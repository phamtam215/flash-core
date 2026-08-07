# Mục lục tài liệu Flash-Core

> **Điểm vào của cả dự án là [`README.md`](../README.md) ở thư mục gốc**, không phải file này.
> File này chỉ là mục lục: mỗi tài liệu **sở hữu** thông tin gì, và khi nào thì mở nó.

## Nguyên tắc: mỗi thông tin có đúng một chủ

Để tài liệu không lệch nhau, mỗi loại thông tin chỉ được **định nghĩa ở một file**; các file
khác chỉ được **trỏ link tới**, không chép lại.

| Thông tin | Chủ sở hữu duy nhất | Ai được trỏ tới |
|---|---|---|
| Dự án là gì, chạy thế nào | [`README.md`](../README.md) (gốc repo) | mọi nơi |
| **Trạng thái hiện tại + việc còn nợ** | [`CLAUDE.md`](../CLAUDE.md) §Trạng thái hiện tại | README, spec |
| Kế hoạch 7 phase + Definition of Done | [`SPEC.md`](SPEC.md) | README |
| Code nằm ở đâu, sửa X thì mở file nào | [`architecture.md`](architecture.md) | README |
| **Vì sao** chọn thế này, đã loại bỏ gì | [`../project-context.md`](../project-context.md) §3 + [`adr/`](adr/) | mọi nơi |
| Chi tiết một tính năng (API, edge case, test) | [`specs/<tên>.md`](specs/) | — |
| Tên gọi của các bài toán | [`glossary.md`](glossary.md) | — |
| **Cơ chế / bug / tình huống thật của từng phase**, và **CI + Testing** (xuyên suốt) | [`tech-playbook.md`](tech-playbook.md) | glossary |
| Cách dùng Claude Code trong repo | [`claude-guide.md`](claude-guide.md) | CLAUDE.md (chỉ tóm tắt) |
| Chuẩn commit, quy tắc nhánh | [`git-workflow.md`](git-workflow.md) | — |
| Checklist review code | [`review-checklist.md`](review-checklist.md) | — |

Ngoại lệ có chủ đích: `CLAUDE.md` giữ **bản tóm tắt** bộ công cụ và convention dù
`claude-guide.md` mới là bản đầy đủ — vì `CLAUDE.md` được nạp tự động mỗi phiên, Claude cần
thấy ngay mà không phải mở thêm file. Giữ phần tóm tắt đó **ngắn**; chi tiết luôn ở file chủ.

## Mở file nào khi nào

| Thời điểm | File |
|---|---|
| Lần đầu vào dự án | [`README.md`](../README.md) → [`architecture.md`](architecture.md) |
| Muốn biết đang đứng ở đâu, làm gì tiếp | gõ `/phase-status` (báo cáo động, không bao giờ lệch) |
| Trước khi bắt đầu một phase | [`glossary.md`](glossary.md) (nhận diện tên) → [`tech-playbook.md`](tech-playbook.md) (cơ chế + bẫy) → [`SPEC.md`](SPEC.md) |
| Đang va một bug lạ | [`tech-playbook.md`](tech-playbook.md) — bảng "Bug hay gặp" của phase đó |
| **CI đỏ**, hoặc muốn hiểu test được tổ chức thế nào | [`tech-playbook.md` §Xuyên suốt](tech-playbook.md) — CI & Testing (xuyên suốt mọi phase) |
| Không biết sửa file nào | [`architecture.md`](architecture.md) |
| Trước khi code một tính năng | gõ `/spec <tên>` → tạo file trong [`specs/`](specs/) |
| Khi phải chọn giữa hai cách làm | gõ `/adr <chủ đề>` → tạo file trong [`adr/`](adr/) |
| Sau khi Claude viết code | [`review-checklist.md`](review-checklist.md) |
| Khi tạo commit | gõ `/commit` (chuẩn ở [`git-workflow.md`](git-workflow.md)) |
| Cuối mỗi phase | gõ `/journal <N>` → ghi vào [`journal/`](journal/) |
| Muốn kiểm tra mình có thật sự hiểu | gõ `/quiz` |
| Trước khi đi phỏng vấn | [`glossary.md`](glossary.md) §12 câu tự kiểm tra + [`adr/`](adr/) + [`journal/`](journal/) |

## Thư mục

```
docs/
├── README.md              ← mục lục này
├── architecture.md        bản đồ code
├── SPEC.md                kế hoạch 7 phase + Definition of Done
├── spec-report.html       bản trình bày trực quan của SPEC (mở bằng browser)
├── glossary.md            từ điển: TÊN của các bài toán (nhận diện, 1 dòng/mục)
├── tech-playbook.md       cơ chế + bug hay gặp + tình huống thật (theo phase, + CI & Testing)
├── git-workflow.md        chuẩn commit, quy tắc nhánh, AI không tự push
├── review-checklist.md    checklist review code
├── claude-guide.md        dùng lệnh/skill/hook/agent nào khi nào
├── mcp-setup.md           MCP nào bật ở phase nào
├── templates/             khuôn cho spec tính năng & ADR
├── specs/                 spec chi tiết từng tính năng   (thêm dần)
├── adr/                   quyết định kiến trúc            (thêm dần)
└── journal/               nhật ký học tập cuối phase      (thêm dần)
```

## Ba nguyên tắc không được phá

1. **Không có spec → không code.** Tính năng mới phải có file trong `specs/`.
2. **AI commit, nhưng không push trước khi Tâm review.** (có hook chặn `git push`)
3. **Chưa trả lời được "câu hỏi bản chất" của phase → chưa qua phase.** (dùng `/quiz`)
