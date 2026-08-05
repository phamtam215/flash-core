# Spec: [Tên tính năng]

- **Phase:** [số phase]
- **Ngày:** [yyyy-mm-dd]
- **Trạng thái:** Draft / Đã duyệt / Đã implement

## Mục tiêu
[1–3 câu: tính năng này giải quyết vấn đề gì, cho ai]

## API / Interface
[Endpoint, method, request/response schema (Zod), status codes]

## Luồng xử lý
[Các bước chính, transaction boundary nằm ở đâu, gọi queue chỗ nào]

## Edge cases bắt buộc xử lý
- [ ] [ví dụ: gọi 2 lần cùng Idempotency-Key]
- [ ] [ví dụ: 100 request song song vào cùng 1 SKU]
- [ ] [ví dụ: DB timeout giữa chừng]

## Test cases phải pass
1. [happy path]
2. [từng edge case ở trên]

## Ngoài phạm vi (Non-goals)
[Những thứ CỐ TÌNH không làm trong spec này]

## Câu hỏi mở cho Tâm quyết
[Trade-off cần Tâm chọn trước khi code — nếu có, dừng chờ quyết định]
