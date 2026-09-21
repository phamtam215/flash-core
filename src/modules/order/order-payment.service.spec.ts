import { OrderPaymentService } from './order-payment.service';

/**
 * Đặt cạnh `order.notifier.spec.ts` thì thấy rõ điểm học của Phase 4: **cùng một cơ chế
 * UNIQUE, nhưng ranh giới transaction khác nhau nên bảo đảm nhận được cũng khác nhau.**
 * Hệ quả ở đây nằm trọn trong DB ⇒ dấu và việc chạy chung transaction ⇒ *exactly-once* thật,
 * không phải chọn giữa "mất" và "trùng".
 *
 * Hai nhánh đắt nhất là hai nhánh **không** đánh `PAID`: tiền đã chuyển thật, nên sai ở đây
 * là sai bằng tiền chứ không phải bằng một dòng log.
 */
describe('OrderPaymentService', () => {
  const tx = {} as never;
  const input = {
    eventId: 'e1',
    orderId: 'o1',
    paymentIntentId: 'pi_1',
    amountVnd: 199_000,
    correlationId: 'c1',
  };

  let repo: {
    findOrderForPayment: jest.Mock;
    markPaid: jest.Mock;
    createRefundRequest: jest.Mock;
  };
  let idempotency: { runOnceInTransaction: jest.Mock };
  let service: OrderPaymentService;

  beforeEach(() => {
    repo = {
      findOrderForPayment: jest.fn(),
      markPaid: jest.fn().mockResolvedValue(true),
      createRefundRequest: jest.fn(),
    };
    idempotency = {
      // Mặc định: dấu giành được ⇒ thân hàm được chạy.
      runOnceInTransaction: jest.fn(async (_id, _consumer, work) => {
        await work(tx);
        return true;
      }),
    };
    service = new OrderPaymentService(repo as never, idempotency as never);
  });

  it('đúng tiền, đơn còn PENDING → PAID', async () => {
    repo.findOrderForPayment.mockResolvedValue({ id: 'o1', totalVnd: 199_000, status: 'PENDING' });

    await expect(service.settle(input as never)).resolves.toEqual({ kind: 'PAID' });
    expect(repo.markPaid).toHaveBeenCalledWith(tx, 'o1', 'pi_1');
  });

  it('⭐ webhook trùng (dấu đã có) → thân hàm KHÔNG chạy, không đánh PAID lần hai', async () => {
    idempotency.runOnceInTransaction.mockResolvedValue(false);

    await expect(service.settle(input as never)).resolves.toEqual({ kind: 'ALREADY_HANDLED' });
    expect(repo.findOrderForPayment).not.toHaveBeenCalled();
    expect(repo.markPaid).not.toHaveBeenCalled();
  });

  it('⭐ số tiền lệch → KHÔNG PAID, ghi refund_requests', async () => {
    repo.findOrderForPayment.mockResolvedValue({ id: 'o1', totalVnd: 250_000, status: 'PENDING' });

    // Chữ ký webhook hợp lệ không có nghĩa là nghiệp vụ hợp lệ — đây là chỗ hay bị bỏ qua nhất.
    await expect(service.settle(input as never)).resolves.toEqual({
      kind: 'REFUND_REQUIRED',
      reason: 'AMOUNT_MISMATCH',
    });
    expect(repo.markPaid).not.toHaveBeenCalled();
    expect(repo.createRefundRequest).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ orderId: 'o1', reason: 'AMOUNT_MISMATCH', amountVnd: 199_000 }),
    );
  });

  it('⭐ đơn đã CANCELLED → không hồi sinh thành PAID: hàng đã trả kho, người khác có thể đã mua', async () => {
    repo.findOrderForPayment.mockResolvedValue({ id: 'o1', totalVnd: 199_000, status: 'CANCELLED' });

    await expect(service.settle(input as never)).resolves.toEqual({
      kind: 'REFUND_REQUIRED',
      reason: 'ORDER_ALREADY_CANCELLED',
    });
    expect(repo.markPaid).not.toHaveBeenCalled();
    expect(repo.createRefundRequest).toHaveBeenCalledWith(
      tx,
      expect.objectContaining({ reason: 'ORDER_ALREADY_CANCELLED' }),
    );
  });

  it('không tìm thấy đơn → ORDER_NOT_FOUND, không ghi refund (chưa biết hoàn cho đơn nào)', async () => {
    repo.findOrderForPayment.mockResolvedValue(null);

    await expect(service.settle(input as never)).resolves.toEqual({ kind: 'ORDER_NOT_FOUND' });
    expect(repo.createRefundRequest).not.toHaveBeenCalled();
  });

  it('markPaid không đổi được dòng nào (đơn vừa sang PAID ở đường khác) → ALREADY_HANDLED', async () => {
    repo.findOrderForPayment.mockResolvedValue({ id: 'o1', totalVnd: 199_000, status: 'PENDING' });
    repo.markPaid.mockResolvedValue(false);

    await expect(service.settle(input as never)).resolves.toEqual({ kind: 'ALREADY_HANDLED' });
  });

  it('dấu và hệ quả dùng CÙNG một transaction — đó là thứ làm nên exactly-once ở đây', async () => {
    repo.findOrderForPayment.mockResolvedValue({ id: 'o1', totalVnd: 199_000, status: 'PENDING' });

    await service.settle(input);

    const [eventId, consumer] = idempotency.runOnceInTransaction.mock.calls[0];
    expect(eventId).toBe('e1');
    expect(consumer).toBe('order.payment');
    // `tx` truyền vào hàm repo phải đúng là `tx` mà runOnceInTransaction cấp, không phải
    // client toàn cục — dùng nhầm là hệ quả nằm ngoài transaction của dấu.
    expect(repo.markPaid.mock.calls[0][0]).toBe(tx);
  });
});
