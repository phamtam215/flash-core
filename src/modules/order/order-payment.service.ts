import { Injectable, Logger } from '@nestjs/common';

import { IdempotencyRepository } from '../outbox';
import type { OrderPayments, SettlementOutcome, SettlePaymentInput } from './order-payments';
import { OrderRepository } from './order.repository';

const CONSUMER = 'order.payment';

/**
 * Xử lý một sự kiện "đã thanh toán" cho đúng một lần.
 *
 * Khác với việc gửi email, **hệ quả ở đây nằm hoàn toàn trong DB** — nên dấu idempotent và
 * hệ quả chạy trong CÙNG transaction (`runOnceInTransaction`), và ta được *exactly-once
 * processing* thật sự, không phải chọn giữa "mất" và "trùng". Đó là lý do đáng nhìn hai
 * consumer của phase này cạnh nhau: cùng một cơ chế UNIQUE, nhưng ranh giới transaction khác
 * nhau nên bảo đảm nhận được cũng khác nhau.
 */
@Injectable()
export class OrderPaymentService implements OrderPayments {
  private readonly logger = new Logger(OrderPaymentService.name);

  constructor(
    private readonly repo: OrderRepository,
    private readonly idempotency: IdempotencyRepository,
  ) {}

  async settle(input: SettlePaymentInput): Promise<SettlementOutcome> {
    let outcome: SettlementOutcome = { kind: 'ALREADY_HANDLED' };

    const ran = await this.idempotency.runOnceInTransaction(input.eventId, CONSUMER, async (tx) => {
      const order = await this.repo.findOrderForPayment(tx, input.orderId);

      if (!order) {
        outcome = { kind: 'ORDER_NOT_FOUND' };
        return;
      }

      // Số tiền lệch: KHÔNG đánh dấu PAID. Đây là chỗ dễ bị bỏ qua nhất — webhook hợp lệ về
      // chữ ký không có nghĩa là hợp lệ về nghiệp vụ.
      if (order.totalVnd !== input.amountVnd) {
        await this.recordRefund(tx, input, 'AMOUNT_MISMATCH', order.totalVnd);
        outcome = { kind: 'REFUND_REQUIRED', reason: 'AMOUNT_MISMATCH' };
        return;
      }

      // Đơn đã huỷ: TUYỆT ĐỐI không hồi sinh thành PAID — hàng đã trả về kho và có thể người
      // khác đã mua mất; đổi trạng thái ở đây là tạo oversell ở đường sau.
      if (order.status === 'CANCELLED') {
        await this.recordRefund(tx, input, 'ORDER_ALREADY_CANCELLED', order.totalVnd);
        outcome = { kind: 'REFUND_REQUIRED', reason: 'ORDER_ALREADY_CANCELLED' };
        return;
      }

      const paid = await this.repo.markPaid(tx, order.id, input.paymentIntentId);
      outcome = paid ? { kind: 'PAID' } : { kind: 'ALREADY_HANDLED' };
    });

    if (!ran) {
      this.logger.debug({ eventId: input.eventId }, 'Sự kiện thanh toán đã xử lý — bỏ qua bản trùng');
      return { kind: 'ALREADY_HANDLED' };
    }

    return outcome;
  }

  private async recordRefund(
    tx: Parameters<Parameters<IdempotencyRepository['runOnceInTransaction']>[2]>[0],
    input: SettlePaymentInput,
    reason: 'ORDER_ALREADY_CANCELLED' | 'AMOUNT_MISMATCH',
    expectedVnd: number,
  ): Promise<void> {
    await this.repo.createRefundRequest(tx, {
      orderId: input.orderId,
      paymentIntentId: input.paymentIntentId,
      amountVnd: input.amountVnd,
      reason,
      correlationId: input.correlationId,
    });

    // Mức `error` là có chủ ý: tiền thật đã chuyển mà hệ thống không nhận được. Đây đúng là
    // loại việc phải có người nhìn, khác hẳn 409 "hết hàng" (trạng thái nghiệp vụ bình thường).
    this.logger.error(
      {
        orderId: input.orderId,
        paymentIntentId: input.paymentIntentId,
        reason,
        paidVnd: input.amountVnd,
        expectedVnd,
        correlationId: input.correlationId,
      },
      'Cần hoàn tiền — đã ghi refund_requests, KHÔNG tự hoàn',
    );
  }
}
