# Flash-Core v2 — Spec gốc

> Nguồn: chưng cất từ quá trình thiết kế giữa Tâm và Claude (claude.ai).
> Đây là tài liệu định hướng cao nhất. Spec chi tiết từng tính năng nằm ở `docs/specs/`.
>
> **Câu hỏi bản chất** ghi ở mỗi phase dưới đây là một mục Definition of Done. Đáp án của các
> phase đã làm nằm ở [`tech-playbook.md`](tech-playbook.md) — mục *Câu hỏi bản chất của
> Phase N — và đáp án*, cùng mục *Ôn phỏng vấn — 12 câu chốt*.

## 1. Mục tiêu
- Học bản chất hệ thống lớn: concurrency, async, reliability, observability, FinOps.
- Portfolio đủ mạnh cho vị trí Backend Node.js Middle: mỗi dòng CV có bằng chứng
  (benchmark, coverage, ADR, API live).
- Luyện quy trình AI-era: Tâm viết spec/review/quyết định, AI implement.

## 2. Nghiệp vụ
Săn flash sale áo thun:
- Đợt sale mở đúng giờ, mẫu áo giảm sâu, tồn kho giới hạn **theo SKU biến thể (size × màu)**.
- User: đăng nhập → xem sự kiện (đếm ngược + tồn kho realtime) → chọn size/màu,
  săn hàng → đơn Pending giữ chỗ 15 phút → thanh toán qua cổng sandbox
  (VNPay sandbox / Stripe test mode), webhook xác nhận → Completed;
  quá hạn → tự hủy, trả hàng về kho.

## 3. Các module
| Module | Nội dung chính |
|---|---|
| Auth & Security | Argon2, Access(15m) + Refresh(7d) qua HttpOnly Cookie, Refresh Token Rotation, rate limiting login |
| Product & Inventory | Mẫu áo + biến thể size×màu (JSONB + GIN index), tồn kho theo SKU, cursor pagination |
| Order & Concurrency ⭐ | 3 chiến lược chống oversell (bật/tắt bằng config): Optimistic (version) / Pessimistic (`SELECT FOR UPDATE` qua `$queryRaw`) / Redis atomic (Lua) + async persist. Idempotency-Key, Snapshot Price, ACID |
| Async & Payment | BullMQ: email, delayed job hủy đơn quá 15 phút, retry exponential backoff, DLQ. Outbox pattern. Payment webhook: verify chữ ký, idempotent, xử lý webhook đến sau khi đơn đã hủy |
| Observability | Pino JSON log + correlationId xuyên request→queue, /health & /ready, Prometheus metrics, graceful shutdown |
| Load Testing | k6 local: 1.000 VU săn 100 chiếc của 1 mẫu hot, so sánh 3 chiến lược, oversell = 0 |

## 4. Lộ trình 8 Phase
### Phase 0 — Nền móng & Quy trình AI (1 tuần)
Repo + Docker Compose (Postgres, Redis) + NestJS skeleton + Prisma + CI GitHub Actions
(lint, test). Hoàn thiện CLAUDE.md, template spec/ADR, review checklist.
**Deliverable:** `docker compose up` chạy toàn bộ; CI xanh.
**Câu hỏi bản chất:** Modular Monolith vs Microservices? Vì sao dự án 1 người không
nên làm microservices? Ranh giới module enforce bằng gì trong NestJS?

### Phase 1 — Auth & Security (1–1.5 tuần)
Argon2, Access + Refresh Token, HttpOnly Cookie, Refresh Token Rotation, rate limit login.
**Deliverable:** integration test toàn luồng auth, kể cả case token bị đánh cắp và reuse.
**Câu hỏi bản chất:** Vì sao Argon2 > bcrypt? HttpOnly chống XSS thế nào, vì sao vẫn
lo CSRF? Rotation phát hiện token theft ra sao?

### Phase 2 — Product & Inventory (1 tuần)
CRUD mẫu áo với biến thể size×màu, JSONB + GIN index, tồn kho theo SKU,
cursor pagination, seed 100.000 SKU.
**Deliverable:** so sánh `EXPLAIN ANALYZE` trước/sau index.
**Câu hỏi bản chất:** Cursor vs offset pagination khi dữ liệu lớn? GIN vs B-tree?
Khi nào JSONB là lựa chọn tệ?

### Phase 3 — Order & Concurrency ⭐ (2–2.5 tuần)
Implement cả 3 chiến lược A/B/C chống oversell, bật/tắt bằng config.
Idempotency-Key, Snapshot Price, transaction bọc đúng ranh giới.
**Evidence CV:** báo cáo k6 1.000 VU săn 100 chiếc — throughput, p95, error rate
của A/B/C, oversell = 0 ở cả ba.
**Câu hỏi bản chất:** Vì sao read→if→write chắc chắn oversell dưới tải cao?
Isolation level mặc định của Postgres và anomaly nó cho phép? Redis chết sau khi
trừ kho nhưng trước khi ghi DB thì sao?

### Phase 4 — Async, Queue, Payment Webhook & Reliability (2 tuần)
BullMQ (email, hủy đơn 15 phút, retry backoff, DLQ), Outbox pattern.
Payment sandbox: verify chữ ký webhook, webhook idempotent, case webhook đến
sau khi đơn đã bị hủy.
**Deliverable:** demo "rút dây mạng" — kill worker giữa chừng, không mất message,
không gửi email trùng.
**Câu hỏi bản chất:** At-least-once vs exactly-once? Vì sao consumer phải idempotent?
Outbox giải quyết gì mà "ghi DB rồi push queue" không giải quyết được? Vì sao phải
verify chữ ký webhook, xử lý sao khi webhook thanh toán đến sau khi đơn đã hủy?

### Phase 5 — UI demo (2 buổi tối)
**Một trang tĩnh `public/index.html`, không framework** (đổi từ Vite + React + Tailwind —
lý do ở [ADR-007](adr/007-ui-la-trang-tinh-mot-file.md)), polling 1–2s cho tồn kho.
AI làm 100%, không tính coverage. 4 màn hình: (1) Đăng nhập/Đăng ký; (2) Sự kiện sale — lưới áo, đếm
ngược, tồn kho realtime theo size/màu; (3) Chọn size/màu + "Săn ngay" → đơn giữ chỗ 15
phút + thanh toán sandbox; (4) Đơn của tôi. Quá timebox → cắt còn (2)+(3).
Đặt SAU Phase 4 (không phải ngay sau Phase 3) vì màn (3) cần cả job giữ-chỗ-15-phút lẫn
thanh toán sandbox — cả hai là deliverable của Phase 4, không phải Phase 3.
**Deliverable:** demo video/GIF 2 phút — k6 chạy trong khi tồn kho trên FE rơi về 0 và
dừng đúng 0.
**Câu hỏi bản chất:** FE ở đây là công cụ trực quan hoá hay sản phẩm — khác nhau ở đâu
trong cách quyết định làm tới đâu thì dừng?

### Phase 6 — Observability & Hardening (1 tuần)
Pino structured log, correlationId xuyên suốt, /health & /ready, Prometheus metrics,
graceful shutdown.
**Deliverable:** từ 1 request lỗi bất kỳ, truy toàn bộ hành trình bằng 1 correlationId.
**Câu hỏi bản chất:** /health vs /ready và Cloud Run dùng chúng ra sao?
Graceful shutdown sai thì mất gì? Log sao để debug được mà không lộ dữ liệu nhạy cảm?

### Phase 7 — Deploy, FinOps & Đóng gói CV (1–1.5 tuần)
Cloud Run (us-central1, free tier) + Neon + Upstash, GitHub Actions auto deploy,
Secret Manager, budget alert $1. README chuẩn "đọc 3 phút hiểu toàn hệ thống".
**Câu hỏi bản chất:** Cold start ảnh hưởng flash sale thế nào, min-instances giải
quyết ra sao? Connection pooling với serverless (Neon pooler)? Chi phí phát sinh
đầu tiên ở đâu nếu traffic thật tăng?

## 5. Ràng buộc FinOps
- Load test & seed lớn: CHỈ chạy local (Docker Compose).
- Cloud chỉ để demo API sống. Free tier: Cloud Run (us-central1) + Neon Free
  (0.5GB, scale-to-zero, hard cutoff) + Upstash Free (256MB, 500k lệnh/tháng).
- Budget alert $1 ngay ngày đầu. Chấp nhận cold start để giữ 0đ (ghi ADR).

## 6. Definition of Done
- [ ] Báo cáo benchmark k6 so sánh 3 chiến lược + kết luận khi nào dùng cái nào
- [ ] Coverage ≥ 70% module core (Order, Inventory), integration test trên DB thật
- [ ] ~10 ADR
- [ ] Sơ đồ kiến trúc + sequence diagram luồng đặt hàng
- [ ] Payment webhook: verify chữ ký, idempotent, test webhook trùng & đến muộn
- [ ] API live trên Cloud Run, CI/CD tự động
- [ ] Demo video/GIF 2 phút: k6 chạy, tồn kho FE về 0 và dừng đúng 0
