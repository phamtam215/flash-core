import {
  createProductSchema,
  listQuerySchema,
  skuInputSchema,
  updateSkuSchema,
} from './product.dto';

describe('product.dto', () => {
  describe('createProductSchema', () => {
    it('chấp nhận sản phẩm hợp lệ không kèm slug/skus', () => {
      const result = createProductSchema.safeParse({ name: 'Áo Thun Basic' });
      expect(result.success).toBe(true);
    });

    it('chuẩn hoá slug về chữ thường', () => {
      const result = createProductSchema.safeParse({ name: 'X', slug: 'Ao-Thun' });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data.slug).toBe('ao-thun');
    });

    it('từ chối slug có ký tự không hợp lệ (khoảng trắng, dấu gạch dưới)', () => {
      expect(createProductSchema.safeParse({ name: 'X', slug: 'ao thun' }).success).toBe(false);
      expect(createProductSchema.safeParse({ name: 'X', slug: 'ao_thun' }).success).toBe(false);
    });

    it('chấp nhận tối đa 50 SKU, từ chối 51', () => {
      const oneSku = { size: 'M' as const, color: 'Đen', priceVnd: 100_000, stock: 10 };
      expect(
        createProductSchema.safeParse({ name: 'X', skus: Array(50).fill(oneSku) }).success,
      ).toBe(true);
      expect(
        createProductSchema.safeParse({ name: 'X', skus: Array(51).fill(oneSku) }).success,
      ).toBe(false);
    });

    it('attributes chỉ chấp nhận record phẳng (string/number/boolean), không nested', () => {
      expect(
        createProductSchema.safeParse({ name: 'X', attributes: { material: 'cotton', weightGram: 180 } })
          .success,
      ).toBe(true);
      expect(
        createProductSchema.safeParse({ name: 'X', attributes: { nested: { a: 1 } } }).success,
      ).toBe(false);
    });
  });

  describe('skuInputSchema', () => {
    it('từ chối size ngoài danh sách cho phép', () => {
      const result = skuInputSchema.safeParse({ size: 'XXXL', color: 'Đen', priceVnd: 1, stock: 1 });
      expect(result.success).toBe(false);
    });

    it('từ chối priceVnd <= 0 — tiền phải dương', () => {
      expect(
        skuInputSchema.safeParse({ size: 'M', color: 'Đen', priceVnd: 0, stock: 1 }).success,
      ).toBe(false);
    });
  });

  describe('updateSkuSchema — test case #6 trong spec', () => {
    it('từ chối stock âm ở tầng Zod, KHÔNG chạm DB', () => {
      const result = updateSkuSchema.safeParse({ stock: -5 });
      expect(result.success).toBe(false);
    });

    it('chấp nhận sửa từng field riêng lẻ', () => {
      expect(updateSkuSchema.safeParse({ stock: 5 }).success).toBe(true);
      expect(updateSkuSchema.safeParse({ isActive: false }).success).toBe(true);
    });
  });

  describe('listQuerySchema — test case #10 trong spec', () => {
    it('mặc định limit = 20 khi không truyền', () => {
      const result = listQuerySchema.parse({});
      expect(result.limit).toBe(20);
    });

    it('ép limit từ string sang number — query string luôn là string', () => {
      const result = listQuerySchema.parse({ limit: '30' });
      expect(result.limit).toBe(30);
    });

    it('từ chối limit vượt quá 100, KHÔNG tự động clamp âm thầm', () => {
      const result = listQuerySchema.safeParse({ limit: '200' });
      expect(result.success).toBe(false);
    });

    it('từ chối limit <= 0', () => {
      expect(listQuerySchema.safeParse({ limit: '0' }).success).toBe(false);
    });
  });
});
