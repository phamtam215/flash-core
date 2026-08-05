import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { DomainError } from '../errors/domain.error';

/**
 * Ngưỡng phân loại lỗi: từ 500 trở lên là lỗi hệ thống (log mức error, cần người xem),
 * dưới 500 là lỗi client hoặc trạng thái nghiệp vụ (log mức warn, không cần báo động).
 */
const SERVER_ERROR_FROM = 500;

interface ErrorBody {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Exception filter thống nhất cho toàn app.
 *
 * Ba việc nó làm, và vì sao mỗi việc quan trọng:
 *
 * 1. **Một hình dạng response lỗi duy nhất** (`code` + `message` + `correlationId`).
 *    Không có nó, mỗi controller sẽ tự bịa format và client phải xử lý n kiểu lỗi.
 *
 * 2. **Phân loại 4xx vs 5xx cho đúng.** Lỗi do client gửi sai hoặc do trạng thái nghiệp vụ
 *    (hết hàng) là 4xx và KHÔNG cần cảnh báo ai. Lỗi do hệ thống là 5xx và phải log ở mức
 *    error. Trộn hai loại này làm error rate trong báo cáo k6 trở nên vô nghĩa — đó là một
 *    trong ba kết luận sai kinh điển khi đọc benchmark ở Phase 3.
 *
 * 3. **Không rò rỉ chi tiết nội bộ ra ngoài.** Với 5xx, client chỉ nhận `correlationId`;
 *    stack trace và message thật nằm trong log. Client không cần biết tên bảng của mình.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { id?: string }>();

    // `id` do nestjs-pino sinh ra ở genReqId (xem common/logger/logger.module.ts) — chính
    // là correlationId dùng để nối log của request này lại với nhau.
    const correlationId = request.id;
    const { status, body } = this.describe(exception);

    if (status >= SERVER_ERROR_FROM) {
      this.logger.error(
        { err: exception, correlationId, method: request.method, path: request.url },
        'Lỗi hệ thống chưa được xử lý',
      );
    } else {
      this.logger.warn(
        { code: body.code, correlationId, method: request.method, path: request.url },
        body.message,
      );
    }

    response.status(status).json({ ...body, correlationId });
  }

  private describe(exception: unknown): { status: number; body: ErrorBody } {
    if (exception instanceof DomainError) {
      return {
        status: exception.httpStatus,
        body: {
          code: exception.code,
          message: exception.message,
          ...(exception.details ? { details: exception.details } : {}),
        },
      };
    }

    if (exception instanceof HttpException) {
      const payload = exception.getResponse();
      const base = typeof payload === 'string' ? { message: payload } : payload;
      return {
        status: exception.getStatus(),
        body: { code: 'HTTP_ERROR', message: exception.message, ...base },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        code: 'INTERNAL_ERROR',
        message: 'Lỗi hệ thống. Gửi correlationId cho quản trị viên để tra log.',
      },
    };
  }
}
