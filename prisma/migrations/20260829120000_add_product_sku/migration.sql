-- CreateEnum
CREATE TYPE "ProductStatus" AS ENUM ('DRAFT', 'ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SkuSize" AS ENUM ('S', 'M', 'L', 'XL', 'XXL');

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProductStatus" NOT NULL DEFAULT 'DRAFT',
    "attributes" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_skus" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "size" "SkuSize" NOT NULL,
    "color" TEXT NOT NULL,
    "sku_code" TEXT NOT NULL,
    "price_vnd" INTEGER NOT NULL,
    "stock" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_skus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "products_slug_key" ON "products"("slug");

-- CreateIndex
-- GIN cho query dạng attributes @> '{"material":"cotton"}' — xem ghi chú ở model Product
-- trong schema.prisma. `type: Gin` trong schema sinh đúng DDL này (đã kiểm bằng `prisma
-- validate`/`generate`, nhưng migration này viết tay vì môi trường code không có Postgres
-- sống để chạy `prisma migrate dev` — xem cảnh báo cuối file).
CREATE INDEX "products_attributes_idx" ON "products" USING GIN ("attributes");

-- CreateIndex
CREATE UNIQUE INDEX "product_skus_sku_code_key" ON "product_skus"("sku_code");

-- CreateIndex
-- Phục vụ keyset pagination của GET /skus: WHERE (created_at, id) < ($1, $2) ORDER BY
-- created_at DESC, id DESC.
CREATE INDEX "product_skus_created_at_id_idx" ON "product_skus"("created_at", "id");

-- CreateIndex
CREATE INDEX "product_skus_product_id_idx" ON "product_skus"("product_id");

-- CreateIndex
-- Một product không có 2 SKU trùng size+màu — lưới chặn double-submit ở tầng DB.
CREATE UNIQUE INDEX "product_skus_product_id_size_color_key" ON "product_skus"("product_id", "size", "color");

-- AddForeignKey
ALTER TABLE "product_skus" ADD CONSTRAINT "product_skus_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CHECK constraints (Prisma không có API cho check constraint, xem ghi chú đầu schema.prisma).
-- Đây là lưới an toàn cuối — Phase 2 chưa chống race condition thật (đó là Phase 3), CHECK
-- chỉ đảm bảo stock/price không bao giờ sai dấu trong DB dù tầng ứng dụng có bug.
ALTER TABLE "product_skus" ADD CONSTRAINT "stock_non_negative" CHECK ("stock" >= 0);
ALTER TABLE "product_skus" ADD CONSTRAINT "price_positive" CHECK ("price_vnd" > 0);
