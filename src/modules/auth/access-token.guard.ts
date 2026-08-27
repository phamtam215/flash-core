import { CanActivate, ExecutionContext, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { ENV, type Env } from '../../config';
import { ACCESS_TOKEN_COOKIE } from './auth.cookies';

/** Request đã qua guard thì chắc chắn có `userId`. */
export interface AuthenticatedRequest extends Request {
  userId: string;
}

/**
 * Chặn request không có access token hợp lệ.
 *
 * Đọc token từ **cookie**, không phải header `Authorization` — quyết định đã chốt ở
 * docs/specs/phase1-auth.md §Quyết định 2. Browser tự đính cookie nên frontend không phải
 * làm gì; đổi lại test bằng curl phải giữ cookie.
 *
 * Guard chỉ xác minh chữ ký và hạn dùng, **không** truy vấn DB. Đó chính là ý nghĩa của
 * "stateless": mọi thứ cần biết đã nằm trong token. Hệ quả phải chấp nhận: user vừa bị xoá
 * vẫn gọi API được cho tới khi token hết hạn — lý do access token chỉ sống 15 phút.
 */
@Injectable()
export class AccessTokenGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { userId?: string }>();
    const token = (request.cookies as Record<string, string> | undefined)?.[ACCESS_TOKEN_COOKIE];

    if (!token) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', message: 'Chưa đăng nhập' });
    }

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token, {
        secret: this.env.JWT_ACCESS_SECRET,
      });
      request.userId = payload.sub;
      return true;
    } catch {
      // Không phân biệt "hết hạn" với "chữ ký sai" trong response: client chỉ cần biết phải
      // đăng nhập lại, còn chi tiết thì chỉ giúp kẻ tấn công dò.
      throw new UnauthorizedException({
        code: 'INVALID_ACCESS_TOKEN',
        message: 'Phiên đăng nhập không hợp lệ',
      });
    }
  }
}
