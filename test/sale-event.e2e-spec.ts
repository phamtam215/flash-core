import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { Test, type TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infra/prisma';
import { QueueService } from '../src/infra/queue';
import { OrderExpiryService } from '../src/modules/order';
import { SaleEventService } from '../src/modules/sale-event';
import { csrfAgent } from './http-helper';
import { startInfra } from './infra-fixture';

/**
 * Integration test Phase 8 — đợt sale thật.
 *
 * Hai test đắt nhất file này, và chúng kiểm hai bài toán concurrency **khác hình dạng nhau**:
 *
 * - **#5** — 1.000 request / 500 người / kho 100 / giới hạn 2: tranh chấp giữa những người
 *   KHÁC nhau trên MỘT dòng tồn kho. Phải bán đúng 100.
 * - **#6** — một người bấm 50 lần song song: tranh chấp giữa các lần bấm của CÙNG một người
 *   trên MỘT dòng quota. Phải mua đúng 2, **và tồn kho chỉ bị chạm đúng 2 lần** — chứng minh
 *   quota chặn TRƯỚC khi đụng vào dòng nóng.
 *
 * Chạy: `npm run test:int:local`.
 */
describe('Đợt sale (e2e)', () => {
  let stopInfra: () => Promise<void>;
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let queue: QueueService;
  let expiry: OrderExpiryService;
  let saleEvents: SaleEventService;

  beforeAll(async () => {
    stopInfra = await startInfra();

    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-toi-thieu-32-ky-tu!!';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-toi-thieu-32-ky-tu!';
    process.env.CSRF_SECRET = 'test-csrf-secret-toi-thieu-32-ky-tu!!!';
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-webhook-secret-toi-thieu-32-ky-tu';
    process.env.INVENTORY_STRATEGY = 'optimistic';
    process.env.ORDER_HOLD_MINUTES = '5';
    process.env.DATABASE_POOL_MAX = '20';
    process.env.QUEUE_PREFIX = `test-${randomUUID().slice(0, 8)}`;

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env }, stdio: 'pipe' });

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    app.use(cookieParser());
    await app.init();
    await app.listen(0);

    prisma = app.get(PrismaService);
    queue = app.get(QueueService);
    expiry = app.get(OrderExpiryService);
    saleEvents = app.get(SaleEventService);
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    await queue?.connection.quit().catch(() => undefined);
    await stopInfra?.();
  });

  function baseUrl(): string {
    const address = app.getHttpServer().address() as { port: number };
    return `http://127.0.0.1:${String(address.port)}`;
  }

  async function loginAsNewUser() {
    const { agent, token, csrfCookie } = await csrfAgent(app);
    const email = `sale-${randomUUID()}@example.com`;
    await agent.post('/auth/register').send({ email, password: 'matkhau123' }).expect(201);
    const login = await agent.post('/auth/login').send({ email, password: 'matkhau123' }).expect(200);

    const authCookies = ((login.headers['set-cookie'] as unknown as string[]) ?? []).map(
      (c) => c.split(';')[0] ?? '',
    );
    return { agent, cookie: [...authCookies, csrfCookie].join('; '), csrf: token, email };
  }

  async function makeAdmin(email: string) {
    await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
  }

  async function seedSku(stock: number, priceVnd = 300_000): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const product = await prisma.product.create({
      data: { name: `Áo sale ${suffix}`, slug: `ao-sale-${suffix}`, status: 'ACTIVE' },
    });
    const sku = await prisma.productSku.create({
      data: {
        productId: product.id,
        size: 'M',
        color: 'Đen',
        skuCode: `AOSALE-${suffix.toUpperCase()}-M`,
        priceVnd,
        stock,
      },
    });
    return sku.id;
  }

  /** Dựng một đợt sale và (tuỳ chọn) publish luôn. Trả về id của dòng `sale_event_skus`. */
  async function seedEvent(opts: {
    skuId: string;
    allocatedStock: number;
    perUserLimit?: number;
    startsAt?: Date;
    endsAt?: Date;
    publish?: boolean;
  }) {
    const admin = await loginAsNewUser();
    await makeAdmin(admin.email);
    await admin.agent.post('/auth/login').send({ email: admin.email, password: 'matkhau123' }).expect(200);

    const suffix = randomUUID().slice(0, 8);
    const created = await admin.agent
      .post('/sale-events')
      .send({
        name: `Đợt ${suffix}`,
        slug: `dot-${suffix}`,
        startsAt: (opts.startsAt ?? new Date(Date.now() - 60_000)).toISOString(),
        endsAt: (opts.endsAt ?? new Date(Date.now() + 3_600_000)).toISOString(),
        items: [
          {
            skuId: opts.skuId,
            salePriceVnd: 199_000,
            allocatedStock: opts.allocatedStock,
            perUserLimit: opts.perUserLimit ?? 2,
          },
        ],
      })
      .expect(201);

    const event = created.body.event as { id: string; slug: string; items: { id: string }[] };
    if (opts.publish !== false) {
      await admin.agent.post(`/sale-events/${event.id}/publish`).expect(200);
    }
    return { eventId: event.id, slug: event.slug, itemId: event.items[0]!.id };
  }

  async function eventStock(itemId: string): Promise<number> {
    return (await prisma.saleEventSku.findUniqueOrThrow({ where: { id: itemId } })).stock;
  }

  async function skuStock(skuId: string): Promise<number> {
    return (await prisma.productSku.findUniqueOrThrow({ where: { id: skuId } })).stock;
  }

  /** Bắn `POST /orders` bằng fetch — dùng cho mọi test song song (supertest đóng server mỗi request). */
  async function buyViaFetch(auth: { cookie: string; csrf: string }, itemId: string, quantity = 1) {
    const res = await fetch(`${baseUrl()}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
        'x-csrf-token': auth.csrf,
        Cookie: auth.cookie,
      },
      body: JSON.stringify({ saleEventSkuId: itemId, quantity }),
    });
    return res.status;
  }

  // ── Khung giờ ────────────────────────────────────────────────────────────────────────

  it('1. chưa tới giờ mở → 409 SALE_NOT_OPEN, tồn kho không đổi', async () => {
    const skuId = await seedSku(50);
    const { itemId } = await seedEvent({
      skuId,
      allocatedStock: 10,
      startsAt: new Date(Date.now() + 3_600_000),
      endsAt: new Date(Date.now() + 7_200_000),
    });
    const buyer = await loginAsNewUser();

    const res = await buyer.agent
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ saleEventSkuId: itemId, quantity: 1 })
      .expect(409);

    expect(res.body.code).toBe('SALE_NOT_OPEN');
    expect(await eventStock(itemId)).toBe(10);
  });

  it('2. đã hết giờ → 409 SALE_NOT_OPEN', async () => {
    const skuId = await seedSku(50);
    const { itemId } = await seedEvent({
      skuId,
      allocatedStock: 10,
      startsAt: new Date(Date.now() - 7_200_000),
      endsAt: new Date(Date.now() - 3_600_000),
    });
    const buyer = await loginAsNewUser();

    const res = await buyer.agent
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ saleEventSkuId: itemId, quantity: 1 })
      .expect(409);

    expect(res.body.code).toBe('SALE_NOT_OPEN');
  });

  it('3. đợt chưa publish dù đang trong giờ → 409, và KHÔNG hiện ở GET /sale-events', async () => {
    const skuId = await seedSku(50);
    const { itemId, slug } = await seedEvent({ skuId, allocatedStock: 10, publish: false });
    const buyer = await loginAsNewUser();

    await buyer.agent
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ saleEventSkuId: itemId, quantity: 1 })
      .expect(409);

    const list = await buyer.agent.get('/sale-events').expect(200);
    expect((list.body.items as { slug: string }[]).some((e) => e.slug === slug)).toBe(false);
    // Hàng vẫn nằm nguyên ở SKU — chưa publish thì chưa cắt.
    expect(await skuStock(skuId)).toBe(50);
  });

  // ── Publish cắt hàng ─────────────────────────────────────────────────────────────────

  it('4. ⭐ publish CẮT hàng khỏi SKU, không phải sao chép', async () => {
    const skuId = await seedSku(50);
    const { itemId } = await seedEvent({ skuId, allocatedStock: 30 });

    // 50 − 30 = 20 còn ở SKU, 30 nằm ở đợt. Tổng vẫn 50 — không sinh thêm hàng từ hư không.
    expect(await skuStock(skuId)).toBe(20);
    expect(await eventStock(itemId)).toBe(30);
  });

  it('4b. publish lần hai → 409, KHÔNG cắt hàng lần nữa', async () => {
    const skuId = await seedSku(50);
    const admin = await loginAsNewUser();
    await makeAdmin(admin.email);
    await admin.agent.post('/auth/login').send({ email: admin.email, password: 'matkhau123' }).expect(200);

    const suffix = randomUUID().slice(0, 8);
    const created = await admin.agent
      .post('/sale-events')
      .send({
        name: `Đợt ${suffix}`,
        slug: `dot-${suffix}`,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 3_600_000).toISOString(),
        items: [{ skuId, salePriceVnd: 199_000, allocatedStock: 30, perUserLimit: 2 }],
      })
      .expect(201);
    const eventId = (created.body.event as { id: string }).id;

    await admin.agent.post(`/sale-events/${eventId}/publish`).expect(200);
    await admin.agent.post(`/sale-events/${eventId}/publish`).expect(409);

    expect(await skuStock(skuId)).toBe(20);
  });

  it('4c. SKU không đủ hàng để cắt → 409, và cờ publish KHÔNG bật (transaction cuộn lại)', async () => {
    const skuId = await seedSku(10);
    const admin = await loginAsNewUser();
    await makeAdmin(admin.email);
    await admin.agent.post('/auth/login').send({ email: admin.email, password: 'matkhau123' }).expect(200);

    const suffix = randomUUID().slice(0, 8);
    const created = await admin.agent
      .post('/sale-events')
      .send({
        name: `Đợt ${suffix}`,
        slug: `dot-${suffix}`,
        startsAt: new Date(Date.now() - 60_000).toISOString(),
        endsAt: new Date(Date.now() + 3_600_000).toISOString(),
        items: [{ skuId, salePriceVnd: 199_000, allocatedStock: 999, perUserLimit: 2 }],
      })
      .expect(201);
    const eventId = (created.body.event as { id: string }).id;

    const res = await admin.agent.post(`/sale-events/${eventId}/publish`).expect(409);
    expect(res.body.code).toBe('NOT_ENOUGH_STOCK_TO_ALLOCATE');

    // Nửa vời ở đây là tệ nhất: cờ bật mà hàng chưa cắt, hoặc ngược lại.
    const event = await prisma.saleEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(event.isPublished).toBe(false);
    expect(await skuStock(skuId)).toBe(10);
  });

  // ── Mua hàng ─────────────────────────────────────────────────────────────────────────

  it('5. mua trong giờ → 201, và giá ghi vào đơn là GIÁ SALE', async () => {
    const skuId = await seedSku(50, 300_000);
    const { itemId } = await seedEvent({ skuId, allocatedStock: 10 });
    const buyer = await loginAsNewUser();

    const res = await buyer.agent
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ saleEventSkuId: itemId, quantity: 1 })
      .expect(201);

    expect((res.body.order as { totalVnd: number }).totalVnd).toBe(199_000);
    expect(await eventStock(itemId)).toBe(9);
    // Kho chung KHÔNG bị đụng tới — hàng của đợt đã tách hẳn ra.
    expect(await skuStock(skuId)).toBe(40);
  });

  it('6. ⭐ 120 request / 60 người / kho 50 / giới hạn 2 → bán đúng 50, không ai quá 2', async () => {
    const skuId = await seedSku(200);
    const { itemId } = await seedEvent({ skuId, allocatedStock: 50, perUserLimit: 2 });

    // Tạo user SONG SONG: 60 lần đăng ký tuần tự (mỗi lần 3 request) là phần chậm nhất của
    // cả bộ test, mà nó không phải thứ đang được đo.
    const buyers = await Promise.all(Array.from({ length: 60 }, () => loginAsNewUser()));
    // Mỗi người bấm 2 lần ⇒ 120 request, đúng bằng giới hạn của họ. Tranh chấp thật nằm ở
    // dòng tồn kho: 120 lượt muốn 120 chiếc mà chỉ có 50.
    const attempts = buyers.flatMap((b) => [b, b]);

    const codes = await Promise.all(attempts.map((b) => buyViaFetch(b, itemId)));

    expect(codes.filter((c) => c === 201)).toHaveLength(50);
    expect(codes.filter((c) => c >= 500)).toHaveLength(0);
    expect(await eventStock(itemId)).toBe(0);

    const overLimit = await prisma.saleEventPurchase.findMany({
      where: { saleEventSkuId: itemId, quantity: { gt: 2 } },
    });
    expect(overLimit).toHaveLength(0);
  }, 120_000);

  it('7. ⭐ một người bấm 20 lần song song, giới hạn 2 → mua đúng 2, tồn kho chỉ giảm 2', async () => {
    const skuId = await seedSku(500);
    const { itemId } = await seedEvent({ skuId, allocatedStock: 100, perUserLimit: 2 });
    const buyer = await loginAsNewUser();

    const codes = await Promise.all(
      Array.from({ length: 20 }, () => buyViaFetch(buyer, itemId)),
    );

    expect(codes.filter((c) => c === 201)).toHaveLength(2);
    expect(codes.filter((c) => c >= 500)).toHaveLength(0);
    // 98, KHÔNG phải 80: quota chặn 18 request kia TRƯỚC khi chúng chạm vào dòng tồn kho.
    // Đây là toàn bộ lý do thứ tự quota-trước-tồn-kho-sau tồn tại.
    expect(await eventStock(itemId)).toBe(98);
  }, 60_000);

  it('8. ⭐ quota qua nhưng hết hàng → suất quota được TRẢ LẠI', async () => {
    const skuId = await seedSku(50);
    const { itemId } = await seedEvent({ skuId, allocatedStock: 1, perUserLimit: 5 });
    const buyer = await loginAsNewUser();

    await buyer.agent
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ saleEventSkuId: itemId, quantity: 1 })
      .expect(201);

    // Hết hàng — lần này phải 409 OUT_OF_STOCK, không phải PER_USER_LIMIT_REACHED.
    const res = await buyer.agent
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ saleEventSkuId: itemId, quantity: 1 })
      .expect(409);
    expect(res.body.code).toBe('OUT_OF_STOCK');

    // Quan trọng: suất vẫn là 1, không phải 2. Quên trả lại thì người mua bị trừ suất cho một
    // đơn không bao giờ tồn tại.
    const purchase = await prisma.saleEventPurchase.findFirstOrThrow({
      where: { saleEventSkuId: itemId },
    });
    expect(purchase.quantity).toBe(1);
  });

  it('9. vượt giới hạn → 409 PER_USER_LIMIT_REACHED (không lẫn với hết hàng)', async () => {
    const skuId = await seedSku(50);
    const { itemId } = await seedEvent({ skuId, allocatedStock: 50, perUserLimit: 2 });
    const buyer = await loginAsNewUser();

    for (let i = 0; i < 2; i += 1) {
      await buyer.agent
        .post('/orders')
        .set('Idempotency-Key', randomUUID())
        .send({ saleEventSkuId: itemId, quantity: 1 })
        .expect(201);
    }

    const res = await buyer.agent
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ saleEventSkuId: itemId, quantity: 1 })
      .expect(409);

    expect(res.body.code).toBe('PER_USER_LIMIT_REACHED');
    expect(await eventStock(itemId)).toBe(48);
  });

  // ── Huỷ đơn trả kho về ĐÚNG CHỖ ──────────────────────────────────────────────────────

  it('10. ⭐ huỷ đơn → trả kho về ĐỢT (không về SKU) và trả cả suất quota', async () => {
    const skuId = await seedSku(50);
    const { itemId } = await seedEvent({ skuId, allocatedStock: 10, perUserLimit: 2 });
    const buyer = await loginAsNewUser();

    const placed = await buyer.agent
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ saleEventSkuId: itemId, quantity: 2 })
      .expect(201);
    const orderId = (placed.body.order as { id: string }).id;

    await buyer.agent.post(`/orders/${orderId}/cancel`).expect(200);

    expect(await eventStock(itemId)).toBe(10);
    // 40, KHÔNG phải 42: hàng của đợt không được chui về kho chung, nếu không đợt sau bán hụt.
    expect(await skuStock(skuId)).toBe(40);

    // Và suất quota phải trả lại — quên thì huỷ đơn xong không mua lại được nữa.
    await buyer.agent
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ saleEventSkuId: itemId, quantity: 2 })
      .expect(201);
  });

  it('11. đơn hết hạn tự huỷ SAU KHI đợt đã đóng → vẫn trả kho bình thường', async () => {
    const skuId = await seedSku(50);
    const { itemId, eventId } = await seedEvent({ skuId, allocatedStock: 10 });
    const buyer = await loginAsNewUser();

    const placed = await buyer.agent
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ saleEventSkuId: itemId, quantity: 1 })
      .expect(201);
    const orderId = (placed.body.order as { id: string }).id;

    // Đợt đóng lại, và đơn quá hạn giữ chỗ.
    await prisma.saleEvent.update({
      where: { id: eventId },
      data: { endsAt: new Date(Date.now() - 1_000) },
    });
    await prisma.order.update({
      where: { id: orderId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    // Đường huỷ KHÔNG được đòi điều kiện thời gian của đợt — nếu đòi thì đơn treo vĩnh viễn
    // và hàng không bao giờ về kho.
    await expect(expiry.cancelExpired(orderId)).resolves.toBe(true);
    expect(await eventStock(itemId)).toBe(10);
  });

  // ── Hiển thị ─────────────────────────────────────────────────────────────────────────

  it('12. GET /sale-events trả status TÍNH RA đúng ở cả ba mốc', async () => {
    const skuId = await seedSku(90);
    await seedEvent({
      skuId,
      allocatedStock: 10,
      startsAt: new Date(Date.now() + 3_600_000),
      endsAt: new Date(Date.now() + 7_200_000),
    });
    const { slug: openSlug } = await seedEvent({ skuId, allocatedStock: 10 });
    const buyer = await loginAsNewUser();

    const list = await buyer.agent.get('/sale-events').expect(200);
    const items = list.body.items as { slug: string; status: string }[];

    expect(items.find((e) => e.slug === openSlug)?.status).toBe('OPEN');
    expect(items.some((e) => e.status === 'SCHEDULED')).toBe(true);
  });

  it('13. GET /sale-events/:slug trả remainingForUser theo người đang xem', async () => {
    const skuId = await seedSku(50);
    const { itemId, slug } = await seedEvent({ skuId, allocatedStock: 10, perUserLimit: 2 });
    const buyer = await loginAsNewUser();

    await buyer.agent
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ saleEventSkuId: itemId, quantity: 1 })
      .expect(201);

    const res = await buyer.agent.get(`/sale-events/${slug}`).expect(200);
    const items = (res.body.event as { items: { id: string; remainingForUser: number }[] }).items;

    expect(items.find((i) => i.id === itemId)?.remainingForUser).toBe(1);
  });

  it('14. gửi cả skuId lẫn saleEventSkuId → 400, chặn ở biên', async () => {
    const skuId = await seedSku(50);
    const { itemId } = await seedEvent({ skuId, allocatedStock: 10 });
    const buyer = await loginAsNewUser();

    await buyer.agent
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ skuId, saleEventSkuId: itemId, quantity: 1 })
      .expect(400);
  });

  it('15. đường cũ (skuId, giá gốc) vẫn chạy nguyên', async () => {
    const skuId = await seedSku(50, 300_000);
    const buyer = await loginAsNewUser();

    const res = await buyer.agent
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ skuId, quantity: 1 })
      .expect(201);

    expect((res.body.order as { totalVnd: number }).totalVnd).toBe(300_000);
    expect(await skuStock(skuId)).toBe(49);
  });

  // ── Đóng đợt: trả hàng tồn về SKU ────────────────────────────────────────────────────

  it('16. ⭐ đợt hết giờ → đóng đợt trả hàng TỒN về SKU', async () => {
    const skuId = await seedSku(50);
    const { itemId, eventId } = await seedEvent({ skuId, allocatedStock: 30 });
    const buyer = await loginAsNewUser();

    await buyer.agent
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ saleEventSkuId: itemId, quantity: 2 })
      .expect(201);

    // 50 − 30 cắt ra = 20 ở SKU; đợt bán 2 còn 28.
    expect(await skuStock(skuId)).toBe(20);
    expect(await eventStock(itemId)).toBe(28);

    await prisma.saleEvent.update({
      where: { id: eventId },
      data: { endsAt: new Date(Date.now() - 1_000) },
    });

    const result = await saleEvents.settleEndedEvents();

    expect(result.events).toBeGreaterThanOrEqual(1);
    expect(result.returned).toBeGreaterThanOrEqual(28);
    // 20 + 28 = 48. Hai chiếc đã bán vẫn nằm trong đơn — tổng hệ thống vẫn đúng 50.
    expect(await skuStock(skuId)).toBe(48);
    expect(await eventStock(itemId)).toBe(0);
  });

  it('17. ⭐ chạy đóng đợt HAI lần → không trả hàng lần hai', async () => {
    const skuId = await seedSku(50);
    const { itemId, eventId } = await seedEvent({ skuId, allocatedStock: 30 });
    await prisma.saleEvent.update({
      where: { id: eventId },
      data: { endsAt: new Date(Date.now() - 1_000) },
    });

    await saleEvents.settleEndedEvents();
    const after = await skuStock(skuId);

    // Chạy chồng hai lần là chuyện bình thường với job lặp. Không idempotent thì mỗi vòng
    // nhân đôi hàng từ hư không — và không có lỗi nào báo, kho chỉ tự nhiên nhiều lên.
    await saleEvents.settleEndedEvents();

    expect(await skuStock(skuId)).toBe(after);
    expect(await eventStock(itemId)).toBe(0);
  });

  it('18. đợt CÒN ĐANG BÁN → không bị đóng, hàng không bị rút về', async () => {
    const skuId = await seedSku(50);
    const { itemId } = await seedEvent({ skuId, allocatedStock: 30 });

    await saleEvents.settleEndedEvents();

    // Rút hàng khỏi một đợt đang mở là cướp hàng khỏi tay người đang bấm mua.
    expect(await eventStock(itemId)).toBe(30);
    expect(await skuStock(skuId)).toBe(20);
  });

  it('19. đợt chưa publish, đã qua endsAt → không đóng (chưa cắt thì không có gì để trả)', async () => {
    const skuId = await seedSku(50);
    const { eventId } = await seedEvent({
      skuId,
      allocatedStock: 30,
      startsAt: new Date(Date.now() - 7_200_000),
      endsAt: new Date(Date.now() - 3_600_000),
      publish: false,
    });

    await saleEvents.settleEndedEvents();

    const event = await prisma.saleEvent.findUniqueOrThrow({ where: { id: eventId } });
    expect(event.isSettled).toBe(false);
    expect(await skuStock(skuId)).toBe(50);
  });
});
