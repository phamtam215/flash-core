#!/usr/bin/env python3
"""Stop — nhắc chạy cổng review nếu có code trong src/ chưa được review, MỘT LẦN mỗi phiên.

Vì sao: `CLAUDE.md` §Quy trình 4 và `project-context.md` §5 nói rõ cơ chế chống ảo giác
thông thọa: sau mỗi tính năng phải tóm tắt luồng chạy bằng lời để Tâm đối chiếu. Đây là bước
dễ bị bỏ nhất, vì nó xảy ra đúng lúc mọi người tưởng đã xong. Hook chặn lượt dừng đầu tiên
có thay đổi trong `src/` để buộc bước đó xảy ra.

An toàn chống lặp vô hạn: chỉ chặn một lần mỗi session (marker trong temp dir) và bỏ qua khi
`stop_hook_active` là true.

Muốn tắt hook này: xoá mục "Stop" trong .claude/settings.json.
"""
import json
import os
import subprocess
import sys
import tempfile


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    if data.get("stop_hook_active"):
        sys.exit(0)  # đang ở lượt tiếp tục do chính hook này gây ra → không chặn nữa

    session_id = data.get("session_id") or "unknown"
    marker = os.path.join(tempfile.gettempdir(), f"flashcore-review-gate-{session_id}")
    if os.path.exists(marker):
        sys.exit(0)

    project_dir = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()
    if not os.path.isdir(os.path.join(project_dir, "src")):
        sys.exit(0)

    try:
        out = subprocess.run(["git", "status", "--porcelain", "--", "src"],
                             cwd=project_dir, capture_output=True, text=True, timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        sys.exit(0)
    if out.returncode != 0:
        sys.exit(0)

    changed = [l for l in out.stdout.splitlines() if l.strip()]
    if not changed:
        sys.exit(0)

    try:
        with open(marker, "w", encoding="utf-8") as fh:
            fh.write("1")
    except OSError:
        pass  # không ghi được marker thì vẫn chặn một lần, nhưng chấp nhận rủi ro nhắc lại

    files = "\n".join(f"  {l}" for l in changed[:10])
    more = f"\n  ... và {len(changed) - 10} file nữa" if len(changed) > 10 else ""

    print(json.dumps({
        "decision": "block",
        "reason": (
            f"Có {len(changed)} file trong `src/` thay đổi chưa commit:\n{files}{more}\n\n"
            "Trước khi dừng, chạy cổng review (skill `review-gate`) và đưa cho Tâm:\n"
            "1. Kết quả chạy test — **số thật**, không phải 'đã chạy ổn'.\n"
            "2. **Tóm tắt luồng chạy 5–10 câu tiếng Việt** (transaction mở/đóng ở đâu, đâu là "
            "critical section, chỗ nào là ranh giới async).\n"
            "3. 2–3 điểm rủi ro nhất Tâm cần đọc kỹ, kèm `file.ts:line`, và nợ kỹ thuật đã "
            "cố tình chấp nhận.\n"
            "4. 2–3 câu hỏi ngược kiểm tra Tâm hiểu cơ chế.\n\n"
            "Nếu đã làm đủ 4 việc trên trong lượt vừa rồi thì chỉ cần nói lại kết luận ngắn "
            "rồi dừng — hook này chỉ chặn một lần mỗi phiên."
        ),
    }))


if __name__ == "__main__":
    main()
