#!/usr/bin/env python3
"""PreToolUse[Write|Edit|MultiEdit] — không cho AI ghi secret.

Vì sao: `CLAUDE.md` §Điều cấm — không hardcode secret, dùng env qua config module validate
bằng Zod. Và `docs/git-workflow.md` §3 — không commit secret, `.env` phải nằm trong
`.gitignore` ngay commit đầu tiên. Secret đã lọt vào git history thì phải rewrite history
mới xóa được, nên chặn trước khi ghi là rẻ nhất.

- Ghi thẳng vào `.env` / khóa riêng → DENY (file đó thuộc quyền Tâm, không phải AI).
- Ghi giá trị secret trông như thật vào file source → ASK, để Tâm xác nhận.
"""
import json
import os
import re
import sys

SECRET_FILE_NAMES = {".env", ".env.local", ".env.production", ".env.prod",
                     ".env.staging", ".env.development", ".npmrc"}
SECRET_FILE_SUFFIXES = (".pem", ".key", ".p12", ".pfx", ".jks")
SAFE_SUFFIXES = (".example", ".sample", ".template", ".dist")

SECRET_ASSIGNMENT = re.compile(
    r"""(?ix)
    \b(
        [A-Z0-9_]*(?:SECRET|PASSWORD|PASSWD|PRIVATE_KEY|ACCESS_KEY)[A-Z0-9_]*
        | [A-Z0-9_]*API_?KEY[A-Z0-9_]*
        | [A-Z0-9_]*(?:AUTH_)?TOKEN[A-Z0-9_]*
        | HMAC_?(?:SECRET|KEY)
        | VNP_?HASH_?SECRET
        | STRIPE_(?:SECRET|WEBHOOK)_[A-Z_]*
    )
    \s*[:=]\s*
    (['"])([^'"\n]{8,})\2
    """
)

PLACEHOLDER_HINTS = (
    "process.env", "configservice", "config.get", "your", "xxx", "changeme",
    "change_me", "placeholder", "example", "todo", "<", "${", "dummy", "fake",
    "test-", "-test", "secret", "redacted", "***",
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


def written_text(tool_name: str, tool_input: dict) -> str:
    parts = []
    if tool_name == "Write":
        parts.append(tool_input.get("content") or "")
    elif tool_name == "Edit":
        parts.append(tool_input.get("new_string") or "")
    elif tool_name == "MultiEdit":
        for edit in tool_input.get("edits") or []:
            parts.append((edit or {}).get("new_string") or "")
    return "\n".join(parts)


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    tool_name = data.get("tool_name")
    if tool_name not in ("Write", "Edit", "MultiEdit"):
        sys.exit(0)

    tool_input = data.get("tool_input") or {}
    path = tool_input.get("file_path") or ""
    if not path:
        sys.exit(0)

    name = os.path.basename(path)
    lowered = name.lower()

    if not lowered.endswith(SAFE_SUFFIXES):
        if lowered in SECRET_FILE_NAMES or lowered.endswith(SECRET_FILE_SUFFIXES):
            respond("deny",
                    f"BỊ CHẶN: AI không ghi vào `{name}`.\n\n"
                    "File chứa secret thuộc quyền Tâm và không bao giờ được commit "
                    "(docs/git-workflow.md §3).\n\n"
                    "Cách làm đúng khi cần thêm một biến môi trường:\n"
                    "  1. Thêm biến (kèm giá trị placeholder) vào `.env.example`.\n"
                    "  2. Thêm biến vào schema Zod của config module để app fail ngay lúc "
                    "khởi động nếu thiếu.\n"
                    "  3. Báo Tâm tên biến cần điền giá trị thật vào `.env` của máy.")

    text = written_text(tool_name, tool_input)
    if not text:
        sys.exit(0)

    for match in SECRET_ASSIGNMENT.finditer(text):
        key, value = match.group(1), match.group(3)
        if any(hint in value.lower() for hint in PLACEHOLDER_HINTS):
            continue
        respond("ask",
                f"Phát hiện có thể đang hardcode secret vào `{path}`:\n\n"
                f"  {key} = '<{len(value)} ký tự bị ẩn>'\n\n"
                "CLAUDE.md §Điều cấm: không hardcode secret; dùng env qua config module có "
                "validate bằng Zod.\n\n"
                "Nếu đây chỉ là giá trị mẫu trong test/fixture thì cho qua. Nếu là secret "
                "thật thì huỷ và chuyển sang đọc từ config.")

    sys.exit(0)


if __name__ == "__main__":
    main()
