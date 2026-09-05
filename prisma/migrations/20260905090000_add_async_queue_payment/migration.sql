-- Phase 4 — Async, Queue & Payment Webhook.
-- Spec: docs/specs/phase4-async-queue-payment.md

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'DISPATCHED', 'FAILED');

-- AlterTable
-- Ba cột NULL-able, không DEFAULT ⇒ metadata-only, không rewrite bảng `orders`.
ALTER TABLE "orders" ADD COLUMN "paid_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "cancelled_at" TIMESTAMP(3);
ALTER TABLE "orders" ADD COLUMN "payment_intent_id" TEXT;

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" UUID NOT NULL,
    "aggregate" TEXT NOT NULL,
    "aggregate_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dispatched_at" TIMESTAMP(3),

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
-- Khoá chính GHÉP (event_id, consumer): cùng một sự kiện có thể có nhiều consumer, mỗi
-- consumer phải được xử lý đúng một lần của riêng nó. Chính ràng buộc này LÀ cơ chế
-- idempotent — không có bảng nào khác giữ vai đó.
CREATE TABLE "processed_events" (
    "event_id" TEXT NOT NULL,
    "consumer" TEXT NOT NULL,
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("event_id","consumer")
);

-- CreateTable
CREATE TABLE "refund_requests" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "payment_intent_id" TEXT NOT NULL,
    "amount_vnd" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "correlation_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
-- Điều kiện để relay quét rẻ: `WHERE status='PENDING' ORDER BY created_at` đi thẳng theo
-- index, không Seq Scan trên bảng chỉ có tăng.
CREATE INDEX "outbox_events_status_created_at_idx" ON "outbox_events"("status", "created_at");

-- CreateIndex
-- Một phiên thanh toán gắn được vào đúng một đơn.
CREATE UNIQUE INDEX "orders_payment_intent_id_key" ON "orders"("payment_intent_id");

-- CreateIndex
-- Webhook lặp lại không tạo được hai yêu cầu hoàn tiền cho cùng một phiên.
CREATE UNIQUE INDEX "refund_requests_payment_intent_id_key" ON "refund_requests"("payment_intent_id");

-- CreateIndex
CREATE INDEX "refund_requests_order_id_idx" ON "refund_requests"("order_id");

-- AddForeignKey
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_requests_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Lưới an toàn ở tầng DB, cùng tinh thần với CHECK (stock >= 0) của Phase 2:
-- số tiền hoàn phải dương, và outbox không được đếm lùi.
ALTER TABLE "refund_requests" ADD CONSTRAINT "refund_amount_positive" CHECK ("amount_vnd" > 0);
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_attempts_non_negative" CHECK ("attempts" >= 0);
