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

    // `DomainError` được tự khai mức log của mình; còn lại suy từ status. Nhờ vậy 503 của
    // readiness (sự cố vận hành bình thường) không nhuộm `error` vào log, trong khi 500 thật
    // vẫn `error` — xem `DomainError.logLevel`.
    const level =
      exception instanceof DomainError
        ? exception.logLevel
        : status >= SERVER_ERROR_FROM
          ? 'error'
          : 'warn';

    if (level === 'error') {
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

    /**
     * Lỗi của `body-parser` **không** phải `HttpException`, nên nếu không bắt riêng thì nó
     * rơi xuống nhánh cuối và thành `500` — báo với client rằng *server hỏng*, trong khi thật
     * ra **client gửi sai**.
     *
     * Gặp thật ngay lần chạy test đầu tiên sau khi đặt `json({ limit: '32kb' })` ở Phase 9:
     * body 64kb trả `500` thay vì `413`. Hai hệ quả, cái thứ hai tệ hơn:
     *
     * 1. Client không biết phải sửa gì (413 nói "gửi nhỏ lại", 500 không nói gì).
     * 2. Nó được log ở mức `error` ⇒ ai đó gửi body to liên tục là tự tạo ra một trận bão
     *    cảnh báo, và cảnh báo kêu sai vài lần là người ta tắt tiếng nó.
     *
     * `type` là trường riêng của `body-parser` (`entity.too.large`, `entity.parse.failed`...),
     * và `status` nó gắn sẵn đã đúng — chỉ cần chuyển tiếp thay vì nuốt.
     */
    const parserError = asBodyParserError(exception);
    if (parserError) {
      return {
        status: parserError.status,
        body: { code: parserError.code, message: parserError.message },
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

/**
 * Nhận diện lỗi "body quá lớn" do `body-parser` ném ra. Nó không kế thừa `HttpException` nên
 * phải soi trường.
 *
 * Không bắt bừa mọi thứ có `status`: bắt rộng quá thì một lỗi hệ thống tình cờ có trường
 * `status` sẽ bị hạ xuống thành lỗi của client, và lúc đó `500` thật bị giấu mất.
 */
function asBodyParserError(
  exception: unknown,
): { status: number; code: string; message: string } | null {
  if (typeof exception !== 'object' || exception === null) return null;

  const { type, status } = exception as { type?: unknown; status?: unknown };
  if (typeof status !== 'number') return null;

  if (type === 'entity.too.large') {
    return {
      status: HttpStatus.PAYLOAD_TOO_LARGE,
      code: 'PAYLOAD_TOO_LARGE',
      message: 'Nội dung gửi lên quá lớn.',
    };
  }
  // CỐ Ý chỉ nhận `entity.too.large`. Lỗi JSON hỏng (`entity.parse.failed`) đã được Nest bọc
  // thành `HttpException` 400 trước khi tới đây, nên một nhánh cho nó sẽ là **code chết** —
  // đã thử và xác nhận bằng test 6c. Code chết tệ hơn không có code: nó làm người đọc tin
  // rằng đường đó đang chạy.
  return null;
}
