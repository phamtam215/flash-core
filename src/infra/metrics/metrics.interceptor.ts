import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { Response } from 'express';
import type { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';

import { MetricsService } from './metrics.service';

/**
 * Đếm mọi HTTP request. Chỉ đo thứ interceptor **biết được**: method, route, status, thời gian.
 *
 * Metric nghiệp vụ (vì sao đơn bị từ chối) KHÔNG đặt ở đây — interceptor chỉ thấy `409`, nó
 * không biết `409` đó là "hết hàng" hay "trạng thái đơn sai". Đếm ở nơi biết lý do, tức là
 * trong service (spec Phase 6, câu hỏi mở #4).
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();

    const http = context.switchToHttp();
    // Kiểu thu hẹp bằng tay: `express.Request` khai `route` là `any`, và ESLint của dự án
    // chặn mọi thao tác trên `any` (đúng — `any` là chỗ bug lọt qua typecheck).
    const request = http.getRequest<{ method: string; route?: { path?: string } }>();
    const response = http.getResponse<Response>();
    const endTimer = this.metrics.httpDuration.startTimer();

    const record = (): void => {
      // `route.path` là MẪU route (`/orders/:id`), không phải đường dẫn thật
      // (`/orders/9722...`). Dùng `request.url` ở đây là mỗi đơn hàng sinh một chuỗi thời gian
      // mới — cách làm sập Prometheus nhanh nhất (xem luật cardinality ở MetricsService).
      const route = request.route?.path ?? 'unmatched';
      const method = request.method;

      endTimer({ method, route });
      this.metrics.httpRequests.inc({ method, route, status: String(response.statusCode) });
    };

    // `tap` với cả hai nhánh: request lỗi cũng phải được đếm, nếu không tỉ lệ lỗi luôn bằng 0
    // — đúng kiểu metric nhìn thì đẹp mà vô dụng.
    return next.handle().pipe(tap({ next: record, error: record }));
  }
}
