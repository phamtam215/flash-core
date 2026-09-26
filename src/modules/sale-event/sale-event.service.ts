import { Injectable, Logger } from '@nestjs/common';

import type { CreateSaleEventDto } from './sale-event.dto';
import { saleEventStatus } from './sale-event.dto';
import {
  NotEnoughStockToAllocateError,
  SaleEventAlreadyPublishedError,
  SaleEventNotFoundError,
  SaleEventSlugTakenError,
} from './sale-event.errors';
import { AllocationFailed, SaleEventRepository } from './sale-event.repository';

const DUPLICATE_KEY = 'P2002';

@Injectable()
export class SaleEventService {
  private readonly logger = new Logger(SaleEventService.name);

  constructor(private readonly repo: SaleEventRepository) {}

  /** Tạo ở trạng thái nháp. Hàng chưa rời khỏi SKU cho tới khi publish. */
  async create(dto: CreateSaleEventDto) {
    try {
      return await this.repo.createDraft(dto);
    } catch (error) {
      // DB là trọng tài cho `slug` trùng — cùng cách làm với `Idempotency-Key` (ADR-011):
      // cứ ghi rồi bắt `P2002`, không đọc-ra-kiểm-rồi-ghi (race condition).
      if (isDuplicateKey(error)) throw new SaleEventSlugTakenError(dto.slug);
      throw error;
    }
  }

  /**
   * Publish: bật cờ **và** cắt hàng khỏi SKU, trong MỘT transaction.
   *
   * Vì sao phải cùng transaction: cắt xong mà chưa kịp bật cờ thì hàng đã biến khỏi SKU nhưng
   * chưa ai bán được — **mất hàng im lặng**. Bật cờ xong mà chưa kịp cắt thì đợt mở bán với
   * `stock = 0` — khách thấy "hết hàng" ngay giây đầu.
   *
   * Tách khỏi `create` có chủ ý: tạo đợt là soạn nội dung, publish là **động vào tồn kho
   * thật**. Gộp hai việc thì mỗi lần sửa mô tả cũng phải nghĩ về kho.
   *
   * Đây là thao tác DUY NHẤT của module này ghi vào `product_skus`, và chỉ ghi đúng
   * `stock`/`version` — cùng phạm vi ADR-003 đã mở cho `order`. Ghi rõ ở ADR-015 để nợ không lan.
   */
  async publish(saleEventId: string) {
    const result = await this.repo.publish(saleEventId).catch((error: unknown) => {
      if (error instanceof AllocationFailed) throw new NotEnoughStockToAllocateError(error.skuId);
      throw error;
    });

    if (result === null) throw new SaleEventNotFoundError();
    if (result === 'ALREADY_PUBLISHED') throw new SaleEventAlreadyPublishedError();

    this.logger.log({ saleEventId }, 'Đã publish đợt sale và cắt hàng khỏi SKU');
    return this.repo.findById(saleEventId);
  }

  /**
   * Đóng mọi đợt đã hết giờ và trả hàng tồn về SKU. Chạy định kỳ ở worker.
   *
   * Đây là **thao tác ngược của publish**, và nó tồn tại vì chính quyết định cắt hàng
   * (ADR-015): đợt kết thúc còn 7 chiếc thì 7 chiếc đó kẹt lại ở `sale_event_skus` — không ai
   * mua được nữa, mà kho chung cũng không có. **Hàng biến mất khỏi hệ thống mà không có lỗi
   * nào báo** — đúng loại sự cố im lặng nhất.
   *
   * Idempotent nhờ cờ `is_settled` nằm trong chính câu `UPDATE`: chạy chồng hai lần thì lần
   * sau đổi 0 dòng và thoát êm, không trả hàng lần hai.
   */
  async settleEndedEvents(limit = 50): Promise<{ events: number; returned: number }> {
    const ids = await this.repo.findEndedUnsettled(limit);
    if (ids.length === 0) return { events: 0, returned: 0 };

    let events = 0;
    let returned = 0;

    for (const id of ids) {
      const result = await this.repo.settleEnded(id);
      // `null` = đường khác đã đóng đợt này trước. Không phải lỗi, thoát êm — cùng lập luận
      // với `cancelPendingOrder` khi hai đường cùng huỷ một đơn.
      if (!result) continue;

      events += 1;
      returned += result.reduce((sum, row) => sum + row.returned, 0);
    }

    if (events > 0) {
      this.logger.log({ events, returned }, 'Đã đóng đợt sale hết giờ và trả hàng tồn về kho chung');
    }
    return { events, returned };
  }

  /** Danh sách đợt đã publish, kèm trạng thái TÍNH RA tại thời điểm đọc. */
  async listPublished(limit = 20) {
    const events = await this.repo.listPublished(limit);
    const now = new Date();
    return events.map((event) => ({
      id: event.id,
      name: event.name,
      slug: event.slug,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      status: saleEventStatus(event, now),
      itemCount: event.items.length,
    }));
  }

  /**
   * Chi tiết một đợt. Kèm `remainingForUser` nếu biết người đang xem là ai — để giao diện
   * hiện "bạn còn mua được 1 chiếc" thay vì để người ta bấm rồi mới nhận `409`.
   */
  async detail(slug: string, userId?: string) {
    const event = await this.repo.findBySlug(slug);
    if (!event || !event.isPublished) throw new SaleEventNotFoundError();

    const items = await Promise.all(
      event.items.map(async (item) => ({
        id: item.id,
        skuId: item.skuId,
        productName: item.sku.product.name,
        size: item.sku.size,
        color: item.sku.color,
        salePriceVnd: item.salePriceVnd,
        originalPriceVnd: item.sku.priceVnd,
        stock: item.stock,
        perUserLimit: item.perUserLimit,
        remainingForUser: userId
          ? Math.max(0, item.perUserLimit - (await this.repo.findPurchasedQuantity(item.id, userId)))
          : null,
      })),
    );

    return {
      id: event.id,
      name: event.name,
      slug: event.slug,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      status: saleEventStatus(event),
      items,
    };
  }
}

function isDuplicateKey(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === DUPLICATE_KEY
  );
}
