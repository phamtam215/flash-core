---
description: Draft spec tính năng vào docs/specs/ rồi dừng chờ tôi duyệt (không code)
argument-hint: <tên tính năng, ví dụ: API săn hàng - trừ tồn kho theo SKU>
---

Dùng skill `feature-spec` để draft spec cho: **$ARGUMENTS**

Nhắc lại giới hạn của lượt này:

- Chỉ tạo file trong `docs/specs/`. **Không** tạo/sửa file trong `src/`, không cài package,
  không chạy migration.
- Mục **"Edge cases bắt buộc xử lý"** và **"Test cases phải pass"** phải cụ thể, có con số,
  có hành vi mong đợi — không viết tên tình huống suông.
- Mục **"Câu hỏi mở cho Tâm quyết"** không được để trống nếu spec có chỗ nào tôi nên chọn.
  Kèm khuyến nghị của em và lý do.
- Kết thúc: đưa đường dẫn file, liệt kê câu hỏi mở, và chờ tôi duyệt.
