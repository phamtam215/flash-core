import { paymentEventSchema } from './payment.dto';

/** Test case #17 của spec Phase 4. */
describe('paymentEventSchema', () => {
  const valid = {
    eventId: 'evt_1',
    type: 'payment.succeeded' as const,
    orderId: '11111111-1111-4111-8111-111111111111',
    paymentIntentId: 'pi_1',
    amountVnd: 250_000,
    occurredAt: '2026-09-05T10:00:00.000Z',
  };

  it('chấp nhận sự kiện hợp lệ', () => {
    expect(paymentEventSchema.parse(valid)).toEqual(valid);
  });

  it('loại bỏ field lạ thay vì ném lỗi — cổng thêm trường mới không làm vỡ webhook', () => {
    const parsed = paymentEventSchema.parse({ ...valid, gatewayInternalField: 'x' });

    expect(parsed).not.toHaveProperty('gatewayInternalField');
  });

  it('từ chối orderId không phải UUID', () => {
    expect(() => paymentEventSchema.parse({ ...valid, orderId: 'khong-phai-uuid' })).toThrow();
  });

  it('từ chối số tiền âm, bằng 0, hoặc có phần thập phân', () => {
    // Tiền lưu Int (VND) — luật trong CLAUDE.md. Cho lọt số thập phân là mở đường cho lỗi
    // làm tròn ở mọi phép cộng sau này.
    expect(() => paymentEventSchema.parse({ ...valid, amountVnd: -1 })).toThrow();
    expect(() => paymentEventSchema.parse({ ...valid, amountVnd: 0 })).toThrow();
    expect(() => paymentEventSchema.parse({ ...valid, amountVnd: 1000.5 })).toThrow();
  });

  it('từ chối loại sự kiện chưa biết', () => {
    expect(() => paymentEventSchema.parse({ ...valid, type: 'payment.refunded' })).toThrow();
  });

  it('từ chối thiếu eventId — không có nó thì không chống trùng được', () => {
    const withoutEventId: Record<string, unknown> = { ...valid };
    delete withoutEventId.eventId;

    expect(() => paymentEventSchema.parse(withoutEventId)).toThrow();
    expect(() => paymentEventSchema.parse({ ...valid, eventId: '' })).toThrow();
  });
});
