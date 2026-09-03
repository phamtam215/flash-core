import { Injectable, Logger } from '@nestjs/common';

import type { InventoryReserver, ReserveResult } from '../inventory-reserver';
import { OrderRepository } from '../order.repository';

/** 3 lần thử, backoff 50ms × 2^n + jitter ±30% (spec Phase 3, Câu hỏi mở #4). */
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 50;

/**
 * Chiến lược A — **Optimistic**: ghi kèm điều kiện, thua thì thử lại.
 *
 * Không khoá gì cả. Câu `UPDATE ... WHERE stock >= ?` tự nó đã đủ an toàn (xem
 * `OrderRepository#decrementStockConditional`), nên "xung đột" ở đây hiếm hơn nhiều so với
 * hình dung thông thường về optimistic locking — vòng retry bên dưới chỉ dành cho lỗi thật của
 * Postgres (serialization failure / deadlock), KHÔNG dành cho "hết hàng".
 *
 * **Thắng khi** tranh chấp thấp: không tốn chi phí khoá, throughput cao nhất trong ba cách.
 * **Thua khi** tranh chấp gắt: mỗi lần thua là một round-trip nữa, tỷ lệ retry tăng phi tuyến
 * theo số người bấm cùng lúc. Đó là thứ benchmark ở test #16 phải cho thấy bằng số.
 */
@Injectable()
export class OptimisticReserver implements InventoryReserver {
  readonly name = 'optimistic' as const;
  private readonly logger = new Logger(OptimisticReserver.name);

  constructor(private readonly repo: OrderRepository) {}

  async reserve(skuId: string, quantity: number): Promise<ReserveResult> {
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        const updated = await this.repo.decrementStockConditional(skuId, quantity);

        if (updated) {
          if (attempt > 1) {
            // Ghi lại số lần thử để benchmark thấy được tỷ lệ retry tăng theo tải.
            this.logger.warn({ skuId, attempt }, 'Optimistic reserve thành công sau khi retry');
          }
          return { ok: true, unitPriceVnd: updated.priceVnd, attempts: attempt };
        }

        // 0 dòng bị ghi. Phải tách hai nguyên nhân — retry cho SKU đã hết hàng là vô nghĩa
        // (tồn kho không tự mọc lại), và làm nhiễu số đo benchmark.
        const onSale = await this.repo.isSkuOnSale(skuId);
        return { ok: false, reason: onSale ? 'OUT_OF_STOCK' : 'SKU_NOT_FOUND' };
      } catch (error) {
        if (!isRetryableConflict(error) || attempt === MAX_ATTEMPTS) throw error;
        this.logger.warn({ skuId, attempt }, 'Xung đột transaction, sẽ thử lại');
        await sleep(backoffMs(attempt));
      }
    }

    // Không tới được: vòng lặp chỉ thoát bằng return hoặc throw. Có để TypeScript yên tâm.
    throw new Error('Optimistic reserve: hết số lần thử');
  }

  async release(skuId: string, quantity: number): Promise<void> {
    await this.repo.incrementStock(skuId, quantity);
  }
}

/**
 * Chỉ retry đúng hai loại lỗi của Postgres: `40001` (serialization failure) và `40P01`
 * (deadlock detected). Cả hai đều là "thử lại thì có thể thành công".
 *
 * Vì sao so chuỗi thay vì so mã lỗi có kiểu: Prisma bọc lỗi của raw query theo cách khác nhau
 * giữa các bản (`P2010` với `meta.code`, hoặc `PrismaClientUnknownRequestError` với mã nằm
 * trong `message`). So chuỗi trên cả hai chỗ là cách chịu được thay đổi đó mà không cần khoá
 * chặt vào một bản Prisma cụ thể. Nhánh này được test #8 chạm tới dưới tải thật.
 */
function isRetryableConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const haystack = JSON.stringify({
    code: (error as { code?: unknown }).code,
    meta: (error as { meta?: unknown }).meta,
    message: (error as { message?: unknown }).message,
  });
  return haystack.includes('40001') || haystack.includes('40P01');
}

/** Backoff có jitter: nhiều request thua cùng lúc thì đừng cùng nhau thử lại cùng thời điểm. */
function backoffMs(attempt: number): number {
  const base = BASE_BACKOFF_MS * 2 ** (attempt - 1);
  const jitter = base * 0.3 * (Math.random() * 2 - 1);
  return Math.max(1, Math.round(base + jitter));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
