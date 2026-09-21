import { Inject, Injectable, type NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

import { ENV, type Env } from '../../config';
import { CSRF_COOKIE, issueToken, verifyToken } from './csrf.token';

/**
 * Phát cookie `csrf_token` cho **mọi** response chưa có token hợp lệ.
 *
 * **Vì sao là middleware toàn cục chứ không phải một endpoint `GET /auth/csrf`:** endpoint
 * riêng thì client phải *nhớ gọi* nó trước lần ghi đầu tiên — quên là `403` khó hiểu, và
 * người viết client mới sẽ vấp đúng chỗ đó. Middleware thì token có mặt ngay từ request đầu
 * tiên, kể cả request tải trang tĩnh `GET /`.
 *
 * **Vì sao cookie này KHÔNG `httpOnly`:** nghe ngược với ba cookie kia, nhưng JS *bắt buộc*
 * phải đọc được thì mới sao chép sang header được — đó là toàn bộ cơ chế double-submit. Nó
 * an toàn vì token CSRF **không phải bí mật xác thực**: biết nó không đăng nhập được, nó chỉ
 * chứng minh "tôi chạy trên origin này". Đặt `httpOnly: true` ở đây là làm cơ chế chết im
 * lặng — mọi request ghi trả 403 và không ai hiểu vì sao.
 */
@Injectable()
export class CsrfIssueMiddleware implements NestMiddleware {
  constructor(@Inject(ENV) private readonly env: Env) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const existing = (req.cookies as Record<string, string> | undefined)?.[CSRF_COOKIE];

    // Chỉ phát mới khi chưa có HOẶC token hiện tại không hợp lệ (bị sửa, hoặc ký bằng secret
    // cũ sau khi xoay khoá). Phát lại mỗi request sẽ làm hai tab đá nhau: tab B ghi đè cookie
    // trong lúc tab A đang giữ giá trị cũ trong DOM ⇒ tab A bấm gì cũng 403.
    if (verifyToken(existing, this.env.CSRF_SECRET) === null) return next();

    res.cookie(CSRF_COOKIE, issueToken(this.env.CSRF_SECRET), {
      httpOnly: false,
      secure: this.env.COOKIE_SECURE,
      sameSite: 'strict',
      path: '/',
    });
    next();
  }
}
