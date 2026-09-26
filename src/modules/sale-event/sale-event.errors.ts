import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../common';

export class SaleEventNotFoundError extends DomainError {
  readonly httpStatus = HttpStatus.NOT_FOUND;
  readonly code = 'SALE_EVENT_NOT_FOUND';

  constructor() {
    super('Không tìm thấy đợt sale');
  }
}

export class SaleEventSlugTakenError extends DomainError {
  readonly httpStatus = HttpStatus.CONFLICT;
  readonly code = 'SALE_EVENT_SLUG_TAKEN';

  constructor(slug: string) {
    super(`Đã có đợt sale dùng slug "${slug}"`);
  }
}

/**
 * Publish là thao tác **cắt hàng ra khỏi SKU**, nên nó hỏng được vì lý do nghiệp vụ: SKU
 * không còn đủ hàng để cắt. Tách khỏi lỗi "không tìm thấy" để người vận hành biết phải làm gì
 * — nhập thêm hàng, hay sửa số phân bổ.
 */
export class NotEnoughStockToAllocateError extends DomainError {
  readonly httpStatus = HttpStatus.CONFLICT;
  readonly code = 'NOT_ENOUGH_STOCK_TO_ALLOCATE';

  constructor(skuId: string) {
    super(`SKU ${skuId} không còn đủ hàng để cắt cho đợt sale`, { skuId });
  }
}

export class SaleEventAlreadyPublishedError extends DomainError {
  readonly httpStatus = HttpStatus.CONFLICT;
  readonly code = 'SALE_EVENT_ALREADY_PUBLISHED';

  constructor() {
    super('Đợt sale đã publish rồi — cắt hàng lần hai sẽ trừ kho hai lần');
  }
}
