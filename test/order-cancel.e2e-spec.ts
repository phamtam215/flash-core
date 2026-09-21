import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infra/prisma';
import { QueueService } from '../src/infra/queue';
import { ORDER_PAYMENTS, OrderExpiryService, type OrderPayments } from '../src/modules/order';
import { csrfAgent } from './http-helper';
import { startInfra } from './infra-fixture';

/**
 * Integration test cho `POST /orders/:id/cancel` — test case 1–11 trong
 * docs/specs/huy-don-chu-dong.md.
 *
 * Tính chất đáng tiền nhất của cả file: **ba đường cùng huỷ một đơn (người mua bấm, delayed
 * job, sweeper) nhưng tồn kho chỉ được trả đúng một lần.** Không thể chứng minh bằng mock —
 * mock không có transaction, không có `UPDATE` có điều kiện, nên nhánh "0 dòng bị đổi" (thứ
 * duy nhất giữ cho tồn kho không nhân đôi) sẽ không bao giờ chạy.
 *
 * Chạy: `npm run test:int` (cần Docker).
 */
describe('Huỷ đơn chủ động (e2e)', () => {
  let stopInfra: () => Promise<void>;
  let app: INestApplication;
  let prisma: PrismaService;
  let queue: QueueService;
  let expiry: OrderExpiryService;

  const WEBHOOK_SECRET = 'test-webhook-secret-toi-thieu-32-ky-tu';

  beforeAll(async () => {
    stopInfra = await startInfra();

    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-toi-thieu-32-ky-tu!!';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-toi-thieu-32-ky-tu!';
    process.env.CSRF_SECRET = 'test-csrf-secret-toi-thieu-32-ky-tu!!!';
    process.env.PAYMENT_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.INVENTORY_STRATEGY = 'optimistic';
    // 5 phút: đủ dài để KHÔNG đơn nào tự hết hạn giữa chừng. Cả file này nói về huỷ *chủ
    // động*, nên đơn tự hết hạn sẽ làm mọi khẳng định về tồn kho thành mơ hồ.
    process.env.ORDER_HOLD_MINUTES = '5';
    process.env.DATABASE_POOL_MAX = '20';
    process.env.QUEUE_PREFIX = `test-${randomUUID().slice(0, 8)}`;

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env }, stdio: 'pipe' });

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.use(cookieParser());
    await app.init();
    await app.listen(0);

    prisma = app.get(PrismaService);
    queue = app.get(QueueService);
    expiry = app.get(OrderExpiryService);
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    await queue?.connection.quit().catch(() => undefined);
    await stopInfra?.();
  });

  // ── Tiện ích ───────────────────────────────────────────────────────────────────────────

  function baseUrl(): string {
    const address = app.getHttpServer().address() as { port: number };
    return `http://127.0.0.1:${String(address.port)}`;
  }

  async function loginAsNewUser() {
    const { agent, token, csrfCookie } = await csrfAgent(app);
    const email = `cancel-${randomUUID()}@example.com`;
    await agent.post('/auth/register').send({ email, password: 'matkhau123' }).expect(201);
    const login = await agent.post('/auth/login').send({ email, password: 'matkhau123' }).expect(200);
    // Lấy cookie thô để test song song bắn bằng `fetch`: supertest tự `listen()` rồi ĐÓNG
    // server sau mỗi request, nên n request song song qua agent sẽ đỏ `ECONNRESET` — bug đã
    // gặp thật ở Phase 3 test #8, ghi ở tech-playbook §Testing.
    const cookies = (login.headers['set-cookie'] as unknown as string[]) ?? [];
    // Kèm cả cookie CSRF: `fetch` không dùng cookie jar của agent nên phải tự ghép, và từ
    // ADR-009 thì thiếu nó là 403 chứ không phải 401 — dễ đọc nhầm thành "lỗi đăng nhập".
    const cookie = [...cookies.map((c) => c.split(';')[0]), csrfCookie].join('; ');
    return { agent, cookie, csrfHeader: { cookie, 'x-csrf-token': token } };
  }

  async function seedSku(stock: number, priceVnd = 150_000): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const product = await prisma.product.create({
      data: { name: `Áo huỷ ${suffix}`, slug: `ao-huy-${suffix}`, status: 'ACTIVE' },
    });
    const sku = await prisma.productSku.create({
      data: {
        productId: product.id,
        size: 'M',
        color: 'Đen',
        skuCode: `AOHUY-${suffix.toUpperCase()}-M`,
        priceVnd,
        stock,
      },
    });
    return sku.id;
  }

  async function placeOrder(
    agent: ReturnType<typeof request.agent>,
    skuId: string,
    quantity = 1,
  ): Promise<{ id: string; totalVnd: number }> {
    const res = await agent
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ skuId, quantity })
      .expect(201);
    return res.body.order as { id: string; totalVnd: number };
  }

  async function stockOf(skuId: string): Promise<number> {
    const sku = await prisma.productSku.findUniqueOrThrow({ where: { id: skuId } });
    return sku.stock;
  }

  async function statusOf(orderId: string): Promise<string> {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    return order.status;
  }

  // ── Test cases ─────────────────────────────────────────────────────────────────────────

  it('1. huỷ đơn PENDING → 200, status CANCELLED, tồn kho trở lại đúng số cũ', async () => {
    const { agent } = await loginAsNewUser();
    const skuId = await seedSku(10);
    const order = await placeOrder(agent, skuId, 2);
    expect(await stockOf(skuId)).toBe(8);

    const res = await agent.post(`/orders/${order.id}/cancel`).expect(200);

    expect(res.body.order.status).toBe('CANCELLED');
    expect(res.body.order.cancelledAt).not.toBeNull();
    expect(await stockOf(skuId)).toBe(10);
  });

  it('2. ⭐ huỷ lần hai → 200 (không phải lỗi), tồn kho KHÔNG tăng tiếp', async () => {
    const { agent } = await loginAsNewUser();
    const skuId = await seedSku(10);
    const order = await placeOrder(agent, skuId, 2);

    await agent.post(`/orders/${order.id}/cancel`).expect(200);
    await agent.post(`/orders/${order.id}/cancel`).expect(200);

    // 12 là con số phải không bao giờ thấy: nó nghĩa là kho "đẻ" ra hàng không có thật.
    expect(await stockOf(skuId)).toBe(10);
  });

  it('3. ⭐ 20 request huỷ SONG SONG cùng một đơn → tồn kho chỉ trả một lần, không 5xx', async () => {
    const { agent, csrfHeader } = await loginAsNewUser();
    const skuId = await seedSku(10);
    const order = await placeOrder(agent, skuId, 2);

    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        fetch(`${baseUrl()}/orders/${order.id}/cancel`, { method: 'POST', headers: csrfHeader }),
      ),
    );

    const codes = responses.map((r) => r.status);
    expect(codes.filter((c) => c >= 500)).toHaveLength(0);
    expect(codes.every((c) => c === 200)).toBe(true);
    expect(await stockOf(skuId)).toBe(10);
  });

  it('4. huỷ đơn của NGƯỜI KHÁC → 404, đơn vẫn PENDING, tồn kho không đổi', async () => {
    const a = await loginAsNewUser();
    const b = await loginAsNewUser();
    const skuId = await seedSku(10);
    const order = await placeOrder(a.agent, skuId, 2);

    await b.agent.post(`/orders/${order.id}/cancel`).expect(404);

    expect(await statusOf(order.id)).toBe('PENDING');
    expect(await stockOf(skuId)).toBe(8);
  });

  it('5. ⭐ đơn đã PAID → 409 ORDER_NOT_CANCELLABLE, vẫn PAID, tồn kho không đổi', async () => {
    const { agent } = await loginAsNewUser();
    const skuId = await seedSku(10);
    const order = await placeOrder(agent, skuId, 2);
    await prisma.order.update({
      where: { id: order.id },
      data: { status: 'PAID', paidAt: new Date() },
    });

    const res = await agent.post(`/orders/${order.id}/cancel`).expect(409);

    expect(res.body.code).toBe('ORDER_NOT_CANCELLABLE');
    expect(await statusOf(order.id)).toBe('PAID');
    expect(await stockOf(skuId)).toBe(8);
  });

  it('6. ⭐ huỷ chủ động rồi delayed job order.expire nổ → KHÔNG trả kho lần hai', async () => {
    const { agent } = await loginAsNewUser();
    const skuId = await seedSku(10);
    const order = await placeOrder(agent, skuId, 2);
    await agent.post(`/orders/${order.id}/cancel`).expect(200);
    expect(await stockOf(skuId)).toBe(10);

    // Đúng thứ worker sẽ gọi khi job nổ sau 5 phút. Job KHÔNG được gỡ khỏi queue lúc huỷ —
    // nó tự vô hại vì `UPDATE ... WHERE status='PENDING'` đổi 0 dòng.
    await expect(expiry.cancelExpired(order.id)).resolves.toBe(false);

    expect(await stockOf(skuId)).toBe(10);
  });

  it('7. huỷ chủ động rồi sweeper chạy → không đếm đơn đó, tồn kho không đổi', async () => {
    const { agent } = await loginAsNewUser();
    const skuId = await seedSku(10);
    const order = await placeOrder(agent, skuId, 2);
    await agent.post(`/orders/${order.id}/cancel`).expect(200);

    // Ép đơn "quá hạn" để chắc chắn sweeper NHÌN THẤY nó — rồi vẫn phải bỏ qua vì đã CANCELLED.
    await prisma.order.update({
      where: { id: order.id },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    await expiry.sweepExpired();

    expect(await stockOf(skuId)).toBe(10);
    expect(await statusOf(order.id)).toBe('CANCELLED');
  });

  it('8. ⭐ huỷ chủ động rồi webhook thanh toán tới → vẫn CANCELLED, ghi 1 refund_requests', async () => {
    const { agent } = await loginAsNewUser();
    const skuId = await seedSku(10);
    const order = await placeOrder(agent, skuId, 2);
    await agent.post(`/orders/${order.id}/cancel`).expect(200);

    // Đi qua đúng cửa hẹp mà module `payment` dùng — không gọi thẳng vào nội bộ order.
    const payments = app.get<OrderPayments>(ORDER_PAYMENTS);
    await payments.settle({
      eventId: randomUUID(),
      orderId: order.id,
      paymentIntentId: `pi_${randomUUID().slice(0, 8)}`,
      amountVnd: order.totalVnd,
      correlationId: 'test',
    });

    expect(await statusOf(order.id)).toBe('CANCELLED');
    const refunds = await prisma.refundRequest.findMany({ where: { orderId: order.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.reason).toBe('ORDER_ALREADY_CANCELLED');
  });

  it('9. đơn nhiều SKU → mỗi SKU được trả đúng số lượng của dòng đó', async () => {
    const { agent } = await loginAsNewUser();
    const skuA = await seedSku(10);
    const skuB = await seedSku(10);
    const orderA = await placeOrder(agent, skuA, 1);
    const orderB = await placeOrder(agent, skuB, 3);
    expect(await stockOf(skuA)).toBe(9);
    expect(await stockOf(skuB)).toBe(7);

    await agent.post(`/orders/${orderA.id}/cancel`).expect(200);
    await agent.post(`/orders/${orderB.id}/cancel`).expect(200);

    expect(await stockOf(skuA)).toBe(10);
    expect(await stockOf(skuB)).toBe(10);
  });

  it('10. id không phải UUID → 404, KHÔNG để lỗi cast ::uuid thành 500', async () => {
    const { agent } = await loginAsNewUser();

    await agent.post('/orders/khong-phai-uuid/cancel').expect(404);
  });

  it('11. có token CSRF nhưng chưa đăng nhập → 401 (không lẫn với 403 của CSRF)', async () => {
    // Gửi token CSRF hợp lệ để tách bạch hai lớp: qua được CsrfGuard rồi mới tới guard đăng
    // nhập. Không gửi thì kết quả là 403 và test này không còn kiểm được điều nó định kiểm.
    const { token, csrfCookie } = await csrfAgent(app);

    const res = await fetch(`${baseUrl()}/orders/${randomUUID()}/cancel`, {
      method: 'POST',
      headers: { cookie: csrfCookie, 'x-csrf-token': token },
    });

    expect(res.status).toBe(401);
  });
});
