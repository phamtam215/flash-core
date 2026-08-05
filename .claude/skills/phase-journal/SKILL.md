---
name: phase-journal
description: >
  Viết nhật ký học tập cuối phase vào docs/journal/phase-N.md, phỏng vấn Tâm để chính
  Tâm trả lời các "câu hỏi bản chất" của phase (KHÔNG trả lời hộ), rồi cập nhật mục
  "Trạng thái hiện tại" trong CLAUDE.md. Dùng skill này khi Tâm nói "xong phase N",
  "kết thúc phase", "viết journal", "tổng kết phase", "chuyển sang phase tiếp theo",
  hoặc khi thấy deliverable của phase hiện tại trong docs/SPEC.md đã hoàn thành hết.
  Đây là cổng chuyển phase: chưa trả lời được câu hỏi bản chất thì chưa qua phase.
---

# Nhật ký học tập cuối phase

`docs/git-workflow.md` §5 gọi đây là "điểm khác biệt của repo này": thứ khiến repo trông
như dự án của người đang tư duy, không phải bản generate một lần. Nó cũng là kho nguyên
liệu trả lời phỏng vấn.

**Luật quan trọng nhất của skill này: phần "câu hỏi bản chất" phải là lời của Tâm, không
phải lời của Claude.** Nếu AI viết hộ, file journal vẫn đẹp nhưng dự án mất đúng mục tiêu
số 1 (`project-context.md` §2). Vai của Claude ở đây là **người phỏng vấn và người chép
biên bản**, không phải người trả lời.

## Bước 1 — Thu thập dữ kiện từ repo (Claude làm)

Đây là phần AI làm tốt: dựng lại lịch sử phase từ chính repo.

```bash
git log --oneline --graph --since="<ngày bắt đầu phase>"
git log --format="%ad %s" --date=short | head -50   # để suy ra mốc thời gian
git log --oneline --grep="^fix" --grep="^test" -E   # nơi chứa các lần va vấn đề
git diff --stat <commit-đầu-phase>..HEAD
ls docs/specs/ docs/adr/
```

Rút ra:
- **Đã build gì** — theo spec nào trong `docs/specs/`, ADR nào đã chốt.
- **Mất bao lâu** — từ ngày commit đầu tới commit cuối của phase, kèm số buổi ước lượng.
- **Đã va vào vấn đề gì** — đọc các commit `fix:`/`test:` và thân commit. Đây là mục giá
  trị nhất: deadlock thật, flaky test thật, oversell lọt thật, migration fail thật.
  Nếu phase trôi qua mà không va vấn đề nào, hãy nói thẳng điều đó ra — có thể là dấu
  hiệu test còn quá nhẹ.
- **Số đo** — coverage, kết quả `EXPLAIN ANALYZE`, kết quả k6 (nếu có). Trích số thật.

## Bước 2 — Phỏng vấn Tâm về "câu hỏi bản chất" (bắt buộc, không bỏ)

Lấy đúng các câu hỏi bản chất của phase từ `docs/SPEC.md`. Ví dụ Phase 3 có: *"Vì sao
read→if→write chắc chắn oversell dưới tải cao?"*, *"Isolation level mặc định của Postgres
và anomaly nó cho phép?"*, *"Redis chết sau khi trừ kho nhưng trước khi ghi DB thì sao?"*.

Cách chạy:

1. Hỏi **một câu mỗi lượt**. Không đưa cả danh sách rồi tự trả lời cả danh sách.
2. Đợi Tâm trả lời. Không gợi ý đáp án trước khi Tâm nói.
3. Chấm câu trả lời thật lòng, theo ba mức và nói rõ mức nào:
   - **Đủ** — nêu được cơ chế bên dưới, không chỉ kết luận.
   - **Thiếu cơ chế** — kết luận đúng nhưng chưa giải thích được vì sao (ví dụ biết
     "phải dùng lock" nhưng không nói được lock chặn ai ở bước nào). Chỉ ra chỗ trống,
     hỏi tiếp một câu đào sâu.
   - **Sai** — nói thẳng là sai và sai ở đâu. **Không được gật cho êm.** Hiểu sai được
     ghi vào journal thì sẽ theo Tâm tới buổi phỏng vấn.
4. Ghi vào journal **nguyên văn ý của Tâm** (biên tập câu cho gọn được, nhưng không thay
   nội dung, không thay bằng cách diễn đạt của Claude). Chỗ nào Tâm chưa trả lời được
   thì ghi thẳng: `⚠️ Chưa trả lời được — cần đọc lại: <mục cụ thể trong glossary/tài liệu>`.

Nếu Tâm nói "viết hộ đi cho nhanh": làm rõ một câu rằng mục này là thứ duy nhất trong
repo không thể outsource, đề nghị hỏi rút gọn 2–3 câu quan trọng nhất, rồi để Tâm quyết.

## Bước 3 — Ghi file `docs/journal/phase-N.md`

Dùng đúng khung này (theo `docs/git-workflow.md` §5, đã bổ sung mục số đo và mục tiếp theo):

```markdown
# Nhật ký Phase N — <tên phase>

- **Thời gian:** <ngày bắt đầu> → <ngày kết thúc> (~<số> buổi)
- **Spec liên quan:** docs/specs/...
- **ADR đã chốt:** ADR-00x, ADR-00y

## Đã build gì
<gạch đầu dòng, ngắn>

## Số đo (bằng chứng cho CV)
<coverage, EXPLAIN trước/sau, k6 p95 & throughput, oversell = 0 ...>

## Đã va vào vấn đề gì và sửa thế nào
### <Tên vấn đề theo glossary, ví dụ: Deadlock khi khóa 2 SKU ngược thứ tự>
- Triệu chứng:
- Nguyên nhân thật:
- Cách sửa:
- Bài học:

## Câu hỏi bản chất — trả lời bằng lời của Tâm
**Hỏi:** <câu hỏi từ SPEC.md>
**Tâm trả lời:** <nguyên văn ý của Tâm>
**Nhận xét của Claude:** <đủ / thiếu cơ chế ở chỗ nào / sai ở đâu>

## Nếu làm lại sẽ làm khác
<lời của Tâm>

## Nợ kỹ thuật mang sang phase sau
<liệt kê, có chủ đích>
```

## Bước 4 — Cập nhật trạng thái dự án

1. `CLAUDE.md` → mục **"Trạng thái hiện tại"**: đổi phase hiện tại, ghi một dòng những
   gì đã xong. (`CLAUDE.md` yêu cầu cập nhật mục này mỗi khi hoàn thành một phase.)
2. `docs/SPEC.md` §7 Definition of Done: đánh dấu ô nào đã đạt — **chỉ ô nào có bằng
   chứng thật**, và để Tâm xác nhận trước khi tick.
3. Commit riêng bằng `/commit`, kiểu `docs(journal): tổng kết phase N`.

## Bước 5 — Cổng chuyển phase

Trước khi bắt đầu phase sau, nói rõ với Tâm trạng thái cổng:

- Còn câu hỏi bản chất nào đang `⚠️ Chưa trả lời được` → nêu ra và đề nghị đọc mục nào
  trong `docs/glossary.md` trước khi sang phase mới. `docs/README.md` §"Ba nguyên tắc
  không được phá" số 3: *chưa trả lời được câu hỏi bản chất của phase → chưa qua phase.*
- Nhắc luôn 12 câu hỏi tự kiểm tra cuối `docs/glossary.md`: câu nào thuộc phase vừa xong
  thì thử ngay bằng `/quiz`.
