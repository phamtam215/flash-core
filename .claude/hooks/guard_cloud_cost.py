#!/usr/bin/env python3
"""PreToolUse[Bash] — chặn load test / seed lớn / lệnh phá dữ liệu khi đích là CLOUD.

Vì sao: `project-context.md` quyết định #11 và §4 — bắn 1.000 VU lên free tier sẽ đốt hết
quota trong vài phút, và Neon Free là **hard cutoff** (chạm ngưỡng là DB treo tới chu kỳ
sau), không phải giảm tốc. Mục tiêu chi phí của dự án là 0đ/tháng. Một lệnh chạy nhầm đích
là đủ để phá mục tiêu đó, nên nó được chặn ở tầng hook.

Hook chỉ đọc *tên host* trong biến kết nối để phân loại local/cloud và KHÔNG BAO GIỜ in ra
giá trị biến, để không rò rỉ credential vào transcript.
"""
import json
import os
import re
import sys

# Lệnh nặng hoặc phá dữ liệu — chỉ được chạy khi đích là local
HEAVY = [
    (re.compile(r"\bk6\s+run\b"), "load test k6"),
    (re.compile(r"\bartillery\b|\bautocannon\b|\bwrk\b|\bvegeta\b"), "load test"),
    (re.compile(r"\bprisma\s+db\s+seed\b|\brun\s+seed\b|\bseed:(?:large|100k|big)\b"), "seed dữ liệu"),
    (re.compile(r"\bprisma\s+migrate\s+reset\b"), "prisma migrate reset (XÓA TOÀN BỘ DỮ LIỆU)"),
    (re.compile(r"\bdb\s+push\b.*--force-reset|--force-reset.*\bdb\s+push\b"), "db push --force-reset (XÓA DỮ LIỆU)"),
    (re.compile(r"\bTRUNCATE\b|\bDROP\s+(?:TABLE|DATABASE|SCHEMA)\b", re.I), "lệnh SQL phá dữ liệu"),
]

CLOUD_HOSTS = [
    "neon.tech", "neon.build", "upstash.io", "run.app", "googleapis.com",
    "rds.amazonaws.com", "supabase.co", "supabase.com", "azure.com",
    "planetscale", "railway.app", "render.com", "cloudsql",
]

LOCAL_HOSTS = ["localhost", "127.0.0.1", "0.0.0.0", "::1", "host.docker.internal",
               "postgres", "redis"]  # tên service trong docker-compose

CONN_VARS = ("DATABASE_URL", "DIRECT_URL", "DATABASE_URL_UNPOOLED", "REDIS_URL",
             "REDIS_HOST", "BASE_URL", "API_URL")


def deny(reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


def cloud_host_in(text: str):
    low = text.lower()
    for host in CLOUD_HOSTS:
        if host in low:
            return host
    return None


def collect_targets(command: str, project_dir: str):
    """Trả về [(nguồn, host_cloud_khớp)] cho mọi đích trông như cloud."""
    hits = []

    host = cloud_host_in(command)
    if host:
        hits.append(("chính câu lệnh", host))

    for var in CONN_VARS:
        val = os.environ.get(var)
        if val:
            host = cloud_host_in(val)
            if host:
                hits.append((f"biến môi trường {var}", host))

    for name in (".env", ".env.local", ".env.production"):
        path = os.path.join(project_dir, name)
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                for line in fh:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    key, val = line.split("=", 1)
                    if key.strip() in CONN_VARS:
                        host = cloud_host_in(val)
                        if host:
                            hits.append((f"{name} → {key.strip()}", host))
        except OSError:
            continue

    return hits


def main() -> None:
    try:
        data = json.load(sys.stdin)
    except Exception:
        sys.exit(0)

    if data.get("tool_name") != "Bash":
        sys.exit(0)

    command = (data.get("tool_input") or {}).get("command") or ""
    project_dir = os.environ.get("CLAUDE_PROJECT_DIR") or data.get("cwd") or os.getcwd()

    what = None
    for pattern, label in HEAVY:
        if pattern.search(command):
            what = label
            break
    if not what:
        sys.exit(0)

    hits = collect_targets(command, project_dir)
    if not hits:
        sys.exit(0)  # đích trông như local → cho chạy

    sources = "\n".join(f"  - {src} chứa host cloud: {host}" for src, host in hits)
    deny(
        f"BỊ CHẶN: đang định chạy **{what}** trong khi cấu hình kết nối trỏ ra CLOUD.\n\n"
        f"Phát hiện:\n{sources}\n\n"
        "Luật FinOps của dự án (project-context.md quyết định #11 và §4):\n"
        "  - Load test và seed lớn CHỈ chạy local qua Docker Compose.\n"
        "  - Neon Free là hard cutoff: chạm ngưỡng là DB treo tới chu kỳ sau.\n"
        "  - Mục tiêu chi phí: 0đ/tháng. Cloud chỉ để demo API sống.\n\n"
        "Cách xử lý:\n"
        "  1. `docker compose up -d` để có Postgres + Redis local.\n"
        "  2. Trỏ DATABASE_URL / REDIS_URL về localhost (dùng .env local, không sửa .env cloud).\n"
        "  3. Chạy lại lệnh.\n\n"
        "Nếu Tâm THỰC SỰ muốn chạy lên cloud, hãy dừng và hỏi Tâm — đừng tự quyết."
    )


if __name__ == "__main__":
    main()
