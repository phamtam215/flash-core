import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { ZodValidationPipe } from '../../common';
import { ENV, type Env } from '../../config';
import { AccessTokenGuard, type AuthenticatedRequest } from './access-token.guard';
import { clearAuthCookies, REFRESH_TOKEN_COOKIE, setAuthCookies } from './auth.cookies';
import { loginSchema, registerSchema, type LoginDto, type PublicUser, type RegisterDto } from './auth.dto';
import { AuthService } from './auth.service';

/**
 * Controller chỉ làm ba việc: nhận request, gọi service, gắn cookie vào response.
 * Không có logic nghiệp vụ nào ở đây — đó là việc của service.
 *
 * Token **không bao giờ** nằm trong response body, chỉ trong cookie `HttpOnly`. Trả token
 * trong body nghĩa là JavaScript đọc được nó, và như vậy `httpOnly` thành vô nghĩa.
 */
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  async register(@Body(new ZodValidationPipe(registerSchema)) dto: RegisterDto): Promise<PublicUser> {
    return this.auth.register(dto);
  }

  /**
   * `passthrough: true` để Nest vẫn tự serialize giá trị trả về thành JSON, trong khi mình
   * chỉ mượn `res` để gắn cookie. Thiếu cờ này thì Nest nhường quyền điều khiển response cho
   * mình hoàn toàn, và request sẽ **treo** vì không ai gọi `res.send()`.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: PublicUser }> {
    const { user, tokens } = await this.auth.login(dto);
    setAuthCookies(res, this.env, tokens);
    return { user };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<{ user: PublicUser }> {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_TOKEN_COOKIE];
    if (!token) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Phiên đăng nhập không hợp lệ, vui lòng đăng nhập lại',
      });
    }

    const { user, tokens } = await this.auth.refresh(token);
    setAuthCookies(res, this.env, tokens);
    return { user };
  }

  /**
   * Luôn trả 204, kể cả khi không có token — logout phải idempotent. Bấm hai lần, hoặc bấm
   * lúc phiên đã hết hạn, đều cho ra cùng một kết quả: đã đăng xuất.
   */
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    const token = (req.cookies as Record<string, string> | undefined)?.[REFRESH_TOKEN_COOKIE];
    await this.auth.logout(token);
    clearAuthCookies(res, this.env);
  }

  @Get('me')
  @UseGuards(AccessTokenGuard)
  async me(@Req() req: AuthenticatedRequest): Promise<PublicUser> {
    const user = await this.auth.findPublicUser(req.userId);
    if (!user) {
      // Token hợp lệ nhưng user đã bị xoá — hệ quả đã biết của guard stateless.
      throw new UnauthorizedException({ code: 'USER_NOT_FOUND', message: 'Tài khoản không tồn tại' });
    }
    return user;
  }
}
