# Checklist Phase 0 — Nền móng

> **File này là nguồn sự thật duy nhất về "Phase 0 còn nợ gì".** `CLAUDE.md` và `README.md`
> chỉ trỏ về đây, không chép lại.
>
> Mỗi việc ghi rõ: **ai làm** · **làm gì** · **xong là khi nào**. Tick xong thì sửa file này.
>
> Cập nhật lần cuối: 2026-08-07 · Còn **3 việc**, ~20 phút.

---

## Làm theo thứ tự này

Việc 1 làm trước vì CI có thể đang đỏ — phải biết trước khi đi tiếp.

---

### ☐ 1. Xác nhận CI xanh

**Ai:** Tâm (Claude bị hook chặn `git push`) · **~5 phút**

```bash
git push origin main
```

Rồi mở https://github.com/phamtam215/flash-core/actions

Đang có **2 commit chưa push**: `5593dcd` (sửa CI đỏ) và `2c434d4` (tài liệu CI & test).
Commit `5593dcd` chính là bản vá cho lần đỏ trước — lần chạy này là để **xác nhận bản vá đúng**.

**Xong khi:** job `Lint · Typecheck · Test` hiện dấu ✅.

**Nếu đỏ:** copy log dán vào đây, đừng sửa mò. Cách đọc lỗi CI: [`tech-playbook.md` §Xuyên suốt](tech-playbook.md).

---

### ☑ 2. Chốt 2 câu hỏi đang treo — **XONG 2026-08-07**

- **2a. Minh bạch về AI** → **cả hai**: giữ `Co-Authored-By: Claude` trong commit **và**
  nói rõ quy trình AI-assisted trong README. → nội dung ADR-001
- **2b. Gộp hay tách ADR** → **gộp** 5 quyết định kỹ thuật vào một file. → ADR-002

---

### ☑ 3. Viết ADR — **XONG 2026-08-07 (2/2, Tâm cần đọc duyệt)**

- [`adr/001-modular-monolith.md`](adr/001-modular-monolith.md) — quyết định kiến trúc gốc, và
  là câu hỏi bản chất của Phase 0. Ghi rõ **hai tầng enforce**: NestJS DI chặn *inject*,
  ESLint chặn *import sâu*.
- [`adr/002-nen-mong-ky-thuat-phase-0.md`](adr/002-nen-mong-ky-thuat-phase-0.md) — gộp 5 quyết
  định: Prisma 7 + adapter `pg` · TypeScript 6 · không path alias · tự viết ConfigModule ·
  `@Global` đúng hai chỗ.

ADR về minh bạch AI **đã bỏ** → 3 dòng trong [`README.md`](../README.md) §Về quy trình phát
triển. Lý do: đó là quyết định trình bày portfolio, không phải quyết định kỹ thuật.

**Không ép cho đủ 10 ADR.** Mục tiêu ~10 ở [`SPEC.md` §7](SPEC.md) là của **cả dự án** —
Phase 3 (chọn chiến lược lock sau benchmark) và Phase 4 (chọn cổng thanh toán) sẽ tự sinh ra
nhiều ADR thật. Viết ADR cho quyết định chưa xảy ra là ADR rỗng.

> Ghi chú lệch: thân commit `e9c5ad5` trỏ tới "ADR-003" — sau khi bỏ ADR minh bạch AI thì
> file đó thành `001`. Lịch sử commit không sửa được; số đúng là **ADR-001**.

---

### ☐ 4. Đọc 3 câu hỏi bản chất + đáp án

**Ai:** Tâm đọc · **~5 phút** · Không cần trả lời ai, không cần viết gì

Ba câu của Phase 0 ([`SPEC.md`](SPEC.md) dòng 35–36) — đọc câu hỏi, nghĩ vài giây, rồi đọc
đáp án:

**1. Modular Monolith khác Microservices ở đâu?**

Microservices = nhiều chương trình chạy riêng, mỗi cái database riêng, nói chuyện qua mạng.
Modular Monolith = **một** chương trình, **một** database, nhưng bên trong chia thành module
có ranh giới rõ và chỉ gọi nhau qua cửa chính thức (`index.ts`).

Điểm mấu chốt: khác biệt **không nằm ở cách chia thư mục** — monolith thường cũng chia thư
mục. Nó nằm ở chỗ có thứ gì **chặn** anh đi cửa sau hay không.

**2. Vì sao dự án một người không nên làm microservices?**

Lý do hay được nói: tốn thời gian vào hạ tầng (service discovery, tracing, deploy nhiều
service) thay vì vào nghiệp vụ. Đúng, nhưng chưa phải lý do mạnh nhất.

Lý do thật với dự án này: **chống oversell trong hệ phân tán là bài toán khác hẳn.** Khi
tồn kho và đơn hàng nằm ở hai database riêng, anh mất transaction và mất `SELECT FOR UPDATE`
— tức là mất đúng những công cụ mà cả dự án sinh ra để học. Bài toán sẽ biến thành saga và
đền bù, khó hơn nhiều và không phải thứ anh đang muốn học.

**3. Ranh giới module được enforce bằng cái gì?**

Bằng **hai tầng, cả hai đều là máy chứ không phải người**:

| Tầng | Chặn cái gì | Lúc nào |
|---|---|---|
| **NestJS DI container** | Service không nằm trong `exports` của module thì module khác **không inject được** → `Nest can't resolve dependencies` | Lúc app khởi động |
| **ESLint `no-restricted-imports`** | `import` thẳng vào file bên trong module khác → lint đỏ → CI đỏ | Lúc chạy `npm run lint` |

Vì sao cần cả hai: DI container chỉ chặn việc **inject**. Nó không ngăn anh import class rồi
tự `new`, hay import kiểu dữ liệu nội bộ. Không có tầng ESLint thì ranh giới chỉ là quy ước,
và quy ước xói mòn **im lặng** — không test nào đỏ khi ai đó import sai.

Xem: [`health.module.ts`](../src/modules/health/health.module.ts) (không export
`HealthService` vì chưa ai cần) và [`eslint.config.mjs`](../eslint.config.mjs).

---

Bốn câu về CI & test — cũng đã có đáp án đầy đủ ở
[`tech-playbook.md` §Xuyên suốt](tech-playbook.md#bốn-câu-hay-bị-hỏi--và-câu-trả-lời).

**Xong khi:** đọc hết.

---

### ~~5. Viết nhật ký học tập~~ — **ĐÃ BỎ 2026-08-07**

Phase 0 là dựng config; không có đủ chất để chiêm nghiệm. Journal bắt đầu từ **Phase 3**, nơi
có benchmark và ba chiến lược để so sánh — lúc đó mới có gì đáng ghi.

Hai bài học kỹ thuật thật của Phase 0 **đã được ghi ở nơi có người đọc** rồi, nên không mất:
Prisma 7 sinh import `.js` → [`tech-playbook.md` §Xuyên suốt](tech-playbook.md) và
[`architecture.md` §Những chỗ dễ vấp](architecture.md).

---

### ☐ 5. Đóng phase

**Ai:** Claude · **~10 phút**

- Sửa `CLAUDE.md` §Trạng thái hiện tại → Phase 1
- Sửa [`README.md`](../README.md) §Lộ trình → Phase 0 ✅
- Đánh dấu file này **đã đóng**
- `/commit`

**Xong khi:** không còn ô trống nào ở trên.

---

## Đã xong — không cần hỏi lại

| | Bằng chứng |
|---|---|
| ✅ Docker Compose: Postgres 16 + Redis 7 | `npm run up` |
| ✅ NestJS skeleton + module mẫu `health` | [`src/modules/health/`](../src/modules/health/) |
| ✅ Config validate bằng Zod, chết lúc boot nếu thiếu biến | [`src/config/env.schema.ts`](../src/config/env.schema.ts) |
| ✅ Pino + `correlationId` + redact | [`src/common/logger/`](../src/common/logger/) |
| ✅ Exception filter thống nhất, phân loại 4xx/5xx | [`src/common/filters/`](../src/common/filters/) |
| ✅ Prisma 7 + `pg` driver adapter, đóng pool khi SIGTERM | [`src/infra/prisma/`](../src/infra/prisma/) |
| ✅ **16/16 test xanh** (11 unit + 5 integration Testcontainers) | `npm run check` · `npm run test:int` |
| ✅ CI GitHub Actions: generate → lint → typecheck → test → build | [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) |
| ✅ **Ranh giới module enforce bằng máy**: ESLint chặn import sâu, đã thử bằng file vi phạm | [`eslint.config.mjs`](../eslint.config.mjs) `no-restricted-imports` |
| ✅ Spec Phase 0, template spec/ADR, review checklist | [`specs/phase0-nen-mong.md`](specs/phase0-nen-mong.md) |
| ✅ Bộ công cụ Claude (đã tinh gọn còn 2 lệnh + 3 hook) | [`CLAUDE.md`](../CLAUDE.md) §Bộ công cụ |
| ✅ Tài liệu: bản đồ code, sổ tay kỹ thuật, từ điển, mục lục | [`docs/README.md`](README.md) |

---

## Cố tình KHÔNG làm ở Phase 0

Ghi ra để anh **không phải lo** khi thấy thiếu — đây là nợ có chủ đích, đã có chỗ trả:

| Chưa có | Trả ở |
|---|---|
| Model nghiệp vụ (sản phẩm, SKU, tồn kho, đơn) + migration đầu tiên | Phase 2–3 |
| Auth, rate limit | Phase 1 |
| Redis client, BullMQ (Compose đã dựng Redis nhưng app chưa nối) | Phase 3–4 |
| **Integration test chạy trên CI** | Phase 3 — lý do ghi ở đầu `ci.yml` |
| Metrics, graceful shutdown cho job đang chạy | Phase 5 |
| Dockerfile, deploy Cloud Run | Phase 6 |

---

## Phase 0 đóng góp gì vào Definition of Done

[`SPEC.md` §7](SPEC.md) có 7 mục cho **cả dự án**. Phase 0 chỉ chạm 2 mục, và chỉ một phần:

- **~10 ADR** → sau việc 3 sẽ là **3/10**
- **Integration test trên DB thật** → hạ tầng Testcontainers đã chạy được; phần
  "coverage ≥ 70% module core" phải chờ có module Order/Inventory (Phase 2–3)

5 mục còn lại (benchmark k6, sơ đồ, webhook, deploy, demo video) **không thuộc Phase 0**.

---

## Xong Phase 0 là khi nào

Đúng 3 điều kiện, không thêm:

1. **CI xanh** trên `main` (việc 1)
2. **Đã đọc 3 câu hỏi bản chất + đáp án** (việc 4)
3. **Mọi quyết định hạ tầng đều có chỗ ghi lại** — bằng chứng là 2 ADR (việc 3)

Điều kiện 3 mới là tiêu chí thật của phase này. Code chạy chỉ là điều kiện cần: đây là phần
nền, sai ở đây thì 6 phase sau phải chịu. Điều đáng giá không phải là *nhớ được* các quyết
định, mà là **chúng đã được viết ra ở nơi tra lại được** — sáu tháng sau không ai nhớ nổi,
kể cả người ra quyết định.
