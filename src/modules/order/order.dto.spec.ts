import { createOrderSchema, listOrderQuerySchema } from './order.dto';

const VALID_UUID = '3f1b9c4e-2d55-4a1e-8b1a-0f1b2c3d4e5f';

describe('order.dto', () => {
  describe('createOrderSchema — test case #5 trong spec', () => {
    it('chấp nhận đơn hợp lệ', () => {
      const result = createOrderSchema.safeParse({ skuId: VALID_UUID, quantity: 2 });
      expect(result.success).toBe(true);
    });

    it('từ chối quantity = 0 và số âm', () => {
      expect(createOrderSchema.safeParse({ skuId: VALID_UUID, quantity: 0 }).success).toBe(false);
      expect(createOrderSchema.safeParse({ skuId: VALID_UUID, quantity: -1 }).success).toBe(false);
    });

    it('từ chối quantity vượt trần 5 — chống gom hàng flash sale', () => {
      expect(createOrderSchema.safeParse({ skuId: VALID_UUID, quantity: 6 }).success).toBe(false);
      expect(createOrderSchema.safeParse({ skuId: VALID_UUID, quantity: 5 }).success).toBe(true);
    });

    it('từ chối quantity không phải số nguyên', () => {
      expect(createOrderSchema.safeParse({ skuId: VALID_UUID, quantity: 1.5 }).success).toBe(false);
    });

    it('từ chối skuId không phải UUID', () => {
      expect(createOrderSchema.safeParse({ skuId: 'khong-phai-uuid', quantity: 1 }).success).toBe(
        false,
      );
    });

    it('LOẠI field `price` do client tự thêm — test case #10, snapshot price', () => {
      // Đây là hàng rào chống "mua áo 500k với giá 1đ": schema không khai `price` nên Zod bỏ
      // nó đi, service luôn lấy giá từ DB.
      const result = createOrderSchema.parse({ skuId: VALID_UUID, quantity: 1, price: 1 });
      expect(result).not.toHaveProperty('price');
      expect(result).toEqual({ skuId: VALID_UUID, quantity: 1 });
    });
  });

  describe('listOrderQuerySchema', () => {
    it('mặc định limit = 20', () => {
      expect(listOrderQuerySchema.parse({}).limit).toBe(20);
    });

    it('ép limit từ string sang number — query string luôn là string', () => {
      expect(listOrderQuerySchema.parse({ limit: '30' }).limit).toBe(30);
    });

    it('từ chối limit vượt 100, không tự clamp âm thầm', () => {
      expect(listOrderQuerySchema.safeParse({ limit: '200' }).success).toBe(false);
    });
  });
});
