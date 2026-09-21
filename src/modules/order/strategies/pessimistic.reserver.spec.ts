import { PessimisticReserver } from './pessimistic.reserver';

/**
 * Chiến lược này cố tình **không có vòng retry** — người đến sau *chờ* khoá chứ không *thất
 * bại rồi thử lại*. Test ở đây khoá đúng tính chất đó: một lần gọi repo, `attempts` luôn = 1.
 * Thêm retry vào sau này là đổi bản chất của chiến lược và làm benchmark Phase 3 hết so sánh được.
 */
describe('PessimisticReserver', () => {
  let repo: { lockAndDecrementStock: jest.Mock; incrementStock: jest.Mock };
  let reserver: PessimisticReserver;

  beforeEach(() => {
    repo = { lockAndDecrementStock: jest.fn(), incrementStock: jest.fn() };
    reserver = new PessimisticReserver(repo as never);
  });

  it('khoá và trừ được → ok, attempts luôn = 1 (không có retry nào)', async () => {
    repo.lockAndDecrementStock.mockResolvedValue({ priceVnd: 199_000 });

    await expect(reserver.reserve('sku-1', 2)).resolves.toEqual({
      ok: true,
      unitPriceVnd: 199_000,
      attempts: 1,
    });
    expect(repo.lockAndDecrementStock).toHaveBeenCalledTimes(1);
  });

  it('repo báo hết hàng → chuyển nguyên lý do lên, không thử lại', async () => {
    repo.lockAndDecrementStock.mockResolvedValue({ reason: 'OUT_OF_STOCK' });

    await expect(reserver.reserve('sku-1', 2)).resolves.toEqual({
      ok: false,
      reason: 'OUT_OF_STOCK',
    });
    expect(repo.lockAndDecrementStock).toHaveBeenCalledTimes(1);
  });

  it('repo báo không có SKU → SKU_NOT_FOUND', async () => {
    repo.lockAndDecrementStock.mockResolvedValue({ reason: 'SKU_NOT_FOUND' });

    await expect(reserver.reserve('sku-1', 2)).resolves.toEqual({
      ok: false,
      reason: 'SKU_NOT_FOUND',
    });
  });

  it('release → cộng thẳng lại vào DB', async () => {
    await reserver.release('sku-1', 3);

    expect(repo.incrementStock).toHaveBeenCalledWith('sku-1', 3);
  });
});
