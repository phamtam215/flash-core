import { type CanActivate, type ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import { ROLES_KEY, type Role } from './roles.decorator';
import type { AuthenticatedRequest } from './access-token.guard';

/**
 * Chặn request của người không đủ vai trò.
 *
 * **Luôn đặt SAU `AccessTokenGuard`** trong `@UseGuards(AccessTokenGuard, RolesGuard)` —
 * Nest chạy guard theo đúng thứ tự khai báo, và guard này đọc `request.role` do guard kia
 * gắn vào. Đảo thứ tự thì `role` là `undefined` và **mọi** request bị `403`, kể cả của admin.
 *
 * **Vai trò đọc từ JWT, không truy vấn DB** — cùng lựa chọn stateless với `AccessTokenGuard`.
 * Hệ quả phải chấp nhận và phải nói ra: **hạ quyền một người chỉ có hiệu lực sau khi access
 * token của họ hết hạn (≤15 phút)**. Muốn tức thì thì phải hỏi DB mỗi request — thêm một
 * round-trip vào mọi endpoint để rút ngắn một khe 15 phút mà dự án chưa có nhu cầu. Đây đúng
 * là đánh đổi đã ghi cho việc xoá user ở `access-token.guard.ts`, không phải ngoại lệ mới.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Không khai `@Roles(...)` ⇒ không yêu cầu vai trò nào. Guard này chỉ lọc thêm, nó KHÔNG
    // thay `AccessTokenGuard`: route nào cần đăng nhập vẫn phải khai guard kia.
    if (!required || required.length === 0) return true;

    const { role } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (role && required.includes(role)) return true;

    // `403` chứ không `404`: khác với "đơn của người khác" (nơi 404 để không tiết lộ đơn đó
    // tồn tại), ở đây endpoint là công khai ai cũng biết có — giấu nó không mua được gì, mà
    // còn làm người dùng hợp lệ bị thiếu quyền không hiểu vì sao.
    throw new ForbiddenException({
      code: 'FORBIDDEN_ROLE',
      message: 'Tài khoản không có quyền thực hiện thao tác này',
    });
  }
}
