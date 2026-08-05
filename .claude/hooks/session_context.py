#!/usr/bin/env python3
"""SessionStart — nạp trạng thái dự án vào đầu mỗi phiên.

Vì sao: `project-context.md` mô tả vai của Tâm là "chuẩn bị spec, quản lý context, review
output". Hook này làm phần quản lý context tự động: mỗi phiên mới, Claude biết ngay đang ở
phase nào, còn việc gì treo, và ba luật không được phá — thay vì phải đọc lại 5 file hoặc
(tệ hơn) đoán.

Giữ output ngắn: nó vào context của MỌI phiên, dài là trả giá bằng token mỗi lần.
"""
import json
import os
import re
import subprocess
import sys


def git(project_dir: str, *args) -> str:
    try:
        out = subprocess.run(["git", *args], cwd=project_dir, capture_output=True,
                             text=True, timeout=5)
        return out.stdout.strip() if out.returncode == 0 else ""
    except (OSError, subprocess.TimeoutExpired):
        return ""


def count_md(path: str) -> int:
    try:
        return len([f for f in os.listdir(path)
                    if f.endswith(".md") and not f.startswith(".")])
    except OSError:
        return 0


def read(path: str) -> str:
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            return fh.read()
    except OSError:
        return ""


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        data = {}

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()

    claude_md = read(os.path.join(project_dir, "CLAUDE.md"))
    m = re.search(r"Phase hiện tại:\s*\*\*(.+?)\*\*", claude_md)
    phase = m.group(1) if m else "chưa ghi trong CLAUDE.md"

    specs = count_md(os.path.join(project_dir, "docs", "specs"))
    adrs = count_md(os.path.join(project_dir, "docs", "adr"))
    journals = count_md(os.path.join(project_dir, "docs", "journal"))

    branch = git(project_dir, "rev-parse", "--abbrev-ref", "HEAD") or "?"
    recent = git(project_dir, "log", "--oneline", "-3")
    dirty = git(project_dir, "status", "--porcelain")
    dirty_count = len([l for l in dirty.splitlines() if l.strip()]) if dirty else 0

    context = read(os.path.join(project_dir, "project-context.md"))
    pending = len(re.findall(r"^\s*-\s\[ \]", context, re.M))

    lines = [
        "## Trạng thái Flash-Core (nạp tự động đầu phiên)",
        "",
        f"- **Phase hiện tại:** {phase}",
        f"- **Nhánh:** `{branch}` · {dirty_count} file thay đổi chưa commit",
        f"- **Tài liệu:** {specs} spec · {adrs} ADR (mục tiêu ~10) · {journals} journal",
    ]
    if pending:
        lines.append(f"- **Việc treo cần Tâm quyết:** {pending} mục (project-context.md §6)")
    if recent:
        lines.append("- **3 commit gần nhất:**")
        lines += [f"    - {l}" for l in recent.splitlines()]

    lines += [
        "",
        "**Ba luật không được phá** (docs/README.md):",
        "1. Không có spec → không code. Tính năng mới phải có file trong `docs/specs/`"
        " (dùng skill `feature-spec` hoặc `/spec`).",
        "2. AI commit nhưng **không push** trước khi Tâm review (hook sẽ chặn `git push`).",
        "3. Chưa trả lời được câu hỏi bản chất của phase → chưa qua phase (`/quiz`).",
        "",
        "Trả lời bằng **tiếng Việt**, ở mức bản chất (cơ chế + trade-off), và chủ động đặt "
        "câu hỏi ngược cho Tâm ở các điểm quan trọng.",
        "",
        "Lệnh có sẵn: `/spec` `/adr` `/review-gate` `/journal` `/quiz` `/phase-status` `/commit`",
    ]

    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": "\n".join(lines),
        }
    }))


if __name__ == "__main__":
    main()
