# Spec: Observability & Hardening (Phase 6)

- **Phase:** 6
- **Ngày:** 2026-09-05
- **Trạng thái:** Đã implement (2026-09-06)

> Hợp đồng của phase. Phần *vì sao* — liveness vs readiness, cardinality của metric, vì sao
> graceful shutdown sai thì mất dữ liệu — nằm ở
> [`tech-playbook.md` §Phase 6](../tech-playbook.md).

## Mục tiêu

Năm phase trước xây thứ **chạy đúng**. Phase này làm cho nó **nhìn được vào bên trong khi nó
chạy sai** — vì trên production, thứ mình không đo được thì mình không sửa được.

**Deliverable chốt phase:** từ một request lỗi bất kỳ, truy **toàn bộ** hành trình bằng một
`correlationId` — kể cả phần chạy trong worker, sau khi request đã kết thúc từ lâu.

## Vấn đề hiện tại (đo được, không phải phỏng đoán)

Ba món nợ đã ghi từ trước, đến hạn trả ở phase này:

| Nợ | Ghi ở đâu | Hậu quả nếu để nguyên |
|---|---|---|
| `correlationId` **chết ở biên HTTP** — không đi vào job | `logger.module.ts` (ghi từ Phase 0) | Đơn đặt lúc 20:00, email lỗi lúc 20:01 — hai sự việc **không nối được với nhau** |
| `/ready` trả 503 bị log mức **`error`** | `architecture.md` §Một chỗ chưa ổn | Postgres chớp 2 phút ⇒ hàng chục dòng `error` ⇒ cảnh báo kêu sai ⇒ người ta tắt tiếng nó |
| `/ready` **không kiểm Redis** | — | Redis chết thì đặt đơn (chiến lược `redis`) và mọi job đều hỏng, nhưng instance vẫn báo "sẵn sàng" |

## Phạm vi — 4 khối

| # | Khối | Nội dung |
|---|---|---|
| 1 | **correlationId xuyên suốt** | `AsyncLocalStorage` + mixin của Pino; HTTP middleware và worker cùng nạp vào một chỗ |
| 2 | **Metrics** | `prom-client`, endpoint `GET /metrics`, 4 metric hạ tầng + 4 metric nghiệp vụ |
| 3 | **Health cứng hơn** | `/ready` kiểm cả Redis; 503 của readiness log mức `warn`, không phải `error` |
| 4 | **Graceful shutdown** | Nhận SIGTERM → `/ready` trả 503 ngay → chờ `SHUTDOWN_GRACE_MS` → mới đóng |

## Khối 1 — correlationId xuyên suốt

**Cơ chế:** một `AsyncLocalStorage<{ correlationId }>` trong `src/common/correlation/`.

- **HTTP:** middleware chạy sớm nhất, lấy id từ `genReqId` rồi `store.run(...)` cho toàn bộ
  phần còn lại của request.
- **Worker:** `JobProcessor` đọc `correlationId` từ payload job rồi `store.run(...)` quanh lời
  gọi service. Job không có id (job lặp) thì sinh id mới.
- **Pino:** một `mixin` đọc store và gắn `correlationId` vào **mọi** dòng log, kể cả log không
  thuộc request nào. Nhờ vậy không service nào phải tự truyền id đi.

**Id đi vào job bằng đường nào:**

```
POST /orders  ──► outbox_events.payload.correlationId   ← ghi cùng transaction
                    │
                    ▼  relay đọc payload
              queue job payload.correlationId
                    │
                    ▼  JobProcessor
              AsyncLocalStorage ⇒ mọi log của job mang đúng id đó
```

Chọn **payload tường minh** chứ không "worker tự sinh": id phải là id của request đã tạo ra
việc đó, nếu không thì nối lại được đúng một nửa hành trình.

## Khối 2 — Metrics

`GET /metrics` trả định dạng Prometheus text. **Không auth** (xem §Câu hỏi mở #2).

**Hạ tầng:**

| Metric | Kiểu | Nhãn |
|---|---|---|
| `http_requests_total` | Counter | `method`, `route`, `status` |
| `http_request_duration_seconds` | Histogram | `method`, `route` |
| `process_*`, `nodejs_*` | mặc định của `prom-client` | — |

**Nghiệp vụ — đây mới là phần đáng giá:**

| Metric | Kiểu | Trả lời câu gì |
|---|---|---|
| `orders_placed_total` | Counter (`result`: `created`/`out_of_stock`/`duplicate`) | Bán được bao nhiêu, từ chối bao nhiêu, **vì sao** từ chối |
| `inventory_reserve_duration_seconds` | Histogram (`strategy`) | Chiến lược nào đang chậm — nối thẳng với benchmark Phase 3 |
| `outbox_pending` | Gauge | Hộp thư đi có đang ùn không (số này tăng đều = relay chết) |
| `queue_jobs_total` | Counter (`job`, `outcome`: `completed`/`failed`) | Job nào hay hỏng |

**Luật cardinality:** nhãn **không bao giờ** được chứa `orderId`, `userId`, `skuId` hay bất cứ
giá trị không giới hạn nào. `route` phải là **mẫu route** (`/orders/:id`), không phải đường dẫn
thật. Vi phạm luật này là cách làm sập Prometheus nhanh nhất.

## Khối 3 — Health cứng hơn

```ts
ReadinessReport = {
  ready: boolean,
  checks: { database: 'up' | 'down', redis: 'up' | 'down' },
}
```

- `/health` (liveness) **không đổi**: không kiểm dependency nào. DB chết mà restart container
  thì không chữa được gì, chỉ mất thêm request app vẫn xử lý được.
- `/ready` kiểm **cả hai**, `ready = database && redis`.
- 503 do readiness **log mức `warn`**. Cách chọn: thêm `logLevel` vào `DomainError` (hướng thứ
  hai trong `architecture.md`) — sạch hơn là gắn luật của một endpoint vào filter dùng chung.

## Khối 4 — Graceful shutdown

```
SIGTERM
  ├─ 1. đặt cờ shuttingDown = true  ⇒ /ready trả 503 NGAY
  │     (load balancer ngừng gửi request mới — nhưng nó cần vài giây để nhận ra)
  ├─ 2. chờ SHUTDOWN_GRACE_MS (mặc định 5s) — request đang chạy dở vẫn xong bình thường
  └─ 3. app.close() ⇒ đóng pool, đóng Redis, đóng queue
```

Thiếu bước 2 là **cắt ngang request đang xử lý** mỗi lần deploy. Đây là lý do "deploy xong có
vài đơn lỗi" mà không ai lần ra được.

Worker đã có phần này từ Phase 4 (`worker.close()` chờ job đang chạy xong) — Phase 6 làm nốt
cho API.

## Biến môi trường mới

| Biến | Mặc định | Ghi chú |
|---|---|---|
| `METRICS_ENABLED` | `true` | Tắt được để đo chi phí của chính việc đo |
| `SHUTDOWN_GRACE_MS` | `5000` | Thời gian chờ sau khi `/ready` chuyển 503 |

## Edge cases bắt buộc xử lý

- [ ] Job lặp (relay, sweeper) không có `correlationId` trong payload → sinh id mới, **không** ném lỗi
- [ ] Hai job chạy song song → mỗi job có store riêng, id không lẫn sang nhau
- [ ] Log phát ra ngoài mọi request và mọi job (ví dụ lúc khởi động) → không có `correlationId`, và đó là **đúng**, không phải lỗi
- [ ] Redis chết → `/ready` 503 nhưng `/health` vẫn 200 (container không bị restart)
- [ ] Cả Postgres lẫn Redis chết → `/ready` 503, body nói rõ **cả hai** đều `down`
- [ ] `/metrics` gọi khi `METRICS_ENABLED=false` → `404`, không phải trang rỗng
- [ ] Nhãn `route` của một đường dẫn có tham số → phải là `/orders/:id`, tuyệt đối không phải `/orders/<uuid>`
- [ ] SIGTERM giữa lúc có request đang chạy → request đó **chạy xong**, không bị cắt
- [ ] SIGTERM hai lần liên tiếp → không sập giữa chừng, lần hai bị bỏ qua

## Test cases phải pass

1. Log của một request bất kỳ đều mang đúng `correlationId` từ header gửi vào
2. Không gửi header → sinh id mới, và id đó có trong response header
3. **Đặt đơn → dòng `outbox_events` mang đúng `correlationId` của request đó** ⭐
4. Relay đẩy job → payload job mang `correlationId` từ outbox
5. **`JobProcessor` chạy job → log của service bên trong mang đúng `correlationId` đó** ⭐
6. Job lặp không có id → vẫn chạy, log mang một id mới sinh
7. Hai job song song → hai id khác nhau, không lẫn
8. `/ready` khi Redis chết → 503, `checks.redis = 'down'`, `checks.database = 'up'`
9. `/ready` 503 → log ở mức `warn`, **không** phải `error`
10. `/health` khi Redis chết → vẫn 200
11. `GET /metrics` → 200, có `http_requests_total` và `orders_placed_total`
12. Gọi `POST /orders` rồi `/metrics` → `orders_placed_total{result="created"}` tăng đúng 1
13. Đặt đơn khi hết hàng → `orders_placed_total{result="out_of_stock"}` tăng, **không** phải `created`
14. Nhãn `route` là mẫu route, không chứa uuid
15. `METRICS_ENABLED=false` → `/metrics` trả 404
16. SIGTERM → `/ready` chuyển 503 trước khi process thoát ⭐

## Definition of Done

- [x] Test case xanh (**15 integration mới, tổng 89**), `npm run check` sạch
- [ ] **Deliverable**: đặt một đơn, lấy `correlationId` ở response header, `grep` ra được **cả**
      log của request **lẫn** log của job gửi email — dán kết quả vào §Bằng chứng DoD
- [x] Ba món nợ ở §Vấn đề hiện tại đều đã trả
- [x] ADR-008 cho quyết định AsyncLocalStorage
- [x] Kiến thức mới ghi vào `tech-playbook.md` §Phase 6
- [ ] Tâm tự trả lời 3 câu hỏi bản chất của Phase 6

## Ngoài phạm vi (Non-goals)

- **Distributed tracing** (OpenTelemetry, Jaeger) — một hệ thống, một process chính; tracing
  giải bài toán *nhiều service*, chưa phải bài toán ở đây. `correlationId` làm đủ việc
- **Grafana / Alertmanager / dashboard** — cần hạ tầng luôn chạy, trái ràng buộc FinOps 0đ
- **Log aggregation** (Loki, ELK) — Cloud Run đã gom stdout sẵn ở Phase 7
- **SLO/error budget** — cần lưu lượng thật mới có nghĩa
- **Rate limit toàn cục, WAF, security headers** — Phase 7 nếu còn thời gian

## Câu hỏi mở cho Tâm quyết

> Mỗi câu có khuyến nghị. Không sửa gì thì tôi hiểu là chấp nhận, và ghi ADR theo đó.

**1. `AsyncLocalStorage` hay truyền `correlationId` qua tham số?**
Khuyến nghị: **AsyncLocalStorage**. Truyền tham số thì mọi service phải thêm một tham số không
liên quan gì tới nghiệp vụ của nó, và **chỉ cần một chỗ quên là đứt chuỗi** — mà chỗ quên đó
không có test nào bắt được. ALS trả giá bằng "phép màu ngầm": đọc code không thấy id được
truyền đi đâu. Đánh đổi này đáng, và Phase 0 cũng đã ghi sẵn hướng này.

**2. `/metrics` có cần auth không?**
Khuyến nghị: **không**, nhưng ghi rõ là nợ. Metrics ở đây không chứa dữ liệu cá nhân (luật
cardinality cấm), và Cloud Run ở Phase 7 sẽ chặn bằng ingress chứ không bằng token. Thêm auth
bây giờ là thêm một khoá nữa phải quản mà chưa chống được mối đe doạ nào có thật.

**3. Thêm `logLevel` vào `DomainError`, hay xử lý riêng 503 trong filter?**
Khuyến nghị: **thêm `logLevel` vào `DomainError`** (mặc định suy ra từ `httpStatus`). Nó trả
lời đúng câu hỏi *"lỗi này có đáng gọi người dậy lúc 3 giờ sáng không"* — và đó là thuộc tính
của **lỗi**, không phải của filter. `architecture.md` đã cân hai hướng này từ Phase 0.

**4. Metric nghiệp vụ đặt ở đâu?**
Khuyến nghị: **trong service nghiệp vụ**, không phải interceptor. Interceptor chỉ biết
HTTP status, mà `201` và `409` không nói được "vì sao từ chối". `orders_placed_total{result}`
chỉ đúng khi đếm ở nơi biết lý do.

## Bằng chứng Definition of Done (2026-09-06)

**Test:** 15 integration mới xanh; cả bộ **89/89** (74 của Phase 0–5 vẫn xanh), unit **77/77**,
lint/typecheck sạch.

Ba cổng chính:
- **#3** — đặt đơn kèm header `x-correlation-id` → dòng `outbox_events` mang **đúng** id đó.
- **#5** — `JobProcessor` chạy job → service bên trong đọc được **đúng** id từ payload, xuyên
  qua `await`. Đây là mắt xích khiến chuỗi log nối được qua ranh giới process.
- **#14** — nhãn `route` là `/orders/:id`, **không** chứa uuid. Luật cardinality được khoá bằng
  test chứ không bằng lời dặn.

**Ba món nợ đã trả:**

| Nợ | Trả bằng |
|---|---|
| `correlationId` chết ở biên HTTP | `common/correlation/` + mixin Pino + payload job ([ADR-008](../adr/008-correlationid-dung-asynclocalstorage.md)) |
| `/ready` 503 log mức `error` | `DomainError.logLevel` + `NotReadyError` — lỗi tự khai mức log của mình |
| `/ready` không kiểm Redis | `checkRedis()` bằng `PING`, chạy song song với `SELECT 1` |

**Một thay đổi ngoài spec, tìm ra khi chạy cả bộ test:** `test/infra-fixture.ts` giờ **tự xoá
và tạo lại schema** khi dùng lối thoát `TEST_DATABASE_URL`. Lần chạy thứ hai đỏ hàng loạt vì dữ
liệu lần trước còn đó (`auth.e2e-spec` đăng ký lại email cũ → 409). Kèm hàng rào: từ chối chạy
nếu tên database không kết thúc bằng `_test` — xoá schema là thao tác không hoàn tác được, nên
không thể phụ thuộc vào việc con người nhớ.