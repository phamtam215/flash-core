import { Module } from '@nestjs/common';

import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  controllers: [HealthController],
  providers: [HealthService],
  // Không export HealthService: không module nào cần gọi nó. Chỉ export thứ thật sự có
  // người dùng — export "cho chắc" là cách ranh giới module bị xói mòn dần.
})
export class HealthModule {}
