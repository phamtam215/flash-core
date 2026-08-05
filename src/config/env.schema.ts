import { z } from 'zod';

/**
 * Schema của biến môi trường.
 *
 * Vì sao validate bằng Zod ngay lúc khởi động: nếu thiếu `DATABASE_URL`, mình muốn app
 * chết ngay khi `npm run dev` — không phải chết lúc 3h sáng khi request đầu tiên chạm tới
 * DB. Lỗi cấu hình phải nổ càng sớm và càng ồn càng tốt.
 *
 * `z.coerce.number()` vì mọi biến môi trường đều là string — không coerce thì `PORT` sẽ là
 * `"3000"` và `app.listen("3000")` vẫn chạy, nhưng phép so sánh số ở nơi khác thì sai.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL là bắt buộc — xem .env.example'),

  /**
   * Số connection tối đa của `pg.Pool`.
   *
   * Đây không phải con số vô hại: mỗi transaction đang CHỜ khóa (chiến lược pessimistic ở
   * Phase 3) vẫn giữ một connection. Pool quá nhỏ thì request fail vì "hết pool" — một
   * nguyên nhân hoàn toàn khác với "lock contention" nhưng triệu chứng giống nhau. Để nó
   * thành biến cấu hình để benchmark phân biệt được hai nguyên nhân đó.
   */
  DATABASE_POOL_MAX: z.coerce.number().int().positive().max(500).default(10),

  REDIS_URL: z.string().min(1, 'REDIS_URL là bắt buộc — xem .env.example'),

  /**
   * Chiến lược chống oversell (Phase 3). Ba implementation cùng một interface, đổi bằng
   * env để benchmark so sánh được công bằng.
   * Giá trị mặc định cho production sẽ được chốt bằng ADR SAU khi có số đo k6.
   */
  INVENTORY_STRATEGY: z.enum(['optimistic', 'pessimistic', 'redis']).default('optimistic'),
});

export type Env = Readonly<z.infer<typeof envSchema>>;

/**
 * Đọc và validate biến môi trường. Throw kèm danh sách field lỗi — không throw kiểu
 * "invalid config" chung chung, vì lỗi cấu hình thường xảy ra với người vừa clone repo và
 * họ cần biết CHÍNH XÁC biến nào thiếu.
 */
export function validateEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);

  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Cấu hình môi trường không hợp lệ:\n${details}\n\nĐối chiếu .env.example.`);
  }

  return Object.freeze(parsed.data);
}
