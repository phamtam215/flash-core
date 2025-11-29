/**
 * Module chính của ứng dụng NestJS.
 * Đây là nơi định nghĩa các controller (xử lý request HTTP),
 * providers (các service cung cấp logic nghiệp vụ),
 * và import các module khác như DatabaseModule.
 * AppModule là điểm khởi đầu để NestJS biết cấu trúc ứng dụng.
 */
import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { DatabaseModule } from './database/database.module';

@Module({
  imports: [DatabaseModule], // Import module database để sử dụng Prisma
  controllers: [AppController], // Đăng ký controller để xử lý các route
  providers: [AppService], // Đăng ký service để cung cấp logic nghiệp vụ
})
export class AppModule {}
