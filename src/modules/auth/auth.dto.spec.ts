import { loginSchema, registerSchema } from './auth.dto';

/**
 * Test case 13 trong docs/specs/phase1-auth.md.
 * Unit test thuần — không cần DB, không cần Redis, chạy trong vài mili giây.
 */
describe('auth DTO schema', () => {
  describe('registerSchema', () => {
    it('nhận email và mật khẩu hợp lệ', () => {
      const result = registerSchema.parse({ email: 'tam@example.com', password: 'matkhau123' });
      expect(result).toEqual({ email: 'tam@example.com', password: 'matkhau123' });
    });

    it('chuẩn hoá email về chữ thường và cắt khoảng trắng', () => {
      // Không chuẩn hoá thì "Tam@Example.com" và "tam@example.com" thành hai tài khoản khác
      // nhau, và ràng buộc UNIQUE trên cột email trở nên vô dụng.
      const result = registerSchema.parse({ email: '  TAM@Example.COM  ', password: 'matkhau123' });
      expect(result.email).toBe('tam@example.com');
    });

    it('từ chối email sai định dạng', () => {
      const result = registerSchema.safeParse({ email: 'khong-phai-email', password: 'matkhau123' });
      expect(result.success).toBe(false);
    });

    it('từ chối mật khẩu dưới 8 ký tự', () => {
      const result = registerSchema.safeParse({ email: 'tam@example.com', password: 'ngan' });
      expect(result.success).toBe(false);
      expect(result.error?.issues[0]?.message).toContain('8 ký tự');
    });

    it('từ chối mật khẩu quá 72 ký tự', () => {
      const result = registerSchema.safeParse({
        email: 'tam@example.com',
        password: 'a'.repeat(73),
      });
      expect(result.success).toBe(false);
    });

    it('loại bỏ field lạ client tự thêm', () => {
      // Nếu Zod không loại, một field như `role: "admin"` có thể chảy thẳng xuống service.
      const result = registerSchema.parse({
        email: 'tam@example.com',
        password: 'matkhau123',
        role: 'admin',
      });
      expect(result).not.toHaveProperty('role');
    });
  });

  describe('loginSchema', () => {
    it('KHÔNG áp luật độ dài tối thiểu', () => {
      // Luật độ dài có thể đổi theo thời gian; người đăng ký từ trước vẫn phải đăng nhập
      // được bằng mật khẩu cũ của họ.
      const result = loginSchema.safeParse({ email: 'tam@example.com', password: 'x' });
      expect(result.success).toBe(true);
    });

    it('từ chối mật khẩu rỗng', () => {
      const result = loginSchema.safeParse({ email: 'tam@example.com', password: '' });
      expect(result.success).toBe(false);
    });
  });
});
