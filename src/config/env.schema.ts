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

  // ── Phase 1: Auth (spec: docs/specs/phase1-auth.md) ────────────────────────────────────

  /**
   * Khoá ký JWT. **Không có giá trị mặc định** — cố tình để app chết lúc khởi động nếu
   * thiếu, thay vì âm thầm chạy với một khoá ai cũng đoán được.
   *
   * Hai khoá RIÊNG cho access và refresh: nếu dùng chung một khoá, một access token hết hạn
   * vẫn có chữ ký hợp lệ và có thể bị đem đi giả làm refresh token. Tách khoá thì token loại
   * này không bao giờ verify được ở loại kia.
   *
   * Sinh khoá: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
   */
  JWT_ACCESS_SECRET: z.string().min(32, 'JWT_ACCESS_SECRET cần tối thiểu 32 ký tự'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET cần tối thiểu 32 ký tự'),

  /**
   * Tuổi thọ token, tính bằng GIÂY.
   *
   * Access token ngắn (15 phút) vì nó **không thu hồi được** — còn hạn là còn dùng được, kể
   * cả sau khi user logout. Rút ngắn là cách duy nhất giới hạn thiệt hại khi bị đánh cắp.
   * Refresh token dài (7 ngày) nhưng thu hồi được vì có bản ghi trong DB.
   */
  ACCESS_TOKEN_TTL: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL: z.coerce.number().int().positive().default(604800),

  /**
   * Rate limit đăng nhập: tối đa bao nhiêu lần sai trong bao nhiêu giây.
   * Đếm ở Redis chứ không trong RAM — nhiều instance thì đếm RAM sai ngay (spec §Quyết định 1).
   */
  LOGIN_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(5),
  LOGIN_RATE_LIMIT_WINDOW: z.coerce.number().int().positive().default(60),

  /**
   * Bật cờ `Secure` cho cookie (chỉ gửi qua HTTPS).
   * Local chạy http://localhost nên phải TẮT, không thì browser vứt cookie đi.
   * Production bắt buộc BẬT — không có nó thì token bay qua mạng ở dạng thô.
   */
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
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
