import { z } from 'zod';

/**
 * Schema của dữ liệu client gửi lên — validate ở BIÊN bằng `ZodValidationPipe`, cùng cách
 * module `auth` đã làm (xem `src/modules/auth/auth.dto.ts`).
 */

export const skuSizeSchema = z.enum(['S', 'M', 'L', 'XL', 'XXL']);

export const skuInputSchema = z.object({
  size: skuSizeSchema,
  color: z.string().trim().min(1).max(50),
  priceVnd: z.number().int().positive(),
  stock: z.number().int().nonnegative(),
});

/**
 * Slug tự chuẩn hoá (`trim` + `toLowerCase`) trước khi kiểm định dạng — cùng lý do với
 * `emailField` ở `auth.dto.ts`: `"Ao-Thun"` không nên bị từ chối chỉ vì client gõ hoa.
 */
const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Slug chỉ gồm chữ thường, số và dấu gạch ngang'));

/**
 * Thuộc tính MỞ của Product (chất liệu, hoạ tiết...) — xem ghi chú ở model `Product` trong
 * `schema.prisma` để biết vì sao đây là JSONB, không phải cột riêng. Ràng buộc shape TỐI
 * THIỂU ở đây (record phẳng, không nested) để tránh rác hoàn toàn tự do, nhưng vẫn giữ đúng
 * bản chất JSONB — không ép một tập enum cứng.
 */
const attributesSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()]));

export const createProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  // Thiếu → service tự sinh từ `name` (xem `product.slug.ts`).
  slug: slugSchema.optional(),
  description: z.string().trim().max(2000).optional(),
  attributes: attributesSchema.optional(),
  skus: z.array(skuInputSchema).max(50).optional(),
});

export const updateProductSchema = createProductSchema
  .pick({ name: true, description: true, attributes: true })
  .partial();

export const updateSkuSchema = z.object({
  priceVnd: z.number().int().positive().optional(),
  stock: z.number().int().nonnegative().optional(),
  isActive: z.boolean().optional(),
});

/**
 * Query của API danh sách (`GET /products`, `GET /skus`, `GET /products/:id/skus`).
 *
 * `z.coerce.number()` bắt buộc vì query string luôn tới dưới dạng string (`?limit=20` nghĩa
 * là Express đưa vào `"20"`, không phải `20`) — cùng lý do `PORT` trong `env.schema.ts` phải
 * coerce.
 */
export const listQuerySchema = z.object({
  cursor: z.string().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type SkuInput = z.infer<typeof skuInputSchema>;
export type CreateProductDto = z.infer<typeof createProductSchema>;
export type UpdateProductDto = z.infer<typeof updateProductSchema>;
export type UpdateSkuDto = z.infer<typeof updateSkuSchema>;
export type ListQueryDto = z.infer<typeof listQuerySchema>;
