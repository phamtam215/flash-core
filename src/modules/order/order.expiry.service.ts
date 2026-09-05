import { Inject, Injectable, Logger } from '@nestjs/common';

import { INVENTORY_RESERVER, type InventoryReserver } from './inventory-reserver';
import { OrderRepository } from './order.repository';

/** Sweeper xử lý tối đa ngần này đơn mỗi vòng, để một lần quét không chiếm worker quá lâu. */
const SWEEP_BATCH = 100;

/**
 * Huỷ đơn quá hạn giữ chỗ và trả hàng về kho.
 *
 * **Có HAI đường vào cùng một hàm, và đó là chủ ý** (spec Phase 4, câu hỏi mở #3):
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
    @Inject(INVENTORY_RESERVER) private readonly reserver: InventoryReserver,
  ) {}

  /** Trả `true` nếu chính lần gọi NÀY huỷ đơn (và đã trả kho); `false` nếu không có gì để làm. */
  async cancelExpired(orderId: string): Promise<boolean> {
    const items = await this.repo.cancelIfExpired(orderId);

    if (items === null) {
      // Đơn đã `PAID`, đã `CANCELLED`, hoặc chưa tới hạn. Đường kia xử lý trước rồi.
      this.logger.debug({ orderId }, 'Không có gì để huỷ — bỏ qua');
      return false;
    }

    // Trả kho SAU khi `UPDATE` đã commit và chỉ khi nó thật sự đổi được trạng thái. Đảo thứ
    // tự (trả kho trước) sẽ trả hai lần khi hai đường cùng chạy — chính là bug
    // "tồn kho bị trả về kho hai lần" ở tech-playbook §Phase 4.
    for (const item of items) {
      await this.reserver.release(item.skuId, item.quantity);
    }

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
