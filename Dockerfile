# Ảnh production cho Cloud Run. Hai stage, và lý do tách nằm ở dòng cuối stage 2:
# **ảnh chạy không chứa mã nguồn TypeScript, devDependencies, hay bất cứ thứ gì chỉ cần lúc
# build.** Bề mặt tấn công nhỏ hơn, ảnh nhẹ hơn, cold start nhanh hơn — mà cold start là thứ
# Cloud Run scale-to-zero bắt người dùng đầu tiên phải trả.

# ── Stage 1: build ────────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS builder
WORKDIR /app

# Copy manifest TRƯỚC source. Docker cache theo từng lệnh, nên sửa một dòng code không làm
# `npm ci` chạy lại — khác biệt giữa build 15 giây và build 3 phút.
COPY package.json package-lock.json ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts ./
COPY tsconfig*.json nest-cli.json ./
COPY src ./src

# Prisma Client được generate vào `src/generated/prisma` (không phải node_modules) — quyết
# định từ Phase 0. Phải chạy TRƯỚC `nest build`, nếu không tsc không tìm thấy client.
#
# `DATABASE_URL` giả: `prisma generate` chỉ đọc schema, không kết nối. Nhưng `prisma.config.ts`
# đòi biến này tồn tại, nên đưa một giá trị hợp lệ về cú pháp là đủ. KHÔNG đưa URL thật vào
# ảnh build — nó sẽ nằm lại trong layer.
ENV DATABASE_URL="postgresql://build:build@localhost:5432/build"
RUN npx prisma generate
RUN npm run build

# Cắt devDependencies khỏi node_modules để copy sang stage sau.
RUN npm prune --omit=dev

# ── Stage 2: runtime ──────────────────────────────────────────────────────────────────────
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Chạy bằng user không phải root. Ảnh `node` có sẵn user `node` (uid 1000).
USER node

COPY --chown=node:node --from=builder /app/node_modules ./node_modules
COPY --chown=node:node --from=builder /app/dist ./dist
COPY --chown=node:node --from=builder /app/src/generated ./src/generated
# Migration đi theo ảnh để `prisma migrate deploy` chạy được từ chính container này.
COPY --chown=node:node --from=builder /app/prisma ./prisma
COPY --chown=node:node --from=builder /app/prisma.config.ts ./
COPY --chown=node:node package.json ./
# Trang demo Phase 5 — `useStaticAssets` đọc từ `../public` so với `dist/`.
COPY --chown=node:node public ./public

# Cloud Run tiêm PORT vào môi trường và app đọc nó qua `env.PORT`. EXPOSE chỉ là tài liệu.
EXPOSE 3000

# Không dùng `npm start`: npm sẽ là PID 1 và **nuốt SIGTERM**, nên phần tắt êm ba bước ở
# `main.ts` (Phase 6) không bao giờ chạy — và mỗi lần Cloud Run thay phiên bản sẽ cắt ngang
# request đang xử lý. Gọi thẳng `node` để chính app nhận tín hiệu.
CMD ["node", "dist/main.js"]
