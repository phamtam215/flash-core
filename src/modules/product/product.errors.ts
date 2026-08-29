import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../common';

/**
 * Lỗi nghiệp vụ của module product. Kế thừa `DomainError` nên service không cần biết gì về
 * HTTP — `AllExceptionsFilter` tự map sang status code ở biên (xem src/common/filters/).
 */

/** Slug là khoá con người đọc được và tự chọn được (client hoặc tự sinh từ `name`). */
export class SlugAlreadyExistsError extends DomainError {
  readonly httpStatus = HttpStatus.CONFLICT;
  readonly code = 'SLUG_ALREADY_EXISTS';

  constructor() {
    super('Slug này đã được dùng cho sản phẩm khác');
  }
}

export class ProductNotFoundError extends DomainError {
  readonly httpStatus = HttpStatus.NOT_FOUND;
  readonly code = 'PRODUCT_NOT_FOUND';

  constructor() {
    super('Không tìm thấy sản phẩm');
  }
}

export class SkuNotFoundError extends DomainError {
  readonly httpStatus = HttpStatus.NOT_FOUND;
  readonly code = 'SKU_NOT_FOUND';

  constructor() {
    super('Không tìm thấy biến thể (SKU)');
  }
}

/**
 * Trùng `(productId, size, color)` — đây là cơ chế thay `Idempotency-Key` cho việc thêm SKU:
 * bấm "thêm biến thể" hai lần chỉ tạo được một dòng, lần thứ hai bị chặn ở đây.
 */
export class SkuAlreadyExistsError extends DomainError {
  readonly httpStatus = HttpStatus.CONFLICT;
  readonly code = 'SKU_ALREADY_EXISTS';

  constructor() {
    super('Biến thể (size + màu) này đã tồn tại cho sản phẩm');
  }
}

export class InvalidCursorError extends DomainError {
  readonly httpStatus = HttpStatus.BAD_REQUEST;
  readonly code = 'INVALID_CURSOR';

  constructor() {
    super('Cursor không hợp lệ');
  }
}
