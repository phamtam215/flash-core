-- Phase 8 — Đợt sale thật (giờ mở, giá riêng, giới hạn mua mỗi người).
-- Spec: docs/specs/phase8-sale-event.md · Quyết định cắt tồn kho: docs/adr/015-ton-kho-dot-cat-ra-tu-sku.md

-- CreateTable
-- CỐ TÌNH KHÔNG có cột `status`. "Đang mở hay chưa" tính từ starts_at/ends_at + is_published
-- tại chỗ đọc. Lưu nó là lưu bản cache của giá trị tính được, và cache thì sai được.
CREATE TABLE "sale_events" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "is_published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sale_event_skus" (
    "id" UUID NOT NULL,
    "sale_event_id" UUID NOT NULL,
    "sku_id" UUID NOT NULL,
    "sale_price_vnd" INTEGER NOT NULL,
    -- Phân bổ (cố định từ lúc soạn) tách khỏi còn lại (giảm dần khi bán). Nhờ vậy trả lời
    -- được "đã bán bao nhiêu" bằng một phép trừ, không phải đếm đơn.
    "allocated_stock" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "per_user_limit" INTEGER NOT NULL DEFAULT 2,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sale_event_skus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Khoá chính GHÉP (sale_event_sku_id, user_id): một dòng cho mỗi người trong mỗi đợt-mẫu.
-- Chính khoá này khiến quota KHÔNG cần khoá gì — hai người khác nhau không chạm cùng dòng.
CREATE TABLE "sale_event_purchases" (
    "sale_event_sku_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "sale_event_purchases_pkey" PRIMARY KEY ("sale_event_sku_id","user_id")
);

-- AlterTable
-- NULL-able, không DEFAULT ⇒ metadata-only, không rewrite bảng `order_items`.
-- NULL = mua giá gốc thẳng trên SKU (đường Phase 3, vẫn giữ). Có giá trị = mua trong đợt.
ALTER TABLE "order_items" ADD COLUMN "sale_event_sku_id" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "sale_events_slug_key" ON "sale_events"("slug");
-- Danh sách đợt đang bán: lọc is_published rồi sắp theo giờ mở.
CREATE INDEX "sale_events_is_published_starts_at_idx" ON "sale_events"("is_published", "starts_at");
-- Một mẫu chỉ xuất hiện MỘT lần trong một đợt. Thiếu ràng buộc này thì cùng một SKU có hai
-- dòng trong cùng đợt, mỗi dòng một kho — và tổng bán ra vượt số hàng đã cắt.
CREATE UNIQUE INDEX "sale_event_skus_sale_event_id_sku_id_key" ON "sale_event_skus"("sale_event_id", "sku_id");
CREATE INDEX "sale_event_skus_sku_id_idx" ON "sale_event_skus"("sku_id");
CREATE INDEX "order_items_sale_event_sku_id_idx" ON "order_items"("sale_event_sku_id");

-- AddForeignKey
ALTER TABLE "sale_event_skus" ADD CONSTRAINT "sale_event_skus_sale_event_id_fkey" FOREIGN KEY ("sale_event_id") REFERENCES "sale_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_event_skus" ADD CONSTRAINT "sale_event_skus_sku_id_fkey" FOREIGN KEY ("sku_id") REFERENCES "product_skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "sale_event_purchases" ADD CONSTRAINT "sale_event_purchases_sale_event_sku_id_fkey" FOREIGN KEY ("sale_event_sku_id") REFERENCES "sale_event_skus"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sale_event_purchases" ADD CONSTRAINT "sale_event_purchases_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_sale_event_sku_id_fkey" FOREIGN KEY ("sale_event_sku_id") REFERENCES "sale_event_skus"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tồn kho của đợt cũng không bao giờ được âm — cùng hàng rào với product_skus.stock.
ALTER TABLE "sale_event_skus" ADD CONSTRAINT "sale_event_skus_stock_non_negative" CHECK ("stock" >= 0);
ALTER TABLE "sale_event_purchases" ADD CONSTRAINT "sale_event_purchases_quantity_non_negative" CHECK ("quantity" >= 0);
