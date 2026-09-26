# Spec: Phase 9 — Web hoàn thiện (auth, captcha, security header, giao diện ổn định)

- **Phase:** 9
- **Ngày:** 2026-09-26
- **Trạng thái:** Draft — chờ Tâm duyệt (4 câu hỏi mở ở cuối)

> Hợp đồng của phase. Kiến thức (*CSP làm gì*, *proof-of-work chống bot ra sao*) sẽ viết vào
> [`tech-playbook.md`](../tech-playbook.md) §Phase 9.

## Vấn đề

Trang hiện tại là **công cụ trực quan hoá**, đúng như [ADR-007](../adr/007-ui-la-trang-tinh-mot-file.md)
và `project-context.md` quyết định #10 đã chốt: 465 dòng `app.js`, 4 màn ẩn/hiện bằng class,
tồn tại để làm được **một** cảnh — tồn kho rơi về 0. Nó làm tốt việc đó.

Nhưng nó không phải một trang web. Ba khoảng trống cụ thể:

| | Hiện trạng | Vấn đề |
|---|---|---|
| **Đăng ký/đăng nhập** | Một form duy nhất, lỗi hiện ở dải băng trên cùng | Không có validate tại chỗ, không có trạng thái đang-gửi, không đổi được mật khẩu, không xem/thu hồi được phiên |
| **Chống bot** | Chỉ rate limit login theo email | `POST /auth/register` **không giới hạn gì** — một script tạo 10.000 tài khoản trong một phút, và mỗi tài khoản là một suất mua ở Phase 8 |
| **Security header** | **Không có cái nào** (đã kiểm: 0 dòng trong `src/`) | Không CSP, không HSTS, không `X-Content-Type-Options`, không `frame-ancestors` — trang nhúng được vào iframe của người khác |

Khoảng trống thứ hai đáng chú ý nhất: **Phase 8 gắn giới hạn mua vào *tài khoản*, nên tài
khoản trở thành thứ đáng làm giả.** Không chặn đăng ký hàng loạt thì `perUserLimit` chỉ là
một gờ giảm tốc.

## Quan hệ với ADR-007 — sửa đổi, không lật

ADR-007 chốt **trang tĩnh, không framework, không build step**, vì FE là công cụ chứ không
phải sản phẩm. Phase này giữ nguyên **kết luận** đó và chỉ mở rộng **phạm vi**:

- **Vẫn không framework, vẫn không build step.** Nest tiếp tục phục vụ `public/` bằng
  `useStaticAssets`; deploy không đổi một dòng nào.
- **Tách file bằng ESM gốc của trình duyệt** (`<script type="module">` + `import`). Không
  bundler, không transpile — trình duyệt tự lo. 465 dòng trong một file đã bắt đầu khó đọc;
  chia thành `api.js`, `router.js`, `forms.js`, `screens/*.js` là đủ, và **không thêm công cụ
  nào**.

Cần **ADR-016** ghi lại: *vì sao vẫn không thêm React dù giờ đã có 6 màn*. Câu trả lời ngắn:
build step là thứ phải nuôi (phiên bản Node, cache CI, source map, một `dist/` nữa trong ảnh
Docker) và ở quy mô này nó chưa mua lại được gì. Nếu một ngày phải viết state đồng bộ phức
tạp thì ADR đó là chỗ đảo lại.

## Phạm vi — ba khối

### Khối 1 — Màn hình và luồng

| Màn | Nội dung |
|---|---|
| **Trang chủ** | Danh sách đợt sale (Phase 8) + đếm ngược tới giờ mở |
| **Đăng ký / Đăng nhập** | Tách hai màn riêng; validate tại chỗ; captcha; nút khoá khi đang gửi |
| **Chi tiết đợt** | Bảng SKU, giá sale, tồn kho polling, giới hạn còn lại của chính mình |
| **Đơn của tôi** | Giữ nguyên, thêm phân trang |
| **Tài khoản** | Đổi mật khẩu; **danh sách phiên đang đăng nhập + thu hồi** |

Ba luật giao diện áp cho mọi form, vì thiếu cái nào cũng làm trang "trông như đồ chơi":

1. **Lỗi hiện cạnh ô nhập**, không phải ở dải băng trên cùng. Dải băng để dành cho lỗi hệ
   thống (mất mạng, 500).
2. **Mọi nút gửi đều có trạng thái khoá + đang-gửi.** Không khoá thì bấm hai lần là hai
   request — và ở Phase 8 đó là hai suất mua.
3. **Không bao giờ để trang trắng.** Mỗi màn có ba trạng thái: đang tải / trống / lỗi-kèm-nút-thử-lại.

### Khối 2 — Chống bot: proof-of-work captcha

`GET /auth/challenge` trả `{ challenge, difficulty }`. Client tìm `nonce` sao cho
`sha256(challenge + nonce)` có `difficulty` bit 0 đầu tiên, rồi gửi kèm khi đăng ký. Server
verify bằng **một** phép băm.

**Vì sao proof-of-work, không phải reCAPTCHA/Turnstile:**

| | **Proof-of-work tự làm** ⭐ | reCAPTCHA / Turnstile |
|---|---|---|
| Bên thứ ba | Không | Có — và nó thấy mọi người dùng của mình |
| Khoá/tài khoản | Không | Phải đăng ký, thêm 2 secret nữa (Secret Manager free chỉ 6 version) |
| CSP | Không phải nới | **Phải cho phép script ngoài** — mà CSP chặt là một deliverable của chính phase này |
| Chi phí | 0đ | 0đ (nhưng thêm một nhà cung cấp phải theo dõi) |
| Chống người thật quyết tâm | Kém hơn | Tốt hơn |
| Học được gì | Hashcash, kinh tế học của rate limit | Cách dán một script |

Điểm mấu chốt của PoW: **nó không chặn bot, nó làm bot ĐẮT.** Difficulty đặt sao cho người
thật tốn ~300ms (không nhận ra) còn kẻ tạo 10.000 tài khoản tốn ~50 phút CPU. Đó là một đánh
đổi **đo được**, khác hẳn "có captcha rồi nên chắc là an toàn".

Nó **không thay** rate limit mà **cộng vào**: PoW làm chậm, Redis rate limit đặt trần cứng.

### Khối 3 — Security header + rate limit mở rộng

| Header | Giá trị | Chặn gì |
|---|---|---|
| `Content-Security-Policy` | `default-src 'self'; script-src 'self'; style-src 'self'; frame-ancestors 'none'; base-uri 'none'` | XSS: script chèn được vào DOM vẫn không chạy được nếu nó là inline hoặc từ domain lạ |
| `Strict-Transport-Security` | `max-age=31536000` (chỉ khi `COOKIE_SECURE=true`) | Hạ cấp HTTPS→HTTP |
| `X-Content-Type-Options` | `nosniff` | Trình duyệt đoán sai kiểu file rồi chạy nó như script |
| `Referrer-Policy` | `same-origin` | Rò đường dẫn nội bộ sang site khác |
| `Permissions-Policy` | tắt camera/mic/geolocation | Thu hẹp bề mặt |

**CSP là phần tốn công thật, không phải một dòng cấu hình.** `script-src 'self'` nghĩa là
**mọi `<script>` inline và mọi `onclick=` trong HTML đều chết**. Trang hiện tại phải rà lại
toàn bộ — và đó chính là giá trị: nó *ép* tách hành vi khỏi markup, thay vì tin lời hứa.

Rate limit mở rộng sang `POST /auth/register` (theo IP, vì chưa có tài khoản để khoá theo) và
`POST /auth/refresh`. Dùng lại `RedisService.incrementWithExpiry` sẵn có.

## Edge cases bắt buộc xử lý

- [ ] Gửi đăng ký **không có** lời giải PoW → `400`, **không** tạo user.
- [ ] Lời giải PoW **sai** (nonce không thoả difficulty) → `400`.
- [ ] **Dùng lại** một lời giải đã dùng → `400`. Challenge phải là một-lần (Redis, TTL 5 phút).
- [ ] Challenge **quá hạn** (> 5 phút) → `400` kèm thông báo bảo lấy challenge mới.
- [ ] 100 lần đăng ký từ cùng IP trong một phút → `429` sau ngưỡng, và ngưỡng đếm ở **Redis**
      (nhiều instance dùng chung).
- [ ] CSP bật mà trang **vẫn chạy đủ**: không còn `<script>` inline, không còn `onclick=`.
      Test tự động phải bắt được, không dựa vào mắt người.
- [ ] `frame-ancestors 'none'` → nhúng trang vào `<iframe>` thì trình duyệt từ chối.
- [ ] HSTS **không** được gửi khi `COOKIE_SECURE=false` (local http) — gửi nhầm là tự khoá
      mình khỏi `localhost` trong một năm, và xoá rất phiền.
- [ ] Thu hồi một phiên → refresh token của **đúng** phiên đó chết, các phiên khác còn sống.
- [ ] Đổi mật khẩu → **mọi** phiên khác bị thu hồi (dùng lại reuse-detection của Phase 1).
- [ ] Bấm nút gửi hai lần thật nhanh → chỉ một request rời trình duyệt.
- [ ] Mất mạng giữa chừng → màn hiện lỗi kèm nút thử lại, không trắng trang.

## Test cases phải pass

**Unit** (`pow.spec.ts`): sinh challenge hai lần cho hai giá trị khác nhau · lời giải đúng →
hợp lệ · nonce sai → không hợp lệ · difficulty cao hơn → lời giải cũ không còn hợp lệ ·
challenge sai định dạng → không ném lỗi.

**Integration:**

1. `GET /auth/challenge` → `200`, có `challenge` + `difficulty`.
2. ⭐ Đăng ký không kèm lời giải → `400`, `users` không tăng.
3. ⭐ Đăng ký kèm lời giải **hợp lệ** → `201`.
4. ⭐ Dùng **lại** lời giải đó lần hai → `400` (challenge một-lần).
5. Challenge quá hạn → `400`.
6. Đăng ký quá ngưỡng từ một IP → `429`.
7. ⭐ Mọi response có đủ 5 header; `HSTS` **vắng mặt** khi `COOKIE_SECURE=false`.
8. ⭐ Quét `public/**/*.html`: **không** có `<script>` inline và **không** có thuộc tính `on*=`
   (test đọc file, không cần trình duyệt — CSP hỏng kiểu này rất dễ lọt).
9. `GET /account/sessions` → trả phiên của chính mình, không của ai khác.
10. Thu hồi một phiên → refresh bằng token đó `401`; phiên khác vẫn refresh được.
11. Đổi mật khẩu → toàn bộ phiên khác `401` ở lần refresh kế tiếp.
12. 120 test cũ vẫn xanh (đăng ký trong test phải đi qua PoW — thêm helper vào `http-helper.ts`).

## Definition of Done

- [ ] 12 integration + 5 unit test trên xanh; `npm run check` sạch.
- [ ] Chạy đầu-cuối trên Chrome thật: đăng ký (có captcha) → xem đợt sale → đếm ngược → săn →
      thanh toán → huỷ → đổi mật khẩu → thu hồi phiên.
- [ ] **DevTools Console sạch** khi CSP bật — không một lỗi vi phạm nào.
- [ ] Đo thời gian giải PoW trên máy thật, dán số vào spec; chọn difficulty theo số đó.
- [ ] ADR-016 (vẫn không framework) và ADR-017 (PoW thay captcha bên thứ ba).
- [ ] `tech-playbook.md` §Phase 9; cập nhật `architecture.md` + §Trạng thái `CLAUDE.md`.

## Ngoài phạm vi (Non-goals)

- **Xác thực email.** Hạ tầng đã sẵn (outbox + mail), nhưng cần SMTP thật để có nghĩa —
  `LoggingMailSender` hiện chỉ in ra log. Đáng làm ngay sau khi có SMTP.
- **Quên mật khẩu.** Cùng lý do.
- **OAuth / đăng nhập Google.** Thêm một nhà cung cấp và một luồng redirect, không mua thêm
  kiến thức nào mà Phase 1 chưa có.
- **Trang quản trị** (tạo đợt sale trên UI). RBAC đã có, nhưng đây là phase riêng.
- **Dark mode, i18n, animation.** Trang phải *ổn định*, chưa cần đẹp.
- **Chống bot bằng device fingerprint.** Đụng quyền riêng tư, và cần dữ liệu thật để hiệu chỉnh.

## Câu hỏi mở cho Tâm quyết

### 1. Proof-of-work hay Cloudflare Turnstile?

**Em khuyến nghị proof-of-work tự làm** — lý do đầy đủ ở bảng §Khối 2. Gọn lại: Turnstile
buộc nới CSP để nạp script ngoài, mà CSP chặt lại là deliverable của chính phase này; và PoW
dạy được một thứ thật (làm bot *đắt* thay vì *chặn* bot), còn dán script thì không.

Nếu mục tiêu là "giống production thật nhất" thì Turnstile đúng hơn — em làm theo nếu Tâm chọn.

### 2. Có làm xác thực email không?

**Em khuyến nghị CHƯA**, và ghi làm nợ. Toàn bộ hạ tầng đã có (outbox, queue, mail sender), nên
đây gần như chỉ là một consumer nữa — nhưng không có SMTP thật thì nó chỉ ghi log, và một
luồng xác thực mà không ai nhận được mail là thứ trông như xong mà không dùng được. Có SMTP
(Resend/Mailgun free tier) thì làm, mất khoảng nửa ngày.

### 3. Tách file bằng ESM gốc, hay giữ một `app.js`?

**Em khuyến nghị tách** thành ~6 module bằng `<script type="module">`. Không thêm công cụ,
trình duyệt tự lo, và 465 dòng sắp thành ~1.200 khi có thêm 3 màn. Chi phí duy nhất: thêm vài
request lúc tải — không đáng kể cho một trang demo, và HTTP/2 gộp sẵn.

### 4. CSP: dùng `helmet` hay tự viết middleware?

**Em khuyến nghị tự viết** (~30 dòng). `helmet` là 15 middleware mà dự án chỉ dùng 5 header, và
mặc định của nó thay đổi giữa các phiên bản — nghĩa là một `npm update` đổi hành vi bảo mật mà
không ai đọc changelog. Tự viết thì mỗi header nằm trên một dòng, có comment nói nó chặn gì, và
**đọc được trong lúc phỏng vấn**. Đây cũng đúng luật "không thêm công nghệ mới" của CLAUDE.md.
