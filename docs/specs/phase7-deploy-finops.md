# Spec: Phase 7 — Deploy, FinOps & Đóng gói CV

- **Phase:** 7
- **Ngày:** 2026-09-21
- **Trạng thái:** **Code + cấu hình xong; chưa deploy thật** (cần tài khoản GCP của Tâm)

> Hợp đồng của phase. Quyết định *worker chạy thế nào trên Cloud Run* ở
> [ADR-012](../adr/012-worker-tren-cloud-run.md).

## Mục tiêu

Một URL public chạy được, deploy tự động khi push `main`, và **0đ**.

## Ranh giới: việc nào máy làm, việc nào Tâm làm

Đây là phase đầu tiên **không thể làm xong hoàn toàn bằng code** — nó cần tài khoản, thẻ, và
những cú bấm trong console. Ghi rõ ranh giới để không ai tưởng phase đã xong.

| Đã xong (trong repo) | Tâm phải làm (ngoài repo) |
|---|---|
| [`Dockerfile`](../../Dockerfile) multi-stage + [`.dockerignore`](../../.dockerignore) | Tạo project GCP, bật Cloud Run + Artifact Registry + Secret Manager + Cloud Scheduler |
| [`deploy.yml`](../../.github/workflows/deploy.yml): build → migrate → deploy API → deploy worker job → kiểm `/ready` | Dựng **Workload Identity Federation** + service account, đặt 4 biến `vars` trong GitHub |
| [`worker-once.ts`](../../src/worker-once.ts) — worker một lượt cho Cloud Run Job | Tạo Neon Postgres + Upstash Redis, nạp 6 secret vào Secret Manager |
| CI đã bật **integration test** với Postgres + Redis thật | Tạo Cloud Scheduler job gọi `flash-core-worker` mỗi phút |
| | **Budget alert $1 ngay ngày đầu** |

## Thiết kế — bốn quyết định đáng nói

### 1. Ảnh hai stage, chạy bằng user không phải root

Ảnh runtime **không chứa** mã nguồn TypeScript, devDependencies, hay `npm`. Bề mặt tấn công
nhỏ hơn, và cold start nhanh hơn — mà cold start chính là thứ scale-to-zero bắt người dùng đầu
tiên phải trả.

`CMD ["node", "dist/main.js"]` chứ **không** `npm start`: npm sẽ là PID 1 và **nuốt SIGTERM**,
nên phần tắt êm ba bước ở `main.ts` (Phase 6) không bao giờ chạy — và mỗi lần thay phiên bản sẽ
cắt ngang request đang xử lý. Đúng thứ Phase 6 dựng ra để tránh.

### 2. Migration chạy bằng Cloud Run Job, không phải lúc app khởi động

Hai instance khởi động cùng lúc sẽ migrate song song, và `prisma migrate deploy` không chịu
được điều đó. Chạy từ runner cũng không: runner không nằm trong VPC, mà Neon chỉ nên mở cho
Cloud Run.

Job dùng **chính ảnh vừa build** ⇒ migration chạy đúng phiên bản sắp deploy, không lệch.

### 3. Xác thực bằng Workload Identity Federation, không phải service account key

Key JSON là bí mật **dài hạn** nằm trong GitHub Secrets — rò một lần là rò mãi, và không ai
biết nó đã rò. WIF đổi lấy token sống vài phút, gắn với đúng repo này.

### 4. Worker là Job một lượt, Scheduler gọi mỗi phút

Xem [ADR-012](../adr/012-worker-tren-cloud-run.md). Tóm tắt đánh đổi: **0đ, đổi lại độ trễ tệ
nhất 1 phút thay vì ~2 giây.**

## Ràng buộc FinOps

| | Free tier | Thứ vỡ trước nếu traffic thật tăng |
|---|---|---|
| Cloud Run | 2 triệu request/tháng, scale-to-zero | CPU-second khi có traffic đều — hết free là tính tiền theo giây |
| Neon Postgres | 0,5 GB, scale-to-zero | **Dung lượng**: seed 100k dòng của Phase 2 **không được** chạy lên đây |
| Upstash Redis | 256 MB, 500k lệnh/tháng | **Số lệnh**: worker gọi mỗi phút là ~43k lệnh/tháng chỉ để polling — còn chỗ, nhưng không nhiều |
| Cloud Scheduler | 3 job/tháng | Vừa đủ 1 job. Không còn chỗ cho việc thứ hai |

**Cấm tuyệt đối:** chạy k6 hoặc `npm run seed` lên môi trường cloud. Hook `guard_cloud_cost.py`
chặn sẵn khi biến kết nối trỏ ra ngoài.

## Definition of Done

- [x] `Dockerfile` build được, ảnh runtime không chứa devDependencies, chạy bằng user `node`.
- [x] Workflow deploy: build → migrate → API → worker job → **kiểm `/ready`** (deploy hỏng thì
      job phải đỏ, không xanh giả).
- [x] `worker-once.ts` + `npm run worker:once`.
- [x] CI chạy integration test trên Postgres + Redis thật.
- [x] ADR-012 chốt cách chạy worker.
- [ ] **API live trên Cloud Run** — cần tài khoản GCP.
- [ ] **Budget alert $1** — cần console.
- [ ] Cập nhật ADR-012 bằng **số đo thật** sau lần deploy đầu (cold start, độ trễ, chi phí).
- [ ] README "đọc 3 phút hiểu toàn hệ thống" có URL live.

## Câu hỏi bản chất của Phase 7 — và đáp án

### 1. Cold start ảnh hưởng flash sale thế nào, `min-instances` giải quyết ra sao?

Scale-to-zero nghĩa là khi không có request thì **không có instance nào**. Người bấm đầu tiên
phải chờ container khởi động: kéo ảnh (đã cache), chạy Node, dựng cây DI của Nest, mở pool
Postgres. Với dự án này khoảng **1–3 giây**.

Với flash sale thì đó là ca **tệ nhất có thể**: mọi người bấm *cùng một lúc lúc 20:00*, tức là
cú bấm đầu tiên rơi đúng vào cold start, và hàng trăm request sau xếp hàng sau nó. Tệ hơn nữa,
Cloud Run sẽ dựng nhiều instance cùng lúc → **mỗi instance mở pool riêng** → số connection tới
Neon nhân lên theo số instance, và Neon free giới hạn chặt. Đây là lý do `--max-instances 3`
trong workflow, không phải để tiết kiệm mà để **bảo vệ database**.

`min-instances=1` giữ sẵn một instance thức nên request đầu không phải chờ. Đổi lại nó chạy
24/7 ⇒ **có tiền**. Dự án chọn 0đ và chấp nhận cold start, vì đây là demo portfolio chứ không
phải sale thật. Cách thực tế nếu sale thật: đặt `min-instances` lên trước giờ mở sale, hạ về 0
sau đó — trả tiền đúng khoảng thời gian cần.

### 2. Connection pooling với serverless (Neon pooler)?

Mâu thuẫn gốc: Postgres tính **một process cho mỗi connection**, nên nó đắt và có giới hạn
cứng. Serverless thì sinh/diệt instance liên tục, mỗi instance lại muốn một pool riêng.
`max-instances 3` × `DATABASE_POOL_MAX 10` = 30 connection — đã vượt mức thoải mái của Neon
free.

Neon cấp sẵn **pooler** (PgBouncer) ở một hostname riêng (`...-pooler.neon.tech`): app nối vào
pooler, pooler ghép nhiều connection ứng dụng vào ít connection thật.

**Cái bẫy phải biết:** pooler chạy chế độ *transaction pooling* — mỗi transaction có thể rơi
vào một connection backend khác nhau. Nên **prepared statement, `SET`, và session-level advisory
lock đều không dùng được**. Với dự án này, đáng chú ý nhất là chiến lược **pessimistic**:
`SELECT FOR UPDATE` vẫn đúng vì nó nằm **trong** một transaction, nhưng nó giữ connection của
pooler suốt thời gian chờ khoá — nên bài học "pool vỡ trước DB" của Phase 3 còn đúng hơn ở đây,
với một pool nhỏ hơn nhiều. Đó là một lý do nữa để mặc định deploy bằng `optimistic`.

### 3. Chi phí phát sinh đầu tiên ở đâu nếu traffic thật tăng?

Không phải Cloud Run. Theo thứ tự thực tế:

1. **Số lệnh Upstash** — 500k/tháng. Mỗi lần đặt đơn chạm Redis vài lệnh (rate limit, queue,
   và cả tồn kho nếu dùng chiến lược C), cộng ~43k lệnh/tháng chỉ để worker polling. Một đợt
   sale vài chục nghìn lượt bấm là chạm trần.
2. **Dung lượng Neon** — 0,5 GB. Không phải đơn hàng làm đầy, mà là `outbox_events` và
   `processed_events`: chúng chỉ ghi thêm, không bao giờ xoá. **Thiếu một job dọn hai bảng
   này là nợ chưa trả** — và nó sẽ lộ ra bằng hoá đơn, không phải bằng lỗi.
3. **Egress của Cloud Run** — chỉ đáng kể nếu ai đó đẩy ảnh sản phẩm qua API. Dự án chưa có.

Cloud Run tính theo CPU-second *khi đang xử lý request*, nên với scale-to-zero nó là thứ **rẻ
nhất** trong ba cái trên, đúng ngược với trực giác.
