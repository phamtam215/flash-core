import { type CanActivate, type ExecutionContext, Inject, Injectable, Logger } from '@nestjs/common';
import type { Request } from 'express';

import { ENV, type Env } from '../../config';
import { CsrfTokenInvalidError } from './csrf.errors';
import { CSRF_COOKIE, CSRF_HEADER, verifyRequest } from './csrf.token';

/** Method không đổi trạng thái thì không cần token. */
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Đường dẫn miễn kiểm. Giữ **ngắn**, và mỗi dòng phải nói được vì sao.
 *
 * `POST /payments/webhook` — cổng thanh toán gọi server-to-server, **không có cookie nào cả**
 * nên không có gì để CSRF (CSRF khai thác đúng việc browser tự đính cookie). Nó đã có lớp bảo
 * vệ riêng chặt hơn: HMAC trên raw body + dấu thời gian chống replay.
 */
const EXEMPT_PATHS = ['/payments/webhook'];

/**
 * Chặn CSRF bằng double-submit cookie (ADR-009).
 *
 * Đăng ký ở **tầng app** (`APP_GUARD`), không gắn từng controller. Lý do là **fail-closed**:
 * thêm một endpoint ghi mới mà quên nghĩ tới CSRF thì nó **đã được bảo vệ sẵn**. Cách ngược
 * lại — quên gắn = lộ — không có test nào bắt được, vì mọi test vẫn xanh.
 *
 * Lớp thứ ba, độc lập: kiểm `Origin` khi header đó **có mặt**. Dùng `Origin` chứ không
 * `Referer` — `Referer` bị proxy và extension lược bỏ khá thường xuyên nên chặn theo nó là
 * chặn nhầm người dùng thật. Thiếu `Origin` thì bỏ qua, không chặn: client không phải browser
 * (curl, k6, worker nội bộ) không gửi header này, và chúng vốn đã phải qua hai lớp trên.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly logger = new Logger(CsrfGuard.name);

  constructor(@Inject(ENV) private readonly env: Env) {}

  canActivate(context: ExecutionContext): boolean {
    if (context.getType() !== 'http') return true;

    const req = context.switchToHttp().getRequest<Request>();
    if (SAFE_METHODS.has(req.method)) return true;
    if (EXEMPT_PATHS.some((path) => req.path.startsWith(path))) return true;

    const origin = req.get('origin');
    if (origin && !this.isSameOrigin(origin, req)) {
      this.logger.warn({ origin, path: req.path }, 'Chặn request có Origin khác — nghi CSRF');
      throw new CsrfTokenInvalidError('Origin không khớp');
    }

    const failure = verifyRequest({
      cookie: (req.cookies as Record<string, string> | undefined)?.[CSRF_COOKIE],
      header: req.get(CSRF_HEADER),
      secret: this.env.CSRF_SECRET,
    });

    if (failure) {
      this.logger.warn({ reason: failure, path: req.path }, 'Chặn request thiếu/sai token CSRF');
      throw new CsrfTokenInvalidError(failure);
    }
    return true;
  }

  private isSameOrigin(origin: string, req: Request): boolean {
    try {
      return new URL(origin).host === req.get('host');
    } catch {
      // `Origin` không parse được là dị thường, coi như không khớp.
      return false;
    }
  }
}
