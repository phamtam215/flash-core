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
