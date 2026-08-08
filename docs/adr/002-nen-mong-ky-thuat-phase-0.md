# ADR-002: Nền móng kỹ thuật Phase 0

- **Ngày:** 2026-08-07
- **Trạng thái:** Đã chốt

## Bối cảnh

Dựng skeleton Phase 0 phát sinh năm quyết định kỹ thuật nhỏ, đều là **hệ quả của việc chọn
stack** chứ không độc lập với nhau. Gộp một ADR thay vì tách năm file: tách ra sẽ loãng, và
đọc riêng từng cái thì không thấy chúng ràng buộc lẫn nhau.

## Quyết định

| # | Chọn | Câu chốt |
|---|---|---|
| 1 | **Prisma 7 + driver adapter `pg`** | Không pin Prisma 6 để né breaking change |
| 2 | **TypeScript 6**, không TS 7 | `ts-jest` chỉ hỗ trợ `<7` |
| 3 | **Không dùng path alias `@/`** | Import tương đối |
| 4 | **Tự viết ConfigModule** (~10 dòng) | Không dùng `@nestjs/config` |
| 5 | **`@Global()` cho Config + Prisma** | Ngoại lệ có chủ đích |

## Các lựa chọn đã cân nhắc

**1. Prisma 7 vs pin Prisma 6.** Prisma 7 bỏ `datasource.url` khỏi `schema.prisma` (chuyển sang
`prisma.config.ts`) và bắt buộc truyền driver adapter — tài liệu Prisma 6 trên mạng đã sai.
Pin lại v6 thì né được, nhưng ôm nợ nâng cấp. Chọn v7, và **hoá ra có lợi**: `pg.Pool` do mình
cấu hình nên số connection thành biến nhìn thấy và chỉnh được — đúng thứ cần cho benchmark
Phase 3 và Neon pooler Phase 6. Với Prisma 6, pool bị engine Rust giấu.

**2. TypeScript 6 vs 7.** TS 7 đã ra nhưng `ts-jest` khai `peerDependency: typescript <7`.
Phương án khác là đổi sang `@swc/jest` để dùng được TS 7 — nhưng đó là thêm một công cụ mới
vào chuỗi build để đổi lấy một con số version. Chọn TS 6, xem lại khi `ts-jest` hỗ trợ TS 7.

**3. Path alias `@/` vs import tương đối.** Alias đọc đẹp hơn, nhưng `nest build` chạy `tsc`
thuần và **không rewrite alias** — code sẽ dịch trót lọt rồi chết lúc runtime với
`Cannot find module '@/config'`. Sửa được bằng `tsconfig-paths` hoặc `tsc-alias`, tức thêm
một mắt xích nữa. Cây thư mục dự án nông (sâu nhất `../../`) nên alias không mua được gì.

**4. `@nestjs/config` vs tự viết.** Thư viện có sẵn nhưng phải học typing generic của
`ConfigService` và nó không ép validate. Tự viết: một schema Zod + `validateEnv()`, app **chết
ngay lúc boot** nếu thiếu biến, và `Env` là object đã `Object.freeze` có type suy ra từ schema.
Xem lại nếu về sau cần nhiều nguồn cấu hình (file + env + secret manager).

**5. `@Global()`.** Mâu thuẫn với nguyên tắc khai báo phụ thuộc tường minh. Chấp nhận đúng hai
chỗ: `ConfigModule` (mọi module đều cần, khai báo lại 20 lần là nhiễu) và `PrismaModule`
(`pg.Pool` **bắt buộc** là một instance duy nhất cho cả app — nhiều pool nghĩa là số connection
thật khác số mình nghĩ, và điều đó phá luôn benchmark Phase 3). **Module nghiệp vụ không bao
giờ được `@Global`.**

## Hệ quả & trade-off chấp nhận

- Prisma Client được generate vào `src/generated/prisma` (gitignore) → **CI bắt buộc phải chạy
  `db:generate`** trước typecheck. Đã trả giá một lần: CI đỏ vì Prisma 7 sinh import kèm đuôi
  `.js` trong khi file thật là `.ts`, phải thêm `moduleNameMapper` cho jest.
- Đi trước tài liệu phổ biến trên mạng: mọi hướng dẫn Prisma tìm được đều là v6. Đổi lại,
  cách đọc `node_modules/@prisma/config/dist/index.d.ts` để tìm API thật là kỹ năng dùng lại được.
- Bị khoá ở TS 6 cho tới khi `ts-jest` theo kịp.

**Xem lại khi:** `ts-jest` hỗ trợ TS 7 (quyết định 2), hoặc khi cần nhiều nguồn cấu hình
(quyết định 4).
