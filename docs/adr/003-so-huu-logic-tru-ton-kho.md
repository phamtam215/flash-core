# ADR-003: Module `order` sở hữu logic trừ tồn kho

- **Ngày:** 2026-09-01
- **Trạng thái:** Đã chốt

## Bối cảnh

Phase 3 phải trừ tồn kho và tạo đơn **atomic** (oversell = 0 là ràng buộc cứng của dự án).
Nhưng `stock` nằm trên bảng `product_skus` do module `product` sở hữu, còn đơn hàng thuộc
module `order` — hai ràng buộc kéo về hai hướng: "một bảng một chủ" (`docs/architecture.md`
quy tắc 2) và "trừ kho + tạo đơn phải cùng một transaction".

## Quyết định

Module `order` sở hữu **cả ba chiến lược reserve** (`order/strategies/*`) và đọc/ghi
`product_skus.stock` trực tiếp qua repository của chính nó.

## Các lựa chọn đã cân nhắc

- **`order` sở hữu logic trừ kho** ✅ — *ưu*: transaction nằm gọn trong một module, không có
  object transaction của Prisma nào đi qua ranh giới module; benchmark ba chiến lược chạy trên
  cùng một luồng nên so sánh công bằng. *nhược*: `order` chạm bảng do `product` sở hữu.
- **`product` sở hữu, export `INVENTORY_RESERVER`** — *ưu*: đúng chủ sở hữu dữ liệu. *nhược*:
  để atomic thì `order` phải truyền `tx` (kiểu `Prisma.TransactionClient`) qua ranh giới
  module — rò rỉ đúng thứ mà quy tắc 2 muốn tránh, và biến ranh giới module thành hình thức.
- **Tách module `inventory` riêng** — *ưu*: sạch về lý thuyết. *nhược*: hai module cùng ghi
  `product_skus`, hoặc phải tách bảng `stock` riêng và tự quản lý nhất quán giữa hai bảng —
  phức tạp hơn giá trị mang lại khi cả hệ thống vẫn là một process, một DB.

## Hệ quả & trade-off chấp nhận

**Được:** transaction hẹp và nhìn thấy được ở một chỗ (`order.repository.ts`); ba chiến lược
đổi bằng config mà không đổi ranh giới module; không có Prisma `tx` nào rò rỉ ra ngoài module.

**Mất:** `product_skus` giờ có hai module ghi vào — `product` ghi `price_vnd`/`is_active`,
`order` ghi `stock`/`version`. Đây là **nợ có ghi chép**, không phải chuyện vô tình. Ai đọc
`product` mà muốn biết `stock` đổi ở đâu sẽ phải đi sang `order` tìm.

**Giới hạn tự đặt để nợ không lan:** module `order` **chỉ** được ghi hai cột `stock` và
`version` của `product_skus`, không ghi cột nào khác; mọi câu SQL chạm bảng đó phải nằm trong
`order.repository.ts` (không rải ra service/strategy).

**Xem lại khi:** tách `inventory` thành service/deploy riêng (lúc đó mất transaction chung là
bắt buộc, phải chuyển sang saga/reservation-token — bài toán khác hẳn), hoặc khi xuất hiện
module thứ ba cần ghi `stock`.
