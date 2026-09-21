import { RedisAtomicReserver } from './redis.reserver';

/**
 * Chiến lược duy nhất giữ tồn kho ở **hai nơi** (Redis + Postgres) mà không transaction nào
 * bao được cả hai. Vì vậy phần đáng test nhất không phải đường thành công, mà là **đường bù
 * trừ ngược**: Redis đã trừ rồi mà DB từ chối, hoặc DB ném lỗi.
 *
 * Bỏ sót một nhánh bù trừ là tồn kho Redis thấp hơn thực tế vĩnh viễn — nghĩa là **bán hụt**
 * hàng, im lặng, cho tới khi có người đối soát tay. Đó là loại lỗi không test nào khác bắt được.
 */
describe('RedisAtomicReserver', () => {
  const KEY = 'stock:sku-1';

  let client: { eval: jest.Mock; set: jest.Mock; incrby: jest.Mock };
  let repo: {
    decrementStockConditional: jest.Mock;
    incrementStock: jest.Mock;
    readSkuStock: jest.Mock;
  };
  let reserver: RedisAtomicReserver;

  beforeEach(() => {
    client = { eval: jest.fn(), set: jest.fn(), incrby: jest.fn() };
    repo = {
      decrementStockConditional: jest.fn(),
      incrementStock: jest.fn(),
      readSkuStock: jest.fn(),
    };
    reserver = new RedisAtomicReserver({ client } as never, repo as never);
  });

  it('Redis còn hàng và DB ghi được → ok, giá lấy từ DB', async () => {
    client.eval.mockResolvedValue(98);
    repo.decrementStockConditional.mockResolvedValue({ priceVnd: 199_000 });

    await expect(reserver.reserve('sku-1', 2)).resolves.toEqual({
      ok: true,
      unitPriceVnd: 199_000,
      attempts: 1,
    });
  });

  it('Redis báo không đủ hàng (-1) → OUT_OF_STOCK, KHÔNG đụng tới DB', async () => {
    client.eval.mockResolvedValue(-1);

    await expect(reserver.reserve('sku-1', 2)).resolves.toEqual({
      ok: false,
      reason: 'OUT_OF_STOCK',
    });
    expect(repo.decrementStockConditional).not.toHaveBeenCalled();
  });

  it('⭐ chưa nạp key (-2) → nạp lazy bằng SET NX, rồi chạy lại script', async () => {
    client.eval.mockResolvedValueOnce(-2).mockResolvedValueOnce(97);
    repo.readSkuStock.mockResolvedValue({ stock: 100 });
    repo.decrementStockConditional.mockResolvedValue({ priceVnd: 50_000 });

    await expect(reserver.reserve('sku-1', 3)).resolves.toMatchObject({ ok: true });

    // `NX` là bắt buộc: thiếu nó thì request nạp muộn sẽ ghi đè số đã bị request trước trừ đi,
    // và tồn kho "mọc lại" — đúng kiểu oversell mà cả dự án đang chống.
    expect(client.set).toHaveBeenCalledWith(KEY, '100', 'NX');
  });

  it('nạp lazy mà SKU không tồn tại → SKU_NOT_FOUND, không set key rỗng', async () => {
    client.eval.mockResolvedValue(-2);
    repo.readSkuStock.mockResolvedValue(null);

    await expect(reserver.reserve('sku-1', 1)).resolves.toEqual({
      ok: false,
      reason: 'SKU_NOT_FOUND',
    });
    expect(client.set).not.toHaveBeenCalled();
  });

  it('vừa nạp xong mà vẫn miss → ném lỗi, KHÔNG im lặng coi như hết hàng', async () => {
    client.eval.mockResolvedValue(-2);
    repo.readSkuStock.mockResolvedValue({ stock: 100 });

    await expect(reserver.reserve('sku-1', 1)).rejects.toThrow(/Không nạp được tồn kho/);
  });

  it('⭐ Redis cho phép nhưng DB từ chối (hai bên lệch) → hoàn lại Redis rồi mới báo hết hàng', async () => {
    client.eval.mockResolvedValue(98);
    repo.decrementStockConditional.mockResolvedValue(null);

    await expect(reserver.reserve('sku-1', 2)).resolves.toEqual({
      ok: false,
      reason: 'OUT_OF_STOCK',
    });
    expect(client.incrby).toHaveBeenCalledWith(KEY, 2);
  });

  it('⭐ DB ném lỗi sau khi Redis đã trừ → hoàn lại Redis rồi mới ném lỗi lên', async () => {
    const boom = new Error('mất kết nối Postgres');
    client.eval.mockResolvedValue(98);
    repo.decrementStockConditional.mockRejectedValue(boom);

    await expect(reserver.reserve('sku-1', 2)).rejects.toBe(boom);
    expect(client.incrby).toHaveBeenCalledWith(KEY, 2);
  });

  it('bù trừ Redis cũng hỏng → KHÔNG nuốt lỗi gốc của DB', async () => {
    const boom = new Error('mất kết nối Postgres');
    client.eval.mockResolvedValue(98);
    repo.decrementStockConditional.mockRejectedValue(boom);
    client.incrby.mockRejectedValue(new Error('Redis cũng chết'));

    // Lỗi bù trừ chỉ được log, còn thứ bay lên phải là nguyên nhân thật — nếu không người đọc
    // log sẽ đi sửa nhầm Redis trong khi thứ hỏng là Postgres.
    await expect(reserver.reserve('sku-1', 2)).rejects.toBe(boom);
  });

  it('release → hoàn CẢ HAI kho, Redis trước rồi DB', async () => {
    const order: string[] = [];
    client.incrby.mockImplementation(() => Promise.resolve(order.push('redis')));
    repo.incrementStock.mockImplementation(() => Promise.resolve(order.push('db')));

    await reserver.release('sku-1', 3);

    expect(client.incrby).toHaveBeenCalledWith(KEY, 3);
    expect(repo.incrementStock).toHaveBeenCalledWith('sku-1', 3);
    expect(order).toEqual(['redis', 'db']);
  });
});
