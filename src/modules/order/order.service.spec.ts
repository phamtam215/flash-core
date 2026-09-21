import { JOB } from '../../infra/queue';
import {
  OrderNotCancellableError,
  OrderNotFoundError,
  OutOfStockError,
  SkuNotFoundError,
} from './order.errors';
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
    cancelPendingOrder: jest.Mock;
    findOrderStatusOfUser: jest.Mock;
  };
  let queue: { add: jest.Mock };
  let reserver: { name: string; reserve: jest.Mock; release: jest.Mock };
  let ordersPlaced: { inc: jest.Mock };
  let ordersCancelled: { inc: jest.Mock };
  let stopTimer: jest.Mock;
  let service: OrderService;

  const dto = { skuId: 'sku-1', quantity: 2 };

  beforeEach(() => {
    repo = {
      createOrder: jest.fn(),
      findOrderByIdempotencyKey: jest.fn(),
      listOrdersOfUser: jest.fn(),
      findOrderOfUser: jest.fn(),
      cancelPendingOrder: jest.fn(),
      findOrderStatusOfUser: jest.fn(),
    };
    queue = { add: jest.fn().mockResolvedValue(undefined) };
    reserver = { name: 'optimistic', reserve: jest.fn(), release: jest.fn() };
    ordersPlaced = { inc: jest.fn() };
    ordersCancelled = { inc: jest.fn() };
    stopTimer = jest.fn();
    const metrics = {
      ordersPlaced,
      ordersCancelled,
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

  describe('cancelMyOrder — người mua tự huỷ', () => {
    const ORDER_ID = '11111111-2222-3333-4444-555555555555';

    it('huỷ được → trả kho đúng từng dòng hàng, đếm metric by=user', async () => {
      repo.cancelPendingOrder.mockResolvedValue([
        { skuId: 'sku-1', quantity: 2 },
        { skuId: 'sku-2', quantity: 1 },
      ]);
      repo.findOrderOfUser.mockResolvedValue({ id: ORDER_ID, status: 'CANCELLED' });

      const result = await service.cancelMyOrder(ORDER_ID, 'u1');

      expect(result.cancelled).toBe(true);
      expect(reserver.release).toHaveBeenNthCalledWith(1, 'sku-1', 2);
      expect(reserver.release).toHaveBeenNthCalledWith(2, 'sku-2', 1);
      expect(ordersCancelled.inc).toHaveBeenCalledWith({ by: 'user' });
    });

    it('⭐ huỷ với scope BY_USER — KHÔNG đòi hết hạn, nhưng đòi đúng chủ đơn', async () => {
      repo.cancelPendingOrder.mockResolvedValue([]);
      repo.findOrderOfUser.mockResolvedValue({ id: ORDER_ID });

      await service.cancelMyOrder(ORDER_ID, 'u1');

      // Lọt `kind: 'EXPIRED'` vào đây là người mua không huỷ được đơn của chính mình cho tới
      // khi hết 15 phút — đúng thứ tính năng này sinh ra để bỏ đi.
      expect(repo.cancelPendingOrder).toHaveBeenCalledWith(ORDER_ID, {
        kind: 'BY_USER',
        userId: 'u1',
      });
    });

    it('⭐ đơn đã CANCELLED từ trước → 200 (cancelled=false), TUYỆT ĐỐI không trả kho lần hai', async () => {
      repo.cancelPendingOrder.mockResolvedValue(null);
      repo.findOrderStatusOfUser.mockResolvedValue({ status: 'CANCELLED' });
      repo.findOrderOfUser.mockResolvedValue({ id: ORDER_ID, status: 'CANCELLED' });

      const result = await service.cancelMyOrder(ORDER_ID, 'u1');

      expect(result.cancelled).toBe(false);
      expect(reserver.release).not.toHaveBeenCalled();
      // Không đếm metric ở lần gọi thứ hai: nếu đếm thì "số đơn bị huỷ" phụ thuộc vào việc
      // người dùng bấm mấy lần, và con số đó hết dùng được.
      expect(ordersCancelled.inc).not.toHaveBeenCalled();
    });

    it('⭐ đơn đã PAID → 409 OrderNotCancellableError, không trả kho', async () => {
      repo.cancelPendingOrder.mockResolvedValue(null);
      repo.findOrderStatusOfUser.mockResolvedValue({ status: 'PAID' });

      await expect(service.cancelMyOrder(ORDER_ID, 'u1')).rejects.toBeInstanceOf(
        OrderNotCancellableError,
      );
      expect(reserver.release).not.toHaveBeenCalled();
    });

    it('đơn không tồn tại hoặc của người khác → 404, không phân biệt hai ca', async () => {
      repo.cancelPendingOrder.mockResolvedValue(null);
      repo.findOrderStatusOfUser.mockResolvedValue(null);

      await expect(service.cancelMyOrder(ORDER_ID, 'u1')).rejects.toBeInstanceOf(
        OrderNotFoundError,
      );
    });

    it('id sai định dạng UUID → 404, KHÔNG để Postgres ném lỗi cast thành 500', async () => {
      await expect(service.cancelMyOrder('khong-phai-uuid', 'u1')).rejects.toBeInstanceOf(
        OrderNotFoundError,
      );
      expect(repo.cancelPendingOrder).not.toHaveBeenCalled();
    });
  });

  describe('đọc đơn', () => {
    it('đơn của người khác → 404 chứ không 403: không tiết lộ đơn đó có tồn tại', async () => {
      repo.findOrderOfUser.mockResolvedValue(null);

      await expect(
        service.getMyOrder('11111111-2222-3333-4444-555555555555', 'u-khac'),
      ).rejects.toBeInstanceOf(OrderNotFoundError);
    });

    it('GET đơn với id sai định dạng → 404 chứ không 500 (cùng lá chắn với huỷ đơn)', async () => {
      await expect(service.getMyOrder('abc', 'u1')).rejects.toBeInstanceOf(OrderNotFoundError);
      expect(repo.findOrderOfUser).not.toHaveBeenCalled();
    });

    it('cursor rỗng → không giải mã gì, vẫn trả trang đầu', async () => {
      repo.listOrdersOfUser.mockResolvedValue([]);

      const page = await service.listMyOrders('u1', { limit: 20 });

      expect(repo.listOrdersOfUser).toHaveBeenCalledWith('u1', undefined, 20);
      expect(page.items).toEqual([]);
    });
  });
});
