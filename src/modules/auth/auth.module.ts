import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AccessTokenGuard } from './access-token.guard';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { USER_DIRECTORY } from './user-directory';

/**
 * `JwtModule.register({})` để rỗng là có chủ đích: secret và thời hạn được truyền **ở từng
 * lời gọi** `signAsync`/`verifyAsync`, không đặt mặc định ở đây.
 *
 * Lý do: access token và refresh token dùng **hai secret khác nhau**. Nếu đặt một secret mặc
 * định ở module, rất dễ vô tình ký refresh token bằng khoá của access token — và khi đó một
 * access token hết hạn vẫn có chữ ký hợp lệ để đem đi giả làm refresh token.
 *
 * Không export gì trừ những thứ khai trong `index.ts`: `AuthService` là chi tiết nội bộ.
 * Module khác cần biết "ai đang đăng nhập" thì dùng `AccessTokenGuard`, không gọi service.
 *
 * `JwtModule` cũng phải export, không chỉ `AccessTokenGuard`. Lý do phát hiện ở Phase 2 khi
 * `ProductModule` lần đầu dùng `AccessTokenGuard` từ NGOÀI `AuthModule`: `@UseGuards(Class)`
 * không tái dùng instance đã dựng sẵn của `AuthModule` như constructor injection thường —
 * `GuardsContextCreator` tra `AccessTokenGuard` trong injectables của module CHỨA CONTROLLER
 * (ở đây là `ProductModule`) rồi tự dựng lại từ đó, nên `JwtService` (dependency của guard)
 * phải resolve được NGAY TẠI `ProductModule`, không thừa hưởng từ chỗ `AuthModule` đã có sẵn.
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthRepository,
    AccessTokenGuard,
    // `useExisting` chứ không `useClass`: cùng một instance `AuthRepository`, chỉ nhìn qua
    // một cửa hẹp hơn. `useClass` sẽ dựng thêm một bản thứ hai.
    { provide: USER_DIRECTORY, useExisting: AuthRepository },
  ],
  exports: [AccessTokenGuard, JwtModule, USER_DIRECTORY],
})
export class AuthModule {}
