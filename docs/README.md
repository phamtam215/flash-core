# Mục lục tài liệu Flash-Core

> **Điểm vào của cả dự án là [`README.md`](../README.md) ở thư mục gốc**, không phải file này.
> File này chỉ trả lời hai câu: **thông tin nào thuộc file nào**, và **khi nào mở file nào**.

## Luật một chủ sở hữu

Mỗi loại thông tin được **định nghĩa ở đúng một file**. File khác chỉ được **trỏ link**, không
chép lại. Đây là luật khiến tài liệu không lệch nhau khi code đổi.

| Thông tin | Chủ sở hữu duy nhất |
|---|---|
| Dự án là gì, chạy thế nào | [`README.md`](../README.md) (gốc repo) |
| **Thứ tự học** cho người mới: học gì trước, phá cái gì để thấy | [`onboarding.md`](onboarding.md) |
| **Đang ở phase nào, còn nợ gì** | [`CLAUDE.md`](../CLAUDE.md) §Trạng thái hiện tại |
| Kế hoạch 8 phase + Definition of Done | [`SPEC.md`](SPEC.md) |
| Code nằm ở đâu, sửa X thì mở file nào | [`architecture.md`](architecture.md) |
| **Kiến thức**: cơ chế, bug thật, số đo, đáp án câu hỏi bản chất, ôn phỏng vấn | [`tech-playbook.md`](tech-playbook.md) |
| **Vì sao chọn thế này**, đã loại bỏ gì | [`adr/`](adr/) + [`../project-context.md`](../project-context.md) §3 |
| **Hợp đồng** một tính năng: API, schema, edge case, test case, bằng chứng DoD | [`specs/`](specs/) |
| **Tên gọi** của các bài toán (1 dòng/mục) | [`glossary.md`](glossary.md) |
| Chuẩn commit, quy tắc nhánh, cách đóng phase | [`git-workflow.md`](git-workflow.md) |
| Checklist review code | [`review-checklist.md`](review-checklist.md) |
| Bản HTML đọc offline (`html/index.html`) | sinh từ chính các `.md` ở đây bằng `npm run docs:html` |

Ba ranh giới hay bị vi phạm nhất, ghi ra để tự kiểm khi sửa tài liệu:

1. **Spec không giữ kiến thức.** Spec nói *phải làm gì*; playbook nói *vì sao và hỏng ra sao*.
   Thấy mình viết một đoạn giải thích cơ chế trong spec → chuyển sang playbook, để lại một link.
2. **Chỉ `CLAUDE.md` giữ trạng thái.** Spec được giữ *bằng chứng* (số test, số đo, cấu hình để
   chạy lại), không giữ câu "đang làm dở đến đâu".
3. **Glossary không giải thích.** Dài hơn một dòng nghĩa là nó thuộc playbook.

## Mở file nào khi nào

| Thời điểm | File |
|---|---|
| **Lần đầu vào dự án** | [`onboarding.md`](onboarding.md) — lộ trình 6 buổi có thực hành, làm theo thứ tự |
| **"Giờ tôi cần làm gì?"** | [`../CLAUDE.md`](../CLAUDE.md) §Trạng thái hiện tại |
| Trước khi bắt đầu một phase | [`glossary.md`](glossary.md) (nhận tên, 20') → [`tech-playbook.md`](tech-playbook.md) §Phase N (cơ chế + bẫy, 15') → [`SPEC.md`](SPEC.md) |
| Trước khi code một tính năng | gõ `/spec <tên>` → tạo file trong [`specs/`](specs/) |
| Đang va một bug lạ | [`tech-playbook.md`](tech-playbook.md) — bảng *Bug hay gặp* của phase đó |
| **CI đỏ**, hoặc muốn hiểu test được tổ chức thế nào | [`tech-playbook.md` §Xuyên suốt — CI & Testing](tech-playbook.md) |
| Không biết sửa file nào | [`architecture.md`](architecture.md) |
| Khi phải chọn giữa hai cách làm | nói "viết ADR cho X" → tạo file trong [`adr/`](adr/) |
| Sau khi Claude viết code | [`review-checklist.md`](review-checklist.md) |
| Khi tạo commit / khi đóng phase | gõ `/commit` — chuẩn ở [`git-workflow.md`](git-workflow.md) §5 |
| Integration test báo không tìm thấy Docker | đặt `TEST_DATABASE_URL`/`TEST_REDIS_URL` — xem `test/infra-fixture.ts` |
| **Trước khi đi phỏng vấn** | [`tech-playbook.md` §Ôn phỏng vấn — 12 câu chốt](tech-playbook.md) → mục *Câu hỏi bản chất* của từng phase → [`adr/`](adr/) |

## Thư mục

```
docs/
├── README.md              ← mục lục này
├── SPEC.md                kế hoạch 8 phase + Definition of Done
├── onboarding.md          ★ LỘ TRÌNH CHO NGƯỜI MỚI — 6 buổi, có thực hành
├── architecture.md        bản đồ code
├── tech-playbook.md       ★ NGUỒN KIẾN THỨC DUY NHẤT (cơ chế · bug · số đo · ôn phỏng vấn)
├── glossary.md            từ điển: TÊN của các bài toán, 1 dòng/mục
├── git-workflow.md        chuẩn commit, quy tắc nhánh, cách đóng phase
├── review-checklist.md    checklist review code
├── phase-0-checklist.md   hồ sơ Phase 0 (đã đóng — không còn việc phải làm)
├── specs/                 hợp đồng từng tính năng + bằng chứng DoD
├── adr/                   quyết định kiến trúc
├── templates/             khuôn cho spec & ADR
└── html/                  bản đọc offline, sinh bằng `npm run docs:html`
```

## Ba nguyên tắc không được phá

1. **Không có spec → không code.** Tính năng mới phải có file trong `specs/`.
2. **AI commit, nhưng không push trước khi Tâm review.** (có hook chặn `git push`)
3. **Kiến thức mới chỉ được ghi vào `tech-playbook.md`.** Viết ở chỗ khác là bắt đầu phân tán lại.
