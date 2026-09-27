#!/usr/bin/env bash
# Tắt / bật Cloud SQL khi nghỉ học.
#
# CHƯA DÙNG trong giai đoạn credit (ADR-016): instance đã tắt vẫn bị tính tiền IP công khai,
# xấp xỉ giá cái máy — tắt không rẻ hơn. Script này dành cho hướng "Private IP cố định, gỡ IP
# công khai" sau credit (hướng dẫn deploy §16).
#
#   npm run gcp:off     trước khi tắt máy
#   npm run gcp:on      lúc bắt đầu học (chờ 1–3 phút)
#   npm run gcp:status  xem đang bật hay tắt
#
# Vì sao phải làm HAI việc chứ không chỉ tắt DB: Cloud Scheduler vẫn gọi worker mỗi 5 phút.
# DB tắt mà worker vẫn chạy thì mỗi lượt đều đỏ rồi retry — không mất dữ liệu, nhưng log đầy
# lỗi giả và tốn vCPU-giây vô ích.
#
# Cloud Run service KHÔNG cần đụng tới: không ai gọi thì nó tự về 0 instance, 0đ.
set -euo pipefail

INSTANCE="${SQL_INSTANCE_NAME:-flash-core-db}"
TICK_JOB="flash-core-worker-tick"
REGION="${REGION:-us-central1}"
PROJECT="$(gcloud config get-value project 2>/dev/null)"

[ -n "$PROJECT" ] || { echo "✗ chưa chọn project: gcloud config set project <ID>"; exit 1; }

state() {
  gcloud sql instances describe "$INSTANCE" --format='value(settings.activationPolicy,state)'
}

case "${1:-}" in
  off)
    # Dừng worker TRƯỚC, rồi mới tắt DB — ngược lại thì có một khe worker nối vào DB đang tắt.
    gcloud scheduler jobs pause "$TICK_JOB" --location="$REGION" --quiet \
      || echo "⚠ không dừng được $TICK_JOB (chưa tạo ở §10?) — vẫn tắt DB"
    gcloud sql instances patch "$INSTANCE" --activation-policy=NEVER --quiet
    echo "✓ đã tắt ($PROJECT). Ổ đĩa vẫn tính tiền lúc tắt — chỉ xoá instance mới là 0đ."
    ;;
  on)
    # Bật DB TRƯỚC, rồi mới cho worker chạy lại.
    gcloud sql instances patch "$INSTANCE" --activation-policy=ALWAYS --quiet
    gcloud scheduler jobs resume "$TICK_JOB" --location="$REGION" --quiet \
      || echo "⚠ không bật lại được $TICK_JOB (chưa tạo ở §10?)"
    echo "✓ đã bật ($PROJECT). Nhớ chạy 'npm run gcp:off' trước khi nghỉ."
    ;;
  status)
    echo "Cloud SQL $INSTANCE: $(state)"
    echo "Scheduler $TICK_JOB: $(gcloud scheduler jobs describe "$TICK_JOB" --location="$REGION" --format='value(state)')"
    ;;
  *)
    echo "Dùng: $0 on|off|status"; exit 1
    ;;
esac
