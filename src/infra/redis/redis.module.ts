import { Global, Module } from '@nestjs/common';

import { RedisService } from './redis.service';

/**
 * `@Global()` cùng lý do với `PrismaModule`: một kết nối duy nhất cho cả app. Mỗi
 * `new Redis()` là một TCP connection thật, và Upstash (Phase 7) giới hạn số connection.
 *
 * Ranh giới: global không có nghĩa là gọi Redis ở khắp nơi. Phase 1 chỉ `AuthService` dùng,
 * cho đúng một việc là đếm rate limit.
 */
@Global()
@Module({
  providers: [RedisService],
  exports: [RedisService],
})
export class RedisModule {}
