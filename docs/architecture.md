# Bản đồ code — cái gì nằm ở đâu

> **File này trả lời đúng một câu hỏi:** *"muốn sửa/tìm thứ X thì mở file nào?"*
>
> Khác với `README.md` (giới thiệu dự án cho người ngoài) và `docs/SPEC.md` (nói sẽ làm gì),
> file này mô tả **code hiện có**. Cập nhật mỗi khi thêm module mới.
>
> Trạng thái: Phase 0. Toàn bộ code hiện tại là ~600 dòng — đọc hết trong 30 phút.

---

## Đọc theo thứ tự này (lần đầu)

Đi theo đúng đường một request chạy, mỗi bước một file:

| # | File | Trả lời câu gì |
|---|---|---|
| 1 | [`src/main.ts`](../src/main.ts) (32 dòng) | App khởi động thế nào, theo thứ tự nào |
| 2 | [`src/app.module.ts`](../src/app.module.ts) (25) | Có những mảnh nào, ráp vào nhau ra sao |
| 3 | [`src/config/env.schema.ts`](../src/config/env.schema.ts) (58) | App cần biến môi trường nào, validate thế nào |
| 4 | [`src/common/logger/logger.module.ts`](../src/common/logger/logger.module.ts) (76) | `correlationId` sinh ra ở đâu |
| 5 | [`src/infra/prisma/prisma.service.ts`](../src/infra/prisma/prisma.service.ts) (61) | Kết nối DB, và vì sao pool lại đáng chú ý |
| 6 | [`src/modules/health/`](../src/modules/health/) (3 file, ~96) | **Khuôn mẫu của mọi module sau này** |
| 7 | [`src/common/filters/all-exceptions.filter.ts`](../src/common/filters/all-exceptions.filter.ts) (99) | Lỗi đi đâu về đâu |

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
| 14 | [`all-exceptions.filter.ts:55`](../src/common/filters/all-exceptions.filter.ts#L55) | 503 < 500? Không — nhưng 503 ≥ 500 nên log mức `error`… *(xem câu hỏi bên dưới)* |
| 15 | [`all-exceptions.filter.ts:67`](../src/common/filters/all-exceptions.filter.ts#L67) | Trả `{ code, message, correlationId }` — một hình dạng cho mọi lỗi trong toàn app |

**Ba điều đáng rút ra từ mạch này:**

1. **`correlationId` sinh ở bước 7 và được dùng lại ở bước 13** — hai file cách xa nhau, nối
   với nhau qua `req.id`. Đó là toàn bộ cơ chế "truy một request qua mọi dòng log".
2. **Không controller nào tự xử lý lỗi.** Chúng chỉ `throw`; filter ở biên lo phần còn lại.
3. **Bước 3 là lá chắn rẻ nhất của cả hệ thống** — sai cấu hình thì chết lúc `npm run dev`,
   không phải lúc có khách.

> **Câu hỏi để tự kiểm tra:** bước 14 nói `/ready` trả 503 và filter log ở mức **error**.
> Nhưng "DB tạm chết" là sự cố vận hành bình thường, không phải bug của code. Vậy log mức
> `error` ở đây có đúng không, hay nó sẽ làm nhiễu cảnh báo khi lên production? Nếu thấy
> chưa ổn thì đó là một cải tiến thật — và là chất liệu tốt cho một ADR.

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
│   │   ├── logger/logger.module.ts Pino + genReqId(correlationId) + redact dữ liệu nhạy cảm
│   │   └── index.ts                public interface
│   │
│   ├── infra/                    ← KẾT NỐI RA NGOÀI (DB, sau này Redis/queue)
│   │   └── prisma/
│   │       ├── prisma.service.ts   pg.Pool → PrismaPg adapter → PrismaClient, đóng khi SIGTERM
│   │       ├── prisma.module.ts    @Global — pool phải là MỘT instance cho cả app
│   │       └── index.ts            public interface
│   │
│   ├── modules/                  ← NGHIỆP VỤ. Mỗi thư mục = một module có ranh giới
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
│   └── jest-integration.json       config jest riêng cho integration (chậm, cần Docker)
│
├── prisma/schema.prisma          ← định nghĩa bảng DB
├── prisma.config.ts              ← cấu hình Prisma CLI (Prisma 7: url KHÔNG nằm trong schema)
├── docker-compose.yml            ← Postgres 16 + Redis 7 cho local
├── .env.example                  ← danh sách biến môi trường (copy thành .env)
│
├── docs/                         ← tài liệu (xem docs/README.md)
├── .claude/                      ← bộ công cụ Claude Code (xem docs/claude-guide.md)
├── jest.config.js                ← unit test (src/**/*.spec.ts, không cần Docker)
└── .github/workflows/ci.yml      ← CI: generate → lint → typecheck → test → build
```

Cách CI hoạt động và cách bộ test được chia tầng: [`tech-playbook.md` §Xuyên suốt](tech-playbook.md).

---

## Muốn làm X thì sửa file nào

| Muốn… | Sửa/tạo | Lưu ý |
|---|---|---|
| Thêm **biến môi trường** | `src/config/env.schema.ts` + `.env.example` + `.env` | Thêm cả 3 chỗ, nếu không app fail lúc khởi động |
| Thêm **bảng DB** | `prisma/schema.prisma` → `npm run db:migrate` | Tiền dùng `Int` (VND). Cần `CHECK` thì viết SQL raw trong migration |
| Thêm **module nghiệp vụ** | `src/modules/<tên>/` — copy cấu trúc `health/` | Bắt buộc có `index.ts`. Đăng ký vào `app.module.ts` |
| Thêm **endpoint** | controller của module đó | Validate body bằng `ZodValidationPipe` |
| Thêm **loại lỗi nghiệp vụ** | class kế thừa `DomainError` trong module | Filter tự map sang HTTP, không cần sửa filter |
| Đổi **hình dạng response lỗi** | `src/common/filters/all-exceptions.filter.ts` | Đổi 1 chỗ, áp dụng toàn app |
| Thêm **field bị che trong log** | `redact.paths` trong `logger.module.ts` | Che ở tầng logger, đừng dựa vào "nhớ đừng log" |
| Đổi **pool size DB** | `DATABASE_POOL_MAX` trong `.env` | Biến này quan trọng ở Phase 3 — xem ghi chú trong `prisma.service.ts` |
| Thêm **unit test** | file `*.spec.ts` cạnh code | Chạy `npm test` |
| Thêm **integration test** | `test/*.e2e-spec.ts` | Chạy `npm run test:int`, cần Docker |
| Đổi **luật lint** | `eslint.config.mjs` | |
| Đổi **CI** (thêm bước, đổi Node version) | `.github/workflows/ci.yml` | Node version lấy từ `.nvmrc` — đổi ở đó, không sửa trong yml |
| Đổi **hành vi của Claude** | `.claude/` — xem `docs/claude-guide.md` | |

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
của module được phụ thuộc — bên gọi phụ thuộc vào interface, không vào class. Xem skill
`nestjs-module` để có ví dụ đầy đủ.

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

## Những chỗ dễ vấp (đã gặp thật ở Phase 0)

| Hiện tượng | Nguyên nhân |
|---|---|
| `prisma generate` báo `Cannot resolve environment variable: DATABASE_URL` | `prisma.config.ts` đọc biến này qua `env()`. Cần `.env` hoặc set biến trước lệnh |
| `datasource property url is no longer supported` | Prisma 7 bỏ `url` khỏi schema — nó nằm ở `prisma.config.ts`. Tài liệu Prisma 6 trên mạng đã cũ |
| `nest build` exit 0 nhưng `dist/` rỗng | `.tsbuildinfo` cũ ở root khiến tsc tưởng đã build. Đã sửa bằng `tsBuildInfoFile: ./dist/.tsbuildinfo` |
| `Cannot find name 'describe'` | `tsconfig.json` khai báo `types` tường minh — thêm type mới phải thêm vào mảng đó |
| Test xanh ở máy, **đỏ trên CI**: `Cannot find module './internal/class.js'` | Prisma 7 sinh import kèm đuôi `.js` nhưng file thật là `.ts`. Máy vẫn xanh vì đang giữ bản generate **cũ** (sinh trước khi đổi `moduleResolution` sang `node16`). Đã sửa bằng `moduleNameMapper` trong hai file config jest |
| `TS5011: rootDir must be explicitly set` khi chạy jest | `isolatedModules: true` khiến ts-jest dịch từng file riêng, TS6 không tự suy ra được thư mục gốc. Cần `rootDir` tường minh trong `tsconfig.json` |
| Import `@/config` chạy được lúc dev nhưng vỡ sau `npm run build` | Dự án **không dùng path alias** — `nest build` là tsc thuần, không rewrite alias. Dùng import tương đối |

---

## Tài liệu liên quan

| Câu hỏi | File |
|---|---|
| Dự án này là gì, chạy thế nào | [`README.md`](../README.md) |
| Sẽ làm gì ở 7 phase, Definition of Done | [`docs/SPEC.md`](SPEC.md) |
| **Vì sao** chọn thế này, đã loại bỏ gì | [`project-context.md`](../project-context.md) |
| Tên gọi của các bài toán sẽ gặp | [`docs/glossary.md`](glossary.md) |
| Dùng lệnh/skill/hook nào khi nào | [`docs/claude-guide.md`](claude-guide.md) |
| Chi tiết Phase 0 đã làm gì, test nào pass | [`docs/specs/phase0-nen-mong.md`](specs/phase0-nen-mong.md) |
