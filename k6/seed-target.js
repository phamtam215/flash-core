/**
 * Dựng dữ liệu cho benchmark k6: một user + một SKU `stock = 100`, rồi in ra `SKU_ID` và
 * access token để truyền vào `k6 run -e ...`.
 *
 * Dùng `fetch` gọi API thật (không ghi thẳng DB) để đúng đường đi của người dùng, và để chắc
 * rằng app đang chạy trước khi bắn 1.000 VU vào nó.
 *
 * Chạy: `node k6/seed-target.js` (cần app đang `npm run dev`).
 */
const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const EMAIL = `k6-${Date.now()}@example.com`;
const PASSWORD = 'matkhau123';

/** Lấy giá trị một cookie từ header `set-cookie`. */
function readCookie(response, name) {
  const raw = response.headers.getSetCookie?.() ?? [];
  const found = raw.find((c) => c.startsWith(`${name}=`));
  return found?.split(';')[0]?.split('=')[1];
}

async function main() {
  const register = await fetch(`${BASE_URL}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!register.ok) throw new Error(`register thất bại: ${register.status}`);

  const login = await fetch(`${BASE_URL}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!login.ok) throw new Error(`login thất bại: ${login.status}`);

  const accessToken = readCookie(login, 'access_token');
  if (!accessToken) throw new Error('không lấy được access_token từ cookie');

  const suffix = Date.now();
  const product = await fetch(`${BASE_URL}/products`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: `access_token=${accessToken}` },
    body: JSON.stringify({
      name: `Áo benchmark ${suffix}`,
      slug: `ao-benchmark-${suffix}`,
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
    `  k6 run -e SKU_ID=${skuId} -e TOKEN=${accessToken} -e STRATEGY=optimistic -e POOL_MAX=10 k6/flash-sale.js`,
  );
  console.log('');
  console.log('Sau mỗi lần chạy: restart app với INVENTORY_STRATEGY khác, rồi seed lại SKU mới.');
}

main().catch((error) => {
  console.error('Seed benchmark thất bại:', error.message);
  process.exitCode = 1;
});
