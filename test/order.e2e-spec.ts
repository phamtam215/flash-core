import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infra/prisma';
import { RedisService } from '../src/infra/redis';

/**
 * Integration test Phase 3 — test case trong docs/specs/phase3-order-concurrency.md.
 *
 * Vì sao tuyệt đối không mock Prisma/Redis ở đây: oversell chỉ xảy ra khi Postgres THẬT xử lý
 * khoá THẬT dưới nhiều request THẬT cùng lúc. Một repository bị mock sẽ luôn trả về kết quả
 * đúng — test xanh 100% trong khi production bán quá 100 chiếc (bài học ở
 * docs/tech-playbook.md §Xuyên suốt → Testing).
 *
 * Chạy: `npm run test:int` (cần Docker).
 */

const STRATEGIES = ['optimistic', 'pessimistic', 'redis'] as const;

describe('Order (e2e)', () => {
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedTestContainer;

  beforeAll(async () => {
    [postgres, redis] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine')
        .withDatabase('flashcore')
        .withUsername('flashcore')
        .withPassword('flashcore')
        .start(),
      new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
    ]);

    process.env.DATABASE_URL = postgres.getConnectionUri();
    process.env.REDIS_URL = `redis://${redis.getHost()}:${String(redis.getMappedPort(6379))}`;
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-toi-thieu-32-ky-tu!!';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-toi-thieu-32-ky-tu!';
    // Pool phải đủ rộng cho 200 request song song ở test #8, nếu không cái vỡ trước sẽ là pool
    // chứ không phải khoá — và test sẽ đo sai thứ. Chính hiện tượng này là bài học ghi ở
    // tech-playbook §Phase 3 ("pessimistic chậm quá" thật ra là hết connection).
    process.env.DATABASE_POOL_MAX = '50';

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env }, stdio: 'pipe' });
  }, 300_000);

  afterAll(async () => {
    await Promise.all([postgres?.stop(), redis?.stop()]);
  });

  /**
   * Dựng một app mới với chiến lược chỉ định. Phải tạo app SAU khi set `INVENTORY_STRATEGY`
   * vì `ConfigModule` đọc và validate env ngay lúc khởi động — đó cũng là lý do đổi chiến lược
   * chỉ cần đổi env, không sửa code.
   */
  async function createApp(strategy: (typeof STRATEGIES)[number]): Promise<INestApplication> {
    process.env.INVENTORY_STRATEGY = strategy;

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();

    // `listen(0)` = xin HĐH một cổng trống. Bắt buộc cho các test bắn song song: supertest tự
    // `listen()` rồi ĐÓNG server sau mỗi request, nên khi 200 request chạy cùng lúc, request
    // này bị cắt socket vì request khác vừa kết thúc → `read ECONNRESET`. Có server thật đứng
    // sẵn thì không còn vòng mở-đóng đó, và cũng giống cách k6 sẽ bắn ở test #16 hơn.
    await app.listen(0);
    return app;
  }

  /** `http://127.0.0.1:<cổng thật>` của app đang listen. */
  function baseUrlOf(app: INestApplication): string {
    const address = app.getHttpServer().address() as { port: number };
    return `http://127.0.0.1:${String(address.port)}`;
  }

  /**
   * Đăng nhập và lấy CHUỖI access token, để bắn request song song bằng `fetch` với header
   * `Cookie` tự gắn — không đi qua supertest agent nữa.
   */
  async function accessTokenOf(app: INestApplication): Promise<string> {
    const email = `order-${randomUUID()}@example.com`;
    const agent = request.agent(app.getHttpServer());
    await agent.post('/auth/register').send({ email, password: 'matkhau123' }).expect(201);
    const login = await agent.post('/auth/login').send({ email, password: 'matkhau123' }).expect(200);

    const cookies = login.headers['set-cookie'] as string[] | string | undefined;
    const list = Array.isArray(cookies) ? cookies : cookies ? [cookies] : [];
    const token = list.find((c) => c.startsWith('access_token='))?.split(';')[0]?.split('=')[1];
    if (!token) throw new Error('không lấy được access_token từ cookie');
    return token;
  }

  /** Bắn `POST /orders` bằng fetch — dùng cho mọi test song song. Trả về status code. */
  async function placeViaFetch(
    baseUrl: string,
    token: string,
    skuId: string,
    quantity = 1,
  ): Promise<number> {
    const res = await fetch(`${baseUrl}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': randomUUID(),
        Cookie: `access_token=${token}`,
      },
      body: JSON.stringify({ skuId, quantity }),
    });
    return res.status;
  }

  /** Đăng ký + đăng nhập một user mới, trả về agent đã giữ cookie phiên. */
  async function loginAsNewUser(app: INestApplication) {
    const agent = request.agent(app.getHttpServer());
    const email = `order-${randomUUID()}@example.com`;
    await agent.post('/auth/register').send({ email, password: 'matkhau123' }).expect(201);
    await agent.post('/auth/login').send({ email, password: 'matkhau123' }).expect(200);
    return agent;
  }

  /**
   * Tạo SKU mới trực tiếp qua Prisma (không qua API product) — test này đo tồn kho, không đo
   * CRUD catalog. Mỗi test dùng một SKU RIÊNG: chiến lược Redis cache tồn kho theo `skuId`,
   * dùng lại SKU cũ sẽ mang cache của test trước sang, gây flaky.
   */
  async function seedSku(
    app: INestApplication,
    input: { stock: number; priceVnd?: number; isActive?: boolean },
  ): Promise<string> {
    const prisma = app.get(PrismaService);
    const suffix = randomUUID().slice(0, 8);

    const product = await prisma.product.create({
      data: { name: `Áo test ${suffix}`, slug: `ao-test-${suffix}`, status: 'ACTIVE' },
    });

    const sku = await prisma.productSku.create({
      data: {
        productId: product.id,
        size: 'M',
        color: 'Đen',
        skuCode: `AOTEST-${suffix.toUpperCase()}-M`,
        priceVnd: input.priceVnd ?? 150_000,
        stock: input.stock,
        isActive: input.isActive ?? true,
      },
    });

    return sku.id;
  }

  const place = (agent: ReturnType<typeof request.agent>, skuId: string, quantity = 1, key?: string) =>
    agent
      .post('/orders')
      .set('Idempotency-Key', key ?? randomUUID())
      .send({ skuId, quantity });

  // ── Luồng cơ bản: chạy trên chiến lược mặc định ────────────────────────────────────────

  describe('luồng cơ bản (optimistic)', () => {
    let app: INestApplication;
    let agent: ReturnType<typeof request.agent>;

    beforeAll(async () => {
      app = await createApp('optimistic');
      agent = await loginAsNewUser(app);
    }, 120_000);

    afterAll(async () => {
      await app?.close();
    });

    it('1. đặt hàng hợp lệ → 201, stock giảm đúng quantity, có 1 order item', async () => {
      const skuId = await seedSku(app, { stock: 10, priceVnd: 199_000 });

      const res = await place(agent, skuId, 3).expect(201);

      expect(res.body.order).toMatchObject({ status: 'PENDING', totalVnd: 199_000 * 3 });
      expect(res.body.order.expiresAt).toEqual(expect.any(String));

      const prisma = app.get(PrismaService);
      const sku = await prisma.productSku.findUniqueOrThrow({ where: { id: skuId } });
      expect(sku.stock).toBe(7);

      const items = await prisma.orderItem.findMany({
        where: { orderId: String(res.body.order.id) },
      });
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ quantity: 3, unitPriceVnd: 199_000 });
    });

    it('2. cùng Idempotency-Key 2 lần → 1 đơn, lần 2 trả 200 + đúng đơn cũ, stock trừ MỘT lần', async () => {
      const skuId = await seedSku(app, { stock: 10 });
      const key = randomUUID();

      const first = await place(agent, skuId, 2, key).expect(201);
      const second = await place(agent, skuId, 2, key).expect(200);

      expect(second.body.order.id).toBe(first.body.order.id);

      const prisma = app.get(PrismaService);
      const sku = await prisma.productSku.findUniqueOrThrow({ where: { id: skuId } });
      expect(sku.stock).toBe(8); // 10 - 2, KHÔNG phải 6
      expect(await prisma.order.count({ where: { idempotencyKey: key } })).toBe(1);
    });

    it('3. khác Idempotency-Key, cùng user + SKU → 2 đơn', async () => {
      const skuId = await seedSku(app, { stock: 10 });

      const a = await place(agent, skuId, 1).expect(201);
      const b = await place(agent, skuId, 1).expect(201);

      expect(a.body.order.id).not.toBe(b.body.order.id);
    });

    it('4. thiếu header Idempotency-Key → 400, chưa chạm tồn kho', async () => {
      const skuId = await seedSku(app, { stock: 10 });

      const res = await agent.post('/orders').send({ skuId, quantity: 1 }).expect(400);
      expect(res.body.code).toBe('IDEMPOTENCY_KEY_REQUIRED');

      const prisma = app.get(PrismaService);
      const sku = await prisma.productSku.findUniqueOrThrow({ where: { id: skuId } });
      expect(sku.stock).toBe(10);
    });

    it('6. skuId lạ → 404; SKU is_active = false → 404', async () => {
      const notFound = await place(agent, randomUUID(), 1).expect(404);
      expect(notFound.body.code).toBe('SKU_NOT_FOUND');

      const inactiveSku = await seedSku(app, { stock: 10, isActive: false });
      const inactive = await place(agent, inactiveSku, 1).expect(404);
      expect(inactive.body.code).toBe('SKU_NOT_FOUND');
    });

    it('7. stock = 0 → 409 OUT_OF_STOCK (KHÔNG phải 500)', async () => {
      const skuId = await seedSku(app, { stock: 0 });

      const res = await place(agent, skuId, 1).expect(409);
      expect(res.body.code).toBe('OUT_OF_STOCK');
    });

    it('7b. quantity lớn hơn stock còn lại → 409', async () => {
      const skuId = await seedSku(app, { stock: 2 });

      await place(agent, skuId, 3).expect(409);

      const prisma = app.get(PrismaService);
      const sku = await prisma.productSku.findUniqueOrThrow({ where: { id: skuId } });
      expect(sku.stock).toBe(2); // không trừ một phần
    });

    it('9. snapshot price: đổi giá SKU sau khi đặt → giá trên order item KHÔNG đổi', async () => {
      const skuId = await seedSku(app, { stock: 5, priceVnd: 100_000 });
      const res = await place(agent, skuId, 1).expect(201);

      const prisma = app.get(PrismaService);
      await prisma.productSku.update({ where: { id: skuId }, data: { priceVnd: 999_000 } });

      const detail = await agent.get(`/orders/${String(res.body.order.id)}`).expect(200);
      expect(detail.body.items[0].unitPriceVnd).toBe(100_000);
      expect(detail.body.order.totalVnd).toBe(100_000);
    });

    it('10. client gửi kèm `price` trong body → bị loại, đơn dùng giá từ DB', async () => {
      const skuId = await seedSku(app, { stock: 5, priceVnd: 250_000 });

      const res = await agent
        .post('/orders')
        .set('Idempotency-Key', randomUUID())
        .send({ skuId, quantity: 1, price: 1 })
        .expect(201);

      expect(res.body.order.totalVnd).toBe(250_000); // không phải 1
    });

    it('11. GET /orders chỉ trả đơn của chính user', async () => {
      const skuId = await seedSku(app, { stock: 10 });
      const other = await loginAsNewUser(app);

      const mine = await place(agent, skuId, 1).expect(201);
      await place(other, skuId, 1).expect(201);

      const list = await other.get('/orders?limit=100').expect(200);
      const ids = (list.body.items as { id: string }[]).map((o) => o.id);

      expect(ids).not.toContain(String(mine.body.order.id));
      expect(ids).toHaveLength(1);
    });

    it('12. GET /orders/:id của user khác → 404 (không phải 403 — không tiết lộ đơn tồn tại)', async () => {
      const skuId = await seedSku(app, { stock: 10 });
      const mine = await place(agent, skuId, 1).expect(201);

      const other = await loginAsNewUser(app);
      const res = await other.get(`/orders/${String(mine.body.order.id)}`).expect(404);
      expect(res.body.code).toBe('ORDER_NOT_FOUND');
    });

    it('cursor pagination của GET /orders: 2 trang không trùng dòng', async () => {
      const fresh = await loginAsNewUser(app);
      const skuId = await seedSku(app, { stock: 30 });
      for (let i = 0; i < 25; i++) {
        await place(fresh, skuId, 1).expect(201);
      }

      const page1 = await fresh.get('/orders?limit=20').expect(200);
      expect(page1.body.items).toHaveLength(20);
      expect(page1.body.nextCursor).not.toBeNull();

      const page2 = await fresh
        .get(`/orders?limit=20&cursor=${encodeURIComponent(String(page1.body.nextCursor))}`)
        .expect(200);
      expect(page2.body.items).toHaveLength(5);

      const ids1 = (page1.body.items as { id: string }[]).map((o) => o.id);
      const ids2 = (page2.body.items as { id: string }[]).map((o) => o.id);
      expect(ids1.filter((id) => ids2.includes(id))).toHaveLength(0);
    });

    it('cursor rác → 400 INVALID_CURSOR, không phải 500', async () => {
      const res = await agent.get('/orders?cursor=abc-khong-decode-duoc').expect(400);
      expect(res.body.code).toBe('INVALID_CURSOR');
    });
  });

  // ── Test #8: cổng chính của phase, chạy cho CẢ BA chiến lược ───────────────────────────

  describe.each(STRATEGIES)('test #8 — chiến lược %s: oversell = 0', (strategy) => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createApp(strategy);
    }, 120_000);

    afterAll(async () => {
      await app?.close();
    });

    it('200 request song song vào SKU stock = 100 → đúng 100 đơn, 100 lần 409, stock = 0', async () => {
      const skuId = await seedSku(app, { stock: 100, priceVnd: 100_000 });
      const token = await accessTokenOf(app);
      const baseUrl = baseUrlOf(app);

      // MỘT user, 200 `Idempotency-Key` khác nhau, bắn bằng `fetch` vào server thật.
      //
      // Hai lần đầu viết test này đều ĐỎ vì BỘ TẠO TẢI, không vì code: lần 1 dùng 200 user
      // riêng (400 lần hash Argon2 làm Node tắc), lần 2 dùng supertest agent bắn song song
      // (supertest tự mở/đóng server mỗi request nên socket bị cắt giữa dòng). Bài học đáng
      // giá hơn cả kết quả: khi test concurrency đỏ, hỏi trước "thứ vừa vỡ có đúng là thứ
      // mình muốn đo không".
      const results = await Promise.all(
        Array.from({ length: 200 }, () => placeViaFetch(baseUrl, token, skuId)),
      );

      const created = results.filter((s) => s === 201).length;
      const rejected = results.filter((s) => s === 409).length;
      const serverErrors = results.filter((s) => s >= 500).length;

      // Ba khẳng định, thiếu một cái là chưa chứng minh được gì:
      expect(serverErrors).toBe(0); // không có lỗi hệ thống nào
      expect(created).toBe(100); // bán đúng số hàng có
      expect(rejected).toBe(100); // phần còn lại bị từ chối tử tế bằng 409

      const prisma = app.get(PrismaService);
      const sku = await prisma.productSku.findUniqueOrThrow({ where: { id: skuId } });
      expect(sku.stock).toBe(0); // KHÔNG âm, KHÔNG còn dư

      const itemCount = await prisma.orderItem.count({ where: { skuId } });
      expect(itemCount).toBe(100);
    }, 180_000);

    it('13. stock = 1, hai request song song → đúng 1 thắng', async () => {
      const skuId = await seedSku(app, { stock: 1 });
      const token = await accessTokenOf(app);
      const baseUrl = baseUrlOf(app);

      const statuses = (
        await Promise.all([
          placeViaFetch(baseUrl, token, skuId),
          placeViaFetch(baseUrl, token, skuId),
        ])
      ).sort((x, y) => x - y);

      expect(statuses).toEqual([201, 409]);
    }, 60_000);
  });

  // ── Redis: hai kho dữ liệu phải khớp nhau, và lệch thì phải bù trừ ────────────────────

  describe('chiến lược redis: đồng bộ và bù trừ', () => {
    let app: INestApplication;

    beforeAll(async () => {
      app = await createApp('redis');
    }, 120_000);

    afterAll(async () => {
      await app?.close();
    });

    it('14. sau 50 reserve song song, tồn kho Redis khớp tồn kho DB', async () => {
      const skuId = await seedSku(app, { stock: 60 });
      const token = await accessTokenOf(app);
      const baseUrl = baseUrlOf(app);

      await Promise.all(
        Array.from({ length: 50 }, () => placeViaFetch(baseUrl, token, skuId)),
      );

      const prisma = app.get(PrismaService);
      const redisService = app.get(RedisService);

      const sku = await prisma.productSku.findUniqueOrThrow({ where: { id: skuId } });
      const cached = await redisService.client.get(`stock:${skuId}`);

      expect(sku.stock).toBe(10);
      expect(Number(cached)).toBe(sku.stock);
    }, 120_000);

    it('15. Redis nói còn hàng mà DB nói hết → trả 409 và HOÀN LẠI Redis (không im lặng sửa số)', async () => {
      // Dựng đúng tình huống lệch: DB hết hàng nhưng Redis còn 999. Đây là cách kiểm chứng
      // nhánh bù trừ mà không phải mock gì — mock ở đây sẽ test chính cái mock.
      const skuId = await seedSku(app, { stock: 0 });
      const redisService = app.get(RedisService);
      await redisService.client.set(`stock:${skuId}`, '999');

      const agent = await loginAsNewUser(app);
      const res = await agent
        .post('/orders')
        .set('Idempotency-Key', randomUUID())
        .send({ skuId, quantity: 1 })
        .expect(409);

      expect(res.body.code).toBe('OUT_OF_STOCK');
      // Đã trừ 1 rồi hoàn lại 1 ⇒ vẫn là 999. Nếu không bù trừ thì còn 998 và tồn kho Redis
      // sẽ trôi dần mỗi lần lệch.
      expect(Number(await redisService.client.get(`stock:${skuId}`))).toBe(999);
    }, 60_000);
  });
});
