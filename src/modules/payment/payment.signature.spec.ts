import { createHmac } from 'node:crypto';

import { signPayload, verifySignature } from './payment.signature';

/**
 * Test case #16 của spec Phase 4.
 *
 * Đây là hàng rào duy nhất bảo vệ một endpoint **không có đăng nhập**. Sai ở đây thì bất kỳ
 * ai cũng đánh dấu được đơn của người khác là "đã trả tiền", nên nó đáng test kỹ hơn mức
 * bình thường.
 */
describe('verifySignature', () => {
  const secret = 's'.repeat(32);
  const rawBody = '{"eventId":"evt_1","amountVnd":100000}';
  const now = 1_757_000_000;
  const base = { rawBody, secret, toleranceSec: 300, nowSec: now };

  it('chấp nhận chữ ký đúng, sinh bởi chính signPayload', () => {
    expect(verifySignature({ ...base, header: signPayload(rawBody, secret, now) })).toBeNull();
  });

  it('từ chối khi thiếu header', () => {
    expect(verifySignature({ ...base, header: undefined })).toBe('MISSING');
  });

  it('từ chối header sai định dạng', () => {
    expect(verifySignature({ ...base, header: 'abc123' })).toBe('MALFORMED');
    expect(verifySignature({ ...base, header: `v1=${'a'.repeat(64)}` })).toBe('MALFORMED');
    // Chữ ký phải là hex — chữ hoa/ký tự lạ là sai định dạng, không phải sai chữ ký.
    expect(verifySignature({ ...base, header: `t=${now},v1=ZZZZ` })).toBe('MALFORMED');
  });

  it('từ chối khi khoá ký khác', () => {
    const header = signPayload(rawBody, 'khoa-khac-hoan-toan-32-ky-tu-abc', now);
    expect(verifySignature({ ...base, header })).toBe('MISMATCH');
  });

  it('từ chối khi body bị sửa dù chỉ một byte', () => {
    const header = signPayload(rawBody, secret, now);
    const tampered = rawBody.replace('100000', '100001');

    expect(verifySignature({ ...base, header, rawBody: tampered })).toBe('MISMATCH');
  });

  it('từ chối chữ ký quá cũ hoặc quá tương lai — chống replay', () => {
    const old = signPayload(rawBody, secret, now - 600);
    const future = signPayload(rawBody, secret, now + 600);

    expect(verifySignature({ ...base, header: old })).toBe('EXPIRED');
    expect(verifySignature({ ...base, header: future })).toBe('EXPIRED');
    // Ngay sát mép vẫn nhận.
    expect(verifySignature({ ...base, header: signPayload(rawBody, secret, now - 300) })).toBeNull();
  });

  it('dấu thời gian nằm TRONG phần được ký — không thể đổi t mà giữ chữ ký cũ', () => {
    const header = signPayload(rawBody, secret, now - 600);
    // Kẻ tấn công bắt được chữ ký cũ và chỉ sửa `t` cho mới lại.
    const replayed = header.replace(`t=${now - 600}`, `t=${now}`);

    // Nếu chỉ ký body (không ký `t`), dòng này sẽ trả `null` và replay thành công.
    expect(verifySignature({ ...base, header: replayed })).toBe('MISMATCH');
  });

  it('chữ ký sai độ dài không làm hàm ném lỗi', () => {
    // `timingSafeEqual` ném `RangeError` nếu hai buffer khác độ dài — phải chặn trước, nếu
    // không một chữ ký cụt sẽ thành 500 thay vì 401.
    expect(() => verifySignature({ ...base, header: `t=${now},v1=abcd` })).not.toThrow();
    expect(verifySignature({ ...base, header: `t=${now},v1=abcd` })).toBe('MISMATCH');
  });

  it('trả EXPIRED chỉ khi chữ ký đã đúng — không tiết lộ phần còn lại đúng', () => {
    // Chữ ký sai VÀ hết hạn: phải báo MISMATCH. Báo EXPIRED ở đây là nói với kẻ tấn công
    // rằng chữ ký của họ đã đúng, chỉ cần chỉnh lại đồng hồ.
    const wrongAndOld = `t=${now - 600},v1=${createHmac('sha256', 'khac').update('x').digest('hex')}`;

    expect(verifySignature({ ...base, header: wrongAndOld })).toBe('MISMATCH');
  });
});
