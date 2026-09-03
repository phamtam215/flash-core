import { Inject, Injectable, Logger } from '@nestjs/common';

import { decodeCursor, paginate } from '../../common';
import { INVENTORY_RESERVER, type InventoryReserver } from './inventory-reserver';
import type { CreateOrderDto, ListOrderQueryDto } from './order.dto';
import { OrderNotFoundError, OutOfStockError, SkuNotFoundError } from './order.errors';
import { OrderRepository } from './order.repository';

/** Đơn giữ chỗ 15 phút. Phase 3 chỉ GHI mốc này; job tự hủy khi quá hạn là Phase 4. */
const HOLD_MINUTES = 15;

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly repo: OrderRepository,
    @Inject(INVENTORY_RESERVER) private readonly reserver: InventoryReserver,
  ) {}

  /**
   * "Săn ngay" — trừ tồn kho rồi tạo đơn giữ chỗ.
   *
   * **Thứ tự reserve-trước-insert-sau là đánh đổi có chủ đích** (spec Phase 3): lần gọi lặp
   * (trùng `Idempotency-Key`) sẽ trừ kho rồi mới phát hiện trùng và phải hoàn lại. Cách ngược
   * lại (insert đơn trước) tránh được việc hoàn kho ở nhánh này, nhưng với chiến lược Redis thì
   * reserve nằm NGOÀI transaction DB nên vẫn phải bù trừ ở nhánh lỗi — không có cách nào tránh
   * hoàn toàn. Chọn một luồng chung cho cả ba chiến lược để benchmark so sánh công bằng.
   *
   * Trả kèm `created` để controller biết trả `201` (vừa tạo) hay `200` (đơn đã có sẵn).
   */
  async placeOrder(userId: string, idempotencyKey: string, dto: CreateOrderDto) {
    const reserved = await this.reserver.reserve(dto.skuId, dto.quantity);

    if (!reserved.ok) {
      if (reserved.reason === 'SKU_NOT_FOUND') throw new SkuNotFoundError();
      throw new OutOfStockError();
    }

    const expiresAt = new Date(Date.now() + HOLD_MINUTES * 60 * 1000);
    const order = await this.repo.createOrder({
      userId,
      idempotencyKey,
      skuId: dto.skuId,
      quantity: dto.quantity,
      // Snapshot price: giá vừa đọc từ DB lúc trừ kho, KHÔNG phải giá client gửi (client không
      // được gửi giá) và cũng không đọc lại lúc xem đơn.
      unitPriceVnd: reserved.unitPriceVnd,
      expiresAt,
    });

    if (!order) {
      // `Idempotency-Key` đã tồn tại ⇒ đây là lần bấm thứ hai. Hoàn lại tồn kho vừa trừ, rồi
      // trả về đúng đơn cũ. Nếu không hoàn, bấm hai lần sẽ "ăn" hai suất hàng mà chỉ có một đơn.
      await this.reserver.release(dto.skuId, dto.quantity);

      const existing = await this.repo.findOrderByIdempotencyKey(userId, idempotencyKey);
      if (!existing) {
        // Không tìm thấy đơn dù vừa vỡ UNIQUE: chỉ xảy ra nếu đơn bị xoá giữa hai bước. Không
        // nuốt — để lỗi bay lên filter chung.
        throw new Error('Idempotency-Key trùng nhưng không tìm thấy đơn cũ');
      }

      this.logger.log({ orderId: existing.id, userId }, 'Idempotency-Key trùng — trả lại đơn cũ');
      return { order: existing, created: false };
    }

    this.logger.log(
      { orderId: order.id, userId, skuId: dto.skuId, strategy: this.reserver.name, attempts: reserved.attempts },
      'Đặt đơn thành công',
    );
    return { order, created: true };
  }

  async listMyOrders(userId: string, query: ListOrderQueryDto) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = await this.repo.listOrdersOfUser(userId, cursor, query.limit);
    return paginate(rows, query.limit);
  }

  /** Đơn của người khác coi như không tồn tại — 404, không 403. */
  async getMyOrder(orderId: string, userId: string) {
    const order = await this.repo.findOrderOfUser(orderId, userId);
    if (!order) throw new OrderNotFoundError();
    return order;
  }
}
