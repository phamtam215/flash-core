/**
 * Public interface của module auth.
 *
 * Module khác (Phase 3: order) chỉ được import từ đây. Cụ thể chúng cần:
 * `AccessTokenGuard` để chặn request chưa đăng nhập, `AuthenticatedRequest` để đọc
 * `req.userId`, và từ Phase 4 là `UserDirectory` — cửa hẹp để hỏi địa chỉ email của một user
 * khi worker gửi mail xác nhận.
 *
 * `AuthService`, `AuthRepository`, các hàm cookie **cố tình không export** — đó là chi tiết
 * nội bộ. ESLint sẽ chặn nếu ai đó import sâu vào trong (xem eslint.config.mjs).
 */
export { AuthModule } from './auth.module';
export { AccessTokenGuard, type AuthenticatedRequest } from './access-token.guard';
export { USER_DIRECTORY, type UserDirectory } from './user-directory';
