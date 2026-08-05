#!/usr/bin/env python3
"""PreToolUse[Bash] — chặn `git push`.

Vì sao có hook này: `project-context.md` quyết định #14 nói rằng bước review giữa commit
và push chính là nơi kiến thức hình thành. Nếu AI push tự động, bước đó bị bỏ và dự án mất
đúng phần giá trị học tập. Đây là luật cứng, không phải khuyến nghị — nên nó được enforce
bằng hook chứ không bằng việc AI tự nhớ.

Fail-open: mọi lỗi bất ngờ đều cho phép chạy tiếp, để hook không bao giờ làm nghẽn công việc.
"""
import json
import re
import sys

SEPARATORS = re.compile(r"&&|\|\||;|\n|\|")


def deny(reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    if data.get("tool_name") != "Bash":
        sys.exit(0)

    command = (data.get("tool_input") or {}).get("command") or ""

    for segment in SEPARATORS.split(command):
        tokens = segment.split()
        if "git" not in tokens:
            continue
        gi = tokens.index("git")
        rest = tokens[gi + 1:]
        if "push" not in rest:
            continue
        if "--dry-run" in rest or "-n" in rest:
            continue  # dry-run không đẩy gì lên remote, cho phép

        deny(
            "BỊ CHẶN bởi luật của dự án: AI được commit nhưng KHÔNG được push.\n"
            "Nguồn: docs/git-workflow.md §4.1 và project-context.md quyết định #14 — "
            "bước review giữa commit và push là nơi Tâm hình thành kiến thức.\n\n"
            "Việc cần làm thay vì push:\n"
            "1. Chạy skill `review-gate` (hoặc /review-gate) nếu chưa chạy.\n"
            "2. Báo Tâm: 'Đã commit, sẵn sàng push khi anh review xong.'\n"
            "3. Chờ Tâm ra lệnh push — khi đó chính Tâm chạy lệnh `git push`.\n\n"
            "Đừng tìm cách lách (alias, script trung gian, gh CLI) — hãy dừng và báo Tâm."
        )

    sys.exit(0)


if __name__ == "__main__":
    main()
