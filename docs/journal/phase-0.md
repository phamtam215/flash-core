# Tổng kết Phase 0 — Nền móng & Quy trình AI

> Viết ngày 2026-08-27, sau khi Phase 0 đã đóng (2026-08-08). Đây là bản tổng kết **thực tế**
> (Claude viết lại từ git log + tài liệu đã có), không phải journal học tập đầy đủ kiểu skill
> `phase-journal` — quyết định gốc (`docs/phase-0-checklist.md`) là journal chỉ bắt đầu từ
> Phase 3. Phần **Câu hỏi bản chất** ở cuối cố tình để trống — Tâm tự trả lời, không đọc đáp
> án trước khi tự nghĩ (lý do: `project-context.md` §5 — ảo giác thông thạo).

## Thời gian

Bắt đầu → đóng: 2026-08-05 → **2026-08-08**. Hồ sơ đầy đủ: `docs/phase-0-checklist.md`.

## Đã làm

- Skeleton NestJS + TypeScript strict, validate env bằng Zod
- Pino JSON log + `correlationId` sinh ở middleware, gắn xuyên request → response header
- Exception filter thống nhất (`APP_FILTER`) — một hình dạng lỗi cho toàn hệ thống
- Prisma 7 + driver adapter `@prisma/adapter-pg` (bọc `pg.Pool` tự cấu hình)
- Module `health` (liveness/readiness) — khuôn mẫu cấu trúc cho mọi module sau
- Docker Compose (Postgres 16 + Redis 7) cho local
- CI GitHub Actions: generate → lint → typecheck → test → build, chạy trên mọi PR/push `main`
- **Ranh giới module enforce bằng 2 tầng máy**: NestJS DI (chặn inject) + ESLint
  `no-restricted-imports` (chặn import sâu) — đây là thứ duy nhất khiến kiến trúc này khác
  một monolith thường

## Số liệu

- **16/16 test pass** lúc đóng phase
- Doc budget: đo được **1 dòng code : 5 dòng tài liệu** (990 vs 5.050) → cắt `.claude/` từ
  3.098 dòng còn ~350 (xoá 10 skill, 6 hook, 5 command, 1 agent). Luật mới:
  `CLAUDE.md` §Ngân sách tài liệu

## Quyết định đáng chú ý (chi tiết ở ADR, không lặp lại ở đây)

- [`adr/001-modular-monolith.md`](../adr/001-modular-monolith.md) — Modular Monolith thay vì
  Microservices, và cơ chế 2 tầng enforce ranh giới module
- [`adr/002-nen-mong-ky-thuat-phase-0.md`](../adr/002-nen-mong-ky-thuat-phase-0.md) — 5 quyết
  định kỹ thuật gộp: Prisma 7 + adapter `pg`, TypeScript 6, không path alias, tự viết
  `ConfigModule`, `@Global` đúng hai chỗ

## Bug/gotcha đáng nhớ

Toàn bộ nằm ở việc Prisma 7 khác hẳn tài liệu cũ trên mạng (đã ghi ở `docs/architecture.md`
§Những chỗ dễ vấp): `datasource.url` chuyển sang `prisma.config.ts`, import sinh ra kèm đuôi
`.js` dù file thật là `.ts` (cần `moduleNameMapper` trong cả hai config Jest), `.tsbuildinfo`
cũ khiến `nest build` báo thành công nhưng `dist/` rỗng.

## Commit liên quan

`e9c5ad5` (ESLint chặn import sâu) · `ae4e7f3` (2 ADR) · `8be66e3` (checklist) ·
`38910c9` (tinh gọn `.claude`) · `b0e9f01` (dẫn đường đọc code) ·
`c723684` (đóng Phase 0, duyệt spec Phase 1)

## Câu hỏi bản chất của phase (SPEC.md) — Tâm tự trả lời

- Modular Monolith vs Microservices — khác nhau ở đâu, đánh đổi gì?
- Vì sao dự án một người **không nên** làm microservices?
- Ranh giới module được enforce bằng gì trong NestJS — và vì sao **một mình** DI container
  của Nest không đủ?
