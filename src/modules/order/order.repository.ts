import { Injectable } from '@nestjs/common';

import type { Cursor } from '../../common';
import { PrismaService } from '../../infra/prisma';

/**
 * Toàn bộ truy cập DB của module order — quy tắc số 2 trong docs/architecture.md.
 *
 * File này cũng là **biên giới của nợ kỹ thuật đã chốt trong ADR-003**: module `order` được
 * phép ghi hai cột `stock` và `version` của bảng `product_skus` (bảng do module `product` sở
 * hữu), nhưng CHỈ ở file này và CHỈ hai cột đó. Các strategy bên `strategies/` chỉ chứa
 * *chính sách* (vòng retry, phối hợp với Redis), không chứa câu SQL nào — nếu SQL rải ra đó
 * thì nợ sẽ lan và không ai kiểm soát được ai đang ghi tồn kho.
 */
@Injectable()
export class OrderRepository {
  constructor(private readonly prisma: PrismaService) {}

  // ── Tồn kho: 3 cách trừ, dùng cho 3 chiến lược ─────────────────────────────────────────

  /**
   * **Optimistic**: đưa điều kiện vào chính câu ghi.
   *
   * Đây là câu quan trọng nhất của cả phase. Nó an toàn ngay ở Read Committed (mức mặc định
   * của Postgres) mà KHÔNG cần transaction, không cần đổi isolation level: khi câu `UPDATE`
   * này gặp dòng đang bị transaction khác khoá, Postgres **chờ**, và sau khi tx kia commit thì
   * **đánh giá lại `WHERE` trên phiên bản mới nhất** rồi mới quyết định có ghi không. Nhờ vậy
   * `stock >= quantity` không bao giờ được kiểm tra trên dữ liệu cũ.
   *
   * Trả `null` khi 0 dòng bị ghi — lúc đó CHƯA biết vì sao (không tồn tại? hết hàng?), phải
   * hỏi thêm bằng `isSkuOnSale`. Trộn hai nguyên nhân đó là bug ghi ở tech-playbook (retry 3
   * lần cho SKU đã hết hàng).
   */
  async decrementStockConditional(
    skuId: string,
    quantity: number,
  ): Promise<{ priceVnd: number } | null> {
    const rows = await this.prisma.$queryRaw<{ price_vnd: number }[]>`
      UPDATE product_skus
      SET stock = stock - ${quantity}, version = version + 1, updated_at = now()
      WHERE id = ${skuId}::uuid AND is_active = true AND stock >= ${quantity}
      RETURNING price_vnd`;

    const row = rows[0];
    return row ? { priceVnd: row.price_vnd } : null;
  }

  /**
   * **Pessimistic**: khoá dòng rồi mới đọc-kiểm-tra-ghi.
   *
   * `FOR UPDATE` **bắt buộc** nằm trong transaction interactive. Chạy nó ngoài transaction thì
   * khoá được nhả ngay khi câu lệnh kết thúc → vô tác dụng, và bug này im lặng (test đơn lẻ
   * vẫn xanh, chỉ vỡ dưới tải).
   *
   * Prisma không có API cho `FOR UPDATE` nên phải `$queryRaw` — đây chính là "chạm giới hạn của
   * ORM", bài học mà project-context.md quyết định #5 chủ động chọn để học.
   *
   * Chỉ khoá một dòng nên chưa cần lo thứ tự khoá. Khi nào một đơn có nhiều SKU thì phải khoá
   * theo `ORDER BY id` cố định, nếu không hai transaction khoá chéo nhau sẽ deadlock.
   */
  async lockAndDecrementStock(
    skuId: string,
    quantity: number,
  ): Promise<{ priceVnd: number } | { reason: 'OUT_OF_STOCK' | 'SKU_NOT_FOUND' }> {
    return this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ stock: number; price_vnd: number }[]>`
        SELECT stock, price_vnd FROM product_skus
        WHERE id = ${skuId}::uuid AND is_active = true
        FOR UPDATE`;

      const row = rows[0];
      if (!row) return { reason: 'SKU_NOT_FOUND' as const };
      // Kiểm tra trong RAM ở ĐÂY là an toàn — khác hẳn optimistic — vì dòng đang bị khoá độc
      // quyền, không ai chen vào giữa lúc đọc và lúc ghi được.
      if (row.stock < quantity) return { reason: 'OUT_OF_STOCK' as const };

      await tx.$executeRaw`
        UPDATE product_skus
        SET stock = stock - ${quantity}, version = version + 1, updated_at = now()
        WHERE id = ${skuId}::uuid`;

      return { priceVnd: row.price_vnd };
    });
  }

  /** Hoàn tồn kho (nhánh lỗi, hoặc bù trừ khi Redis đã trừ mà DB ghi không thành). */
  async incrementStock(skuId: string, quantity: number): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE product_skus
      SET stock = stock + ${quantity}, version = version + 1, updated_at = now()
      WHERE id = ${skuId}::uuid`;
  }

  /** SKU có tồn tại và đang bán không — dùng để tách "hết hàng" khỏi "không tồn tại". */
  async isSkuOnSale(skuId: string): Promise<boolean> {
    const sku = await this.prisma.productSku.findFirst({
      where: { id: skuId, isActive: true },
      select: { id: true },
    });
    return sku !== null;
  }

  /** Đọc tồn kho + giá để nạp vào Redis (chiến lược C). */
  async readSkuStock(skuId: string): Promise<{ stock: number; priceVnd: number } | null> {
    const sku = await this.prisma.productSku.findFirst({
      where: { id: skuId, isActive: true },
      select: { stock: true, priceVnd: true },
    });
    return sku ? { stock: sku.stock, priceVnd: sku.priceVnd } : null;
  }

  // ── Đơn hàng ───────────────────────────────────────────────────────────────────────────

  /**
   * Tạo đơn + item trong MỘT transaction. Trả `null` khi `Idempotency-Key` đã tồn tại.
   *
   * Chống double-submit bằng cách **để DB làm trọng tài**: cứ `INSERT`, vi phạm
   * `UNIQUE(user_id, idempotency_key)` thì bắt lỗi `P2002`. Cách sai là `SELECT` xem key có
   * chưa rồi mới `INSERT` — giữa hai bước đó request thứ hai chen vào được, và ta lại tạo ra
   * đúng cái lost update mà cả phase này đang chống.
   *
   * Transaction chỉ bọc hai lệnh ghi, không có lời gọi mạng nào bên trong (luật CLAUDE.md).
   */
  async createOrder(input: {
    userId: string;
    idempotencyKey: string;
    skuId: string;
    quantity: number;
    unitPriceVnd: number;
    expiresAt: Date;
  }) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const order = await tx.order.create({
          data: {
            userId: input.userId,
            idempotencyKey: input.idempotencyKey,
            totalVnd: input.unitPriceVnd * input.quantity,
            expiresAt: input.expiresAt,
          },
        });

        await tx.orderItem.create({
          data: {
            orderId: order.id,
            skuId: input.skuId,
            quantity: input.quantity,
            unitPriceVnd: input.unitPriceVnd,
          },
        });

        return order;
      });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  async findOrderByIdempotencyKey(userId: string, idempotencyKey: string) {
    return this.prisma.order.findUnique({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      include: { items: true },
    });
  }

  /** Tra theo id VÀ userId cùng lúc — đơn của người khác coi như không tồn tại. */
  async findOrderOfUser(orderId: string, userId: string) {
    return this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { items: true },
    });
  }

  /** Keyset pagination `(createdAt, id)` DESC, lọc theo user. Lấy dư 1 dòng như Phase 2. */
  async listOrdersOfUser(userId: string, cursor: Cursor | undefined, limit: number) {
    return this.prisma.order.findMany({
      where: {
        userId,
        ...(cursor && {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  }
}

/**
 * Nhận diện lỗi vi phạm UNIQUE của Prisma (`P2002`).
 *
 * Chỉ so `code`, KHÔNG đọc `meta.target`: hình dạng của `target` khác nhau giữa connector và
 * giữa các bản Prisma (có bản trả mảng tên cột, có bản trả tên constraint). Ở đây không cần
 * phân biệt — lệnh `INSERT` này chỉ có đúng một ràng buộc UNIQUE có thể vỡ:
 * `(user_id, idempotency_key)`.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}
