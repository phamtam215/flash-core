import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Token CSRF: `<random hex 32 byte>.<hmac-sha256 của random>`.
 *
 * **Vì sao ký thay vì random thuần** (ADR-009): double-submit bản thường chỉ so cookie với
 * header. Kẻ tấn công **cùng site** — một subdomain bị chiếm — đặt được cookie sang domain
 * chính, nên nó chỉ cần đặt `csrf_token=abc` rồi gửi `X-CSRF-Token: abc` là qua. Mà đúng kịch
 * bản đó mới là lý do dự án làm token (`SameSite=Strict` đã chặn CSRF cổ điển rồi). Không ký
 * thì token này không thêm được gì.
 *
 * Có chữ ký thì cookie do kẻ tấn công tự chế **không verify được** vì nó không có `CSRF_SECRET`.
 *
 * **Điểm yếu còn lại, ghi ra chứ không giấu:** chữ ký không ràng buộc vào phiên đăng nhập. Kẻ
 * tấn công có tài khoản hợp lệ lấy token đã ký của chính nó rồi dùng cho nạn nhân vẫn lọt.
 * Bịt hẳn phải ký kèm `userId`, kéo theo phải phát lại token sau mỗi lần login/logout và đồng
 * bộ mọi tab đang mở — nợ đã ghi ở `docs/specs/csrf-token.md` §Câu hỏi mở #2.
 *
 * Cách ký và cách so sánh copy đúng `payment.signature.ts`, không phát minh lại.
 */
export const CSRF_COOKIE = 'csrf_token';
export const CSRF_HEADER = 'x-csrf-token';

export type CsrfFailure = 'MISSING' | 'MALFORMED' | 'MISMATCH' | 'SIGNATURE_MISMATCH';

export function issueToken(secret: string): string {
  const random = randomBytes(32).toString('hex');
  return `${random}.${sign(random, secret)}`;
}

/** Trả `null` khi token hợp lệ, hoặc lý do hỏng. Dùng cho token đứng một mình (lúc phát lại). */
export function verifyToken(token: string | undefined, secret: string): CsrfFailure | null {
  if (!token) return 'MISSING';

  const parts = token.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return 'MALFORMED';
  if (!/^[0-9a-f]{64}$/.test(parts[0]) || !/^[0-9a-f]{64}$/.test(parts[1])) return 'MALFORMED';

  return equals(parts[1], sign(parts[0], secret)) ? null : 'SIGNATURE_MISMATCH';
}

/**
 * Kiểm một request: cookie và header phải **cùng tồn tại**, **bằng nhau**, và **ký hợp lệ**.
 *
 * Thứ tự kiểm có chủ ý: so cookie với header TRƯỚC khi verify chữ ký. Hai bên lệch nhau là
 * dấu hiệu CSRF thật; chữ ký sai là dấu hiệu token bị chế. Phân biệt được hai ca giúp đọc log
 * sự cố biết đang bị tấn công kiểu gì — gộp thành một lý do là mất thông tin đó.
 */
export function verifyRequest(input: {
  cookie: string | undefined;
  header: string | undefined;
  secret: string;
}): CsrfFailure | null {
  if (!input.cookie || !input.header) return 'MISSING';
  if (!equals(input.cookie, input.header)) return 'MISMATCH';
  return verifyToken(input.cookie, input.secret);
}

function sign(random: string, secret: string): string {
  return createHmac('sha256', secret).update(random).digest('hex');
}

/**
 * So sánh bằng `timingSafeEqual`, không phải `===`. So chuỗi thường dừng ở byte đầu tiên khác
 * nhau nên thời gian trả lời rò rỉ độ dài tiền tố đúng — đủ để dò dần từng byte.
 */
function equals(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // `timingSafeEqual` ném lỗi nếu hai buffer khác độ dài. Độ dài không phải bí mật ở đây
  // (token luôn 129 ký tự) nên so nó bằng `!==` là an toàn.
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
