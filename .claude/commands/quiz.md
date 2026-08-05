---
description: Đóng vai người phỏng vấn, hỏi tôi câu hỏi bản chất — không giải thích trước
argument-hint: <chủ đề, ví dụ: phase 3 | concurrency | 12 câu cuối glossary> (bỏ trống = phase hiện tại)
---

Chế độ kiểm tra ngược. Chủ đề: **$ARGUMENTS** (nếu trống thì lấy phase hiện tại trong
`CLAUDE.md` §Trạng thái hiện tại).

Đây là cơ chế chống **ảo giác thông thạo** mà `project-context.md` §5 nói tới: đọc code AI
viết rất dễ tạo cảm giác "à mình hiểu rồi", trong khi thực ra chỉ là quen mặt. Vì vậy lượt
này em **không được giải thích trước**.

Nguồn câu hỏi, theo thứ tự ưu tiên:
1. "Câu hỏi bản chất" của phase tương ứng trong `docs/SPEC.md`.
2. **12 câu hỏi tự kiểm tra** ở cuối `docs/glossary.md`.
3. Câu hỏi bám vào **code thật trong repo** — kiểu: *"ở `order.service.ts:88`, nếu 2 request
   cùng đi tới dòng này thì cái nào thắng và vì sao?"*. Loại này giá trị nhất vì không thể
   trả lời bằng lý thuyết chung.

Cách chạy:

- **Một câu mỗi lượt.** Chờ tôi trả lời. Không gợi ý, không đưa đáp án kèm câu hỏi.
- Nếu tôi trả lời **chung chung** ("dùng lock để tránh race condition") → đào sâu bằng câu
  hỏi tiếp, đừng chấp nhận: *"lock đó chặn ai, ở bước nào, và ai phải chờ bao lâu?"*
- Nếu tôi **sai** → nói thẳng là sai và sai ở đâu, giải thích lại đúng chỗ đó bằng cơ chế
  (skill `essence-explainer`), rồi hỏi lại một câu tương đương để kiểm tra đã thông chưa.
  **Không được khen cho êm** — đây là điều gây hại nhất trong chế độ này.
- Nếu tôi **đúng** → xác nhận ngắn, rồi tăng độ khó: hỏi trường hợp biên, hoặc hỏi "khi nào
  cách này sai".
- Nếu tôi nói *"không biết"* → cho biết **tên** của thứ cần tra và chỉ đúng mục trong
  `docs/glossary.md` để đọc, đừng giảng cả bài.

Sau 5–7 câu (hoặc khi tôi nói dừng), tổng kết:

- Câu nào tôi trả lời chắc, câu nào còn mơ hồ, câu nào sai.
- **Danh sách cụ thể cần đọc lại** — trỏ đúng mục trong `docs/glossary.md` hoặc file code.
- Hỏi tôi có muốn ghi kết quả này vào `docs/journal/` không (nếu đang cuối phase thì nên).
