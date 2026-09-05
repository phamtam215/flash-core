import { Inject, Injectable, Logger } from '@nestjs/common';

import type { EmailConfirmPayload } from '../../infra/queue';
import { USER_DIRECTORY, type UserDirectory } from '../auth';
import { MAIL_SENDER, PermanentMailError, type MailSender } from '../mail';
import { IdempotencyRepository } from '../outbox';

/** Tên người tiêu thụ, đi vào khoá của `processed_events`. Đổi tên = gửi lại toàn bộ. */
const CONSUMER = 'order.email.confirm';

/**
 * Gửi email xác nhận đơn — người tiêu thụ duy nhất của sự kiện `order.placed`.
 *
 * Hệ quả (gửi mail) nằm NGOÀI DB nên không có transaction nào bao được cả dấu lẫn việc. Dự án
 * chọn **ghi dấu trước** (ADR-004): đảm bảo *không gửi trùng*, đổi lại mất mail nếu process
 * bị giết đúng khe giữa `claim` và `send`. Với email xác nhận đơn thì gửi trùng gây mất lòng
 * tin hơn là chậm một nhịp, và đơn vẫn tra được ở `GET /orders`.
 */
@Injectable()
export class OrderNotifier {
  private readonly logger = new Logger(OrderNotifier.name);

  constructor(
    private readonly idempotency: IdempotencyRepository,
    @Inject(MAIL_SENDER) private readonly mailer: MailSender,
    @Inject(USER_DIRECTORY) private readonly users: UserDirectory,
  ) {}

  async sendConfirmation(payload: EmailConfirmPayload): Promise<void> {
    const claimed = await this.idempotency.claim(payload.eventId, CONSUMER);
    if (!claimed) {
      this.logger.debug({ eventId: payload.eventId }, 'Email này gửi rồi — bỏ qua bản trùng');
      return;
    }

    try {
      const email = await this.users.findEmailById(payload.userId);
      if (!email) {
        // Không có người nhận thì retry bao nhiêu lần cũng vậy — coi là lỗi vĩnh viễn.
        throw new PermanentMailError(`Không tìm thấy email của user ${payload.userId}`);
      }

      await this.mailer.send({
        to: email,
        subject: `Đơn ${payload.orderId} đã được giữ chỗ`,
        body: `Đơn hàng của bạn trị giá ${payload.totalVnd.toLocaleString('vi-VN')}đ đang chờ thanh toán.`,
      });
    } catch (error) {
      // Trả lại dấu để BullMQ retry còn chạy được. Lỗi vĩnh viễn thì KHÔNG trả — giữ dấu lại
      // để job có vào DLQ cũng không ai vô tình chạy lại và gửi trùng.
      if (!(error instanceof PermanentMailError)) {
        await this.idempotency.release(payload.eventId, CONSUMER);
      }
      throw error;
    }
  }
}
