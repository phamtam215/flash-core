import { decodeCursor, encodeCursor, InvalidCursorError } from './cursor';

describe('common/pagination/cursor', () => {
  it('round-trip: decode(encode(x)) === x', () => {
    const original = {
      createdAt: new Date('2026-08-29T12:34:56.789Z'),
      id: '3f1b9c4e-2d55-4a1e-8b1a-0f1b2c3d4e5f',
    };

    const cursor = encodeCursor(original);
    const decoded = decodeCursor(cursor);

    expect(decoded.createdAt.toISOString()).toBe(original.createdAt.toISOString());
    expect(decoded.id).toBe(original.id);
  });

  it('cursor là chuỗi base64url MỜ — không lộ thẳng ISO date/uuid ra ngoài', () => {
    const cursor = encodeCursor({ createdAt: new Date('2026-01-01T00:00:00.000Z'), id: 'abc' });
    expect(cursor).not.toContain('2026-01-01');
    expect(cursor).not.toContain('_');
  });

  it('cursor rác (test case #9 trong spec Phase 2) → ném InvalidCursorError, không phải 500', () => {
    expect(() => decodeCursor('abc-khong-decode-duoc')).toThrow(InvalidCursorError);
  });

  it('cursor rỗng hoặc thiếu dấu phân cách → InvalidCursorError', () => {
    expect(() => decodeCursor('')).toThrow(InvalidCursorError);
  });
});
