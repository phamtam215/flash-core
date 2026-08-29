import { Module } from '@nestjs/common';

import { AuthModule } from '../auth';
import { ProductController } from './product.controller';
import { ProductRepository } from './product.repository';
import { ProductService } from './product.service';

/**
 * Import `AuthModule` (không import sâu vào `auth/access-token.guard`) để dùng
 * `AccessTokenGuard` cho các route ghi — đúng luật "chỉ nói chuyện qua public interface"
 * (docs/architecture.md §Ba quy tắc cấu trúc).
 *
 * Không export gì: chưa module nào khác (Phase 3: order) cần import module này — khi cần,
 * thêm export có chủ đích vào `index.ts`, không mở toang.
 */
@Module({
  imports: [AuthModule],
  controllers: [ProductController],
  providers: [ProductService, ProductRepository],
})
export class ProductModule {}
