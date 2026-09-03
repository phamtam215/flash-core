import { z } from 'zod';

/**
 * Schema của "săn ngay".
 *
 * KHÔNG có field `price`. Giá luôn đọc từ DB tại thời điểm trừ kho (snapshot price) — client
 * gửi giá lên là con đường ngắn nhất để mua áo 500k với giá 1đ. `ZodValidationPipe` tự loại
 * field lạ, và đã có test cho đúng hành vi đó từ Phase 0.
 */
export const createOrderSchema = z.object({
  skuId: z.string().uuid('skuId phải là UUID'),

  /**
   * Trần 5 chiếc/đơn: flash sale cần chống gom hàng. Không có bảng cấu hình per-event ở phase
   * này — khi có bảng Event (Phase 3+) thì trần sẽ đọc từ đó.
   */
  quantity: z.number().int().positive().max(5, 'Tối đa 5 sản phẩm mỗi đơn'),
});

/**
 * Query của `GET /orders` — cùng cơ chế keyset `(createdAt, id)` với Phase 2, dùng chung helper
 * ở `common/pagination`. `z.coerce` vì query string luôn tới dưới dạng string.
 */
export const listOrderQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateOrderDto = z.infer<typeof createOrderSchema>;
export type ListOrderQueryDto = z.infer<typeof listOrderQuerySchema>;
