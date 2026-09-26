import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { ENV, type Env } from '../../config';

/**
 * Năm header bảo vệ, mỗi cái chặn một thứ khác nhau.
 *
 * **Vì sao tự viết thay vì dùng `helmet`:** helmet là 15 middleware mà dự án dùng 5, và mặc
 * định của nó **đổi giữa các phiên bản** — một `npm update` đổi hành vi bảo mật mà không ai
 * đọc changelog. Ở đây mỗi header nằm trên một dòng, có comment nói nó chặn gì, và đọc được
 * trong lúc phỏng vấn. Cũng đúng luật "không thêm công nghệ mới" của CLAUDE.md.
 */
@Injectable()
export class SecurityHeadersMiddleware implements NestMiddleware {
  constructor(@Inject(ENV) private readonly env: Env) {}

  use(_req: Request, res: Response, next: NextFunction): void {
    /**
     * Lớp phòng thủ hoạt động **sau khi** code đã thủng: có lỗ XSS và kẻ tấn công chèn được
     * `<script>` vào DOM thì trình duyệt **vẫn từ chối chạy nó**, vì nó không đến từ `'self'`.
     *
     * Từng chỉ thị:
     * - `script-src 'self'` — giết mọi `<script>` inline và mọi `onclick=`. Đây là chỉ thị
     *   đắt nhất về công sức và cũng đáng giá nhất.
     * - `img-src 'self' data:` — `data:` là bắt buộc vì favicon nhúng bằng data URI
     *   (`public/index.html`). Bỏ nó đi thì favicon biến mất kèm một lỗi CSP trong console.
     * - `frame-ancestors 'none'` — không ai nhúng được trang này vào iframe của họ
     *   (clickjacking). Thay cho `X-Frame-Options` vốn đã cũ.
     * - `base-uri 'none'` — chặn `<base href>` bị chèn để đổi gốc của mọi đường dẫn tương đối.
     * - `form-action 'self'` — form không gửi được sang domain lạ.
     */
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "frame-ancestors 'none'",
        "base-uri 'none'",
        "form-action 'self'",
      ].join('; '),
    );

    // Trình duyệt ĐỪNG đoán kiểu file. Không có nó, một file người dùng tải lên được phục vụ
    // với `Content-Type` sai vẫn có thể bị đoán thành script rồi chạy.
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Bấm link ra ngoài thì site kia không thấy đường dẫn nội bộ của mình.
    res.setHeader('Referrer-Policy', 'same-origin');

    // Dự án không dùng ba quyền này. Khai tường minh để một thư viện nào đó không âm thầm xin.
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');

    /**
     * HSTS **phải có điều kiện**, và đây là chỗ dễ tự bắn vào chân nhất trong cả file.
     *
     * Gửi header này trên `http://localhost` là ra lệnh cho trình duyệt: "từ giờ tới một năm
     * nữa, mọi thứ ở localhost chỉ được đi HTTPS". Mà local không có HTTPS ⇒ **tự khoá mình
     * khỏi localhost**, và gỡ phải vào `chrome://net-internals/#hsts` — mỗi trình duyệt một
     * kiểu, mất cả buổi.
     *
     * Dùng lại đúng cờ `COOKIE_SECURE` đã có: nó bật khi và chỉ khi đang chạy HTTPS thật.
     * Một biến, hai nơi dùng, không thêm khái niệm mới.
     */
    if (this.env.COOKIE_SECURE) {
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    }

    next();
  }
}
