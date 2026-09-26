import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';


import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test, type TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { json } from 'express';

import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/infra/prisma';
import { QueueService } from '../src/infra/queue';
import { csrfAgent } from './http-helper';
import { startInfra } from './infra-fixture';

/**
 * Integration test cho security baseline — Phase 9 khối 1–3.
 *
 * Test đáng tiền nhất ở đây là **#3**: quét file HTML tìm `<script>` inline và thuộc tính
 * `on*=`. Nó không cần trình duyệt, chạy trong mili giây, và bắt được đúng kiểu hỏng mà CSP
 * gây ra — trang vẫn *trông* bình thường ở mọi test khác, chỉ có JS im lặng không chạy trên
 * trình duyệt thật. Không có test này thì lỗi chỉ lộ ra khi có người mở trang.
 */
describe('Security baseline (e2e)', () => {
  let stopInfra: () => Promise<void>;
  let app: NestExpressApplication;
  let prisma: PrismaService;
  let queue: QueueService;

  const HEADERS = [
    'content-security-policy',
    'x-content-type-options',
    'referrer-policy',
    'permissions-policy',
  ];

  beforeAll(async () => {
    stopInfra = await startInfra();

    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'error';
    process.env.JWT_ACCESS_SECRET = 'test-access-secret-toi-thieu-32-ky-tu!!';
    process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-toi-thieu-32-ky-tu!';
    process.env.CSRF_SECRET = 'test-csrf-secret-toi-thieu-32-ky-tu!!!';
    process.env.PAYMENT_WEBHOOK_SECRET = 'test-webhook-secret-toi-thieu-32-ky-tu';
    // Tắt: test #2 kiểm rằng HSTS KHÔNG được gửi khi chạy http.
    process.env.COOKIE_SECURE = 'false';
    // Hạ ngưỡng để KIỂM chính cơ chế rate limit. `infra-fixture` nới nó lên rất cao cho mọi
    // spec khác (cả bộ test đăng ký hàng trăm user từ một IP) — spec này ghi đè lại.
    process.env.REGISTER_RATE_LIMIT_MAX = '5';
    process.env.REFRESH_RATE_LIMIT_MAX = '5';
    process.env.QUEUE_PREFIX = `test-${randomUUID().slice(0, 8)}`;

    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { env: { ...process.env }, stdio: 'pipe' });

    const moduleRef: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({ rawBody: true });
    app.use(cookieParser());
    // Giống hệt `main.ts`: tin đúng MỘT lớp proxy. Test #5 chứng minh nó bật đúng.
    app.set('trust proxy', 1);
    app.use(json({ limit: '32kb' }));
    await app.init();
    await app.listen(0);

    prisma = app.get(PrismaService);
    queue = app.get(QueueService);
  }, 300_000);

  afterAll(async () => {
    await app?.close();
    await queue?.connection.quit().catch(() => undefined);
    await stopInfra?.();
  });

  function baseUrl(): string {
    const address = app.getHttpServer().address() as { port: number };
    return `http://127.0.0.1:${String(address.port)}`;
  }

  // ── Khối 1: header ───────────────────────────────────────────────────────────────────

  it('1. ⭐ mọi response có đủ 4 header bảo vệ', async () => {
    const res = await fetch(`${baseUrl()}/health/live`);

    for (const name of HEADERS) {
      expect(res.headers.get(name)).toBeTruthy();
    }
    const csp = res.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    // `data:` bắt buộc có, nếu không favicon nhúng data URI biến mất kèm lỗi CSP.
    expect(csp).toContain('img-src');
    expect(csp).toContain('data:');
  });

  it('2. ⭐ COOKIE_SECURE=false → KHÔNG gửi HSTS', async () => {
    // Gửi HSTS trên http://localhost là tự khoá mình khỏi localhost một năm, và gỡ phải vào
    // chrome://net-internals. Đây là lý do header đó phải có điều kiện.
    const res = await fetch(`${baseUrl()}/health/live`);

    expect(res.headers.get('strict-transport-security')).toBeNull();
  });

  it('2b. trang tĩnh cũng có header (middleware chạy cho mọi route)', async () => {
    const res = await fetch(`${baseUrl()}/`);

    expect(res.headers.get('content-security-policy')).toBeTruthy();
  });

  it('3. ⭐ không file nào có <script> inline, on*= hay style= (ba thứ CSP chặn)', () => {
    const dir = join(__dirname, '..', 'public');
    const files = readdirSync(dir).filter((f) => f.endsWith('.html'));
    expect(files.length).toBeGreaterThan(0);

    for (const file of files) {
      const html = readFileSync(join(dir, file), 'utf8');

      // `<script>` KHÔNG có `src=` ⇒ inline ⇒ CSP `script-src 'self'` chặn.
      const inline = /<script(?![^>]*\bsrc=)[^>]*>/i.exec(html);
      expect(inline?.[0] ?? null).toBeNull();

      // `onclick=`, `onload=`... — cũng bị CSP chặn.
      const handler = /\son[a-z]+\s*=\s*["']/i.exec(html);
      expect(handler?.[0] ?? null).toBeNull();

      // `style="..."` cũng bị `style-src 'self'` chặn — không chỉ thẻ `<style>`. Chỗ này
      // hay bị bỏ sót vì ai cũng nghĩ CSP chỉ liên quan tới script.
      const inlineStyle = /\sstyle\s*=\s*["']/i.exec(html);
      expect(inlineStyle?.[0] ?? null).toBeNull();
    }
  });

  it('3b. ⭐ app.js cũng không sinh ra style= vào DOM', () => {
    // `public/*.html` sạch nhưng JS vẫn có thể chèn `style="..."` qua `innerHTML` — lúc đó
    // CSP chặn ở trình duyệt thật, còn mọi test khác vẫn xanh.
    const js = readFileSync(join(__dirname, '..', 'public', 'app.js'), 'utf8');

    expect(/\sstyle\s*=\s*["']/i.exec(js)?.[0] ?? null).toBeNull();
  });

  // ── Khối 2: rate limit theo IP + body limit ──────────────────────────────────────────

  it('4. ⭐ quá ngưỡng đăng ký từ một IP → 429 TOO_MANY_REQUESTS', async () => {
    const { token, csrfCookie } = await csrfAgent(app);
    const ip = `203.0.113.${String(Math.floor(Math.random() * 200) + 1)}`;
    const headers = {
      'Content-Type': 'application/json',
      'x-csrf-token': token,
      cookie: csrfCookie,
      'x-forwarded-for': ip,
    };

    // Ngưỡng ở spec này là 5 (đặt trong beforeAll), nên 7 lần là chắc chắn chạm.
    const codes: number[] = [];
    for (let i = 0; i < 7; i += 1) {
      const res = await fetch(`${baseUrl()}/auth/register`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ email: `rl-${randomUUID()}@example.com`, password: 'matkhau123' }),
      });
      codes.push(res.status);
    }

    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
    expect(codes[0]).toBe(201);
  });

  it('5. ⭐ IP khác không bị ảnh hưởng (chứng minh trust proxy bật đúng)', async () => {
    const { token, csrfCookie } = await csrfAgent(app);
    const headers = (ip: string) => ({
      'Content-Type': 'application/json',
      'x-csrf-token': token,
      cookie: csrfCookie,
      'x-forwarded-for': ip,
    });

    // Đốt hết hạn mức của một IP...
    const burnt = `198.51.100.${String(Math.floor(Math.random() * 200) + 1)}`;
    for (let i = 0; i < 7; i += 1) {
      await fetch(`${baseUrl()}/auth/register`, {
        method: 'POST',
        headers: headers(burnt),
        body: JSON.stringify({ email: `burn-${randomUUID()}@example.com`, password: 'matkhau123' }),
      });
    }

    // ...IP khác vẫn đăng ký được. Không bật `trust proxy` thì cả hai trông như cùng một IP
    // (IP của proxy) và test này đỏ.
    const other = await fetch(`${baseUrl()}/auth/register`, {
      method: 'POST',
      headers: headers('192.0.2.77'),
      body: JSON.stringify({ email: `ok-${randomUUID()}@example.com`, password: 'matkhau123' }),
    });

    expect(other.status).toBe(201);
  });

  it('6. body vượt giới hạn → 413, không tạo user', async () => {
    const { token, csrfCookie } = await csrfAgent(app);
    const before = await prisma.user.count();

    const res = await fetch(`${baseUrl()}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': token,
        cookie: csrfCookie,
        'x-forwarded-for': '192.0.2.200',
      },
      body: JSON.stringify({
        email: 'to-qua@example.com',
        password: 'matkhau123',
        rac: 'x'.repeat(64 * 1024),
      }),
    });

    expect(res.status).toBe(413);
    expect(await prisma.user.count()).toBe(before);
  });

  it('6b. ⭐ body quá lớn phải là 413, KHÔNG phải 500', async () => {
    // Bug thật, bắt được ngay lần chạy test đầu tiên sau khi đặt `json({ limit })`: lỗi của
    // `body-parser` không kế thừa `HttpException` nên filter cho nó rơi xuống nhánh cuối và
    // thành 500 — báo "server hỏng" trong khi thật ra client gửi sai, VÀ log ở mức `error`
    // nên ai gửi body to liên tục là tự tạo một trận bão cảnh báo.
    const { token, csrfCookie } = await csrfAgent(app);

    const res = await fetch(`${baseUrl()}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': token,
        cookie: csrfCookie,
        'x-forwarded-for': '192.0.2.201',
      },
      body: JSON.stringify({ email: 'a@b.com', password: 'matkhau123', rac: 'x'.repeat(64 * 1024) }),
    });

    expect(res.status).toBe(413);
    expect(((await res.json()) as { code: string }).code).toBe('PAYLOAD_TOO_LARGE');
  });

  it('6c. JSON hỏng → 400, cũng không phải 500', async () => {
    const { token, csrfCookie } = await csrfAgent(app);

    const res = await fetch(`${baseUrl()}/auth/register`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': token,
        cookie: csrfCookie,
        'x-forwarded-for': '192.0.2.202',
      },
      body: '{ khong phai json',
    });

    // Chỉ khẳng định 400. Nest đã tự bọc lỗi parse thành HttpException trước khi tới filter,
    // nên mã lỗi là `HTTP_ERROR` chứ không phải mã riêng — và đó là hành vi đúng sẵn, không
    // cần thêm code. Test này ở đây để nếu một ngày nó thành 500 thì có cái bắt.
    expect(res.status).toBe(400);
  });

  it('7. đăng ký bình thường vẫn 201 (ngưỡng không chặn nhầm người thật)', async () => {
    const { agent } = await csrfAgent(app);

    await agent
      .post('/auth/register')
      .set('X-Forwarded-For', '192.0.2.123')
      .send({ email: `binh-thuong-${randomUUID()}@example.com`, password: 'matkhau123' })
      .expect(201);
  });
});
