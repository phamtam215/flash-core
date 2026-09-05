import { Inject, Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

import { ENV, type Env } from '../../config';

/**
 * Nơi duy nhất định nghĩa metric của cả hệ thống.
 *
 * ### Luật cardinality — vi phạm là làm sập Prometheus
 *
 * Prometheus lưu **một chuỗi thời gian riêng cho mỗi tổ hợp nhãn**. Thêm `orderId` vào nhãn
 * nghĩa là mỗi đơn hàng sinh ra một chuỗi mới, và bộ nhớ tăng vô hạn theo lưu lượng. Vì vậy
 * nhãn ở đây **chỉ được nhận giá trị trong một tập đóng, biết trước**: tên route (mẫu, không
 * phải đường dẫn thật), status code, tên chiến lược, tên job.
 *
 * Muốn tra theo `orderId` thì đó là việc của **log** (`correlationId`), không phải của metric.
 * Hai công cụ trả lời hai câu khác nhau: metric nói *"đang có bao nhiêu, nhanh chậm ra sao"*,
 * log nói *"chuyện gì đã xảy ra với cái này"*.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  // ── Hạ tầng ──────────────────────────────────────────────────────────────────────────
  readonly httpRequests: Counter<'method' | 'route' | 'status'>;
  readonly httpDuration: Histogram<'method' | 'route'>;

  // ── Nghiệp vụ: phần đáng giá hơn ─────────────────────────────────────────────────────
  readonly ordersPlaced: Counter<'result'>;
  readonly reserveDuration: Histogram<'strategy'>;
  readonly outboxPending: Gauge<string>;
  readonly queueJobs: Counter<'job' | 'outcome'>;

  constructor(@Inject(ENV) env: Env) {
    // `process_*` và `nodejs_*`: RSS, event loop lag, số handle đang mở. Rẻ và thường là thứ
    // đầu tiên nhìn khi "app chậm mà không hiểu vì sao".
    if (env.METRICS_ENABLED) collectDefaultMetrics({ register: this.registry });

    this.httpRequests = new Counter({
      name: 'http_requests_total',
      help: 'Tổng số HTTP request theo method, route và status',
      labelNames: ['method', 'route', 'status'] as const,
      registers: [this.registry],
    });

    this.httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Thời gian xử lý HTTP request',
      labelNames: ['method', 'route'] as const,
      // Bucket chọn quanh vùng có ý nghĩa của dự án này: p95 của Phase 3 rơi vào 0,5–2 giây
      // tuỳ chiến lược, nên phải có đủ mốc trong khoảng đó mới đọc được biểu đồ.
      buckets: [0.005, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2, 5],
      registers: [this.registry],
    });

    this.ordersPlaced = new Counter({
      name: 'orders_placed_total',
      help: 'Số lần đặt đơn, tách theo KẾT QUẢ (created / out_of_stock / duplicate / sku_not_found)',
      labelNames: ['result'] as const,
      registers: [this.registry],
    });

    this.reserveDuration = new Histogram({
      name: 'inventory_reserve_duration_seconds',
      help: 'Thời gian trừ tồn kho, tách theo chiến lược — nối thẳng với benchmark Phase 3',
      labelNames: ['strategy'] as const,
      buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 2],
      registers: [this.registry],
    });

    this.outboxPending = new Gauge({
      name: 'outbox_pending',
      help: 'Số sự kiện đang chờ đẩy trong hộp thư đi — tăng đều nghĩa là relay đã chết',
      registers: [this.registry],
    });

    this.queueJobs = new Counter({
      name: 'queue_jobs_total',
      help: 'Số job đã xử lý theo tên job và kết quả',
      labelNames: ['job', 'outcome'] as const,
      registers: [this.registry],
    });
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }
}
