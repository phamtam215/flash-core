import { z } from 'zod';

/** Một mẫu trong đợt: cắt bao nhiêu hàng ra, bán giá nào, mỗi người tối đa mấy chiếc. */
const saleEventItemSchema = z.object({
  skuId: z.string().uuid('skuId phải là UUID'),
  salePriceVnd: z.number().int().positive(),
  /** Số hàng **cắt ra** từ `ProductSku.stock` lúc publish — không phải bản sao (ADR-015). */
  allocatedStock: z.number().int().positive(),
  perUserLimit: z.number().int().positive().max(100).default(2),
});

export const createSaleEventSchema = z
  .object({
    name: z.string().min(1).max(200),
    slug: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[a-z0-9-]+$/, 'slug chỉ gồm chữ thường, số và dấu gạch nối'),
    startsAt: z.coerce.date(),
    endsAt: z.coerce.date(),
    items: z.array(saleEventItemSchema).min(1, 'Đợt sale phải có ít nhất một mẫu'),
  })
  .refine((v) => v.endsAt > v.startsAt, {
    message: 'endsAt phải sau startsAt',
    path: ['endsAt'],
  });

export type CreateSaleEventDto = z.infer<typeof createSaleEventSchema>;
export type SaleEventItemDto = z.infer<typeof saleEventItemSchema>;

/**
 * Trạng thái **tính ra**, không lưu trong DB. Xem `schema.prisma` §SaleEvent để biết vì sao.
 */
export type SaleEventStatus = 'DRAFT' | 'SCHEDULED' | 'OPEN' | 'ENDED';

/**
 * Tính trạng thái từ dữ liệu + mốc thời gian.
 *
 * **Dùng cho HIỂN THỊ, không dùng để quyết định bán.** Quyết định bán phải nằm trong chính
 * câu `UPDATE` với `now()` của Postgres (xem `order.repository.ts`) — hàm này chạy trong RAM
 * của Node nên nó luôn nói về một thời điểm đã cũ, và mỗi instance có đồng hồ riêng.
 */
export function saleEventStatus(
  event: { isPublished: boolean; startsAt: Date; endsAt: Date },
  now: Date = new Date(),
): SaleEventStatus {
  if (!event.isPublished) return 'DRAFT';
  if (now < event.startsAt) return 'SCHEDULED';
  if (now > event.endsAt) return 'ENDED';
  return 'OPEN';
}
