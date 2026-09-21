/**
 * WORKER CHẠY MỘT LƯỢT RỒI THOÁT — điểm vào cho **Cloud Run Job** (`npm run worker:once`).
 *
 * **Vì sao tồn tại, trong khi đã có `worker.ts`:** Cloud Run free tier **scale về 0** khi
 * không có request. Một tiến trình nền phải thức liên tục thì hoặc không chạy được ở đó, hoặc
 * phải đặt `min-instances=1` — mà cái đó tốn tiền, vi phạm ràng buộc FinOps 0đ của dự án
 * (`docs/SPEC.md` §5). Lời giải free-tier: **Cloud Scheduler gọi một Cloud Run Job mỗi phút**,
 * job đó dọn một lượt rồi thoát. Chi tiết và các phương án đã loại: ADR-012.
 *
 * Nó cố tình **không** dựng `Worker` của BullMQ. `Worker` là vòng lặp chờ-việc dài hạn; ở đây
 * ta chủ động gọi thẳng hai việc định kỳ, rồi **rút** job đang chờ trong queue ra xử lý cho
 * tới khi hết hoặc hết ngân sách thời gian.
 *
 * Bất biến quan trọng: **mọi thứ nó gọi đều idempotent** (outbox `SKIP LOCKED`,
 * `processed_events`, `UPDATE ... WHERE status='PENDING'`). Nên chạy chồng hai lượt, hoặc bị
 * giết giữa chừng, đều không sinh hệ quả trùng — cùng bảo đảm với `worker.ts`, không phải
 * bảo đảm yếu hơn.
 */
import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import type { Job } from 'bullmq';
import { Logger } from 'nestjs-pino';

import { QueueService } from './infra/queue';
import { JobProcessor } from './worker/job.processor';
import { WorkerModule } from './worker/worker.module';

/** Ngân sách thời gian cho một lượt. Hết thì thoát êm — lượt sau (1 phút nữa) dọn tiếp. */
const BUDGET_MS = 50_000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  const queue = app.get(QueueService);
  const processor = app.get(JobProcessor);
  const deadline = Date.now() + BUDGET_MS;

  let processed = 0;
  let failed = 0;

  try {
    // 1. Hai việc định kỳ, gọi thẳng — không qua lịch lặp của BullMQ (lịch đó cần một tiến
    //    trình thức để kích hoạt, thứ chính xác là cái ta không có ở đây).
    await runSafely(() => processor.process({ name: 'outbox.relay' } as Job), logger, 'relay');
    await runSafely(() => processor.process({ name: 'order.expire.sweep' } as Job), logger, 'sweep');

    // 2. Rút job đang chờ (email xác nhận, thanh toán, huỷ đơn tới hạn) cho tới khi hết.
    for (;;) {
      if (Date.now() > deadline) {
        logger.warn({ processed, failed }, 'Hết ngân sách thời gian — lượt sau dọn tiếp');
        break;
      }

      const jobs = await queue.queue.getJobs(['waiting', 'delayed'], 0, 24);
      // `delayed` mà chưa tới hạn thì để yên: nó là lịch hẹn huỷ đơn, chạy sớm là huỷ nhầm
      // đơn còn hạn. `cancelIfExpired` vẫn chặn được nhờ điều kiện `expires_at <= now()`,
      // nhưng dựa vào lưới cuối cho việc mình chủ động làm sai thì không phải thiết kế.
      const due = jobs.filter((job) => (job.opts.delay ?? 0) === 0 || job.timestamp + (job.opts.delay ?? 0) <= Date.now());
      if (due.length === 0) break;

      for (const job of due) {
        try {
          await processor.process(job);
          await job.remove();
          processed += 1;
        } catch (error) {
          // Không `remove`: để job nằm lại cho BullMQ retry ở lượt sau, đúng như khi chạy
          // worker dài hạn. Nuốt lỗi ở đây và thoát mã 0 là cách làm mất việc im lặng.
          failed += 1;
          logger.warn({ jobId: job.id, name: job.name, err: (error as Error).message }, 'Job lỗi — giữ lại cho lượt sau');
        }
      }
    }

    logger.log({ processed, failed }, 'Xong một lượt worker');
  } finally {
    await queue.connection.quit().catch(() => undefined);
    await app.close();
  }

  // Thoát khác 0 khi có job lỗi để Cloud Run Job đánh dấu lần chạy là thất bại — nếu luôn
  // thoát 0 thì bảng điều khiển sẽ xanh mướt kể cả khi không job nào chạy nổi.
  process.exit(failed > 0 ? 1 : 0);
}

async function runSafely(work: () => Promise<unknown>, logger: Logger, name: string): Promise<void> {
  try {
    await work();
  } catch (error) {
    logger.error({ err: (error as Error).message }, `Việc định kỳ "${name}" lỗi`);
  }
}

void bootstrap();
