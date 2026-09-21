# ADR-010: Phân trang bằng keyset cursor, không dùng OFFSET

- **Ngày:** 2026-08-20 (ghi lại 2026-09-21 — quyết định đã áp dụng từ Phase 2)
- **Trạng thái:** Đã chốt

## Bối cảnh

`GET /products` và `GET /orders` đều trả danh sách dài. Cách quen thuộc là
`LIMIT ? OFFSET ?`. Bài toán của dự án là flash sale — danh sách được lật trong lúc dữ liệu
**đang đổi liên tục** (tồn kho giảm, đơn mới sinh ra), và catalog có 100.000 dòng SKU.

## Quyết định

Dùng **keyset (cursor) pagination**: nhớ *vị trí cuối cùng đã đọc* thay vì *đã bỏ qua bao
nhiêu dòng*.

```sql
-- thay vì: ORDER BY created_at DESC LIMIT 20 OFFSET 400
WHERE (created_at, id) < ($cursor_created_at, $cursor_id)
ORDER BY created_at DESC, id DESC LIMIT 21   -- lấy dư 1 để biết còn trang sau
```

Cursor là `(createdAt, id)` mã hoá base64. Cặp hai cột chứ không chỉ `createdAt`: hai dòng
tạo cùng một mili giây thì `createdAt` không đủ để xác định vị trí, và trang sau sẽ **lặp
hoặc nhảy cóc** một dòng.

## Vì sao không dùng OFFSET

**1. Sai kết quả khi dữ liệu đổi giữa hai trang** — đây mới là lý do chính, không phải tốc độ.
Đọc trang 1 (dòng 1–20), trong lúc đó có 3 đơn mới chèn lên đầu, rồi đọc trang 2 với
`OFFSET 20`: ba dòng vừa nằm ở cuối trang 1 bị đẩy xuống và **hiện lại** ở trang 2. Người dùng
thấy đơn lặp, hoặc tệ hơn là đơn bị bỏ sót. Keyset không có lỗi này vì nó neo vào *dòng cụ
thể*, không phải *số thứ tự*.

**2. Chậm dần tuyến tính theo độ sâu.** `OFFSET 400` buộc Postgres đọc và **vứt bỏ** 400 dòng
trước khi trả 20 dòng cần. Càng lật sâu càng chậm — đúng vào lúc người dùng kiên nhẫn nhất.

**Đo thật, test #14 Phase 2** trên 100.000 dòng, cùng một vị trí: **keyset nhanh hơn ~50 lần**
(`EXPLAIN (ANALYZE, BUFFERS)` dán trong
[spec Phase 2](../specs/phase2-product-inventory.md)).

## Hệ quả

**Được:** kết quả ổn định khi dữ liệu đổi; thời gian trả lời **không phụ thuộc độ sâu**; đi
thẳng theo index `(created_at, id)`.

**Mất:**

- **Không nhảy tới trang N** được. Chấp nhận: không màn nào của dự án cần "tới trang 7", và
  danh sách flash sale vốn là cuộn vô hạn.
- **Không có tổng số trang.** Cần thì phải `COUNT(*)` riêng — mà `COUNT(*)` trên 100k dòng
  cũng không rẻ.
- Cursor phải mã hoá/giải mã, và **cursor rác phải trả `400`, không phải `500`** — đã khoá
  bằng test.

**Một bài học đi kèm, ngược trực giác, cũng từ test #14/#15:** không phải index nào cũng
thắng. Trên 10.000 dòng, **Seq Scan nhanh hơn GIN index** cho truy vấn JSONB — planner đọc
tuần tự rẻ hơn là đi qua index rồi quay lại heap. Số đo quyết định, không phải trực giác.

**Nơi code:** [`src/common/pagination/cursor.ts`](../../src/common/pagination/cursor.ts) —
Phase 3 chuyển từ `modules/product/` ra `common/` khi module thứ hai cần dùng, đúng luật
"chỉ thứ ≥2 module dùng mới vào `common/`".
