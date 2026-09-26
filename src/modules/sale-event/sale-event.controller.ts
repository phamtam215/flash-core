import { Body, Controller, Get, HttpCode, HttpStatus, Param, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';

import { ZodValidationPipe } from '../../common';
import {
  AccessTokenGuard,
  OptionalAccessTokenGuard,
  Role,
  Roles,
  RolesGuard,
  type AuthenticatedRequest,
} from '../auth';
import { createSaleEventSchema, type CreateSaleEventDto } from './sale-event.dto';
import { SaleEventService } from './sale-event.service';

@Controller('sale-events')
export class SaleEventController {
  constructor(private readonly events: SaleEventService) {}

  /**
   * Danh sách đợt đã publish. **Công khai** — người chưa đăng nhập vẫn xem được lịch sale,
   * giống mọi trang thương mại điện tử. Đợt nháp không lộ ra đây dù đang trong khung giờ.
   */
  @Get()
  @HttpCode(HttpStatus.OK)
  async list() {
    return { items: await this.events.listPublished() };
  }

  /**
   * Chi tiết một đợt. Guard KHÔNG bắt buộc đăng nhập, nhưng nếu có phiên thì trả thêm
   * `remainingForUser` — để giao diện hiện "bạn còn mua được 1 chiếc" thay vì để người ta bấm
   * rồi mới nhận `409`.
   */
  @Get(':slug')
  @UseGuards(OptionalAccessTokenGuard)
  async detail(@Param('slug') slug: string, @Req() req: Request) {
    const userId = (req as Partial<AuthenticatedRequest>).userId;
    return { event: await this.events.detail(slug, userId) };
  }

  /** Soạn đợt mới, ở trạng thái nháp. Hàng chưa rời khỏi SKU. */
  @Post()
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles(Role.ADMIN)
  async create(@Body(new ZodValidationPipe(createSaleEventSchema)) dto: CreateSaleEventDto) {
    return { event: await this.events.create(dto) };
  }

  /**
   * Publish — thao tác **động vào tồn kho thật**: cắt hàng từ SKU sang đợt.
   *
   * `POST` chứ không `PATCH`: đây không phải sửa một trường, mà là kích hoạt một quy trình có
   * hệ quả ngoài bản ghi này.
   */
  @Post(':id/publish')
  @UseGuards(AccessTokenGuard, RolesGuard)
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async publish(@Param('id') id: string) {
    return { event: await this.events.publish(id) };
  }
}
