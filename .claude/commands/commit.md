---
description: Tạo commit theo chuẩn Flash-Core (Conventional Commits + thân giải thích vì sao)
---

Tạo git commit theo quy chuẩn trong `docs/git-workflow.md`. Thực hiện tuần tự:

1. `git status` — xem thay đổi đang có.
2. `git diff` và `git diff --staged` — đọc kỹ nội dung thay đổi.
3. **Đánh giá phạm vi:** nếu các thay đổi thuộc nhiều ý khác nhau, đề xuất tách
   thành nhiều commit và hỏi tôi trước khi làm.
4. Chạy test liên quan. **Nếu test fail, KHÔNG commit** — báo tôi biết lỗi gì.
5. Kiểm tra không có secret / `.env` / token lọt vào diff.
6. Stage đúng file cần thiết (không dùng `git add .` một cách mù quáng).
7. Tạo commit message đúng format:
   - Dòng đầu: `<type>(<scope>): <mô tả mệnh lệnh, < 50 ký tự>`
   - Dòng trống
   - Thân: giải thích **VÌ SAO** chọn cách này (không lặp lại "làm gì"),
     nêu trade-off đã chấp nhận nếu có
   - Dòng `Refs:` trỏ tới file spec trong `docs/specs/` và ADR liên quan (nếu có)
   - Toàn bộ message viết bằng **tiếng Việt**
8. `git log -1 --stat` để tôi xác nhận kết quả.

**KHÔNG tự động push.** Sau khi commit, chỉ báo tôi: "Đã commit, sẵn sàng push khi
anh review xong." Việc push chỉ thực hiện khi tôi yêu cầu rõ ràng.
