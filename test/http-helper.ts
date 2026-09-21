import type { INestApplication } from '@nestjs/common';
import request from 'supertest';

import { CSRF_COOKIE, CSRF_HEADER } from '../src/common';

/**
 * Tạo một `supertest.agent` đã có sẵn token CSRF.
 *
 * Từ khi có `CsrfGuard` ở tầng app (ADR-009), **mọi** request ghi đều cần cặp cookie+header
 * khớp nhau. Agent của supertest tự giữ cookie, nhưng header thì phải tự gắn — và gắn tay ở
 * hơn 80 chỗ gọi là cách chắc chắn để một ngày nào đó có chỗ quên, rồi người ta "sửa" bằng
 * cách miễn CSRF cho route đó.
 *
 * `agent.set(...)` đặt header mặc định cho mọi request sau của agent, nên toàn bộ file test
 * chỉ cần đổi đúng dòng tạo agent.
 *
 * Trả kèm `token` và `cookie` thô cho các test bắn **song song bằng `fetch`** — supertest tự
 * `listen()` rồi đóng server sau mỗi request nên n request song song qua nó sẽ đỏ
 * `ECONNRESET` (bug thật ở Phase 3 test #8, ghi ở tech-playbook §Testing).
 */
export async function csrfAgent(app: INestApplication): Promise<{
  agent: ReturnType<typeof request.agent>;
  token: string;
  csrfCookie: string;
}> {
  const agent = request.agent(app.getHttpServer());

  // Một GET bất kỳ đi qua router của Nest là đủ để middleware phát cookie. Dùng `/health/live`
  // vì nó không cần đăng nhập, không chạm DB, và luôn tồn tại.
  const res = await agent.get('/health/live');
  const token = readCsrfCookie(res.headers['set-cookie'] as unknown as string[] | undefined);
  if (!token) throw new Error('Không nhận được cookie CSRF — middleware phát token có vấn đề?');

  agent.set(CSRF_HEADER, token);
  return { agent, token, csrfCookie: `${CSRF_COOKIE}=${token}` };
}

function readCsrfCookie(setCookie: string[] | undefined): string | undefined {
  const found = (setCookie ?? []).find((c) => c.startsWith(`${CSRF_COOKIE}=`));
  return found?.split(';')[0]?.slice(CSRF_COOKIE.length + 1);
}
