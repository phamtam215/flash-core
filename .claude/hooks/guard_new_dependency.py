#!/usr/bin/env python3
"""PreToolUse[Bash] — kiểm soát việc thêm dependency mới.

Vì sao: `CLAUDE.md` §Điều cấm và `project-context.md` quyết định #13 — "8 công nghệ hiểu sâu
> 15 công nghệ hiểu lờ mờ". Người phỏng vấn giỏi phát hiện resume-driven development trong
2 câu hỏi. Vì vậy thêm công nghệ mới phải qua ADR để Tâm quyết, không phải một lệnh
`npm install` lặng lẽ giữa lúc code.

- Package thuộc stack đã chốt → cho qua im lặng.
- Package đã bị loại bỏ có chủ đích → DENY, kèm lý do đã ghi trong decision log.
- Package lạ → ASK, để Tâm tự quyết (không chặn cứng, vì có thể là util nhỏ hợp lý).
"""
import json
import re
import shlex
import sys

INSTALL_RE = re.compile(
    r"\b(?:npm\s+(?:i|install|add)|yarn\s+add|pnpm\s+(?:add|install)|bun\s+add)\b"
)

# Stack đã chốt trong CLAUDE.md + hạ tầng test/lint + FE của Phase 3.
# Khớp theo *chuỗi con* — tiện cho các họ package (@nestjs/*, @types/*).
ALLOWED_SUBSTRINGS = (
    "nestjs", "@nestjs", "prisma", "zod", "bullmq", "ioredis", "pino", "argon2",
    "jest", "supertest", "testcontainers", "typescript", "ts-node", "ts-jest",
    "eslint", "prettier", "@types/", "reflect-metadata", "rxjs", "dotenv",
    "cookie-parser", "helmet", "nestjs-zod", "uuid", "prom-client",
    # FE (docs/SPEC.md §6 — AI làm 100%, timebox 2 buổi tối, Phase 3)
    "react", "react-dom", "vite", "@vitejs", "tailwindcss", "postcss", "autoprefixer",
    "axios", "swr",
)

# Khớp theo *tên chính xác* — dùng cho tên ngắn, vì để chúng vào danh sách chuỗi con sẽ
# khớp nhầm hàng loạt package khác (ví dụ "pg" khớp cả "pg-promise", "sequelize-pg"...).
ALLOWED_EXACT = {
    # Prisma 7 cần driver adapter: client không tự quản kết nối nữa, nó dùng pg.Pool.
    "pg",
    "@prisma/adapter-pg",
}

# Đã bị loại bỏ có chủ đích — nêu rõ nguồn quyết định
REJECTED = {
    "kafkajs": "Kafka — loại ở quyết định #13 (không thêm công nghệ mới)",
    "amqplib": "RabbitMQ — loại ở quyết định #13",
    "@nestjs/microservices": "Microservices — loại ở quyết định #3 (chọn Modular Monolith)",
    "typeorm": "TypeORM — loại ở quyết định #5 (giữ Prisma)",
    "drizzle-orm": "Drizzle — loại ở quyết định #5 (giữ Prisma)",
    "sequelize": "Sequelize — loại ở quyết định #5 (giữ Prisma)",
    "class-validator": "class-validator — loại ở quyết định #7 (dùng Zod)",
    "@elastic/elasticsearch": "Elasticsearch — loại ở quyết định #13",
    "@grpc/grpc-js": "gRPC — loại ở quyết định #13",
    "mongoose": "MongoDB — không thuộc stack (Postgres 16 + Prisma)",
    "mysql2": "MySQL — loại ở quyết định #4 (cố tình chọn Postgres để mở rộng skill)",
    "bcrypt": "bcrypt — dự án dùng Argon2 (xem câu hỏi bản chất Phase 1: vì sao Argon2 > bcrypt)",
    "bcryptjs": "bcrypt — dự án dùng Argon2",
}

SUBCOMMANDS = {"i", "install", "add"}


def respond(decision: str, reason: str) -> None:
    print(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": decision,
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
    if not INSTALL_RE.search(command):
        sys.exit(0)

    try:
        tokens = shlex.split(command)
    except ValueError:
        sys.exit(0)

    packages = []
    seen_subcommand = False
    for tok in tokens:
        if tok in ("npm", "yarn", "pnpm", "bun"):
            seen_subcommand = False
            continue
        if tok in SUBCOMMANDS:
            seen_subcommand = True
            continue
        if not seen_subcommand or tok.startswith("-"):
            continue
        if tok in ("&&", "||", ";"):
            seen_subcommand = False
            continue
        packages.append(tok)

    if not packages:
        sys.exit(0)  # `npm install` trơn = cài từ lockfile, không thêm gì mới

    def base_name(spec: str) -> str:
        # "@scope/pkg@1.2.3" -> "@scope/pkg" ; "pkg@^1" -> "pkg"
        if spec.startswith("@"):
            parts = spec.split("@")
            return "@" + parts[1] if len(parts) > 1 else spec
        return spec.split("@")[0]

    names = [base_name(p) for p in packages]

    blocked = [(n, REJECTED[n]) for n in names if n in REJECTED]
    if blocked:
        detail = "\n".join(f"  - {n}: {why}" for n, why in blocked)
        respond("deny",
                "BỊ CHẶN: package này đã bị loại bỏ CÓ CHỦ ĐÍCH trong nhật ký quyết định.\n\n"
                f"{detail}\n\n"
                "Xem project-context.md §3 (Decision Log). Nếu Tâm muốn xem lại quyết định "
                "cũ, hãy viết ADR mới (skill `adr-writer`) thay vì cài trực tiếp — quyết "
                "định cũ không được sửa, chỉ được thay thế bằng ADR mới.")

    unknown = [n for n in names
               if n not in ALLOWED_EXACT
               and not any(s in n.lower() for s in ALLOWED_SUBSTRINGS)]
    if unknown:
        respond("ask",
                "Sắp thêm dependency ngoài stack đã chốt: " + ", ".join(unknown) + "\n\n"
                "CLAUDE.md §Điều cấm: không thêm công nghệ mới — nếu thấy cần, đề xuất qua "
                "ADR để Tâm quyết.\n"
                "project-context.md quyết định #13: 8 công nghệ hiểu sâu > 15 công nghệ hiểu "
                "lờ mờ; câu 'vì sao anh KHÔNG dùng X' trả lời được bằng trade-off là câu ghi "
                "điểm Senior.\n\n"
                "Anh Tâm quyết: cho cài, hay để Claude viết ADR trước, hay tìm cách làm mà "
                "không cần package này?")

    sys.exit(0)


if __name__ == "__main__":
    main()
