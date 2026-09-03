import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import { ZodValidationPipe } from '../../common';
import { AccessTokenGuard, type AuthenticatedRequest } from '../auth';
import {
  createOrderSchema,
  listOrderQuerySchema,
  type CreateOrderDto,
  type ListOrderQueryDto,
} from './order.dto';
import { IdempotencyKeyRequiredError } from './order.errors';
import { OrderService } from './order.service';

/**
 * Mọi route đều cần đăng nhập — không có đơn hàng "vô danh". Guard đặt ở tầng class để không
 * thể quên khi thêm endpoint mới.
 */
@Controller('orders')
@UseGuards(AccessTokenGuard)
export class OrderController {
  constructor(private readonly orders: OrderService) {}

  /**
   * `201` khi vừa tạo đơn mới, `200` khi `Idempotency-Key` đã dùng rồi (trả lại đúng đơn cũ).
   * Phân biệt bằng status code để client biết mà không phải so sánh body — `201` nghĩa là
   * "vừa tạo", nói `201` cho một đơn tạo từ 5 giây trước là nói sai sự thật.
   *
   * `passthrough: true` để Nest vẫn tự serialize giá trị trả về; mình chỉ mượn `res` để đặt
   * status. Thiếu cờ này thì request treo vì không ai gọi `res.send()`.
   */
  @Post()
  async place(
    @Req() req: AuthenticatedRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body(new ZodValidationPipe(createOrderSchema)) dto: CreateOrderDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Chặn ở biên, TRƯỚC khi chạm DB và trước khi trừ kho.
    if (!idempotencyKey || idempotencyKey.trim().length === 0) {
      throw new IdempotencyKeyRequiredError();
    }

    const { order, created } = await this.orders.placeOrder(req.userId, idempotencyKey.trim(), dto);
    res.status(created ? HttpStatus.CREATED : HttpStatus.OK);
    return { order };
  }

  @Get()
  @HttpCode(HttpStatus.OK)
  async listMine(
    @Req() req: AuthenticatedRequest,
    @Query(new ZodValidationPipe(listOrderQuerySchema)) query: ListOrderQueryDto,
  ) {
    return this.orders.listMyOrders(req.userId, query);
  }

  @Get(':id')
  async detail(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    const order = await this.orders.getMyOrder(id, req.userId);
    const { items, ...rest } = order;
    return { order: rest, items };
  }
}
