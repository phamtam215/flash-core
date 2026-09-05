/**
 * Trang demo Phase 5 — không framework, không build step (ADR-007).
 *
 * Nó tồn tại để làm được đúng một cảnh: k6 bắn 1.000 VU trong khi cột Tồn kho rơi về 0 và
 * DỪNG ĐÚNG Ở 0. Mọi thứ khác ở đây là phụ trợ cho cảnh đó.
 *
 * Ba điều đáng chú ý về cách nó nói chuyện với API:
 *
 * 1. KHÔNG có token nào trong JavaScript. Access token nằm trong HttpOnly cookie — JS không
 *    đọc được, và đó là chủ đích (Phase 1). FE chỉ cần `credentials: 'same-origin'`, browser
 *    tự đính cookie.
 * 2. KHÔNG có CORS ở đây, vì trang này do chính Nest phục vụ nên cùng origin với API.
 * 3. FE KHÔNG tự "thanh toán" được: nó không có `PAYMENT_WEBHOOK_SECRET` nên không ký nổi
 *    webhook. Nếu nó làm được thì việc verify chữ ký ở Phase 4 là vô nghĩa.
 */

// ── Trạng thái ứ────────────────────────────────────────────────────────────────────────

const state = {
  user: null,
  productId: null,
  productName: '',
  skus: [],
  lastStock: new Map(), // skuId → tồn kho lần polling trước, để biết ô nào vừa đổi
  order: null,
  refreshed: false, // đã thử refresh token chưa — chỉ được thử MỘT lần
};

/** Mọi `setInterval` đang chạy. Đổi màn thì dọn hết, nếu không polling nhân đôi mỗi lần đổi. */
let timers = [];
function clearTimers() {
  timers.forEach(clearInterval);
  timers = [];
}

const $ = (id) => document.getElementById(id);
const vnd = (n) => n.toLocaleString('vi-VN') + 'đ';

// ── Gọi API ────────────────────────────────────────────────────────────────────────────

/**
 * Bọc `fetch` với đúng ba việc lặp lại ở mọi lời gọi: gửi cookie, parse JSON, và xử lý 401.
 *
 * Access token sống 15 phút nên một phiên xem lâu CHẮC CHẮN gặp 401 giữa chừng. Gặp thì thử
 * `POST /auth/refresh` **một lần** rồi gọi lại; hỏng nữa thì về màn đăng nhập. Không giới hạn
 * một lần thì hai request cùng hết hạn sẽ gọi refresh chồng nhau, và refresh token rotation
 * của Phase 1 coi lần thứ hai là **dùng lại token đã thu hồi** ⇒ thu hồi cả family ⇒ đăng
 * xuất sạch. Tự mình gây ra reuse detection của chính mình.
 */
async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });

  if (res.status === 401 && !state.refreshed && path !== '/auth/refresh') {
    state.refreshed = true;
    const refreshed = await fetch('/auth/refresh', { method: 'POST', credentials: 'same-origin' });
    if (refreshed.ok) {
      state.refreshed = false;
      return api(path, options);
    }
    showAuth();
    throw new Error('Phiên đăng nhập đã hết hạn');
  }

  const body = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const err = new Error(body?.message || `Lỗi ${res.status}`);
    err.status = res.status;
    err.code = body?.code;
    throw err;
  }
  return body;
}

/** Dải báo lỗi ở đầu trang — không dùng `alert` vì nó chặn cả polling. */
let bannerTimer = null;
function banner(message) {
  const el = $('banner');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => el.classList.remove('show'), 6000);
}

// ── Điều hướng ─────────────────────────────────────────────────────────────────────────

function show(screen) {
  clearTimers();
  ['auth', 'sale', 'orders'].forEach((s) => {
    $(`screen-${s}`).classList.toggle('hidden', s !== screen);
  });
  document.querySelectorAll('nav button').forEach((b) => {
    b.classList.toggle('active', b.dataset.screen === screen);
  });

  const loggedIn = screen !== 'auth';
  document.querySelector('nav').classList.toggle('hidden', !loggedIn);
  $('logout').classList.toggle('hidden', !loggedIn);

  if (screen === 'sale') startSale();
  if (screen === 'orders') startOrders();
}

function showAuth() {
  state.user = null;
  $('who').textContent = '';
  show('auth');
}

// ── Màn 1: Đăng nhập ───────────────────────────────────────────────────────────────────

async function submitAuth(kind) {
  const email = $('email').value.trim();
  const password = $('password').value;
  $('auth-msg').textContent = '';

  try {
    await api(`/auth/${kind}`, { method: 'POST', body: JSON.stringify({ email, password }) });
    if (kind === 'register') {
      await api('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
    }
    await boot();
  } catch (err) {
    // Lỗi đăng nhập là chuyện bình thường của người dùng, không phải sự cố hệ thống —
    // hiện tại chỗ nhập, không đẩy lên dải báo lỗi đỏ toàn trang.
    $('auth-msg').textContent = err.message;
  }
}

// ── Màn 2 + 3: Sự kiện sale ────────────────────────────────────────────────────────────

async function startSale() {
  try {
    const page = await api('/products?limit=12');
    const products = page.items || [];
    $('no-products').classList.toggle('hidden', products.length > 0);

    $('products').innerHTML = products
      .map(
        (p) => `<div class="product${p.id === state.productId ? ' selected' : ''}" data-id="${p.id}">
          <h3>${escapeHtml(p.name)}</h3>
          <div class="slug">${escapeHtml(p.slug)}</div>
        </div>`,
      )
      .join('');

    document.querySelectorAll('.product').forEach((el) => {
      el.onclick = () => selectProduct(el.dataset.id, el.querySelector('h3').textContent);
    });

    if (state.productId) await pollSkus();
    else if (products.length > 0) await selectProduct(products[0].id, products[0].name);
  } catch (err) {
    banner(err.message);
  }
}

async function selectProduct(id, name) {
  state.productId = id;
  state.productName = name;
  state.lastStock.clear();

  document.querySelectorAll('.product').forEach((el) => {
    el.classList.toggle('selected', el.dataset.id === id);
  });
  $('sku-title').textContent = name;
  $('sku-panel').classList.remove('hidden');

  await pollSkus();
  clearTimers();
  // 1,5 giây: đủ mượt để thấy tồn kho rơi khi k6 chạy, mà không dội request vào API đang
  // chịu tải. Cảnh cần quay chỉ dài ~10 giây nên WebSocket không mua thêm được gì.
  timers.push(setInterval(pollSkus, 1500));
}

async function pollSkus() {
  if (!state.productId) return;
  try {
    const page = await api(`/products/${state.productId}/skus?limit=20`);
    state.skus = page.items || [];
    renderSkus();
    $('poll-tick').textContent = `cập nhật ${new Date().toLocaleTimeString('vi-VN')}`;
  } catch (err) {
    // Polling KHÔNG được tự tắt khi lỗi: API chết rồi sống lại thì trang tự hồi phục.
    banner(`Không đọc được tồn kho: ${err.message}`);
  }
}

/**
 * Vẽ bảng SKU.
 *
 * **Chỉ dựng lại hàng khi danh sách SKU đổi; còn lại chỉ cập nhật đúng ô tồn kho.**
 *
 * Bản đầu ghi đè `innerHTML` của cả `<tbody>` mỗi nhịp polling. Nó chạy được, nhưng mỗi 1,5
 * giây toàn bộ nút "Săn ngay" bị **huỷ và tạo lại** — người dùng đang rê chuột tới thì nút
 * biến mất, và một cú bấm chậm rơi vào phần tử đã bị gỡ khỏi DOM nên không có gì xảy ra.
 * Lỗi này chỉ lộ ra khi bấm thật (trình duyệt tự động hoá báo "element did not become
 * interactive"), không bao giờ lộ khi chỉ nhìn màn hình.
 */
function renderSkus() {
  const tbody = $('sku-rows');
  const signature = state.skus.map((s) => s.id).join(',');

  if (tbody.dataset.signature !== signature) {
    tbody.dataset.signature = signature;
    tbody.innerHTML = state.skus
      .map(
        (s) => `<tr data-row="${s.id}">
          <td><b>${escapeHtml(s.size)}</b></td>
          <td>${escapeHtml(s.color)}</td>
          <td>${vnd(s.priceVnd)}</td>
          <td><span class="stock" data-stock="${s.id}"></span></td>
          <td style="text-align:right"><button class="primary" data-sku="${s.id}"></button></td>
        </tr>`,
      )
      .join('');

    tbody.querySelectorAll('button[data-sku]').forEach((btn) => {
      btn.onclick = () => placeOrder(btn, btn.dataset.sku);
    });
  }

  for (const sku of state.skus) {
    const cell = tbody.querySelector(`[data-stock="${sku.id}"]`);
    const button = tbody.querySelector(`button[data-sku="${sku.id}"]`);
    if (!cell || !button) continue;

    const before = state.lastStock.get(sku.id);
    const changed = before !== undefined && before !== sku.stock;
    state.lastStock.set(sku.id, sku.stock);

    cell.textContent = String(sku.stock);
    cell.className = `stock ${sku.stock === 0 ? 'out' : sku.stock <= 10 ? 'low' : 'plenty'}`;
    if (changed) {
      // Bỏ rồi thêm lại class để animation chạy lại từ đầu; thiếu bước ép reflow ở giữa thì
      // trình duyệt gộp hai thao tác và không thấy gì nhấp nháy cả.
      cell.classList.remove('changed');
      void cell.offsetWidth;
      cell.classList.add('changed');
    }

    // KHÔNG đụng vào nút đang trong lúc đặt đơn — placeOrder tự quản trạng thái của nó.
    if (button.dataset.busy !== '1') {
      button.disabled = sku.stock === 0;
      button.textContent = sku.stock === 0 ? 'Hết hàng' : 'Săn ngay';
    }
  }
}

async function placeOrder(button, skuId) {
  // Khoá nút NGAY, trước cả await: bấm hai lần thật nhanh là chuyện có thật, và tuy
  // Idempotency-Key chặn được ở tầng server, chặn sớm ở đây rẻ hơn một round-trip.
  button.disabled = true;
  button.dataset.busy = '1';
  button.textContent = 'Đang săn…';

  try {
    const { order } = await api('/orders', {
      method: 'POST',
      // Mỗi lần bấm là một khoá MỚI. Dùng lại khoá cũ thì server trả về đúng đơn cũ (200),
      // đúng theo thiết kế idempotency của Phase 3 — nhưng ở đây ta thật sự muốn đơn mới.
      headers: { 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify({ skuId, quantity: 1 }),
    });
    state.order = order;
    renderOrder();
    await pollSkus();
  } catch (err) {
    // 409 = hết hàng. Đó là TRẠNG THÁI NGHIỆP VỤ bình thường của flash sale, không phải lỗi
    // hệ thống — nên chỉ báo nhẹ, không nhuộm đỏ cả trang.
    banner(err.code === 'OUT_OF_STOCK' ? 'Hết hàng — chậm chân mất rồi.' : err.message);
    await pollSkus();
  } finally {
    delete button.dataset.busy;
    // Nhịp polling ngay sau đó sẽ đặt lại nhãn/trạng thái đúng theo tồn kho mới.
    button.disabled = false;
    button.textContent = 'Săn ngay';
  }
}

function renderOrder() {
  const o = state.order;
  if (!o) return;
  $('order-panel').classList.remove('hidden');
  $('order-detail').innerHTML = `
    <div class="row" style="gap: 18px; margin-bottom: 14px">
      <span class="mono">${o.id}</span>
      <span class="badge ${o.status}">${o.status}</span>
      <b>${vnd(o.totalVnd)}</b>
      <span class="countdown" data-expires="${o.expiresAt}"></span>
    </div>
    <button class="primary" id="btn-pay">Thanh toán</button>
    <div id="pay-hint"></div>`;

  $('btn-pay').onclick = payOrder;
  tickCountdowns();
}

/**
 * "Thanh toán" chỉ tạo phiên rồi hiện ra lệnh để tự bắn webhook.
 *
 * Trang này KHÔNG thể tự đánh dấu đơn đã trả tiền, vì webhook phải mang chữ ký HMAC ký bằng
 * `PAYMENT_WEBHOOK_SECRET` — thứ chỉ có ở server. Đó không phải hạn chế của demo mà là điều
 * đang được chứng minh: nếu trình duyệt ký được thì việc verify chữ ký ở Phase 4 vô nghĩa.
 */
async function payOrder() {
  try {
    const intent = await api(`/payments/checkout/${state.order.id}`, { method: 'POST' });
    $('pay-hint').innerHTML = `
      <div class="note" style="margin-top: 14px">
        <b>Phiên thanh toán đã tạo.</b> Trình duyệt không ký được webhook (không có khoá bí mật),
        nên bước cuối do "cổng thanh toán" làm — chạy lệnh này ở terminal:
      </div>
      <pre>node scripts/send-webhook.mjs \\
  --order ${state.order.id} \\
  --amount ${intent.amountVnd} \\
  --intent ${intent.paymentIntentId}</pre>
      <p class="muted" style="font-size: 13px">
        Chạy xong, mở tab <b>Đơn của tôi</b> — trạng thái sẽ chuyển sang PAID trong vài giây.
      </p>`;
  } catch (err) {
    banner(err.message);
  }
}

// ── Màn 4: Đơn của tôi ─────────────────────────────────────────────────────────────────

async function startOrders() {
  await pollOrders();
  timers.push(setInterval(pollOrders, 3000));
  timers.push(setInterval(tickCountdowns, 1000));
}

async function pollOrders() {
  try {
    const page = await api('/orders?limit=20');
    const orders = page.items || [];
    $('no-orders').classList.toggle('hidden', orders.length > 0);

    $('order-rows').innerHTML = orders
      .map(
        (o) => `<tr>
          <td class="mono">${o.id.slice(0, 8)}…</td>
          <td>${vnd(o.totalVnd)}</td>
          <td><span class="badge ${o.status}">${o.status}</span></td>
          <td>${o.status === 'PENDING' ? `<span class="countdown" data-expires="${o.expiresAt}"></span>` : '—'}</td>
        </tr>`,
      )
      .join('');
    tickCountdowns();
  } catch (err) {
    banner(err.message);
  }
}

/** Đếm ngược tới `expiresAt`. Về 0 thì nhịp polling sau sẽ thấy đơn đã CANCELLED. */
function tickCountdowns() {
  document.querySelectorAll('.countdown[data-expires]').forEach((el) => {
    const left = Math.max(0, Math.floor((new Date(el.dataset.expires) - Date.now()) / 1000));
    const mm = String(Math.floor(left / 60)).padStart(2, '0');
    const ss = String(left % 60).padStart(2, '0');
    el.textContent = left === 0 ? 'đã hết hạn' : `còn ${mm}:${ss}`;
    el.classList.toggle('urgent', left > 0 && left < 60);
  });
}

// ── Khởi động ──────────────────────────────────────────────────────────────────────────

/** Chặn XSS ở chỗ duy nhất trang này chèn dữ liệu từ server vào HTML. */
function escapeHtml(text) {
  return String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

async function boot() {
  try {
    const me = await api('/auth/me');
    state.user = me.user || me;
    $('who').textContent = state.user.email || '';
    show('sale');
  } catch {
    // 401 lúc mới mở trang là chuyện bình thường (chưa đăng nhập), không phải lỗi để báo.
    showAuth();
  }
}

$('btn-login').onclick = () => submitAuth('login');
$('btn-register').onclick = () => submitAuth('register');
$('logout').onclick = async () => {
  await api('/auth/logout', { method: 'POST' }).catch(() => undefined);
  showAuth();
};
document.querySelectorAll('nav button').forEach((b) => {
  b.onclick = () => show(b.dataset.screen);
});
$('password').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') submitAuth('login');
});

timers.push(setInterval(tickCountdowns, 1000));
boot();
