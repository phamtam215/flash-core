import type { CookieOptions, Response } from 'express';

import type { Env } from '../../config';

export const ACCESS_TOKEN_COOKIE = 'access_token';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';

/**
 * Đường dẫn mà refresh token được gửi kèm.
 *
 * Cookie thường được browser đính vào **mọi** request tới domain. Giới hạn `path` khiến
 * refresh token chỉ xuất hiện đúng ở hai endpoint cần nó. Lợi ích: giảm bề mặt rò rỉ — token
 * dài hạn không nằm trong log/proxy/trace của những request chẳng liên quan.
 */
const REFRESH_COOKIE_PATH = '/auth';

/**
 * Bốn cờ bảo mật, mỗi cờ chặn một thứ khác nhau:
 *
 * - `httpOnly` — JavaScript không đọc được cookie (`document.cookie` trả về rỗng).
 *   Chặn: XSS đọc trộm token. **Không** chặn CSRF, vì CSRF đâu cần đọc.
 * - `sameSite: 'strict'` — browser chỉ gửi cookie khi request xuất phát từ chính site mình.
 *   Chặn: CSRF. Đây mới là cờ chống CSRF, không phải httpOnly.
 * - `secure` — chỉ gửi qua HTTPS. Local dùng http nên phải tắt (`COOKIE_SECURE=false`),
 *   production bắt buộc bật.
 * - `maxAge` — browser tự xoá khi hết hạn, không cần code dọn.
 */
function baseOptions(env: Env): CookieOptions {
  return { httpOnly: true, secure: env.COOKIE_SECURE, sameSite: 'strict' };
}

export function setAuthCookies(
  res: Response,
  env: Env,
  tokens: { accessToken: string; refreshToken: string },
): void {
  res.cookie(ACCESS_TOKEN_COOKIE, tokens.accessToken, {
    ...baseOptions(env),
    path: '/',
    maxAge: env.ACCESS_TOKEN_TTL * 1000, // express tính bằng mili giây
  });

  res.cookie(REFRESH_TOKEN_COOKIE, tokens.refreshToken, {
    ...baseOptions(env),
    path: REFRESH_COOKIE_PATH,
    maxAge: env.REFRESH_TOKEN_TTL * 1000,
  });
}

/**
 * Xoá cookie khi logout.
 *
 * `path` phải khớp **chính xác** lúc set, nếu không browser coi là cookie khác và cookie cũ
 * vẫn nằm nguyên đó. Đây là lỗi kinh điển khiến "logout xong vẫn còn đăng nhập".
 */
export function clearAuthCookies(res: Response, env: Env): void {
  res.clearCookie(ACCESS_TOKEN_COOKIE, { ...baseOptions(env), path: '/' });
  res.clearCookie(REFRESH_TOKEN_COOKIE, { ...baseOptions(env), path: REFRESH_COOKIE_PATH });
}
