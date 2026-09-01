import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

import { ENV, type Env } from '../../config';
import { PrismaClient } from '../../generated/prisma/client';

/**
 * Kết nối tới Postgres.
 *
 * Từ Prisma 7, client không tự quản kết nối bằng Rust engine nữa — mình đưa vào một driver
 * adapter. Ở đây adapter bọc một `pg.Pool` **do mình tạo và cấu hình**, và đó là điểm đáng
 * chú ý nhất của file này:
 *
 * - Số connection tối đa trở thành một biến mình điều khiển (`DATABASE_POOL_MAX`). Ở Phase
 *   3, khi chạy chiến lược pessimistic lock với 1.000 VU, pool là thứ vỡ trước cả DB: mỗi
 *   transaction đang chờ khóa vẫn giữ một connection. Không tách được biến này ra thì lúc
 *   đọc kết quả benchmark sẽ kết luận sai là "pessimistic chậm" trong khi thật ra là
 *   "hết connection".
 * - Ở Phase 7, cùng chỗ này là nơi cắm Neon pooler (PgBouncer): nhiều instance Cloud Run ×
 *   pool mỗi instance có thể vượt giới hạn connection của Neon.
 *
 * Vì sao `extends PrismaClient` chứ không bọc lại (composition): để mọi chỗ dùng vẫn viết
 * `prisma.order.findMany()` và `prisma.$transaction()` như tài liệu Prisma, không phải học
 * thêm một lớp API riêng của dự án.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);
  private readonly pool: Pool;

  constructor(@Inject(ENV) env: Env) {
    const pool = new Pool({
      connectionString: env.DATABASE_URL,
      max: env.DATABASE_POOL_MAX,
    });

    super({ adapter: new PrismaPg(pool) });

    // Gán sau `super()` vì TypeScript không cho chạm `this` trước đó.
    this.pool = pool;
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log(`Đã kết nối Postgres (pool max = ${this.pool.options.max ?? 'default'})`);
  }

  /**
   * Đóng kết nối khi app tắt.
   *
   * Cần `app.enableShutdownHooks()` trong main.ts để hook này thật sự chạy khi nhận SIGTERM.
   * Bỏ bước này thì lúc Cloud Run thay revision (Phase 7), connection sẽ bị treo lại phía
   * Postgres cho tới khi timeout — và với Neon Free thì connection là tài nguyên có hạn.
   */
  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    await this.pool.end();
    this.logger.log('Đã đóng kết nối Postgres');
  }
}
