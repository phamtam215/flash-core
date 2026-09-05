/**
 * Public interface của module order.
 *
 * Ba reserver, `OrderService` và `OrderRepository` là chi tiết nội bộ — module khác không
 * được gọi trực tiếp vào tồn kho (đó là điều kiện để nợ kỹ thuật trong ADR-003 không lan ra).
 *
 * Phase 4 mở đúng một cửa hẹp như đã hẹn: `ORDER_PAYMENTS` để module `payment` báo "tiền đã
 * vào" và nhận về kết quả. `payment` không biết bảng `orders` tồn tại.
 *
 * `OrderExpiryService` và `OrderNotifier` được `OrderModule` export cho **worker** (cùng
 * repo, tầng trên `modules/`), không dành cho module nghiệp vụ khác gọi.
 */
export { OrderModule } from './order.module';
export { OrderExpiryService } from './order.expiry.service';
export { OrderNotifier } from './order.notifier';
export {
  ORDER_PAYMENTS,
  type OrderPayments,
  type SettlementOutcome,
  type SettlePaymentInput,
} from './order-payments';
