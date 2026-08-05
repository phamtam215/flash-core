---
name: feature-spec
description: >
  Draft spec chi tiết cho một tính năng Flash-Core vào docs/specs/ theo
  docs/templates/feature-spec-template.md, RỒI DỪNG chờ Tâm duyệt — không code.
  Dùng skill này bất cứ khi nào Tâm yêu cầu làm/implement/code/thêm một tính năng,
  endpoint, module, job, hoặc luồng nghiệp vụ mới (ví dụ "làm API săn hàng", "code
  phần auth", "thêm outbox", "làm màn hình đơn của tôi"), KỂ CẢ KHI TÂM KHÔNG NHẮC
  CHỮ "SPEC" — vì luật số 1 của dự án là "không có spec → không code". Cũng dùng khi
  cần sửa/mở rộng spec đã có, khi Tâm hỏi "tính năng này có spec chưa", hoặc khi phát
  hiện mình đang định viết code cho thứ chưa có file spec tương ứng.
---

# Viết spec tính năng (cổng số 1 của dự án)

Spec ở dự án này không phải thủ tục giấy tờ. Nó là **nơi Tâm ra quyết định trước khi
AI viết code** — nếu bỏ bước này, Tâm mất đúng phần giá trị học tập của dự án và chỉ
còn lại một repo do AI generate. Vì vậy nhiệm vụ khi dùng skill này là *làm cho Tâm
phải quyết*, không phải viết cho đầy template.

## Bước 0 — Kiểm tra đã có spec chưa

```bash
ls docs/specs/
```

- Đã có file khớp tính năng → đọc nó, hỏi Tâm: sửa spec cũ hay viết spec mới?
- Chưa có → tiếp tục. **Không được vừa viết spec vừa code trong cùng một lượt.**

## Bước 1 — Nạp bối cảnh trước khi viết

Đọc theo đúng thứ tự này, vì mỗi file trả lời một câu khác nhau:

| File | Trả lời câu gì |
|---|---|
| `docs/SPEC.md` (mục phase tương ứng) | Deliverable và "câu hỏi bản chất" của phase → spec phải dẫn tới đó |
| `docs/glossary.md` (bảng của phase đó) | Tên chuẩn của các bài toán sẽ gặp → dùng đúng từ vựng trong spec |
| `project-context.md` §3 | **Những gì đã bị loại bỏ có chủ đích** → không được đề xuất lại |
| `docs/specs/` các spec liền trước | Ranh giới module, thứ gì đã tồn tại để tái dùng |

Nếu tính năng nằm ngoài 7 phase trong SPEC.md → dừng, hỏi Tâm, và đề nghị ADR thay vì
tự mở rộng phạm vi dự án.

## Bước 2 — Đặt tên file

`docs/specs/phase<N>-<ten-tinh-nang-kebab>.md`

Ví dụ: `phase1-auth-refresh-rotation.md`, `phase3-order-create.md`,
`phase4-payment-webhook.md`. Số phase trong tên để sau này đọc `ls` là thấy được lộ trình.

## Bước 3 — Điền template, tập trung vào 3 mục dễ làm hời hợt

Dùng nguyên khung `docs/templates/feature-spec-template.md`. Bốn mục đầu (Mục tiêu /
API / Luồng xử lý / Non-goals) thường dễ. Ba mục dưới đây là nơi spec sống hay chết:

### "Edge cases bắt buộc xử lý"

Đừng bịa edge case chung chung. Rà theo loại tính năng — bảng mồi:

| Loại tính năng | Edge case phải cân nhắc |
|---|---|
| **API ghi (POST/PUT)** | Gọi 2 lần cùng `Idempotency-Key`; gọi 2 lần khác key nhưng cùng ý định; body thiếu field; client gửi giá/tồn kho tự bịa (không được tin) |
| **Trừ tồn kho / đặt hàng** | N request song song cùng 1 SKU; tồn kho vừa hết đúng lúc; user bấm 2 lần; process chết sau khi trừ kho trước khi tạo đơn |
| **Job / queue** | Job chạy 2 lần (at-least-once); job fail hết retry đi đâu (DLQ); worker bị kill giữa job; job chạy trên dữ liệu đã bị đổi trạng thái |
| **Webhook** | Chữ ký sai/thiếu; webhook trùng (cùng event id); webhook đến **sau khi** đơn đã tự hủy; webhook đến trước khi đơn kịp ghi DB |
| **API đọc / danh sách** | Dữ liệu 100k dòng; trang cuối; cursor không hợp lệ hoặc trỏ vào dòng đã xóa; N+1 query |
| **Auth** | Token hết hạn; refresh token bị đánh cắp và dùng lại; brute-force login; đăng nhập song song nhiều thiết bị |
| **Bất kỳ** | Câu hỏi vàng: **"nếu process chết ngay tại dòng này thì hệ thống ở trạng thái gì, có phục hồi được không?"** |

Mỗi edge case viết dạng checkbox và **nói rõ hành vi mong đợi**, không chỉ nêu tên
tình huống. "Gọi 2 lần cùng Idempotency-Key" là chưa đủ; phải là "gọi 2 lần cùng
`Idempotency-Key` → trả về đúng đơn đã tạo lần đầu, HTTP 200, không tạo đơn thứ hai,
không trừ kho lần hai".

### "Test cases phải pass"

Đây là **hợp đồng** giữa spec và code (xem skill `test-contract`). Quy tắc:

- Mỗi edge case ở trên phải có ít nhất một test tương ứng — đánh số để test trong code
  tham chiếu lại được (`// spec: phase3-order-create.md #4`).
- Ghi rõ test nào là **integration test trên DB/Redis thật** (concurrency, transaction,
  queue) vì loại lỗi đó không hiện ra khi mock.
- Với case concurrency, ghi rõ con số: "bắn 200 request song song vào SKU còn 100 →
  đúng 100 đơn `PENDING`, tồn kho = 0, không có giá trị âm, không có đơn thứ 101".

### "Câu hỏi mở cho Tâm quyết"

Mục quan trọng nhất của skill này. Nếu mục này trống thì gần như chắc chắn spec đang
lặng lẽ ra quyết định thay Tâm. Rà lại toàn spec và tự hỏi: chỗ nào mình vừa **chọn**
một cách làm mà cách khác cũng hợp lý? Đưa lên đây dưới dạng:

```
- [ ] <Câu hỏi>. Lựa chọn A: ... (được/mất). Lựa chọn B: ... (được/mất).
      Khuyến nghị của Claude: A, vì ...
```

Nếu câu hỏi đó là quyết định kiến trúc dài hạn → nói rõ "câu này nên thành ADR" và
dùng skill `adr-writer` sau khi Tâm chốt.

## Bước 4 — Dừng lại

Trạng thái spec để **`Draft`**. Sau khi ghi file, báo Tâm đúng ba thứ:

1. Đường dẫn file spec.
2. Các câu hỏi mở đang chờ Tâm quyết (liệt kê ngắn, không copy cả spec).
3. Câu chốt: *"Chưa code. Chờ anh duyệt spec (hoặc trả lời các câu hỏi mở) rồi em mới
   implement."*

**Không** tạo file trong `src/`, **không** cài package, **không** chạy migration ở
lượt này. Nếu Tâm nói "làm luôn đi, khỏi spec" — vẫn viết spec (nó nhanh, 1 file), nêu
lý do đúng một câu (`docs/README.md` §"Ba nguyên tắc không được phá"), rồi để Tâm quyết.

## Sau khi Tâm duyệt

Đổi trạng thái spec sang `Đã duyệt`, rồi mới implement. Khi implement xong, đổi sang
`Đã implement` và chạy skill `review-gate` trước khi báo hoàn thành.
