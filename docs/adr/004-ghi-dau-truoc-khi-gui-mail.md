# ADR-004: Ghi dấu đã-xử-lý TRƯỚC khi gửi email, không phải sau

- **Ngày:** 2026-09-05
- **Trạng thái:** Đã chốt

## Bối cảnh

Hàng đợi của Phase 4 là **at-least-once**: BullMQ có thể giao cùng một job hai lần (worker
chết giữa chừng, job bị coi là stalled và giao lại). Consumer vì thế phải idempotent, và cơ
chế là `INSERT` một dấu vào `processed_events` rồi để UNIQUE của DB làm trọng tài.

Với việc **ghi DB** (đánh dấu đơn `PAID`) thì không có gì phải quyết: dấu và hệ quả nằm chung
một transaction, hoặc cùng có hoặc cùng không.

Với việc **gửi email** thì không có transaction nào bao được cả hai — SMTP không nằm trong
ACID của Postgres. Buộc phải chọn thứ tự, và mỗi thứ tự hỏng theo một kiểu:

- **Gửi trước, ghi dấu sau:** process chết ở giữa ⇒ email đã đi mà không có dấu ⇒ lần retry
  gửi **lần hai**.
- **Ghi dấu trước, gửi sau:** process chết ở giữa ⇒ có dấu mà email chưa đi ⇒ email **mất**.

## Quyết định

**Ghi dấu trước.** Nếu việc gửi thất bại *mà mã còn chạy được*, dấu được **trả lại**
(`IdempotencyRepository.release`) để lần retry sau còn chạy. Chỉ khi process bị giết đúng khe
giữa hai bước thì email mới mất.

Lỗi **vĩnh viễn** (địa chỉ sai định dạng, không tìm thấy người nhận) thì **không** trả dấu:
giữ nguyên để job có nằm lại DLQ cũng không ai vô tình chạy lại và gửi trùng.

## Các lựa chọn đã cân nhắc

- **Ghi dấu trước** ✅ — *ưu*: bảo đảm "không gửi trùng", đúng thứ test #18 kiểm chứng; cửa sổ
  mất mail rất hẹp (giữa hai lệnh liền nhau). *nhược*: mất mail là mất im lặng — không ai
  biết, vì dấu vẫn nằm đó như thể đã gửi.
- **Gửi trước, ghi dấu sau** — *ưu*: không bao giờ mất mail. *nhược*: khách nhận hai email xác
  nhận cho một đơn; với email liên quan tiền bạc, đó là mất lòng tin, và không có cách nào thu
  hồi cái đã gửi.
- **Bảng `sent_emails` + trạng thái hai pha** (`SENDING` → `SENT`) — *ưu*: nhìn ra được email
  kẹt ở `SENDING` để dò lại. *nhược*: thêm một bảng làm đúng việc `processed_events` đang làm,
  và vẫn không xoá được cửa sổ rủi ro — chỉ chuyển nó thành "phải có người dọn hàng kẹt".

## Hệ quả & trade-off chấp nhận

**Được:** một cơ chế duy nhất (`processed_events`) cho mọi consumer; bảo đảm mạnh nhất ở đúng
hướng người dùng quan tâm — không bao giờ nhận email trùng.

**Mất:** khi process bị giết đúng khe hẹp đó, email xác nhận của đơn ấy sẽ không bao giờ được
gửi, và **hệ thống không biết**. Chấp nhận được vì đơn hàng vẫn tra được ở `GET /orders` —
email là tiện ích, không phải nguồn sự thật.

**Xem lại khi:** có loại email mà mất là không chấp nhận được (ví dụ hoá đơn/biên lai theo
quy định). Lúc đó dùng đúng cơ chế của Outbox cho luôn phần gửi: ghi trạng thái gửi vào DB
trong transaction, và một job đối soát quét những dòng "đã đánh dấu mà chưa xác nhận gửi".
