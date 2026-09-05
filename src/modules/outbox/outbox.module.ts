import { Module } from '@nestjs/common';

import { IdempotencyRepository } from './idempotency.repository';
import { OutboxRelay } from './outbox.relay';
import { OutboxRepository } from './outbox.repository';

/**
 * Đường ống nhắn tin bất đồng bộ của cả app: hộp thư đi (`outbox_events`) và dấu đã-xử-lý
 * (`processed_events`).
 *
 * Hai bảng này ở chung một module vì chúng là **hai nửa của một cơ chế**: outbox đảm bảo
 * "không mất", processed_events đảm bảo "không trùng". Tách ra hai module thì người đọc phải
 * ghép lại mới hiểu tại sao cái nào cũng chưa đủ một mình.
 */
@Module({
  providers: [OutboxRepository, IdempotencyRepository, OutboxRelay],
  exports: [OutboxRepository, IdempotencyRepository, OutboxRelay],
})
export class OutboxModule {}
