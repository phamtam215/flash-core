import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Inject,
  Logger,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';

import { ZodValidationPipe } from '../../common';
import { ENV, type Env } from '../../config';
import { JOB, QueueService, type PaymentProcessPayload } from '../../infra/queue';
import { AccessTokenGuard, type AuthenticatedRequest } from '../auth';
import { paymentEventSchema, type PaymentEventDto } from './payment.dto';
import { InvalidWebhookSignatureError } from './payment.errors';
import { SIGNATURE_HEADER, verifySignature } from './payment.signature';
import { PaymentCheckoutService } from './payment-checkout.service';

/** Request có `rawBody` — bật bằng `rawBody: true` lúc `NestFactory.create` (xem `main.ts`). */
type RawBodyRequest = { rawBody?: Buffer; id?: string };

@Controller('payments')
export class PaymentController {
  private readonly logger = new Logger(PaymentController.name);

  constructor(
    private readonly queue: QueueService,
    private readonly checkout: PaymentCheckoutService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Webhook của cổng thanh toán. **Không có guard** — request này đến từ máy chủ của cổng,
   * không có access token nào cả; thứ xác thực nó là **chữ ký**.
   *
   * Hai nguyên tắc quyết định hình dạng của hàm này:
   *
   * 1. **Verify trước khi parse.** Chữ ký ký trên đúng chuỗi byte cổng gửi (`req.rawBody`).
   *    Dùng `@Body()` đã parse rồi `JSON.stringify` lại là cách chắc chắn làm chữ ký sai mãi.
   * 2. **Trả 2xx nhanh, việc nặng đẩy vào queue.** Cổng thanh toán có timeout; xử lý chậm
   *    thì nó coi là thất bại và gửi lại — nhân đôi công việc và tạo thêm bản trùng.
   *
   * `204` cũng là câu trả lời cho sự kiện **trùng**: cổng gửi lại là chuyện bình thường của
   * at-least-once, không phải lỗi của người gửi nên không trả 4xx.
   */
  @Post('webhook')
  @HttpCode(HttpStatus.NO_CONTENT)
  async webhook(
    @Req() req: RawBodyRequest,
    @Headers(SIGNATURE_HEADER) signature: string | undefined,
    @Body(new ZodValidationPipe(paymentEventSchema)) event: PaymentEventDto,
  ): Promise<void> {
    const failure = verifySignature({
      header: signature,
      rawBody: req.rawBody?.toString('utf8') ?? '',
      secret: this.env.PAYMENT_WEBHOOK_SECRET,
      toleranceSec: this.env.PAYMENT_WEBHOOK_TOLERANCE,
    });

    if (failure) {
      // Lý do THẬT chỉ có ở log phía server, kèm correlationId. Client chỉ nhận 401 chung.
      this.logger.warn({ failure, eventId: event.eventId }, 'Từ chối webhook: chữ ký không hợp lệ');
      throw new InvalidWebhookSignatureError();
    }

    await this.queue.add<PaymentProcessPayload>(JOB.PAYMENT_PROCESS, {
      eventId: event.eventId,
      type: event.type,
      orderId: event.orderId,
      paymentIntentId: event.paymentIntentId,
      amountVnd: event.amountVnd,
      // Nối log của webhook với log của worker — nếu không, hai nửa của cùng một sự việc
      // nằm ở hai chỗ không tra ngược về nhau được.
      correlationId: req.id ?? randomUUID(),
    });
  }

  /**
   * Tạo phiên thanh toán giả lập (spec §Non-goals: không tích hợp cổng thật).
   *
   * Nó tồn tại để chạy được luồng end-to-end mà không cần mạng ngoài: lấy `paymentIntentId`
   * ở đây, ký một webhook bằng `scripts/send-webhook.mjs`, rồi bắn vào endpoint trên.
   */
  @Post('checkout/:orderId')
  @UseGuards(AccessTokenGuard)
  @HttpCode(HttpStatus.CREATED)
  async createCheckout(@Req() req: AuthenticatedRequest, @Param('orderId') orderId: string) {
    return this.checkout.createIntent(orderId, req.userId);
  }
}
