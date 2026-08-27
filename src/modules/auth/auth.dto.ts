import { z } from 'zod';

/**
 * Schema của dữ liệu client gửi lên. Validate ở BIÊN (controller) bằng `ZodValidationPipe`,
 * để service luôn nhận dữ liệu đã sạch và đã có type.
 *
 * `z.infer` suy ra type từ chính schema — một nguồn sự thật cho cả runtime và compile-time.
 * Đây là lý do dự án chọn Zod thay class-validator (project-context.md quyết định #7).
 */

/**
 * Email được **chuẩn hoá trước, validate sau** — thứ tự này quan trọng.
 *
 * Trong Zod 4, các bước chạy đúng theo thứ tự viết. Nếu đặt `z.email()` trước rồi mới
 * `.trim()`, thì `"  tam@example.com  "` bị loại ngay ở bước validate vì khoảng trắng thừa —
 * lỗi khó hiểu với người dùng chỉ lỡ tay copy dư một dấu cách. `.pipe()` cho phép chạy
 * `trim` + `toLowerCase` trước, rồi mới đưa kết quả sạch vào kiểm tra định dạng.
 *
 * `toLowerCase` là bắt buộc chứ không phải cho đẹp: thiếu nó thì `Tam@x.com` và `tam@x.com`
 * thành hai tài khoản khác nhau, và ràng buộc UNIQUE trên cột email mất tác dụng.
 */
const emailField = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email('Email không hợp lệ').max(255));

export const registerSchema = z.object({
  email: emailField,

  /**
   * Tối thiểu 8 ký tự theo khuyến nghị OWASP.
   *
   * Trần 72 ký tự là để tương thích ngược với bcrypt (bcrypt cắt cụt sau 72 byte và **im
   * lặng** làm vậy). Argon2 không có giới hạn đó, nhưng vẫn chặn ở đây để không ai gửi mật
   * khẩu 1 MB — mỗi lần hash tốn RAM thật, đó là một kiểu tấn công từ chối dịch vụ rẻ tiền.
   */
  password: z.string().min(8, 'Mật khẩu tối thiểu 8 ký tự').max(72, 'Mật khẩu tối đa 72 ký tự'),
});

export const loginSchema = z.object({
  email: emailField,
  // Login KHÔNG kiểm tra độ dài: luật độ dài có thể đổi theo thời gian, và người đăng ký từ
  // trước vẫn phải đăng nhập được bằng mật khẩu cũ.
  password: z.string().min(1, 'Thiếu mật khẩu').max(72),
});

export type RegisterDto = z.infer<typeof registerSchema>;
export type LoginDto = z.infer<typeof loginSchema>;

/** Hình dạng user trả ra ngoài. Cố tình KHÔNG có `passwordHash`. */
export interface PublicUser {
  id: string;
  email: string;
}
