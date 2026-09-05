# Từ điển nhận diện — Flash-Core

> **Cách dùng:** đây KHÔNG phải tài liệu để học thuộc. Mục đích duy nhất: cho Tâm
> *cái tên* của các bài toán, để khi va vào thì nhận ra ngay "à, đây là X" và biết
> phải đào ở đâu. Mỗi mục = tên + vấn đề nó chỉ + dấu hiệu gặp phải.
> Đọc 20 phút, không cần hiểu sâu. Quay lại đọc kỹ mục nào khi phase đó tới.
>
> **Cần hiểu sâu hơn cái tên?** → [`tech-playbook.md`](tech-playbook.md) có cơ chế, bug hay
> gặp, tình huống thật, đáp án 3 câu hỏi bản chất của từng phase, và mục
> [§Ôn phỏng vấn — 12 câu chốt](tech-playbook.md#ôn-phỏng-vấn--12-câu-chốt).
> File này chỉ cho *cái tên*; **mọi lời giải thích dài hơn một dòng đều nằm ở file kia.**

---

## Phase 0 — Kiến trúc

| Tên | Vấn đề nó chỉ | Dấu hiệu gặp |
|---|---|---|
| **Monolith / Modular Monolith / Microservices** | Ba mức tách hệ thống. Modular Monolith = 1 process nhưng module có ranh giới rõ | Khi quyết định cấu trúc thư mục ban đầu |
| **Coupling / Cohesion** | Module dính nhau quá (coupling cao) hay gom đúng việc (cohesion cao) | Khi module A phải import service của module B |
| **Dependency Injection (DI)** | Không tự tạo dependency bên trong, để bên ngoài đưa vào → dễ test | Cốt lõi của NestJS, gặp ngay từ dòng đầu |
| **12-Factor App** | Bộ 12 nguyên tắc app chạy tốt trên cloud (config qua env, log ra stdout...) | Khi cấu hình env và deploy |

---

## Phase 1 — Auth & Security

| Tên | Vấn đề nó chỉ | Dấu hiệu gặp |
|---|---|---|
| **Hashing vs Encryption** | Hash một chiều (mật khẩu), encrypt hai chiều. Nhầm hai cái này là lỗi nghiêm trọng | Khi lưu mật khẩu |
| **Salt / Pepper** | Chuỗi random thêm vào trước khi hash để 2 người cùng mật khẩu ra hash khác nhau | Argon2 tự làm, nhưng phải biết vì sao |
| **Rainbow table / Brute-force** | Hai kiểu tấn công mật khẩu mà hash chậm (Argon2) chống lại | Vì sao không dùng MD5/SHA256 cho mật khẩu |
| **Stateless vs Stateful session** | JWT không cần lưu server (stateless) nhưng khó thu hồi; session lưu server thì ngược lại | Khi chọn cơ chế đăng nhập |
| **Access Token / Refresh Token** | Token ngắn hạn để dùng, token dài hạn để lấy token mới | Thiết kế luồng auth |
| **Refresh Token Rotation / Reuse Detection** | Mỗi lần refresh cấp token mới, token cũ dùng lại = dấu hiệu bị đánh cắp | Phase 1 deliverable |
| **XSS / CSRF** | XSS: chèn JS độc đọc token. CSRF: lừa browser gửi request kèm cookie | Vì sao HttpOnly Cookie + SameSite |
| **Rate limiting / Throttling** | Giới hạn số request để chống dò mật khẩu và spam | API login, API săn hàng |
| **Principle of Least Privilege** | Cấp quyền tối thiểu đủ dùng | Khi làm role admin/user, khi cấp IAM trên GCP |

---

## Phase 2 — Database

| Tên | Vấn đề nó chỉ | Dấu hiệu gặp |
|---|---|---|
| **Index (B-tree / GIN)** | Cấu trúc tra cứu nhanh. B-tree cho so sánh, GIN cho JSONB/full-text | Query chậm khi seed 100k SKU |
| **Query plan / EXPLAIN ANALYZE** | Xem DB thực sự chạy query thế nào (có dùng index không) | Phase 2 deliverable |
| **Sequential scan vs Index scan** | Quét toàn bảng vs dùng index — đọc được trong query plan | Khi EXPLAIN ra "Seq Scan" trên bảng lớn |
| **N+1 query** | Lấy 1 danh sách rồi query thêm cho từng phần tử → 101 query thay vì 2 | Khi list sản phẩm kèm biến thể |
| **Cursor vs Offset pagination** | OFFSET lớn thì DB phải đếm bỏ hết các dòng trước → chậm dần | Trang cuối của danh sách 100k SKU |
| **Normalization vs Denormalization** | Tách bảng cho gọn vs gộp lại cho nhanh | Khi thiết kế bảng biến thể size×màu |
| **JSONB** | Lưu dữ liệu linh hoạt trong Postgres, đánh index được nhưng không có ràng buộc kiểu | Thuộc tính động của áo |
| **Migration** | Thay đổi schema có phiên bản, chạy được trên mọi môi trường | Mỗi lần sửa Prisma schema |
| **Connection pool** | Tái dùng kết nối DB vì mở mới rất đắt | Khi deploy serverless (Phase 7) |

---

## Phase 3 — Concurrency ⭐ (mục quan trọng nhất)

| Tên | Vấn đề nó chỉ | Dấu hiệu gặp |
|---|---|---|
| **Race condition** | Hai luồng chạy song song, kết quả sai tùy thứ tự thực thi | Bản chất của oversell |
| **Critical section** | Đoạn code chỉ được 1 luồng vào một lúc | Đoạn trừ tồn kho |
| **Read-modify-write (lost update)** | Đọc → kiểm tra → ghi: giữa các bước có kẻ khác chen vào | Vì sao `if (stock > 0) stock--` luôn sai dưới tải |
| **ACID** | Atomicity, Consistency, Isolation, Durability — 4 bảo đảm của transaction | Nền tảng mọi thứ ở phase này |
| **Isolation level** | Read Committed / Repeatable Read / Serializable — mức cách ly giữa transaction | Postgres mặc định Read Committed, cho phép anomaly gì? |
| **Dirty read / Non-repeatable read / Phantom read** | Ba loại "đọc sai" mà isolation level cao hơn ngăn được | Khi đọc tồn kho trong transaction |
| **Optimistic locking** | Không khóa, dùng cột `version`, ai ghi sau thì fail và retry | Chiến lược A |
| **Pessimistic locking (`SELECT FOR UPDATE`)** | Khóa dòng ngay khi đọc, ai đến sau phải chờ | Chiến lược B |
| **`SKIP LOCKED`** | Bỏ qua dòng đang bị khóa thay vì chờ — dùng cho hàng đợi trong DB | Khi làm outbox worker |
| **Deadlock** | Hai transaction khóa chéo nhau, cả hai treo | Sẽ gặp thật khi làm chiến lược B nếu khóa sai thứ tự |
| **Lock contention** | Quá nhiều luồng tranh cùng một khóa → throughput sụt | Sẽ thấy rõ trong benchmark k6 |
| **Atomic operation** | Thao tác không thể bị chen ngang (Redis `DECR`, Lua script) | Chiến lược C |
| **Idempotency / Idempotency-Key** | Gọi API 2 lần cho cùng kết quả, không tạo 2 đơn | User bấm "Săn ngay" hai lần / mạng lag retry |
| **Optimistic vs Pessimistic — trade-off** | Ít tranh chấp → optimistic nhanh hơn; tranh chấp gắt → pessimistic ổn định hơn | Kết luận của báo cáo benchmark |
| **Snapshot / Point-in-time data** | Lưu giá tại thời điểm mua, không join lấy giá hiện tại | Bảng order_items |
| **CAP theorem / Consistency vs Availability** | Không thể vừa nhất quán tuyệt đối vừa luôn sẵn sàng khi mạng chia cắt | Khi cân trade-off chiến lược C (Redis nhanh nhưng có thể lệch DB) |
| **p50 / p95 / p99 latency** | Độ trễ theo phân vị — p95 quan trọng hơn trung bình | Đọc kết quả k6 |
| **Throughput (RPS) / Virtual User (VU)** | Số request/giây và số user ảo mô phỏng | Cấu hình kịch bản k6 |

---

## Phase 4 — Async, Queue, Payment

| Tên | Vấn đề nó chỉ | Dấu hiệu gặp |
|---|---|---|
| **Producer / Consumer / Worker** | Bên đẩy việc, bên xử lý việc | Cấu trúc BullMQ |
| **At-most-once / At-least-once / Exactly-once** | Ba mức bảo đảm giao message. Exactly-once gần như không đạt được thật | Vì sao consumer phải idempotent |
| **Idempotent consumer** | Xử lý message trùng vẫn cho kết quả đúng | Job gửi email chạy 2 lần → không gửi 2 mail |
| **Retry / Exponential backoff / Jitter** | Thử lại với khoảng chờ tăng dần + random để tránh dồn cục | Cấu hình job fail |
| **Dead Letter Queue (DLQ)** | Nơi chứa job fail hết số lần retry, để xem lại thủ công | Job không bao giờ được biến mất im lặng |
| **Dual write problem** | Ghi DB rồi push queue: chết ở giữa → DB có, queue không | Chính lý do cần Outbox |
| **Outbox pattern** | Ghi event vào bảng cùng transaction với dữ liệu, worker đọc bảng đẩy vào queue | Phase 4 nâng cấp |
| **Eventual consistency** | Dữ liệu các nơi sẽ khớp nhau sau một lúc, không tức thì | Trạng thái đơn sau khi webhook về |
| **Delayed job / Scheduled job** | Job hẹn giờ chạy sau X phút | Tự hủy đơn quá 15 phút |
| **Compensating transaction** | Không rollback được thì làm hành động bù (trả hàng về kho) | Khi hủy đơn đã giữ kho |
| **Webhook / Signature verification (HMAC)** | Cổng thanh toán gọi ngược về mình; phải verify chữ ký kẻo bị giả mạo | Tích hợp payment sandbox |
| **Out-of-order / Late-arriving event** | Webhook "đã trả tiền" đến sau khi đơn đã bị hủy | Case ác nhất của Phase 4 |
| **Race giữa webhook và scheduled job** | Hai luồng cùng đổi trạng thái đơn một lúc | Cần khóa hoặc state machine |
| **State machine** | Định nghĩa rõ trạng thái nào được chuyển sang trạng thái nào | Pending → Completed / Cancelled, cấm chuyển ngược |

---

## Phase 6 — Observability

| Tên | Vấn đề nó chỉ | Dấu hiệu gặp |
|---|---|---|
| **Ba trụ cột: Logs / Metrics / Traces** | Log = sự kiện, Metrics = số đo theo thời gian, Trace = hành trình 1 request | Khung sườn cả phase |
| **Structured logging** | Log dạng JSON để máy đọc và query được, không phải string | Pino |
| **Correlation ID / Request ID** | Một ID xuyên suốt request → queue → worker để nối các log lại. **Đã chạy từ Phase 0** — giải thích đầy đủ kèm log thật ở [`tech-playbook.md` §Phase 0](tech-playbook.md) | Mỗi lần debug từ báo lỗi của khách |
| **Liveness vs Readiness probe** | `/health` = còn sống chưa? `/ready` = sẵn sàng nhận traffic chưa? | Cloud Run dùng để quyết định gửi request |
| **Graceful shutdown / SIGTERM** | Nhận tín hiệu tắt → ngừng nhận request mới, chờ job xong, rồi đóng | Không làm → mất job đang chạy khi deploy |
| **Cardinality (metrics)** | Nhãn metric có quá nhiều giá trị (vd: userId) → nổ bộ nhớ | Khi đặt label cho Prometheus |
| **PII / Data masking** | Dữ liệu cá nhân không được lọt vào log | Review checklist |

---

## Phase 7 — Deploy & FinOps

| Tên | Vấn đề nó chỉ | Dấu hiệu gặp |
|---|---|---|
| **Cold start** | Container ngủ, request đầu phải chờ khởi động | Cloud Run + Neon scale-to-zero |
| **Autoscaling / min-instances / max-instances** | Số bản chạy tối thiểu và tối đa | Trade-off tiền vs độ trễ |
| **Stateless service** | Không lưu state trong RAM của instance, vì instance bị tạo/hủy tùy ý | Vì sao session/cache phải ở Redis |
| **Serverless connection pooling (PgBouncer)** | Nhiều instance × nhiều connection → vượt giới hạn DB | Neon pooler |
| **Blue-green / Rolling deploy** | Chiến lược deploy không downtime | Cloud Run revision |
| **Secret management** | Secret không nằm trong code/repo | GCP Secret Manager |
| **Budget alert / Quota** | Cảnh báo và giới hạn để không bị hóa đơn bất ngờ | Đặt $1 ngày đầu |
| **Egress cost** | Tiền trả cho dữ liệu ra khỏi cloud — thường bị bỏ sót | Bài học FinOps |

---

## Xuyên suốt — CI, Testing & Quy trình

> Phần này có mục riêng đầy đủ ở [`tech-playbook.md` §Xuyên suốt](tech-playbook.md) — cơ chế, bug
> hay gặp, và cách đọc `ci.yml` của repo này.

| Tên | Vấn đề nó chỉ | Dấu hiệu gặp |
|---|---|---|
| **CI vs CD** | CI = tự chứng minh code còn đúng mỗi lần push. CD = tự deploy. Repo này mới có CI | Mỗi lần push lên main |
| **Workflow / Job / Step / Runner** | Bốn tầng của GitHub Actions. Job = máy riêng, step = cùng máy | Khi đọc `.github/workflows/ci.yml` |
| **"Máy sạch"** | Runner mới tinh mỗi lần → thứ gì không nằm trong git thì CI phải sinh lại | Vì sao CI phải chạy `db:generate` |
| **CI đỏ / local xanh** | Có state chỉ tồn tại ở máy local (file gitignore, cache, bản generate cũ) | Đã gặp thật ở Phase 0 |
| **`npm ci` vs `npm install`** | `ci` cài đúng lockfile và fail nếu lock lệch; `install` được tự sửa lock | Vì sao CI không dùng `install` |
| **Unit / Integration / E2E test** | Ba tầng test: hàm đơn lẻ / nhiều thành phần thật / toàn luồng | Chiến lược test của dự án |
| **Test double: Mock / Stub / Spy / Fake** | Bốn cách thay thế dependency khi test — hay bị gọi lẫn là "mock" | Khi test service gọi DB hoặc payment |
| **Testcontainers** | Chạy Postgres/Redis thật trong Docker khi test, không mock | Integration test Phase 3 |
| **Flaky test** | Test lúc pass lúc fail — thường do timing hoặc state dùng chung | Sẽ gặp khi test concurrency |
| **Coverage — và cái bẫy của nó** | Đo % code **được chạy qua**, không phải % rủi ro được kiểm chứng | Mục tiêu 70% module core |
| **Branch coverage** | % nhánh `if` được đi **cả hai chiều** — đáng nhìn hơn line coverage | Khi đọc báo cáo coverage |
| **Mutation testing** | Cố tình sửa hỏng code xem test có đỏ không — phép thử thật sự của bộ test | Khi nghi bộ test chỉ đẹp số |
| **Fixture / Seed data** | Dữ liệu mẫu chuẩn bị trước cho test | Seed 100k SKU |
| **ADR (Architecture Decision Record)** | Ghi lại quyết định + trade-off để sau này giải thích được | Mỗi quyết định lớn |
| **Technical debt** | Nợ kỹ thuật: chấp nhận làm nhanh, trả sau — phải ghi lại, không được im lặng | Khi cố tình đơn giản hóa |
