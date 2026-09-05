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

  // ── Phase 4: Async, Queue & Payment (spec: docs/specs/phase4-async-queue-payment.md) ───

  /**
   * Thời gian giữ chỗ của một đơn `PENDING`, tính bằng PHÚT.
   *
   * Phase 3 để hằng số 15 trong `order.service.ts`. Phase 4 kéo ra env vì integration test
   * cần rút xuống vài giây để kiểm chứng luồng tự huỷ — không có nó thì test phải chờ 15
   * phút thật, hoặc phải giả lập đồng hồ (phức tạp hơn và che mất bug thời gian thật).
   */
  ORDER_HOLD_MINUTES: z.coerce.number().positive().default(15),

  /**
   * Khoá ký webhook thanh toán. **Không có default** — thiếu là app chết lúc khởi động, cùng
   * lý do với JWT secret: một endpoint không cần đăng nhập mà khoá đoán được thì ai cũng
   * đánh dấu đơn của người khác là "đã trả tiền" được.
   */
  PAYMENT_WEBHOOK_SECRET: z.string().min(32, 'PAYMENT_WEBHOOK_SECRET cần tối thiểu 32 ký tự'),

  /**
   * Chữ ký cũ hơn ngần này GIÂY thì từ chối.
   *
   * Chống replay: chữ ký hợp lệ bắt được trên đường truyền sẽ hợp lệ mãi mãi nếu không có
   * mốc thời gian trong phần được ký. Ký `${t}.${rawBody}` rồi kiểm `|now - t|` là cách các
   * cổng thật (Stripe, GitHub) đang làm.
   */
  PAYMENT_WEBHOOK_TOLERANCE: z.coerce.number().int().positive().default(300),

  /** Số job một worker xử lý song song. */
  QUEUE_CONCURRENCY: z.coerce.number().int().positive().max(100).default(5),

  /**
   * Tiền tố khoá Redis của BullMQ.
   *
   * Vì sao phải là biến chứ không hằng số: mọi tiến trình nối cùng một Redis và cùng tiền tố
   * sẽ **chia nhau job**. Chuyện đó đúng với nhiều worker của cùng một hệ thống, nhưng sai
   * với integration test — worker đang chạy trên máy dev sẽ nuốt mất job của test, và test đỏ
   * với thông báo "không tìm thấy job" hoàn toàn không chỉ về nguyên nhân. Test đặt tiền tố
   * ngẫu nhiên để chạy trên Redis dùng chung mà vẫn cô lập.
   */
  QUEUE_PREFIX: z.string().min(1).default('bull'),

  /** Nhịp quét hộp thư đi, mili-giây. Nhỏ = email tới nhanh hơn, DB bị hỏi nhiều hơn. */
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),

  /** Số dòng outbox lấy mỗi vòng quét. */
  OUTBOX_BATCH_SIZE: z.coerce.number().int().positive().max(1000).default(50),

  // ── Phase 6: Observability (spec: docs/specs/phase6-observability.md) ──────────────────

  /**
   * Bật `GET /metrics`. Tắt được để **đo chi phí của chính việc đo** — thu thập metric mặc
   * định của Node (event loop lag, GC) không miễn phí, và trên free tier thì mọi mili-giây
   * đều tính.
   */
  METRICS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  /**
   * Sau khi nhận SIGTERM, chờ ngần này mili-giây rồi mới đóng app.
   *
   * Không phải chờ cho vui: `/ready` chuyển 503 ngay khi nhận tín hiệu, nhưng **load balancer
   * cần vài giây mới nhận ra** và ngừng gửi request mới. Đóng ngay lập tức là cắt ngang những
   * request vừa được gửi tới trong khe đó — đúng nguyên nhân của "deploy xong có vài đơn lỗi"
   * mà không ai lần ra được.
   */
  SHUTDOWN_GRACE_MS: z.coerce.number().int().nonnegative().max(60_000).default(5_000),
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
