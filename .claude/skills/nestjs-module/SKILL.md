---
name: nestjs-module
description: >
  Tạo hoặc mở rộng một module NestJS trong src/modules/ đúng convention Flash-Core:
  controller / service / repository / dto bằng Zod, ranh giới module qua public interface,
  tiền tệ số nguyên VND, Idempotency-Key cho API ghi đơn hàng, log Pino kèm correlationId,
  exception filter thống nhất, config validate bằng Zod. Dùng skill này khi cần tạo module
  mới, thêm endpoint, thêm service/repository/DTO, khi Tâm nói "scaffold", "tạo module",
  "thêm API", "viết controller", hoặc khi đang sửa code trong src/modules/ và cần biết
  chuẩn của dự án. Cũng dùng khi thấy code vi phạm ranh giới module (import trực tiếp
  service của module khác).
---

# Convention module NestJS của Flash-Core

Kiến trúc là **Modular Monolith**: một process, nhưng module có ranh giới thật. Ranh giới
đó là toàn bộ lý do dự án không chọn microservices (`project-context.md` §3 quyết định #3)
— nếu module dính vào nhau thì dự án chỉ còn là monolith thường và mất luôn câu chuyện
kiến trúc để kể.

Ưu tiên tuyệt đối: **code dễ đọc, dễ giải thích hơn code thông minh** (`CLAUDE.md`).
Một `reduce` lồng ba tầng tiết kiệm 5 dòng nhưng làm Tâm không kể lại được luồng chạy là
một đánh đổi sai ở dự án này.

## Cấu trúc thư mục

```
src/modules/<ten-module>/
├── <ten>.module.ts          # khai báo providers, exports — chỉ export public interface
├── <ten>.controller.ts      # HTTP: parse/validate → gọi service → map response
├── <ten>.service.ts         # nghiệp vụ + transaction boundary
├── <ten>.repository.ts      # mọi truy cập Prisma nằm ở đây, không rải ra service
├── dto/
│   └── <viec>.dto.ts        # Zod schema + type suy ra từ schema
├── index.ts                 # public interface của module (xem dưới)
└── <ten>.service.spec.ts    # unit test cạnh code
```

Test integration (dùng DB thật) nằm ở `test/` cấp repo, không trong `src/` — xem skill
`test-contract`.

## Ranh giới module — enforce bằng gì

`CLAUDE.md`: *module không import trực tiếp service của module khác — chỉ qua public
interface được export.* Cụ thể:

1. Mỗi module có `index.ts` export **đúng những gì bên ngoài được dùng**: token/interface,
   DTO công khai, và module class. Không export repository, không export Prisma model.
2. Module khác import từ `src/modules/<ten>` (tức `index.ts`), không import sâu vào
   `src/modules/<ten>/<ten>.service`.
3. Với phụ thuộc dễ thành vòng tròn hoặc cần đảo chiều, khai báo interface + injection
   token thay vì import class:

```ts
// src/modules/inventory/index.ts
export const INVENTORY_SERVICE = Symbol('INVENTORY_SERVICE');

export interface InventoryPort {
  /** Trừ tồn kho theo SKU. Trả về false nếu không còn hàng — không throw. */
  reserve(skuId: string, qty: number): Promise<boolean>;
}

export { InventoryModule } from './inventory.module';
```

Module `order` phụ thuộc vào `InventoryPort`, không vào `InventoryService`. Đây là
Dependency Injection dùng đúng mục đích (`docs/glossary.md` Phase 0) và là thứ khiến
module test được mà không dựng cả hệ thống.

Khi phát hiện code vi phạm ranh giới → nêu ra ở `review-gate`, đừng im lặng sửa cho chạy.

## DTO bằng Zod (không dùng class-validator)

Schema-first: khai báo một lần, dùng cho cả validate và type.

```ts
// dto/create-order.dto.ts
import { z } from 'zod';

export const createOrderSchema = z.object({
  skuId: z.string().uuid(),
  quantity: z.number().int().positive().max(5),
  // Cố tình KHÔNG nhận price từ client — giá lấy từ DB tại thời điểm đặt (snapshot price).
});

export type CreateOrderDto = z.infer<typeof createOrderSchema>;
```

Hai luật đi kèm:

- **Không tin dữ liệu client cho giá và tồn kho.** Nếu thấy `price` hay `stock` trong
  request schema thì gần như chắc chắn là lỗ hổng — server tự đọc từ DB.
- Validate **ở biên** (pipe của controller), để service nhận vào dữ liệu đã sạch và đã có
  type. Dùng một `ZodValidationPipe` dùng chung toàn repo, không viết lại ở từng controller:

```ts
@Post()
create(@Body(new ZodValidationPipe(createOrderSchema)) dto: CreateOrderDto) { ... }
```

Lỗi validate phải ra HTTP 400 với danh sách field lỗi, đi qua exception filter chung.

## Idempotency-Key cho API ghi đơn hàng

`CLAUDE.md`: *mọi API ghi (POST/PUT) liên quan đơn hàng phải nhận `Idempotency-Key`
header.* Điểm cốt lõi không phải là nhận header, mà là **kiểm tra ở đúng chỗ**:

- Check **trước khi tạo bất kỳ side effect nào** (trước khi trừ kho, trước khi ghi đơn).
- Lưu key vào bảng riêng với **unique constraint** trên `(userId, key)` — dựa vào DB để
  chống race, không dựa vào `SELECT` rồi `INSERT` (chính là lost update).
- Gọi lại cùng key → trả về **kết quả của lần đầu** (200 + đơn cũ), không tạo đơn mới,
  không trừ kho lần hai.
- Cùng key nhưng body khác → 422, vì đó là lỗi phía client.

Chi tiết cơ chế xem skill `concurrency-oversell`.

## Tiền tệ

Lưu **số nguyên VND** (`Int`/`BigInt` trong Prisma). Không dùng `Float`/`Number` cho tiền
— sai số dấu phẩy động sẽ hiện ra ở tổng đơn và không có cách sửa hồi tố. Đặt tên field
rõ đơn vị (`priceVnd`, `totalVnd`) để người đọc không phải đoán.

`order_items` lưu **giá snapshot tại thời điểm mua**, không join lấy giá hiện tại —
flash sale đổi giá liên tục, đơn cũ phải giữ giá cũ (`docs/glossary.md` Phase 3:
snapshot / point-in-time data).

## Log

Pino, JSON, **luôn kèm `correlationId`**. Không log password, token, số thẻ, cookie.

- `correlationId` sinh ở middleware nếu request chưa có, và **truyền qua cả job queue**
  (đưa vào payload job) để nối được hành trình request → worker. Đây là deliverable của
  Phase 5: từ 1 request lỗi truy lại toàn bộ hành trình bằng 1 id.
- Log ở tầng service những mốc quyết định (trừ kho thành công/thất bại, chuyển trạng thái
  đơn), không log mọi dòng.

## Lỗi

- Exception filter thống nhất cho toàn app; controller không tự `try/catch` rồi trả về
  response tự bịa.
- **Không có `catch` rỗng**, không `catch` chỉ `console.log` rồi đi tiếp.
- Phân loại đúng: client gửi sai / hết hàng / vi phạm nghiệp vụ → 4xx (409 cho hết hàng
  là hợp lý). DB chết, Redis chết, bug → 5xx.
- Lỗi nghiệp vụ dùng exception class riêng của module (ví dụ `OutOfStockError`), controller
  hoặc filter map sang HTTP — service không biết gì về HTTP.

## Transaction

- Boundary **hẹp nhất có thể**, nằm ở service, không ở controller, không ở repository.
- **Không gọi API ngoài, không gửi email, không await HTTP trong transaction.** Việc đó
  đi qua queue (xem skill `queue-payment-reliability`).
- Với Prisma cần pessimistic lock thì phải dùng `$queryRaw` trong `$transaction`
  interactive — Prisma không có API cho `SELECT ... FOR UPDATE`. Đây là bài học "khi nào
  ORM không đủ" (`project-context.md` quyết định #5), nên viết comment giải thích tại chỗ.

## Config

Mọi biến môi trường đi qua config module có **schema Zod validate lúc khởi động** — app
phải fail ngay khi thiếu biến, không fail lúc 3h sáng khi có request đầu tiên chạm tới.
Không hardcode secret. Không đọc `process.env` rải rác trong service; inject config.

## Sau khi tạo module

1. Có test theo danh sách "Test cases phải pass" của spec (skill `test-contract`).
2. Chạy skill `review-gate` trước khi báo xong.
3. Tóm tắt luồng chạy 5–10 câu tiếng Việt cho Tâm.
