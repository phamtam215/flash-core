import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../errors/domain.error';

/**
 * `403` chứ KHÔNG `401`.
 *
 * `401` nghĩa là "anh chưa đăng nhập", và client của dự án này (`public/app.js`) phản ứng
 * bằng cách gọi `POST /auth/refresh` rồi thử lại — một vòng lặp vô ích, vì vấn đề không nằm ở
 * phiên. Tệ hơn: chính lần refresh đó cũng thiếu token CSRF nên cũng hỏng, và triệu chứng
 * cuối cùng người dùng thấy là "tự nhiên bị đăng xuất".
 *
 * `403` nói đúng chuyện: đã biết anh là ai, nhưng request này không chứng minh được nó xuất
 * phát từ trang của mình.
 */
export class CsrfTokenInvalidError extends DomainError {
  readonly httpStatus = HttpStatus.FORBIDDEN;
  readonly code = 'CSRF_TOKEN_INVALID';

  constructor(reason: string) {
    super(`Yêu cầu không có token CSRF hợp lệ (${reason}). Tải lại trang rồi thử lại.`);
  }
}
