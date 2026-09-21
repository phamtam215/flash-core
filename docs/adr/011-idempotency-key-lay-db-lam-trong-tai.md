# ADR-011: `Idempotency-Key` lấy ràng buộc UNIQUE của DB làm trọng tài

- **Ngày:** 2026-08-28 (ghi lại 2026-09-21 — quyết định đã áp dụng từ Phase 3)
- **Trạng thái:** Đã chốt

## Bối cảnh

Người mua bấm "Săn ngay" hai lần — vì mạng chậm, vì sốt ruột, vì trình duyệt tự gửi lại. Hai
request tới gần như cùng lúc. Chỉ được ra **một** đơn.

## Quyết định

Client gửi `Idempotency-Key` (header bắt buộc với mọi API **tạo** thứ gì đó liên quan đơn
hàng). DB có `UNIQUE(user_id, idempotency_key)`. Server **cứ `INSERT` thẳng** và **bắt lỗi
`P2002`** (vi phạm UNIQUE) để biết đây là lần bấm thứ hai:

```
INSERT ... → thành công  ⇒ đơn mới, trả 201
INSERT ... → P2002       ⇒ đã có, hoàn kho, đọc lại đơn cũ, trả 200
```

## Vì sao không "kiểm tra trước rồi mới ghi"

```ts
const existing = await repo.findByKey(userId, key);   // ①
if (existing) return existing;
return repo.create(...);                              // ②
```

Đoạn này **sai dưới tải**, và sai im lặng. Hai request song song đều chạy ① khi chưa ai ghi
xong → cả hai thấy `null` → cả hai chạy ② → **hai đơn**. Khe giữa ① và ② nhỏ tới mức test tay
không bao giờ gặp, nhưng dưới 1.000 người bấm cùng lúc thì nó gặp liên tục.

Đây là cùng một bài học với ba chiến lược chống oversell (ADR-003): **đưa điều kiện vào chính
câu ghi, đừng kiểm tra trong RAM rồi mới ghi.** Chỉ có DB mới biết ai tới trước, vì chỉ nó
thấy được cả hai transaction.

| Cách | Vì sao loại |
|---|---|
| Check-then-insert | Race condition, sai im lặng dưới tải (ở trên) |
| Khoá phân tán bằng Redis (`SET NX` theo key) | Thêm một hệ thống vào đường nóng, và vẫn phải có UNIQUE làm lưới cuối. Đã có lưới cuối thì lớp khoá kia chỉ là tối ưu — chưa đo được là chưa đáng thêm |
| Cột `UNIQUE` mà không có header, tự sinh key từ nội dung đơn | Hai lần mua **cố ý** cùng một SKU cùng số lượng sẽ bị coi là trùng. Ý định phải do client nói, không suy đoán được |

## Hệ quả

**Được:** đúng trong mọi kịch bản song song mà không thêm hệ thống nào; một `INSERT` cho
đường thành công (đường chạy 99% thời gian).

**Mất — và đây là đánh đổi phải nói ra:** thứ tự của dự án là **trừ kho trước, tạo đơn sau**,
nên lần bấm thứ hai sẽ trừ kho rồi mới phát hiện trùng và phải **hoàn lại**. Đổi ngược thứ tự
(tạo đơn trước) tránh được việc hoàn kho ở nhánh này, nhưng chiến lược Redis trừ kho **ngoài**
transaction DB nên vẫn phải bù trừ ở nhánh lỗi — không cách nào tránh hoàn toàn. Chọn một
luồng chung cho cả ba chiến lược để benchmark Phase 3 so sánh công bằng.

Hệ quả thứ hai: bắt `P2002` nghĩa là **phụ thuộc vào mã lỗi của Prisma**. Nếu một ngày đổi
ORM thì chỗ này phải sửa — chấp nhận, vì nó nằm gọn trong đúng một hàm của repository.

**Không nhầm với `processed_events`:** bảng đó (Phase 4) cũng dùng UNIQUE làm trọng tài nhưng
cho việc khác — chống **xử lý** một sự kiện hai lần ở phía consumer, không phải chống **tạo**
hai đơn ở phía client. Hai bài toán, cùng một công cụ.

**Nơi code:** [`order.repository.ts`](../../src/modules/order/order.repository.ts) ·
[`order.service.ts`](../../src/modules/order/order.service.ts) ·
[spec Phase 3](../specs/phase3-order-concurrency.md)

**Ngoại lệ đã chốt:** `POST /orders/:id/cancel` **không** đòi header này — huỷ đơn không *tạo*
gì, tính idempotent của nó đến từ `WHERE status = 'PENDING'` trong chính câu `UPDATE`, chặt
hơn một header do client tự sinh. Xem [spec huỷ đơn chủ động](../specs/huy-don-chu-dong.md).
