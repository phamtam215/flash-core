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
- `docs/architecture.md` — bản đồ code: file nào làm gì, định nghĩa ở đâu, ba quy tắc
  cấu trúc. Đọc trước khi thêm/sửa file trong `src/`.
- `docs/SPEC.md` — spec gốc: 7 phase, deliverable, Definition of Done
- `docs/specs/` — spec chi tiết từng tính năng (viết trước khi code)
- `docs/adr/` — các quyết định kiến trúc đã chốt
- `docs/review-checklist.md` — checklist Tâm dùng để review code của bạn
- `docs/glossary.md` — từ điển khái niệm của dự án. Khi giải thích, ưu tiên dùng
  đúng các thuật ngữ trong file này để Tâm quen dần với từ vựng chuẩn.
- `docs/tech-playbook.md` — cơ chế, bug hay gặp và tình huống thật của từng phase. Mục
  **§Xuyên suốt — CI & Testing** là phần Tâm tự nhận còn yếu nhất (GitHub Actions và
  testing): khi chạm tới CI hoặc test thì giải thích kỹ hơn mức mặc định, và cập nhật mục
  đó khi CI/bộ test đổi. Khi giải thích "vì sao", bám sát cách diễn đạt ở file này để Tâm
  không phải học hai phiên bản.
- `docs/git-workflow.md` — quy chuẩn nhánh, commit message, và **quy tắc AI không
  push trước khi Tâm review**. Dùng `/commit` để tạo commit đúng chuẩn.
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
   cùng commit. Ba chỗ hay lệch: `docs/architecture.md`, `docs/phase-0-checklist.md`,
   §Trạng thái hiện tại của file này.
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
- Lệnh hay dùng: `npm run check` (lint + typecheck + test), `npm run up`, `npm run db:generate`.

## Trạng thái hiện tại
- Phase hiện tại: **Phase 1 — Auth & Security** (bắt đầu 2026-08-08)
- **Phase 0 ĐÃ ĐÓNG** 2026-08-08 — hồ sơ ở `docs/phase-0-checklist.md`. Kết quả: skeleton
  NestJS + config Zod + Pino/correlationId + exception filter + Prisma 7 (pg adapter) +
  module `health` + Docker Compose + CI xanh + ESLint chặn import sâu. **16/16 test pass**.
  2 ADR (`docs/adr/001`, `002`).
- **Đã code xong** theo `docs/specs/phase1-auth.md`: module `auth` (register/login/refresh/
  logout/me), `infra/redis`, migration đầu tiên, guard đọc token từ cookie.
  **21/21 unit test xanh**, lint/typecheck/build sạch.
- **CÒN NỢ:** 12 integration test trong `test/auth.e2e-spec.ts` **chưa chạy lần nào** (Docker
  tắt lúc viết). Chạy `npm run up` rồi `npm run test:int`. Chưa xanh thì chưa xong Phase 1.
- **Biến môi trường mới** phải thêm vào `.env` và `.env.example`: `JWT_ACCESS_SECRET`,
  `JWT_REFRESH_SECRET` (mỗi cái ≥32 ký tự). Thiếu là app chết lúc khởi động.
- Phase 1 xong khi: 14 test case trong spec pass, **đặc biệt test số 8** (dùng lại refresh
  token cũ → thu hồi cả family) — đó là deliverable của phase theo `docs/SPEC.md`.
- Cập nhật mục này mỗi khi xong một mốc. **Không tạo checklist riêng cho Phase 1** (§Ngân
  sách tài liệu) — spec đã là danh sách việc.
