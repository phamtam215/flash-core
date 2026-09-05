import { Inject, Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';

import { ENV, type Env } from '../../config';
import { JOB, QUEUE_NAME, type JobName } from './queue.constants';

/**
 * Số lần thử lại và cách giãn cách giữa hai lần.
 *
 * `jitter` quan trọng ngang `backoff`: 500 job cùng fail lúc SMTP sập sẽ cùng thức dậy đúng
 * một thời điểm nếu delay giống hệt nhau, và đập chết dịch vụ vừa hồi phục (*thundering
 * herd*). BullMQ nhận `jitter` từ 0 đến 1 — 0.5 nghĩa là delay thật nằm ngẫu nhiên trong
 * khoảng 50–100% giá trị tính được.
 */
const RETRY = {
  [JOB.EMAIL_CONFIRM]: { attempts: 5, backoff: { type: 'exponential' as const, delay: 1_000, jitter: 0.5 } },
  [JOB.ORDER_EXPIRE]: { attempts: 3, backoff: { type: 'exponential' as const, delay: 5_000, jitter: 0.5 } },
  [JOB.PAYMENT_PROCESS]: { attempts: 5, backoff: { type: 'exponential' as const, delay: 2_000, jitter: 0.5 } },
} as const;

/**
 * Sở hữu queue BullMQ và kết nối Redis riêng của nó.
 *
 * **Vì sao KHÔNG dùng lại `RedisService.client`:** BullMQ chạy các lệnh blocking
 * (`BZPOPMIN`, `BRPOPLPUSH`) để chờ việc, và ioredis bắt buộc `maxRetriesPerRequest: null`
 * cho kiểu kết nối đó — nếu không, một lệnh chờ lâu sẽ bị coi là thất bại và ném lỗi.
 * `RedisService` cố tình đặt `maxRetriesPerRequest: 1` (rate limit phải hỏng nhanh), hai nhu
 * cầu ngược nhau nên phải là hai kết nối. Đây là chỗ dễ vấp: dùng chung sẽ chạy được lúc
 * đầu rồi ném `MaxRetriesPerRequestError` khi queue rảnh việc.
 */
@Injectable()
export class QueueService implements OnModuleDestroy {
  private readonly logger = new Logger(QueueService.name);
  readonly connection: Redis;
  readonly queue: Queue;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.connection = new Redis(env.REDIS_URL, {
      maxRetriesPerRequest: null,
      // Không lazyConnect: BullMQ tự quản vòng đời kết nối của nó.
    });

    this.queue = new Queue(QUEUE_NAME, {
      connection: this.connection,
      // Worker phải dùng ĐÚNG tiền tố này, nếu không hai bên nhìn vào hai không gian khoá
      // khác nhau và job nằm im mãi mà không ai báo lỗi.
      prefix: env.QUEUE_PREFIX,
      defaultJobOptions: {
        // Job xong thì dọn, giữ lại 100 bản gần nhất để còn nhìn được lúc debug.
        removeOnComplete: 100,
        // DLQ của dự án này CHÍNH LÀ trạng thái `failed` của BullMQ: job cạn retry nằm lại
        // trong Redis, xem bằng `queue.getFailed()`. `removeOnFail: true` là cách làm job
        // biến mất không dấu vết — bug đã ghi ở tech-playbook §Phase 4.
        removeOnFail: false,
      },
    });
  }

  /** Đẩy một job có cấu hình retry tương ứng với tên của nó. */
  async add<T extends object>(name: JobName, payload: T, opts?: { delay?: number; jobId?: string }) {
    const retry = RETRY[name as keyof typeof RETRY];
    return this.queue.add(name, payload, { ...retry, ...opts });
  }

  /**
   * Đăng ký hai job lặp. `jobId` cố định để chạy nhiều worker cũng chỉ có MỘT lịch — BullMQ
   * khử trùng theo khoá lặp, không phải mỗi worker tự tạo một lịch riêng.
   */
  async registerRepeatables(): Promise<void> {
    await this.queue.upsertJobScheduler(
      'outbox-relay-scheduler',
      { every: this.env.OUTBOX_POLL_INTERVAL_MS },
      { name: JOB.OUTBOX_RELAY, opts: { removeOnComplete: 5, removeOnFail: 20 } },
    );
    await this.queue.upsertJobScheduler(
      'order-expire-sweeper',
      { every: 60_000 },
      { name: JOB.ORDER_EXPIRE_SWEEP, opts: { removeOnComplete: 5, removeOnFail: 20 } },
    );
    this.logger.log('Đã đăng ký 2 job lặp: outbox relay và sweeper huỷ đơn quá hạn');
  }

  async onModuleDestroy(): Promise<void> {
    await this.queue.close();
    await this.connection.quit();
  }
}
