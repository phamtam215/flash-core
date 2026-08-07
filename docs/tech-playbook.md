# Sổ tay kỹ thuật — kiến thức cần có trước mỗi phase

> **Đối tượng:** Middle Backend. Giả định đã biết REST, SQL cơ bản, async/await, Docker.
> Không giải thích lại những thứ đó.
>
> **Cách dùng:** đọc mục của phase **trước khi bắt đầu phase đó** (~15 phút/phase). Không
> đọc hết một lượt. Quay lại khi va vấn đề.
>
> **Chủ trương:** mỗi mục nêu *cơ chế* đủ để tự suy ra hệ quả, rồi dừng. Muốn đào sâu thì
> đã có từ khoá chuẩn để tra.

## Vai của file này so với các file khác

| File | Trả lời câu gì |
|---|---|
| [`glossary.md`](glossary.md) | Cái tôi đang gặp **tên là gì**? (nhận diện, 1 dòng/mục) |
| **`tech-playbook.md`** ← đây | **Nó hoạt động thế nào, hỏng ra sao, tránh bằng cách nào**? |
| `.claude/skills/*` | Implement thế nào trong repo này? (code, SQL, Lua) |
| [`adr/`](adr/) | Dự án **chọn** cách nào và vì sao? |

---

# Phần 0 — Thuật ngữ hay bị dùng sai

Đọc một lần, dùng cả dự án. Cột phải là chỗ dễ nhầm nhất.

| Thuật ngữ | Định nghĩa chính xác | Đừng nhầm với |
|---|---|---|
| **Hash** | Hàm một chiều, không giải ngược được | **Encrypt** (hai chiều, có khoá) và **Encode** (base64 — chỉ đổi cách biểu diễn, ai cũng giải được) |
| **Authentication** | Anh là ai | **Authorization** — anh được làm gì |
| **Idempotent** | Gọi N lần cho **cùng kết quả trạng thái** như gọi 1 lần | **Deterministic** (cùng input → cùng output). `DELETE` idempotent nhưng không deterministic về response |
| **Concurrency** | Nhiều việc **đan xen** trong cùng khoảng thời gian | **Parallelism** — chạy **đồng thời** trên nhiều CPU. Node.js một luồng vẫn có concurrency, gần như không có parallelism |
| **Latency** | Một request mất bao lâu | **Throughput** — bao nhiêu request/giây. Tăng throughput thường làm latency xấu đi |
| **p95** | 95% request nhanh hơn mức này | **Trung bình** — bị vài request 10s kéo lệch, che mất trải nghiệm tệ |
| **Liveness** | Process còn sống không? | **Readiness** — có nên gửi traffic không? Nhầm hai cái này gây restart loop (xem Phase 5) |
| **At-least-once** | Message được giao **≥1 lần** (có thể trùng) | **Exactly-once** — không tồn tại ở tầng giao vận (xem Phase 4) |
| **Optimistic lock** | Không khoá; lúc ghi mới kiểm tra "dữ liệu còn nguyên không", sai thì thua và retry | **Pessimistic lock** — khoá ngay khi đọc, người sau **chờ** |
| **Race condition** | Kết quả sai tuỳ **thứ tự** thực thi | **Deadlock** — hai bên khoá chéo, cả hai **treo** |
| **4xx** | Lỗi do phía gọi (kể cả "hết hàng") | **5xx** — lỗi do hệ thống mình. Trộn hai loại làm error rate vô nghĩa |
| **Transaction** | Nhóm thao tác **all-or-nothing** trên một connection | **Batch** — gộp nhiều thao tác cho nhanh, không đảm bảo nguyên tử |

---

# Phase 0 — Kiến trúc & nền móng

### Cần rõ

| Thuật ngữ | Một câu |
|---|---|
| **Modular Monolith** | Một process, một lần deploy, nhưng module có ranh giới rõ và chỉ nói chuyện qua interface công khai |
| **Coupling / Cohesion** | Coupling = mức phụ thuộc **giữa** module (muốn thấp); Cohesion = mức gắn kết **trong** một module (muốn cao) |
| **Dependency Injection** | Không tự `new` dependency bên trong; để bên ngoài đưa vào → thay được khi test |
| **IoC container** | Thứ giữ và ráp các dependency (ở NestJS là chính framework) |
| **12-Factor** | Bộ nguyên tắc app cloud; hai điều dùng ngay: **config qua env**, **log ra stdout** |

### Cơ chế phải nắm

- **Ranh giới module không do thư mục tạo ra, mà do `import` tạo ra.** Chia thư mục đẹp mà
  `import` xuyên thẳng vào file bên trong module khác thì ranh giới bằng không.
- **Đảo phụ thuộc**: khi module A cần B, cho A phụ thuộc vào *interface* do B công bố, không
  vào *class* của B. Đó là điều kiện để sau này tách B ra service riêng mà A không phải sửa.
- **Validate config lúc khởi động, không lúc dùng.** Thiếu biến môi trường phải làm app chết
  ngay khi boot — không phải chết lúc 3h sáng khi request đầu tiên chạm tới.

### Bug hay gặp

| Triệu chứng | Nguyên nhân | Cách chặn |
|---|---|---|
| `Nest can't resolve dependencies of X` | Quên khai báo provider, hoặc quên import module chứa nó | Đọc đúng tên token trong thông báo lỗi — nó chỉ thẳng mắt xích thiếu |
| Circular dependency | A import B, B import A | Tách phần chung ra module thứ ba, hoặc dùng interface + token |
| `@Global()` khắp nơi | Lười khai báo phụ thuộc | Chỉ global cho **hạ tầng** (config, pool DB). Nghiệp vụ thì không |
| App chạy local, chết trên server | Config đọc từ `process.env` rải rác, không validate | Một schema, một chỗ, chạy lúc boot |

### Tình huống thực tế

Tháng thứ 6, cần tách module thanh toán ra service riêng. Nếu suốt 6 tháng module khác chỉ
gọi qua interface công khai thì việc tách là đổi phần implement. Nếu chúng `import` thẳng
service và dùng cả kiểu dữ liệu nội bộ, việc tách trở thành viết lại.

---

# Phase 1 — Auth & Security

### Cần rõ

| Thuật ngữ | Một câu |
|---|---|
| **Salt** | Chuỗi random **duy nhất mỗi user**, lưu kèm hash, để hai người cùng mật khẩu ra hash khác nhau |
| **Pepper** | Chuỗi bí mật **dùng chung**, lưu ngoài DB (env/KMS) — DB rò rỉ vẫn chưa đủ để crack |
| **Memory-hard** | Thuật toán cố tình tốn RAM để GPU/ASIC không nhân bản rẻ được. Lý do Argon2 > bcrypt |
| **Access token** | Sống ngắn (15 phút), gửi kèm mọi request, **không thu hồi được** |
| **Refresh token** | Sống dài (7 ngày), chỉ dùng để đổi lấy access token mới, **lưu server nên thu hồi được** |
| **Rotation** | Mỗi lần refresh cấp token mới và **vô hiệu token cũ** |
| **Reuse detection** | Refresh token đã bị vô hiệu mà vẫn được dùng → coi như bị đánh cắp → thu hồi cả chuỗi (family) |
| **XSS** | Chèn JS chạy trong trang của mình → đọc được mọi thứ JS đọc được |
| **CSRF** | Lừa browser **tự gửi** request kèm cookie sang site mình |

### Cơ chế phải nắm

- **`HttpOnly` chặn XSS đọc cookie, không chặn CSRF.** Vì CSRF không cần *đọc* cookie —
  browser tự đính kèm. Chống CSRF bằng `SameSite=Lax/Strict` (+ CSRF token nếu cần cross-site).
- **Stateless không thu hồi được.** JWT hợp lệ tới lúc hết hạn, kể cả khi user đã logout. Nên
  access token phải **ngắn**, còn refresh token thì **stateful** (lưu DB, thu hồi được).
- **Refresh token phải hash trước khi lưu DB**, đúng như mật khẩu. DB rò rỉ mà token lưu thô
  thì kẻ tấn công đăng nhập được ngay.
- **So sánh token phải timing-safe** (`crypto.timingSafeEqual`). `===` thoát sớm ở byte đầu
  khác nhau → thời gian phản hồi rò rỉ thông tin.
- Argon2**id** là biến thể nên dùng. Tham số theo khuyến nghị OWASP hiện hành (tối thiểu
  m=19 MiB, t=2, p=1) rồi **đo lại trên máy production** — mục tiêu vài trăm ms.

### Bug hay gặp

| Triệu chứng | Nguyên nhân | Cách chặn |
|---|---|---|
| Login chậm 3s dưới tải | Tham số Argon2 quá nặng × nhiều request đồng thời | Đo, chỉnh tham số, thêm rate limit |
| Logout xong vẫn gọi API được | Access token còn hạn — đúng thiết kế stateless | Rút ngắn hạn access token; thu hồi ở tầng refresh |
| User bị đăng xuất ngẫu nhiên | Rotation + 2 tab cùng refresh → tab chậm dùng token đã vô hiệu | Cho grace period ngắn, hoặc khoá theo family thay vì từng token |
| Brute-force lọt | Rate limit chỉ theo IP | Giới hạn theo **cả** account và IP; account bị dò từ 1000 IP vẫn phải chặn |
| Token lộ trong log | Log nguyên request headers | Redact ở tầng logger, đừng dựa vào "nhớ đừng log" |

### Tình huống thực tế

Reuse detection nghe lý thuyết cho tới khi xảy ra thật: laptop user bị dính malware, kẻ tấn
công copy refresh token. Cả hai cùng dùng → server thấy một token đã rotate bị dùng lại →
thu hồi cả family → **cả hai** bị đăng xuất. User phải đăng nhập lại (phiền), nhưng kẻ tấn
công mất quyền. Đó là đánh đổi có chủ đích, không phải bug.

---

# Phase 2 — Database & hiệu năng

### Cần rõ

| Thuật ngữ | Một câu |
|---|---|
| **B-tree** | Index mặc định, hợp với `=`, `<`, `>`, `BETWEEN`, `ORDER BY` |
| **GIN** | Index cho giá trị "nhiều phần tử trong một ô": JSONB, mảng, full-text |
| **Seq Scan** | Quét toàn bảng. Trên bảng nhỏ đây là lựa chọn **đúng**, không phải lỗi |
| **Query plan** | Kế hoạch DB tự chọn dựa trên **statistics**, không dựa trên câu SQL mình viết |
| **Statistics** | Ước lượng phân bố dữ liệu, cập nhật bởi `ANALYZE`/autovacuum |
| **N+1** | Lấy 1 danh sách rồi query thêm cho từng phần tử |
| **Offset pagination** | `LIMIT/OFFSET` — DB vẫn phải tạo và bỏ đi toàn bộ dòng trước offset |
| **Keyset (cursor) pagination** | Dùng giá trị của dòng cuối trang trước làm mốc `WHERE` |
| **Connection pool** | Tập connection tái dùng, vì mở connection mới rất đắt |

### Cơ chế phải nắm

- **Đo trên dữ liệu thật.** Trên 10 dòng, Seq Scan luôn thắng index. Kết luận rút ra từ bảng
  nhỏ gần như luôn sai. Seed 100k rồi mới `EXPLAIN`.
- **`ANALYZE` sau khi seed.** Thiếu bước này planner đoán sai và mọi kết luận sau đó vô nghĩa.
- Trong `EXPLAIN (ANALYZE, BUFFERS)`, thứ đáng nhìn đầu tiên là **`rows` (ước lượng) lệch
  `actual rows` bao nhiêu lần**. Lệch lớn = planner đang mù.
- **Index không miễn phí**: mỗi index làm `INSERT`/`UPDATE` chậm hơn. Trên bảng tồn kho bị
  update liên tục giữa flash sale, đó là chi phí trên đúng đường nóng nhất.
- **JSONB hợp với thuộc tính động**, không hợp với thứ cần ràng buộc và join thường xuyên.
  `size`/`color` là cột thật; "chất liệu, hoạ tiết tuỳ mẫu" mới là JSONB.

### Bug hay gặp

| Triệu chứng | Nguyên nhân | Cách chặn |
|---|---|---|
| Có index mà vẫn Seq Scan | Cột bị bọc hàm: `WHERE lower(email)=…` | Tạo **expression index** trên đúng biểu thức đó |
| `LIKE '%abc%'` chậm | B-tree không phục vụ được wildcard đầu chuỗi | GIN + `pg_trgm`, hoặc đổi cách tìm |
| Query nhanh lần 2, chậm lần 1 | Lần 2 đọc từ cache | Đọc `Buffers: shared read` vs `hit` trước khi mừng |
| Trang cuối chậm dần | Offset pagination | Chuyển sang keyset |
| Danh sách 20 item → 21 query | N+1 | Bật log query của Prisma và **đếm** |
| Deploy xong app treo | Migration thêm index khoá bảng lớn | `CREATE INDEX CONCURRENTLY` (không chạy trong transaction) |

### Tình huống thực tế

Query danh sách SKU chạy 8ms trên máy dev với 200 dòng. Lên staging 100k dòng thành 900ms.
Nguyên nhân không phải "thiếu index" mà là **planner chọn Seq Scan vì statistics cũ**. Chạy
`ANALYZE` xong còn 12ms — chưa cần thêm index nào. Bài học: đo trước, đừng thêm index theo
phản xạ.

---

# Phase 3 — Concurrency ⭐ (phần quan trọng nhất)

### Cần rõ

| Thuật ngữ | Một câu |
|---|---|
| **Critical section** | Đoạn chỉ được một luồng đi qua tại một thời điểm |
| **Read-modify-write** | Đọc → tính → ghi. Giữa các bước có kẻ chen vào ⇒ **lost update** |
| **ACID** | Atomicity (tất cả hoặc không), Consistency (không phá ràng buộc), Isolation (mức cách ly), Durability (commit rồi là còn) |
| **Isolation level** | Mức cách ly giữa các transaction đang chạy đồng thời |
| **Dirty read** | Đọc dữ liệu tx khác **chưa commit** |
| **Non-repeatable read** | Đọc cùng một dòng hai lần trong một tx, giá trị khác nhau |
| **Phantom read** | Chạy cùng một điều kiện hai lần, **số dòng** khác nhau |
| **Serialization failure** | Lỗi `40001` — PG huỷ tx vì không thể xếp thứ tự an toàn. **Phải retry** |
| **Lock contention** | Nhiều luồng tranh cùng một khoá → throughput sụt |
| **Pool exhaustion** | Hết connection trong pool → request fail. **Triệu chứng giống lock contention nhưng nguyên nhân khác** |

### Cơ chế phải nắm

**1. Vì sao `if (stock > 0) stock--` *chắc chắn* sai, không phải "hiếm khi" sai.**
Điều kiện được kiểm tra trong RAM của Node tại một thời điểm đã cũ. Nơi duy nhất biết sự
thật là dòng trong Postgres. Dưới tải, khoảng giữa "đọc" và "ghi" luôn có request khác chen
vào. Cách chữa duy nhất đúng: **đưa điều kiện vào cùng câu lệnh ghi**.

**2. Ba mức isolation của Postgres:**

| Mức | Ngăn được | Vẫn cho phép | Ghi chú |
|---|---|---|---|
| **Read Committed** (mặc định) | dirty read | non-repeatable, phantom | Mỗi **câu lệnh** thấy một snapshot mới |
| **Repeatable Read** | + non-repeatable, phantom | — | PG dùng snapshot isolation; có thể ném `40001` |
| **Serializable** | tất cả | — | SSI phát hiện chu trình phụ thuộc; ném `40001` nhiều hơn |

Điểm ai cũng bỏ qua: **Repeatable Read và Serializable không loại bỏ việc phải retry — chúng
chuyển lỗi từ "dữ liệu sai" sang "transaction bị huỷ".** Không viết vòng retry thì đổi
isolation level chỉ làm hỏng theo cách khác.

**3. Vì sao `UPDATE ... WHERE id=? AND stock>=1` an toàn ngay ở Read Committed.**
Khi `UPDATE` gặp dòng đang bị tx khác khoá, nó **chờ**; tx kia commit xong, Postgres
**đánh giá lại điều kiện `WHERE` trên phiên bản mới nhất** rồi mới quyết định có update
không. Nhờ vậy điều kiện không bao giờ chạy trên dữ liệu cũ. Đây là lý do cột `version`
không bắt buộc để chống oversell — nó cần khi update nhiều field phụ thuộc nhau.

**4. Ba chiến lược, một đánh đổi:**

| | Cơ chế | Thắng khi | Thua khi |
|---|---|---|---|
| Optimistic | Ghi kèm điều kiện, thua thì retry | Tranh chấp thấp | Tranh chấp gắt → retry tăng phi tuyến |
| Pessimistic | `SELECT … FOR UPDATE`, người sau chờ | Tranh chấp gắt, cần công bằng | Throughput sụt; nguy cơ deadlock |
| Redis atomic | Lua script kiểm-tra-và-trừ trong một lệnh | Cần throughput tối đa | Redis chết giữa chừng → lệch DB, phải reconcile |

**5. Redis atomic vì sao phải là Lua.** Redis thực thi lệnh tuần tự trên một luồng, nên một
script Lua chạy trọn vẹn không bị chen ngang. `GET` rồi `DECRBY` từ Node lại là
read-modify-write, chỉ đổi chỗ xảy ra.

**6. Idempotency-Key phải để DB làm trọng tài.** `INSERT` key với **unique constraint** rồi
bắt lỗi trùng — không `SELECT` xem tồn tại chưa rồi mới `INSERT` (đó lại là lost update).
Và phải check **trước** mọi side effect.

### Bug hay gặp

| Triệu chứng | Nguyên nhân | Cách chặn |
|---|---|---|
| Bán 101 chiếc khi còn 100 | Read-modify-write | Đưa điều kiện vào câu `UPDATE`; thêm `CHECK (stock >= 0)` làm lưới cuối |
| `FOR UPDATE` không có tác dụng | Chạy ngoài transaction → khoá nhả ngay khi câu lệnh xong | Bọc trong `$transaction` interactive |
| Deadlock ngẫu nhiên | Hai tx khoá nhiều dòng theo **thứ tự khác nhau** | Luôn khoá theo thứ tự cố định (`ORDER BY id`) |
| Retry 3 lần cho SKU đã hết hàng | Không phân biệt "hết hàng" (đừng retry) với "xung đột version" (nên retry) | Tách hai nhánh sau khi `UPDATE` trả 0 dòng |
| Hết hàng trả 500 | Coi trạng thái nghiệp vụ là lỗi hệ thống | 409 Conflict |
| "Pessimistic chậm quá" | Thật ra **hết connection pool**, không phải lock | Xem `pg_stat_activity`; tách `DATABASE_POOL_MAX` thành biến để thử |
| Tồn kho Redis lệch DB | Trừ Redis xong process chết trước khi ghi DB | Outbox + reconcile job **có ghi log**, không im lặng sửa số |
| Test concurrency lúc xanh lúc đỏ | Dữ liệu còn sót giữa các test | `TRUNCATE` ở `afterEach`, mỗi test tự seed |

### Tình huống thực tế

20:00 mở sale, 1.000 người bấm trong 3 giây. Log cho thấy p95 nhảy lên 4s và 30% request lỗi.
Nhìn vội thì kết luận "DB không chịu nổi". Nhưng khi tách số ra: 5xx = 0, toàn bộ lỗi là 409
(hết hàng) — hoàn toàn bình thường, vì chỉ có 100 chiếc. Còn p95 4s là do pool 10 connection
trong khi 200 transaction đang xếp hàng chờ khoá.

Hai bài học: **luôn tách 4xx khỏi 5xx trước khi kết luận**, và **pool size là một phần của
kết quả benchmark, không phải hằng số**.

---

# Phase 4 — Async, Queue & Payment

### Cần rõ

| Thuật ngữ | Một câu |
|---|---|
| **At-most-once** | Có thể mất, không bao giờ trùng |
| **At-least-once** | Không bao giờ mất, có thể trùng ← lựa chọn thực tế |
| **Exactly-once** | Không tồn tại ở tầng **giao vận**. Cái đạt được là *exactly-once processing* = at-least-once + consumer idempotent |
| **Dual write** | Ghi vào hai hệ thống mà không có transaction bao được cả hai |
| **Outbox** | Ghi event vào bảng **trong cùng transaction** với dữ liệu; worker đọc bảng rồi đẩy queue |
| **`SKIP LOCKED`** | Bỏ qua dòng đang bị khoá thay vì chờ — để nhiều worker chia việc, không giẫm nhau |
| **Idempotent consumer** | Xử lý message trùng vẫn ra đúng một kết quả |
| **Thundering herd** | Hàng loạt client cùng retry một lúc, đập chết service vừa hồi phục |
| **DLQ** | Nơi chứa job cạn retry, để người xem lại |
| **Compensating transaction** | Không rollback được thì làm hành động bù (trả hàng về kho) |
| **State machine** | Bảng quy định trạng thái nào được chuyển sang trạng thái nào |

### Cơ chế phải nắm

- **Dual write không sửa được bằng `try/catch`.** `await db.save()` rồi `await queue.add()`:
  chết ở giữa là DB có, queue không. Đảo thứ tự cũng hỏng theo cách khác. Chỉ có cách đưa
  event vào **cùng transaction** với dữ liệu — đó là Outbox.
- **Outbox không cho exactly-once.** Push queue thành công rồi chết trước khi đánh dấu
  `processed_at` → push lần hai. Nó chuyển bài toán từ "có thể **mất**" sang "có thể
  **trùng**" — và trùng thì consumer idempotent xử lý được, còn mất thì không.
- **Idempotent bằng unique constraint**, giống Idempotency-Key: `INSERT` `event_id` vào bảng
  `processed_event`, va unique là bỏ qua.
- **Việc không ghi DB được (gửi email) không có transaction.** Phải chọn: ghi dấu *trước*
  (rủi ro mất mail) hay *sau* (rủi ro gửi hai lần). Đây là quyết định nghiệp vụ → ghi ADR.
- **Jitter quan trọng ngang backoff.** 500 job cùng fail lúc SMTP sập sẽ cùng thức dậy nếu
  delay giống hệt nhau.
- **Chuyển trạng thái phải có điều kiện ở DB**, không kiểm tra trong RAM:
  `UPDATE orders SET status='CANCELLED' WHERE id=? AND status='PENDING'`. 0 dòng bị ảnh hưởng
  nghĩa là ai đó đã xử lý trước — thoát êm, không throw, không trả hàng về kho lần hai.
- **Webhook: verify chữ ký trên raw body, trước khi parse.** Middleware parse JSON rồi
  stringify lại sẽ đổi bytes và chữ ký không bao giờ khớp. So sánh bằng `timingSafeEqual`.
- **Trả 2xx nhanh, xử lý nặng đẩy vào queue.** Cổng thanh toán có timeout; xử lý chậm → nó
  coi là fail → retry → nhân đôi công việc.

### Bug hay gặp

| Triệu chứng | Nguyên nhân | Cách chặn |
|---|---|---|
| Chữ ký webhook luôn sai | Verify trên body đã parse lại | Đọc raw body cho đúng route đó |
| Khách nhận 2 email xác nhận | Consumer không idempotent + queue at-least-once | Bảng `processed_event` với unique key |
| Đơn đã huỷ bỗng thành đã trả tiền | Webhook đến muộn, code hồi sinh đơn `CANCELLED` | State machine cấm chuyển ngược; ghi bản ghi cần hoàn tiền |
| Tồn kho bị trả về kho hai lần | Job huỷ đơn chạy hai lần, không kiểm tra trạng thái trước khi bù | Conditional `UPDATE`, xem số dòng bị ảnh hưởng |
| Job biến mất không dấu vết | `removeOnFail: true`, không có DLQ | Giữ failed job + metric + log mức error |
| Service vừa hồi phục lại sập | Thundering herd | Backoff **+ jitter** |
| Job retry mãi cho lỗi không thể sửa | Không phân biệt lỗi tạm thời với lỗi vĩnh viễn | Email sai định dạng → fail thẳng, đừng retry |

### Tình huống thực tế

Khách bấm thanh toán lúc phút 14:58. Cổng xử lý chậm, webhook "đã trả tiền" về lúc 15:03 —
đơn đã tự huỷ và hàng đã trả về kho, có thể người khác đã mua mất.

Ba cách xử lý sai: (1) bỏ qua webhook — khách mất tiền; (2) hồi sinh đơn thành `PAID` — tạo
oversell ở đường sau; (3) tự động hoàn tiền mà không ghi lại — không ai biết chuyện đã xảy ra.

Cách đúng: ghi một bản ghi `refund_required` đầy đủ thông tin, log mức error kèm
`correlationId`, rồi để quy trình nghiệp vụ (tự động hoặc thủ công) xử lý. **Tiền thật đã
chuyển thì không được để hệ thống im lặng.**

---

# Phase 5 — Observability

### Cần rõ

| Thuật ngữ | Một câu |
|---|---|
| **Logs / Metrics / Traces** | Sự kiện rời rạc / số đo theo thời gian / hành trình một request qua nhiều thành phần |
| **Structured logging** | Log dạng JSON để **máy** query được, không phải chuỗi cho người đọc |
| **Correlation ID** | Một id xuyên suốt request → queue → worker, để nối các dòng log lại |
| **Liveness probe** | "Còn sống không?" Fail → **restart container** |
| **Readiness probe** | "Nhận traffic được chưa?" Fail → **ngừng gửi traffic**, không restart |
| **Graceful shutdown** | Nhận SIGTERM → ngừng nhận request mới → chờ việc đang chạy → đóng kết nối |
| **Cardinality** | Số giá trị khác nhau của một nhãn metric. Cao quá thì nổ bộ nhớ |
| **PII** | Dữ liệu định danh cá nhân — không được lọt vào log |

### Cơ chế phải nắm

- **Liveness không được kiểm tra dependency.** DB chết → `/health` fail → orchestrator restart
  container → app khởi động lại → DB vẫn chết → restart loop. Restart app không chữa được DB;
  nó chỉ làm mất luôn những request app còn xử lý được.
- **Correlation ID phải đi qua ranh giới async.** Trong HTTP request thì dễ; khi đẩy job vào
  queue, id phải nằm trong payload — nếu không, hành trình đứt đúng chỗ khó debug nhất.
- **Graceful shutdown có thứ tự**: ngừng nhận mới → chờ inflight xong (có timeout) → đóng
  pool/queue. Làm sai thứ tự thì vẫn mất việc đang chạy.
- **Redact ở tầng logger**, không dựa vào việc nhớ đừng log. Cấu hình một lần, áp dụng mọi nơi.
- **Metric label không được chứa userId/orderId.** Mỗi giá trị mới tạo một time series —
  cardinality nổ, hệ thống metric chết.

### Bug hay gặp

| Triệu chứng | Nguyên nhân | Cách chặn |
|---|---|---|
| Container restart liên tục khi DB chậm | Liveness kiểm tra DB | Tách rõ `/health` và `/ready` |
| Có log nhưng không lần được request | Thiếu correlationId, hoặc id đứt ở queue | Sinh ở middleware, truyền vào payload job |
| Deploy làm mất job đang chạy | Không bắt SIGTERM | Bật shutdown hooks, chờ inflight |
| Prometheus ngốn RAM | Label cardinality cao | Chỉ label thứ hữu hạn: route, method, status |
| Log lộ token | Log nguyên headers | Redact paths ở logger |

### Tình huống thực tế

Khách báo "đặt hàng lỗi lúc 20:15". Không có correlation ID thì phải mò log theo timestamp
giữa hàng nghìn request đồng thời. Có rồi thì: lấy id từ response header khách gửi lại →
một câu query → thấy đủ hành trình từ HTTP tới worker, kể cả job retry ba lần.

Đó là toàn bộ lý do Phase 5 tồn tại: **biến việc điều tra từ vài giờ thành một câu query.**

---

# Phase 6 — Deploy & FinOps

### Cần rõ

| Thuật ngữ | Một câu |
|---|---|
| **Cold start** | Request đầu phải chờ container khởi động từ 0 |
| **min-instances** | Số bản luôn chạy sẵn — hết cold start nhưng **mất tiền 24/7** |
| **Stateless** | Không giữ state trong RAM instance, vì instance bị tạo/huỷ bất kỳ lúc nào |
| **Transaction pooling** (PgBouncer) | Connection được trả về pool sau **mỗi transaction**, không phải mỗi phiên |
| **Blue-green / Rolling** | Hai chiến lược đổi phiên bản không downtime |
| **Egress cost** | Tiền trả cho dữ liệu **đi ra khỏi** cloud — khoản hay bị bỏ sót nhất |
| **Hard cutoff** | Chạm hạn mức là **dừng hẳn**, không phải giảm tốc (Neon Free) |

### Cơ chế phải nắm

- **Serverless nhân connection lên.** N instance × pool size mỗi instance có thể vượt
  `max_connections` của DB. Đó là lý do cần pooler.
- **Transaction pooling không giữ session state.** Prepared statement, `LISTEN/NOTIFY`,
  advisory lock ở mức session sẽ không hoạt động như mong đợi. Phải biết trước khi bật.
- **Cold start cộng dồn**: container lạnh + DB scale-to-zero lạnh. Với flash sale mở đúng giờ,
  request đầu tiên chính là lúc đông nhất — cách rẻ nhất là **hâm nóng trước giờ mở**.
- **Worker chạy nền trên nền tảng tính tiền theo request** cần chú ý: CPU có thể bị bóp sau
  khi response đã trả. Worker queue thường nên là service riêng.
- **Đặt budget alert ngay ngày đầu bật billing.** Rẻ hơn mọi cách tối ưu sau đó.

### Bug hay gặp

| Triệu chứng | Nguyên nhân | Cách chặn |
|---|---|---|
| `too many connections` khi traffic tăng | Số instance × pool vượt giới hạn DB | Dùng pooler; giảm pool mỗi instance |
| Request đầu mỗi sáng chậm 5s | Cold start + DB scale-to-zero | Hâm nóng trước giờ cao điểm |
| DB treo giữa tháng | Chạm hard cutoff của free tier | Theo dõi quota; không chạy load test lên cloud |
| Hoá đơn bất ngờ | Không có budget alert; egress bị bỏ quên | Alert $1 từ ngày đầu |
| Job mất khi deploy | Không graceful shutdown | Xem Phase 5 |

### Tình huống thực tế

Free tier chỉ áp dụng ở một số region cụ thể — chọn region gần Việt Nam nghe hợp lý nhưng
mất free tier. Chấp nhận độ trễ ~200ms từ VN để giữ chi phí 0đ là một **đánh đổi có ý thức**,
và giải thích được đánh đổi đó chính là câu chuyện FinOps đáng kể khi phỏng vấn — đáng giá
hơn nhiều so với việc chỉ nói "em đã deploy lên cloud".

---

# Đào sâu khi cần

Chỉ tra khi thật sự va vấn đề — đọc trước sẽ quên.

| Chủ đề | Nguồn |
|---|---|
| Isolation level, MVCC, khoá | Tài liệu chính thức PostgreSQL, chương *Concurrency Control* |
| Index & query plan | PostgreSQL docs, chương *Performance Tips* + `EXPLAIN` |
| Auth, lưu mật khẩu, JWT | OWASP Cheat Sheet Series (Password Storage, Session Management) |
| Outbox, saga, idempotency | microservices.io — *Transactional Outbox* |
| Queue, retry, DLQ | Tài liệu BullMQ + AWS Builders' Library, *Timeouts, retries and backoff with jitter* |
| Đọc số benchmark | k6 docs, phần *Metrics* và *Thresholds* |
