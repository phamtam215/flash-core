/**
 * Seed 100.000 dòng `product_skus` (10.000 Product × 10 SKU) để đo `EXPLAIN (ANALYZE,
 * BUFFERS)` trên dữ liệu đủ lớn — xem docs/specs/phase2-product-inventory.md §Kế hoạch seed.
 *
 * CHỈ CHẠY LOCAL. `guard_cloud_cost.py` (Phase 0) tự chặn lệnh `npm run seed` nếu biến kết
 * nối trỏ ra cloud — không thêm code chặn riêng ở đây.
 *
 * Dùng `pg` THẲNG (không qua Prisma Client) — hai lý do:
 * 1. `id` tự sinh bằng `randomUUID()` ở tầng ứng dụng (không để DB sinh) để biết trước
 *    `productId` của mỗi SKU mà không cần round-trip đọc lại sau khi insert Product.
 * 2. Prisma Client sinh ra dưới dạng TypeScript source với import kèm đuôi `.js` (đúng chuẩn
 *    Prisma 7 + `moduleResolution: node16`), nhưng file thật trên đĩa là `.ts`. Jest có
 *    `moduleNameMapper` xử lý việc này; chạy qua `ts-node` (như script này) thì không có gì
 *    làm việc đó, và `require` sẽ vỡ ngay ở bước nạp client. Vì script này chỉ cần
 *    `INSERT` hàng loạt (không cần API kiểu Prisma), dùng `pg` thẳng né được cả vấn đề này.
 *
 * Chạy: `npm run seed` (cần Docker + `npm run up`).
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import { Pool } from 'pg';

const PRODUCT_COUNT = 10_000;
const SIZES = ['S', 'M', 'L', 'XL', 'XXL'] as const;
// 2 màu × 5 size = 10 SKU/product — đúng tỉ lệ trong spec.
const COLORS = [
  { name: 'Đen', code: 'DEN' },
  { name: 'Trắng', code: 'TRANG' },
];
const BATCH_SIZE = 2_000;

interface ProductRow {
  id: string;
  name: string;
  slug: string;
  attributes: string; // JSON.stringify sẵn — cột đích là jsonb, Postgres tự cast từ text
}

interface SkuRow {
  id: string;
  productId: string;
  size: string;
  color: string;
  skuCode: string;
  priceVnd: number;
  stock: number;
}

function pad(n: number): string {
  return String(n).padStart(6, '0');
}

/** Xen kẽ 2 giá trị `material` để test #15 (GIN index) có dữ liệu lọc được ý nghĩa. */
function attributesFor(index: number): Record<string, string> {
  return {
    material: index % 2 === 0 ? 'cotton' : 'polyester',
    origin: index % 3 === 0 ? 'Việt Nam' : 'Trung Quốc',
  };
}

/**
 * Insert nhiều dòng trong MỘT câu SQL (`VALUES ($1,$2,...), ($n+1,...), ...`) — nhanh hơn hẳn
 * N câu `INSERT` rời, và không có ORM nào ở giữa để lo tương thích.
 */
async function insertBatched<T>(
  pool: Pool,
  label: string,
  rows: T[],
  columns: string[],
  table: string,
  toValues: (row: T) => unknown[],
): Promise<void> {
  for (let offset = 0; offset < rows.length; offset += BATCH_SIZE) {
    const batch = rows.slice(offset, offset + BATCH_SIZE);
    const params: unknown[] = [];
    const rowPlaceholders = batch.map((row, i) => {
      const values = toValues(row);
      const placeholders = values.map((_, j) => `$${String(i * values.length + j + 1)}`);
      params.push(...values);
      return `(${placeholders.join(', ')})`;
    });

    const sql = `INSERT INTO "${table}" (${columns.map((c) => `"${c}"`).join(', ')}) VALUES ${rowPlaceholders.join(', ')}`;
    await pool.query(sql, params);

    process.stdout.write(
      `\r${label}: ${String(Math.min(offset + BATCH_SIZE, rows.length))}/${String(rows.length)}`,
    );
  }
  process.stdout.write('\n');
}

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error('Thiếu DATABASE_URL — export biến này trước khi chạy seed');

  const pool = new Pool({ connectionString: databaseUrl });

  console.log(`Sinh ${String(PRODUCT_COUNT)} product × ${String(SIZES.length * COLORS.length)} SKU...`);

  const products: ProductRow[] = [];
  const skus: SkuRow[] = [];

  for (let i = 0; i < PRODUCT_COUNT; i++) {
    const productId = randomUUID();
    const slug = `seed-product-${pad(i)}`;

    products.push({
      id: productId,
      name: `Seed Product ${pad(i)}`,
      slug,
      attributes: JSON.stringify(attributesFor(i)),
    });

    for (const size of SIZES) {
      for (const color of COLORS) {
        skus.push({
          id: randomUUID(),
          productId,
          size,
          color: color.name,
          skuCode: `${slug.toUpperCase().replace(/-/g, '')}-${color.code}-${size}`,
          priceVnd: 100_000 + (i % 50) * 1_000,
          stock: 50 + (i % 20),
        });
      }
    }
  }

  await insertBatched(pool, 'Product', products, ['id', 'name', 'slug', 'status', 'attributes'], 'products', (p) => [
    p.id,
    p.name,
    p.slug,
    'ACTIVE',
    p.attributes,
  ]);

  await insertBatched(
    pool,
    'ProductSku',
    skus,
    ['id', 'product_id', 'size', 'color', 'sku_code', 'price_vnd', 'stock'],
    'product_skus',
    (s) => [s.id, s.productId, s.size, s.color, s.skuCode, s.priceVnd, s.stock],
  );

  // Bắt buộc — thiếu bước này planner dùng thống kê CŨ (hoặc rỗng), mọi kết luận EXPLAIN sau
  // đó vô nghĩa. Xem docs/tech-playbook.md §Phase 2.
  console.log('ANALYZE...');
  await pool.query('ANALYZE products');
  await pool.query('ANALYZE product_skus');

  console.log(`Xong: ${String(products.length)} product, ${String(skus.length)} SKU.`);

  await pool.end();
}

main().catch((error: unknown) => {
  console.error('Seed thất bại:', error);
  process.exitCode = 1;
});
