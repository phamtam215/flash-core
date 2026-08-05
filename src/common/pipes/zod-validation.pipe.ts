import { BadRequestException, Injectable, type PipeTransform } from '@nestjs/common';
import { ZodError, type ZodType } from 'zod';

/**
 * Validate input ở BIÊN bằng Zod, để service luôn nhận dữ liệu đã sạch và đã có type.
 *
 * Dùng như thế này trong controller:
 *
 *   @Post()
 *   create(@Body(new ZodValidationPipe(createOrderSchema)) dto: CreateOrderDto) { ... }
 *
 * Vì sao Zod thay class-validator (quyết định #7): một schema dùng cho cả hai việc —
 * validate lúc runtime và suy ra type lúc compile (`z.infer`). Với class-validator, type và
 * luật validate là hai thứ tách rời và có thể lệch nhau mà TypeScript không phát hiện.
 */
@Injectable()
export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    try {
      return this.schema.parse(value);
    } catch (error) {
      if (error instanceof ZodError) {
        // Trả về danh sách field lỗi, không chỉ một câu chung chung — client cần biết sửa
        // field nào. Đây là lỗi của client nên là 4xx, không phải 5xx.
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: 'Dữ liệu gửi lên không hợp lệ',
          fields: error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        });
      }

      // Lỗi lạ thì để nó bay lên exception filter. Không nuốt (CLAUDE.md §Điều cấm).
      throw error;
    }
  }
}
