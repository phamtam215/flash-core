/**
 * Tên queue và tên job — nơi duy nhất định nghĩa chúng.
 *
 * Vì sao MỘT queue nhiều loại job, không phải mỗi loại một queue: mỗi queue BullMQ giữ riêng
 * một kết nối blocking tới Redis (lệnh `BZPOPMIN` chờ việc). Bốn queue là bốn connection nằm
 * không, trong khi Upstash (Phase 7) tính theo connection. Phân biệt bằng tên job đủ dùng
 * cho tới khi thật sự cần tách độ ưu tiên.
 */
export const QUEUE_NAME = 'flash-core';

export const JOB = {
  /** Gửi email xác nhận đơn. Đẩy bởi outbox relay, KHÔNG đẩy thẳng từ request. */
  EMAIL_CONFIRM: 'order.email.confirm',
  /** Huỷ một đơn quá hạn. Hẹn giờ lúc tạo đơn (`delay`). */
  ORDER_EXPIRE: 'order.expire',
  /** Xử lý một sự kiện thanh toán đã verify chữ ký. */
  PAYMENT_PROCESS: 'payment.process',
  /** Quét hộp thư đi rồi đẩy vào queue. Repeatable. */
  OUTBOX_RELAY: 'outbox.relay',
  /** Lưới an toàn: quét đơn PENDING quá hạn mà delayed job không chạy. Repeatable. */
  ORDER_EXPIRE_SWEEP: 'order.expire.sweep',
} as const;

export type JobName = (typeof JOB)[keyof typeof JOB];

/**
 * Payload của từng loại job. `eventId` là khoá idempotent phía consumer.
 *
 * Cố ý KHÔNG mang địa chỉ email: (1) nó là dữ liệu cá nhân, không nên nằm trong Redis lẫn
 * bảng outbox lâu hơn mức cần; (2) tra địa chỉ lúc gửi thì đổi email xong vẫn gửi đúng chỗ;
 * (3) đường đặt hàng là đường nóng nhất của hệ thống, không thêm một câu SELECT vào đó.
 */
export interface EmailConfirmPayload {
  eventId: string;
  orderId: string;
  userId: string;
  totalVnd: number;
}

export interface OrderExpirePayload {
  orderId: string;
}

export interface PaymentProcessPayload {
  eventId: string;
  type: 'payment.succeeded' | 'payment.failed';
  orderId: string;
  paymentIntentId: string;
  amountVnd: number;
  correlationId?: string;
}
