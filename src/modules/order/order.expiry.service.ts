import { Inject, Injectable, Logger } from '@nestjs/common';

import { MetricsService } from '../../infra/metrics';
import { INVENTORY_RESERVER, type InventoryReserver } from './inventory-reserver';
import { OrderRepository } from './order.repository';

/** Sweeper xử lý tối đa ngần này đơn mỗi vòng, để một lần quét không chiếm worker quá lâu. */
const SWEEP_BATCH = 100;

/**
 * Huỷ đơn quá hạn giữ chỗ và trả hàng về kho.
 *
 * **Có HAI đường vào cùng một hàm, và đó là chủ ý** (spec Phase 4, câu hỏi mở #3):
 *
 * (Từ 2026-09-21 có **đường thứ ba**: người mua tự bấm huỷ — `OrderService.cancelMyOrder`.
 * Nó dùng chung `repo.cancelPendingOrder` với `scope` khác, nên lập luận idempotent dưới đây
 * bao luôn cả nó.)
 *
 * - `order.expire` — delayed job hẹn sẵn lúc tạo đơn. Đúng giờ, nhưng nằm trong Redis: mất
 *   Redis, job bị xoá nhầm, hoặc worker chết đúng lúc là đơn treo `PENDING` vĩnh viễn.
 * - `order.expire.sweep` — quét DB mỗi 60 giây. Chậm hơn, nhưng **DB mới là sự thật**.
 *
 * Hai đường cùng chạy nghĩa là `cancelExpired` **bắt buộc** phải idempotent, không phải "nên".
 * Đó là lý do nó tồn tại dưới dạng này thay vì hai hàm riêng — và là nội dung của test #8.
 */
@Injectable()
export class OrderExpiryService {
  private readonly logger = new Logger(OrderExpiryService.name);

  constructor(
    private readonly repo: OrderRepository,
    private readonly metrics: MetricsService,
    @Inject(INVENTORY_RESERVER) private readonly reserver: InventoryReserver,
  ) {}

  /** Trả `true` nếu chính lần gọi NÀY huỷ đơn (và đã trả kho); `false` nếu không có gì để làm. */
  async cancelExpired(orderId: string): Promise<boolean> {
    const items = await this.repo.cancelPendingOrder(orderId, { kind: 'EXPIRED' });

    if (items === null) {
      // Đơn đã `PAID`, đã `CANCELLED`, hoặc chưa tới hạn. Đường kia xử lý trước rồi.
      this.logger.debug({ orderId }, 'Không có gì để huỷ — bỏ qua');
      return false;
    }

    // Trả kho SAU khi `UPDATE` đã commit và chỉ khi nó thật sự đổi được trạng thái. Đảo thứ
    // tự (trả kho trước) sẽ trả hai lần khi hai đường cùng chạy — chính là bug
    // "tồn kho bị trả về kho hai lần" ở tech-playbook §Phase 4.
    for (const item of items) {
      await releaseStock(this.repo, this.reserver, item);
    }

    this.metrics.ordersCancelled.inc({ by: 'expiry' });
    this.logger.log({ orderId, items: items.length }, 'Đã huỷ đơn quá hạn và trả hàng về kho');
    return true;
  }

  /** Lưới an toàn: quét DB tìm đơn quá hạn mà delayed job không chạy. Trả số đơn đã huỷ. */
  async sweepExpired(): Promise<number> {
    const ids = await this.repo.findExpiredPendingOrderIds(SWEEP_BATCH);
    if (ids.length === 0) return 0;

    let cancelled = 0;
    for (const id of ids) {
      if (await this.cancelExpired(id)) cancelled += 1;
    }

    if (cancelled > 0) this.logger.warn({ cancelled }, 'Sweeper đã dọn đơn quá hạn mà delayed job bỏ sót');
    return cancelled;
  }
}

/**
 * Trả tồn kho về **đúng nơi nó được lấy ra**.
 *
 * Đơn mua trong đợt sale thì hàng đã được **cắt khỏi `product_skus` từ lúc publish** (ADR-015),
 * nên trả nó về SKU là làm hàng của đợt chui về kho chung — đợt sau bán hụt đúng số đó, và
 * không có lỗi nào báo. Kèm theo phải trả cả **suất quota**, nếu không người mua huỷ đơn rồi
 * không mua lại được nữa.
 */
export async function releaseStock(
  repo: OrderRepository,
  reserver: InventoryReserver,
  item: { skuId: string; quantity: number; saleEventSkuId: string | null; userId: string },
): Promise<void> {
  if (item.saleEventSkuId) {
    await repo.incrementSaleEventStock(item.saleEventSkuId, item.quantity);
    await repo.releaseUserQuota(item.saleEventSkuId, item.userId, item.quantity);
    return;
  }
  await reserver.release(item.skuId, item.quantity);
}
