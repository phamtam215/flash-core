# Spec: Huỷ đơn chủ động — `POST /orders/:id/cancel`

- **Phase:** 7 (nợ chuyển tiếp từ Phase 4)
- **Ngày:** 2026-09-21
- **Trạng thái:** Draft — chờ Tâm duyệt

> Hợp đồng của tính năng. Phần *vì sao* (huỷ đơn idempotent, hai đường cùng huỷ, `UPDATE` có
> điều kiện) đã có ở [`tech-playbook.md` §Phase 4](../tech-playbook.md) — spec này không chép
> lại, chỉ trỏ link.

## Mục tiêu

Người mua đổi ý được: huỷ đơn `PENDING` của chính mình và **trả hàng về kho ngay**, thay vì
phải đợi hết 15 phút giữ chỗ. Với flash sale thì 15 phút đó là 15 phút hàng bị giam mà không
ai mua được.

Đây cũng là chỗ trả một **nợ đã ghi từ Phase 4**
([spec Phase 4 §Chưa có test](phase4-async-queue-payment.md)): `cancelIfExpired` hiện đòi
`expires_at <= now()`, tức **không dùng lại được** cho huỷ chủ động. Nợ ghi ra lúc đó là *"khi
thêm endpoint huỷ đơn thì phải xem lại hàm này"* — giờ là lúc đó.

## API / Interface

```
POST /orders/:id/cancel
  Cookie: access_token=...          (bắt buộc — AccessTokenGuard ở tầng class)
  Idempotency-Key: <chuỗi>          ← xem Câu hỏi mở #2
  Body: không có
```

| Mã | Khi nào | Body |
|---|---|---|
| `200` | Huỷ thành công **ở chính lần gọi này** | `{ order: { id, status: 'CANCELLED', cancelledAt, ... } }` |
| `200` | Đơn **đã** `CANCELLED` từ trước (bấm hai lần, hoặc job tự huỷ chạy trước) | Như trên — xem Câu hỏi mở #1 |
| `409` | Đơn đã `PAID` | `{ code: 'ORDER_NOT_CANCELLABLE', message: 'Đơn đã thanh toán, không huỷ được' }` |
| `404` | Đơn không tồn tại **hoặc là đơn của người khác** | `{ code: 'ORDER_NOT_FOUND', ... }` |
| `401` | Chưa đăng nhập | filter chung |

**Vì sao `404` cho đơn của người khác chứ không `403`:** trả `403` là xác nhận đơn đó tồn tại.
Luật này đã áp dụng ở `GET /orders/:id`
([`order.errors.ts`](../../src/modules/order/order.errors.ts)), giữ nguyên cho nhất quán.

**Vì sao không dùng `DELETE /orders/:id`:** không có gì bị xoá — dòng đơn vẫn còn, chỉ đổi
`status`. `DELETE` sẽ nói sai với người đọc API rằng bản ghi biến mất, và làm khó nếu sau này
cần thêm hành động khác trên cùng đơn (`/refund`, `/extend`).

### Lỗi mới

```ts
// order.errors.ts
export class OrderNotCancellableError extends DomainError {
  readonly httpStatus = HttpStatus.CONFLICT;   // 409, giống OutOfStockError
  readonly code = 'ORDER_NOT_CANCELLABLE';
}
```

409 chứ không 400: đây là **xung đột trạng thái**, không phải input sai. Client gửi đúng hết,
chỉ là đơn đã sang trạng thái khác.

## Thay đổi ở tầng repository — điểm kỹ thuật chính của spec này

Hiện có đúng một hàm, và điều kiện hết-hạn bị **nướng cứng** vào câu SQL:

```sql
-- cancelIfExpired(orderId) — hôm nay
UPDATE orders SET status='CANCELLED', cancelled_at=now(), updated_at=now()
WHERE id = $1 AND status='PENDING' AND expires_at <= now()
```

Huỷ chủ động cần **bỏ** điều kiện `expires_at` và **thêm** điều kiện `user_id`. Đề xuất: gộp
thành một hàm có tham số, giữ nguyên hình dạng trả về (`items[] | null`):

```ts
type CancelScope =
  | { kind: 'EXPIRED' }                    // sweeper + delayed job: đòi expires_at <= now()
  | { kind: 'BY_USER'; userId: string };   // endpoint: đòi đúng chủ đơn, KHÔNG đòi hết hạn

cancelPendingOrder(orderId: string, scope: CancelScope): Promise<Items[] | null>
```

**Ba tính chất phải giữ nguyên, vì chúng là thứ làm cho "hai đường cùng huỷ" an toàn:**

1. `status = 'PENDING'` vẫn nằm trong `WHERE` ở **cả hai** nhánh. Đây mới là điều kiện chống
   trả kho hai lần, không phải `expires_at`.
2. Đọc `order_items` **sau** khi `UPDATE` trả về `> 0` dòng, trong **cùng** transaction.
3. Trả `null` khi `UPDATE` đổi 0 dòng ⇒ người gọi **không** trả kho. Service tầng trên
   ([`order.expiry.service.ts`](../../src/modules/order/order.expiry.service.ts)) không đổi.

**Không** viết hàm thứ hai copy-paste: hai câu SQL gần giống nhau cùng ghi tồn kho là cách
chắc chắn nhất để một ngày nào đó chỉ một trong hai được sửa.

## Luồng xử lý

```
1. Guard: có access_token? → không thì 401
2. repo.cancelPendingOrder(id, { kind: 'BY_USER', userId })   ← MỘT transaction
     UPDATE orders ... WHERE id=? AND user_id=? AND status='PENDING'
     0 dòng → trả null   |   >0 dòng → SELECT order_items
3. null → phải phân biệt ba lý do, bằng MỘT câu đọc lại:
     đơn không tồn tại / của người khác → 404 ORDER_NOT_FOUND
     status = 'CANCELLED'               → 200 (đã huỷ rồi, coi như thành công)
     status = 'PAID'                    → 409 ORDER_NOT_CANCELLABLE
4. có items → reserver.release(skuId, quantity) cho từng dòng   ← NGOÀI transaction
5. metrics.ordersCancelled.inc({ by: 'user' })
6. 200 { order }
```

**Bước 4 nằm ngoài transaction là chủ ý**, giống hệt `OrderExpiryService`: chiến lược `redis`
ghi vào Redis — gọi Redis trong transaction Postgres là giữ khoá DB suốt thời gian chờ mạng
(luật "transaction boundary hẹp nhất", CLAUDE.md).

**Delayed job `expire-<id>` vẫn còn trong queue và vẫn sẽ nổ sau đó.** Cố ý **không** gỡ nó:
khi nổ, `UPDATE ... WHERE status='PENDING'` đổi 0 dòng → `cancelExpired` trả `false` → không
trả kho lần hai. Gỡ job là thêm một lệnh Redis có thể hỏng, để đổi lấy một thứ vốn đã an toàn.
Test #6 khoá tính chất này.

## Edge cases bắt buộc xử lý

- [ ] Bấm huỷ **hai lần liên tiếp** trên cùng đơn → tồn kho chỉ tăng **một** lần; lần hai trả
      `200` (không phải 409, không phải 500).
- [ ] **20 request huỷ song song** trên cùng một đơn → đúng **1** lần `release`, `stock` tăng
      đúng `quantity`, không có 5xx.
- [ ] Huỷ đơn của **người khác** (đơn tồn tại thật) → `404`, và `stock` **không** đổi.
- [ ] Huỷ đơn `PAID` → `409`, `status` vẫn `PAID`, `paid_at` không bị xoá, `stock` không đổi.
- [ ] Huỷ **rồi** delayed job `order.expire` nổ (đơn vốn có `expires_at` sau đó) → job đổi 0
      dòng, `stock` **không** tăng lần hai.
- [ ] **Sweeper** chạy sau khi user đã huỷ → cùng kết quả như trên, `sweepExpired()` không đếm
      đơn đó.
- [ ] Huỷ **rồi** webhook thanh toán tới sau (người mua vẫn bấm trả tiền ở cổng) → **không**
      chuyển `PAID`; ghi `refund_requests` lý do `ORDER_ALREADY_CANCELLED`. *Đường này đã có
      sẵn ở [`order-payment.service.ts`](../../src/modules/order/order-payment.service.ts) —
      test để chứng minh nó vẫn đúng khi nguồn huỷ là user, không phải job.*
- [ ] Webhook `PAID` tới **trước** rồi user mới bấm huỷ (ngược lại ca trên) → `409`, tiền giữ
      nguyên, không sinh `refund_requests`.
- [ ] Đơn có **nhiều dòng hàng** (2 SKU) → cả hai SKU đều được trả kho, đúng số lượng từng dòng.
- [ ] `:id` không phải UUID hợp lệ → `404` (không để lỗi cast uuid của Postgres thành 500).

## Test cases phải pass

Integration (Postgres + Redis thật) trừ khi ghi rõ.

1. Đặt đơn 2 chiếc (`stock` 10 → 8) → huỷ → `200`, `status='CANCELLED'`, `cancelled_at` khác
   null, `stock` trở lại **10**.
2. Huỷ lần hai trên cùng đơn → `200`, `stock` vẫn **10** (không thành 12).
3. ⭐ **20 request huỷ song song** cùng một đơn → đúng 1 lần `200` … (hoặc 20 lần `200`, xem
   Câu hỏi mở #1), `stock` tăng đúng **2**, số 5xx = **0**.
4. User B huỷ đơn của user A → `404`; đọc lại đơn: vẫn `PENDING`, `stock` không đổi.
5. Đơn đã `PAID` (qua webhook hợp lệ) → huỷ → `409` `ORDER_NOT_CANCELLABLE`, `status` vẫn
   `PAID`.
6. ⭐ Huỷ chủ động, rồi gọi thẳng `expiryService.cancelExpired(orderId)` → trả `false`,
   `stock` **không** tăng lần hai.
7. Huỷ chủ động, rồi `sweepExpired()` → trả `0`, `stock` không đổi.
8. ⭐ Huỷ chủ động, rồi webhook thanh toán đúng chữ ký tới → `status` vẫn `CANCELLED`, có đúng
   **1** dòng `refund_requests` lý do `ORDER_ALREADY_CANCELLED`.
9. Đơn 2 SKU (A×1, B×3) → huỷ → `stock` của A tăng 1, của B tăng 3.
10. `POST /orders/khong-phai-uuid/cancel` → `404`, không 500.
11. Không có cookie → `401`.
12. (unit) `OrderService.cancelMyOrder`: repo trả `null` + đơn `PAID` → ném
    `OrderNotCancellableError`; repo trả `null` + đơn không tồn tại → ném `OrderNotFoundError`;
    repo trả `items` → `release` được gọi đúng một lần cho mỗi dòng.
13. (unit) `cancelPendingOrder` với `scope.kind='BY_USER'` **không** có `expires_at` trong điều
    kiện, với `EXPIRED` thì **có** — khoá lại để không ai vô tình đổi ngược.

## Definition of Done

- [ ] 13 test case trên xanh; tổng integration ≥ 101, unit ≥ 135.
- [ ] `npm run check` sạch (lint + typecheck + unit).
- [ ] `OrderExpiryService` **không đổi hành vi** — 90 test cũ vẫn xanh, không sửa test nào để
      chúng xanh trở lại.
- [ ] Ngưỡng coverage trong `jest.config.js` vẫn qua.
- [ ] UI có nút "Huỷ đơn" ở tab *Đơn của tôi* cho dòng `PENDING` — xem Câu hỏi mở #3.
- [ ] Cập nhật: `docs/architecture.md` (sơ đồ tuần tự B thêm đường huỷ chủ động), §Trạng thái
      trong `CLAUDE.md`, mục nợ ở `docs/specs/phase4-async-queue-payment.md`, và
      `docs/tech-playbook.md` nếu có bug thật tìm được.

## Ngoài phạm vi (Non-goals)

- **Huỷ đơn `PAID` / hoàn tiền tự động.** Đụng tiền thật, cần quyết định riêng. Hôm nay hệ
  thống chỉ *ghi* `refund_requests` và để người xử lý tay — giữ nguyên.
- **Admin huỷ đơn của người khác.** Chưa có RBAC thật (nợ từ Phase 2); làm bây giờ là dựng
  quyền trên nền chưa có.
- **Gia hạn giữ chỗ** (`/extend`). Ngược hướng với flash sale.
- **Gỡ delayed job khỏi queue khi huỷ.** Đã giải thích ở §Luồng xử lý: không cần, và thêm một
  điểm hỏng.
- **Email báo "đơn đã huỷ".** Thêm một consumer nữa; để dành nếu thấy thật sự cần.

## Câu hỏi mở cho Tâm quyết

### 1. Huỷ đơn đã `CANCELLED` → `200` hay `409`?

| | `200` (khuyến nghị) | `409` |
|---|---|---|
| Ý nghĩa | "Trạng thái anh muốn đã đạt được" | "Đơn không còn huỷ được" |
| Bấm hai lần trên UI | Im lặng, đúng ý người dùng | Hiện lỗi đỏ cho một thao tác đã thành công |
| Test #3 (20 song song) | 20 lần `200` — đơn giản | 1 lần `200` + 19 lần `409` |

**Em khuyến nghị `200`.** Huỷ là thao tác *idempotent theo bản chất*: gọi n lần cho cùng kết
quả. Trả `409` biến một thao tác an toàn thành thao tác người dùng sợ bấm lại — và trên mạng
chập chờn thì bấm lại là chuyện bình thường. `409` vẫn dành riêng cho `PAID`, nơi trạng thái
thật sự **xung đột** với ý định.

### 2. Có bắt buộc `Idempotency-Key` cho endpoint này không?

CLAUDE.md: *"Mọi API ghi (POST/PUT) liên quan đơn hàng phải nhận `Idempotency-Key`"*. Chiếu
theo chữ thì có.

**Em khuyến nghị KHÔNG bắt buộc**, và ghi một dòng ngoại lệ vào CLAUDE.md nói rõ vì sao. Lý
do: `Idempotency-Key` tồn tại để chống **tạo trùng** — hai lần bấm ra hai đơn. Huỷ đơn không
tạo gì cả; tính idempotent của nó đến từ `WHERE status='PENDING'` trong chính câu `UPDATE`,
chặt hơn một header do client tự sinh. Bắt buộc thêm header ở đây là **nghi lễ**: tốn một
khái niệm cho client mà không mua thêm bảo đảm nào.

Nếu Tâm muốn giữ luật cho nhất quán thì em làm theo — chỉ mất vài dòng.

### 3. UI có nút "Huỷ đơn" luôn trong đợt này không?

**Em khuyến nghị CÓ** — một nút ở cột cuối của dòng `PENDING`, hỏi xác nhận rồi gọi API, xong
thì để nhịp polling 1,5 giây tự cập nhật. Khoảng 25 dòng trong
[`public/app.js`](../../public/app.js).

Lý do: đây là tính năng **nhìn thấy được**, và nó bổ sung đúng thứ đang thiếu cho cảnh demo —
hiện tại muốn cho người phỏng vấn thấy "hàng quay lại kho" thì phải ngồi đợi hết giờ giữ chỗ
(Bước 6b của [`demo-phong-van.md`](../demo-phong-van.md) phải hạ `ORDER_HOLD_MINUTES=0.5` mới
quay được). Có nút huỷ thì cảnh đó bấm một cái là xong.

### 4. Có đếm metric `orders_cancelled_total{by="user"|"expiry"}` không?

**Em khuyến nghị CÓ.** Một counter, hai nhãn, khoảng 10 dòng. Nó trả lời được câu đáng hỏi
nhất khi hệ thống chạy thật: *người mua đang tự bỏ đơn, hay đơn đang chết vì hết giờ?* — hai
nguyên nhân hoàn toàn khác nhau, và hôm nay không có cách nào phân biệt từ ngoài. Nhãn giữ ở
hai giá trị cố định nên không có rủi ro cardinality.
