---
name: queue-payment-reliability
description: >
  Làm phần async và độ bền của Flash-Core: BullMQ (job gửi email, delayed job hủy đơn quá
  15 phút, retry exponential backoff + jitter, DLQ), Outbox pattern chống dual write, và
  payment webhook (verify chữ ký HMAC, idempotent consumer, xử lý webhook "đã trả tiền"
  đến SAU khi đơn đã tự hủy). Dùng skill này khi làm bất cứ thứ gì liên quan tới queue,
  job, worker, BullMQ, Redis job, gửi email, hẹn giờ, hủy đơn, retry, dead letter queue,
  outbox, event, webhook, thanh toán, VNPay/Stripe sandbox, hoàn tiền, hoặc bất cứ việc
  gì trong Phase 4. Cũng dùng khi cần trả lời at-least-once vs exactly-once, hoặc khi
  nghi có race giữa webhook và scheduled job.
---

# Async, queue và payment webhook — Phase 4

Phase này dạy một thứ khác hẳn Phase 3. Phase 3 là "hai luồng tranh nhau trong một
process"; Phase 4 là **"hệ thống gồm nhiều phần, phần nào cũng có thể chết bất cứ lúc
nào, và mình vẫn không được mất dữ liệu hay làm sai nghiệp vụ"**.

Câu hỏi xuyên suốt để tự chất vấn ở mọi dòng code trong phase này: **"nếu process chết
ngay tại đây thì hệ thống ở trạng thái gì, và ai dọn?"**

## 1. Dual write problem và Outbox pattern

Đoạn code trông vô hại này chứa một lỗi không thể sửa bằng try/catch:

```ts
await prisma.order.create({ data: order });   // (1) DB xong
await queue.add('send-email', { orderId });   // (2) chết ở đây → mãi mãi không có email
```

Hai lần ghi vào hai hệ thống khác nhau, không có transaction nào bao được cả hai. Đảo thứ
tự cũng không cứu được: push queue trước rồi DB fail thì worker sẽ xử lý một đơn không tồn
tại. Tên chuẩn: **dual write problem** (`docs/glossary.md` Phase 4).

**Outbox pattern** — ghi event vào một bảng trong DB, **cùng transaction** với dữ liệu
nghiệp vụ, rồi một worker đọc bảng đó đẩy vào queue:

```ts
await prisma.$transaction(async (tx) => {
  const order = await tx.order.create({ data: order });
  await tx.outbox.create({ data: {
    id: crypto.randomUUID(),              // = jobId sau này, để dedupe
    topic: 'order.created',
    payload: { orderId: order.id, correlationId },   // mang correlationId sang worker
  }});
});
// Hết transaction. Nếu chết ở đây, event vẫn nằm trong DB và worker sẽ đẩy sau.
```

Worker poll bảng outbox, nhiều instance cùng chạy không được lấy trùng việc — đây là chỗ
`SKIP LOCKED` đúng chỗ (khác với trừ tồn kho, nơi bỏ qua dòng bị khóa là sai nghiệp vụ):

```sql
SELECT id, topic, payload FROM outbox
WHERE  processed_at IS NULL
ORDER  BY created_at
LIMIT  100
FOR UPDATE SKIP LOCKED;
```

Outbox **không** biến hệ thống thành exactly-once: sau khi push queue thành công mà chết
trước khi `UPDATE processed_at`, event sẽ được push lần hai. Nó chuyển bài toán từ "có thể
mất" sang "có thể trùng" — và trùng thì consumer idempotent xử lý được, còn mất thì không.
Đó chính là toàn bộ giá trị của pattern này, và là câu trả lời cho câu hỏi bản chất
*"Outbox giải quyết gì mà 'ghi DB rồi push queue' không giải quyết được?"*.

## 2. At-least-once → consumer buộc phải idempotent

Không có hàng đợi thực tế nào cho **exactly-once**: để biết message đã xử lý chưa, consumer
phải ghi lại là đã xử lý, và giữa "xử lý xong" với "ghi lại" luôn có một khe hở để chết.
Vì vậy hệ thống chọn **at-least-once** và bù bằng consumer idempotent.

Cách làm trong dự án:

```ts
// Bảng processed_event: PRIMARY KEY (event_id) — dựa vào DB phân định, không dựa vào SELECT
try {
  await tx.processedEvent.create({ data: { eventId, handler: 'send-email' } });
} catch (e) {
  if (isUniqueViolation(e)) return;   // đã xử lý rồi → thoát êm, KHÔNG throw
  throw e;
}
await doTheWork();   // nằm trong cùng transaction nếu công việc là ghi DB
```

Với việc **không** ghi DB được (gửi email qua SMTP), không có transaction nào bao được cả
hai. Chọn thứ tự có hậu quả nhẹ hơn và nói rõ ra: ghi `processed_event` **trước** rồi gửi
mail → rủi ro là mất một mail khi crash đúng khe hở; ghi **sau** → rủi ro là gửi hai mail.
Với email xác nhận đơn thì gửi trùng đỡ tệ hơn là mất, nhưng đây là quyết định nghiệp vụ →
ghi ADR, đừng chọn ngầm.

Thêm một lớp nữa: đặt `jobId` = `outbox.id` khi `queue.add()`. BullMQ bỏ qua job trùng
`jobId` — chặn được phần lớn ca trùng ở tầng queue trước khi tới consumer. Nó không thay
thế bảng `processed_event` (BullMQ dọn job cũ nên jobId hết tác dụng sau một thời gian),
nhưng rẻ và hiệu quả.

## 3. Retry, backoff, jitter và DLQ

```ts
await queue.add('send-email', payload, {
  jobId: outboxId,
  attempts: 5,
  backoff: { type: 'exponential', delay: 1_000 },  // 1s, 2s, 4s, 8s, 16s
  removeOnComplete: 1_000,
  removeOnFail: false,        // giữ lại để soi — job fail không được biến mất im lặng
});
```

**Jitter quan trọng không kém backoff.** Khi SMTP sập 30 giây, 500 job cùng fail cùng lúc
và cùng thức dậy cùng lúc → đập lại vào service vừa hồi phục và làm nó sập tiếp
(thundering herd). Thêm random vào delay.

**Phân biệt lỗi tạm thời và lỗi vĩnh viễn.** SMTP timeout → retry hợp lý. Email sai định
dạng → retry 5 lần cũng vẫn sai, chỉ tốn thời gian và làm nhiễu log. Với lỗi vĩnh viễn,
dùng `UnrecoverableError` của BullMQ để đi thẳng vào failed.

**DLQ:** job cạn attempts phải nằm ở một chỗ **có người nhìn**. Tối thiểu: giữ trong
failed set + một metric `jobs_dead_total` + log ở mức `error` kèm `correlationId`. Nguyên
tắc từ `docs/glossary.md`: *job không bao giờ được biến mất im lặng*.

## 4. Delayed job hủy đơn 15 phút — và race với webhook

Đơn `PENDING` giữ chỗ 15 phút; hết hạn thì tự hủy và **trả hàng về kho** (compensating
transaction). Đặt job lúc tạo đơn:

```ts
await cancelQueue.add('cancel-expired', { orderId }, { delay: 15 * 60_000, jobId: `cancel-${orderId}` });
```

Nguy hiểm nằm ở chỗ này: **webhook "đã thanh toán" và job hủy đơn có thể chạy cùng lúc**.
Nếu cả hai đều `SELECT` thấy đơn `PENDING` rồi mỗi bên ghi trạng thái của mình, kết quả
phụ thuộc thứ tự — đúng là race condition, chỉ là ở tầng nghiệp vụ.

Cách chữa: **state machine + chuyển trạng thái có điều kiện ở DB**, không kiểm tra trong
RAM (cùng nguyên lý với Phase 3):

```sql
-- Job hủy đơn: chỉ hủy nếu vẫn còn PENDING. affected = 0 nghĩa là ai đó đã xử lý xong đơn
-- này trước mình → thoát êm, KHÔNG trả hàng về kho, KHÔNG throw.
UPDATE orders SET status = 'CANCELLED', cancelled_at = now()
WHERE id = $1 AND status = 'PENDING';
```

State machine của đơn — khai báo tường minh ở một chỗ, cấm chuyển ngược:

```
PENDING → PAID       (webhook verify OK)
PENDING → CANCELLED  (hết 15 phút, hoặc user hủy)
PAID    → REFUNDED   (hoàn tiền)
CANCELLED → ✗        (không đi đâu nữa — kể cả khi webhook tới sau)
```

Mọi hàm đổi trạng thái đi qua đúng một chỗ kiểm tra bảng chuyển tiếp này. Rải `if
(order.status === ...)` khắp service là cách chắc chắn để sinh ra một chuyển tiếp không ai
lường trước.

## 5. Payment webhook — phần "thật" nhất của dự án

Thứ tự các bước không được đổi:

1. **Đọc raw body** (Buffer, chưa qua JSON parse) — chữ ký được tính trên bytes gốc; middleware
   parse JSON rồi stringify lại sẽ đổi bytes và chữ ký sẽ không bao giờ khớp. Trong NestJS
   phải cấu hình `rawBody` cho đúng route webhook.
2. **Verify HMAC trước khi xử lý bất cứ thứ gì.** So sánh bằng
   `crypto.timingSafeEqual`, không bằng `===` — so sánh chuỗi thoát sớm ở byte đầu khác
   nhau và rò rỉ thông tin qua thời gian phản hồi. Chữ ký sai → 401, log cảnh báo, dừng.
3. **Chống replay:** kiểm tra timestamp trong payload không quá cũ (ví dụ 5 phút). Chữ ký
   đúng không có nghĩa là request mới — kẻ tấn công chụp lại được một webhook hợp lệ cũ.
4. **Idempotent theo event id của cổng thanh toán** (mục 2 ở trên). Cổng thanh toán retry
   webhook là hành vi bình thường, không phải sự cố.
5. **Trả 2xx nhanh, xử lý nặng đẩy vào queue.** Cổng thanh toán có timeout; xử lý chậm →
   nó coi là fail và retry, làm nhân bản công việc. Verify + ghi event + đẩy queue rồi trả
   200 ngay.
6. **Không tin số tiền trong webhook một cách mù quáng** — đối chiếu `amount` với tổng đơn
   trong DB. Lệch thì không đánh dấu PAID, log ở mức error để người xử lý tay.

### Case ác nhất: webhook đến SAU khi đơn đã tự hủy

`project-context.md` gọi đây là lỗ hổng lớn nhất của spec v1 và là lý do phase này tồn tại.
Tình huống: user trả tiền ở phút 14:58, webhook về ở phút 15:03, đơn đã `CANCELLED` và
hàng đã trả về kho.

Đây **không phải bug để sửa cho hết** — nó là tình huống nghiệp vụ có thật, tiền của khách
đã vào thật. Cách xử lý đúng:

- **Không** lặng lẽ bỏ qua webhook (khách mất tiền, không có đơn).
- **Không** hồi sinh đơn `CANCELLED` thành `PAID` — hàng đã trả về kho và có thể đã có người
  khác mua; hồi sinh chính là tạo ra oversell ở đường sau.
- Đúng: ghi nhận một bản ghi `payment_orphan` / `refund_required` với đầy đủ thông tin
  (event id, số tiền, orderId, thời điểm), chuyển đơn sang trạng thái cần xử lý và **tạo
  job hoàn tiền** (hoặc, nếu còn tồn kho, tạo đơn mới — nhưng đó là quyết định nghiệp vụ
  phải ghi ADR, không tự chọn).
- Log ở mức `warn`/`error` kèm `correlationId` để truy được cả hành trình.

Test bắt buộc: tạo đơn → cho job hủy chạy → **rồi mới** gửi webhook thanh toán → khẳng định
đơn không thành `PAID`, tồn kho không bị trừ lần hai, và có đúng một bản ghi cần hoàn tiền.

## 6. Chứng minh độ bền: demo "rút dây mạng"

Deliverable của Phase 4 (`docs/SPEC.md`): kill worker giữa chừng, **không mất message,
không gửi email trùng**.

Cách làm:

1. Chạy hệ thống, tạo N đơn để sinh N job.
2. `docker compose kill -s SIGKILL worker` giữa lúc worker đang xử lý (SIGKILL, không
   SIGTERM — SIGTERM là để test graceful shutdown ở Phase 5, hai thứ khác nhau).
3. Bật worker lại.
4. Khẳng định: đủ N email đã gửi (đếm qua fake SMTP như MailHog), **không có email nào
   gửi 2 lần**, bảng outbox không còn dòng `processed_at IS NULL`.

Đây là lúc `processed_event` chứng minh giá trị của nó. Nếu test này pass mà không cần
bảng đó, gần như chắc chắn test chưa kill đúng khoảnh khắc nguy hiểm.

## Sau khi implement

1. Tóm tắt luồng chạy 5–10 câu tiếng Việt (đi từ request → outbox → worker → webhook).
2. Chạy `review-gate`.
3. Câu hỏi ngược cho Tâm — dùng đúng câu hỏi bản chất của Phase 4:
   - At-least-once vs exactly-once khác nhau ở đâu, vì sao exactly-once gần như không đạt được?
   - Outbox giải quyết gì mà "ghi DB rồi push queue" không giải quyết được?
   - Vì sao phải verify chữ ký webhook, và vì sao phải verify trên raw body?
   - Webhook "đã thanh toán" đến sau khi đơn đã hủy — xử lý thế nào cho đúng nghiệp vụ?
