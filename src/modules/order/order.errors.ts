import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../common';

/**
 * Lỗi nghiệp vụ của module order.
 *
 * Điểm quan trọng nhất ở file này: **hết hàng là 409, không phải 500**. Hết hàng là trạng thái
 * nghiệp vụ hoàn toàn bình thường của flash sale (chỉ có 100 chiếc mà 1.000 người bấm). Nếu nó
 * thành 5xx thì error rate trong báo cáo k6 sẽ trộn "lỗi hệ thống" với "hết hàng" và không còn
 * nói lên điều gì — đúng cái bẫy đọc benchmark ghi ở tech-playbook §Phase 3.
 */
export class OutOfStockError extends DomainError {
  readonly httpStatus = HttpStatus.CONFLICT;
  readonly code = 'OUT_OF_STOCK';

  constructor() {
    super('Sản phẩm đã hết hàng');
  }
}

export class SkuNotFoundError extends DomainError {
  readonly httpStatus = HttpStatus.NOT_FOUND;
  readonly code = 'SKU_NOT_FOUND';

  constructor() {
    super('Không tìm thấy biến thể (SKU) đang bán');
  }
}

/**
 * `Idempotency-Key` là header BẮT BUỘC với mọi API ghi liên quan đơn hàng (luật trong
 * CLAUDE.md). Chặn ở biên, trước khi chạm DB.
 */
export class IdempotencyKeyRequiredError extends DomainError {
  readonly httpStatus = HttpStatus.BAD_REQUEST;
  readonly code = 'IDEMPOTENCY_KEY_REQUIRED';

  constructor() {
    super('Thiếu header Idempotency-Key');
  }
}

/**
 * Dùng cho cả "đơn không tồn tại" và "đơn của người khác" — cố tình KHÔNG phân biệt.
 * Trả 403 cho đơn của người khác là tiết lộ rằng đơn đó tồn tại.
 */
export class OrderNotFoundError extends DomainError {
  readonly httpStatus = HttpStatus.NOT_FOUND;
  readonly code = 'ORDER_NOT_FOUND';

  constructor() {
    super('Không tìm thấy đơn hàng');
  }
}
