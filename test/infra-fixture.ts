import Redis from 'ioredis';
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
 * **Lối thoát tự làm sạch CẢ HAI kho trước mỗi lần chạy**, để nó cho kết quả giống
 * Testcontainers (mỗi lần chạy một DB trắng và một Redis trắng). Thiếu bước này thì lần chạy
 * thứ hai đỏ hàng loạt vì dữ liệu của lần trước còn đó — ví dụ `auth.e2e-spec` đăng ký lại
 * email cũ và nhận 409.
 *
 * **Redis cũng phải dọn, và đây là bug thật đã gặp (2026-09-22):** bộ đếm rate limit sống
 * trong Redis với TTL 60 giây, khoá là `ratelimit:login:<email>`. Email của `auth.e2e-spec`
 * lại **cố định** (`user1@`, `user2@`…), nên chạy cả bộ hai lần trong vòng một phút thì lần
 * sau thừa hưởng bộ đếm của lần trước và test #12 nhận `429` sớm hơn dự kiến. Triệu chứng là
 * **flaky**: xanh, rồi đỏ, rồi lại xanh — kiểu lỗi tốn nhiều thời gian nhất để tin là có thật.
 * Cùng lý do, `stock:<skuId>` còn sót làm chiến lược `redis` đọc tồn kho cũ.
 *
 * Và nó **từ chối chạy** nếu tên database không kết thúc bằng `_test`: xoá sạch schema là thao
 * tác không hoàn tác được, nên phải có một hàng rào không phụ thuộc vào việc con người nhớ.
 */
export async function startInfra(): Promise<() => Promise<void>> {
  /**
   * Nới ngưỡng rate-limit-theo-IP cho toàn bộ integration test.
   *
   * **Vì sao cần:** cả bộ test đăng ký hàng trăm user, và tất cả đi từ cùng một IP
   * (`127.0.0.1`). Ngưỡng production 20 lần/giờ chặn luôn chính bộ test — phát hiện ngay lần
   * chạy đầu sau khi thêm rate limit ở Phase 9, với triệu chứng khó đoán: hai test **ở giữa**
   * file `async-payment` đỏ với `429`, còn mọi test trước đó xanh.
   *
   * Đặt ở đây chứ không rải vào từng spec: nó đúng cho mọi spec, và quên một chỗ là lại một
   * lần đi truy `429` từ đầu.
   *
   * `security.e2e-spec.ts` **ghi đè lại giá trị thấp** trong `beforeAll` của nó để kiểm chính
   * cơ chế này — nên dòng dưới đây không làm mất phần test của rate limit.
   */
  process.env.REGISTER_RATE_LIMIT_MAX ??= '100000';
  process.env.REFRESH_RATE_LIMIT_MAX ??= '100000';

  if (process.env.TEST_DATABASE_URL && process.env.TEST_REDIS_URL) {
    await resetSchema(process.env.TEST_DATABASE_URL);
    await resetRedis(process.env.TEST_REDIS_URL);
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

/**
 * `FLUSHDB` cho Redis test — tương đương "một container Redis mới".
 *
 * Hàng rào an toàn, cùng tinh thần với `_test` của Postgres: **bắt buộc trỏ vào một database
 * index khác 0**. Redis có 16 DB đánh số; DB 0 là nơi máy dev đang chạy thật (tồn kho, rate
 * limit, job BullMQ). `FLUSHDB` nhầm vào đó là xoá sạch trạng thái dev giữa lúc đang làm việc,
 * và không có lệnh nào hoàn tác.
 *
 * Nên `TEST_REDIS_URL` phải có dạng `redis://localhost:6379/1`.
 */
async function resetRedis(url: string): Promise<void> {
  const database = new URL(url).pathname.replace(/^\//, '');

  if (!database || database === '0') {
    throw new Error(
      `TEST_REDIS_URL phải chỉ rõ database index khác 0 (ví dụ redis://localhost:6379/1) — ` +
        'đang là "' + (database || '(không có)') + '". Từ chối FLUSHDB để tránh xoá Redis dev.',
    );
  }

  const client = new Redis(url, { maxRetriesPerRequest: 1, lazyConnect: true });
  try {
    await client.connect();
    await client.flushdb();
  } finally {
    client.disconnect();
  }
}
