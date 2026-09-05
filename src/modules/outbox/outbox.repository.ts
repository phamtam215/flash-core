import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infra/prisma';

/** Một dòng hộp thư đi, đã khoá và sẵn sàng đẩy đi. */
export interface ClaimedEvent {
  id: string;
  type: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lấy một lô sự kiện chờ đẩy, **khoá chúng lại cho riêng worker này**.
   *
   * `FOR UPDATE SKIP LOCKED` là toàn bộ mấu chốt: `FOR UPDATE` khoá dòng lấy được, `SKIP
   * LOCKED` bảo Postgres **bỏ qua** dòng đang bị worker khác khoá thay vì xếp hàng chờ. Nhờ
   * vậy chạy 5 worker song song thì chúng chia nhau việc, không giẫm chân và cũng không nối
   * đuôi. Bỏ `SKIP LOCKED` đi thì nhiều worker biến thành một worker chậm — tất cả cùng chờ
   * dòng đầu tiên.
   *
   * Phải nằm trong interactive transaction (giống `SELECT FOR UPDATE` của Phase 3): ngoài
   * transaction thì khoá nhả ngay khi câu lệnh xong, và hai worker cùng đẩy một sự kiện.
   * Ở đây transaction bọc luôn cả `UPDATE ... DISPATCHED` do `markDispatched` gọi ngay sau —
   * xem `OutboxRelay` để thấy vì sao vẫn có thể trùng (và vì sao thế là chấp nhận được).
   */
  async claimBatch(limit: number): Promise<ClaimedEvent[]> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string; type: string; aggregate_id: string; payload: Record<string, unknown> }[]
      >`
        SELECT id, type, aggregate_id, payload
        FROM outbox_events
        WHERE status = 'PENDING'
        ORDER BY created_at
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED`;

      if (rows.length === 0) return [];

      // Đánh dấu ngay trong CÙNG transaction đang giữ khoá: worker khác nhìn vào chỉ thấy
      // `DISPATCHED`, không thể lấy lại lô này.
      await tx.$executeRaw`
        UPDATE outbox_events
        SET status = 'DISPATCHED', dispatched_at = now(), attempts = attempts + 1
        WHERE id = ANY(${rows.map((r) => r.id)}::uuid[])`;

      return rows.map((r) => ({
        id: r.id,
        type: r.type,
        aggregateId: r.aggregate_id,
        payload: r.payload,
      }));
    });
  }

  /** Trả dòng về hàng chờ khi đẩy queue thất bại, để lần quét sau thử lại. */
  async releaseFailed(ids: string[], error: string): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.$executeRaw`
      UPDATE outbox_events
      SET status = CASE WHEN attempts >= 5 THEN 'FAILED'::"OutboxStatus" ELSE 'PENDING'::"OutboxStatus" END,
          last_error = ${error}
      WHERE id = ANY(${ids}::uuid[])`;
  }

  /** Dùng cho test và cho việc soi bằng tay khi có sự cố. */
  async countByStatus(status: 'PENDING' | 'DISPATCHED' | 'FAILED'): Promise<number> {
    return this.prisma.outboxEvent.count({ where: { status } });
  }
}
