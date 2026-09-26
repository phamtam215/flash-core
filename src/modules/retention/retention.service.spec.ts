import { RetentionService } from './retention.service';

/**
 * Hai tính chất phải khoá, và cả hai đều **hỏng im lặng** nếu sai:
 *
 * - Xoá **theo lô, lặp cho tới hết** — nếu chỉ xoá một lô rồi dừng, bảng vẫn phình mà log lại
 *   báo "đã dọn", nên không ai đi kiểm.
 * - **Dừng đúng lúc**: lô không đầy nghĩa là hết dòng đủ cũ. Không dừng thì chạy thêm những
 *   câu `DELETE` không xoá được gì, và chạm trần vòng lặp mỗi lần chạy.
 */
describe('RetentionService', () => {
  const BATCH = 100;

  let repo: {
    deleteDispatchedOutbox: jest.Mock;
    deleteProcessedEvents: jest.Mock;
    countFailedOutbox: jest.Mock;
  };
  let retentionDeleted: { inc: jest.Mock };
  let outboxFailed: { set: jest.Mock };
  let service: RetentionService;

  beforeEach(() => {
    repo = {
      deleteDispatchedOutbox: jest.fn().mockResolvedValue(0),
      deleteProcessedEvents: jest.fn().mockResolvedValue(0),
      countFailedOutbox: jest.fn().mockResolvedValue(0),
    };
    retentionDeleted = { inc: jest.fn() };
    outboxFailed = { set: jest.fn() };
    service = new RetentionService(
      repo as never,
      { retentionDeleted, outboxFailed } as never,
      { DATA_RETENTION_DAYS: 30, RETENTION_BATCH_SIZE: BATCH } as never,
    );
  });

  it('không có gì để xoá → không đếm metric, không ồn ào', async () => {
    await expect(service.sweep()).resolves.toEqual({ outbox: 0, processed: 0 });

    expect(retentionDeleted.inc).not.toHaveBeenCalled();
  });

  it('⭐ lô ĐẦY → chạy tiếp; lô không đầy → DỪNG', async () => {
    repo.deleteDispatchedOutbox
      .mockResolvedValueOnce(BATCH) // đầy ⇒ còn nữa
      .mockResolvedValueOnce(BATCH) // đầy ⇒ còn nữa
      .mockResolvedValueOnce(7); // không đầy ⇒ hết

    const result = await service.sweep();

    expect(result.outbox).toBe(BATCH * 2 + 7);
    // Đúng 3 lần: không dừng sớm (bảng vẫn phình), và không chạy thêm câu vô ích.
    expect(repo.deleteDispatchedOutbox).toHaveBeenCalledTimes(3);
  });

  it('⭐ tồn đọng khổng lồ → dừng ở trần vòng lặp, không chiếm worker vô hạn', async () => {
    repo.deleteDispatchedOutbox.mockResolvedValue(BATCH); // luôn đầy — không bao giờ hết

    const result = await service.sweep();

    // 20 vòng (MAX_ROUNDS). Phần còn lại để lần chạy sau — thà dọn chậm còn hơn chiếm worker.
    expect(repo.deleteDispatchedOutbox).toHaveBeenCalledTimes(20);
    expect(result.outbox).toBe(BATCH * 20);
  });

  it('mốc thời gian tính từ DATA_RETENTION_DAYS', async () => {
    const before = Date.now();

    await service.sweep();

    const olderThan = repo.deleteDispatchedOutbox.mock.calls[0][0] as Date;
    const ageMs = before - olderThan.getTime();
    expect(ageMs).toBeGreaterThan(29 * 24 * 3600 * 1000);
    expect(ageMs).toBeLessThan(31 * 24 * 3600 * 1000);
  });

  it('⭐ luôn ĐO số dòng FAILED — chúng không bị xoá, nên con số đó là tín hiệu', async () => {
    repo.countFailedOutbox.mockResolvedValue(12);

    await service.sweep();

    // Job dọn là chỗ duy nhất đi ngang qua cả bảng một cách đều đặn, nên nó tiện thể phát
    // hiện được "có thứ hỏng mà chưa ai nhìn".
    expect(outboxFailed.set).toHaveBeenCalledWith(12);
  });

  it('đếm metric tách theo bảng — để biết bảng nào đang phình', async () => {
    repo.deleteDispatchedOutbox.mockResolvedValueOnce(5);
    repo.deleteProcessedEvents.mockResolvedValueOnce(9);

    await service.sweep();

    expect(retentionDeleted.inc).toHaveBeenCalledWith({ table: 'outbox_events' }, 5);
    expect(retentionDeleted.inc).toHaveBeenCalledWith({ table: 'processed_events' }, 9);
  });
});
