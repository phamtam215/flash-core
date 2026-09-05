import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../common';

/**
 * `/ready` trả 503 — và **log ở mức `warn`, không phải `error`**.
 *
 * Đây là chỗ trả món nợ ghi ở `docs/architecture.md` §Một chỗ chưa ổn từ Phase 0: Cloud Run
 * gọi `/ready` vài giây một lần, nên Postgres chớp 2 phút sẽ sinh hàng chục dòng `error` cho
 * một sự cố vận hành hoàn toàn bình thường. Cảnh báo dựng theo số dòng `error` sẽ kêu sai, và
 * cảnh báo kêu sai vài lần thì người ta tắt tiếng nó.
 *
 * "Instance này tạm chưa nhận traffic" là **thông tin vận hành**, không phải bug của code.
 */
export class NotReadyError extends DomainError {
  readonly httpStatus = HttpStatus.SERVICE_UNAVAILABLE;
  readonly code = 'NOT_READY';

  /** Ghi đè mặc định (5xx ⇒ `error`) — xem giải thích ở trên. */
  override get logLevel(): 'warn' {
    return 'warn';
  }

  constructor(checks: Readonly<Record<string, unknown>>) {
    super('Instance chưa sẵn sàng nhận traffic', checks);
  }
}
