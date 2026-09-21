# Spec: Phase 7 — Deploy GCP, FinOps & CI/CD

- **Phase:** 7
- **Ngày:** 2026-09-21
- **Trạng thái:** Draft — chờ Tâm duyệt (có 4 câu hỏi mở ở cuối, chưa quyết thì chưa code)

> **Quan hệ với [`phase7-deploy-finops.md`](phase7-deploy-finops.md) — đọc trước khi dùng.**
> File kia là **hợp đồng đã implement** (Dockerfile, `deploy.yml`, `worker-once.ts`, ADR-012)
> và là nguồn sự thật cho *phase này đã làm gì*. File này ra đời song song, cùng ngày, và
> hiện **trùng vai một phần** — vi phạm luật một chủ sở hữu. Phần **không** trùng, tức phần
> đáng giữ lại: các phép tính FinOps theo đơn vị thật, cấu hình Cloud Run nên đặt gì, bảng
> tra theo triệu chứng, và những cái bẫy vận hành rút từ một hệ thống GCP đang chạy thật.
> **Tâm quyết:** gộp phần đó vào `phase7-deploy-finops.md` + `tech-playbook.md` §Phase 7 rồi
> xoá file này, hay giữ riêng. Tôi không tự gộp vì luồng kia đang sửa cùng lúc.
>
> **Nguồn của phần "bẫy vận hành":** bộ tài liệu học hạ tầng của dự án OfficeCube
> (`officecube-renewal/docs/cloud-learning/`) — một hệ thống GCP thật đang chạy: Cloud Run +
> External LB + IAP + Cloud SQL + Cloud Build + Secret Manager, có ảnh chụp Console kèm số
> đo. Chỉ đọc, không sửa gì bên đó. Kiến thức được **dịch sang bài toán của Flash-Core**, chứ
> không chép: OfficeCube là app nội bộ sau IAP, traffic đều, chấp nhận trả tiền; Flash-Core
> là demo public, traffic bùng theo đợt, ràng buộc 0đ. Nhiều chỗ *cùng một dịch vụ, cấu hình
> đúng lại ngược nhau* — những chỗ đó được ghi rõ.

## Mục tiêu

Đưa Flash-Core lên GCP sao cho **hoá đơn cuối tháng đúng 0đ**, API demo được bằng một
đường link, và mỗi lựa chọn hạ tầng là một câu trả lời phỏng vấn có số liệu đằng sau.

Hai mục tiêu này kéo ngược nhau, và **chính chỗ kéo ngược là phần học được nhiều nhất**:
kiến trúc hiện tại (worker process riêng, poll outbox mỗi giây — ADR-005) là kiến trúc
*đúng về nghiệp vụ* nhưng **đốt sạch free tier trong 1–4 ngày**. Phase 7 phải giải bài đó
mà không phá tính đúng đắn đã chứng minh ở Phase 3–4.

## Ràng buộc

- 0đ/tháng. Budget alert **$1** bật ngay ngày đầu, trước khi tạo bất cứ tài nguyên nào.
- Region **us-central1** — free tier Cloud Run chỉ có ở us-central1 / us-east1 / us-west1.
- k6 và seed 100k **không bao giờ** bắn lên cloud (đã có hook `guard_cloud_cost.py` chặn).
- Không thêm công nghệ mới ngoài dịch vụ GCP cần cho việc deploy (project-context §3 mục 13).

## Sơ đồ hạ tầng đích

```diagram
                   người xem demo                        Tâm (máy local)
                         │                                      │
                         │ HTTPS                                │ git push
                         ▼                                      ▼
            ┌────────────────────────────┐            ┌──────────────────────┐
            │  Cloud Run SERVICE  «api»  │            │   GitHub Actions     │
            │  min=0  max=2  conc=80     │◀───deploy──│  ci.yml + deploy.yml │
            │  dist/main.js  :8080       │            │  (WIF, không key)    │
            └──────┬──────────────┬──────┘            └──────────┬───────────┘
                   │              │                              │ push image
                   │              │                              ▼
                   │              │                   ┌──────────────────────┐
                   │              │                   │  Artifact Registry   │
                   │              │                   │  cleanup: giữ 3 tag  │
                   │              │                   └──────────┬───────────┘
                   │              │                              │ pull
                   │              │                   ┌──────────▼───────────┐
                   │              │   ┌──cron 5'─────▶│ Cloud Run JOB «work» │
                   │              │   │               │  chạy-một-lượt-rồi-  │
                   │              │   │               │  thoát, dist/worker  │
                   │              │   │               └──────┬──────┬────────┘
                   │              │   │                      │      │
                   │              │  ┌┴──────────────┐       │      │
                   │              │  │Cloud Scheduler│       │      │
                   │              │  │ 3 job (free)  │       │      │
                   │              │  └───────────────┘       │      │
                   ▼              ▼                          ▼      ▼
         ┌──────────────┐  ┌──────────────┐        ┌──────────────┐ │
         │  Neon Free   │  │ Upstash Free │◀───────┘              │ │
         │  PG 16       │  │ Redis 256MB  │                       │ │
         │  0.5GB/100h  │  │ 500k lệnh/th │◀──────────────────────┘ │
         │  -pooler ⇄ direct              │                         │
         └──────────────┘  └──────────────┘◀────────────────────────┘
                   ▲
                   │ migrate deploy (endpoint DIRECT, không qua pooler)
                   └────────────── GitHub Actions, bước riêng trước khi deploy

         Secret Manager ──(6 secret)──▶ Cloud Run service + job
         Cloud Logging  ◀──stdout JSON── cả hai (50 GiB/tháng free)
```

## Bài toán #1 — worker luôn thức là thứ giết free tier

Đây là phát hiện quan trọng nhất của phase, và nó không nằm trong SPEC.md gốc.

**Phép tính, dựa trên code đang chạy:**

| Nguồn đốt | Cơ chế trong code | Hệ quả trên free tier |
|---|---|---|
| Outbox relay | `OUTBOX_POLL_INTERVAL_MS=1000` → 86.400 query/ngày | Neon **không bao giờ** autosuspend (ngưỡng 5 phút idle) ⇒ 720 compute-giờ/tháng so với hạn mức **100** ⇒ **hết trong ~4,2 ngày**, rồi hard cutoff: DB treo |
| BullMQ worker | blocking wait + quét delayed set liên tục | ước ~2–5 lệnh/giây lúc rảnh ⇒ 5–13 triệu lệnh/tháng so với hạn mức **500.000** ⇒ **hết trong ~1–3 ngày** |
| Sweeper huỷ đơn | job lặp, nhịp ngắn | cộng thêm vào cả hai dòng trên |

Con số vế "đốt" là ước lượng phải **đo lại** bằng dashboard Upstash/Neon trong 24h đầu —
nhưng bậc độ lớn đủ rõ để kết luận: **không thể nuôi một worker luôn thức ở 0đ.**

**Và Cloud Run còn một cái bẫy riêng giết luôn phương án "gộp worker vào API":** ngoài lúc
đang xử lý request, Cloud Run **cắt CPU** của container (CPU throttling). Một `setInterval`
poll outbox sẽ bị đóng băng giữa chừng và chỉ nhúc nhích khi tình cờ có request đi vào.
Bật "CPU always allocated" thì mất scale-to-zero, tức mất 0đ.

**Bốn phương án:**

| | Cách làm | Tiền | Mất gì |
|---|---|---|---|
| A ⭐ | **Cloud Run Job + Cloud Scheduler**, worker đổi sang *chạy-một-lượt-rồi-thoát*: quét outbox một lô, chạy sweeper, xử lý job đang chờ, rồi `exit 0`. Cron 5 phút | 0đ — 288 lần/ngày × ~10s ≈ 86.400 vCPU-giây/tháng (hạn mức 180.000); Neon chỉ thức ~24 giờ/tháng | Email chậm tối đa 5 phút. Chấp nhận được: đơn giữ chỗ 15 phút, sweeper 5 phút vẫn đúng hợp đồng |
| B | Gộp worker vào API bằng cờ `WORKER_INLINE` | 0đ trên giấy | **Không chạy được**: CPU throttling + scale-to-zero ⇒ không có instance thì không ai xử lý job. Đã loại ở ADR-005, Phase 7 xác nhận loại vì lý do mới |
| C | Cloud Run service thứ hai, `min-instances=1`, CPU always on | ~$10–15/tháng | Mất mục tiêu 0đ |
| D | Không deploy worker; demo job nền chạy local | 0đ | Link demo không có luồng async — mất đúng phần khó nhất của dự án |

**Khuyến nghị: A.** Nó buộc phải viết một entrypoint "một lượt" (`src/worker-once.ts`) —
khác `src/worker.ts` ở chỗ không mở `Worker` chờ mãi mà gọi thẳng processor cho tới khi hàng
rỗng rồi thoát. Đây là kiến thức thật: *job nền trên serverless không phải daemon, mà là
hàm có điểm kết thúc.* Cần **ADR-012** vì nó sửa lại giới hạn "tới hết Phase 6" của ADR-005.

## Bài toán #2 — nối Postgres từ serverless

- Neon cho hai endpoint: **`-pooler`** (PgBouncer, transaction mode) và **direct**.
- **Runtime dùng `-pooler`.** `SELECT FOR UPDATE` của chiến lược pessimistic vẫn đúng: cả
  transaction đi trọn trên một server connection. `LISTEN/NOTIFY` và session-level advisory
  lock thì không qua được pooler — dự án không dùng cái nào, ghi ra để sau này không vấp.
- **`prisma migrate deploy` dùng endpoint direct.** Pooler không chịu được DDL + advisory
  lock mà Prisma dùng để khoá migration.
- **Migrate chạy ở CI, không chạy lúc container khởi động.** Cloud Run có thể bật nhiều
  instance cùng lúc; ba instance cùng chạy migrate là một cuộc đua không cần thiết.
- `DATABASE_POOL_MAX` × `max-instances` là trần connection. Đề xuất **pool 5 × max 2 = 10**.
  Cần **ADR-013** chốt con số và lý do (đây cũng là nơi trả lời câu "connection pooling với
  serverless" trong SPEC.md).

## Bài toán #3 — cold start và giờ mở bán

min-instances=0 ⇒ request đầu tiên phải chờ container khởi động (ước 2–5 giây với image
Node ~200MB, **phải đo thật** và dán số vào §Bằng chứng).

Với flash sale, cold start rơi đúng vào giây đầu tiên của đợt sale — tệ nhất có thể. Cách
giữ 0đ mà vẫn ấm: **Cloud Scheduler ping `/health` mỗi 10 phút trong khung giờ demo**, hoặc
một job cron chạy 5 phút trước giờ mở bán. Đây là câu trả lời FinOps hoàn chỉnh: *biết
min-instances giải quyết được, biết nó tốn tiền, và chọn cách rẻ hơn cho đúng bài toán demo.*

**Cái bẫy của chính cách trị này:** ping đều = instance không bao giờ ngủ = đúng bằng
`min-instances=1` trá hình (xem phép tính ở Bài toán #4). Nên ping **chỉ bật trong khung giờ
demo rồi tắt**, không để chạy 24/7. Cùng lý do đó, **Cloud Monitoring uptime check** — công
cụ "biết hỏng trước khi người dùng báo", và hay được khuyên bật từ nhiều vùng địa lý — ở đây
phải dùng dè: mỗi lần check là một request thật, đặt nhịp 1 phút × 4 vùng là tự tay giữ
container sống suốt tháng. Đề xuất: **1 uptime check, 1 vùng, nhịp 15 phút**, đủ để biết API
chết mà không phá ngân sách.

## Bài toán #4 — hoá đơn thật sự tính theo cái gì

Free tier Cloud Run nghe rất rộng cho tới khi đổi đơn vị: **180.000 vCPU-giây = 50 giờ CPU
mỗi tháng**. Một instance 1 vCPU sống liên tục cả tháng là 720 giờ — **vượt 14 lần**. Nghĩa
là mọi thứ giữ container thức (min-instances, ping đều, uptime check dày, worker nền) đều
không phải "tối ưu nhỏ" mà là **quyết định chi tiền**.

Và có một công tắc quyết định hơn cả: **cách tính tiền của service**.

| | Tính tiền lúc nào | Hệ quả |
|---|---|---|
| **Request-based** ⭐ | chỉ trong lúc đang xử lý request | Rẻ nhất khi app rảnh nhiều. Đổi lại **CPU bị cắt ngoài request** — đây chính là thứ giết phương án gộp worker vào API ở Bài toán #1 |
| Instance-based | toàn bộ vòng đời instance, kể cả lúc rảnh và lúc chạy tác vụ nền sau khi đã trả response | Đắt hơn nhiều ở app ít traffic, nhưng CPU luôn được cấp |

**Chọn request-based cho service `api`.** Ước lượng: 2 triệu request × ~100ms ≈ 200.000
vCPU-giây — đã sát trần 180.000, nên con số đáng theo dõi không phải "bao nhiêu request" mà
**"tổng thời gian CPU"**. Hai đòn bẩy rẻ nhất để kéo nó xuống: `--concurrency` cao (nhiều
request chia nhau một instance) và **response nhanh** (mỗi 10ms cắt được là vài giờ CPU/tháng).

*(Bài học lấy từ hệ thống OfficeCube: ở đó service đang để instance-based và max-instances=20
— hoàn toàn hợp lý cho một app nội bộ có traffic đều, nhưng là lựa chọn ngược hẳn với bài
toán 0đ ở đây. Cùng một dịch vụ, hai cấu hình đúng khác nhau vì ràng buộc khác nhau.)*

## Bài toán #5 — deploy hỏng: hai kiểu "đỏ" hoàn toàn khác nhau

Đây là bài học đắt nhất rút từ hệ thống OfficeCube, và nó áp thẳng vào `deploy.yml` của
Flash-Core vì pipeline cũng có đúng thứ tự **build → migrate → deploy**.

| Đỏ ở đâu | Database | Người dùng thấy | Phải làm gì |
|---|---|---|---|
| **Migrate** | đã đổi **một phần**, kẹt giữa hai schema | không thấy gì — traffic chưa rời revision cũ | **Dừng. Đọc log.** Không bấm chạy lại một cách mù quáng: chạy lại một migration đã áp dụng dở có thể hỏng nặng hơn |
| **Deploy** | đã đổi **xong** | không thấy gì — revision cũ vẫn giữ 100% traffic | Nhẹ hơn nhiều. Nhưng hệ thống đang ở trạng thái **schema mới + code cũ** — phải sửa nhanh, vì code cũ không biết cột mới |

**Và cái bẫy lớn nhất, đúng chỗ ai cũng tưởng đã an toàn:** rollback Cloud Run chỉ đưa
*code* về revision cũ — **schema database không lùi theo**. Nghĩa là **revision cũ bắt buộc
phải chạy được với schema mới**. Hệ quả thành một luật viết migration:

> **Migration phải additive.** Thêm cột (nullable hoặc có default), thêm bảng, thêm index —
> được. Xoá cột, đổi kiểu, đổi tên trong cùng một lần deploy — **không**, vì nó biến rollback
> thành đường một chiều. Muốn xoá thì tách hai lần deploy: lần 1 code thôi dùng cột, lần 2
> mới xoá cột (expand → contract).

Flash-Core sắp va đúng chỗ này: Phase 3 đã thêm `ProductSku.version`, Phase 4 thêm 3 bảng +
3 cột, và vừa có migration `add_user_role`. Tất cả đều additive — **may hơn khôn**, nên chốt
thành luật trước khi có cái đầu tiên không additive.

**Neon không có Point-in-time recovery ở gói Free** (⚠ kiểm lại). Nghĩa là nếu một migration
phá dữ liệu, không có nút lùi về "giây trước khi chạy". Trước mỗi migration có `DROP` hoặc
đổi kiểu: **tự tay snapshot/branch trước**, coi như một bước của quy trình, không phải tuỳ hứng.

## Bài toán #6 — bảy cái bẫy vận hành, rút từ hệ thống đang chạy thật

Mỗi dòng dưới đây là một thứ đã thật sự xảy ra hoặc đang tồn tại trên hạ tầng OfficeCube.
Ghi ra để Flash-Core không phải học lại bằng trải nghiệm.

1. **Đổi secret KHÔNG tự áp dụng.** Secret Manager có giá trị mới, nhưng container đang chạy
   vẫn giữ giá trị cũ cho tới khi **deploy lại**. Triệu chứng kinh điển: "tôi đổi rồi mà sao
   vẫn sai". Cho vào runbook như một bước, không phải một ghi chú.
2. **Artifact Registry phải cùng region với Cloud Run.** OfficeCube build ảnh ở Osaka trong
   khi chạy ở Tokyo ⇒ mỗi lần deploy kéo ảnh xuyên vùng, chậm hơn mà không ai để ý. Flash-Core:
   repo đặt **us-central1**, đúng region service.
3. **Bật immutable tags.** Mặc định một tag có thể bị ghi đè bởi lần push sau — nghĩa là
   `v1.2.3` hôm nay và `v1.2.3` tuần sau có thể là hai ảnh khác nhau, và không còn cách nào
   biết bản đang chạy là bản nào.
4. **Cache layer cũng chiếm dung lượng.** OfficeCube: 12,5 GB và tăng mãi vì **không có
   cleanup policy** sau hơn 150 lần deploy. Với free tier 0,5 GB thì đây không phải "sau này
   tính" mà là thứ phải bật ngay từ ngày đầu — và policy phải tính cả ảnh cache, không chỉ ảnh
   runtime.
5. **"IP allowlist trống" ≠ đóng cửa.** Cloud SQL của OfficeCube bật Public IP với
   Authorized networks trống, và tài liệu cũ ghi là "an toàn". Chính xác hơn: an toàn trước
   quét cổng ngẫu nhiên, **không** an toàn trước một danh tính hợp lệ bị lộ — vì đường
   xác thực bằng danh tính đi vòng qua hẳn lớp kiểm tra IP. Áp cho Flash-Core: **Neon được
   bảo vệ bằng chuỗi kết nối, không bằng IP.** Chuỗi lộ là vào được từ bất kỳ đâu. Nên
   `DATABASE_URL` nằm ở Secret Manager, không nằm trong `vars`, và không bao giờ vào log.
6. **Ai sửa được workflow thì kiểm soát cả project.** Ở OfficeCube, service account deploy
   mang gần 20 role admin — nên "bảo vệ quyền sửa trigger CI còn quan trọng hơn bảo vệ chính
   service account đó". Flash-Core giữ SA deploy ở đúng 4 role, và coi
   **`.github/workflows/deploy.yml` là file nhạy cảm nhất repo** — sửa nó = sửa quyền chạy.
7. **Cái đang chạy nhiều hơn cái được vẽ.** Bảng *Enabled APIs & services* của OfficeCube lộ
   ra Maps API, Places API và Firebase Auth — không sơ đồ kiến trúc nào có. Sau khi deploy,
   mở đúng trang đó một lần: nó trả lời "mình đang thực sự gọi gì và trả tiền cho gì", và là
   cách nhanh nhất phát hiện **thứ mình không biết là mình không biết**.

## Cấu hình Cloud Run service

| Cờ | Giá trị | Vì sao |
|---|---|---|
| `--region` | us-central1 | free tier chỉ ở đây |
| `--min-instances` | 0 | điều kiện của 0đ |
| `--max-instances` | **2** | trần chi phí *và* trần connection tới Neon. Đây là cái van an toàn quan trọng nhất |
| `--concurrency` | 80 | Node xử lý I/O-bound tốt; giảm số instance ⇒ giảm vCPU-giây |
| `--cpu` / `--memory` | 1 / 512Mi | dưới 512Mi Prisma + WASM query compiler dễ OOM lúc khởi động |
| `--timeout` | 30s | request của dự án đều dưới 1s; timeout dài chỉ kéo dài hoá đơn khi có sự cố |
| `--port` | 8080 | Cloud Run tiêm `PORT=8080`; `main.ts` đã đọc `env.PORT` và listen `0.0.0.0` — không phải sửa gì |
| `--no-allow-unauthenticated` | **không dùng** | demo cần public |
| startup probe | `GET /ready` | đúng ngữ nghĩa: sẵn sàng nhận traffic chưa |
| liveness probe | `GET /health` | Postgres chết **không** được làm Cloud Run restart container — đã chốt từ spec Phase 0 |

**Một chỉnh quan trọng so với hình dung hiện có trong code:** Cloud Run **không có readiness
probe điều khiển routing** như Kubernetes. Khi thay revision, nó tự ngừng gửi request rồi mới
bắn SIGTERM, và chỉ cho khoảng **10 giây** trước SIGKILL. Nghĩa là `SHUTDOWN_GRACE_MS=5000`
là hợp lý và **không được tăng quá ~8000**, nếu không container bị giết giữa lúc đang đóng
pool. Ghi vào playbook khi làm.

## Bí mật: cái nào vào Secret Manager

Secret Manager free tier chỉ cho **6 secret version *active*** (⚠ kiểm lại). Dự án có đúng 6
giá trị nhạy cảm — vừa khít, nên **mỗi lần xoay khoá phải destroy version cũ**, nếu không
version thứ 7 bắt đầu tính tiền.

| Vào Secret Manager | Env thường trên Cloud Run |
|---|---|
| `DATABASE_URL` (bản `-pooler`) | `NODE_ENV=production`, `PORT` (Cloud Run tự tiêm) |
| `REDIS_URL` | `LOG_LEVEL=info` |
| `JWT_ACCESS_SECRET` | `DATABASE_POOL_MAX=5` |
| `JWT_REFRESH_SECRET` | `INVENTORY_STRATEGY=pessimistic` (số Phase 3 cho thấy nó nhanh nhất khi đa số request là "hết hàng") |
| `PAYMENT_WEBHOOK_SECRET` | `COOKIE_SECURE=true` ← **bắt buộc**, HTTPS thật |
| `CSRF_SECRET` | `QUEUE_PREFIX=prod` ← tách hẳn không gian job khỏi máy dev |
| — | `METRICS_ENABLED=?` ← xem câu hỏi mở #3 |
| — | `DATABASE_URL_DIRECT` (chỉ CI dùng, không gắn vào service) |

## Dockerfile (đề xuất — chưa tạo, đang chờ duyệt)

Multi-stage, ba tầng. Điểm đáng nhớ nằm ở chỗ **`npm run db:generate` phải chạy trong build**
(Prisma Client sinh vào `src/generated/`, không có trong git), và **`public/` phải được copy**
vì `main.ts` phục vụ trang demo từ đó.

```dockerfile
# 1. deps — cache riêng, chỉ đổi khi package-lock đổi
FROM node:24-alpine AS deps
WORKDIR /app
COPY package*.json ./
RUN npm ci

# 2. build — generate Prisma Client rồi nest build
FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN npm run db:generate && npm run build && npm prune --omit=dev

# 3. runtime — image cuối, không có mã nguồn .ts
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/public ./public
COPY --from=build /app/prisma ./prisma
USER node
CMD ["node", "dist/main.js"]
```

`.dockerignore` hiện có đã đúng (loại `node_modules`, `dist`, `.env`, `docs`, `*.md`).
Một image, hai entrypoint: service chạy `dist/main.js`, job ghi đè bằng
`--command node --args dist/worker-once.js`. **Không build hai image** — cùng một artifact
chạy ở hai vai là cách kiểm chứng "cùng một build đã test".

## CI/CD

Hai workflow, tách bạch:

- **`ci.yml`** (đã có): lint → typecheck → unit test → build. **Nợ phải trả ở phase này:**
  file này vẫn ghi "integration test sẽ bật ở Phase 3" — giờ là Phase 7 và vẫn chưa bật.
  Thêm job `integration` dùng **service containers** của GitHub Actions (postgres:16 +
  redis:7) thay vì Testcontainers: nhanh hơn và khớp với lối thoát `TEST_DATABASE_URL` /
  `TEST_REDIS_URL` mà `test/infra-fixture.ts` đã có sẵn.
- **`deploy.yml`** (mới): chạy sau khi `ci.yml` xanh trên `main` →
  `auth` (WIF) → build & push image → `prisma migrate deploy` (endpoint **direct**) →
  `gcloud run deploy` → `gcloud run jobs update` → smoke test `GET /health` trên URL thật →
  **hỏng thì `gcloud run services update-traffic --to-revisions=<trước>=100`**.

**Xác thực bằng Workload Identity Federation, không bao giờ tạo service-account key JSON.**
GitHub Actions đổi OIDC token của chính nó lấy access token ngắn hạn của GCP. 0đ, và là thứ
đáng kể nhất trong phần bảo mật hạ tầng khi phỏng vấn: *không có bí mật dài hạn nào để lộ.*
Cần **ADR-014**.

Service account cho deploy chỉ được 4 role: `run.admin`, `artifactregistry.writer`,
`iam.serviceAccountUser`, `secretmanager.secretAccessor` — least privilege, đúng mục đã có
tên trong `glossary.md`.

## Bảy chốt chặn chi phí

1. **Budget alert $1** trên billing account — làm trước mọi thứ khác.
2. `--max-instances=2` trên service; `--max-retries=1` + `--task-timeout=120s` trên job.
3. **Cleanup policy Artifact Registry**: giữ 3 tag mới nhất, xoá untagged > 7 ngày
   (free 0,5 GB — vài image Node là chạm, ⚠ kiểm lại hạn mức).
4. Neon: bật autosuspend 5 phút (mặc định) và **đừng để thứ gì poll nó**.
5. Cloud Logging **exclusion filter** cho log `debug` trên production; `LOG_LEVEL=info`.
6. Hook `guard_cloud_cost.py` đã chặn k6/seed khi biến kết nối trỏ ra cloud — giữ nguyên.
7. **Xoá tài nguyên sau khi quay video demo** nếu nghỉ dài: Cloud Run 0 instance là 0đ,
   nhưng Neon vẫn tính storage khi vượt 0,5 GB.

## Các bước setup, theo thứ tự

1. Bật billing → **tạo budget alert $1** → xác nhận email cảnh báo đã tới.
2. `gcloud projects create flash-core-demo` → bật API: `run`, `artifactregistry`,
   `secretmanager`, `cloudscheduler`, `iamcredentials`.
3. Tạo Neon project (region gần us-central1: AWS **us-east-1** hoặc **us-east-2**) và
   Upstash database (cùng us-east-1) → lấy cả hai chuỗi kết nối Neon.
4. Đẩy 6 secret vào Secret Manager.
5. Tạo Artifact Registry repo `flash-core` + cleanup policy.
6. Tạo service account deploy + Workload Identity Pool, gắn 4 role.
7. Viết `Dockerfile`, build local, `docker run` thử với biến trỏ vào Docker Compose local.
8. `deploy.yml` → merge → xem revision đầu tiên lên.
9. `prisma migrate deploy` (qua CI, endpoint direct) → tạo dữ liệu demo **nhỏ**
   (≤ 20 SKU — không phải seed 100k).
10. Tạo Cloud Run Job + 2 Cloud Scheduler (worker 5 phút, warm-up 10 phút khi demo).
11. Chạy §Test cases dưới đây, dán số đo vào §Bằng chứng.

## Edge cases bắt buộc xử lý

- [ ] Neon đang suspend → request đầu chờ DB wake (~500ms–3s): `/ready` không được báo chết
- [ ] Cloud Run scale 0→1 giữa lúc có người đang xem trang: polling tồn kho không được vỡ
- [ ] Hai instance cùng chạy → `Idempotency-Key` và `WHERE status='PENDING'` vẫn là trọng tài
- [ ] Job worker chạy chồng nhau (lần trước chưa xong, cron đã kích lần sau)
- [ ] Deploy revision mới giữa lúc có request đang bay → không được 5xx
- [ ] `prisma migrate deploy` fail giữa chừng → deploy phải dừng, **không** đẩy image mới
- [ ] Neon chạm hard cutoff → app trả 503 có nghĩa, không phải stack trace
- [ ] Secret xoay khoá → `CSRF_SECRET` mới không được làm người dùng bị đăng xuất

## Test cases phải pass

1. `GET /health` trên URL thật → 200, đo **cold start** (số giây) và **warm** (ms)
2. `GET /ready` → 200; ngắt Neon (suspend) → vẫn phải đúng ngữ nghĩa, không restart container
3. Đăng ký → đăng nhập → săn → thanh toán → `PAID`, chạy trọn trên cloud bằng trang demo
4. Cookie trả về có `Secure` + `HttpOnly` + `SameSite` (kiểm bằng DevTools trên HTTPS thật)
5. 20 request song song vào 1 SKU còn 5 cái → đúng 5 đơn, `stock=0`, 15 lần 409 (**quy mô
   nhỏ, không phải load test** — ràng buộc FinOps)
6. Đặt đơn rồi không trả tiền → Cloud Run Job chạy → đơn về `CANCELLED`, tồn kho trả lại đúng
   một lần
7. Outbox: tạo 20 đơn, xem job chạy hai nhịp → `outbox` còn chờ = 0, email đúng 20
8. Deploy revision mới trong lúc có request → 0 lỗi 5xx
9. Rollback: `update-traffic` về revision trước → API sống lại trong < 60s
10. Xoay `CSRF_SECRET` → người đang đăng nhập vẫn dùng được (token phát lại ở request kế)
11. Sau 48h chạy: Neon compute-giờ và Upstash lệnh **đo thật**, đối chiếu phép tính ở §Bài
    toán #1 — đây là bằng chứng FinOps, không phải số dự đoán
12. Budget alert: xác nhận email đã nhận được ít nhất một báo cáo

## Ngoài phạm vi (Non-goals)

- Custom domain, Cloud CDN, Cloud Armor — demo dùng thẳng URL `*.run.app`
- Managed Prometheus / Cloud Trace (tốn tiền; `/metrics` vẫn phục vụ đo local)
- Terraform / IaC — 11 bước setup làm tay một lần, làm tay rồi mới hiểu Terraform sinh ra gì
- Multi-region, blue-green thủ công — Cloud Run revision đã cho rollback
- Load test trên cloud — vĩnh viễn không

## Câu hỏi mở cho Tâm quyết

1. **Worker deploy theo phương án nào?** Khuyến nghị **A** (Cloud Run Job + Scheduler, viết
   thêm `worker-once.ts`). Chọn A thì Phase 7 có thêm việc code, không chỉ cấu hình.
2. **Nhịp cron của worker job:** 5 phút (email trễ ≤ 5') hay 1 phút (trễ ≤ 1', tốn ~5×
   vCPU-giây, vẫn trong hạn mức)? Khuyến nghị **5 phút**, hạ xuống 1 phút khi quay video.
3. **`METRICS_ENABLED` trên cloud:** `false` (không ai scrape, đỡ lộ bề mặt) hay `true` (để
   `curl /metrics` làm cảnh quay demo)? Khuyến nghị **`true` trong lúc demo, `false` sau đó**.
4. **Bật integration test trong `ci.yml` ngay phase này?** Khuyến nghị **có** — nó là món nợ
   ghi từ Phase 0 và là phần Tâm tự nhận yếu nhất (playbook §Xuyên suốt — CI & Testing).

## Kiến thức sẽ ghi vào `tech-playbook.md` §Phase 7 (không viết ở spec này)

CPU throttling của Cloud Run và vì sao nó giết job nền · daemon vs chạy-một-lượt trên
serverless · PgBouncer transaction mode giữ được gì và mất gì · vì sao migrate không chạy lúc
khởi động container · Workload Identity Federation thay key JSON · cold start và ba cách trị
(kèm giá) · đọc hoá đơn GCP: chi phí phát sinh đầu tiên xuất hiện ở đâu.

## Bằng chứng (điền khi implement xong)

*(URL revision, số cold start đo được, ảnh dashboard Neon/Upstash sau 48h, ảnh email budget
alert, log một lần rollback.)*
