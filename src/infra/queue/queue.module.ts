import { Global, Module } from '@nestjs/common';

import { QueueService } from './queue.service';

/**
 * `@Global()` theo đúng khuôn của `PrismaModule`/`RedisModule`: một kết nối cho cả app.
 *
 * Ranh giới vẫn giữ: global nghĩa là *inject được ở mọi nơi*, không có nghĩa là *nên* đẩy
 * job ở mọi nơi. Trong Phase 4 chỉ ba chỗ được đẩy: outbox relay, `OrderService` (hẹn giờ
 * huỷ đơn) và `PaymentController` (webhook).
 */
@Global()
@Module({
  providers: [QueueService],
  exports: [QueueService],
})
export class QueueModule {}
