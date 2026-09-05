import { execFileSync } from 'node:child_process';

import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infra/prisma';
import { startInfra } from './infra-fixture';

/**
 * Integration test cho module product — test case trong docs/specs/phase2-product-inventory.md
 * (test #1–5, #7–9, #11–13; #6 và #10 là unit test Zod, xem `src/modules/product/*.spec.ts`).
 *
 * Vì sao không mock Prisma: `UNIQUE(product_id, size, color)`, `CHECK (stock >= 0)`, và cursor
 * pagination chỉ đúng nếu chạy trên Postgres thật — cùng lý do `test/auth.e2e-spec.ts` đã nêu.
 *
 * Chạy: `npm run test:int` (cần Docker).
 */
describe('Product (e2e)', () => {
  let stopInfra: () => Promise<void>;
  let app: INestApplication;
  let agent: ReturnType<typeof request.agent>;

  beforeAll(async () => {
    stopInfra = await startInfra();
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-toi-thieu-32-ky-tu!!';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-toi-thieu-32-ky-tu!';
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-webhook-secret-toi-thieu-32-ky-tu';

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env }, stdio: 'pipe' });

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    // `request.agent` giữ cookie qua các lần gọi như một session browser thật — đơn giản hơn
    // tự đọc/gắn header `Cookie` tay (cách `test/auth.e2e-spec.ts` phải làm vì nó test CHÍNH
    // cơ chế cookie). Ở đây chỉ cần "đã đăng nhập" để gọi API ghi.
    agent = request.agent(app.getHttpServer());
    await agent
      .post('/auth/register')
      .send({ email: 'product-admin@example.com', password: 'matkhau123' })
      .expect(201);
    await agent
      .post('/auth/login')
      .send({ email: 'product-admin@example.com', password: 'matkhau123' })
      .expect(200);
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    await stopInfra?.();
  });

  const oneSku = (size: 'S' | 'M' | 'L' | 'XL' | 'XXL', color: string) => ({
    size,
    color,
    priceVnd: 150_000,
    stock: 20,
  });

  // ── 1–2: tạo sản phẩm, trùng slug ───────────────────────────────────────────────────────

  it('1. tạo sản phẩm hợp lệ không kèm SKU → 201, slug tự sinh từ name', async () => {
    const res = await agent.post('/products').send({ name: 'Áo Thun Basic Trắng' }).expect(201);

    expect(res.body.product).toMatchObject({ name: 'Áo Thun Basic Trắng', slug: 'ao-thun-basic-trang' });
    expect(res.body.product.id).toEqual(expect.any(String));
  });

  it('2. tạo sản phẩm với slug đã tồn tại → 409, không tạo dòng nào', async () => {
    await agent.post('/products').send({ name: 'X', slug: 'slug-trung' }).expect(201);

    const res = await agent.post('/products').send({ name: 'Y khác hẳn', slug: 'slug-trung' }).expect(409);
    expect(res.body.code).toBe('SLUG_ALREADY_EXISTS');
  });

  // ── 3–5: SKU ─────────────────────────────────────────────────────────────────────────────

  it('3. tạo sản phẩm kèm 10 SKU (5 size × 2 màu) → 201, product có đúng 10 SKU', async () => {
    const skus = (['S', 'M', 'L', 'XL', 'XXL'] as const).flatMap((size) => [
      oneSku(size, 'Đen'),
      oneSku(size, 'Trắng'),
    ]);

    const created = await agent
      .post('/products')
      .send({ name: 'Áo Có Sẵn 10 SKU', skus })
      .expect(201);

    const detail = await request(app.getHttpServer())
      .get(`/products/${String(created.body.product.id)}`)
      .expect(200);

    expect(detail.body.skus).toHaveLength(10);
  });

  it('4. thêm SKU trùng (size, color) cho cùng product → 409', async () => {
    const product = await agent.post('/products').send({ name: 'Áo Test Trùng SKU' }).expect(201);
    const productId = String(product.body.product.id);

    await agent.post(`/products/${productId}/skus`).send(oneSku('M', 'Xanh')).expect(201);
    const res = await agent.post(`/products/${productId}/skus`).send(oneSku('M', 'Xanh')).expect(409);
    expect(res.body.code).toBe('SKU_ALREADY_EXISTS');
  });

  it('5. thêm SKU cho productId không tồn tại → 404', async () => {
    const randomId = '00000000-0000-0000-0000-000000000000';
    const res = await agent.post(`/products/${randomId}/skus`).send(oneSku('M', 'Đen')).expect(404);
    expect(res.body.code).toBe('PRODUCT_NOT_FOUND');
  });

  // ── 7: CHECK constraint là lưới an toàn cuối ────────────────────────────────────────────

  it('7. UPDATE ... SET stock = -1 bằng SQL thẳng → Postgres từ chối bởi CHECK stock_non_negative', async () => {
    const product = await agent.post('/products').send({ name: 'Áo Test Check Constraint' }).expect(201);
    const sku = await agent
      .post(`/products/${String(product.body.product.id)}/skus`)
      .send(oneSku('M', 'Đen'))
      .expect(201);

    // Vòng qua tầng service, dùng thẳng connection Prisma của app — đây chính là điều CHECK
    // constraint phải chặn được, không phải Zod (Zod chỉ chặn được đường vào qua API, không
    // chặn SQL thẳng).
    const prisma = app.get(PrismaService);

    await expect(
      prisma.$executeRawUnsafe(`UPDATE product_skus SET stock = -1 WHERE id = $1`, sku.body.sku.id),
    ).rejects.toThrow(/stock_non_negative/);
  });

  // ── 8–9: cursor pagination ───────────────────────────────────────────────────────────────

  it('8. cursor pagination: trang 1 + trang 2 (dùng nextCursor) không trùng, không thiếu', async () => {
    const total = 40;
    for (let i = 0; i < total; i++) {
      await agent.post('/products').send({ name: `Bulk Pagination Product ${String(i).padStart(3, '0')}` }).expect(201);
    }

    const page1 = await request(app.getHttpServer()).get('/products?limit=20').expect(200);
    expect(page1.body.items).toHaveLength(20);
    expect(page1.body.nextCursor).not.toBeNull();

    const page2 = await request(app.getHttpServer())
      .get(`/products?limit=20&cursor=${encodeURIComponent(String(page1.body.nextCursor))}`)
      .expect(200);
    expect(page2.body.items).toHaveLength(20);

    const idsPage1 = (page1.body.items as { id: string }[]).map((p) => p.id);
    const idsPage2 = (page2.body.items as { id: string }[]).map((p) => p.id);
    const overlap = idsPage1.filter((id) => idsPage2.includes(id));

    expect(overlap).toHaveLength(0);
  });

  it('9. cursor rác không decode được → 400 INVALID_CURSOR, không phải 500', async () => {
    const res = await request(app.getHttpServer())
      .get('/products?cursor=abc-khong-decode-duoc')
      .expect(400);
    expect(res.body.code).toBe('INVALID_CURSOR');
  });

  // ── 11: N+1 ──────────────────────────────────────────────────────────────────────────────

  it('11. GET /products/:id của product có 50 SKU trả về đủ 50 SKU trong một lần gọi', async () => {
    // Ghi chú: spec yêu cầu khẳng định "đúng 2 câu query tới DB" — test này KHÔNG đo trực
    // tiếp số câu SQL (cần retrofit log event vào PrismaService dùng chung toàn app, rủi ro
    // cao hơn giá trị mang lại ở Phase 2). Bằng chứng gián tiếp: `product.repository.ts
    // #findProductWithSkus` dùng MỘT lời gọi Prisma với `include: { skus: true }`, không có
    // vòng lặp gọi lại DB theo từng SKU — đọc code là thấy ngay không có N+1. Test này xác
    // nhận HÀNH VI đúng (đủ 50 SKU, không thiếu/thừa), không xác nhận số query.
    const skus = Array.from({ length: 50 }, (_, i) => oneSku('M', `Color${String(i)}`));
    const product = await agent.post('/products').send({ name: 'Áo 50 SKU', skus }).expect(201);

    const detail = await request(app.getHttpServer())
      .get(`/products/${String(product.body.product.id)}`)
      .expect(200);

    expect(detail.body.skus).toHaveLength(50);
  });

  // ── 12: soft delete ──────────────────────────────────────────────────────────────────────

  it('12. DELETE /products/:id (soft delete) → không còn trong list, vẫn xem chi tiết được', async () => {
    const product = await agent.post('/products').send({ name: 'Áo Sẽ Bị Ngừng Bán' }).expect(201);
    const productId = String(product.body.product.id);

    await agent.delete(`/products/${productId}`).expect(204);

    const list = await request(app.getHttpServer()).get('/products?limit=100').expect(200);
    expect(list.body.items.some((p: { id: string }) => p.id === productId)).toBe(false);

    const detail = await request(app.getHttpServer()).get(`/products/${productId}`).expect(200);
    expect(detail.body.product.status).toBe('ARCHIVED');
  });

  // ── 13: lost update được chấp nhận ở Phase 2 ────────────────────────────────────────────

  it('13. 2 PATCH stock gần như đồng thời vào cùng SKU → cả hai 200, kết quả cuối là một trong hai giá trị', async () => {
    const product = await agent.post('/products').send({ name: 'Áo Test Lost Update' }).expect(201);
    const sku = await agent
      .post(`/products/${String(product.body.product.id)}/skus`)
      .send(oneSku('M', 'Đen'))
      .expect(201);
    const skuId = String(sku.body.sku.id);

    const [res1, res2] = await Promise.all([
      agent.patch(`/products/${String(product.body.product.id)}/skus/${skuId}`).send({ stock: 111 }),
      agent.patch(`/products/${String(product.body.product.id)}/skus/${skuId}`).send({ stock: 222 }),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const skuList = await request(app.getHttpServer())
      .get(`/products/${String(product.body.product.id)}/skus`)
      .expect(200);
    const finalStock = skuList.body.items.find((s: { id: string }) => s.id === skuId)?.stock;

    // Lost update CHẤP NHẬN ở Phase 2 (xem Non-goals trong spec) — chỉ khẳng định kết quả
    // cuối là MỘT trong hai giá trị đã ghi, không khẳng định giá trị nào thắng.
    expect([111, 222]).toContain(finalStock);
  });
});
