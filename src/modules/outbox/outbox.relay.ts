import { Inject, Injectable, Logger } from '@nestjs/common';

import { ENV, type Env } from '../../config';
import { JOB, QueueService, type EmailConfirmPayload } from '../../infra/queue';
import { OutboxRepository, type ClaimedEvent } from './outbox.repository';

/**
 * Đọc hộp thư đi rồi đẩy vào queue. Chạy như một job lặp (`outbox.relay`).
 *
 * **Vì sao vẫn có thể trùng, dù đã khoá dòng:** `claimBatch` commit trạng thái `DISPATCHED`
 * TRƯỚC khi gọi `queue.add`. Nếu đổi thứ tự (đẩy trước, đánh dấu sau) thì process chết ở giữa
 * sẽ đẩy lại lần sau — trùng. Giữ nguyên thứ tự này thì process chết ở giữa sẽ **mất** job...
 * nên nhánh `catch` phải trả dòng về `PENDING`. Kết quả: có thể trùng, không mất. Đúng mô
 * hình at-least-once, và consumer idempotent lo phần còn lại.
 */
@Injectable()
export class OutboxRelay {
  private readonly logger = new Logger(OutboxRelay.name);

  constructor(
    private readonly repo: OutboxRepository,
    private readonly queue: QueueService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Trả về số sự kiện đã đẩy trong vòng quét này. */
  async relayOnce(): Promise<number> {
    const events = await this.repo.claimBatch(this.env.OUTBOX_BATCH_SIZE);
    if (events.length === 0) return 0;

    const failed: string[] = [];
    let lastError = '';

    for (const event of events) {
      try {
        await this.dispatch(event);
      } catch (error) {
        failed.push(event.id);
        lastError = error instanceof Error ? error.message : String(error);
        this.logger.error({ eventId: event.id, type: event.type, err: error }, 'Đẩy sự kiện thất bại');
      }
    }

    if (failed.length > 0) await this.repo.releaseFailed(failed, lastError);

    const sent = events.length - failed.length;
    if (sent > 0) this.logger.debug({ sent }, 'Đã đẩy sự kiện từ hộp thư đi');
    return sent;
  }

  private async dispatch(event: ClaimedEvent): Promise<void> {
    switch (event.type) {
      case 'order.placed':
        await this.queue.add<EmailConfirmPayload>(JOB.EMAIL_CONFIRM, {
          // `eventId` = id dòng outbox. Đẩy lại cùng dòng ⇒ cùng eventId ⇒ consumer nhận ra
          // bản trùng. Sinh id mới ở đây là tự tay phá vỡ tính idempotent.
          eventId: event.id,
          ...(event.payload as unknown as Omit<EmailConfirmPayload, 'eventId'>),
        });
        return;
      default:
        // Không nuốt lặng: kiểu sự kiện lạ nghĩa là ai đó ghi outbox mà quên viết đường ra.
        throw new Error(`Không có người tiêu thụ cho sự kiện "${event.type}"`);
    }
  }
}
