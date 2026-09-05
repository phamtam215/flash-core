# ADR-006: Relay giữ transaction mở trong lúc đẩy queue

- **Ngày:** 2026-09-05
- **Trạng thái:** Đã chốt

## Bối cảnh

`CLAUDE.md` có luật: *"Transaction boundary phải hẹp nhất có thể; không gọi API ngoài trong
transaction."* Luật đó đúng cho đường request — giữ khoá trên dòng nghiệp vụ nóng trong lúc
chờ mạng là cách làm sập hệ thống dưới tải.

Nhưng relay của Outbox có ba thao tác phải xảy ra theo đúng một thứ tự: **lấy dòng và khoá
lại → đẩy vào queue → đánh dấu đã đẩy**. Bản đầu tiên của `OutboxRepository` làm khác: đánh
dấu `DISPATCHED` và **commit** trước, rồi mới gọi `queue.add` ở ngoài. Kết quả là một cửa sổ
mất dữ liệu: process bị giết đúng khe giữa commit và `queue.add` thì dòng nằm lại
`DISPATCHED` vĩnh viễn — không ai đẩy nữa và **không ai biết**. Email của đơn đó không bao giờ
được gửi.

Điều đó phá đúng lời hứa của cả phase ("không mất message") và mâu thuẫn với chính câu giải
thích trong `tech-playbook.md`: Outbox chuyển bài toán từ *có thể mất* sang *có thể trùng*.

## Quyết định

Giữ transaction mở suốt cả ba thao tác: `SELECT … FOR UPDATE SKIP LOCKED` → `queue.add` →
`UPDATE … DISPATCHED` → commit. Transaction có trần thời gian 15 giây.

Hỏng ở bất kỳ đâu ⇒ rollback ⇒ các dòng quay lại `PENDING` ⇒ nhịp quét sau đẩy lại.

## Các lựa chọn đã cân nhắc

- **Giữ transaction mở** ✅ — *ưu*: không bao giờ mất; rollback tự làm việc dọn dẹp, không cần
  trạng thái trung gian hay job đối soát. *nhược*: vi phạm luật "không gọi ngoài trong
  transaction"; một lô hỏng có thể đẩy trùng vài job đầu.
- **Đánh dấu trước rồi đẩy** ❌ — *ưu*: transaction ngắn nhất. *nhược*: **mất im lặng** khi
  process chết giữa hai bước. Đây là bản đầu, đã bỏ.
- **Trạng thái `DISPATCHING` + job đối soát** — *ưu*: transaction ngắn mà vẫn không mất (dòng
  kẹt ở `DISPATCHING` quá lâu thì trả về `PENDING`). *nhược*: thêm một trạng thái, một
  migration, một job nền và một hằng số timeout nữa phải chỉnh — nhiều máy móc hơn hẳn cho
  cùng một bảo đảm, ở quy mô mà lô chỉ mất vài chục mili-giây để đẩy.

## Hệ quả & trade-off chấp nhận

**Được:** bảo đảm *at-least-once* đúng như tài liệu nói. Test `4b` khoá tính chất này lại:
đẩy hỏng giữa lô thì cả 5 dòng phải quay về `PENDING`, không dòng nào kẹt ở `DISPATCHED`.

**Mất:** một ngoại lệ của luật transaction, và nó **chỉ** hợp lệ vì ba điều kiện cùng đúng —
(1) dòng bị khoá là dòng `outbox_events`, không ai ngoài relay đụng tới; (2) worker khác gặp
khoá thì `SKIP LOCKED` đi tiếp ngay, không xếp hàng; (3) Redis nằm cùng hạ tầng và transaction
có trần thời gian. Mất một trong ba thì phải xem lại.

**Xem lại khi:** đẩy sự kiện ra một hệ thống ngoài mạng nội bộ (webhook đối tác, Kafka ở xa) —
lúc đó độ trễ không còn kiểm soát được và phải chuyển sang phương án `DISPATCHING` + đối soát.
