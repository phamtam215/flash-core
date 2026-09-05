import { Injectable, Logger } from '@nestjs/common';
import { UnrecoverableError, type Job } from 'bullmq';

import {
  JOB,
  type EmailConfirmPayload,
  type OrderExpirePayload,
  type PaymentProcessPayload,
} from '../infra/queue';
import { PermanentMailError } from '../modules/mail';
import { OrderExpiryService, OrderNotifier } from '../modules/order';
import { OutboxRelay } from '../modules/outbox';
import { PaymentService } from '../modules/payment';

/**
 * Bộ điều phối job: nhận một job của BullMQ và gọi đúng service nghiệp vụ.
 *
 * File này cố tình **mỏng** — nó chỉ định tuyến theo tên job, không chứa nghiệp vụ nào. Nhờ
 * vậy mọi luồng đều test được bằng cách gọi thẳng service, không cần dựng Redis và giả lập
 * job (chỉ hai test #6 và #18 mới thật sự cần queue chạy).
 */
@Injectable()
export class JobProcessor {
  private readonly logger = new Logger(JobProcessor.name);

  constructor(
    private readonly relay: OutboxRelay,
    private readonly notifier: OrderNotifier,
    private readonly expiry: OrderExpiryService,
    private readonly payments: PaymentService,
  ) {}

  async process(job: Job): Promise<void> {
    switch (job.name) {
      case JOB.OUTBOX_RELAY:
        await this.relay.relayOnce();
        return;

      case JOB.EMAIL_CONFIRM:
        await this.sendEmail(job.data as EmailConfirmPayload);
        return;

      case JOB.ORDER_EXPIRE:
        await this.expiry.cancelExpired((job.data as OrderExpirePayload).orderId);
        return;

      case JOB.ORDER_EXPIRE_SWEEP:
        await this.expiry.sweepExpired();
        return;

      case JOB.PAYMENT_PROCESS:
        await this.payments.process(job.data as PaymentProcessPayload);
        return;

      default:
        // Không nuốt lặng: job lạ nghĩa là ai đó đẩy một tên chưa có người xử lý. Ném
        // `UnrecoverableError` vì retry cũng không làm nó được hiểu.
        throw new UnrecoverableError(`Không có người xử lý cho job "${job.name}"`);
    }
  }

  /**
   * Bọc riêng vì đây là chỗ duy nhất phải **phân biệt lỗi tạm thời với lỗi vĩnh viễn**.
   *
   * `UnrecoverableError` bảo BullMQ dừng retry ngay và đẩy job vào `failed` (DLQ của dự án).
   * Không phân biệt thì một email sai định dạng vẫn bị thử 5 lần với backoff tăng dần — tốn
   * thời gian, và làm DLQ đầy rác không giúp gì cho người đang tìm sự cố thật.
   */
  private async sendEmail(payload: EmailConfirmPayload): Promise<void> {
    try {
      await this.notifier.sendConfirmation(payload);
    } catch (error) {
      if (error instanceof PermanentMailError) {
        this.logger.error({ eventId: payload.eventId, err: error }, 'Lỗi gửi mail không thể sửa — không retry');
        throw new UnrecoverableError(error.message);
      }
      throw error;
    }
  }
}
