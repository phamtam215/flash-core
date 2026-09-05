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
 * Nhớ trỏ vào một database RIÊNG (`flashcore_test`), không phải DB dev.
 */
export async function startInfra(): Promise<() => Promise<void>> {
  if (process.env.TEST_DATABASE_URL && process.env.TEST_REDIS_URL) {
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
