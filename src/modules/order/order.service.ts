import { Inject, Injectable, Logger } from '@nestjs/common';

import { decodeCursor, getCorrelationId, paginate } from '../../common';
import { ENV, type Env } from '../../config';
import { MetricsService } from '../../infra/metrics';
import { JOB, QueueService, type OrderExpirePayload } from '../../infra/queue';
import { INVENTORY_RESERVER, type InventoryReserver } from './inventory-reserver';
import type { CreateOrderDto, ListOrderQueryDto } from './order.dto';
import { OrderNotFoundError, OutOfStockError, SkuNotFoundError } from './order.errors';
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
    // Đo riêng bước trừ kho, tách theo chiến lược: đây là đoạn nóng nhất của cả hệ thống và
    // là thứ benchmark Phase 3 đã so sánh. Có metric thì so sánh đó tiếp tục được trên môi
    // trường thật, không chỉ trong một lần chạy k6.
    const stopReserveTimer = this.metrics.reserveDuration.startTimer({ strategy: this.reserver.name });
    const reserved = await this.reserver.reserve(dto.skuId, dto.quantity);
    stopReserveTimer();

    if (!reserved.ok) {
      // Đếm ở ĐÂY chứ không ở interceptor, vì chỉ chỗ này biết `409` là "hết hàng" hay
      // "SKU không tồn tại". Một metric `http_requests_total{status="409"}` không trả lời
      // được câu hỏi thật sự đáng hỏi: bán hết hàng, hay đang có ai bắn vào SKU không có thật?
      if (reserved.reason === 'SKU_NOT_FOUND') {
        this.metrics.ordersPlaced.inc({ result: 'sku_not_found' });
        throw new SkuNotFoundError();
      }
      this.metrics.ordersPlaced.inc({ result: 'out_of_stock' });
      throw new OutOfStockError();
    }

    const expiresAt = new Date(Date.now() + this.env.ORDER_HOLD_MINUTES * 60 * 1000);
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

      this.metrics.ordersPlaced.inc({ result: 'duplicate' });
      this.logger.log({ orderId: existing.id, userId }, 'Idempotency-Key trùng — trả lại đơn cũ');
      return { order: existing, created: false };
    }

    // Hẹn giờ tự huỷ. **Sau** khi transaction đã commit, và cố tình KHÔNG nằm trong đó: gọi
    // Redis bên trong transaction là vi phạm luật "transaction boundary hẹp nhất" (CLAUDE.md)
    // và giữ khoá DB suốt thời gian chờ mạng.
    //
    // Redis hỏng ở đây thì đơn vẫn tạo xong — chỉ mất lịch hẹn, và sweeper 60 giây một lần sẽ
    // dọn. Vì vậy chỉ log `warn` chứ không ném lỗi làm hỏng một request đã thành công.
    try {
      await this.queue.add<OrderExpirePayload>(
        JOB.ORDER_EXPIRE,
        { orderId: order.id, correlationId: getCorrelationId() },
        {
          delay: this.env.ORDER_HOLD_MINUTES * 60 * 1000,
          // `jobId` theo đơn: đẩy lại cùng đơn không sinh ra hai lịch hẹn.
          //
          // Dấu gạch nối, KHÔNG phải dấu hai chấm: BullMQ dùng `:` làm ký tự phân cách khoá
          // Redis nên nó từ chối thẳng `jobId` chứa `:` (`Custom Id cannot contain :`). Bản
          // đầu viết `expire:${order.id}` và **mọi đơn đều không hẹn được lịch tự huỷ** —
          // lỗi bị `catch` bên dưới nuốt thành một dòng `warn`, còn sweeper thì vẫn dọn đúng
          // nên nhìn từ ngoài không ai thấy gì sai. Test #12 khoá lại tính chất này.
          jobId: `expire-${order.id}`,
        },
      );
    } catch (error) {
      this.logger.warn({ orderId: order.id, err: error }, 'Không hẹn được lịch huỷ đơn — sweeper sẽ dọn');
    }

    this.metrics.ordersPlaced.inc({ result: 'created' });
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
