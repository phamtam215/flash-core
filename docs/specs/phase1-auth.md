# Spec: Auth — đăng ký, đăng nhập, refresh token (Phase 1)

- **Phase:** 1
- **Ngày:** 2026-08-08
- **Trạng thái:** **Đã implement** 2026-08-08 — 14/14 test case xanh (21 unit + 12 integration), kể cả test #8 reuse detection
  (Docker đang tắt lúc code xong; cần `npm run test:int` để xác nhận)

## Mục tiêu

Cho user tạo tài khoản và đăng nhập, rồi giữ phiên đăng nhập an toàn bằng cặp
Access + Refresh Token. Phase 3 cần biết "ai đang bấm Săn ngay" để chống một người ôm hàng
và để gắn đơn vào đúng người — không có auth thì không làm được.

Mục tiêu học: **lưu mật khẩu đúng cách**, và **hiểu vì sao token bị đánh cắp lại phát hiện
được**.

## API

| Method | Path | Việc | Response |
|---|---|---|---|
| POST | `/auth/register` | Tạo tài khoản | `201 { id, email }` |
| POST | `/auth/login` | Đăng nhập | `200 { user }` + 2 cookie |
| POST | `/auth/refresh` | Đổi refresh token lấy cặp mới | `200 { user }` + 2 cookie mới |
| POST | `/auth/logout` | Thu hồi refresh token | `204` |
| GET | `/auth/me` | Thông tin user đang đăng nhập | `200 { id, email }` |

**Request schema (Zod):**

```ts
register: { email: string().email(), password: string().min(8).max(72) }
login:    { email: string().email(), password: string() }
// refresh và logout không có body — token nằm trong cookie
```

**Hai token, hai vai trò khác nhau:**

| | Access Token | Refresh Token |
|---|---|---|
| Dùng để | Gọi API hằng ngày | **Chỉ** để xin cặp token mới |
| Sống | 15 phút | 7 ngày |
| Lưu ở | HttpOnly Cookie, `path=/` | HttpOnly Cookie, `path=/auth` |
| Server có lưu không | **Không** (stateless, verify bằng chữ ký) | **Có** — lưu hash trong DB để thu hồi được |

Vì sao access token ngắn: nó không thu hồi được, nên rủi ro bị đánh cắp được giới hạn bằng
thời gian sống. Vì sao refresh token phải lưu DB: để thu hồi được khi logout hoặc khi phát
hiện bị đánh cắp.

## Schema DB

```prisma
model User {
  id           String   @id @default(uuid()) @db.Uuid
  email        String   @unique
  passwordHash String   @map("password_hash")
  createdAt    DateTime @default(now()) @map("created_at")
  refreshTokens RefreshToken[]
  @@map("users")
}

model RefreshToken {
  id        String    @id @default(uuid()) @db.Uuid
  userId    String    @map("user_id") @db.Uuid
  tokenHash String    @unique @map("token_hash")   // SHA-256, KHÔNG lưu token thô
  familyId  String    @map("family_id") @db.Uuid   // cả chuỗi rotation dùng chung 1 id
  expiresAt DateTime  @map("expires_at")
  revokedAt DateTime? @map("revoked_at")
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  @@index([userId])
  @@map("refresh_tokens")
}
```

`familyId` là chìa khoá của reuse detection — xem mục dưới.

## Luồng xử lý

**Đăng ký:** validate Zod → hash mật khẩu bằng Argon2id → `INSERT`. Email trùng → 409.
Không có transaction (một câu lệnh ghi).

**Đăng nhập:** tìm user theo email → `argon2.verify` → sinh cặp token → lưu hash refresh
token vào DB với `familyId` mới → set 2 cookie. Sai email **hoặc** sai mật khẩu đều trả
**cùng một lỗi 401** `INVALID_CREDENTIALS` — không được nói "email không tồn tại", vì như
vậy là cho kẻ tấn công dò xem email nào đã đăng ký.

**Refresh (phần khó nhất):**

1. Đọc refresh token từ cookie, hash lại, tra DB.
2. Không tìm thấy → 401.
3. **Tìm thấy nhưng `revokedAt` khác null** → đây là token đã dùng rồi mà vẫn bị dùng lại
   → **reuse detection**: thu hồi **toàn bộ token cùng `familyId`**, trả 401. Người dùng
   thật lẫn kẻ trộm đều bị đăng xuất — đúng như mong muốn.
4. Hết hạn → 401.
5. Hợp lệ → **trong một transaction**: đánh dấu token cũ `revokedAt = now()`, tạo token mới
   cùng `familyId`. Trả cặp cookie mới.

Transaction chỉ bọc bước 5. Không gọi gì ra ngoài trong transaction.

**Cơ chế reuse detection, nói bằng lời:** mỗi refresh token chỉ được dùng **đúng một lần**.
Nếu kẻ trộm copy token và dùng trước, người dùng thật sẽ dùng lại token cũ đó và bị phát
hiện. Nếu người dùng thật dùng trước, kẻ trộm bị phát hiện. **Dù ai dùng trước, lần thứ hai
luôn lộ.** Đó là toàn bộ ý tưởng.

## Edge cases bắt buộc xử lý

- [ ] Email đã tồn tại → 409, không lộ thông tin gì thêm
- [ ] Sai mật khẩu và email không tồn tại → **cùng** 401 `INVALID_CREDENTIALS`
- [ ] Refresh token đã dùng rồi lại dùng nữa → thu hồi cả `familyId`, 401
- [ ] Refresh token hết hạn → 401
- [ ] Logout → token bị thu hồi, dùng lại không được
- [ ] Mật khẩu và hash **không bao giờ** xuất hiện trong log (đã có `redact` từ Phase 0)
- [ ] Response của `/auth/me` không chứa `passwordHash`
- [ ] Brute-force login → rate limit chặn

## Test cases phải pass

| # | Test | Loại |
|---|---|---|
| 1 | Đăng ký thành công → 201, DB có user, `passwordHash` không phải mật khẩu thô | integration ✅ |
| 2 | Đăng ký email trùng → 409 | integration ✅ |
| 3 | Đăng nhập đúng → 200 + 2 cookie có cờ `HttpOnly` | integration ✅ |
| 4 | Sai mật khẩu và email lạ → **cùng** một response 401 | integration ✅ |
| 5 | `/auth/me` không có token → 401 | integration ✅ |
| 6 | `/auth/me` có access token → 200, **không** có `passwordHash` trong body | integration ✅ |
| 7 | Refresh hợp lệ → cặp token mới, token cũ hết dùng được | integration ✅ |
| 8 | **Dùng lại refresh token cũ → cả family bị thu hồi** (case quan trọng nhất) | integration ✅ |
| 9 | Refresh token hết hạn → 401 | integration ✅ |
| 10 | Logout → refresh token cũ không dùng được nữa | integration ✅ |
| 11 | Access token hết hạn → 401, refresh xong gọi lại thì được | integration ✅ |
| 12 | Đăng nhập sai N lần → 429 | integration ✅ |
| 13 | Zod chặn email sai định dạng / mật khẩu dưới 8 ký tự | unit ✅ |
| 14 | Chuẩn hoá email (chữ thường, cắt khoảng trắng), loại field lạ | unit ✅ |

Test 8 là **deliverable của phase này** theo `docs/SPEC.md`.

**Trạng thái thật (2026-08-27):** 14/14 test case pass — 21/21 unit test + 12/12 integration
test (`test/auth.e2e-spec.ts`, chạy thật qua Testcontainers) + 5 test health e2e đi kèm,
tổng `npm run test:int` = 17/17. Chạy lần đầu dính bug môi trường (Prisma 7 tải WASM query
compiler cần `node --experimental-vm-modules` khi chạy dưới Jest) — đã sửa trong
`package.json`, chi tiết ở `docs/tech-playbook.md` §Xuyên suốt → Testing → Bug hay gặp.

## Ngoài phạm vi

- Quên mật khẩu, xác thực email, OAuth — không cần cho bài toán flash sale
- Role/permission (admin) — chưa có màn admin nào
- CSRF token — dùng `SameSite=Strict` là đủ cho phase này, ghi lại làm nợ

## Hai quyết định đã chốt (2026-08-08)

**1. Rate limit login → lưu đếm ở Redis**, không phải RAM.

Đếm trong RAM sai ngay khi có từ 2 instance trở lên: mỗi instance đếm riêng nên giới hạn
"5 lần/phút" thành 10 lần/phút với 2 instance. Cloud Run tự scale nên đây không phải giả
định xa vời. Redis đã dựng sẵn trong `docker-compose.yml` từ Phase 0 mà chưa ai dùng, và
Phase 3 (chiến lược C) chắc chắn cần Redis client — làm bây giờ là làm sớm việc phải làm.

**Hệ quả:** Phase 1 phát sinh thêm `src/infra/redis/` — module hạ tầng thứ hai, cấu trúc
copy từ `infra/prisma/`. Dùng biến `REDIS_URL` đã có sẵn trong `env.schema.ts`.

**2. Access token đọc từ HttpOnly Cookie**, không dùng header `Authorization: Bearer`.

`docs/SPEC.md` đã chốt HttpOnly Cookie, và Phase 5 có UI thật nên browser tự gửi cookie là
đường đi tự nhiên. Đổi lại: **test bằng curl/Postman phiền hơn** vì phải giữ
cookie jar — chấp nhận, vì integration test dùng `supertest` giữ cookie tự động.

Ghi chú bảo mật: HttpOnly chặn JavaScript đọc token (chống XSS lấy token), nhưng **không**
chặn CSRF — browser vẫn tự gửi cookie kèm request từ trang khác. Phase này dựa vào
`SameSite=Strict`; CSRF token là nợ đã ghi ở mục Ngoài phạm vi.

---

## Kiến thức của phase này nằm ở đâu

Spec này là **hợp đồng**. Phần *vì sao* — Argon2 vs bcrypt, XSS vs CSRF, vì sao HttpOnly chưa
đủ — và **đáp án 3 câu hỏi bản chất của Phase 1** nằm ở
[`tech-playbook.md` §Phase 1](../tech-playbook.md). Khoảng 15 phút.

## Bằng chứng Definition of Done

**14/14 test case pass** — 21 unit + 12 integration (`test/auth.e2e-spec.ts`), kể cả test #8
(reuse detection: dùng lại refresh token đã xoay → thu hồi cả family). Trạng thái tổng:
[`CLAUDE.md` §Trạng thái hiện tại](../../CLAUDE.md).
