import { z } from 'zod';

/**
 * Sự kiện từ cổng thanh toán.
 *
 * Zod mặc định **loại bỏ field lạ**, nên cổng thêm trường mới không làm vỡ webhook — nhưng
 * cũng có nghĩa là trường mới sẽ bị bỏ im lặng, phải chủ động cập nhật schema khi cần dùng.
 */
export const paymentEventSchema = z.object({
  eventId: z.string().min(1),
  type: z.enum(['payment.succeeded', 'payment.failed']),
  orderId: z.string().uuid('orderId phải là UUID'),
  paymentIntentId: z.string().min(1),
  amountVnd: z.number().int().positive(),
  occurredAt: z.string().datetime(),
});

export type PaymentEventDto = z.infer<typeof paymentEventSchema>;
