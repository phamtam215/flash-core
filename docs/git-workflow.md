# Git Workflow — Flash-Core

> Mục tiêu: git history của repo này phải **tự kể được câu chuyện phát triển dự án**.
> Người tuyển dụng đọc `git log` là hiểu được tư duy, không chỉ đọc code cuối cùng.

## 1. Nhánh
- `main` — luôn xanh (CI pass). Không commit trực tiếp.
- `phase-N/<tên-tính-năng>` — nhánh làm việc, ví dụ `phase-3/optimistic-locking`.
- Xong tính năng → PR vào `main`, tự review, merge (squash nếu commit lộn xộn).

## 2. Commit message — Conventional Commits
```
<type>(<scope>): <mô tả ngắn, thể mệnh lệnh, < 50 ký tự>

<thân: VÌ SAO làm thế này, không phải LÀM GÌ — code đã nói "làm gì" rồi>
<trade-off đã chấp nhận, nếu có>

Refs: docs/specs/<file>.md, ADR-<số>
```
**Types:** `feat` (tính năng mới) · `fix` (sửa lỗi) · `refactor` · `test` · `docs` ·
`perf` (cải thiện hiệu năng) · `chore` (cấu hình, CI, deps)

**Scope:** tên module — `auth`, `product`, `order`, `queue`, `payment`, `obs`, `infra`, `fe`

### Ví dụ tốt (chuẩn của dự án này)
```
feat(order): thêm optimistic locking cho trừ tồn kho SKU

Dùng cột version trên bảng inventory, update kèm điều kiện version
để phát hiện xung đột, retry tối đa 3 lần với backoff nhẹ.

Chọn optimistic thay pessimistic ở bước này vì muốn đo baseline
throughput khi chưa có lock chờ nhau — sẽ so sánh với FOR UPDATE
ở commit sau. Trade-off: dưới tranh chấp gắt tỷ lệ retry sẽ cao,
đo bằng k6 ở Phase 3.

Refs: docs/specs/order-create.md, ADR-004
```

### Ví dụ tệ (cấm)
```
update code
fix bug
feat: thêm nhiều thứ
```

## 3. Nguyên tắc commit
- **Một commit = một ý.** Đổi 3 việc khác nhau → 3 commit.
- **Commit phải xanh:** không commit code làm test fail (trừ commit `test:` cố tình
  thêm test đỏ trước khi implement — ghi rõ trong thân).
- **Không commit secret.** `.env` phải nằm trong `.gitignore` ngay commit đầu tiên.
- **Không push khi test chưa pass local.** CI chỉ là lưới an toàn cuối.

## 4. Quy tắc dành cho AI (Claude Code)
1. **AI được commit, nhưng KHÔNG được push trước khi Tâm review.**
   Luồng chuẩn: AI code → AI chạy test → AI commit → **Tâm review theo
   `docs/review-checklist.md`** → Tâm ra lệnh push.
2. Mỗi commit AI tạo phải có **thân giải thích vì sao**, và tham chiếu spec/ADR liên quan.
3. Trước khi mở PR, AI viết **PR description** gồm: tính năng gì, các quyết định chính,
   test nào đã thêm, phần nào cần Tâm chú ý khi review.
4. Nếu một thay đổi lớn hơn phạm vi spec → dừng, hỏi Tâm, đề xuất ADR. Không tự mở rộng.
5. Giữ **Co-Authored-By** minh bạch nếu Tâm muốn — xem mục 6.

## 5. Đóng phase — cập nhật đúng ba chỗ, không thêm file
Kết thúc một phase, tạo commit `docs:` sửa **đúng ba chỗ**, mỗi chỗ có một chủ rõ ràng:

| Chỗ | Ghi gì |
|---|---|
| `CLAUDE.md` §Trạng thái hiện tại | phase đã xong, còn nợ gì — **chủ sở hữu duy nhất của trạng thái** |
| `docs/specs/phaseN-*.md` §Bằng chứng DoD | số test, số đo, cấu hình để chạy lại |
| `docs/tech-playbook.md` §Phase N | **kiến thức mới**: cơ chế vừa hiểu ra, bug thật đã va, con số đo được và vì sao nó như vậy |

> Trước đây repo có thêm `docs/journal/phase-N.md`; đã bỏ vì nó chép lại trạng thái từ spec và
> chỉ tồn tại cho 2 trong 4 phase — đúng kiểu phân tán mà tài liệu dự án này muốn tránh. Nội
> dung đáng giữ (bug thật, số đo, "nếu làm lại") giờ nằm ở playbook; lịch sử vẫn còn trong
> `git log -- docs/journal/`.

## 6. Minh bạch về việc dùng AI
Có hai lựa chọn, Tâm chọn một và ghi vào ADR-001:
- **(a) Giữ `Co-Authored-By: Claude`** trong commit — minh bạch tuyệt đối.
- **(b) Không ghi trong commit, nhưng nói rõ trong README** rằng dự án được phát
  triển theo quy trình AI-assisted (spec-driven, human review), kèm link
  `docs/review-checklist.md` và `docs/adr/`.

**Khuyến nghị: chọn (b), hoặc (a)+(b).** Che giấu là rủi ro lớn nhất — bị phát hiện
thì mất uy tín; còn chủ động trình bày quy trình kiểm soát AI thì đó là **năng lực
đáng giá năm 2026**, không phải điểm yếu. Điều Tâm cần bảo vệ không phải là "tôi tự
gõ từng dòng", mà là **"tôi hiểu và chịu trách nhiệm cho từng dòng"** — bằng chứng
là ADR, test, benchmark và nhật ký học tập.

## 7. Vài lệnh hay dùng khi review code AI
```bash
git log --oneline --graph          # xem lịch sử gọn
git show <hash>                    # xem 1 commit làm gì
git diff main...HEAD               # xem toàn bộ thay đổi của nhánh
git diff --staged                  # xem đúng thứ sắp commit
git log -S "SELECT FOR UPDATE"     # tìm commit nào đưa đoạn code này vào
```
