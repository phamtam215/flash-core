import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import Redis from 'ioredis';

import { ENV, type Env } from '../../config';

/**
 * Kết nối tới Redis.
 *
 * Cấu trúc file này cố tình giống hệt `infra/prisma/prisma.service.ts`: một service `@Global`
 * giữ đúng MỘT kết nối cho cả app, mở ở `onModuleInit`, đóng ở `onModuleDestroy`. Module hạ
 * tầng nào sau này (BullMQ ở Phase 4) cũng theo khuôn đó.
 *
 * Vì sao chỉ một instance: mỗi `new Redis()` mở một TCP connection thật. Tạo mới ở mỗi chỗ
 * dùng thì số connection tăng theo số service, và Upstash (Phase 7) tính tiền/giới hạn theo
 * connection.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(@Inject(ENV) env: Env) {
    this.client = new Redis(env.REDIS_URL, {
      // Không tự kết nối lúc `new` — để `onModuleInit` chủ động gọi `connect()`, nhờ vậy lỗi
      // kết nối nổ ra đúng lúc khởi động app chứ không phải lúc request đầu tiên chạm tới.
      lazyConnect: true,

      // Số lần thử lại cho MỘT lệnh trước khi ném lỗi. Mặc định của ioredis là 20 — quá nhiều:
      // nó biến "Redis chết" thành "request treo rất lâu rồi mới lỗi". Rate limit là thứ được
      // phép hỏng nhanh, nên để 1.
      maxRetriesPerRequest: 1,
    });
  }

  async onModuleInit(): Promise<void> {
    await this.client.connect();
    this.logger.log('Đã kết nối Redis');
  }

  async onModuleDestroy(): Promise<void> {
    // `quit()` gửi lệnh QUIT rồi chờ Redis đóng tử tế, khác `disconnect()` là cắt ngay.
    await this.client.quit();
    this.logger.log('Đã đóng kết nối Redis');
  }

  /**
   * Đếm một lần "chạm" cho `key` trong cửa sổ `windowSeconds`, trả về số lần đã chạm.
   *
   * Vì sao gộp INCR + EXPIRE vào một `multi()`: hai lệnh rời nhau có thể bị ngắt giữa chừng
   * (process chết, mạng đứt) → key tồn tại mà **không có hạn dùng** → user đó bị khoá vĩnh
   * viễn. `multi()` gửi cả hai như một lô, Redis chạy liền mạch không xen kẽ lệnh khác.
   *
   * `EXPIRE` đặt lại mỗi lần gọi, nên đây là **cửa sổ trượt thô**: sai một chút so với cửa sổ
   * chính xác, nhưng đổi lại chỉ tốn 2 lệnh. Rate limit không cần chính xác tuyệt đối.
   */
  async incrementWithExpiry(key: string, windowSeconds: number): Promise<number> {
    const results = await this.client.multi().incr(key).expire(key, windowSeconds).exec();

    // `exec()` trả `null` khi transaction bị huỷ, và mỗi phần tử là [lỗi, kết quả].
    const incrResult = results?.[0];
    if (!incrResult || incrResult[0]) {
      throw new Error('Không đếm được rate limit trên Redis', { cause: incrResult?.[0] });
    }

    return Number(incrResult[1]);
  }

  /** Xoá bộ đếm — gọi khi đăng nhập thành công để lần sai trước đó không tính nữa. */
  async reset(key: string): Promise<void> {
    await this.client.del(key);
  }
}
