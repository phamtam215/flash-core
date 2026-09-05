import { execFileSync } from 'node:child_process';

import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import { join } from 'node:path';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { startInfra } from './infra-fixture';

/**
 * Integration test Phase 5 — test case trong docs/specs/phase5-ui-demo.md.
 *
 * Bản thân giao diện không có test tự động (SPEC.md §Phase 5), nhưng **phần server phục vụ nó
 * thì có** — và đó mới là chỗ dễ hỏng: middleware tĩnh chạy TRƯỚC router của Nest, nên nếu
 * cấu hình sai thì một endpoint API bỗng trả về HTML, hoặc đường dẫn lạ trả HTML thay vì 404
 * JSON. Cả hai đều là lỗi im lặng: trình duyệt vẫn hiện trang, chỉ có client gọi API là vỡ.
 */
describe('UI demo (e2e)', () => {
  let stopInfra: () => Promise<void>;
  let app: INestApplication;

  beforeAll(async () => {
    stopInfra = await startInfra();

    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-toi-thieu-32-ky-tu!!';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-toi-thieu-32-ky-tu!';
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-webhook-secret-toi-thieu-32-ky-tu';

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env }, stdio: 'pipe' });

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>();
    // Đúng cấu hình của `main.ts` — test mà bỏ dòng này thì nó kiểm một app khác với app thật.
    (app as NestExpressApplication).useStaticAssets(join(__dirname, '..', 'public'), { index: false });
    await app.init();
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    await stopInfra?.();
  });

  it('1. GET / trả 200 và HTML', async () => {
    const res = await request(app.getHttpServer()).get('/').expect(200);

    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('Flash');
  });

  it('2. GET / KHÔNG cần đăng nhập — trang tự hỏi /auth/me rồi mới quyết định', async () => {
    // Nếu lỡ bọc guard vào đây thì người chưa đăng nhập nhận 401 và không bao giờ thấy được
    // màn đăng nhập — vòng lặp chết.
    await request(app.getHttpServer()).get('/').expect(200);
  });

  it('3. tài nguyên tĩnh phục vụ được, và KHÔNG nuốt route API', async () => {
    await request(app.getHttpServer()).get('/app.js').expect(200);
    await request(app.getHttpServer()).get('/styles.css').expect(200);

    // `/health` vẫn là JSON như trước khi có trang tĩnh.
    const health = await request(app.getHttpServer()).get('/health').expect(200);
    expect(health.headers['content-type']).toMatch(/application\/json/);
    expect(health.body).toHaveProperty('status', 'ok');
  });

  it('4. đường dẫn lạ trả 404 JSON đúng hình dạng lỗi chung, không trả HTML', async () => {
    const res = await request(app.getHttpServer()).get('/khong-ton-tai-dau').expect(404);

    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body).toMatchObject({ code: expect.any(String), correlationId: expect.any(String) });
  });
});
