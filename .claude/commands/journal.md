---
description: Viết nhật ký học tập cuối phase và phỏng vấn tôi về câu hỏi bản chất
argument-hint: <số phase, ví dụ: 3>
---

Dùng skill `phase-journal` cho phase: **$ARGUMENTS**

Trình tự của lượt này:

1. **Claude làm:** dựng lại lịch sử phase từ `git log` — đã build gì, mất bao lâu, va vào
   vấn đề gì (đọc các commit `fix:`/`test:` và thân commit), số đo thật (coverage, EXPLAIN,
   k6). Trình bày phần này trước để tôi xác nhận.
2. **Rồi phỏng vấn tôi:** lấy đúng các "câu hỏi bản chất" của phase từ `docs/SPEC.md`, hỏi
   **một câu mỗi lượt**, chờ tôi trả lời, **không tự trả lời hộ**.
3. Chấm câu trả lời của tôi theo ba mức: đủ / thiếu cơ chế ở chỗ nào / sai ở đâu.
   **Sai thì nói thẳng là sai** — đừng gật cho êm, vì tôi sẽ mang cái hiểu sai đó vào
   buổi phỏng vấn.
4. Ghi `docs/journal/phase-$ARGUMENTS.md` bằng **lời của tôi** ở mục câu hỏi bản chất.
   Chỗ tôi chưa trả lời được thì ghi `⚠️ Chưa trả lời được — cần đọc lại: <mục cụ thể>`.
5. Cập nhật mục "Trạng thái hiện tại" trong `CLAUDE.md`, và đề xuất tick những ô Definition
   of Done trong `docs/SPEC.md` §7 **có bằng chứng thật** (chờ tôi xác nhận trước khi tick).
6. Commit riêng bằng `/commit`.
