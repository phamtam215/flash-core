import { type CanActivate, type ExecutionContext, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

import { ENV, type Env } from '../../config';
import { RedisService } from '../../infra/redis';
import { DomainError } from '../errors/domain.error';
import { IP_RATE_LIMIT_KEY, type IpRateLimitOptions } from './ip-rate-limit.decorator';

export class TooManyRequestsError extends DomainError {
  readonly httpStatus = HttpStatus.TOO_MANY_REQUESTS;
  readonly code = 'TOO_MANY_REQUESTS';

  constructor(retryAfterSeconds: number) {
    super(`Quá nhiều yêu cầu. Thử lại sau ${String(retryAfterSeconds)} giây`, {
      retryAfterSeconds,
    });
  }
}

/**
 * Đếm số lần gọi theo IP, lưu ở **Redis**.
 *
 * Vì sao Redis chứ không phải một `Map` trong RAM: Cloud Run chạy tới 2 instance, mỗi instance
 * đếm riêng thì ngưỡng "20 lần/giờ" thành 40. Đây đúng là lý do `infra/redis` ra đời từ Phase 1
 * (xem spec Phase 1 §Quyết định 1) — nên dùng lại, không dựng cơ chế mới.
 *
 * Guard này nằm ở `common/` dù nó chạm `infra/redis`. Đổi lại, nó dùng được cho **mọi** module
 * mà không module nào phải sở hữu logic đếm — và `RedisModule` là `@Global` nên không có vòng
 * phụ thuộc nào phát sinh.
 */
@Injectable()
export class IpRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(IpRateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const options = this.reflector.getAllAndOverride<IpRateLimitOptions | undefined>(
      IP_RATE_LIMIT_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!options) return true;

    const req = context.switchToHttp().getRequest<Request>();
    const ip = req.ip ?? 'unknown';

    const max = this.env[options.maxEnv];
    const count = await this.redis.incrementWithExpiry(
      `ratelimit:ip:${options.name}:${ip}`,
      options.windowSeconds,
    );

    if (count > max) {
      this.logger.warn({ ip, route: options.name, count }, 'Chặn vì quá ngưỡng theo IP');
      throw new TooManyRequestsError(options.windowSeconds);
    }
    return true;
  }
}
