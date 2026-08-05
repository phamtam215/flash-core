# Bộ tài liệu Flash-Core — Đọc file này trước

## Cài vào repo
Giải nén toàn bộ nội dung vào **thư mục gốc của repo**. Kết quả:

```
<repo>/
├── CLAUDE.md                     ← Claude Code tự đọc mỗi phiên
├── .claude/commands/commit.md    ← slash command /commit
├── gitignore.example             ← MERGE tay vào .gitignore của bạn, đừng ghi đè
└── docs/
    ├── README.md                 ← file này
    ├── SPEC.md                   ← spec gốc: 7 phase, DoD
    ├── spec-report.html          ← bản trình bày trực quan của SPEC (mở bằng browser)
    ├── glossary.md               ← từ điển khái niệm, đọc trước khi vào phase
    ├── git-workflow.md           ← chuẩn commit + quy tắc AI không tự push
    ├── review-checklist.md       ← dùng mỗi lần review code AI
    ├── templates/                ← template spec tính năng & ADR
    ├── specs/                    ← spec chi tiết từng tính năng (bạn sẽ thêm dần)
    ├── adr/                      ← các quyết định kiến trúc (bạn sẽ thêm dần)
    └── journal/                  ← nhật ký học tập cuối mỗi phase
```

> ⚠️ `gitignore.example` được đặt tên như vậy để **không ghi đè** `.gitignore` sẵn có
> của bạn. Hãy mở ra và copy các dòng còn thiếu sang. Bắt buộc phải có `.env`.

## Dùng file nào khi nào

| Thời điểm | File |
|---|---|
| Trước khi bắt đầu một phase | `docs/glossary.md` (bảng của phase đó) + `docs/SPEC.md` |
| Trước khi code một tính năng | Viết spec mới theo `docs/templates/feature-spec-template.md` → lưu vào `docs/specs/` |
| Khi ra quyết định kiến trúc | `docs/templates/adr-template.md` → lưu vào `docs/adr/` |
| Sau khi AI viết code | `docs/review-checklist.md` |
| Khi tạo commit | gõ `/commit` trong Claude Code (chuẩn ở `docs/git-workflow.md`) |
| Cuối mỗi phase | Viết `docs/journal/phase-N.md` + trả lời câu hỏi bản chất |
| Trước khi đi phỏng vấn | `docs/glossary.md` mục "12 câu hỏi tự kiểm tra" + `docs/adr/` |

## Câu lệnh đầu tiên với Claude Code
Mở Claude Code tại thư mục repo và gõ:

> Đọc `CLAUDE.md` và `docs/SPEC.md`. Bắt đầu **Phase 0**: draft spec cho phần nền
> móng (Docker Compose Postgres+Redis, NestJS skeleton, Prisma, CI GitHub Actions)
> theo `docs/templates/feature-spec-template.md`, lưu vào `docs/specs/`.
> **Chưa code, chờ tôi duyệt spec trước.**

## Ba nguyên tắc không được phá
1. **Không có spec → không code.**
2. **AI commit, nhưng không push trước khi tôi review.**
3. **Chưa trả lời được "câu hỏi bản chất" của phase → chưa qua phase.**
