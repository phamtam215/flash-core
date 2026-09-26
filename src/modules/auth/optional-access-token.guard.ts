import { type CanActivate, type ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';

import { ENV, type Env } from '../../config';
import { ACCESS_TOKEN_COOKIE } from './auth.cookies';
import { Role } from './roles.decorator';

/**
 * Gắn `userId`/`role` NẾU có phiên hợp lệ, và **luôn cho qua** nếu không.
 *
 * Dùng cho trang công khai nhưng cá nhân hoá được: ai cũng xem được lịch sale, nhưng người đã
 * đăng nhập thì thấy thêm "bạn còn mua được 1 chiếc" — thay vì bấm mua rồi mới nhận `409`.
 *
 * **Khác `AccessTokenGuard` ở đúng một điểm: token hỏng KHÔNG phải lỗi.** Nên mọi nhánh thất
 * bại đều `return true` chứ không ném. Viết nhầm thành ném là biến một trang công khai thành
 * trang đăng nhập, và triệu chứng chỉ lộ ra với người có cookie cũ đã hết hạn.
 */
@Injectable()
export class OptionalAccessTokenGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { userId?: string; role?: Role }>();
    const token = (request.cookies as Record<string, string> | undefined)?.[ACCESS_TOKEN_COOKIE];
    if (!token) return true;

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; role?: Role }>(token, {
        secret: this.env.JWT_ACCESS_SECRET,
      });
      request.userId = payload.sub;
      request.role = payload.role ?? Role.USER;
    } catch {
      // Token hết hạn hoặc sai chữ ký: coi như khách vãng lai, KHÔNG chặn.
    }
    return true;
  }
}
