# ADR-001: Modular Monolith thay vì Microservices

- **Ngày:** 2026-08-07
- **Trạng thái:** Đã chốt

## Bối cảnh

Flash-Core là dự án một người, mục tiêu học **bản chất concurrency** (oversell = 0 dưới tải
cao) và làm portfolio. Cần chọn cách tách hệ thống trước khi viết dòng code đầu tiên, vì
quyết định này không đảo ngược rẻ được. Sức hút của microservices là nó "trông giống hệ thống
lớn" trên CV.

## Quyết định

**Modular Monolith**: một process, một lần deploy, nhưng module có ranh giới rõ và chỉ nói
chuyện với nhau qua public interface (`index.ts` + injection token).

## Các lựa chọn đã cân nhắc

- **Microservices** — *ưu*: nghe kêu trên CV; tách scale được từng phần. *nhược*: với một
  người, toàn bộ thời gian sẽ chảy vào hạ tầng (service discovery, distributed tracing,
  saga, deploy nhiều service) thay vì vào concurrency. Tệ hơn: **oversell trong hệ phân tán
  là bài toán khác** — mất đi khả năng dùng transaction và lock của một database duy nhất,
  tức là mất đúng thứ muốn học.
- **Monolith thường** (chia thư mục, không có ranh giới) — *ưu*: nhanh nhất. *nhược*: sau
  6 tháng thành mớ phụ thuộc chằng chịt, và không kể được câu chuyện kiến trúc nào.
- **Modular Monolith** ✅ — giữ được transaction/lock của một DB, vẫn có ranh giới để nói
  chuyện, và tách ra service riêng sau này là việc đổi phần implement chứ không phải viết lại.

## Hệ quả & trade-off chấp nhận

**Được:** giữ nguyên vũ khí cần cho Phase 3 — `SELECT FOR UPDATE`, isolation level, một
connection pool đo được. Deploy một container lên Cloud Run, hợp mục tiêu 0đ/tháng.

**Mất:** không scale riêng từng phần được. Chấp nhận vì tải thật của dự án là **local k6**,
không phải production.

**Ranh giới được enforce bằng hai tầng — cả hai đều là máy, không phải người:**

1. **NestJS DI container** (runtime): provider không nằm trong `exports` của module thì
   module khác không inject được → `Nest can't resolve dependencies`.
2. **ESLint `no-restricted-imports`** (lint time, chạy trong CI): chặn `import` thẳng vào file
   bên trong module khác. Cần tầng này vì DI chỉ chặn việc *inject*, không chặn được việc
   import class rồi tự `new`, hay import kiểu dữ liệu nội bộ.

Không có tầng 2 thì ranh giới chỉ là quy ước, và nó xói mòn **im lặng** — không test nào đỏ.

**Xem lại khi:** một module cần scale hoặc deploy độc lập thật sự (ví dụ worker xử lý queue
ăn CPU khác hẳn API). Lúc đó tách được vì đã có ranh giới; đó chính là điều ADR này mua.
