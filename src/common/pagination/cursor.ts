import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../errors/domain.error';

/**
 * Cursor (keyset) pagination — dùng chung cho mọi API danh sách.
 *
 * Chuyển từ `modules/product/product.cursor.ts` ra `common/` ở Phase 3, đúng lúc module thứ
 * hai (`order`) cần tới: `docs/architecture.md` quy định `common/` chỉ chứa thứ **≥2 module**
 * dùng. Trước Phase 3 nó thuộc về `product` là đúng; giữ nguyên ở đó rồi cho `order` import
 * sâu vào mới là sai.
 *
 * Vì sao mốc là CẶP `(createdAt, id)` chứ không phải một cột: `id` (UUID v4) không mang nghĩa
 * thời gian nên không sắp xếp được; `createdAt` một mình thì nhiều dòng ghi cùng lúc có thể
 * trùng tới mili-giây, và khi mốc không phân biệt được thì trang sau sẽ bỏ sót hoặc lặp dòng.
 * `id` đứng sau làm tie-breaker để thứ tự là toàn phần.
 */
export interface Cursor {
  createdAt: Date;
  id: string;
}

/** Cursor không decode được / sai định dạng. 400, không phải 500. */
export class InvalidCursorError extends DomainError {
  readonly httpStatus = HttpStatus.BAD_REQUEST;
  readonly code = 'INVALID_CURSOR';

  constructor() {
    super('Cursor không hợp lệ');
  }
}

export function encodeCursor(row: Cursor): string {
  return Buffer.from(`${row.createdAt.toISOString()}_${row.id}`, 'utf8').toString('base64url');
}

/**
 * Ném `InvalidCursorError` cho MỌI kiểu sai — client không cần biết sai ở đâu, chỉ cần biết
 * cursor này không dùng được.
 */
export function decodeCursor(raw: string): Cursor {
  const decoded = Buffer.from(raw, 'base64url').toString('utf8');

  // `id` là UUID (không chứa "_"), nên tách ở dấu "_" cuối cùng là an toàn.
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

/**
 * Cắt đúng `limit` dòng từ kết quả `limit + 1` mà repository trả về, và tính `nextCursor` từ
 * dòng CUỐI CÙNG được giữ lại (không phải dòng dư ra).
 *
 * Vì sao repository lấy dư 1 dòng: để biết "còn trang sau không" mà không cần thêm một câu
 * `COUNT` — trên bảng lớn `COUNT` là câu quét toàn bộ, đắt hơn cả câu lấy dữ liệu.
 */
export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export function paginate<T extends Cursor>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items.at(-1);
  return { items, nextCursor: hasMore && last ? encodeCursor(last) : null };
}
