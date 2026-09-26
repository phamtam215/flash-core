# Hướng dẫn deploy lên GCP — từ con số không

> **Dành cho người lần đầu deploy.** Mỗi bước có **hai cách làm**, chọn một, đừng làm cả hai:
> **Console (UI)** — bấm trên console.cloud.google.com, viết trước vì là cách dùng chính; và
> **lệnh `gcloud`** — copy-dán, nhanh khi phải dựng lại. Bước nào cũng nói rõ *vì sao* nó tồn tại,
> để khi hỏng thì biết đường sửa.
>
> **Tên nút trên Console đổi theo thời gian.** Các màn Budget, Cloud SQL, Artifact Registry,
> Workload Identity và tạo service account đã được **đối chiếu trên Console thật ngày
> 2026-09-26**. Chỗ chưa xem được trên Console thật (vì API của nó chưa bật) thì dựa theo tài liệu
> chính thức và có dấu ⚠. Không thấy đúng chữ thì gõ tên dịch vụ vào ô tìm kiếm trên cùng.
>
> **Mở một dịch vụ mà API của nó chưa bật** thì Console tự chuyển sang trang có nút **Enable** —
> bấm Enable ở đó là đúng (tương đương bước 3 của §2).
>
> **Giả định:** đã có tài khoản GCP với **$300 credit / 90 ngày**. Hướng dẫn này tận dụng
> credit đó, và §16 nói rõ phải đổi gì khi credit hết.
>
> **Hai môi trường ([ADR-017](adr/017-moi-truong-va-phan-quyen-theo-mo-hinh-cong-ty.md)).** §1–§17
> dựng **một** môi trường. Làm **hai lần**: project `flash-core-dev` trước, `flash-core-prod`
> sau — cùng các bước, chỉ khác tên project. §18 nói phần khác nhau (nhóm quyền, người duyệt,
> tag). Chỉ muốn một môi trường thì làm prod và bỏ qua §18.
>
> Quyết định kiến trúc đứng sau mỗi lựa chọn: [ADR-012](adr/012-worker-tren-cloud-run.md)
> (worker) · [ADR-013](adr/013-pool-nho-tren-serverless.md) (pool) ·
> [ADR-014](adr/014-workload-identity-federation.md) (xác thực CI) ·
> [ADR-016](adr/016-cloud-sql-thay-neon.md) (Cloud SQL, chạy liên tục trong giai đoạn credit).
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
                                 │                                 │
                                 │ Cloud SQL  flash-core-db        │
                                 │   Postgres 16, db-f1-micro      │
                                 └──────────────────┬──────────────┘
                                                    │
                                              ┌─────▼────┐
                                              │ Upstash  │
                                              │  Redis   │
                                              └──────────┘
```

### Bên thứ ba — liệt kê đầy đủ

| Dịch vụ | Dùng làm gì | Có tính vào $300 credit không | Gói dùng |
|---|---|---|---|
| **GCP Cloud Run** | Chạy API và worker | ✅ Có | Free tier + credit |
| **GCP Artifact Registry** | Lưu ảnh Docker | ✅ Có | 0,5 GB free |
| **GCP Secret Manager** | 6 bí mật runtime | ✅ Có | 6 version active free |
| **GCP Cloud Scheduler** | Gọi worker mỗi 5 phút | ✅ Có | 3 job free (dùng 1) |
| **GCP Cloud Logging** | Log của app | ✅ Có | 50 GB/tháng free |
| **GCP Cloud SQL** | PostgreSQL 16 | ✅ Có | **Không có gói free** — tính theo giờ máy bật + ổ đĩa (§4) |
| **Upstash** | Redis (queue + rate limit + tồn kho) | ❌ **Không** | Free 256 MB / 500k lệnh |
| **GitHub** | Repo + Actions chạy CI/CD | ❌ Không | Free (repo công khai hoặc cá nhân) |

> **Điểm dễ hiểu nhầm nhất:** $300 credit **chỉ tiêu được trong GCP**. Upstash là công ty
> khác, credit không đụng tới — nên vẫn dùng gói free của nó, và khi credit hết thì **không
> phải làm gì với nó**. Cloud SQL thì ngược lại: là thứ **duy nhất** trong danh sách tiêu
> credit đều đặn, và là thứ duy nhất ra hoá đơn khi credit hết (§16).

**Không cần cho bản chạy được:** dịch vụ gửi email thật (Resend/Mailgun). Hiện `MAIL_SENDER`
là bản ghi-ra-log; luồng outbox vẫn chạy đủ và chứng minh được "không mất, không trùng", chỉ
là không có mail nào tới hộp thư. Muốn mail thật thì xem §17.

---

## 1. Việc ĐẦU TIÊN: đặt cảnh báo ngân sách

Làm trước cả khi tạo project. Lý do: mọi thứ sau đây đều có thể tạo ra chi phí, và **cách duy
nhất biết mình đang tiêu tiền là được báo** — bảng điều khiển thì phải tự nhớ mở.

*(Đối chiếu trên Console thật, 2026-09-26.)*

1. ☰ → **Billing** → menu trái, nhóm **Cost control** → **Budgets & caps** → **Create new**
   > Đã có budget từ trước (ví dụ tạo lúc mở tài khoản) thì **bấm vào nó để sửa** theo các bước
   > dưới, khỏi tạo cái thứ hai.

![Trang Budgets & caps](html/assets/img/deploy/budget-1-danh-sach.jpg)
*① Menu trái: Cost control → Budgets & caps. ② Nút Create new.*

2. **Define** (bước 1/4): chọn **Alerts only (available to all services)** → **Name**
   `flash-core` → **Next**

![Bước Define](html/assets/img/deploy/budget-2-define.jpg)
*① Alerts only. ② Tên budget. ③ Next.*

3. **Scope** (bước 2/4): *Time range* **Monthly** · *Projects* và *Services* giữ **All**. Kéo
   xuống mục **Savings**: có hai ô **Savings programs** và **Other savings**, **cả hai đang được
   tick sẵn** → **bỏ tick cả hai** → **Next**

![Bước Scope, hai ô Savings đã bỏ tick](html/assets/img/deploy/budget-3-scope.jpg)
*① Monthly. ② ③ Hai ô Savings — ảnh chụp lúc ĐÃ bỏ tick, đây là trạng thái đúng. ④ Next.*

4. **Amount** (bước 3/4): *Budget type* **Specified amount** · *Target amount* là số tiền **theo
   đơn vị tiền tệ của tài khoản billing** — nhìn ký hiệu trước ô nhập. Tài khoản tính bằng **₫**
   thì nhập **`300000`** (≈ $12); tính bằng $ thì nhập `12` → **Next**

![Bước Amount với 130.000₫](html/assets/img/deploy/budget-4-amount.jpg)
*① Specified amount. ② Target amount — để ý ký hiệu ₫: gõ "5" ở đây nghĩa là 5 đồng. (Ảnh chụp lúc thử 130.000₫; con số đúng giờ là 300.000₫ — lý do ở cuối mục này.) ③ Next.*

5. **Actions** (bước 4/4): *Set alert threshold rules* giữ ba mốc **50% / 90% / 100%**,
   *Trigger on* **Actual**. Mục *Manage notifications*: giữ tick **Email alerts to billing admins
   and users** → **Finish**

![Bước Actions](html/assets/img/deploy/budget-5-actions.jpg)
*① Ba mốc 50/90/100%, Trigger on Actual (Console tự tính ra số tiền). ② Email alerts to billing admins and users. ③ Finish.*

> **Đơn vị tiền là chỗ dễ sai nhất bước 4** — lúc đối chiếu, chính tài khoản mẫu tính bằng ₫. Gõ
> `5` thì budget là **5 đồng** và cảnh báo kêu ngay từ đồng đầu tiên, rồi bị bỏ qua mãi mãi.
>
> **Bước 3 là bước hay bị bỏ qua nhất.** Dòng chữ ngay dưới chữ *Savings* nói rõ: budget theo dõi
> *"total cost minus any applicable selected credits"* — chi phí **sau khi trừ** các mục đang
> tick. $300 credit nằm trong **Other savings** (bấm mũi tên cạnh nó sẽ thấy *Promotional
> credits*). Để tick thì budget thấy 0đ suốt 90 ngày và **không bao giờ kêu**, dù Cloud SQL chạy
> 24/7. Bỏ tick hết thì nó đo chi phí thật.
>
> **Không có nút gửi thử email.** Cảnh báo đi tới tài khoản Google đang đăng nhập Console (anh là
> billing admin). Thư đầu tiên kêu ở mốc 50% chính là lần kiểm tra — lúc đó xem cả mục Spam.
>
> **Bước 2 còn một lựa chọn khác: *Spend cap enforcement*** — **chặn cứng** dịch vụ khi chạm trần,
> thay vì chỉ báo. Nghe hợp với dự án cá nhân, nhưng Console ghi rõ *"available for limited
> services"*, và khi kích hoạt nó *"pause your usage … until lifted"*. Hướng dẫn này chưa dùng vì
> chưa kiểm được Cloud SQL / Cloud Run có nằm trong danh sách dịch vụ được hỗ trợ không.
>
> **≈ $12 (300.000₫) chứ không phải $1:** Cloud SQL chạy liên tục đã ~$9/tháng ([ADR-016](adr/016-cloud-sql-thay-neon.md)).
> Ngưỡng thấp hơn thế thì tháng nào cũng kêu, và cảnh báo lúc nào cũng kêu thì chẳng ai đọc nữa.
> Đặt ngay trên mức bình thường thì **kêu nghĩa là có chuyện**: thường là một instance tạo sai
> máy (§4 bước 5) hoặc bật nhầm HA/PITR.

---

## 2. Tạo project và bật API

**Bằng Console:**

1. Trên thanh trên cùng, bấm vào tên project → **New project** → đặt tên `flash-core-demo` → Create.
   Ghi lại **Project ID** (Console tự thêm hậu tố nếu tên bị trùng) và **Project number**
   (xem ở ☰ → **Cloud overview → Dashboard**, thẻ *Project info*). §7 cần cả hai.
2. ☰ → **Billing** → nếu Console báo project chưa có tài khoản thanh toán → **Link a billing account**.
3. ☰ → **APIs & Services → Library**, tìm từng API rồi bấm **Enable**:
   Cloud Run Admin API · Artifact Registry API · Secret Manager API · Cloud Scheduler API ·
   Cloud SQL Admin API · IAM Service Account Credentials API · Security Token Service API

> Console thường tự hỏi có bật API không khi mở một dịch vụ lần đầu — nhưng **hai API cuối
> không có trang riêng**, nên không ai hỏi. Thiếu chúng thì Workload Identity Federation (§7)
> không đổi được token, và CI đỏ ở bước `auth` với một thông báo chẳng nhắc gì tới API.

**Hoặc bằng lệnh:**

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
  sqladmin.googleapis.com \
  iamcredentials.googleapis.com \
  sts.googleapis.com
```

> **`us-central1` không phải tuỳ tiện:** free tier của Cloud Run chỉ áp ở một số region, và
> đây là region dự án đã chốt. Đổi region thì phải đổi cả nơi đặt Artifact Registry (§3) —
> ảnh ở region khác nghĩa là mỗi lần deploy kéo ảnh xuyên vùng, chậm mà không ai để ý.

---

## 3. Artifact Registry + chính sách dọn ảnh

**Bằng Console:**

1. ☰ → **Artifact Registry → Repositories → Create repository**
2. Name `flash-core` · Format **Docker** · Mode **Standard** · Location type **Region** → `us-central1`

![Form tạo repository](html/assets/img/deploy/ar-1-repo.jpg)
*① Name. ② Format Docker. ③ Mode Standard. ④ Location type Region + us-central1. Nếu hiện hộp "Artifact Registry API has not been used…" là API chưa bật — làm bước 3 của §2 rồi tải lại trang.*

3. Mục **Cleanup policies**: **Dry run đang được chọn sẵn** → đổi sang **Delete artifacts**, rồi
   **Add a cleanup policy** hai lần (mỗi cái xong bấm **Done**):
   - *Name* `giu-3-tag-moi-nhat` — *Policy type* **Keep most recent versions**, *Keep count* `3`
   - *Name* `xoa-anh-khong-tag-qua-7-ngay` — *Policy type* **Conditional delete**, *Tag state*
     **Untagged**, tick **Older than** rồi điền `7d`

![Cleanup policy xoá ảnh không tag](html/assets/img/deploy/ar-2-cleanup.jpg)
*① Delete artifacts (không phải Dry run). ② Tên chính sách. ③ Conditional delete. ④ Tag state Untagged. ⑤ Tick Older than, điền 7d. Xong bấm Done ở cuối khung.*

4. Mục **Vulnerability scanning** (cuối form): đổi sang **Disabled** — mặc định là *Enabled*, và
   quét lỗ hổng tính tiền theo từng ảnh được đẩy lên (⚠ kiểm bảng giá Artifact Analysis)
5. **Create**

![Vulnerability scanning và nút Create](html/assets/img/deploy/ar-3-scanning.jpg)
*① Vulnerability scanning → Disabled. ② Create.*

> *Dry run* chỉ ghi log "lẽ ra sẽ xoá cái này" chứ không xoá gì. Chọn nhầm thì nhìn vào vẫn
> thấy chính sách đầy đủ mà ảnh vẫn dồn lên.

**Hoặc bằng lệnh:**

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

## 4. Cloud SQL (PostgreSQL)

**Bằng Console:**

1. ☰ → **SQL → Create instance → Choose PostgreSQL** (trang *Create a PostgreSQL instance*)
2. **Choose a Cloud SQL edition**: chọn **Enterprise** — **không** chọn *Enterprise Plus* (lý do ở
   bảng dưới). Ô *Edition preset* ngay dưới đang là **Production** (8 vCPU, 32 GB, 250 GB, Highly
   available) → đổi sang **Sandbox**

![Chọn edition và preset](html/assets/img/deploy/sql-1-edition.jpg)
*① Enterprise. ② Edition preset → Sandbox. Khung Summary bên phải cập nhật theo từng lựa chọn — dùng nó để kiểm lại.*

3. **Instance info**: *Database version* mặc định là **PostgreSQL 18** → đổi sang **PostgreSQL
   16** (khớp `docker-compose.yml` và bộ test — test trên phiên bản khác rồi deploy là để dành lỗi
   cho môi trường thật) · *Instance ID* `flash-core-db` · *Password* của user `postgres`: bấm
   **Generate** rồi cất vào trình quản lý mật khẩu (app không dùng user này)
4. **Choose region and zonal availability**: *Region* **us-central1 (Iowa)** · *Zonal availability*
   **Single zone** (*Multiple zones* nhân đôi tiền)

![Phiên bản, Instance ID, region, zone](html/assets/img/deploy/sql-2-info-region.jpg)
*① PostgreSQL 16. ② Instance ID. ③ Generate password. ④ us-central1. ⑤ Single zone. Nhìn bảng giá góc phải dưới: máy mặc định của preset Sandbox là $0,14/giờ ≈ $100/tháng — vì thế bước 5 bắt buộc.*

5. **Customize your instance → Show configuration options**, sửa bốn mục:
   - **Machine configuration** — **quan trọng nhất**: preset Sandbox dùng máy `db-custom-2-8192`
     (2 vCPU, 8 GB). Ở *Machine family dropdown* chọn **General purpose - Shared core** → Console
     chọn sẵn *1 vCPU, 1.7 GB* → đổi sang **1 vCPU, 0.614 GB** (chính là `db-f1-micro`)

![Chọn máy Shared core 0.614 GB](html/assets/img/deploy/sql-3-machine.jpg)
*① General purpose - Shared core. ② 1 vCPU, 0.614 GB. ③ Summary phải ghi Machine type db-f1-micro.*

   - **Storage**: *Storage type* **SSD** · *Storage capacity* **10 GB** · **bỏ tick** *Enable
     automatic storage increases* (đang tick sẵn)

![Storage](html/assets/img/deploy/sql-4-storage.jpg)
*① SSD. ② 10 GB. ③ Enable automatic storage increases — ảnh chụp lúc ĐÃ bỏ tick.*

   - **Connections**: *Instance IP assignment* giữ **Public IP**, **không** bấm *Add a network*

![Connections](html/assets/img/deploy/sql-5-connections.jpg)
*① Public IP giữ tick. ② Không bấm Add a network — danh sách để trống. ③ Private IP: để trống, trừ khi sau này chọn hướng Private IP ở §16.*

   - **Data Protection**: giữ tick *Automated daily backups*; *Backup window* hiển thị theo **giờ
     máy anh (GMT+7)** — chọn khung buổi tối, lúc hay bật máy học nhất. **Bỏ tick** *Enable
     point-in-time recovery* (ghi thêm log vào ổ = thêm tiền). Giữ tick *Prevent instance
     deletion*. **Bỏ tick** *Retain backups after instance deletion* và *Final backup on instance
     deletion* — giữ chúng thì xoá instance xong vẫn còn bản sao lưu tính tiền thêm tới 30 ngày

![Data Protection](html/assets/img/deploy/sql-6-data-protection.jpg)
*① Automated daily backups. ② Backup window (giờ GMT+7). ③ Point-in-time recovery — đã bỏ tick. ④ Prevent instance deletion giữ tick. ⑤ Hai ô giữ backup sau khi xoá — đã bỏ tick.*

6. Kéo xuống cuối, **kiểm bảng giá** rồi mới bấm **Create instance** — mất 5–10 phút. Mục
   *Security* để nguyên (*Allow only SSL connections*): connector và proxy đều mã hoá sẵn.

![Bảng giá và nút Create instance](html/assets/img/deploy/sql-7-gia-va-create.jpg)
*① Bảng giá phải ra khoảng $0,01/giờ (máy) + $0,002/giờ (ổ 10 GB). Bảng này KHÔNG tính tiền IP lúc máy tắt — xem §15. ② Create instance.*

7. Khi instance có dấu xanh:
   - Tab **Databases → Create database** → `flashcore`
   - Tab **Users → Add user account** → *Built-in authentication*, username `flashcore`,
     password sinh bằng `openssl rand -hex 24` trên máy (dạng hex để khỏi phải URL-encode). Cất
     lại — đây là **`DB_PASS`** dùng ở §6 và §8.
   - Trang **Overview** → chép **Connection name** (dạng `project:us-central1:flash-core-db`) —
     đây là **`SQL_INSTANCE`** dùng ở §6 và §8.

> **Vì sao phải sửa nhiều thế:** mọi mặc định của form đều nghiêng về production — preset
> Production, nhiều vùng, PITR, giữ backup sau khi xoá. Bỏ sót *một* mục máy (bước 5) là hoá đơn
> nhảy từ vài đô lên cỡ trăm đô/tháng. Tạo xong, mở **Overview** kiểm lại hai dòng *Edition* và
> *Machine type* (chốt chặn đầu tiên ở §15).

**Hoặc bằng lệnh:**

```bash
gcloud sql instances create flash-core-db \
  --database-version=POSTGRES_16 \
  --edition=ENTERPRISE \
  --tier=db-f1-micro \
  --region="$REGION" \
  --availability-type=zonal \
  --storage-type=SSD --storage-size=10 --no-storage-auto-increase \
  --backup-start-time=12:00

gcloud sql databases create flashcore --instance=flash-core-db

# Mật khẩu dạng hex để khỏi phải URL-encode khi ghép vào chuỗi kết nối
export DB_PASS=$(openssl rand -hex 24)
gcloud sql users create flashcore --instance=flash-core-db --password="$DB_PASS"

# Tên kết nối, dạng project:region:instance — dùng ở §6, §8 và mọi lệnh proxy
export SQL_INSTANCE=$(gcloud sql instances describe flash-core-db --format='value(connectionName)')
echo "$SQL_INSTANCE"
```

Lệnh `create` mất 5–10 phút. Mỗi lựa chọn ở trên — dù chọn trên UI hay bằng cờ — đều có lý do:

| Cờ (tương ứng trên UI) | Vì sao |
|---|---|
| `--edition=ENTERPRISE` | **Bắt buộc ghi rõ.** Postgres 16 mặc định là *Enterprise Plus*, mà bản đó **không có** máy dùng chung CPU — máy nhỏ nhất của nó giá hàng trăm đô/tháng. Quên cờ này là lỗi đắt nhất trong cả hướng dẫn (⚠ kiểm lại mặc định hiện tại) |
| `--tier=db-f1-micro` | Máy nhỏ nhất, dùng chung CPU, 0,6 GB RAM, `max_connections = 25`. Đủ cho demo: trần connection của dự án là ≤ 17 ([ADR-016](adr/016-cloud-sql-thay-neon.md)) |
| `--availability-type=zonal` | Một vùng. *Regional* (HA) nhân đôi tiền — không đáng cho môi trường thử |
| `--no-storage-auto-increase` | Ổ tự nở là hoá đơn tự nở. Dữ liệu demo không bao giờ tới 10 GB |
| `--backup-start-time=12:00` | 12:00 UTC = 19:00 giờ VN. **Sao lưu chỉ chạy khi máy đang bật**, nên đặt vào giờ hay học nhất |

**Tiền** (đọc trên form tạo instance 2026-09-26): máy `db-f1-micro` **$0,01/giờ**, ổ 10 GB SSD
$0,17/GB/tháng ⇒ chạy liên tục ~$9/tháng, trừ vào credit. Vì sao không tắt máy khi nghỉ cho rẻ
hơn: §15.

> **Không mở IP cho ai, và không cần mở.** Instance có IP công khai nhưng danh sách IP được phép
> để **trống**. Cloud Run nối qua *Cloud SQL connector* (socket `/cloudsql/...`), máy dev và
> GitHub runner nối qua *Cloud SQL Auth Proxy* — cả hai xác thực bằng **IAM** (role
> `cloudsql.client`) rồi mới tới mật khẩu DB.
>
> Hệ quả phải hiểu đúng (bẫy #5 ở [spec Phase 7 §Bài toán #6](specs/phase7-deploy-gcp.md)):
> **"danh sách IP trống" không có nghĩa là đóng cửa** — connector đi vòng qua lớp IP. Hàng rào
> thật là *ai có role `cloudsql.client`* cộng *mật khẩu*. Cấp role đó cho ai là mở cửa cho
> người đó.

**Xem và sửa dữ liệu ngay trên trình duyệt — Cloud SQL Studio:** instance → **Cloud SQL
Studio** ở menu trái → đăng nhập user `flashcore`, database `flashcore`. Chạy SQL thẳng, không
cần cài gì. §11 bước 5 dùng cách này.

**Hoặc nối từ máy dev** bằng proxy (khi cần chạy script của repo, hoặc quen `psql`):

```bash
# Cài: https://cloud.google.com/sql/docs/postgres/sql-proxy#install
gcloud auth application-default login          # một lần
cloud-sql-proxy --port 6543 "$SQL_INSTANCE"     # để cửa sổ này chạy
# cửa sổ khác:
psql "postgresql://flashcore:$DB_PASS@127.0.0.1:6543/flashcore"
```

> **Cổng 6543, không phải 5432:** máy này đã có Postgres cài thẳng ở 5432 và Docker Compose
> ở cổng 5433. Proxy chiếm 5432 thì lệnh nào tưởng đang nói với DB local sẽ nói với **cloud**.

---

## 5. Upstash (Redis)

1. Đăng ký tại **upstash.com**
2. Tạo database, chọn **GCP us-central1** (cùng region Cloud Run — Upstash có sẵn vùng này)
3. Lấy chuỗi `rediss://...` (chú ý **hai chữ s** — TLS)

> Gói free: **256 MB / 500.000 lệnh mỗi tháng**. Worker gọi mỗi 5 phút là ~8.600 lệnh/tháng
> chỉ để hỏi việc — còn rất nhiều chỗ, nhưng đây là hạn mức **chạm trần đầu tiên** nếu có
> traffic thật (xem [spec Phase 7](specs/phase7-deploy-gcp.md) §Bài toán #4).

---

## 6. Nạp 6 bí mật vào Secret Manager

**Bằng Console:**

1. ☰ → **Security → Secret Manager → Create secret**
2. Name `JWT_ACCESS_SECRET` · *Secret type* để trống · Secret value: dán kết quả của
   `openssl rand -hex 32` (chạy trên máy, **mỗi secret chạy một lần**, không dùng lại) · các mục
   khác giữ mặc định → **Create secret**
3. Lặp lại cho `JWT_REFRESH_SECRET`, `PAYMENT_WEBHOOK_SECRET`, `CSRF_SECRET`
4. `REDIS_URL` — dán chuỗi `rediss://...` của Upstash (§5)
5. `DATABASE_URL` — dán chuỗi dạng dưới đây, thay `<DB_PASS>` và `<SQL_INSTANCE>` bằng hai giá
   trị đã chép ở §4:

   ```text
   postgresql://flashcore:<DB_PASS>@localhost/flashcore?host=/cloudsql/<SQL_INSTANCE>
   ```

> **Kiểm không có dấu cách hay xuống dòng ở cuối** trước khi bấm Create. Secret lưu đúng từng
> ký tự được dán vào, và một ký tự xuống dòng thừa ở cuối `DATABASE_URL` làm đường dẫn socket
> sai — app báo "không nối được DB" chứ không báo "chuỗi có ký tự lạ".

**Hoặc bằng lệnh:**

```bash
# Sinh 4 khoá ngẫu nhiên
for NAME in JWT_ACCESS_SECRET JWT_REFRESH_SECRET PAYMENT_WEBHOOK_SECRET CSRF_SECRET; do
  openssl rand -hex 32 | gcloud secrets create "$NAME" --data-file=- --replication-policy=automatic
done

# Hai chuỗi kết nối. `printf '%s'` chứ không `echo`: echo thêm ký tự xuống dòng vào cuối.
printf '%s' "postgresql://flashcore:$DB_PASS@localhost/flashcore?host=/cloudsql/$SQL_INSTANCE" \
  | gcloud secrets create DATABASE_URL --data-file=- --replication-policy=automatic
printf '%s' "<chuỗi rediss:// của Upstash>" \
  | gcloud secrets create REDIS_URL --data-file=- --replication-policy=automatic
```

`DATABASE_URL` là chuỗi trỏ vào **socket** mà Cloud Run gắn vào container.

> `?host=/cloudsql/...` bảo thư viện `pg` nối qua Unix socket thay vì TCP; phần `localhost` chỉ
> để chuỗi đúng cú pháp. Socket đó chỉ tồn tại khi service được deploy với
> `--set-cloudsql-instances` — `deploy.yml` đã có cờ này.

> **Free tier Secret Manager là 6 version *đang hoạt động*, và dự án có đúng 6 bí mật — vừa
> khít.** Nên mỗi lần xoay khoá phải **huỷ version cũ**, nếu không version thứ 7 bắt đầu tính
> tiền:
> ```bash
> gcloud secrets versions destroy <SỐ_VERSION> --secret=CSRF_SECRET
> ```
> Trên Console: mở secret → danh sách version → ⋮ ở version cũ → **Destroy** (⚠ nhãn có thể khác).
>
> **Xoay `CSRF_SECRET` an toàn** — token cũ thành không hợp lệ, middleware phát lại ở request
> kế tiếp, **không ai bị đăng xuất**. Xoay `JWT_*` thì mọi người phải đăng nhập lại.

---

## 7. Service account + Workload Identity Federation

Đây là bước rắc rối nhất. Làm **một lần**, và không bao giờ phải tạo file key JSON nào.

**Bằng Console:**

**7.1 — hai service account: một cho CI, một cho container.** Mẫu của hệ thống công ty
(ADR-017): **mỗi việc một danh tính**, quyền gắn vào đúng tài nguyên chứ không gắn cả project.

*a) `flash-core-runtime` — danh tính mà container chạy dưới.* ☰ → **IAM & Admin → Service
Accounts → Create service account** → *Service account name* `flash-core-runtime` → **Create and
continue** → role **Cloud SQL Client** → **Continue** → **Done**. Quyền đọc secret **không** cấp
ở đây — cấp riêng từng secret ở bước c.

*b) `github-deployer` — danh tính của CI.* ☰ → **IAM & Admin → Service Accounts → Create
service account** → *Service account name* `github-deployer` (ô *Service account ID* tự điền
theo) → **Create and continue**.

> **Bấm *Create and continue* là service account được tạo NGAY** — bước sau chỉ là gắn quyền. Gõ
> sai tên thì phải xoá rồi tạo lại (ID không đổi được sau khi tạo).

![Form tạo service account](html/assets/img/deploy/sa-1-create.jpg)
*① Service account name. ② Service account ID tự điền theo — kiểm kỹ trước khi đi tiếp. ③ Create and continue — bấm là tạo luôn.*


Bước **Permissions (optional)**: chọn role, bấm **Add another role** để thêm cái tiếp, đủ **3**
role ở mức project:

- Cloud Run Admin
- Artifact Registry Writer
- Cloud SQL Client (cho proxy chạy migrate)

→ **Continue** → bỏ qua bước *Principals with access* → **Done** (⚠ nhãn hai nút này theo tài
liệu). Chép email của nó (`github-deployer@<PROJECT_ID>.iam.gserviceaccount.com`).

Rồi cho CI được "khoác" **đúng một** SA là `flash-core-runtime` — không phải mọi SA trong
project: vào **Service Accounts** → bấm `flash-core-runtime` → tab **Principals with access** →
**Grant access** → *New principals* `github-deployer@…` · role **Service Account User** → **Save**.

> CI **không** được đọc secret. Nó chỉ bảo Cloud Run "container này dùng secret X"; người đọc
> secret là `flash-core-runtime` lúc container chạy. Hệ thống công ty cũng vậy: build SA không có
> quyền secret nào.

*c) Cho `flash-core-runtime` đọc đúng 6 secret của nó.* Làm sau §6 (lúc secret đã tồn tại):
**Secret Manager** → tick cả 6 secret → nút **Show info panel** (hoặc **Permissions**) → **Add
principal** → `flash-core-runtime@…` · role **Secret Manager Secret Accessor** → **Save** (⚠ vị
trí nút theo tài liệu). Quyền gắn **lên từng secret**, nên thêm một secret thứ 7 cho việc khác
thì container không tự đọc được nó.

**7.2 — pool và provider.** ☰ → **IAM & Admin → Workload Identity Federation** → **Get started**
(trang *New workload provider and pool*, 3 bước, **chỉ lưu khi bấm Save ở cuối**):

1. **Create an identity pool**: *Name* `github` (dòng *Pool ID* tự thành `github` — **không đổi
   được sau này**) · giữ *Enabled pool* bật → **Continue**

![Bước 1: tạo pool](html/assets/img/deploy/wif-1-pool.jpg)
*① Name. ② Pool ID tự sinh — không đổi được sau này. ③ Enabled pool giữ bật. ④ Continue.*

2. **Add a provider to pool**: *Select a provider* **OpenID Connect (OIDC)** · *Provider name*
   `github-provider` (dòng *Provider ID* tự thành `github-provider`, cũng không đổi được) ·
   *Issuer (URL)* `https://token.actions.githubusercontent.com` · bỏ qua ô *JWK file* · *Audiences*
   giữ **Default audience**. **Chép ngay dòng đường dẫn dưới *Default audience*** (có nút copy) —
   §7.4 dùng nó. → **Continue**

![Bước 2: provider OIDC](html/assets/img/deploy/wif-2-provider.jpg)
*① OpenID Connect (OIDC). ② Provider name + Provider ID tự sinh. ③ Issuer (URL). ④ Default audience. ⑤ Dòng đường dẫn cần chép cho §7.4 (trên màn hình thật là số project của anh, ở đây đã che thành PROJECT_NUMBER).*

3. **Configure provider attributes**:
   - Ô *Google 1* đã khoá sẵn `google.subject` → ô *OIDC 1* điền `assertion.sub`
   - **Add mapping** → *Google 2* `attribute.repository`, *OIDC 2* `assertion.repository`
   - Mục *Attribute conditions* → **Add condition** → ô *Condition CEL* điền
     `assertion.repository=='phamtam215/flash-core'` (đúng tên repo của anh)
   - **Save**

![Bước 3: mapping và condition](html/assets/img/deploy/wif-3-attributes.jpg)
*① Google 1 = google.subject, OIDC 1 = assertion.sub. ② Dòng thêm bằng Add mapping. ③ Condition CEL — dòng quan trọng nhất cả bước. ④ Save — chỉ tới đây mới thực sự tạo pool.*

**7.3 — cho đúng repo này mượn service account.** Trên trang pool `github` → **Grant access** →
**Grant access using Service Account impersonation** → *Service accounts*: chọn `github-deployer`
→ chọn **Only identities matching the filter** → *Attribute name* `repository`, *Attribute
value* `phamtam215/flash-core` → **Save**. Hiện hộp *Configure your application* thì bấm
**Dismiss** — hộp đó để tải file cấu hình cho cách khác, ở đây không cần.

*(Đối chiếu với [tài liệu WIF cho deployment pipeline](https://docs.cloud.google.com/iam/docs/workload-identity-federation-with-deployment-pipelines).
Tài liệu đó giờ ưu tiên cấp quyền thẳng cho danh tính GitHub thay vì mượn service account;
dự án vẫn dùng cách mượn vì [ADR-014](adr/014-workload-identity-federation.md) và `deploy.yml`
đã viết theo cách đó.)*

**7.4 — giá trị dán vào GitHub** (§8). Lấy dòng đã chép ở bước 7.2, **bỏ phần
`https://iam.googleapis.com/` ở đầu** và thay `<providerId>` bằng `github-provider`. Kết quả phải
có dạng:

```text
GCP_WIF_PROVIDER    = projects/<PROJECT_NUMBER>/locations/global/workloadIdentityPools/github/providers/github-provider
GCP_SERVICE_ACCOUNT = github-deployer@<PROJECT_ID>.iam.gserviceaccount.com
```

> Chỗ dễ sai: `GCP_WIF_PROVIDER` dùng **Project number** (dãy số), không phải Project ID.

**Hoặc bằng lệnh:**

```bash
export REPO="<github-user>/<ten-repo>"      # ví dụ: phamtam215/flash-core
export PROJECT_NUMBER=$(gcloud projects describe "$PROJECT_ID" --format='value(projectNumber)')

# 7.1a — danh tính của CONTAINER: chỉ nối Cloud SQL; secret cấp riêng từng cái ở dưới
gcloud iam service-accounts create flash-core-runtime --display-name="Flash-Core runtime"
export RUNTIME_SA="flash-core-runtime@$PROJECT_ID.iam.gserviceaccount.com"
gcloud projects add-iam-policy-binding "$PROJECT_ID" \
  --member="serviceAccount:$RUNTIME_SA" --role=roles/cloudsql.client

# 7.1b — danh tính của CI: 3 role mức project, KHÔNG có quyền đọc secret
gcloud iam service-accounts create github-deployer --display-name="GitHub Actions deployer"
export SA="github-deployer@$PROJECT_ID.iam.gserviceaccount.com"
for ROLE in roles/run.admin roles/artifactregistry.writer roles/cloudsql.client; do
  gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role="$ROLE"
done
# ...và chỉ được "khoác" đúng một SA là runtime, không phải mọi SA trong project
gcloud iam service-accounts add-iam-policy-binding "$RUNTIME_SA" \
  --member="serviceAccount:$SA" --role=roles/iam.serviceAccountUser

# 7.1c — runtime đọc đúng 6 secret của nó (chạy sau §6)
for NAME in DATABASE_URL REDIS_URL JWT_ACCESS_SECRET JWT_REFRESH_SECRET PAYMENT_WEBHOOK_SECRET CSRF_SECRET; do
  gcloud secrets add-iam-policy-binding "$NAME" \
    --member="serviceAccount:$RUNTIME_SA" --role=roles/secretmanager.secretAccessor
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

Mỗi môi trường là một **GitHub Environment** mang biến riêng — nhờ vậy cùng một `deploy.yml`
deploy được cả hai nơi, và secret của prod không lộ cho job chạy ở dev.

1. **Settings → Environments → New environment** → tên **`dev`** (cho project dev) hoặc
   **`production`** (cho project prod) — **đúng hai tên này**, `deploy.yml` chọn theo đuôi tag
2. Trong trang environment vừa tạo, mục **Environment variables → Add environment variable**:

| Tên | Giá trị |
|---|---|
| `GCP_PROJECT_ID` | Project ID của **môi trường này** |
| `GCP_WIF_PROVIDER` | chuỗi bước 7.4 của **project này** |
| `GCP_SERVICE_ACCOUNT` | `github-deployer@<PROJECT_ID>.iam.gserviceaccount.com` |
| `GCP_SQL_INSTANCE` | `SQL_INSTANCE` của project này (dạng `project:us-central1:flash-core-db`) |

3. Mục **Environment secrets → Add environment secret**:

| Tên | Giá trị |
|---|---|
| `DATABASE_URL_MIGRATE` | `postgresql://flashcore:<DB_PASS của project này>@127.0.0.1:5432/flashcore` |

4. Một biến dùng chung cho cả hai, đặt ở mức **repo**: **Settings → Secrets and variables →
   Actions → tab Variables → New repository variable** → `GCP_REGION` = `us-central1`

> Chuỗi `DATABASE_URL_MIGRATE` trỏ vào **proxy** mà workflow tự mở trên runner (cổng 5432 ở đó
> không đụng ai). Nó vẫn là **secret** vì chứa mật khẩu — nhưng lộ riêng nó chưa đủ vào DB: còn
> phải có role `cloudsql.client` (§4).
>
> Phần **bảo vệ** của environment `production` (người duyệt, chỉ nhận tag `v*-prod`) ở §18.

---

## 9. Deploy lần đầu

Deploy **bằng git tag** — cùng cách với hệ thống công ty. Commit phải đã nằm trên `main`:

```bash
git checkout main && git pull
git tag v0.1.0-dev   && git push origin v0.1.0-dev    # → project dev
# thử trên dev xong, cùng commit đó lên prod:
git tag v0.1.0-prod  && git push origin v0.1.0-prod   # → project prod, chờ người duyệt
```

[`deploy.yml`](../.github/workflows/deploy.yml) chạy lại **toàn bộ CI** trên đúng commit được gắn
tag, rồi mới tới các bước deploy:

| # | Bước | Hỏng thì sao |
|---|---|---|
| 0 | CI (lint, typecheck, unit, integration) | Dừng, chưa đụng gì |
| — | *(chỉ prod)* **Chờ duyệt** — tab Actions hiện *Waiting for review* | Chưa ai bấm thì không có gì xảy ra |
| 1 | Kiểm commit đã nằm trên `main`, xác thực bằng WIF | Dừng, chưa đụng gì |
| 2 | Build và đẩy ảnh | Dừng, chưa đụng DB |
| 3 | Mở Cloud SQL Auth Proxy, `prisma migrate deploy` | **Dừng — không deploy code mới lên schema cũ.** Cloud SQL đang tắt thì đỏ ở đây: `npm run gcp:on` rồi chạy lại |
| 4 | Deploy service + worker job | Revision cũ vẫn giữ 100% traffic |
| 5 | Kiểm `/ready` | **Tự lùi traffic về revision trước** |

Xem tiến trình ở tab **Actions**. Deploy lại đúng phiên bản đó: mở lần chạy cũ → **Re-run all
jobs**. Xong thì lấy URL:

```bash
gcloud run services describe flash-core-api --region "$REGION" --format='value(status.url)'
```

---

## 10. Cloud Scheduler gọi worker

Worker **không** chạy liên tục — Cloud Run scale về 0 và cắt CPU ngoài lúc xử lý request, nên
một tiến trình nền sẽ bị đóng băng. Thay vào đó nó là một **Job chạy một lượt rồi thoát**
([ADR-012](adr/012-worker-tren-cloud-run.md)).

Làm **sau** lần deploy đầu (§9) — job `flash-core-worker` phải tồn tại thì mới hẹn lịch được.

**Bằng Console:**

1. Tạo service account riêng cho Scheduler: ☰ → **IAM & Admin → Service Accounts → Create
   service account** → Name `scheduler-invoker` → role **Cloud Run Invoker** (chỉ một role) → **Done**
2. ☰ → **Cloud Run → Jobs** → bấm `flash-core-worker` → tab **Triggers** → **Add Scheduler
   Trigger** ([nguồn](https://docs.cloud.google.com/run/docs/execute/jobs-on-schedule)):
   - *Name* **`flash-core-worker-tick`** — phải **đúng tên này**, vì `npm run gcp:off` tìm job theo tên
   - *Region* `us-central1` · *Frequency* `*/5 * * * *` · *Timezone* tuỳ ý (5 phút một lần thì
     múi giờ không đổi gì)
   - *Service account* `scheduler-invoker` → **Create**
3. Thử ngay: ☰ → **Cloud Scheduler** → tick `flash-core-worker-tick` → **Force run** → quay lại
   job `flash-core-worker`: phải có một lượt chạy mới, dấu xanh.

**Hoặc bằng lệnh:**

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
> vCPU-giây/tháng**, vượt trần free 180.000 hơn hai lần. 5 phút cho ≈86.400 vCPU-giây, vừa
> khít.
>
> Đánh đổi: email xác nhận chậm tối đa 5 phút. Chấp nhận được vì đơn giữ chỗ 15 phút.

---

## 11. Kiểm tra — 7 việc, làm đủ

URL của app nằm ở **Cloud Run → flash-core-api**, dòng trên cùng. Bước 1, 2, 4 mở thẳng trên
trình duyệt được (`<URL>/health`, `<URL>/ready`); bước 3 cần terminal, hoặc xem ở tab
**Network** của DevTools (F12) → bấm vào request đầu tiên → *Response Headers*.

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

5. **Đăng ký một tài khoản trên trang**, rồi nâng nó lên admin. Cách nhanh nhất là **Cloud SQL
   Studio** (§4) — chạy đúng câu mà script `make-admin` chạy:

   ```sql
   UPDATE users SET role = 'ADMIN' WHERE email = 'ban@example.com' RETURNING email, role;
   ```
   Kết quả phải ra **một dòng**; ra 0 dòng là gõ sai email hoặc chưa đăng ký. Xong thì **đăng
   xuất rồi đăng nhập lại** — vai trò nằm trong access token, token cũ vẫn mang vai trò cũ.

   Hoặc chạy script từ máy dev qua proxy (§4, cửa sổ proxy cổng 6543 đang mở):
   ```bash
   DATABASE_URL="postgresql://flashcore:$DB_PASS@127.0.0.1:6543/flashcore" \
     npm run make-admin -- ban@example.com
   ```
   > Không chạy trong ảnh Docker được: `make-admin` cần `ts-node`, mà ảnh runtime đã bỏ mọi
   > devDependency (cùng lý do bước migrate phải chạy ở runner).
6. **Tạo dữ liệu demo qua giao diện** — một product, vài SKU, một đợt sale. **Không chạy
   `npm run seed`** (100.000 dòng) lên cloud — lệnh đó chỉ dành cho DB local.
7. **Chạy thử luồng đầy đủ**: đăng ký → xem đợt sale → săn → thanh toán → huỷ. Chờ 5 phút rồi
   kiểm đơn không trả tiền đã tự huỷ (worker tick).

---

## 12. Diễn tập rollback — làm một lần lúc rảnh, không phải lúc sự cố

**Bằng Console:** **Cloud Run → flash-core-api → tab Revisions → Manage traffic** → đặt revision
cũ **100%** → **Save**. Muốn trả lại thì làm y vậy với revision mới nhất.

**Hoặc bằng lệnh:**

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
> **Sao lưu tự động chỉ chạy lúc máy bật** (§4). Trước một migration có `DROP` hoặc đổi kiểu,
> tự tay sao lưu trước, coi như một bước của quy trình (Console: instance → **Backups → Create
> backup**):
> ```bash
> gcloud sql backups create --instance=flash-core-db
> ```

---

## 13. Sau 48 giờ: đo thật

| Đo gì | Ở đâu | Đối chiếu với |
|---|---|---|
| **Tổng vCPU-giây** | Cloud Run → Metrics | Trần free 180.000/tháng |
| **Tiền Cloud SQL** | Billing → Reports, lọc *Cloud SQL*, bỏ tick credit | ~$9/tháng ([ADR-016](adr/016-cloud-sql-thay-neon.md)) — cao hơn nhiều là tạo sai máy |
| **Số connection cao nhất** | `SELECT count(*) FROM pg_stat_activity` lúc đang dùng | ≤ 17 trên trần 25 |
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
| Đẩy tag mà Actions không chạy gì | Tag không khớp `v*-dev` / `v*-prod` (ví dụ `v1.0.0` hay `1.0.0-dev`) | Xoá tag sai (`git push --delete origin <tag>`), gắn lại đúng mẫu |
| Deploy đỏ ở *Commit phải nằm trên main* | Tag gắn vào commit của nhánh chưa merge | Merge PR trước, gắn tag lên commit trên `main` |
| Prod dừng ở *Waiting for review* mãi | Chưa ai trong danh sách *Required reviewers* bấm duyệt | Tab Actions → lần chạy đó → **Review deployments** → tick `production` → **Approve and deploy** |
| Bước `auth` đỏ ở dev nhưng prod chạy được (hoặc ngược lại) | Biến của hai Environment dán lẫn nhau — mỗi project có WIF và SA riêng | Đối chiếu §8 cho từng environment |
| Deploy đỏ: *Permission … iam.serviceaccounts.actAs* | `github-deployer` chưa được **Service Account User** trên `flash-core-runtime` | §7.1b, đoạn "khoác đúng một SA" |
| CI dừng ở bước `auth`, báo *"unable to get credentials"* | `--attribute-condition` không khớp tên repo, hoặc dán nhầm `GCP_WIF_PROVIDER` | Chạy lại 7.2–7.4, đối chiếu `$REPO` |
| Bước *Mở Cloud SQL Auth Proxy* đỏ | Cloud SQL đang **tắt**, hoặc deploy SA thiếu `cloudsql.client` | `npm run gcp:status`; bật bằng `npm run gcp:on`; kiểm 5 role ở §7.1 |
| App lên nhưng `/ready` 503, log có `ENOENT /cloudsql/...` | Service deploy thiếu `--set-cloudsql-instances`, hoặc biến `GCP_SQL_INSTANCE` sai | Đối chiếu biến ở §8 với `$SQL_INSTANCE` |
| `password authentication failed` | `DATABASE_URL` hoặc `DATABASE_URL_MIGRATE` gõ sai mật khẩu | Đặt lại: `gcloud sql users set-password flashcore --instance=flash-core-db --password=...` rồi sửa cả hai |
| App lên nhưng mọi API trả `500`, log có `42P01` | Chưa chạy migration | Kiểm bước 3 của workflow có xanh không |
| App chết lúc khởi động, log liệt kê biến thiếu | Thiếu secret trong `--set-secrets` | Đối chiếu đủ **6** tên ở §6 |
| `/ready` trả `503` mãi | Cloud SQL đang tắt, hoặc Redis không nối được | `npm run gcp:status`; kiểm `REDIS_URL` có `rediss://` (hai chữ s) |
| Đổi secret rồi mà app vẫn dùng giá trị cũ | **Secret Manager không tự áp dụng** | Phải **deploy lại** service |
| Mọi người dùng bị `429` cùng lúc | `trust proxy` sai ⇒ mọi request trông như một IP | Đã đặt `trust proxy = 1` trong `main.ts`; thêm một lớp proxy nữa thì phải đổi thành 2 |
| Deploy chậm bất thường | Artifact Registry khác region với Cloud Run | Tạo lại repo đúng `$REGION` |
| Hoá đơn cao hơn ~$9/tháng dù không ai dùng | Cloud SQL tạo sai máy / bật HA / bật PITR, hoặc ảnh Docker dồn | *Overview* của instance: *Machine type* phải là `db-f1-micro`, *Availability* Single zone; kiểm §3 cleanup policy |

---

## 15. Chốt chặn chi phí — và vì sao KHÔNG tắt Cloud SQL lúc nghỉ

**Trong 90 ngày credit, để Cloud SQL chạy liên tục.** Nghe ngược với trực giác "không dùng thì
tắt", nhưng tắt không rẻ hơn: instance đã tắt **vẫn bị tính tiền ổ đĩa và IP công khai**
([tài liệu Google](https://docs.cloud.google.com/sql/docs/postgres/start-stop-restart-instance)),
mà IP lúc tắt (~$0,01/giờ, ⚠ nguồn thứ ba) xấp xỉ giá chính cái máy `db-f1-micro` ($0,01/giờ).
Tắt/bật mỗi ngày chỉ đổi tiền máy lấy tiền IP, cộng thêm việc phải nhớ. Phép tính đầy đủ và các
phương án khác: [ADR-016](adr/016-cloud-sql-thay-neon.md).

Cloud Run service thì tự lo: không ai gọi thì về 0 instance, 0đ.

> [`scripts/gcp-db.sh`](../scripts/gcp-db.sh) (`npm run gcp:off` / `gcp:on` / `gcp:status`) vẫn
> giữ trong repo, **chưa dùng trong giai đoạn credit**. Nó chỉ có ích khi đi kèm việc gỡ IP công
> khai (hướng Private IP ở §16) — lúc đó nó đã làm sẵn nửa việc: dừng Scheduler của worker
> **trước** rồi mới tắt DB, bật thì ngược lại.

**Chốt chặn — kiểm lại sau khi deploy:**

- [ ] Budget **≈ $12 (300.000₫ nếu tài khoản tính bằng VND)**, **hai ô Savings đã bỏ tick** (§1)
- [ ] Cloud SQL là edition **Enterprise**, máy **db-f1-micro**, **Single zone** — Console: trang
      Overview của instance; hoặc
      `gcloud sql instances describe flash-core-db --format='value(settings.tier,settings.edition,settings.availabilityType)'`
- [ ] Point-in-time recovery **tắt**, hai ô giữ backup sau khi xoá **tắt** (§4 bước 5)
- [ ] `--max-instances 2` trên service (trần chi phí **và** trần connection tới Cloud SQL)
- [ ] `--cpu-throttling` (billing request-based — cờ quyết định chi phí lớn nhất của Cloud Run)
- [ ] Cleanup policy của Artifact Registry đã bật, ở chế độ **Delete artifacts**
- [ ] `LOG_LEVEL=info` (không `debug`) trên production
- [ ] Scheduler worker **5 phút**, không phải 1 phút
- [ ] **Ngày hết credit đã ghi vào lịch** — đó là ngày phải chọn lại ở §16

**Nghỉ dài (vài tuần trở lên) thì xoá instance** — cách duy nhất về 0đ. Dữ liệu demo tạo lại qua
giao diện mất 5 phút, schema thì migration tự dựng lại ở lần deploy sau. Console: instance →
**Edit** → *Data protection* → bỏ tick **Prevent instance deletion** → Save → quay lại Overview →
**Delete**. Hoặc:

```bash
gcloud sql instances delete flash-core-db     # rồi làm lại §4 khi quay lại
```

> Tên instance vừa xoá có thể bị giữ tới một tuần — tạo lại ngay thì đặt tên khác (ví dụ
> `flash-core-db-2`) và nhớ sửa biến `GCP_SQL_INSTANCE` + secret `DATABASE_URL`.

---

## 16. Khi $300 credit hết — đổi những gì

Có **đúng một thứ** bắt đầu ra hoá đơn thật: **Cloud SQL**. Upstash vốn dùng gói free (credit
không áp cho nó), cấu hình Cloud Run vốn đã được đặt cho mục tiêu 0đ.

Với Cloud SQL, chọn một trong bốn ([ADR-016 §Khi credit sắp hết](adr/016-cloud-sql-thay-neon.md)):

| Cách | Tiền/tháng (⚠ kiểm lại) | Khi nào chọn |
|---|---|---|
| Giữ nguyên, chạy liên tục | ~$9 | Chấp nhận trả tiền, muốn không phải nghĩ |
| **Private IP cố định**, gỡ IP công khai rồi tắt khi nghỉ (`npm run gcp:off`) | ~$2–3 | Còn học đều; chịu dựng thêm Private Services Access |
| **Xoá instance**, tạo lại khi cần demo | 0đ | Nghỉ dài, hoặc chỉ cần bật lúc phỏng vấn |
| Chuyển về Neon Free | 0đ | Không muốn trả đồng nào |

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

---

## 18. Làm việc nhiều người: hai môi trường và phân quyền

Cấu trúc học theo hệ thống đang chạy ở công ty (OfficeCube), vá thêm ba chỗ hở của nó. Bản đối
chiếu từng mục và lý do: [ADR-017](adr/017-moi-truong-va-phan-quyen-theo-mo-hinh-cong-ty.md).

| | Công ty (OfficeCube) | Flash-Core |
|---|---|---|
| Môi trường | 2 project: dev, prod | 2 project: `flash-core-dev`, `flash-core-prod` |
| Kích hoạt deploy | Tag `v*-dev` / `v*-prod` → Cloud Build | Tag `v*-dev` / `v*-prod` → GitHub Actions |
| Ai duyệt lên prod | **Không ai** — đẩy tag là lên | **Required reviewers** của environment `production` |
| Quyền của người | Không nằm trong code, một cá nhân giữ khoá | **Google Group** + bảng quyền bên dưới |
| Danh tính CI | Mỗi repo × môi trường một build SA | Mỗi project một `github-deployer` (qua WIF) |
| Container đọc secret | Từng secret một | Từng secret một (§7.1c) |
| Khoá file nhạy cảm | Không có CODEOWNERS, không khoá tag | `.github/CODEOWNERS` + ruleset khoá tag `v*-prod` |
| Chặn người ngoài vào app | IAP trước Load Balancer | Không — demo công khai (LB tốn ~$18/tháng) |

### 18.1 Dựng hai project

Làm §2 → §11 **hai lần**, lần lượt với `flash-core-dev` rồi `flash-core-prod`. Hai project dùng
chung một tài khoản billing, nên:

- **Budget ở §1 phủ cả hai** (scope *All projects*) — có dev thì nâng lên **≈ $24 (600.000₫)**,
  vì mỗi project có một Cloud SQL ~$9/tháng.
- Free tier của Cloud Run, Scheduler, Secret Manager, Artifact Registry tính **theo tài khoản
  billing**, hai project **chia nhau** một phần miễn phí. Secret Manager thành 12 version (free 6)
  và Artifact Registry có thể quá 0,5 GB — mỗi thứ vài xu mỗi tháng.

> Dựng tay hai lần là chỗ dễ lệch nhất (công ty tránh bằng Terraform, dự án này chưa dùng — xem
> ADR-017). Làm prod xong, mở **Overview** của hai Cloud SQL và hai Cloud Run service đặt cạnh nhau
> đối chiếu từng dòng.

### 18.2 Nhóm người và quyền

Người **không** được cấp quyền từng cá nhân — cấp cho **group**, thêm/bớt người là thêm/bớt
thành viên group. Tạo ở **groups.google.com → Create group** (tài khoản Gmail thường tạo được;
địa chỉ có dạng `…@googlegroups.com`):

| Group | Ai | Project dev | Project prod |
|---|---|---|---|
| `flash-core-admins@` | Tâm (+ một người dự phòng nếu có) | Owner | Owner |
| `flash-core-devs@` | Người cùng làm | **Editor** — tự do thử | **Viewer** — xem cấu hình, log, metric; **không** đọc được secret, **không** deploy |

Gán quyền: vào đúng project → ☰ → **IAM & Admin → IAM → Grant access** → *New principals* là địa
chỉ group → chọn role → **Save**. Làm cho từng ô trong bảng.

> **Không ai giữ `Cloud Run Admin` ở prod ngoài `github-deployer`.** Muốn lên prod thì đi đường
> tag + duyệt. Đây là bản rút gọn của mẫu công ty: ở đó người chạy Terraform cũng không giữ quyền
> rộng mà *mượn* một deployer SA.
>
> **Owner là lối thoát khẩn cấp (break-glass), không phải quyền dùng hằng ngày.** Group admins
> càng ít người càng tốt, nhưng **ít nhất hai** nếu có thể — một người là bus factor 1, đúng lỗ
> của hệ thống công ty.

### 18.3 Bảo vệ environment `production` trên GitHub

**Settings → Environments → `production`**:

1. Mục **Deployment protection rules** → tick **Required reviewers** → thêm tài khoản được quyền
   duyệt → **Save protection rules**
2. Làm một mình thì **để trống** ô *Prevent self-review* — lúc đó việc duyệt là một cú bấm "chắc
   chưa?" có chủ ý. Có người thứ hai thì tick nó: người đẩy tag không tự duyệt được
3. Mục **Deployment branches and tags** → chọn **Selected branches and tags** → **Add deployment
   branch or tag rule** → *Ref type* **Tag** → *Name pattern* `v*-prod` → **Add rule**
4. Làm tương tự cho environment `dev` nhưng chỉ bước 3, với mẫu `v*-dev` (dev không cần duyệt)

> ⚠ **Repo private trên gói GitHub Free không có Required reviewers** — tính năng này miễn phí cho
> repo **public**. Repo portfolio thường để public nên không vướng.

### 18.4 Khoá tag và nhánh

**Settings → Rules → Rulesets**:

- **New tag ruleset** → *Ruleset name* `khoa-tag-prod` · *Enforcement status* **Active** ·
  *Bypass list* thêm **Repository admin** · *Target tags* → **Add target → Include by pattern** →
  `v*-prod` · tick **Restrict creations**, **Restrict updates**, **Restrict deletions** → **Create**.
  Kết quả: chỉ admin gắn được tag prod, và không ai sửa/xoá được tag prod đã có — lịch sử "phiên
  bản nào đã lên prod" không bị viết lại.
- **New branch ruleset** → *Target branches* **Include default branch** · tick **Require status
  checks to pass** (thêm hai check `Lint · Typecheck · Test` và `Integration test (Postgres + Redis
  thật)`) · tick **Block force pushes** → **Create**.

**[`.github/CODEOWNERS`](../.github/CODEOWNERS)** đã có trong repo, chỉ định người phải duyệt khi
PR đụng vào `deploy.yml`, migration và `src/infra/`. Nó chỉ có tác dụng khi bật **Require a pull
request before merging → Require review from Code Owners** trong branch ruleset — **làm một mình
thì đừng bật**: GitHub không cho tự duyệt PR của mình, bật là tự khoá tay. Có người thứ hai thì
bật một ô đó là xong.

### 18.5 Một vòng phát hành hoàn chỉnh

```bash
# 1. Merge vào main qua PR (CI xanh)
# 2. Lên dev
git checkout main && git pull
git tag v0.2.0-dev && git push origin v0.2.0-dev
# 3. Kiểm trên URL của dev (§11). Ổn thì cùng commit đó lên prod:
git tag v0.2.0-prod && git push origin v0.2.0-prod
# 4. Tab Actions → Review deployments → Approve and deploy
# 5. Phiên bản nào đang ở đâu:
git tag --list 'v*-prod' --sort=-creatordate | head -3
```

> **Cùng một commit, hai tag.** Không build lại code khác cho prod — thứ lên prod là đúng thứ đã
> chạy trên dev. Lùi prod: gắn tag prod mới lên commit cũ (ví dụ `v0.1.1-prod` trỏ vào commit của
> `v0.1.0`) và duyệt, hoặc lùi traffic tại chỗ theo §12.
