import { Module } from '@nestjs/common';

import { AccessTokenGuard, AuthModule } from '../auth';
import { OrderModule } from '../order';
import { PaymentCheckoutService } from './payment-checkout.service';
import { PaymentController } from './payment.controller';
import { PaymentService } from './payment.service';

/**
 * Biên giới với cổng thanh toán: verify chữ ký, nhận sự kiện, đẩy vào queue.
 *
 * Import `OrderModule` để lấy token `ORDER_PAYMENTS` — cửa hẹp duy nhất được phép đổi trạng
 * thái tiền của đơn. Module này không biết bảng `orders` tồn tại.
 *
 * `AccessTokenGuard` lại phải nằm trong `providers` của chính module này (chỉ endpoint
 * checkout dùng) — xem `docs/architecture.md` §Những chỗ dễ vấp.
 */
@Module({
  imports: [AuthModule, OrderModule],
  controllers: [PaymentController],
  providers: [PaymentService, PaymentCheckoutService, AccessTokenGuard],
  exports: [PaymentService],
})
export class PaymentModule {}
