# Flash-Core

API Engine cho hệ thống **săn flash sale áo thun** — bài toán trọng tâm là **concurrency**:
hàng nghìn người cùng bấm "Săn ngay" vào một mẫu áo có tồn kho giới hạn theo từng SKU biến
thể (size × màu), và **oversell phải bằng 0**.

Kiến trúc: **Modular Monolith** (NestJS + TypeScript, PostgreSQL 16 + Prisma, Redis + BullMQ).

> **Trạng thái:** Phase 0/6 — Nền móng. README này được cập nhật dần theo từng phase, chỉ
> mô tả những gì **đã thật sự chạy được**. Phần chưa làm nằm ở [Lộ trình](#lộ-trình).

---

## Bắt đầu nhanh

**Cần có:** Node.js ≥ 20.11 (repo dùng 24, xem `.nvmrc`), Docker, npm.

```bash
git clone <repo> && cd flash-core
npm install

cp .env.example .env          # giá trị mặc định đã khớp docker-compose, chạy được ngay
npm run up                    # dựng Postgres 16 + Redis 7
npm run db:generate           # sinh Prisma Client vào src/generated/prisma
npm run dev                   # http://localhost:3000
```

Kiểm tra:

```bash
curl localhost:3000/health    # {"status":"ok","uptimeSeconds":3}
curl -i localhost:3000/ready  # 200 nếu Postgres sống, 503 nếu không
```

Mọi response đều có header `x-correlation-id` — id đó xuất hiện trong mọi dòng log của
request, dùng để truy lại toàn bộ hành trình khi debug.

## Các lệnh

| Lệnh | Việc |
|---|---|
| `npm run dev` | Chạy app, watch mode |
| `npm test` | Unit test (nhanh, không cần Docker) |
| `npm run test:int` | Integration test trên Postgres thật (Testcontainers, cần Docker) |
| `npm run test:cov` | Unit test + coverage |
| `npm run check` | lint + typecheck + test — chạy trước khi commit |
| `npm run lint` / `lint:fix` | ESLint (có rule type-aware) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run build` | Build ra `dist/` |
| `npm run up` / `down` / `logs` | Docker Compose |
| `npm run db:generate` | Sinh Prisma Client |
| `npm run db:migrate` | Tạo & chạy migration (dev) |
| `npm run db:studio` | Prisma Studio |

## Cấu trúc

```
src/
├── main.ts                  # bootstrap: dotenv → Nest → logger → shutdown hooks
├── app.module.ts            # cấu hình → log → hạ tầng → nghiệp vụ
├── config/                  # validate biến môi trường bằng Zod, một lần, lúc khởi động
├── common/                  # hạ tầng dùng chung
│   ├── errors/              #   DomainError — lỗi nghiệp vụ, không biết gì về HTTP
│   ├── filters/             #   exception filter thống nhất, phân loại 4xx vs 5xx
│   ├── pipes/               #   ZodValidationPipe — validate ở biên
│   └── logger/              #   Pino + correlationId + redact dữ liệu nhạy cảm
├── infra/prisma/            # pg.Pool → Prisma adapter → PrismaClient
├── modules/                 # module nghiệp vụ
│   └── health/              #   module mẫu: controller + service + index (public interface)
└── generated/prisma/        # Prisma Client (generate, không commit)

test/                        # integration test (Testcontainers)
prisma/schema.prisma         # schema DB
prisma.config.ts             # cấu hình Prisma CLI (Prisma 7: url không nằm trong schema)
docker-compose.yml           # Postgres 16 + Redis 7
```

Chi tiết từng file và "muốn sửa X thì mở file nào": [`docs/architecture.md`](docs/architecture.md).

**Quy ước module:** mỗi module trong `src/modules/` gồm `controller` / `service` /
`repository` / `dto` (Zod) và một `index.ts` là **public interface**. Module khác chỉ import
từ `index.ts`, không import sâu vào trong. Đó là thứ duy nhất khiến "Modular Monolith" khác
với một monolith thường.

## Những quyết định đáng chú ý

| Quyết định | Vì sao |
|---|---|
| **Modular Monolith**, không microservices | Dự án một người. Microservices sẽ ngốn toàn bộ thời gian vào hạ tầng thay vì vào concurrency |
| **PostgreSQL** dù MySQL quen hơn | Cố tình mở rộng skill: JSONB + GIN, `SELECT FOR UPDATE SKIP LOCKED`, isolation level rõ ràng |
| **Zod**, không class-validator | Một schema dùng cho cả validate runtime và suy ra type compile-time |
| **Prisma 7 + driver adapter `pg`** | Prisma 7 bỏ engine Rust; `pg.Pool` do mình cấu hình → số connection thành biến điều khiển được, cần cho benchmark Phase 3 và Neon pooler Phase 6 |
| **Không path alias `@/`** | `nest build` dùng tsc thuần, không rewrite alias → alias vỡ ở runtime. Import tương đối luôn đúng, không cần loader |
| Tiền lưu **số nguyên VND** | Không dùng float cho tiền |

Chi tiết và các lựa chọn đã bị loại bỏ: [`project-context.md`](project-context.md) §3,
và [`docs/adr/`](docs/adr/).

## Lộ trình

| Phase | Nội dung | Trạng thái |
|---|---|---|
| 0 | Docker Compose · NestJS skeleton · Prisma · CI · convention | 🟡 16/16 test xanh, còn nợ ADR |
| 1 | Auth: Argon2, Access + Refresh Token, rotation, rate limit | ⬜ |
| 2 | Product & Inventory: SKU size×màu, JSONB + GIN, cursor pagination, seed 100k | ⬜ |
| 3 | ⭐ Order & Concurrency: 3 chiến lược chống oversell + benchmark k6 1.000 VU | ⬜ |
| 4 | Async: BullMQ, Outbox, DLQ, payment webhook (verify HMAC, idempotent) | ⬜ |
| 5 | Observability: Pino + correlationId xuyên suốt, /health & /ready, metrics | ⬜ |
| 6 | Deploy Cloud Run + Neon + Upstash, FinOps mục tiêu 0đ/tháng | ⬜ |

Chi tiết deliverable từng phase: [`docs/SPEC.md`](docs/SPEC.md).

### Trạng thái chi tiết & việc còn nợ

Danh sách việc còn nợ được giữ ở **một chỗ duy nhất**:
[`docs/phase-0-checklist.md`](docs/phase-0-checklist.md) — mỗi việc kèm ai làm, gõ lệnh gì,
và xong là khi nào.
Chi tiết Phase 0 (danh sách test, quyết định kỹ thuật): [`docs/specs/phase0-nen-mong.md`](docs/specs/phase0-nen-mong.md).

## Tài liệu

| File | Nội dung |
|---|---|
| [`docs/phase-0-checklist.md`](docs/phase-0-checklist.md) | **Việc còn lại của phase đang làm, theo thứ tự** |
| [`docs/architecture.md`](docs/architecture.md) | **Bản đồ code: file nào làm gì, sửa X thì mở file nào** |
| [`docs/SPEC.md`](docs/SPEC.md) | Spec gốc: 7 phase, deliverable, Definition of Done |
| [`project-context.md`](project-context.md) | Nhật ký quyết định — vì sao, và **đã loại bỏ gì** |
| [`docs/glossary.md`](docs/glossary.md) | Từ điển: tên gọi các bài toán + 12 câu hỏi tự kiểm tra |
| [`docs/tech-playbook.md`](docs/tech-playbook.md) | Kiến thức cần có trước mỗi phase: cơ chế, bug hay gặp, tình huống thật. có mục **CI & Testing** xuyên suốt |
| [`docs/specs/`](docs/specs/) | Spec chi tiết từng tính năng |
| [`docs/adr/`](docs/adr/) | Các quyết định kiến trúc đã chốt |
| [`docs/journal/`](docs/journal/) | Nhật ký học tập cuối mỗi phase |
| [`docs/review-checklist.md`](docs/review-checklist.md) | Checklist review code |
| [`docs/git-workflow.md`](docs/git-workflow.md) | Chuẩn commit, quy tắc nhánh |
| [`docs/claude-guide.md`](docs/claude-guide.md) | Hướng dẫn dùng Claude Code trong repo này |

## Về quy trình phát triển

Dự án này được phát triển theo quy trình **AI-assisted, spec-driven, human-reviewed**:

- Mỗi tính năng có spec trong `docs/specs/` **trước khi** viết code.
- Claude Code implement; mọi thay đổi được review theo `docs/review-checklist.md` trước khi
  merge — có hook chặn `git push` để bước review không bị bỏ qua.
- Mỗi quyết định kiến trúc có ADR ghi lại **cả những lựa chọn đã bị loại và vì sao**.
- Cuối mỗi phase có nhật ký học tập trong `docs/journal/`.

Cách làm này được ghi ra công khai vì nó là một phần của điều dự án muốn thể hiện: không
phải "tôi tự gõ từng dòng", mà **"tôi hiểu và chịu trách nhiệm cho từng dòng"** — bằng chứng
là ADR, test, benchmark và nhật ký học tập.
