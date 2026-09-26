# Spec: Phase 9 — Security baseline + web dùng được

- **Phase:** 9
- **Ngày:** 2026-09-26 (viết lại sau khi rà baseline thật)
- **Trạng thái:** Draft — chờ Tâm duyệt (3 câu hỏi mở ở cuối)

> Hợp đồng của phase. Kiến thức (*CSP chặn gì*, *vì sao rate limit phải ở Redis*) viết vào
> [`tech-playbook.md`](../tech-playbook.md) §Phase 9.

## Mục tiêu

**Mọi thứ trong danh sách "phải có" đều có, và chứng minh được là có.** Không làm security
nâng cao (2FA, device fingerprint, audit log, WAF) — những thứ đó cần dữ liệu thật và một đội
vận hành để hiệu chỉnh, thêm vào một dự án học chỉ tốn công mà không kiểm chứng được.

Kèm theo: trang web đủ tử tế để dùng, không chỉ để quay demo.

## Rà baseline — hiện trạng thật (đo ngày 2026-09-26)

Đây là phần đáng giá nhất của spec: **đi hết danh sách phải-có rồi đối chiếu với code**, thay
vì đoán. Kết quả: **15/19 đã có sẵn từ các phase trước** — phần thiếu nhỏ hơn nhiều so với
cảm giác ban đầu.

| # | Phải có | Hiện trạng | Ở đâu |
|---|---|---|---|
| 1 | Băm mật khẩu bằng thuật toán memory-hard | ✅ Argon2id | `auth.service.ts` |
| 2 | Cookie `HttpOnly` + `Secure` + `SameSite` | ✅ cả ba | `auth.cookies.ts` |
| 3 | Refresh token xoay vòng + phát hiện dùng lại | ✅ thu hồi cả family | `auth.service.ts` |
| 4 | Chặn dò mật khẩu (rate limit **login**) | ✅ 5 lần/phút, đếm ở Redis | `auth.service.ts` |
| 5 | Chống **timing attack** lúc đăng nhập | ✅ verify trên `DUMMY_HASH` khi email không tồn tại | `auth.service.ts:54` |
| 6 | Không lộ email nào tồn tại | ✅ sai mật khẩu và email lạ trả **cùng** một lỗi | test #4 |
| 7 | CSRF | ✅ double-submit có ký HMAC, guard toàn cục fail-closed | [ADR-009](../adr/009-csrf-double-submit-co-ky.md) |
| 8 | Phân quyền | ✅ RBAC 2 vai trò, fail-closed | [spec RBAC](rbac.md) |
| 9 | Validate mọi input ở biên | ✅ Zod + `ZodValidationPipe` | `common/pipes/` |
| 10 | Chống SQL injection | ✅ Prisma tham số hoá, kể cả `$queryRaw` (tagged template) | `order.repository.ts` |
| 11 | Chống XSS khi render | ✅ `escapeHtml` ở mọi chỗ chèn dữ liệu người dùng | `public/app.js` |
| 12 | Không log dữ liệu nhạy cảm | ✅ Pino `redact`: cookie, authorization, `*.password`, `*.passwordHash` | `logger.module.ts:64` |
| 13 | Lỗi không lộ nội bộ ra client | ✅ 5xx trả message chung + `correlationId`; stack chỉ vào log | `all-exceptions.filter.ts` |
| 14 | Secret không hardcode, validate lúc khởi động | ✅ Zod, thiếu là app chết ngay | `env.schema.ts` |
| 15 | Webhook xác thực chữ ký | ✅ HMAC-SHA256 trên raw body + chống replay | `payment.signature.ts` |
| **16** | **Security header** | ❌ **KHÔNG CÓ CÁI NÀO** (0 dòng trong `src/`) | — |
| **17** | **Rate limit `POST /auth/register`** | ❌ **không giới hạn gì** | — |
| **18** | **Quét lỗ hổng phụ thuộc trong CI** | ❌ chưa có `npm audit` | — |
| **19** | **Giới hạn kích thước body** | ⚠️ đang dựa vào mặc định 100kb của Express — đúng, nhưng **ngầm** | — |

**Ba dòng ❌ và một dòng ⚠️ là toàn bộ phạm vi security của phase này.**

Dòng 17 đáng lo nhất, và lý do không nằm ở bản thân nó: **Phase 8 gắn giới hạn "2 chiếc/người"
vào *tài khoản*.** Đăng ký không giới hạn nghĩa là một script tạo 5.000 tài khoản = 5.000 suất
mua, và `perUserLimit` chỉ còn là gờ giảm tốc. Làm Phase 8 mà bỏ dòng này là vô hiệu hoá phần
khó nhất của chính Phase 8.

## Khối 1 — Năm security header

Tự viết một middleware ~30 dòng, **không dùng `helmet`** (xem Câu hỏi mở #2).

| Header | Giá trị | Chặn gì |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'` | Có lỗ XSS thì script chèn vào **vẫn không chạy** — lớp phòng thủ hoạt động *sau khi* code đã thủng |
| `X-Content-Type-Options` | `nosniff` | Trình duyệt đoán sai kiểu file rồi chạy nó như script |
| `Referrer-Policy` | `same-origin` | Rò đường dẫn nội bộ sang site khác |
| `Permissions-Policy` | `camera=(), microphone=(), geolocation=()` | Thu hẹp bề mặt |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` — **chỉ khi `COOKIE_SECURE=true`** | Hạ cấp HTTPS→HTTP |

**HSTS phải có điều kiện.** Gửi nó trên `http://localhost` là tự khoá mình khỏi localhost
trong một năm, và gỡ phải vào `chrome://net-internals/#hsts`. Dùng lại đúng cờ `COOKIE_SECURE`
đã có — một biến, hai nơi dùng, không thêm khái niệm.

**CSP là phần tốn công thật.** `script-src 'self'` giết mọi `<script>` inline và mọi `onclick=`
trong HTML. `img-src` phải có `data:` vì favicon đang nhúng bằng data URI. Phải rà lại
`public/` và gỡ JS ra file — và đó chính là giá trị, nó *ép* tách hành vi khỏi markup thay vì
tin lời hứa. Test #8 quét file để bắt, không dựa vào mắt người.

## Khối 2 — Rate limit `register` + body limit tường minh

`POST /auth/register` và `POST /auth/refresh` đếm theo **IP**, dùng lại
`RedisService.incrementWithExpiry` đã có — không viết cơ chế mới.

Vì sao theo IP chứ không theo email: lúc đăng ký thì **chưa có tài khoản để khoá**, và email
thì kẻ tấn công tự bịa ra vô hạn. IP là thứ duy nhất còn lại — không hoàn hảo (NAT chung,
proxy) nên ngưỡng phải rộng rãi: **20 lần/giờ mỗi IP**, đủ chặn script mà không phiền quán net.

Đọc IP **phải qua `X-Forwarded-For`** khi chạy sau Cloud Run, và **phải bật `trust proxy`** của
Express — thiếu bước đó thì mọi request trông như đến từ cùng một IP nội bộ và rate limit khoá
nhầm toàn bộ người dùng.

Body limit: đặt **tường minh** `json({ limit: '32kb' })`. Mặc định 100kb của Express vốn đã
đúng, nhưng một giá trị ngầm là thứ đổi theo phiên bản thư viện mà không ai biết.

## Khối 3 — `npm audit` trong CI

Thêm một bước vào `ci.yml`: `npm audit --audit-level=high`. Chặn ở mức `high` trở lên, không
chặn `moderate` — chặn quá chặt thì một lỗ hổng trong devDependency không ai khai thác được
cũng làm đỏ CI, và người ta sẽ tắt nó đi. **Một cổng luôn đỏ là một cổng bị bỏ qua.**

## Khối 4 — Web dùng được

Phần này **không phải security**, nhưng là lý do Tâm mở phase. Giữ nguyên
[ADR-007](../adr/007-ui-la-trang-tinh-mot-file.md): không framework, không build step — chỉ
tách `public/app.js` (465 dòng, sắp thành ~1.200) thành ~6 module bằng `<script type="module">`
của trình duyệt. Không thêm công cụ nào.

| Màn | Nội dung |
|---|---|
| Trang chủ | Danh sách đợt sale (Phase 8) + đếm ngược tới giờ mở |
| Đăng ký / Đăng nhập | **Tách hai màn**, validate tại chỗ, nút khoá khi đang gửi |
| Chi tiết đợt | Bảng SKU, giá sale, tồn kho polling, giới hạn còn lại của mình |
| Đơn của tôi | Giữ nguyên + phân trang |
| Tài khoản | Đổi mật khẩu · **xem và thu hồi phiên đăng nhập** |

Ba luật cho mọi form, thiếu cái nào cũng làm trang trông như đồ chơi:

1. **Lỗi hiện cạnh ô nhập**, không phải dải băng trên cùng. Dải băng để dành cho lỗi hệ thống.
2. **Nút gửi luôn có trạng thái khoá + đang-gửi.** Không khoá thì bấm hai lần là hai request —
   ở Phase 8 đó là hai suất mua.
3. **Không bao giờ trắng trang.** Mỗi màn có ba trạng thái: đang tải / trống / lỗi-kèm-thử-lại.

Hai màn tài khoản đều **dùng lại cơ chế Phase 1**, không thêm gì: thu hồi phiên = thu hồi một
refresh token; đổi mật khẩu = thu hồi cả family (chính là reuse-detection đã có).

## Edge cases bắt buộc xử lý

- [ ] Mọi response có đủ 4 header; `HSTS` **vắng mặt** khi `COOKIE_SECURE=false`.
- [ ] CSP bật mà trang **vẫn chạy đủ**: không còn `<script>` inline, không còn `on*=`.
- [ ] `frame-ancestors 'none'` → nhúng trang vào `<iframe>` bị trình duyệt từ chối.
- [ ] Favicon data URI vẫn hiện (⇒ `img-src` phải có `data:`).
- [ ] 21 lần đăng ký từ một IP trong một giờ → `429`; IP khác **không** bị ảnh hưởng.
- [ ] Sau proxy: hai người dùng khác nhau qua `X-Forwarded-For` khác nhau → đếm riêng.
      Không bật `trust proxy` thì test này đỏ.
- [ ] Body 1MB → `413`, **không** chạm DB, **không** làm chết process.
- [ ] Thu hồi một phiên → refresh token phiên đó `401`; phiên khác vẫn sống.
- [ ] Đổi mật khẩu → **mọi** phiên khác chết ở lần refresh kế tiếp.
- [ ] Bấm nút gửi hai lần thật nhanh → chỉ một request rời trình duyệt.
- [ ] Mất mạng giữa chừng → hiện lỗi + nút thử lại, không trắng trang.

## Test cases phải pass

1. ⭐ Mọi response có 4 header đúng giá trị.
2. ⭐ `COOKIE_SECURE=false` → **không** có `Strict-Transport-Security`; `=true` → có.
3. ⭐ Quét `public/**/*.html`: không `<script>` inline, không thuộc tính `on*=`.
   *(Test đọc file, không cần trình duyệt — CSP hỏng kiểu này rất dễ lọt.)*
4. 21 lần `POST /auth/register` cùng IP trong cửa sổ → `429` ở lần thứ 21.
5. Đổi `X-Forwarded-For` → đếm lại từ đầu (chứng minh `trust proxy` bật đúng).
6. Body > limit → `413`, `users` không tăng.
7. `GET /account/sessions` → chỉ phiên của mình.
8. Thu hồi một phiên → token đó `401`, phiên khác refresh được.
9. Đổi mật khẩu → toàn bộ phiên khác `401`.
10. `npm audit --audit-level=high` sạch (chạy trong CI).
11. 120 test cũ vẫn xanh.

## Definition of Done

- [ ] 11 test case xanh; `npm run check` sạch.
- [ ] **Bảng rà baseline ở đầu spec này cập nhật lại: 19/19 ✅** — đây là deliverable chính,
      và là thứ mở ra được khi người phỏng vấn hỏi "em xử lý security thế nào".
- [ ] Chạy đầu-cuối trên Chrome thật, **Console sạch** khi CSP bật — không một vi phạm nào.
- [ ] ADR-016: vì sao vẫn không framework dù đã 6 màn.
- [ ] `tech-playbook.md` §Phase 9 + cập nhật `architecture.md`, §Trạng thái `CLAUDE.md`.

## Ngoài phạm vi (Non-goals)

Ghi rõ vì đây là chỗ dễ phình nhất, và Tâm đã chốt **"cơ bản, chưa cần nâng cao"**:

- **Captcha.** Rate limit theo IP là mức cơ bản. Proof-of-work có ích khi bị spam thật —
  ghi làm nợ, làm khi *đo được* là cần (xem Câu hỏi mở #1).
- **2FA / TOTP.** Không phải baseline cho một trang bán áo.
- **Xác thực email, quên mật khẩu.** Hạ tầng đã sẵn nhưng cần SMTP thật mới có nghĩa.
- **Audit log ai làm gì.** Đáng khi có nhiều admin; giờ có đúng một.
- **Device fingerprint, WAF, chống DDoS.** Cần dữ liệu thật để hiệu chỉnh.
- **Kiểm mật khẩu rò rỉ (HaveIBeenPwned).** Gọi API ngoài trong luồng đăng ký.
- **Dark mode, i18n, animation.** Trang phải *ổn định*, chưa cần đẹp.

## Câu hỏi mở cho Tâm quyết

### 1. Có làm captcha không?

**Em khuyến nghị KHÔNG, trong phase này.** Rate limit theo IP là mức "phải có"; captcha là mức
"khi bị spam thật". Thêm nó bây giờ là tối ưu một vấn đề chưa xảy ra, mà lại kéo theo hoặc một
nhà cung cấp bên ngoài (Turnstile — buộc nới CSP, ngược với Khối 1), hoặc ~80 dòng
proof-of-work tự viết.

Ghi làm nợ kèm **điều kiện kích hoạt rõ ràng**: thấy `429` của `register` tăng đều trong
metric thì làm. Đó là cách nợ nên được ghi — có mốc để biết lúc nào phải trả, không phải một
dòng "sau này tính".

### 2. Header: tự viết hay `helmet`?

**Em khuyến nghị tự viết** (~30 dòng). `helmet` là 15 middleware mà dự án dùng 5, và mặc định
của nó **đổi giữa các phiên bản** — một `npm update` đổi hành vi bảo mật mà không ai đọc
changelog. Tự viết thì mỗi header một dòng, có comment nói nó chặn gì, và đọc được trong lúc
phỏng vấn. Cũng đúng luật "không thêm công nghệ mới" của `CLAUDE.md`.

### 3. Làm cả Khối 4 (web) luôn, hay tách?

**Em khuyến nghị tách làm hai đợt:** Khối 1–3 (security, ~1 ngày) trước vì **Phase 8 phụ thuộc
vào Khối 2**; Khối 4 (web) sau, vì nó không chặn gì cả và tốn nhiều thời gian hơn hẳn.

Nếu Tâm muốn có trang đẹp để quay video trước thì đảo lại cũng được — chỉ cần biết là Phase 8
sẽ chạy trong lúc `register` còn hở.
