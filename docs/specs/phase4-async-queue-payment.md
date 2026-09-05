# Spec: Async, Queue & Payment Webhook (Phase 4)

- **Phase:** 4
- **Ngày:** 2026-09-05
- **Trạng thái:** Đã implement (2026-09-05) — 6 câu hỏi mở đã chốt theo khuyến nghị

> Đây là **hợp đồng**: xây gì, API ra sao, test nào phải xanh. Phần *vì sao* — dual write,
> at-least-once, vì sao Outbox không cho exactly-once, backoff + jitter, verify chữ ký trên raw
> body — nằm ở [`tech-playbook.md` §Phase 4](../tech-playbook.md). Đọc mục đó (~15 phút) trước
> khi code.

## Mục tiêu

Phase 3 đã giữ được **oversell = 0** trên đường đồng bộ. Phase 4 xử lý mọi thứ xảy ra **sau khi
request kết thúc**: đơn `PENDING` quá 15 phút phải tự huỷ và trả hàng về kho, email xác nhận
phải gửi đúng **một** lần, và tiền vào thì đơn phải thành `PAID` — kể cả khi worker bị giết
giữa chừng, webhook đến hai lần, hay webhook đến **sau** khi đơn đã huỷ.

Deliverable chốt phase: **demo "rút dây mạng"** — giết worker giữa lúc xử lý, bật lại, không
mất message, không gửi email trùng, tồn kho không bị trả về hai lần.

## Phạm vi — 5 khối

| # | Khối | Nội dung |
|---|---|---|
| 1 | **Hạ tầng queue** | `src/infra/queue/` — kết nối BullMQ dùng lại `RedisService`, đăng ký queue, cấu hình retry/backoff/jitter/DLQ |
| 2 | **Outbox** | Bảng `outbox_events` ghi **cùng transaction** với đơn; relay worker đọc bằng `FOR UPDATE SKIP LOCKED` rồi đẩy vào queue |
| 3 | **Tự huỷ đơn quá hạn** | Delayed job 15 phút + sweeper định kỳ làm lưới an toàn; huỷ đơn và **trả tồn kho** đúng một lần |
| 4 | **Email xác nhận** | Consumer idempotent qua bảng `processed_events`; `MailSender` là interface, Phase 4 dùng bản ghi log |
| 5 | **Payment webhook** | `POST /payments/webhook` — verify HMAC trên **raw body**, trả 2xx nhanh, xử lý trong queue, state machine cấm hồi sinh đơn đã huỷ |

## API

| Method | Path | Auth | Mô tả |
|---|---|---|---|
| `POST` | `/payments/webhook` | **Không** (xác thực bằng chữ ký) | Nhận sự kiện từ cổng thanh toán |
| `POST` | `/payments/checkout/:orderId` | Access token | Tạo phiên thanh toán giả lập, trả về `paymentIntentId` |
| `GET` | `/orders/:id` | Access token | *(đã có ở Phase 3)* — bổ sung `paidAt`, `cancelledAt` vào response |

### `POST /payments/webhook`

Header bắt buộc:

```
X-Payment-Signature: t=1757000000,v1=<hex hmac-sha256>
Content-Type: application/json
```

Body (`paymentEventSchema`):

```ts
z.object({
  eventId: z.string().min(1),          // ID sự kiện của cổng — khoá chống trùng
  type: z.enum(['payment.succeeded', 'payment.failed']),
  orderId: z.string().uuid('orderId phải là UUID'),
  paymentIntentId: z.string().min(1),
  amountVnd: z.number().int().positive(),
  occurredAt: z.string().datetime(),
})
```

Đáp:

| Status | Khi nào | Ghi chú |
|---|---|---|
| `204` | Chữ ký hợp lệ, đã nhận | Trả **ngay**, xử lý nặng nằm trong queue |
| `400` | Body sai schema | |
| `401` | Chữ ký sai, thiếu header, hoặc `t` lệch quá `PAYMENT_WEBHOOK_TOLERANCE` giây | **Không** tiết lộ lý do cụ thể trong body |

`204` cũng là câu trả lời cho sự kiện **trùng** — cổng gửi lại thì vẫn phải nhận êm, không 409.

### `POST /payments/checkout/:orderId`

Chỉ tồn tại để chạy được luồng end-to-end mà không cần cổng thật (xem Câu hỏi mở #1). Trả
`404` nếu đơn không phải của user, `409` nếu đơn không còn `PENDING`.

## Schema DB

Ba bảng mới + hai cột trên `orders`.

```prisma
enum OutboxStatus {
  PENDING     /// chưa đẩy vào queue
  DISPATCHED  /// đã đẩy, không xử lý lại
  FAILED      /// cạn retry ở khâu đẩy — cần người xem
}

/// Hộp thư đi. Dòng ở đây được ghi TRONG CÙNG transaction với dữ liệu nghiệp vụ, nên không
/// bao giờ có chuyện "đơn tồn tại mà event biến mất".
model OutboxEvent {
  id          String       @id @default(uuid()) @db.Uuid
  aggregate   String                                  /// 'order'
  aggregateId String       @map("aggregate_id") @db.Uuid
  type        String                                  /// 'order.placed' | 'order.paid' | ...
  payload     Json         @db.JsonB
  status      OutboxStatus @default(PENDING)
  attempts    Int          @default(0)
  lastError   String?      @map("last_error")
  createdAt   DateTime     @default(now()) @map("created_at")
  dispatchedAt DateTime?   @map("dispatched_at")

  /// Relay quét đúng dòng cần đẩy, cũ trước. Index này LÀ điều kiện để `SKIP LOCKED` rẻ.
  @@index([status, createdAt])
  @@map("outbox_events")
}

/// Dấu "đã xử lý rồi" của consumer. Idempotency ở đây do UNIQUE của DB quyết định, giống hệt
/// cách `Idempotency-Key` làm ở Phase 3 — không SELECT-rồi-INSERT.
model ProcessedEvent {
  eventId     String   @id @map("event_id")   /// khoá tự nhiên: id sự kiện + tên consumer
  consumer    String
  processedAt DateTime @default(now()) @map("processed_at")

  @@unique([eventId, consumer])
  @@map("processed_events")
}

/// Tiền đã vào nhưng đơn không còn nhận được (đã huỷ). KHÔNG tự hoàn tiền, chỉ ghi lại đầy đủ.
model RefundRequest {
  id              String   @id @default(uuid()) @db.Uuid
  orderId         String   @map("order_id") @db.Uuid
  paymentIntentId String   @map("payment_intent_id")
  amountVnd       Int      @map("amount_vnd")
  reason          String                        /// 'ORDER_ALREADY_CANCELLED'
  correlationId   String?  @map("correlation_id")
  createdAt       DateTime @default(now()) @map("created_at")

  order Order @relation(fields: [orderId], references: [id])

  @@unique([paymentIntentId])   /// webhook lặp không tạo hai yêu cầu hoàn tiền
  @@map("refund_requests")
}
```

Thêm vào `model Order`:

```prisma
  paidAt          DateTime? @map("paid_at")
  cancelledAt     DateTime? @map("cancelled_at")
  paymentIntentId String?   @unique @map("payment_intent_id")
```

## Hàng đợi và job

Một queue duy nhất tên `flash-core`, phân biệt bằng tên job.

| Job | Ai đẩy | Retry | Backoff | Hết retry thì |
|---|---|---|---|---|
| `order.email.confirm` | Outbox relay | 5 | exponential 1s, `jitter` bật | Giữ lại làm DLQ + log `error` |
| `order.expire` | Đặt lúc tạo đơn, `delay = 15 phút` | 3 | exponential 5s + jitter | DLQ; sweeper vẫn dọn được |
| `payment.process` | Controller webhook | 5 | exponential 2s + jitter | DLQ + log `error` kèm `eventId` |
| `outbox.relay` | Repeatable, mỗi `OUTBOX_POLL_INTERVAL_MS` | — | — | Dòng chuyển `FAILED` sau 5 lần |
| `order.expire.sweep` | Repeatable, mỗi 60s | — | — | Log `error` |

**DLQ ở đây là `removeOnFail: false`** — job cạn retry nằm lại trong Redis ở trạng thái
`failed`, không biến mất. Không dựng queue riêng cho DLQ (xem Câu hỏi mở #5).

## Biến môi trường mới

| Biến | Mặc định | Ghi chú |
|---|---|---|
| `PAYMENT_WEBHOOK_SECRET` | *(bắt buộc, ≥32 ký tự)* | Không có default — thiếu là app chết lúc khởi động |
| `PAYMENT_WEBHOOK_TOLERANCE` | `300` | Giây; chống replay chữ ký cũ |
| `ORDER_HOLD_MINUTES` | `15` | Chuyển hằng số `HOLD_MINUTES` của Phase 3 thành env để test rút xuống vài giây |
| `QUEUE_CONCURRENCY` | `5` | Số job xử lý song song mỗi worker |
| `OUTBOX_POLL_INTERVAL_MS` | `1000` | |
| `OUTBOX_BATCH_SIZE` | `50` | |

## Luồng xử lý

### A. Đặt đơn → email xác nhận (Outbox)

```
POST /orders  ──► reserve tồn kho (Phase 3, không đổi)
                    │
                    ▼
              ┌─ TRANSACTION ────────────────────────┐
              │  INSERT orders                        │
              │  INSERT outbox_events (order.placed)  │  ← cùng transaction, đây LÀ Outbox
              └───────────────────────────────────────┘
                    │
                    ▼  (request kết thúc, trả 201 — KHÔNG chờ queue)

[worker] outbox.relay mỗi 1s:
   SELECT … FROM outbox_events WHERE status='PENDING'
     ORDER BY created_at LIMIT :batch FOR UPDATE SKIP LOCKED
   → queue.add('order.email.confirm', payload)
   → UPDATE outbox_events SET status='DISPATCHED', dispatched_at=now()

[worker] order.email.confirm:
   INSERT processed_events(eventId, 'email.confirm')   ← va UNIQUE ⇒ thoát êm, KHÔNG gửi lại
   mailer.send(...)
```

**Transaction boundary:** chỉ bao hai câu `INSERT`. Không gọi Redis, không gọi queue, không
gọi mailer bên trong.

### B. Tự huỷ đơn quá hạn

```
Lúc tạo đơn: queue.add('order.expire', {orderId}, { delay: ORDER_HOLD_MINUTES })
Song song:   order.expire.sweep mỗi 60s quét (status='PENDING' AND expires_at < now())

Cả hai đường đều gọi CÙNG một hàm cancelExpiredOrder(orderId):
   UPDATE orders SET status='CANCELLED', cancelled_at=now()
     WHERE id=:id AND status='PENDING' AND expires_at < now()
   → 0 dòng bị ảnh hưởng ⇒ ai đó xử lý trước rồi ⇒ RETURN, không làm gì thêm
   → 1 dòng                ⇒ trả tồn kho về (reserver.release) trong cùng transaction với UPDATE
```

Hai đường vào một hàm là cố ý: nó **bắt buộc** hàm đó phải idempotent, và đó là bài học chính
của khối này.

### C. Webhook thanh toán

```
POST /payments/webhook
  1. Đọc RAW body (chưa parse)
  2. HMAC-SHA256(`${t}.${rawBody}`, PAYMENT_WEBHOOK_SECRET) so bằng timingSafeEqual
  3. |now - t| > tolerance  ⇒ 401
  4. Parse Zod ⇒ 400 nếu sai
  5. queue.add('payment.process', event)   → trả 204 NGAY
```

```
[worker] payment.process:
   INSERT processed_events(eventId, 'payment')      ← trùng ⇒ thoát êm
   Đơn PENDING   → UPDATE … SET status='PAID', paid_at=now() WHERE id=? AND status='PENDING'
   Đơn PAID      → không làm gì (đã xử lý)
   Đơn CANCELLED → INSERT refund_requests + logger.error({orderId, paymentIntentId, correlationId})
                   TUYỆT ĐỐI không đổi status về PAID
```

## Edge cases bắt buộc xử lý

- [ ] Worker bị giết **sau** khi relay đẩy queue, **trước** khi `UPDATE status='DISPATCHED'` → job được đẩy lần hai → consumer idempotent nuốt bản trùng, email chỉ gửi một lần
- [ ] Worker bị giết **giữa** lúc xử lý `order.email.confirm` → BullMQ trả job về queue, chạy lại, không mất
- [ ] Hai worker chạy song song → `FOR UPDATE SKIP LOCKED` chia việc, không cùng đẩy một dòng
- [ ] Webhook đến **hai lần** cùng `eventId` → lần hai thoát êm, vẫn trả `204`
- [ ] Webhook đến **sau** khi đơn đã `CANCELLED` → tạo `refund_requests`, log `error`, đơn giữ nguyên `CANCELLED`
- [ ] Webhook chữ ký sai / thiếu header / `t` quá cũ → `401`, không xử lý
- [ ] Body webhook bị sửa một byte → chữ ký không khớp → `401`
- [ ] Delayed job và sweeper cùng huỷ một đơn → chỉ một đường trả tồn kho, `stock` không tăng hai lần
- [ ] User đã tự huỷ đơn, delayed job vẫn nổ 15 phút sau → conditional `UPDATE` ảnh hưởng 0 dòng → thoát êm
- [ ] SMTP/mailer lỗi tạm thời → retry có backoff **+ jitter**; lỗi vĩnh viễn (email sai định dạng) → fail thẳng, không retry
- [ ] `amountVnd` trong webhook khác `total_vnd` của đơn → **không** đánh dấu `PAID`, ghi `refund_requests` với `reason='AMOUNT_MISMATCH'` + log `error`
- [ ] Redis chết khi controller đang `queue.add` cho webhook → trả `500` để cổng retry (chấp nhận, vì cổng thanh toán nào cũng retry)

## Test cases phải pass

Integration (Testcontainers, Postgres + Redis thật) trừ khi ghi rõ:

1. Đặt đơn → có đúng 1 dòng `outbox_events` `PENDING`, ghi cùng transaction với đơn
2. Relay chạy → dòng thành `DISPATCHED`, job có trong queue
3. Chạy relay **hai lần** trên cùng dòng → chỉ một job được đẩy
4. Hai relay song song trên 50 dòng → tổng job đẩy đúng 50, không trùng (`SKIP LOCKED`)
5. Consumer email chạy hai lần cùng `eventId` → `mailer.send` được gọi đúng **1** lần
6. Giả lập worker chết giữa chừng (throw sau khi gửi, trước khi đánh dấu) → chạy lại không gửi trùng
7. Đơn quá hạn → `order.expire` huỷ đơn, `stock` tăng lại đúng số lượng
8. **Delayed job + sweeper cùng chạy trên một đơn → `stock` chỉ tăng một lần** ⭐
9. Đơn đã `PAID` → `order.expire` không huỷ, không trả kho
10. Webhook chữ ký đúng → `204`, đơn thành `PAID`, `paid_at` khác null
11. Webhook chữ ký sai → `401`, đơn giữ nguyên `PENDING`
12. Webhook `t` lệch 10 phút → `401`
13. Webhook cùng `eventId` gửi 2 lần → `204` cả hai, chỉ một lần chuyển trạng thái
14. Webhook tới đơn đã `CANCELLED` → đơn vẫn `CANCELLED`, có 1 dòng `refund_requests`, có log `error`
15. Webhook lệch số tiền → không `PAID`, có `refund_requests` `AMOUNT_MISMATCH`
16. Unit: `verifySignature` — chữ ký đúng/sai/thiếu/hết hạn, và **so sánh bằng `timingSafeEqual`**
17. Unit: `paymentEventSchema` chặn field lạ, `amountVnd` âm, `orderId` không phải uuid
18. **"Rút dây mạng"**: đặt 20 đơn → giết worker giữa chừng → bật lại → đúng 20 email, không hơn ⭐

## Definition of Done

- [x] 18/18 test case trên xanh, `npm run check` sạch
- [x] Test #8 và #18 xanh — đây là hai cổng chính của phase
- [x] Chạy **bằng tay** trên môi trường dev thật (API + worker + Postgres/Redis compose) — số
      liệu ở §Bằng chứng DoD bên dưới
- [ ] Demo "rút dây mạng" (giết worker giữa chừng) chạy bằng tay — test #18 đã tự động hoá
      đúng kịch bản đó, còn lại là nhìn tận mắt
- [x] Migration viết tay chạy đúng qua `prisma migrate deploy`
- [x] ADR cho các quyết định ở §Câu hỏi mở được chốt (ADR-004, ADR-005)
- [x] Kiến thức mới ghi vào `tech-playbook.md` §Phase 4
- [ ] Tâm tự trả lời 4 câu hỏi bản chất của Phase 4 trong `docs/SPEC.md`

## Bằng chứng Definition of Done (2026-09-05)

> Trạng thái tổng của dự án do [`CLAUDE.md` §Trạng thái hiện tại](../../CLAUDE.md) sở hữu.

**Test:** 18/18 integration mới xanh; chạy cả bộ **67/67** (49 của Phase 0–3 vẫn xanh sau khi
`OrderService`/`OrderRepository` đổi để ghi outbox và hẹn giờ huỷ đơn). Unit **70/70**.
Lint/typecheck sạch. Migration `20260905090000_add_async_queue_payment` chạy đúng ngay lần
đầu qua `prisma migrate deploy`.

Hai cổng chính:
- **#8a/#8b — huỷ đơn quá hạn:** hai đường (delayed job + sweeper) cùng chạy trên một đơn →
  đúng một đường đổi được trạng thái, `stock` trở về **10**, không phải 14.
- **#18 — "rút dây mạng":** 20 đơn, giết worker #1 bằng `close(true)` (không chờ job đang
  chạy), bật worker #2 dọn nốt → **đúng 20 email**, 20 tiêu đề khác nhau. Không mất, không trùng.

**Ba việc đổi so với spec khi làm thật:**
1. `EmailConfirmPayload` **không** mang địa chỉ email (spec ban đầu có). Lý do: đó là dữ liệu
   cá nhân nằm lại trong Redis + bảng outbox, và tra lúc gửi thì đổi email xong vẫn gửi đúng
   chỗ. Đường đặt hàng cũng không phải gánh thêm một câu `SELECT`.
2. BullMQ phải có **kết nối Redis riêng**, không dùng lại `RedisService` như spec viết —
   worker chạy lệnh blocking nên bắt buộc `maxRetriesPerRequest: null`, ngược với giá trị `1`
   mà rate limit cần. Ghi ở `tech-playbook.md` §Phase 4 → Bug hay gặp.
3. Thêm `test/infra-fixture.ts`: mặc định vẫn Testcontainers, nhưng cho phép trỏ vào
   Postgres/Redis đã chạy sẵn qua `TEST_DATABASE_URL`/`TEST_REDIS_URL` — cần cho môi trường
   không nối được `docker.sock` từ trong Jest.

**Chạy demo bằng tay:**

```bash
npm run up && npx prisma migrate deploy
npm run dev                        # terminal 1
npm run worker                     # terminal 2
node scripts/send-webhook.mjs --order <uuid> --amount <vnd>
```

### Kết quả chạy tay trên dev thật (2026-09-05)

SKU `stock = 5`, giá 250.000đ. Mọi số dưới đây đọc thẳng từ Postgres, không phải từ test.

| Bước | Kết quả quan sát được |
|---|---|
| Đặt đơn 2 cái | `PENDING`, `total_vnd = 500000`, `stock` 5 → **3** |
| Outbox | 1 dòng `order.placed`, relay đổi sang **`DISPATCHED`** trong ~1 giây |
| Email | 1 dòng `processed_events(consumer='order.email.confirm')` — gửi đúng một lần |
| `POST /payments/checkout/:id` | trả `paymentIntentId` |
| Webhook chữ ký **đúng** | `204` → đơn **`PAID`**, `paid_at` có giá trị, `payment_intent_id` khớp |
| Webhook chữ ký **sai** (đổi khoá ký) | **`401 INVALID_SIGNATURE`**, đơn không đổi |
| Webhook **trùng** `eventId`, gửi 2 lần | `204` cả hai, `processed_events` vẫn **1** dòng, `payment_intent_id` **không** bị ghi đè |
| Đơn thứ hai bị đẩy quá hạn (`expires_at` về quá khứ) | **sweeper** huỷ trong vòng 60 giây: `CANCELLED`, `cancelled_at` có giá trị, `stock` 2 → **3** (trả kho đúng một lần) |
| Webhook "đã trả tiền" tới đơn **đã huỷ** | `204`, đơn **vẫn `CANCELLED`**, `paid_at` rỗng, sinh 1 `refund_requests` `reason='ORDER_ALREADY_CANCELLED'`, `stock` **giữ nguyên 3** |

Hàng cuối là ca đáng giá nhất: hệ thống **không** hồi sinh đơn (sẽ tạo oversell ở đường sau),
**không** im lặng bỏ qua (khách mất tiền), mà để lại hồ sơ đầy đủ + log mức `error`.

## Ngoài phạm vi (Non-goals)

- **Cổng thanh toán thật** (Stripe/VNPay/MoMo) — cần secret thật và mạng ngoài, CI không chạy được
- **Gửi email thật qua SMTP** — `MailSender` là interface, Phase 4 chỉ có bản ghi log
- **Tự động hoàn tiền** — chỉ ghi `refund_requests`; hoàn tiền là quy trình nghiệp vụ, không phải code
- **Saga / distributed transaction** — một DB thì chưa cần
- **Queue riêng cho DLQ, dashboard BullMQ** — dùng trạng thái `failed` sẵn có
- **Đo hiệu năng queue** — Phase 4 đo *đúng đắn*, không đo throughput; benchmark Redis async là việc của Phase 7

## Câu hỏi mở cho Tâm quyết

> Mỗi câu đều có khuyến nghị. Nếu Tâm nói "bắt đầu code đi" mà không sửa gì, tôi hiểu là chấp
> nhận toàn bộ khuyến nghị và ghi ADR theo đó (giống cách đã làm ở Phase 2 và 3).

**1. Cổng thanh toán: sandbox thật hay giả lập trong repo?**
Khuyến nghị: **giả lập** — thêm `POST /payments/checkout/:orderId` sinh ra `paymentIntentId`, và
một script `scripts/send-webhook.mjs` ký đúng chữ ký để bắn webhook vào app. Lý do: bài học của
phase là *verify chữ ký, idempotent, webhook đến muộn* — cả ba đều học được đầy đủ với cổng giả,
mà test vẫn chạy được trong CI không cần mạng. Cổng thật chỉ thêm phần đăng ký tài khoản.

**2. Worker chạy chung process với API hay tách entrypoint?**
Khuyến nghị: **tách** — `src/worker.ts` + `npm run worker`. Không tách thì không giết được worker
mà giữ API sống, tức là **không demo được deliverable của phase**. Đổi lại: local phải chạy hai
lệnh. Cách chạy trên Cloud Run (nơi khó nuôi process nền ở free tier) để Phase 7 quyết bằng ADR.

**3. Huỷ đơn quá hạn: delayed job, sweeper, hay cả hai?**
Khuyến nghị: **cả hai**, và đó là chủ ý. Delayed job dạy cách BullMQ hẹn giờ; sweeper dạy bài học
lớn hơn — **queue có thể mất job, DB mới là sự thật**. Hai đường cùng gọi một hàm idempotent
biến "phải idempotent" từ lời khuyên thành ràng buộc test được (test #8). Chi phí: một repeatable
job mỗi 60s, quét bằng index `[status, expires_at]` đã có sẵn từ Phase 3.

**4. Trả tồn kho khi huỷ đơn: gọi `reserver.release` hay viết SQL riêng?**
Khuyến nghị: **`reserver.release`** — đã có sẵn, và với chiến lược Redis thì nó trả về **cả Redis
lẫn DB**, thứ mà một câu SQL không làm được. Ràng buộc kèm theo (đúng tinh thần ADR-003): lệnh
`UPDATE orders` và lệnh trả kho phải nằm trong **cùng một** interactive transaction ở chiến lược
optimistic/pessimistic; với Redis thì DB trước, Redis sau, hỏng thì log `error`.

**5. DLQ: `removeOnFail: false` hay một queue `*.dlq` riêng?**
Khuyến nghị: **`removeOnFail: false`**. Job cạn retry nằm lại ở trạng thái `failed` trong Redis,
xem được bằng `queue.getFailed()`. Queue riêng chỉ đáng khi cần re-drive hàng loạt có nghi thức —
chưa phải bài toán ở đây, và nó là một khái niệm mới phải nuôi.

**6. `MailSender`: interface + bản log, hay ghi thẳng vào bảng `sent_emails`?**
Khuyến nghị: **interface + bản ghi log**, và test dùng bản đếm số lần gọi. Bảng `sent_emails` nghe
có vẻ "thật" hơn nhưng nó chính là bảng `processed_events` đội tên khác — hai bảng cùng một việc
là chỗ để sinh ra bug.

## Kiến thức của phase này nằm ở đâu

[`tech-playbook.md` §Phase 4](../tech-playbook.md) — dual write, at-least-once vs exactly-once,
`SKIP LOCKED`, backoff + jitter, thundering herd, verify chữ ký trên raw body, state machine cấm
chuyển ngược. Bốn câu hỏi bản chất của phase (`docs/SPEC.md`) sẽ có đáp án ở cùng chỗ đó **sau
khi** code xong và đo thật — không viết trước.
