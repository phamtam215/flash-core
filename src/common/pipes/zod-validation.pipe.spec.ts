import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

import { ZodValidationPipe } from './zod-validation.pipe';

describe('ZodValidationPipe', () => {
  const schema = z.object({
    skuId: z.string().uuid(),
    quantity: z.number().int().positive().max(5),
  });

  const pipe = new ZodValidationPipe(schema);
  const validInput = { skuId: '3f1b9c4e-2d55-4a1e-8b1a-0f1b2c3d4e5f', quantity: 2 };

  it('trả về dữ liệu đã parse khi input hợp lệ', () => {
    expect(pipe.transform(validInput)).toEqual(validInput);
  });

  it('ném BadRequest (400) kèm danh sách field lỗi, không phải 500', () => {
    // Lỗi do client gửi sai phải là 4xx. Nếu nó thành 5xx, error rate trong báo cáo k6 ở
    // Phase 3 sẽ lẫn lỗi hệ thống với lỗi input và không còn nói lên điều gì.
    expect(() => pipe.transform({ skuId: 'không-phải-uuid', quantity: 0 })).toThrow(
      BadRequestException,
    );

    try {
      pipe.transform({ skuId: 'không-phải-uuid', quantity: 0 });
      fail('đáng lẽ phải throw');
    } catch (error) {
      const body = (error as BadRequestException).getResponse() as {
        code: string;
        fields: { path: string; message: string }[];
      };

      expect(body.code).toBe('VALIDATION_FAILED');
      expect(body.fields.map((f) => f.path).sort()).toEqual(['quantity', 'skuId']);
    }
  });

  it('loại bỏ field lạ mà client tự thêm vào', () => {
    // Quan trọng với dự án này: client KHÔNG được gửi `price`. Giá luôn lấy từ DB tại thời
    // điểm đặt (snapshot price). Schema không khai báo `price` nên Zod bỏ nó đi.
    const result = pipe.transform({ ...validInput, price: 1 }) as Record<string, unknown>;

    expect(result).not.toHaveProperty('price');
  });
});
