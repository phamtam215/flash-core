---
name: concurrency-oversell
description: >
  Trái tim của dự án — chống oversell khi hàng nghìn user cùng săn 1 SKU: ba chiến lược
  Optimistic / Pessimistic / Redis atomic bật tắt bằng config, Idempotency-Key, snapshot
  price, cách CHỨNG MINH oversell = 0 bằng test song song trên DB thật, và benchmark k6 để
  so sánh ba chiến lược. Dùng skill này khi làm bất cứ thứ gì liên quan tới trừ tồn kho,
  đặt hàng, giữ chỗ, "săn ngay", race condition, lost update, lock (optimistic /
  pessimistic / SELECT FOR UPDATE / SKIP LOCKED), deadlock, isolation level, Redis DECR /
  Lua script, retry khi xung đột, hoặc bất cứ việc gì trong Phase 3. Cũng dùng khi Tâm hỏi
  vì sao code hiện tại có thể bán vượt tồn kho, hoặc khi cần đo/so sánh throughput và p95
  của ba chiến lược.
---

# Chống oversell — Phase 3 ⭐

Đây là phần chứa gần toàn bộ giá trị học tập và là điểm mạnh nhất trên CV
(`project-context.md` quyết định #6): làm một cách chỉ là "đã làm"; **so sánh ba cách kèm
số đo mới là "đã hiểu"**. Vì vậy mọi việc ở đây kết thúc bằng hai thứ: một bằng chứng
`oversell = 0` và một con số.

## Luật nền: điều kiện phải nằm ở nơi giữ sự thật

```ts
// SAI — và sai một cách chắc chắn, không phải "hiếm khi"
const sku = await repo.findById(skuId);
if (sku.stock > 0) {
  await repo.update(skuId, { stock: sku.stock - 1 });
}
```

Điều kiện `stock > 0` được kiểm tra trong RAM của Node, tại một thời điểm đã cũ. Nơi duy
nhất biết sự thật là dòng dữ liệu trong Postgres (hoặc key trong Redis). Giữa lúc đọc và
lúc ghi, N request khác đã chen vào — tên chuẩn của lỗi này là **read-modify-write /
lost update** (`docs/glossary.md` Phase 3).

Cách chữa duy nhất đúng, dù chọn chiến lược nào: **đẩy điều kiện xuống cùng nơi và cùng
lúc với hành động ghi**, để việc "kiểm tra và trừ" là một thao tác không thể bị chen ngang.

Ba chiến lược dưới đây là ba cách khác nhau để đạt đúng điều đó, với ba đánh đổi khác nhau.

## Ba chiến lược, một interface

Bật tắt bằng config `INVENTORY_STRATEGY=optimistic|pessimistic|redis` (validate bằng Zod
lúc khởi động). Dùng strategy pattern: cùng một interface, ba implementation, đổi bằng env
không sửa code gọi — đó là điều kiện để benchmark so sánh được công bằng.

```ts
export interface InventoryReservation {
  /** Trả về true nếu giữ được hàng. Không throw khi hết hàng — hết hàng là kết quả
   *  nghiệp vụ hợp lệ, không phải lỗi hệ thống. */
  reserve(skuId: string, qty: number): Promise<boolean>;
}
```

| | A — Optimistic | B — Pessimistic | C — Redis atomic |
|---|---|---|---|
| Cơ chế | `UPDATE ... WHERE version = ? AND stock >= qty`, kiểm tra số dòng bị ảnh hưởng | `SELECT ... FOR UPDATE` trong transaction, ai đến sau phải chờ | Lua script `DECRBY` có kiểm tra trong Redis, ghi DB sau bằng outbox |
| Thắng khi | Tranh chấp thấp/vừa | Tranh chấp gắt, cần công bằng và ổn định | Tải rất cao, cần throughput tối đa |
| Thua khi | Tranh chấp gắt → retry nhiều, phí round-trip | Lock contention → throughput sụt, nguy cơ deadlock | Redis chết giữa đường → tồn kho lệch DB, cần reconcile |
| Nhất quán | Mạnh (trong DB) | Mạnh (trong DB) | **Eventual** — chấp nhận lệch trong khoảng ngắn |

Chi tiết SQL/Lua từng chiến lược, thứ tự khóa để tránh deadlock, cấu hình retry và cơ chế
reconcile cho chiến lược C: đọc **`references/strategies.md`**.

Không tự chọn chiến lược mặc định cho production — đó là ADR Tâm phải chốt **sau khi có
số benchmark** (`project-context.md` §6).

## Idempotency-Key — đặt đúng chỗ mới có tác dụng

User bấm "Săn ngay" hai lần, hoặc mạng lag khiến client retry: không được ra hai đơn.

Thứ tự bắt buộc trong luồng:

1. Nhận `Idempotency-Key` từ header.
2. **`INSERT` key vào bảng `idempotency_key` với unique constraint `(userId, key)`** —
   dựa vào DB để phân định người thắng. Nếu `INSERT` va unique violation → đây là request
   lặp, đọc và trả về kết quả đã lưu của lần đầu.
3. Chỉ sau khi thắng ở bước 2 mới được trừ kho và tạo đơn.
4. Lưu response vào chính bản ghi idempotency để lần gọi lặp sau trả đúng cái cũ.

Sai phổ biến: `SELECT` xem key tồn tại chưa → thấy chưa có → `INSERT`. Đó lại chính là
read-modify-write, chỉ đổi bảng. Và sai thứ hai: check idempotency **sau** khi đã trừ kho
— lúc đó side effect đã xảy ra rồi.

Câu hỏi bản chất của phase hỏi đúng chỗ này: *"Idempotency-Key phải được kiểm tra ở đâu
trong luồng, vì sao đúng chỗ đó?"*.

## Transaction boundary trong luồng đặt hàng

Trong transaction: trừ kho + tạo đơn + tạo bản ghi outbox. Ngoài transaction: gửi email,
gọi cổng thanh toán, mọi HTTP. Lý do: transaction giữ khóa; gọi mạng trong transaction
biến độ trễ mạng thành thời gian giữ khóa, và một cổng thanh toán chậm 2 giây sẽ khóa cả
tồn kho 2 giây.

Với chiến lược C, "trừ kho" xảy ra ở Redis **ngoài** transaction DB — đây chính là chỗ
sinh ra trade-off nhất quán, phải hiểu và giải thích được, không che đi.

## Chứng minh oversell = 0 (không phải tin, mà là đo)

Integration test trên **Postgres + Redis thật** (Testcontainers) — race condition không
hiện ra khi mock, vì mock không có bộ lịch thực thi thật.

Khung test bắt buộc cho mỗi chiến lược:

```ts
// Seed: 1 SKU, stock = 100. Bắn 200 request song song.
const results = await Promise.allSettled(
  Array.from({ length: 200 }, (_, i) => createOrder({ skuId, idempotencyKey: `k-${i}` })),
);

// Khẳng định — cả bốn, không chỉ cái đầu:
// 1. Đúng 100 request thành công (không 99, không 101).
// 2. stock trong DB = 0.
// 3. Không có giá trị stock âm ở bất kỳ thời điểm nào (check constraint stock >= 0 ở DB).
// 4. Số đơn PENDING trong DB = 100.
```

Thêm ba test nữa hay bị bỏ:

- **Idempotency:** 50 request **cùng một** `Idempotency-Key` → đúng 1 đơn, kho trừ 1.
- **Hết hàng đúng lúc:** stock = 1, bắn 50 request → 1 thành công, 49 nhận 409, không ai
  nhận 500.
- **Chết giữa đường (chiến lược C):** trừ Redis xong rồi làm process fail trước khi persist
  → chứng minh reconcile phát hiện và tồn kho cuối cùng vẫn đúng.

Đặt `CHECK (stock >= 0)` ở DB làm lưới an toàn cuối. Nó không thay thế chiến lược, nhưng
nếu nó bị vi phạm thì test đỏ ngay thay vì bán vượt âm thầm.

Chống flaky: đừng dùng `sleep` cố định để "đợi cho xong"; truncate/reset DB giữa các test;
mỗi test tự seed dữ liệu của mình. Xem skill `test-contract`.

## Benchmark ba chiến lược

Evidence CV của Phase 3: báo cáo k6 **1.000 VU săn 100 chiếc**, so sánh throughput, p95,
error rate của A/B/C, và `oversell = 0` ở cả ba.

Chạy **CHỈ trên local qua Docker Compose** — bắn 1.000 VU lên free tier sẽ đốt hết quota
trong vài phút (`project-context.md` quyết định #11). Hook `guard_cloud_cost.py` sẽ chặn
nếu DATABASE_URL trỏ ra cloud, nhưng đừng dựa vào hook: tự kiểm tra trước.

Kịch bản k6, cách đọc kết quả, và mẫu bảng so sánh cho báo cáo: đọc
**`references/k6-benchmark.md`**.

## Sau khi implement

Bắt buộc, theo `CLAUDE.md` và `project-context.md` §5:

1. Tóm tắt luồng chạy 5–10 câu tiếng Việt.
2. Chạy `review-gate`.
3. Đặt câu hỏi ngược cho Tâm — ưu tiên đúng bốn câu hỏi bản chất của Phase 3:
   - Vì sao `read→if→write` **chắc chắn** oversell dưới tải cao (không phải "có thể")?
   - Isolation level mặc định của Postgres là gì, nó cho phép anomaly nào?
   - Redis chết sau khi trừ kho nhưng trước khi ghi DB thì hệ thống ở trạng thái gì, ai sửa?
   - Deadlock ở chiến lược B xảy ra thế nào và giảm khả năng gặp bằng cách nào?
