import { Global, Module } from '@nestjs/common';

import { validateEnv, type Env } from './env.schema';

/**
 * Injection token cho object cấu hình đã validate.
 *
 * Dùng `Symbol` thay vì string để không thể trùng token với module khác một cách vô tình.
 */
export const ENV = Symbol('ENV');

/**
 * Cấu hình của app.
 *
 * Vì sao tự viết thay vì dùng `@nestjs/config`: ở đây chỉ cần đúng một việc — validate
 * `process.env` một lần rồi cung cấp một object đã đóng băng, có type đầy đủ. Tự viết mất
 * 10 dòng, đọc là hiểu, và tránh được phần typing generic khá rối của `ConfigService`.
 * Nếu về sau cần nhiều nguồn cấu hình (file, remote, per-environment) thì hãy xem lại
 * quyết định này bằng một ADR.
 *
 * `@Global()` vì gần như module nào cũng cần cấu hình — bắt mọi module import lại là
 * nhiễu vô ích. Đây là ngoại lệ có chủ đích với nguyên tắc "module phải khai báo rõ phụ
 * thuộc": cấu hình là hạ tầng, không phải nghiệp vụ.
 */
@Global()
@Module({
  providers: [
    {
      provide: ENV,
      useFactory: (): Env => validateEnv(),
    },
  ],
  exports: [ENV],
})
export class ConfigModule {}
