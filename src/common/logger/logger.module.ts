import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { Module, type MiddlewareConsumer, type NestModule } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule, type Params } from 'nestjs-pino';

import { ConfigModule, ENV, type Env } from '../../config';
import { getCorrelationId, runWithCorrelationId } from '../correlation';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Structured logging bằng Pino, mọi dòng log kèm `correlationId`.
 *
 * `genReqId` là trái tim của module này: nó nhận correlation id từ header nếu client (hoặc
 * service gọi trước) đã có, còn không thì sinh mới. Nhờ vậy một request đi qua nhiều thành
 * phần vẫn giữ cùng một id — điều kiện để đạt deliverable của Phase 6: *từ một request lỗi
 * bất kỳ, truy toàn bộ hành trình bằng một correlationId*.
 *
 * Id cũng được ghi vào response header, để khi user báo lỗi họ có thể đưa lại đúng id đó.
 *
 * **Phase 6 đã trả món nợ ghi ở đây từ Phase 0**: id không còn chết ở biên HTTP nữa. Nó được
 * nạp vào một `AsyncLocalStorage` (xem `common/correlation/`) ngay ở middleware, và `mixin`
 * bên dưới đọc store đó để gắn `correlationId` vào **mọi** dòng log — kể cả log phát ra từ
 * worker, nơi không có `req` nào cả.
 *
 * Nhờ vậy không service nào phải tự truyền id đi, và cũng không service nào có thể *quên*
 * truyền. Chỉ có đúng hai chỗ nạp store: middleware ở đây, và `JobProcessor` bên worker.
 */
@Module({
  imports: [
    PinoLoggerModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ENV],
      useFactory: (env: Env): Params => ({
        pinoHttp: {
          level: env.LOG_LEVEL,

          genReqId: (req: IncomingMessage, res: ServerResponse): string => {
            const incoming = req.headers[CORRELATION_ID_HEADER];
            const id =
              typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
            res.setHeader(CORRELATION_ID_HEADER, id);
            return id;
          },

          /**
           * Gắn `correlationId` vào MỌI dòng log, lấy từ `AsyncLocalStorage`.
           *
           * Khác với `req.id` (chỉ có ở log của pino-http), mixin chạy cho cả những dòng do
           * `Logger` của Nest phát ra từ sâu trong service — và cả những dòng phát ra trong
           * worker, nơi không tồn tại request nào.
           *
           * Trả object rỗng khi ở ngoài mọi luồng (ví dụ log lúc khởi động) là ĐÚNG: id giả
           * không nối được với gì, chỉ làm nhiễu khi tra log.
           */
          mixin: (): Record<string, string> => {
            const correlationId = getCorrelationId();
            return correlationId ? { correlationId } : {};
          },

          // CLAUDE.md: không log dữ liệu nhạy cảm. Redact ở tầng logger chứ không dựa vào
          // việc "nhớ đừng log" ở từng chỗ gọi — cách sau chắc chắn sẽ hỏng ở lần thứ n.
          redact: {
            paths: [
              'req.headers.authorization',
              'req.headers.cookie',
              'res.headers["set-cookie"]',
              '*.password',
              '*.passwordHash',
              '*.token',
              '*.accessToken',
              '*.refreshToken',
              '*.cardNumber',
              '*.cvv',
            ],
            censor: '[REDACTED]',
          },

          // Production: JSON một dòng ra stdout (12-Factor App — log là stream, không phải
          // file). Local: pino-pretty cho dễ đọc. Không dùng pretty ở production vì nó tốn
          // CPU và làm log không parse được bằng máy.
          ...(env.NODE_ENV === 'production'
            ? {}
            : {
                transport: {
                  target: 'pino-pretty',
                  options: { singleLine: true, translateTime: 'HH:MM:ss.l' },
                },
              }),
        },
      }),
    }),
  ],
})
export class LoggerModule implements NestModule {
  /**
   * Middleware nạp `correlationId` vào store cho toàn bộ phần còn lại của request.
   *
   * **Phải chạy sớm nhất có thể** — mọi thứ nằm ngoài `run()` sẽ log mà không có id. Nest gọi
   * middleware theo thứ tự đăng ký và trước mọi guard/interceptor/controller, nên đăng ký ở
   * module gốc của log là đủ sớm.
   *
   * `req.id` do `genReqId` ở trên sinh ra và đã chạy trước (pino-http là middleware của chính
   * nó, được nestjs-pino cài ở tầng thấp hơn) — ở đây chỉ việc đọc lại, không sinh id thứ hai.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply((req: IncomingMessage & { id?: string }, _res: ServerResponse, next: () => void) => {
        runWithCorrelationId(typeof req.id === 'string' ? req.id : undefined, next);
      })
      .forRoutes('*');
  }
}
