import { issueToken, verifyRequest, verifyToken } from './csrf.token';

/**
 * Chữ ký là thứ DUY NHẤT khiến token này khác một chuỗi random.
 *
 * Bỏ ký đi thì double-submit vẫn chạy, mọi test khác vẫn xanh, và cơ chế **vẫn chặn được
 * CSRF cổ điển** — nên không có gì đỏ để báo. Thứ mất đi là đúng kịch bản mà dự án làm token
 * vì nó: kẻ tấn công **cùng site** tự đặt cặp cookie+header khớp nhau. Test #3 và #6 dưới đây
 * là chỗ duy nhất trong cả bộ test bắt được việc đó.
 */
describe('CSRF token', () => {
  const SECRET = 'khoa-bi-mat-toi-thieu-32-ky-tu-cho-test';

  it('token vừa phát → verify hợp lệ', () => {
    expect(verifyToken(issueToken(SECRET), SECRET)).toBeNull();
  });

  it('hai lần phát cho hai giá trị KHÁC nhau (có random thật, không phải hằng số)', () => {
    expect(issueToken(SECRET)).not.toBe(issueToken(SECRET));
  });

  it('⭐ token tự chế (không có secret) → SIGNATURE_MISMATCH', () => {
    // Đúng thứ kẻ tấn công cùng site làm được: đặt cookie và header khớp nhau.
    const forged = `${'a'.repeat(64)}.${'b'.repeat(64)}`;

    expect(verifyToken(forged, SECRET)).toBe('SIGNATURE_MISMATCH');
  });

  it('ký bằng secret khác → SIGNATURE_MISMATCH', () => {
    expect(verifyToken(issueToken('mot-khoa-khac-cung-du-32-ky-tu-nhe!!'), SECRET)).toBe(
      'SIGNATURE_MISMATCH',
    );
  });

  it('sửa một ký tự phần random → SIGNATURE_MISMATCH (chữ ký cũ không còn khớp)', () => {
    const token = issueToken(SECRET);
    const tampered = (token[0] === 'a' ? 'b' : 'a') + token.slice(1);

    expect(verifyToken(tampered, SECRET)).toBe('SIGNATURE_MISMATCH');
  });

  it.each([
    ['không có dấu chấm', 'abc'],
    ['ba phần', 'a.b.c'],
    ['không phải hex', `${'z'.repeat(64)}.${'z'.repeat(64)}`],
    ['sai độ dài', 'aa.bb'],
  ])('token %s → MALFORMED, không ném lỗi', (_name, token) => {
    expect(verifyToken(token, SECRET)).toBe('MALFORMED');
  });

  it.each([
    ['không có', undefined],
    ['chuỗi rỗng', ''],
  ])('token %s → MISSING', (_name, token) => {
    expect(verifyToken(token, SECRET)).toBe('MISSING');
  });

  describe('verifyRequest — cookie so với header', () => {
    it('cookie và header khớp, ký hợp lệ → qua', () => {
      const token = issueToken(SECRET);

      expect(verifyRequest({ cookie: token, header: token, secret: SECRET })).toBeNull();
    });

    it.each([
      ['thiếu header', true, false],
      ['thiếu cookie', false, true],
      ['thiếu cả hai', false, false],
    ])('%s → MISSING', (_name, hasCookie, hasHeader) => {
      const token = issueToken(SECRET);

      expect(
        verifyRequest({
          cookie: hasCookie ? token : undefined,
          header: hasHeader ? token : undefined,
          secret: SECRET,
        }),
      ).toBe('MISSING');
    });

    it('cookie và header là hai token hợp lệ nhưng KHÁC nhau → MISMATCH', () => {
      // Tách riêng MISMATCH khỏi SIGNATURE_MISMATCH có ích khi đọc log sự cố: lệch nhau là
      // dấu hiệu CSRF thật, ký sai là dấu hiệu token bị chế. Gộp lại là mất thông tin đó.
      expect(
        verifyRequest({ cookie: issueToken(SECRET), header: issueToken(SECRET), secret: SECRET }),
      ).toBe('MISMATCH');
    });

    it('⭐ cookie và header KHỚP nhau nhưng đều tự chế → SIGNATURE_MISMATCH', () => {
      const forged = `${'a'.repeat(64)}.${'b'.repeat(64)}`;

      // Double-submit KHÔNG ký sẽ cho ca này qua. Đây là lý do có chữ ký.
      expect(verifyRequest({ cookie: forged, header: forged, secret: SECRET })).toBe(
        'SIGNATURE_MISMATCH',
      );
    });
  });
});
