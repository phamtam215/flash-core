/**
 * Điểm khởi đầu của ứng dụng NestJS.
 * File này tạo và khởi chạy server HTTP sử dụng framework NestJS.
 * Ứng dụng sẽ listen trên port được chỉ định (mặc định 3000).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  // Tạo instance của ứng dụng NestJS từ AppModule
  const app = await NestFactory.create(AppModule);
  // Lắng nghe trên port từ biến môi trường PORT hoặc 3000
  await app.listen(process.env.PORT ?? 3000);
}

// Gọi hàm bootstrap để khởi chạy ứng dụng
bootstrap();
