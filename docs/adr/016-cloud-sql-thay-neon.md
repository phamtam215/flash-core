# ADR-016: Postgres trên cloud dùng Cloud SQL, để chạy liên tục trong giai đoạn credit — thay Neon

- **Ngày:** 2026-09-26
- **Trạng thái:** Đã chốt (Tâm quyết). **Thay phần "đi qua Neon pooler" của ADR-013** — phần
  pool 5 × max-instances 2 của ADR-013 vẫn giữ nguyên.

## Bối cảnh

Phase 7 chốt Neon Free cho Postgres vì mục tiêu **0đ/tháng vĩnh viễn** (quyết định #12 ở
`project-context.md`): Neon tự ngủ sau 5 phút rảnh, Cloud SQL thì không có gói free và tính
tiền theo **giờ máy bật**, không theo lượng dùng.

Nhưng môi trường cloud của dự án là **môi trường để thử**, không phải production. Và Tâm muốn
học đúng dịch vụ mà công ty thật dùng (OfficeCube chạy Cloud SQL), trong lúc còn $300 credit.

## Quyết định

**Cloud SQL for PostgreSQL 16**, edition **Enterprise**, máy **`db-f1-micro`** (Shared core,
0,614 GB), region `us-central1` (cùng Cloud Run), IP công khai với danh sách IP được phép để
trống.

**Trong 90 ngày credit: để instance chạy liên tục, không tắt/bật.** Gần hết credit thì quyết
lại theo hoá đơn thật (§Khi credit sắp hết).

Nối DB bằng **Cloud SQL connector** (Unix socket `/cloudsql/...`): Cloud Run gắn qua
`--set-cloudsql-instances`, bước migrate trên GitHub runner đi qua **Cloud SQL Auth Proxy**.
Không còn cặp chuỗi pooled/direct — chỉ một đường.

## Vì sao KHÔNG tắt/bật — bản đầu của ADR này đã sai chỗ này

Bản đầu (cùng ngày) chốt "tắt bằng tay khi nghỉ, ước ~$2–3/tháng". Đối chiếu lại thì sai:
**instance đã tắt vẫn bị tính tiền ổ đĩa *và* IP** ([tài liệu Google](https://docs.cloud.google.com/sql/docs/postgres/start-stop-restart-instance)).
IP công khai lúc máy tắt tốn khoảng **$0,01/giờ** (⚠ theo nguồn thứ ba, chưa thấy số trên
trang giá chính thức) — gần bằng giá chính cái máy `db-f1-micro` ($0,01/giờ, đọc trên form tạo
instance ngày 2026-09-26).

| Cách | Tiền/tháng (⚠ ước lượng) | Ghi chú |
|---|---|---|
| **Chạy liên tục** ⭐ | ~$9 (máy ~$7,3 + ổ 10 GB ~$1,7) | Không có gì phải nhớ |
| Tắt khi nghỉ, giữ IP công khai | ~$9 (IP lúc tắt ~$7,3 + ổ ~$1,7 + giờ máy lúc học) | **Không rẻ hơn** — tốn công vô ích |
| Tắt khi nghỉ + gỡ IP công khai, dùng Private IP cố định | ~$2–3 | Phải dựng Private Services Access, tắt/bật chậm hơn 1–2 phút |
| Xoá instance khi nghỉ dài | 0đ | Tạo lại ~15 phút; tên instance vừa xoá có thể bị giữ tới một tuần |
| Quay về Neon Free | 0đ | Mất các lợi ích bên dưới |

$9/tháng × 3 tháng ≈ $27 trên $300 credit. Thêm một lớp mạng (Private IP) ngay lúc chưa deploy
được lần nào để tiết kiệm con số đó là sai thứ tự ưu tiên.

## Vì sao KHÔNG cần pooler nữa

ADR-013 cần PgBouncer vì Neon Free giới hạn connection chặt. `db-f1-micro` cho `max_connections
= 25` (⚠ kiểm lại), trần của dự án là API 5 × 2 instance = 10, worker job 5, migrate/`make-admin`
1–2 ⇒ **≤ 17**. Hết pooler thì **migrate không còn phải đi đường riêng** — lý do advisory lock
mức session của ADR-013 biến mất cùng pooler.

## Hệ quả & trade-off chấp nhận

**Được:** học đúng dịch vụ doanh nghiệp dùng; DB cùng mạng với app (không còn vài chục ms mỗi
lần hỏi-đáp — quan trọng với pessimistic lock, vì khoá bị giữ suốt các lần hỏi-đáp đó); không
còn cold start của DB; không còn "chạm hạn mức là DB treo".

**Mất:**

- **~$9/tháng credit**, và **mục tiêu "0đ/tháng vĩnh viễn" của quyết định #12 hết đúng** — sau
  credit thì hoặc trả tiền, hoặc đổi cách (bảng trên).
- **Deploy SA thêm role thứ 5** (`cloudsql.client`, cho proxy trên runner). Đi ngược "đúng 4
  role" của ADR-014 một bậc — chấp nhận vì role này chỉ cho *nối vào* instance, không cho sửa.
- **Form tạo instance mặc định rất đắt** (preset Production, rồi preset Sandbox vẫn là máy
  2 vCPU ≈ $100/tháng). Một lần bấm nhầm đáng giá cả năm tiền `db-f1-micro` — hướng dẫn deploy
  §4 có ảnh chụp từng ô phải sửa.

## Khi credit sắp hết — và điều gì khiến quyết định này sai

- **Ngày hết credit**: chọn lại một dòng trong bảng trên. Còn học đều → Private IP + tắt/bật
  (`scripts/gcp-db.sh` đã có sẵn nửa việc). Học thưa → xoá instance. Không muốn trả đồng nào →
  Neon (cấu hình cũ còn trong git ở commit trước ADR này).
- **Hoá đơn Cloud SQL một tháng vượt ~$12** ⇒ đã có thứ bị tạo sai (máy to, HA, PITR). Dấu hiệu:
  budget 300.000₫ kêu. Kiểm *Overview* của instance: *Edition* và *Machine type*.
- **`too many connections`** trong log ⇒ phép cộng ≤ 17 ở trên sai (thường vì ai đó nới
  `max-instances` hay `DATABASE_POOL_MAX`). Đo bằng `SELECT count(*) FROM pg_stat_activity`.

## Liên quan

[ADR-013](013-pool-nho-tren-serverless.md) (pool) ·
[ADR-014](014-workload-identity-federation.md) (role của deploy SA) ·
[hướng dẫn deploy §4 và §15](../huong-dan-deploy-gcp.md) ·
[`deploy.yml`](../../.github/workflows/deploy.yml)
