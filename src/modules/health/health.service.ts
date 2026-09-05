import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../infra/prisma';
import { RedisService } from '../../infra/redis';

export interface LivenessReport {
  status: 'ok';
  uptimeSeconds: number;
}

export interface ReadinessReport {
  ready: boolean;
  checks: {
    database: 'up' | 'down';
    redis: 'up' | 'down';
    /** `true` khi đã nhận SIGTERM và đang rút khỏi vòng phục vụ. */
    shuttingDown: boolean;
  };
}

/**
 * Liveness và readiness — hai câu hỏi khác nhau, hay bị gộp thành một.
 *
 * - **Liveness (`/health`)**: "process này còn sống chưa treo không?" Không được kiểm tra
 *   dependency. Nếu `/health` fail vì DB chết, Cloud Run sẽ **restart container** — mà
 *   restart app thì không chữa được DB, chỉ làm mất luôn những request app vẫn xử lý được.
 *
 * - **Readiness (`/ready`)**: "có nên gửi traffic cho instance này không?" Ở đây MỚI kiểm
 *   tra dependency. DB chết → trả 503 → load balancer tạm ngừng gửi request, nhưng container
 *   vẫn sống và tự phục hồi khi DB trở lại.
 *
 * Đây là câu hỏi bản chất của Phase 6 và là lỗi cấu hình phổ biến nhất khi deploy.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  /**
   * Đã nhận SIGTERM chưa. Bật lên là `/ready` trả 503 NGAY, trong khi app vẫn phục vụ nốt
   * request đang chạy — xem `main.ts` §Graceful shutdown.
   */
  private shuttingDown = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  /** Gọi khi nhận SIGTERM. Chỉ có một chiều: đã rút thì không quay lại nhận traffic. */
  beginShutdown(): void {
    this.shuttingDown = true;
    this.logger.warn('Nhận tín hiệu tắt — /ready sẽ trả 503, ngừng nhận traffic mới');
  }

  liveness(): LivenessReport {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  async readiness(): Promise<ReadinessReport> {
    // Kiểm song song: hai phép thử độc lập, chạy tuần tự chỉ làm readiness chậm gấp đôi mà
    // không thêm thông tin gì.
    const [database, redis] = await Promise.all([this.checkDatabase(), this.checkRedis()]);

    return {
      ready: database === 'up' && redis === 'up' && !this.shuttingDown,
      checks: { database, redis, shuttingDown: this.shuttingDown },
    };
  }

  /**
   * Redis chết thì chiến lược tồn kho `redis`, rate limit đăng nhập và **toàn bộ queue** đều
   * hỏng — instance đó không nên nhận traffic nữa. Trước Phase 6 nó vẫn báo "sẵn sàng", nên
   * request cứ được gửi vào một instance chắc chắn sẽ lỗi.
   *
   * `PING` là phép thử rẻ nhất chứng minh connection còn dùng được THẬT, khác với việc kiểm
   * tra "đối tượng client có tồn tại không" — thứ luôn đúng kể cả khi Redis đã chết.
   */
  private async checkRedis(): Promise<'up' | 'down'> {
    try {
      await this.redis.client.ping();
      return 'up';
    } catch (error) {
      this.logger.warn({ err: error }, 'Kiểm tra readiness của Redis thất bại');
      return 'down';
    }
  }

  private async checkDatabase(): Promise<'up' | 'down'> {
    try {
      // `SELECT 1` là phép thử rẻ nhất chứng minh connection còn dùng được thật — khác với
      // việc chỉ kiểm tra "đối tượng client có tồn tại không", thứ luôn đúng dù DB đã chết.
      await this.prisma.$queryRaw`SELECT 1`;
      return 'up';
    } catch (error) {
      // Có bắt lỗi, nhưng KHÔNG nuốt: readiness fail là tín hiệu vận hành quan trọng nên
      // phải để lại dấu vết trong log. `catch` rỗng ở đây sẽ khiến DB chết mà không ai biết.
      this.logger.warn({ err: error }, 'Kiểm tra readiness của Postgres thất bại');
      return 'down';
    }
  }
}
