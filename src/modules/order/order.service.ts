import { Inject, Injectable, Logger } from '@nestjs/common';

import { decodeCursor, getCorrelationId, paginate } from '../../common';
import { ENV, type Env } from '../../config';
import { MetricsService } from '../../infra/metrics';
import { JOB, QueueService, type OrderExpirePayload } from '../../infra/queue';
import { INVENTORY_RESERVER, type InventoryReserver } from './inventory-reserver';
import type { CreateOrderDto, ListOrderQueryDto } from './order.dto';
import {
  OrderNotCancellableError,
  OrderNotFoundError,
  OutOfStockError,
  PerUserLimitReachedError,
  SaleNotOpenError,
  SkuNotFoundError,
} from './order.errors';
import { releaseStock } from './order.expiry.service';
import { OrderRepository } from './order.repository';

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly repo: OrderRepository,
    private readonly queue: QueueService,
    private readonly metrics: MetricsService,
    @Inject(INVENTORY_RESERVER) private readonly reserver: InventoryReserver,
    @Inject(ENV) private readonly env: Env,
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
    // Zod đã bảo đảm đúng một trong hai có giá trị (`order.dto.ts` §refine).
    return dto.saleEventSkuId
      ? this.placeSaleEventOrder(userId, idempotencyKey, dto.saleEventSkuId, dto.quantity)
      : this.placeDirectOrder(userId, idempotencyKey, dto.skuId as string, dto.quantity);
  }

  /** Mua giá gốc thẳng trên SKU — đường của Phase 3, không đổi. */
  private async placeDirectOrder(
    userId: string,
    idempotencyKey: string,
    skuId: string,
    quantity: number,
  ) {
    const stopReserveTimer = this.metrics.reserveDuration.startTimer({ strategy: this.reserver.name });
    const reserved = await this.reserver.reserve(skuId, quantity);
    stopReserveTimer();

    if (!reserved.ok) {
      if (reserved.reason === 'SKU_NOT_FOUND') {
        this.metrics.ordersPlaced.inc({ result: 'sku_not_found' });
        throw new SkuNotFoundError();
      }
      this.metrics.ordersPlaced.inc({ result: 'out_of_stock' });
      throw new OutOfStockError();
    }

    return this.finishOrder({
      userId,
      idempotencyKey,
      skuId,
      quantity,
      unitPriceVnd: reserved.unitPriceVnd,
      onDuplicate: () => this.reserver.release(skuId, quantity),
      strategy: this.reserver.name,
      attempts: reserved.attempts,
    });
  }

  /**
   * Mua trong một đợt sale (Phase 8).
   *
   * **Thứ tự quota-trước-tồn-kho-sau là có tính toán.** Nhánh nào hỏng cũng phải bù trừ nhánh
   * kia, nên thứ tự không quyết định tính đúng — nó quyết định **tải lên dòng nóng**. Một
   * người đã mua đủ suất thì **luôn luôn** bị từ chối, biết trước mà không cần hỏi tồn kho;
   * kiểm quota trước nghĩa là những request chắc chắn hỏng **không bao giờ chạm vào dòng tồn
   * kho đang có nghìn người tranh**. Dưới kịch bản thật (bot bấm 50 lần) đây là khác biệt
   * đáng kể.
   */
  private async placeSaleEventOrder(
    userId: string,
    idempotencyKey: string,
    saleEventSkuId: string,
    quantity: number,
  ) {
    const claimed = await this.repo.claimUserQuota(saleEventSkuId, userId, quantity);
    if (!claimed) {
      this.metrics.ordersPlaced.inc({ result: 'per_user_limit' });
      throw new PerUserLimitReachedError();
    }

    const stopReserveTimer = this.metrics.reserveDuration.startTimer({ strategy: 'sale-event' });
    const reserved = await this.repo.decrementSaleEventStock(saleEventSkuId, quantity);
    stopReserveTimer();

    if (!reserved) {
      // Trả suất vừa giữ TRƯỚC khi ném lỗi — quên bước này thì người mua bị trừ suất cho một
      // đơn không bao giờ tồn tại, và họ không mua lại được nữa.
      await this.repo.releaseUserQuota(saleEventSkuId, userId, quantity);

      const reason = await this.repo.diagnoseSaleEventSku(saleEventSkuId);
      if (reason === 'NOT_FOUND') {
        this.metrics.ordersPlaced.inc({ result: 'sku_not_found' });
        throw new SkuNotFoundError();
      }
      if (reason === 'NOT_OPEN') {
        this.metrics.ordersPlaced.inc({ result: 'sale_not_open' });
        throw new SaleNotOpenError();
      }
      this.metrics.ordersPlaced.inc({ result: 'out_of_stock' });
      throw new OutOfStockError();
    }

    return this.finishOrder({
      userId,
      idempotencyKey,
      skuId: reserved.skuId,
      saleEventSkuId,
      quantity,
      unitPriceVnd: reserved.salePriceVnd,
      onDuplicate: async () => {
        await this.repo.incrementSaleEventStock(saleEventSkuId, quantity);
        await this.repo.releaseUserQuota(saleEventSkuId, userId, quantity);
      },
      strategy: 'sale-event',
      attempts: 1,
    });
  }

  /**
   * Phần chung của hai đường: tạo đơn, xử lý `Idempotency-Key` trùng, hẹn lịch tự huỷ.
   *
   * Gộp lại vì đây đúng là phần **không** khác nhau — tách ra thì một ngày nào đó chỉ một
   * trong hai đường được sửa, và bug sẽ nằm ở đường ít ai chạy hơn.
   */
  private async finishOrder(input: {
    userId: string;
    idempotencyKey: string;
    skuId: string;
    saleEventSkuId?: string;
    quantity: number;
    unitPriceVnd: number;
    onDuplicate: () => Promise<void>;
    strategy: string;
    attempts: number;
  }) {
    const expiresAt = new Date(Date.now() + this.env.ORDER_HOLD_MINUTES * 60 * 1000);
    const order = await this.repo.createOrder({
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
      skuId: input.skuId,
      saleEventSkuId: input.saleEventSkuId,
      quantity: input.quantity,
      // Snapshot price: giá vừa đọc từ DB lúc trừ kho, KHÔNG phải giá client gửi.
      unitPriceVnd: input.unitPriceVnd,
      expiresAt,
    });

    if (!order) {
      // `Idempotency-Key` đã tồn tại ⇒ lần bấm thứ hai. Hoàn lại thứ vừa giữ, rồi trả đơn cũ.
      await input.onDuplicate();

      const existing = await this.repo.findOrderByIdempotencyKey(input.userId, input.idempotencyKey);
      if (!existing) throw new Error('Idempotency-Key trùng nhưng không tìm thấy đơn cũ');

      this.metrics.ordersPlaced.inc({ result: 'duplicate' });
      this.logger.log({ orderId: existing.id, userId: input.userId }, 'Idempotency-Key trùng — trả lại đơn cũ');
      return { order: existing, created: false };
    }

    try {
      await this.queue.add<OrderExpirePayload>(
        JOB.ORDER_EXPIRE,
        { orderId: order.id, correlationId: getCorrelationId() },
        {
          delay: this.env.ORDER_HOLD_MINUTES * 60 * 1000,
          // Dấu gạch nối, KHÔNG phải dấu hai chấm: BullMQ từ chối `jobId` chứa `:`. Bản đầu
          // viết `expire:${id}` và MỌI đơn đều không hẹn được lịch — lỗi bị `catch` bên dưới
          // nuốt thành một dòng `warn`. Test #12 khoá lại.
          jobId: `expire-${order.id}`,
        },
      );
    } catch (error) {
      this.logger.warn({ orderId: order.id, err: error }, 'Không hẹn được lịch huỷ đơn — sweeper sẽ dọn');
    }

    this.metrics.ordersPlaced.inc({ result: 'created' });
    this.logger.log(
      {
        orderId: order.id,
        userId: input.userId,
        skuId: input.skuId,
        saleEventSkuId: input.saleEventSkuId,
        strategy: input.strategy,
        attempts: input.attempts,
      },
      'Đặt đơn thành công',
    );
    return { order, created: true };
  }

  /**
   * Người mua tự huỷ đơn `PENDING` của mình và **trả hàng về kho ngay**, không phải đợi hết
   * 15 phút giữ chỗ. Với flash sale, 15 phút đó là 15 phút hàng bị giam mà không ai mua được.
   *
   * Trả `cancelled` để controller biết đây là lần huỷ thật hay đơn vốn đã `CANCELLED` — cả hai
   * đều `200`, nhưng chỉ lần thật mới được đếm vào metric.
   */
  async cancelMyOrder(orderId: string, userId: string) {
    // Chặn ở đây thay vì để Postgres ném lỗi cast `::uuid` (thành 500). Một id sai định dạng
    // chắc chắn không phải đơn của ai cả — nên nó là 404, cùng câu trả lời với "đơn của người
    // khác": không tiết lộ gì về thứ mình không sở hữu.
    if (!UUID_PATTERN.test(orderId)) throw new OrderNotFoundError();

    const items = await this.repo.cancelPendingOrder(orderId, { kind: 'BY_USER', userId });

    if (items === null) {
      // 0 dòng bị đổi. Ba lý do khác nhau, và chúng cho ba câu trả lời khác nhau — đọc lại
      // một lần ở nhánh lỗi (không nằm trên đường nóng) để phân biệt.
      const existing = await this.repo.findOrderStatusOfUser(orderId, userId);
      if (!existing) throw new OrderNotFoundError();
      if (existing.status === 'PAID') throw new OrderNotCancellableError();

      // Còn lại: đã `CANCELLED` từ trước — bấm hai lần, hoặc job tự huỷ chạy xong trước.
      // Trạng thái người dùng muốn đã đạt được, nên đây là thành công, không phải lỗi.
      this.logger.debug({ orderId, userId }, 'Đơn đã huỷ từ trước — không trả kho lần hai');
      return { order: await this.getMyOrder(orderId, userId), cancelled: false };
    }

    // Trả kho NGOÀI transaction, giống hệt `OrderExpiryService`: chiến lược `redis` ghi sang
    // Redis, mà gọi Redis trong transaction Postgres là giữ khoá DB suốt thời gian chờ mạng.
    //
    // `releaseStock` dùng chung với đường tự huỷ — nó quyết định trả về ĐỢT hay về SKU. Hai
    // đường phải dùng chung đúng một hàm, nếu không một ngày chỉ một đường được sửa.
    for (const item of items) {
      await releaseStock(this.repo, this.reserver, item);
    }

    // Delayed job `expire-<orderId>` vẫn nằm trong queue và vẫn sẽ nổ sau đó. Cố tình KHÔNG
    // gỡ: lúc nổ, `UPDATE ... WHERE status = 'PENDING'` đổi 0 dòng nên nó tự vô hại. Gỡ job
    // là thêm một lệnh Redis có thể hỏng, để đổi lấy một thứ vốn đã an toàn.
    this.metrics.ordersCancelled.inc({ by: 'user' });
    this.logger.log({ orderId, userId, items: items.length }, 'Người mua tự huỷ đơn — đã trả hàng về kho');

    return { order: await this.getMyOrder(orderId, userId), cancelled: true };
  }

  async listMyOrders(userId: string, query: ListOrderQueryDto) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = await this.repo.listOrdersOfUser(userId, cursor, query.limit);
    return paginate(rows, query.limit);
  }

  /** Đơn của người khác coi như không tồn tại — 404, không 403. */
  async getMyOrder(orderId: string, userId: string) {
    if (!UUID_PATTERN.test(orderId)) throw new OrderNotFoundError();

    const order = await this.repo.findOrderOfUser(orderId, userId);
    if (!order) throw new OrderNotFoundError();
    return order;
  }
}

/**
 * Chặn id sai định dạng TRƯỚC khi nó tới DB. Không có nó thì `:id` bất kỳ (vd `abc`) làm
 * Postgres ném lỗi cast `::uuid` — và một chuỗi người dùng gõ bừa lại thành `500` như thể hệ
 * thống hỏng. Dùng regex thay vì thêm một Zod schema vì đây là một tham số đường dẫn duy nhất.
 */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
