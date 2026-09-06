# Flash-Core — Săn Flash Sale Áo Thun

## Dự án này là gì
API Engine cho hệ thống săn flash sale áo thun, kiến trúc **Modular Monolith**.
Nghiệp vụ: các đợt sale mở đúng giờ, mẫu áo hot số lượng giới hạn **theo từng SKU
biến thể (size × màu)**, hàng nghìn user cùng bấm "Săn ngay" → bài toán cốt lõi là
concurrency (oversell = 0), async/queue, payment webhook, observability.

**Mục đích thật của dự án:** chủ repo (Tâm) dùng dự án để học bản chất hệ thống lớn
và làm portfolio. AI viết code, Tâm viết spec + review + ra quyết định. Vì vậy:
**code phải dễ đọc, dễ giải thích — ưu tiên rõ ràng hơn thông minh.**

## Tài liệu bắt buộc đọc

`docs/README.md` là **bản đồ tài liệu**: thông tin nào thuộc file nào, mở file nào khi nào.
Luật cứng của cả hệ tài liệu: **mỗi thông tin có đúng một chủ sở hữu; file khác chỉ trỏ link,
không chép lại.** Ba ranh giới quan trọng nhất:

| Loại thông tin | Chủ sở hữu duy nhất |
|---|---|
| **Kiến thức** (cơ chế, bug thật, số đo, đáp án câu hỏi bản chất, ôn phỏng vấn) | `docs/tech-playbook.md` |
| **Hợp đồng** một tính năng (API, schema, edge case, test case, bằng chứng DoD) | `docs/specs/` |
| **Trạng thái** (đang ở phase nào, còn nợ gì) | §Trạng thái hiện tại của chính file này |

Vì vậy: **viết kiến thức mới thì viết vào `tech-playbook.md`**, không viết vào spec; spec chỉ
được giữ *bằng chứng* (số test, số đo, cấu hình chạy lại), không giữ trạng thái.

- `docs/onboarding.md` — **lộ trình cho người mới** (6 buổi, có bài thực hành phá code rồi
  sửa). Nó KHÔNG chứa kiến thức — nó sở hữu *thứ tự học* và các bài thực hành, còn kiến thức
  vẫn trỏ về `tech-playbook.md`. Khi Tâm hỏi "học lại từ đâu", trỏ vào file này.
- `docs/hoc/index.html` — **giáo trình 8 phase** (HTML, mở bằng trình duyệt). Sở hữu *sơ đồ*:
  nghiệp vụ + vòng đời đơn hàng + vai trò từng module ở trang đầu, rồi mỗi phase một trang có
  sơ đồ cơ chế, cấu trúc file, cách code, cách test, tiêu chí qua phase và mục "bị chỉ vào thì
  trả lời thế nào". Nó KHÔNG giữ kiến thức mới — mọi câu "vì sao" bám sát `tech-playbook.md`
  và trỏ link về đó. Kèm **bộ theo dõi hiểu bài**: 113 ý, tick vào là % của phase tăng lên, danh
  sách ý nằm ở `docs/hoc/assets/track.js` (nguồn sự thật duy nhất — sửa ý thì sửa ở đó, cả
  checklist lẫn bảng tổng đều sinh ra từ nó). Tiến độ lưu ở `localStorage`, **không vào git**.
- `docs/architecture.md` — bản đồ code: file nào làm gì, định nghĩa ở đâu, ba quy tắc
  cấu trúc. Đọc trước khi thêm/sửa file trong `src/`.
- `docs/SPEC.md` — spec gốc: 8 phase, deliverable, Definition of Done
- `docs/adr/` — các quyết định kiến trúc đã chốt
- `docs/review-checklist.md` — checklist Tâm dùng để review code của bạn
- `docs/glossary.md` — từ điển **tên gọi**, một dòng mỗi mục. Khi giải thích, ưu tiên dùng
  đúng các thuật ngữ trong file này để Tâm quen dần với từ vựng chuẩn. Dài hơn một dòng thì
  nó thuộc `tech-playbook.md`, không thuộc đây.
- `docs/tech-playbook.md` — **nguồn kiến thức duy nhất**. Mục **§Xuyên suốt — CI & Testing**
  là phần Tâm tự nhận còn yếu nhất (GitHub Actions và testing): khi chạm tới CI hoặc test thì
  giải thích kỹ hơn mức mặc định, và cập nhật mục đó khi CI/bộ test đổi. Khi giải thích
  "vì sao", bám sát cách diễn đạt ở file này để Tâm không phải học hai phiên bản.
- `docs/git-workflow.md` — quy chuẩn nhánh, commit message, **cách đóng phase (đúng 3 chỗ
  phải sửa)**, và **quy tắc AI không push trước khi Tâm review**. Dùng `/commit`.
- `project-context.md` — nhật ký quyết định: **vì sao** chọn thế này và **những gì đã
  bị loại bỏ có chủ đích**. Đọc trước khi đề xuất bất cứ thay đổi kiến trúc nào.

## Tech stack (đã chốt — không tự ý đổi)
- **NestJS + TypeScript** (strict mode), validation bằng **Zod** (không dùng class-validator)
- **PostgreSQL 16** + **Prisma** (pessimistic lock dùng `$queryRaw` trong interactive transaction)
- **Redis + BullMQ** (queue, delayed jobs, DLQ), Lua script cho atomic decrement
- **Jest + Supertest + Testcontainers** (integration test chạy trên Postgres/Redis thật)
- **k6** cho load test (chạy LOCAL, không bắn lên cloud)
- **Docker Compose** cho local, deploy **GCP Cloud Run** (region us-central1, free tier) + Neon Postgres + Upstash Redis
- Auth: Argon2, Access + Refresh Token (HttpOnly Cookie), Refresh Token Rotation

## Quy trình làm việc (bắt buộc)
1. **Không có spec → không code.** Tính năng mới phải có file trong `docs/specs/`
   theo `docs/templates/feature-spec-template.md`. Nếu Tâm yêu cầu code mà chưa có
   spec, hãy đề nghị viết spec trước (bạn có thể draft, Tâm duyệt).
2. **Test là hợp đồng.** Viết test theo danh sách test case trong spec TRƯỚC hoặc
   cùng lúc với implement. Mọi test phải pass trước khi coi là xong.
3. **Quyết định kiến trúc → tạo ADR** trong `docs/adr/` theo template (5–10 dòng).
4. **Tài liệu phải đúng ở mỗi commit.** Sửa code làm lệch tài liệu nào thì sửa luôn trong
   cùng commit. Ba chỗ hay lệch: `docs/architecture.md`, `README.md` (gốc repo),
   §Trạng thái hiện tại của file này. Bản HTML sinh lại bằng `npm run docs:html`.
5. **Giải thích khi được hỏi**, ở mức bản chất (cơ chế + trade-off).

### Cách nói chuyện với Tâm (chốt 2026-08-07)
- **Ngắn.** Trả lời xong việc thì dừng. Không tóm tắt luồng chạy 5–10 câu, không liệt kê
  "điểm cần đọc kỹ", trừ khi Tâm hỏi.
- **Không kiểm tra ngược.** Không kết thúc bằng câu hỏi bắt Tâm trả lời. Chỗ nào đáng chú ý
  thì nói thẳng **kèm lời giải đáp ngay**. Lý do: bị hỏi liên tục biến mỗi lượt thành bài
  kiểm tra và làm mất động lực.
- **Đi từ đơn giản lên.** Giải thích bằng thứ Tâm đã biết (REST, SQL, async/await, Docker),
  không nhảy thẳng vào khái niệm nâng cao. Thấy cần khái niệm mới thì nêu tên nó, giải thích
  một câu, rồi mới dùng.
- **Tự quyết việc nhỏ.** Tách commit, đặt tên biến, chọn chỗ để file — tự làm rồi báo, đừng
  hỏi. Chỉ hỏi khi quyết định ảnh hưởng kiến trúc hoặc tốn tiền.

## Convention code
- Cấu trúc module NestJS: `src/modules/<tên-module>/` gồm controller, service,
  repository, dto (Zod schema), spec test. Module không import trực tiếp
  service của module khác — chỉ qua public interface được export.
- Tiền tệ: lưu số nguyên (VND, không có phần thập phân). Không dùng float cho tiền.
- Mọi API ghi (POST/PUT) liên quan đơn hàng phải nhận `Idempotency-Key` header.
- Log bằng Pino, JSON, luôn kèm `correlationId`. Không log dữ liệu nhạy cảm
  (password, token, số thẻ).
- Lỗi: dùng exception filter thống nhất, không nuốt lỗi (không có catch rỗng).
- Transaction boundary phải hẹp nhất có thể; không gọi API ngoài trong transaction.

## Ngân sách tài liệu (luật cứng)
Cuối Phase 0 đo được **1 dòng code : 5 dòng nói về code** (990 vs 5 050). Sai hướng với một
dự án mục tiêu là học công nghệ, nên đã cắt mạnh ngày 2026-08-07 (`.claude/` từ 3 098 còn
~350 dòng: xoá 10 skill, 6 hook, 5 command, 1 agent). Từ đây:
- **Mỗi phase tối đa MỘT file tài liệu mới.** Còn lại là code, test, ADR.
- **Không thêm skill/hook/command mới.** Cấu hình Claude Code không phải kỹ năng backend.
- Không tạo checklist riêng cho từng phase. `docs/phase-0-checklist.md` là ngoại lệ duy nhất.
- ADR thì cứ viết — nó ép nói ra trade-off, đó là học thật.

Nếu Tâm yêu cầu thêm tài liệu mà ngân sách đã hết, **nói ra tỉ lệ hiện tại trước khi làm**.

## Điều cấm
- Không thêm công nghệ mới (Kafka, K8s, microservices...) — nếu thấy cần, đề xuất
  qua ADR để Tâm quyết, không tự thêm.
- Không chạy load test / seed dữ liệu lớn lên môi trường cloud (free tier).
- Không hardcode secret; dùng env qua config module có validate bằng Zod.

## Bộ công cụ Claude Code (đã tinh gọn 2026-08-07)

**2 lệnh:** `/commit` · `/spec`

**3 hook** — chỉ chặn thứ gây mất mát thật, không hỏi han lặt vặt:

| Hook | Chặn |
|---|---|
| `guard_git_push.py` | Mọi `git push` — chỉ Tâm push sau khi review |
| `guard_cloud_cost.py` | `k6 run` / seed / `migrate reset` khi biến kết nối trỏ ra cloud |
| `guard_secret_files.py` | Ghi vào `.env`, hoặc hardcode secret trong source |

Nếu hook chặn, **đừng tìm cách lách** — dừng lại và báo Tâm.

**MCP** — Context7 (tra tài liệu đúng phiên bản NestJS/Prisma/BullMQ/Zod).

Đã xoá: 10 skill, 6 hook, 5 command, 1 agent, `docs/claude-guide.md`, `docs/mcp-setup.md`.
Lý do: chúng chiếm 3 098 dòng — gấp ba lần code — và làm mỗi lượt sửa/commit dài lê thê.
Muốn xem lại thì `git log -- .claude/`.

## Ghi chú kỹ thuật đã chốt ở Phase 0 (khác tài liệu cũ trên mạng)
- **Prisma 7**: `datasource.url` KHÔNG còn trong `schema.prisma` — nằm ở `prisma.config.ts`.
  `PrismaClient` phải nhận driver adapter (`@prisma/adapter-pg` bọc `pg.Pool`).
  Prisma Client được generate vào `src/generated/prisma`, không phải node_modules.
- **TypeScript 6** (không dùng TS 7 vì `ts-jest` chưa hỗ trợ). `module`/`moduleResolution`
  = `node16`, và `types` khai báo tường minh trong tsconfig.
- **Không dùng path alias `@/`** — `nest build` không rewrite alias. Dùng import tương đối.
- **Prisma Client sinh import kèm đuôi `.js`** nhưng file thật là `.ts` → jest cần
  `moduleNameMapper: {'^(\\.{1,2}/.*)\\.js$': '$1'}`. Sau khi đổi tsconfig thì **phải
  `npm run db:generate` lại**, nếu không máy vẫn xanh mà CI đỏ.
- **Prisma 7 tải query compiler bằng WASM qua `await import(...)`** — luôn vậy, kể cả
  generator đã đặt `moduleFormat = "cjs"` (cờ đó không đổi cách tải WASM). Jest chạy test
  trong `vm.Context` nên cần cờ `node --experimental-vm-modules` mới `import()` được — đã
  thêm vào script `test:int`. Không lộ ở unit test vì `PrismaService` luôn bị mock ở đó.
  Chi tiết: `docs/tech-playbook.md` §Xuyên suốt → Testing → Bug hay gặp.
- Lệnh hay dùng: `npm run check` (lint + typecheck + test), `npm run up`, `npm run db:generate`.

## Trạng thái hiện tại
- Phase hiện tại: **Phase 6 — Observability** (bắt đầu 2026-09-06). **Phase 4 ĐÃ ĐÓNG** 2026-09-05.
- **Phase 0 ĐÃ ĐÓNG** 2026-08-08 — hồ sơ ở `docs/phase-0-checklist.md`. Kết quả: skeleton
  NestJS + config Zod + Pino/correlationId + exception filter + Prisma 7 (pg adapter) +
  module `health` + Docker Compose + CI xanh + ESLint chặn import sâu. **16/16 test pass**.
  2 ADR (`docs/adr/001`, `002`).
- **Phase 1 — code + test xong**, chưa đóng chính thức (chờ Tâm review + push): module `auth` (register/login/refresh/logout/me), `infra/
  redis`, migration đầu tiên. **14/14 test case pass** — 21 unit + 12 integration
  (`test/auth.e2e-spec.ts`), kể cả test số 8 (reuse detection).
- **Phase 2 — HOÀN TẤT theo Definition of Done**, xác nhận trên Postgres/Redis thật, theo
  `docs/specs/phase2-product-inventory.md`: module `product` (CRUD Product/SKU biến thể,
  cursor pagination, GIN index cho JSONB), migration mới (viết tay, chạy đúng ngay lần đầu),
  seed 100k dòng (`npm run seed`, đã chạy thật: 10.000 Product / 100.000 ProductSku). **28/28
  integration test** + **43/43 unit test** pass, lint/typecheck/build sạch. Bằng chứng
  `EXPLAIN (ANALYZE, BUFFERS)` test #14 (keyset ~50× nhanh hơn offset ở cùng vị trí trong
  100k dòng) và #15 (Seq Scan thắng GIN trên 10k dòng — bài học "đo trên dữ liệu thật", không
  phải index luôn thắng) đã dán vào §Trạng thái thật cuối spec. Hai bug thật tìm thấy khi
  chạy trên môi trường thật: guard dùng chéo module thiếu dependency (2 phần, xem
  `docs/architecture.md` §Những chỗ dễ vấp), và seed thiếu `updated_at` khi insert thẳng.
  **Definition of Done đủ 6/6** — 3 câu hỏi bản chất đã có trả lời (Claude trả lời theo yêu
  cầu trực tiếp, ghi rõ nguồn trong spec, không tính là Tâm tự kiểm tra hiểu bài). Còn lại:
  Tâm review diff + push.
- **Biến môi trường mới** (Phase 1) phải thêm vào `.env` và `.env.example`: `JWT_ACCESS_SECRET`,
  `JWT_REFRESH_SECRET` (mỗi cái ≥32 ký tự). Thiếu là app chết lúc khởi động.
- **Phase 3 — HOÀN TẤT Definition of Done** (49/49 integration + benchmark k6) theo
  `docs/specs/phase3-order-concurrency.md`: module `order` (đặt hàng, Idempotency-Key,
  snapshot price, cursor pagination đơn), **3 chiến lược chống oversell** đổi bằng
  `INVENTORY_STRATEGY` (optimistic / pessimistic `SELECT FOR UPDATE` / Redis Lua), migration
  `Order`/`OrderItem` + cột `ProductSku.version`, ADR-003 chốt module nào sở hữu logic trừ kho.
  **54/54 unit test pass**, lint/typecheck/build sạch. Cursor pagination chuyển từ
  `modules/product/` ra `common/pagination/` vì đã có 2 module dùng.
  **Test #8 (cổng chính) xanh ở cả ba chiến lược**: 200 request song song → đúng 100 đơn,
  100 lần 409, `stock` = 0, không 5xx. Oversell = 0.
  **Benchmark test #16 xong** (1.000 VU, 4 cấu hình): oversell = 0 ở cả bốn, 0 lỗi 5xx. Ba
  kết quả ngược trực giác — pessimistic nhanh nhất (900/1.000 request là "hết hàng", ca đó nó
  tốn 1 round-trip còn optimistic tốn 2), pool 50 chậm hơn pool 10, Redis chưa nhanh hơn vì
  Phase 3 còn ghi DB đồng bộ. Số + lý do ở §Bằng chứng test #16 cuối spec và
  `docs/tech-playbook.md` §Phase 3. Một bug thật tìm được khi benchmark: `generateSkuCode`
  cắt slug 16 ký tự làm trùng `sku_code` → 500; đã sửa bằng 4 ký tự băm.
  **Còn lại:** Tâm tự trả lời 3 câu hỏi bản chất, review + push. k6 nằm ở `.tools/k6`
  (gitignore) — Homebrew không cài được vì sandbox chặn đọc `/etc/ssl/cert.pem`.
- **Phase 4 ĐÃ ĐÓNG** 2026-09-05 — Definition of Done đủ 8/8, theo
  `docs/specs/phase4-async-queue-payment.md`: `infra/queue` (BullMQ, kết nối riêng vì worker
  cần `maxRetriesPerRequest: null`), module `outbox` (hộp thư đi + dấu idempotent), `mail`,
  `payment` (verify HMAC trên raw body, cổng giả lập), `OrderExpiryService` (huỷ đơn quá hạn
  bằng **cả** delayed job **lẫn** sweeper), `OrderNotifier`, worker tách process
  (`npm run worker`), migration `20260905090000_add_async_queue_payment` (3 bảng + 3 cột).
  **21/21 integration test mới xanh, tổng 70/70**; unit **74/74**; lint/typecheck sạch.
  Hai cổng chính đều xanh: **#8 hai đường huỷ đơn → tồn kho chỉ trả một lần**, **#18 "rút dây
  mạng" → đúng 20 email, không hơn**, **#4b đẩy queue hỏng giữa lô → cả lô về `PENDING`,
  không mất sự kiện**. 3 ADR mới (`004` ghi dấu trước khi gửi mail, `005` worker chạy process
  riêng, `006` relay giữ transaction khi đẩy queue).
  **Một lỗi thật đã sửa trong lúc rà lại:** relay bản đầu đánh dấu `DISPATCHED` rồi commit
  TRƯỚC khi `queue.add` — process chết ở khe giữa là mất sự kiện im lặng, phá đúng lời hứa của
  phase. Đã đảo thành đẩy-trước-đánh-dấu-sau trong cùng transaction (ADR-006).
  **Biến môi trường mới bắt buộc:** `PAYMENT_WEBHOOK_SECRET` (≥32 ký tự) — thiếu là app chết
  lúc khởi động. Thêm 5 biến có mặc định: `ORDER_HOLD_MINUTES`, `PAYMENT_WEBHOOK_TOLERANCE`,
  `QUEUE_CONCURRENCY`, `QUEUE_PREFIX`, `OUTBOX_POLL_INTERVAL_MS`, `OUTBOX_BATCH_SIZE`.
  **`QUEUE_PREFIX` đáng nhớ:** BullMQ chia job cho mọi tiến trình cùng Redis + cùng tiền tố,
  nên worker đang chạy trên máy dev sẽ nuốt job của integration test nếu không tách tiền tố.
  **Demo "rút dây mạng" đã chạy tay** (Tâm, 2026-09-05): 20 đơn, giết worker giữa chừng, bật
  lại → outbox còn chờ = 0, email đã gửi = 20. Không mất, không trùng.
  **4 câu hỏi bản chất đã có đáp án** ở `tech-playbook.md` §Phase 4 (Claude viết theo yêu cầu
  trực tiếp của Tâm 2026-09-05, ghi rõ nguồn — không tính là Tâm tự kiểm tra hiểu bài).
- **Lưu ý môi trường:** sandbox chặn Jest nối `docker.sock` (`connect EPERM`) dù `docker` CLI
  chạy được ⇒ Testcontainers báo "Could not find a working container runtime strategy". Lối
  thoát đã có sẵn: `TEST_DATABASE_URL`/`TEST_REDIS_URL` trỏ vào Postgres/Redis của
  `npm run up` (xem `test/infra-fixture.ts`). CI vẫn dùng Testcontainers như cũ.
- **Phase 5 — code + test xong**, chờ Tâm review + push, theo `docs/specs/phase5-ui-demo.md`:
  `public/index.html` + `styles.css` + `app.js` (**không framework, không build step** —
  ADR-007 đổi lại quyết định Vite+React trong SPEC.md), Nest phục vụ tĩnh bằng
  `useStaticAssets` + `AppController` cho route `GET /`. 4 màn: Đăng nhập, Sự kiện sale (tồn
  kho polling 1,5s), Săn ngay + đếm ngược, Đơn của tôi. **4 integration test cho phần server
  phục vụ trang** (tổng 74/74), unit 74/74. Đã chạy đầu-cuối trên Chrome thật: đăng ký → săn
  → thanh toán → PAID. Bug thật tìm được: vẽ lại cả `<tbody>` mỗi nhịp polling làm nút bị huỷ
  giữa lúc bấm — đã đổi sang cập nhật tại chỗ.
  **Đã chạy k6 với trang đang mở:** 1.000 VU → 201=100, 409=900, 5xx=0; tồn kho trên màn hình
  về 0 và dừng ở 0, DB xác nhận `stock=0` / bán đúng 100. Số ở spec §Chạy k6 với trang đang mở.
  **Còn lại:** Tâm quay video 2 phút (deliverable), trả lời câu hỏi bản chất, review + push.
- **Phase 6 — code + test xong**, chờ Tâm review + push, theo `docs/specs/phase6-observability.md`:
  `common/correlation/` (AsyncLocalStorage + mixin Pino — `correlationId` giờ đi xuyên cả
  worker, ADR-008), `infra/metrics/` (prom-client, `GET /metrics`, 4 metric hạ tầng + 4 nghiệp
  vụ), `/ready` kiểm cả Redis + cờ `shuttingDown`, `DomainError.logLevel` (503 readiness log
  `warn` chứ không `error` — trả nợ ghi từ Phase 0), graceful shutdown 3 bước ở `main.ts`.
  **15 integration test mới, tổng 89/89**; unit **77/77**. 2 biến env mới có mặc định:
  `METRICS_ENABLED`, `SHUTDOWN_GRACE_MS`.
  **`test/infra-fixture.ts` giờ tự reset schema** khi dùng `TEST_DATABASE_URL`, và từ chối chạy
  nếu tên DB không kết thúc bằng `_test`.
  **Còn lại:** Tâm trả lời 3 câu hỏi bản chất, review + push.
- **Trước khi chạy `npm run worker` lần đầu sau khi pull:** `npx prisma migrate deploy`.
  Thiếu bước này worker in lỗi `42P01`/`42703` mỗi giây (thiếu bảng / thiếu cột).
- Cập nhật mục này mỗi khi xong một mốc. **Không tạo checklist riêng cho Phase 1/2/3** (§Ngân
  sách tài liệu) — spec đã là danh sách việc.
