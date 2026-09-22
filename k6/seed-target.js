/**
 * Dựng dữ liệu cho benchmark k6: một user + một SKU `stock = 100`, rồi in ra `SKU_ID` và
 * access token để truyền vào `k6 run -e ...`.
 *
 * Dùng `fetch` gọi API thật (không ghi thẳng DB) để đúng đường đi của người dùng, và để chắc
 * rằng app đang chạy trước khi bắn 1.000 VU vào nó.
 *
 * Từ Phase 7 nó phải làm thêm hai việc mà bản đầu không có, và thiếu cái nào cũng ra 403:
 *
 * 1. **Lấy token CSRF** rồi gửi kèm ở mọi request ghi (double-submit, ADR-009).
 * 2. **Nâng user vừa tạo lên ADMIN** — `POST /products` giờ đòi vai trò đó (RBAC). Cố tình
 *    không có endpoint tự nâng quyền, nên script ghi thẳng một cột vào Postgres, đúng cách
 *    `npm run make-admin` làm. Chỉ an toàn vì đây là công cụ benchmark **chạy local**;
 *    `guard_cloud_cost.py` chặn sẵn khi biến kết nối trỏ ra cloud.
 *
 * Chạy: `node k6/seed-target.js` (cần app đang `npm run dev` và `npm run up`).
 */
// `require` chứ không `import`: package.json không có `"type": "module"`, nên dùng `import`
// sẽ khiến Node phải đoán lại kiểu module và in một cảnh báo mỗi lần chạy.
const { Client } = require('pg');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const EMAIL = `k6-${Date.now()}@example.com`;
const PASSWORD = 'matkhau123';

/** Lấy token CSRF từ một GET bất kỳ. Middleware phát cookie này cho mọi response chưa có. */
async function fetchCsrf() {
  const res = await fetch(`${BASE_URL}/health/live`);
  const token = readCookie(res, 'csrf_token');
  if (!token) throw new Error('Không lấy được cookie csrf_token — app có chạy không?');
  return token;
}

/** Lấy giá trị một cookie từ header `set-cookie`. */
function readCookie(response, name) {
  const raw = response.headers.getSetCookie?.() ?? [];
  const found = raw.find((c) => c.startsWith(`${name}=`));
  return found?.split(';')[0]?.split('=')[1];
}

async function main() {
  const csrf = await fetchCsrf();
  const write = {
    'Content-Type': 'application/json',
    'X-CSRF-Token': csrf,
    Cookie: `csrf_token=${csrf}`,
  };

  const register = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: write,
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!register.ok) throw new Error(`register thất bại: ${register.status}`);

  // Nâng quyền TRƯỚC khi đăng nhập: vai trò nằm trong access token, nâng sau thì token vừa
  // cấp vẫn là USER và `POST /products` sẽ 403 (spec RBAC, test #5).
  await promoteToAdmin(EMAIL);

  const login = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: write,
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) throw new Error(`login thất bại: ${login.status}`);

  const accessToken = readCookie(login, 'access_token');
  if (!accessToken) throw new Error('không lấy được access_token từ cookie');

  const suffix = Date.now();
  const product = await fetch(`${BASE_URL}/products`, {
    method: 'POST',
    headers: { ...write, Cookie: `access_token=${accessToken}; csrf_token=${csrf}` },
    body: JSON.stringify({
      // Tên đọc được như hàng thật: mẫu này sẽ hiện trên UI lúc demo cảnh 1.000 người bấm,
      // nên không đặt tên kiểu `Áo benchmark 1757...`. Chỉ `slug` mới cần hậu tố cho khỏi trùng.
      name: 'Áo thun Flash Sale 20:00 — 100 chiếc',
      slug: `ao-thun-flash-sale-2000-${suffix}`,
      skus: [{ size: 'M', color: 'Đen', priceVnd: 199000, stock: 100 }],
    }),
  });
  if (!product.ok) throw new Error(`tạo product thất bại: ${product.status}`);
  const productId = (await product.json()).product.id;

  const detail = await fetch(`${BASE_URL}/products/${productId}`);
  const skuId = (await detail.json()).skus[0].id;

  console.log('');
  console.log('Chạy benchmark bằng lệnh sau (đổi STRATEGY cho khớp app đang chạy):');
  console.log('');
  console.log(
    `  k6 run -e SKU_ID=${skuId} -e TOKEN=${accessToken} -e CSRF=${csrf} \\\n    -e STRATEGY=optimistic -e POOL_MAX=10 k6/flash-sale.js`,
  );
  console.log('');
  console.log('Sau mỗi lần chạy: restart app với INVENTORY_STRATEGY khác, rồi seed lại SKU mới.');
}

/**
 * Đặt `role = 'ADMIN'` bằng SQL, giống `prisma/seed/make-admin.ts`.
 *
 * Dùng `pg` thẳng (không qua Prisma Client) vì script chạy bằng `node` thuần: Prisma Client
 * sinh import kèm đuôi `.js` nhưng file thật là `.ts`, và không có tầng nào remap.
 */
async function promoteToAdmin(email) {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rowCount } = await client.query(`UPDATE users SET role = 'ADMIN' WHERE email = $1`, [email]);
    if (rowCount === 0) throw new Error(`Không tìm thấy user ${email} để nâng quyền`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error('Seed benchmark thất bại:', error.message);
  process.exitCode = 1;
});
