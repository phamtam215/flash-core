import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { CORRELATION_ID_HEADER, getCorrelationId, runWithCorrelationId } from '../src/common';
import { MetricsInterceptor, MetricsService } from '../src/infra/metrics';
import { PrismaService } from '../src/infra/prisma';
import { JOB, QueueService } from '../src/infra/queue';
import { HealthService } from '../src/modules/health';
import { OrderExpiryService, OrderNotifier } from '../src/modules/order';
import { OutboxRelay } from '../src/modules/outbox';
import { PaymentService } from '../src/modules/payment';
import { JobProcessor } from '../src/worker/job.processor';
import { startInfra } from './infra-fixture';

/**
 * Integration test Phase 6 — test case trong docs/specs/phase6-observability.md.
 *
 * Cổng chính của phase là test #3 và #5: `correlationId` của một request phải đi được vào
 * hộp thư đi, rồi vào job, rồi ra tới log của service chạy trong worker. Không có chuỗi đó
 * thì deliverable "truy toàn bộ hành trình bằng một id" chỉ đúng một nửa.
 */
describe('Observability (e2e)', () => {
  let stopInfra: () => Promise<void>;
  let app: INestApplication;
  let prisma: PrismaService;
  let metrics: MetricsService;

  beforeAll(async () => {
    stopInfra = await startInfra();

    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-toi-thieu-32-ky-tu!!';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-toi-thieu-32-ky-tu!';
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-webhook-secret-toi-thieu-32-ky-tu';
    process.env.METRICS_ENABLED = 'true';
    process.env.QUEUE_PREFIX = `test-${randomUUID().slice(0, 8)}`;

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env }, stdio: 'pipe' });

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    app.useGlobalInterceptors(app.get(MetricsInterceptor));
    await app.init();

    prisma = app.get(PrismaService);
    metrics = app.get(MetricsService);
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    await stopInfra?.();
  });

  // ── Tiện ích ───────────────────────────────────────────────────────────────────────────

  async function loginAsNewUser() {
    const agent = request.agent(app.getHttpServer());
    const email = `obs-${randomUUID()}@example.com`;
    await agent.post('/auth/register').send({ email, password: 'matkhau123' }).expect(201);
    await agent.post('/auth/login').send({ email, password: 'matkhau123' }).expect(200);
    return agent;
  }

  async function seedSku(stock: number): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const product = await prisma.product.create({
      data: { name: `Áo obs ${suffix}`, slug: `ao-obs-${suffix}`, status: 'ACTIVE' },
    });
    const sku = await prisma.productSku.create({
      data: {
        productId: product.id,
        size: 'M',
        color: 'Đen',
        skuCode: `AOOBS-${suffix.toUpperCase()}-M`,
        priceVnd: 150_000,
        stock,
      },
    });
    return sku.id;
  }

  /**
   * Dựng `JobProcessor` bằng tay, đúng cách `WorkerModule` ráp nó.
   *
   * Không `app.get(JobProcessor)` được vì nó thuộc `WorkerModule` — cây DI song song với
   * `AppModule`, không phải con của nó (ADR-005). Dựng bằng tay ở đây rẻ hơn nhiều so với
   * compile thêm một `WorkerModule` thứ hai chỉ để mở thêm một kết nối Redis nữa.
   */
  function makeJobProcessor(): JobProcessor {
    return new JobProcessor(
      app.get(OutboxRelay),
      app.get(OrderNotifier),
      app.get(OrderExpiryService),
      app.get(PaymentService),
      metrics,
    );
  }

  /** Đọc giá trị một metric (theo nhãn) từ chính registry, không phải parse text. */
  async function metricValue(name: string, labels: Record<string, string>): Promise<number> {
    const metric = await metrics.registry.getSingleMetric(name)?.get();
    const found = metric?.values.find((v) =>
      Object.entries(labels).every(([k, val]) => String(v.labels[k]) === val),
    );
    return found?.value ?? 0;
  }

  // ── correlationId ──────────────────────────────────────────────────────────────────────

  it('1. giữ nguyên correlationId client gửi vào, và trả lại ở response header', async () => {
    const given = `corr-${randomUUID()}`;

    const res = await request(app.getHttpServer())
      .get('/health')
      .set(CORRELATION_ID_HEADER, given)
      .expect(200);

    expect(res.headers[CORRELATION_ID_HEADER]).toBe(given);
  });

  it('2. không gửi header → sinh id mới và trả về', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);

    expect(res.headers[CORRELATION_ID_HEADER]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('3. ⭐ đặt đơn → dòng outbox mang ĐÚNG correlationId của request đó', async () => {
    const agent = await loginAsNewUser();
    const given = `corr-${randomUUID()}`;

    const res = await agent
      .post('/orders')
      .set(CORRELATION_ID_HEADER, given)
      .set('Idempotency-Key', randomUUID())
      .send({ skuId: await seedSku(5), quantity: 1 })
      .expect(201);

    const event = await prisma.outboxEvent.findFirstOrThrow({
      where: { aggregateId: String(res.body.order.id) },
    });

    // Đây là mắt xích đầu tiên của chuỗi. Đứt ở đây thì log lúc đặt đơn và log lúc gửi email
    // vĩnh viễn không nối được với nhau.
    expect((event.payload as { correlationId?: string }).correlationId).toBe(given);
  });

  it('4. relay đẩy job → payload job mang correlationId từ outbox', async () => {
    const agent = await loginAsNewUser();
    const given = `corr-${randomUUID()}`;

    await agent
      .post('/orders')
      .set(CORRELATION_ID_HEADER, given)
      .set('Idempotency-Key', randomUUID())
      .send({ skuId: await seedSku(5), quantity: 1 })
      .expect(201);

    await app.get(OutboxRelay).relayOnce();

    const jobs = await app.get(QueueService).queue.getJobs(['waiting', 'delayed', 'active']);
    const emailJob = jobs.find(
      (job) => (job.data as { correlationId?: string }).correlationId === given,
    );

    expect(emailJob).toBeDefined();
    expect(emailJob?.name).toBe(JOB.EMAIL_CONFIRM);
  });

  it('5. ⭐ chạy job → mọi lời gọi bên trong đọc được đúng correlationId đó', async () => {
    const given = `corr-${randomUUID()}`;
    let seenInsideJob: string | undefined;

    // Chặn ngay tại một service để xem `AsyncLocalStorage` có xuyên qua được lớp điều phối
    // job và các `await` bên trong hay không — đó mới là điều đáng kiểm, không phải nội dung
    // dòng log.
    const relay = app.get(OutboxRelay);
    const spy = jest.spyOn(relay, 'relayOnce').mockImplementation(() => {
      seenInsideJob = getCorrelationId();
      return Promise.resolve(0);
    });

    await makeJobProcessor().process({
      name: JOB.OUTBOX_RELAY,
      data: { correlationId: given },
    } as never);

    spy.mockRestore();
    expect(seenInsideJob).toBe(given);
  });

  it('6. job lặp không có correlationId → vẫn chạy, và có một id mới', async () => {
    let seen: string | undefined;
    const relay = app.get(OutboxRelay);
    const spy = jest.spyOn(relay, 'relayOnce').mockImplementation(() => {
      seen = getCorrelationId();
      return Promise.resolve(0);
    });

    await makeJobProcessor().process({ name: JOB.OUTBOX_RELAY, data: {} } as never);

    spy.mockRestore();
    // Có id (để log của vòng quét này nối được với nhau), nhưng là id mới — không request nào
    // tạo ra job lặp cả.
    expect(seen).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('7. hai luồng song song → id không lẫn sang nhau', async () => {
    const ids = await Promise.all(
      ['a', 'b', 'c'].map((tag) =>
        runWithCorrelationId(`corr-${tag}`, async () => {
          // `await` ở giữa là chỗ dễ lẫn nhất nếu dùng biến toàn cục thay vì ALS.
          await new Promise((resolve) => setTimeout(resolve, 10));
          return getCorrelationId();
        }),
      ),
    );

    expect(ids).toEqual(['corr-a', 'corr-b', 'corr-c']);
  });

  // ── Health ─────────────────────────────────────────────────────────────────────────────

  it('8. /ready trả 200 kèm cả hai check khi mọi thứ sống', async () => {
    const res = await request(app.getHttpServer()).get('/ready').expect(200);

    expect(res.body.checks).toMatchObject({ database: 'up', redis: 'up', shuttingDown: false });
  });

  it('9. /health vẫn 200 dù dependency có vấn đề — liveness KHÔNG kiểm dependency', () => {
    // Kiểm bằng hợp đồng của service: liveness không chạm DB/Redis. Giết Postgres thật trong
    // integration test sẽ làm hỏng mọi test sau đó.
    const report = app.get(HealthService).liveness();

    expect(report.status).toBe('ok');
  });

  it('10. ⭐ sau beginShutdown() → /ready trả 503, /health vẫn 200', async () => {
    const health = app.get(HealthService);
    health.beginShutdown();

    const ready = await request(app.getHttpServer()).get('/ready').expect(503);
    expect(ready.body).toMatchObject({ code: 'NOT_READY' });
    expect(ready.body.correlationId).toEqual(expect.any(String));

    // Liveness KHÔNG được fail lúc này: fail là Cloud Run restart container đang tắt dở.
    await request(app.getHttpServer()).get('/health').expect(200);
  });

  // ── Metrics ────────────────────────────────────────────────────────────────────────────

  it('11. GET /metrics trả định dạng Prometheus, có cả metric hạ tầng lẫn nghiệp vụ', async () => {
    const res = await request(app.getHttpServer()).get('/metrics').expect(200);


    expect(res.headers['content-type']).toMatch(/text\/plain/);
    expect(res.text).toContain('http_requests_total');
    expect(res.text).toContain('orders_placed_total');
    expect(res.text).toContain('outbox_pending');
  });

  it('12. đặt đơn thành công → orders_placed_total{result="created"} tăng đúng 1', async () => {
    const agent = await loginAsNewUser();
    const before = await metricValue('orders_placed_total', { result: 'created' });

    await agent
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ skuId: await seedSku(5), quantity: 1 })
      .expect(201);

    expect(await metricValue('orders_placed_total', { result: 'created' })).toBe(before + 1);
  });

  it('13. đặt đơn khi hết hàng → đếm vào out_of_stock, KHÔNG phải created', async () => {
    const agent = await loginAsNewUser();
    const skuId = await seedSku(0);
    const beforeCreated = await metricValue('orders_placed_total', { result: 'created' });
    const beforeOut = await metricValue('orders_placed_total', { result: 'out_of_stock' });

    await agent
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ skuId, quantity: 1 })
      .expect(409);

    // Đây là lý do metric nghiệp vụ không đặt ở interceptor: interceptor chỉ thấy `409`, nó
    // không biết đó là hết hàng hay SKU không tồn tại.
    expect(await metricValue('orders_placed_total', { result: 'out_of_stock' })).toBe(beforeOut + 1);
    expect(await metricValue('orders_placed_total', { result: 'created' })).toBe(beforeCreated);
  });

  it('14. ⭐ nhãn route là MẪU route, không chứa uuid — luật cardinality', async () => {
    const agent = await loginAsNewUser();
    const res = await agent
      .post('/orders')
      .set('Idempotency-Key', randomUUID())
      .send({ skuId: await seedSku(5), quantity: 1 })
      .expect(201);

    await agent.get(`/orders/${String(res.body.order.id)}`).expect(200);

    const text = await metrics.render();
    // Có `/orders/:id` là đúng; có uuid thật là mỗi đơn sinh một chuỗi thời gian mới —
    // cách làm sập Prometheus nhanh nhất.
    expect(text).toContain('route="/orders/:id"');
    expect(text).not.toMatch(/route="\/orders\/[0-9a-f]{8}-/);
  });

  it('15. thời gian trừ kho được đo, tách theo chiến lược', async () => {
    const text: string = await metrics.render();

    expect(text).toContain('inventory_reserve_duration_seconds');
    expect(text).toContain('strategy="optimistic"');
  });
});
