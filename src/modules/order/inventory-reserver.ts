/**
 * Hợp đồng chung của **ba** chiến lược chống oversell (Phase 3).
 *
 * Service tầng trên chỉ biết interface này — nó KHÔNG biết đang chạy optimistic, pessimistic
 * hay Redis. Nhờ vậy đổi chiến lược bằng đúng một biến môi trường (`INVENTORY_STRATEGY`), và
 * benchmark ba cách chạy trên **cùng một luồng nghiệp vụ** nên số đo so sánh được công bằng.
 * Nếu thay bằng `if (strategy === 'redis') ...` rải trong service thì mỗi nhánh sẽ dần trôi
 * khác nhau và benchmark mất ý nghĩa.
 */
export type ReserveResult =
  | {
      ok: true;
      /** Giá đơn vị ĐỌC TỪ DB tại thời điểm trừ kho — dùng làm snapshot price cho đơn. */
      unitPriceVnd: number;
      /** Số lần thử (optimistic có thể > 1). Ghi vào log để benchmark thấy tỷ lệ retry. */
      attempts: number;
    }
  | { ok: false; reason: 'OUT_OF_STOCK' | 'SKU_NOT_FOUND' };

export interface InventoryReserver {
  readonly name: 'optimistic' | 'pessimistic' | 'redis';

  /** Trừ `quantity` khỏi tồn kho của `skuId`. Không ném lỗi cho trạng thái nghiệp vụ. */
  reserve(skuId: string, quantity: number): Promise<ReserveResult>;

  /**
   * Hoàn lại tồn kho đã trừ — dùng ở nhánh lỗi (vd phát hiện `Idempotency-Key` trùng SAU khi
   * đã reserve). Phải idempotent-an-toàn theo nghĩa: gọi đúng một lần cho mỗi lần reserve
   * thành công. Việc gọi đúng số lần là trách nhiệm của service, không phải của reserver.
   */
  release(skuId: string, quantity: number): Promise<void>;
}

/** Token DI — factory trong `order.module.ts` chọn implementation theo `INVENTORY_STRATEGY`. */
export const INVENTORY_RESERVER = Symbol('INVENTORY_RESERVER');
