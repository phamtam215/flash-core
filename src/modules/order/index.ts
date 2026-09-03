/**
 * Public interface của module order.
 *
 * Chỉ export `OrderModule`. Ba reserver và `OrderRepository` là chi tiết nội bộ — module khác
 * không được gọi trực tiếp vào tồn kho (đó là điều kiện để nợ kỹ thuật trong ADR-003 không
 * lan ra). Phase 4 (payment webhook) sẽ cần đổi trạng thái đơn: lúc đó export một interface
 * hẹp cho đúng việc đó, không mở toang service.
 */
export { OrderModule } from './order.module';
