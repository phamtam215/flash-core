# Spec: UI demo — nhìn thấy tồn kho rơi về 0 (Phase 5)

- **Phase:** 5
- **Ngày:** 2026-09-05
- **Trạng thái:** Đã implement (2026-09-05)

> Hợp đồng của phase. Phần *vì sao chọn trang tĩnh* ở
> [ADR-007](../adr/007-ui-la-trang-tinh-mot-file.md); cơ chế CORS và bẫy cookie ở
> [`tech-playbook.md` §Phase 5](../tech-playbook.md).

## Mục tiêu

FE ở đây là **công cụ trực quan hoá**, không phải sản phẩm (`project-context.md` quyết định
#10). Nó tồn tại để làm được đúng một cảnh: **k6 bắn 1.000 VU trong khi tồn kho trên màn hình
rơi về 0 và dừng đúng 0** — thứ mà một bảng số trong terminal không kể được.

Mục tiêu phụ, cũng thật: có một chỗ bấm được để tự thử luồng Phase 1–4 mà không cần curl.

## Phạm vi

**Một file `public/index.html`.** Không dependency, không build step, CSS viết tay, do Nest
phục vụ tĩnh trên cùng cổng với API.

Bốn màn hình, chuyển bằng show/hide (không router):

| # | Màn hình | Dùng API |
|---|---|---|
| 1 | Đăng nhập / Đăng ký | `POST /auth/register`, `POST /auth/login`, `GET /auth/me`, `POST /auth/logout` |
| 2 | Sự kiện sale — lưới áo, tồn kho tự cập nhật | `GET /products`, `GET /products/:id/skus` |
| 3 | Chọn size/màu → "Săn ngay" → đơn giữ chỗ + đếm ngược | `POST /orders`, `POST /payments/checkout/:orderId` |
| 4 | Đơn của tôi | `GET /orders` |

## Quyết định thiết kế

**1. Cùng origin, không CORS.** Nest phục vụ `public/` bằng `useStaticAssets` (có sẵn trong
`platform-express`, không thêm dependency). FE và API cùng `localhost:3000` nên cookie
`SameSite=Strict` tự đi kèm mọi `fetch` — chỉ cần `credentials: 'same-origin'`.

**2. Polling 1,5 giây, không WebSocket.** Cảnh cần quay là tồn kho rơi trong ~10 giây; polling
đủ mượt và không thêm một tầng hạ tầng nào. WebSocket là công nghệ mới ⇒ phải qua ADR, và nó
không làm demo tốt hơn.

**3. FE KHÔNG tự "thanh toán được".** Bấm "Thanh toán" chỉ gọi `POST /payments/checkout/:id`
để lấy `paymentIntentId`, rồi **hiện ra lệnh `node scripts/send-webhook.mjs …` để copy**.
Trình duyệt không có `PAYMENT_WEBHOOK_SECRET` nên không ký nổi webhook — và đó chính là điểm
đáng nhìn: nếu FE tự đánh dấu đơn đã trả tiền được thì việc verify chữ ký ở Phase 4 là vô nghĩa.

**4. Không tự sinh dữ liệu mẫu trong FE.** Muốn có áo để săn thì tạo qua API (hoặc `npm run
seed`). FE chỉ đọc và đặt đơn — thêm màn quản trị là mở rộng phạm vi.

## Luồng chính

```
Mở http://localhost:3000
  ├─ GET /auth/me  → 200: vào thẳng màn (2)   ·   401: hiện màn (1)
  │
  ├─ Màn (2): GET /products (keyset) → lưới áo
  │            chọn một áo → GET /products/:id/skus
  │            setInterval 1,5s: gọi lại /skus → cập nhật số tồn kho
  │
  ├─ Màn (3): chọn size/màu → POST /orders (kèm Idempotency-Key sinh bằng crypto.randomUUID)
  │            201 → hiện đơn + đếm ngược tới expiresAt
  │            409 → "Hết hàng"   ·   404 → "SKU không còn bán"
  │            bấm Thanh toán → POST /payments/checkout/:id → hiện lệnh send-webhook
  │
  └─ Màn (4): GET /orders → danh sách, polling 3s để thấy PENDING → PAID / CANCELLED
```

## Edge cases bắt buộc xử lý

- [x] Chưa đăng nhập mà mở thẳng màn (2) → tự chuyển về màn (1), không hiện lỗi đỏ
- [ ] Access token hết hạn giữa chừng (15 phút) → `401` ở một lần polling → thử
      `POST /auth/refresh` **một lần**, hỏng thì về màn đăng nhập. Không lặp vô hạn
- [x] `POST /orders` trả `409` → hiện "Hết hàng", **không** coi là lỗi hệ thống (không đỏ toàn trang)
- [x] Bấm "Săn ngay" hai lần thật nhanh → nút khoá ngay lần đầu; và mỗi lần bấm sinh
      `Idempotency-Key` mới (khoá cũ sẽ trả về đúng đơn cũ, không tạo đơn thứ hai)
- [ ] Đơn hết hạn giữa lúc đang xem → đếm ngược về 0 → hàng đổi sang `CANCELLED` ở nhịp polling sau
- [x] Rời tab rồi quay lại → polling không nhân đôi (dọn `setInterval` khi đổi màn)
- [x] API chết giữa chừng → hiện dải báo lỗi ở đầu trang, polling vẫn tiếp tục để tự hồi phục

## Test cases phải pass

FE không có test tự động (SPEC.md §Phase 5) — nhưng **phần server phục vụ nó thì có**:

1. `GET /` trả `200` và `Content-Type: text/html`
2. `GET /` **không** bị guard chặn (không cần đăng nhập mới xem được trang)
3. Route tĩnh không nuốt route API: `GET /health` vẫn trả JSON như cũ
4. Đường dẫn lạ (`GET /khong-ton-tai`) vẫn trả 404 JSON đúng hình dạng lỗi chung, không trả HTML

Phần UI kiểm bằng tay theo danh sách edge case ở trên.

## Definition of Done

- [x] 4 màn hình chạy được trên trình duyệt thật — xem §Bằng chứng DoD
- [x] 4 test server ở trên xanh, `npm run check` sạch (74 unit + 74 integration)
- [x] Chạy k6 (`k6/flash-sale.js`) trong khi mở màn (2): tồn kho rơi về **0 và dừng ở 0**
- [ ] Quay video/GIF ~2 phút cảnh đó — deliverable của phase
- [ ] Tâm tự trả lời câu hỏi bản chất của Phase 5 trong `docs/SPEC.md`

## Ngoài phạm vi (Non-goals)

- Framework, build step, TypeScript cho FE — [ADR-007](../adr/007-ui-la-trang-tinh-mot-file.md)
- Màn quản trị (tạo áo/SKU), phân trang đầy đủ, tìm kiếm, lọc
- Responsive tới mức mobile-first — chỉ cần không vỡ ở màn hình hẹp
- i18n, dark mode theo hệ thống, accessibility đầy đủ
- Test tự động cho FE (Playwright/Cypress) — sẽ là công nghệ mới, và không phục vụ mục tiêu học

## Câu hỏi mở cho Tâm quyết

Không có. Hướng đã chốt ở ADR-007; nếu muốn đổi thì nói trước khi tôi code.

## Bằng chứng Definition of Done (2026-09-05)

Chạy đầu-cuối trên **Chrome thật**, app build từ `dist/`, Postgres/Redis của docker-compose:

| Bước | Kết quả |
|---|---|
| Mở `/` khi chưa đăng nhập | hiện màn Đăng nhập, không lỗi đỏ, console sạch |
| Đăng ký → tự đăng nhập | vào thẳng màn Sự kiện sale, header hiện email |
| Lưới áo + bảng SKU | 12 áo, tồn kho tự cập nhật, dấu thời gian đổi mỗi 1,5 giây |
| Bấm "Săn ngay" | `201`, tồn kho **3 → 2**, hiện đơn `PENDING` + đếm ngược `còn 14:59` |
| Bấm "Thanh toán" | hiện `paymentIntentId` + lệnh `send-webhook` để copy |
| Chạy lệnh đó ở terminal | `204`; worker xử lý → đơn thành **`PAID`** |
| Mở tab "Đơn của tôi" | hàng đơn hiện `PAID`, cột Còn lại là `—` |

**Một bug thật tìm được nhờ bấm bằng trình duyệt tự động, không phải nhìn màn hình:**
bản đầu của `renderSkus()` ghi đè `innerHTML` cả `<tbody>` mỗi nhịp polling ⇒ **mọi nút "Săn
ngay" bị huỷ và tạo lại mỗi 1,5 giây**. Nhìn thì không thấy gì, nhưng một cú bấm chậm rơi vào
phần tử đã bị gỡ khỏi DOM và **không có gì xảy ra**. Trình duyệt tự động báo thẳng: *"element
did not become interactive"*. Đã sửa thành cập nhật tại chỗ — chỉ dựng lại hàng khi danh sách
SKU thật sự đổi, còn lại chỉ ghi đè ô tồn kho.

### Chạy k6 với trang đang mở (2026-09-05)

SKU `stock = 100`, 1.000 VU, trang đang polling 1,5 giây trên cùng SKU đó:

```
201 (bán được):    100   ← đúng 100
409 (hết hàng):    900   ← trạng thái nghiệp vụ, không phải lỗi
4xx khác:          0
5xx:               0
```

Toàn bộ 1.000 iteration xong trong **1,4 giây**. Trên màn hình, ô Tồn kho đi từ `100` xuống
`0`, đổi sang màu đỏ, nút chuyển thành "Hết hàng" và **dừng ở 0** — không có nhịp polling nào
hiện số âm hay số khác 0 sau đó.

Đối chiếu DB ngay sau khi chạy:

| | |
|---|---|
| `product_skus.stock` | **0** |
| số dòng `order_items` của SKU đó | **100** |
| tổng `quantity` đã bán | **100** |

Bán ra đúng 100 chiếc trên 1.000 người bấm. **Oversell = 0**, lần này nhìn thấy được chứ không
chỉ đọc trong bảng số của k6.
