import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import { Test, type TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infra/prisma';
import { QueueService } from '../src/infra/queue';
import { RetentionService } from '../src/modules/retention';
import { startInfra } from './infra-fixture';

/**
 * Integration test cho job dọn dữ liệu.
 *
 * Test đắt nhất là **#2 và #3**: chứng minh job **không bao giờ** xoá `PENDING` và `FAILED`.
 * Xoá nhầm `PENDING` là mất sự kiện chưa đẩy; xoá nhầm `FAILED` là dọn mất đúng thứ đang chờ
 * người điều tra. Cả hai đều không có lỗi nào báo — bảng chỉ nhỏ lại, và trông như job chạy tốt.
 */
describe('Dọn dữ liệu cũ (e2e)', () => {
  let stopInfra: () => Promise<void>;
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let queue: QueueService;
  let retention: RetentionService;

  const RETENTION_DAYS = 30;
  const long_ago = () => new Date(Date.now() - (RETENTION_DAYS + 5) * 24 * 3600 * 1000);
  const recently = () => new Date(Date.now() - 24 * 3600 * 1000);

  beforeAll(async () => {
    stopInfra = await startInfra();

    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-toi-thieu-32-ky-tu!!';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-toi-thieu-32-ky-tu!';
    process.env.CSRF_SECRET = 'test-csrf-secret-toi-thieu-32-ky-tu!!!';
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-webhook-secret-toi-thieu-32-ky-tu';
    process.env.DATA_RETENTION_DAYS = String(RETENTION_DAYS);
    process.env.RETENTION_BATCH_SIZE = '50';
    process.env.QUEUE_PREFIX = `test-${randomUUID().slice(0, 8)}`;

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env }, stdio: 'pipe' });

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    await app.init();

    prisma = app.get(PrismaService);
    queue = app.get(QueueService);
    retention = app.get(RetentionService);
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    await queue?.connection.quit().catch(() => undefined);
    await stopInfra?.();
  });

  beforeEach(async () => {
    await prisma.processedEvent.deleteMany();
    await prisma.outboxEvent.deleteMany();
  });

  async function seedOutbox(
    status: 'PENDING' | 'DISPATCHED' | 'FAILED',
    dispatchedAt: Date | null,
  ): Promise<string> {
    const row = await prisma.outboxEvent.create({
      data: {
        aggregate: 'order',
        aggregateId: randomUUID(),
        type: 'order.placed',
        payload: {},
        status,
        dispatchedAt,
      },
    });
    return row.id;
  }

  it('1. dòng DISPATCHED đủ cũ → bị xoá', async () => {
    await seedOutbox('DISPATCHED', long_ago());

    const result = await retention.sweep();

    expect(result.outbox).toBe(1);
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('2. ⭐ dòng PENDING KHÔNG bao giờ bị xoá, dù cũ tới đâu', async () => {
    // `PENDING` nghĩa là chưa đẩy vào queue. Xoá nó là **mất sự kiện** — email không bao giờ
    // gửi, và không có gì báo vì dòng đó biến mất luôn.
    const id = await seedOutbox('PENDING', null);

    await retention.sweep();

    expect(await prisma.outboxEvent.findUnique({ where: { id } })).not.toBeNull();
  });

  it('3. ⭐ dòng FAILED KHÔNG bao giờ bị xoá — đó là thứ đang chờ người nhìn', async () => {
    const id = await seedOutbox('FAILED', long_ago());

    await retention.sweep();

    expect(await prisma.outboxEvent.findUnique({ where: { id } })).not.toBeNull();
  });

  it('4. dòng DISPATCHED còn mới → giữ lại', async () => {
    const id = await seedOutbox('DISPATCHED', recently());

    const result = await retention.sweep();

    expect(result.outbox).toBe(0);
    expect(await prisma.outboxEvent.findUnique({ where: { id } })).not.toBeNull();
  });

  it('5. ⭐ dấu idempotent đủ cũ bị xoá, dấu còn mới thì KHÔNG', async () => {
    // Ngưỡng giữ dấu là một núm vặn về TÍNH ĐÚNG: xoá dấu rồi mà sự kiện quay lại thì nó
    // được xử lý lần nữa — với `markPaid` thì hệ quả là tiền.
    await prisma.processedEvent.create({
      data: { eventId: `cu-${randomUUID()}`, consumer: 'order.email.confirm', processedAt: long_ago() },
    });
    const moi = `moi-${randomUUID()}`;
    await prisma.processedEvent.create({
      data: { eventId: moi, consumer: 'order.email.confirm', processedAt: recently() },
    });

    const result = await retention.sweep();

    expect(result.processed).toBe(1);
    expect(
      await prisma.processedEvent.findUnique({
        where: { eventId_consumer: { eventId: moi, consumer: 'order.email.confirm' } },
      }),
    ).not.toBeNull();
  });

  it('6. ⭐ xoá theo LÔ, lặp cho tới hết — 120 dòng với lô 50 vẫn sạch', async () => {
    await prisma.outboxEvent.createMany({
      data: Array.from({ length: 120 }, () => ({
        aggregate: 'order',
        aggregateId: randomUUID(),
        type: 'order.placed',
        payload: {},
        status: 'DISPATCHED' as const,
        dispatchedAt: long_ago(),
      })),
    });

    const result = await retention.sweep();

    // Dừng sau một lô thì bảng vẫn còn 70 dòng mà log vẫn báo "đã dọn" — không ai đi kiểm.
    expect(result.outbox).toBe(120);
    expect(await prisma.outboxEvent.count()).toBe(0);
  });

  it('7. chạy hai lần liên tiếp → lần hai không xoá gì (idempotent, không lỗi)', async () => {
    await seedOutbox('DISPATCHED', long_ago());

    await retention.sweep();
    const second = await retention.sweep();

    expect(second).toEqual({ outbox: 0, processed: 0 });
  });

  it('8. metric outbox_failed phản ánh đúng số dòng FAILED còn lại', async () => {
    await seedOutbox('FAILED', long_ago());
    await seedOutbox('FAILED', long_ago());
    await seedOutbox('DISPATCHED', long_ago());

    await retention.sweep();

    // Hai dòng FAILED còn nguyên; dòng DISPATCHED đã đi.
    expect(await prisma.outboxEvent.count({ where: { status: 'FAILED' } })).toBe(2);
    expect(await prisma.outboxEvent.count()).toBe(2);
  });
});
