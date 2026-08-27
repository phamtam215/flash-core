# Tổng kết Phase 1 — Auth & Security

> Viết ngày 2026-08-27, ngay sau khi 14/14 test case pass. Bản tổng kết **thực tế** (Claude
> viết), không phải journal học tập đầy đủ — xem lưu ý ở `docs/journal/phase-0.md`. Phần
> **Câu hỏi bản chất** để trống cho Tâm tự trả lời.

## Thời gian

Bắt đầu 2026-08-08 → code + test xong **2026-08-27**. Chưa "đóng phase" chính thức — còn chờ
Tâm review diff và push (`docs/git-workflow.md` §AI không push trước khi review).

## Đã làm

- Migration `User` + `RefreshToken` (spec: `docs/specs/phase1-auth.md`)
- `register` / `login` / `refresh` / `logout` / `me`
- Argon2id hash mật khẩu (memory-hard, chống GPU brute-force)
- JWT access + refresh, **hai secret riêng** (access verify không lẫn được sang refresh)
- **Refresh token rotation + reuse detection**: mỗi token chỉ dùng đúng 1 lần; dùng lại token
  đã xoay → thu hồi **toàn bộ family**, không riêng token đó — vì không biết ai là chủ thật
- Rate limit login đếm ở Redis (không phải RAM — đúng khi chạy nhiều instance)
- Cookie `HttpOnly` cho cả access lẫn refresh token
- `infra/redis` — module hạ tầng mới, `RedisModule`/`RedisService`

## Số liệu

- **14/14 test case trong spec pass**: 21 unit test (8 DTO + 13 khác) + 12 integration test
  auth + 5 integration test health = **17/17** khi chạy `npm run test:int`
- **Test #8 xanh** (dùng lại refresh token cũ → thu hồi cả family) — deliverable chính của
  phase theo `docs/SPEC.md`
- 2 biến môi trường mới bắt buộc: `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` (≥32 ký tự)

## Bug đáng nhớ — lần đầu integration test thật sự chạy

`npm run test:int` đỏ 17/17 ngay lần chạy đầu: `TypeError: A dynamic import callback was
invoked without --experimental-vm-modules`. Nguyên nhân: Prisma 7 tải query compiler bằng
WASM qua `await import(...)`, kể cả khi generator đặt `moduleFormat = "cjs"` (cờ đó không đổi
cách tải WASM). Jest chạy test trong `vm.Context`, cần cờ này mới đăng ký được dynamic import
callback. Không lộ ở unit test vì `PrismaService` ở đó luôn bị mock — bug chỉ hiện khi engine
Prisma khởi động thật, đúng lúc integration test chạm vào lần đầu tiên. Đã sửa trong
`package.json` (`test:int`). Chi tiết: `docs/tech-playbook.md` §Xuyên suốt → Testing →
Bug hay gặp.

## Còn lại trước khi đóng phase

Tâm review diff → push. Sau đó tuỳ chọn: viết journal đầy đủ (câu hỏi bản chất bên dưới) rồi
mới mở Phase 2.

## Commit liên quan

`038c68d` (feat auth: toàn bộ module) · `3ed3044` (fix test: `--experimental-vm-modules`)

## Câu hỏi bản chất của phase (SPEC.md) — Tâm tự trả lời

- Vì sao Argon2 tốt hơn bcrypt cho việc hash mật khẩu?
- `HttpOnly` chống XSS bằng cách nào — và vì sao có `HttpOnly` rồi vẫn phải lo CSRF?
- Refresh token rotation phát hiện việc token bị đánh cắp (theft) như thế nào? Nếu kẻ trộm
  dùng token trước, chuyện gì xảy ra? Nếu chủ thật dùng trước thì sao?
