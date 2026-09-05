import { Inject, Injectable, Logger } from '@nestjs/common';

import { ORDER_PAYMENTS, type OrderPayments } from '../order';
import type { PaymentProcessPayload } from '../../infra/queue';

/**
 * Người tiêu thụ job `payment.process`.
 *
 * Việc duy nhất của nó là **đưa sự kiện đã verify sang cửa `ORDER_PAYMENTS`** rồi ghi log
 * theo kết quả. Toàn bộ quyết định nghiệp vụ (đánh dấu PAID hay ghi yêu cầu hoàn tiền) nằm
 * bên module `order`, vì đó là trạng thái của đơn — module `payment` chỉ là *biên giới với
 * cổng thanh toán*.
 */
@Injectable()
export class PaymentService {
  private readonly logger = new Logger(PaymentService.name);

  constructor(@Inject(ORDER_PAYMENTS) private readonly orders: OrderPayments) {}

  async process(payload: PaymentProcessPayload): Promise<void> {
    if (payload.type === 'payment.failed') {
      // Không huỷ đơn ở đây: khách có thể trả lại bằng cách khác trước khi hết 15 phút. Cứ để
      // đơn tự hết hạn theo đúng một đường duy nhất (`order.expire`), đừng thêm đường thứ ba.
      this.logger.log({ orderId: payload.orderId }, 'Thanh toán thất bại — để đơn tự hết hạn');
      return;
    }

    const outcome = await this.orders.settle({
      eventId: payload.eventId,
      orderId: payload.orderId,
      paymentIntentId: payload.paymentIntentId,
      amountVnd: payload.amountVnd,
      correlationId: payload.correlationId,
    });

    switch (outcome.kind) {
      case 'PAID':
        this.logger.log({ orderId: payload.orderId }, 'Đơn đã chuyển sang PAID');
        return;
      case 'ALREADY_HANDLED':
        return;
      case 'REFUND_REQUIRED':
        // `order` đã log mức error kèm đầy đủ thông tin — không log lại lần hai ở đây.
        return;
      case 'ORDER_NOT_FOUND':
        // Không ném lỗi: retry cũng không làm đơn xuất hiện. Nhưng phải ồn, vì cổng đang nói
        // về một đơn mình không biết — hoặc dữ liệu lệch, hoặc ai đó gửi bậy mà có chữ ký đúng.
        this.logger.error(
          { orderId: payload.orderId, paymentIntentId: payload.paymentIntentId },
          'Webhook trỏ tới đơn không tồn tại',
        );
        return;
    }
  }
}
