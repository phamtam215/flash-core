---
description: Báo cáo tiến độ phase hiện tại so với SPEC.md và Definition of Done
---

Báo cáo trạng thái dự án. Đọc `CLAUDE.md` §Trạng thái hiện tại, `docs/SPEC.md`,
`docs/specs/`, `docs/adr/`, `docs/journal/`, và `git log`. Trình bày **ngắn, dạng bảng**,
không diễn giải dài.

Cần đủ 6 phần sau:

1. **Phase hiện tại** và deliverable của nó theo `docs/SPEC.md` — cái nào xong, cái nào
   chưa. Chỉ đánh xong khi có bằng chứng thật (file, test pass, số đo), không đánh theo
   cảm giác.

2. **Bảng đếm:** số spec trong `docs/specs/`, số ADR trong `docs/adr/` (mục tiêu ~10), số
   journal trong `docs/journal/`, nhánh git hiện tại, số commit của phase này.

3. **Definition of Done** (`docs/SPEC.md` §7) — 7 ô, ô nào đạt/chưa, kèm bằng chứng nếu đạt.

4. **Câu hỏi bản chất chưa trả lời được** — quét `docs/journal/` tìm các dòng
   `⚠️ Chưa trả lời được`, và nêu các câu hỏi bản chất của phase hiện tại chưa được ghi
   nhận ở đâu. Đây là cổng chuyển phase (`docs/README.md` nguyên tắc 3).

5. **Việc còn treo cần tôi quyết** — lấy từ `project-context.md` §6 và các mục
   "Câu hỏi mở cho Tâm quyết" còn bỏ trống trong `docs/specs/`.

6. **Đề xuất 3 việc tiếp theo**, xếp theo thứ tự, mỗi việc một dòng, nói rõ việc nào cần
   spec trước.

Không tự làm gì trong lượt này — chỉ báo cáo.
