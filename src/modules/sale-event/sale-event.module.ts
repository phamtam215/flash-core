import { Module } from '@nestjs/common';

import { AuthModule } from '../auth';
import { SaleEventController } from './sale-event.controller';
import { SaleEventRepository } from './sale-event.repository';
import { SaleEventService } from './sale-event.service';

/**
 * `AuthModule` được import vì `AccessTokenGuard` và `RolesGuard` cần `JwtService` và
 * `Reflector` từ cây DI của nó — đúng cái bẫy đã ghi ở `architecture.md` §Những chỗ dễ vấp:
 * import class guard thôi là chưa đủ, module cấp dependency cho nó cũng phải có mặt.
 */
@Module({
  imports: [AuthModule],
  controllers: [SaleEventController],
  providers: [SaleEventService, SaleEventRepository],
  exports: [SaleEventService],
})
export class SaleEventModule {}
