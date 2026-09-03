# Review Checklist — dùng cho MỌI code do AI viết

> Quy tắc vàng: **không merge code mà mình không giải thích lại được luồng chạy.**

## Đúng nghiệp vụ
- [ ] Khớp spec trong `docs/specs/`? Tất cả test case trong spec đều có test và pass?
- [ ] Edge cases trong spec được xử lý thật (không chỉ TODO)?

## Transaction & Concurrency
- [ ] Transaction boundary hẹp nhất có thể? Không gọi API ngoài / gửi email trong transaction?
- [ ] Race condition: chuyện gì xảy ra nếu 2 request chạy song song qua đoạn này?
- [ ] Idempotency-Key được check đúng chỗ (trước khi tạo side effect)?

Bổ sung sau Phase 3 — mỗi dòng là một bug đã gặp thật hoặc đã phải nghĩ kỹ để tránh:
- [ ] Điều kiện tồn kho nằm **trong câu ghi** (`UPDATE … WHERE stock >= ?`), không phải `if`
      trong RAM rồi mới ghi?
- [ ] `UPDATE` ghi **0 dòng** thì có tách được "không tồn tại" (404) khỏi "hết hàng" (409)? Gộp
      hai ca này lại là gốc của bug "retry 3 lần cho SKU đã hết hàng".
- [ ] Hết hàng trả **409**, không phải 500? (trộn 4xx với 5xx làm error rate benchmark vô nghĩa)
- [ ] Chỉ retry lỗi **serialization failure / deadlock**, KHÔNG retry trạng thái nghiệp vụ?
- [ ] `SELECT … FOR UPDATE` có nằm trong `$transaction` interactive? (ngoài transaction thì khoá
      nhả ngay khi câu lệnh xong → vô tác dụng, và bug này im lặng)
- [ ] Trừ kho xong mà bước sau thất bại (trùng Idempotency-Key, ghi DB lỗi) thì có **hoàn kho**?
- [ ] Nhánh hai kho dữ liệu lệch nhau (Redis vs DB) có **log rõ**, không im lặng sửa số?
- [ ] Test song song đo đúng thứ cần đo, hay đang đo chính bộ tạo tải? (xem
      `docs/tech-playbook.md` §Xuyên suốt → Testing)

## Lỗi & độ bền
- [ ] Không có catch nuốt lỗi? Lỗi được phân loại (4xx vs 5xx) hợp lý?
- [ ] Job queue: retry được cấu hình? Job fail hết retry đi về đâu (DLQ)?
- [ ] Nếu process chết ngay TẠI dòng này thì hệ thống ở trạng thái gì? Phục hồi được không?

## Hiệu năng
- [ ] Có N+1 query không? Query trong vòng lặp?
- [ ] Index tồn tại cho các cột trong WHERE/ORDER BY của query nóng?

## Bảo mật & log
- [ ] Input được validate bằng Zod ở biên? Không tin dữ liệu client (giá, tồn kho)?
- [ ] Log đủ để debug (correlationId) nhưng không lộ password/token?
- [ ] Secret không hardcode?

## Đọc lại phần "vì sao" (làm cuối cùng)
- [ ] Claude đã tóm tắt **luồng chạy 5–10 câu** cho thay đổi này chưa? Đọc lại, chỗ nào thấy
      lạ thì hỏi — **hỏi là được, không cần tự trả lời**.
- [ ] Quyết định nào trong diff này mà sáu tháng sau sẽ không ai nhớ lý do? Nếu có → viết ADR.

> Trước đây mục này bắt tự kể lại luồng chạy không nhìn code. Đã bỏ (2026-08-07): việc đó
> biến mỗi lần review thành một bài thi.
