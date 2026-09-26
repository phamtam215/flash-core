-- Đóng đợt sale và trả hàng tồn về SKU — trả nợ mà chính Phase 8 tạo ra.
--
-- Vì sao cần cờ riêng thay vì suy từ thời gian: "đã hết giờ" và "đã trả hàng về kho" là HAI
-- chuyện khác nhau, và khoảng giữa chúng chính là lúc job đóng đợt chưa chạy tới. Suy từ
-- `ends_at` thì không biết đã trả hàng chưa ⇒ chạy lại là nhân đôi hàng từ hư không.
--
-- NOT NULL kèm DEFAULT hằng số ⇒ metadata-only từ Postgres 11, không rewrite bảng.
ALTER TABLE "sale_events" ADD COLUMN "is_settled" BOOLEAN NOT NULL DEFAULT false;

-- Job đóng đợt quét đúng dòng cần xử lý.
CREATE INDEX "sale_events_is_published_is_settled_ends_at_idx"
  ON "sale_events"("is_published", "is_settled", "ends_at");
