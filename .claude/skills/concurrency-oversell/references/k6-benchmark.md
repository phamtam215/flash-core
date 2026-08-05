# Benchmark k6 — 1.000 VU săn 100 chiếc

> Đọc file này khi chạy load test hoặc viết báo cáo benchmark. Kết quả của nó là
> **evidence CV** quan trọng nhất của dự án (`docs/SPEC.md` Phase 3).

## Luật bất di bất dịch: chỉ chạy LOCAL

Chạy qua Docker Compose trên máy Tâm. **Không bắn lên Cloud Run / Neon / Upstash** — 1.000
VU sẽ đốt hết free tier trong vài phút và Neon là **hard cutoff** (chạm ngưỡng là DB treo
tới chu kỳ sau), không phải giảm tốc (`project-context.md` §4, quyết định #11).

Bonus đã ghi trong quyết định #11: số đo local còn **đáng tin hơn** vì không nhiễu network
~200ms từ VN sang us-central1.

Hook `guard_cloud_cost.py` chặn `k6 run` khi phát hiện DATABASE_URL/REDIS_URL trỏ ra cloud.
Đừng coi hook là lớp bảo vệ duy nhất — tự `echo $DATABASE_URL` kiểm tra trước.

## Chuẩn bị trước mỗi lần đo (nếu bỏ bước này thì số vô nghĩa)

1. **Reset dữ liệu về đúng trạng thái đầu:** 1 SKU hot, `stock = 100`, không còn đơn cũ.
   Ba chiến lược phải chạy trên cùng một điểm khởi đầu, nếu không thì đang so táo với cam.
2. **Warm-up:** chạy 30 giây tải nhẹ trước khi đo, để JIT của V8, connection pool và cache
   của Postgres ổn định. Không warm-up thì p95 của lần chạy đầu luôn tệ hơn và mình sẽ kết
   luận sai về chiến lược nào chạy trước.
3. **Ghi lại cấu hình môi trường** vào báo cáo: số CPU của máy, pool size của Prisma,
   `maxmemory` Redis, phiên bản Postgres. Không có phần này thì báo cáo không tái lập được.
4. **Chỉ đổi một biến giữa các lần chạy** — đúng `INVENTORY_STRATEGY`, không đổi kèm thứ khác.
5. Đóng các app nặng khác trên máy. Nghe tầm thường nhưng Chrome 40 tab làm p95 lệch thật.

## Kịch bản k6

```js
// k6/hunt.js
import http from 'k6/http';
import { check } from 'k6';
import { Counter } from 'k6/metrics';

const success = new Counter('orders_success');
const outOfStock = new Counter('orders_out_of_stock');
const serverError = new Counter('orders_5xx');

export const options = {
  scenarios: {
    // Flash sale không phải tải đều — nó là một cú đập. Dùng ramping-arrival-rate để mô
    // phỏng "mở cổng lúc 20:00": 1.000 VU đổ vào trong vài giây.
    flash: {
      executor: 'ramping-arrival-rate',
      startRate: 50,
      timeUnit: '1s',
      preAllocatedVUs: 200,
      maxVUs: 1000,
      stages: [
        { target: 1000, duration: '5s' },   // cú đập
        { target: 1000, duration: '30s' },  // giữ tải
        { target: 0, duration: '5s' },
      ],
    },
  },
  thresholds: {
    // Ngưỡng đặt để k6 tự fail khi vi phạm — quan trọng hơn việc nhìn số bằng mắt.
    'orders_5xx': ['count==0'],            // hết hàng là 409, không được là 500
    'http_req_duration{expected_response:true}': ['p(95)<1000'],
  },
};

export default function () {
  const res = http.post(`${__ENV.BASE_URL}/orders`,
    JSON.stringify({ skuId: __ENV.SKU_ID, quantity: 1 }),
    { headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${__ENV.TOKEN}`,
        // Mỗi VU/iteration một key riêng: đây là mô phỏng user khác nhau, không phải retry.
        'Idempotency-Key': `${__VU}-${__ITER}`,
      } });

  if (res.status === 201) success.add(1);
  else if (res.status === 409) outOfStock.add(1);
  else if (res.status >= 500) serverError.add(1);

  check(res, { 'không có 5xx': (r) => r.status < 500 });
}
```

**Kiểm tra sau mỗi lần chạy — phần này quan trọng hơn cả số k6:**

```sql
SELECT stock FROM sku_inventory WHERE id = '<skuId>';        -- phải = 0, không âm
SELECT count(*) FROM orders WHERE sku_id = '<skuId>';        -- phải = 100, đúng 100
```

`orders_success` từ k6 phải khớp `count(*)` từ DB. Nếu lệch, tin DB — k6 chỉ thấy response,
DB mới là sự thật.

## Đọc kết quả cho đúng

| Số | Nghĩa | Bẫy |
|---|---|---|
| **throughput (req/s)** | Bao nhiêu request xử lý xong mỗi giây | Throughput cao mà error rate cao là vô nghĩa — fail nhanh cũng là nhanh |
| **p95** | 95% request nhanh hơn mức này | Đừng dùng **trung bình**: một vài request 10s bị trung bình che mất. p95 là con số kể đúng trải nghiệm user |
| **p99** | Đuôi phân bố | Ở chiến lược B, p99 là chỗ lock contention hiện rõ nhất |
| **error rate** | Tỷ lệ lỗi | **Phân biệt 409 (hết hàng — đúng nghiệp vụ) với 500 (bug)**. Trộn hai loại này là sai lầm phổ biến nhất khi đọc báo cáo |
| **tỷ lệ retry** (A) | Số lần xung đột version | Số này tăng phi tuyến theo tranh chấp — chính là lý do optimistic thua ở tải cao |
| **lock wait** (B) | Thời gian chờ khóa | Lấy từ `pg_stat_activity` / log Postgres, không từ k6 |

**Ba kết luận sai kinh điển, tránh:**

1. *"Chiến lược C nhanh nhất nên tốt nhất."* — C nhanh vì đổi tính nhất quán lấy tốc độ.
   Kết luận đúng phải kèm cái giá: cần reconcile job, có cửa sổ lệch dữ liệu, Redis thành
   single point of failure.
2. *"B chậm vì pessimistic lock chậm."* — có thể B chậm vì **hết connection pool**, một
   nguyên nhân hoàn toàn khác. Kiểm tra `pg_stat_activity` và số connection trước khi kết luận.
3. *"Máy em đo được 3.000 req/s nên hệ thống chịu được 3.000 req/s."* — số đo trên máy
   local với Postgres cùng máy không dịch được sang Cloud Run + Neon. Nói rõ giới hạn này
   trong báo cáo; nói ra là điểm cộng, che đi là điểm trừ nếu bị hỏi.

## Báo cáo — nơi lưu và cấu trúc

Lưu vào `docs/journal/phase-3-benchmark.md` (và trích số vào ADR chọn chiến lược mặc định).

```markdown
# Benchmark 3 chiến lược chống oversell

## Môi trường
CPU / RAM / Docker version / Postgres 16 / pool size / Redis maxmemory / ngày đo

## Kịch bản
1.000 VU, ramping-arrival-rate, 1 SKU stock=100, 40s

## Kết quả
| | Optimistic | Pessimistic | Redis atomic |
|---|---|---|---|
| Throughput (req/s) | | | |
| p95 (ms) | | | |
| p99 (ms) | | | |
| 409 (hết hàng) | | | |
| 5xx | 0 | 0 | 0 |
| Tỷ lệ retry / lock wait | | | |
| **stock cuối trong DB** | 0 | 0 | 0 |
| **số đơn** | 100 | 100 | 100 |

## Kết luận
- Khi nào dùng cái nào, dựa trên số nào ở trên.
- Điều gì làm mình ngạc nhiên so với dự đoán trước khi đo. ← phần đáng giá nhất
- Giới hạn của phép đo này (local, 1 SKU, không có network latency thật).
```

Mục *"điều gì làm mình ngạc nhiên"* là mục nên viết trước tiên khi vừa xem số, lúc còn
nhớ cảm giác. Nó là nguyên liệu tốt nhất cho câu trả lời phỏng vấn, và cũng là bằng chứng
rõ nhất rằng Tâm thật sự chạy phép đo này chứ không dán bảng số vào cho đẹp.

## Ảnh/GIF demo (Definition of Done)

Deliverable cuối: **video/GIF 2 phút** — k6 đang chạy trong lúc tồn kho trên FE rơi về 0
và **dừng đúng 0**. Chuẩn bị: mở FE (polling 1–2s) cạnh terminal k6, quay màn hình cả hai.
Đây là lý do duy nhất FE tồn tại trong dự án (`project-context.md` quyết định #10) — nên
đừng bỏ qua bước quay, nó là thứ người tuyển dụng xem trước cả README.
