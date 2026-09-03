# Sổ tay kỹ thuật — kiến thức cần có trước mỗi phase

> **Đối tượng:** Middle Backend. Giả định đã biết REST, SQL cơ bản, async/await, Docker.
> Không giải thích lại những thứ đó.
>
> **Cách dùng:** đọc mục của phase **trước khi bắt đầu phase đó** (~15 phút/phase). Không
> đọc hết một lượt. Quay lại khi va vấn đề.
> Ngoại lệ: hai mục **Phần 0** (thuật ngữ) và **Xuyên suốt** (CI & Testing) dùng ở cả 7 phase
> — đọc một lần ngay từ đầu.
>
> **Chủ trương:** mỗi mục nêu *cơ chế* đủ để tự suy ra hệ quả, rồi dừng. Muốn đào sâu thì
> đã có từ khoá chuẩn để tra.

## Vai của file này so với các file khác

| File | Trả lời câu gì |
|---|---|
| [`glossary.md`](glossary.md) | Cái tôi đang gặp **tên là gì**? (nhận diện, 1 dòng/mục) |
| **`tech-playbook.md`** ← đây | **Nó hoạt động thế nào, hỏng ra sao, tránh bằng cách nào**? |
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
| **Liveness** | Process còn sống không? | **Readiness** — có nên gửi traffic không? Nhầm hai cái này gây restart loop (xem Phase 6) |
| **At-least-once** | Message được giao **≥1 lần** (có thể trùng) | **Exactly-once** — không tồn tại ở tầng giao vận (xem Phase 4) |
| **Optimistic lock** | Không khoá; lúc ghi mới kiểm tra "dữ liệu còn nguyên không", sai thì thua và retry | **Pessimistic lock** — khoá ngay khi đọc, người sau **chờ** |
| **Race condition** | Kết quả sai tuỳ **thứ tự** thực thi | **Deadlock** — hai bên khoá chéo, cả hai **treo** |
| **4xx** | Lỗi do phía gọi (kể cả "hết hàng") | **5xx** — lỗi do hệ thống mình. Trộn hai loại làm error rate vô nghĩa |
| **Transaction** | Nhóm thao tác **all-or-nothing** trên một connection | **Batch** — gộp nhiều thao tác cho nhanh, không đảm bảo nguyên tử |

---

# Xuyên suốt — CI & Testing (dùng ở **mọi** phase)

> Đọc phần này **một lần, ngay bây giờ** — khác các mục dưới (đọc trước từng phase). Đây là
> thứ chạy mỗi lần push, ở cả 7 phase.

## A. GitHub Actions

### Cần rõ

| Thuật ngữ | Một câu | Đừng nhầm với |
|---|---|---|
| **CI** (Continuous Integration) | Mỗi lần push, máy tự chứng minh code còn đúng | **CD** — tự động deploy. Repo này mới có CI, chưa có CD |
| **Workflow** | Một file YAML trong `.github/workflows/`. Một file = một "chương trình CI" | Một repo có nhiều workflow chạy độc lập nhau |
| **Event** (`on:`) | Điều kiện kích hoạt: `push`, `pull_request`, `schedule`, `workflow_dispatch` (bấm tay) | — |
| **Job** | Nhóm step chạy trên **một máy ảo riêng**. Job khác nhau = máy khác nhau, **không** chung ổ đĩa | **Step** — chạy trong cùng máy, cùng thư mục |
| **Step** | Một lệnh (`run:`) hoặc một action (`uses:`). Tuần tự, dừng ở step đầu tiên fail | — |
| **Runner** | Máy ảo chạy job. `ubuntu-latest` = máy GitHub cấp, **mới tinh mỗi lần** | Không phải máy của anh, không có gì sẵn |
| **Action** | Đoạn code đóng gói tái dùng. `actions/checkout@v4` = repo `actions/checkout`, tag `v4` | — |
| **Artifact** | File muốn giữ lại để tải về sau (báo cáo coverage, build output) | **Cache** — chỉ để tăng tốc lần sau, mất lúc nào cũng được, không được phụ thuộc vào |

### Cơ chế phải nắm

- **CI là "máy sạch" — đó chính là toàn bộ giá trị của nó.** Máy anh xanh chỉ chứng minh
  *"chạy được trên máy anh, với những thứ tình cờ đang có sẵn ở đó"*. CI chứng minh
  *"chạy được từ số 0, chỉ với những gì thật sự nằm trong git"*.
- Hệ quả trực tiếp: **thứ gì code cần mà không nằm trong git thì CI phải sinh lại**. Trong
  repo này đó là `src/generated/prisma` (bị gitignore) → bắt buộc có bước `npm run db:generate`
  **trước** typecheck. Đây đúng là nguyên nhân bug `Cannot find module './internal/class.js'`
  chỉ đỏ trên CI: máy local đang giữ bản generate cũ, CI sinh bản mới.
- **`npm ci` ≠ `npm install`.** `ci` xoá sạch `node_modules`, cài **đúng** `package-lock.json`,
  và **fail** nếu lock lệch `package.json`. `install` được phép tự sửa lock. CI luôn dùng `ci`
  để mọi lần chạy có cùng version dependency.
- **`cache: npm` cache thư mục tải về của npm (`~/.npm`), không cache `node_modules`.**
  Khoá cache là hash của `package-lock.json`. Nên nó chỉ làm `npm ci` nhanh hơn, không bỏ qua
  bước cài — và không thể gây "CI xanh nhờ đồ cũ".
- **Thứ tự step là có chủ đích:** cái **nhanh và hay hỏng** lên trước. lint (giây) → typecheck
  (giây) → test (chục giây) → build. Fail sớm = biết sớm, đỡ tốn phút chạy.
- **Job chạy song song mặc định; step chạy tuần tự.** Muốn job B chờ A xong: `needs: A`. Muốn
  chạy cùng một job trên nhiều phiên bản Node: `strategy.matrix`.
- **`concurrency` + `cancel-in-progress`**: push 3 lần liên tiếp → huỷ 2 lần chạy cũ, chỉ giữ
  lần mới nhất. Tiết kiệm phút chạy và tránh đọc nhầm kết quả của commit cũ.
- **Secret**: khai báo ở Settings → Secrets, dùng qua `${{ secrets.X }}`. GitHub che giá trị
  trong log — nhưng che bằng **so khớp chuỗi thô**. Nếu code in ra base64 hoặc bản cắt của
  secret thì **không** che được. Nguyên tắc: đừng in biến env ra log, dù đang debug.
- **Phút chạy:** repo **public** thì runner tiêu chuẩn miễn phí không giới hạn; repo **private**
  có hạn mức tháng. Đây là lý do `timeout-minutes` đáng đặt — một job treo có thể ăn 6 tiếng
  (mặc định của GitHub) trước khi bị cắt.

### Đọc `ci.yml` của repo này

| Khối trong [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) | Nó làm gì và vì sao |
|---|---|
| `on: push/pull_request → main` | Chạy khi push thẳng main **và** khi mở PR vào main. Hai event khác nhau, cùng một workflow |
| `concurrency: cancel-in-progress` | Push liên tiếp → chỉ giữ lần chạy mới nhất |
| `runs-on: ubuntu-latest` + `timeout-minutes: 10` | Máy sạch, và tự cắt nếu treo quá 10 phút |
| `actions/checkout@v4` | Tải code về máy ảo. Mặc định clone **nông** (depth 1) — đủ cho CI, nhưng lệnh nào cần lịch sử git đầy đủ thì phải khai `fetch-depth: 0` |
| `actions/setup-node@v4` + `node-version-file: .nvmrc` | Node version lấy từ chính file mà máy local dùng → **một nguồn sự thật**, không có chuyện local Node 24 / CI Node 20 |
| `npm ci` | Cài đúng lock |
| `npm run db:generate` (kèm `DATABASE_URL` giả) | Sinh Prisma Client vì nó bị gitignore. URL giả là đủ vì `generate` không kết nối DB — nhưng phải **đúng cú pháp**, nếu không `prisma.config.ts` sẽ ném lỗi |
| `lint` → `typecheck` → `test --coverage` → `build` | Nhanh-và-hay-hỏng trước. `build` để cuối vì nó chỉ hỏng khi 3 bước trên đã xanh |

**Còn nợ có chủ đích:** integration test **chưa** chạy trên CI (lý do ghi ngay đầu `ci.yml`:
dựng container làm CI chậm nhiều lần, và Phase 0 chưa có gì đáng test trên DB thật). Sẽ bật ở
Phase 3. Khi bật, có hai cách: `services:` của GitHub Actions (nhanh hơn, nhưng cấu hình khác
với local) hoặc để nguyên Testcontainers (chậm hơn, nhưng **local và CI chạy y hệt nhau**).

### Bug hay gặp

| Triệu chứng | Nguyên nhân | Cách chặn |
|---|---|---|
| **CI đỏ, local xanh** | Có thứ chỉ tồn tại trên máy local: file bị gitignore, biến env, bản build/generate cũ | Tái hiện bằng máy sạch: xoá `node_modules` + `src/generated`, chạy lại từ `npm ci`. **Luôn tái hiện được rồi mới sửa** |
| CI xanh, local đỏ | Ngược lại — local đang bẩn | Như trên |
| Workflow **không chạy chút nào** | Sai đường dẫn (phải là `.github/workflows/`), sai nhánh trong `on:`, hoặc YAML sai cú pháp | Tab Actions không hiện tên workflow = GitHub chưa nhận file |
| Step fail nhưng job vẫn xanh | Lệnh chạy trong pipe/`&&` nuốt mất exit code, hoặc có `continue-on-error` | Mỗi việc một `run:` riêng |
| Secret lọt vào log | `echo $VAR`, hoặc in cả object config ra khi debug | Không in env. Nếu lỡ lọt: **coi như secret đã lộ**, phải xoay vòng, không chỉ xoá log |
| CI chậm dần theo tháng | Test tích luỹ, mỗi test lại dựng lại app/DB | Xem mục **B. Testing** — gốc nằm ở cấu trúc test, không phải ở CI |

### Tình huống thực tế

Đội 6 người, `main` đỏ từ 10h sáng. Người thứ hai push lúc 10h30 thấy đỏ, tưởng lỗi của mình,
mất 40 phút debug. Người thứ ba thấy đỏ nữa thì **thôi không nhìn CI nữa**. Đến chiều không ai
biết trong đống đỏ đó có bao nhiêu lỗi thật.

Vì vậy luật phổ biến là: **main đỏ thì sửa hoặc revert trong 15 phút, không debug từ từ.** Giá
trị của CI không nằm ở việc nó chạy test — mà ở việc màu xanh **đáng tin**. Một CI đỏ kinh niên
tệ hơn không có CI, vì nó dạy cả đội bỏ qua tín hiệu.

---

## B. Testing

### Cần rõ

| Thuật ngữ | Một câu | Đừng nhầm với |
|---|---|---|
| **Unit test** | Test **một** đơn vị logic, mọi phụ thuộc thay bằng đồ giả. Nhanh (ms) | Không cần Docker, không chạm mạng/ổ đĩa |
| **Integration test** | Ghép nhiều mảnh **thật** với nhau (app + Postgres thật) | **E2E** — đi qua giao diện ngoài cùng như người dùng thật |
| **SUT** | System Under Test — thứ đang bị test | Mọi thứ còn lại là "môi trường" |
| **Test double** | Từ **chung** cho mọi thứ đóng thế dependency | Bốn loại dưới đây hay bị gọi lẫn là "mock" |
| ├ **Stub** | Trả sẵn một giá trị. Không kiểm tra gì | **Mock** |
| ├ **Mock** | Stub **cộng thêm** khẳng định "phải được gọi đúng N lần, đúng tham số" | Mock kiểm tra *tương tác*; stub chỉ cấp *dữ liệu* |
| ├ **Spy** | Bọc hàm **thật**, hàm vẫn chạy, chỉ ghi lại lời gọi | Stub — stub thay hẳn hàm |
| └ **Fake** | Bản cài đặt **thật nhưng đơn giản** (repository in-memory) | Có logic thật, không phải trả giá trị cứng |
| **Fixture** | Dữ liệu chuẩn bị sẵn cho test | **Seed** — dữ liệu mồi cho app chạy thật |
| **AAA** | Arrange → Act → Assert. Chuẩn bị, gọi, khẳng định | Ba khối tách bạch trong mỗi test |
| **Flaky test** | Lúc xanh lúc đỏ **mà code không đổi** | Nguy hiểm hơn test đỏ hẳn — nó dạy người ta bỏ qua kết quả test |
| **Coverage** | % dòng code **được chạy qua** khi test | **Không phải** % code được *kiểm chứng*. Test không có `expect` nào vẫn cho 100% |
| ├ statement/line | Dòng có được chạy không | Dễ đạt, ít ý nghĩa |
| └ **branch** | **Mỗi nhánh** `if`/`?:` có được đi cả hai chiều không | Con số đáng nhìn hơn hẳn line coverage |

### Cơ chế phải nắm

- **Kim tự tháp test.** Nhiều unit (nhanh, chỉ thẳng chỗ hỏng) → ít integration → rất ít E2E.
  Lật ngược ("ice-cream cone": chủ yếu E2E) cho ra CI 40 phút và mỗi lần đỏ không ai biết vì sao.
- **Câu hỏi chọn tầng test: rủi ro nằm ở đâu?** Rủi ro trong *logic của mình* → unit. Rủi ro
  nằm ở *tương tác* với thứ mình không viết (khoá của Postgres, thứ tự message của Redis, chữ ký
  webhook) → **bắt buộc** integration. Mock chỗ đó là tự lừa mình.
- **Đây chính là lý do repo dùng Testcontainers.** Oversell (Phase 3) chỉ xảy ra khi Postgres
  thật xử lý lock thật dưới tải thật. Một repository bị mock sẽ **luôn** trả về kết quả đúng —
  test xanh 100% trong khi production bán quá 50 áo.
- **Testcontainers** dựng container Docker thật trong vòng đời test, cấp **port ngẫu nhiên**
  (nên chạy song song không đụng nhau), dọn sau khi xong. Đổi lại: cần Docker daemon đang chạy,
  và khởi động chậm → dựng **một lần** trong `beforeAll` cho cả file, không phải `beforeEach`.
- **Jest chạy các *file* test song song** (mỗi file một process, module registry riêng), nhưng
  **các test *trong* một file thì tuần tự**. `--runInBand` (repo dùng cho integration) ép tất cả
  về một process, chạy nối đuôi — cần thiết vì nhiều file cùng đụng một DB.
- **Test phải độc lập với thứ tự chạy.** Nếu đảo thứ tự mà đỏ, nghĩa là có state rò rỉ giữa các
  test. Đây là mầm của flaky.
- **Test là hợp đồng về *hành vi*, không phải bản sao của code.** Phép thử: refactor bên trong
  mà không đổi hành vi — nếu test phải sửa theo, test đó đang bám vào implement. Phép thử ngược:
  cố tình xoá một `if` trong code — nếu **không** có test nào đỏ thì vùng đó chưa được bảo vệ,
  bất kể coverage bao nhiêu. (Tự động hoá phép thử này gọi là **mutation testing**.)
- **Với async/queue (Phase 4): tuyệt đối không `sleep(500)` rồi assert.** Đó là nguồn flaky số
  một. Chờ theo **điều kiện** — poll cho đến khi trạng thái đổi, có timeout tổng.

### Trong repo này

| | Unit | Integration |
|---|---|---|
| Lệnh | `npm test` | `npm run test:int` |
| Config | [`jest.config.js`](../jest.config.js) | [`test/jest-integration.json`](../test/jest-integration.json) |
| File | `src/**/*.spec.ts` — **nằm cạnh code nó test** | `test/**/*.e2e-spec.ts` |
| Cần Docker | Không | **Có** |
| Chạy trên CI | Có | Chưa (bật ở Phase 3) |

Hai hậu tố `.spec.ts` / `.e2e-spec.ts` chỉ là **quy ước đặt tên của repo** để hai `testRegex`
tách nhau ra, không phải luật của Jest.

Cả hai config đều cần `moduleNameMapper: {'^(\\.{1,2}/.*)\\.js$': '$1'}` — Prisma 7 sinh import
kèm đuôi `.js` nhưng file trên đĩa là `.ts`, và Jest chỉ thử thêm đuôi cho đường dẫn **chưa có**
đuôi. Xoá dòng này đi là CI đỏ ngay.

### Bug hay gặp

| Triệu chứng | Nguyên nhân | Cách chặn |
|---|---|---|
| **Test xanh nhưng bug vẫn lọt production** | Mock quá sâu — test đang kiểm tra chính cái mock mình viết | Ở chỗ rủi ro, test qua ranh giới **thật** (DB, HTTP) |
| Chạy riêng file thì xanh, chạy cả bộ thì đỏ | State dùng chung: biến ở tầng module, bản ghi DB còn sót, mock chưa reset | `clearMocks: true`; mỗi test tự dọn dữ liệu nó tạo |
| **Flaky** | `setTimeout` cố định, phụ thuộc giờ hệ thống, port cứng, thứ tự chạy | Chờ theo điều kiện; để container tự cấp port; giả lập thời gian bằng fake timer |
| `Jest did not exit one second after...` | Quên đóng pool / server / container | `afterAll`: `app.close()`, `pool.end()`, `container.stop()` |
| `Could not find a working container runtime strategy` | Docker daemon chưa bật | Bật Docker. **Không phải lỗi code** — đã gặp thật ở Phase 0 |
| `A dynamic import callback was invoked without --experimental-vm-modules` khi `test:int` | Prisma 7 tải query compiler qua WASM bằng `await import(...)` — luôn vậy, kể cả khi generator đặt `moduleFormat = "cjs"` (cờ đó chỉ đổi cách client tự export, không đổi cách nó tải WASM). Jest chạy test trong `vm.Context`; thiếu cờ này thì Node không có "dynamic import callback" để phục vụ `import()`. Không xảy ra ở unit test vì `PrismaService` ở đó luôn bị mock (`health.service.spec.ts`), chưa từng gọi `$connect()` thật — bug chỉ lộ khi engine khởi động thật, đúng phase đầu tiên có integration test | Gặp thật ở Phase 1. Đã thêm `node --experimental-vm-modules` vào script `test:int` trong `package.json` |
| `Cannot find module './internal/class.js'` khi chạy script bằng `ts-node` (không qua Jest, không qua `nest build`) | Cùng gốc với dòng trên: Prisma 7 sinh import kèm đuôi `.js` nhưng file thật là `.ts`. Jest có `moduleNameMapper` xử lý; `nest build` compile hẳn `.ts`→`.js` nên file `.js` thật sự tồn tại. `ts-node` chạy trực tiếp thì không có tầng nào remap — `require('./internal/class.js')` vỡ ngay | Gặp thật ở Phase 2 (script `prisma/seed/seed-skus.ts`). Né bằng cách không import Prisma Client trong script chạy qua `ts-node`, dùng `pg` thẳng (bulk insert không cần API kiểu Prisma) |
| `Could not find a working container runtime strategy` dù Docker đang chạy | **Container rác dồn lại**. Mỗi lần test chết giữa dòng để lại Postgres+Redis container; tới ~14 cái thì daemon trả lời chậm hơn timeout dò của Testcontainers (nó bỏ cuộc sau ~2s) và báo như thể không có Docker | `docker container prune -f` (chỉ xoá container ĐÃ DỪNG). Gặp thật ở Phase 3: dọn 14→2 thì 4/4 lần chạy xanh. KHÔNG đưa `prune` vào `npm run test:int` — nó xoá cả container của dự án khác |
| Test bắn N request song song đỏ `read ECONNRESET` | **supertest tự `listen()` rồi ĐÓNG server sau mỗi request** — request này bị cắt socket vì request khác vừa xong. Dấu hiệu kèm theo: `MaxListenersExceededWarning: close listeners added to [Server]` | Cho app `listen(0)` MỘT lần rồi bắn bằng `fetch` vào cổng thật. Gặp thật ở Phase 3 test #8; cũng giống cách k6 bắn hơn |
| Coverage cao mà vẫn sợ sửa code | Test bám implement, hoặc test không `expect` gì | Nhìn **branch coverage**, và làm phép thử "xoá một `if`" ở trên |

### Tình huống thực tế

Đêm flash sale, hệ thống bán quá 50 áo. Mở CI ra: xanh, coverage 92%. Lý do: service tồn kho
được test với một repository **mock** — mock trả về đúng số lượng mọi lúc, nên logic
`if (stock > 0) stock--` trông hoàn toàn đúng. Race condition không tồn tại trong thế giới của
mock, vì mock không có transaction, không có lock, không có hai request cùng lúc.

Bài học rút ra là một câu nên nhớ cả dự án: **coverage đo phần code đã chạy, không đo phần rủi
ro đã được kiểm chứng.** Rủi ro của dự án này nằm ở *tương tác*, và tương tác thì chỉ lộ ra khi
các mảnh thật chạy cùng nhau.

### Bốn câu hay bị hỏi — và câu trả lời

**1. CI đỏ mà máy mình xanh thì làm gì đầu tiên?**

**Tái hiện lỗi trên máy mình trước**, bằng cách dọn sạch mọi thứ không nằm trong git:

```bash
rm -rf node_modules src/generated && npm ci && npm run db:generate && npm run check
```

Vì sao không "sửa đại rồi push lại xem sao": mỗi vòng như thế mất vài phút chờ CI, và quan
trọng hơn — nếu tình cờ xanh thì **vẫn không biết vì sao**, nên lần sau lại gặp. Sửa được
mà không hiểu thì chưa gọi là sửa. Bug `Cannot find module './internal/class.js'` của dự án
này tái hiện được bằng đúng lệnh trên, và chỉ khi tái hiện mới lộ ra nguyên nhân thật là
bản Prisma Client cũ còn sót trên máy.

**2. Vì sao CI dùng `npm ci` chứ không `npm install`?**

`npm ci` xoá sạch `node_modules` rồi cài **đúng** những gì `package-lock.json` ghi, và
**báo lỗi** nếu lock lệch với `package.json`. `npm install` thì được phép tự sửa lock cho
khớp.

Nếu CI dùng `install`: một dependency có thể được cài ở version khác với máy anh, CI xanh
trong khi máy anh đỏ (hoặc ngược lại), và lock file bị sửa ngầm trên máy ảo rồi vứt đi —
không ai thấy. `ci` đảm bảo mọi lần chạy đều giống hệt nhau.

**3. Mock, stub, fake khác nhau chỗ nào?**

| | Nó là gì | Ví dụ |
|---|---|---|
| **Stub** | Trả sẵn một giá trị cứng, không kiểm tra gì | `findById()` luôn trả về một user mẫu |
| **Mock** | Stub **cộng thêm** khẳng định về cách nó bị gọi | "`sendEmail` phải được gọi đúng 1 lần với địa chỉ này" |
| **Fake** | Bản cài đặt **thật nhưng đơn giản**, có logic | Repository lưu vào một `Map` trong RAM |

**Chỗ trong dự án này mà dùng mock là sai: test chống oversell (Phase 3).** Mock repository
sẽ luôn trả về số tồn kho đúng, vì trong thế giới của mock không có transaction, không có
lock, không có hai request cùng lúc. Test xanh 100% trong khi production bán quá 50 áo.
Đó chính là lý do repo dùng Testcontainers với Postgres thật.

**4. Coverage 100% mà vẫn lọt bug — bằng cách nào?**

Coverage chỉ đếm **dòng code có được chạy qua hay không**, nó không kiểm tra kết quả đúng
hay sai. Một test gọi hàm rồi **không `expect` gì cả** vẫn cho 100% coverage.

Ví dụ cụ thể: hàm tính tiền `total = price * quantity` bị viết nhầm thành `price + quantity`.
Test gọi hàm đó → dòng code được chạy → coverage 100%. Nhưng nếu test chỉ kiểm tra "hàm
không ném lỗi" mà không so sánh con số, bug đi thẳng ra production.

Phép thử thật cho bộ test: **xoá một `if` trong code rồi chạy test.** Nếu không có test nào
đỏ thì vùng đó chưa được bảo vệ, bất kể coverage bao nhiêu. (Làm tự động việc này gọi là
*mutation testing*.)

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

## Logging và `correlationId` — đọc kỹ, code đã dùng từ Phase 0

> Phần này để **ở Phase 0** chứ không phải Phase 6, vì `correlationId` đã chạy trong repo
> ngay từ bây giờ ([`logger.module.ts`](../src/common/logger/logger.module.ts)). Phase 6 chỉ
> mở rộng nó ra queue và thêm metrics.

### Bước 1 — Log thường vs structured log

`console.log('User 5 mua áo')` sinh ra **một câu chữ**. Người đọc được, **máy thì không** —
muốn tìm "mọi lần user 5 mua hàng" phải dùng regex và cầu trời không ai đổi cách viết câu.

Structured log ghi ra **một object JSON mỗi dòng**. Đây là log thật do pino của repo in ra:

```json
{"level":40,"time":1786177830188,"pid":85352,"hostname":"...","reqId":"018f2c1a-9b3e-7a24-b8d1-2f6c4e0a7d95","skuId":"AO-THUN-DEN-L","remaining":0,"msg":"hết hàng"}
```

Vì nó là JSON, máy **query được như query database**: *"cho tôi mọi dòng có `skuId` =
AO-THUN-DEN-L và `level` ≥ 40"*. Đó là toàn bộ lý do dùng JSON thay vì câu chữ.

> `level` là số: 30 = info, 40 = warn, 50 = error. Ở máy anh, `pino-pretty` dịch lại thành
> chữ cho dễ đọc; lên production thì in JSON thô để máy gom log xử lý.

### Bước 2 — Vấn đề mà `correlationId` sinh ra để giải

Flash sale, 1 000 người bấm "Săn ngay" cùng lúc. Mỗi request in ra 4–5 dòng log. Trong một
giây, file log có **vài nghìn dòng của cả nghìn người trộn lẫn nhau**:

```
kiểm tra tồn kho
hết hàng
kiểm tra tồn kho
tạo đơn thành công
hết hàng
```

Khách gọi lên: *"tôi bấm mua lúc 20:15 mà báo lỗi"*. Dòng `hết hàng` nào là của khách đó?
**Không cách nào biết.** Đây là vấn đề thật, không phải chuyện lý thuyết.

### Bước 3 — `correlationId` là gì

Là **một chuỗi ngẫu nhiên duy nhất, gắn cho mỗi request ngay khi nó vừa vào app, và được in
kèm mọi dòng log của request đó.**

Chỉ vậy thôi. Không có gì phức tạp hơn. Đây là cùng bốn dòng log ở trên nhưng có id (log
thật, chạy bằng cấu hình pino của repo):

```
[08:30:40.675] INFO: request bắt đầu   {"reqId":"018f2c1a-...-7d95","req":{"method":"POST","url":"/orders"}}
[08:30:40.676] INFO: kiểm tra tồn kho  {"reqId":"018f2c1a-...-7d95","skuId":"AO-THUN-DEN-L"}
[08:30:40.676] WARN: hết hàng          {"reqId":"018f2c1a-...-7d95","skuId":"AO-THUN-DEN-L","remaining":0}
[08:30:40.676] INFO: request kết thúc  {"reqId":"018f2c1a-...-7d95","res":{"statusCode":409},"responseTime":47}
```

Giờ dù có trộn với 999 người khác, chỉ cần lọc theo `reqId` là ra **đúng bốn dòng này, đúng
thứ tự** — toàn bộ câu chuyện của một khách hàng.

> Trong repo, pino đặt tên trường là `reqId`. `correlationId` là tên khái niệm chung; ở
> exception filter nó được đọc lại qua `request.id`. **Ba tên, một thứ.**

### Bước 4 — Nó sinh ra ở đâu trong repo này

Toàn bộ cơ chế nằm ở **7 dòng** trong
[`logger.module.ts:34`](../src/common/logger/logger.module.ts#L34):

```ts
genReqId: (req, res) => {
  const incoming = req.headers['x-correlation-id'];
  const id = typeof incoming === 'string' && incoming.length > 0 ? incoming : randomUUID();
  res.setHeader('x-correlation-id', id);   // trả về cho client
  return id;                                // pino gắn vào MỌI dòng log của request này
}
```

Ba việc, theo thứ tự:

1. **Có id sẵn từ client không?** Nếu có thì dùng lại, **không sinh mới**.
2. Không có thì `randomUUID()` sinh một cái.
3. **Ghi id vào response header** để client cầm được.

### Bước 5 — Thực tế dùng thế nào

Đây là phần trả lời câu "thực tế như nào":

| Ai | Làm gì |
|---|---|
| Khách | Gặp lỗi, chụp màn hình. Frontend hiện `Mã lỗi: 018f2c1a-…` (lấy từ response header) |
| Support | Gửi mã đó cho dev |
| Anh | Dán mã vào ô tìm kiếm của hệ thống log → ra **đúng hành trình của khách đó** |

Không có id: mò log theo mốc thời gian giữa hàng nghìn request → vài giờ, và thường không ra.
Có id: **một câu query, vài giây.** Đó là toàn bộ giá trị.

Trong dự án này, `{ code, message, correlationId }` là hình dạng của **mọi** response lỗi
([`all-exceptions.filter.ts:67`](../src/common/filters/all-exceptions.filter.ts#L67)) — nên
khách luôn có mã để đưa lại.

### Bước 6 — Vì sao phải nhận id từ client nếu client đã gửi

Đây là chỗ mọi người hay bỏ qua. Giả sử sau này có 2 thành phần: API và worker.

- Nếu **mỗi thành phần tự sinh id mới**: một hành động của khách để lại 2 id khác nhau → vẫn
  không nối được. Vô nghĩa.
- Nếu **thành phần sau nhận lại id của thành phần trước**: cả chuỗi dùng chung một id → nối
  được từ đầu tới cuối.

Vì thế dòng `if (incoming) dùng lại` quan trọng ngang với dòng sinh id mới.

### Bước 7 — Chỗ id sẽ đứt (nợ đã biết)

Hiện `reqId` chỉ sống trong phạm vi **một HTTP request**. Đến Phase 4, khi đẩy job vào BullMQ,
request kết thúc mà job chạy sau — **id không tự đi theo**. Phải nhét nó vào payload của job
rồi worker đọc ra và log kèm.

Nếu quên, hành trình đứt đúng chỗ khó debug nhất: phần chạy nền, không ai nhìn thấy. Ghi chú
này đã có sẵn trong comment của
[`logger.module.ts`](../src/common/logger/logger.module.ts).

### Thử ngay trên máy (2 phút)

```bash
npm run dev     # terminal 1

# terminal 2:
curl -i localhost:3000/health | grep -i x-correlation-id
curl -i -H 'x-correlation-id: TAM-TEST-001' localhost:3000/health | grep -i x-correlation-id
```

Lệnh đầu: app tự sinh một UUID. Lệnh sau: app **giữ nguyên** `TAM-TEST-001`. Nhìn sang
terminal 1, dòng log của request thứ hai có `reqId: "TAM-TEST-001"` — chính là bước 3 và
bước 6 đang chạy.

### Ba thứ không được log

| Không log | Vì sao |
|---|---|
| Mật khẩu, token, cookie | Log thường được gom về nơi nhiều người xem được. Log token = phát token |
| Số thẻ, CVV | Vi phạm PCI-DSS, và không có lý do chính đáng nào |
| Toàn bộ `req.headers` | Trong đó có `authorization` và `cookie` |

Repo chặn sẵn bằng `redact.paths` ở
[`logger.module.ts`](../src/common/logger/logger.module.ts) — che **ở tầng logger**, không
trông vào việc từng người nhớ đừng log. Cách sau chắc chắn hỏng ở lần thứ n.

---

# Phase 1 — Auth & Security

## Cookie, HttpOnly và Redis — giải thích từ đầu

> Ba thứ này Phase 1 dùng liên tục. Đọc mục này trước, rồi mới đọc phần "Cơ chế phải nắm".

### Cookie là gì

Anh đã biết mỗi HTTP request/response đều có **headers**. Cookie chỉ là **hai header đặc
biệt** mà trình duyệt xử lý giúp:

```
# Server trả về, sau khi login thành công:
Set-Cookie: access_token=eyJhbGc...; HttpOnly; Secure; SameSite=Strict; Max-Age=900

# Từ đó browser TỰ ĐỘNG đính kèm vào MỌI request sau tới domain này:
Cookie: access_token=eyJhbGc...
```

**Điểm mấu chốt là chữ "tự động".** Frontend không phải viết một dòng code nào — browser tự
nhớ và tự gửi. So sánh với cách dùng header `Authorization: Bearer <token>`: lúc đó frontend
phải tự lưu token ở đâu đó, tự nhớ gắn vào từng request, và tự xoá khi logout.

### Các cờ của cookie

| Cờ | Nghĩa | Thiếu nó thì sao |
|---|---|---|
| **`HttpOnly`** | JavaScript **không đọc được** cookie này | XSS đọc trộm token |
| **`Secure`** | Chỉ gửi qua HTTPS | Token bay qua mạng ở dạng thô, ai bắt gói tin cũng thấy |
| **`SameSite=Strict`** | Chỉ gửi khi request **xuất phát từ chính site mình** | Dính CSRF |
| **`Max-Age`** | Sống bao nhiêu giây rồi browser tự xoá | Cookie sống mãi |
| **`Path=/auth/refresh`** | Chỉ gửi khi gọi đúng đường dẫn đó | Refresh token bị đính kèm **mọi** request — lộ ra nhiều nơi vô ích |

### `HttpOnly` chính xác là gì

Cookie **thường** thì JavaScript đọc được:

```js
document.cookie   // "access_token=eyJhbGc..."  ← đọc thoải mái
```

Cookie có cờ `HttpOnly` thì trình duyệt **giấu hẳn khỏi JavaScript**:

```js
document.cookie   // ""  ← không thấy gì, dù cookie vẫn tồn tại và vẫn được gửi đi
```

Chỉ trình duyệt biết giá trị đó, và nó chỉ dùng khi tự đính vào request.

**Vì sao quan trọng:** giả sử trang có lỗ hổng **XSS** — kẻ tấn công chèn được đoạn JS chạy
trong trang của anh. Nếu token nằm ở `localStorage` hoặc cookie thường, đoạn JS đó đọc rồi
gửi về máy nó trong một dòng. Với `HttpOnly`, nó **không lấy được token**.

### Nhưng `HttpOnly` KHÔNG chống CSRF

Đây là chỗ hay hiểu nhầm nhất. **CSRF không cần đọc cookie** — nó lợi dụng đúng cái tính
"browser tự gửi".

Kịch bản cụ thể: anh đang đăng nhập Flash-Core. Anh mở một trang lạ, trong đó có:

```html
<form action="https://flash-core.app/orders" method="POST" id="f">...</form>
<script>document.getElementById('f').submit()</script>
```

Browser gửi request đó **kèm cookie của anh** (vì cookie thuộc về domain flash-core.app, và
browser luôn tự đính). Server thấy cookie hợp lệ → tưởng chính anh đặt hàng. Kẻ tấn công
chưa từng đọc được token, nhưng vẫn hành động thay anh được.

**`SameSite=Strict` chặn việc này:** browser chỉ gửi cookie khi request **xuất phát từ chính
flash-core.app**. Request bắn từ trang lạ thì không có cookie → server trả 401.

### Redis là gì, và Phase 1 dùng nó làm gì

So với Postgres mà anh đã quen:

| | PostgreSQL | Redis |
|---|---|---|
| Lưu ở đâu | Ổ đĩa | **RAM** |
| Cấu trúc | Bảng, cột, quan hệ | Chỉ **key → value** |
| Truy vấn | SQL, join, index | Lấy theo đúng key. Không join, không SQL |
| Tốc độ | Mili giây | **Micro giây** |
| Mất dữ liệu | Không được phép | Chấp nhận được |

Redis dùng cho **dữ liệu tạm, ghi/đọc rất nhiều, mất cũng không chết ai**. Rate limit đúng
là loại đó.

**Phase 1 dùng Redis cho đúng một việc: đếm số lần đăng nhập sai.**

```
INCR   ratelimit:login:tam@example.com     → trả về 1, rồi 2, rồi 3...
EXPIRE ratelimit:login:tam@example.com 60  → tự xoá sau 60 giây
```

Vượt ngưỡng (ví dụ 5 lần/phút) → trả 429. Hết 60 giây, key tự biến mất, đếm lại từ đầu —
**không cần job dọn dẹp**, đó là thứ Postgres không cho không.

**Vì sao không đếm trong RAM của Node?** Vì Cloud Run chạy nhiều instance. Mỗi instance đếm
riêng thì giới hạn "5 lần/phút" thành 10 với 2 instance, 25 với 5 instance. Redis là **chỗ
đếm chung** cho mọi instance.

**Vì sao không đếm trong Postgres?** Mỗi lần login sai là một lần ghi. Dưới tấn công
brute-force đó là hàng nghìn lượt ghi mỗi giây đổ vào database chính — làm chậm cả những
việc quan trọng như đặt hàng. Redis sinh ra cho đúng loại việc này.

**Một chi tiết sẽ gặp lại ở Phase 3:** `INCR` là thao tác **atomic** — 100 request đồng thời
cùng gọi thì Redis vẫn đếm đúng 100, không mất lượt nào. Đây chính là tính chất mà chiến
lược C (Redis atomic decrement) dựa vào để chống oversell.

---

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

### Số thật đo được trong Flash-Core (không phải ví dụ minh hoạ)

Hai bằng chứng dưới đây là kết quả `EXPLAIN` thật, chạy trên 100.000 dòng seed trong chính
repo này — plan đầy đủ nằm ở `docs/specs/phase2-product-inventory.md` §Trạng thái thật, ở đây
chỉ giải thích **vì sao** con số lại như vậy.

**1. Offset vs keyset — cùng một vị trí, khác nhau 50 lần**

Lấy 20 dòng bắt đầu từ vị trí thứ 80.000 trong 100.000 dòng:

| Cách | Buffers (số trang 8KB phải đọc) | Thời gian |
|---|---|---|
| `OFFSET 80000 LIMIT 20` | 78.563 | 88 ms |
| `WHERE (created_at, id) < (...) LIMIT 20` (keyset) | 22 | 1,8 ms |

Cả hai dùng **chung một index** (`product_skus_created_at_id_idx`) — khác biệt không nằm ở
"có index hay không", mà ở **cách index được dùng**:

- `OFFSET` nói với Postgres: "đi theo index từ đầu, đếm đủ 80.000 dòng rồi mới bắt đầu lấy".
  Giống việc tìm trang 4001 trong một cuốn sách bằng cách lật từng trang một, dù bạn đã biết
  thứ tự các trang.
- `WHERE (created_at, id) < (...)` nói: "index ơi, cho tôi nhảy thẳng tới đúng chỗ này". Giống
  một cuốn từ điển — biết từ cần tìm bắt đầu bằng chữ gì thì mở thẳng đúng phần đó, không lật
  từ trang 1.

Hệ quả thực tế: `OFFSET` càng lớn (trang càng sâu) thì càng chậm **tuyến tính**. `WHERE` giữ
nguyên tốc độ dù đang ở trang 2 hay trang 20.000 — đó là lý do API `GET /skus` (chịu tải
100k dòng) bắt buộc dùng keyset.

**2. GIN index KHÔNG tự động thắng — crossover phụ thuộc kích thước bảng**

Cùng một câu `WHERE attributes @> '{"material":"cotton"}'`, trên bảng `products` (10.000 dòng,
50% khớp điều kiện):

| Cách | Buffers | Thời gian |
|---|---|---|
| Seq Scan (không có GIN) | 200 | 1,65 ms |
| Bitmap Heap Scan (có GIN) | 207 | 1,92 ms |

**Seq Scan thắng**, dù có GIN index đàng hoàng. Lý do: GIN phải làm thêm hai việc — (1) tra
cấu trúc index để biết dòng nào khớp, (2) `Recheck Cond` (đọc lại dòng thật từ bảng để xác
nhận, vì GIN không đảm bảo chính xác tuyệt đối với mọi kiểu điều kiện) — hai bước phụ đó chỉ
đáng giá khi số dòng bị loại bỏ đủ NHIỀU. Ở đây bảng chỉ có 10.000 dòng và tới một nửa số dòng
khớp điều kiện, đọc thẳng toàn bộ 200 trang rẻ hơn hẳn việc "tra rồi đọc lại".

**Quy tắc ngón tay cái** rút ra được (không phải số chính xác, chỉ là trực giác để đoán trước
khi đo): index (bất kỳ loại nào, không riêng GIN) đáng giá khi nó giúp **bỏ qua** phần lớn dữ
liệu — bảng càng lớn, hoặc điều kiện lọc càng "hiếm" (khớp một tỉ lệ nhỏ số dòng), index càng
thắng đậm. Bảng nhỏ hoặc điều kiện khớp một nửa dữ liệu thì Seq Scan thường đủ tốt, đôi khi
còn nhanh hơn. **Luôn `EXPLAIN` để biết, đừng suy đoán.**

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

### Số thật đo được trong Flash-Core (Phase 3, 1.000 VU săn 100 chiếc)

| Chiến lược | Pool | p95 (ms) | rps | Oversell |
|---|---|---|---|---|
| optimistic | 10 | 2 063 | 476 | 0 |
| pessimistic | 10 | **492** | **1 580** | 0 |
| pessimistic | 50 | 969 | 993 | 0 |
| redis | 10 | 1 393 | 481 | 0 |

Ba kết quả ngược trực giác, giải thích đầy đủ ở `docs/specs/phase3-order-concurrency.md`
§Bằng chứng test #16:

1. **Pessimistic nhanh nhất** — vì 900/1.000 request rơi vào "hết hàng", ca đó pessimistic chỉ
   tốn 1 round-trip còn optimistic tốn 2 (`UPDATE` ghi 0 dòng rồi phải hỏi thêm để tách 404
   khỏi 409). Đường đi phổ biến nhất lại là đường tốn gấp đôi.
2. **Pool 50 chậm hơn pool 10** — nới pool chỉ chuyển phần chờ khoá từ hàng đợi trong app
   (rẻ) vào bên trong Postgres (đắt). Xếp hàng bên ngoài DB, đừng dồn vào trong DB.
3. **Redis chưa nhanh hơn** — vì Phase 3 vẫn ghi DB đồng bộ. Ưu thế của nó chỉ hiện ra khi có
   outbox + async persist ở Phase 4. Số hôm nay là mốc để so sánh sau.

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

# Phase 6 — Observability

> Phần **logging và `correlationId`** đã được giải thích đầy đủ ở
> [Phase 0 §Logging và correlationId](#logging-và-correlationid--đọc-kỹ-code-đã-dùng-từ-phase-0)
> — có ví dụ log thật và cách dùng khi khách báo lỗi. Phần dưới đây chỉ là những thứ Phase 6
> **thêm vào**: đưa id qua queue, metrics, probe, graceful shutdown.

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

Đó là toàn bộ lý do Phase 6 tồn tại: **biến việc điều tra từ vài giờ thành một câu query.**

---

# Phase 7 — Deploy & FinOps

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
| Job mất khi deploy | Không graceful shutdown | Xem Phase 6 |

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
| Cú pháp YAML, context `${{ }}`, matrix, reusable workflow | GitHub Docs — *GitHub Actions › Writing workflows* (phần *Workflow syntax* là bản tra cứu đầy đủ) |
| Test double: mock vs stub vs fake | Martin Fowler — *Mocks Aren't Stubs* và *Test Pyramid* |
| Jest: config, timer giả, chạy song song | Jest docs — *Configuring Jest* + *Timer Mocks* |
| Isolation level, MVCC, khoá | Tài liệu chính thức PostgreSQL, chương *Concurrency Control* |
| Index & query plan | PostgreSQL docs, chương *Performance Tips* + `EXPLAIN` |
| Auth, lưu mật khẩu, JWT | OWASP Cheat Sheet Series (Password Storage, Session Management) |
| Outbox, saga, idempotency | microservices.io — *Transactional Outbox* |
| Queue, retry, DLQ | Tài liệu BullMQ + AWS Builders' Library, *Timeouts, retries and backoff with jitter* |
| Đọc số benchmark | k6 docs, phần *Metrics* và *Thresholds* |
