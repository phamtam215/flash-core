import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { PrismaService } from '../../infra/prisma';
import { OrderNotPayableError, PaymentOrderNotFoundError } from './payment.errors';

/**
 * Cổng thanh toán giả lập của Phase 4.
 *
 * Chỉ sinh một `paymentIntentId` và kiểm tra đơn còn nhận tiền được không. Bài học của phase
 * (verify chữ ký, idempotent, webhook đến muộn) học đủ với cổng giả, mà test vẫn chạy được
 * trong CI không cần mạng — spec §Câu hỏi mở #1.
 *
 * Đọc `orders` trực tiếp ở đây là ngoại lệ có ý thức: nó chỉ ĐỌC và chỉ để trả lời "đơn này
 * của anh có còn chờ thanh toán không". Mọi thao tác GHI vào đơn đều đi qua cửa
 * `ORDER_PAYMENTS` của module `order`.
 */
@Injectable()
export class PaymentCheckoutService {
  constructor(private readonly prisma: PrismaService) {}

  async createIntent(orderId: string, userId: string): Promise<{ paymentIntentId: string; amountVnd: number }> {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      select: { status: true, totalVnd: true },
    });

    // Đơn của người khác coi như không tồn tại — cùng lý do với `OrderNotFoundError`.
    if (!order) throw new PaymentOrderNotFoundError();
    if (order.status !== 'PENDING') throw new OrderNotPayableError();

    return { paymentIntentId: `pi_${randomUUID()}`, amountVnd: order.totalVnd };
  }
}
