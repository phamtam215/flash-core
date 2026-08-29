import { Module } from '@nestjs/common';

import { AccessTokenGuard, AuthModule } from '../auth';
import { ProductController } from './product.controller';
import { ProductRepository } from './product.repository';
import { ProductService } from './product.service';

/**
 * Import `AuthModule` (không import sâu vào `auth/access-token.guard`) để dùng
 * `AccessTokenGuard` cho các route ghi — đúng luật "chỉ nói chuyện qua public interface"
 * (docs/architecture.md §Ba quy tắc cấu trúc).
 *
 * `AccessTokenGuard` PHẢI có mặt ở `providers` của CHÍNH module này, không chỉ nằm trong
 * `AuthModule` dù đã export. Lý do (phát hiện thật khi chạy `npm run test:int`):
 * `@UseGuards(SomeClass)` không tái dùng instance đã dựng sẵn ở module gốc như constructor
 * injection thường — `GuardsContextCreator.getInstanceByMetatype` (nguồn `@nestjs/core`) chỉ
 * tra trong `injectables` của MODULE CHỨA CONTROLLER (ở đây là `ProductModule`), không đi
 * qua `imports`/`exports`. Thiếu dòng này thì Nest tự dựng lại `AccessTokenGuard` ở đây và
 * báo không tìm thấy `JwtService` — đó là lý do `AuthModule` cũng phải export `JwtModule`
 * (xem `auth.module.ts`), để `JwtService` resolve được ngay tại `ProductModule`.
 *
 * Không export gì: chưa module nào khác (Phase 3: order) cần import module này — khi cần,
 * thêm export có chủ đích vào `index.ts`, không mở toang.
 */
@Module({
  imports: [AuthModule],
  controllers: [ProductController],
  providers: [ProductService, ProductRepository, AccessTokenGuard],
})
export class ProductModule {}
