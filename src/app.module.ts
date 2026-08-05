import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';

import { AllExceptionsFilter, LoggerModule } from './common';
import { ConfigModule } from './config';
import { PrismaModule } from './infra/prisma';
import { HealthModule } from './modules/health';

/**
 * Module gốc.
 *
 * Thứ tự import phản ánh thứ tự phụ thuộc: cấu hình → log → hạ tầng → nghiệp vụ.
 * Module nghiệp vụ (`modules/*`) không bao giờ được import chéo nhau ở đây — nếu hai module
 * cần nói chuyện, chúng đi qua public interface trong `index.ts` của nhau (xem skill
 * `nestjs-module`). Đó là thứ duy nhất khiến "Modular Monolith" khác "monolith".
 */
@Module({
  imports: [ConfigModule, LoggerModule, PrismaModule, HealthModule],
  providers: [
    // Đăng ký filter ở tầng app thay vì bọc từng controller: một hình dạng lỗi cho toàn hệ
    // thống, và không thể quên áp dụng cho endpoint mới.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
