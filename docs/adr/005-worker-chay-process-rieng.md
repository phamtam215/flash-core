# ADR-005: Worker chạy process riêng, không chung với API

- **Ngày:** 2026-09-05
- **Trạng thái:** Đã chốt (giới hạn tới hết Phase 6)

## Bối cảnh

Phase 4 thêm bốn loại job nền (relay outbox, gửi email, huỷ đơn quá hạn, xử lý webhook).
BullMQ cho phép chạy `Worker` ngay trong process của API — một lệnh `npm run dev` là xong.

Nhưng deliverable chốt phase là demo **"rút dây mạng"**: giết worker giữa lúc xử lý, chứng
minh không mất message và không gửi email trùng. Chạy chung process thì giết worker là giết
luôn API, và không còn gì để quan sát.

## Quyết định

Hai entrypoint trong cùng một repo: `src/main.ts` (API) và `src/worker.ts` (worker), với hai
cây DI song song — `AppModule` và `WorkerModule`. Chạy bằng `npm run dev` và `npm run worker`.

`WorkerModule` không nạp controller nào và dùng `NestFactory.createApplicationContext` (không
mở cổng HTTP).

`npm run worker` = `nest start --entryFile worker`, **không** phải `ts-node src/worker.ts`:
Prisma Client sinh import kèm đuôi `.js` trong khi file thật là `.ts`, và `ts-node` không có
gì ánh xạ lại nên vỡ ngay khi nạp client. `nest start` biên dịch bằng đúng tsc như API rồi
chạy `dist/worker.js` — worker dùng chung một đường build đã biết là đúng.

## Các lựa chọn đã cân nhắc

- **Hai process** ✅ — *ưu*: demo được deliverable; scale worker độc lập với API; job nặng
  không ăn CPU của request đang chờ; tắt êm (`worker.close()`) tách bạch với tắt API.
  *nhược*: local phải chạy hai lệnh; hai chỗ phải cùng có biến môi trường.
- **Một process, worker chạy kèm API** — *ưu*: một lệnh, một container, hợp free tier Cloud
  Run. *nhược*: không demo được; một job ngốn CPU làm chậm mọi request; và nguy hiểm hơn cả:
  autoscaling theo lưu lượng HTTP sẽ nhân số worker lên theo số instance mà không ai chủ ý.
- **Cờ `WORKER_INLINE=true`** để chọn lúc chạy — *ưu*: linh hoạt. *nhược*: thêm một nhánh
  hành vi phải test hai lần, trong khi bài toán thật (deploy ra sao) vẫn chưa được trả lời.

## Hệ quả & trade-off chấp nhận

**Được:** giết/khởi động lại worker mà API không hề gián đoạn — điều kiện để test #18 tồn tại;
`QUEUE_CONCURRENCY` trở thành một núm vặn thật.

**Mất:** local nhiều thao tác hơn một chút. Và **câu hỏi deploy vẫn còn nợ**: Cloud Run free
tier khó nuôi một process nền luôn thức (scale-to-zero là điều kiện để giữ 0đ).

**Xem lại ở Phase 7** — ba hướng đã thấy: (1) worker chạy như Cloud Run Job kích bằng Cloud
Scheduler thay vì service luôn sống; (2) `min-instances=1` cho service worker, mất free tier;
(3) quay lại chạy kèm API và chấp nhận mất tính tách bạch. Quyết định đó cần số liệu chi phí
thật, nên không chốt trước ở đây.
