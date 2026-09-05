import { Global, Module } from '@nestjs/common';

import { MetricsController } from './metrics.controller';
import { MetricsInterceptor } from './metrics.interceptor';
import { MetricsService } from './metrics.service';

/**
 * `@Global` như các module hạ tầng khác: registry phải là MỘT instance cho cả app, nếu không
 * mỗi module đếm vào một sổ riêng và `/metrics` chỉ thấy một phần.
 *
 * Worker cũng import module này (không có controller nào chạy) để đếm `queue_jobs_total` và
 * `outbox_pending` — nhưng nó không phục vụ HTTP nên số đó chưa scrape được. Phase 7 quyết
 * cách lấy metric ra khỏi worker.
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService, MetricsInterceptor],
  exports: [MetricsService, MetricsInterceptor],
})
export class MetricsModule {}
