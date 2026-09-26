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

/**
 * Đơn không còn ở trạng thái huỷ được — thực tế chỉ xảy ra khi đơn đã `PAID`.
 *
 * `409` chứ không `400`: client gửi đúng hết, đây là **xung đột trạng thái**, không phải sai
 * input. Cùng họ với `OutOfStockError` — trạng thái nghiệp vụ, không phải lỗi hệ thống.
 *
 * Đơn đã `CANCELLED` KHÔNG rơi vào lỗi này mà trả `200`: huỷ là thao tác idempotent theo bản
 * chất, gọi n lần cho cùng kết quả. Trả lỗi cho lần gọi thứ hai biến một thao tác an toàn
 * thành thứ người dùng sợ bấm lại — trong khi bấm lại trên mạng chập chờn là chuyện thường.
 */
export class OrderNotCancellableError extends DomainError {
  readonly httpStatus = HttpStatus.CONFLICT;
  readonly code = 'ORDER_NOT_CANCELLABLE';

  constructor() {
    super('Đơn đã thanh toán, không huỷ được');
  }
}

/**
 * Đợt sale chưa mở, đã đóng, hoặc chưa publish.
 *
 * Tách khỏi `OutOfStockError` có chủ ý — cùng lý do với `SkuNotFoundError` ở Phase 3. Gộp cả
 * ba thành một `409` là mất luôn câu đáng hỏi nhất lúc có sự cố: *bán hết hàng, hay người ta
 * vào sớm, hay ai đó quên publish?*
 */
export class SaleNotOpenError extends DomainError {
  readonly httpStatus = HttpStatus.CONFLICT;
  readonly code = 'SALE_NOT_OPEN';

  constructor() {
    super('Đợt sale chưa mở hoặc đã kết thúc');
  }
}

/** Đã mua đủ số chiếc cho phép trong đợt này. */
export class PerUserLimitReachedError extends DomainError {
  readonly httpStatus = HttpStatus.CONFLICT;
  readonly code = 'PER_USER_LIMIT_REACHED';

  constructor() {
    super('Bạn đã mua đủ số lượng cho phép của mẫu này trong đợt sale');
  }
}
