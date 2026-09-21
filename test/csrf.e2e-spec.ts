import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';

import { AppModule } from '../src/app.module';
import { CSRF_COOKIE, CSRF_HEADER } from '../src/common';
import { PrismaService } from '../src/infra/prisma';
import { QueueService } from '../src/infra/queue';
import { signPayload } from '../src/modules/payment';
import { csrfAgent } from './http-helper';
import { startInfra } from './infra-fixture';

/**
 * Integration test cho CSRF — test case 6–14 trong docs/specs/csrf-token.md.
 *
 * Test đắt nhất file này là **#9**: cookie và header khớp nhau nhưng cả hai đều do kẻ tấn công
 * tự chế. Double-submit KHÔNG ký sẽ cho ca đó qua — và đó đúng là kịch bản duy nhất mà dự án
 * làm token vì nó (`SameSite=Strict` đã chặn CSRF cổ điển rồi). Bỏ chữ ký đi thì mọi test khác
 * vẫn xanh; chỉ #9 đỏ.
 *
 * Chạy: `npm run test:int`.
 */
describe('CSRF (e2e)', () => {
  let stopInfra: () => Promise<void>;
  let app: INestApplication;
  let prisma: PrismaService;
  let queue: QueueService;

  const WEBHOOK_SECRET = 'test-webhook-secret-toi-thieu-32-ky-tu';

  beforeAll(async () => {
    stopInfra = await startInfra();

    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-toi-thieu-32-ky-tu!!';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-toi-thieu-32-ky-tu!';
    process.env.PAYMENT_WEBHOOK_SECRET = WEBHOOK_SECRET;
    process.env.CSRF_SECRET = 'test-csrf-secret-toi-thieu-32-ky-tu!!!';
    process.env.INVENTORY_STRATEGY = 'optimistic';
    process.env.ORDER_HOLD_MINUTES = '5';
    process.env.QUEUE_PREFIX = `test-${randomUUID().slice(0, 8)}`;

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env }, stdio: 'pipe' });

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication({ rawBody: true });
    app.use(cookieParser());
    await app.init();
    await app.listen(0);

    prisma = app.get(PrismaService);
    queue = app.get(QueueService);
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

  async function seedSku(stock: number): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const product = await prisma.product.create({
      data: { name: `Áo csrf ${suffix}`, slug: `ao-csrf-${suffix}`, status: 'ACTIVE' },
    });
    const sku = await prisma.productSku.create({
      data: {
        productId: product.id,
        size: 'M',
        color: 'Đen',
        skuCode: `AOCSRF-${suffix.toUpperCase()}-M`,
        priceVnd: 150_000,
        stock,
      },
    });
    return sku.id;
  }

  async function stockOf(skuId: string): Promise<number> {
    return (await prisma.productSku.findUniqueOrThrow({ where: { id: skuId } })).stock;
  }

  /** Đăng nhập xong, trả cookie thô + token để bắn bằng `fetch` (điều khiển được từng header). */
  async function loginRaw() {
    const { agent, token, csrfCookie } = await csrfAgent(app);
    const email = `csrf-${randomUUID()}@example.com`;
    await agent.post('/auth/register').send({ email, password: 'matkhau123' }).expect(201);
    const login = await agent.post('/auth/login').send({ email, password: 'matkhau123' }).expect(200);

    const authCookies = ((login.headers['set-cookie'] as unknown as string[]) ?? []).map(
      (c) => c.split(';')[0] ?? '',
    );
    return { agent, token, cookie: [...authCookies, csrfCookie].join('; ') };
  }

  // ── Test cases ─────────────────────────────────────────────────────────────────────────

  it('6. GET / → có Set-Cookie csrf_token, KHÔNG HttpOnly, có SameSite=Strict', async () => {
    const res = await fetch(`${baseUrl()}/`);
    const setCookie = res.headers.getSetCookie().find((c) => c.startsWith(`${CSRF_COOKIE}=`));

    expect(setCookie).toBeDefined();
    // `HttpOnly` ở đây là bug chí mạng: JS không đọc được thì double-submit chết im lặng,
    // mọi request ghi trả 403 và triệu chứng không hề chỉ về nguyên nhân.
    expect(setCookie?.toLowerCase()).not.toContain('httponly');
    expect(setCookie?.toLowerCase()).toContain('samesite=strict');
  });

  it('7. ⭐ POST /orders THIẾU header → 403, không tạo đơn, tồn kho KHÔNG đổi', async () => {
    const { cookie } = await loginRaw();
    const skuId = await seedSku(10);

    const res = await fetch(`${baseUrl()}/orders`, {
      method: 'POST',
      headers: { cookie, 'Content-Type': 'application/json', 'Idempotency-Key': randomUUID() },
      body: JSON.stringify({ skuId, quantity: 2 }),
    });

    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe('CSRF_TOKEN_INVALID');
    // Chặn phải xảy ra TRƯỚC khi chạm tồn kho. Chặn sau thì kẻ tấn công vẫn làm hàng biến mất.
    expect(await stockOf(skuId)).toBe(10);
    expect(await prisma.order.count({ where: { items: { some: { skuId } } } })).toBe(0);
  });

  it('8. POST /orders có header khớp cookie → 201 như cũ', async () => {
    const { agent } = await loginRaw();
    const skuId = await seedSku(10);

    await agent
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ skuId, quantity: 2 })
      .expect(201);

    expect(await stockOf(skuId)).toBe(8);
  });

  it('9. ⭐ cookie và header KHỚP nhau nhưng tự chế (kẻ tấn công cùng site) → 403', async () => {
    const { cookie } = await loginRaw();
    const skuId = await seedSku(10);
    const forged = `${'a'.repeat(64)}.${'b'.repeat(64)}`;

    // Kịch bản thật: một subdomain bị chiếm đặt được cookie sang domain chính. Không có chữ
    // ký thì nó chỉ cần đặt cookie rồi gửi header cùng giá trị — và double-submit vô dụng.
    const res = await fetch(`${baseUrl()}/orders`, {
      method: 'POST',
      headers: {
        cookie: `${cookie.replace(new RegExp(`${CSRF_COOKIE}=[^;]*`), `${CSRF_COOKIE}=${forged}`)}`,
        [CSRF_HEADER]: forged,
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({ skuId, quantity: 2 }),
    });

    expect(res.status).toBe(403);
    expect(await stockOf(skuId)).toBe(10);
  });

  it('9b. cookie và header là hai token HỢP LỆ nhưng khác nhau → 403', async () => {
    const a = await loginRaw();
    const b = await csrfAgent(app);

    const res = await fetch(`${baseUrl()}/orders`, {
      method: 'POST',
      headers: {
        cookie: a.cookie,
        [CSRF_HEADER]: b.token,
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({ skuId: await seedSku(10), quantity: 1 }),
    });

    expect(res.status).toBe(403);
  });

  it('10. GET /orders không cần token → 200', async () => {
    const { cookie } = await loginRaw();

    const res = await fetch(`${baseUrl()}/orders`, { headers: { cookie } });

    expect(res.status).toBe(200);
  });

  it('11. ⭐ POST /payments/webhook KHÔNG có cookie/header CSRF → vẫn 204', async () => {
    // Cổng thanh toán gọi server-to-server, không có cookie nào nên không có gì để CSRF.
    // Miễn nhầm cho nó là làm hỏng tích hợp; không miễn là webhook chết hoàn toàn.
    const body = {
      eventId: `evt_${randomUUID()}`,
      type: 'payment.succeeded',
      orderId: randomUUID(),
      paymentIntentId: `pi_${randomUUID().slice(0, 8)}`,
      amountVnd: 150_000,
      occurredAt: new Date().toISOString(),
    };
    const raw = JSON.stringify(body);
    const signedAt = Math.floor(Date.now() / 1000);

    const res = await fetch(`${baseUrl()}/payments/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-payment-signature': signPayload(raw, WEBHOOK_SECRET, signedAt),
      },
      body: raw,
    });

    expect(res.status).toBe(204);
  });

  it('12. POST /auth/login thiếu token → 403 chứ KHÔNG 401', async () => {
    // 401 sẽ khiến client đi gọi /auth/refresh rồi thử lại — vòng lặp vô ích, và lần refresh
    // đó cũng thiếu token nên cũng hỏng. Người dùng thấy triệu chứng "tự nhiên bị đăng xuất".
    const res = await fetch(`${baseUrl()}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'ai-do@example.com', password: 'matkhau123' }),
    });

    expect(res.status).toBe(403);
  });

  it('13. POST /orders/:id/cancel thiếu token → 403, đơn vẫn PENDING', async () => {
    const { agent, cookie } = await loginRaw();
    const skuId = await seedSku(10);
    const placed = await agent
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ skuId, quantity: 1 })
      .expect(201);
    const orderId = (placed.body.order as { id: string }).id;

    const res = await fetch(`${baseUrl()}/orders/${orderId}/cancel`, {
      method: 'POST',
      headers: { cookie },
    });

    expect(res.status).toBe(403);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('PENDING');
  });

  it('14. Origin khác host → 403 dù token hợp lệ (lớp phòng thủ thứ ba)', async () => {
    const { cookie, token } = await loginRaw();

    const res = await fetch(`${baseUrl()}/orders`, {
      method: 'POST',
      headers: {
        cookie,
        [CSRF_HEADER]: token,
        origin: 'https://trang-la.example',
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
      },
      body: JSON.stringify({ skuId: await seedSku(10), quantity: 1 }),
    });

    expect(res.status).toBe(403);
  });
});
