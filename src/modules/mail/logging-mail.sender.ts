import { Injectable, Logger } from '@nestjs/common';

import { PermanentMailError, type MailSender } from './mail.sender';

/** Định dạng email tối thiểu — đủ để tách "sai vĩnh viễn" khỏi "hỏng tạm thời". */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Bản gửi mail của Phase 4: ghi log thay vì gửi thật.
 *
 * Nó vẫn *kiểm tra địa chỉ* và ném `PermanentMailError` khi sai — không phải để làm màu, mà
 * vì luồng "lỗi vĩnh viễn thì fail thẳng, đừng retry" cần một chỗ thật để phát sinh lỗi đó,
 * nếu không thì test case tương ứng chỉ kiểm được mock.
 */
@Injectable()
export class LoggingMailSender implements MailSender {
  private readonly logger = new Logger(LoggingMailSender.name);

  send(mail: { to: string; subject: string; body: string }): Promise<void> {
    if (!EMAIL_SHAPE.test(mail.to)) {
      return Promise.reject(new PermanentMailError(`Địa chỉ nhận không hợp lệ: ${mail.to}`));
    }
    this.logger.log({ to: mail.to, subject: mail.subject }, 'Gửi email (bản log của Phase 4)');
    return Promise.resolve();
  }
}
