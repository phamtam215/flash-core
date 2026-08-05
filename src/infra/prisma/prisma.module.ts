import { Global, Module } from '@nestjs/common';

import { PrismaService } from './prisma.service';

/**
 * `@Global()` vì gần như mọi module nghiệp vụ đều cần truy cập DB, và một `pg.Pool` duy
 * nhất cho cả app là điều bắt buộc — nếu mỗi module tự tạo pool riêng thì tổng số
 * connection sẽ nhân lên theo số module và vượt giới hạn của Postgres.
 *
 * Lưu ý ranh giới: global KHÔNG có nghĩa là module nghiệp vụ được tự do viết SQL khắp nơi.
 * Mọi truy cập Prisma phải nằm trong `<ten>.repository.ts` của module đó (xem skill
 * `nestjs-module`), để sau này đổi cách truy cập dữ liệu chỉ phải sửa một file mỗi module.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
