# Bản đồ code — cái gì nằm ở đâu

> **File này trả lời đúng một câu hỏi:** *"muốn sửa/tìm thứ X thì mở file nào?"*
>
> Khác với `README.md` (giới thiệu dự án cho người ngoài) và `docs/SPEC.md` (nói sẽ làm gì),
> file này mô tả **code hiện có**. Cập nhật mỗi khi thêm module mới.
>
> Trạng thái: Phase 4. Code hiện tại ~4 700 dòng.

---

## Đọc theo thứ tự này (lần đầu)

Đi theo đúng đường một request chạy, mỗi bước một file:

| # | File | Trả lời câu gì |
|---|---|---|
| 1 | [`src/main.ts`](../src/main.ts) (32 dòng) | App khởi động thế nào, theo thứ tự nào |
| 2 | [`src/app.module.ts`](../src/app.module.ts) (25) | Có những mảnh nào, ráp vào nhau ra sao |
| 3 | [`src/config/env.schema.ts`](../src/config/env.schema.ts) (58) | App cần biến môi trường nào, validate thế nào |
| 4 | [`src/common/logger/logger.module.ts`](../src/common/logger/logger.module.ts) (76) | `correlationId` sinh ra ở đâu — [giải thích đầy đủ](tech-playbook.md) |
| 5 | [`src/infra/prisma/prisma.service.ts`](../src/infra/prisma/prisma.service.ts) (61) | Kết nối DB, và vì sao pool lại đáng chú ý |
| 6 | [`src/modules/health/`](../src/modules/health/) (3 file, ~96) | **Khuôn mẫu của mọi module sau này** |
| 7 | [`src/common/filters/all-exceptions.filter.ts`](../src/common/filters/all-exceptions.filter.ts) (99) | Lỗi đi đâu về đâu |
| 8 | [`src/modules/auth/auth.service.ts`](../src/modules/auth/auth.service.ts) (Phase 1) | Argon2, xoay token, **reuse detection** |
| 9 | [`src/modules/product/product.repository.ts`](../src/modules/product/product.repository.ts) (Phase 2) | Cursor pagination, tồn kho theo SKU |
| 10 | [`src/modules/order/strategies/`](../src/modules/order/strategies/) (Phase 3) ⭐ | **Ba cách chống oversell** — đọc cả 3 file, mỗi file có mục "thắng khi / thua khi" |
| 11 | [`src/modules/outbox/`](../src/modules/outbox/) (Phase 4) | **Outbox + dấu idempotent** — hai nửa của một cơ chế: không mất / không trùng |
| 12 | [`src/worker.ts`](../src/worker.ts) (Phase 4) | Tiến trình xử lý job nền, và vì sao nó tách khỏi API |

Sau đó đọc [`test/health.e2e-spec.ts`](../test/health.e2e-spec.ts) — nó cho thấy toàn bộ
chuỗi trên chạy thật với Postgres thật.

---

## Đi theo một request: `GET /ready` khi Postgres đã chết

Bảng trên nói *file nào làm gì*. Phần này nói *chúng ráp vào nhau ra sao* — đi đúng một
request từ lúc gõ `npm run dev` tới lúc client nhận `503`.

**Lúc khởi động (một lần):**

| # | Ở đâu | Chuyện gì xảy ra |
|---|---|---|
| 1 | [`main.ts:4`](../src/main.ts#L4) | `dotenv/config` nạp `.env` vào `process.env`. **Phải là import đầu tiên** |
| 2 | [`main.ts:13`](../src/main.ts#L13) | Nest dựng `AppModule`, ráp module theo thứ tự cấu hình → log → hạ tầng → nghiệp vụ |
| 3 | [`config.module.ts:30`](../src/config/config.module.ts#L30) | `validateEnv()` chạy. Thiếu biến → **throw ngay tại đây, app không bao giờ lên** |
| 4 | [`logger.module.ts:30`](../src/common/logger/logger.module.ts#L30) | Pino nhận `LOG_LEVEL` từ `Env` vừa validate |
| 5 | [`prisma.service.ts:33`](../src/infra/prisma/prisma.service.ts#L33) | Tạo `pg.Pool` → bọc `PrismaPg` adapter → `super()`. Pool là **một** instance cho cả app |
| 6 | [`main.ts:24`](../src/main.ts#L24) | Đăng ký shutdown hook, để SIGTERM còn kịp đóng pool |

**Mỗi request:**

| # | Ở đâu | Chuyện gì xảy ra |
|---|---|---|
| 7 | [`logger.module.ts:34`](../src/common/logger/logger.module.ts#L34) | `genReqId` chạy **trước mọi thứ**: lấy `x-correlation-id` từ header, hoặc sinh UUID mới. Gắn vào `req.id` **và** vào response header |
| 8 | [`health.controller.ts:15`](../src/modules/health/health.controller.ts#L15) | Nest định tuyến `/ready` tới đây |
| 9 | [`health.service.ts:49`](../src/modules/health/health.service.ts#L49) | `SELECT 1` qua Prisma → Postgres chết → `pg` ném lỗi |
| 10 | [`health.service.ts:54`](../src/modules/health/health.service.ts#L54) | `catch` **có bắt nhưng không nuốt**: log mức `warn`, rồi trả `'down'` |
| 11 | [`health.controller.ts:21`](../src/modules/health/health.controller.ts#L21) | `ready === false` → ném `ServiceUnavailableException`. Phải là **status code**, vì load balancer không đọc body |
| 12 | [`all-exceptions.filter.ts:45`](../src/common/filters/all-exceptions.filter.ts#L45) | Filter bắt exception (đăng ký `APP_FILTER` ở `app.module.ts`, nên không controller nào thoát được) |
| 13 | [`all-exceptions.filter.ts:52`](../src/common/filters/all-exceptions.filter.ts#L52) | Lấy lại `req.id` — **chính là id sinh ở bước 7**. Đây là chỗ hai đầu nối vào nhau |
| 14 | [`all-exceptions.filter.ts:55`](../src/common/filters/all-exceptions.filter.ts#L55) | 503 ≥ 500 nên filter log ở mức `error` — *xem mục ngay bên dưới, chỗ này chưa ổn* |
| 15 | [`all-exceptions.filter.ts:67`](../src/common/filters/all-exceptions.filter.ts#L67) | Trả `{ code, message, correlationId }` — một hình dạng cho mọi lỗi trong toàn app |

**Ba điều đáng rút ra từ mạch này:**

1. **`correlationId` sinh ở bước 7 và được dùng lại ở bước 13** — hai file cách xa nhau, nối
   với nhau qua `req.id`. Đó là toàn bộ cơ chế "truy một request qua mọi dòng log".
2. **Không controller nào tự xử lý lỗi.** Chúng chỉ `throw`; filter ở biên lo phần còn lại.
3. **Bước 3 là lá chắn rẻ nhất của cả hệ thống** — sai cấu hình thì chết lúc `npm run dev`,
   không phải lúc có khách.

### Một chỗ chưa ổn trong đoạn này — và cách nghĩ về nó

**Hiện tượng:** bước 14 — `/ready` trả 503, mà filter phân loại `status >= 500` là lỗi hệ
thống nên log ở mức **error**.

**Vì sao đó là vấn đề:** Cloud Run gọi `/ready` liên tục, vài giây một lần. Nếu Postgres
chớp 2 phút, log sẽ có hàng chục dòng `error` — trong khi đây là sự cố vận hành *bình
thường*, không phải bug của code. Đến Phase 6 khi gắn cảnh báo theo số dòng `error`, chuông
sẽ kêu inh ỏi vì chuyện không cần ai dậy lúc 3 giờ sáng. Cảnh báo kêu sai vài lần là người
ta bắt đầu tắt tiếng nó — và lần thứ n, khi có sự cố thật, không ai nghe.

**Cách sửa, hai hướng:**

| Hướng | Làm gì | Đánh đổi |
|---|---|---|
| Sửa ở filter | Thêm ngoại lệ: 503 thì log `warn` | Đơn giản, nhưng gắn luật của một endpoint vào chỗ dùng chung cho cả app |
| Sửa ở chỗ ném lỗi | Controller ném một `DomainError` riêng có mức log `warn` | Sạch hơn về ranh giới, nhưng phải thêm khái niệm "mức log" vào lớp lỗi |

**Chưa sửa, và đó là chủ đích.** Phase 0 chưa có cảnh báo nên chưa ai đau. Đây là **nợ kỹ
thuật có ghi chép** — sẽ trả ở Phase 6 cùng lúc với việc dựng metrics, khi đã biết rõ cảnh
báo được cấu hình thế nào. Sửa bây giờ là đoán mò yêu cầu chưa tồn tại.

---

## Cây thư mục — mỗi dòng một trách nhiệm

```
flash-core/
│
├── src/                          ← toàn bộ code chạy
│   ├── main.ts                     bootstrap: dotenv → Nest → logger → shutdown hooks → listen
│   ├── app.module.ts               ráp module, đăng ký exception filter toàn cục
│   │
│   ├── config/                   ← ĐỌC BIẾN MÔI TRƯỜNG. Không nơi nào khác được đọc process.env
│   │   ├── env.schema.ts           schema Zod + validateEnv() — nguồn sự thật của mọi biến
│   │   ├── config.module.ts        @Global, cung cấp object Env qua token ENV
│   │   └── index.ts                public interface: { ConfigModule, ENV, Env, validateEnv }
│   │
│   ├── common/                   ← HẠ TẦNG DÙNG CHUNG. Chỉ thứ ≥2 module dùng mới vào đây
│   │   ├── errors/domain.error.ts  lớp cha cho lỗi nghiệp vụ (không biết gì về HTTP)
│   │   ├── filters/…filter.ts      1 hình dạng response lỗi + phân loại 4xx vs 5xx
│   │   ├── pipes/…pipe.ts          ZodValidationPipe — validate input ở biên
│   │   ├── pagination/cursor.ts    keyset cursor (Phase 3 chuyển từ product/ ra vì ≥2 module dùng)
│   │   ├── logger/logger.module.ts Pino + genReqId(correlationId) + redact dữ liệu nhạy cảm
│   │   └── index.ts                public interface
│   │
│   ├── infra/                    ← KẾT NỐI RA NGOÀI (DB, Redis, sau này queue)
│   │   ├── prisma/
│   │   │   ├── prisma.service.ts   pg.Pool → PrismaPg adapter → PrismaClient, đóng khi SIGTERM
│   │   │   ├── prisma.module.ts    @Global — pool phải là MỘT instance cho cả app
│   │   │   └── index.ts            public interface
│   │   ├── redis/                  (Phase 1) cấu trúc copy y hệt prisma/
│   │   │   ├── redis.service.ts    ioredis + incrementWithExpiry() cho rate limit
│   │   │   ├── redis.module.ts     @Global — một kết nối cho cả app
│   │   │   └── index.ts            public interface
│   │   └── queue/                  (Phase 4) BullMQ
│   │       ├── queue.constants.ts  tên queue + 5 tên job + payload — nguồn sự thật duy nhất
│   │       ├── queue.service.ts    Queue + kết nối RIÊNG (maxRetriesPerRequest: null), retry/backoff/jitter
│   │       ├── queue.module.ts     @Global
│   │       └── index.ts            public interface
│   │
│   ├── modules/                  ← NGHIỆP VỤ. Mỗi thư mục = một module có ranh giới
│   │   ├── auth/                   (Phase 1) đăng ký, đăng nhập, refresh token
│   │   │   ├── auth.controller.ts    HTTP + gắn cookie. Không có logic nghiệp vụ
│   │   │   ├── auth.service.ts       Argon2, sinh token, REUSE DETECTION, rate limit
│   │   │   ├── auth.repository.ts    mọi truy cập DB của module gom về đây
│   │   │   ├── auth.dto.ts           schema Zod + type suy ra từ schema
│   │   │   ├── auth.errors.ts        lỗi nghiệp vụ kế thừa DomainError
│   │   │   ├── auth.cookies.ts       4 cờ bảo mật của cookie, giải thích từng cờ
│   │   │   ├── access-token.guard.ts chặn request chưa đăng nhập, đọc token từ cookie
│   │   │   └── index.ts              CHỈ export AuthModule + AccessTokenGuard
│   │   ├── product/                 (Phase 2) sản phẩm + SKU biến thể, cursor pagination
│   │   │   ├── product.controller.ts CRUD, ghi dùng AccessTokenGuard (import từ ../auth)
│   │   │   ├── product.service.ts    check-tồn-tại-trước-khi-ghi, cursor decode/paginate
│   │   │   ├── product.repository.ts mọi truy cập DB (kể cả keyset WHERE) gom về đây
│   │   │   ├── product.dto.ts        schema Zod: Product/SKU/cursor query
│   │   │   ├── product.errors.ts     lỗi nghiệp vụ kế thừa DomainError
│   │   │   ├── product.cursor.ts     encode/decode cursor base64url (createdAt, id)
│   │   │   ├── product.slug.ts       slugify + sinh sku_code (bỏ dấu tiếng Việt)
│   │   │   └── index.ts              chỉ export ProductModule (chưa module nào khác cần)
│   │   ├── order/                   (Phase 3) ⭐ đặt hàng + chống oversell
│   │   │   ├── order.controller.ts   HTTP: 201 khi tạo mới, 200 khi Idempotency-Key trùng
│   │   │   ├── order.service.ts      reserve → tạo đơn; hoàn kho khi key trùng
│   │   │   ├── order.repository.ts   MỌI câu SQL chạm tồn kho nằm ở đây (ADR-003)
│   │   │   ├── inventory-reserver.ts hợp đồng chung của 3 chiến lược + token DI
│   │   │   ├── strategies/           optimistic | pessimistic | redis (Lua)
│   │   │   ├── order.dto.ts          Zod: KHÔNG có field price (snapshot price)
│   │   │   ├── order.errors.ts       hết hàng = 409, KHÔNG phải 500
│   │   │   └── index.ts              chỉ export OrderModule
│   │   └── health/                 module mẫu — copy cấu trúc này khi tạo module mới
│   │       ├── health.controller.ts  HTTP: nhận request → gọi service → map response
│   │       ├── health.service.ts     logic: liveness vs readiness
│   │       ├── health.service.spec.ts unit test nằm CẠNH code nó test
│   │       ├── health.module.ts      khai báo provider/controller
│   │       └── index.ts              public interface — module khác chỉ import từ đây
│   │
│   └── generated/prisma/         ← code Prisma sinh ra. KHÔNG sửa tay, KHÔNG commit
│
├── test/                         ← integration test (Postgres thật qua Testcontainers)
│   ├── health.e2e-spec.ts
│   ├── auth.e2e-spec.ts
│   ├── product.e2e-spec.ts
│   ├── order.e2e-spec.ts
│   └── jest-integration.json       config jest riêng cho integration (chậm, cần Docker)
│
├── scripts/build-docs-html.mjs   ← sinh docs/html/ từ Markdown (`npm run docs:html`)
├── docs/html/                    ← bản HTML đọc offline; mở `index.html`
│
├── k6/                           ← benchmark 1.000 VU cho 3 chiến lược (CHỈ chạy local)
│   ├── flash-sale.js               đếm RIÊNG 201/409/4xx/5xx — xem vì sao trong file
│   └── seed-target.js              tạo user + SKU stock=100, in ra lệnh k6 kèm token
│
├── prisma/schema.prisma          ← định nghĩa bảng DB
├── prisma/seed/seed-skus.ts      ← seed 100k SKU (Phase 2), chạy bằng `npm run seed`
├── prisma.config.ts              ← cấu hình Prisma CLI (Prisma 7: url KHÔNG nằm trong schema)
├── docker-compose.yml            ← Postgres 16 + Redis 7 cho local
├── .env.example                  ← danh sách biến môi trường (copy thành .env)
│
├── docs/                         ← tài liệu (xem docs/README.md)
├── .claude/                      ← 2 lệnh + 3 hook (xem CLAUDE.md §Bộ công cụ)
├── jest.config.js                ← unit test (src/**/*.spec.ts, không cần Docker)
└── .github/workflows/ci.yml      ← CI: generate → lint → typecheck → test → build
```

Cách CI hoạt động và cách bộ test được chia tầng: [`tech-playbook.md` §Xuyên suốt](tech-playbook.md).

---

## Muốn làm X thì sửa file nào

| Muốn… | Sửa/tạo | Lưu ý |
|---|---|---|
| Thêm **biến môi trường** | `src/config/env.schema.ts` + `.env.example` + `.env` | Thêm cả 3 chỗ, nếu không app fail lúc khởi động |
| Sửa **luật mật khẩu / rate limit** | `src/modules/auth/auth.dto.ts`, `auth.service.ts` | Đổi ngưỡng thì sửa `.env`, không sửa code |
| Sửa **cờ bảo mật của cookie** | `src/modules/auth/auth.cookies.ts` | `path` lúc xoá phải khớp lúc set, nếu không cookie không mất |
| Bảo vệ một **endpoint mới** | `@UseGuards(AccessTokenGuard)` trong controller | Import từ `../auth`, không import sâu |
| Thêm **bảng DB** | `prisma/schema.prisma` → `npm run db:migrate` | Tiền dùng `Int` (VND). Cần `CHECK` thì viết SQL raw trong migration |
| Thêm **module nghiệp vụ** | `src/modules/<tên>/` — copy cấu trúc `health/` | Bắt buộc có `index.ts`. Đăng ký vào `app.module.ts` |
| Thêm **endpoint** | controller của module đó | Validate body bằng `ZodValidationPipe` |
| Thêm **loại lỗi nghiệp vụ** | class kế thừa `DomainError` trong module | Filter tự map sang HTTP, không cần sửa filter |
| Đổi **hình dạng response lỗi** | `src/common/filters/all-exceptions.filter.ts` | Đổi 1 chỗ, áp dụng toàn app |
| Thêm **field bị che trong log** | `redact.paths` trong `logger.module.ts` | Che ở tầng logger, đừng dựa vào "nhớ đừng log" |
| Sửa **tài liệu** rồi muốn bản HTML khớp lại | `npm run docs:html` | Sinh lại 5 trang tham khảo + 3 ADR trong `docs/html/`. `index.html` và `phase-*.html` là trang viết tay, script KHÔNG ghi đè |
| Đổi **chiến lược chống oversell** | `INVENTORY_STRATEGY` trong `.env` (`optimistic`/`pessimistic`/`redis`) | Không sửa code. Factory ở `order.module.ts` là chỗ duy nhất biết biến này |
| Đổi **pool size DB** | `DATABASE_POOL_MAX` trong `.env` | Biến này quan trọng ở Phase 3 — xem ghi chú trong `prisma.service.ts` |
| Thêm **unit test** | file `*.spec.ts` cạnh code | Chạy `npm test` |
| Thêm **integration test** | `test/*.e2e-spec.ts` | Chạy `npm run test:int`, cần Docker. Không nối được docker socket thì đặt `TEST_DATABASE_URL`/`TEST_REDIS_URL` (xem `test/infra-fixture.ts`) |
| Thêm **loại job nền** | `src/infra/queue/queue.constants.ts` (tên + payload) → service nghiệp vụ → `src/worker/job.processor.ts` | Job mới phải idempotent. Hệ quả trong DB thì dùng `runOnceInTransaction`; ngoài DB thì `claim`/`release` |
| Thêm **sự kiện Outbox** | ghi `tx.outboxEvent.create` trong **cùng transaction** với dữ liệu → thêm nhánh ở `OutboxRelay.dispatch` | Không bao giờ `queue.add` ngay trong request nếu sự kiện phải đi cùng một lệnh ghi DB |
| Đổi **thời gian giữ chỗ đơn** | `ORDER_HOLD_MINUTES` trong `.env` | Test đặt xuống vài giây; đừng hardcode lại thành hằng số |
| Đổi **luật lint** | `eslint.config.mjs` | |
| Đổi **CI** (thêm bước, đổi Node version) | `.github/workflows/ci.yml` | Node version lấy từ `.nvmrc` — đổi ở đó, không sửa trong yml |
| Đổi **hành vi của Claude** | `CLAUDE.md`, hoặc `.claude/commands/` | |

---

## Ba quy tắc cấu trúc (vi phạm là mất kiến trúc)

**1. Module chỉ nói chuyện qua `index.ts`.**

```ts
import { HealthModule } from '../health';            // ✅ qua public interface
import { HealthService } from '../health/health.service';  // ❌ import sâu
```

Đây là **thứ duy nhất** khiến "Modular Monolith" khác một monolith thường. Không có ranh
giới này thì lý do bỏ microservices (`project-context.md` quyết định #3) không còn giá trị
để kể trong phỏng vấn.

Khi hai module cần phụ thuộc nhau, khai báo **interface + injection token** trong `index.ts`
của module được phụ thuộc — bên gọi phụ thuộc vào interface, không vào class.

**2. Truy cập DB nằm trong repository của module, không rải khắp service.**

Phase 0 chưa có module nào chạm DB nên chưa có file `*.repository.ts` — module đầu tiên có
DB (Phase 2) sẽ tạo. `PrismaService` là `@Global` nhưng điều đó **không** có nghĩa được
gọi Prisma ở mọi nơi.

**3. Ba tầng, phụ thuộc chỉ đi một chiều.**

```
modules/ (nghiệp vụ)  →  infra/ (kết nối ngoài)  →  config/
        ↘                    ↙
            common/ (hạ tầng dùng chung)
```

`common/` và `config/` **không bao giờ** import ngược lên `modules/`. Nếu thấy mình sắp làm
thế, nghĩa là thứ đó không phải hạ tầng dùng chung mà là nghiệp vụ đặt nhầm chỗ.

---

## Những chỗ dễ vấp (đã gặp thật)

| Hiện tượng | Nguyên nhân |
|---|---|
| `prisma generate` báo `Cannot resolve environment variable: DATABASE_URL` | `prisma.config.ts` đọc biến này qua `env()`. Cần `.env` hoặc set biến trước lệnh |
| `datasource property url is no longer supported` | Prisma 7 bỏ `url` khỏi schema — nó nằm ở `prisma.config.ts`. Tài liệu Prisma 6 trên mạng đã cũ |
| `nest build` exit 0 nhưng `dist/` rỗng | `.tsbuildinfo` cũ ở root khiến tsc tưởng đã build. Đã sửa bằng `tsBuildInfoFile: ./dist/.tsbuildinfo` |
| `Cannot find name 'describe'` | `tsconfig.json` khai báo `types` tường minh — thêm type mới phải thêm vào mảng đó |
| Test xanh ở máy, **đỏ trên CI**: `Cannot find module './internal/class.js'` | Prisma 7 sinh import kèm đuôi `.js` nhưng file thật là `.ts`. Máy vẫn xanh vì đang giữ bản generate **cũ** (sinh trước khi đổi `moduleResolution` sang `node16`). Đã sửa bằng `moduleNameMapper` trong hai file config jest |
| `TS5011: rootDir must be explicitly set` khi chạy jest | `isolatedModules: true` khiến ts-jest dịch từng file riêng, TS6 không tự suy ra được thư mục gốc. Cần `rootDir` tường minh trong `tsconfig.json` |
| Import `@/config` chạy được lúc dev nhưng vỡ sau `npm run build` | Dự án **không dùng path alias** — `nest build` là tsc thuần, không rewrite alias. Dùng import tương đối |
| (Phase 3) `POST /products` trả 500 khi tạo nhiều product có slug dài dùng chung tiền tố | `generateSkuCode` cắt slug còn 16 ký tự đầu ⇒ hai slug khác nhau ra CÙNG một `sku_code`, vỡ `UNIQUE`. Comment cũ ghi ca này "cực hiếm" nhưng script seed benchmark làm nó xảy ra 100% các lần. Đã sửa bằng 4 ký tự băm FNV-1a của slug đầy đủ — **bài học: "cực hiếm" là phỏng đoán, phải kiểm bằng cách dùng thật** |
| (Phase 2) `@UseGuards(GuardTừModuleKhác)` báo thiếu dependency của GUARD (không phải của controller) | `@UseGuards(Class)` **không** tái dùng singleton của module gốc như constructor injection — `GuardsContextCreator` tra thẳng `injectables` của module chứa **controller** (không đi qua `imports`/`exports`) rồi tự dựng lại guard ở đó, nên mọi dependency của guard (ở đây `JwtService`) phải resolve được **ngay tại module đang dùng guard**. Sửa **2 phần**: (1) khai guard trong `providers` của CHÍNH module đang dùng nó (`src/modules/product/product.module.ts`), không chỉ import module gốc; (2) export cả module cung cấp dependency của guard (`JwtModule`) từ module gốc (`src/modules/auth/auth.module.ts`) — thiếu phần nào cũng lỗi |
| (Phase 6) Delayed job huỷ đơn **chưa bao giờ chạy** mà không ai biết | `jobId: `expire:${id}`` — BullMQ từ chối `jobId` chứa `:`. Lỗi rơi vào `catch` chỉ log `warn`, và sweeper vẫn dọn đúng nên nhìn từ ngoài không thấy gì sai. Chỉ lộ ra khi đọc log `info` của app thật. Sửa: dùng `expire-${id}`; test 9b khoá lại |
| (Phase 4) BullMQ ném `MaxRetriesPerRequestError` khi queue **rảnh việc** | Worker chạy lệnh blocking (`BZPOPMIN`) để chờ job, ioredis bắt buộc `maxRetriesPerRequest: null` cho kiểu kết nối đó. `RedisService` cố tình đặt `1` (rate limit phải hỏng nhanh) ⇒ hai nhu cầu ngược nhau, **phải là hai kết nối**. Dùng chung thì chạy được lúc đầu rồi mới nổ — bug im lặng |
| (Phase 4) `Could not find a working container runtime strategy` dù `docker ps` chạy được | Jest không `connect` được `docker.sock` (`EPERM`) trong khi shell thì được. Lối thoát: `TEST_DATABASE_URL`/`TEST_REDIS_URL` trỏ vào `npm run up` — xem `test/infra-fixture.ts` |
| (Phase 4) `npm run worker` báo `Cannot find module './internal/class.js'` | Chạy bằng `ts-node`. Prisma Client sinh import kèm đuôi `.js` nhưng file thật là `.ts` — Jest có `moduleNameMapper`, `ts-node` thì không. Dùng `nest start --entryFile worker` (biên dịch bằng tsc rồi chạy `dist/`). Cùng gốc với bug CI ở Phase 0 |
| `Permission denied` khi chạy `node_modules/.bin/ts-node` | Symlink trỏ tới `dist/bin.js` bị mất bit thực thi sau một lần `npm install`. Gọi qua `node -r ts-node/register <file>` thì không phụ thuộc bit đó (đã đổi trong script `seed`) |

---

## Tài liệu liên quan

| Câu hỏi | File |
|---|---|
| **Thông tin này thuộc file nào** | [`docs/README.md`](README.md) — bản đồ tài liệu |
| Dự án này là gì, chạy thế nào | [`README.md`](../README.md) |
| Cơ chế hoạt động, bug hay gặp, số đo thật | [`docs/tech-playbook.md`](tech-playbook.md) |
| Sẽ làm gì ở 8 phase, Definition of Done | [`docs/SPEC.md`](SPEC.md) |
| **Vì sao** chọn thế này, đã loại bỏ gì | [`project-context.md`](../project-context.md) |
| Tên gọi của các bài toán sẽ gặp | [`docs/glossary.md`](glossary.md) |
| Chi tiết Phase 0 đã làm gì, test nào pass | [`docs/specs/phase0-nen-mong.md`](specs/phase0-nen-mong.md) |
| Quyết định kiến trúc đã chốt (5 ADR) | [`docs/adr/`](adr/) |
