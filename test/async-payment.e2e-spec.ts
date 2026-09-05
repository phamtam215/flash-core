import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { Worker } from 'bullmq';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infra/prisma';
import { JOB, QUEUE_NAME, QueueService } from '../src/infra/queue';
import { MAIL_SENDER, type MailSender } from '../src/modules/mail';
import { OrderExpiryService, OrderNotifier } from '../src/modules/order';
import { OutboxRelay, OutboxRepository } from '../src/modules/outbox';
import { PaymentService } from '../src/modules/payment';
import { signPayload } from '../src/modules/payment';
import { startInfra } from './infra-fixture';

/**
 * Integration test Phase 4 — test case 1–15 và 18 trong
 * docs/specs/phase4-async-queue-payment.md.
 *
 * Vì sao không mock queue/DB: cả ba bảo đảm của phase (không mất, không trùng, không trả kho
 * hai lần) chỉ có nghĩa khi Postgres thật giữ khoá thật và Redis thật giữ job thật. Một queue
 * bị mock luôn giao đúng một lần — tức là luôn xanh, kể cả khi code sai.
 *
 * Chạy: `npm run test:int` (cần Docker).
 */

/** Bản gửi mail giả — ĐẾM số lần gửi. Đó là cách duy nhất kiểm chứng "không gửi trùng". */
class CountingMailSender implements MailSender {
  readonly sent: { to: string; subject: string }[] = [];
  failNextTimes = 0;

  send(mail: { to: string; subject: string; body: string }): Promise<void> {
    if (this.failNextTimes > 0) {
      this.failNextTimes -= 1;
      return Promise.reject(new Error('SMTP tạm thời không phản hồi'));
    }
    this.sent.push({ to: mail.to, subject: mail.subject });
    return Promise.resolve();
  }
}

describe('Async, Queue & Payment (e2e)', () => {
  let stopInfra: () => Promise<void>;
  let app: INestApplication;
  let prisma: PrismaService;
  let mailer: CountingMailSender;
  let queue: QueueService;

  /** Đơn giữ chỗ 2 giây trong test, thay vì 15 phút — lý do biến này thành env ngay từ đầu. */
  const HOLD_SECONDS = 2;

  beforeAll(async () => {
    stopInfra = await startInfra();

    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-toi-thieu-32-ky-tu!!';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-toi-thieu-32-ky-tu!';
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-webhook-secret-toi-thieu-32-ky-tu';
    process.env.INVENTORY_STRATEGY = 'optimistic';
    process.env.ORDER_HOLD_MINUTES = String(HOLD_SECONDS / 60);
    process.env.DATABASE_POOL_MAX = '20';
    // Tiền tố riêng cho mỗi lần chạy: Redis có thể đang dùng chung với worker trên máy dev,
    // và nếu chung tiền tố thì worker đó nuốt mất job của test — triệu chứng là "không tìm
    // thấy job" hoặc "0 email", không hề chỉ về nguyên nhân.
    process.env.QUEUE_PREFIX = `test-${randomUUID().slice(0, 8)}`;

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env }, stdio: 'pipe' });

    mailer = new CountingMailSender();

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      // Thay bản gửi mail thật bằng bản đếm — đây là toàn bộ lý do `MAIL_SENDER` là một token
      // chứ không phải lời gọi `logger.log` nằm thẳng trong service.
      .overrideProvider(MAIL_SENDER)
      .useValue(mailer)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    app.use(cookieParser());
    await app.init();
    await app.listen(0);

    prisma = app.get(PrismaService);
    queue = app.get(QueueService);
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    // `app.close()` đã gọi `QueueService.onModuleDestroy`, nhưng BullMQ còn giữ vài kết nối
    // phụ do nó tự `duplicate()` bên trong. Đóng thêm ở đây để Jest không báo "did not exit".
    await queue?.connection.quit().catch(() => undefined);
    await stopInfra?.();
  });

  beforeEach(async () => {
    mailer.sent.length = 0;
    mailer.failNextTimes = 0;
    await queue.queue.drain(true);
    // Dọn dư âm của test trước. Cả file dùng CHUNG một database, nên một dòng outbox còn
    // `PENDING` từ test trước sẽ bị `relayOnce()` của test sau nhặt lên và đếm nhầm. Bài học
    // này đúng cả ngoài test: relay không biết ranh giới nào cả, nó lấy mọi thứ đang chờ.
    await prisma.outboxEvent.updateMany({
      where: { status: 'PENDING' },
      data: { status: 'DISPATCHED' },
    });
  });

  // ── Tiện ích ───────────────────────────────────────────────────────────────────────────

  function baseUrl(): string {
    const address = app.getHttpServer().address() as { port: number };
    return `http://127.0.0.1:${String(address.port)}`;
  }

  async function loginAsNewUser() {
    const agent = request.agent(app.getHttpServer());
    const email = `pay-${randomUUID()}@example.com`;
    await agent.post('/auth/register').send({ email, password: 'matkhau123' }).expect(201);
    await agent.post('/auth/login').send({ email, password: 'matkhau123' }).expect(200);
    return { agent, email };
  }

  async function seedSku(stock: number, priceVnd = 150_000): Promise<string> {
    const suffix = randomUUID().slice(0, 8);
    const product = await prisma.product.create({
      data: { name: `Áo p4 ${suffix}`, slug: `ao-p4-${suffix}`, status: 'ACTIVE' },
    });
    const sku = await prisma.productSku.create({
      data: {
        productId: product.id,
        size: 'M',
        color: 'Đen',
        skuCode: `AOP4-${suffix.toUpperCase()}-M`,
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

  /** Bắn webhook có chữ ký hợp lệ (hoặc cố tình sai, tuỳ tham số). */
  async function sendWebhook(
    body: Record<string, unknown>,
    opts: { secret?: string; timestampSec?: number; tamper?: boolean } = {},
  ): Promise<number> {
    const raw = JSON.stringify(body);
    const secret = opts.secret ?? 'test-webhook-secret-toi-thieu-32-ky-tu';
    const ts = opts.timestampSec ?? Math.floor(Date.now() / 1000);
    const signature = signPayload(raw, secret, ts);

    const res = await fetch(`${baseUrl()}/payments/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-payment-signature': signature },
      // `tamper` sửa body SAU khi ký — mô phỏng người ở giữa đổi số tiền.
      body: opts.tamper ? raw.replace(/"amountVnd":(\d+)/, (_m, n: string) => `"amountVnd":${Number(n) + 1}`) : raw,
    });
    return res.status;
  }

  function webhookBody(order: { id: string; totalVnd: number }, over: Record<string, unknown> = {}) {
    return {
      eventId: `evt_${randomUUID()}`,
      type: 'payment.succeeded',
      orderId: order.id,
      paymentIntentId: `pi_${randomUUID()}`,
      amountVnd: order.totalVnd,
      occurredAt: new Date().toISOString(),
      ...over,
    };
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // ── Outbox ─────────────────────────────────────────────────────────────────────────────

  it('1. đặt đơn → đúng 1 dòng outbox PENDING, ghi cùng transaction với đơn', async () => {
    const { agent } = await loginAsNewUser();
    const order = await placeOrder(agent, await seedSku(5));

    const events = await prisma.outboxEvent.findMany({ where: { aggregateId: order.id } });

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ aggregate: 'order', type: 'order.placed', status: 'PENDING' });
  });

  it('2. relay chạy → dòng thành DISPATCHED và job có trong queue', async () => {
    const { agent } = await loginAsNewUser();
    const order = await placeOrder(agent, await seedSku(5));

    const sent = await app.get(OutboxRelay).relayOnce();

    expect(sent).toBeGreaterThanOrEqual(1);
    const row = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: order.id } });
    expect(row.status).toBe('DISPATCHED');
    expect(row.dispatchedAt).not.toBeNull();

    const waiting = await queue.queue.getJobs(['waiting', 'delayed']);
    expect(waiting.some((job) => job.name === JOB.EMAIL_CONFIRM)).toBe(true);
  });

  it('3. chạy relay HAI lần trên cùng dòng → chỉ một job được đẩy', async () => {
    const { agent } = await loginAsNewUser();
    await placeOrder(agent, await seedSku(5));

    const first = await app.get(OutboxRelay).relayOnce();
    const second = await app.get(OutboxRelay).relayOnce();

    expect(first).toBe(1);
    // Lần hai không còn gì để lấy: dòng đã `DISPATCHED` ngay trong transaction của lần một.
    expect(second).toBe(0);
  });

  it('4. hai relay SONG SONG trên 20 dòng → tổng đúng 20, không dòng nào đẩy hai lần', async () => {
    const { agent } = await loginAsNewUser();
    const skuId = await seedSku(50);
    for (let i = 0; i < 20; i += 1) await placeOrder(agent, skuId);

    const relay = app.get(OutboxRelay);
    // `FOR UPDATE SKIP LOCKED`: hai vòng quét chia nhau việc thay vì cùng lấy một lô.
    const [a, b] = await Promise.all([relay.relayOnce(), relay.relayOnce()]);

    expect(a + b).toBe(20);
    expect(await app.get(OutboxRepository).countByStatus('PENDING')).toBe(0);
  });

  it('4b. ⭐ đẩy queue hỏng giữa lô → CẢ LÔ quay lại PENDING, không mất sự kiện nào', async () => {
    const { agent } = await loginAsNewUser();
    const skuId = await seedSku(20);
    for (let i = 0; i < 5; i += 1) await placeOrder(agent, skuId);

    const repo = app.get(OutboxRepository);
    expect(await repo.countByStatus('PENDING')).toBe(5);

    // Giả lập cổng ra đứt giữa lúc đẩy: nhận đủ lô rồi mới ném lỗi.
    let seen = 0;
    await expect(
      repo.dispatchBatch(50, async (events) => {
        seen = events.length;
        await Promise.resolve();
        throw new Error('Redis đứt giữa chừng');
      }),
    ).rejects.toThrow(/Redis đứt/);
    expect(seen).toBe(5);

    // Đây là điều kiện sống còn của phase: KHÔNG dòng nào bị bỏ lại ở DISPATCHED.
    // Nếu đánh dấu trước rồi mới đẩy (bản đầu của code này), 5 dòng sẽ mắc kẹt ở DISPATCHED
    // và 5 email không bao giờ được gửi — mất im lặng.
    expect(await repo.countByStatus('PENDING')).toBe(5);

    // Nhịp quét sau đẩy lại đủ 5. Trùng là chấp nhận được (consumer idempotent lo), mất thì không.
    expect(await app.get(OutboxRelay).relayOnce()).toBe(5);
    expect(await repo.countByStatus('PENDING')).toBe(0);
  });

  it('4c. đẩy hỏng liên tiếp 5 lần → dòng chuyển FAILED, không thử lại vô hạn', async () => {
    const { agent } = await loginAsNewUser();
    await placeOrder(agent, await seedSku(5));

    const repo = app.get(OutboxRepository);
    const boom = () => Promise.reject(new Error('cổng ra luôn hỏng'));

    for (let i = 0; i < 5; i += 1) {
      await repo.dispatchBatch(50, boom).catch(() => undefined);
      await repo.recordDispatchFailure('cổng ra luôn hỏng', 50);
    }

    expect(await repo.countByStatus('PENDING')).toBe(0);
    expect(await repo.countByStatus('FAILED')).toBeGreaterThanOrEqual(1);
  });

  // ── Consumer idempotent ────────────────────────────────────────────────────────────────

  it('5. consumer email chạy hai lần cùng eventId → chỉ gửi MỘT lần', async () => {
    const { agent, email } = await loginAsNewUser();
    const order = await placeOrder(agent, await seedSku(5));
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: order.id } });

    const payload = {
      eventId: event.id,
      orderId: order.id,
      userId: (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).userId,
      totalVnd: order.totalVnd,
    };
    const notifier = app.get(OrderNotifier);
    await notifier.sendConfirmation(payload);
    await notifier.sendConfirmation(payload);

    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]?.to).toBe(email);
  });

  it('6. worker chết giữa chừng (mail lỗi) → chạy lại gửi được, và chỉ gửi một lần', async () => {
    const { agent } = await loginAsNewUser();
    const order = await placeOrder(agent, await seedSku(5));
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: order.id } });
    const userId = (await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).userId;
    const payload = { eventId: event.id, orderId: order.id, userId, totalVnd: order.totalVnd };

    mailer.failNextTimes = 1;
    const notifier = app.get(OrderNotifier);

    // Lần một hỏng: dấu idempotent phải được TRẢ LẠI, nếu không email này mất vĩnh viễn.
    await expect(notifier.sendConfirmation(payload)).rejects.toThrow(/SMTP/);
    await notifier.sendConfirmation(payload);
    await notifier.sendConfirmation(payload);

    expect(mailer.sent).toHaveLength(1);
  });

  it('6b. lỗi mail VĨNH VIỄN → không retry, và dấu KHÔNG được trả lại (không gửi trùng)', async () => {
    const { agent } = await loginAsNewUser();
    const order = await placeOrder(agent, await seedSku(5));
    const event = await prisma.outboxEvent.findFirstOrThrow({ where: { aggregateId: order.id } });

    // `userId` không tồn tại ⇒ không tra ra địa chỉ ⇒ `PermanentMailError`. Retry bao nhiêu
    // lần cũng vậy, nên JobProcessor phải đổi nó thành `UnrecoverableError` để BullMQ dừng.
    const payload = {
      eventId: event.id,
      orderId: order.id,
      userId: '00000000-0000-4000-8000-000000000000',
      totalVnd: order.totalVnd,
    };

    // `JobProcessor` thuộc `WorkerModule` (tầng trên `modules/`), không có trong `AppModule`
    // — việc nó đổi `PermanentMailError` thành `UnrecoverableError` được kiểm ở unit test
    // `src/worker/job.processor.spec.ts`. Ở đây kiểm phần nghiệp vụ.
    await expect(app.get(OrderNotifier).sendConfirmation(payload)).rejects.toMatchObject({
      name: 'PermanentMailError',
    });

    expect(mailer.sent).toHaveLength(0);
    // Dấu vẫn nằm lại: job có vào DLQ thì cũng không ai chạy lại và gửi trùng.
    const marks = await prisma.processedEvent.count({
      where: { eventId: event.id, consumer: 'order.email.confirm' },
    });
    expect(marks).toBe(1);
  });

  it('7. đơn quá hạn → job huỷ đơn và stock tăng lại đúng số lượng', async () => {
    const { agent } = await loginAsNewUser();
    const skuId = await seedSku(10);
    const order = await placeOrder(agent, skuId, 3);
    expect((await prisma.productSku.findUniqueOrThrow({ where: { id: skuId } })).stock).toBe(7);

    await sleep(HOLD_SECONDS * 1000 + 200);
    const cancelled = await app.get(OrderExpiryService).cancelExpired(order.id);

    expect(cancelled).toBe(true);
    expect((await prisma.productSku.findUniqueOrThrow({ where: { id: skuId } })).stock).toBe(10);
    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe('CANCELLED');
    expect(row.cancelledAt).not.toBeNull();
  });

  it('8a. ⭐ hai đường cùng huỷ MỘT đơn → đúng một đường thắng, stock chỉ tăng một lần', async () => {
    const { agent } = await loginAsNewUser();
    const skuId = await seedSku(10);
    const order = await placeOrder(agent, skuId, 4);
    expect((await prisma.productSku.findUniqueOrThrow({ where: { id: skuId } })).stock).toBe(6);
    await sleep(HOLD_SECONDS * 1000 + 200);

    const expiry = app.get(OrderExpiryService);
    // Đúng cảnh xảy ra thật khi delayed job nổ trùng lúc sweeper quét tới cùng một đơn.
    const results = await Promise.all([expiry.cancelExpired(order.id), expiry.cancelExpired(order.id)]);

    // Điều kiện nằm trong câu UPDATE nên chỉ một lời gọi thấy 1 dòng bị ảnh hưởng.
    expect(results.filter(Boolean)).toHaveLength(1);
    // Bằng chứng cứng nhất: trả kho hai lần thì stock thành 14.
    expect((await prisma.productSku.findUniqueOrThrow({ where: { id: skuId } })).stock).toBe(10);
  });

  it('8b. ⭐ sweeper dọn đơn mà delayed job bỏ sót → cũng chỉ trả kho một lần', async () => {
    const { agent } = await loginAsNewUser();
    const skuId = await seedSku(10);
    const order = await placeOrder(agent, skuId, 4);
    await sleep(HOLD_SECONDS * 1000 + 200);

    const expiry = app.get(OrderExpiryService);
    // Sweeper quét TOÀN BỘ đơn quá hạn nên số nó trả về gồm cả đơn của test khác — vì vậy
    // kiểm chứng bằng trạng thái của đúng đơn này, không bằng con số tổng.
    await expiry.sweepExpired();
    // Delayed job nổ muộn, sau khi sweeper đã dọn: phải thoát êm, không trả kho lần hai.
    expect(await expiry.cancelExpired(order.id)).toBe(false);

    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('CANCELLED');
    expect((await prisma.productSku.findUniqueOrThrow({ where: { id: skuId } })).stock).toBe(10);
  });

  it('9. đơn đã PAID → job huỷ không đụng tới, không trả kho', async () => {
    const { agent } = await loginAsNewUser();
    const skuId = await seedSku(10);
    const order = await placeOrder(agent, skuId, 2);
    await prisma.order.update({ where: { id: order.id }, data: { status: 'PAID', paidAt: new Date() } });
    await sleep(HOLD_SECONDS * 1000 + 200);

    expect(await app.get(OrderExpiryService).cancelExpired(order.id)).toBe(false);
    expect((await prisma.productSku.findUniqueOrThrow({ where: { id: skuId } })).stock).toBe(8);
  });

  // ── Webhook ────────────────────────────────────────────────────────────────────────────

  it('10. chữ ký đúng → 204, và job xử lý chuyển đơn sang PAID', async () => {
    const { agent } = await loginAsNewUser();
    const order = await placeOrder(agent, await seedSku(5));
    const body = webhookBody(order);

    expect(await sendWebhook(body)).toBe(204);

    const jobs = await queue.queue.getJobs(['waiting', 'active', 'delayed']);
    const job = jobs.find((j) => j.name === JOB.PAYMENT_PROCESS);
    expect(job).toBeDefined();

    await app.get(PaymentService).process(job!.data);

    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe('PAID');
    expect(row.paidAt).not.toBeNull();
    expect(row.paymentIntentId).toBe(body.paymentIntentId);
  });

  it('11. chữ ký sai → 401 và đơn giữ nguyên PENDING', async () => {
    const { agent } = await loginAsNewUser();
    const order = await placeOrder(agent, await seedSku(5));

    expect(await sendWebhook(webhookBody(order), { secret: 'khoa-khac-toi-thieu-32-ky-tu-abcdef' })).toBe(401);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PENDING');
  });

  it('11b. body bị sửa sau khi ký → 401 (chữ ký ký trên RAW body)', async () => {
    const { agent } = await loginAsNewUser();
    const order = await placeOrder(agent, await seedSku(5));

    expect(await sendWebhook(webhookBody(order), { tamper: true })).toBe(401);
  });

  it('12. dấu thời gian lệch 10 phút → 401', async () => {
    const { agent } = await loginAsNewUser();
    const order = await placeOrder(agent, await seedSku(5));
    const old = Math.floor(Date.now() / 1000) - 600;

    expect(await sendWebhook(webhookBody(order), { timestampSec: old })).toBe(401);
  });

  it('13. cùng eventId gửi 2 lần → 204 cả hai, chỉ một lần chuyển trạng thái', async () => {
    const { agent } = await loginAsNewUser();
    const order = await placeOrder(agent, await seedSku(5));
    const body = webhookBody(order);

    expect(await sendWebhook(body)).toBe(204);
    expect(await sendWebhook(body)).toBe(204);

    const payments = app.get(PaymentService);
    const jobs = (await queue.queue.getJobs(['waiting', 'active', 'delayed'])).filter(
      (j) => j.name === JOB.PAYMENT_PROCESS,
    );
    expect(jobs).toHaveLength(2);
    for (const job of jobs) await payments.process(job.data);

    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe('PAID');
    // Bản trùng KHÔNG được sinh thêm yêu cầu hoàn tiền hay ghi đè gì.
    expect(await prisma.refundRequest.count({ where: { orderId: order.id } })).toBe(0);
    expect(await prisma.processedEvent.count({ where: { eventId: String(body.eventId) } })).toBe(1);
  });

  it('14. webhook tới đơn đã CANCELLED → đơn vẫn CANCELLED, có 1 refund_requests', async () => {
    const { agent } = await loginAsNewUser();
    const skuId = await seedSku(5);
    const order = await placeOrder(agent, skuId);
    await sleep(HOLD_SECONDS * 1000 + 200);
    await app.get(OrderExpiryService).cancelExpired(order.id);

    const body = webhookBody(order);
    await app.get(PaymentService).process({
      eventId: String(body.eventId),
      type: 'payment.succeeded',
      orderId: order.id,
      paymentIntentId: String(body.paymentIntentId),
      amountVnd: order.totalVnd,
    });

    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe('CANCELLED');
    expect(row.paidAt).toBeNull();

    const refunds = await prisma.refundRequest.findMany({ where: { orderId: order.id } });
    expect(refunds).toHaveLength(1);
    expect(refunds[0]?.reason).toBe('ORDER_ALREADY_CANCELLED');
  });

  it('15. số tiền lệch → không PAID, có refund_requests AMOUNT_MISMATCH', async () => {
    const { agent } = await loginAsNewUser();
    const order = await placeOrder(agent, await seedSku(5));

    await app.get(PaymentService).process({
      eventId: `evt_${randomUUID()}`,
      type: 'payment.succeeded',
      orderId: order.id,
      paymentIntentId: `pi_${randomUUID()}`,
      amountVnd: order.totalVnd - 1_000,
    });

    const row = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(row.status).toBe('PENDING');
    const refunds = await prisma.refundRequest.findMany({ where: { orderId: order.id } });
    expect(refunds[0]?.reason).toBe('AMOUNT_MISMATCH');
  });

  // ── Cổng chính của phase ───────────────────────────────────────────────────────────────

  it(
    '18. ⭐ "rút dây mạng": giết worker giữa chừng rồi bật lại → đúng 20 email, không hơn',
    async () => {
      const { agent } = await loginAsNewUser();
      const skuId = await seedSku(50);
      const orderIds = new Set<string>();
      for (let i = 0; i < 20; i += 1) orderIds.add((await placeOrder(agent, skuId)).id);
      await app.get(OutboxRelay).relayOnce();

      const processor = async (job: { name: string; data: unknown }): Promise<void> => {
        if (job.name !== JOB.EMAIL_CONFIRM) return;
        await app.get(OrderNotifier).sendConfirmation(job.data as never);
      };

      // Worker #1: xử lý được vài job rồi bị GIẾT giữa chừng (`force = true`, không chờ job
      // đang chạy xong) — mô phỏng đúng cảnh rút dây mạng, không phải tắt êm.
      const prefix = process.env.QUEUE_PREFIX;
      const firstConn = queue.connection.duplicate();
      const first = new Worker(QUEUE_NAME, processor, { connection: firstConn, concurrency: 2, prefix });
      await sleep(400);
      await first.close(true);

      // Worker #2 bật lên và dọn nốt. Job đang dở của worker #1 bị coi là "stalled" và được
      // giao lại — đó là lý do có thể xử lý TRÙNG, và là lý do consumer phải idempotent.
      const secondConn = queue.connection.duplicate();
      const second = new Worker(QUEUE_NAME, processor, { connection: secondConn, concurrency: 5, prefix });

      // Chỉ đếm email của 20 đơn tạo trong CHÍNH test này.
      const mine = () => mailer.sent.filter((m) => [...orderIds].some((id) => m.subject.includes(id)));
      const deadline = Date.now() + 20_000;
      while (mine().length < 20 && Date.now() < deadline) await sleep(200);
      await second.close();
      // BullMQ không tự đóng connection do mình truyền vào — không quit thì Jest treo.
      await Promise.all([firstConn.quit(), secondConn.quit()]);

      // Không MẤT: đủ 20. Không TRÙNG: đúng 20, dù worker #1 bị giết giữa chừng và job đang
      // dở của nó được giao lại cho worker #2.
      expect(mine()).toHaveLength(20);
      expect(new Set(mine().map((m) => m.subject)).size).toBe(20);
    },
    60_000,
  );
});
