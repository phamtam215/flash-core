#!/usr/bin/env node
/**
 * Ký và bắn một webhook thanh toán vào app đang chạy — cổng thanh toán giả lập của Phase 4.
 *
 * Vì sao là script rời chứ không phải một endpoint trong app: webhook thật đến từ **bên
 * ngoài**, mang chữ ký do bên ngoài tạo. Một endpoint "tự bắn cho chính mình" sẽ dùng chung
 * bộ nhớ với phần verify và che mất đúng thứ cần kiểm — rằng chữ ký được tính trên đúng
 * chuỗi byte đã truyền đi.
 *
 *   node scripts/send-webhook.mjs --order <uuid> --amount 150000 [--intent pi_x] [--url ...]
 *
 * Khoá lấy từ `PAYMENT_WEBHOOK_SECRET` trong môi trường (nạp sẵn bằng `.env`).
 */
import 'dotenv/config';

import { createHmac, randomUUID } from 'node:crypto';

const args = Object.fromEntries(
  process.argv.slice(2).reduce((pairs, token, i, all) => {
    if (token.startsWith('--')) pairs.push([token.slice(2), all[i + 1]]);
    return pairs;
  }, []),
);

const secret = process.env.PAYMENT_WEBHOOK_SECRET;
if (!secret) {
  console.error('Thiếu PAYMENT_WEBHOOK_SECRET — kiểm tra .env');
  process.exit(1);
}
if (!args.order || !args.amount) {
  console.error('Dùng: node scripts/send-webhook.mjs --order <uuid> --amount <vnd> [--intent pi_x]');
  process.exit(1);
}

const body = JSON.stringify({
  eventId: args.event ?? `evt_${randomUUID()}`,
  type: args.type ?? 'payment.succeeded',
  orderId: args.order,
  paymentIntentId: args.intent ?? `pi_${randomUUID()}`,
  amountVnd: Number(args.amount),
  occurredAt: new Date().toISOString(),
});

// Dấu thời gian nằm TRONG phần được ký — không có nó thì chữ ký bắt được dùng lại được mãi mãi.
const t = Math.floor(Date.now() / 1000);
const signature = `t=${t},v1=${createHmac('sha256', secret).update(`${t}.${body}`).digest('hex')}`;

const url = `${args.url ?? 'http://localhost:3000'}/payments/webhook`;
const res = await fetch(url, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'x-payment-signature': signature },
  body,
});

console.log(`${res.status} ${res.statusText}  ←  ${url}`);
if (res.status !== 204) console.log(await res.text());
