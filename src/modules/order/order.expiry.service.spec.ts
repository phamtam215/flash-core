import { OrderExpiryService } from './order.expiry.service';

/**
 * Service này có **hai đường vào cùng một hàm** (delayed job và sweeper), nên tính chất đáng
 * khoá nhất không phải "huỷ được đơn" mà là "**huỷ hai lần chỉ trả kho một lần**".
 *
 * Integration test #8 đã chứng minh điều đó trên DB thật. Unit test ở đây khoá thêm phần
 * *quyết định* của service — thứ sẽ vỡ im lặng nếu ai đó đổi thứ tự "trả kho" lên trước
 * `UPDATE`: lúc đó DB vẫn đúng một đơn `CANCELLED`, nhưng tồn kho cộng hai lần.
 */
describe('OrderExpiryService', () => {
  let repo: { cancelPendingOrder: jest.Mock; findExpiredPendingOrderIds: jest.Mock };
  let reserver: { release: jest.Mock };
  let ordersCancelled: { inc: jest.Mock };
  let service: OrderExpiryService;

  beforeEach(() => {
    repo = { cancelPendingOrder: jest.fn(), findExpiredPendingOrderIds: jest.fn() };
    reserver = { release: jest.fn() };
    ordersCancelled = { inc: jest.fn() };
    service = new OrderExpiryService(repo as never, { ordersCancelled } as never, reserver as never);
  });

  describe('cancelExpired', () => {
    it('huỷ được → trả kho đúng từng dòng hàng của đơn', async () => {
      repo.cancelPendingOrder.mockResolvedValue([
        { skuId: 'sku-1', quantity: 2 },
        { skuId: 'sku-2', quantity: 1 },
      ]);

      await expect(service.cancelExpired('o1')).resolves.toBe(true);

      expect(reserver.release).toHaveBeenCalledTimes(2);
      expect(reserver.release).toHaveBeenNthCalledWith(1, 'sku-1', 2);
      expect(reserver.release).toHaveBeenNthCalledWith(2, 'sku-2', 1);
    });

    it('⭐ đường kia huỷ trước rồi (UPDATE ảnh hưởng 0 dòng) → TUYỆT ĐỐI không trả kho lần hai', async () => {
      // `null` = đơn đã PAID, đã CANCELLED, hoặc chưa tới hạn. Chính là ca delayed job và
      // sweeper cùng nổ trên một đơn.
      repo.cancelPendingOrder.mockResolvedValue(null);

      await expect(service.cancelExpired('o1')).resolves.toBe(false);
      expect(reserver.release).not.toHaveBeenCalled();
    });

    it('⭐ luôn huỷ với scope EXPIRED — đường này KHÔNG được bỏ điều kiện quá hạn', async () => {
      repo.cancelPendingOrder.mockResolvedValue([]);

      await service.cancelExpired('o1');

      // Đổi nhầm sang BY_USER ở đây là sweeper huỷ được cả đơn CHƯA tới hạn — người mua đang
      // trong trang thanh toán thì đơn biến mất.
      expect(repo.cancelPendingOrder).toHaveBeenCalledWith('o1', { kind: 'EXPIRED' });
    });

    it('đếm metric theo nguồn huỷ = expiry, tách khỏi người mua tự bấm', async () => {
      repo.cancelPendingOrder.mockResolvedValue([{ skuId: 's', quantity: 1 }]);

      await service.cancelExpired('o1');

      expect(ordersCancelled.inc).toHaveBeenCalledWith({ by: 'expiry' });
    });

    it('không có gì để huỷ → KHÔNG đếm metric (nếu không con số luôn gấp đôi thực tế)', async () => {
      repo.cancelPendingOrder.mockResolvedValue(null);

      await service.cancelExpired('o1');

      expect(ordersCancelled.inc).not.toHaveBeenCalled();
    });

    it('đơn không có dòng hàng nào → vẫn tính là đã huỷ, không gọi trả kho', async () => {
      repo.cancelPendingOrder.mockResolvedValue([]);

      await expect(service.cancelExpired('o1')).resolves.toBe(true);
      expect(reserver.release).not.toHaveBeenCalled();
    });
  });

  describe('sweepExpired', () => {
    it('không có đơn quá hạn → thoát ngay, không đụng gì tới kho', async () => {
      repo.findExpiredPendingOrderIds.mockResolvedValue([]);

      await expect(service.sweepExpired()).resolves.toBe(0);
      expect(repo.cancelPendingOrder).not.toHaveBeenCalled();
    });

    it('chỉ ĐẾM những đơn mà chính lần quét này huỷ được', async () => {
      repo.findExpiredPendingOrderIds.mockResolvedValue(['o1', 'o2', 'o3']);
      repo.cancelPendingOrder
        .mockResolvedValueOnce([{ skuId: 's', quantity: 1 }]) // o1: quét huỷ được
        .mockResolvedValueOnce(null) // o2: delayed job đã huỷ xong trước đó
        .mockResolvedValueOnce([{ skuId: 's', quantity: 1 }]); // o3: quét huỷ được

      // Đếm cả o2 thì con số "sweeper đã dọn bao nhiêu đơn delayed job bỏ sót" sẽ nói dối,
      // và đó đúng là con số dùng để biết Redis/queue có đang hỏng hay không.
      await expect(service.sweepExpired()).resolves.toBe(2);
    });

    it('quét tối đa một lô — không để một vòng chiếm worker vô hạn', async () => {
      repo.findExpiredPendingOrderIds.mockResolvedValue([]);

      await service.sweepExpired();

      expect(repo.findExpiredPendingOrderIds).toHaveBeenCalledWith(100);
    });
  });
});
