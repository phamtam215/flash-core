---
name: test-contract
description: >
  Viết test cho Flash-Core theo đúng danh sách "Test cases phải pass" trong spec: chia tầng
  unit vs integration, dựng Postgres/Redis thật bằng Testcontainers, pattern test race
  condition (bắn N request song song), chống flaky test, và không rơi vào bẫy coverage.
  Dùng skill này khi cần viết/sửa test, khi Tâm nói "viết test", "test case", "integration
  test", "Testcontainers", "coverage", "test bị flaky", "test fail", "mock", hoặc khi vừa
  implement xong một tính năng và cần test theo hợp đồng trong spec. Cũng dùng khi có test
  đỏ và cần quyết định sửa code hay sửa test.
---

# Test là hợp đồng

`CLAUDE.md` §Quy trình 2: *"Test là hợp đồng. Viết test theo danh sách test case trong spec
TRƯỚC hoặc cùng lúc với implement."* Nghĩa là spec quyết định test, không phải code quyết
định test. Test viết sau khi ngắm code sẽ chỉ khẳng định lại những gì code đang làm, kể cả
khi code làm sai.

Và luật thứ hai, quan trọng hơn: **test đỏ thì sửa code, không sửa test.** Ngoại lệ duy
nhất là khi test viết sai so với spec — lúc đó dừng lại, sửa **spec** trước, rồi sửa test
theo spec, và nói cho Tâm biết spec đã đổi.

## Nối test với spec 1:1

Mỗi dòng trong mục "Test cases phải pass" của spec phải tìm được đúng một test. Đánh dấu
tham chiếu ngay trong tên hoặc comment để sau này rà được:

```ts
// spec: docs/specs/phase3-order-create.md #4 — 200 request song song vào SKU còn 100
it('bắn 200 request song song vào SKU stock=100 → đúng 100 đơn, stock=0', async () => { ... });
```

Tên test viết bằng tiếng Việt, mô tả **hành vi và con số**, không mô tả hàm được gọi.
`it('should work')` là test không có giá trị làm hợp đồng.

Khi review, `review-gate` sẽ đối chiếu đúng danh sách này — nên spec nào chưa có test thì
nói ra, đừng để trống.

## Chia tầng: cái gì unit, cái gì integration

| Loại | Dùng cho | Vì sao |
|---|---|---|
| **Unit** | Logic thuần: tính tổng đơn, state machine chuyển trạng thái, verify HMAC, validate Zod, tính backoff | Nhanh, chạy hàng trăm cái trong vài giây. Không cần DB |
| **Integration (DB/Redis thật)** | Concurrency, transaction, lock, index/query, outbox, job queue, webhook end-to-end | **Loại lỗi ở đây không hiện ra khi mock** |

Câu quyết định: *"lỗi mình đang muốn bắt có nằm trong logic của mình, hay nằm trong hành vi
của Postgres/Redis?"* Race condition, isolation level, unique constraint, `FOR UPDATE`,
`SKIP LOCKED`, Lua script — tất cả nằm ở nhóm sau. Mock Prisma để test optimistic locking là
tự bịa ra một database không có bộ lịch thực thi thật, và test sẽ xanh trong khi production
oversell.

Mock chỉ dành cho **biên ngoài hệ thống**: cổng thanh toán, SMTP, HTTP bên thứ ba. Với SMTP
thì tốt hơn là dùng fake thật (MailHog trong Docker Compose) để đếm được số mail đã gửi —
cần cho test "không gửi email trùng" của Phase 4.

## Testcontainers: Postgres + Redis thật

```ts
// test/setup-containers.ts
let pg: StartedPostgreSqlContainer;
let redis: StartedTestContainer;

beforeAll(async () => {
  pg = await new PostgreSqlContainer('postgres:16').start();     // cùng major version với production
  redis = await new GenericContainer('redis:7').withExposedPorts(6379).start();
  process.env.DATABASE_URL = pg.getConnectionUri();
  process.env.REDIS_URL = `redis://${redis.getHost()}:${redis.getMappedPort(6379)}`;
  execSync('npx prisma migrate deploy', { env: process.env });   // migrate, không db push
}, 120_000);   // pull image lần đầu chậm — timeout phải rộng

afterAll(async () => { await pg?.stop(); await redis?.stop(); });
```

Ba lưu ý làm bộ test này chạy được lâu dài:

- **Dùng đúng `postgres:16`** như production. Test trên 15 rồi deploy lên 16 là để dành lỗi
  cho môi trường thật.
- **Một container cho cả file test, không phải cho mỗi test.** Khởi động container mất
  vài giây; cô lập giữa các test làm bằng cách dọn dữ liệu, không bằng cách dựng lại container.
- **`migrate deploy`, không `db push`** — để test đi qua đúng các migration sẽ chạy trên
  production. Migration lỗi sẽ bị bắt ở đây thay vì ở Cloud Run.

**Dọn dữ liệu giữa các test** — nhanh và tin cậy hơn xóa từng bảng:

```ts
afterEach(async () => {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE orders, order_items, sku_inventory, outbox, processed_event,
     idempotency_key RESTART IDENTITY CASCADE`,
  );
  await redisClient.flushDb();
});
```

Mỗi test **tự seed dữ liệu của mình**. Test dựa vào dữ liệu do test khác để lại là nguyên
nhân số một của flaky test, và nó chỉ lộ ra khi thứ tự chạy đổi (hoặc khi chạy song song
trên CI).

## Pattern test concurrency

```ts
const KEYS = Array.from({ length: 200 }, (_, i) => `key-${i}`);   // mỗi request 1 key riêng

const results = await Promise.allSettled(
  KEYS.map((k) => request(app).post('/orders')
    .set('Idempotency-Key', k)
    .send({ skuId, quantity: 1 })),
);

const created = results.filter((r) => r.status === 'fulfilled' && r.value.status === 201);
const conflict = results.filter((r) => r.status === 'fulfilled' && r.value.status === 409);
const errors  = results.filter((r) => r.status === 'fulfilled' && r.value.status >= 500);

expect(created).toHaveLength(100);   // đúng 100 — không 99, không 101
expect(errors).toHaveLength(0);      // hết hàng phải là 409, không được là 500
expect(conflict).toHaveLength(100);

const inv = await prisma.skuInventory.findUnique({ where: { id: skuId } });
expect(inv.stock).toBe(0);           // và có CHECK (stock >= 0) ở DB làm lưới cuối
expect(await prisma.order.count({ where: { skuId } })).toBe(100);
```

Ba điểm dễ bỏ:

- **`Promise.allSettled`, không `Promise.all`** — `all` reject ngay ở lỗi đầu tiên và mình
  mất toàn bộ thông tin về 199 request còn lại.
- **Khẳng định cả bốn thứ**: số 201, số 409, số 5xx = 0, và trạng thái DB. Chỉ check "không
  quá 100 đơn" là chưa đủ — 99 đơn cũng thỏa mà đó là bug (mất một suất).
- **Chạy cùng bộ test này cho cả ba chiến lược** (parameterize theo `INVENTORY_STRATEGY`).
  Nếu một chiến lược cần test riêng thì interface đang rò rỉ chi tiết implementation.

Lưu ý về mức độ song song thật: `Promise.allSettled` trong một process Node vẫn đi qua một
event loop và một connection pool, nên nó **ít gay gắt hơn** 200 client thật. Nó đủ để bắt
lỗi logic; muốn thấy lock contention thật thì phải dùng k6 (xem skill `concurrency-oversell`).

## Chống flaky test

`docs/glossary.md` đã cảnh báo: flaky test sẽ gặp khi test concurrency. Nguyên nhân và cách
tránh:

| Nguyên nhân | Cách tránh |
|---|---|
| `await sleep(500)` để "đợi job xong" | **Poll có điều kiện** với timeout: lặp kiểm tra trạng thái tới khi đúng hoặc hết hạn. `sleep` cố định vừa chậm vừa vẫn fail trên CI yếu hơn |
| State dùng chung giữa các test | `TRUNCATE` + `flushDb` ở `afterEach`, mỗi test tự seed |
| Phụ thuộc thứ tự chạy | Không dùng biến module-level lưu id giữa các test |
| Thời gian thật (delayed job 15 phút) | Không `sleep` 15 phút. Cho phép cấu hình TTL qua env và đặt 1 giây trong test, hoặc gọi trực tiếp handler của job. Có thể dùng fake timer cho unit test, nhưng không dùng được với BullMQ delay thật |
| Random port / container | Luôn lấy port từ `getMappedPort()`, không hardcode |

Test flaky **không được để yên**. Sửa hoặc xóa. Một test lúc xanh lúc đỏ làm cả bộ test mất
giá trị vì người ta bắt đầu chạy lại cho tới khi xanh.

## Bẫy coverage

Mục tiêu là **≥70% cho module core (Order, Inventory)** — đây là ngưỡng sàn, không phải
đích. Coverage đo *dòng nào được chạy qua*, không đo *có khẳng định đúng thứ quan trọng hay
không*. Một test gọi hết mọi hàm rồi `expect(true).toBe(true)` cho 100% coverage và bắt được
0 bug.

Nên tự hỏi thay cho việc ngắm % coverage: **"nếu mình cố tình làm hỏng dòng này, có test nào
đỏ không?"** Thử thật vài lần với đoạn trừ tồn kho — đổi `>=` thành `>`, xóa điều kiện
`WHERE version = ?` — nếu bộ test vẫn xanh thì test đang không bảo vệ gì cả.

Ưu tiên độ phủ theo mức độ nguy hiểm: trừ tồn kho, idempotency, state machine của đơn,
webhook verify. Getter/DTO mapping không cần test riêng.

## Chạy test

```bash
npm test                      # unit — nhanh, chạy liên tục khi code
npm run test:int              # integration (Testcontainers) — chậm hơn, cần Docker chạy
npm test -- --coverage        # số cho báo cáo
```

Trước khi commit, `review-gate` sẽ chạy test và **báo số thật**. Test fail thì không commit
(hook `guard_commit_message.py` không chặn được việc này — Tâm và Claude phải tự giữ luật,
xem `docs/git-workflow.md` §3).
