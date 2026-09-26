# ADR-017: Hai môi trường (dev/prod) và phân quyền theo mô hình của hệ thống công ty

- **Ngày:** 2026-09-26
- **Trạng thái:** Đã chốt (Tâm yêu cầu: "muốn học cấu trúc của công ty đang dùng"). Cấu hình
  xong trong repo, **chưa dựng thật trên GCP**.

## Bối cảnh

Đến ADR-016, hướng dẫn deploy viết cho **một người**: một project, Tâm là Owner duy nhất,
deploy tự chạy khi `main` xanh. Phân quyền chỉ có ở phía máy (service account tối thiểu), chưa
có gì cho người thứ hai.

Mẫu để học là hệ thống OfficeCube đang chạy thật ở công ty (khảo sát chỉ-đọc repo `officecube`
ngày 2026-09-26: Terragrunt ở `infra/provision`, Cloud Build ở `infra/pipeline`).

## Quyết định

### Bê nguyên từ công ty

| Mẫu của công ty | Ở Flash-Core |
|---|---|
| **Mỗi môi trường một GCP project** (dev, prod), không có staging | `flash-core-dev` và `flash-core-prod` |
| Đặt tên `<env>-<app>-<thứ>` | `flash-core-runtime`, `github-deployer` — tên project đã mang `<env>` nên tên bên trong giữ ngắn |
| **Deploy bằng git tag**: `v*-dev` → dev, `v*-prod` → prod | Y hệt: `v1.2.0-dev`, `v1.2.0-prod` |
| **Mỗi pipeline một SA riêng**, `serviceAccountUser` chỉ trên đúng một runtime SA | `github-deployer` mỗi project; `serviceAccountUser` cấp trên `flash-core-runtime`, không cấp cả project |
| **Runtime SA riêng**, không dùng SA mặc định của Compute | `flash-core-runtime` thay `<number>-compute@` |
| **Secret cấp quyền theo từng secret**, không cấp cả project | `secretAccessor` gắn lên từng secret trong 6 cái |
| Terraform chạy bằng cách *mượn* deployer SA thay vì người giữ quyền rộng | Người không giữ `run.admin` ở prod — chỉ CI giữ |

### Làm tốt hơn — vá đúng ba lỗ của công ty

1. **Công ty: đẩy tag là lên prod, không ai duyệt.** Flash-Core: GitHub Environment
   `production` có **Required reviewers** — job deploy dừng chờ bấm duyệt.
2. **Công ty: danh sách người được mượn SA là một cá nhân (bus factor 1), quyền người không nằm
   trong code.** Flash-Core: người nhận quyền qua **Google Group**, và bảng quyền người được
   ghi trong hướng dẫn deploy §18 — thêm người là thêm vào group, không sửa IAM.
3. **Công ty: không có CODEOWNERS, không khoá tag.** Flash-Core: `.github/CODEOWNERS` cho
   `deploy.yml`, migration và `src/infra/`; ruleset khoá tag `v*-prod`.

### Cố ý KHÔNG bê

| Công ty dùng | Không dùng vì |
|---|---|
| **Terraform + Terragrunt** | Spec Phase 7 §Vì sao không dùng IaC đã chốt; thêm công cụ mới phải qua ADR riêng. Cái giá: dựng dev và prod là **làm tay hai lần** theo cùng một hướng dẫn — đúng loại lệch mà IaC sinh ra để chặn |
| **Cloud Build** | Đã có GitHub Actions + WIF ([ADR-014](014-workload-identity-federation.md)); đổi CI không làm phân quyền tốt hơn |
| **IAP + External Load Balancer** | App công ty là nội bộ; Flash-Core là demo công khai. LB tốn ~$18/tháng chỉ riêng forwarding rule. Hệ quả: **dev cũng công khai** — chấp nhận vì dev chỉ có dữ liệu demo |
| **VM + OS Login + SSH qua IAP** | Không có VM |
| **Deployer SA ngang Owner** | Đó là lỗ, không phải mẫu: `github-deployer` giữ đúng 5 role |

## Hệ quả & trade-off chấp nhận

**Được:** một thay đổi đi qua dev trước khi chạm prod; prod cần một cú bấm duyệt có chủ ý; thêm
người không phải chạm IAM; runtime SA chỉ đọc được đúng secret của nó.

**Mất:**

- **Tiền gấp đôi phần Cloud SQL**: project dev có instance riêng, ~$9/tháng nữa (ADR-016). Cộng
  hai môi trường ~$18/tháng credit. Cloud Run, Scheduler, Artifact Registry tính free tier theo
  **tài khoản billing**, nên hai project dùng chung một phần miễn phí: Secret Manager thành 12
  version (free 6) ⇒ vài xu; Artifact Registry có thể vượt 0,5 GB ⇒ vài xu.
- **Deploy không còn tự chạy khi `main` xanh** — phải gắn tag. Chậm hơn một bước, đổi lại biết
  chính xác phiên bản nào đang ở đâu (`git tag --list 'v*-prod'`).
- **Làm một mình thì CODEOWNERS chưa ép được gì**: GitHub không cho tự duyệt PR của mình, nên
  bật "Require review from Code Owners" là tự khoá tay. File vẫn có để khi có người thứ hai chỉ
  cần bật một ô. Tương tự, *Required reviewers* cho phép tự duyệt (bỏ tick *Prevent
  self-review*) — lúc một người, nó là một cú bấm "tôi chắc chứ?" chứ chưa phải bốn mắt.
- **Dựng tay hai project** dễ lệch nhau. Dấu hiệu: một lỗi chỉ xảy ra ở prod mà dev không có.

## Điều gì khiến quyết định này sai

- **Có người thứ hai thật sự vào dự án** ⇒ bật "Require review from Code Owners", bật *Prevent
  self-review* ở environment `production`. Nếu hai project bắt đầu lệch cấu hình ⇒ lúc đó mới
  đáng viết ADR cho Terraform.
- **Credit hết và chỉ còn một người** ⇒ xoá project dev (tiết kiệm ~$9/tháng), giữ nguyên luồng
  tag + duyệt cho prod.

## Liên quan

[ADR-014](014-workload-identity-federation.md) (WIF — giờ mỗi project một bộ) ·
[ADR-016](016-cloud-sql-thay-neon.md) (Cloud SQL) ·
[hướng dẫn deploy §18](../huong-dan-deploy-gcp.md) ·
[`deploy.yml`](../../.github/workflows/deploy.yml) · [`CODEOWNERS`](../../.github/CODEOWNERS)
