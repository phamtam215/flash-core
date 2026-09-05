import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../common';

/**
 * Chữ ký không hợp lệ → `401`, và **thông điệp cố tình chung chung**.
 *
 * Nói rõ "chữ ký sai" hay "chữ ký hết hạn" là giúp người đang dò tìm biết mình sai ở đâu. Lý
 * do thật vẫn được log đầy đủ ở phía server kèm `correlationId` — người vận hành có thông
 * tin, kẻ tấn công thì không.
 */
export class InvalidWebhookSignatureError extends DomainError {
  readonly httpStatus = HttpStatus.UNAUTHORIZED;
  readonly code = 'INVALID_SIGNATURE';

  constructor() {
    super('Chữ ký webhook không hợp lệ');
  }
}

export class OrderNotPayableError extends DomainError {
  readonly httpStatus = HttpStatus.CONFLICT;
  readonly code = 'ORDER_NOT_PAYABLE';

  constructor() {
    super('Đơn không ở trạng thái chờ thanh toán');
  }
}

export class PaymentOrderNotFoundError extends DomainError {
  readonly httpStatus = HttpStatus.NOT_FOUND;
  readonly code = 'ORDER_NOT_FOUND';

  constructor() {
    super('Không tìm thấy đơn hàng');
  }
}
