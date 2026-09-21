import { ForbiddenException } from '@nestjs/common';

import { RolesGuard } from './roles.guard';
import { Role } from './roles.decorator';

/**
 * Guard này quyết định ai được ghi vào catalog. Hai tính chất phải khoá bằng test, vì cả hai
 * đều **hỏng im lặng**:
 *
 * - route KHÔNG khai `@Roles(...)` phải **cho qua** — nếu chặn thì mọi endpoint chưa gắn
 *   decorator bỗng nhiên `403`, và triệu chứng trông như lỗi đăng nhập;
 * - route CÓ khai mà `request.role` rỗng phải **chặn**. `role` rỗng xảy ra khi ai đó đảo thứ
 *   tự `@UseGuards(RolesGuard, AccessTokenGuard)` — lúc đó mở thì mọi người đều thành admin.
 */
describe('RolesGuard', () => {
  function contextWith(role: string | undefined) {
    return {
      getType: () => 'http',
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ userId: 'u1', role }) }),
    } as never;
  }

  function guardRequiring(required: string[] | undefined) {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(required) };
    return new RolesGuard(reflector as never);
  }

  it('route không khai @Roles → cho qua (guard này chỉ LỌC THÊM, không thay AccessTokenGuard)', () => {
    expect(guardRequiring(undefined).canActivate(contextWith(Role.USER))).toBe(true);
  });

  it('@Roles() rỗng → cho qua', () => {
    expect(guardRequiring([]).canActivate(contextWith(Role.USER))).toBe(true);
  });

  it('đúng vai trò → cho qua', () => {
    expect(guardRequiring([Role.ADMIN]).canActivate(contextWith(Role.ADMIN))).toBe(true);
  });

  it('⭐ USER gọi route đòi ADMIN → 403 FORBIDDEN_ROLE', () => {
    expect(() => guardRequiring([Role.ADMIN]).canActivate(contextWith(Role.USER))).toThrow(
      ForbiddenException,
    );
  });

  it('⭐ request KHÔNG có role (đảo thứ tự guard) → CHẶN, không mở', () => {
    // Fail-closed. Mở ở đây là biến mọi người thành admin bằng một lỗi thứ tự khai báo mà
    // không test nào khác bắt được.
    expect(() => guardRequiring([Role.ADMIN]).canActivate(contextWith(undefined))).toThrow(
      ForbiddenException,
    );
  });

  it('nhiều vai trò được phép → khớp một cái là qua', () => {
    expect(guardRequiring([Role.ADMIN, Role.USER]).canActivate(contextWith(Role.USER))).toBe(true);
  });
});
