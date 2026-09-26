# ADR-013: Pool nhỏ (5) × max-instances nhỏ (2) trên serverless, đi qua Neon pooler

- **Ngày:** 2026-09-22
- **Trạng thái:** Đã chốt (cấu hình xong, **chưa đo trên cloud thật**). **Phần pooler đã được
  thay bởi [ADR-016](016-cloud-sql-thay-neon.md)** (2026-09-26): DB chuyển sang Cloud SQL, không
  còn pooler hay cặp endpoint pooled/direct. Phần pool 5 × max-instances 2 vẫn đúng.

## Bối cảnh

Postgres cấp **một process cho mỗi connection**, nên connection là tài nguyên đắt và có trần
cứng. Serverless thì ngược lại: sinh/diệt instance liên tục, mỗi instance muốn một pool riêng.
Trần thật là một phép nhân:

```
tổng connection = DATABASE_POOL_MAX × max-instances
```

Local đang để `DATABASE_POOL_MAX=10`. Giữ nguyên nó với `max-instances=3` là **30 connection**
vào một Neon free — vượt xa mức thoải mái, và thứ vỡ sẽ không phải "DB chậm" mà là
`too many connections`, xảy ra đúng lúc đông người nhất.

## Quyết định

**`DATABASE_POOL_MAX=5` × `--max-instances 2` = trần 10 connection.** Runtime nối qua endpoint
**`-pooler`** của Neon (PgBouncer, transaction mode); `prisma migrate deploy` nối qua endpoint
**direct**.

## Vì sao pool NHỎ, không phải pool to

Đây là chỗ ngược trực giác nhất, và dự án **đã đo** ở benchmark Phase 3 (test #16, 1.000 VU):

> **Pool 50 chậm hơn pool 10.**

Nới pool không tạo thêm năng lực xử lý — nó chỉ **chuyển chỗ xếp hàng**: từ hàng đợi trong
app (rẻ, chỉ là một Promise chờ) vào bên trong Postgres (đắt, mỗi kẻ chờ là một process thật
tranh CPU và khoá với những kẻ đang làm việc). Luật rút ra:

> **Xếp hàng bên ngoài DB, đừng dồn vào trong DB.**

Và nó gắn thẳng vào chiến lược pessimistic: **một transaction đang *chờ khoá* vẫn giữ nguyên
connection của nó.** Nên dưới tải cao, thứ cạn trước là *pool*, không phải DB — mà triệu chứng
(request treo rồi timeout) **giống hệt** lock contention. Hai nguyên nhân, một triệu chứng;
đó là lý do `DATABASE_POOL_MAX` được tách thành biến môi trường ngay từ Phase 0 chứ không
hardcode: để phân biệt được hai thứ đó bằng cách thử, không bằng cách đoán.

## Vì sao runtime đi qua pooler, migrate thì không

| | Endpoint | Vì sao |
|---|---|---|
| Runtime | `-pooler` | PgBouncer ghép nhiều connection ứng dụng vào ít connection thật — đúng thứ serverless cần |
| `migrate deploy` | **direct** | Prisma dùng **advisory lock ở mức session** để hai lần migrate không chạy chồng. Transaction pooling không giữ được session ⇒ khoá đó vô hiệu, và DDL qua pooler cũng không đáng tin |

**Transaction mode mất gì — ghi ra để sau này không vấp:** `LISTEN`/`NOTIFY` và advisory lock
mức session không dùng được. Dự án hiện **không dùng cái nào**, nên đây là ghi chú phòng xa,
không phải vấn đề đang có.

**Thứ *không* mất, và hay bị hiểu nhầm:** `SELECT ... FOR UPDATE` của chiến lược pessimistic
**vẫn đúng** qua pooler, vì nó nằm trọn trong một transaction và cả transaction đi trên cùng
một server connection. Cái nó ảnh hưởng là *sức chứa*, không phải *tính đúng đắn*.

## Hệ quả

**Được:** trần connection biết trước và nhỏ; phù hợp Neon free; đúng luật "xếp hàng ngoài DB"
đã đo được ở Phase 3.

**Mất:**

- **Trần throughput thấp.** 10 connection cho toàn hệ thống nghĩa là một đợt sale thật sẽ
  chạm trần — chấp nhận, vì đây là demo portfolio, và k6 bị cấm bắn lên cloud.
- `max-instances 2` cũng là **trần chi phí**, nên hai mục tiêu (bảo vệ DB, giữ 0đ) tình cờ
  cùng một cần gạt. Tình cờ tốt, nhưng phải biết là **hai** lý do — ai đó nới nó lên vì lý do
  chi phí sẽ vô tình phá trần connection.
- **Chưa có số đo trên cloud thật.** Con số 5 × 2 chọn theo lập luận và số đo *local*; phải
  đối chiếu bằng `pg_stat_activity` + dashboard Neon trong 48h đầu, rồi cập nhật ADR này.

## Liên quan

[spec Phase 7 §Bài toán #2](../specs/phase7-deploy-gcp.md) ·
[spec Phase 3 §Test #16](../specs/phase3-order-concurrency.md) ·
[tech-playbook §Phase 3](../tech-playbook.md) ·
[`env.schema.ts`](../../src/config/env.schema.ts)
