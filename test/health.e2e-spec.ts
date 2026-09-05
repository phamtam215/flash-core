import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { startInfra } from './infra-fixture';

/**
 * Integration test đầu tiên của dự án: bật app thật, nối vào **Postgres thật** trong
 * Docker, rồi gọi HTTP thật.
 *
 * Vì sao không mock DB ở đây: mục đích của test này chính là chứng minh chuỗi
 * cấu hình → pg.Pool → Prisma adapter → Postgres hoạt động đầu-cuối. Mock đi thì test còn
 * lại đúng thứ nó không cần kiểm tra.
 *
 * Dùng `postgres:16-alpine` khớp docker-compose.yml và khớp Neon (Phase 6) — test trên
 * phiên bản khác rồi deploy là để dành lỗi cho môi trường thật.
 *
 * Chạy: `npm run test:int` (cần Docker đang bật; lần đầu sẽ pull image nên chậm).
 */
describe('Health (e2e)', () => {
  let stopInfra: () => Promise<void>;
  let app: INestApplication;

  beforeAll(async () => {
    // App đọc cấu hình từ process.env qua Zod, nên trỏ nó vào Postgres/Redis vừa dựng.
    // Không cần migration ở đây: readiness chỉ chạy `SELECT 1`, chưa cần bảng nào.
    stopInfra = await startInfra();

    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    // Phase 1 thêm hai biến bắt buộc. Giá trị test, không phải secret thật.
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-toi-thieu-32-ky-tu!!';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-toi-thieu-32-ky-tu!';
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-webhook-secret-toi-thieu-32-ky-tu';

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  }, 180_000);

  afterAll(async () => {
    await app?.close();
    await stopInfra?.();
  });

  describe('GET /health (liveness)', () => {
    it('trả 200 và uptime', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);

      expect(res.body).toMatchObject({ status: 'ok' });
      expect(typeof res.body.uptimeSeconds).toBe('number');
    });

    it('trả về correlationId trong response header', async () => {
      const res = await request(app.getHttpServer()).get('/health').expect(200);

      expect(res.headers['x-correlation-id']).toBeDefined();
    });

    it('giữ nguyên correlationId do client gửi lên', async () => {
      // Đây là điều kiện để nối được log của một request đi qua nhiều thành phần —
      // deliverable của Phase 5.
      const given = 'test-correlation-id-123';

      const res = await request(app.getHttpServer())
        .get('/health')
        .set('x-correlation-id', given)
        .expect(200);

      expect(res.headers['x-correlation-id']).toBe(given);
    });
  });

  describe('GET /ready (readiness)', () => {
    it('trả 200 khi Postgres còn sống', async () => {
      const res = await request(app.getHttpServer()).get('/ready').expect(200);

      // Phase 6 thêm hai check vào report. Dùng `toMatchObject` thay `toEqual` để test này
      // không vỡ mỗi lần thêm một dependency mới cần kiểm — thứ nó khẳng định là "ready khi
      // DB sống", không phải "report có đúng ba field".
      expect(res.body).toMatchObject({ ready: true, checks: { database: 'up', redis: 'up' } });
    });
  });

  describe('GET /khong-ton-tai', () => {
    it('lỗi đi qua exception filter chung: có code và correlationId', async () => {
      const res = await request(app.getHttpServer()).get('/khong-ton-tai').expect(404);

      expect(res.body.code).toBe('HTTP_ERROR');
      expect(res.body.correlationId).toBeDefined();
    });
  });
});
