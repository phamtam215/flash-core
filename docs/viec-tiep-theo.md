# Việc tiếp theo — hàng đợi có thứ tự

> **File này sở hữu đúng một thứ: THỨ TỰ LÀM.** Không phải trạng thái, không phải hợp đồng,
> không phải kiến thức. Ba thứ đó đã có chủ:
>
> | Thông tin | Chủ sở hữu |
> |---|---|
> | Cái gì **đã xong**, còn nợ gì | [`CLAUDE.md`](../CLAUDE.md) §Trạng thái hiện tại |
> | **Hợp đồng** một tính năng (API, schema, test case) | [`specs/`](specs/) |
> | **Kiến thức** (cơ chế, bug thật, số đo) | [`tech-playbook.md`](tech-playbook.md) |
> | **Thứ tự làm** | **file này** |
>
> **Luật giữ cho nó không trôi lệch:** xong một việc thì **xoá dòng đó trong chính commit làm
> việc đó**. Không để dành "dọn sau" — một hàng đợi cũ là một hàng đợi không ai tin.
>
> Cập nhật lần cuối: **2026-09-26** — vừa xong Phase 9 khối 1–3 (security) và Phase 8 (đợt sale).

---

## 🔴 Đang chặn — làm trước mọi thứ khác

| # | Việc | Ai | Mất bao lâu | Đang chặn gì |
|---|---|---|---|---|
| 1 | Thêm `CSRF_SECRET` vào `.env` (≥32 ký tự, sinh bằng `openssl rand -hex 32`) | Tâm | 1 phút | Chạy app ở local — thiếu là `npm run dev` chết lúc khởi động |
| 2 | `git push origin main` — 12 commit đang chờ | Tâm | 1 phút | CI chạy, và mọi review |

---

## 🟡 Chờ quyết định

| # | Việc | Ai | Ghi chú |
|---|---|---|---|
| 3 | Duyệt [spec Phase 8](specs/phase8-sale-event.md) — 3 câu hỏi mở | Tâm | Nặng nhất: tồn kho đợt **cắt ra** từ SKU hay **dùng chung**. Quyết định này đổi hình dạng schema |
| 4 | Duyệt [spec Phase 9](specs/phase9-web-hoan-thien.md) — 3 câu hỏi mở | Tâm | Nặng nhất: làm khối security (1 ngày) trước hay làm web (4 ngày) trước |

---

## ✅ Vừa xong

**Phase 9 khối 1–3 — security baseline** (2026-09-26). 5 security header, rate limit
`register`/`refresh` theo IP, `trust proxy 1`, body limit 32kb, cổng `npm audit` trong CI.
Bảng rà 19 mục giờ **19/19**. [spec Phase 9](specs/phase9-web-hoan-thien.md)

**Phase 8 — đợt sale thật** (2026-09-26). Giờ mở/đóng, giá riêng, giới hạn mua mỗi người;
tồn kho đợt **cắt ra** khỏi SKU ([ADR-015](adr/015-ton-kho-dot-cat-ra-tu-sku.md)). 17 test
mới, tổng **148 integration + 163 unit**. [spec Phase 8](specs/phase8-sale-event.md)

---

## 🟢 Xếp hàng — duyệt xong là code được

| # | Việc | Ước lượng | Vì sao đứng ở đây |
|---|---|---|---|
| 5 | **Job dọn `outbox_events` + `processed_events`** | ~0,5 ngày | Nên xong **trước khi deploy**: hai bảng chỉ ghi thêm, trên Neon free 0,5 GB nó lộ ra bằng **hoá đơn**, không bằng lỗi |
| 6 | **Phase 9 khối 4** — web dùng được: 6 màn, tách `app.js` thành module ESM | ~4 ngày | Không chặn gì, nhưng là thứ người phỏng vấn nhìn thấy đầu tiên |

---

## 🔵 Việc của Tâm, không chặn ai

| # | Việc | Mất bao lâu |
|---|---|---|
| 7 | Trả lời câu hỏi bản chất Phase 3, 5, 6 | ~1 giờ |
| 8 | Quay video demo 2 phút — dòng Definition of Done cuối cùng chưa tick. Cách dựng cảnh ở [demo-phong-van.md](demo-phong-van.md) Bước 7 | ~30 phút |
| 9 | Dựng hạ tầng GCP: project, WIF, Neon, Upstash, 6 secret, Cloud Scheduler **5 phút**, và **budget alert $1 làm trước tiên**. 11 bước ở [spec Phase 7](specs/phase7-deploy-gcp.md) | ~nửa ngày |
| 10 | Sau khi deploy: đo thật rồi cập nhật số vào [ADR-012](adr/012-worker-tren-cloud-run.md) và [ADR-013](adr/013-pool-nho-tren-serverless.md) — cả hai đang dùng số đo **local** | ~1 giờ |

---

## ⚪ Chưa xếp hàng

Nợ đã ghi chép, có chủ ý hoãn. **Danh sách đầy đủ kèm lý do ở [`CLAUDE.md`](../CLAUDE.md)
§Trạng thái** — đây chỉ là con trỏ, không chép lại.

- ADR-015 (tồn kho đợt) và ADR-016 (vì sao vẫn không framework) — viết cùng lúc code Phase 8/9
- Test "Redis chết giữa request webhook" — cần toxiproxy
- Cảnh báo `Jest did not exit` — test vẫn xanh, chỉ chậm thoát ~1 giây
- Gộp `UPDATE` + `isSkuOnSale` của optimistic — đổi hành vi nên phải benchmark lại
- Xác thực email + quên mật khẩu — cần SMTP thật
- Captcha — **điều kiện kích hoạt:** thấy `429` của `register` tăng đều trong metric

Nợ mới phát sinh từ Phase 8: **đóng đợt và trả hàng tồn về SKU** — đợt kết thúc còn 7 chiếc
thì 7 chiếc đó vẫn nằm ở `sale_event_skus`, chưa có thao tác nào đưa chúng về kho chung. Và
**k6 chạy trên đợt sale** (hiện `seed-target.js` vẫn dựng SKU thường).

Hướng mở tiếp, chưa có spec: **Phase 10** đơn nhiều dòng (mở ra deadlock ordering) ·
**Phase 11** cache đọc (mở ra cache stampede) · **Phase 12** saga hoàn tiền ·
**Phase 13** vòng đời dữ liệu.
