import { Inject, Injectable, Logger } from '@nestjs/common';

import { ENV, type Env } from '../../config';
import { JOB, QueueService, type EmailConfirmPayload } from '../../infra/queue';
import { OutboxRepository, type ClaimedEvent } from './outbox.repository';

/**
 * Đọc hộp thư đi rồi đẩy vào queue. Chạy như một job lặp (`outbox.relay`).
 *
 * Bảo đảm của nó là **at-least-once**: không mất, có thể trùng. Xem
 * `OutboxRepository.dispatchBatch` để biết vì sao thứ tự "đẩy trước, đánh dấu sau" là điều
 * kiện để có được bảo đảm đó — và vì sao thứ tự ngược lại làm mất sự kiện im lặng.
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
    const batchSize = this.env.OUTBOX_BATCH_SIZE;

    try {
      const sent = await this.repo.dispatchBatch(batchSize, async (events) => {
        for (const event of events) await this.dispatch(event);
      });

      if (sent > 0) this.logger.debug({ sent }, 'Đã đẩy sự kiện từ hộp thư đi');
      return sent;
    } catch (error) {
      // Cả lô đã rollback về `PENDING`. Ghi lại số lần hỏng ở một lệnh RIÊNG, ngoài transaction
      // vừa bị huỷ — nếu ghi bên trong thì nó cũng bị cuốn theo và không bao giờ đếm được.
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error({ err: message }, 'Đẩy hộp thư đi thất bại — lô quay lại PENDING');
      await this.repo.recordDispatchFailure(message, batchSize);
      return 0;
    }
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
