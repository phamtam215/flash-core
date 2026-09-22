/**
 * WORKER CHẠY MỘT LƯỢT RỒI THOÁT — điểm vào cho **Cloud Run Job** (`npm run worker:once`).
 *
 * **Vì sao tồn tại, trong khi đã có `worker.ts`:** Cloud Run free tier **scale về 0** khi
 * không có request, và ngoài lúc xử lý request thì CPU của container bị **cắt** (throttling).
 * Một vòng lặp chờ-việc dài hạn vừa không sống được, vừa bị đóng băng giữa chừng. Đặt
 * `min-instances=1` thì tốn tiền, vi phạm ràng buộc 0đ (`docs/SPEC.md` §5). Lời giải free-tier:
 * **Cloud Scheduler gọi một Cloud Run Job mỗi 5 phút**, job đó dọn một lượt rồi thoát.
 * Phương án đã loại và phép tính hạn mức: ADR-012 + spec Phase 7 §Bài toán #1.
 *
 * **Nó VẪN dùng `Worker` của BullMQ, chỉ khác ở chỗ biết lúc nào dừng.** Bản đầu tự `getJobs`
 * rồi gọi thẳng `processor.process()` — và đó là một lỗi thật: job ném lỗi sẽ **không** vào
 * trạng thái `failed`, `attemptsMade` không tăng, `backoff` không chạy, DLQ không bao giờ có
 * gì. Vòng lặp lấy lại đúng job đó ngay lập tức và quay vòng cho tới hết ngân sách. Nói cách
 * khác: bỏ qua vòng đời của BullMQ là bỏ luôn retry, backoff và DLQ mà Phase 4 dựng lên.
 * `Worker` + sự kiện `drained` cho đúng hành vi đó mà vẫn có điểm kết thúc.
 *
 * Bất biến quan trọng: **mọi thứ nó gọi đều idempotent** (outbox `SKIP LOCKED`,
 * `processed_events`, `UPDATE ... WHERE status='PENDING'`). Nên hai lượt chạy chồng nhau, hoặc
 * bị giết giữa chừng, đều không sinh hệ quả trùng — cùng bảo đảm với `worker.ts`.
 */
import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { Worker, type Job } from 'bullmq';
import { Logger } from 'nestjs-pino';

import { ENV, type Env } from './config';
import { QUEUE_NAME, QueueService } from './infra/queue';
import { JobProcessor } from './worker/job.processor';
import { WorkerModule } from './worker/worker.module';

/**
 * Trần thời gian cho một lượt.
 *
 * **10 giây không phải con số tuỳ ý**: nó là giả định trong phép tính hạn mức ở
 * `docs/specs/phase7-deploy-gcp.md` §Bài toán #4 — 288 lượt/ngày × 10s ≈ 86.400 vCPU-giây/
 * tháng, dưới trần free tier 180.000. Nới lên 50 giây là tự đưa trường hợp xấu nhất lên
 * 432.000 ⇒ vượt trần. Lượt bình thường chỉ mất ~1 giây; đây là **trần**, và trần mới là thứ
 * hoá đơn quan tâm.
 */
const BUDGET_MS = 10_000;

async function bootstrap(): Promise<void> {
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);

  const env = app.get<Env>(ENV);
  const queue = app.get(QueueService);
  const processor = app.get(JobProcessor);

  let processed = 0;
  let failed = 0;

  // Hai việc định kỳ, gọi thẳng — KHÔNG qua lịch lặp của BullMQ. Lịch lặp cần một tiến trình
  // thức để kích hoạt, thứ chính xác là cái ta không có ở đây.
  await runSafely(() => processor.process({ name: 'outbox.relay' } as Job), logger, 'outbox.relay');
  await runSafely(() => processor.process({ name: 'order.expire.sweep' } as Job), logger, 'sweep');

  // Worker thật: job đi đúng vòng đời active → completed/failed, nên `attempts`, `backoff` và
  // DLQ của `QueueService` hoạt động y như khi chạy worker dài hạn.
  const worker = new Worker(QUEUE_NAME, (job) => processor.process(job), {
    connection: queue.connection.duplicate(),
    concurrency: env.QUEUE_CONCURRENCY,
    prefix: env.QUEUE_PREFIX,
  });

  worker.on('completed', () => {
    processed += 1;
  });
  worker.on('failed', (job, err) => {
    failed += 1;
    logger.warn({ jobId: job?.id, name: job?.name, err: err.message }, 'Job lỗi — BullMQ giữ lại để retry');
  });

  // Dừng khi hàng rỗng, hoặc khi hết ngân sách — cái nào tới trước.
  //
  // `drained` bắn khi không còn job nào ĐANG CHỜ. Job `delayed` chưa tới hạn không tính, và
  // đó là đúng: lịch hẹn huỷ đơn chạy sớm là huỷ nhầm đơn còn hạn.
  await new Promise<void>((resolve) => {
    const budget = setTimeout(() => {
      logger.warn({ processed, failed }, 'Hết ngân sách thời gian — lượt sau dọn tiếp');
      resolve();
    }, BUDGET_MS);

    worker.on('drained', () => {
      clearTimeout(budget);
      resolve();
    });
  });

  // `worker.close()` ngừng nhận job mới rồi CHỜ job đang chạy xong — không cắt ngang việc dở.
  await worker.close();
  logger.log({ processed, failed }, 'Xong một lượt worker');

  // KHÔNG tự `queue.connection.quit()` ở đây: `QueueService.onModuleDestroy` đã làm việc đó,
  // và gọi `quit()` lần hai trên một ioredis đã đóng sẽ **reject** (`Connection is closed.`).
  // Bản đầu mắc đúng lỗi này — lời từ chối đó thoát ra ngoài nên `process.exit()` bên dưới
  // không bao giờ chạy, và Cloud Run đánh dấu **mọi** lần chạy là thất bại.
  await app.close();

  // Thoát khác 0 khi có job lỗi, để bảng điều khiển Cloud Run không xanh giả.
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
