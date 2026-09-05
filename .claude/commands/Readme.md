---
description: Tạo commit gọn theo chuẩn Conventional Commits, kèm bảng tổng hợp đã làm gì
---

Tạo git commit. **Làm nhanh, đừng dài dòng.**

## 4 bước

1. `git status` + `git diff` — đọc thay đổi.
2. `npm run check`. **Fail thì dừng**, báo lỗi, không commit.
3. Kiểm tra không có secret / `.env` lọt vào diff.
4. Stage đúng file rồi commit. **Một commit là đủ** — chỉ tách khi thật sự có hai việc
   không liên quan gì nhau, và tách thì tự quyết, đừng hỏi tôi.

## Message — tối đa 8 dòng

```
<type>(<scope>): <mô tả mệnh lệnh, dưới 50 ký tự>

<2–4 dòng: vì sao làm thế này, đánh đổi gì nếu có>

Refs: <file spec hoặc ADR liên quan, bỏ qua nếu không có>
```

Tiếng Việt. **Không viết lại "đã làm gì"** — `git diff` nói rồi. Chỉ viết cái diff không
nói được: vì sao.

## Sau khi commit — đúng ba phần này, không thêm

**1. Bảng tổng hợp đã làm gì**

| Việc | File |
|---|---|
| ... | ... |

**2. Tài liệu đã cập nhật chưa** — nếu thay đổi làm lệch tài liệu nào thì **sửa luôn trong
cùng commit**, đừng để nợ. Ba chỗ hay lệch: `docs/architecture.md` (thêm/xoá file trong
`src/`), `docs/phase-0-checklist.md` (xong một việc), `CLAUDE.md` §Trạng thái hiện tại.
Nếu không có gì lệch thì ghi một dòng: *"Tài liệu không đổi."*

**3. Một dòng cuối:** *"Đã commit, sẵn sàng push khi anh review xong."*

## Cấm

- **Không `git push`** — chỉ Tâm push, sau khi review.
- Không viết tóm tắt luồng chạy 5–10 câu, không nêu "điểm cần đọc kỹ", không hỏi ngược.
  Muốn những thứ đó thì Tâm sẽ tự hỏi.
