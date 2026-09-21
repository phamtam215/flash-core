import { JOB } from '../../infra/queue';
import { OrderNotFoundError, OutOfStockError, SkuNotFoundError } from './order.errors';
import { OrderService } from './order.service';

/**
 * `OrderService` là chỗ *ghép* các mảnh lại: trừ kho → tạo đơn → hẹn giờ huỷ. Bản thân nó
 * không chứa SQL nào, nên unit test với repo giả là đúng công cụ — và nó khoá được những
 * tính chất mà integration test khó chỉ thẳng vào:
 *
 * - giá ghi vào đơn lấy từ **kết quả trừ kho**, không phải từ client;
 * - bấm hai lần (trùng `Idempotency-Key`) phải **hoàn kho**, nếu không một người ăn hai suất;
 * - `jobId` của lịch hẹn huỷ **không được chứa `:`** — bug thật đã xảy ra, xem
 *   `order.service.ts` và `docs/tech-playbook.md` §Phase 4;
 * - queue hỏng **không được** làm hỏng một request đã tạo đơn xong.
 */
describe('OrderService', () => {
  const ORDER_HOLD_MINUTES = 15;

  let repo: {
    createOrder: jest.Mock;
    findOrderByIdempotencyKey: jest.Mock;
    listOrdersOfUser: jest.Mock;
    findOrderOfUser: jest.Mock;
  };
  let queue: { add: jest.Mock };
  let reserver: { name: string; reserve: jest.Mock; release: jest.Mock };
  let ordersPlaced: { inc: jest.Mock };
  let stopTimer: jest.Mock;
  let service: OrderService;

  const dto = { skuId: 'sku-1', quantity: 2 };

  beforeEach(() => {
    repo = {
      createOrder: jest.fn(),
      findOrderByIdempotencyKey: jest.fn(),
      listOrdersOfUser: jest.fn(),
      findOrderOfUser: jest.fn(),
    };
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    reserver = { name: 'optimistic', reserve: jest.fn(), release: jest.fn() };
    ordersPlaced = { inc: jest.fn() };
    stopTimer = jest.fn();
    const metrics = {
      ordersPlaced,
      reserveDuration: { startTimer: jest.fn().mockReturnValue(stopTimer) },
    };

    service = new OrderService(
      repo as never,
      queue as never,
      metrics as never,
      reserver as never,
      { ORDER_HOLD_MINUTES } as never,
    );
  });

  /** Trừ kho thành công, giá đơn vị do DB trả về (KHÁC giá client có thể gửi). */
  function reserveOk(unitPriceVnd = 199_000) {
    reserver.reserve.mockResolvedValue({ ok: true, unitPriceVnd, attempts: 1 });
  }

  describe('placeOrder — nhánh trừ kho thất bại', () => {
    it('hết hàng → OutOfStockError, KHÔNG tạo đơn', async () => {
      reserver.reserve.mockResolvedValue({ ok: false, reason: 'OUT_OF_STOCK' });

      await expect(service.placeOrder('u1', 'key-1', dto)).rejects.toBeInstanceOf(OutOfStockError);
      expect(repo.createOrder).not.toHaveBeenCalled();
    });

    it('SKU không tồn tại → SkuNotFoundError, đếm riêng chứ không gộp vào "hết hàng"', async () => {
      reserver.reserve.mockResolvedValue({ ok: false, reason: 'SKU_NOT_FOUND' });

      await expect(service.placeOrder('u1', 'key-1', dto)).rejects.toBeInstanceOf(SkuNotFoundError);
      // Gộp hai ca này thành một nhãn là mất luôn câu hỏi đáng hỏi nhất lúc có sự cố:
      // bán hết hàng, hay đang có ai bắn vào SKU không có thật?
      expect(ordersPlaced.inc).toHaveBeenCalledWith({ result: 'sku_not_found' });
    });

    it('đồng hồ đo bước trừ kho vẫn được DỪNG dù trừ kho thất bại', async () => {
      reserver.reserve.mockResolvedValue({ ok: false, reason: 'OUT_OF_STOCK' });

      await expect(service.placeOrder('u1', 'key-1', dto)).rejects.toThrow();
      expect(stopTimer).toHaveBeenCalled();
    });
  });

  describe('placeOrder — đặt đơn thành công', () => {
    it('⭐ giá ghi vào đơn lấy từ kết quả TRỪ KHO, không phải từ client', async () => {
      reserveOk(250_000);
      repo.createOrder.mockResolvedValue({ id: 'o1' });

      await service.placeOrder('u1', 'key-1', dto);

      expect(repo.createOrder).toHaveBeenCalledWith(
        expect.objectContaining({ unitPriceVnd: 250_000, skuId: 'sku-1', quantity: 2 }),
      );
    });

    it('hạn giữ chỗ tính từ ORDER_HOLD_MINUTES', async () => {
      reserveOk();
      repo.createOrder.mockResolvedValue({ id: 'o1' });
      const before = Date.now();

      await service.placeOrder('u1', 'key-1', dto);

      const { expiresAt } = repo.createOrder.mock.calls[0][0];
      const heldMs = expiresAt.getTime() - before;
      expect(heldMs).toBeGreaterThanOrEqual(ORDER_HOLD_MINUTES * 60 * 1000 - 50);
      expect(heldMs).toBeLessThanOrEqual(ORDER_HOLD_MINUTES * 60 * 1000 + 1000);
    });

    it('⭐ jobId của lịch hẹn huỷ KHÔNG chứa ":" — BullMQ từ chối thẳng ký tự đó', async () => {
      reserveOk();
      repo.createOrder.mockResolvedValue({ id: 'o1' });

      await service.placeOrder('u1', 'key-1', dto);

      const [name, payload, opts] = queue.add.mock.calls[0];
      expect(name).toBe(JOB.ORDER_EXPIRE);
      expect(payload).toMatchObject({ orderId: 'o1' });
      expect(opts.jobId).toBe('expire-o1');
      // Bản đầu viết `expire:${id}` ⇒ MỌI đơn đều không hẹn được lịch huỷ, mà lỗi bị `catch`
      // nuốt thành một dòng `warn` nên nhìn từ ngoài không ai thấy gì sai.
      expect(opts.jobId).not.toContain(':');
      expect(opts.delay).toBe(ORDER_HOLD_MINUTES * 60 * 1000);
    });

    it('⭐ queue hỏng → đơn VẪN được trả về, không biến request đã thành công thành 500', async () => {
      reserveOk();
      repo.createOrder.mockResolvedValue({ id: 'o1' });
      queue.add.mockRejectedValue(new Error('Redis mất kết nối'));

      const result = await service.placeOrder('u1', 'key-1', dto);

      // Mất lịch hẹn thôi — sweeper 60 giây một lần vẫn dọn được đơn quá hạn.
      expect(result).toEqual({ order: { id: 'o1' }, created: true });
    });
  });

  describe('placeOrder — Idempotency-Key trùng (bấm hai lần)', () => {
    it('⭐ hoàn lại đúng số hàng vừa trừ, nếu không một người ăn hai suất', async () => {
      reserveOk();
      repo.createOrder.mockResolvedValue(null); // vỡ UNIQUE ⇒ đã có đơn với key này
      repo.findOrderByIdempotencyKey.mockResolvedValue({ id: 'o-cu' });

      const result = await service.placeOrder('u1', 'key-1', dto);

      expect(reserver.release).toHaveBeenCalledWith('sku-1', 2);
      expect(result).toEqual({ order: { id: 'o-cu' }, created: false });
    });

    it('không hẹn thêm lịch huỷ cho đơn cũ', async () => {
      reserveOk();
      repo.createOrder.mockResolvedValue(null);
      repo.findOrderByIdempotencyKey.mockResolvedValue({ id: 'o-cu' });

      await service.placeOrder('u1', 'key-1', dto);

      expect(queue.add).not.toHaveBeenCalled();
    });

    it('trùng key nhưng không tìm thấy đơn cũ → ném lỗi, KHÔNG nuốt im lặng', async () => {
      reserveOk();
      repo.createOrder.mockResolvedValue(null);
      repo.findOrderByIdempotencyKey.mockResolvedValue(null);

      await expect(service.placeOrder('u1', 'key-1', dto)).rejects.toThrow(/không tìm thấy đơn cũ/);
    });
  });

  describe('đọc đơn', () => {
    it('đơn của người khác → 404 chứ không 403: không tiết lộ đơn đó có tồn tại', async () => {
      repo.findOrderOfUser.mockResolvedValue(null);

      await expect(service.getMyOrder('o1', 'u-khac')).rejects.toBeInstanceOf(OrderNotFoundError);
    });

    it('cursor rỗng → không giải mã gì, vẫn trả trang đầu', async () => {
      repo.listOrdersOfUser.mockResolvedValue([]);

      const page = await service.listMyOrders('u1', { limit: 20 });

      expect(repo.listOrdersOfUser).toHaveBeenCalledWith('u1', undefined, 20);
      expect(page.items).toEqual([]);
    });
  });
});
