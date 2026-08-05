---
description: Viết ADR (Architecture Decision Record) vào docs/adr/ ở trạng thái Đề xuất
argument-hint: <chủ đề quyết định, ví dụ: chọn chiến lược lock mặc định cho production>
---

Dùng skill `adr-writer` để viết ADR cho: **$ARGUMENTS**

Yêu cầu của lượt này:

- Cấp số tiếp theo dựa trên `ls docs/adr/`. Nếu chủ đề khớp một ADR đang treo trong
  `project-context.md` §6 thì dùng đúng chủ đề/số đó.
- Tối thiểu **2 lựa chọn thật**, mỗi cái có cả ưu và nhược. Không dựng bù nhìn.
  Luôn cân nhắc thêm lựa chọn "chưa quyết, chờ số đo".
- Mục hệ quả phải trả lời đủ ba: được gì, **mất gì**, và **điều kiện cụ thể nào thì
  cần xem lại quyết định này**.
- Có số đo trong repo (`docs/journal/`, báo cáo k6, EXPLAIN) thì dẫn số thật, đừng viết
  "nhanh hơn".
- Trạng thái để **`Đề xuất`** — tôi mới là người chốt.
- Kết thúc bằng một câu hỏi ngược kiểm tra tôi thật sự đồng ý, không phải "ừ cho xong".
