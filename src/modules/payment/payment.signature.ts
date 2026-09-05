import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Header chữ ký, cùng định dạng các cổng thật (Stripe, GitHub) dùng:
 *
 *     X-Payment-Signature: t=1757000000,v1=<hex hmac-sha256>
 *
 * `t` là dấu thời gian (giây) và **nằm trong phần được ký** — đó là điểm mấu chốt chống
 * replay: không có `t`, một chữ ký hợp lệ bắt được trên đường truyền sẽ hợp lệ mãi mãi.
 */
export const SIGNATURE_HEADER = 'x-payment-signature';

export type SignatureFailure = 'MISSING' | 'MALFORMED' | 'MISMATCH' | 'EXPIRED';

export function signPayload(rawBody: string, secret: string, timestampSec: number): string {
  const mac = createHmac('sha256', secret).update(`${timestampSec}.${rawBody}`).digest('hex');
  return `t=${timestampSec},v1=${mac}`;
}

/**
 * Kiểm chữ ký. Trả `null` khi hợp lệ, hoặc lý do thất bại.
 *
 * Hai điểm phải làm đúng, cả hai đều là bug im lặng nếu làm sai:
 *
 * 1. **Ký trên RAW body**, đúng chuỗi byte cổng đã gửi. Nếu để middleware parse JSON rồi
 *    `JSON.stringify` lại, thứ tự khoá và khoảng trắng có thể đổi ⇒ chữ ký không bao giờ
 *    khớp, và triệu chứng ("chữ ký luôn sai") không hề chỉ về nguyên nhân.
 * 2. **So sánh bằng `timingSafeEqual`**, không phải `===`. So sánh chuỗi thường dừng ở byte
 *    đầu tiên khác nhau, nên thời gian trả lời rò rỉ *độ dài tiền tố đúng* — đủ để dò dần
 *    từng byte chữ ký. `timingSafeEqual` luôn tốn thời gian như nhau.
 */
export function verifySignature(input: {
  header: string | undefined;
  rawBody: string;
  secret: string;
  toleranceSec: number;
  nowSec?: number;
}): SignatureFailure | null {
  if (!input.header) return 'MISSING';

  const parsed = /^t=(\d+),v1=([0-9a-f]+)$/.exec(input.header.trim());
  if (!parsed?.[1] || !parsed[2]) return 'MALFORMED';

  const timestamp = Number(parsed[1]);
  const received = Buffer.from(parsed[2], 'hex');
  const now = input.nowSec ?? Math.floor(Date.now() / 1000);

  const expected = createHmac('sha256', input.secret)
    .update(`${timestamp}.${input.rawBody}`)
    .digest();

  // `timingSafeEqual` ném lỗi nếu hai buffer khác độ dài — kiểm trước, và độ dài không phải
  // bí mật (SHA-256 luôn 32 byte) nên so sánh nó bằng `!==` là an toàn.
  if (received.length !== expected.length) return 'MISMATCH';
  if (!timingSafeEqual(received, expected)) return 'MISMATCH';

  // Kiểm hạn SAU khi chữ ký đã đúng: trả lời "hết hạn" cho một chữ ký sai là tự tiết lộ rằng
  // phần còn lại đúng.
  if (Math.abs(now - timestamp) > input.toleranceSec) return 'EXPIRED';

  return null;
}
