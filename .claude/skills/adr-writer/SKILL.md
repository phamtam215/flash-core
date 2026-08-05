---
name: adr-writer
description: >
  Ghi Architecture Decision Record vào docs/adr/ theo docs/templates/adr-template.md.
  Dùng skill này khi Tâm hỏi "chọn A hay B", "nên dùng cái nào", "có nên thêm X không",
  khi cần chốt một quyết định kiến trúc (chiến lược lock, cổng thanh toán, isolation
  level, cách deploy, thêm thư viện/công nghệ mới), khi Tâm nói "ghi ADR"/"tạo ADR",
  và QUAN TRỌNG NHẤT: khi đang code mà phát hiện mình vừa ngầm ra một quyết định dài
  hạn thay Tâm — lúc đó phải dừng và đề xuất ADR. Cũng dùng khi Tâm muốn xem lại một
  quyết định cũ hoặc thay thế nó bằng quyết định mới.
---

# Ghi ADR (Architecture Decision Record)

ADR là bằng chứng "tôi hiểu và chịu trách nhiệm cho từng dòng" — thứ Definition of Done
của dự án đòi ~10 cái, và thứ Tâm sẽ mở ra đọc lại trước khi đi phỏng vấn. Giá trị của
nó không nằm ở quyết định, mà ở **các lựa chọn đã bị loại và vì sao**.

## Khi nào cần một ADR (và khi nào không)

**Cần ADR:**
- Quyết định khó đảo ngược, hoặc đảo ngược thì phải sửa nhiều nơi (schema, chiến lược
  lock, cấu trúc queue, cơ chế auth).
- Có ít nhất hai cách hợp lý và mình đang chọn một.
- Sau này sẽ có người (kể cả Tâm 3 tháng sau) hỏi "sao lại làm thế này?".
- **Thêm bất kỳ công nghệ/thư viện mới** — `CLAUDE.md` §Điều cấm nói rõ: không tự thêm,
  phải qua ADR để Tâm quyết.

**Không cần ADR:** đặt tên biến, chia file, chọn thư viện util nhỏ đã có tiền lệ trong
repo, những thứ sửa trong 10 phút.

## Bước 1 — Cấp số và tên file

```bash
ls docs/adr/
```

Lấy số lớn nhất + 1. Đặt tên `docs/adr/ADR-<3 chữ số>-<tieu-de-kebab>.md`, ví dụ
`ADR-004-chien-luoc-chong-oversell.md`.

Có ba ADR đã được ghi nợ sẵn trong `project-context.md` §6 — nếu chủ đề đang bàn khớp
một trong số đó, dùng đúng số/chủ đề đó thay vì tạo mới:

- **ADR-001** — Minh bạch về AI: giữ `Co-Authored-By` trong commit, hay chỉ nói rõ
  trong README (hay cả hai)?
- **Cổng thanh toán** — VNPay sandbox hay Stripe test mode?
- **Chiến lược mặc định cho production** — chốt sau khi có số benchmark Phase 3.

## Bước 2 — Viết, theo đúng template

Dùng `docs/templates/adr-template.md`. Chất lượng nằm ở hai mục:

### "Các lựa chọn đã cân nhắc"

Tối thiểu **2 lựa chọn thật**, mỗi cái có ưu VÀ nhược. Dấu hiệu ADR yếu: lựa chọn B
được viết như một con bù nhìn hiển nhiên sai để lựa chọn A trông đẹp. Nếu B thật sự vô
lý thì nó không đáng nằm trong ADR — tìm lựa chọn B khác đáng gờm hơn.

Với dự án này, luôn cân nhắc thêm một lựa chọn đặc biệt: **"không làm gì / giữ nguyên"**.
Nhiều quyết định tốt nhất là hoãn lại tới khi có số đo.

### "Hệ quả & trade-off chấp nhận"

Phải trả lời được cả ba:
1. Được gì — cụ thể, đo được nếu có thể.
2. **Mất gì** — nếu không nêu được cái mất nào, nghĩa là chưa hiểu quyết định.
3. **Khi nào cần xem lại quyết định này** — nêu điều kiện kích hoạt cụ thể ("nếu p95
   khi 1.000 VU vượt 500ms", "nếu tồn kho Redis lệch DB quá 1 lần/tuần"), không viết
   "khi cần thiết".

Nếu quyết định dựa trên số đo (Phase 3 benchmark) → nhúng số thật vào ADR, không viết
"nhanh hơn". Số là thứ khiến ADR không bị nghi là văn mẫu.

## Bước 3 — Trạng thái và quyền chốt

- AI viết ADR ở trạng thái **`Đề xuất`**.
- Chỉ Tâm đổi sang **`Đã chốt`**. Đừng tự chốt hộ, kể cả khi khuyến nghị rất rõ.
- Thay quyết định cũ: **không sửa nội dung ADR cũ**. Tạo ADR mới, và ở ADR cũ đổi
  trạng thái thành `Đã thay thế bởi ADR-xx`. Lịch sử đổi ý chính là phần giá trị nhất
  của thư mục này khi kể chuyện phỏng vấn.

## Bước 4 — Nối ADR vào phần còn lại của repo

- Commit message tham chiếu ADR ở dòng `Refs:` (xem `docs/git-workflow.md` §2).
- Spec liên quan trong `docs/specs/` thêm một dòng trỏ tới ADR.
- Nếu ADR làm thay đổi cách làm việc → cập nhật `CLAUDE.md`.

Sau khi ghi, báo Tâm ngắn gọn: quyết định đề xuất là gì, đánh đổi chính là gì, và câu
hỏi cần Tâm chốt. Rồi hỏi ngược một câu để kiểm tra Tâm thật sự đồng ý chứ không chỉ
"ừ cho xong" — ví dụ: *"nếu 3 tháng sau có người hỏi vì sao anh không chọn B, anh sẽ
trả lời thế nào?"*
