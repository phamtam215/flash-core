# Bối cảnh & Nhật ký quyết định — Flash-Core

> **File này là gì:** bản chưng cất từ quá trình thiết kế dự án giữa Tâm và Claude
> (trên claude.ai) trước khi viết dòng code đầu tiên.
> **Mục đích:** `SPEC.md` nói *làm gì*; file này nói *vì sao*, và **những gì đã bị
> loại bỏ có chủ đích**. Đọc file này trước khi đề xuất bất cứ thay đổi kiến trúc nào.

---

## 1. Chủ dự án

- **Tên:** Tâm — Backend Web Developer.
- **Nền tảng sẵn có:** Node.js, GCP (deploy, scheduler, monitor log), MySQL, Prisma.
- **Ngôn ngữ giao tiếp:** **tiếng Việt**. Giải thích ở mức bản chất (cơ chế bên dưới,
  trade-off), không chỉ mô tả code làm gì.
- **Bối cảnh công việc:** làm dự án công ty, phần lớn công việc hằng ngày đã dịch
  chuyển sang dùng AI — vai trò nghiêng về chuẩn bị spec, quản lý context, review
  output. Dự án cá nhân này chính là nơi luyện đúng bộ kỹ năng đó.
- **Điểm yếu tự nhận:** chỉ làm quanh quẩn dự án công ty (CRUD, MySQL), chưa được
  chạm tới tư duy kiến trúc và các bài toán tải cao. Đây là lỗ hổng dự án cần lấp.

## 2. Mục tiêu của dự án (theo đúng thứ tự ưu tiên)

1. **Hiểu bản chất** các bài toán hệ thống lớn — không phải để có code chạy được.
2. **Portfolio đủ mạnh** cho vị trí Backend Node.js Middle: mỗi dòng CV có bằng chứng.
3. **Luyện quy trình AI-era**: Tâm là architect + reviewer, AI là implementer.

> ⚠️ **Hệ quả quan trọng cho AI:** vì mục tiêu số 1 là *hiểu*, nên **code chạy được
> không đồng nghĩa với xong**. Một tính năng chỉ xong khi Tâm giải thích lại được
> luồng chạy. Ưu tiên code rõ ràng, dễ giải thích hơn code thông minh, ngắn gọn.

## 3. Nhật ký quyết định (Decision Log)

| # | Quyết định | Vì sao | Đã loại bỏ điều gì |
|---|---|---|---|
| 1 | **Làm dự án này, tạm gác chứng chỉ GCP ACE** | Chứng chỉ chứng minh "biết service" — loại kiến thức AI tra cứu hộ được, và động lực đang cạn vì học flashcard không có phản hồi ngắn. Dự án cho vòng lặp làm→thấy kết quả mỗi tuần. Phase 6 deploy GCP thật sẽ khiến ôn ACE sau này dễ hơn | Không bỏ ACE, chỉ đổi thứ tự: dự án trước, ACE sau như "phần thưởng phụ" |
| 2 | **Nghiệp vụ: săn flash sale áo thun** | Tồn kho chia nhỏ theo SKU biến thể (size × màu) → tranh chấp gắt và thực tế hơn. Ban đầu từng cân nhắc gắn với brand PATA (hải sản) nhưng chốt áo thun cho phổ quát | Trang bán hàng CRUD đầy đủ tính năng; giao diện lòe loẹt |
| 3 | **Modular Monolith** | Dự án một người. Microservices sẽ ngốn toàn bộ thời gian vào hạ tầng thay vì học concurrency | Microservices, Kubernetes, service mesh |
| 4 | **PostgreSQL thay vì MySQL (dù MySQL quen hơn)** | Cố tình mở rộng skill: JSONB, GIN index, `SELECT FOR UPDATE SKIP LOCKED`, isolation levels rõ ràng | MySQL (đã quen ở công ty, học được ít hơn) |
| 5 | **Giữ Prisma** | Đã quen → tập trung năng lượng vào phần khó (concurrency). Bonus: chạm giới hạn của Prisma (pessimistic lock phải `$queryRaw`) là bài học "khi nào ORM không đủ" | TypeORM, Drizzle, raw SQL toàn bộ |
| 6 | **Implement CẢ 3 chiến lược chống oversell** (optimistic / pessimistic / Redis atomic), bật tắt bằng config | Đây là **trái tim dự án** và là điểm mạnh nhất trên CV. Làm một cách thì chỉ là "đã làm"; so sánh ba cách kèm số đo mới là "đã hiểu" | Chỉ làm optimistic locking như spec v1 |
| 7 | **Zod thay class-validator** | Schema-first, dùng chung schema cho validate + type inference | class-validator + class-transformer |
| 8 | **Bổ sung payment webhook sandbox** (VNPay sandbox hoặc Stripe test mode) | Lỗ hổng lớn nhất của spec v1: thanh toán chỉ mô phỏng. Webhook mới là phần thật và khó: verify chữ ký HMAC, idempotent, và case ác nhất — webhook "đã trả tiền" đến *sau khi* đơn đã tự hủy | Thanh toán mô phỏng bằng một nút bấm đổi trạng thái |
| 9 | **Outbox pattern cho queue** | Giải quyết dual write problem (ghi DB xong, push queue fail) | "Ghi DB rồi push queue" đơn thuần |
| 10 | **FE do AI làm 100%, timebox 2 buổi tối, tại Phase 3** | FE là *công cụ trực quan hóa*, không phải sản phẩm. Giá trị duy nhất: cảnh k6 chạy trong khi tồn kho trên màn hình rơi về 0 và **dừng đúng 0** → demo evidence | FE đẹp, responsive, state management phức tạp. Trước Phase 3 dùng Swagger UI thay FE |
| 11 | **Load test CHỈ chạy local** (Docker Compose) | Bắn 1.000 VU lên cloud sẽ đốt hết free tier trong vài phút. Bonus: số đo local còn đáng tin hơn vì không nhiễu network | Load test trên môi trường cloud |
| 12 | **Deploy Cloud Run (us-central1) + Neon + Upstash, mục tiêu 0đ/tháng** | Free tier vĩnh viễn. Chấp nhận cold start và độ trễ ~200ms từ VN để giữ chi phí 0đ — chính việc *giải thích được đánh đổi này* là câu chuyện FinOps để kể khi phỏng vấn | min-instances = 1 (mất phí); region gần VN (mất free tier) |
| 13 | **Không thêm công nghệ mới nữa** | 8 công nghệ hiểu sâu > 15 công nghệ hiểu lờ mờ. Người phỏng vấn giỏi phát hiện "resume-driven development" trong 2 câu hỏi. Câu "vì sao anh KHÔNG dùng Kafka" trả lời được bằng trade-off là câu ghi điểm Senior | Kafka, RabbitMQ, K8s, gRPC, Elasticsearch, CQRS/Event Sourcing |
| 14 | **AI commit nhưng KHÔNG push trước khi Tâm review** | Bước review giữa commit và push chính là nơi kiến thức hình thành — nó buộc đọc diff với tâm thế người chịu trách nhiệm | Để AI chạy trọn vòng commit → push tự động |

## 4. Ràng buộc chi phí (đã kiểm chứng, 08/2026)

- **Cloud Run free tier:** 180.000 vCPU-giây, 360.000 GiB-giây, 2 triệu request/tháng
  — **chỉ áp dụng ở us-central1 / us-east1 / us-west1**.
- **Neon Free:** 0.5 GB storage, 100 compute-giờ/tháng, scale-to-zero sau 5 phút idle.
  Giới hạn là **hard cutoff** (chạm ngưỡng là DB treo tới chu kỳ sau), không phải giảm tốc.
- **Upstash Free:** 256 MB, 500.000 lệnh/tháng.
- **Bắt buộc:** đặt **budget alert $1** ngay ngày đầu bật billing GCP. Không dùng
  $300 credit trial một cách vô thức.

> Số liệu free tier thay đổi theo thời gian — kiểm tra lại trước khi deploy Phase 6.

## 5. Triết lý học tập của dự án (ảnh hưởng trực tiếp cách AI nên phản hồi)

Tâm chọn cách học **just-in-time** (va vấn đề rồi mới đào sâu) thay vì học hết lý
thuyết trước. Hai rủi ro đã nhận diện, và cách dự án phòng chúng:

1. **Không biết mình đang không biết gì.** Nếu chưa từng nghe tên "race condition"
   thì sẽ không nhận ra code của mình có lỗi đó — nó vẫn chạy đúng trên máy local.
   → Phòng bằng `docs/glossary.md`: danh sách *tên* các bài toán, để nhận diện.

2. **Ảo giác thông thạo (illusion of fluency).** Đọc code AI viết rất dễ tạo cảm
   giác "à mình hiểu rồi", trong khi thực ra chỉ là quen mặt.
   → Phòng bằng ba cơ chế bắt buộc: **tự kể lại luồng chạy khi không nhìn code**,
   **tự viết test cho case ác ý**, **tự chạy benchmark ra số**.

**Vì vậy, khi làm việc với Tâm, AI nên:**
- Sau mỗi tính năng, tóm tắt luồng chạy bằng lời (5–10 câu, tiếng Việt) để Tâm đối chiếu.
- Khi Tâm hỏi "vì sao", trả lời ở mức cơ chế và trade-off, không mô tả lại code.
- **Chủ động đặt câu hỏi ngược lại** cho Tâm ở các điểm quan trọng (ví dụ: "theo anh
  nếu 2 request cùng chạy qua đoạn này thì sao?") thay vì chỉ giải thích một chiều.
- Dùng đúng thuật ngữ trong `docs/glossary.md` để Tâm quen dần từ vựng chuẩn.
- Không "giúp cho xong": nếu Tâm bỏ qua bước review hoặc bước spec, hãy nhắc.

## 6. Việc còn treo (cần Tâm quyết, ghi thành ADR)

- [ ] **ADR-001 — Minh bạch về AI:** giữ `Co-Authored-By: Claude` trong commit, hay
      chỉ nói rõ quy trình AI-assisted trong README? (Khuyến nghị đã bàn: chọn cách
      nói rõ trong README, hoặc cả hai. **Che giấu là rủi ro lớn nhất.**)
- [ ] **Cổng thanh toán:** VNPay sandbox (sát thị trường VN) hay Stripe test mode
      (tài liệu tốt hơn, dễ test webhook hơn)?
- [ ] **Chiến lược mặc định** cho production sau khi có kết quả benchmark Phase 3.

## 7. Thang thời gian & kỳ vọng

~10–12 tuần, mỗi tuần 3–4 buổi tối. Phase 3 (concurrency) và Phase 4 (queue +
payment) chiếm gần một nửa thời gian — **đúng như thiết kế**, vì đó là nơi chứa
gần toàn bộ giá trị học tập. Không rút ngắn hai phase này để chạy cho nhanh tới deploy.

## 8. Định nghĩa "thành công" của dự án

Không phải là API chạy được. Mà là: **Tâm trả lời trôi chảy 12 câu hỏi tự kiểm tra
ở cuối `docs/glossary.md` mà không nhìn code.** Khi đó, mọi nghi ngờ kiểu "dự án này
do AI viết hộ" sẽ tự động biến thành điểm cộng: *"người này biết dùng AI đúng cách."*