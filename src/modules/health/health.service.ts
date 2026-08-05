import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../../infra/prisma';

export interface LivenessReport {
  status: 'ok';
  uptimeSeconds: number;
}

export interface ReadinessReport {
  ready: boolean;
  checks: {
    database: 'up' | 'down';
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
 * Đây là câu hỏi bản chất của Phase 5 và là lỗi cấu hình phổ biến nhất khi deploy.
 */
@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  liveness(): LivenessReport {
    return { status: 'ok', uptimeSeconds: Math.floor(process.uptime()) };
  }

  async readiness(): Promise<ReadinessReport> {
    const database = await this.checkDatabase();
    return { ready: database === 'up', checks: { database } };
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
