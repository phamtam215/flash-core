// `dotenv/config` phải là import ĐẦU TIÊN: nó nạp .env vào process.env, và validateEnv()
// (chạy khi Nest khởi tạo ConfigModule) đọc process.env. Đảo thứ tự là app sẽ báo thiếu
// biến môi trường dù .env có đủ.
import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { ENV, type Env } from './config';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    // Giữ log lại trong buffer tới khi logger Pino sẵn sàng, để không mất log lúc khởi động
    // (giai đoạn hay xảy ra lỗi cấu hình nhất).
    bufferLogs: true,
  });

  app.useLogger(app.get(Logger));

  // Bắt SIGTERM/SIGINT để chạy onModuleDestroy (đóng pool Postgres, sau này là chờ job
  // BullMQ xong). Không bật thì lúc Cloud Run thay revision, connection và job đang chạy
  // sẽ bị cắt giữa chừng — đúng câu hỏi bản chất của Phase 5.
  app.enableShutdownHooks();

  const env = app.get<Env>(ENV);
  await app.listen(env.PORT, '0.0.0.0');

  app.get(Logger).log(`Flash-Core đang chạy tại http://localhost:${env.PORT} (${env.NODE_ENV})`);
}

void bootstrap();
