# Spec: Nền móng & Quy trình AI (Phase 0)

- **Phase:** 0
- **Ngày:** 2026-08-05
- **Trạng thái:** Đã implement

> Ghi chú về quy trình: spec này được viết **cùng lúc** với implement, không phải trước —
> vì Tâm yêu cầu setup code trực tiếp và deliverable của Phase 0 đã được định nghĩa sẵn
> trong `docs/SPEC.md`. Từ Phase 1 trở đi quay lại đúng thứ tự: spec → duyệt → code.

## Mục tiêu

Dựng bộ khung để mọi phase sau chỉ việc thêm module: repo có Docker Compose, NestJS
skeleton, Prisma, CI xanh, và một module mẫu thể hiện đầy đủ convention của dự án.

Tiêu chí thật của phase này không phải "code chạy" mà là **mọi quyết định hạ tầng đều giải
thích được** — vì đây là nền, sai ở đây thì 6 phase sau phải chịu.

## API / Interface

| Method | Path | Mô tả | Response |
|---|---|---|---|
| GET | `/health` | Liveness — process còn sống? **Không** kiểm tra dependency | `200 {status, uptimeSeconds}` |
| GET | `/ready` | Readiness — có nên gửi traffic? Kiểm tra Postgres | `200 {ready, checks}` / `503` |

Mọi response lỗi có dạng thống nhất: `{ code, message, correlationId }`.
Mọi response có header `x-correlation-id`.

## Luồng xử lý

1. `main.ts` nạp `.env` (dotenv) → NestFactory tạo app với `bufferLogs`.
2. `ConfigModule` validate `process.env` bằng Zod **một lần** → cung cấp object `Env` đã
   đóng băng qua token `ENV`. Thiếu biến → app chết ngay lúc khởi động.
3. `LoggerModule` (nestjs-pino) dựng logger từ `Env`; `genReqId` nhận hoặc sinh
   `x-correlation-id`, ghi vào response header.
4. `PrismaModule` tạo `pg.Pool` (max = `DATABASE_POOL_MAX`) → bọc bằng `PrismaPg` adapter →
   truyền vào `PrismaClient`.
5. Request `/ready` → controller → service → `SELECT 1` qua Prisma → map thành báo cáo.
6. Lỗi ở bất kỳ đâu → `AllExceptionsFilter` phân loại (DomainError / HttpException / lỗi lạ)
   → log error nếu ≥500, warn nếu <500 → trả body thống nhất.
7. SIGTERM → `enableShutdownHooks` → `onModuleDestroy` đóng Prisma và `pool.end()`.

**Transaction boundary:** chưa có transaction nào ở phase này.
**Gọi queue:** chưa có queue ở phase này.

## Edge cases bắt buộc xử lý

- [x] Thiếu `DATABASE_URL` → app fail lúc khởi động, thông báo nêu **tên biến** thiếu.
- [x] `PORT="abc"` → fail validate, không âm thầm thành `NaN`.
- [x] Client gửi field lạ (ví dụ `price`) → Zod loại bỏ, không truyền xuống service.
- [x] Postgres chết → `/ready` trả 503 nhưng `/health` vẫn 200 (không để Cloud Run restart
      container vô ích).
- [x] Postgres chết → lỗi được **log** (không nuốt) ở mức warn.
- [x] Route không tồn tại → 404 đi qua exception filter chung, vẫn có `correlationId`.
- [x] Client gửi sẵn `x-correlation-id` → giữ nguyên, không sinh id mới.
- [ ] **Chưa làm:** correlationId chưa xuyên sang worker/queue (chưa có queue — Phase 4).

## Test cases phải pass

| # | Test | Loại | Trạng thái |
|---|---|---|---|
| 1 | `liveness` trả ok và **không** chạm DB | unit | ✅ pass |
| 2 | `readiness` = true khi DB trả lời | unit | ✅ pass |
| 3 | `readiness` = false khi DB lỗi, **không throw** ra ngoài | unit | ✅ pass |
| 4 | `validateEnv` điền đủ giá trị mặc định | unit | ✅ pass |
| 5 | `validateEnv` ép `PORT` string → number | unit | ✅ pass |
| 6 | `validateEnv` báo lỗi kèm tên biến khi thiếu | unit | ✅ pass |
| 7 | `validateEnv` từ chối enum sai và `PORT` không phải số | unit | ✅ pass |
| 8 | Config trả về object đã `Object.freeze` | unit | ✅ pass |
| 9 | Zod pipe trả dữ liệu đã parse khi hợp lệ | unit | ✅ pass |
| 10 | Zod pipe ném 400 kèm danh sách field lỗi (không phải 500) | unit | ✅ pass |
| 11 | Zod pipe loại bỏ field lạ do client thêm | unit | ✅ pass |
| 12 | `GET /health` → 200, có `x-correlation-id` | integration | ⚠️ **chưa chạy** |
| 13 | `GET /health` giữ nguyên correlationId client gửi | integration | ⚠️ **chưa chạy** |
| 14 | `GET /ready` → 200 với Postgres thật (Testcontainers) | integration | ⚠️ **chưa chạy** |
| 15 | Route lạ → 404 qua filter chung, có `correlationId` | integration | ⚠️ **chưa chạy** |

Test 12–15 đã viết ở `test/health.e2e-spec.ts` nhưng **chưa chạy được lần nào** vì Docker
daemon không bật trong môi trường lúc setup. Tâm cần chạy `npm run test:int` để xác nhận —
đây là việc còn nợ của phase này.

## Ngoài phạm vi (Non-goals)

- Model nghiệp vụ trong Prisma (sản phẩm, SKU, tồn kho, đơn) — Phase 2–3, cần spec riêng.
- Migration đầu tiên — chưa có model nghiệp vụ nào để migrate.
- Auth, rate limiting — Phase 1.
- Redis client, BullMQ — Phase 3–4 (docker-compose đã dựng sẵn Redis nhưng app chưa nối).
- Prometheus metrics, graceful shutdown cho job đang chạy — Phase 5.
- Dockerfile cho Cloud Run — Phase 6.
- Integration test trên CI — bật ở Phase 3 khi đã có test concurrency thật.

## Quyết định đã lấy trong phase này (cần ADR)

1. **Prisma 7 + driver adapter `pg`** thay vì pin Prisma 6. Prisma 7 bỏ `datasource.url`
   trong schema và bắt dùng adapter. Hoá ra có lợi: `pg.Pool` do mình cấu hình → số
   connection thành biến nhìn thấy được, đúng thứ cần cho Phase 3 và Phase 6. → **ADR**
2. **TypeScript 6, không dùng TypeScript 7.** TS 7 đã phát hành nhưng `ts-jest` chỉ hỗ trợ
   `<7`. Đổi sang `@swc/jest` thì được TS 7 nhưng thêm một công cụ mới. → **ADR**
3. **Không dùng path alias `@/`.** `nest build` chạy tsc thuần và không rewrite alias, nên
   alias sẽ vỡ ở runtime nếu không thêm loader. Dùng import tương đối: cây thư mục nông,
   sâu nhất là `../../`. → ghi vào ADR chung về build.
4. **Tự viết ConfigModule** thay vì `@nestjs/config` — 10 dòng, không cần học typing generic
   của `ConfigService`. Xem lại nếu về sau cần nhiều nguồn cấu hình. → **ADR**
5. **`@Global()` cho ConfigModule và PrismaModule** — ngoại lệ có chủ đích với nguyên tắc
   khai báo phụ thuộc tường minh: cấu hình và pool DB là hạ tầng, và pool **phải** là một
   instance duy nhất cho cả app.

## Câu hỏi mở cho Tâm quyết

- [ ] **ADR-001 (đang treo từ trước):** giữ `Co-Authored-By: Claude` trong commit, hay chỉ
      nói rõ quy trình AI-assisted trong README, hay cả hai?
- [ ] Bốn quyết định ở mục trên có cần viết thành 4 ADR riêng, hay gộp thành một
      "ADR-002: nền móng kỹ thuật Phase 0"? **Khuyến nghị:** gộp, vì chúng cùng một chủ đề
      và đều là hệ quả của việc chọn stack; tách 4 file làm loãng.
