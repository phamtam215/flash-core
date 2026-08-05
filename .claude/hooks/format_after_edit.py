#!/usr/bin/env python3
"""PostToolUse[Write|Edit|MultiEdit] — format file vừa sửa bằng prettier của repo.

Vì sao: format tự động giữ cho diff sạch, và diff sạch là điều kiện để Tâm review được
(docs/review-checklist.md bắt đầu bằng việc đọc diff). Nếu để AI và editor format khác nhau,
mỗi lần sửa một dòng sẽ sinh ra diff 40 dòng và bước review thành vô nghĩa.

Chỉ chạy khi repo đã có prettier trong node_modules — im lặng bỏ qua nếu chưa (Phase 0).
Nếu prettier báo lỗi parse thì đó là dấu hiệu file có lỗi syntax → báo lại cho Claude.
"""
import json
import os
import subprocess
import sys

EXTENSIONS = (".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".css", ".yml", ".yaml")


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    if data.get("tool_name") not in ("Write", "Edit", "MultiEdit"):
        sys.exit(0)

    path = (data.get("tool_input") or {}).get("file_path") or ""
    if not path or not path.endswith(EXTENSIONS) or not os.path.isfile(path):
        sys.exit(0)

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()
    prettier = os.path.join(project_dir, "node_modules", ".bin", "prettier")
    if not os.path.isfile(prettier):
        sys.exit(0)

    try:
        result = subprocess.run(
            [prettier, "--write", "--log-level", "warn", path],
            capture_output=True, text=True, timeout=20, cwd=project_dir,
        )
    except (OSError, subprocess.TimeoutExpired):
        sys.exit(0)

    if result.returncode != 0:
        message = (result.stderr or result.stdout or "").strip()[:800]
        print(json.dumps({
            "hookSpecificOutput": {
                "hookEventName": "PostToolUse",
                "additionalContext": (
                    f"prettier không format được `{os.path.relpath(path, project_dir)}` — "
                    "thường có nghĩa là file đang có lỗi syntax. Kiểm tra lại trước khi đi "
                    f"tiếp:\n{message}"
                ),
            }
        }))

    sys.exit(0)


if __name__ == "__main__":
    main()
