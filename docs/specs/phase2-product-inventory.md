# Spec: Product & Inventory — CRUD mẫu áo, biến thể SKU, cursor pagination (Phase 2)

- **Phase:** 2
- **Ngày:** 2026-08-27 (draft) · 2026-08-29 (code)
- **Trạng thái:** Code xong theo spec dưới, **chưa xác nhận trên Postgres thật** — xem
  §Trạng thái thật ở cuối file

## Mục tiêu

Cho phép quản trị mẫu áo (Product) và biến thể bán được thật sự của nó (SKU: size × màu,
tồn kho riêng từng SKU), và cho client duyệt danh sách hàng chục nghìn SKU mà không chậm dần
theo độ sâu trang. Đây là nền dữ liệu Phase 3 (Order) sẽ khoá/trừ tồn kho lên trên.

Mục tiêu học: **cursor (keyset) pagination vs offset**, **GIN index cho JSONB dùng khi nào**,
**khi nào JSONB là lựa chọn tệ** (size/màu KHÔNG dùng JSONB — xem lý do ở mục Schema DB).

## API

Module đề xuất: `src/modules/product/` — gồm cả Product và Sku trong một module (Sku là con
trực tiếp của Product, tách module riêng chỉ sinh import vòng không cần thiết).

| Method | Path | Việc | Auth | Response |
|---|---|---|---|---|
| POST | `/products` | Tạo sản phẩm mới, kèm SKU ban đầu (tuỳ chọn) | `AccessTokenGuard` | `201 { product }` |
| GET | `/products` | Danh sách sản phẩm, cursor pagination | Public | `200 { items, nextCursor }` |
| GET | `/products/:id` | Chi tiết sản phẩm kèm toàn bộ SKU | Public | `200 { product, skus }` |
| PATCH | `/products/:id` | Sửa `name`/`description`/`attributes` (không sửa SKU) | `AccessTokenGuard` | `200 { product }` |
| DELETE | `/products/:id` | Ngừng bán — **soft delete** (`status = ARCHIVED`) | `AccessTokenGuard` | `204` |
| POST | `/products/:id/skus` | Thêm biến thể (size×màu) mới | `AccessTokenGuard` | `201 { sku }` |
| GET | `/products/:id/skus` | Danh sách SKU của 1 sản phẩm | Public | `200 { items }` |
| PATCH | `/products/:id/skus/:skuId` | Sửa `priceVnd`/`stock`/`isActive` | `AccessTokenGuard` | `200 { sku }` |
| DELETE | `/products/:id/skus/:skuId` | Ngừng bán 1 biến thể (`isActive = false`) | `AccessTokenGuard` | `204` |
| GET | `/skus` | Toàn bộ SKU hệ thống, cursor pagination — **API chịu tải 100k dòng** | Public | `200 { items, nextCursor }` |

Ghi chú auth: Phase 1 chưa có role/admin (đã ghi nợ ở `docs/specs/phase1-auth.md`). Tạm dùng
`AccessTokenGuard` có sẵn (bất kỳ user đăng nhập nào ghi được) — xem "Câu hỏi mở #1".

Ghi chú `Idempotency-Key` (CLAUDE.md): luật này áp cho **API ghi liên quan đơn hàng**. CRUD
Product/SKU là thao tác quản trị catalog, tần suất thấp, không đơn hàng → **không** bắt buộc
header này ở Phase 2. Chống double-submit dựa vào `UNIQUE(productId, size, color)` — xem Edge
case.

**Request schema (Zod):**

```ts
const skuInput = z.object({
  size: z.enum(['S', 'M', 'L', 'XL', 'XXL']),
  color: z.string().trim().min(1).max(50),
  priceVnd: z.number().int().positive(),
  stock: z.number().int().nonnegative(),
});

const createProduct = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/).optional(), // thiếu → tự sinh từ name
  description: z.string().max(2000).optional(),
  attributes: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).optional(),
  skus: z.array(skuInput).max(50).optional(),
});

const updateProduct = createProduct
  .pick({ name: true, description: true, attributes: true })
  .partial();

const updateSku = z.object({
  priceVnd: z.number().int().positive().optional(),
  stock: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

const listQuery = z.object({
  cursor: z.string().optional(),
  limit: z.number().int().min(1).max(100).default(20),
});
```

## Schema DB

```prisma
enum ProductStatus {
  DRAFT
  ACTIVE
  ARCHIVED
}

enum SkuSize {
  S
  M
  L
  XL
  XXL
}

/// Mẫu áo. KHÔNG có giá, KHÔNG có tồn kho — hai thứ đó thuộc về SKU, không thuộc Product.
model Product {
  id          String        @id @default(uuid()) @db.Uuid
  name        String
  slug        String        @unique
  description String?
  status      ProductStatus @default(DRAFT)

  /// Thuộc tính MỞ, không cần lọc chính xác cao tần và khác nhau tuỳ mẫu: chất liệu,
  /// hoạ tiết, xuất xứ, hướng dẫn giặt là... Size/màu KHÔNG nằm ở đây, xem ProductSku —
  /// đó là bộ dữ liệu có tập giá trị đóng, cần validate và join/filter thường xuyên, JSONB
  /// làm mất cả hai khả năng đó (không CHECK được enum, không index rẻ bằng B-tree).
  attributes  Json?
  createdAt   DateTime      @default(now()) @map("created_at")
  updatedAt   DateTime      @updatedAt @map("updated_at")

  skus ProductSku[]

  // GIN cho query dạng attributes @> '{"material":"cotton"}'. Prisma 7: xác nhận lại cú
  // pháp @@index(type: Gin) lúc code — nếu chưa hỗ trợ thẳng thì CREATE INDEX ... USING GIN
  // bằng raw SQL trong migration (cùng cách CHECK constraint bên dưới đang làm).
  @@index([attributes], type: Gin)
  @@map("products")
}

/// Biến thể bán được thật sự: một tổ hợp size × màu của một Product. Tồn kho gắn Ở ĐÂY,
/// không phải ở Product — "sản phẩm còn hàng" là suy ra từ "còn SKU nào của nó stock > 0".
model ProductSku {
  id        String   @id @default(uuid()) @db.Uuid
  productId String   @map("product_id") @db.Uuid
  size      SkuSize
  color     String
  skuCode   String   @unique @map("sku_code") // mã đọc được cho vận hành, vd AOTHUN-DEN-M
  priceVnd  Int      @map("price_vnd")        // VND, Int — không Float cho tiền
  stock     Int
  isActive  Boolean  @default(true) @map("is_active")
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")

  product Product @relation(fields: [productId], references: [id], onDelete: Cascade)

  // Một product không có 2 SKU trùng size+màu — lưới chặn double-submit ở tầng DB.
  @@unique([productId, size, color])
  // Phục vụ keyset pagination của GET /skus — xem mục "Cursor pagination".
  @@index([createdAt, id])
  @@index([productId])
  @@map("product_skus")
}
```

Migration cần thêm 2 `CHECK` bằng raw SQL (Prisma không có API cho check constraint, giống
cách `RefreshToken`/`User` đã ghi chú trong `schema.prisma` hiện tại):

```sql
ALTER TABLE product_skus ADD CONSTRAINT stock_non_negative CHECK (stock >= 0);
ALTER TABLE product_skus ADD CONSTRAINT price_positive CHECK (price_vnd > 0);
```

Đây là **lưới an toàn cuối** — Phase 2 chưa có cơ chế chống race condition (đó là Phase 3),
nên CHECK là thứ duy nhất đảm bảo `stock` không bao giờ xuống âm trong DB dù tầng ứng dụng
có bug.

## Cursor pagination — vì sao không offset

`GET /skus` phải chạy ổn định trên 100.000 dòng. Offset (`LIMIT/OFFSET`) buộc Postgres **tạo
và bỏ đi** toàn bộ dòng đứng trước offset mỗi lần gọi — trang càng sâu càng chậm tuyến tính.
Trang gần cuối (`OFFSET 80000`) chậm hơn hẳn trang đầu dù cùng `LIMIT 20`.

Keyset (cursor) pagination dùng giá trị của dòng cuối trang trước làm mốc `WHERE`, tận dụng
index để **nhảy thẳng** tới vị trí, không đếm số dòng đã bỏ qua — chi phí gần như hằng số bất
kể trang thứ mấy.

Cột mốc: `(created_at, id)` — không dùng `id` (UUID) một mình vì UUID v4 không mang nghĩa thời
gian, không dùng `created_at` một mình vì nhiều SKU seed cùng lúc có thể trùng timestamp đến
mili-giây (`created_at` không unique) → cần `id` làm tie-breaker để đảm bảo thứ tự tổng và
không bỏ sót/trùng dòng.

```sql
-- Trang đầu
SELECT * FROM product_skus
ORDER BY created_at DESC, id DESC
LIMIT 20;

-- Trang kế tiếp, cursor = (created_at, id) của dòng cuối trang trước
SELECT * FROM product_skus
WHERE (created_at, id) < ($1, $2)
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

`cursor` trả cho client là base64 của `"<createdAtISO>_<id>"` — chuỗi mờ (opaque), client
không tự ráp được. Cursor không hợp lệ (decode lỗi, sai định dạng) → `400 INVALID_CURSOR`,
không phải `500`.

Lợi ích phụ: keyset không bị lệch khi có insert/delete xen giữa hai lần gọi (offset thì có —
dòng bị chèn trước offset làm cả trang bị dịch, có thể thấy trùng hoặc mất một dòng).

## Kế hoạch seed 100.000 SKU

- Script: `prisma/seed/seed-skus.ts`, chạy bằng lệnh mới `npm run db:seed` (thêm vào
  `package.json` lúc code).
- Cấu trúc: **10.000 Product × 10 SKU** (5 size × 2 màu cố định) = đúng 100.000 dòng
  `product_skus`. Đủ lớn để thấy khác biệt Seq Scan/GIN có ý nghĩa, đủ nhỏ để chạy vài giây
  trên máy dev.
- Insert theo batch (`createMany`, ~2.000 dòng/lần trong vòng lặp), không một câu `INSERT`
  khổng lồ, không N+1 (không insert từng dòng một).
- Dữ liệu sinh **xác định** (deterministic: `product-${i}`, mã màu/size lặp theo mảng cố
  định) — không thêm dependency mới (vd `faker`) để tránh việc phải xin thêm gói ngoài
  phạm vi lượt này.
- **Chỉ chạy local.** `guard_cloud_cost.py` (đã có từ Phase 0) tự chặn lệnh seed khi biến kết
  nối trỏ ra cloud — không cần thêm code chặn riêng trong script.
- Sau seed: bắt buộc chạy `ANALYZE product_skus;` — thiếu bước này planner dùng thống kê cũ,
  mọi kết luận `EXPLAIN` sau đó vô nghĩa (đã ghi ở `tech-playbook.md` §Phase 2).

## Luồng xử lý

**Tạo sản phẩm (`POST /products`):** validate Zod → nếu thiếu `slug` thì sinh từ `name`
(kebab-case) → trong một transaction: `INSERT products`, rồi nếu có `skus` kèm theo thì
`createMany` toàn bộ SKU (transaction đảm bảo product và lô SKU đầu tiên cùng tồn tại hoặc
cùng không). Slug trùng → 409.

**Thêm SKU (`POST /products/:id/skus`):** kiểm tra `productId` tồn tại (404 nếu không) →
`INSERT`. Trùng `(productId, size, color)` → DB ném lỗi unique constraint → map sang `409`.

**Sửa SKU (`PATCH .../skus/:skuId`):** `UPDATE` trực tiếp các field có mặt trong body. Không
có logic khoá/kiểm tra tồn kho đang bị giữ (đó là Phase 3) — Phase 2 chấp nhận **last write
wins** khi hai request PATCH cùng lúc, xem Edge case.

**Xoá (soft delete):** `DELETE /products/:id` → `UPDATE status = 'ARCHIVED'`, không xoá dòng,
không đụng tới các `ProductSku` con. `DELETE .../skus/:skuId` → `UPDATE is_active = false`.
Lý do không hard-delete: Phase 3 (Order) sẽ tạo khoá ngoại tới `ProductSku` — xoá thật sẽ làm
hỏng dữ liệu lịch sử đơn hàng sau này.

**Danh sách (`GET /products`, `GET /skus`):** parse `cursor`/`limit` → truy vấn keyset như
mục trên → cắt đúng `limit` dòng, dòng thứ `limit+1` (nếu có) chỉ dùng để tính `nextCursor`,
không trả về. `GET /products` mặc định lọc `status != 'ARCHIVED'`.

**Chi tiết kèm SKU (`GET /products/:id`):** 1 query lấy Product + 1 query
`WHERE product_id = $1` lấy toàn bộ SKU (Prisma `include`) — **không** query SKU theo từng
dòng Product (N+1).

## Edge cases bắt buộc xử lý

- [ ] `POST /products` với `slug` đã tồn tại → `409`, không tạo dòng nào
- [ ] `POST /products/:id/skus` với `(size, color)` đã tồn tại cho đúng `productId` đó → `409`
      (double-submit / bấm 2 lần) — đây là cơ chế thay `Idempotency-Key` cho catalog write
- [ ] `POST /products/:id/skus` với `productId` không tồn tại → `404`
- [ ] `PATCH .../skus/:skuId` với `stock: -5` → `400` ở tầng Zod, **không** chạm DB
- [ ] Bỏ qua tầng service, `UPDATE product_skus SET stock = -1` bằng SQL thẳng → DB từ chối vì
      `CHECK (stock >= 0)` — lưới an toàn cuối, test bằng `$queryRaw` trực tiếp
- [ ] `GET /products?cursor=<chuỗi-rác-không-decode-được>` → `400 INVALID_CURSOR`, không `500`
- [ ] `GET /skus?limit=200` (vượt max 100) → `400`, không tự động clamp âm thầm
- [ ] Trang 1 và trang 2 của cùng một lượt duyệt (dùng `nextCursor` của trang 1) **không**
      trùng dòng, **không** thiếu dòng, kể cả khi có SKU mới được insert giữa hai lần gọi
- [ ] `DELETE /products/:id` (soft delete) → `GET /products` mặc định không còn thấy sản
      phẩm này, nhưng `GET /products/:id` vẫn trả về được (dữ liệu không mất)
- [ ] 2 request `PATCH .../skus/:skuId` set `stock` khác nhau, gửi gần như đồng thời → cả hai
      đều `200`, kết quả cuối là "ai ghi sau thắng" (lost update **được chấp nhận** ở Phase
      2 — ghi rõ trong response/log rằng đây là hành vi tạm thời, Phase 3 sẽ thay bằng
      optimistic/pessimistic/Redis lock)
- [ ] `GET /products/:id` của sản phẩm có 50 SKU → đúng **2 câu query** tới DB (1 product +
      1 SKU), không phải 51

## Test cases phải pass

| # | Test | Loại |
|---|---|---|
| 1 | Tạo sản phẩm hợp lệ, không kèm SKU → `201`, DB có Product, `slug` tự sinh nếu thiếu | integration |
| 2 | Tạo sản phẩm với `slug` trùng → `409` | integration |
| 3 | Tạo sản phẩm kèm 10 SKU ban đầu (5 size × 2 màu) → `201`, DB có đúng 10 dòng `product_skus` | integration |
| 4 | Thêm SKU trùng `(size, color)` cho cùng product → `409` | integration |
| 5 | Thêm SKU cho `productId` không tồn tại → `404` | integration |
| 6 | `PATCH` SKU với `stock: -5` → `400`, DB không đổi | unit (Zod) |
| 7 | `UPDATE ... SET stock = -1` bằng `$queryRaw` thẳng → Postgres từ chối, đúng tên constraint `stock_non_negative` | integration |
| 8 | Seed 50 Product, `GET /products?limit=20` → 20 item + `nextCursor`; gọi tiếp với `nextCursor` → 20 item kế tiếp, hợp với trang 1 ra đúng 40 item không trùng | integration |
| 9 | `GET /products?cursor=abc-khong-decode-duoc` → `400 INVALID_CURSOR` | integration |
| 10 | `GET /skus?limit=200` → `400` | unit (Zod) |
| 11 | `GET /products/:id` của product có 50 SKU → đếm số query Prisma thực thi = 2 | integration |
| 12 | `DELETE /products/:id` → `status = ARCHIVED`; `GET /products` không còn thấy nó, `GET /products/:id` vẫn `200` | integration |
| 13 | 2 request `PATCH` stock gần như đồng thời (`Promise.all`) vào cùng SKU → cả hai `200`, giá trị cuối khớp với request nào ghi sau (assert bằng thời điểm `updatedAt`) | integration |
| 14 | `EXPLAIN (ANALYZE, BUFFERS)` trên 100k dòng `product_skus`: `OFFSET 80000 LIMIT 20` so với keyset `WHERE (created_at, id) < (...) LIMIT 20` — ghi lại plan + buffers của cả hai, khẳng định keyset không tăng theo độ sâu trang | manual (evidence, không phải Jest) |
| 15 | `EXPLAIN (ANALYZE, BUFFERS)` query `attributes @> '{"material":"cotton"}'` trên bảng `products` **trước** khi có GIN index (kỳ vọng Seq Scan) và **sau** khi `CREATE INDEX CONCURRENTLY ... USING GIN` + `ANALYZE` (kỳ vọng đổi sang Bitmap Heap Scan dùng GIN, hoặc — nếu planner vẫn chọn Seq Scan vì bảng còn nhỏ — ghi rõ lý do, đúng bài học "đo trên dữ liệu thật" ở `tech-playbook.md`) | manual (evidence) |

Test 14 và 15 là **deliverable của phase này** theo `docs/SPEC.md` — không phải Jest test,
nhưng là điều kiện đóng phase: kết quả `EXPLAIN` dán vào phần cập nhật của spec này (mục
"Trạng thái thật" sẽ thêm khi implement, theo đúng khuôn `phase1-auth.md` đã làm).

## Definition of Done

- [ ] Test #1–13 xanh (unit + integration qua Testcontainers)
- [ ] Test #14: bằng chứng `EXPLAIN (ANALYZE, BUFFERS)` offset sâu (80.000) vs keyset trên
      100.000 dòng `product_skus`, dán plan thật vào spec
- [ ] Test #15: bằng chứng `EXPLAIN (ANALYZE, BUFFERS)` trước/sau khi thêm GIN index trên
      `products.attributes`, dán plan thật vào spec, kèm 1 câu kết luận (dùng index hay
      không, vì sao)
- [ ] `npm run check` xanh (lint + typecheck + test)
- [ ] `docs/architecture.md` cập nhật mục module `product/` (theo đúng luật "tài liệu đúng ở
      mỗi commit")

## Ngoài phạm vi (Non-goals)

- Đơn hàng, giỏ hàng, thanh toán, giữ chỗ 15 phút — thuộc Phase 3–4, **không làm ở đây**
- Chống oversell thật sự (optimistic/pessimistic/Redis atomic) — Phase 3. Phase 2 chỉ có
  `CHECK (stock >= 0)` làm lưới an toàn cuối, chấp nhận lost update ở tầng ứng dụng
- Role/permission (admin) thật sự (RBAC) — Phase 1 chưa làm, Phase 2 tạm dùng
  `AccessTokenGuard`, xem Câu hỏi mở #1
- Ảnh sản phẩm / upload file
- Full-text search (`pg_trgm`, `tsvector`, tìm theo tên gần đúng) — GIN ở đây chỉ phục vụ
  containment `@>` chính xác trên JSONB, không phải tìm mờ
- Giá khuyến mãi riêng theo sự kiện flash sale (giá event khác giá SKU gốc) — cần bảng
  Event/Order, thuộc Phase 3
- Đa tiền tệ — chỉ VND

## Câu hỏi mở cho Tâm quyết

> **Đã code theo ĐÚNG cả 5 khuyến nghị dưới đây** (Tâm nói "bắt đầu code đi" mà không sửa gì —
> hiểu là chấp nhận khuyến nghị mặc định). Nếu muốn đổi ý sau khi đọc code thật, đây là 5 chỗ
> cần sửa: `product.module.ts` (câu 1), `product.errors.ts`/soft-delete trong
> `product.repository.ts` (câu 2), `schema.prisma` model `ProductSku` (câu 3), `seed-skus.ts`
> (câu 4), `product.dto.ts` (câu 5).

**1. API ghi Product/SKU dùng auth nào, khi Phase 1 chưa có role?**
Khuyến nghị: dùng `AccessTokenGuard` có sẵn (bất kỳ user đăng nhập nào ghi được) — chi phí
gần 0 vì guard đã tồn tại, và có ít nhất dấu vết "ai sửa" trong log thay vì để public hoàn
toàn. Ghi rõ đây là nợ kỹ thuật (RBAC thật) chuyển tiếp, không phải giải pháp cuối.

**2. Xoá Product/SKU: soft delete hay hard delete?**
Khuyến nghị: **soft delete** (`status`/`isActive`), như đã viết trong Schema DB — vì Phase 3
Order sẽ tạo khoá ngoại tới `ProductSku`, hard delete bây giờ sẽ phải đổi lại migration ở
Phase 3 và có rủi ro mất dữ liệu nếu lỡ xoá nhầm sản phẩm đã từng bán.

**3. Có thêm cột `version` (Int) vào `ProductSku` ngay từ Phase 2 để Phase 3 dùng optimistic
locking không, hay để Phase 3 tự thêm bằng migration riêng?**
Khuyến nghị: **không thêm bây giờ**. Cột chưa dùng tới trong Phase 2 là suy đoán trước nhu
cầu; Phase 3 thêm bằng một migration nhỏ riêng, giữ spec này đúng phạm vi của nó.

**4. Tỉ lệ seed: 10.000 Product × 10 SKU (5 size × 2 màu) = 100.000, hay tỉ lệ khác?**
Khuyến nghị: giữ 10.000×10 như đã chọn trong mục "Kế hoạch seed" — đủ lớn để `EXPLAIN` cho
kết quả có ý nghĩa, đủ nhỏ để chạy vài giây trên máy dev, và lưới 5 size × 2 màu giống thật
với áo thun.

**5. `attributes` JSONB có ràng buộc shape tối thiểu ở tầng Zod không, hay hoàn toàn tự do?**
Khuyến nghị: Zod validate shape tối thiểu (`record(string, string|number|boolean)`, không cho
nested object/array) — đủ để tránh rác hoàn toàn tự do, nhưng vẫn giữ đúng bản chất JSONB
(không ép enum cứng, DB không CHECK được nội dung).

## Câu hỏi bản chất của phase

(copy từ `docs/SPEC.md`, Tâm tự trả lời sau khi implement + đo)

- Cursor vs offset pagination khi dữ liệu lớn?
- GIN vs B-tree?
- Khi nào JSONB là lựa chọn tệ?

## Kiến thức cần có trước khi code

Đọc [`tech-playbook.md` §Phase 2 — Database & hiệu năng](../tech-playbook.md) — B-tree vs
GIN, vì sao phải `ANALYZE` sau seed, cách đọc `rows` ước lượng vs `actual rows` trong
`EXPLAIN`, và tình huống thật "8ms máy dev → 900ms 100k dòng, thủ phạm là statistics cũ chứ
không phải thiếu index". Khoảng 10 phút.

## Trạng thái thật (2026-08-29)

**Đã xong, tự kiểm chứng được (không cần Docker):**
- Code đủ 8 file module `product/` + cập nhật `schema.prisma`, `app.module.ts`
- `npm run lint` và `npm run typecheck` sạch (kể cả `prisma/seed/seed-skus.ts` — đã thêm
  `prisma/**/*.ts` vào `tsconfig.json` include và glob lint/format trong `package.json`)
- **43/43 unit test xanh** (21 cũ + 22 mới: `product.dto.spec.ts`, `product.cursor.spec.ts`,
  `product.slug.spec.ts` — validate Zod, round-trip cursor, sinh slug/sku_code bỏ dấu)
- Seed script chạy thử với DB giả: sinh đúng 10.000 product × 10 SKU trong RAM, dừng đúng ở
  bước kết nối (không có Postgres thật trong môi trường code) — logic sinh dữ liệu không lỗi,
  chưa xác nhận INSERT thật

**CHƯA xác nhận — cần Docker, việc của Tâm:**
- [ ] `npm run test:int` — test #1–5, #7–9, #11–13 (integration, viết trong
      `test/product.e2e-spec.ts`) **chưa chạy lần nào**
- [ ] Migration `20260829120000_add_product_sku/migration.sql` **viết tay** (không phải
      `prisma migrate dev` sinh ra — môi trường code không có Postgres sống để chạy lệnh đó).
      Đã validate bằng `prisma validate`/`generate` (schema hợp lệ), nhưng SQL thật đúng hay
      sai chỉ lộ ra khi `npm run test:int` chạy `prisma migrate deploy` lần đầu — nếu sai,
      Postgres sẽ báo lỗi rõ ràng ngay ở bước đó, không âm thầm
- [ ] `npm run seed` — chưa chạy với Postgres thật
- [ ] Test #14, #15 (bằng chứng `EXPLAIN (ANALYZE, BUFFERS)`) — **manual, việc của Tâm**, dán
      kết quả thật vào đây sau khi seed xong

**Một chỗ spec không nói rõ, tôi tự quyết khi code:** cách sinh `sku_code` (client không gửi,
spec chỉ ghi ví dụ `"AOTHUN-DEN-M"`). Đã viết `product.slug.ts#generateSkuCode`: bỏ dấu tiếng
Việt, viết hoa, ghép `${productCode}-${colorCode}-${size}`, trần 16/12 ký tự. Trùng mã (hiếm)
rơi vào lỗi `UNIQUE` thật của cột, trả 500 kèm `correlationId` — chưa map thành lỗi nghiệp vụ
riêng vì không có trong 14 test case bắt buộc.

**Việc kế tiếp:** `npm run up` → `npm run test:int` → nếu xanh, `npm run seed` → chạy
`EXPLAIN (ANALYZE, BUFFERS)` cho 2 câu ở test #14/#15 → dán kết quả vào đây → Definition of
Done mới coi là đủ.
