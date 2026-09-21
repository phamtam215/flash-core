-- RBAC — trả nợ kỹ thuật ghi từ Phase 2.
-- Spec: docs/specs/rbac.md

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');

-- AlterTable
-- Có DEFAULT và NOT NULL. Từ Postgres 11, thêm cột NOT NULL kèm DEFAULT hằng số là thao tác
-- **metadata-only**: giá trị mặc định được lưu trong catalog, không ghi lại từng dòng của
-- bảng. Nên câu này chạy tức thì kể cả khi `users` đã lớn, và không khoá bảng lâu.
--
-- `DEFAULT 'USER'` cũng là lựa chọn an toàn duy nhất: mọi tài khoản đang có — và mọi tài
-- khoản đăng ký sau này — đều KHÔNG phải admin cho tới khi có người chủ động nâng quyền.
ALTER TABLE "users" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'USER';
