/**
 * ĐIỂM BẮT ĐẦU CỦA WORKER — tiến trình xử lý job nền, chạy bằng `npm run worker`.
 *
 * **Vì sao tách khỏi `main.ts` thay vì chạy chung một process** (spec Phase 4, câu hỏi mở
 * #2): deliverable của phase là demo "rút dây mạng" — giết worker giữa lúc xử lý mà API vẫn
 * sống, rồi bật lại và chứng minh không mất message, không gửi email trùng. Chạy chung thì
 * giết worker là giết luôn API, và không có gì để chứng minh.
 *
 * Đổi lại: local phải chạy hai lệnh (`npm run dev` và `npm run worker`). Cách chạy trên
 * Cloud Run — nơi free tier khó nuôi một process nền luôn thức — để Phase 7 quyết bằng ADR.
 *
 * **Vì sao `npm run worker` là `nest start --entryFile worker` chứ không phải `ts-node`:**
 * Prisma Client được generate thành TypeScript với import kèm đuôi `.js` (đúng chuẩn Prisma 7
 * + `moduleResolution: node16`) nhưng file thật trên đĩa là `.ts`. Jest xử lý bằng
 * `moduleNameMapper`, còn `ts-node` thì không có gì làm việc đó và `require` vỡ ngay ở bước
 * nạp client. `nest start` biên dịch bằng đúng tsc như API rồi chạy `dist/worker.js`, nên
 * worker đi chung một đường build đã biết là đúng. (`prisma/seed/seed-skus.ts` né vấn đề này
 * bằng cách dùng `pg` thẳng — nhưng worker thì cần cả Prisma Client.)
 */
import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { Worker } from 'bullmq';
import { Logger } from 'nestjs-pino';

import { ENV, type Env } from './config';
import { QUEUE_NAME, QueueService } from './infra/queue';
import { JobProcessor } from './worker/job.processor';
import { WorkerModule } from './worker/worker.module';

async function bootstrap(): Promise<void> {
  // `createApplicationContext` thay cho `create`: dựng đúng cây DI, KHÔNG mở cổng HTTP.
  // Worker không phục vụ request nào — mở cổng chỉ để đó là thêm một bề mặt tấn công.
  const app = await NestFactory.createApplicationContext(WorkerModule, { bufferLogs: true });
  const logger = app.get(Logger);
  app.useLogger(logger);
  app.enableShutdownHooks();

  const env = app.get<Env>(ENV);
  const queue = app.get(QueueService);
  const processor = app.get(JobProcessor);

  await queue.registerRepeatables();

  const worker = new Worker(QUEUE_NAME, (job) => processor.process(job), {
    // Kết nối RIÊNG cho worker: nó chạy lệnh blocking để chờ việc, không dùng chung với
    // connection của `Queue` được (xem `QueueService` để biết vì sao `maxRetriesPerRequest`
    // phải là `null`).
    connection: queue.connection.duplicate(),
    concurrency: env.QUEUE_CONCURRENCY,
    prefix: env.QUEUE_PREFIX,
  });

  worker.on('failed', (job, err) => {
    // Ba tình huống khác hẳn nhau, đừng gộp thành một dòng log:
    //
    // 1. **Job lặp** (relay, sweeper) — không có `attempts`, nhưng nó KHÔNG nằm lại DLQ: lịch
    //    lặp sẽ tạo một job mới ở nhịp sau. Gọi nó là "cạn số lần thử" là nói sai, và dưới
    //    một sự cố kéo dài (DB chưa migrate chẳng hạn) nó in ra mỗi giây một dòng `error`
    //    khiến người đọc tưởng có hàng trăm job chết.
    // 2. **Job một lần, còn lượt** — sẽ thử lại, chỉ đáng `warn`.
    // 3. **Job một lần, hết lượt** — mới thật sự nằm lại DLQ, và mới đáng `error`.
    // `repeatJobKey` chỉ có ở job do lịch lặp sinh ra — đó là cách phân biệt duy nhất.
    const repeatable = Boolean(job?.repeatJobKey);
    const exhausted = job ? job.attemptsMade >= (job.opts.attempts ?? 1) : false;

    const level = repeatable || !exhausted ? 'warn' : 'error';
    const message = repeatable
      ? 'Job lặp thất bại — sẽ chạy lại ở nhịp sau'
      : exhausted
        ? 'Job cạn số lần thử — nằm lại ở DLQ'
        : 'Job thất bại, sẽ thử lại';

    logger[level](
      { jobId: job?.id, name: job?.name, attempt: job?.attemptsMade, err: err.message },
      message,
    );
  });

  /**
   * Tắt êm (graceful shutdown).
   *
   * `worker.close()` **ngừng nhận job mới rồi chờ job đang chạy xong**. Thiếu bước này thì
   * mỗi lần deploy sẽ cắt ngang một job đang xử lý dở — đúng thứ Phase 4 phải chứng minh là
   * không xảy ra. Đóng worker TRƯỚC `app.close()` vì job đang chạy còn cần Prisma/Redis.
   */
  const shutdown = async (signal: string): Promise<void> => {
    logger.log(`Nhận ${signal} — ngừng nhận job mới, chờ job đang chạy xong`);
    await worker.close();
    await app.close();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  logger.log(`Worker đang chạy — concurrency ${env.QUEUE_CONCURRENCY}, queue "${QUEUE_NAME}"`);
}

void bootstrap();
