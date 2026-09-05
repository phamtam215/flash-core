import { Controller, Get } from '@nestjs/common';

import { NotReadyError } from './health.errors';
import { HealthService, type LivenessReport, type ReadinessReport } from './health.service';

@Controller()
export class HealthController {
  constructor(private readonly health: HealthService) {}

  @Get('health')
  liveness(): LivenessReport {
    return this.health.liveness();
  }

  @Get('ready')
  async readiness(): Promise<ReadinessReport> {
    const report = await this.health.readiness();

    if (!report.ready) {
      // Phải là 503 chứ không phải 200 kèm `ready: false`: load balancer đọc **status code**
      // để quyết định có gửi traffic hay không, nó không parse body.
      //
      // `NotReadyError` thay cho `ServiceUnavailableException` để lỗi này log ở mức `warn` —
      // xem `health.errors.ts`, đó là món nợ từ Phase 0 được trả ở đây.
      throw new NotReadyError(report.checks);
    }

    return report;
  }
}
