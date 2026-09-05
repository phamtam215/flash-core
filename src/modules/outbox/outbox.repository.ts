import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infra/prisma';

/** Một dòng hộp thư đi đã được khoá và sẵn sàng đẩy đi. */
export interface ClaimedEvent {
  id: string;
  type: string;
  aggregateId: string;
  payload: Record<string, unknown>;
}

/** Bao nhiêu lần đẩy hỏng thì bỏ cuộc và chuyển sang `FAILED` để người xem. */
const MAX_DISPATCH_ATTEMPTS = 5;

/** Trần thời gian cho một transaction relay (ms) — đủ cho một lô, không để treo mãi. */
const RELAY_TX_TIMEOUT_MS = 15_000;

@Injectable()
export class OutboxRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lấy một lô sự kiện chờ đẩy, gọi `publish`, rồi mới đánh dấu `DISPATCHED` — **tất cả trong
   * MỘT transaction đang giữ khoá trên các dòng đó**.
   *
   * ### Vì sao thứ tự phải là "đẩy trước, đánh dấu sau"
   *
   * Bản đầu của file này làm ngược lại: đánh dấu `DISPATCHED` rồi commit, sau đó mới gọi
   * `queue.add` bên ngoài. Nó **mất sự kiện**: process bị giết đúng khe giữa commit và
   * `queue.add` thì dòng nằm lại ở `DISPATCHED` vĩnh viễn, không ai đẩy nữa và cũng không ai
   * biết — email của đơn đó không bao giờ được gửi.
   *
   * Với thứ tự hiện tại, chết ở bất kỳ đâu cũng dẫn tới **rollback**: các dòng quay lại
   * `PENDING` và nhịp quét sau đẩy lại. Có thể **trùng** (đã đẩy vài job rồi mới hỏng), và
   * trùng thì consumer idempotent nuốt được — còn **mất** thì không có cách nào cứu. Đó chính
   * là câu "Outbox chuyển bài toán từ *có thể mất* sang *có thể trùng*" trong tech-playbook.
   *
   * ### Vì sao chấp nhận gọi ra ngoài bên trong transaction
   *
   * `CLAUDE.md` cấm gọi API ngoài trong transaction, và luật đó đúng cho đường request: giữ
   * khoá trên dòng nghiệp vụ nóng trong lúc chờ mạng là cách làm sập hệ thống. Ở đây là ngoại
   * lệ có ý thức, vì ba điều kiện cùng đúng: (1) dòng bị khoá là dòng **outbox**, không ai
   * ngoài relay đụng tới; (2) worker khác gặp khoá thì `SKIP LOCKED` cho đi tiếp ngay, không
   * xếp hàng; (3) Redis nằm cùng hạ tầng, và transaction có trần thời gian.
   * Không có ngoại lệ này thì không có cách nào giữ được "không mất". Ghi ở ADR-006.
   *
   * ### `FOR UPDATE SKIP LOCKED`
   *
   * `FOR UPDATE` khoá dòng lấy được; `SKIP LOCKED` bảo Postgres **bỏ qua** dòng đang bị worker
   * khác khoá thay vì chờ. Nhờ vậy 5 worker chia nhau việc. Bỏ `SKIP LOCKED` đi thì 5 worker
   * biến thành 1 worker chậm — tất cả cùng chờ dòng đầu tiên.
   *
   * Trả về số sự kiện đã đẩy thành công.
   */
  async dispatchBatch(
    limit: number,
    publish: (events: ClaimedEvent[]) => Promise<void>,
  ): Promise<number> {
    return this.prisma.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<
          { id: string; type: string; aggregate_id: string; payload: Record<string, unknown> }[]
        >`
          SELECT id, type, aggregate_id, payload
          FROM outbox_events
          WHERE status = 'PENDING'
          ORDER BY created_at
          LIMIT ${limit}
          FOR UPDATE SKIP LOCKED`;

        if (rows.length === 0) return 0;

        const events = rows.map((row) => ({
          id: row.id,
          type: row.type,
          aggregateId: row.aggregate_id,
          payload: row.payload,
        }));

        // Ném lỗi ở đây ⇒ cả transaction rollback ⇒ các dòng vẫn `PENDING`.
        await publish(events);

        await tx.$executeRaw`
          UPDATE outbox_events
          SET status = 'DISPATCHED', dispatched_at = now(), attempts = attempts + 1
          WHERE id = ANY(${events.map((e) => e.id)}::uuid[])`;

        return events.length;
      },
      { timeout: RELAY_TX_TIMEOUT_MS },
    );
  }

  /**
   * Ghi lại một lần đẩy hỏng: tăng `attempts`, và quá ngưỡng thì chuyển `FAILED`.
   *
   * Chạy NGOÀI transaction vừa rollback — nếu ghi bên trong thì chính nó cũng bị cuốn theo và
   * `attempts` không bao giờ tăng, dòng hỏng vĩnh viễn sẽ được thử lại mỗi giây mãi mãi.
   */
  async recordDispatchFailure(error: string, limit: number): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE outbox_events
      SET attempts = attempts + 1,
          last_error = ${error},
          status = CASE WHEN attempts + 1 >= ${MAX_DISPATCH_ATTEMPTS}
                        THEN 'FAILED'::"OutboxStatus"
                        ELSE 'PENDING'::"OutboxStatus" END
      WHERE id IN (
        SELECT id FROM outbox_events WHERE status = 'PENDING' ORDER BY created_at LIMIT ${limit}
      )`;
  }

  /** Dùng cho test và cho việc soi bằng tay khi có sự cố. */
  async countByStatus(status: 'PENDING' | 'DISPATCHED' | 'FAILED'): Promise<number> {
    return this.prisma.outboxEvent.count({ where: { status } });
  }
}
