/**
 * Cấu hình Prisma CLI (Prisma 7 trở lên).
 *
 * Từ Prisma 7, `datasource.url` không còn được khai báo trong `schema.prisma` nữa —
 * connection string cho các lệnh migrate/introspect nằm ở đây. Lợi ích: schema trở thành
 * file thuần mô tả cấu trúc, không lẫn thông tin môi trường.
 *
 * Runtime của app KHÔNG đọc file này — app tự tạo `pg.Pool` và truyền vào PrismaClient
 * qua driver adapter (xem src/infra/prisma/prisma.service.ts). Nói cách khác: file này chỉ
 * dành cho `prisma migrate` / `prisma studio` / `prisma db`.
 */
import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
