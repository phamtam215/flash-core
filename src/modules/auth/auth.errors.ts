import { HttpStatus } from '@nestjs/common';

import { DomainError } from '../../common';

/**
 * Lỗi nghiệp vụ của auth. Kế thừa `DomainError` nên service không cần biết gì về HTTP —
 * `AllExceptionsFilter` tự map sang status code ở biên (xem src/common/filters/).
 */

/**
 * Dùng CHUNG cho cả "email không tồn tại" và "sai mật khẩu".
 *
 * Đây là quyết định bảo mật, không phải lười: nếu trả hai lỗi khác nhau, kẻ tấn công thử
 * lần lượt danh sách email và biết được email nào đã đăng ký ở hệ thống này (user
 * enumeration). Thông tin đó đủ để chuyển sang dò mật khẩu có mục tiêu, hoặc bán lại.
 */
export class InvalidCredentialsError extends DomainError {
  readonly httpStatus = HttpStatus.UNAUTHORIZED;
  readonly code = 'INVALID_CREDENTIALS';

  constructor() {
    super('Email hoặc mật khẩu không đúng');
  }
}

export class EmailAlreadyExistsError extends DomainError {
  readonly httpStatus = HttpStatus.CONFLICT;
  readonly code = 'EMAIL_ALREADY_EXISTS';

  constructor() {
    // Không nhắc lại email trong message: nó sẽ chảy vào log và vào response.
    super('Email này đã được đăng ký');
  }
}

/** Refresh token không tồn tại, hết hạn, hoặc đã bị thu hồi. */
export class InvalidRefreshTokenError extends DomainError {
  readonly httpStatus = HttpStatus.UNAUTHORIZED;
  readonly code = 'INVALID_REFRESH_TOKEN';

  constructor() {
    super('Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại');
  }
}

/**
 * Quá số lần đăng nhập sai cho phép.
 *
 * 429 chứ không phải 401: đây là lỗi "anh gọi quá nhiều", khác hẳn "anh sai mật khẩu".
 * Trộn hai loại làm error rate trong báo cáo benchmark trở nên vô nghĩa.
 */
export class TooManyLoginAttemptsError extends DomainError {
  readonly httpStatus = HttpStatus.TOO_MANY_REQUESTS;
  readonly code = 'TOO_MANY_LOGIN_ATTEMPTS';

  constructor(retryAfterSeconds: number) {
    super(`Sai quá nhiều lần. Thử lại sau ${String(retryAfterSeconds)} giây`, {
      retryAfterSeconds,
    });
  }
}
