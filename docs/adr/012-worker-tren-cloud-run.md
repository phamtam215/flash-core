# ADR-012: Worker trên Cloud Run chạy như Job một lượt, do Scheduler gọi

- **Ngày:** 2026-09-21
- **Trạng thái:** Đã chốt (code xong, **chưa deploy thật**)

## Bối cảnh

[ADR-005](005-worker-chay-process-rieng.md) chốt worker chạy **process riêng** để demo được
"rút dây mạng": giết worker giữa chừng mà API vẫn sống. Ghi chú trong
[`src/worker.ts`](../../src/worker.ts) để lại đúng một câu hỏi mở: *"Cách chạy trên Cloud Run —
nơi free tier khó nuôi một process nền luôn thức — để Phase 7 quyết bằng ADR."* Đây là ADR đó.

Vấn đề cụ thể: **Cloud Run scale về 0** khi không có request. Worker của dự án là vòng lặp
chờ-việc dài hạn (BullMQ `Worker` + hai lịch lặp: outbox relay 2 giây, sweeper 60 giây). Không
có instance nào thức thì không có gì kích hoạt hai lịch đó.

Ràng buộc cứng: **0đ** (`docs/SPEC.md` §5 — free tier, budget alert $1).

## Quyết định

**Cloud Run Job chạy một lượt rồi thoát, Cloud Scheduler gọi mỗi 5 phút.**

Điểm vào mới [`src/worker-once.ts`](../../src/worker-once.ts) (`npm run worker:once`):

1. Gọi thẳng `outbox.relay` và `order.expire.sweep` — không qua lịch lặp của BullMQ (lịch đó
   cần một tiến trình thức để kích hoạt, đúng thứ ta không có).
2. Rút job đang chờ trong queue ra xử lý tới khi hết, hoặc hết **ngân sách 10 giây**.
3. Thoát mã khác 0 nếu có job lỗi, để bảng điều khiển của Cloud Run không xanh giả.

`worker.ts` (dài hạn) **giữ nguyên** và vẫn là cách chạy ở local + là thứ demo "rút dây mạng".

## Vì sao không chọn cách khác

| Cách | Vì sao loại |
|---|---|
| **`min-instances=1`** cho một service worker | Giải pháp đúng đắn nhất về kỹ thuật, và là thứ mình sẽ chọn nếu có ngân sách. Nhưng một instance thức 24/7 vượt free tier ⇒ vi phạm ràng buộc 0đ. Loại vì **tiền**, không phải vì kỹ thuật — ghi rõ để sau này ai có ngân sách thì đảo lại ngay |
| **Chạy worker chung process với API** (cờ env) | Rẻ nhất, nhưng Cloud Run scale về 0 ⇒ job chỉ được xử lý *trong lúc đang có request*. Một đơn đặt lúc 20:00 rồi không ai truy cập nữa thì email không bao giờ gửi. Hỏng đúng lời hứa của Phase 4 |
| **Cloud Tasks đẩy thẳng vào một endpoint HTTP** | Hợp Cloud Run hơn cả, và không cần Redis giữ queue. Nhưng đổi cả cơ chế queue của dự án — BullMQ là thứ đang được học, và Phase 4 dựa vào DLQ/backoff của nó. Đổi ở bước deploy là để đuôi vẫy chó |
| **Một VM nhỏ chạy worker** (e2-micro free tier) | Free tier có thật, nhưng thêm một loại hạ tầng thứ hai phải vá và theo dõi, cho một dự án mà mục tiêu là học Cloud Run |

## Hệ quả

**Được:** 0đ; không đổi kiến trúc queue; `worker.ts` và `worker-once.ts` dùng **chung**
`JobProcessor`, nên không có nhánh logic nào bị bỏ quên khi test.

**Mất — và đây là thứ phải nói với người phỏng vấn, không giấu:**

- **Độ trễ tệ nhất là 5 phút** thay vì ~2 giây. Với email xác nhận thì chấp nhận được (đơn
  giữ chỗ 15 phút nên sweeper 5 phút vẫn đúng hợp đồng); với một hệ thống thật cần phản hồi
  tức thì thì không.
- Cloud Scheduler free tier là **3 job/tháng** — vừa đủ, không còn chỗ cho việc thứ hai.
- Lượt chạy có thể **chồng nhau** nếu một lượt quá 5 phút. An toàn vì **mọi thứ nó gọi đều
  idempotent**: outbox dùng `FOR UPDATE SKIP LOCKED`, consumer dùng `processed_events`, huỷ
  đơn dùng `UPDATE ... WHERE status='PENDING'`. Đây không phải may mắn — đó đúng là ba cơ chế
  Phase 4 dựng lên, và ADR này là lần đầu chúng được dựa vào ngoài kịch bản gốc.
- **Chưa deploy thật.** ADR chốt hướng và code đã có; số đo thật (cold start, độ trễ, chi phí)
  phải cập nhật vào đây sau lần deploy đầu tiên.

## Hai lỗi của chính ADR này, sửa sau khi review

### Lỗi 2 — bản đầu bỏ qua vòng đời của BullMQ

`worker-once.ts` bản đầu tự `getJobs()` rồi gọi thẳng `processor.process()`. Hệ quả: job ném
lỗi **không** vào trạng thái `failed`, `attemptsMade` không tăng, `backoff` không chạy, DLQ
không bao giờ có gì — và vòng lặp lấy lại đúng job đó ngay lập tức, quay vòng tới hết ngân
sách. Tức là **bỏ retry, backoff và DLQ mà cả Phase 4 dựng lên**, để đổi lấy… không gì cả.

Đã sửa: vẫn dùng `Worker` của BullMQ, chỉ thêm điểm dừng — sự kiện `drained` (hàng rỗng) hoặc
hết trần thời gian, cái nào tới trước, rồi `worker.close()` (chờ job đang chạy xong).

Kèm một lỗi nhỏ hơn nhưng hỏng nặng hơn: bản đầu gọi `queue.connection.quit()` rồi mới
`app.close()`, mà `QueueService.onModuleDestroy` **cũng** quit đúng client đó. Lần quit thứ
hai reject (`Connection is closed.`), lời từ chối thoát ra ngoài nên `process.exit()` không
bao giờ chạy — Cloud Run đánh dấu **mọi** lần chạy là thất bại.

### Lỗi 1 — nhịp cron

Bản đầu chốt nhịp **1 phút**, chọn theo cảm giác "càng nhanh càng tốt". Phép tính hạn mức ở
[spec Phase 7](../specs/phase7-deploy-gcp.md) §Bài toán #1 và #4 bác bỏ nó:

| Nhịp | vCPU-giây/tháng | Hạn mức free | Neon |
|---|---|---|---|
| 1 phút | 1.440 lượt/ngày × ~10s ≈ **432.000** | 180.000 ⇒ **vượt 2,4 lần** | thức gần như liên tục ⇒ đốt hết 100 compute-giờ |
| **5 phút** ⭐ | 288 lượt/ngày × ~10s ≈ **86.400** | 180.000 ⇒ vừa khít | thức ~24 giờ/tháng |

**Bài học, đáng hơn cả con số:** một quyết định vận hành phải đối chiếu với **hạn mức tính
theo đơn vị thật** (vCPU-giây, compute-giờ, số lệnh), không theo trực giác về độ trễ. Ở đây
"nhanh gấp 5" đổi lấy "vượt hạn mức 2,4 lần" — tức là hỏng hẳn, không phải đắt hơn một chút.

**Và bài học chung của cả hai lỗi:** ADR này được viết *trước* khi có ai chạy thử. Cả hai chỗ
sai đều lộ ra ở bước review chứ không phải ở bước code — nên phần "Hệ quả" của một ADR chưa
triển khai phải được đọc như **giả thuyết**, không phải kết luận.

## Liên quan

[ADR-005](005-worker-chay-process-rieng.md) · [spec Phase 7](../specs/phase7-deploy-gcp.md) ·
[`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml)
