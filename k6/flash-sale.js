/**
 * Benchmark test #16 — so sánh BA chiến lược chống oversell dưới tải thật.
 *
 * CHỈ CHẠY LOCAL (`project-context.md` quyết định #11): bắn 1.000 VU lên free tier sẽ đốt hết
 * quota trong vài phút, và Neon Free là hard cutoff. Hook `guard_cloud_cost.py` chặn `k6 run`
 * khi biến kết nối trỏ ra cloud.
 *
 * Cách chạy (một chiến lược một lần, phải RESTART app giữa các lần vì INVENTORY_STRATEGY đọc
 * lúc khởi động):
 *
 *   npm run up
 *   # cửa sổ 1:
 *   INVENTORY_STRATEGY=optimistic npm run dev
 *   # cửa sổ 2:
 *   node k6/seed-target.js                 # tạo user + SKU stock=100, in ra SKU_ID
 *   k6 run -e SKU_ID=<id> -e TOKEN=<access token> k6/flash-sale.js
 *
 * Lặp lại với `pessimistic` và `redis`. Ghi lại 4 số cho mỗi lần: throughput, p95,
 * tỷ lệ 201, tỷ lệ 409 — và tách 4xx khỏi 5xx trước khi kết luận bất cứ điều gì.
 */
import http from 'k6/http';
import { check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const SKU_ID = __ENV.SKU_ID;
const TOKEN = __ENV.TOKEN;
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

/**
 * Đếm RIÊNG từng loại kết quả. Đây là điểm quan trọng nhất của script này: nếu chỉ nhìn
 * `http_req_failed` thì 409 (hết hàng — hoàn toàn bình thường, chỉ có 100 chiếc mà 1.000
 * người bấm) sẽ bị tính là "lỗi", và error rate 90% làm mọi kết luận về hiệu năng thành vô
 * nghĩa. Trộn 4xx với 5xx là bẫy đọc benchmark ghi ở docs/tech-playbook.md §Phase 3.
 */
const created = new Counter('orders_created');       // 201 — bán được
const outOfStock = new Counter('orders_out_of_stock'); // 409 — hết hàng, ĐÚNG kỳ vọng
const clientErrors = new Counter('errors_4xx_other');  // 4xx khác — sai input/auth, phải = 0
const serverErrors = new Counter('errors_5xx');        // 5xx — lỗi thật, phải = 0
const orderLatency = new Trend('order_latency_ms', true);

export const options = {
  scenarios: {
    flash_sale: {
      // 1.000 VU bấm gần như cùng lúc — mô phỏng "20:00 mở sale".
      executor: 'per-vu-iterations',
      vus: 1000,
      iterations: 1,
      maxDuration: '60s',
    },
  },
  thresholds: {
    // Ràng buộc CỨNG của cả dự án: không được có lỗi hệ thống nào.
    errors_5xx: ['count==0'],
    // Bán đúng số hàng có — không hơn. Ngưỡng này là thứ chứng minh oversell = 0.
    orders_created: ['count<=100'],
  },
};

export default function () {
  const res = http.post(
    `${BASE_URL}/orders`,
    JSON.stringify({ skuId: SKU_ID, quantity: 1 }),
    {
      headers: {
        'Content-Type': 'application/json',
        // Mỗi VU một key riêng: đang đo tranh chấp tồn kho, không đo chống double-submit.
        'Idempotency-Key': `k6-${__VU}-${__ITER}-${Date.now()}`,
        Cookie: `access_token=${TOKEN}`,
      },
    },
  );

  orderLatency.add(res.timings.duration);

  if (res.status === 201) created.add(1);
  else if (res.status === 409) outOfStock.add(1);
  else if (res.status >= 500) serverErrors.add(1);
  else clientErrors.add(1);

  check(res, {
    'không có lỗi hệ thống': (r) => r.status < 500,
    'chỉ 201 hoặc 409': (r) => r.status === 201 || r.status === 409,
  });
}

/**
 * In tóm tắt đúng 4 số cần cho báo cáo. `handleSummary` chạy sau khi test xong.
 */
export function handleSummary(data) {
  const get = (name) => data.metrics[name]?.values?.count ?? 0;
  const lat = data.metrics.order_latency_ms?.values ?? {};

  const report = [
    '',
    '=== Kết quả benchmark ===',
    `Chiến lược:        ${__ENV.STRATEGY || '(nhớ ghi lại INVENTORY_STRATEGY đang chạy)'}`,
    `Pool max:          ${__ENV.POOL_MAX || '(nhớ ghi lại DATABASE_POOL_MAX)'}`,
    `201 (bán được):    ${get('orders_created')}   ← phải đúng 100`,
    `409 (hết hàng):    ${get('orders_out_of_stock')}   ← bình thường, KHÔNG phải lỗi`,
    `4xx khác:          ${get('errors_4xx_other')}   ← phải 0`,
    `5xx:               ${get('errors_5xx')}   ← phải 0`,
    `p95 (ms):          ${(lat['p(95)'] ?? 0).toFixed(1)}`,
    `throughput (rps):  ${(data.metrics.http_reqs?.values?.rate ?? 0).toFixed(1)}`,
    '',
  ].join('\n');

  return { stdout: report };
}
