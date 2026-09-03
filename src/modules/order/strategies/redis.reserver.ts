import { Injectable, Logger } from '@nestjs/common';

import { RedisService } from '../../../infra/redis';
import type { InventoryReserver, ReserveResult } from '../inventory-reserver';
import { OrderRepository } from '../order.repository';

/**
 * Kiểm-tra-và-trừ trong MỘT lệnh Redis.
 *
 * Vì sao phải là Lua: Redis chạy lệnh tuần tự trên một luồng, nên một script Lua chạy trọn vẹn
 * không bị chen ngang. Nếu làm `GET` rồi `DECRBY` từ Node thì lại đúng là read-modify-write —
 * chỉ đổi CHỖ xảy ra race condition từ Postgres sang Redis, không chữa được gì.
 *
 * Ba giá trị trả về: `-2` chưa nạp key, `-1` không đủ hàng, `>= 0` là tồn kho còn lại sau khi
 * trừ.
 */
const RESERVE_LUA = `
local stock = tonumber(redis.call('GET', KEYS[1]))
if stock == nil then return -2 end
if stock < tonumber(ARGV[1]) then return -1 end
return redis.call('DECRBY', KEYS[1], ARGV[1])
`;

const NOT_LOADED = -2;
const INSUFFICIENT = -1;

/**
 * Chiến lược C — **Redis atomic**.
 *
 * **Thắng khi** cần throughput tối đa: quyết định "còn hàng không" diễn ra trong RAM của Redis,
 * không tranh khoá trên Postgres.
 * **Thua khi** có sự cố giữa hai kho dữ liệu: Redis đã trừ mà DB chưa ghi thì hai bên lệch —
 * và Redis không nằm trong transaction của Postgres nên không có ACID nào cứu. Phase 3 xử lý
 * bằng **bù trừ ngược + log rõ**; outbox pattern và reconcile job là Phase 4.
 *
 * Phase 3 ghi DB **đồng bộ** ngay trong request (async persist là Phase 4) — nên tốc độ ở
 * benchmark chưa phản ánh hết ưu thế của cách này. Ghi rõ để đọc số đo không kết luận sai.
 */
@Injectable()
export class RedisAtomicReserver implements InventoryReserver {
  readonly name = 'redis' as const;
  private readonly logger = new Logger(RedisAtomicReserver.name);

  constructor(
    private readonly redis: RedisService,
    private readonly repo: OrderRepository,
  ) {}

  async reserve(skuId: string, quantity: number): Promise<ReserveResult> {
    const key = stockKey(skuId);

    let remaining = await this.runReserveScript(key, quantity);

    if (remaining === NOT_LOADED) {
      // Nạp lazy khi miss: đọc DB rồi `SET NX` — `NX` để hai request cùng nạp không ghi đè
      // nhau (request thứ hai nạp sau khi request đầu đã trừ sẽ làm tồn kho "mọc lại").
      const loaded = await this.loadStockIntoRedis(skuId, key);
      if (!loaded) return { ok: false, reason: 'SKU_NOT_FOUND' };

      remaining = await this.runReserveScript(key, quantity);
      if (remaining === NOT_LOADED) {
        // Key vừa nạp mà vẫn miss: Redis bị xoá key ngay giữa hai lệnh, hoặc bị evict. Rất
        // hiếm, nhưng không được im lặng coi như hết hàng.
        throw new Error(`Không nạp được tồn kho vào Redis cho SKU ${skuId}`);
      }
    }

    if (remaining === INSUFFICIENT) return { ok: false, reason: 'OUT_OF_STOCK' };

    // Redis ĐÃ trừ. Từ đây trở đi mọi lỗi đều phải bù trừ ngược, nếu không tồn kho hai bên lệch.
    try {
      const updated = await this.repo.decrementStockConditional(skuId, quantity);

      if (!updated) {
        // DB nói không đủ hàng trong khi Redis nói đủ ⇒ hai bên đã lệch từ trước (vd ai đó sửa
        // stock thẳng trong DB). Bù trừ Redis và log mức error — KHÔNG im lặng sửa số.
        await this.releaseRedis(key, quantity);
        this.logger.error(
          { skuId, quantity },
          'Redis và DB lệch tồn kho: Redis cho phép trừ nhưng DB từ chối. Đã hoàn lại Redis.',
        );
        return { ok: false, reason: 'OUT_OF_STOCK' };
      }

      return { ok: true, unitPriceVnd: updated.priceVnd, attempts: 1 };
    } catch (error) {
      await this.releaseRedis(key, quantity);
      this.logger.error({ err: error, skuId, quantity }, 'Ghi DB thất bại sau khi Redis đã trừ — đã hoàn lại Redis');
      throw error;
    }
  }

  /** Hoàn cả hai kho: Redis trước (nhanh, không hỏng), DB sau. */
  async release(skuId: string, quantity: number): Promise<void> {
    await this.releaseRedis(stockKey(skuId), quantity);
    await this.repo.incrementStock(skuId, quantity);
  }

  private async runReserveScript(key: string, quantity: number): Promise<number> {
    const result = await this.redis.client.eval(RESERVE_LUA, 1, key, String(quantity));
    return Number(result);
  }

  /** Trả `false` khi SKU không tồn tại / không còn bán. */
  private async loadStockIntoRedis(skuId: string, key: string): Promise<boolean> {
    const sku = await this.repo.readSkuStock(skuId);
    if (!sku) return false;

    await this.redis.client.set(key, String(sku.stock), 'NX');
    return true;
  }

  private async releaseRedis(key: string, quantity: number): Promise<void> {
    try {
      await this.redis.client.incrby(key, quantity);
    } catch (error) {
      // Bù trừ thất bại là trường hợp xấu nhất: tồn kho Redis giờ THẤP hơn thực tế (bán ít hơn
      // số hàng có). Log mức error để reconcile job của Phase 4 có dấu vết mà lần lại.
      this.logger.error({ err: error, key, quantity }, 'Bù trừ Redis thất bại — tồn kho Redis đang thấp hơn DB');
    }
  }
}

/** Một key cho mỗi SKU. Không dùng hash để mỗi SKU trừ độc lập, không tranh nhau một key. */
function stockKey(skuId: string): string {
  return `stock:${skuId}`;
}
