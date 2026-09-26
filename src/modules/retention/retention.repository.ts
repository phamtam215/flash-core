import { Inject, Injectable } from '@nestjs/common';

import { ENV, type Env } from '../../config';
import { PrismaService } from '../../infra/prisma';

/** Toàn bộ truy cập DB của module retention. */
@Injectable()
export class RetentionRepository {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Xoá dòng outbox **đã đẩy xong** và đủ cũ.
   *
   * Ba điều kiện, mỗi cái chặn một kiểu xoá nhầm:
   *
   * - `status = 'DISPATCHED'` — **không bao giờ xoá `PENDING`** (chưa đẩy, xoá là mất sự
   *   kiện) và **không bao giờ xoá `FAILED`**. `FAILED` là những dòng cạn số lần thử, tức là
   *   thứ đang **chờ người nhìn**. Dọn chúng đi là dọn mất chính cái cần điều tra.
   * - `dispatched_at < now() - N ngày` — cũ hơn cửa sổ giữ.
   * - `LIMIT` qua subquery — xem §Xoá theo lô ở service.
   */
  async deleteDispatchedOutbox(olderThan: Date): Promise<number> {
    return this.prisma.$executeRaw`
      DELETE FROM outbox_events
      WHERE id IN (
        SELECT id FROM outbox_events
        WHERE status = 'DISPATCHED' AND dispatched_at IS NOT NULL AND dispatched_at < ${olderThan}
        ORDER BY dispatched_at
        LIMIT ${this.env.RETENTION_BATCH_SIZE}
      )`;
  }

  /** Xoá dấu idempotent đã đủ cũ. Đọc kỹ ghi chú ở `DATA_RETENTION_DAYS` trước khi hạ ngưỡng. */
  async deleteProcessedEvents(olderThan: Date): Promise<number> {
    return this.prisma.$executeRaw`
      DELETE FROM processed_events
      WHERE (event_id, consumer) IN (
        SELECT event_id, consumer FROM processed_events
        WHERE processed_at < ${olderThan}
        ORDER BY processed_at
        LIMIT ${this.env.RETENTION_BATCH_SIZE}
      )`;
  }

  /** Số dòng `FAILED` còn nằm lại — để đo, không để xoá. */
  async countFailedOutbox(): Promise<number> {
    return this.prisma.outboxEvent.count({ where: { status: 'FAILED' } });
  }
}
