/**
 * Cửa hẹp cho module `payment` đổi trạng thái tiền của một đơn.
 *
 * Phase 3 đã ghi trước ý này trong `order/index.ts`: *"Phase 4 sẽ cần đổi trạng thái đơn: lúc
 * đó export một interface hẹp cho đúng việc đó, không mở toang service."* Đây là interface
 * đó — `payment` không biết bảng `orders` tồn tại, chỉ biết "báo cho order rằng tiền đã vào,
 * rồi nhận về kết quả".
 *
 * Vì sao `order` giữ luôn việc ghi `refund_requests` thay vì để `payment` ghi: đó là trạng
 * thái **tiền của một đơn**, khoá ngoại trỏ vào `orders`, và nó phải nằm cùng transaction với
 * quyết định "không đánh dấu PAID". Chia đôi thì lại đúng dual write mà cả phase đang chống.
 */
export type SettlementOutcome =
  /** Chuyển `PENDING` → `PAID` thành công. */
  | { kind: 'PAID' }
  /** Sự kiện này (hoặc đơn này) đã xử lý trước rồi — không làm gì thêm, vẫn trả 2xx. */
  | { kind: 'ALREADY_HANDLED' }
  /** Tiền đã vào nhưng đơn không nhận được. Đã ghi `refund_requests`. */
  | { kind: 'REFUND_REQUIRED'; reason: 'ORDER_ALREADY_CANCELLED' | 'AMOUNT_MISMATCH' }
  /** `orderId` trong webhook không tồn tại — dữ liệu lạ, phải log để người xem. */
  | { kind: 'ORDER_NOT_FOUND' };

export interface SettlePaymentInput {
  /** Id sự kiện của cổng — khoá idempotent. */
  eventId: string;
  orderId: string;
  paymentIntentId: string;
  amountVnd: number;
  correlationId?: string;
}

export interface OrderPayments {
  settle(input: SettlePaymentInput): Promise<SettlementOutcome>;
}

export const ORDER_PAYMENTS = Symbol('ORDER_PAYMENTS');
