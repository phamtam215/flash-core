# Dùng Claude Code trong repo này

> **File này dành cho Tâm** — hướng dẫn thực dụng: khi nào gõ lệnh gì, skill nào tự chạy
> lúc nào, hook nào chặn cái gì.
>
> Nguyên tắc thiết kế của bộ này: `CLAUDE.md` nói *luật*, thư mục `.claude/` **thi hành**
> luật đó. Luật chỉ nằm trong văn bản sẽ bị bỏ qua vào đúng lúc gấp; luật có hook thì không.

## Bản đồ 30 giây

```
.claude/
├── settings.json        đăng ký hook + statusline + permissions
├── commands/    (7)     lệnh Tâm gõ tay:  /spec /adr /review-gate /commit
│                                          /journal /quiz /phase-status
├── skills/      (10)    Claude TỰ dùng khi gặp việc tương ứng — không cần gõ
├── hooks/       (9)     script python3 chạy tự động quanh mỗi tool call
├── agents/      (1)     code-reviewer — reviewer độc lập, chỉ đọc không sửa
└── statusline.sh        phase · nhánh · số file đổi · spec/ADR
.mcp.json                Context7 (tra tài liệu đúng phiên bản thư viện)
```

Cần Python 3 (macOS có sẵn). Không phải cài gì thêm.

---

## 1. Bảy lệnh — khi nào gõ cái nào

| Gõ | Khi nào | Nó làm gì |
|---|---|---|
| `/spec <tên tính năng>` | **Bắt đầu** một tính năng mới | Draft spec vào `docs/specs/` theo template rồi **DỪNG** chờ Tâm duyệt. Không code. |
| `/adr <chủ đề>` | Phải chọn giữa hai cách làm | Viết ADR ở trạng thái *Đề xuất*, ép nêu ≥2 lựa chọn thật + **mất gì** + **khi nào xem lại** |
| `/review-gate` | Trước khi commit | Đi hết `docs/review-checklist.md` kèm `file:line`, chạy test báo **số thật**, tóm tắt luồng chạy 5–10 câu, nêu nợ kỹ thuật, hỏi ngược |
| `/commit` | Tạo commit | Commit theo Conventional Commits + thân giải thích **vì sao**. Không push. |
| `/quiz [chủ đề]` | Muốn biết mình có thật sự hiểu | Claude đóng vai người phỏng vấn: **một câu mỗi lượt**, không giải thích trước, sai thì nói thẳng là sai |
| `/phase-status` | Không rõ đang đứng ở đâu | Tiến độ vs `SPEC.md` §7, số spec/ADR, việc treo, câu hỏi bản chất chưa trả lời |
| `/journal <N>` | Kết thúc một phase | Dựng lịch sử phase từ `git log`, rồi **phỏng vấn Tâm** về câu hỏi bản chất và ghi lại **bằng lời của Tâm** |

**Lệnh dễ quên nhất mà đáng dùng nhất là `/quiz`** — nó là thứ duy nhất trong cả bộ kiểm tra
*Tâm* chứ không kiểm tra code. Dùng nó sau mỗi tính năng khó, đừng để tới cuối phase.

## 2. Mười skill — Claude tự chọn, không cần gõ

Skill là hướng dẫn chuyên môn Claude tự nạp khi ngữ cảnh khớp. Muốn gọi thẳng thì nói
*"dùng skill concurrency-oversell"*.

### Nhóm quy trình

| Skill | Tự chạy khi | Nội dung |
|---|---|---|
| `feature-spec` | Tâm nói "làm/code/implement tính năng X" — **kể cả khi không nhắc chữ spec** | Bảng mồi edge case theo loại tính năng (API ghi / trừ kho / job / webhook / API đọc / auth). Ép mục "Câu hỏi mở cho Tâm quyết" không được trống |
| `adr-writer` | "chọn A hay B", hoặc Claude phát hiện mình đang ngầm quyết định thay Tâm | Cấp số ADR, chống lựa chọn bù nhìn, ép nêu điều kiện xem lại |
| `review-gate` | Trước khi báo "xong" | Không tick suông — mỗi ý kèm bằng chứng hoặc ghi thẳng "chưa xử lý" |
| `phase-journal` | "xong phase N" | **Không trả lời hộ** câu hỏi bản chất. Chỗ Tâm chưa trả lời được thì ghi `⚠️` |

### Nhóm học tập

| Skill | Tự chạy khi | Nội dung |
|---|---|---|
| `essence-explainer` | Tâm hỏi "vì sao", "khác nhau thế nào", hỏi thuật ngữ trong glossary | Khung 5 phần: tên bài toán theo glossary → cơ chế cụ thể đến mức "ai chờ ai ở bước nào" → trade-off và **khi nào cách này sai** → mỏ neo `file:line` → câu hỏi ngược. Cấm "vì đó là best practice" |

### Nhóm kỹ thuật

| Skill | Phase | Nội dung |
|---|---|---|
| `nestjs-module` | mọi phase | Cấu trúc module, ranh giới qua `index.ts` + injection token, DTO Zod, Idempotency-Key, tiền số nguyên VND, transaction boundary |
| `db-postgres-performance` | 2 | Đọc `EXPLAIN (ANALYZE, BUFFERS)`, B-tree vs GIN, keyset pagination, N+1, `ANALYZE` sau seed, **khi nào JSONB là lựa chọn tệ** |
| `concurrency-oversell` ⭐ | 3 | 3 chiến lược sau một interface, Idempotency-Key đúng chỗ, cách **chứng minh** oversell = 0. Kèm 2 file tham chiếu: `strategies.md` (SQL/Lua, deadlock, reconcile) và `k6-benchmark.md` (kịch bản k6, đọc p95, 3 kết luận sai kinh điển) |
| `queue-payment-reliability` | 4 | Dual write → Outbox + `SKIP LOCKED`, at-least-once → consumer idempotent, backoff + jitter, DLQ, state machine đơn, webhook: raw body → HMAC `timingSafeEqual` → chống replay → idempotent, **case webhook đến sau khi đơn đã hủy** |
| `test-contract` | xuyên suốt | Nối test 1:1 với spec, unit vs integration, Testcontainers, pattern test 200 request song song, chống flaky, **bẫy coverage** |

## 3. Chín hook — cái gì chạy lúc nào

| Khi nào | Hook | Hành vi |
|---|---|---|
| **Đầu mỗi phiên** | `session_context` | Nạp: phase hiện tại, nhánh, số file đổi, số spec/ADR/journal, 3 commit gần nhất, việc treo, 3 luật, danh sách lệnh |
| **Trước mỗi lệnh Bash** | `guard_git_push` | 🔴 **CHẶN** mọi `git push` (trừ `--dry-run`). Chỉ Tâm push, sau khi review |
| | `guard_commit_message` | 🔴 **CHẶN** nếu dòng đầu sai Conventional Commits hoặc dài > 72 ký tự.<br>🟡 **HỎI** nếu thiếu thân giải thích vì sao |
| | `guard_cloud_cost` | 🔴 **CHẶN** `k6 run` / seed / `migrate reset` / `TRUNCATE` khi biến kết nối trỏ ra `neon.tech`, `upstash.io`, `run.app`… |
| | `guard_new_dependency` | 🔴 **CHẶN** package đã bị loại có chủ đích (kafkajs, typeorm, class-validator, bcrypt, mysql2…) kèm số quyết định.<br>🟡 **HỎI** với package lạ |
| **Trước Write/Edit** | `guard_secret_files` | 🔴 **CHẶN** ghi vào `.env`, `*.pem`.<br>🟡 **HỎI** khi thấy giá trị secret trông như thật trong source |
| **Sau Write/Edit** | `format_after_edit` | Chạy prettier của repo. Nếu prettier không parse được → báo (dấu hiệu lỗi syntax) |
| **Sau `git commit`** | `post_commit_reminder` | Nhắc: **không push**, nhắc tóm tắt luồng chạy, nhắc nêu điểm rủi ro cần Tâm đọc kỹ |
| *(đã tắt)* | `stop_review_gate` | Chặn lượt dừng đầu tiên khi `src/` có thay đổi chưa review. **Tắt vì quá chặt** — muốn bật lại thì thêm lại mục `"Stop"` vào `settings.json` |

Mọi hook **fail-open**: gặp lỗi lạ, JSON không parse được → cho chạy tiếp. Hook không bao
giờ được làm nghẽn công việc.

Không hook nào in ra secret: `guard_cloud_cost` chỉ in *tên host* đã khớp,
`guard_secret_files` chỉ in độ dài giá trị.

### Khi bị hook chặn

Đọc lý do — nó luôn nói rõ luật nào và ở file nào. Rồi làm theo đề xuất trong đó. **Đừng tìm
cách lách** (alias, script trung gian): nếu Tâm thật sự muốn làm việc bị chặn, sửa hoặc tắt
hook một cách tường minh, để lần sau còn biết là đã tắt.

### Tắt / sửa hook

```bash
# Tắt một hook: xoá mục tương ứng trong .claude/settings.json (file .py vẫn còn để bật lại)
# Tắt toàn bộ hook: thêm "disableAllHooks": true vào .claude/settings.json

# Tự thử một hook:
echo '{"tool_name":"Bash","tool_input":{"command":"git push"}}' \
  | python3 .claude/hooks/guard_git_push.py
# rỗng = cho qua · có JSON "deny" = chặn
```

## 4. Agent `code-reviewer`

Reviewer độc lập, **chỉ đọc không sửa**. Giá trị của nó là không có context của người viết
code — người viết luôn đọc lại bằng ý định của mình chứ không bằng thứ thật sự trên màn hình.

Gọi khi: diff lớn, hoặc diff chạm phần nguy hiểm (trừ tồn kho, transaction, webhook, auth),
hoặc muốn lượt review thứ hai trước khi mở PR.

> "Dùng agent code-reviewer soi diff hiện tại."

Nó báo cáo theo mức nghiêm trọng, mỗi phát hiện kèm **tình huống vỡ cụ thể**, cộng mục "đã
kiểm tra và thấy ổn" để Tâm biết phạm vi review. Nó được yêu cầu **không bịa góp ý cho có**.

## 5. MCP

Chỉ **Context7** bật sẵn: tra tài liệu đúng phiên bản của NestJS / Prisma / BullMQ / Zod.
Đáng bật vì stack này đổi API nhanh và mạng đầy tài liệu cũ — Prisma 7 vừa bỏ
`datasource.url` là ví dụ sống.

Dùng: *"tra tài liệu Prisma về `$transaction` interactive (dùng context7) rồi mới viết code."*

Postgres MCP để dành Phase 2, Playwright MCP để dành Phase 3.
Redis / GitHub / Docker MCP đã cân nhắc và **cố tình không thêm** (`redis-cli` và `gh` đủ rồi).
Chi tiết: [`docs/mcp-setup.md`](mcp-setup.md).

---

## 6. Một tính năng đi qua cả bộ công cụ

```
/spec "API săn hàng — trừ tồn kho theo SKU"
    skill feature-spec → docs/specs/phase3-order-create.md → DỪNG
    Tâm đọc, trả lời "Câu hỏi mở", duyệt
        ↓
"Implement theo spec vừa duyệt"
    skill nestjs-module          cấu trúc, Zod, ranh giới module
    skill concurrency-oversell   chiến lược lock, idempotency
    skill test-contract          test 1:1 với spec, Testcontainers
    hook guard_new_dependency    HỎI nếu cần package lạ
    hook format_after_edit       giữ diff sạch để review được
        ↓
/review-gate
    checklist + file:line · test số thật · luồng chạy 5–10 câu · câu hỏi ngược
        ↓  (diff lớn hoặc nguy hiểm)
"dùng agent code-reviewer"
        ↓
/commit
    hook guard_commit_message    kiểm format + thân "vì sao"
    hook post_commit_reminder    nhắc KHÔNG push
        ↓
Tâm review theo docs/review-checklist.md → Tâm tự `git push`
    (hook guard_git_push chặn nếu Claude thử push)
        ↓
/quiz            bị kiểm tra ngược về phần vừa làm
/phase-status    còn thiếu gì so với Definition of Done
/journal 3       cuối phase: phỏng vấn + nhật ký học tập
```

## 7. Bảo trì bộ công cụ

- **Skill làm sai cùng một kiểu lần thứ hai** → sửa skill. Không được kích hoạt → sửa
  `description`. Kích hoạt nhưng làm sai → sửa thân skill.
- **Thêm skill mới** chỉ khi có loại việc lặp lại mà hướng dẫn hiện có không bao được. Skill
  không bao giờ được dùng còn tệ hơn không có — nó vẫn tốn context mỗi phiên.
- **Sau mỗi phase, tự hỏi:** hook nào chưa bao giờ chặn gì? skill nào chưa bao giờ được
  dùng? Nếu có, hoặc luật đó không thật, hoặc `description` viết chưa đúng.
- Bộ này là **iteration 1, chưa qua đo** (chưa chạy eval so sánh có-skill vs không-skill).
  Cứ dùng thật rồi sửa theo cái vướng — đó là cách hiệu quả hơn tối ưu trước.
