# ADR-015: Tồn kho của đợt sale được CẮT RA khỏi SKU, không dùng chung

- **Ngày:** 2026-09-26
- **Trạng thái:** Đã chốt

## Bối cảnh

Phase 8 thêm khái niệm **đợt sale**: giờ mở, giá riêng, giới hạn mua mỗi người. Câu hỏi thiết
kế nặng nhất là tồn kho nằm ở đâu — vì nó quyết định cả hình dạng schema lẫn mọi đường trả kho.

## Quyết định

Mỗi dòng `sale_event_skus` giữ **tồn kho của riêng nó**, được **cắt ra** khỏi
`product_skus.stock` tại thời điểm **publish**, trong một transaction cùng với việc bật cờ
`is_published`.

```
Trước publish:  product_skus.stock = 50   ·  sale_event_skus.stock = 0
Sau  publish:   product_skus.stock = 20   ·  sale_event_skus.stock = 30
                                   └────── tổng vẫn 50 ──────┘
```

Đơn mua trong đợt chỉ trừ tồn kho **của đợt**; huỷ đơn trả về **đợt**, không về SKU.

## Vì sao không dùng chung `ProductSku.stock`

| | **Cắt ra** ⭐ | Dùng chung |
|---|---|---|
| Hai đợt cùng lúc (20:00 và 22:00) | Mỗi đợt một kho, không ăn của nhau | **Không mô hình hoá được** — hai đợt tranh cùng một dòng |
| Phân bổ "100 chiếc cho đợt tối, 50 cho đợt sáng" | Làm được | Không |
| Schema | Thêm một cột `allocated_stock` và một bước publish | Ít hơn |
| Đường trả kho | Phải biết trả về đâu | Chỉ một chỗ |

Dùng chung thì `SaleEvent` chỉ còn là **một cái nhãn dán lên SKU** — nó thêm giá và khung giờ,
nhưng câu hỏi thú vị nhất của bài toán flash sale (phân bổ hàng cho từng đợt) biến mất. Chi phí
của việc cắt ra là một thao tác publish phải viết đúng, mà bản thân nó cũng là một transaction
đáng học.

## Hệ quả

**Được:**

- Hai đợt song song có kho độc lập.
- Trả lời được "đợt này đã bán bao nhiêu" bằng `allocated_stock - stock`, không phải đếm đơn.
- Tổng tồn kho toàn hệ thống **không đổi** khi publish — không sinh hàng từ hư không, và điều
  đó kiểm được bằng một phép cộng (test #4).

**Mất — và đây là phần phải cẩn thận:**

- **Huỷ đơn phải trả kho về đúng nơi.** `order_items.sale_event_sku_id` `NULL` hay không quyết
  định trả về SKU hay về đợt. Trả nhầm thì hàng của đợt chui về kho chung, **đợt sau bán hụt
  đúng số đó, và không có lỗi nào báo**. Cả hai đường huỷ (người mua bấm, và job hết hạn) dùng
  chung đúng một hàm `releaseStock` — tách ra là một ngày nào đó chỉ một đường được sửa.
- **Publish phải nguyên tử.** Cắt xong mà chưa bật cờ ⇒ hàng biến khỏi SKU mà chưa ai bán được
  (mất hàng im lặng). Bật cờ mà chưa cắt ⇒ đợt mở với `stock = 0`. Cả hai nằm trong một
  transaction, và `UPDATE ... WHERE is_published = false` khiến hai lần bấm publish chỉ ăn một.
- **Hàng tồn sau đợt không tự về kho chung.** Đợt kết thúc còn 7 chiếc thì 7 chiếc đó vẫn nằm
  ở `sale_event_skus`. Cần một thao tác "đóng đợt, trả hàng về SKU" — **chưa làm**, ghi làm nợ.

## Ranh giới module — nối tiếp ADR-003

ADR-003 chốt: module `order` được ghi `product_skus.stock`/`version`, **chỉ** trong
`order.repository.ts`. Phase 8 mở thêm đúng hai chỗ, cùng tinh thần:

| Module | Được ghi gì | Ở file nào |
|---|---|---|
| `sale-event` | `product_skus.stock`/`version` — **chỉ lúc publish** | `sale-event.repository.ts` |
| `order` | `sale_event_skus.stock` và `sale_event_purchases` | `order.repository.ts` |

`SaleEventRepository` **không** được export ra khỏi module. Mở nó là mở toang ba bảng cho mọi
module ghi — đúng kiểu xói mòn ranh giới mà `architecture.md` quy tắc 1 muốn chặn.

## Một điều KHÔNG làm, và vì sao

Ba chiến lược chống oversell (optimistic / pessimistic / Redis) **không** được áp lên tồn kho
của đợt — đường bán theo đợt dùng một câu `UPDATE` có điều kiện, cùng cơ chế với `optimistic`.

Lý do: câu `UPDATE` của đợt mang thêm hai điều kiện mà SKU không có (khung giờ, cờ publish),
nên bê nguyên ba chiến lược sang đòi tổng quát hoá cả interface `InventoryReserver`. Mà
**benchmark Phase 3 so sánh ba chiến lược trên cùng một luồng** — đổi luồng là số đo hết so
sánh được. Giữ ba chiến lược ở đúng chỗ chúng được đo.

Ghi ra ở đây thay vì để người đọc tự phát hiện, vì [spec Phase 8](../specs/phase8-sale-event.md)
§Phạm vi có câu *"chúng giữ nguyên, chỉ được gọi trên tồn kho của đợt"* — câu đó nói quá điều
đã làm.

**Liên quan:** [ADR-003](003-so-huu-logic-tru-ton-kho.md) ·
[spec Phase 8](../specs/phase8-sale-event.md)
