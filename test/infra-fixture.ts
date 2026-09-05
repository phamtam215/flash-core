import { Client } from 'pg';

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';

/**
 * Dựng Postgres + Redis cho integration test và đặt `DATABASE_URL`/`REDIS_URL`.
 *
 * **Mặc định** dùng Testcontainers: mỗi lần chạy có DB sạch hoàn toàn, không phụ thuộc máy ai
 * — đây là cách CI chạy và là mặc định đúng.
 *
 * **Lối thoát** khi đặt `TEST_DATABASE_URL` + `TEST_REDIS_URL`: dùng Postgres/Redis đã chạy
 * sẵn (`npm run up`) thay vì tự dựng. Cần cho môi trường không nối được Docker socket từ
 * trong Jest — sandbox của Claude Code chặn `connect` tới `docker.sock` (dù `docker` CLI vẫn
 * chạy được), nên Testcontainers báo "Could not find a working container runtime strategy".
 * Vẫn là Postgres/Redis THẬT nên bảo đảm của test không đổi; khác duy nhất là ai dựng chúng.
 *
 * **Lối thoát tự làm sạch schema trước mỗi lần chạy**, để nó cho kết quả giống Testcontainers
 * (mỗi lần chạy một DB trắng). Thiếu bước này thì lần chạy thứ hai đỏ hàng loạt vì dữ liệu của
 * lần trước còn đó — ví dụ `auth.e2e-spec` đăng ký lại email cũ và nhận 409.
 *
 * Và nó **từ chối chạy** nếu tên database không kết thúc bằng `_test`: xoá sạch schema là thao
 * tác không hoàn tác được, nên phải có một hàng rào không phụ thuộc vào việc con người nhớ.
 */
export async function startInfra(): Promise<() => Promise<void>> {
  if (process.env.TEST_DATABASE_URL && process.env.TEST_REDIS_URL) {
    await resetSchema(process.env.TEST_DATABASE_URL);
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
    process.env.REDIS_URL = process.env.TEST_REDIS_URL;
    return () => Promise.resolve();
  }

  const [postgres, redis]: [StartedPostgreSqlContainer, StartedTestContainer] = await Promise.all([
    new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('flashcore')
      .withUsername('flashcore')
      .withPassword('flashcore')
      .start(),
    new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
  ]);

  process.env.DATABASE_URL = postgres.getConnectionUri();
  process.env.REDIS_URL = `redis://${redis.getHost()}:${String(redis.getMappedPort(6379))}`;

  return async () => {
    await Promise.all([postgres.stop(), redis.stop()]);
  };
}

/**
 * Xoá sạch schema `public` của database test rồi tạo lại — tương đương "một container mới".
 *
 * Hàng rào an toàn: tên database **bắt buộc** kết thúc bằng `_test`. Gõ nhầm
 * `TEST_DATABASE_URL` sang DB dev (nơi có 100.000 dòng seed) mà không có hàng rào này thì mất
 * hết, và không có lệnh nào hoàn tác được.
 */
async function resetSchema(connectionString: string): Promise<void> {
  const database = new URL(connectionString).pathname.replace(/^\//, '');

  if (!database.endsWith('_test')) {
    throw new Error(
      `TEST_DATABASE_URL trỏ vào database "${database}" — tên phải kết thúc bằng "_test". ` +
        'Từ chối xoá schema để tránh xoá nhầm DB dev.',
    );
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query('DROP SCHEMA IF EXISTS public CASCADE');
    await client.query('CREATE SCHEMA public');
  } finally {
    await client.end();
  }
}
