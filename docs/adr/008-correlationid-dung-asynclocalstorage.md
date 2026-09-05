# ADR-008: `correlationId` đi bằng AsyncLocalStorage, không truyền qua tham số

- **Ngày:** 2026-09-06
- **Trạng thái:** Đã chốt

## Bối cảnh

Phase 0 dựng `correlationId` ở `genReqId` của pino-http và ghi thẳng vào comment một món nợ:
*"id hiện chỉ có trong phạm vi HTTP request. Khi Phase 4 đẩy job vào BullMQ, id phải được nhét
vào payload job — hoặc dùng AsyncLocalStorage cho gọn."*

Đến Phase 4 thì nợ thành vấn đề thật: đơn đặt lúc 20:00:01, email lỗi lúc 20:00:04 ở một
process khác — hai sự việc **không nối được với nhau**, và deliverable của Phase 6 (*truy toàn
bộ hành trình bằng một id*) không thể đạt.

## Quyết định

Một `AsyncLocalStorage` trong `src/common/correlation/`, cộng một `mixin` của Pino đọc store
đó và gắn `correlationId` vào **mọi** dòng log.

Đúng **hai** chỗ nạp store: middleware HTTP, và `JobProcessor`. Id đi từ request → cột
`payload` của `outbox_events` → payload job → store của worker.

## Các lựa chọn đã cân nhắc

- **AsyncLocalStorage** ✅ — *ưu*: không service nào phải nhận thêm tham số lạ, và cũng không
  service nào có thể *quên* truyền; log của thư viện bên thứ ba cũng tự có id. *nhược*: "phép
  màu ngầm" — đọc `OrderService` không thấy id đến từ đâu; và ALS có chi phí nhỏ ở mỗi mắt
  xích async.
- **Truyền qua tham số** — *ưu*: hiển nhiên, đọc code là thấy. *nhược*: mọi service phải nhận
  một tham số chẳng liên quan gì tới nghiệp vụ của nó, và **chỉ cần một chỗ quên là đứt
  chuỗi** — chỗ quên đó không có test nào bắt được, và nó sẽ im lặng cho tới lúc cần tra log
  nhất.
- **Chỉ nhét id vào payload job, không có ALS** — *ưu*: ít máy móc nhất. *nhược*: `JobProcessor`
  phải tự truyền id xuống từng service, tức là quay lại nhược điểm trên, chỉ khác phạm vi.

## Hệ quả & trade-off chấp nhận

**Được:** một `grep` theo id ra được cả log của request lẫn log của job — kể cả những dòng phát
ra từ sâu trong service mà không ai chủ động truyền gì.

**Mất:** một "kênh ngầm" mà người đọc code phải biết là nó tồn tại. Đó là lý do
`correlation.store.ts` được comment kỹ hơn mức bình thường, và là lý do **chỉ có đúng hai chỗ**
được gọi `run()` — mở rộng số chỗ đó là bắt đầu mất kiểm soát.

**Xem lại khi:** cần truyền thêm ngữ cảnh (tenant, user, locale). Lúc đó đừng thêm nhiều store —
mở rộng chính object trong store này, để vẫn chỉ có một kênh.
