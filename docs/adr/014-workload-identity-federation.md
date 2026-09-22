# ADR-014: CI xác thực với GCP bằng Workload Identity Federation, không dùng key JSON

- **Ngày:** 2026-09-22
- **Trạng thái:** Đã chốt (workflow xong, **chưa dựng WIF thật** — cần console GCP)

## Bối cảnh

`deploy.yml` phải đẩy ảnh vào Artifact Registry, chạy Cloud Run Job, và deploy service. Tức
là GitHub Actions cần một danh tính GCP có quyền thật.

Cách phổ biến nhất trên mạng: tạo **service account key JSON**, dán vào GitHub Secrets.

## Quyết định

**Workload Identity Federation.** GitHub Actions đổi **OIDC token của chính nó** lấy access
token ngắn hạn của GCP. Không tạo key JSON nào.

Service account deploy giữ đúng **4 role**: `run.admin`, `artifactregistry.writer`,
`iam.serviceAccountUser`, `secretmanager.secretAccessor`.

## Vì sao không dùng key JSON

Key JSON là **bí mật dài hạn**, và ba tính chất của nó đều xấu:

1. **Không hết hạn.** Rò một lần là rò mãi, cho tới khi có người nhớ ra và xoay khoá.
2. **Không biết đã rò.** Nó nằm trong GitHub Secrets, trong log build nếu ai đó lỡ `echo`,
   trong máy của người từng tải về để thử. Không có tín hiệu nào báo nó đang bị dùng ở nơi khác.
3. **Không gắn với ngữ cảnh.** Ai cầm file đó đều dùng được, từ bất cứ đâu.

WIF bỏ cả ba: token sống vài phút, và **gắn với đúng repo + đúng nhánh** — token lấy được từ
một repo khác không dùng được ở đây.

| Cách | Bí mật dài hạn? | Phải xoay khoá? | Chi phí |
|---|---|---|---|
| **WIF** ⭐ | Không | Không | 0đ |
| Service account key JSON | Có | Có, định kỳ, và thủ công | 0đ |
| Tự dựng runner trong VPC | Không | Không | Tốn tiền, và thêm một máy phải vá |

## Luật đi kèm: `deploy.yml` là file nhạy cảm nhất repo

Hệ quả ít người nói ra: **ai sửa được workflow thì điều khiển được service account.** Thêm một
dòng vào `deploy.yml` là chạy được lệnh bất kỳ dưới danh nghĩa 4 role kia.

Nên hai thứ sau phải được coi ngang nhau: *quyền sửa IAM* và *quyền merge vào `main`*. Với
repo một người thì nó chỉ là một dòng ghi nhớ; với repo nhiều người thì nó là lý do phải bật
branch protection và **review bắt buộc cho riêng thư mục `.github/`**.

(Bài học rút từ hạ tầng OfficeCube, nơi service account deploy mang gần 20 role admin — ở đó
kết luận cũng y hệt: bảo vệ quyền sửa trigger CI còn quan trọng hơn bảo vệ chính service
account.)

## Hệ quả

**Được:** không có bí mật dài hạn nào để lộ — và đây là câu trả lời gọn nhất cho câu hỏi
"bảo mật CI/CD của em thế nào" khi phỏng vấn.

**Mất:**

- **Dựng lần đầu phức tạp hơn nhiều** so với dán một file JSON: phải tạo Workload Identity
  Pool, provider, điều kiện lọc theo repo, rồi gắn quyền `workloadIdentityUser`. Là việc làm
  **một lần**, nhưng dễ sai và thông báo lỗi khó đọc.
- **Không chạy deploy từ máy local bằng cùng danh tính được** — muốn thử tay thì phải
  `gcloud auth login` bằng tài khoản người. Đúng ra là tốt: deploy chỉ đi qua một đường.
- Phụ thuộc vào OIDC issuer của GitHub. Đổi nhà cung cấp CI thì phải dựng lại phần này.

## Liên quan

[spec Phase 7 §CI/CD](../specs/phase7-deploy-gcp.md) ·
[`.github/workflows/deploy.yml`](../../.github/workflows/deploy.yml)
