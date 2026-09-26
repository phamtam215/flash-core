# Spec: Phase 8 — Đợt sale thật (giờ mở, giá riêng, giới hạn mua)

- **Phase:** 8
- **Ngày:** 2026-09-26
- **Trạng thái:** **Đã implement** 2026-09-26 (Tâm duyệt cả 3 câu hỏi mở theo khuyến nghị)

> Hợp đồng của phase. Kiến thức (*vì sao* điều kiện thời gian phải nằm trong câu ghi, vì sao
> quota khác tồn kho) sẽ viết vào [`tech-playbook.md`](../tech-playbook.md) §Phase 8, không
> viết ở đây.

## Vấn đề

**Dự án tên là flash sale nhưng chưa có đợt sale nào.** Hiện đặt hàng thẳng trên SKU: bấm lúc
nào cũng mua được, giá luôn là giá gốc, và một người mua bao nhiêu cũng được. Ba thứ định
nghĩa nên một đợt flash sale đều thiếu:

| Thiếu | Hệ quả |
|---|---|
| **Giờ mở/đóng** | Không có "20:00 mở bán" — mất luôn cảnh nghẹt thở mà cả dự án dựng ra để mô phỏng |
| **Giá riêng theo đợt** | Sale mà không giảm giá |
| **Giới hạn mua mỗi người** | Một người quét sạch 100 chiếc bằng script — đúng thứ flash sale thật sợ nhất |

Cái thứ ba cũng là **một bài toán concurrency mới**, không phải biến thể của bài cũ — xem
§Vì sao quota khác tồn kho.

## Phạm vi

Ba bảng mới, một endpoint đặt hàng mở rộng, một màn hình đếm ngược. **Không** đụng vào ba
chiến lược chống oversell — chúng giữ nguyên, chỉ được gọi trên tồn kho của *đợt* thay vì của
SKU.

## Schema

```prisma
model SaleEvent {
  id          String   @id @default(uuid()) @db.Uuid
  name        String
  slug        String   @unique
  startsAt    DateTime @map("starts_at")
  endsAt      DateTime @map("ends_at")

  /// Cờ DUY NHẤT được lưu. "Đang mở hay chưa" thì KHÔNG lưu — xem §Trạng thái phải tính, đừng lưu.
  isPublished Boolean  @default(false) @map("is_published")

  items SaleEventSku[]
  @@index([isPublished, startsAt])
  @@map("sale_events")
}

model SaleEventSku {
  id           String @id @default(uuid()) @db.Uuid
  saleEventId  String @map("sale_event_id") @db.Uuid
  skuId        String @map("sku_id") @db.Uuid

  /// Giá của đợt. Đơn vẫn snapshot giá này vào `OrderItem.unitPriceVnd` như Phase 3.
  salePriceVnd Int    @map("sale_price_vnd")

  /// Tồn kho **cắt ra** từ `ProductSku.stock` lúc publish — xem Câu hỏi mở #1.
  stock        Int
  perUserLimit Int    @default(2) @map("per_user_limit")

  event     SaleEvent           @relation(fields: [saleEventId], references: [id], onDelete: Cascade)
  purchases SaleEventPurchase[]

  @@unique([saleEventId, skuId])
  @@map("sale_event_skus")
}

/// Đã mua bao nhiêu, của ai, trong đợt nào. Một dòng cho mỗi cặp (đợt-sku, người).
model SaleEventPurchase {
  saleEventSkuId String @map("sale_event_sku_id") @db.Uuid
  userId         String @map("user_id") @db.Uuid
  quantity       Int

  item SaleEventSku @relation(fields: [saleEventSkuId], references: [id], onDelete: Cascade)

  @@id([saleEventSkuId, userId])
  @@map("sale_event_purchases")
}
```

## Trạng thái phải TÍNH, đừng lưu

Cám dỗ đầu tiên là thêm cột `status: SCHEDULED | ACTIVE | ENDED` rồi có một job lật nó lúc
20:00. **Không làm vậy.**

`status` như thế là **bản cache của một giá trị tính được** — và như mọi cache, nó sai được:
job chạy trễ 3 giây thì DB nói "chưa mở" trong khi đồng hồ đã qua 20:00. Lúc đó có hai nguồn
sự thật về cùng một câu hỏi, và nguồn sai lại là nguồn được tin.

Thay vào đó: lưu `startsAt`/`endsAt` + `isPublished`, còn "đang mở hay chưa" **tính ra tại chỗ
đọc**. Không job, không lệch, không có gì để đồng bộ.

`isPublished` phải lưu vì nó **không** tính được từ thời gian: một đợt soạn dở không được tự
mở chỉ vì đồng hồ đi qua `startsAt`.

## Ai quyết định "đã 20:00" — và vì sao không phải Node

Điều kiện thời gian **bắt buộc nằm trong chính câu `UPDATE`**, dùng `now()` của Postgres:

```sql
UPDATE sale_event_skus s
SET stock = stock - $qty
FROM sale_events e
WHERE s.id = $id AND e.id = s.sale_event_id
  AND s.stock >= $qty
  AND e.is_published = true
  AND now() BETWEEN e.starts_at AND e.ends_at   -- ← đồng hồ của DB, không phải của app
RETURNING s.sale_price_vnd
```

Kiểm `Date.now()` trong Node rồi mới gửi `UPDATE` là **lặp lại đúng sai lầm của
`if (stock > 0) stock--`** ở Phase 3: điều kiện được đánh giá ở một thời điểm đã cũ, tại một
nơi không phải nơi quyết định. Hai điểm khác biệt khiến nó tệ hơn ở đây:

1. **Nhiều instance, nhiều đồng hồ.** Cloud Run chạy tới 2 instance; nếu đồng hồ một máy nhanh
   2 giây thì máy đó mở bán sớm 2 giây — và đúng 2 giây đó là lúc *chỉ nó* phục vụ, nên ai bấm
   trúng nó thì mua được trước cả nghìn người khác. Không công bằng, và không ai lần ra được.
2. **Một nguồn thời gian là một nguồn sự thật.** `now()` của Postgres là mốc duy nhất mà mọi
   instance cùng nhìn thấy.

## Vì sao quota khác tồn kho — và không dùng lại được cơ chế cũ

| | Tồn kho | Quota mỗi người |
|---|---|---|
| Hình dạng | **Một dòng nóng** cho cả nghìn người | **Một dòng cho mỗi người** |
| Tranh chấp | Giữa **những người khác nhau** — phải xếp hàng | Chỉ giữa **các lần bấm của cùng một người** |
| Lời giải | `UPDATE ... WHERE stock >= ?` (hoặc khoá / Lua) | `INSERT ... ON CONFLICT DO UPDATE ... WHERE` |

Quota **không cần khoá gì cả**, vì hai người khác nhau không bao giờ chạm cùng một dòng. Câu
upsert có điều kiện làm trọn việc trong một lần ghi:

```sql
INSERT INTO sale_event_purchases (sale_event_sku_id, user_id, quantity)
VALUES ($item, $user, $qty)
ON CONFLICT (sale_event_sku_id, user_id) DO UPDATE
  SET quantity = sale_event_purchases.quantity + EXCLUDED.quantity
  WHERE sale_event_purchases.quantity + EXCLUDED.quantity <= $limit
RETURNING quantity
```

`RETURNING` không trả dòng nào ⇒ vượt giới hạn. **Cùng một triết lý với Phase 3** (đưa điều
kiện vào câu ghi), nhưng **cơ chế khác** — và đó là điểm học của phase này: *hình dạng tranh
chấp quyết định công cụ, không phải thói quen.*

## Thứ tự: quota TRƯỚC, tồn kho SAU

Nhánh nào thất bại cũng phải bù trừ nhánh kia, nên thứ tự không quyết định tính đúng — nó
quyết định **tải lên dòng nóng**.

Chọn **quota trước** vì: một người đã mua đủ 2 cái thì **luôn luôn** bị từ chối, biết trước mà
không cần hỏi tồn kho. Kiểm nó trước nghĩa là những request chắc chắn hỏng **không bao giờ
chạm vào dòng tồn kho đang có nghìn người tranh**. Dưới kịch bản thật (bot bấm 50 lần) đây là
khác biệt đáng kể.

Thất bại ở bước tồn kho ⇒ trừ lại quota bằng đúng câu `UPDATE ... SET quantity = quantity - $qty`.

## API

```
GET  /sale-events                 → danh sách đợt đã publish, kèm `status` TÍNH RA
GET  /sale-events/:slug           → chi tiết + danh sách SKU, giá sale, tồn kho, giới hạn
POST /orders                      → body thêm `saleEventSkuId` (thay cho `skuId`)
```

| Mã | Khi nào |
|---|---|
| `409 SALE_NOT_OPEN` | Chưa tới giờ, đã hết giờ, hoặc đợt chưa publish |
| `409 PER_USER_LIMIT_REACHED` | Vượt `perUserLimit` |
| `409 OUT_OF_STOCK` | Hết hàng của đợt (giữ nguyên mã cũ) |

Ba mã `409` tách bạch, **không gộp**: cùng lý do với `sku_not_found` vs `out_of_stock` ở
Phase 3 — lúc có sự cố, "1.000 lần 409" không trả lời được câu đáng hỏi là *bán hết hàng, hay
đang có bot bấm, hay người ta vào sớm?*

Metric: `orders_placed_total{result}` thêm hai nhãn `sale_not_open`, `per_user_limit`.

## Edge cases bắt buộc xử lý

- [ ] Bấm **trước** `startsAt` 1 giây → `409 SALE_NOT_OPEN`, tồn kho **không** đổi.
- [ ] Bấm **sau** `endsAt` 1 giây → `409 SALE_NOT_OPEN`.
- [ ] Đợt `isPublished = false` dù đang trong khung giờ → `409`, và **không** hiện ở
      `GET /sale-events`.
- [ ] 1.000 request song song đúng thời khắc mở bán, `stock = 100`, `perUserLimit = 2`, **500
      user khác nhau** → đúng 100 chiếc bán ra, không ai mua quá 2.
- [ ] **Một user bấm 50 lần song song**, limit 2 → mua được đúng 2, 48 lần `409`, và dòng tồn
      kho chỉ bị chạm 2 lần (chứng minh quota chặn trước).
- [ ] Quota qua nhưng tồn kho hết → quota được **trả lại**; bấm lại lần sau vẫn còn suất.
- [ ] Huỷ đơn (chủ động hoặc hết hạn) → trả **cả** tồn kho đợt **lẫn** quota. Đây là chỗ dễ
      quên nhất: quên trả quota thì người mua huỷ đơn rồi không mua lại được nữa.
- [ ] Đơn quá hạn tự huỷ khi **đợt đã đóng** → vẫn trả kho bình thường (không được đòi
      `now() BETWEEN ...` ở đường huỷ).
- [ ] Đồng hồ máy app lệch 5 giây so với DB → **không ảnh hưởng gì** (test bằng cách giả lập
      `Date.now()` trong app, không giả lập `now()` của DB).
- [ ] `saleEventSkuId` sai định dạng UUID → `404`, không `500`.

## Test cases phải pass

1. Đợt chưa tới giờ → `409 SALE_NOT_OPEN`, `stock` không đổi.
2. Đợt đã hết giờ → `409 SALE_NOT_OPEN`.
3. Đợt chưa publish, đang trong giờ → `409`; không xuất hiện ở `GET /sale-events`.
4. Trong giờ, còn hàng, chưa chạm limit → `201`, `OrderItem.unitPriceVnd` = **giá sale**.
5. ⭐ 1.000 request song song / 500 user / `stock=100` / `limit=2` → đúng 100 đơn, không user
   nào > 2, `stock = 0`, 0 lỗi 5xx.
6. ⭐ Một user bấm 50 lần song song, `limit=2` → đúng 2 đơn; đếm số lần `stock` bị chạm = 2.
7. ⭐ Quota qua, tồn kho hết → `409 OUT_OF_STOCK` **và** `quantity` trong
   `sale_event_purchases` trở về giá trị trước đó.
8. Huỷ đơn chủ động → tồn kho đợt +n **và** quota −n; mua lại được.
9. Đơn hết hạn tự huỷ sau khi đợt đóng → vẫn trả kho, `cancelPendingOrder` không đòi điều kiện
   thời gian của đợt.
10. `GET /sale-events` trả `status` tính ra đúng ở cả ba mốc (trước / trong / sau).
11. (unit) Câu upsert quota: vượt limit → 0 dòng; đúng limit → trả `quantity` mới.
12. (unit) Service: `SALE_NOT_OPEN` vs `PER_USER_LIMIT_REACHED` vs `OUT_OF_STOCK` không lẫn nhau.

## Definition of Done

- [x] **17 integration test xanh** (nhiều hơn 12 dự kiến — thêm test cho publish và cho đường
      cũ), tổng integration **131 → 148**. `npm run check` sạch, unit 163/163. Chạy 2 lần liên
      tiếp đều xanh.
- [ ] k6 chạy lại được trên **đợt sale** — chưa làm, `k6/seed-target.js` vẫn dựng SKU thường.
      Test #6 đã chứng minh tính chất đó ở quy mô 120 request; k6 là để có số p95/throughput.
- [ ] Màn hình đếm ngược tới `startsAt` — thuộc Phase 9 khối 4 (web).
- [x] [ADR-015](../adr/015-ton-kho-dot-cat-ra-tu-sku.md) chốt cắt ra khỏi SKU.
- [x] `tech-playbook.md` §Phase 8.
- [ ] Cập nhật `architecture.md` (sơ đồ tuần tự A thêm hai điều kiện) và §Trạng thái `CLAUDE.md`.

## Ngoài phạm vi (Non-goals)

- **Phòng chờ ảo** (admission control). Đáng làm, nhưng là một phase riêng.
- **Giỏ hàng nhiều SKU** — vẫn để dành cho phase deadlock-ordering.
- **Giới hạn theo thiết bị/IP** thay vì theo tài khoản. Chống bot thật cần nhiều hơn một cột.
- **Đợt sale lồng nhau / giá bậc thang / mã giảm giá.** Một đợt, một giá.
- **Chiến lược chống oversell thứ tư.** Ba cái hiện có chạy nguyên trên tồn kho của đợt.

## Câu hỏi mở — ĐÃ CHỐT 2026-09-26

> Cả ba duyệt theo khuyến nghị. Giữ phần lập luận vì *lý do* mới là thứ đáng đọc lại.
> Câu #1 chốt thành [ADR-015](../adr/015-ton-kho-dot-cat-ra-tu-sku.md).

### 1. Tồn kho của đợt: cắt ra từ SKU, hay dùng chung `ProductSku.stock`?

| | **Cắt ra** (khuyến nghị) | Dùng chung |
|---|---|---|
| Cách làm | Lúc publish: `ProductSku.stock -= allocated`, đợt giữ số của riêng nó | Đợt chỉ thêm giá + giờ + limit; vẫn trừ `ProductSku.stock` |
| Được | Hai đợt (20:00 và 22:00) có kho riêng, không ăn của nhau. Đúng cách flash sale thật vận hành | Ít schema hơn, ít đường bù trừ hơn |
| Mất | Thêm một bước publish phải đúng, và huỷ đợt phải trả kho về SKU | **Không mô hình hoá được hai đợt cùng lúc** — mà đó là cả điểm của "đợt" |

**Em khuyến nghị cắt ra.** Dùng chung thì `SaleEvent` chỉ còn là một cái nhãn dán lên SKU, và
câu hỏi thú vị nhất ("phân bổ 100 chiếc cho đợt tối, 50 cho đợt sáng") biến mất. Chi phí là một
thao tác publish — nhỏ, và bản thân nó cũng là một transaction đáng viết đúng.

### 2. `perUserLimit` đếm theo **đợt-SKU** hay theo **cả đợt**?

**Em khuyến nghị theo đợt-SKU** (như schema trên): "mỗi người 2 chiếc *mỗi mẫu*". Theo cả đợt
("2 sản phẩm bất kỳ trong đợt") nghe hợp lý hơn với người dùng, nhưng biến khoá quota thành
`(saleEventId, userId)` và lúc đó **quota lại thành dòng nóng chung cho nhiều SKU** — mất đúng
tính chất làm nó rẻ. Nếu Tâm muốn cả đợt thì làm được, chỉ cần biết là đã đánh đổi cái gì.

### 3. Đơn cũ trỏ thẳng SKU thì sao — giữ hay bỏ `POST /orders` bản cũ?

**Em khuyến nghị GIỮ cả hai đường**: `skuId` (mua giá gốc, không giới hạn) và `saleEventSkuId`
(mua theo đợt). Lý do: 120 integration test hiện có đều đi đường cũ, bỏ nó là phải viết lại
gần hết — mà phần chúng đang khoá (oversell, idempotency, huỷ đơn) **không** liên quan tới đợt
sale. Đổi lại DTO có hai trường loại trừ nhau, phải validate bằng Zod `refine`.

---

## Trạng thái thật (2026-09-26)

**17/17 integration test xanh** (`test/sale-event.e2e-spec.ts`), tổng **148 integration + 163
unit**, chạy 2 lần liên tiếp đều ổn định.

| Việc | Ở đâu |
|---|---|
| 3 bảng + cột `order_items.sale_event_sku_id` | `migrations/20260926120000_add_sale_event` |
| Module `sale-event` (soạn, publish, xem) | `src/modules/sale-event/` |
| Quota + trừ kho đợt + chẩn đoán 3 lý do | `order.repository.ts` |
| Hai đường đặt hàng tách bạch, phần chung gộp lại | `order.service.ts` |
| Trả kho về **đúng chỗ** khi huỷ | `order.expiry.service.ts` §`releaseStock` |
| `OptionalAccessTokenGuard` | `src/modules/auth/` |

### Ba thứ phát sinh ngoài spec

1. **`allocatedStock` tách khỏi `stock`.** Bản spec đầu chỉ có `stock`, và publish phải nhận
   danh sách phân bổ từ người gọi — dẫn tới một hàm `publish()` không dùng được. Tách thành
   *phân bổ* (cố định từ lúc soạn) và *còn lại* (giảm dần khi bán) thì publish tự đọc được, và
   tiện thể trả lời được "đã bán bao nhiêu" bằng một phép trừ thay vì đếm đơn.
2. **`OptionalAccessTokenGuard`.** `GET /sale-events/:slug` là trang công khai nhưng cần biết
   người xem là ai để hiện "bạn còn mua được 1 chiếc". `AccessTokenGuard` thì ép đăng nhập,
   không có guard thì `userId` luôn rỗng. Guard mới **luôn cho qua**, chỉ gắn `userId` khi có
   phiên hợp lệ — token hỏng không phải lỗi.
3. **Trả quota khi huỷ cần `userId` chính xác.** Bản đầu đoán "đơn mới nhất của mẫu này" bằng
   một câu join — sai ngay khi có hai người cùng huỷ. Đã đổi: `cancelPendingOrder` trả kèm
   `userId` của đơn.

### Một điều spec nói quá điều đã làm

§Phạm vi viết *"ba chiến lược chống oversell giữ nguyên, chỉ được gọi trên tồn kho của đợt"*.
Thực tế **không** làm vậy: đường bán theo đợt dùng một câu `UPDATE` có điều kiện (cùng cơ chế
`optimistic`). Lý do và đánh đổi ghi ở [ADR-015](../adr/015-ton-kho-dot-cat-ra-tu-sku.md)
§Một điều KHÔNG làm.
