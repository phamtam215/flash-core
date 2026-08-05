# Ba chiến lược chống oversell — chi tiết implementation

> Đọc file này khi thực sự implement một trong ba chiến lược. `SKILL.md` cho bức tranh
> chung và bảng trade-off; file này cho SQL/Lua, cấu hình retry, và các cái bẫy cụ thể.

## Mục lục
- [A — Optimistic locking](#a--optimistic-locking-version-column)
- [B — Pessimistic locking](#b--pessimistic-locking-select--for-update)
- [C — Redis atomic + async persist](#c--redis-atomic--async-persist)
- [Chọn chiến lược bằng config](#chọn-chiến-lược-bằng-config)
- [Bảng so sánh để đưa vào ADR](#bảng-so-sánh-để-đưa-vào-adr)

---

## A — Optimistic locking (version column)

**Ý tưởng:** không khóa gì cả. Cho mọi request cùng chạy, nhưng lúc ghi thì kèm điều kiện
"dữ liệu vẫn đúng như lúc tôi đọc". Ai ghi sau và thấy dữ liệu đã đổi thì thua và retry.

```sql
UPDATE sku_inventory
SET    stock = stock - $qty,
       version = version + 1
WHERE  id = $skuId
  AND  version = $versionĐãĐọc
  AND  stock >= $qty;
```

Điểm quyết định: **số dòng bị ảnh hưởng**. `1` = giữ được hàng. `0` = hoặc có người ghi
trước (version đã đổi), hoặc đã hết hàng — hai trường hợp này **phải phân biệt được**, vì
một cái đáng retry còn một cái thì không:

```ts
const affected = await tx.$executeRaw`UPDATE ... `;
if (affected === 1) return true;                     // giữ được hàng

const current = await tx.sku_inventory.findUnique({ where: { id: skuId } });
if (!current || current.stock < qty) return false;    // hết hàng thật → KHÔNG retry
throw new VersionConflictError();                     // xung đột → retry
```

Nếu không phân biệt, code sẽ retry 3 lần cho một SKU đã hết hàng — tốn 3 round-trip để
trả về cùng một câu trả lời, và dưới 1.000 VU thì đó là 3.000 query rác.

**Thực ra có thể bỏ cột `version`.** Điều kiện `stock >= $qty` trong cùng câu `UPDATE` đã
đủ chống oversell, vì Postgres khóa dòng ở mức câu lệnh khi ghi. Vẫn giữ `version` trong dự
án này vì hai lý do: (1) nó là cách kinh điển để học optimistic locking và để so sánh với
pessimistic; (2) nó cần thiết khi update nhiều field phụ thuộc nhau, không chỉ trừ một số.
Ghi rõ nhận xét này vào ADR — nhận ra "cột version không bắt buộc ở đây" chính là dấu hiệu
đã hiểu cơ chế thay vì làm theo mẫu.

**Retry:**

```ts
const MAX_RETRY = 3;
for (let attempt = 0; attempt < MAX_RETRY; attempt++) {
  try { return await tryReserve(); }
  catch (e) {
    if (!(e instanceof VersionConflictError) || attempt === MAX_RETRY - 1) throw e;
    // backoff nhẹ + jitter: jitter quan trọng hơn backoff ở đây, vì không có jitter thì
    // tất cả request thua cùng lúc sẽ cùng thức dậy cùng lúc và lại đụng nhau.
    await sleep(5 * 2 ** attempt + Math.random() * 10);
  }
}
```

Đo và log **tỷ lệ retry**. Đây là con số đẹp nhất của chiến lược A trong báo cáo: nó cho
thấy tranh chấp tăng thì chi phí optimistic tăng theo phi tuyến.

**Cái bẫy:** hết retry rồi trả 500. Không đúng — hết retry vì tranh chấp là tình trạng
tạm thời, trả **409 Conflict** kèm thông điệp cho client thử lại thì hợp lý hơn.

---

## B — Pessimistic locking (`SELECT ... FOR UPDATE`)

**Ý tưởng:** khóa dòng ngay khi đọc. Ai đến sau **chờ** tại chỗ cho tới khi người trước
commit. Không ai phải retry, nhưng ai cũng phải xếp hàng.

Prisma không có API cho `FOR UPDATE` → phải `$queryRaw` **bên trong `$transaction`
interactive**. Đây đúng là bài học "khi nào ORM không đủ" (`project-context.md` #5), nên
viết comment giải thích tại chỗ.

```ts
await prisma.$transaction(async (tx) => {
  // FOR UPDATE chỉ có tác dụng khi nằm trong transaction — ngoài transaction thì khóa
  // được nhả ngay khi câu lệnh kết thúc, tức là vô nghĩa.
  const [row] = await tx.$queryRaw<{ stock: number }[]>`
    SELECT stock FROM sku_inventory WHERE id = ${skuId} FOR UPDATE
  `;
  if (!row || row.stock < qty) return false;          // hết hàng, nhả khóa khi transaction đóng
  await tx.$executeRaw`
    UPDATE sku_inventory SET stock = stock - ${qty} WHERE id = ${skuId}
  `;
  return true;
}, { timeout: 5_000, isolationLevel: 'ReadCommitted' });
```

**Ba cái bẫy phải xử lý:**

1. **Deadlock do thứ tự khóa.** Nếu một đơn giữ nhiều SKU và mỗi request khóa theo thứ tự
   khác nhau, hai transaction sẽ khóa chéo và cả hai treo tới khi Postgres tự phát hiện rồi
   kill một cái. Cách phòng: **luôn khóa theo một thứ tự xác định** — `ORDER BY id` khi lấy
   danh sách SKU cần khóa, hoặc sort mảng skuId trước khi vào transaction. Đây là câu hỏi
   bản chất #4 của dự án; nên gặp deadlock thật một lần trong test rồi sửa, thay vì phòng
   sẵn mà không hiểu.

2. **Lock timeout.** Không đặt timeout thì dưới 1.000 VU hàng đợi chờ khóa sẽ dài tới mức
   request đầu tiên hết hạn ở client mà transaction vẫn đang chờ, giữ connection vô ích.
   Đặt `lock_timeout` (Postgres) và `timeout` (Prisma), và trả 409/503 khi hết hạn.

3. **Connection pool cạn.** Mỗi transaction đang chờ khóa vẫn chiếm 1 connection. Pool 10
   connection + 50 request chờ = 40 request không lấy được connection và fail vì lý do
   *khác hẳn* nguyên nhân thật. Khi đọc kết quả benchmark, phải phân biệt "chậm vì lock
   contention" với "fail vì hết pool" — đây là chỗ dễ kết luận sai nhất của cả phase.

**`SKIP LOCKED`** là biến thể khác mục đích: không dùng cho trừ kho (bỏ qua dòng đang khóa
nghĩa là bán sai SKU), mà dùng cho **outbox worker** lấy job trong DB — nhiều worker cùng
poll một bảng, mỗi worker lấy phần chưa ai giữ. Xem skill `queue-payment-reliability`.

---

## C — Redis atomic + async persist

**Ý tưởng:** đưa tồn kho vào Redis, dùng Lua script để "kiểm tra và trừ" trong một lệnh
atomic (Redis chạy đơn luồng nên script không bị chen ngang), rồi ghi DB sau qua outbox.

```lua
-- reserve.lua — KEYS[1] = stock:<skuId>, ARGV[1] = qty
local stock = tonumber(redis.call('GET', KEYS[1]))
if stock == nil then return -1 end          -- key chưa nạp → caller phải warm-up
if stock < tonumber(ARGV[1]) then return 0 end
return redis.call('DECRBY', KEYS[1], ARGV[1])   -- >= 0: tồn kho còn lại
```

Vì sao phải là Lua chứ không phải `GET` rồi `DECRBY` từ Node: hai lệnh rời nhau lại là
read-modify-write, chỉ là chuyển sang Redis. `DECRBY` một mình cũng không đủ, vì nó trừ
xuống âm rồi mình mới biết là đã âm — lúc đó đã bán vượt.

*(`DECRBY` rồi kiểm tra kết quả âm rồi `INCRBY` bù cũng chống được oversell, nhưng có một
khoảng thời gian tồn kho hiển thị bị âm và các request khác đọc thấy số sai. Lua tránh được
khoảng đó. Đáng nêu trong ADR như lựa chọn đã cân nhắc.)*

**Ba vấn đề bắt buộc giải quyết — và đây là toàn bộ giá trị học tập của chiến lược C:**

1. **Warm-up và nguồn sự thật.** Ai nạp `stock:<skuId>` vào Redis, lúc nào? Nếu Redis mất
   dữ liệu (restart, eviction), nạp lại từ đâu để không nạp lại số đã cũ và bán lần hai?
   Quy ước rõ: DB là nguồn sự thật khi khởi động; Redis là nguồn sự thật trong lúc sale
   đang chạy; chỉ nạp lại khi sale chưa mở hoặc khi reconcile đã chạy xong.

2. **Redis trừ xong rồi process chết trước khi ghi DB.** Tồn kho thật đã giảm nhưng DB
   không có đơn nào — hàng bị "bốc hơi", không ai mua được nhưng cũng không ai có đơn.
   Đây là câu hỏi bản chất của phase. Giải pháp trong dự án: ghi bản ghi **outbox trong
   cùng transaction với đơn**, và một **reconcile job** định kỳ so `stock` Redis với
   `stock_db - số đơn đang giữ`, phát hiện lệch thì log cảnh báo + trả hàng về Redis.
   Quan trọng: **không im lặng sửa số** — mỗi lần reconcile phải để lại dấu vết, vì lệch
   tồn kho là tín hiệu có bug ở chỗ khác.

3. **Eventual consistency là trade-off có chủ đích.** Trong khoảng giữa "Redis đã trừ" và
   "DB đã có đơn", hai nguồn không khớp. Chấp nhận được cho flash sale (khách chấp nhận
   "đang xử lý"), không chấp nhận được cho kế toán. Đây là chỗ CAP theorem thôi lý thuyết
   và thành một dòng code — ghi vào ADR.

**Eviction:** đặt Redis không evict key tồn kho (`maxmemory-policy noeviction` cho DB chứa
tồn kho, hoặc tách DB riêng). Một key tồn kho bị evict giữa sale = bán vượt.

---

## Chọn chiến lược bằng config

```ts
// config schema (Zod) — fail ngay lúc khởi động nếu sai, không fail lúc có request
INVENTORY_STRATEGY: z.enum(['optimistic', 'pessimistic', 'redis']),
```

Đăng ký provider theo config, cùng token `INVENTORY_RESERVATION`. Ba implementation ở ba
file riêng, mỗi file ≤ ~120 dòng và đọc được độc lập — vì mục tiêu là Tâm mở từng file ra
giải thích được, không phải một class 400 dòng với ba nhánh `if`.

Test: chạy **cùng một bộ test** cho cả ba chiến lược (test parameterized theo strategy).
Nếu một chiến lược cần test riêng thì đó là dấu hiệu interface bị rò rỉ chi tiết
implementation.

---

## Bảng so sánh để đưa vào ADR

Điền bằng số thật từ k6, không điền bằng cảm nhận:

| | Optimistic | Pessimistic | Redis atomic |
|---|---|---|---|
| Throughput (req/s) | | | |
| p95 (ms) | | | |
| p99 (ms) | | | |
| Error rate | | | |
| Tỷ lệ retry / lock wait | | | |
| Oversell | 0 | 0 | 0 |
| Kết luận: khi nào dùng | | | |

Câu kết luận của ADR phải trả lời được: *"nếu chỉ được chọn một cho production, chọn cái
nào và với điều kiện nào thì đổi ý?"*
