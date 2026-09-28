# Deploy lên GCP bằng lệnh — bản copy-dán

> **Đây là nửa "lệnh" của [hướng dẫn deploy](huong-dan-deploy-gcp.md).** Bản kia làm mọi thứ
> bằng Console (UI) và giải thích *vì sao*; file này chỉ giữ **lệnh `gcloud` / terminal** tương
> đương, để dựng lại nhanh hoặc khi quen tay rồi. Chọn một trong hai cho mỗi bước, **đừng làm cả
> hai** — tạo hai lần thì lần sau báo "already exists".
>
> **Số mục trùng với bản Console:** §3 ở đây là lệnh cho §3 bên kia. Mục chỉ làm được trên web
> (§1 budget, §5 Upstash, §8 GitHub, §13 đo, §16 hết credit, §17 email) thì không có ở đây.
>
> Vì sao cấu hình như vậy thì đọc mục con cuối *Vì sao cấu hình như vậy* của từng mục bên bản
> Console — file này cố ý không chép lại lý do.

---

<!--@@muc-luc-->

---

<!--@@chuong Chuẩn bị máy-->
## 0. Cài công cụ và đặt biến dùng chung

1. Cài `gcloud`: <https://cloud.google.com/sdk/docs/install>
2. Cài Cloud SQL Auth Proxy (§4.2 dùng): `brew install cloud-sql-proxy`, hoặc tải ở
   [trang cài đặt](https://cloud.google.com/sql/docs/postgres/sql-proxy#install) rồi `chmod +x`.
3. Đăng nhập cho **lệnh `gcloud`**:

   ```bash
   gcloud auth login
   ```

4. Đặt biến dùng chung. **Mọi lệnh bên dưới đọc các biến này** — mở terminal mới là phải
   `export` lại.

   ```bash
   export PROJECT_ID=<Project ID>            # đã tạo bằng Console thì chép từ Console
   export REGION=us-central1
   export REPO=phamtam215/flash-core          # <github-user>/<ten-repo>
   ```

   Hai biến sinh ra ở §4 (`DB_PASS`, `SQL_INSTANCE`) cũng phải `export` lại nếu mở terminal
   mới — `SQL_INSTANCE` lấy lại được bằng lệnh ở §4.1 bước 4, `DB_PASS` thì lấy từ trình quản lý
   mật khẩu.

---

<!--@@chuong Dựng hạ tầng-->
## 2. Tạo project và bật API

1. Tạo project (tên phải **duy nhất toàn cầu** — thêm hậu tố nếu bị trùng) và chọn nó làm mặc
   định:

   ```bash
   export PROJECT_ID=flash-core-demo-$(date +%s | tail -c 5)
   gcloud projects create "$PROJECT_ID"
   gcloud config set project "$PROJECT_ID"
   ```

2. Gắn tài khoản thanh toán (lấy ID bằng `gcloud billing accounts list`):

   ```bash
   gcloud billing projects link "$PROJECT_ID" --billing-account=<BILLING_ACCOUNT_ID>
   ```

3. Bật 7 API:

   ```bash
   gcloud services enable \
     run.googleapis.com \
     artifactregistry.googleapis.com \
     secretmanager.googleapis.com \
     cloudscheduler.googleapis.com \
     sqladmin.googleapis.com \
     iamcredentials.googleapis.com \
     sts.googleapis.com
   ```

---

## 3. Artifact Registry + chính sách dọn image

1. Tạo repository:

   ```bash
   gcloud artifacts repositories create flash-core \
     --repository-format=docker --location="$REGION" \
     --description="Docker image của Flash-Core"
   ```

2. Bật chính sách dọn **ngay bây giờ**, đừng để sau:

   ```bash
   cat > /tmp/cleanup.json <<'JSON'
   [
     {
       "name": "giu-3-tag-moi-nhat",
       "action": {"type": "Keep"},
       "mostRecentVersions": {"keepCount": 3}
     },
     {
       "name": "xoa-image-cu-qua-7-ngay",
       "action": {"type": "Delete"},
       "condition": {"tagState": "any", "olderThan": "7d"}
     }
   ]
   JSON

   gcloud artifacts repositories set-cleanup-policies flash-core \
     --location="$REGION" --policy=/tmp/cleanup.json
   ```

---

## 4. Cloud SQL (PostgreSQL)

### 4.1 Tạo instance, database, user

1. Tạo instance (mất 5–10 phút):

   ```bash
   gcloud sql instances create flash-core-db \
     --database-version=POSTGRES_16 \
     --edition=ENTERPRISE \
     --tier=db-f1-micro \
     --region="$REGION" \
     --availability-type=zonal \
     --storage-type=SSD --storage-size=10 --no-storage-auto-increase \
     --backup-start-time=12:00
   ```

2. Tạo database `flashcore`:

   ```bash
   gcloud sql databases create flashcore --instance=flash-core-db
   ```

3. Tạo user `flashcore` — mật khẩu dạng hex để khỏi phải URL-encode khi ghép vào chuỗi kết nối.
   **Cất `DB_PASS` vào trình quản lý mật khẩu** ngay:

   ```bash
   export DB_PASS=$(openssl rand -hex 24)
   gcloud sql users create flashcore --instance=flash-core-db --password="$DB_PASS"
   ```

4. Lấy tên kết nối (dạng `project:region:instance`) — dùng ở §6, §8 bản Console và mọi lệnh
   proxy:

   ```bash
   export SQL_INSTANCE=$(gcloud sql instances describe flash-core-db --format='value(connectionName)')
   echo "$SQL_INSTANCE"
   ```

Mỗi cờ ứng với một lựa chọn trên form Console (§4.1 bản Console, lý do ở §4.4). Hai cờ riêng của đường lệnh:

| Cờ | Vì sao phải ghi |
|---|---|
| `--edition=ENTERPRISE` | **Bắt buộc ghi rõ.** Postgres 16 mặc định là *Enterprise Plus*, mà bản đó **không có** máy dùng chung CPU — quên cờ này là lỗi đắt nhất cả hướng dẫn (⚠ kiểm lại mặc định hiện tại) |
| `--backup-start-time=12:00` | Giờ **UTC**: 12:00 UTC = 19:00 giờ VN. Console thì hiển thị theo giờ máy, còn cờ này thì không |

### 4.2 Nối từ máy dev qua Cloud SQL Auth Proxy

Cơ chế và sơ đồ: [§4.3 bản Console](huong-dan-deploy-gcp.md#43-nối-từ-máy-local-psql-dbeaver-script-của-repo), lý do ở §4.4.4.

1. **Một lần:** đăng nhập cho *chương trình* (proxy), khác với `gcloud auth login` ở §0:

   ```bash
   gcloud auth application-default login
   ```

   Trang đồng ý có checkbox **không tick sẵn** — tick **Select all** rồi mới Continue. Bỏ qua
   là gặp lỗi `cloud-platform scope is required but not consented`; chạy lại với `--force`.

2. **Một lần, nếu máy có sẵn project của công ty:** chỉ quota project về đúng chỗ, cất ADC
   ra file riêng, và tạo cấu hình `gcloud` riêng:

   ```bash
   gcloud auth application-default set-quota-project "$PROJECT_ID"

   # ADC là MỘT file cho cả máy — cất bản của dự án này ra file riêng
   cp ~/.config/gcloud/application_default_credentials.json ~/.config/gcloud/adc-flash-core.json

   # cấu hình gcloud riêng, không đụng cái đang có
   gcloud config configurations create flash-core
   gcloud config set account <email cá nhân>
   gcloud config set project "$PROJECT_ID"
   ```

   Đổi qua lại: `gcloud config configurations activate <tên>`. Xem đang ở đâu: `gcloud config list`.

3. **Mỗi lần muốn nối** — mở proxy ở một cửa sổ và **để nó chạy** (in `Ready for new
   connections` rồi đứng yên; `Ctrl+C` là mất đường nối):

   ```bash
   cloud-sql-proxy --port 6543 "$SQL_INSTANCE"
   # máy có project công ty (bước 2) thì dùng đúng file ADC riêng:
   cloud-sql-proxy --credentials-file ~/.config/gcloud/adc-flash-core.json --port 6543 "$SQL_INSTANCE"
   ```

4. Cửa sổ khác, nối như một Postgres bình thường — **cổng 6543**, không phải 5432 (máy đã có
   Postgres ở 5432 và Docker Compose ở 5433):

   ```bash
   psql "postgresql://flashcore:$DB_PASS@127.0.0.1:6543/flashcore"
   ```

   Công cụ có giao diện (TablePlus, DBeaver…): Host `127.0.0.1` · Port `6543` · User
   `flashcore` · Database `flashcore` · **SSL off** (proxy đã mã hoá).

5. Chạy script của repo lên DB cloud — ví dụ nâng quyền admin (ảnh runtime không chạy được vì
   `ts-node` đã bị prune):

   ```bash
   DATABASE_URL="postgresql://flashcore:$DB_PASS@127.0.0.1:6543/flashcore" \
     npm run make-admin -- <email>
   ```

> **⚠ Đang nối vào cloud thì ba lệnh này là cấm:** `npm run seed`, `k6 run`,
> `prisma migrate reset`. Hook `guard_cloud_cost.py` chặn sẵn — nó chặn thì đừng lách.

---

## 6. Nạp 6 bí mật vào Secret Manager

1. Sinh và nạp 4 khoá ngẫu nhiên:

   ```bash
   for NAME in JWT_ACCESS_SECRET JWT_REFRESH_SECRET PAYMENT_WEBHOOK_SECRET CSRF_SECRET; do
     openssl rand -hex 32 | gcloud secrets create "$NAME" --data-file=- --replication-policy=automatic
   done
   ```

2. Nạp hai chuỗi kết nối. `printf '%s'` chứ không `echo` — `echo` thêm ký tự xuống dòng vào
   cuối, và `DATABASE_URL` có ký tự thừa là đường dẫn socket sai:

   ```bash
   printf '%s' "postgresql://flashcore:$DB_PASS@localhost/flashcore?host=/cloudsql/$SQL_INSTANCE" \
     | gcloud secrets create DATABASE_URL --data-file=- --replication-policy=automatic
   printf '%s' "<chuỗi rediss:// của Upstash>" \
     | gcloud secrets create REDIS_URL --data-file=- --replication-policy=automatic
   ```

3. **Khi xoay khoá về sau:** huỷ version cũ, nếu không version thứ 7 bắt đầu tính tiền:

   ```bash
   gcloud secrets versions destroy <SỐ_VERSION> --secret=CSRF_SECRET
   ```

---

<!--@@chuong Danh tính và quyền-->
## 7. Service account + Workload Identity Federation

Số bước con khớp §7.1–§7.4 bản Console.

1. **Lấy project number** (§7.3, §7.4 cần):

   ```bash
   export PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')
   ```

2. **§7.1.1 — `flash-core-runtime`**, danh tính của container: chỉ nối Cloud SQL.

   ```bash
   gcloud iam service-accounts create flash-core-runtime --display-name="Flash-Core runtime"
   export RUNTIME_SA="flash-core-runtime@$PROJECT_ID.iam.gserviceaccount.com"
   gcloud projects add-iam-policy-binding "$PROJECT_ID" \
     --member="serviceAccount:$RUNTIME_SA" --role=roles/cloudsql.client
   ```

3. **§7.1.2 — `github-deployer`**, danh tính của CI: 3 role mức project, **không** có quyền đọc
   secret, và chỉ được "khoác" đúng một SA là runtime:

   ```bash
   gcloud iam service-accounts create github-deployer --display-name="GitHub Actions deployer"
   export SA="github-deployer@$PROJECT_ID.iam.gserviceaccount.com"
   for ROLE in roles/run.admin roles/artifactregistry.writer roles/cloudsql.client; do
     gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="$ROLE"
   done
   gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
     --member="serviceAccount:$SA" --role=roles/iam.serviceAccountUser
   ```

4. **§7.1.3 — runtime đọc đúng 6 secret của nó** (chạy sau §6):

   ```bash
   for NAME in DATABASE_URL REDIS_URL JWT_ACCESS_SECRET JWT_REFRESH_SECRET PAYMENT_WEBHOOK_SECRET CSRF_SECRET; do
     gcloud secrets add-iam-policy-binding "$NAME" \
       --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor
   done
   ```

5. **§7.2 — pool và provider** cho GitHub OIDC. `--attribute-condition` là dòng quan trọng
   nhất: thiếu nó thì *mọi* repo GitHub đều đổi được token lấy quyền vào project.

   ```bash
   gcloud iam workload-identity-pools create github --location=global --display-name="GitHub"

   gcloud iam workload-identity-pools providers create-oidc github-provider \
     --location=global --workload-identity-pool=github \
     --issuer-uri="https://token.actions.githubusercontent.com" \
     --attribute-mapping="google.subject=assertion.sub,attribute.repository=assertion.repository" \
     --attribute-condition="assertion.repository=='$REPO'"
   ```

6. **§7.3 — cho đúng repo này mượn `github-deployer`:**

   ```bash
   gcloud iam service-accounts add-iam-policy-binding "$SA" \
     --role=roles/iam.workloadIdentityUser \
     --member="principalSet://iam.googleapis.com/projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/attribute.repository/$REPO"
   ```

7. **§7.4 — in ra hai giá trị dán vào GitHub** (§8 bản Console):

   ```bash
   echo "GCP_WIF_PROVIDER = projects/$PROJECT_NUMBER/locations/global/workloadIdentityPools/github/providers/github-provider"
   echo "GCP_SERVICE_ACCOUNT = $SA"
   ```

8. **§7.6 — tự kiểm một lượt.** In ra đúng những gì bảng 8 dòng của bản Console yêu cầu:

   ```bash
   echo "— service account (phải có 2, cột KEY_ID trống):"
   gcloud iam service-accounts list --project "$PROJECT_ID"
   for E in "$RUNTIME_SA" "$SA"; do
     echo "  khoá của $E:"; gcloud iam service-accounts keys list --iam-account "$E" --managed-by user
   done

   echo "— role mức project của hai SA (deployer phải đúng 3, runtime phải có cloudsql.client):"
   gcloud projects get-iam-policy "$PROJECT_ID" --flatten='bindings[].members' \
     --filter='bindings.members:(github-deployer OR flash-core-runtime)' \
     --format='table(bindings.members, bindings.role)'

   echo "— ai được khoác runtime (phải thấy github-deployer / serviceAccountUser):"
   gcloud iam service-accounts get-iam-policy "$RUNTIME_SA" --format='table(bindings.role, bindings.members)'

   echo "— ai được mượn deployer (phải thấy principalSet của đúng repo):"
   gcloud iam service-accounts get-iam-policy "$SA" --format='table(bindings.role, bindings.members)'

   echo "— provider: issuer, mapping, và ĐIỀU KIỆN khoá repo:"
   gcloud iam workload-identity-pools providers describe github-provider \
     --location=global --workload-identity-pool=github \
     --format='yaml(oidc.issuerUri, attributeMapping, attributeCondition, state)'
   ```

   Dòng cuối là dòng đáng đọc kỹ nhất: `attributeCondition` **trống** nghĩa là bất kỳ repo GitHub
   nào cũng mượn được service account này, mà deploy của anh vẫn chạy đúng nên không có triệu
   chứng nào báo.

9. **Gỡ lỗi (không phải việc hằng ngày):** đóng giả `github-deployer` để kiểm nó có quyền thật
   không, mà không phải push thử qua CI. Cần anh có `serviceAccountUser` trên nó:

   ```bash
   gcloud auth print-access-token \
     --impersonate-service-account="$SA"
   ```

---

<!--@@chuong Đưa lên chạy-->
## 9. Deploy lần đầu

1. Gắn tag lên commit **đã nằm trên `main`** — tag quyết định môi trường:

   ```bash
   git checkout main && git pull
   git tag v0.1.0-dev   && git push origin v0.1.0-dev    # → project dev
   ```

2. Thử trên dev xong, **cùng commit đó** lên prod (dừng ở *Waiting for review* chờ duyệt):

   ```bash
   git tag v0.1.0-prod  && git push origin v0.1.0-prod   # → project prod
   ```

3. Lấy URL của app sau khi workflow xanh:

   ```bash
   gcloud run services describe flash-core-api --region "$REGION" --format='value(status.url)'
   ```

---

## 10. Cloud Scheduler gọi worker

Làm **sau** §9 — job `flash-core-worker` phải tồn tại thì mới hẹn lịch được.

1. Service account riêng cho Scheduler, chỉ đúng một quyền:

   ```bash
   gcloud iam service-accounts create scheduler-invoker --display-name="Cloud Scheduler invoker"
   export INVOKER="scheduler-invoker@$PROJECT_ID.iam.gserviceaccount.com"
   gcloud projects add-iam-policy-binding "$PROJECT_ID" \
     --member="serviceAccount:$INVOKER" --role=roles/run.invoker
   ```

2. Hẹn lịch **5 phút** một lần. Tên phải đúng `flash-core-worker-tick` — `npm run gcp:off` tìm
   job theo tên này:

   ```bash
   gcloud scheduler jobs create http flash-core-worker-tick \
     --location="$REGION" \
     --schedule="*/5 * * * *" \
     --uri="https://$REGION-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$PROJECT_ID/jobs/flash-core-worker:run" \
     --http-method=POST \
     --oauth-service-account-email="$INVOKER"
   ```

3. Chạy thử ngay một lượt:

   ```bash
   gcloud scheduler jobs run flash-core-worker-tick --location="$REGION"
   ```

---

<!--@@chuong Kiểm và xử lý sự cố-->
## 11. Kiểm tra

1. Lấy URL:

   ```bash
   export URL=$(gcloud run services describe flash-core-api --region "$REGION" --format='value(status.url)')
   ```

2. Sống chưa (lần đầu chậm vì cold start — bình thường):

   ```bash
   curl -s "$URL/health"
   ```

3. Sẵn sàng chưa (kiểm cả Postgres lẫn Redis) — phải ra `200`:

   ```bash
   curl -i -s "$URL/ready" | head -1
   ```

4. Header bảo vệ — phải có đủ 5, gồm cả HSTS vì đây là HTTPS thật:

   ```bash
   curl -sI "$URL/" | grep -iE 'content-security-policy|strict-transport|x-content-type|referrer|permissions'
   ```

5. Mở trang demo: `open "$URL"`
6. Nâng tài khoản vừa đăng ký lên admin: §4.2 bước 5 (proxy cổng 6543 đang mở). Xong thì đăng
   xuất rồi đăng nhập lại.

---

## 12. Rollback

1. Xem các revision:

   ```bash
   gcloud run revisions list --service flash-core-api --region "$REGION"
   ```

2. Lùi 100% traffic về revision trước:

   ```bash
   gcloud run services update-traffic flash-core-api --region "$REGION" \
     --to-revisions=<TEN_REVISION_CU>=100
   ```

3. Trước một migration có `DROP` hoặc đổi kiểu — tự tay sao lưu:

   ```bash
   gcloud sql backups create --instance=flash-core-db
   ```

---

## 14. Lệnh chữa cho bảng triệu chứng

Bảng triệu chứng ở [§14 bản Console](huong-dan-deploy-gcp.md#14-khi-hỏng-tra-theo-triệu-chứng);
đây là các lệnh nó nhắc tới.

1. Xoá tag gắn sai (không khớp `v*-dev` / `v*-prod`), rồi gắn lại đúng mẫu:

   ```bash
   git push --delete origin <tag> && git tag -d <tag>
   ```

2. Đặt lại mật khẩu user `flashcore` — xong phải sửa **cả** secret `DATABASE_URL` (§6) lẫn
   GitHub secret `DATABASE_URL_MIGRATE`:

   ```bash
   gcloud sql users set-password flashcore --instance=flash-core-db --password=<mật khẩu mới>
   ```

3. Xem Cloud SQL đang bật hay tắt, và bật lại:

   ```bash
   npm run gcp:status
   npm run gcp:on
   ```

---

<!--@@chuong Lâu dài-->
## 15. Chốt chặn chi phí

1. Kiểm edition, máy, số vùng của Cloud SQL — phải ra `db-f1-micro  ENTERPRISE  ZONAL`:

   ```bash
   gcloud sql instances describe flash-core-db \
     --format='value(settings.tier,settings.edition,settings.availabilityType)'
   ```

2. Nghỉ dài thì xoá instance (cách duy nhất về 0đ) — phải tắt *Prevent instance deletion*
   trước (bằng Console, xem §15.2 bản Console). Quay lại thì làm lại §4.1:

   ```bash
   gcloud sql instances delete flash-core-db
   ```

---

## 18. Một vòng phát hành hoàn chỉnh (§18.5)

1. Merge vào `main` qua PR (CI xanh).
2. Lên dev:

   ```bash
   git checkout main && git pull
   git tag v0.2.0-dev && git push origin v0.2.0-dev
   ```

3. Kiểm trên URL của dev (§11). Ổn thì **cùng commit đó** lên prod:

   ```bash
   git tag v0.2.0-prod && git push origin v0.2.0-prod
   ```

4. Tab **Actions → Review deployments → Approve and deploy** (trên GitHub).
5. Phiên bản nào đang ở prod:

   ```bash
   git tag --list 'v*-prod' --sort=-creatordate | head -3
   ```
