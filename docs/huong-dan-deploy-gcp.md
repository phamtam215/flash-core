# Hướng dẫn deploy lên GCP — từ con số không

> **Dành cho người lần đầu deploy.** Mỗi bước có lệnh copy-dán được, và nói rõ *vì sao* bước
> đó tồn tại — để khi nó hỏng thì biết đường sửa, không phải đi hỏi lại từ đầu.
>
> **Giả định:** đã có tài khoản GCP với **$300 credit / 90 ngày**. Hướng dẫn này tận dụng
> credit đó, và §16 nói rõ phải đổi gì khi credit hết.
>
> Quyết định kiến trúc đứng sau mỗi lựa chọn: [ADR-012](adr/012-worker-tren-cloud-run.md)
> (worker) · [ADR-013](adr/013-pool-nho-tren-serverless.md) (pool) ·
> [ADR-014](adr/014-workload-identity-federation.md) (xác thực CI).
> Phép tính FinOps đầy đủ: [spec Phase 7](specs/phase7-deploy-gcp.md).

---

## 0. Bức tranh toàn cảnh — cái gì chạy ở đâu

```diagram
        GitHub                          Google Cloud Platform
   ┌──────────────┐              ┌────────────────────────────────┐
   │ repo + CI/CD │──── WIF ────►│ Artifact Registry (ảnh Docker) │
   │ deploy.yml   │   (không     │                                 │
   └──────────────┘   có key)    │ Cloud Run SERVICE  flash-core-api│◄── người dùng
                                 │   scale 0 → 2                   │
                                 │                                 │
                                 │ Cloud Run JOB  flash-core-worker│
                                 │   Scheduler gọi mỗi 5 phút      │
                                 │                                 │
                                 │ Secret Manager (6 bí mật)       │
                                 └───────┬──────────────┬──────────┘
                                         │              │
                                    ┌────▼────┐    ┌────▼─────┐
                                    │  Neon   │    │ Upstash  │
                                    │Postgres │    │  Redis   │
                                    └─────────┘    └──────────┘
```

### Bên thứ ba — liệt kê đầy đủ

| Dịch vụ | Dùng làm gì | Có tính vào $300 credit không | Gói dùng |
|---|---|---|---|
| **GCP Cloud Run** | Chạy API và worker | ✅ Có | Free tier + credit |
| **GCP Artifact Registry** | Lưu ảnh Docker | ✅ Có | 0,5 GB free |
| **GCP Secret Manager** | 6 bí mật runtime | ✅ Có | 6 version active free |
| **GCP Cloud Scheduler** | Gọi worker mỗi 5 phút | ✅ Có | 3 job free |
| **GCP Cloud Logging** | Log của app | ✅ Có | 50 GB/tháng free |
| **Neon** | PostgreSQL 16 | ❌ **Không** — bên thứ ba ngoài GCP | Free 0,5 GB |
| **Upstash** | Redis (queue + rate limit + tồn kho) | ❌ **Không** | Free 256 MB / 500k lệnh |
| **GitHub** | Repo + Actions chạy CI/CD | ❌ Không | Free (repo công khai hoặc cá nhân) |

> **Điểm dễ hiểu nhầm nhất:** $300 credit **chỉ tiêu được trong GCP**. Neon và Upstash là công
> ty khác, credit không đụng tới. Nên dù có credit, vẫn dùng gói free của hai bên đó — và
> chính vì vậy khi credit hết thì **không phải làm gì cả với chúng**.

**Không cần cho bản chạy được:** dịch vụ gửi email thật (Resend/Mailgun). Hiện `MAIL_SENDER`
là bản ghi-ra-log; luồng outbox vẫn chạy đủ và chứng minh được "không mất, không trùng", chỉ
là không có mail nào tới hộp thư. Muốn mail thật thì xem §17.

---

## 1. Việc ĐẦU TIÊN: đặt cảnh báo ngân sách

Làm trước cả khi tạo project. Lý do: mọi thứ sau đây đều có thể tạo ra chi phí, và **cách duy
nhất biết mình đang tiêu tiền là được báo** — bảng điều khiển thì phải tự nhớ mở.

1. Mở **Billing → Budgets & alerts → Create budget**
2. Đặt ngân sách **$1**, cảnh báo ở **50% / 90% / 100%**
3. Bật *"Email alerts to billing admins"*
4. **Gửi thử một cảnh báo và xác nhận email tới nơi** — một cảnh báo không ai nhận được thì
   không phải cảnh báo

> $1 chứ không phải $300: mục tiêu là biết **ngay khi bắt đầu tiêu**, không phải biết lúc sắp
> hết credit. Credit tiêu hết trong im lặng thì tháng sau hoá đơn thật mới tới.

---

## 2. Tạo project và bật API

```bash
# Cài gcloud nếu chưa có: https://cloud.google.com/sdk/docs/install
gcloud auth login

# Tên project phải DUY NHẤT toàn cầu — thêm hậu tố nếu bị trùng
export PROJECT_ID=flash-core-demo-$(date +%s | tail -c 5)
export REGION=us-central1

gcloud projects create "$PROJECT_ID"
gcloud config set project "$PROJECT_ID"

# Gắn project vào tài khoản thanh toán (lấy ID bằng: gcloud billing accounts list)
gcloud billing projects link "$PROJECT_ID" --billing-account=<BILLING_ACCOUNT_ID>

gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com \
  cloudscheduler.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com
```

> **`us-central1` không phải tuỳ tiện:** free tier của Cloud Run chỉ áp ở một số region, và
> đây là region dự án đã chốt. Đổi region thì phải đổi cả nơi đặt Artifact Registry (§3) —
> ảnh ở region khác nghĩa là mỗi lần deploy kéo ảnh xuyên vùng, chậm mà không ai để ý.

---

## 3. Artifact Registry + chính sách dọn ảnh

```bash
gcloud artifacts repositories create flash-core \
  --repository-format=docker --location="$REGION" \
  --description="Ảnh Docker của Flash-Core"
```

**Bật chính sách dọn ngay bây giờ**, đừng để sau:

```bash
cat > /tmp/cleanup.json <<'JSON'
[
  {
    "name": "giu-3-tag-moi-nhat",
    "action": {"type": "Keep"},
    "mostRecentVersions": {"keepCount": 3}
  },
  {
    "name": "xoa-anh-khong-tag-qua-7-ngay",
    "action": {"type": "Delete"},
    "condition": {"tagState": "untagged", "olderThan": "7d"}
  }
]
JSON

gcloud artifacts repositories set-cleanup-policies flash-core \
  --location="$REGION" --policy=/tmp/cleanup.json
```

> **Vì sao ngay bây giờ:** mỗi lần deploy đẩy một ảnh mới ~150–200 MB. Free tier là **0,5 GB**
> — tức là chạm trần sau khoảng ba lần deploy. Không có chính sách dọn thì đây là thứ đầu tiên
> phát sinh tiền, và nó phát sinh một cách âm thầm.

---

## 4. Neon (PostgreSQL)

1. Đăng ký tại **neon.tech** bằng email cá nhân
2. Tạo project, chọn region **AWS us-east-1** hoặc **us-east-2** (gần `us-central1` nhất)
3. Vào **Connection Details**, lấy **hai** chuỗi kết nối:

| Loại | Hình dạng | Dùng ở đâu |
|---|---|---|
| **Pooled** | `...-pooler.neon.tech/...` | **Runtime** của app |
| **Direct** | `...neon.tech/...` (không có `-pooler`) | **Chỉ** bước `prisma migrate deploy` |

> **Vì sao hai chuỗi, và vì sao không được dùng lẫn** ([ADR-013](adr/013-pool-nho-tren-serverless.md)):
> pooler là PgBouncer chạy *transaction pooling* — nó ghép nhiều kết nối ứng dụng vào ít kết
> nối thật, đúng thứ serverless cần. Nhưng Prisma khoá migration bằng **advisory lock ở mức
> session**, mà transaction pooling không giữ session ⇒ khoá đó vô hiệu và hai lần migrate
> chạy chồng được. Nên migrate **phải** đi đường direct.
>
> Thứ **không** mất qua pooler, hay bị hiểu nhầm: `SELECT ... FOR UPDATE` của chiến lược
> pessimistic **vẫn đúng**, vì nó nằm trọn trong một transaction. Pooler ảnh hưởng *sức chứa*,
> không ảnh hưởng *tính đúng đắn*.

4. Kiểm tra **autosuspend** đang bật (mặc định 5 phút idle). Đừng để thứ gì poll nó liên tục.

---

## 5. Upstash (Redis)

1. Đăng ký tại **upstash.com**
2. Tạo database, region **us-east-1** (cùng phía với Neon)
3. Lấy chuỗi `rediss://...` (chú ý **hai chữ s** — TLS)

> Gói free: **256 MB / 500.000 lệnh mỗi tháng**. Worker gọi mỗi 5 phút là ~8.600 lệnh/tháng
> chỉ để hỏi việc — còn rất nhiều chỗ, nhưng đây là hạn mức **chạm trần đầu tiên** nếu có
> traffic thật (xem [spec Phase 7](specs/phase7-deploy-gcp.md) §Bài toán #4).

---

## 6. Nạp 6 bí mật vào Secret Manager

```bash
# Sinh 4 khoá ngẫu nhiên
for NAME in JWT_ACCESS_SECRET JWT_REFRESH_SECRET PAYMENT_WEBHOOK_SECRET CSRF_SECRET; do
  openssl rand -hex 32 | gcloud secrets create "$NAME" --data-file=- --replication-policy=automatic
done

# Hai chuỗi kết nối — dán giá trị thật khi được hỏi, rồi Ctrl+D
gcloud secrets create DATABASE_URL --data-file=- --replication-policy=automatic
gcloud secrets create REDIS_URL    --data-file=- --replication-policy=automatic
```

`DATABASE_URL` dùng chuỗi **pooled** của Neon.

> **Free tier Secret Manager là 6 version *đang hoạt động*, và dự án có đúng 6 bí mật — vừa
> khít.** Nên mỗi lần xoay khoá phải **huỷ version cũ**, nếu không version thứ 7 bắt đầu tính
> tiền:
> ```bash
> gcloud secrets versions destroy <SỐ_VERSION> --secret=CSRF_SECRET
> ```
>
> **Xoay `CSRF_SECRET` an toàn** — token cũ thành không hợp lệ, middleware phát lại ở request
> kế tiếp, **không ai bị đăng xuất**. Xoay `JWT_*` thì mọi người phải đăng nhập lại.

---

## 7. Service account + Workload Identity Federation

Đây là bước rắc rối nhất. Làm **một lần**, và không bao giờ phải tạo file key JSON nào.

```bash
export REPO="<github-user>/<ten-repo>"      # ví dụ: phamtam215/flash-core
export PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

# 7.1 — service account cho CI, đúng 4 quyền
gcloud iam service-accounts create github-deployer --display-name="GitHub Actions deployer"
export SA="github-deployer@$PROJECT_ID.iam.gserviceaccount.com"

for ROLE in roles/run.admin roles/artifactregistry.writer \
            roles/iam.serviceAccountUser roles/secretmanager.secretAccessor; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="$ROLE"
done

# 7.2 — pool và provider cho GitHub OIDC
gcloud iam workload-identity-pools create github --location=global --display-name="GitHub"

gcloud iam workload-identity-pools providers create-oidc github-provider \
  --location=global --workload-identity-pool=github \
  --issuer-uri="https://token.actions.githubusercontent.com" \
  --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
  --attribute-condition="assertion.repository=='$REPO'"

# 7.3 — cho phép ĐÚNG repo này mượn service account
gcloud iam service-accounts add-iam-policy-binding "$SA" \
  --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"

# 7.4 — in ra giá trị cần dán vào GitHub
echo "GCP_WIF_PROVIDER = projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github-provider"
echo "GCP_SERVICE_ACCOUNT = $SA"
```

> **`--attribute-condition` là dòng quan trọng nhất trong cả bước này.** Thiếu nó thì *bất kỳ
> repo GitHub nào trên đời* cũng đổi được token của họ lấy quyền vào project của anh. Có nó
> thì chỉ đúng repo này.
>
> **Vì sao không dùng key JSON** ([ADR-014](adr/014-workload-identity-federation.md)): key
> JSON là bí mật **dài hạn** — không hết hạn, không biết đã rò, không gắn ngữ cảnh. WIF đổi
> lấy token sống vài phút và gắn với đúng repo.
>
> **Luật đi kèm:** ai sửa được `deploy.yml` thì điều khiển được service account này. Coi
> quyền merge vào `main` ngang với quyền sửa IAM.

---

## 8. Khai báo bên GitHub

Vào **Settings → Secrets and variables → Actions**:

**Tab Variables** (không nhạy cảm):

| Tên | Giá trị |
|---|---|
| `GCP_PROJECT_ID` | giá trị `$PROJECT_ID` |
| `GCP_REGION` | `us-central1` |
| `GCP_WIF_PROVIDER` | chuỗi bước 7.4 in ra |
| `GCP_SERVICE_ACCOUNT` | `github-deployer@....iam.gserviceaccount.com` |

**Tab Secrets** (nhạy cảm):

| Tên | Giá trị |
|---|---|
| `DATABASE_URL_DIRECT` | chuỗi **direct** của Neon (không có `-pooler`) |

> Chuỗi direct là **secret**, không phải variable — nó mở được cả database từ bất kỳ đâu. Neon
> bảo vệ bằng chuỗi kết nối chứ **không** bằng danh sách IP, nên lộ chuỗi là lộ database.

---

## 9. Deploy lần đầu

```bash
git push origin main
```

Push xong thì **CI chạy trước**; [`deploy.yml`](../.github/workflows/deploy.yml) chỉ khởi động
khi CI **xanh** (trigger `workflow_run`), và deploy đúng commit CI vừa kiểm. Muốn deploy lại mà
không push: tab **Actions → Deploy → Run workflow**. Nó chạy 5 bước theo thứ tự:

| # | Bước | Hỏng thì sao |
|---|---|---|
| 1 | Xác thực bằng WIF | Dừng, chưa đụng gì |
| 2 | Build và đẩy ảnh | Dừng, chưa đụng DB |
| 3 | `prisma migrate deploy` (direct) | **Dừng — không deploy code mới lên schema cũ** |
| 4 | Deploy service + worker job | Revision cũ vẫn giữ 100% traffic |
| 5 | Kiểm `/ready` | **Tự lùi traffic về revision trước** |

Xem tiến trình ở tab **Actions**. Xong thì lấy URL:

```bash
gcloud run services describe flash-core-api --region "$REGION" --format='value(status.url)'
```

---

## 10. Cloud Scheduler gọi worker

Worker **không** chạy liên tục — Cloud Run scale về 0 và cắt CPU ngoài lúc xử lý request, nên
một tiến trình nền sẽ bị đóng băng. Thay vào đó nó là một **Job chạy một lượt rồi thoát**
([ADR-012](adr/012-worker-tren-cloud-run.md)).

```bash
# Service account riêng cho Scheduler, chỉ đúng một quyền
gcloud iam service-accounts create scheduler-invoker --display-name="Cloud Scheduler invoker"
export INVOKER="scheduler-invoker@$PROJECT_ID.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$INVOKER" --role=roles/run.invoker

gcloud scheduler jobs create http flash-core-worker-tick \
  --location="$REGION" \
  --schedule="*/5 * * * *" \
  --uri="https://$REGION-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$PROJECT_ID/jobs/flash-core-worker:run" \
  --http-method=POST \
  --oauth-service-account-email="$INVOKER"
```

> **5 phút, không phải 1 phút.** Phép tính: 1 phút = 1.440 lượt/ngày × ~10 giây ≈ **432.000
> vCPU-giây/tháng**, vượt trần free 180.000 hơn hai lần — *và* giữ Neon thức gần như liên tục
> nên đốt luôn 100 compute-giờ của nó. 5 phút cho ≈86.400 vCPU-giây, vừa khít.
>
> Đánh đổi: email xác nhận chậm tối đa 5 phút. Chấp nhận được vì đơn giữ chỗ 15 phút.

---

## 11. Kiểm tra — 7 việc, làm đủ

```bash
export URL=$(gcloud run services describe flash-core-api --region "$REGION" --format='value(status.url)')

# 1. Sống chưa (lần đầu chậm vì cold start — bình thường)
curl -s "$URL/health"

# 2. Sẵn sàng chưa (kiểm cả Postgres lẫn Redis)
curl -i -s "$URL/ready" | head -1

# 3. Header bảo vệ — phải có đủ 5, gồm cả HSTS vì đây là HTTPS thật
curl -sI "$URL/" | grep -iE 'content-security-policy|strict-transport|x-content-type|referrer|permissions'

# 4. Trang demo
open "$URL"
```

5. **Đăng ký một tài khoản trên trang**, rồi nâng nó lên admin:
   ```bash
   gcloud run jobs deploy flash-core-admin \
     --image "$(gcloud run services describe flash-core-api --region $REGION --format='value(spec.template.spec.containers[0].image)')" \
     --region "$REGION" --command npm --args "run,make-admin,--,ban@example.com" \
     --set-secrets DATABASE_URL=DATABASE_URL:latest --max-retries 0 --quiet
   gcloud run jobs execute flash-core-admin --region "$REGION" --wait
   ```
6. **Tạo dữ liệu demo qua giao diện** — một product, vài SKU, một đợt sale. **Không chạy
   `npm run seed`** (100.000 dòng) lên Neon free.
7. **Chạy thử luồng đầy đủ**: đăng ký → xem đợt sale → săn → thanh toán → huỷ. Chờ 5 phút rồi
   kiểm đơn không trả tiền đã tự huỷ (worker tick).

---

## 12. Diễn tập rollback — làm một lần lúc rảnh, không phải lúc sự cố

```bash
# Xem các revision
gcloud run revisions list --service flash-core-api --region "$REGION"

# Lùi 100% traffic về revision trước
gcloud run services update-traffic flash-core-api --region "$REGION" \
  --to-revisions=<TEN_REVISION_CU>=100
```

> **Rollback chỉ đưa CODE về, schema database KHÔNG lùi theo.** Nghĩa là revision cũ **bắt
> buộc phải chạy được với schema mới**. Đó là lý do mọi migration của dự án đều **additive**
> (thêm cột nullable/có default, thêm bảng, thêm index) — muốn xoá cột thì tách hai lần deploy:
> lần 1 code thôi dùng cột, lần 2 mới xoá.
>
> **Neon gói Free không có Point-in-time recovery** (⚠ kiểm lại theo gói hiện tại). Trước một
> migration có `DROP` hoặc đổi kiểu: tự tay tạo branch/snapshot trước, coi như một bước của
> quy trình.

---

## 13. Sau 48 giờ: đo thật

| Đo gì | Ở đâu | Đối chiếu với |
|---|---|---|
| **Tổng vCPU-giây** | Cloud Run → Metrics | Trần free 180.000/tháng |
| **Neon compute-giờ** | Neon dashboard | Hạn mức 100 giờ |
| **Số lệnh Upstash** | Upstash dashboard | 500.000/tháng |
| **Dung lượng Artifact Registry** | Artifact Registry | 0,5 GB |
| Cold start / warm | `curl -w '%{time_total}'` | ghi vào spec |

Dán số vào [spec Phase 7 §Bằng chứng](specs/phase7-deploy-gcp.md) và cập nhật
[ADR-012](adr/012-worker-tren-cloud-run.md) / [ADR-013](adr/013-pool-nho-tren-serverless.md) —
cả hai hiện đang dùng **số đo local**, chưa phải số thật.

---

## 14. Khi hỏng — tra theo triệu chứng

| Triệu chứng | Nguyên nhân thường gặp nhất | Cách chữa |
|---|---|---|
| Job Deploy hiện **skipped** (xám) | CI đỏ, hoặc chưa đặt biến `GCP_WIF_PROVIDER` ở §8 — job cố ý bỏ qua thay vì đỏ | Sửa CI cho xanh / đặt đủ 4 biến `vars` |
| CI dừng ở bước `auth`, báo *"unable to get credentials"* | `--attribute-condition` không khớp tên repo, hoặc dán nhầm `GCP_WIF_PROVIDER` | Chạy lại 7.2–7.4, đối chiếu `$REPO` |
| `migrate deploy` treo rồi timeout | Dùng nhầm chuỗi **pooled** cho migrate | Đổi `DATABASE_URL_DIRECT` sang chuỗi **direct** |
| App lên nhưng mọi API trả `500`, log có `42P01` | Chưa chạy migration | Kiểm bước 3 của workflow có xanh không |
| App chết lúc khởi động, log liệt kê biến thiếu | Thiếu secret trong `--set-secrets` | Đối chiếu đủ **6** tên ở §6 |
| `/ready` trả `503` mãi | Redis hoặc Postgres không nối được | Kiểm `REDIS_URL` có `rediss://` (hai chữ s) |
| Đổi secret rồi mà app vẫn dùng giá trị cũ | **Secret Manager không tự áp dụng** | Phải **deploy lại** service |
| Mọi người dùng bị `429` cùng lúc | `trust proxy` sai ⇒ mọi request trông như một IP | Đã đặt `trust proxy = 1` trong `main.ts`; thêm một lớp proxy nữa thì phải đổi thành 2 |
| Deploy chậm bất thường | Artifact Registry khác region với Cloud Run | Tạo lại repo đúng `$REGION` |
| Hoá đơn nhích lên dù không ai dùng | Ảnh Docker dồn, hoặc có thứ poll Neon | Kiểm §3 cleanup policy và §10 nhịp Scheduler |

---

## 15. Bảy chốt chặn chi phí — kiểm lại sau khi deploy

- [ ] Budget alert **$1** đã bật và **đã nhận được email thử**
- [ ] `--max-instances 2` trên service (trần chi phí **và** trần connection tới Neon)
- [ ] `--cpu-throttling` (billing request-based — cờ quyết định chi phí lớn nhất)
- [ ] Cleanup policy của Artifact Registry đã bật
- [ ] Neon autosuspend 5 phút, và **không có gì poll nó**
- [ ] `LOG_LEVEL=info` (không `debug`) trên production
- [ ] Scheduler **5 phút**, không phải 1 phút

**Nghỉ dài thì xoá tài nguyên:** Cloud Run 0 instance là 0đ, nhưng Neon vẫn tính dung lượng
nếu vượt 0,5 GB. Quay video demo xong mà nghỉ vài tháng thì xoá dữ liệu demo đi.

---

## 16. Khi $300 credit hết — đổi những gì

Tin tốt: **gần như không phải đổi gì**, vì Neon và Upstash vốn đã dùng gói free (credit không
áp cho chúng), còn cấu hình Cloud Run vốn đã được đặt cho mục tiêu 0đ.

Nhưng nếu trong 90 ngày anh có nới cấu hình cho thoải mái, thì đây là chỗ phải trả lại:

| Nếu đã bật trong lúc có credit | Khi hết credit |
|---|---|
| `--min-instances 1` (hết cold start, ~$10–15/tháng) | **Trả về 0** |
| `--no-cpu-throttling` (instance-based billing) | **Trả về `--cpu-throttling`** |
| Worker chạy như service thức liên tục | **Trả về Cloud Run Job + Scheduler** |
| Uptime check nhiều vùng, nhịp dày | Còn 1 check, 1 vùng, nhịp 15 phút |

> **Ghi ngày hết credit vào lịch ngay hôm nay.** Đây là loại quyết định có hạn sử dụng mà ba
> tháng sau không ai còn nhớ lý do — và lúc phát hiện ra thì phát hiện bằng hoá đơn.
>
> Và giữ nguyên đường `worker-once` + Scheduler kể cả khi đang chạy min-instances, để còn lùi
> về được.

---

## 17. Tuỳ chọn: gửi email thật

Hiện `MAIL_SENDER` là bản ghi-ra-log — luồng outbox vẫn chứng minh được "không mất, không
trùng", chỉ là không có mail nào tới hộp thư. Muốn mail thật:

1. Đăng ký **Resend** hoặc **Mailgun** (cả hai có gói free ~100 mail/ngày) — **bên thứ ba
   ngoài GCP, credit không áp**
2. Thêm secret `MAIL_API_KEY` vào Secret Manager (⚠ lúc đó là **7** secret — vượt free tier 6
   version, phải huỷ bớt version cũ hoặc chấp nhận trả phí vài xu)
3. Viết một `MailSender` mới cạnh `LoggingMailSender` và đổi provider trong `MailModule`

Việc này **chưa làm**, và nó là điều kiện để mở khoá hai tính năng đang nằm trong Non-goals:
xác thực email và quên mật khẩu.
