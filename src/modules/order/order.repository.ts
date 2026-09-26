import { Injectable } from '@nestjs/common';

import { getCorrelationId, type Cursor } from '../../common';
import { PrismaService, type PrismaTx } from '../../infra/prisma';

/**
 * Toàn bộ truy cập DB của module order — quy tắc số 2 trong docs/architecture.md.
 *
 * File này cũng là **biên giới của nợ kỹ thuật đã chốt trong ADR-003**: module `order` được
 * phép ghi hai cột `stock` và `version` của bảng `product_skus` (bảng do module `product` sở
 * hữu), nhưng CHỈ ở file này và CHỈ hai cột đó. Các strategy bên `strategies/` chỉ chứa
 * *chính sách* (vòng retry, phối hợp với Redis), không chứa câu SQL nào — nếu SQL rải ra đó
 * thì nợ sẽ lan và không ai kiểm soát được ai đang ghi tồn kho.
 */
/**
 * Ai đang huỷ đơn — và điều kiện kèm theo của người đó.
 *
 * `EXPIRED`: delayed job và sweeper, không biết user nào, nhưng **bắt buộc** đơn phải quá hạn.
 * `BY_USER`: người mua bấm huỷ, **không** đòi quá hạn, nhưng phải đúng chủ đơn.
 */
export type CancelScope = { kind: 'EXPIRED' } | { kind: 'BY_USER'; userId: string };

/** Dòng hàng của một đơn vừa huỷ, kèm đủ thông tin để trả kho về đúng chỗ. */
export type CancelledOrderItems = {
  skuId: string;
  quantity: number;
  saleEventSkuId: string | null;
  userId: string;
}[];

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
   * Tạo đơn + item + **sự kiện hộp thư đi** trong MỘT transaction. Trả `null` khi
   * `Idempotency-Key` đã tồn tại.
   *
   * Chống double-submit bằng cách **để DB làm trọng tài**: cứ `INSERT`, vi phạm
   * `UNIQUE(user_id, idempotency_key)` thì bắt lỗi `P2002`. Cách sai là `SELECT` xem key có
   * chưa rồi mới `INSERT` — giữa hai bước đó request thứ hai chen vào được, và ta lại tạo ra
   * đúng cái lost update mà cả phase này đang chống.
   *
   * **Dòng `outbox_events` nằm trong cùng transaction — đó LÀ Outbox pattern** (Phase 4).
   * Cách sai là `await tx.order.create(...)` xong rồi `await queue.add(...)` bên ngoài: hai
   * hệ thống khác nhau, không transaction nào bao được cả hai (*dual write*), và `try/catch`
   * không cứu được vì lệnh đầu đã commit rồi. Đơn trùng key thì cả ba lệnh cùng bị huỷ, nên
   * không bao giờ có "đơn không tạo được mà vẫn gửi email".
   *
   * Transaction chỉ bọc ba lệnh ghi, không có lời gọi mạng nào bên trong (luật CLAUDE.md).
   */
  async createOrder(input: {
    userId: string;
    idempotencyKey: string;
    skuId: string;
    quantity: number;
    unitPriceVnd: number;
    expiresAt: Date;
    /** Có giá trị = mua trong đợt sale; huỷ đơn sẽ trả kho về đợt, không về SKU. */
    saleEventSkuId?: string;
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
            saleEventSkuId: input.saleEventSkuId ?? null,
            quantity: input.quantity,
            unitPriceVnd: input.unitPriceVnd,
          },
        });

        await tx.outboxEvent.create({
          data: {
            aggregate: 'order',
            aggregateId: order.id,
            type: 'order.placed',
            payload: {
              orderId: order.id,
              userId: input.userId,
              totalVnd: order.totalVnd,
              // Id của request đang chạy, ghi luôn vào hộp thư đi. Đây là mắt xích nối log
              // của lúc ĐẶT đơn với log của lúc GỬI email — hai việc cách nhau vài giây và
              // xảy ra ở hai process khác nhau (Phase 6).
              correlationId: getCorrelationId() ?? null,
            },
          },
        });

        return order;
      });
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  // ── Đặt hàng trong ĐỢT SALE (Phase 8) ──────────────────────────────────────────────────

  /**
   * Giữ một suất trong quota của người mua.
   *
   * **Không khoá gì cả — và đó là điểm học của Phase 8.** Tồn kho là MỘT dòng nóng mà cả
   * nghìn người tranh, nên buộc phải xếp hàng. Quota là MỘT dòng cho MỖI người: hai người
   * khác nhau không bao giờ chạm cùng dòng, nên tranh chấp duy nhất là giữa các lần bấm của
   * **chính người đó**. Một câu upsert có điều kiện làm trọn việc:
   *
   * - Chưa có dòng ⇒ `INSERT` thành công (đã kiểm `quantity <= limit` ở `VALUES`).
   * - Có rồi ⇒ `DO UPDATE` chỉ chạy khi tổng mới **không vượt** giới hạn.
   * - Không dòng nào trả về ⇒ vượt giới hạn.
   *
   * Cùng triết lý "đưa điều kiện vào chính câu ghi" với Phase 3, nhưng **cơ chế khác** — hình
   * dạng tranh chấp quyết định công cụ, không phải thói quen.
   */
  async claimUserQuota(
    saleEventSkuId: string,
    userId: string,
    quantity: number,
  ): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ quantity: number }[]>`
      INSERT INTO sale_event_purchases (sale_event_sku_id, user_id, quantity)
      SELECT ${saleEventSkuId}::uuid, ${userId}::uuid, ${quantity}
      FROM sale_event_skus s
      WHERE s.id = ${saleEventSkuId}::uuid AND ${quantity} <= s.per_user_limit
      ON CONFLICT (sale_event_sku_id, user_id) DO UPDATE
        SET quantity = sale_event_purchases.quantity + ${quantity}
        WHERE sale_event_purchases.quantity + ${quantity}
              <= (SELECT per_user_limit FROM sale_event_skus WHERE id = ${saleEventSkuId}::uuid)
      RETURNING quantity`;

    return rows.length > 0;
  }

  /** Trả lại suất quota đã giữ — dùng khi bước trừ tồn kho phía sau thất bại. */
  async releaseUserQuota(saleEventSkuId: string, userId: string, quantity: number): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE sale_event_purchases SET quantity = quantity - ${quantity}
      WHERE sale_event_sku_id = ${saleEventSkuId}::uuid AND user_id = ${userId}::uuid`;
  }

  /**
   * Trừ tồn kho của đợt — **và kiểm khung giờ trong CÙNG câu lệnh**.
   *
   * `now()` ở đây là đồng hồ của **Postgres**, không phải của Node. Kiểm `Date.now()` trong
   * app rồi mới gửi `UPDATE` là lặp lại đúng sai lầm `if (stock > 0) stock--` của Phase 3 —
   * điều kiện được đánh giá ở một thời điểm đã cũ, tại một nơi không phải nơi quyết định. Ở
   * đây còn tệ hơn vì **nhiều instance là nhiều đồng hồ**: máy nào nhanh 2 giây sẽ mở bán sớm
   * 2 giây, và đúng 2 giây đó chỉ nó phục vụ — ai bấm trúng nó thì mua được trước cả nghìn
   * người khác, mà không ai lần ra được vì sao.
   *
   * Trả `null` khi 0 dòng bị ghi. Lúc đó CHƯA biết vì sao (hết hàng? chưa tới giờ? chưa
   * publish?) — người gọi phải hỏi thêm, giống `decrementStockConditional` của Phase 3.
   */
  async decrementSaleEventStock(
    saleEventSkuId: string,
    quantity: number,
  ): Promise<{ salePriceVnd: number; skuId: string } | null> {
    const rows = await this.prisma.$queryRaw<{ sale_price_vnd: number; sku_id: string }[]>`
      UPDATE sale_event_skus s
      SET stock = s.stock - ${quantity}, updated_at = now()
      FROM sale_events e
      WHERE s.id = ${saleEventSkuId}::uuid
        AND e.id = s.sale_event_id
        AND s.stock >= ${quantity}
        AND e.is_published = true
        AND now() >= e.starts_at
        AND now() <= e.ends_at
      RETURNING s.sale_price_vnd, s.sku_id`;

    const row = rows[0];
    return row ? { salePriceVnd: row.sale_price_vnd, skuId: row.sku_id } : null;
  }

  /** Hoàn tồn kho về ĐỢT (không phải về SKU — hàng đã cắt ra khỏi SKU từ lúc publish). */
  async incrementSaleEventStock(saleEventSkuId: string, quantity: number): Promise<void> {
    await this.prisma.$executeRaw`
      UPDATE sale_event_skus SET stock = stock + ${quantity}, updated_at = now()
      WHERE id = ${saleEventSkuId}::uuid`;
  }

  /**
   * Vì sao `decrementSaleEventStock` trả `null` — dùng để tách ba lý do thành ba mã lỗi khác
   * nhau. Gộp chúng thành một `409` là mất luôn câu đáng hỏi nhất lúc có sự cố: *bán hết
   * hàng, hay đang có bot bấm, hay người ta vào sớm?*
   */
  async diagnoseSaleEventSku(
    saleEventSkuId: string,
  ): Promise<'NOT_FOUND' | 'NOT_OPEN' | 'OUT_OF_STOCK'> {
    const rows = await this.prisma.$queryRaw<
      { open: boolean; in_stock: boolean }[]
    >`
      SELECT (e.is_published AND now() >= e.starts_at AND now() <= e.ends_at) AS open,
             (s.stock > 0) AS in_stock
      FROM sale_event_skus s JOIN sale_events e ON e.id = s.sale_event_id
      WHERE s.id = ${saleEventSkuId}::uuid`;

    const row = rows[0];
    if (!row) return 'NOT_FOUND';
    if (!row.open) return 'NOT_OPEN';
    return 'OUT_OF_STOCK';
  }

  /**
   * Huỷ một đơn **đang `PENDING`** và trả về các dòng hàng cần hoàn kho, hoặc `null` nếu
   * không có gì để huỷ.
   *
   * Điều kiện nằm trong chính câu `UPDATE`, không kiểm tra trong RAM rồi mới ghi — cùng một
   * bài học với `decrementStockConditional` ở Phase 3. Ở đây nó còn quan trọng hơn vì có
   * **ba** đường cùng gọi (delayed job, sweeper, và người mua bấm huỷ): 0 dòng bị ảnh hưởng
   * nghĩa là đường kia đã xử lý xong, và ta phải thoát êm — không throw, và tuyệt đối không
   * trả kho lần hai.
   *
   * **`status = 'PENDING'` mới là điều kiện chống trả kho hai lần, KHÔNG phải `expires_at`.**
   * Đó là lý do nhánh `BY_USER` bỏ được `expires_at` mà vẫn an toàn y hệt: dù người mua bấm
   * huỷ lúc đơn còn 14 phút, câu `UPDATE` này vẫn chỉ đổi được đúng một lần.
   *
   * Hai nhánh cố tình nằm chung một hàm thay vì copy thành hai: hai câu SQL gần giống nhau
   * cùng ghi vào đường trả tồn kho là cách chắc chắn nhất để một ngày nào đó chỉ một trong
   * hai được sửa.
   *
   * Đọc `order_items` trong CÙNG transaction để người gọi biết trả lại bao nhiêu — query lại
   * ở ngoài thì giữa hai lần đơn có thể đã đổi.
   */
  async cancelPendingOrder(
    orderId: string,
    scope: CancelScope,
  ): Promise<CancelledOrderItems | null> {
    return this.prisma.$transaction(async (tx) => {
      // Hai câu tách riêng chứ không ghép điều kiện bằng biến: `$executeRaw` là tagged
      // template nên mọi tham số đều được tham số hoá, còn nối chuỗi để "dùng chung một câu"
      // sẽ mở đường cho SQL injection ngay ở câu ghi nhạy cảm nhất của hệ thống.
      const updated =
        scope.kind === 'EXPIRED'
          ? await tx.$executeRaw`
              UPDATE orders
              SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
              WHERE id = ${orderId}::uuid AND status = 'PENDING' AND expires_at <= now()`
          : await tx.$executeRaw`
              UPDATE orders
              SET status = 'CANCELLED', cancelled_at = now(), updated_at = now()
              WHERE id = ${orderId}::uuid AND status = 'PENDING' AND user_id = ${scope.userId}::uuid`;

      if (updated === 0) return null;

      // Kèm `saleEventSkuId` để người gọi biết trả kho về ĐÂU: về đợt hay về SKU. Trả nhầm
      // chỗ nghĩa là hàng của đợt chui về kho chung, và đợt sau bán hụt.
      //
      // Kèm cả `userId` vì trả suất quota cần biết CHÍNH XÁC của ai — suy ra bằng cách đoán
      // "đơn mới nhất của mẫu này" là sai ngay khi có hai người cùng huỷ.
      const rows = await tx.$queryRaw<
        { skuId: string; quantity: number; saleEventSkuId: string | null; userId: string }[]
      >`
        SELECT i.sku_id AS "skuId", i.quantity, i.sale_event_sku_id AS "saleEventSkuId",
               o.user_id AS "userId"
        FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE i.order_id = ${orderId}::uuid`;

      return rows;
    });
  }

  /**
   * Đọc trạng thái đơn của chính user — dùng để phân biệt ba lý do khiến
   * `cancelPendingOrder` trả `null`: đơn không tồn tại (hoặc của người khác), đã `CANCELLED`,
   * hay đã `PAID`. Chỉ chạy ở nhánh lỗi nên không nằm trên đường nóng.
   */
  async findOrderStatusOfUser(
    orderId: string,
    userId: string,
  ): Promise<{ status: string } | null> {
    const rows = await this.prisma.$queryRaw<{ status: string }[]>`
      SELECT status::text FROM orders WHERE id = ${orderId}::uuid AND user_id = ${userId}::uuid`;
    return rows[0] ?? null;
  }

  /** Danh sách đơn `PENDING` đã quá hạn — đầu vào của sweeper. Đi thẳng theo index `[status, expires_at]`. */
  async findExpiredPendingOrderIds(limit: number): Promise<string[]> {
    const rows = await this.prisma.order.findMany({
      where: { status: 'PENDING', expiresAt: { lte: new Date() } },
      select: { id: true },
      orderBy: { expiresAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => row.id);
  }

  /**
   * Đánh dấu đơn đã trả tiền. Trả `false` nếu đơn không còn `PENDING` — người gọi đọc lại
   * trạng thái thật để quyết định (đã `PAID` thì thôi, `CANCELLED` thì phải ghi yêu cầu hoàn
   * tiền). Nhận `tx` để dùng chung transaction với dấu idempotent.
   */
  async markPaid(tx: PrismaTx, orderId: string, paymentIntentId: string): Promise<boolean> {
    const updated = await tx.$executeRaw`
      UPDATE orders
      SET status = 'PAID', paid_at = now(), payment_intent_id = ${paymentIntentId}, updated_at = now()
      WHERE id = ${orderId}::uuid AND status = 'PENDING'`;
    return updated > 0;
  }

  /** Đọc trạng thái + tổng tiền của đơn, không giới hạn theo user (worker không có user). */
  async findOrderForPayment(tx: PrismaTx, orderId: string) {
    return tx.order.findUnique({
      where: { id: orderId },
      select: { id: true, status: true, totalVnd: true, userId: true },
    });
  }

  /**
   * Ghi một yêu cầu hoàn tiền. KHÔNG tự hoàn — chỉ để lại hồ sơ đầy đủ để quy trình nghiệp vụ
   * xử lý, đúng tinh thần "tiền thật đã chuyển thì hệ thống không được im lặng".
   *
   * `UNIQUE(payment_intent_id)` chặn webhook lặp tạo hai yêu cầu. Va UNIQUE ở đây là chuyện
   * bình thường (cổng gửi lại), nên nuốt êm bằng `skipDuplicates`-style try/catch ở người gọi.
   */
  async createRefundRequest(
    tx: PrismaTx,
    input: {
      orderId: string;
      paymentIntentId: string;
      amountVnd: number;
      reason: string;
      correlationId?: string;
    },
  ): Promise<void> {
    await tx.refundRequest.create({ data: input });
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
