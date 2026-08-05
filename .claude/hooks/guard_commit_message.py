#!/usr/bin/env python3
"""PreToolUse[Bash] — kiểm tra commit message đúng chuẩn Flash-Core trước khi commit.

Vì sao: `docs/git-workflow.md` §1 đặt mục tiêu "git log của repo này phải tự kể được câu
chuyện phát triển dự án". Một commit "update code" không thể sửa lại sau khi đã push, nên
rẻ nhất là chặn ngay lúc tạo.

Kiểm tra: dòng đầu đúng Conventional Commits, có thân giải thích VÌ SAO, độ dài hợp lý.
Fail-open với các dạng lệnh không đọc được (`-F file`, `--amend` không kèm -m, heredoc).
"""
import json
import re
import shlex
import sys

TYPES = ("feat", "fix", "refactor", "test", "docs", "perf", "chore")
HEADER_RE = re.compile(r"^(" + "|".join(TYPES) + r")\(([a-z0-9][a-z0-9-]*)\): (.+)$")

FORMAT_HELP = (
    "Định dạng bắt buộc (docs/git-workflow.md §2):\n\n"
    "  <type>(<scope>): <mô tả mệnh lệnh, < 50 ký tự>\n"
    "  <dòng trống>\n"
    "  <thân: VÌ SAO làm thế này — code đã nói LÀM GÌ rồi>\n"
    "  <trade-off đã chấp nhận, nếu có>\n"
    "  <dòng trống>\n"
    "  Refs: docs/specs/<file>.md, ADR-<số>\n\n"
    "type: feat | fix | refactor | test | docs | perf | chore\n"
    "scope: auth | product | order | queue | payment | obs | infra | fe\n"
    "Toàn bộ message viết bằng tiếng Việt."
)


def respond(decision: str, reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def deny(reason: str) -> None:
    """Dùng cho lỗi định dạng rõ ràng — không có cách nào commit như vậy là đúng."""
    respond("deny", reason)


def ask(reason: str) -> None:
    """Dùng cho thứ *nên* có nhưng đôi khi bỏ được — để Tâm quyết thay vì chặn cứng."""
    respond("ask", reason)


def extract_messages(tokens):
    """Lấy các giá trị của -m / --message. Trả về None nếu lệnh không dùng -m."""
    messages = []
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if t in ("-m", "--message"):
            if i + 1 < len(tokens):
                messages.append(tokens[i + 1])
            i += 2
            continue
        if t.startswith("--message="):
            messages.append(t.split("=", 1)[1])
            i += 1
            continue
        # -m"msg" hoặc cờ ghép kiểu -am "msg"
        if t.startswith("-") and not t.startswith("--"):
            flags = t[1:]
            if flags.startswith("m") and len(flags) > 1:
                messages.append(flags[1:])
            elif "m" in flags and i + 1 < len(tokens):
                messages.append(tokens[i + 1])
                i += 2
                continue
        i += 1
    return messages


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    if data.get("tool_name") != "Bash":
        sys.exit(0)

    command = (data.get("tool_input") or {}).get("command") or ""
    if "commit" not in command:
        sys.exit(0)

    try:
        tokens = shlex.split(command)
    except ValueError:
        sys.exit(0)  # không parse được (heredoc, quote lệch) → để qua

    if "git" not in tokens:
        sys.exit(0)
    after_git = tokens[tokens.index("git") + 1:]
    if "commit" not in after_git:
        sys.exit(0)
    if "-F" in after_git or "--file" in after_git:
        sys.exit(0)  # message nằm trong file, không kiểm tra được ở đây

    messages = extract_messages(after_git)
    if not messages:
        sys.exit(0)  # --amend / -C / editor → không can thiệp

    full = "\n\n".join(messages) if len(messages) > 1 else messages[0]
    lines = full.split("\n")
    header = lines[0].strip()

    m = HEADER_RE.match(header)
    if not m:
        deny(
            "Commit message không đúng chuẩn của dự án.\n\n"
            f"Dòng đầu đang là: {header!r}\n\n" + FORMAT_HELP
        )

    subject = m.group(3)
    if len(header) > 72:
        deny(
            f"Dòng đầu dài {len(header)} ký tự — quá dài để đọc trong `git log --oneline`.\n"
            f"Mô tả nên < 50 ký tự. Hãy rút gọn: {subject!r}\n\n" + FORMAT_HELP
        )

    body = "\n".join(lines[1:]).strip()
    if len(body) < 20:
        ask(
            "Commit thiếu thân giải thích VÌ SAO — có muốn commit như vậy không?\n\n"
            "docs/git-workflow.md §4.2: mỗi commit AI tạo phải có thân giải thích vì sao, "
            "và tham chiếu spec/ADR liên quan. Đây là thứ khiến git log kể được câu chuyện "
            "phát triển — thay vì chỉ liệt kê thay đổi mà `git diff` đã nói rõ hơn.\n\n"
            + FORMAT_HELP
        )

    # Dòng `Refs:` không bị chặn: commit chore/infra có thể không gắn spec nào, và hook này
    # cố tình KHÔNG trả về permissionDecision "allow" — "allow" sẽ bỏ qua luôn bước xin phép
    # của Tâm cho câu lệnh Bash, tức là hook tự cấp quyền rộng hơn việc nó cần làm.
    # Yêu cầu về `Refs:` đã nằm trong FORMAT_HELP ở trên và trong docs/git-workflow.md §4.2.
    sys.exit(0)


if __name__ == "__main__":
    main()
