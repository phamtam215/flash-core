import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';

import { ENV, type Env } from '../../config';
import { RedisService } from '../../infra/redis';
import { AuthRepository } from './auth.repository';
import type { LoginDto, PublicUser, RegisterDto } from './auth.dto';
import {
  EmailAlreadyExistsError,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  TooManyLoginAttemptsError,
} from './auth.errors';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface AuthResult {
  user: PublicUser;
  tokens: TokenPair;
}

/**
 * Tham số Argon2id theo khuyến nghị OWASP (m=19 MiB, t=2, p=1).
 *
 * Ba con số này là một **đánh đổi trực tiếp giữa bảo mật và tải server**: tăng lên thì kẻ
 * tấn công dò chậm hơn, nhưng mỗi lần đăng nhập cũng tốn RAM và CPU thật của mình. Dưới
 * flash sale, hàng nghìn lượt đăng nhập cùng lúc × 19 MiB là con số phải tính tới.
 *
 * `argon2id` là biến thể nên dùng: nó trộn cả argon2i (chống tấn công side-channel) và
 * argon2d (chống GPU), thay vì chỉ được một trong hai.
 */
const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 19456, // KiB = 19 MiB
  timeCost: 2,
  parallelism: 1,
} as const;

/**
 * Hash giả dùng khi email không tồn tại.
 *
 * Vì sao cần: nếu email không có thì trả lỗi ngay, thời gian phản hồi sẽ **ngắn hơn hẳn** so
 * với trường hợp email có thật (vì bỏ qua bước verify tốn ~100ms). Kẻ tấn công đo thời gian
 * là biết email nào tồn tại — đúng thứ mà việc dùng chung một message lỗi đang cố che.
 * Chạy verify trên hash giả để hai nhánh tốn thời gian tương đương. Tên gọi: timing attack.
 */
const DUMMY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHR2YWx1ZQ$Rd0fFYFwPmYxDBQ0kfBNaMDpjcQVQPBmJ0Q0GKGXQ0Y';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly repo: AuthRepository,
    private readonly redis: RedisService,
    private readonly jwt: JwtService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async register(dto: RegisterDto): Promise<PublicUser> {
    const existing = await this.repo.findUserByEmail(dto.email);
    if (existing) throw new EmailAlreadyExistsError();

    const passwordHash = await argon2.hash(dto.password, ARGON2_OPTIONS);
    const user = await this.repo.createUser(dto.email, passwordHash);

    this.logger.log({ userId: user.id }, 'Đăng ký tài khoản mới');
    return { id: user.id, email: user.email };
  }

  async login(dto: LoginDto): Promise<AuthResult> {
    await this.assertNotRateLimited(dto.email);

    const user = await this.repo.findUserByEmail(dto.email);

    // Luôn chạy verify, kể cả khi không tìm thấy user — xem ghi chú ở DUMMY_HASH.
    const passwordMatches = await argon2.verify(user?.passwordHash ?? DUMMY_HASH, dto.password);

    if (!user || !passwordMatches) {
      await this.recordFailedLogin(dto.email);
      throw new InvalidCredentialsError();
    }

    // Đăng nhập được rồi thì xoá bộ đếm: những lần gõ nhầm trước đó không nên trừ vào hạn
    // mức của lần sau.
    await this.redis.reset(this.rateLimitKey(dto.email));

    const tokens = await this.issueTokenPair(user.id, randomUUID());
    this.logger.log({ userId: user.id }, 'Đăng nhập thành công');
    return { user: { id: user.id, email: user.email }, tokens };
  }

  /**
   * Đổi refresh token lấy cặp token mới — phần khó nhất của phase này.
   *
   * Luật: mỗi refresh token dùng được **đúng một lần**. Dùng lần thứ hai nghĩa là có hai bên
   * cùng giữ token đó, và không có cách nào biết bên nào là chủ thật. Xử lý an toàn duy nhất
   * là thu hồi cả family, buộc cả hai đăng nhập lại.
   */
  async refresh(rawToken: string): Promise<AuthResult> {
    const stored = await this.repo.findRefreshTokenByHash(this.hashToken(rawToken));
    if (!stored) throw new InvalidRefreshTokenError();

    if (stored.revokedAt) {
      // REUSE DETECTION. Đây là tình huống đáng báo động, phải log ở mức cảnh báo để Phase 6
      // gắn được cảnh báo thật — nó là dấu hiệu token bị đánh cắp.
      const revokedCount = await this.repo.revokeFamily(stored.familyId);
      this.logger.warn(
        { userId: stored.userId, familyId: stored.familyId, revokedCount },
        'Phát hiện refresh token bị dùng lại — đã thu hồi toàn bộ family',
      );
      throw new InvalidRefreshTokenError();
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new InvalidRefreshTokenError();
    }

    const user = await this.repo.findUserById(stored.userId);
    if (!user) throw new InvalidRefreshTokenError();

    // Giữ nguyên familyId: cặp token mới vẫn thuộc cùng một lần đăng nhập.
    const { accessToken, refreshToken, tokenHash, expiresAt } = await this.buildTokenPair(
      user.id,
      stored.familyId,
    );

    await this.repo.rotateRefreshToken({
      oldTokenId: stored.id,
      userId: user.id,
      newTokenHash: tokenHash,
      familyId: stored.familyId,
      expiresAt,
    });

    return { user: { id: user.id, email: user.email }, tokens: { accessToken, refreshToken } };
  }

  /**
   * Logout: thu hồi đúng token đang dùng.
   *
   * Không ném lỗi khi token không hợp lệ — logout phải **idempotent**. Bấm hai lần, hoặc bấm
   * khi token đã hết hạn, đều phải cho kết quả "đã đăng xuất", không phải màn hình lỗi.
   */
  async logout(rawToken: string | undefined): Promise<void> {
    if (!rawToken) return;

    const stored = await this.repo.findRefreshTokenByHash(this.hashToken(rawToken));
    if (stored && !stored.revokedAt) {
      await this.repo.revokeToken(stored.id);
      this.logger.log({ userId: stored.userId }, 'Đăng xuất');
    }
  }

  async findPublicUser(id: string): Promise<PublicUser | null> {
    const user = await this.repo.findUserById(id);
    return user ? { id: user.id, email: user.email } : null;
  }

  // ── Nội bộ ──────────────────────────────────────────────────────────────────────────────

  private async issueTokenPair(userId: string, familyId: string): Promise<TokenPair> {
    const { accessToken, refreshToken, tokenHash, expiresAt } = await this.buildTokenPair(
      userId,
      familyId,
    );
    await this.repo.createRefreshToken({ userId, tokenHash, familyId, expiresAt });
    return { accessToken, refreshToken };
  }

  private async buildTokenPair(userId: string, familyId: string) {
    const accessToken = await this.jwt.signAsync(
      { sub: userId },
      { secret: this.env.JWT_ACCESS_SECRET, expiresIn: this.env.ACCESS_TOKEN_TTL },
    );

    // `jti` (JWT ID) là chuỗi ngẫu nhiên khiến hai refresh token của cùng một user, sinh
    // trong cùng một giây, vẫn khác nhau. Không có nó, hai token có thể trùng chuỗi → trùng
    // `tokenHash` → vi phạm ràng buộc UNIQUE.
    const refreshToken = await this.jwt.signAsync(
      { sub: userId, familyId, jti: randomUUID() },
      { secret: this.env.JWT_REFRESH_SECRET, expiresIn: this.env.REFRESH_TOKEN_TTL },
    );

    return {
      accessToken,
      refreshToken,
      tokenHash: this.hashToken(refreshToken),
      expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL * 1000),
    };
  }

  /**
   * SHA-256, không phải Argon2.
   *
   * Argon2 cố tình chậm để chống dò mật khẩu — thứ con người đặt nên đoán được. Refresh token
   * là chuỗi ngẫu nhiên do máy sinh, không có gì để đoán, nên không cần chậm. Và hàm này chạy
   * ở **mọi** lần refresh, dùng Argon2 ở đây là tự bắn vào chân mình về hiệu năng.
   */
  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private rateLimitKey(email: string): string {
    return `ratelimit:login:${email}`;
  }

  /**
   * Đếm theo **email**, không theo IP.
   *
   * Theo IP thì kẻ tấn công đổi IP là thoát (botnet, proxy rẻ tiền). Theo email thì dù dò từ
   * 1 000 IP khác nhau, một tài khoản vẫn chỉ chịu N lần thử mỗi phút.
   *
   * Đánh đổi đã biết: kẻ xấu có thể cố tình gõ sai để **khoá tài khoản người khác** — một
   * dạng từ chối dịch vụ. Chấp nhận ở phase này vì cửa sổ chỉ 60 giây. Cách chặn triệt để là
   * đếm theo cả email lẫn IP rồi lấy ngưỡng chặt hơn; ghi lại làm nợ cho Phase 6.
   */
  private async assertNotRateLimited(email: string): Promise<void> {
    const attempts = await this.redis.client.get(this.rateLimitKey(email));
    if (attempts && Number(attempts) >= this.env.LOGIN_RATE_LIMIT_MAX) {
      throw new TooManyLoginAttemptsError(this.env.LOGIN_RATE_LIMIT_WINDOW);
    }
  }

  private async recordFailedLogin(email: string): Promise<void> {
    await this.redis.incrementWithExpiry(
      this.rateLimitKey(email),
      this.env.LOGIN_RATE_LIMIT_WINDOW,
    );
  }
}
