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
- `docs/claude-guide.md` — hướng dẫn dùng bộ công cụ Claude Code của repo: lệnh nào
  dùng khi nào, skill nào tự chạy lúc nào, hook nào chặn cái gì.

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
4. **Sau khi hoàn thành một tính năng**, tóm tắt luồng chạy bằng lời (5–10 câu,
   tiếng Việt) để Tâm dùng cho bước tự kiểm tra "câu hỏi bản chất".
5. **Giải thích khi được hỏi.** Khi Tâm hỏi "vì sao", trả lời ở mức bản chất
   (trade-off, cơ chế bên dưới), không chỉ mô tả code làm gì.

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

## Điều cấm
- Không thêm công nghệ mới (Kafka, K8s, microservices...) — nếu thấy cần, đề xuất
  qua ADR để Tâm quyết, không tự thêm.
- Không chạy load test / seed dữ liệu lớn lên môi trường cloud (free tier).
- Không hardcode secret; dùng env qua config module có validate bằng Zod.

## Bộ công cụ Claude Code (chi tiết ở `docs/claude-guide.md`)

**Skill** (tự kích hoạt, không cần gọi tay) — `.claude/skills/`:
`feature-spec` · `adr-writer` · `review-gate` · `phase-journal` · `essence-explainer` ·
`nestjs-module` · `concurrency-oversell` ⭐ · `queue-payment-reliability` ·
`db-postgres-performance` · `test-contract`

**Slash command** — `/spec` · `/adr` · `/review-gate` · `/commit` · `/journal` ·
`/quiz` (bị kiểm tra ngược) · `/phase-status`

**Hook** (`.claude/settings.json` → `.claude/hooks/`) — enforce luật tự động, không trông
vào việc AI tự nhớ:
- `git push` bị **chặn cứng** → chỉ Tâm push, sau khi review.
- Commit message sai chuẩn Conventional Commits → **chặn**; thiếu thân "vì sao" → **hỏi**.
- `k6 run` / seed / `migrate reset` khi biến kết nối trỏ ra cloud → **chặn** (FinOps).
- Cài package đã bị loại có chủ đích → **chặn**; package lạ → **hỏi Tâm** (không tự thêm).
- Ghi vào `.env` hoặc hardcode secret → **chặn / hỏi**.
- Đầu mỗi phiên: tự nạp trạng thái phase, số spec/ADR, việc treo.

Nếu một hook chặn, **đừng tìm cách lách** — dừng lại và báo Tâm.

**Agent** — `code-reviewer`: reviewer độc lập chỉ đọc không sửa. Dùng khi diff lớn hoặc
chạm phần nguy hiểm (trừ tồn kho, transaction, webhook, auth).

**MCP** — Context7 bật sẵn (tra tài liệu đúng phiên bản NestJS/Prisma/BullMQ/Zod).
Postgres MCP bật ở Phase 2, Playwright MCP ở Phase 3. Xem `docs/mcp-setup.md`.

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
- Phase hiện tại: **Phase 0 — Nền móng** (xem docs/SPEC.md)
- Đã xong: skeleton NestJS + config Zod + Pino/correlationId + exception filter +
  Prisma 7 (pg adapter) + module `health` mẫu + Docker Compose + CI.
  **11/11 unit test + 5/5 integration test (Testcontainers, Postgres thật) pass**,
  lint/typecheck/build sạch.
- **Còn nợ (nguồn sự thật duy nhất — các file khác trỏ về đây):**
  1. Viết ADR cho 5 quyết định kỹ thuật ở `docs/specs/phase0-nen-mong.md` mục cuối. Hiện 0/10.
  2. Kiểm tra CI: đã push `015fef2` nên workflow đã kích hoạt, nhưng **chưa ai xem kết quả**.
     Mở https://github.com/phamtam215/flash-core/actions xác nhận xanh hay đỏ.
- Cập nhật mục này mỗi khi hoàn thành một phase.
