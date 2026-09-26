/**
 * Public interface của module sale-event.
 *
 * `SaleEventRepository` cố tình KHÔNG export: module `order` cần trừ tồn kho của đợt, nhưng
 * nó làm việc đó qua `order.repository.ts` — cùng ranh giới mà ADR-003 đã chốt cho
 * `product_skus`. Mở repository ra là mở toang ba bảng cho mọi module ghi.
 */
export { SaleEventModule } from './sale-event.module';
export { SaleEventService } from './sale-event.service';
export { saleEventStatus, type SaleEventStatus } from './sale-event.dto';
