import { Inject, Injectable, Logger } from '@nestjs/common';

import { ENV, type Env } from '../../config';
import { MetricsService } from '../../infra/metrics';
import { RetentionRepository } from './retention.repository';

/** Trần số vòng mỗi lần chạy — chặn một lần dọn chiếm worker vô hạn nếu tồn đọng quá lớn. */
const MAX_ROUNDS = 20;

/**
 * Dọn hai bảng **chỉ ghi thêm, không bao giờ tự xoá**: `outbox_events` và `processed_events`.
 *
 * **Vì sao nợ này đáng trả trước khi deploy:** hai bảng đó tăng theo mỗi đơn hàng và không có
 * gì làm chúng nhỏ lại. Trên Neon free 0,5 GB, thứ vỡ không phải hiệu năng mà là **dung
 * lượng** — và nó lộ ra bằng **hoá đơn hoặc hard cutoff**, không bằng một dòng lỗi nào. Loại
 * sự cố im lặng nhất trong cả hệ thống.
 *
 * ### Xoá theo lô, không xoá một phát
 *
 * `DELETE FROM outbox_events WHERE ...` trên vài triệu dòng là một transaction khổng lồ: nó
 * giữ khoá lâu, phình WAL, và nếu bị huỷ giữa chừng thì **cuộn lại toàn bộ** — mất hết công
 * mà bảng vẫn nguyên. Xoá 5.000 dòng mỗi vòng thì mỗi vòng tự commit, dừng lúc nào cũng giữ
 * được phần đã làm.
 *
 * Kèm trần `MAX_ROUNDS`: tồn đọng một triệu dòng cũng chỉ dọn 100.000 mỗi lần chạy, phần còn
 * lại để giờ sau. Thà dọn chậm còn hơn chiếm worker suốt đêm.
 */
@Injectable()
export class RetentionService {
  private readonly logger = new Logger(RetentionService.name);

  constructor(
    private readonly repo: RetentionRepository,
    private readonly metrics: MetricsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async sweep(): Promise<{ outbox: number; processed: number }> {
    const olderThan = new Date(Date.now() - this.env.DATA_RETENTION_DAYS * 24 * 60 * 60 * 1000);

    const outbox = await this.deleteInRounds(() => this.repo.deleteDispatchedOutbox(olderThan));
    const processed = await this.deleteInRounds(() => this.repo.deleteProcessedEvents(olderThan));

    // Đo số dòng FAILED còn lại ở mỗi lần dọn. Nó KHÔNG bao giờ bị xoá, nên nếu con số này
    // tăng đều thì có thứ đang hỏng mà chưa ai nhìn — đúng thứ một job dọn dẹp tiện thể phát
    // hiện được, vì nó là chỗ duy nhất đi ngang qua cả bảng một cách đều đặn.
    this.metrics.outboxFailed.set(await this.repo.countFailedOutbox());

    if (outbox > 0 || processed > 0) {
      this.metrics.retentionDeleted.inc({ table: 'outbox_events' }, outbox);
      this.metrics.retentionDeleted.inc({ table: 'processed_events' }, processed);
      this.logger.log({ outbox, processed, olderThan }, 'Đã dọn dữ liệu cũ');
    }

    return { outbox, processed };
  }

  /** Gọi lại cho tới khi hết dòng để xoá, hoặc chạm trần số vòng. */
  private async deleteInRounds(deleteOnce: () => Promise<number>): Promise<number> {
    let total = 0;
    for (let round = 0; round < MAX_ROUNDS; round += 1) {
      const deleted = await deleteOnce();
      total += deleted;
      // Lô không đầy nghĩa là đã hết dòng đủ cũ — dừng, đừng chạy thêm một câu vô ích.
      if (deleted < this.env.RETENTION_BATCH_SIZE) break;
    }
    return total;
  }
}
