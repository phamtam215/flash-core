#!/usr/bin/env bash
# Statusline của Flash-Core: phase hiện tại · nhánh · số file đổi · spec/ADR.
#
# Vì sao: hai thứ dễ mất dấu nhất trong dự án dài 10–12 tuần là "mình đang ở phase nào" và
# "đã có bao nhiêu ADR so với mục tiêu ~10". Để chúng trước mắt thì không cần nhớ.
#
# Nhận JSON trạng thái phiên trên stdin (không dùng ở đây, nhưng phải đọc cho hết stream).
cat >/dev/null 2>&1

DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
cd "$DIR" 2>/dev/null || exit 0

phase=$(grep -o 'Phase hiện tại: \*\*[^*]*\*\*' CLAUDE.md 2>/dev/null | sed 's/Phase hiện tại: \*\*//; s/\*\*//' | head -1)
[ -z "$phase" ] && phase="?"

branch=$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')
dirty=$(git status --porcelain 2>/dev/null | grep -c . | tr -d ' ')
specs=$(ls docs/specs/*.md 2>/dev/null | grep -c . | tr -d ' ')
adrs=$(ls docs/adr/*.md 2>/dev/null | grep -c . | tr -d ' ')

printf '⚡ %s │ %s' "$phase" "$branch"
[ "$dirty" != "0" ] && printf ' (%s±)' "$dirty"
printf ' │ %s spec · %s/10 ADR' "$specs" "$adrs"
