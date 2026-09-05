import { validateEnv } from './env.schema';

/**
 * Test cho việc validate cấu hình.
 *
 * Vì sao đáng test: đây là hàm quyết định app có khởi động được hay không. Nếu nó âm thầm
 * nhận giá trị sai (ví dụ `PORT="abc"` thành `NaN`), lỗi sẽ hiện ra ở một chỗ hoàn toàn
 * khác và rất khó truy — đúng kiểu bug tốn cả buổi.
 */
describe('validateEnv', () => {
  // Giá trị test, không phải secret thật — độ dài 32 chỉ để qua ràng buộc `min(32)`.
  const valid = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
    JWT_ACCESS_SECRET: 'a'.repeat(32),
    JWT_REFRESH_SECRET: 'b'.repeat(32),
    PAYMENT_WEBHOOK_SECRET: 'c'.repeat(32),
  };

  it('điền giá trị mặc định cho các biến không bắt buộc', () => {
    const env = validateEnv(valid);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.DATABASE_POOL_MAX).toBe(10);
    expect(env.INVENTORY_STRATEGY).toBe('optimistic');
    expect(env.ACCESS_TOKEN_TTL).toBe(900); // 15 phút
    expect(env.REFRESH_TOKEN_TTL).toBe(604800); // 7 ngày
    expect(env.LOGIN_RATE_LIMIT_MAX).toBe(5);
    expect(env.COOKIE_SECURE).toBe(false); // local dùng http

    // Phase 4
    expect(env.ORDER_HOLD_MINUTES).toBe(15);
    expect(env.PAYMENT_WEBHOOK_TOLERANCE).toBe(300);
    expect(env.QUEUE_CONCURRENCY).toBe(5);
    expect(env.OUTBOX_POLL_INTERVAL_MS).toBe(1000);
    expect(env.OUTBOX_BATCH_SIZE).toBe(50);
  });

  it('bắt buộc PAYMENT_WEBHOOK_SECRET — endpoint webhook không có auth nào khác', () => {
    const withoutSecret: Record<string, string> = { ...valid };
    delete withoutSecret.PAYMENT_WEBHOOK_SECRET;

    // Thiếu hẳn: app phải chết lúc khởi động, không được chạy với khoá rỗng — ai cũng ký
    // được webhook và đánh dấu đơn của người khác là "đã trả tiền".
    expect(() => validateEnv(withoutSecret)).toThrow(/PAYMENT_WEBHOOK_SECRET/);
    // Có nhưng quá ngắn cũng không được.
    expect(() => validateEnv({ ...valid, PAYMENT_WEBHOOK_SECRET: 'ngan' })).toThrow(
      /PAYMENT_WEBHOOK_SECRET/,
    );
  });

  it('ép COOKIE_SECURE từ chuỗi sang boolean', () => {
    // Không transform thì `COOKIE_SECURE="false"` là chuỗi khác rỗng → truthy → bật cờ
    // Secure ở local → browser vứt cookie đi và không ai hiểu vì sao login không giữ phiên.
    expect(validateEnv({ ...valid, COOKIE_SECURE: 'true' }).COOKIE_SECURE).toBe(true);
    expect(validateEnv({ ...valid, COOKIE_SECURE: 'false' }).COOKIE_SECURE).toBe(false);
  });

  it('từ chối JWT secret quá ngắn — khoá yếu là khoá đoán được', () => {
    expect(() => validateEnv({ ...valid, JWT_ACCESS_SECRET: 'ngan' })).toThrow(
      /JWT_ACCESS_SECRET/,
    );
  });

  it('ép PORT từ string sang number — vì mọi biến môi trường đều là string', () => {
    const env = validateEnv({ ...valid, PORT: '8080' });

    expect(env.PORT).toBe(8080);
    expect(typeof env.PORT).toBe('number');
  });

  it('báo lỗi kèm TÊN biến khi thiếu biến bắt buộc', () => {
    // Thông điệp lỗi phải chỉ đúng biến nào thiếu: người gặp lỗi này thường là người vừa
    // clone repo, họ cần biết sửa gì chứ không cần biết "config invalid".
    const thieuDatabaseUrl = { ...valid, DATABASE_URL: undefined };
    expect(() => validateEnv(thieuDatabaseUrl)).toThrow(/DATABASE_URL/);
  });

  it('từ chối giá trị không thuộc danh sách cho phép', () => {
    expect(() => validateEnv({ ...valid, INVENTORY_STRATEGY: 'magic' })).toThrow(
      /INVENTORY_STRATEGY/,
    );
    expect(() => validateEnv({ ...valid, PORT: 'abc' })).toThrow(/PORT/);
  });

  it('trả về object đã đóng băng — cấu hình không được sửa lúc runtime', () => {
    const env = validateEnv(valid);

    expect(Object.isFrozen(env)).toBe(true);
  });
});
