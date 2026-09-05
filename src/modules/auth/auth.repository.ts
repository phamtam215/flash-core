import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../infra/prisma';

/**
 * Toàn bộ truy cập DB của module auth nằm ở đây — quy tắc số 2 trong docs/architecture.md.
 *
 * Vì sao không cho service gọi thẳng Prisma: khi cần đổi cách lưu (thêm cache, đổi query,
 * tách bảng) thì chỉ phải sửa một file, và khi đọc service thì thấy được *nghiệp vụ* chứ
 * không lẫn với câu truy vấn.
 */
@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findUserByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async findUserById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  /** Cửa công khai cho module khác (`UserDirectory`) — chỉ trả đúng địa chỉ email. */
  async findEmailById(userId: string): Promise<string | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { email: true },
    });
    return user?.email ?? null;
  }

  async createUser(email: string, passwordHash: string) {
    return this.prisma.user.create({ data: { email, passwordHash } });
  }

  async findRefreshTokenByHash(tokenHash: string) {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  async createRefreshToken(input: {
    userId: string;
    tokenHash: string;
    familyId: string;
    expiresAt: Date;
  }) {
    return this.prisma.refreshToken.create({ data: input });
  }

  /**
   * Xoay token: vô hiệu token cũ và tạo token mới **trong cùng một transaction**.
   *
   * Vì sao phải cùng transaction: nếu tách đôi và process chết ở giữa, sẽ rơi vào một trong
   * hai trạng thái hỏng — token cũ đã vô hiệu mà token mới chưa kịp tạo (user mất phiên vô
   * cớ), hoặc token mới đã tạo mà token cũ vẫn dùng được (có hai token sống cùng lúc, phá
   * luôn ý nghĩa của reuse detection).
   *
   * Transaction chỉ bọc đúng hai lệnh ghi này — không có lời gọi mạng nào bên trong, đúng
   * luật "transaction boundary hẹp nhất có thể" trong CLAUDE.md.
   */
  async rotateRefreshToken(input: {
    oldTokenId: string;
    userId: string;
    newTokenHash: string;
    familyId: string;
    expiresAt: Date;
  }) {
    return this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: input.oldTokenId },
        data: { revokedAt: new Date() },
      });

      return tx.refreshToken.create({
        data: {
          userId: input.userId,
          tokenHash: input.newTokenHash,
          familyId: input.familyId,
          expiresAt: input.expiresAt,
        },
      });
    });
  }

  /**
   * Thu hồi TOÀN BỘ token cùng một family — dùng khi phát hiện reuse.
   *
   * `revokedAt: null` trong điều kiện để không ghi đè mốc thời gian của những token đã bị
   * thu hồi trước đó; mốc đầu tiên mới là mốc phản ánh đúng lúc token hết hiệu lực.
   */
  async revokeFamily(familyId: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async revokeToken(id: string): Promise<void> {
    await this.prisma.refreshToken.update({ where: { id }, data: { revokedAt: new Date() } });
  }
}
