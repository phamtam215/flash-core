import { Module } from '@nestjs/common';

import { ENV, type Env } from '../../config';
import { AccessTokenGuard, AuthModule } from '../auth';
import { MailModule } from '../mail';
import { OutboxModule } from '../outbox';
import { INVENTORY_RESERVER, type InventoryReserver } from './inventory-reserver';
import { ORDER_PAYMENTS } from './order-payments';
import { OrderPaymentService } from './order-payment.service';
import { OrderController } from './order.controller';
import { OrderExpiryService } from './order.expiry.service';
import { OrderNotifier } from './order.notifier';
import { OrderRepository } from './order.repository';
import { OrderService } from './order.service';
import { OptimisticReserver } from './strategies/optimistic.reserver';
import { PessimisticReserver } from './strategies/pessimistic.reserver';
import { RedisAtomicReserver } from './strategies/redis.reserver';

/**
 * `AccessTokenGuard` phải có mặt trong `providers` của CHÍNH module này (không chỉ import
 * `AuthModule`) — xem `product.module.ts` và `docs/architecture.md` §Những chỗ dễ vấp: guard
 * dùng qua `@UseGuards(Class)` được tra trong `injectables` của module chứa controller, không
 * đi qua `imports`/`exports`.
 *
 * Factory cho `INVENTORY_RESERVER` là chỗ duy nhất trong toàn bộ code biết `INVENTORY_STRATEGY`
 * đang là gì. Cả ba implementation đều được đăng ký làm provider (rẻ — chúng không giữ state
 * gì), nhưng chỉ một cái được service nhận. Nhờ vậy đổi chiến lược = đổi một biến môi trường,
 * không sửa code, và benchmark ba cách chạy trên cùng một luồng nghiệp vụ.
 */
@Module({
  imports: [AuthModule, MailModule, OutboxModule],
  controllers: [OrderController],
  providers: [
    OrderService,
    OrderRepository,
    OrderExpiryService,
    OrderNotifier,
    OrderPaymentService,
    { provide: ORDER_PAYMENTS, useExisting: OrderPaymentService },
    AccessTokenGuard,
    OptimisticReserver,
    PessimisticReserver,
    RedisAtomicReserver,
    {
      provide: INVENTORY_RESERVER,
      inject: [ENV, OptimisticReserver, PessimisticReserver, RedisAtomicReserver],
      useFactory: (
        env: Env,
        optimistic: OptimisticReserver,
        pessimistic: PessimisticReserver,
        redis: RedisAtomicReserver,
      ): InventoryReserver => {
        switch (env.INVENTORY_STRATEGY) {
          case 'pessimistic':
            return pessimistic;
          case 'redis':
            return redis;
          case 'optimistic':
            return optimistic;
        }
      },
    },
  ],
  // Worker (`src/worker/`) cần hai thứ này để chạy job. Không export `OrderService` —
  // đặt đơn vẫn chỉ đi qua HTTP.
  exports: [OrderExpiryService, OrderNotifier, OrderRepository, ORDER_PAYMENTS],
})
export class OrderModule {}
