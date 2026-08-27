import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';

import { AccessTokenGuard } from './access-token.guard';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';

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
 */
@Module({
  imports: [JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, AccessTokenGuard],
  exports: [AccessTokenGuard],
})
export class AuthModule {}
