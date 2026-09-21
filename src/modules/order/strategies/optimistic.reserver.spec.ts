import { OptimisticReserver } from './optimistic.reserver';

/**
 * Điểm đáng test ở chiến lược này **không** phải "trừ được kho" — câu
 * `UPDATE ... WHERE stock >= ?` lo việc đó, và integration test #8 đã chứng minh trên DB thật.
 *
 * Đáng test là **quyết định retry**, vì nó chỉ lộ ra khi DB trả về đúng loại lỗi hiếm mà
 * integration test rất khó dựng lại:
 *
 * - "hết hàng" **không** được retry (tồn kho không tự mọc lại) — retry ở đây vừa vô nghĩa vừa
 *   làm nhiễu số đo benchmark;
 * - `40001` / `40P01` (serialization failure, deadlock) **phải** được retry;
 * - mọi lỗi khác phải bay lên ngay, không nuốt vào vòng lặp.
 */
describe('OptimisticReserver', () => {
  let repo: {
    decrementStockConditional: jest.Mock;
    isSkuOnSale: jest.Mock;
    incrementStock: jest.Mock;
  };
  let reserver: OptimisticReserver;

  beforeEach(() => {
    repo = {
      decrementStockConditional: jest.fn(),
      isSkuOnSale: jest.fn(),
      incrementStock: jest.fn(),
    };
    reserver = new OptimisticReserver(repo as never);
  });

  it('trừ được ngay lần đầu → ok, giá lấy từ dòng vừa ghi, attempts = 1', async () => {
    repo.decrementStockConditional.mockResolvedValue({ priceVnd: 199_000 });

    await expect(reserver.reserve('sku-1', 2)).resolves.toEqual({
      ok: true,
      unitPriceVnd: 199_000,
      attempts: 1,
    });
  });

  it('⭐ hết hàng → KHÔNG retry: tồn kho không tự mọc lại', async () => {
    repo.decrementStockConditional.mockResolvedValue(null);
    repo.isSkuOnSale.mockResolvedValue(true);

    await expect(reserver.reserve('sku-1', 2)).resolves.toEqual({
      ok: false,
      reason: 'OUT_OF_STOCK',
    });
    expect(repo.decrementStockConditional).toHaveBeenCalledTimes(1);
  });

  it('0 dòng và SKU không còn bán → SKU_NOT_FOUND, tách khỏi "hết hàng"', async () => {
    repo.decrementStockConditional.mockResolvedValue(null);
    repo.isSkuOnSale.mockResolvedValue(false);

    await expect(reserver.reserve('sku-1', 2)).resolves.toEqual({
      ok: false,
      reason: 'SKU_NOT_FOUND',
    });
  });

  it('⭐ serialization failure (40001) → thử lại, lần sau thành công, attempts = 2', async () => {
    repo.decrementStockConditional
      .mockRejectedValueOnce(Object.assign(new Error('could not serialize access'), { code: '40001' }))
      .mockResolvedValueOnce({ priceVnd: 199_000 });

    await expect(reserver.reserve('sku-1', 2)).resolves.toEqual({
      ok: true,
      unitPriceVnd: 199_000,
      attempts: 2,
    });
  });

  it('deadlock (40P01) nằm trong `meta` chứ không phải `code` → vẫn nhận ra và thử lại', async () => {
    // Prisma bọc lỗi raw query khác nhau giữa các bản: có bản đặt mã ở `meta.code`, có bản
    // nhét vào `message`. Nhận diện phải chịu được cả hai, nếu không retry im lặng ngừng chạy.
    repo.decrementStockConditional
      .mockRejectedValueOnce(Object.assign(new Error('P2010'), { meta: { code: '40P01' } }))
      .mockResolvedValueOnce({ priceVnd: 10_000 });

    await expect(reserver.reserve('sku-1', 1)).resolves.toMatchObject({ ok: true, attempts: 2 });
  });

  it('⭐ lỗi KHÔNG phải xung đột → ném ngay, không nuốt vào vòng retry', async () => {
    const boom = Object.assign(new Error('unique constraint'), { code: '23505' });
    repo.decrementStockConditional.mockRejectedValue(boom);

    await expect(reserver.reserve('sku-1', 2)).rejects.toBe(boom);
    expect(repo.decrementStockConditional).toHaveBeenCalledTimes(1);
  });

  it('xung đột liên tục → thử đúng 3 lần rồi ném lỗi gốc, không thử vô hạn', async () => {
    const conflict = Object.assign(new Error('deadlock detected'), { code: '40P01' });
    repo.decrementStockConditional.mockRejectedValue(conflict);

    await expect(reserver.reserve('sku-1', 2)).rejects.toBe(conflict);
    expect(repo.decrementStockConditional).toHaveBeenCalledTimes(3);
  });

  it('release → cộng thẳng lại vào DB', async () => {
    await reserver.release('sku-1', 3);

    expect(repo.incrementStock).toHaveBeenCalledWith('sku-1', 3);
  });
});
