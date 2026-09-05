import { Injectable, Logger } from '@nestjs/common';

import { PrismaService, type PrismaTx } from '../../infra/prisma';

/**
 * Biến hàng đợi *at-least-once* thành *exactly-once processing*.
 *
 * Cơ chế luôn là một: `INSERT` một dấu vào `processed_events` và để **UNIQUE của DB** làm
 * trọng tài — y hệt `Idempotency-Key` ở Phase 3. Cách sai vẫn là `SELECT` xem đã xử lý chưa
 * rồi mới xử lý: hai worker chạy song song lọt qua khe giữa hai bước đó.
 *
 * Nhưng có **hai** cách dùng, và khác nhau ở chỗ hệ quả nằm trong hay ngoài DB:
 *
 * - `runOnceInTransaction` — hệ quả là câu ghi DB (đánh dấu đơn `PAID`). Dấu và hệ quả nằm
 *   trong cùng transaction ⇒ hoặc cả hai cùng có, hoặc cả hai cùng không. **Miễn phí và
 *   tuyệt đối.**
 * - `claim`/`release` — hệ quả nằm ngoài DB (gửi email). Không transaction nào bao được cả
 *   hai, nên phải **chọn** rủi ro: ghi dấu trước (có thể mất mail nếu process chết đúng khe
 *   giữa hai bước) hay gửi trước (có thể gửi hai lần). Dự án chọn *ghi dấu trước* — xem
 *   ADR-004.
 */
@Injectable()
export class IdempotencyRepository {
  private readonly logger = new Logger(IdempotencyRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Chạy `work` đúng một lần cho cặp (`eventId`, `consumer`), **trong cùng transaction với
   * dấu đã xử lý**. Trả `false` nếu sự kiện này đã được xử lý trước đó.
   */
  async runOnceInTransaction(
    eventId: string,
    consumer: string,
    work: (tx: PrismaTx) => Promise<void>,
  ): Promise<boolean> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.processedEvent.create({ data: { eventId, consumer } });
        await work(tx);
      });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) {
        this.logger.debug({ eventId, consumer }, 'Sự kiện đã xử lý — bỏ qua bản trùng');
        return false;
      }
      throw error;
    }
  }

  /**
   * Giành quyền xử lý một sự kiện có hệ quả NGOÀI DB. `false` nghĩa là người khác giành trước
   * (hoặc chính mình đã xử lý ở lần chạy trước) ⇒ không được làm gì thêm.
   */
  async claim(eventId: string, consumer: string): Promise<boolean> {
    try {
      await this.prisma.processedEvent.create({ data: { eventId, consumer } });
      return true;
    } catch (error) {
      if (isUniqueViolation(error)) return false;
      throw error;
    }
  }

  /**
   * Trả lại quyền khi công việc thất bại, để lần retry sau còn chạy được.
   *
   * Thiếu bước này thì một lỗi SMTP tạm thời sẽ khoá vĩnh viễn email đó — dấu đã ghi mà việc
   * chưa làm. Đây chính là cái giá của lựa chọn "ghi dấu trước", và nó chỉ được trả khi mã
   * còn chạy: process bị giết giữa hai bước thì email mất luôn (ADR-004 chấp nhận).
   */
  async release(eventId: string, consumer: string): Promise<void> {
    await this.prisma.processedEvent.deleteMany({ where: { eventId, consumer } });
  }
}

/** Xem `order.repository.ts` để biết vì sao chỉ so `code`, không đọc `meta.target`. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
