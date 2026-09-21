import { SetMetadata } from '@nestjs/common';

/**
 * Vai trò. Giữ nguyên tên với enum `Role` trong `schema.prisma` — khai lại ở đây thay vì
 * import từ Prisma Client để module khác dùng `@Roles(...)` mà không phải kéo theo cả client.
 */
export const Role = { USER: 'USER', ADMIN: 'ADMIN' } as const;
export type Role = (typeof Role)[keyof typeof Role];

export const ROLES_KEY = 'roles';

/**
 * Đánh dấu route cần vai trò nào. Phải đi kèm `RolesGuard` trong `@UseGuards(...)` —
 * decorator chỉ gắn metadata, nó không tự chặn gì cả.
 *
 * Cố tình **không** làm guard toàn cục như `CsrfGuard`: CSRF là luật đúng cho mọi endpoint
 * ghi, còn vai trò thì mỗi route một khác. Guard toàn cục ở đây sẽ phải mang một danh sách
 * đường dẫn — thứ luôn lệch với code thật.
 */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
