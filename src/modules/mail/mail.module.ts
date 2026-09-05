import { Module } from '@nestjs/common';

import { LoggingMailSender } from './logging-mail.sender';
import { MAIL_SENDER } from './mail.sender';

/**
 * Một provider sau một token — cùng khuôn với `INVENTORY_RESERVER` ở Phase 3. Nhờ vậy đổi
 * sang SMTP thật (hoặc bản đếm trong test) là đổi đúng một dòng ở đây.
 */
@Module({
  providers: [LoggingMailSender, { provide: MAIL_SENDER, useExisting: LoggingMailSender }],
  exports: [MAIL_SENDER],
})
export class MailModule {}
