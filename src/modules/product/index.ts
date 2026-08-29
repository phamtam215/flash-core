/**
 * Public interface của module product.
 *
 * Chưa module nào khác cần import từ đây (Phase 3 — order — sẽ cần đọc giá/tồn kho SKU, lúc
 * đó export thêm có chủ đích, không mở toang). `ProductService`/`ProductRepository` cố tình
 * không export — chi tiết nội bộ, ESLint chặn nếu ai đó import sâu vào trong.
 */
export { ProductModule } from './product.module';
