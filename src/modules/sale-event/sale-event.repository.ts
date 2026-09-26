import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infra/prisma';
import type { CreateSaleEventDto } from './sale-event.dto';

/** Toàn bộ truy cập DB của module sale-event — quy tắc số 2 trong docs/architecture.md. */
@Injectable()
export class SaleEventRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createDraft(dto: CreateSaleEventDto) {
    return this.prisma.saleEvent.create({
      data: {
        name: dto.name,
        slug: dto.slug,
        startsAt: dto.startsAt,
        endsAt: dto.endsAt,
        items: {
          create: dto.items.map((item) => ({
            skuId: item.skuId,
            salePriceVnd: item.salePriceVnd,
            allocatedStock: item.allocatedStock,
            // `stock = 0` cho tới khi publish: hàng chưa rời khỏi SKU thì đợt chưa có gì bán.
            // Đặt sẵn bằng `allocatedStock` ở đây là nói dối về một thứ chưa xảy ra.
            stock: 0,
            perUserLimit: item.perUserLimit,
          })),
        },
      },
      include: { items: true },
    });
  }

  /**
   * Publish: **cắt** hàng từ `product_skus.stock` sang `sale_event_skus.stock`, trong MỘT
   * transaction cùng với việc bật cờ `is_published`.
   *
   * Vì sao phải cùng transaction: cắt xong mà chưa kịp bật cờ thì hàng đã biến khỏi SKU nhưng
   * chưa ai bán được — mất hàng im lặng. Bật cờ xong mà chưa kịp cắt thì đợt mở bán với
   * `stock = 0` — khách thấy "hết hàng" ngay giây đầu.
   *
   * Điều kiện `stock >= ?` nằm trong chính câu `UPDATE`, đúng bài học Phase 3: không đọc ra
   * rồi so trong RAM. Ở đây nó còn chặn được cả trường hợp hai người cùng bấm publish.
   *
   * Trả `null` khi đợt đã publish rồi — **không cắt lần hai**, vì cắt hai lần là trừ kho hai
   * lần cho cùng một đợt.
   */
  async publish(saleEventId: string): Promise<'OK' | 'ALREADY_PUBLISHED' | null> {
    return this.prisma.$transaction(async (tx) => {
      const event = await tx.saleEvent.findUnique({
        where: { id: saleEventId },
        include: { items: true },
      });
      if (!event) return null;

      // Bật cờ bằng `UPDATE ... WHERE is_published = false`: nếu hai người cùng bấm publish
      // thì chỉ một câu đổi được dòng, người kia thấy 0 và dừng. Không cần khoá.
      const flipped = await tx.$executeRaw`
        UPDATE sale_events SET is_published = true, updated_at = now()
        WHERE id = ${saleEventId}::uuid AND is_published = false`;

      if (flipped === 0) return 'ALREADY_PUBLISHED';

      for (const item of event.items) {
        const taken = await tx.$executeRaw`
          UPDATE product_skus
          SET stock = stock - ${item.allocatedStock}, version = version + 1, updated_at = now()
          WHERE id = ${item.skuId}::uuid AND is_active = true AND stock >= ${item.allocatedStock}`;

        if (taken === 0) {
          // Ném để **cả transaction cuộn lại**: cờ publish và những lần cắt trước đó đều
          // biến mất. Nửa vời ở đây nghĩa là vài mẫu đã mất hàng mà đợt không bán được.
          throw new AllocationFailed(item.skuId);
        }

        await tx.$executeRaw`
          UPDATE sale_event_skus SET stock = allocated_stock, updated_at = now()
          WHERE id = ${item.id}::uuid`;
      }

      return 'OK';
    });
  }

  /**
   * Đóng một đợt đã kết thúc và **trả hàng tồn về SKU** — thao tác ngược của publish.
   *
   * Vì sao cần: hàng được **cắt** khỏi SKU lúc publish (ADR-015), nên đợt kết thúc còn 7 chiếc
   * thì 7 chiếc đó **kẹt lại** ở `sale_event_skus` — không ai mua được nữa, mà kho chung cũng
   * không có. Hàng biến mất khỏi hệ thống mà không có lỗi nào báo.
   *
   * Ba hàng rào trong chính câu `UPDATE`, mỗi cái chặn một kiểu trả nhầm:
   *
   * - `is_published = true AND is_settled = false` — chưa publish thì chưa cắt, không có gì
   *   để trả; đã settle rồi mà trả lần nữa là **nhân đôi hàng từ hư không**.
   * - `now() > ends_at` — đợt còn đang bán thì rút hàng về là cướp hàng khỏi tay người mua.
   *
   * Trả `null` khi không có gì để làm — giống `cancelPendingOrder`, để người gọi thoát êm
   * thay vì ném lỗi cho một tình huống bình thường (job chạy lại trên đợt đã settle).
   */
  async settleEnded(saleEventId: string): Promise<{ skuId: string; returned: number }[] | null> {
    return this.prisma.$transaction(async (tx) => {
      const closed = await tx.$executeRaw`
        UPDATE sale_events SET is_settled = true, updated_at = now()
        WHERE id = ${saleEventId}::uuid
          AND is_published = true
          AND is_settled = false
          AND now() > ends_at`;

      if (closed === 0) return null;

      // Lấy tồn dư SAU khi cờ đã đổi được — cùng lập luận với `cancelPendingOrder`: chỉ đọc
      // số cần trả khi chắc chắn chính lần gọi NÀY là lần đóng đợt.
      const leftovers = await tx.$queryRaw<{ skuId: string; stock: number }[]>`
        SELECT sku_id AS "skuId", stock FROM sale_event_skus
        WHERE sale_event_id = ${saleEventId}::uuid AND stock > 0`;

      for (const row of leftovers) {
        await tx.$executeRaw`
          UPDATE product_skus
          SET stock = stock + ${row.stock}, version = version + 1, updated_at = now()
          WHERE id = ${row.skuId}::uuid`;
        await tx.$executeRaw`
          UPDATE sale_event_skus SET stock = 0, updated_at = now()
          WHERE sale_event_id = ${saleEventId}::uuid AND sku_id = ${row.skuId}::uuid`;
      }

      return leftovers.map((row) => ({ skuId: row.skuId, returned: row.stock }));
    });
  }

  /** Đợt đã publish, đã hết giờ, chưa settle — đầu vào của job đóng đợt. */
  async findEndedUnsettled(limit: number): Promise<string[]> {
    const rows = await this.prisma.saleEvent.findMany({
      where: { isPublished: true, isSettled: false, endsAt: { lt: new Date() } },
      select: { id: true },
      orderBy: { endsAt: 'asc' },
      take: limit,
    });
    return rows.map((row) => row.id);
  }

  async findBySlug(slug: string) {
    return this.prisma.saleEvent.findUnique({
      where: { slug },
      include: { items: { include: { sku: { include: { product: true } } } } },
    });
  }

  async findById(id: string) {
    return this.prisma.saleEvent.findUnique({ where: { id }, include: { items: true } });
  }

  /** Chỉ đợt đã publish. Đợt nháp không được lộ ra ngoài dù đang trong khung giờ. */
  async listPublished(limit: number) {
    return this.prisma.saleEvent.findMany({
      where: { isPublished: true },
      orderBy: [{ startsAt: 'asc' }],
      take: limit,
      include: { items: true },
    });
  }

  /** Đã mua bao nhiêu chiếc của mẫu này trong đợt này — để hiển thị "còn mua được mấy cái". */
  async findPurchasedQuantity(saleEventSkuId: string, userId: string): Promise<number> {
    const row = await this.prisma.saleEventPurchase.findUnique({
      where: { saleEventSkuId_userId: { saleEventSkuId, userId } },
    });
    return row?.quantity ?? 0;
  }
}

/** Lỗi nội bộ để cuộn transaction publish. Service dịch nó sang lỗi nghiệp vụ. */
export class AllocationFailed extends Error {
  constructor(readonly skuId: string) {
    super(`Không đủ hàng để cắt cho SKU ${skuId}`);
  }
}
