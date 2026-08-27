/**
 * Public interface của module auth.
 *
 * Module khác (Phase 3: order) chỉ được import từ đây. Cụ thể chúng cần đúng hai thứ:
 * `AccessTokenGuard` để chặn request chưa đăng nhập, và `AuthenticatedRequest` để đọc
 * `req.userId`.
 *
 * `AuthService`, `AuthRepository`, các hàm cookie **cố tình không export** — đó là chi tiết
 * nội bộ. ESLint sẽ chặn nếu ai đó import sâu vào trong (xem eslint.config.mjs).
 */
export { AuthModule } from './auth.module';
export { AccessTokenGuard, type AuthenticatedRequest } from './access-token.guard';
