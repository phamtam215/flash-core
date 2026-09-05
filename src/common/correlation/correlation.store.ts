import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

interface CorrelationContext {
  correlationId: string;
}

/**
 * Chỗ giữ `correlationId` cho **toàn bộ** một luồng công việc — một HTTP request, hoặc một job.
 *
 * `AsyncLocalStorage` là kho lưu trữ đi theo *ngữ cảnh bất đồng bộ*: mọi thứ chạy bên trong
 * `run()` — kể cả sau `await`, kể cả trong callback lồng mấy tầng — đều đọc được cùng một giá
 * trị, mà không ai phải truyền nó qua tham số. Node tự nối ngữ cảnh qua các mắt xích async.
 *
 * **Vì sao chọn cách này thay vì truyền tham số** (spec Phase 6, câu hỏi mở #1): truyền tham
 * số thì mọi service phải nhận thêm một tham số chẳng liên quan gì tới nghiệp vụ của nó, và
 * **chỉ cần một chỗ quên là đứt chuỗi** — mà chỗ quên đó không có test nào bắt được. Cái giá
 * phải trả là "phép màu ngầm": đọc `OrderService` sẽ không thấy id được truyền vào từ đâu.
 * Đó là lý do file này được comment kỹ, và là lý do chỉ có ĐÚNG HAI chỗ gọi `run()` —
 * middleware HTTP và `JobProcessor`.
 *
 * Điều dễ hiểu lầm: đây **không phải** biến toàn cục. Hai request chạy song song có hai store
 * riêng biệt, không thấy nhau — chính là điều kiện để nó dùng được ở server.
 */
const storage = new AsyncLocalStorage<CorrelationContext>();

/** Chạy `fn` trong một ngữ cảnh mang `correlationId`. Không truyền id thì sinh mới. */
export function runWithCorrelationId<T>(correlationId: string | undefined, fn: () => T): T {
  return storage.run({ correlationId: correlationId ?? randomUUID() }, fn);
}

/**
 * Id của luồng hiện tại, hoặc `undefined` nếu đang ở ngoài mọi luồng.
 *
 * `undefined` ở đây là **đúng**, không phải lỗi: log lúc khởi động app không thuộc request
 * nào cả. Đừng sinh id giả cho nó — một id không nối với gì thì chỉ làm nhiễu.
 */
export function getCorrelationId(): string | undefined {
  return storage.getStore()?.correlationId;
}
