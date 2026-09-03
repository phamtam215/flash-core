# Spec: Order & Concurrency — 3 chiến lược chống oversell (Phase 3) ⭐

- **Phase:** 3
- **Ngày:** 2026-09-01
- **Trạng thái:** Draft — chờ duyệt (chưa code)

> Đây là phase **quan trọng nhất** của dự án (`project-context.md` quyết định #6). Hai phase
> trước là chuẩn bị: Phase 1 cho biết *ai* đang mua, Phase 2 cho biết *cái gì* còn hàng. Phase
> này trả lời câu hỏi khó: **1.000 người bấm cùng lúc vào 100 chiếc áo thì bán ra đúng 100,
> không phải 101.**
>
> Kiến thức nền cần đọc TRƯỚC khi code: [`tech-playbook.md` §Phase 3](../tech-playbook.md) —
> 6 cơ chế (vì sao `if (stock > 0) stock--` *chắc chắn* sai, 3 mức isolation, vì sao
> `UPDATE ... WHERE stock >= 1` an toàn ngay ở Read Committed, 3 chiến lược và đánh đổi, vì
> sao Redis phải dùng Lua, vì sao Idempotency-Key phải để DB làm trọng tài). Khoảng 20 phút.

## Mục tiêu

Cho user "săn" một SKU: tạo đơn giữ chỗ, trừ tồn kho **chính xác tuyệt đối** dưới tải cao.
Deliverable học tập không phải "có API đặt hàng chạy được", mà là **so sánh được ba cách
chống oversell bằng số đo thật**, và giải thích được cách nào thắng ở hoàn cảnh nào.

Ba tính chất bắt buộc, không thương lượng:
1. **Oversell = 0** ở cả ba chiến lược, dưới 1.000 VU.
2. **Idempotent**: cùng một `Idempotency-Key` gọi 10 lần → đúng 1 đơn.
3. **Snapshot price**: đơn giữ giá tại thời điểm đặt, giá SKU đổi sau đó không ảnh hưởng.

## API

Module đề xuất: `src/modules/order/` — sở hữu `Order`, `OrderItem`, và **cả ba chiến lược
reserve** (xem Câu hỏi mở #1 về lý do không đặt ở module `product`).

| Method | Path | Việc | Auth | Response |
|---|---|---|---|---|
| POST | `/orders` | **"Săn ngay"** — trừ kho + tạo đơn giữ chỗ | `AccessTokenGuard` | `201 { order }` |
| GET | `/orders` | Đơn của tôi, cursor pagination | `AccessTokenGuard` | `200 { items, nextCursor }` |
| GET | `/orders/:id` | Chi tiết đơn kèm item | `AccessTokenGuard` | `200 { order, items }` |

`POST /orders` **bắt buộc** header `Idempotency-Key` (luật trong `CLAUDE.md`: mọi API ghi liên
quan đơn hàng). Thiếu header → `400 IDEMPOTENCY_KEY_REQUIRED`, chưa chạm DB.

**Request schema (Zod):**

```ts
const createOrder = z.object({
  skuId: z.string().uuid(),
  quantity: z.number().int().positive().max(5), // xem Câu hỏi mở #3
});
// KHÔNG có field `price`. Client không được gửi giá — giá lấy từ DB tại thời điểm đặt
// (snapshot price). `ZodValidationPipe` tự loại field lạ, đã có test từ Phase 0.
```

`GET /orders` dùng lại đúng `listQuerySchema` (cursor + limit) của Phase 2 — cùng cơ chế
keyset `(createdAt, id)`, không phát minh lại.

## Schema DB

```prisma
enum OrderStatus {
  PENDING   // đã giữ chỗ, chờ thanh toán
  PAID      // Phase 4 chuyển sang trạng thái này khi webhook xác nhận
  CANCELLED // Phase 4: hết 15 phút tự hủy, hoặc user tự hủy
}

/// Đơn hàng. `idempotencyKey` là khoá UNIQUE — đó là cơ chế chống double-submit, và
/// DB là trọng tài duy nhất (xem tech-playbook §Phase 3 cơ chế #6).
model Order {
  id             String      @id @default(uuid()) @db.Uuid
  userId         String      @map("user_id") @db.Uuid
  status         OrderStatus @default(PENDING)
  /// Tổng tiền = tổng (unitPriceVnd × quantity) của item, chốt tại thời điểm đặt.
  totalVnd       Int         @map("total_vnd")
  /// Client tự sinh, gửi qua header. UNIQUE theo user để hai user tình cờ dùng cùng chuỗi
  /// không chặn nhau.
  idempotencyKey String      @map("idempotency_key")
  /// Mốc hết hạn giữ chỗ (createdAt + 15 phút). Phase 3 chỉ GHI cột này; job tự hủy khi
  /// quá hạn là deliverable của Phase 4 (BullMQ delayed job).
  expiresAt      DateTime    @map("expires_at")
  createdAt      DateTime    @default(now()) @map("created_at")
  updatedAt      DateTime    @updatedAt @map("updated_at")

  user  User        @relation(fields: [userId], references: [id])
  items OrderItem[]

  @@unique([userId, idempotencyKey])
  @@index([userId, createdAt])
  @@index([status, expiresAt]) // Phase 4 quét đơn PENDING quá hạn
  @@map("orders")
}

/// Một dòng trong đơn. `unitPriceVnd` là SNAPSHOT — copy giá SKU lúc đặt, KHÔNG join lấy
/// giá hiện tại khi đọc đơn. Lý do: giá SKU đổi (kết thúc sale) không được làm đổi số tiền
/// trên đơn đã chốt.
model OrderItem {
  id           String   @id @default(uuid()) @db.Uuid
  orderId      String   @map("order_id") @db.Uuid
  skuId        String   @map("sku_id") @db.Uuid
  quantity     Int
  unitPriceVnd Int      @map("unit_price_vnd")
  createdAt    DateTime @default(now()) @map("created_at")

  order Order      @relation(fields: [orderId], references: [id], onDelete: Cascade)
  sku   ProductSku @relation(fields: [skuId], references: [id])

  @@index([orderId])
  @@index([skuId])
  @@map("order_items")
}
```

**Quan hệ ngược bắt buộc thêm** (Prisma không validate nếu thiếu):

```prisma
model User       { orders     Order[]      }  // thêm vào model User đã có
model ProductSku { orderItems OrderItem[]  }  // thêm vào model ProductSku đã có
```

**Thêm vào `ProductSku` (migration riêng, đúng như Phase 2 đã hẹn):**

```prisma
  /// Tăng 1 mỗi lần tồn kho đổi. Dùng cho chiến lược optimistic.
  /// Ghi chú quan trọng: cột này KHÔNG cần thiết để chống oversell — `UPDATE ... WHERE
  /// stock >= ?` đã đủ an toàn ngay ở Read Committed. Nó có mặt để (a) so sánh đúng nghĩa
  /// "optimistic locking" trong benchmark, (b) chuẩn bị cho trường hợp update nhiều field
  /// phụ thuộc nhau. Xem tech-playbook §Phase 3 cơ chế #3.
  version Int @default(0)
```

## Ba chiến lược, một interface

Cả ba implement cùng interface, đổi bằng `INVENTORY_STRATEGY` (biến này **đã có sẵn** trong
`env.schema.ts` từ Phase 0 — đúng chỗ nó được chuẩn bị cho).

```ts
/** Kết quả reserve — service tầng trên không cần biết chiến lược nào đang chạy. */
type ReserveResult =
  | { ok: true; unitPriceVnd: number; attempts: number }
  | { ok: false; reason: 'OUT_OF_STOCK' | 'SKU_NOT_FOUND' };

interface InventoryReserver {
  /** Trừ `quantity` khỏi tồn kho của `skuId`, trả về giá đơn vị để snapshot vào đơn. */
  reserve(skuId: string, quantity: number): Promise<ReserveResult>;
  readonly name: 'optimistic' | 'pessimistic' | 'redis';
}
```

Đăng ký qua DI token `INVENTORY_RESERVER` + factory đọc `env.INVENTORY_STRATEGY`. Không dùng
`if/else` rải trong service — service chỉ biết interface.

### A. Optimistic — ghi kèm điều kiện, thua thì retry

```sql
UPDATE product_skus
SET stock = stock - $2, version = version + 1, updated_at = now()
WHERE id = $1 AND stock >= $2 AND is_active = true
RETURNING price_vnd, version;
```

- `UPDATE` trả **0 dòng** → chưa biết vì sao. Phải `SELECT` lại để **tách hai nhánh**:
  không tồn tại → `SKU_NOT_FOUND` (404); tồn tại nhưng `stock < quantity` → `OUT_OF_STOCK`
  (409, **không retry** — retry cho SKU hết hàng là bug ghi trong tech-playbook).
- Retry chỉ dành cho xung đột thật (deadlock/serialization failure `40001`): tối đa 3 lần,
  backoff nhỏ có jitter (xem Câu hỏi mở #4).
- **Điểm học:** câu `UPDATE` này an toàn ngay ở Read Committed, không cần đổi isolation level.
  Khi nó gặp dòng đang bị khoá, Postgres **chờ rồi đánh giá lại `WHERE` trên phiên bản mới**.

### B. Pessimistic — `SELECT FOR UPDATE`, người sau chờ

```ts
await this.prisma.$transaction(async (tx) => {
  // Prisma không có API cho FOR UPDATE → phải $queryRaw. Đây chính là "chạm giới hạn của
  // ORM" mà project-context.md quyết định #5 muốn học.
  const rows = await tx.$queryRaw`
    SELECT id, stock, price_vnd FROM product_skus
    WHERE id = ${skuId}::uuid AND is_active = true
    FOR UPDATE`;
  // ... kiểm tra stock trong RAM Ở ĐÂY LÀ AN TOÀN, vì dòng đang bị khoá độc quyền ...
  await tx.$executeRaw`UPDATE product_skus SET stock = stock - ${quantity} ...`;
});
```

- **Bắt buộc** bọc trong `$transaction` interactive. Chạy `FOR UPDATE` ngoài transaction thì
  khoá nhả ngay khi câu lệnh xong → vô tác dụng (bug #2 trong bảng tech-playbook).
- Khoá nhiều dòng thì luôn `ORDER BY id` để tránh deadlock. Phase 3 chỉ khoá 1 SKU/đơn nên
  chưa gặp, nhưng ghi ra để không quên khi giỏ hàng nhiều SKU xuất hiện.
- **Điểm học dự kiến:** đây là chiến lược sẽ **cạn pool** trước tiên — mỗi transaction đang
  chờ khoá vẫn giữ một connection. `DATABASE_POOL_MAX` là **một phần của kết quả benchmark**,
  không phải hằng số.

### C. Redis atomic — Lua kiểm-tra-và-trừ trong một lệnh

```lua
-- KEYS[1] = stock:{skuId}, ARGV[1] = quantity
local stock = tonumber(redis.call('GET', KEYS[1]))
if stock == nil then return -2 end          -- chưa nạp vào Redis
if stock < tonumber(ARGV[1]) then return -1 end  -- hết hàng
return redis.call('DECRBY', KEYS[1], ARGV[1])
```

- **Vì sao phải Lua:** Redis chạy lệnh tuần tự một luồng, một script Lua chạy trọn vẹn không
  bị chen ngang. `GET` rồi `DECRBY` từ Node lại là read-modify-write — chỉ đổi chỗ xảy ra bug.
- Nạp tồn kho vào Redis: lazy khi miss (`-2`) → đọc DB, `SET` bằng `NX` để hai request cùng
  nạp không ghi đè nhau (xem Câu hỏi mở #2).
- Sau khi Redis trừ thành công → ghi DB (Phase 3 ghi **đồng bộ** ngay trong request; outbox +
  async persist là Phase 4).
- **Failure mode phải xử lý tường minh:** Redis đã trừ mà ghi DB thất bại → **bù trừ ngược**
  (`INCRBY`) và log mức `error` kèm `correlationId`. Nếu cả bù trừ cũng thất bại → tồn kho
  lệch, **log rõ ràng chứ không im lặng sửa số**; reconcile job là Phase 4.

## Luồng xử lý `POST /orders`

```
1. Guard: AccessTokenGuard → có userId
2. Đọc header Idempotency-Key → thiếu thì 400 (chưa chạm DB)
3. Zod validate body (skuId, quantity) → sai thì 400 (chưa chạm DB)
4. reserve(skuId, quantity) qua INVENTORY_RESERVER
   ├─ ok: false → 404 SKU_NOT_FOUND hoặc 409 OUT_OF_STOCK
   └─ ok: true → có unitPriceVnd (snapshot)
5. Transaction (HẸP — chỉ 2 lệnh ghi, không gọi mạng bên trong):
   ├─ INSERT orders (userId, idempotencyKey, totalVnd, expiresAt = now + 15')
   │   └─ vi phạm UNIQUE(userId, idempotencyKey) → đây là lần gọi lặp:
   │       hoàn tồn kho vừa trừ, SELECT đơn cũ, trả 200 + đơn cũ
   └─ INSERT order_items (skuId, quantity, unitPriceVnd)
6. 201 { order }
```

**Thứ tự bước 4 và 5 là một đánh đổi có chủ đích, phải nói rõ:** reserve TRƯỚC rồi insert đơn
sau nghĩa là lần gọi lặp (trùng Idempotency-Key) sẽ trừ kho rồi mới phát hiện và phải **hoàn
lại**. Cách ngược lại (insert đơn trước) tránh được việc hoàn kho, nhưng với chiến lược Redis
thì reserve nằm ngoài transaction DB nên vẫn phải bù trừ ở nhánh lỗi — không có cách nào tránh
hoàn toàn. Chọn "reserve trước" để cả ba chiến lược đi cùng một luồng, dễ so sánh benchmark.
Xem Câu hỏi mở #5.

## Edge cases bắt buộc xử lý

- [ ] Thiếu header `Idempotency-Key` → `400`, chưa chạm DB
- [ ] Cùng `Idempotency-Key` gọi 2 lần → **1 đơn**, lần 2 trả `200` + đúng đơn cũ, tồn kho chỉ
      trừ **một lần**
- [ ] Hai user tình cờ dùng cùng chuỗi Idempotency-Key → 2 đơn độc lập (UNIQUE theo `userId`)
- [ ] `quantity = 0` / âm / > 5 → `400` ở Zod, chưa chạm DB
- [ ] `skuId` không tồn tại → `404`
- [ ] `is_active = false` (SKU đã ngừng bán) → `404`, không cho đặt
- [ ] `stock = 0` → `409 OUT_OF_STOCK`, **không phải 500** (trạng thái nghiệp vụ, không phải
      lỗi hệ thống — trộn hai loại làm error rate benchmark vô nghĩa)
- [ ] **200 request song song vào SKU có `stock = 100`** → đúng 100 đơn `201`, 100 lần `409`,
      `stock` cuối = 0, **không bao giờ âm**. Chạy cho **cả ba** chiến lược
- [ ] `UPDATE product_skus SET stock = -1` bằng SQL thẳng → DB từ chối (`CHECK stock >= 0`,
      lưới an toàn cuối đã có từ Phase 2)
- [ ] Client gửi kèm `price` trong body → bị Zod loại, đơn dùng giá từ DB
- [ ] Giá SKU đổi SAU khi đặt → `unitPriceVnd` trên `order_items` không đổi
- [ ] `GET /orders` của user A không thấy đơn của user B
- [ ] `GET /orders/:id` với id của user khác → `404` (không phải `403` — không tiết lộ đơn đó
      có tồn tại)
- [ ] (Redis) Redis trừ xong nhưng DB ghi lỗi → bù trừ ngược + log `error`, tồn kho không lệch
- [ ] (Redis) Key chưa nạp → nạp lazy từ DB, hai request cùng nạp không ghi đè nhau

## Test cases phải pass

| # | Test | Loại |
|---|---|---|
| 1 | Đặt hàng hợp lệ → `201`, `stock` giảm đúng `quantity`, `order_items` có 1 dòng | integration |
| 2 | Cùng `Idempotency-Key` 2 lần → 1 đơn, lần 2 trả `200` + cùng `order.id`, `stock` trừ 1 lần | integration |
| 3 | Khác `Idempotency-Key`, cùng user + SKU → 2 đơn | integration |
| 4 | Thiếu header `Idempotency-Key` → `400` | integration |
| 5 | `quantity` = 0 / -1 / 6 → `400` | unit (Zod) |
| 6 | `skuId` lạ → `404`; SKU `is_active = false` → `404` | integration |
| 7 | `stock = 0` → `409 OUT_OF_STOCK` | integration |
| 8 | ⭐ **200 request `Promise.all` vào SKU `stock = 100` → đúng 100×`201` + 100×`409`, `stock` = 0** — chạy **3 lần, mỗi lần một `INVENTORY_STRATEGY`** | integration |
| 9 | Snapshot price: đặt xong đổi `price_vnd` của SKU → `order_items.unit_price_vnd` không đổi | integration |
| 10 | Client gửi `price` trong body → bị loại, đơn dùng giá DB | integration |
| 11 | `GET /orders` chỉ trả đơn của chính user (tạo đơn bằng 2 user khác nhau) | integration |
| 12 | `GET /orders/:id` của user khác → `404` | integration |
| 13 | Pessimistic khoá thật: 2 transaction song song, cái sau **chờ** cái trước (assert bằng thứ tự `updatedAt` / không có lost update) | integration |
| 14 | Redis: sau 200 reserve song song, `GET stock:{skuId}` khớp `product_skus.stock` trong DB | integration |
| 15 | Redis bù trừ: mock DB ghi lỗi sau khi Redis trừ → Redis được `INCRBY` trả lại, có log `error` | integration |
| 16 | ⭐ **k6 1.000 VU săn 100 chiếc, chạy 3 lần cho 3 chiến lược**: ghi lại throughput, p95, error rate (tách 4xx/5xx), khẳng định oversell = 0 ở cả ba | manual (evidence) |

Test #8 là **cổng chính** của phase: chưa xanh ở cả ba chiến lược thì chưa có gì để nói.
Test #16 là **Evidence CV** theo `docs/SPEC.md`.

## Definition of Done

- [ ] Test #1–15 xanh (unit + integration qua Testcontainers), test #8 xanh với **cả ba**
      `INVENTORY_STRATEGY`
- [ ] Test #16: báo cáo k6 cho 3 chiến lược — bảng throughput / p95 / error rate (tách 4xx vs
      5xx) + kết luận **khi nào dùng cái nào**, dán vào §Trạng thái thật của spec này
- [ ] `DATABASE_POOL_MAX` được thử ở ≥2 giá trị khi benchmark pessimistic, ghi lại ảnh hưởng
      (chứng minh hiểu "pool exhaustion khác lock contention")
- [ ] `npm run check` xanh
- [ ] **ADR-003**: chốt module nào sở hữu logic trừ kho (xem Câu hỏi mở #1) — quyết định này
      ảnh hưởng ranh giới module nên bắt buộc có ADR
- [ ] `docs/architecture.md` cập nhật module `order/`
- [ ] Tâm tự trả lời 3 câu hỏi bản chất của phase

## Ngoài phạm vi (Non-goals)

- **Tự hủy đơn quá 15 phút** (BullMQ delayed job) và **trả hàng về kho** — Phase 4. Phase 3
  chỉ GHI cột `expiresAt`, không có job nào đọc nó.
- **Thanh toán / webhook** — Phase 4. Đơn dừng ở `PENDING`.
- **Outbox pattern + async persist cho chiến lược Redis** — Phase 4. Phase 3 ghi DB đồng bộ.
- **Reconcile job** cho tồn kho Redis lệch DB — Phase 4. Phase 3 chỉ log rõ khi phát hiện.
- **Giỏ hàng nhiều SKU** trong một đơn. Một đơn = một SKU. (Schema `OrderItem` đã sẵn sàng cho
  nhiều dòng, nhưng API và logic khoá chỉ làm 1 SKU — tránh bài toán deadlock thứ tự khoá khi
  chưa cần.)
- **Huỷ đơn do user bấm** — Phase 4 làm cùng lúc với auto-cancel để dùng chung đường trả kho.
- **Sự kiện sale có giờ mở/đóng** (đếm ngược, giá event riêng) — chưa có bảng Event; Phase 3
  đặt hàng trực tiếp trên SKU.
- **UI** — Phase 5.

## Câu hỏi mở cho Tâm quyết

**1. Logic trừ kho thuộc module nào — `order` hay `product`?** *(quan trọng nhất, cần ADR)*
Tồn kho là dữ liệu của `product`, nhưng trừ kho phải nằm **cùng transaction** với tạo đơn của
`order`. Ba hướng:
- (a) **Đặt cả 3 chiến lược trong `order/`**, `order` đọc/ghi `product_skus` trực tiếp qua
  repository của chính nó. *Ưu*: transaction gọn, không truyền object transaction của Prisma
  qua ranh giới module. *Nhược*: `order` chạm bảng do `product` sở hữu.
- (b) Đặt trong `product/`, export qua `INVENTORY_RESERVER`. *Ưu*: đúng chủ sở hữu dữ liệu.
  *Nhược*: để atomic, `order` phải truyền `tx` (kiểu Prisma) vào — **rò rỉ Prisma qua ranh
  giới module**, đúng thứ `docs/architecture.md` quy tắc 2 muốn tránh.
- (c) Tách module `inventory/` riêng, sở hữu cả bảng `product_skus.stock`. *Nhược*: hai module
  cùng ghi một bảng, phức tạp hơn giá trị mang lại ở quy mô này.

**Khuyến nghị: (a)**, và viết ADR-003 nói rõ đánh đổi. Lý do: atomicity của "trừ kho + tạo
đơn" là ràng buộc **cứng** (oversell = 0), còn "mỗi bảng một chủ" là nguyên tắc **mềm** — khi
hai thứ xung đột thì giữ cái cứng. Ghi rõ trong ADR rằng đây là nợ có ghi chép, sẽ phải xử lý
lại nếu sau này tách `inventory` thành service riêng.

**2. Nạp tồn kho vào Redis (chiến lược C): lazy hay warm-up tường minh?**
Khuyến nghị: **lazy khi miss** — script Lua trả `-2` nếu key chưa có, service đọc DB rồi
`SET key stock NX` (chỉ set khi chưa tồn tại, tránh hai request cùng nạp ghi đè nhau). Đơn
giản hơn một lệnh warm-up riêng, và không cần nhớ chạy trước khi mở sale. Đánh đổi: request
đầu tiên chậm hơn (thêm 1 round-trip DB).

**3. Trần `quantity` mỗi đơn?**
Khuyến nghị: **5**. Flash sale cần chống gom hàng, và đúng con số đã dùng làm ví dụ trong test
`ZodValidationPipe` từ Phase 0. Không có bảng cấu hình per-event ở phase này.

**4. Retry cho optimistic: mấy lần, backoff thế nào?**
Khuyến nghị: **3 lần**, backoff `50ms × 2^n` + jitter ±30%. Chỉ retry khi lỗi là serialization
failure / deadlock (`40001`, `40P01`); **không** retry `OUT_OF_STOCK`. Ghi `attempts` vào log
để benchmark thấy được tỷ lệ retry tăng thế nào theo tải — đó là bằng chứng cho câu "optimistic
thua khi tranh chấp gắt".

**5. Lần gọi lặp (trùng Idempotency-Key) trả `200` hay `201`?**
Khuyến nghị: **`200`** + đúng đơn cũ trong body. `201` nghĩa là "vừa tạo mới", nói sai sự thật.
Client phân biệt được "đơn của tôi đã tồn tại" mà không cần đọc body.

**6. `POST /orders` có cần rate limit riêng?**
Khuyến nghị: **không ở phase này**. Rate limit login (Phase 1) chống dò mật khẩu; còn bấm "săn
ngay" nhiều lần là hành vi bình thường của flash sale, và `Idempotency-Key` + tồn kho đã là
giới hạn tự nhiên. Thêm rate limit lúc này sẽ làm nhiễu số đo k6.

## Câu hỏi bản chất của phase

(copy từ `docs/SPEC.md`, Tâm tự trả lời sau khi implement + đo)

- Vì sao read→if→write **chắc chắn** oversell dưới tải cao?
- Isolation level mặc định của Postgres là gì, và nó cho phép anomaly nào?
- Redis chết sau khi trừ kho nhưng trước khi ghi DB thì sao?
