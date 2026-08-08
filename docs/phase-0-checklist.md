# Checklist Phase 0 — Nền móng

> **File này là nguồn sự thật duy nhất về "Phase 0 còn nợ gì".** `CLAUDE.md` và `README.md`
> chỉ trỏ về đây, không chép lại.
>
> Mỗi việc ghi rõ: **ai làm** · **gõ gì** · **xong là khi nào**. Tick xong thì sửa file này.
>
> Cập nhật lần cuối: 2026-08-07 · Còn **2 việc**, ~20 phút.
>
> **Đã cắt gọn 2026-08-07.** Đo được tỉ lệ 1 dòng code : 5 dòng tài liệu → bỏ ADR về minh bạch
> AI (chuyển thành 3 dòng trong README, vì nó là chuyện portfolio chứ không phải kỹ thuật) và
> bỏ journal Phase 0 (phase này là config, không có gì để chiêm nghiệm — journal bắt đầu từ
> Phase 3). Luật ngân sách tài liệu mới: `CLAUDE.md` §Ngân sách tài liệu.

---

## Làm theo thứ tự này

Thứ tự không tuỳ tiện: việc 1 có thể đang đỏ (phải biết trước khi làm tiếp), việc 2 chặn
việc 3, và việc 4 là cổng — không qua thì việc 5–6 vô nghĩa.

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

### ☐ 4. Qua cổng `/quiz` — câu hỏi bản chất

**Ai:** Tâm trả lời, **không nhìn code** · **~20 phút**

```
/quiz
```

Ba câu của Phase 0 ([`SPEC.md`](SPEC.md) dòng 35–36):

1. Modular Monolith khác Microservices ở đâu?
2. Vì sao dự án **một người** không nên làm microservices?
3. **Ranh giới module được enforce bằng cái gì** trong NestJS? (câu khó nhất)

Cộng thêm 4 câu về CI & test ở cuối
[`tech-playbook.md` §Xuyên suốt](tech-playbook.md) — phần anh tự nhận còn yếu.

> **Đây là cổng, không phải thủ tục.** Luật số 3 của dự án: chưa trả lời được câu hỏi bản
> chất → chưa qua phase. Trả lời lí nhí thì quay lại đọc, đừng tick bừa.

**Xong khi:** trả lời được cả 3 câu không nhìn code, và câu 3 nói được **cơ chế cụ thể**
(không phải "nhờ chia thư mục").

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

**Xong khi:** `/phase-status` báo Phase 1, và không còn ô trống nào ở trên.

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
| ✅ Bộ công cụ Claude: 10 skill · 7 lệnh · 8 hook · 1 agent · MCP | [`claude-guide.md`](claude-guide.md) |
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
2. **Trả lời được 3 câu hỏi bản chất** không nhìn code (việc 4)
3. **Mọi quyết định hạ tầng đều giải thích được** — bằng chứng là ADR (việc 3) + journal (việc 5)

Điều kiện 3 mới là tiêu chí thật của phase này. Code chạy chỉ là điều kiện cần: đây là phần
nền, sai ở đây thì 6 phase sau phải chịu.
