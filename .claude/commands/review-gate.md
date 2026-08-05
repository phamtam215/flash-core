---
description: Tự review code vừa viết theo docs/review-checklist.md, chạy test, tóm tắt luồng chạy
---

Dùng skill `review-gate` để tự review toàn bộ thay đổi đang có.

Nhắc lại tiêu chuẩn:

- Đi hết 5 nhóm trong `docs/review-checklist.md`. **Mỗi ý trả lời kèm bằng chứng
  `file.ts:line`**, hoặc ghi thẳng "chưa xử lý — lý do". Không tick suông.
- Chạy test và **báo số thật** (pass/fail, coverage module core). Test fail thì dừng ở đó,
  không đi tiếp như thể đã xong.
- Tóm tắt luồng chạy **5–10 câu tiếng Việt**, nói rõ transaction mở/đóng ở đâu và đâu là
  critical section. Không dán code vào phần này.
- Nêu 2–3 điểm rủi ro nhất tôi cần đọc kỹ, và **nợ kỹ thuật đã cố tình chấp nhận**.
- Đặt 2–3 câu hỏi ngược kiểm tra tôi hiểu cơ chế (không phải hỏi tôi có đồng ý không).
- Không push. Không tự kết luận "đã đạt Definition of Done".

$ARGUMENTS
