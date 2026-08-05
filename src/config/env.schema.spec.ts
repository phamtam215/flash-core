import { validateEnv } from './env.schema';

/**
 * Test cho việc validate cấu hình.
 *
 * Vì sao đáng test: đây là hàm quyết định app có khởi động được hay không. Nếu nó âm thầm
 * nhận giá trị sai (ví dụ `PORT="abc"` thành `NaN`), lỗi sẽ hiện ra ở một chỗ hoàn toàn
 * khác và rất khó truy — đúng kiểu bug tốn cả buổi.
 */
describe('validateEnv', () => {
  const valid = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/db',
    REDIS_URL: 'redis://localhost:6379',
  };

  it('điền giá trị mặc định cho các biến không bắt buộc', () => {
    const env = validateEnv(valid);

    expect(env.NODE_ENV).toBe('development');
    expect(env.PORT).toBe(3000);
    expect(env.LOG_LEVEL).toBe('info');
    expect(env.DATABASE_POOL_MAX).toBe(10);
    expect(env.INVENTORY_STRATEGY).toBe('optimistic');
  });

  it('ép PORT từ string sang number — vì mọi biến môi trường đều là string', () => {
    const env = validateEnv({ ...valid, PORT: '8080' });

    expect(env.PORT).toBe(8080);
    expect(typeof env.PORT).toBe('number');
  });

  it('báo lỗi kèm TÊN biến khi thiếu biến bắt buộc', () => {
    // Thông điệp lỗi phải chỉ đúng biến nào thiếu: người gặp lỗi này thường là người vừa
    // clone repo, họ cần biết sửa gì chứ không cần biết "config invalid".
    expect(() => validateEnv({ REDIS_URL: 'redis://localhost:6379' })).toThrow(/DATABASE_URL/);
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
