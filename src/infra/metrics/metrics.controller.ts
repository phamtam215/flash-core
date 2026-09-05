import { Controller, Get, Header, Inject, NotFoundException } from '@nestjs/common';

import { ENV, type Env } from '../../config';
import { MetricsService } from './metrics.service';

/**
 * `GET /metrics` — định dạng text của Prometheus.
 *
 * **Không có auth** (spec Phase 6, câu hỏi mở #2): metric ở đây không chứa dữ liệu cá nhân vì
 * luật cardinality cấm nhãn tự do, và ở Phase 7 Cloud Run sẽ chặn bằng ingress chứ không bằng
 * token. Thêm một khoá nữa phải quản mà chưa chống được mối đe doạ có thật là nợ, không phải
 * bảo mật. Ghi ra đây để không ai tưởng là quên.
 */
@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: MetricsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Get()
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async scrape(): Promise<string> {
    // Tắt metrics thì endpoint phải BIẾN MẤT, không phải trả trang rỗng: trang rỗng khiến
    // Prometheus tưởng scrape thành công với 0 metric, và biểu đồ tụt về 0 như thể hệ thống
    // ngừng hoạt động.
    if (!this.env.METRICS_ENABLED) throw new NotFoundException();
    return this.metrics.render();
  }
}
