# ADR-009: Chống CSRF bằng double-submit cookie có ký HMAC

- **Ngày:** 2026-09-21
- **Trạng thái:** Đã chốt

## Bối cảnh

Access token nằm trong cookie `HttpOnly`, và browser **tự đính cookie vào mọi request** tới
domain — đó chính là thứ CSRF khai thác. Phase 1 dựa vào `SameSite=Strict` và ghi CSRF token
làm nợ.

`SameSite=Strict` **đang chặn được CSRF cổ điển**, và sau quyết định này nó vẫn là lớp phòng
thủ **chính**. Ba lý do vẫn thêm token:

1. `SameSite` **không** chặn kẻ tấn công **cùng site** — một subdomain bị chiếm gửi được
   request "same-site" kèm cookie. Theo định nghĩa của cờ, nó không bịt lỗ này.
2. `SameSite` là hành vi của **trình duyệt**, không phải của server. Trình duyệt cũ, WebView
   nhúng trong app, client không phải browser đều không bắt buộc tuân theo. Server đang tin
   vào thứ nó không kiểm soát.
3. Defense in depth: không để một cờ duy nhất, do bên thứ ba thực thi, là thứ duy nhất đứng
   giữa kẻ tấn công và việc đặt đơn thay người khác.

## Quyết định

**Double-submit cookie, token có ký HMAC-SHA256**, kiểm bằng guard ở tầng app.

- Cookie `csrf_token` = `<random 32 byte hex>.<hmac(random, CSRF_SECRET)>`, **không**
  `HttpOnly` (JS phải đọc được), `SameSite=Strict`, `Secure` theo `COOKIE_SECURE`.
- Client sao chép giá trị đó sang header `X-CSRF-Token`. Server so hai bên bằng
  `timingSafeEqual`, rồi verify chữ ký.
- Guard đăng ký bằng `APP_GUARD`; miễn method an toàn và đúng một đường dẫn:
  `POST /payments/webhook`.
- Lớp thứ ba: từ chối khi header `Origin` **có mặt** và khác host. Thiếu `Origin` thì bỏ qua.

## Vì sao không chọn cách khác

| Cách | Vì sao loại |
|---|---|
| **Synchronizer token** (lưu token theo session ở Redis) | Chắc hơn thật, nhưng thêm một round-trip Redis vào **mọi** request ghi — kể cả `POST /orders`, endpoint nóng nhất hệ thống mà cả Phase 3 dành để tối ưu. Trả giá ở đúng chỗ không nên trả |
| **Double-submit không ký** | Kẻ tấn công cùng site đặt được cookie sang domain chính, nên nó chỉ cần đặt `csrf_token=abc` rồi gửi `X-CSRF-Token: abc`. Mà đó đúng là kịch bản duy nhất khiến ta làm token (lý do #1 ở trên) ⇒ bản không ký **không thêm được gì** so với `SameSite` |
| **Chỉ kiểm `Referer`** | `Referer` bị proxy và extension lược bỏ khá thường xuyên ⇒ chặn nhầm người dùng thật. Dùng `Origin` làm lớp bổ sung thì được, làm lớp chính thì không |

## Hệ quả

**Được:**

- Không chạm Redis/DB — verify là một phép HMAC trong RAM.
- `CSRF_SECRET` xoay được an toàn: token cũ thành không hợp lệ, middleware phát lại ở request
  kế tiếp, **không ai bị đăng xuất**.
- Guard ở tầng app nên **fail-closed**: endpoint ghi mới được bảo vệ sẵn kể cả khi người thêm
  nó không nghĩ tới CSRF.

**Mất:**

- Thêm biến bắt buộc `CSRF_SECRET` — thiếu là app chết lúc khởi động.
- Gọi API bằng `curl` cần hai bước (`curl -c` lấy cookie trước).
- **83 chỗ gọi trong test phải đi qua một helper chung** (`test/http-helper.ts`). Đây là chi
  phí thật, và cũng là dấu hiệu tốt: nếu gắn tay từng chỗ thì một ngày nào đó có chỗ quên, rồi
  người ta "sửa" bằng cách miễn CSRF cho route đó.

**Điểm yếu còn lại, ghi ra chứ không giấu:** chữ ký **không ràng buộc vào phiên đăng nhập**.
Kẻ tấn công có tài khoản hợp lệ lấy token đã ký của chính nó rồi dùng cho nạn nhân vẫn lọt.
Bịt hẳn phải ký kèm `userId`, kéo theo phải phát lại token sau mỗi lần login/logout/refresh và
đồng bộ mọi tab đang mở — thêm một tầng cho một kịch bản cần kẻ tấn công **đã** có tài khoản
**và** đã dụ được nạn nhân. Ghi làm nợ ở
[spec CSRF §Câu hỏi mở #2](../specs/csrf-token.md).

**Chi tiết:** [spec CSRF](../specs/csrf-token.md) ·
[`src/common/csrf/`](../../src/common/csrf/) · [tech-playbook §Phase 1](../tech-playbook.md)
