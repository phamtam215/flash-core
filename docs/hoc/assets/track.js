/**
 * Theo dõi hiểu bài — checkbox + phần trăm cho từng phase.
 *
 * Không build step, không thư viện. Tiến độ lưu ở `localStorage` của TRÌNH DUYỆT ĐANG MỞ —
 * đổi máy hoặc xoá dữ liệu duyệt web là mất, nên trang chủ có nút Xuất/Nhập để mang đi.
 *
 * DANH SÁCH DƯỚI ĐÂY LÀ NGUỒN SỰ THẬT DUY NHẤT: cả checklist trong từng trang phase lẫn bảng
 * tổng ở index.html đều sinh ra từ nó, nên hai chỗ không bao giờ lệch nhau.
 *
 * `id` của mỗi ý là KHOÁ LƯU TRỮ — sửa chữ thì thoải mái, nhưng ĐỔI id là mất dấu tick cũ.
 * Thêm ý mới thì đặt id mới, đừng dùng lại id đã bỏ.
 */

const PHASES = [
  {
    id: 'p0', num: '0', title: 'Nền móng & ranh giới', href: 'phase-0.html',
    items: [
      ['ranh-gioi-import', 'Ranh giới module do <b>import</b> tạo ra, không do thư mục — chia thư mục đẹp mà import xuyên vào trong thì ranh giới bằng 0'],
      ['hai-tang-ep', 'Hai tầng ép ranh giới: DI container chặn <i>inject</i>, ESLint chặn <i>import sâu</i> — và vì sao thiếu tầng 2 thì ranh giới xói mòn im lặng'],
      ['ba-kieu-chia', 'Ba cách chia hệ thống: monolith thường / modular monolith / microservices — khác nhau ở độ tách'],
      ['vi-sao-khong-micro', 'Vì sao dự án một người không nên microservices: mất transaction và lock của một DB — đúng công cụ dùng để chống oversell'],
      ['ba-tang-mot-chieu', 'Ba tầng phụ thuộc chỉ đi một chiều, và phép thử "sắp import ngược lên modules ⇒ đặt nhầm chỗ"'],
      ['dotenv-dau-tien', 'Vì sao <code>import \'dotenv/config\'</code> phải là import đầu tiên, và triệu chứng khi đảo'],
      ['validate-luc-boot', 'Vì sao validate config lúc khởi động chứ không lúc dùng'],
      ['bufferlogs', '<code>bufferLogs</code> và <code>useLogger</code> là một cặp — bỏ một cái thì mất log khởi động'],
      ['loi-ra-bien', 'Controller chỉ <code>throw</code>; filter ở biên lo hình dạng lỗi cho cả app'],
      ['corrid-nhan-lai', '<code>correlationId</code>: sinh mới HOẶC nhận lại từ client — và vì sao dòng "nhận lại" quan trọng ngang dòng sinh mới'],
      ['chon-tang-test', 'Chọn tầng test theo câu "rủi ro nằm ở đâu": logic của mình ⇒ unit, tương tác với thứ mình không viết ⇒ integration'],
      ['xoa-mot-if', 'Phép thử "xoá một <code>if</code>" — coverage đo dòng đã chạy, không đo rủi ro đã kiểm chứng'],
      ['ci-may-sach', 'Vì sao tiêu chí là "CI xanh từ máy sạch", không phải "test xanh trên máy tôi"'],
      ['global-ha-tang', '<code>@Global()</code> chỉ dành cho hạ tầng, vì pool phải là MỘT instance cho cả app'],
    ],
  },
  {
    id: 'p1', num: '1', title: 'Auth & Security', href: 'phase-1.html',
    items: [
      ['access-vs-refresh', 'Access vs refresh token: ngắn/dài, stateless/stateful, thu hồi được hay không'],
      ['logout-van-goi-duoc', 'Logout xong access token vẫn dùng được tới lúc hết hạn — là thiết kế, không phải bug'],
      ['httponly-xss', '<code>HttpOnly</code> chặn XSS <b>đọc</b> cookie'],
      ['samesite-csrf', 'CSRF không cần đọc cookie — nó mượn việc trình duyệt tự <b>gửi</b>; chặn bằng <code>SameSite</code>'],
      ['bon-co-cookie', 'Bốn cờ cookie và thứ mỗi cờ chặn: <code>HttpOnly</code> · <code>Secure</code> · <code>SameSite</code> · <code>Path</code>'],
      ['path-xoa-cookie', '<code>path</code> lúc xoá cookie phải khớp lúc set, nếu không cookie không bao giờ mất'],
      ['rotation-reuse', 'Rotation + reuse detection: <b>dù ai dùng trước, lần thứ hai luôn lộ</b>'],
      ['gia-cua-reuse', 'Cái giá của reuse detection: cả hai bên bị đăng xuất, vì không biết ai là chủ thật'],
      ['argon2-vs-bcrypt', 'Argon2id memory-hard vs bcrypt chỉ tốn CPU — và cái giá 19 MiB mỗi lần login'],
      ['dummy-hash', 'Hash giả khi email không tồn tại — chống timing attack'],
      ['sha256-refresh', 'Refresh token hash bằng SHA-256 chứ không Argon2, nhưng <b>vẫn phải hash</b>'],
      ['ratelimit-email', 'Rate limit đếm theo email trên Redis; đánh đổi: có thể bị dùng để khoá tài khoản người khác'],
      ['incr-atomic', '<code>INCR</code> là atomic — tính chất này sẽ được dùng lại ở chiến lược Redis của Phase 3'],
    ],
  },
  {
    id: 'p2', num: '2', title: 'Product & Inventory', href: 'phase-2.html',
    items: [
      ['offset-vs-keyset', 'Offset đi từ đầu đếm bỏ N dòng; keyset nhảy thẳng — và <b>cả hai dùng chung một index</b>'],
      ['so-do-that', 'Số thật: 78.563 buffer / 88ms so với 22 buffer / 1,8ms ở cùng vị trí trong 100k dòng'],
      ['danh-doi-keyset', 'Đánh đổi của keyset: không nhảy tới trang bất kỳ được — hợp cuộn vô hạn, không hợp UI có số trang'],
      ['cursor-can-id', 'Vì sao cursor phải gồm cả <code>id</code>, không chỉ <code>created_at</code>'],
      ['limit-cong-mot', '<code>LIMIT limit + 1</code> để biết còn trang sau mà không phải <code>COUNT(*)</code>'],
      ['gin-vs-btree', 'GIN và B-tree hợp loại truy vấn nào'],
      ['seq-scan-thang', 'Vì sao Seq Scan thắng GIN trên 10.000 dòng: <code>Recheck Cond</code> + điều kiện khớp một nửa'],
      ['analyze-statistics', '<code>ANALYZE</code> sau khi seed; đọc <code>rows</code> ước lượng lệch <code>actual rows</code> bao nhiêu lần'],
      ['jsonb-te', 'Bốn trường hợp JSONB là lựa chọn tệ'],
      ['size-color-cot-that', 'Vì sao <code>size</code>/<code>color</code> là cột thật chứ không nhét vào JSONB'],
      ['check-stock', '<code>CHECK (stock &gt;= 0)</code> là lưới an toàn cuối — và test #7 tấn công từ dưới bằng SQL thô'],
      ['dem-so-query', 'Test #11 đếm số query để chặn N+1 — đo cái không nhìn thấy'],
      ['tien-int', 'Tiền lưu <code>Int</code>, không <code>Float</code>'],
      ['cuc-hiem', 'Bug <code>generateSkuCode</code>: "cực hiếm" là phỏng đoán cho tới khi có ai dùng thật'],
    ],
  },
  {
    id: 'p3', num: '3', title: 'Order & Concurrency ⭐', href: 'phase-3.html',
    items: [
      ['lost-update', 'Lost update: đọc–kiểm tra–ghi là <b>ba thao tác rời nhau</b>, khe giữa đọc và ghi luôn bị chen'],
      ['db-khong-bao-loi', '<b>Database không báo lỗi gì cả</b> — nó không hỏng, nó chỉ sai'],
      ['dieu-kien-trong-cau-ghi', 'Cách chữa: đưa điều kiện vào <b>chính câu ghi</b> — <code>UPDATE … WHERE stock &gt;= ?</code>'],
      ['danh-gia-lai-where', 'Postgres gặp dòng bị khoá thì <b>chờ, rồi đánh giá lại <code>WHERE</code> trên phiên bản mới nhất</b>'],
      ['read-committed-du', 'An toàn ngay ở Read Committed — không cần transaction, không cần đổi isolation level'],
      ['anomaly-va-retry', 'Read Committed cho phép anomaly nào; nâng lên Repeatable Read/Serializable <b>không bỏ được retry</b>'],
      ['version-khong-bat-buoc', 'Cột <code>version</code> không bắt buộc để chống oversell — nó cần khi update nhiều field phụ thuộc nhau'],
      ['ba-chien-luoc', 'Ba chiến lược: cơ chế, thắng khi nào, thua khi nào'],
      ['vi-sao-lua', 'Vì sao chiến lược Redis phải là Lua chứ không <code>GET</code> rồi <code>DECRBY</code>'],
      ['idempotency-key', 'Idempotency-Key: <code>INSERT</code> rồi bắt lỗi UNIQUE, <b>không</b> SELECT-rồi-INSERT'],
      ['snapshot-price', 'Snapshot price: client không được gửi giá; giá lấy từ <code>RETURNING</code> đúng lúc trừ kho'],
      ['409-khong-500', 'Hết hàng là 409 — trộn 4xx với 5xx làm error rate mất hết ý nghĩa'],
      ['mock-la-sai', 'Vì sao mock ở đây là sai: race condition không tồn tại trong thế giới của mock'],
      ['pessimistic-nhanh-nhat', 'Pessimistic nhanh nhất vì 900/1.000 request là "hết hàng" — ca đó tốn 1 round-trip, optimistic tốn 2'],
      ['pool-50-cham-hon', 'Pool 50 chậm hơn pool 10 — xếp hàng bên ngoài DB, đừng dồn vào trong DB'],
      ['redis-chua-nhanh', 'Redis chưa nhanh hơn vì Phase 3 còn ghi DB đồng bộ — số hôm nay là mốc để so sánh sau'],
      ['for-update-trong-tx', '<code>FOR UPDATE</code> phải nằm trong transaction, nếu không khoá nhả ngay và bug im lặng'],
      ['deadlock', 'Deadlock xảy ra khi khoá theo thứ tự khác nhau — ở đây chưa lo vì mỗi đơn chỉ chạm một SKU'],
    ],
  },
  {
    id: 'p4', num: '4', title: 'Async, Queue & Payment ⭐', href: 'phase-4.html',
    items: [
      ['dual-write', 'Dual write: chết giữa <code>db.save</code> và <code>queue.add</code>, và <b><code>try/catch</code> không cứu được</b>'],
      ['dao-thu-tu-cung-hong', 'Đảo thứ tự cũng hỏng, chỉ đổi kiểu — bài toán không nằm ở thứ tự'],
      ['outbox-cung-tx', 'Outbox: ghi <b>ý định</b> vào cùng transaction với dữ liệu'],
      ['mat-thanh-trung', 'Outbox chuyển bài toán từ "có thể <b>mất</b>" sang "có thể <b>trùng</b>"'],
      ['thu-tu-relay', 'Thứ tự trong relay: <b>đẩy trước, đánh dấu sau, cùng một transaction</b>'],
      ['ban-dau-viet-nguoc', 'Bản đầu của dự án viết ngược và vẫn mất dữ liệu im lặng — <b>không một test nào đỏ</b>'],
      ['ngoai-le-tx', 'Ba điều kiện khiến "gọi queue trong transaction" là ngoại lệ chấp nhận được (ADR-006)'],
      ['skip-locked', '<code>SKIP LOCKED</code>: thiếu nó thì 5 worker biến thành 1 worker chậm'],
      ['hai-duong-huy', 'Hai đường huỷ đơn, và vì sao trả kho phải <b>SAU</b> khi <code>UPDATE</code> đổi được trạng thái'],
      ['hai-consumer', 'Hai consumer, hai bảo đảm khác nhau: hệ quả trong DB vs ngoài DB'],
      ['at-least-once', 'At-least-once vs exactly-once, và vì sao mức thứ ba <b>không tồn tại ở tầng giao vận</b>'],
      ['consumer-idempotent', 'Consumer là <b>nơi duy nhất còn chặn được</b> — chặn bằng UNIQUE của DB'],
      ['raw-body', 'Webhook phải ký/verify trên <b>RAW body</b>, không phải body đã parse rồi stringify lại'],
      ['t-trong-chu-ky', 'Dấu thời gian <code>t</code> nằm <b>trong</b> phần được ký — thiếu nó là replay được mãi mãi'],
      ['timing-safe', '<code>timingSafeEqual</code> chứ không <code>===</code>, và vì sao'],
      ['webhook-den-muon', 'Webhook đến sau khi đơn đã huỷ: ba cách xử lý sai, và cách đúng (<code>refund_requests</code>)'],
      ['worker-process-rieng', 'Ba lý do worker phải là tiến trình riêng (ADR-005)'],
      ['jitter', 'Jitter quan trọng ngang backoff — thundering herd'],
      ['queue-prefix', '<code>QUEUE_PREFIX</code>: worker trên máy dev sẽ nuốt job của integration test'],
    ],
  },
  {
    id: 'p5', num: '5', title: 'UI demo', href: 'phase-5.html',
    items: [
      ['cong-cu-vs-san-pham', 'FE là <b>công cụ</b> hay <b>sản phẩm</b> — khác nhau ở tiêu chí dừng'],
      ['cat-goc-vs-quyet-dinh', 'Cắt góc khác quyết định ở chỗ: có ADR ghi rõ mình đang mất gì'],
      ['cung-origin', 'Cùng origin nên dự án không phải trả giá cho CORS'],
      ['cors-la-cua-browser', 'CORS là quy tắc của <b>trình duyệt</b>, không phải của server — <code>curl</code> vẫn chạy'],
      ['fe-khong-ky-duoc', 'FE không ký được webhook — và vì sao đó chính là thứ đang được chứng minh'],
      ['bug-ve-lai-tbody', 'Bug vẽ lại cả <code>&lt;tbody&gt;</code> mỗi nhịp polling làm nút bị huỷ giữa lúc bấm'],
      ['don-timers', 'Dọn <code>setInterval</code> khi đổi màn, nếu không polling nhân đôi'],
      ['route-tinh-khong-nuot-api', '4 test server: route tĩnh không được nuốt route API, 404 vẫn phải là JSON'],
      ['canh-quay-la-deliverable', 'Vì sao cảnh "tồn kho về 0 và dừng ở 0" là deliverable, chứ không phải bảng số'],
    ],
  },
  {
    id: 'p6', num: '6', title: 'Observability', href: 'phase-6.html',
    items: [
      ['ba-cau-hoi', 'Metric / log / health trả lời <b>ba câu khác nhau</b>'],
      ['id-di-qua-db', '<code>correlationId</code> đi từ API sang worker <b>qua DB</b> (payload outbox), không qua RAM'],
      ['hai-cho-goi-als', 'Chỉ có <b>đúng hai chỗ</b> trong toàn bộ code gọi <code>runWithCorrelationId</code>'],
      ['als-khong-toan-cuc', '<code>AsyncLocalStorage</code> không phải biến toàn cục — hai request có hai store riêng'],
      ['vi-sao-khong-truyen-tham-so', 'Vì sao không truyền tham số: chỉ một chỗ quên là đứt chuỗi, mà không test nào bắt được'],
      ['health-khong-cham-dep', '<code>/health</code> không được chạm database hay Redis'],
      ['vong-lap-restart', 'Gộp liveness với readiness ⇒ vòng lặp restart, và hệ thống phục hồi <b>chậm hơn</b>'],
      ['503-la-warn', '503 của readiness phải log <code>warn</code> — cảnh báo kêu sai vài lần là người ta tắt tiếng nó'],
      ['tra-no-dung-luc', 'Vì sao món nợ đó đợi tới Phase 6 mới trả, thay vì sửa ngay ở Phase 0'],
      ['cardinality', 'Cardinality: Prometheus lưu một chuỗi thời gian cho <b>mỗi tổ hợp nhãn</b>'],
      ['route-la-mau', 'Nhãn <code>route</code> phải là <b>mẫu</b> route, không phải đường dẫn thật'],
      ['dem-o-noi-biet-ly-do', 'Metric nghiệp vụ đếm ở <b>nơi biết lý do</b>, không ở interceptor'],
      ['dem-truoc-khi-nem', 'Đếm ở nhánh <code>catch</code> <b>trước</b> khi ném lại, nếu không tỉ lệ hỏng luôn bằng 0'],
      ['metrics-404', '<code>/metrics</code> khi tắt phải trả <b>404</b>, không phải 200 với trang rỗng'],
      ['tat-em-ba-buoc', 'Tắt êm ba bước, và vì sao bước giữa (chờ) là bước duy nhất thật sự cứu được request'],
      ['outbox-pending-gauge', '<code>outbox_pending</code> tăng đều nghĩa là relay đã chết — thấy trước khi có ai báo lỗi'],
    ],
  },
  {
    id: 'p7', num: '7', title: 'Deploy & FinOps', href: 'phase-7.html',
    items: [
      ['cold-start-cong-don', 'Cold start cộng dồn: container lạnh + database scale-to-zero'],
      ['do-tre-don-vao-giay-dau', 'Với flash sale, độ trễ không rải đều mà dồn hết vào giây đầu tiên'],
      ['min-instances', '<code>min-instances</code> chữa được nhưng mất free tier — dự án <b>chọn chịu</b> cold start'],
      ['ham-nong', 'Hâm nóng trước giờ mở chỉ dùng được vì <b>giờ mở là biết trước</b> — không phải giải pháp tổng quát'],
      ['nhan-connection', 'Serverless nhân connection lên: N instance × pool size vượt <code>max_connections</code>'],
      ['transaction-pooling', 'Transaction pooling không giữ session state — prepared statement, <code>LISTEN/NOTIFY</code>, advisory lock'],
      ['region-free-tier', 'Chọn region gần Việt Nam nghe hợp lý nhưng mất free tier'],
      ['hard-cutoff', 'Neon Free là <b>hard cutoff</b>: chạm hạn mức là dừng hẳn, không phải giảm tốc'],
      ['budget-alert', 'Budget alert $1 ngay ngày đầu; egress là khoản hay bị bỏ sót nhất'],
      ['khong-load-test-cloud', 'Không load test lên cloud — và repo có hook chặn bằng máy'],
    ],
  },
];

const KEY = 'flashcore-hoc-v1';

function loadState() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; }
}
function saveState(state) {
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; } catch { return false; }
}
function storageWorks() {
  try { localStorage.setItem(KEY + ':probe', '1'); localStorage.removeItem(KEY + ':probe'); return true; }
  catch { return false; }
}

let state = loadState();
/** Giữ ô Xuất/nhập mở sau khi vẽ lại, nếu không người dùng không thấy thông báo. */
let ioOpen = false;

function countPhase(phase) {
  const done = phase.items.filter(([id]) => state[phase.id + '/' + id]).length;
  return { done, total: phase.items.length, pct: Math.round((done / phase.items.length) * 100) };
}
function countAll() {
  let done = 0, total = 0;
  for (const p of PHASES) { const c = countPhase(p); done += c.done; total += c.total; }
  return { done, total, pct: Math.round((done / total) * 100) };
}

function barHtml(pct, done, total, big) {
  const full = pct === 100 ? ' full' : '';
  return `<div class="progress${big ? ' big' : ''}${full}">
    <div class="bar"><span style="width:${pct}%"></span></div>
    <b class="pct">${pct}%</b><span class="cnt">${done}/${total}</span>
  </div>`;
}

/** Checklist trong một trang phase. */
function renderTrack(el) {
  const phase = PHASES.find((p) => p.id === el.dataset.phase);
  if (!phase) return;
  const c = countPhase(phase);
  el.innerHTML = `
    <h2>Theo dõi hiểu bài — Phase ${phase.num}</h2>
    <p>Tick một ý khi <b>nói được nó thành lời mà không mở tài liệu</b>. Đọc hiểu chưa phải là
    nắm được — cảm giác quen thuộc chính là thứ cần chống lại.</p>
    <div class="trackbox">
      ${barHtml(c.pct, c.done, c.total, true)}
      <div class="donebadge"${c.pct === 100 ? '' : ' hidden'}>Nắm hết phase này ✓</div>
      <ul class="tracklist">
        ${phase.items.map(([id, text]) => {
          const key = phase.id + '/' + id;
          return `<li${state[key] ? ' class="on"' : ''}>
            <label><input type="checkbox" data-key="${key}"${state[key] ? ' checked' : ''}><span>${text}</span></label>
          </li>`;
        }).join('')}
      </ul>
      <div class="trackfoot">
        <button type="button" data-reset="${phase.id}">Bỏ tick cả phase này</button>
        <a href="index.html#tien-do">Xem tổng tiến độ →</a>
      </div>
    </div>`;
}

/** Bảng tổng ở trang chủ. */
function renderDashboard(el) {
  const all = countAll();
  el.innerHTML = `
    <div class="dash">
      <div class="dash-head">
        <div><b class="dash-pct">${all.pct}%</b><span>đã nắm ${all.done}/${all.total} ý</span></div>
        <div class="bar wide"><span style="width:${all.pct}%"></span></div>
      </div>
      <table class="dash-table"><tbody>
      ${PHASES.map((p) => {
        const c = countPhase(p);
        return `<tr class="${c.pct === 100 ? 'full' : ''}">
          <td class="n">${p.num}</td>
          <td class="t"><a href="${p.href}">${p.title}</a></td>
          <td class="b"><div class="bar"><span style="width:${c.pct}%"></span></div></td>
          <td class="p">${c.pct}%</td>
          <td class="c">${c.done}/${c.total}</td>
        </tr>`;
      }).join('')}
      </tbody></table>
      <div class="dash-foot">
        <details${ioOpen ? ' open' : ''}>
          <summary>Xuất / nhập tiến độ (đổi máy hoặc đổi trình duyệt)</summary>
          <p>Tiến độ chỉ nằm trong trình duyệt này. Copy đoạn dưới để mang sang máy khác, hoặc dán
          đoạn cũ vào rồi bấm Nhập.</p>
          <textarea id="track-io" rows="3" spellcheck="false">${JSON.stringify(state)}</textarea>
          <div class="io-row">
            <button type="button" id="track-import">Nhập từ ô trên</button>
            <button type="button" id="track-reset-all">Xoá toàn bộ tiến độ</button>
            <span id="track-msg"></span>
          </div>
        </details>
      </div>
    </div>`;
}

/** Huy hiệu % ở sidebar, có trên mọi trang. */
function renderSide() {
  const el = document.getElementById('side-progress');
  if (!el) return;
  const all = countAll();
  const track = document.getElementById('track');
  const here = track ? PHASES.find((p) => p.id === track.dataset.phase) : null;
  const hc = here ? countPhase(here) : null;
  el.innerHTML = `
    ${hc ? `<div class="sp-row"><span>Phase ${here.num}</span><b>${hc.pct}%</b></div>
            <div class="bar${hc.pct === 100 ? ' full' : ''}"><span style="width:${hc.pct}%"></span></div>` : ''}
    <div class="sp-row"><span>Toàn bộ</span><b>${all.pct}%</b></div>
    <div class="bar"><span style="width:${all.pct}%"></span></div>
    <div class="sp-note">${all.done}/${all.total} ý</div>`;
}

function refresh() {
  const track = document.getElementById('track');
  if (track) renderTrack(track);
  const dash = document.getElementById('dashboard');
  if (dash) renderDashboard(dash);
  renderSide();
}

document.addEventListener('change', (e) => {
  const input = e.target;
  if (!(input instanceof HTMLInputElement) || !input.dataset.key) return;
  if (input.checked) state[input.dataset.key] = 1; else delete state[input.dataset.key];
  saveState(state);
  refresh();
});

document.addEventListener('click', (e) => {
  const t = e.target;
  if (!(t instanceof HTMLElement)) return;

  if (t.dataset.reset) {
    const phase = PHASES.find((p) => p.id === t.dataset.reset);
    if (phase && confirm(`Bỏ tick toàn bộ Phase ${phase.num}?`)) {
      for (const [id] of phase.items) delete state[phase.id + '/' + id];
      saveState(state); refresh();
    }
    return;
  }
  if (t.closest && t.closest('.dash-foot')) ioOpen = true;

  if (t.id === 'track-import') {
    const box = document.getElementById('track-io');
    const msg = document.getElementById('track-msg');
    try {
      const parsed = JSON.parse(box.value);
      if (typeof parsed !== 'object' || parsed === null) throw new Error('không phải object');
      state = parsed; saveState(state); refresh();
      const m = document.getElementById('track-msg');
      if (m) m.textContent = 'Đã nhập.';
    } catch (err) {
      msg.textContent = 'Không đọc được: ' + err.message;
    }
    return;
  }
  if (t.id === 'track-reset-all') {
    if (confirm('Xoá toàn bộ tiến độ của cả 8 phase?')) { state = {}; saveState(state); refresh(); }
  }
});

document.addEventListener('DOMContentLoaded', () => {
  if (!storageWorks()) {
    const warn = document.createElement('div');
    warn.className = 'storage-warn';
    warn.innerHTML = 'Trình duyệt đang chặn lưu trữ cục bộ cho file mở từ ổ đĩa — <b>tick sẽ mất khi tải lại trang</b>. Mở qua một web server nhỏ (ví dụ <code>npx serve docs/hoc</code>) là lưu được.';
    document.querySelector('.content')?.prepend(warn);
  }
  refresh();
});
