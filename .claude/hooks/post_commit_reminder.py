#!/usr/bin/env python3
"""PostToolUse[Bash] — sau khi commit thành công, nhắc đúng bước tiếp theo.

Vì sao: điểm dễ trượt nhất của quy trình là ngay sau commit — lúc đó cảm giác "xong rồi" rất
mạnh, và cả AI lẫn người đều muốn đi tiếp. Nhưng theo `docs/git-workflow.md` §4.1, luồng
chuẩn là: AI code → test → commit → **Tâm review** → Tâm ra lệnh push. Hook này chèn đúng
một nhắc nhở vào đúng khoảnh khắc đó.
"""
import json
import re
import sys

COMMIT_RE = re.compile(r"\bgit\b[^|;&]*\bcommit\b")


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    if data.get("tool_name") != "Bash":
        sys.exit(0)

    command = (data.get("tool_input") or {}).get("command") or ""
    if not COMMIT_RE.search(command):
        sys.exit(0)

    response = data.get("tool_response")
    blob = json.dumps(response) if not isinstance(response, str) else response
    if "nothing to commit" in blob.lower():
        sys.exit(0)

    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": (
                "Vừa commit. Ba việc bắt buộc trước khi làm bất cứ thứ gì khác:\n"
                "1. **KHÔNG push.** Báo Tâm: 'Đã commit, sẵn sàng push khi anh review xong.'\n"
                "2. Nếu chưa tóm tắt **luồng chạy 5–10 câu tiếng Việt** cho thay đổi này thì "
                "làm ngay (CLAUDE.md §Quy trình 4) — đây là nguyên liệu Tâm dùng để tự kiểm "
                "tra 'câu hỏi bản chất'.\n"
                "3. Nêu 2–3 điểm trong diff Tâm cần đọc kỹ theo `docs/review-checklist.md`, "
                "và đặt câu hỏi ngược kiểm tra Tâm hiểu cơ chế."
            ),
        }
    }))


if __name__ == "__main__":
    main()
