# Flash-Core — Lộ trình cho người mới

> **Đây không phải tài liệu để đọc. Đây là tài liệu để LÀM.**
>
> Nó không chứa kiến thức — kiến thức đã nằm ở [`tech-playbook.md`](tech-playbook.md). Cái nó
> sở hữu là **thứ tự**: học gì trước, tự tay phá cái gì để thấy, và làm sao biết mình đã hiểu
> thật hay chỉ đang gật gù.

## Bạn sẽ làm được gì sau khi xong

Không phải "hiểu về", mà là **làm được**. Sau 6 buổi (mỗi buổi 60–90 phút):

1. Dựng và chạy toàn bộ hệ thống, đặt được một đơn hàng đi hết vòng đời từ `PENDING` tới `PAID`.
2. **Tự tay tạo ra một vụ bán vượt hàng**, rồi giải thích được vì sao nó xảy ra bằng đúng cơ chế.
3. Đọc một câu SQL và nói được nó an toàn hay không dưới tải, mà không cần chạy thử.
4. **Giết một tiến trình giữa chừng** rồi chứng minh bằng số liệu là không mất và không trùng dữ liệu.
5. Từ một `correlationId`, truy toàn bộ hành trình của một request qua hai process.
6. Sửa một tính năng nhỏ theo đúng quy trình của repo: spec → test → code → tài liệu.

## Ba luật của lộ trình này

Ba luật dưới đây không phải để làm khó. Chúng là cách chống lại **ảo giác thông thạo** — cảm
giác "hiểu rồi" khi đọc một lời giải thích hay, mà thực ra chưa hiểu gì.

**1. Dự đoán TRƯỚC khi chạy.** Mỗi bài thực hành mở đầu bằng một câu hỏi. Hãy **viết câu trả
lời ra giấy** trước khi gõ lệnh. Đoán sai rồi thấy mình sai là cách học nhanh nhất mà não
người có; đọc đáp án trước thì bộ não ghi nhận "đã biết" và không ghi nhớ gì.

**2. Làm trước, đọc lý thuyết sau.** Mỗi buổi có mục *"Vì sao"* trỏ sang playbook. **Đừng mở
nó trước khi làm xong phần thực hành.** Lời giải thích chỉ bám được vào trí nhớ khi nó trả lời
một câu hỏi bạn đang thật sự thắc mắc.

**3. Tự kiểm bằng cách NHỚ LẠI, không phải đọc lại.** Cuối mỗi buổi có phần *Tự kiểm*. Gấp
tài liệu, tự nói thành lời. Đọc lại cho cảm giác quen thuộc — mà quen thuộc không phải là hiểu.

> **Nếu chỉ có 2 tiếng:** làm **Buổi 0** và **Buổi 2**. Buổi 2 là phần cốt lõi của cả dự án;
> mọi thứ còn lại là hạ tầng phục vụ nó.

> **Đi cùng tài liệu này:** [`docs/hoc/index.html`](hoc/index.html) — giáo trình 8 phase, mở
> bằng trình duyệt. Nó có **sơ đồ** (vòng đời đơn hàng, cơ chế từng phase, đường đi của một
> request) và **bộ theo dõi 113 ý** để tick khi *nói được thành lời*.
>
> Hai file chia việc rõ ràng: **file này bắt LÀM**, giáo trình kia giải thích **VÌ SAO**. Cách
> dùng tốt nhất là xen kẽ — làm xong buổi thực hành thì mở trang phase tương ứng để xem sơ đồ
> và tick những ý mình đã nói được:
>
> | Buổi ở đây | Trang giáo trình tương ứng |
> |---|---|
> | Buổi 1 | [Phase 0](hoc/phase-0.html) · [Phase 1](hoc/phase-1.html) |
> | **Buổi 2** ⭐ | [Phase 2](hoc/phase-2.html) · [Phase 3](hoc/phase-3.html) ⭐ |
> | Buổi 3 | [Phase 4](hoc/phase-4.html) ⭐ |
> | Buổi 4 | [Phase 6](hoc/phase-6.html) |
> | Buổi 5 | [Phase 5](hoc/phase-5.html) · [Phase 7](hoc/phase-7.html) |

---

## Buổi 0 — Chạy được hệ thống (30 phút)

**Mục tiêu:** kết thúc buổi này, bạn đặt được một đơn hàng qua giao diện và nhìn thấy nó trong
database.

### Chuẩn bị

```bash
git clone <repo> && cd flash-core
npm install
cp .env.example .env
```

Mở `.env`, điền ba khoá bí mật (mỗi khoá một giá trị **khác nhau**):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# chạy 3 lần, điền vào JWT_ACCESS_SECRET, JWT_REFRESH_SECRET, PAYMENT_WEBHOOK_SECRET
```

### Chạy

```bash
npm run up                    # Postgres 16 + Redis 7 trong Docker
npx prisma migrate deploy     # tạo bảng — QUÊN BƯỚC NÀY thì worker báo lỗi 42P01 mỗi giây
npm run db:generate

npm run dev                   # terminal 1 — API
npm run worker                # terminal 2 — xử lý việc nền
```

Mở **http://localhost:3000** → đăng ký → bạn đang ở màn "Sự kiện sale".

### Làm

Chưa có áo nào để bán. Tạo một cái:

```bash
# đăng nhập bằng curl để lấy cookie
J=$(mktemp); E="hoc-$(date +%s)@example.com"
curl -s -c $J -X POST localhost:3000/auth/register -H 'Content-Type: application/json' \
  -d "{\"email\":\"$E\",\"password\":\"matkhau123\"}" -o /dev/null
curl -s -c $J -b $J -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$E\",\"password\":\"matkhau123\"}" -o /dev/null

curl -s -b $J -X POST localhost:3000/products -H 'Content-Type: application/json' \
  -d "{\"name\":\"Áo học việc\",\"slug\":\"ao-hoc-viec-$(date +%s)\",\"status\":\"ACTIVE\",
       \"skus\":[{\"size\":\"M\",\"color\":\"Đen\",\"priceVnd\":199000,\"stock\":5}]}" | head -c 200
```

Quay lại trình duyệt, tải lại trang → bấm **Săn ngay**. Bạn sẽ thấy đơn `PENDING` kèm đếm ngược
15 phút, và tồn kho tụt từ 5 xuống 4.

### Tự kiểm

Không mở tài liệu, trả lời:

- Vì sao phải chạy **hai** tiến trình (`dev` và `worker`)? Gộp lại một có được không?
- Đơn vừa tạo có trạng thái gì? Ai sẽ đổi nó, và khi nào?

> **Vì sao worker tách riêng:** [ADR-005](adr/005-worker-chay-process-rieng.md) (5 dòng).

---

## Buổi 1 — Bài toán và ranh giới (60 phút)

**Mục tiêu:** nói được trong 3 câu hệ thống này giải quyết cái gì, và chỉ đúng file cần mở khi
được giao một việc bất kỳ.

### Dự đoán trước

Viết ra giấy: *một shop bán áo online bình thường và một shop chạy flash sale khác nhau ở
chỗ nào về mặt kỹ thuật?* Ghi ít nhất hai điểm.

### Đọc (20 phút, đúng thứ tự này)

1. [`README.md`](../README.md) — 3 phút, biết dự án là gì.
2. [`docs/html/index.html`](html/index.html) mở bằng trình duyệt → trang **Phase 0** rồi
   **Phase 1**. Đây là bản đọc có dẫn dắt, không phải code.
3. [`architecture.md`](architecture.md) §*Đọc theo thứ tự này* — bảng 12 dòng, mỗi dòng một file.

### Làm

Đi theo **đúng một request** từ đầu tới cuối, mở lần lượt 4 file trong bảng đó. Sau khi đi
xong, tự vẽ lại sơ đồ trên giấy — chỉ bằng trí nhớ:

```
HTTP request → ? → ? → ? → response
```

Rồi đối chiếu với [`architecture.md`](architecture.md) §*Đi theo một request*.

### Điểm cốt lõi của buổi này

Dự án là **Modular Monolith**: một process, một database, nhưng ranh giới giữa các module
được **máy ép**, không phải bằng lời dặn. Hai tầng:

| Tầng | Chặn cái gì | Lỗ hổng của nó |
|---|---|---|
| DI container của NestJS | Không `exports` thì module khác không **inject** được | Vẫn `import` thẳng file rồi tự `new` được |
| ESLint `no-restricted-imports` | Chặn `import` sâu vào trong module khác | — |

Thiếu tầng thứ hai thì ranh giới xói mòn **im lặng**: không test nào đỏ khi ai đó phá luật.

### Tự kiểm

- Module `order` cần đổi trạng thái đơn khi có tiền vào. Module `payment` được phép làm gì và
  **không** được phép làm gì?
- Vì sao dự án một người lại **không nên** làm microservices?

> **Đáp án:** [`tech-playbook.md`](tech-playbook.md) §Phase 0 → *Câu hỏi bản chất* ·
> cửa hẹp giữa hai module: [`src/modules/order/order-payments.ts`](../src/modules/order/order-payments.ts)

---

## Buổi 2 ⭐ — Tự tay gây ra một vụ bán vượt (90 phút)

> Đây là buổi quan trọng nhất. Nếu chỉ làm được một buổi, làm buổi này.

**Mục tiêu:** nhìn thấy tận mắt oversell xảy ra, giải thích được cơ chế, và chỉ ra được câu SQL
nào chữa nó.

### Dự đoán trước — bắt buộc viết ra giấy

Đoạn code sau chạy trong một API bán hàng. Tồn kho còn **1 chiếc**, hai người bấm mua **cùng
lúc**:

```ts
const sku = await db.findSku(skuId);
if (sku.stock > 0) {
  await db.updateStock(skuId, sku.stock - 1);
  await db.createOrder(...);
}
```

1. Bán ra bao nhiêu chiếc?
2. Tồn kho cuối cùng bằng bao nhiêu?
3. Database có báo lỗi gì không?

**Viết xong mới đi tiếp.**

### Thí nghiệm 1 — Lost update, bằng SQL thuần (15 phút)

Tạo file `lost-update-demo.mjs` ở thư mục gốc:

```js
import pg from 'pg';
const url = 'postgresql://flashcore:flashcore@localhost:5433/flashcore?schema=public';
const A = new pg.Client({ connectionString: url });
const B = new pg.Client({ connectionString: url });
await A.connect(); await B.connect();

await A.query('DROP TABLE IF EXISTS demo_kho');
await A.query('CREATE TABLE demo_kho (id int primary key, stock int not null)');
await A.query('INSERT INTO demo_kho VALUES (1, 1)');   // còn ĐÚNG 1 chiếc

await A.query('BEGIN'); await B.query('BEGIN');
const a = (await A.query('SELECT stock FROM demo_kho WHERE id=1')).rows[0].stock;
const b = (await B.query('SELECT stock FROM demo_kho WHERE id=1')).rows[0].stock;
console.log(`A đọc stock = ${a} → "còn hàng, bán!"`);
console.log(`B đọc stock = ${b} → "còn hàng, bán!"`);

await A.query(`UPDATE demo_kho SET stock = ${a - 1} WHERE id=1`);
await A.query('COMMIT');
await B.query(`UPDATE demo_kho SET stock = ${b - 1} WHERE id=1`);
await B.query('COMMIT');

const final = (await A.query('SELECT stock FROM demo_kho WHERE id=1')).rows[0].stock;
console.log(`\nBán 2 chiếc trong khi chỉ có 1. Tồn kho cuối = ${final} (đúng ra là -1).`);
await A.query('DROP TABLE demo_kho');
await A.end(); await B.end();
```

```bash
node lost-update-demo.mjs && rm lost-update-demo.mjs
```

**Kết quả thật:**

```
A đọc stock = 1 → "còn hàng, bán!"
B đọc stock = 1 → "còn hàng, bán!"
Bán 2 chiếc trong khi chỉ có 1. Tồn kho cuối = 0 (đúng ra là -1).
```

Đối chiếu với dự đoán của bạn. Chú ý câu trả lời số 3: **database không báo lỗi gì cả.** Không
có exception, không có cảnh báo. Tiền vẫn thu, hàng thì không có.

### Thí nghiệm 2 — Phá code thật rồi chạy test (30 phút)

Mở [`src/modules/order/order.repository.ts`](../src/modules/order/order.repository.ts), tìm
`decrementStockConditional`. Thay thân hàm bằng bản "đọc → kiểm tra → ghi":

```ts
const read = await this.prisma.$queryRaw<{ stock: number; price_vnd: number }[]>`
  SELECT stock, price_vnd FROM product_skus WHERE id = ${skuId}::uuid AND is_active = true`;
const current = read[0];
if (!current || current.stock < quantity) return null;

await this.prisma.$executeRaw`
  UPDATE product_skus SET stock = stock - ${quantity} WHERE id = ${skuId}::uuid`;
return { priceVnd: current.price_vnd };
```

Chạy đúng bài test bảo vệ tính chất này — 200 request song song vào một SKU có 100 chiếc:

```bash
npm run test:int -- --testPathPatterns=order -t "200 request song song"
```

**Kết quả thật:** test đỏ, nhưng **không đỏ ở chỗ bạn nghĩ**:

```
expect(serverErrors).toBe(0)
Expected: 0
Received: 2
```

Hai request trả về **HTTP 500**, không phải bán vượt. Vì sao? Vì migration Phase 2 có
`CHECK (stock >= 0)` ở tầng database. Lost update vẫn xảy ra — nhưng **lưới an toàn cuối cùng
đã bắt được**, và biến một vụ bán vượt im lặng thành một lỗi ồn ào.

Đó là **phòng thủ nhiều lớp**: lớp ứng dụng sai, lớp database vẫn giữ được sự thật.

Hoàn nguyên:

```bash
git checkout -- src/modules/order/order.repository.ts
```

### Thí nghiệm 3 — Cách chữa, và vì sao nó đúng (20 phút)

Đọc câu SQL thật, chỉ 4 dòng:

```sql
UPDATE product_skus
SET stock = stock - $1, version = version + 1, updated_at = now()
WHERE id = $2 AND is_active = true AND stock >= $1
RETURNING price_vnd
```

Khác biệt duy nhất so với bản hỏng: **điều kiện `stock >= $1` nằm bên trong chính câu ghi.**

Chạy lại test, lần này cả ba chiến lược:

```bash
npm run test:int -- --testPathPatterns=order -t "200 request song song"
```

Ba lần xanh: 200 request → **đúng 100 đơn**, 100 lần 409, tồn kho = 0.

### Vì sao (giờ mới đọc)

> [`tech-playbook.md`](tech-playbook.md) §Phase 3 — đọc mục *Cơ chế phải nắm* và *Câu hỏi bản
> chất của Phase 3*. Câu quan trọng nhất: khi câu `UPDATE` gặp một dòng đang bị khoá, Postgres
> **chờ, rồi đánh giá lại `WHERE` trên phiên bản mới nhất** — nên `stock >= ?` không bao giờ
> được kiểm tra trên dữ liệu cũ.

### Tự kiểm

Gấp tài liệu:

1. Vì sao `if (stock > 0) stock--` **chắc chắn** sai, không phải "hiếm khi" sai?
2. Dự án có **ba** chiến lược chống oversell. Kể tên và nói mỗi cái thắng khi nào.
3. Benchmark cho thấy `pessimistic` **nhanh nhất** — ngược với kỳ vọng thông thường. Vì sao?

> Câu 3 khó nhất và đáng nhất: đáp án ở [`tech-playbook.md`](tech-playbook.md) §Phase 3 →
> *Số thật đo được ở Phase 3*.

---

## Buổi 3 — Việc xảy ra sau khi request kết thúc (90 phút)

**Mục tiêu:** giải thích được vì sao "ghi DB rồi đẩy queue" là sai, và tự chứng minh được hệ
thống không mất/không trùng dữ liệu khi bị giết giữa chừng.

### Dự đoán trước

```ts
await db.save(order);      // ①
await queue.add(job);      // ②
```

Process bị giết đúng giữa ① và ②. Chuyện gì xảy ra? Bọc `try/catch` quanh hai dòng này có cứu
được không?

### Làm — "rút dây mạng" (40 phút)

Tắt worker (Ctrl+C ở terminal 2). Đặt 20 đơn khi **không có worker nào chạy**:

```bash
J=$(mktemp); E="ruttday-$(date +%s)@example.com"
curl -s -c $J -X POST localhost:3000/auth/register -H 'Content-Type: application/json' \
  -d "{\"email\":\"$E\",\"password\":\"matkhau123\"}" -o /dev/null
curl -s -c $J -b $J -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$E\",\"password\":\"matkhau123\"}" -o /dev/null

PID=$(curl -s -b $J -X POST localhost:3000/products -H 'Content-Type: application/json' \
  -d "{\"name\":\"Áo rút dây\",\"slug\":\"ao-rut-day-$(date +%s)\",\"status\":\"ACTIVE\",
       \"skus\":[{\"size\":\"M\",\"color\":\"Đen\",\"priceVnd\":150000,\"stock\":50}]}" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['product']['id'])")
SKU=$(curl -s -b $J localhost:3000/products/$PID/skus \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print((d.get('items') or d)[0]['id'])")

for i in $(seq 1 20); do
  curl -s -b $J -X POST localhost:3000/orders -H 'Content-Type: application/json' \
    -H "Idempotency-Key: rut-day-$(date +%s)-$i" -d "{\"skuId\":\"$SKU\",\"quantity\":1}" -o /dev/null
done
echo "SKU=$SKU"   # ← ghi lại
```

Giờ bật worker rồi **giết nó giữa chừng**:

```bash
npm run worker      # đợi ~1 giây, thấy log chạy thì Ctrl+C NGAY
npm run worker      # bật lại, để chạy ~10 giây rồi Ctrl+C
```

Đếm — thay `<SKU>` bằng mã ở trên:

```bash
docker exec -i flashcore-postgres psql -U flashcore -d flashcore -x <<SQL
SELECT
  (SELECT count(*) FROM orders o JOIN order_items i ON i.order_id=o.id
    WHERE i.sku_id='<SKU>')                                    AS so_don,
  (SELECT count(*) FROM outbox_events e JOIN order_items i ON i.order_id=e.aggregate_id
    WHERE i.sku_id='<SKU>' AND e.status='PENDING')             AS outbox_con_cho,
  (SELECT count(*) FROM processed_events p
    WHERE p.consumer='order.email.confirm'
      AND p.event_id IN (SELECT e.id::text FROM outbox_events e
                          JOIN order_items i ON i.order_id=e.aggregate_id
                         WHERE i.sku_id='<SKU>'))              AS email_da_gui;
SQL
```

**Phải ra: `20 / 0 / 20`.**

Hiểu ba con số này là hiểu cả buổi:

| Con số | Nghĩa là | Nếu sai |
|---|---|---|
| `so_don = 20` | đặt được 20 đơn | |
| `outbox_con_cho = 0` | không sự kiện nào kẹt lại | **> 0 ⇒ MẤT dữ liệu** |
| `email_da_gui = 20` | đúng một dấu cho mỗi đơn | **21 ⇒ gửi TRÙNG · 19 ⇒ MẤT** |

### Vì sao (giờ mới đọc)

> [`tech-playbook.md`](tech-playbook.md) §Phase 4 — *Cơ chế phải nắm* và *Câu hỏi bản chất của
> Phase 4*. Rồi đọc [ADR-006](adr/006-relay-giu-transaction-khi-day-queue.md).
>
> **ADR-006 là tài liệu đáng đọc nhất của cả repo.** Nó kể một lỗi thật: bản đầu tiên của code
> viết đúng pattern Outbox nhưng **sai thứ tự**, nên vẫn mất dữ liệu im lặng — và **không một
> test nào đỏ**. Đó là loại lỗi mà kinh nghiệm không tự dạy được.

### Tự kiểm

1. `at-least-once` và `exactly-once` khác nhau ở đâu? Vì sao `exactly-once` "không tồn tại"?
2. Đánh dấu đơn `PAID` và gửi email xác nhận — cùng dùng một bảng `processed_events`, nhưng
   **bảo đảm đạt được khác nhau**. Khác ở đâu, và vì sao?
3. Webhook "đã thanh toán" đến **sau** khi đơn đã tự huỷ. Ba cách xử lý sai là gì?

---

## Buổi 4 — Nhìn được vào bên trong khi nó chạy sai (60 phút)

**Mục tiêu:** từ một `correlationId`, truy được toàn bộ hành trình qua hai process.

### Dự đoán trước

Khách báo: *"tôi đặt hàng lúc 8 giờ tối, bị lỗi"*. Bạn có log JSON của cả hệ thống. Bắt đầu
từ đâu? Ước lượng mất bao lâu để tìm ra đúng chuỗi sự việc?

### Làm

Đặt một đơn với id do **bạn tự đặt**, rồi đi tìm nó:

```bash
curl -s -b $J -X POST localhost:3000/orders \
  -H 'Content-Type: application/json' \
  -H 'x-correlation-id: toi-tu-dat-id-123' \
  -H "Idempotency-Key: $(uuidgen)" \
  -d "{\"skuId\":\"$SKU\",\"quantity\":1}" -o /dev/null

# id đó đi được tới đâu?
docker exec flashcore-postgres psql -U flashcore -d flashcore -c \
  "SELECT payload->>'correlationId' FROM outbox_events ORDER BY created_at DESC LIMIT 1;"
```

Rồi nhìn **hai** terminal (`dev` và `worker`) — cùng một id xuất hiện ở cả hai, dù chúng là hai
tiến trình khác nhau và cách nhau vài giây.

Xem hệ thống tự báo cáo về chính nó:

```bash
curl -s localhost:3000/metrics | grep -E "^orders_placed_total|^outbox_pending"
curl -s localhost:3000/ready | python3 -m json.tool
```

### Thí nghiệm — giết Redis

```bash
docker stop flashcore-redis
curl -s -o /dev/null -w "ready:  %{http_code}\n" localhost:3000/ready
curl -s -o /dev/null -w "health: %{http_code}\n" localhost:3000/health
docker start flashcore-redis
```

**Phải ra `ready: 503` nhưng `health: 200`.** Hai endpoint này trả lời hai câu hỏi khác nhau,
và gộp chúng làm một là lỗi cấu hình đắt nhất khi deploy — vì `/health` fail sẽ khiến hệ thống
**restart container**, mà restart app thì không chữa được Redis.

### Vì sao (giờ mới đọc)

> [`tech-playbook.md`](tech-playbook.md) §Phase 6 · [ADR-008](adr/008-correlationid-dung-asynclocalstorage.md)

### Tự kiểm

1. `/health` và `/ready` khác nhau thế nào? Điều gì xảy ra nếu `/health` cũng kiểm database?
2. Vì sao **không** được đặt `orderId` vào nhãn của metric?
3. `orders_placed_total{result="out_of_stock"}` được đếm trong service chứ không ở interceptor.
   Vì sao interceptor không làm được việc đó?

---

## Buổi 5 — Tự đóng góp một thay đổi (90 phút)

**Mục tiêu:** đi trọn quy trình của repo, không phải viết code giỏi.

### Việc

Hiện chưa có endpoint để **user tự huỷ đơn** của mình. Nó đã được ghi là nợ trong
[`docs/specs/phase4-async-queue-payment.md`](specs/phase4-async-queue-payment.md) §Edge cases.

Làm theo đúng thứ tự này — **thứ tự mới là bài học**, không phải đoạn code:

1. **Spec trước.** Copy [`templates/feature-spec-template.md`](templates/feature-spec-template.md)
   thành `docs/specs/huy-don-chu-dong.md`. Trả lời: API ra sao, đơn ở trạng thái nào thì huỷ
   được, tồn kho xử lý thế nào, có bao nhiêu edge case?
2. **Test trước hoặc cùng lúc.** Thêm test vào `test/order.e2e-spec.ts`. Ít nhất ba ca: huỷ
   thành công; huỷ đơn đã `PAID` → phải từ chối; huỷ đơn của **người khác** → 404 chứ không
   phải 403.
3. **Rồi mới code.** Gợi ý: `cancelIfExpired` hiện đòi `expires_at <= now()`, nên không dùng
   lại thẳng được. Đây là chỗ phải tự quyết — và ghi lại quyết định.
4. **Chạy `npm run check`** cho tới khi sạch.
5. **Sửa tài liệu trong cùng commit.** Ba chỗ hay lệch: `architecture.md`, `README.md`,
   `CLAUDE.md` §Trạng thái hiện tại.

### Câu hỏi khó nhất của buổi này

Delayed job huỷ đơn quá hạn **vẫn sẽ nổ** 15 phút sau, dù user đã tự huỷ trước đó rồi. Chuyện
gì xảy ra? Tồn kho có bị trả về **hai lần** không?

> Trả lời được câu này mà không cần chạy thử, nghĩa là bạn đã hiểu Buổi 2 và Buổi 3 thật.

### Tự kiểm

- Vì sao repo bắt viết spec trước khi code?
- Vì sao huỷ đơn của người khác phải trả **404** chứ không phải **403**?

---

## Bản đồ tra cứu (dùng sau khi đã xong 6 buổi)

| Cần gì | Mở |
|---|---|
| "Cái tôi đang gặp tên là gì?" | [`glossary.md`](glossary.md) — một dòng mỗi mục |
| "Nó hoạt động thế nào, hỏng ra sao?" | [`tech-playbook.md`](tech-playbook.md) — **nguồn kiến thức duy nhất** |
| "Sửa X thì mở file nào?" | [`architecture.md`](architecture.md) |
| "Vì sao lại chọn cách này?" | [`adr/`](adr/) — 8 ADR, mỗi cái 5–10 dòng |
| "Tính năng này hứa gì?" | [`specs/`](specs/) |
| "Giờ dự án đang ở đâu?" | [`CLAUDE.md`](../CLAUDE.md) §Trạng thái hiện tại |
| Sắp phỏng vấn | [`tech-playbook.md`](tech-playbook.md) §Ôn phỏng vấn — 12 câu chốt |

## Lịch ôn (đừng bỏ — đây là phần quyết định bạn còn nhớ gì sau một tháng)

Trí nhớ rơi rất nhanh nếu chỉ học một lần. Ba lần nhớ lại, giãn cách dần, rẻ hơn nhiều so với
học lại từ đầu:

| Khi nào | Làm gì | Mất bao lâu |
|---|---|---|
| **Sau 1 ngày** | Gấp tài liệu, nói lại phần *Tự kiểm* của Buổi 2 và 3 | 10 phút |
| **Sau 1 tuần** | Đọc [`tech-playbook.md`](tech-playbook.md) §Ôn phỏng vấn — chỉ đọc câu hỏi, tự trả lời, rồi mới xem cột đáp án | 20 phút |
| **Sau 1 tháng** | Làm lại Thí nghiệm 2 của Buổi 2 (phá code → chạy test → hoàn nguyên) | 15 phút |

## Bạn đã sẵn sàng khi

Nói được thành lời, không cần mở tài liệu:

- [ ] Vì sao `if (stock > 0) stock--` chắc chắn sai — và câu SQL nào chữa nó
- [ ] Ba chiến lược chống oversell, mỗi cái thắng khi nào
- [ ] Vì sao "ghi DB rồi đẩy queue" mất dữ liệu, và Outbox sửa nó bằng cách nào
- [ ] Vì sao consumer phải idempotent, và vì sao gửi email khác đánh dấu `PAID`
- [ ] `/health` và `/ready` khác nhau ở đâu
- [ ] Từ một `correlationId`, truy hành trình một request qua hai process

Còn gạch đầu dòng nào chưa nói trôi chảy thì quay lại đúng buổi đó — **đừng đọc lại cả tài
liệu**. Đọc lại toàn bộ cho cảm giác đã hiểu, mà cảm giác đó chính là thứ lộ trình này được
thiết kế để chống lại.
