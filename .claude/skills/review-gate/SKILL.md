---
name: review-gate
description: >
  Tự review code vừa viết theo docs/review-checklist.md, chạy test lấy số thật, rồi tóm
  tắt luồng chạy 5–10 câu tiếng Việt và đặt câu hỏi ngược cho Tâm. Dùng skill này TRƯỚC
  KHI báo "đã xong / đã hoàn thành" bất kỳ tính năng nào, và khi Tâm nói "review",
  "check lại", "xong chưa", "tự kiểm tra đi", "chuẩn bị commit", "mở PR". Đây là cổng
  bắt buộc giữa implement và commit — bỏ qua nó là bỏ đúng phần Tâm học được nhiều nhất.
---

# Cổng tự review trước khi báo xong

`CLAUDE.md` định nghĩa "xong" khác với "code chạy được": một tính năng chỉ xong khi Tâm
**giải thích lại được luồng chạy**. Skill này chuẩn bị nguyên liệu cho việc đó, và bắt
chính mình đi qua `docs/review-checklist.md` với thái độ của người sẽ bị hỏi lại.

Nguyên tắc bao trùm: **không tick suông**. Mỗi ý trong checklist trả lời kèm bằng chứng
(`file.ts:42`) hoặc thẳng thắn ghi "chưa xử lý — lý do / đã ghi nợ ở đâu". Một checklist
toàn dấu tick là checklist vô dụng.

## Bước 1 — Xem đúng thứ mình đã đổi

```bash
git status --short
git diff            # thay đổi chưa stage
git diff --staged   # thứ sắp commit
```

Đọc lại diff như người review, không như người viết. Nếu diff vượt phạm vi spec đang
làm → đó là phát hiện đầu tiên phải báo, không phải bỏ qua.

## Bước 2 — Chạy checklist theo 5 nhóm của `docs/review-checklist.md`

Đọc file đó và đi từng nhóm. Dưới đây là cách tự chất vấn cho từng nhóm, không phải
danh sách thay thế:

**Đúng nghiệp vụ** — Mở spec trong `docs/specs/` ra đối chiếu từng dòng "Test cases phải
pass": test nào tồn tại, tên ở đâu, pass hay không. Edge case nào chỉ có `TODO` thì nói
rõ là chưa làm.

**Transaction & Concurrency** — Chỉ ra đúng dòng mở/đóng transaction. Trong đó có gọi
HTTP/gửi mail/đẩy queue không? Nếu 2 request đi song song qua đoạn này, chuyện gì xảy
ra — trả lời bằng cơ chế (lock nào, điều kiện nào ở DB), không bằng "đã xử lý".
`Idempotency-Key` được check **trước** khi tạo side effect chứ không phải sau?

**Lỗi & độ bền** — Tìm `catch` rỗng hoặc `catch` chỉ log rồi đi tiếp. Lỗi 4xx/5xx phân
loại đúng chưa (lỗi client gửi giá sai là 4xx, DB chết là 5xx)? Job có retry + DLQ? Và
câu quan trọng nhất: **process chết ngay tại dòng này thì hệ thống ở trạng thái gì,
phục hồi bằng cách nào?** — trả lời cho ít nhất 2 điểm nguy hiểm nhất trong diff.

**Hiệu năng** — Có query trong vòng lặp (N+1)? Các cột trong `WHERE`/`ORDER BY` của
query nóng đã có index chưa — kiểm tra bằng `EXPLAIN`, không phải bằng niềm tin (xem
skill `db-postgres-performance`).

**Bảo mật & log** — Input validate bằng Zod ở biên? Có chỗ nào tin dữ liệu client cho
giá/tồn kho? Log có `correlationId` và **không** chứa password/token/số thẻ? Secret
không hardcode?

## Bước 3 — Chạy test, báo số thật

```bash
npm test -- --coverage   # hoặc lệnh test tương ứng của repo
```

Báo con số thật (bao nhiêu pass/fail, coverage module core bao nhiêu %). **Nếu có test
fail: dừng ở đây**, báo lỗi, không đi tiếp sang bước tóm tắt như thể đã xong. Không sửa
test cho pass — sửa code (xem skill `test-contract`).

Nếu tính năng thuộc phần concurrency, kiểm tra đã có ít nhất một test bắn song song
trên DB thật (Testcontainers), không chỉ unit test mock.

## Bước 4 — Tóm tắt luồng chạy 5–10 câu tiếng Việt

Đây là deliverable bắt buộc theo `CLAUDE.md` §Quy trình 4. Viết như đang kể cho người
không đọc code:

- Bắt đầu từ request vào ở đâu, đi qua những lớp nào, dữ liệu bị biến đổi thế nào.
- Nói rõ **transaction mở/đóng ở câu nào** và **điểm nào là critical section**.
- Nói rõ chỗ nào là ranh giới async (đẩy queue, delayed job) và ai xử lý tiếp.
- Dùng đúng thuật ngữ trong `docs/glossary.md` (lost update, at-least-once, compensating
  transaction...) để Tâm quen dần từ vựng chuẩn.
- Không dán code vào phần này.

## Bước 5 — Ba thứ phải nói với Tâm

1. **Phần cần Tâm chú ý khi review** — 2–3 điểm rủi ro nhất trong diff, kèm `file:line`.
   Không viết "mọi thứ đều ổn".
2. **Nợ kỹ thuật đã cố tình chấp nhận** — thứ gì làm nhanh, đơn giản hóa, hoặc bỏ qua,
   và nó sẽ vỡ ở đâu nếu tải tăng. `docs/glossary.md` gọi đây là technical debt: được
   phép có, không được phép im lặng.
3. **2–3 câu hỏi ngược cho Tâm** — kiểm tra Tâm hiểu, chứ không kiểm tra Tâm đồng ý.
   Kiểu câu tốt: *"đoạn `order.service.ts:88`, nếu Redis trừ kho xong rồi process chết
   trước khi ghi DB thì tồn kho lệch bao nhiêu và ai sửa lại?"*. Kiểu câu vô dụng:
   *"anh thấy ổn không?"*.

Kết thúc bằng trạng thái rõ ràng, ví dụ: *"Test 24/24 pass, coverage order 78%. Chưa
commit. Anh review theo `docs/review-checklist.md` rồi em `/commit`."*

## Điều không được làm ở skill này

- Không `git push` (luật cứng của dự án — hook `guard_git_push.py` cũng sẽ chặn).
- Không tự kết luận "đã đạt Definition of Done" — DoD nằm ở `docs/SPEC.md` §7 và do Tâm
  đánh dấu.
- Không thay Tâm trả lời "câu hỏi bản chất" của phase (việc đó thuộc `/quiz` và
  skill `phase-journal`).
