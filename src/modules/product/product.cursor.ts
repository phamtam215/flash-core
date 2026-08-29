import { InvalidCursorError } from './product.errors';

/**
 * Cursor (keyset) pagination theo cặp `(createdAt, id)` — xem
 * `docs/specs/phase2-product-inventory.md` §Cursor pagination để biết vì sao không dùng
 * offset, và vì sao cần CẢ HAI cột làm mốc (id một mình: UUID không mang nghĩa thời gian;
 * createdAt một mình: nhiều dòng seed cùng lúc có thể trùng mili-giây).
 *
 * Cursor trả cho client là chuỗi base64url MỜ (opaque) — client chỉ gửi lại y nguyên, không
 * tự đọc/ráp được nội dung bên trong.
 */
export interface Cursor {
  createdAt: Date;
  id: string;
}

export function encodeCursor(row: Cursor): string {
  return Buffer.from(`${row.createdAt.toISOString()}_${row.id}`, 'utf8').toString('base64url');
}

/** Ném `InvalidCursorError` (400) cho MỌI kiểu sai — client không cần biết sai ở đâu, chỉ cần biết cursor này không dùng được. */
export function decodeCursor(raw: string): Cursor {
  let decoded: string;
  try {
    decoded = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    throw new InvalidCursorError();
  }

  // "id" là UUID (không chứa "_"), nên tách ở dấu "_" cuối cùng là an toàn.
  const separatorIndex = decoded.lastIndexOf('_');
  if (separatorIndex === -1) throw new InvalidCursorError();

  const isoDate = decoded.slice(0, separatorIndex);
  const id = decoded.slice(separatorIndex + 1);
  const createdAt = new Date(isoDate);

  if (Number.isNaN(createdAt.getTime()) || id.length === 0) {
    throw new InvalidCursorError();
  }

  return { createdAt, id };
}
