import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infra/prisma';
import { QueueService } from '../src/infra/queue';
import { csrfAgent } from './http-helper';
import { startInfra } from './infra-fixture';

/**
 * Integration test cho RBAC — trả nợ ghi từ spec Phase 2 ("user nào đăng nhập cũng ghi được
 * catalog").
 *
 * Tính chất đáng khoá nhất **không** phải "admin ghi được" mà là **"user thường KHÔNG ghi
 * được, và request bị chặn TRƯỚC khi dữ liệu đổi"**. Chặn sau khi đã ghi thì guard chỉ làm
 * đẹp response, còn hỏng thì vẫn hỏng.
 *
 * Chạy: `npm run test:int:local`.
 */
describe('RBAC (e2e)', () => {
  let stopInfra: () => Promise<void>;
  let app: INestApplication;
  let prisma: PrismaService;
  let queue: QueueService;

  beforeAll(async () => {
    stopInfra = await startInfra();

    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-toi-thieu-32-ky-tu!!';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-toi-thieu-32-ky-tu!';
    process.env.CSRF_SECRET = 'test-csrf-secret-toi-thieu-32-ky-tu!!!';
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-webhook-secret-toi-thieu-32-ky-tu';
    process.env.QUEUE_PREFIX = `test-${randomUUID().slice(0, 8)}`;

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env }, stdio: 'pipe' });

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
    queue = app.get(QueueService);
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    // `app.close()` đã gọi `QueueService.onModuleDestroy`, nhưng BullMQ còn giữ vài kết nối
    // phụ do nó tự `duplicate()` bên trong. Thiếu dòng này thì Jest báo "did not exit one
    // second after the test run has completed" — cả bộ vẫn xanh, nên rất dễ bỏ qua.
    await queue?.connection.quit().catch(() => undefined);
    await stopInfra?.();
  });

  /** Đăng ký + (tuỳ chọn) nâng quyền + đăng nhập. Thứ tự quan trọng — xem test #5. */
  async function loginAs(role: 'USER' | 'ADMIN') {
    const { agent } = await csrfAgent(app);
    const email = `rbac-${randomUUID()}@example.com`;
    await agent.post('/auth/register').send({ email, password: 'matkhau123' }).expect(201);
    if (role === 'ADMIN') {
      await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });
    }
    await agent.post('/auth/login').send({ email, password: 'matkhau123' }).expect(200);
    return { agent, email };
  }

  function newProductBody() {
    const suffix = randomUUID().slice(0, 8);
    return {
      name: `Áo rbac ${suffix}`,
      slug: `ao-rbac-${suffix}`,
      skus: [{ size: 'M', color: 'Đen', priceVnd: 199_000, stock: 5 }],
    };
  }

  it('1. mặc định đăng ký là USER, KHÔNG phải ADMIN', async () => {
    const { email } = await loginAs('USER');

    expect((await prisma.user.findUniqueOrThrow({ where: { email } })).role).toBe('USER');
  });

  it('2. ⭐ USER thường POST /products → 403 FORBIDDEN_ROLE, và KHÔNG có product nào được tạo', async () => {
    const { agent } = await loginAs('USER');
    const body = newProductBody();

    const res = await agent.post('/products').send(body).expect(403);

    expect(res.body.code).toBe('FORBIDDEN_ROLE');
    // Chặn phải xảy ra TRƯỚC khi chạm DB. Chặn sau thì guard chỉ làm đẹp response.
    expect(await prisma.product.count({ where: { slug: body.slug } })).toBe(0);
  });

  it('3. ADMIN POST /products → 201', async () => {
    const { agent } = await loginAs('ADMIN');

    await agent.post('/products').send(newProductBody()).expect(201);
  });

  it('4. USER thường vẫn ĐỌC được catalog — RBAC chỉ chặn ghi', async () => {
    const { agent } = await loginAs('USER');

    await agent.get('/products').expect(200);
  });

  it('5. ⭐ nâng quyền SAU khi đã đăng nhập → token cũ vẫn là USER, vẫn 403', async () => {
    const { agent, email } = await loginAs('USER');
    await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });

    // Đây KHÔNG phải bug — vai trò nằm trong access token để guard không phải hỏi DB mỗi
    // request. Test này khoá lại hành vi đó để nó không đổi im lặng, và để người vấp nó biết
    // ngay phải làm gì.
    await agent.post('/products').send(newProductBody()).expect(403);
  });

  it('6. ⭐ ...đăng nhập lại thì quyền có hiệu lực ngay', async () => {
    const { agent, email } = await loginAs('USER');
    await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });

    await agent.post('/auth/login').send({ email, password: 'matkhau123' }).expect(200);

    await agent.post('/products').send(newProductBody()).expect(201);
  });

  it('7. refresh token cũng cập nhật vai trò — không phải đăng nhập lại mới được', async () => {
    const { agent, email } = await loginAs('USER');
    await prisma.user.update({ where: { email }, data: { role: 'ADMIN' } });

    // Đây là lý do khe chờ chỉ ≤15 phút (hạn access token) chứ không phải 7 ngày.
    await agent.post('/auth/refresh').expect(200);

    await agent.post('/products').send(newProductBody()).expect(201);
  });

  it('8. USER thường PATCH/DELETE product → 403, dữ liệu không đổi', async () => {
    const admin = await loginAs('ADMIN');
    const created = await admin.agent.post('/products').send(newProductBody()).expect(201);
    const id = (created.body.product as { id: string }).id;

    const { agent } = await loginAs('USER');
    await agent.patch(`/products/${id}`).send({ name: 'Bị đổi trộm' }).expect(403);
    await agent.delete(`/products/${id}`).expect(403);

    const after = await prisma.product.findUniqueOrThrow({ where: { id } });
    expect(after.name).not.toBe('Bị đổi trộm');
  });

  it('9. chưa đăng nhập → 401 (AccessTokenGuard chặn trước RolesGuard)', async () => {
    const { agent } = await csrfAgent(app);

    await agent.post('/products').send(newProductBody()).expect(401);
  });
});
