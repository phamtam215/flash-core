# Spec: CSRF token — lớp phòng thủ thứ hai sau `SameSite=Strict`

- **Phase:** 7 (nợ chuyển tiếp từ Phase 1)
- **Ngày:** 2026-09-21
- **Trạng thái:** Draft — chờ Tâm duyệt

> Hợp đồng của tính năng. Phần *vì sao* — CSRF là gì, vì sao `HttpOnly` **không** chống được
> nó, vì sao `SameSite=Strict` mới là cờ chống — đã có ở
> [`tech-playbook.md` §Phase 1](../tech-playbook.md). Spec này không chép lại.

## Mục tiêu

Trả nợ ghi từ [spec Phase 1 §Ngoài phạm vi](phase1-auth.md): *"CSRF token — dùng
`SameSite=Strict` là đủ cho phase này, ghi lại làm nợ."*

**Nói thẳng trước: `SameSite=Strict` đang chặn được CSRF cổ điển, và nó vẫn là lớp phòng thủ
CHÍNH sau khi làm xong việc này.** Token không thay thế nó. Vậy vì sao vẫn làm — ba lý do
thật, xếp theo sức nặng:

| # | Lý do | Nặng đến đâu |
|---|---|---|
| 1 | **`SameSite` không chặn kẻ tấn công cùng site.** Một subdomain bị chiếm (hoặc một trang khác trên cùng domain có XSS) vẫn gửi được request "same-site" kèm cookie. Đây là lỗ hổng thật mà `SameSite` theo định nghĩa không bịt | Thật, nhưng dự án hiện chưa có subdomain nào |
| 2 | **`SameSite` là hành vi của trình duyệt, không phải của server.** Trình duyệt cũ, WebView nhúng trong app, hoặc một client không phải browser đều không bắt buộc tuân theo. Server đang tin vào thứ nó không kiểm soát | Thật |
| 3 | Đây là câu người phỏng vấn **chắc chắn** hỏi tiếp sau "HttpOnly có chống CSRF không" | Không phải lý do kỹ thuật, nhưng là mục đích của dự án |

Nguyên tắc chung đằng sau: **defense in depth** — không để một cờ duy nhất, do bên thứ ba
(trình duyệt) thực thi, là thứ duy nhất đứng giữa kẻ tấn công và việc đặt đơn thay người khác.

## Chọn cơ chế: double-submit cookie, token có ký

Ba cách phổ biến, và vì sao chọn cách thứ hai:

| Cách | Cần gì | Vì sao chọn / loại |
|---|---|---|
| **Synchronizer token** (lưu token theo session ở server) | Một chỗ lưu theo session — Redis | **Loại.** Chắc hơn, nhưng thêm một round-trip Redis vào **mọi** request ghi, kể cả `POST /orders` — endpoint nóng nhất hệ thống. Trả giá ở đúng chỗ không nên trả |
| **Double-submit cookie, token có ký HMAC** | Không lưu gì | **CHỌN.** Stateless, không chạm Redis/DB. HMAC khiến kẻ tấn công không tự chế được cặp cookie+header hợp lệ nếu không có `CSRF_SECRET` |
| Chỉ kiểm `Origin`/`Referer` | Không gì cả | **Loại làm cách chính.** Rẻ nhất, nhưng `Referer` bị proxy/extension lược bỏ khá thường xuyên ⇒ chặn nhầm người dùng thật. Vẫn giữ làm *bổ sung* — xem Câu hỏi mở #4 |

### Cách double-submit hoạt động

```
1. Server đặt cookie `csrf_token` — KHÔNG HttpOnly (JS phải đọc được), SameSite=Strict
2. JS đọc cookie, gắn vào header `X-CSRF-Token` của mọi request ghi
3. Server so cookie với header. Khớp → cho qua. Lệch/thiếu → 403
```

**Vì sao nó chặn được CSRF:** trang lạ **gửi** được cookie của anh (browser tự đính) nhưng
**đọc** thì không — same-origin policy chặn. Không đọc được thì không đặt header đúng được.
Mấu chốt nằm ở chỗ đó: CSRF khai thác "tự động gửi", còn token đòi một thao tác **chủ động
đọc** mà chỉ code trên đúng origin mới làm được.

**Vì sao cookie này KHÔNG được `HttpOnly`:** nghe ngược, nhưng `HttpOnly` sẽ làm JS không đọc
được và cơ chế chết ngay. Nó an toàn vì token CSRF **không phải bí mật xác thực** — biết nó
không đăng nhập được, chỉ chứng minh được "tôi chạy trên origin này".

### Vì sao ký HMAC thay vì random thuần

Token = `<random-32-byte-hex>.<hmac-sha256(random, CSRF_SECRET)>`, verify bằng
`timingSafeEqual` — **dùng lại đúng cách làm của
[`payment.signature.ts`](../../src/modules/payment/payment.signature.ts)**, không phát minh
lại.

Random thuần vẫn chặn được CSRF cổ điển. Chữ ký thêm đúng một thứ: kẻ tấn công **cùng site**
(kịch bản #1 ở trên) đặt được cookie sang domain chính, nhưng cookie nó đặt sẽ **không có
chữ ký hợp lệ** nên server từ chối. Không có chữ ký thì nó chỉ cần đặt cookie `csrf_token=abc`
rồi gửi header `X-CSRF-Token: abc` — và double-submit thành vô dụng đúng ở kịch bản mà ta
làm token vì nó.

**Điểm yếu còn lại, ghi ra chứ không giấu:** chữ ký này **không ràng buộc vào phiên đăng
nhập**. Kẻ tấn công có tài khoản hợp lệ trên hệ thống lấy được một token đã ký của *chính nó*
rồi dùng lại cho nạn nhân. Bịt hẳn thì phải ký kèm `userId` — nhưng token phải phát **trước**
khi đăng nhập, nên sẽ phải phát lại sau mỗi lần login. Xem Câu hỏi mở #2.

## API / Interface

Không thêm endpoint nào. Thay đổi nằm ở **biên**:

| Thành phần | Việc |
|---|---|
| Middleware phát token | Mọi response: chưa có cookie `csrf_token` hợp lệ thì đặt một cái mới |
| Guard kiểm token | Mọi request `POST`/`PUT`/`PATCH`/`DELETE`, trừ danh sách miễn |
| [`public/app.js`](../../public/app.js) | Hàm `api()` tự đọc cookie và gắn header — **đúng một chỗ sửa** |

```
Cookie: csrf_token=<random>.<hmac>     ← Secure, SameSite=Strict, KHÔNG HttpOnly
Header: X-CSRF-Token: <random>.<hmac>  ← client tự sao chép từ cookie
```

| Mã | Khi nào |
|---|---|
| `403` `CSRF_TOKEN_INVALID` | Thiếu header, thiếu cookie, hai bên lệch, hoặc chữ ký sai |

`403` chứ không `401`: `401` nghĩa là *"anh chưa đăng nhập"* và client sẽ đi gọi
`POST /auth/refresh` rồi thử lại — vòng lặp vô ích, vì vấn đề không nằm ở phiên. `403` nói
đúng chuyện: đã biết anh là ai, nhưng request này không chứng minh được nó xuất phát từ trang
của mình.

### Danh sách miễn — và vì sao từng cái

| Đường dẫn | Vì sao miễn |
|---|---|
| `POST /payments/webhook` | Server-to-server, **không có cookie nào cả** nên không có gì để CSRF. Nó đã có lớp bảo vệ riêng, chặt hơn: HMAC trên raw body + dấu thời gian chống replay |
| Mọi `GET`/`HEAD`/`OPTIONS` | Không đổi trạng thái. (Ràng buộc kèm theo: **không được** có endpoint `GET` nào ghi dữ liệu — nếu có thì lỗ hổng nằm ở đó, không phải ở CSRF) |

`POST /auth/login`, `/auth/register`, `/auth/refresh`, `/auth/logout` **KHÔNG** miễn — xem
Câu hỏi mở #1.

## Luồng xử lý

```
Request tới
  │
  ├─ GET/HEAD/OPTIONS ────────────────────────► cho qua
  ├─ đường dẫn trong danh sách miễn ──────────► cho qua
  │
  └─ còn lại:
       đọc cookie `csrf_token` + header `X-CSRF-Token`
       thiếu một trong hai ──────────────────► 403
       hai bên khác nhau (timingSafeEqual) ──► 403
       chữ ký HMAC không hợp lệ ─────────────► 403
       hợp lệ ───────────────────────────────► cho qua

Response ra
  │
  └─ chưa có cookie `csrf_token` hợp lệ ──────► Set-Cookie: csrf_token=<random>.<hmac>
```

Guard đăng ký ở **tầng app** (`APP_GUARD` trong `app.module.ts`), giống cách
`AllExceptionsFilter` đăng ký bằng `APP_FILTER`. Lý do là **fail-closed**: thêm endpoint ghi
mới mà quên nghĩ tới CSRF thì nó **được bảo vệ sẵn**. Cách ngược lại (gắn guard vào từng
controller) thì quên = lộ, và không ai phát hiện ra vì mọi test vẫn xanh.

## Edge cases bắt buộc xử lý

- [ ] Request ghi **thiếu header** `X-CSRF-Token` → `403`, và **không** có tác dụng phụ nào
      (đơn không được tạo, tồn kho không đổi).
- [ ] Có header nhưng **thiếu cookie** → `403`.
- [ ] Header và cookie **khác nhau** → `403`.
- [ ] Token **đúng định dạng nhưng chữ ký sai** (kẻ tấn công cùng site tự đặt cặp
      cookie+header `abc`) → `403`. *Đây là ca duy nhất mà bản có ký khác bản random thuần.*
- [ ] Token **bị sửa một ký tự** ở phần random (chữ ký cũ) → `403`.
- [ ] `GET /orders` **không** cần token → `200`.
- [ ] `POST /payments/webhook` **không** cần token, vẫn `204` như cũ.
- [ ] Người dùng chưa từng vào trang, gọi thẳng `POST /auth/login` bằng curl không cookie →
      `403` (chứ không `401`) — và thông báo phải nói được phải làm gì.
- [ ] Cookie `csrf_token` được đặt ở **mọi** response nếu chưa có, kể cả `GET /` (trang tĩnh) —
      nếu không thì lần ghi đầu tiên luôn `403`.
- [ ] Cookie `csrf_token` **không** có cờ `HttpOnly` (có là cơ chế chết), **có** `SameSite=Strict`
      và theo `COOKIE_SECURE`.
- [ ] Hai tab cùng mở → cùng đọc một cookie, cả hai đều gửi được. Không có chuyện tab mở sau
      làm token tab trước hết hiệu lực.

## Test cases phải pass

Unit (`csrf.token.spec.ts`) — logic ký/kiểm, không cần hạ tầng:

1. `issueToken()` → `verifyToken()` trả `null` (hợp lệ).
2. Sửa một ký tự phần random → `'SIGNATURE_MISMATCH'`.
3. Token ký bằng secret khác → `'SIGNATURE_MISMATCH'`.
4. Token sai định dạng (`abc`, rỗng, thiếu dấu chấm) → `'MALFORMED'`.
5. Hai lần `issueToken()` cho **hai giá trị khác nhau** (có random thật, không hằng số).

Integration (`test/csrf.e2e-spec.ts`):

6. `GET /` → response có `Set-Cookie: csrf_token=...`, **không** chứa `HttpOnly`, có
   `SameSite=Strict`.
7. ⭐ `POST /orders` **không** header → `403` `CSRF_TOKEN_INVALID`; `stock` của SKU **không**
   đổi; **không** có dòng `orders` nào được tạo.
8. `POST /orders` có header **khớp** cookie → `201` như cũ.
9. ⭐ Cookie `csrf_token=gia-mao` + header `X-CSRF-Token: gia-mao` (kẻ tấn công cùng site tự
   đặt cặp khớp nhau) → `403`. **Bản random thuần sẽ cho qua ca này** — đây là test chứng minh
   chữ ký đáng giá.
10. `GET /orders` không header → `200`.
11. ⭐ `POST /payments/webhook` chữ ký HMAC hợp lệ, **không** có cookie/header CSRF → `204`.
12. `POST /auth/login` không header → `403` (không phải `401`).
13. `POST /orders/:id/cancel` không header → `403`, đơn vẫn `PENDING`.
14. Toàn bộ **101 integration test cũ vẫn xanh** sau khi thêm token vào helper đăng nhập.

## Definition of Done

- [ ] 14 test case trên xanh; integration ≥ 112, unit ≥ 144.
- [ ] `npm run check` sạch.
- [ ] `public/index.html` bấm được đầu-cuối trên Chrome thật: đăng ký → săn → huỷ → thanh toán.
- [ ] Biến mới `CSRF_SECRET` (≥32 ký tự) có trong `.env.example` **và** được ghi vào §Trạng
      thái của `CLAUDE.md` là biến bắt buộc — thiếu là app chết lúc khởi động, giống
      `PAYMENT_WEBHOOK_SECRET`.
- [ ] `docs/tech-playbook.md` §Phase 1 nối tiếp mục CSRF sẵn có: double-submit hoạt động ra
      sao, vì sao cookie này không `HttpOnly`, điểm yếu còn lại.
- [ ] Cập nhật spec Phase 1 (nợ đã trả) và `docs/architecture.md`.

## Ngoài phạm vi (Non-goals)

- **Thay `SameSite=Strict`.** Token là lớp **thứ hai**; cờ kia vẫn là lớp chính.
- **Chống XSS.** XSS đọc được cookie CSRF nên token không cứu được — chống XSS là escape
  output (đã làm ở `public/app.js`) và CSP, việc khác hoàn toàn.
- **Xoay token định kỳ / hết hạn theo thời gian.** Token không phải bí mật xác thực; thêm hạn
  dùng là thêm một nguồn lỗi `403` giả cho người mở tab lâu.
- **CORS.** Dự án phục vụ FE từ chính origin của API (Phase 5, ADR-007) nên không có
  cross-origin nào để cấu hình.

## Câu hỏi mở cho Tâm quyết

### 1. `POST /auth/login` và `/auth/register` có bắt token không?

**Em khuyến nghị CÓ (không miễn).** Lý do: **login CSRF** là tấn công thật — kẻ tấn công ép
trình duyệt nạn nhân đăng nhập vào **tài khoản của nó**, rồi mọi thứ nạn nhân làm sau đó
(đặt đơn, nhập thẻ) nằm trong tài khoản nó đọc được. Ít người biết nhưng không hiếm.

Chi phí để bắt: gần bằng không, vì cookie đã được phát ở response của `GET /` — tức là trang
đăng nhập vừa tải xong đã có token. Giá phải trả duy nhất: gọi API bằng `curl` sẽ cần hai
bước (`curl -c` lấy cookie trước). Test integration không ảnh hưởng vì `supertest.agent` giữ
cookie tự động.

### 2. Có ràng buộc token vào `userId` không?

**Em khuyến nghị KHÔNG, trong đợt này.** Ràng buộc sẽ bịt nốt lỗ "kẻ tấn công có tài khoản
hợp lệ dùng token của chính nó cho nạn nhân", nhưng kéo theo: token phải phát **lại** sau mỗi
lần login/logout/refresh, và mọi tab đang mở của cùng người dùng phải cùng thấy token mới —
thêm hẳn một tầng đồng bộ cho một kịch bản cần kẻ tấn công **đã** có tài khoản **và** đã dụ
được nạn nhân.

Ghi ra làm nợ có chép chép, đúng cách dự án này đã làm với `/ready` log `error` ở Phase 0 —
nợ được ghi kèm hai hướng sửa rồi trả đúng lúc, hơn là làm sớm một thứ chưa đo được giá trị.

### 3. Middleware phát token hay controller phát?

**Em khuyến nghị middleware toàn cục.** Phát ở một controller (vd `GET /auth/csrf`) nghĩa là
client phải **nhớ gọi** nó trước — quên là `403` khó hiểu. Middleware thì token luôn có mặt
từ request đầu tiên, kể cả request tải trang tĩnh.

### 4. Có kiểm thêm `Origin` không?

**Em khuyến nghị CÓ, nhưng chỉ khi header `Origin` CÓ mặt** (không phải `Referer`). `Origin`
được gửi trên mọi request ghi của mọi trình duyệt hiện đại và **không** bị proxy lược như
`Referer`. Thiếu `Origin` thì bỏ qua, không chặn — tránh chặn nhầm client không phải browser.
Khoảng 8 dòng, và nó là lớp thứ ba độc lập với cả hai lớp kia.

Nếu Tâm thấy ba lớp cho một dự án học là thừa thì bỏ mục này, spec vẫn đủ.
