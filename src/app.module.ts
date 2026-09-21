import { type MiddlewareConsumer, Module, type NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';

import { AppController } from './app.controller';
import { AllExceptionsFilter, CsrfGuard, CsrfIssueMiddleware, LoggerModule } from './common';
import { ConfigModule } from './config';
import { MetricsModule } from './infra/metrics';
import { PrismaModule } from './infra/prisma';
import { QueueModule } from './infra/queue';
import { RedisModule } from './infra/redis';
import { AuthModule } from './modules/auth';
import { HealthModule } from './modules/health';
import { MailModule } from './modules/mail';
import { OrderModule } from './modules/order';
import { OutboxModule } from './modules/outbox';
import { PaymentModule } from './modules/payment';
import { ProductModule } from './modules/product';

/**
 * Module gốc.
 *
 * Thứ tự import phản ánh thứ tự phụ thuộc: cấu hình → log → hạ tầng → nghiệp vụ.
 * Module nghiệp vụ (`modules/*`) không bao giờ được import chéo nhau ở đây — nếu hai module
 * cần nói chuyện, chúng đi qua public interface trong `index.ts` của nhau (xem skill
 * `nestjs-module`). Đó là thứ duy nhất khiến "Modular Monolith" khác "monolith".
 */
@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    MetricsModule,
    AuthModule,
    ProductModule,
    MailModule,
    OutboxModule,
    OrderModule,
    PaymentModule,
    HealthModule,
  ],
  // Controller duy nhất ở tầng app: trả trang demo Phase 5. Mọi thứ khác thuộc về module.
  controllers: [AppController],
  providers: [
    // Đăng ký filter ở tầng app thay vì bọc từng controller: một hình dạng lỗi cho toàn hệ
    // thống, và không thể quên áp dụng cho endpoint mới.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    // Chặn CSRF ở tầng app chứ không gắn từng controller — **fail-closed**: endpoint ghi mới
    // được bảo vệ sẵn kể cả khi người thêm nó không nghĩ tới CSRF. Cách ngược lại thì quên =
    // lộ, và không test nào bắt được vì mọi test vẫn xanh. Chi tiết: ADR-009.
    { provide: APP_GUARD, useClass: CsrfGuard },
    CsrfIssueMiddleware,
  ],
})
export class AppModule implements NestModule {
  /** Phát cookie CSRF cho mọi response chưa có — kể cả `GET /` (trang tĩnh). */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CsrfIssueMiddleware).forRoutes('*');
  }
}
