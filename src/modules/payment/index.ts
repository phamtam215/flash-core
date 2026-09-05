/**
 * Public interface của module payment.
 *
 * `PaymentService` được export cho **worker** (tầng trên `modules/`) chạy job
 * `payment.process`. Phần verify chữ ký và `PaymentCheckoutService` là chi tiết nội bộ.
 */
export { PaymentModule } from './payment.module';
export { PaymentService } from './payment.service';
export { SIGNATURE_HEADER, signPayload, verifySignature, type SignatureFailure } from './payment.signature';
