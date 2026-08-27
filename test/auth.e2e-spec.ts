import { execFileSync } from 'node:child_process';

import type { INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { GenericContainer, type StartedTestContainer } from 'testcontainers';
import cookieParser from 'cookie-parser';
import request from 'supertest';

import { AppModule } from '../src/app.module';

/**
 * Integration test cho toàn bộ luồng auth — 12 case trong docs/specs/phase1-auth.md.
 *
 * Vì sao **không** mock Postgres và Redis: rủi ro của phase này nằm ở *tương tác*, không ở
 * logic đơn lẻ. Reuse detection chỉ đúng nếu transaction xoay token chạy thật; rate limit
 * chỉ đúng nếu Redis đếm thật. Mock đi thì test xanh 100% mà vẫn lọt bug — đúng cái bẫy
 * mô tả ở docs/tech-playbook.md §Xuyên suốt.
 *
 * Chạy: `npm run test:int` (cần Docker).
 */

/**
 * Đọc header `set-cookie`. Express trả về mảng khi có nhiều cookie, chuỗi khi chỉ có một —
 * gom về một dạng để phần dưới không phải phân biệt.
 */
function setCookieHeaders(res: request.Response): string[] {
  const raw: unknown = res.headers['set-cookie'];
  if (Array.isArray(raw)) return raw as string[];
  return typeof raw === 'string' ? [raw] : [];
}

/** Lấy GIÁ TRỊ của một cookie (phần sau dấu `=`, trước dấu `;`). */
function readCookie(res: request.Response, name: string): string | undefined {
  const found = setCookieHeaders(res).find((c) => c.startsWith(`${name}=`));
  return found?.split(';')[0]?.split('=')[1];
}

/** Lấy nguyên dòng `set-cookie` để kiểm tra các cờ HttpOnly / SameSite / Path. */
function cookieAttributes(res: request.Response, name: string): string {
  return setCookieHeaders(res).find((c) => c.startsWith(`${name}=`)) ?? '';
}

describe('Auth (e2e)', () => {
  let postgres: StartedPostgreSqlContainer;
  let redis: StartedTestContainer;
  let app: INestApplication;

  // Email khác nhau cho mỗi test để chúng độc lập với thứ tự chạy — test dùng chung dữ liệu
  // là nguồn flaky số một.
  let counter = 0;
  const nextEmail = (): string => `user${String(++counter)}@example.com`;
  const PASSWORD = 'matkhau123';

  beforeAll(async () => {
    [postgres, redis] = await Promise.all([
      new PostgreSqlContainer('postgres:16-alpine')
        .withDatabase('flashcore')
        .withUsername('flashcore')
        .withPassword('flashcore')
        .start(),
      new GenericContainer('redis:7-alpine').withExposedPorts(6379).start(),
    ]);

    process.env.DATABASE_URL = postgres.getConnectionUri();
    process.env.REDIS_URL = `redis://${redis.getHost()}:${String(redis.getMappedPort(6379))}`;
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-toi-thieu-32-ky-tu!!';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-toi-thieu-32-ky-tu!';
    // Access token 1 giây để test được case "hết hạn" mà không phải chờ 15 phút.
    process.env.ACCESS_TOKEN_TTL = '1';
    process.env.LOGIN_RATE_LIMIT_MAX = '3';
    process.env.LOGIN_RATE_LIMIT_WINDOW = '60';

    // Dựng bảng bằng chính migration sẽ chạy trên production — không dùng `db push`, để test
    // kiểm chứng luôn rằng file migration đúng.
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
      env: { ...process.env },
      stdio: 'pipe',
    });

    const moduleRef: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    // main.ts gắn cookie-parser sau khi tạo app; ở test phải gắn lại, nếu không `req.cookies`
    // luôn undefined và mọi endpoint cần đăng nhập đều trả 401.
    app.use(cookieParser());
    await app.init();
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    await Promise.all([postgres?.stop(), redis?.stop()]);
  });

  // ── 1–2: đăng ký ────────────────────────────────────────────────────────────────────────

  it('1. đăng ký thành công và KHÔNG trả về mật khẩu dưới bất kỳ dạng nào', async () => {
    const email = nextEmail();
    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: PASSWORD })
      .expect(201);

    expect(res.body).toEqual({ id: expect.any(String), email });
    expect(JSON.stringify(res.body)).not.toContain(PASSWORD);
    expect(res.body).not.toHaveProperty('passwordHash');
  });

  it('2. đăng ký trùng email → 409', async () => {
    const email = nextEmail();
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: PASSWORD })
      .expect(201);

    const res = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: PASSWORD })
      .expect(409);

    expect(res.body.code).toBe('EMAIL_ALREADY_EXISTS');
  });

  // ── 3–4: đăng nhập ──────────────────────────────────────────────────────────────────────

  it('3. đăng nhập đúng → 200, cookie có HttpOnly và SameSite', async () => {
    const email = nextEmail();
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: PASSWORD });

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);

    expect(res.body).toEqual({ user: { id: expect.any(String), email } });
    // Token không được nằm trong body — nếu có thì JavaScript đọc được, và HttpOnly vô nghĩa.
    expect(JSON.stringify(res.body)).not.toContain('eyJ');

    const accessCookie = cookieAttributes(res, 'access_token');
    expect(accessCookie).toContain('HttpOnly');
    expect(accessCookie).toContain('SameSite=Strict');

    // Refresh token bị giới hạn path để không đính kèm mọi request.
    expect(cookieAttributes(res, 'refresh_token')).toContain('Path=/auth');
  });

  it('4. sai mật khẩu và email không tồn tại trả về CÙNG một lỗi', async () => {
    const email = nextEmail();
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: PASSWORD });

    const saiMatKhau = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'sai-mat-khau' })
      .expect(401);

    const emailKhongTonTai = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'khong-ton-tai@example.com', password: PASSWORD })
      .expect(401);

    // Khác nhau một chữ cũng đủ để kẻ tấn công dò xem email nào đã đăng ký.
    expect(saiMatKhau.body.code).toBe('INVALID_CREDENTIALS');
    expect(emailKhongTonTai.body.code).toBe('INVALID_CREDENTIALS');
    expect(saiMatKhau.body.message).toBe(emailKhongTonTai.body.message);
  });

  // ── 5–6: /auth/me ───────────────────────────────────────────────────────────────────────

  it('5. gọi /auth/me khi chưa đăng nhập → 401', async () => {
    const res = await request(app.getHttpServer()).get('/auth/me').expect(401);
    expect(res.body.code).toBe('UNAUTHENTICATED');
    expect(res.body).toHaveProperty('correlationId');
  });

  it('6. gọi /auth/me với access token → 200, không lộ passwordHash', async () => {
    const email = nextEmail();
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: PASSWORD });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD });

    const res = await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `access_token=${readCookie(login, 'access_token') ?? ''}`)
      .expect(200);

    expect(res.body).toEqual({ id: expect.any(String), email });
    expect(res.body).not.toHaveProperty('passwordHash');
  });

  // ── 7–9: refresh & reuse detection ──────────────────────────────────────────────────────

  it('7. refresh hợp lệ → cấp cặp token mới', async () => {
    const email = nextEmail();
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: PASSWORD });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD });

    const oldRefresh = readCookie(login, 'refresh_token');
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `refresh_token=${oldRefresh ?? ''}`)
      .expect(200);

    expect(res.body.user.email).toBe(email);
    expect(readCookie(res, 'refresh_token')).not.toBe(oldRefresh);
  });

  /**
   * TEST QUAN TRỌNG NHẤT CỦA PHASE — deliverable theo docs/SPEC.md.
   *
   * Mô phỏng đúng kịch bản token bị đánh cắp: kẻ trộm copy refresh token, người dùng thật
   * refresh trước (token cũ bị vô hiệu), rồi kẻ trộm dùng bản copy. Lần dùng thứ hai đó là
   * dấu hiệu **chắc chắn** có hai bên cùng giữ token, nên thu hồi cả family.
   */
  it('8. dùng lại refresh token đã xoay → thu hồi CẢ family', async () => {
    const email = nextEmail();
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: PASSWORD });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD });

    const tokenBiDanhCap = readCookie(login, 'refresh_token');

    // Người dùng thật refresh → token cũ bị vô hiệu, nhận token mới.
    const lanDau = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `refresh_token=${tokenBiDanhCap ?? ''}`)
      .expect(200);
    const tokenMoiCuaNguoiThat = readCookie(lanDau, 'refresh_token');

    // Kẻ trộm dùng bản copy của token cũ → bị phát hiện.
    const lanHai = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `refresh_token=${tokenBiDanhCap ?? ''}`)
      .expect(401);
    expect(lanHai.body.code).toBe('INVALID_REFRESH_TOKEN');

    // Và đây là phần khiến nó khác "chỉ từ chối token cũ": token MỚI của người dùng thật —
    // thứ chưa từng bị dùng lại — cũng phải chết theo, vì không thể biết ai là chủ thật.
    const tokenHopLeGioCungChet = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `refresh_token=${tokenMoiCuaNguoiThat ?? ''}`)
      .expect(401);
    expect(tokenHopLeGioCungChet.body.code).toBe('INVALID_REFRESH_TOKEN');
  });

  it('9. refresh token bịa → 401', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', 'refresh_token=token-bia-dat')
      .expect(401);
    expect(res.body.code).toBe('INVALID_REFRESH_TOKEN');
  });

  // ── 10–11: logout & hết hạn ─────────────────────────────────────────────────────────────

  it('10. logout → refresh token cũ hết dùng được, gọi lại logout vẫn 204', async () => {
    const email = nextEmail();
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: PASSWORD });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD });
    const refresh = readCookie(login, 'refresh_token');

    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', `refresh_token=${refresh ?? ''}`)
      .expect(204);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `refresh_token=${refresh ?? ''}`)
      .expect(401);

    // Logout phải idempotent: bấm lần hai không được thành màn hình lỗi.
    await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', `refresh_token=${refresh ?? ''}`)
      .expect(204);
  });

  it('11. access token hết hạn → 401, refresh xong gọi lại thì được', async () => {
    const email = nextEmail();
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: PASSWORD });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD });

    // ACCESS_TOKEN_TTL đặt 1 giây ở beforeAll. Chờ theo mốc thời gian là chấp nhận được ở
    // đây vì đang đợi một hạn dùng cố định, không phải đợi một sự kiện bất định.
    await new Promise((resolve) => setTimeout(resolve, 1500));

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `access_token=${readCookie(login, 'access_token') ?? ''}`)
      .expect(401);

    const refreshed = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', `refresh_token=${readCookie(login, 'refresh_token') ?? ''}`)
      .expect(200);

    await request(app.getHttpServer())
      .get('/auth/me')
      .set('Cookie', `access_token=${readCookie(refreshed, 'access_token') ?? ''}`)
      .expect(200);
  });

  // ── 12: rate limit ──────────────────────────────────────────────────────────────────────

  it('12. sai mật khẩu quá số lần cho phép → 429', async () => {
    const email = nextEmail();
    await request(app.getHttpServer()).post('/auth/register').send({ email, password: PASSWORD });

    // LOGIN_RATE_LIMIT_MAX = 3 ở beforeAll.
    for (let i = 0; i < 3; i++) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'sai-mat-khau' })
        .expect(401);
    }

    const res = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'sai-mat-khau' })
      .expect(429);
    expect(res.body.code).toBe('TOO_MANY_LOGIN_ATTEMPTS');

    // Chặn theo email nên **mật khẩu đúng cũng bị chặn** — đây là đánh đổi có chủ đích, đã
    // ghi trong auth.service.ts: nó ngăn brute-force từ nhiều IP, đổi lại kẻ xấu có thể cố
    // tình khoá tài khoản người khác trong 60 giây.
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: PASSWORD })
      .expect(429);
  });
});
