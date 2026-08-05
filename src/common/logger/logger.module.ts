import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

import { Module } from '@nestjs/common';
import { LoggerModule as PinoLoggerModule, type Params } from 'nestjs-pino';

import { ConfigModule, ENV, type Env } from '../../config';

export const CORRELATION_ID_HEADER = 'x-correlation-id';

/**
 * Structured logging bằng Pino, mọi dòng log kèm `correlationId`.
 *
 * `genReqId` là trái tim của module này: nó nhận correlation id từ header nếu client (hoặc
 * service gọi trước) đã có, còn không thì sinh mới. Nhờ vậy một request đi qua nhiều thành
 * phần vẫn giữ cùng một id — điều kiện để đạt deliverable của Phase 5: *từ một request lỗi
 * bất kỳ, truy toàn bộ hành trình bằng một correlationId*.
 *
 * Id cũng được ghi vào response header, để khi user báo lỗi họ có thể đưa lại đúng id đó.
 *
 * Nợ kỹ thuật đã biết: id hiện chỉ có trong phạm vi HTTP request (`req.id`). Khi Phase 4
 * đẩy job vào BullMQ, id phải được nhét vào payload job để worker log cùng id — hoặc dùng
 * AsyncLocalStorage cho gọn. Chưa làm ở Phase 0 vì chưa có queue.
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
export class LoggerModule {}
