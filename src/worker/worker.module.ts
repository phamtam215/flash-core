import { Module } from '@nestjs/common';

import { LoggerModule } from '../common';
import { ConfigModule } from '../config';
import { PrismaModule } from '../infra/prisma';
import { QueueModule } from '../infra/queue';
import { RedisModule } from '../infra/redis';
import { MailModule } from '../modules/mail';
import { OrderModule } from '../modules/order';
import { OutboxModule } from '../modules/outbox';
import { PaymentModule } from '../modules/payment';
import { JobProcessor } from './job.processor';

/**
 * Cây phụ thuộc của **worker** — song song với `AppModule`, không phải con của nó.
 *
 * Cố ý KHÔNG import `HealthModule`/`ProductModule`: worker không phục vụ HTTP nên không cần
 * controller nào. Nó vẫn nạp `OrderModule`/`PaymentModule` vì cần service của chúng — và đó
 * là lý do hai module đó export service qua `index.ts` thay vì giấu hết.
 *
 * `AllExceptionsFilter` không đăng ký ở đây: filter là khái niệm của tầng HTTP. Lỗi trong
 * worker do BullMQ bắt (retry, rồi vào DLQ) — xem `JobProcessor`.
 */
@Module({
  imports: [
    ConfigModule,
    LoggerModule,
    PrismaModule,
    RedisModule,
    QueueModule,
    MailModule,
    OutboxModule,
    OrderModule,
    PaymentModule,
  ],
  providers: [JobProcessor],
})
export class WorkerModule {}
