---
name: db-postgres-performance
description: >
  Làm việc với Postgres 16 + Prisma ở mức hiệu năng: đọc EXPLAIN (ANALYZE, BUFFERS), chọn
  index B-tree vs GIN cho JSONB, cursor (keyset) pagination thay OFFSET, diệt N+1 query,
  migration thêm index an toàn trên bảng lớn, seed 100.000 SKU để đo trên dữ liệu thật.
  Dùng skill này khi query chậm, khi cần thêm/kiểm tra index, khi Tâm nói "EXPLAIN",
  "index", "phân trang", "pagination", "JSONB", "GIN", "N+1", "seed", "migration",
  "query chậm", "tối ưu DB", hoặc bất cứ việc gì trong Phase 2. Cũng dùng khi thiết kế
  schema Prisma cho biến thể SKU size×màu, và khi cần bằng chứng EXPLAIN trước/sau index
  cho báo cáo.
---

# Postgres + Prisma: đo trước, tối ưu sau

Dự án cố tình chọn Postgres thay MySQL (thứ Tâm đã quen) để mở rộng skill: JSONB, GIN
index, `SELECT FOR UPDATE SKIP LOCKED`, isolation level rõ ràng (`project-context.md`
quyết định #4). Nên ở phase này, mục tiêu không phải "làm query nhanh" mà là **giải thích
được vì sao nó nhanh/chậm**.

Luật số một: **không tối ưu khi chưa đo, và không đo trên 10 dòng dữ liệu.** Trên bảng nhỏ
Postgres luôn chọn Seq Scan vì nó thật sự nhanh hơn — kết luận rút ra từ bảng nhỏ gần như
luôn sai.

## Seed dữ liệu thật trước khi đo

Phase 2 yêu cầu seed **100.000 SKU**. Chỉ chạy local (Docker Compose) — Neon Free chỉ có
0.5 GB và là hard cutoff (`project-context.md` §4).

Sau khi seed, **bắt buộc**:

```sql
ANALYZE;   -- cập nhật statistics; thiếu bước này planner đoán sai và EXPLAIN vô nghĩa
```

Đây là cái bẫy phổ biến nhất: seed xong đo ngay, thấy planner chọn sai, kết luận sai về
index. Postgres chọn kế hoạch dựa trên statistics, và statistics chỉ được cập nhật khi
`ANALYZE` chạy (autovacuum có làm nhưng không ngay lập tức).

## Đọc EXPLAIN cho đúng

```sql
EXPLAIN (ANALYZE, BUFFERS) SELECT ... ;
```

Luôn dùng cả `ANALYZE` (chạy thật, cho số thật) và `BUFFERS` (cho biết đọc từ cache hay từ
đĩa — hai lần chạy liên tiếp mà lần sau nhanh hơn nhiều thì thường là cache, không phải
index).

| Đọc gì | Nghĩa |
|---|---|
| `Seq Scan` trên bảng lớn | Quét toàn bảng — thường là chỗ cần index. Trên bảng nhỏ thì bình thường |
| `Index Scan` / `Index Only Scan` | Dùng index. `Index Only Scan` là tốt nhất: lấy đủ dữ liệu từ index, không cần chạm bảng |
| `Bitmap Heap Scan` | Dùng index nhưng phải quay lại bảng lấy nhiều dòng — trung gian, thường ổn |
| `rows=1000` vs `actual rows=95000` | **Planner đoán lệch thật tế.** Đây là dấu hiệu cần `ANALYZE`, hoặc điều kiện quá phức tạp để planner ước lượng. Lệch lớn → mọi lựa chọn phía sau đều có thể sai |
| `loops=101` | Node này chạy 101 lần → **N+1** |
| `Sort` + `external merge Disk` | Sắp xếp không đủ `work_mem`, phải ghi ra đĩa |
| `Buffers: shared read=...` | Đọc từ đĩa. `hit=...` là từ cache |

**Nguyên tắc đo trước/sau:** chạy EXPLAIN, lưu output, thêm index, `ANALYZE`, chạy lại, so
sánh. Lưu **cả hai** output vào `docs/journal/phase-2-*.md` — đó là deliverable của Phase 2
(*"so sánh EXPLAIN ANALYZE trước/sau index"*) và là evidence CV.

## Index: B-tree hay GIN

| Loại truy vấn | Index |
|---|---|
| `=`, `<`, `>`, `BETWEEN`, `ORDER BY` | **B-tree** (mặc định) |
| Nhiều cột dùng chung trong một `WHERE` | **B-tree composite** — thứ tự cột quan trọng: cột dùng `=` đặt trước cột dùng khoảng/sort |
| Tìm trong **JSONB** (`@>`, `?`, `?&`) | **GIN** |
| Full-text search | **GIN** trên `tsvector` |
| Chỉ một khóa JSONB cụ thể, so sánh `=` | **B-tree trên expression** — `((attrs->>'color'))`, nhẹ hơn GIN nhiều |

GIN mạnh nhưng không miễn phí: index lớn hơn, ghi chậm hơn (mỗi `INSERT` phải cập nhật
nhiều entry). Với bảng tồn kho bị `UPDATE` liên tục trong flash sale, mỗi index thêm vào là
thêm chi phí cho đường ghi — đúng đường nóng nhất của dự án. Nêu đánh đổi này khi đề xuất index.

**Khi nào JSONB là lựa chọn tệ** (câu hỏi bản chất của Phase 2): khi dữ liệu thật ra có
cấu trúc cố định và được truy vấn/ràng buộc thường xuyên. `size` và `color` của áo thì nên
là **cột thật** với ràng buộc và index — vì tồn kho chia theo `(size, color)` là nghiệp vụ
cốt lõi, cần `NOT NULL`, cần unique, cần join nhanh. JSONB dành cho thuộc tính động thật
sự (chất liệu, họa tiết, thông số tùy mẫu) — nơi không cần ràng buộc và schema thay đổi
theo từng mẫu áo. Dùng JSONB cho `size`/`color` là mất cả kiểu dữ liệu, cả ràng buộc, cả
tốc độ, mà không đổi được gì.

## Cursor (keyset) pagination

`OFFSET 100000 LIMIT 20` buộc Postgres tạo và bỏ đi 100.000 dòng trước khi lấy 20 dòng cần
— chi phí tăng theo độ sâu trang. Tệ hơn: nếu có dòng mới chèn vào giữa lúc user lật trang,
sẽ có bản ghi bị nhảy hoặc lặp.

Keyset pagination dùng chính giá trị của dòng cuối trang trước làm mốc:

```sql
SELECT id, name, created_at FROM products
WHERE (created_at, id) < ($lastCreatedAt, $lastId)   -- so sánh tuple, xử lý đúng ca trùng created_at
ORDER BY created_at DESC, id DESC
LIMIT 20;
```

Cần index khớp đúng thứ tự sort: `(created_at DESC, id DESC)`.

Prisma tương đương:

```ts
prisma.product.findMany({
  take: 20,
  skip: 1,                       // bỏ chính bản ghi cursor
  cursor: { id: lastId },
  orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
});
```

**Cursor phải bền:** encode `(createdAt, id)` thành opaque string (base64) trả cho client,
đừng để client tự ghép. Xử lý luôn ca cursor trỏ vào bản ghi đã bị xóa — tuple comparison ở
trên vẫn hoạt động vì nó so giá trị, không cần dòng đó còn tồn tại.

Đánh đổi: keyset **không nhảy tới trang bất kỳ** (không có "trang 500"). Với danh sách sản
phẩm dạng infinite scroll thì không cần; với bảng admin cần nhảy trang thì offset vẫn hợp
lý ở độ sâu nhỏ. Nêu rõ đánh đổi này trong spec thay vì áp dụng cứng một cách.

## N+1 query

Dấu hiệu trong EXPLAIN: `loops=` lớn. Dấu hiệu trong log Prisma: cùng một câu query lặp
với `WHERE id = ...` khác nhau.

```ts
// SAI — 1 + N query
const products = await prisma.product.findMany();
for (const p of products) p.variants = await prisma.variant.findMany({ where: { productId: p.id } });

// ĐÚNG — Prisma include: 2 query (một cho products, một cho variants IN (...))
const products = await prisma.product.findMany({ include: { variants: true } });
```

Bật log query của Prisma khi phát triển để thấy số query thật:

```ts
new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
```

Lưu ý ngược lại: `include` nhiều tầng trên danh sách lớn có thể kéo về vài chục nghìn dòng
và chậm vì lượng dữ liệu, không vì số query. Đo, đừng đoán.

## Migration an toàn

- Prisma migration là file SQL có phiên bản — chạy được trên mọi môi trường. Không sửa
  migration đã apply lên môi trường khác; tạo migration mới.
- **Thêm index trên bảng lớn** dùng `CREATE INDEX CONCURRENTLY` để không khóa ghi. Prisma
  không sinh ra dạng này → tạo migration rỗng (`prisma migrate dev --create-only`) rồi tự
  viết SQL. Lưu ý `CONCURRENTLY` không chạy được trong transaction, mà Prisma bọc migration
  trong transaction → phải đặt riêng trong migration của chính nó.
- Thêm cột `NOT NULL` vào bảng lớn: thêm nullable → backfill theo lô → set `NOT NULL`. Làm
  một bước sẽ khóa bảng.
- `prisma migrate reset` **xóa toàn bộ dữ liệu** — chỉ dùng local, không bao giờ chạy khi
  `DATABASE_URL` trỏ ra Neon.

## Connection pool (nối sang Phase 6)

Mỗi transaction đang chờ khóa vẫn giữ một connection. Pool nhỏ + pessimistic locking = fail
vì hết pool, và triệu chứng trông giống hệt "DB chậm". Khi đọc benchmark Phase 3 phải phân
biệt được hai nguyên nhân này (xem `concurrency-oversell/references/k6-benchmark.md`).

Ở Cloud Run, mỗi instance có pool riêng → số instance × pool size có thể vượt giới hạn
connection của Neon. Đó là lý do dùng Neon pooler (PgBouncer). Ghi vào ADR ở Phase 6.

## Sau khi tối ưu

1. Lưu EXPLAIN trước/sau vào `docs/journal/`.
2. Nói rõ **đánh đổi** của index vừa thêm (ghi chậm hơn bao nhiêu, index chiếm bao nhiêu
   dung lượng — `pg_size_pretty(pg_relation_size('idx_name'))`).
3. Câu hỏi ngược cho Tâm — theo câu hỏi bản chất Phase 2:
   - Cursor và offset pagination khác nhau ở chỗ nào khi dữ liệu lớn?
   - GIN và B-tree — chọn cái nào cho truy vấn nào, và GIN đắt ở đâu?
   - Khi nào JSONB là lựa chọn tệ?
