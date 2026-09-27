# setup-cloud — hộp thư đến cho ảnh chụp Console

Thả ảnh chụp màn hình GCP vào đây, rồi bảo Claude cập nhật tài liệu.

**Thư mục này KHÔNG vào git** (xem `.gitignore`). Ảnh được dùng trong tài liệu sẽ được
**chuyển** sang `docs/html/assets/img/deploy/` với tên theo quy ước, và bản gốc ở đây có thể
xoá bất cứ lúc nào.

Vì sao không để ảnh ở đây luôn: `docs/html/` là thư mục đọc-bằng-trình-duyệt duy nhất của dự
án. Hai nơi chứa ảnh nghĩa là một ngày nào đó tài liệu trỏ vào nơi đã bị xoá.

## Quy ước tên ở `docs/html/assets/img/deploy/`

| Tiền tố | Màn hình |
|---|---|
| `budget-*` | Billing → Budgets & alerts |
| `ar-*` | Artifact Registry |
| `sql-*` | Cloud SQL |
| `sa-*` | IAM → Service accounts |
| `wif-*` | Workload Identity Federation |
| `cred-*` | APIs & Services → Credentials |

## Trước khi gửi ảnh — che ba thứ này

- Địa chỉ email
- **Project ID** và **Project number**
- Chuỗi kết nối, khoá, token

Ảnh trong `docs/` đi vào git và đi theo repo ra ngoài.
