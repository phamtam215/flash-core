# Flash-Core

API Engine cho hệ thống **săn flash sale áo thun** — bài toán trọng tâm là **concurrency**:
hàng nghìn người cùng bấm "Săn ngay" vào một mẫu áo có tồn kho giới hạn theo từng SKU biến
thể (size × màu), và **oversell phải bằng 0**.

Kiến trúc: **Modular Monolith** (NestJS + TypeScript, PostgreSQL 16 + Prisma, Redis + BullMQ).

> **Trạng thái:** Phase 4/8 — Async, Queue & Payment Webhook **đã xong code + test**: Outbox
> ghi cùng transaction với đơn, worker BullMQ chạy process riêng, huỷ đơn quá hạn bằng cả
> delayed job lẫn sweeper, webhook verify HMAC trên raw body. **67/67 integration test xanh**,
> trong đó hai cổng chính: tồn kho chỉ trả về một lần dù hai đường cùng huỷ đơn, và demo
> "rút dây mạng" (giết worker giữa chừng) cho **đúng 20 email, không trùng, không mất**.
> **70/70 integration + 74/74 unit.**
>
> Phase 3 trước đó: ba chiến lược chống oversell đổi bằng một biến môi trường, benchmark k6
> 1.000 VU cho **oversell = 0 ở cả ba** — số đo ở
> [`docs/specs/phase3-order-concurrency.md`](docs/specs/phase3-order-concurrency.md).
>
> README này chỉ mô tả những gì **đã thật sự chạy được**. Phần chưa làm nằm ở
> [Lộ trình](#lộ-trình).

---

## Bắt đầu nhanh

**Cần có:** Node.js ≥ 20.11 (repo dùng 24, xem `.nvmrc`), Docker, npm.

```bash
git clone <repo> && cd flash-core
npm install

cp .env.example .env          # giá trị mặc định đã khớp docker-compose, chạy được ngay
npm run up                    # dựng Postgres 16 + Redis 7
npm run db:generate           # sinh Prisma Client vào src/generated/prisma
npm run dev                   # http://localhost:3000  (terminal 1)
npm run worker                # xử lý job nền           (terminal 2)
```

Worker là **process riêng** để giết được nó mà API vẫn sống — xem
[ADR-005](docs/adr/005-worker-chay-process-rieng.md).

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
| `npm run worker` | Chạy worker xử lý job nền (BullMQ) — process riêng. Dùng `nest start` chứ không `ts-node`: Prisma Client sinh import `.js` mà ts-node không ánh xạ được |
| `npm run worker:dev` | Như trên, watch mode |
| `npm test` | Unit test (nhanh, không cần Docker) |
| `npm run test:int` | Integration test trên Postgres thật (Testcontainers, cần Docker). Không nối được docker socket thì đặt `TEST_DATABASE_URL`/`TEST_REDIS_URL` — xem `test/infra-fixture.ts` |
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
│   └── pagination/          #   keyset cursor — dùng chung product + order
├── infra/
│   ├── prisma/              # pg.Pool → Prisma adapter → PrismaClient
│   └── redis/               # ioredis, một kết nối cho cả app
├── modules/                 # module nghiệp vụ
│   ├── auth/                #   Argon2, JWT cookie, refresh rotation + reuse detection
│   ├── product/             #   Product + SKU size×màu, JSONB + GIN, cursor pagination
│   ├── order/               # ⭐ đặt hàng + 3 chiến lược chống oversell
│   │   └── strategies/      #     optimistic | pessimistic | redis (Lua)
│   └── health/              #   module mẫu: controller + service + index (public interface)
└── generated/prisma/        # Prisma Client (generate, không commit)

test/                        # integration test (Testcontainers) — 49 test
k6/                          # benchmark 1.000 VU cho 3 chiến lược (chạy LOCAL)
prisma/schema.prisma         # schema DB
prisma/migrations/           # 3 migration: auth · product+sku · order+concurrency
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
| **Prisma 7 + driver adapter `pg`** | Prisma 7 bỏ engine Rust; `pg.Pool` do mình cấu hình → số connection thành biến điều khiển được, cần cho benchmark Phase 3 và Neon pooler Phase 7 |
| **Làm CẢ BA chiến lược chống oversell**, đổi bằng config | Làm một cách chỉ là "đã làm"; so sánh ba cách kèm số đo mới là "đã hiểu". Số đo ra kết quả ngược trực giác — xem Lộ trình bên dưới |
| **Ghi dấu đã-xử-lý TRƯỚC khi gửi email** | Gửi mail không nằm trong transaction nào, buộc phải chọn: có thể MẤT hay có thể TRÙNG. Với email xác nhận đơn, gửi hai lần mất lòng tin hơn là chậm một nhịp — [ADR-004](docs/adr/004-ghi-dau-truoc-khi-gui-mail.md) |
| **Huỷ đơn quá hạn bằng CẢ delayed job lẫn sweeper** | Delayed job dạy cách hẹn giờ; sweeper dạy bài học lớn hơn — queue có thể mất job, **DB mới là sự thật**. Hai đường vào một hàm biến "phải idempotent" thành thứ test được |
| Module **`order` sở hữu logic trừ tồn kho** (không phải `product`) | "Trừ kho + tạo đơn" phải atomic là ràng buộc CỨNG; "mỗi bảng một chủ" là nguyên tắc MỀM. Xung đột thì giữ cái cứng — [ADR-003](docs/adr/003-so-huu-logic-tru-ton-kho.md) ghi rõ nợ và giới hạn để nợ không lan |
| **Không path alias `@/`** | `nest build` dùng tsc thuần, không rewrite alias → alias vỡ ở runtime. Import tương đối luôn đúng, không cần loader |
| Tiền lưu **số nguyên VND** | Không dùng float cho tiền |

Chi tiết và các lựa chọn đã bị loại bỏ: [`project-context.md`](project-context.md) §3,
và [`docs/adr/`](docs/adr/).

## Lộ trình

| Phase | Nội dung | Trạng thái |
|---|---|---|
| 0 | Docker Compose · NestJS skeleton · Prisma · CI · convention | ✅ **Xong** — 16/16 test, CI xanh, 2 ADR |
| 1 | Auth: Argon2, Access + Refresh Token, rotation, rate limit | ✅ **Xong** — 14/14 test case, kể cả reuse detection |
| 2 | Product & Inventory: SKU size×màu, JSONB + GIN, cursor pagination, seed 100k | ✅ **Xong** — bằng chứng `EXPLAIN`: keyset ~50× nhanh hơn offset ở trang sâu |
| 3 | ⭐ Order & Concurrency: 3 chiến lược chống oversell + benchmark k6 1.000 VU | ✅ **Xong** — oversell = 0 ở cả ba, ADR-003 |
| 4 | Async: BullMQ, Outbox, DLQ, payment webhook (verify HMAC, idempotent) | ✅ **Xong** — 21 test mới, "rút dây mạng" không mất/không trùng, ADR-004/005/006 |
| 5 | UI demo: Vite + React, 4 màn hình, timebox 2 buổi tối | ⬜ |
| 6 | Observability: Pino + correlationId xuyên suốt, /health & /ready, metrics | ⬜ |
| 7 | Deploy Cloud Run + Neon + Upstash, FinOps mục tiêu 0đ/tháng | ⬜ |

Chi tiết deliverable từng phase: [`docs/SPEC.md`](docs/SPEC.md).

### Kết quả benchmark Phase 3 (1.000 VU săn 100 chiếc)

| Chiến lược | Pool | p95 | Throughput | Oversell |
|---|---|---|---|---|
| optimistic | 10 | 2 063 ms | 476 rps | **0** |
| pessimistic | 10 | **492 ms** | **1 580 rps** | **0** |
| pessimistic | 50 | 969 ms | 993 rps | **0** |
| redis | 10 | 1 393 ms | 481 rps | **0** |

Ba điều số đo nói ra mà lý thuyết không nói: **pessimistic nhanh nhất** (vì 900/1.000 request
rơi vào "hết hàng" — ca đó nó tốn 1 round-trip, optimistic tốn 2), **pool 50 chậm hơn pool
10** (nới pool chỉ chuyển phần chờ khoá từ app vào trong Postgres), và **Redis chưa nhanh hơn**
vì Phase 3 còn ghi DB đồng bộ — ưu thế của nó chỉ hiện ra sau khi có Outbox ở Phase 4.
Giải thích đầy đủ: [`docs/specs/phase3-order-concurrency.md`](docs/specs/phase3-order-concurrency.md)
§Bằng chứng test #16.

### Trạng thái chi tiết & việc còn nợ

Việc đang làm nằm ở [`CLAUDE.md`](CLAUDE.md) §Trạng thái hiện tại.
Hồ sơ Phase 0 (đã đóng): [`docs/phase-0-checklist.md`](docs/phase-0-checklist.md) và
[`docs/specs/phase0-nen-mong.md`](docs/specs/phase0-nen-mong.md).

## Tài liệu

> **Bắt đầu ở đây:** [`docs/README.md`](docs/README.md) — bản đồ tài liệu, nói rõ thông tin nào
> thuộc file nào và mở file nào khi nào. Mỗi thông tin có **đúng một chủ sở hữu**; file khác chỉ
> trỏ link, không chép lại. Bản đọc offline: mở [`docs/html/index.html`](docs/html/index.html).

| File | Nội dung |
|---|---|
| [`docs/README.md`](docs/README.md) | **Bản đồ tài liệu — đọc trước tiên** |
| [`docs/architecture.md`](docs/architecture.md) | **Bản đồ code: file nào làm gì, sửa X thì mở file nào** |
| [`docs/SPEC.md`](docs/SPEC.md) | Spec gốc: 8 phase, deliverable, Definition of Done |
| [`project-context.md`](project-context.md) | Nhật ký quyết định — vì sao, và **đã loại bỏ gì** |
| [`docs/glossary.md`](docs/glossary.md) | Từ điển: **tên gọi** các bài toán (1 dòng/mục) |
| [`docs/tech-playbook.md`](docs/tech-playbook.md) | **Nguồn kiến thức duy nhất**: cơ chế, bug hay gặp, số đo thật, đáp án câu hỏi bản chất từng phase, mục **CI & Testing** xuyên suốt, và **§Ôn phỏng vấn — 12 câu chốt** |
| [`docs/specs/`](docs/specs/) | Spec chi tiết từng tính năng |
| [`docs/adr/`](docs/adr/) | Các quyết định kiến trúc đã chốt |
| [`docs/review-checklist.md`](docs/review-checklist.md) | Checklist review code |
| [`docs/git-workflow.md`](docs/git-workflow.md) | Chuẩn commit, quy tắc nhánh, **cách đóng phase** |

## Về quy trình phát triển

Dự án này được phát triển theo quy trình **AI-assisted, spec-driven, human-reviewed**:

- Mỗi tính năng có spec trong `docs/specs/` **trước khi** viết code.
- Claude Code implement; mọi thay đổi được review theo `docs/review-checklist.md` trước khi
  merge — có hook chặn `git push` để bước review không bị bỏ qua.
- Mỗi quyết định kiến trúc có ADR ghi lại **cả những lựa chọn đã bị loại và vì sao**.
- Cuối mỗi phase, kiến thức rút ra được ghi vào `docs/tech-playbook.md` — đó là **nguồn kiến thức duy nhất** của repo.

Cách làm này được ghi ra công khai vì nó là một phần của điều dự án muốn thể hiện: không
phải "tôi tự gõ từng dòng", mà **"tôi hiểu và chịu trách nhiệm cho từng dòng"** — bằng chứng
là ADR, test, benchmark và nhật ký học tập.

Vì vậy commit nào có AI tham gia đều giữ dòng `Co-Authored-By: Claude`. Che giấu chuyện này
là rủi ro lớn hơn nhiều so với việc thừa nhận nó: người phỏng vấn phát hiện ra thì mất cả
niềm tin, còn nói thẳng thì phần đáng giá — spec, review, quyết định kiến trúc — vẫn nguyên.
