import { Injectable } from '@nestjs/common';

import type { InventoryReserver, ReserveResult } from '../inventory-reserver';
import { OrderRepository } from '../order.repository';

/**
 * Chiến lược B — **Pessimistic**: khoá dòng trước, người sau xếp hàng chờ.
 *
 * Không có vòng retry nào ở đây, và đó là điểm khác biệt cốt lõi so với optimistic: người đến
 * sau **chờ** thay vì **thất bại rồi thử lại**. Đổi lại sự công bằng (ai đến trước được phục vụ
 * trước) bằng throughput.
 *
 * **Thắng khi** tranh chấp gắt và cần công bằng — không có ai bị "thua liên tục" như
 * optimistic dưới tải cao.
 * **Thua khi** cần throughput tối đa: mỗi transaction đang chờ khoá **vẫn giữ một connection**
 * của pool. Với `DATABASE_POOL_MAX = 10` mà 200 người xếp hàng thì thứ vỡ trước là POOL, không
 * phải DB — và triệu chứng (request treo rồi timeout) giống hệt "DB quá tải". Đây là lý do
 * `DATABASE_POOL_MAX` phải được coi là **một phần của kết quả benchmark**, không phải hằng số.
 */
@Injectable()
export class PessimisticReserver implements InventoryReserver {
  readonly name = 'pessimistic' as const;

  constructor(private readonly repo: OrderRepository) {}

  async reserve(skuId: string, quantity: number): Promise<ReserveResult> {
    const result = await this.repo.lockAndDecrementStock(skuId, quantity);

    if ('reason' in result) return { ok: false, reason: result.reason };
    return { ok: true, unitPriceVnd: result.priceVnd, attempts: 1 };
  }

  async release(skuId: string, quantity: number): Promise<void> {
    await this.repo.incrementStock(skuId, quantity);
  }
}
