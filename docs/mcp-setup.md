# MCP servers cho Flash-Core

> **MCP (Model Context Protocol)** cho Claude Code thêm *tool* mới — ví dụ tra tài liệu thư
> viện, truy vấn DB, điều khiển browser. Nó là **tooling của người phát triển**, không phải
> dependency của app, nên không vướng luật "không thêm công nghệ mới" trong `CLAUDE.md`
> (luật đó nói về stack chạy trong production).

## Nguyên tắc chọn MCP cho dự án này

Mỗi MCP server là một process nữa phải chạy, một nguồn nhiễu nữa trong context, và (với
server có credential) một chỗ nữa để rò rỉ secret. Vì vậy chỉ bật khi nó làm được thứ
`Bash` + `Read` không làm được, hoặc làm dễ sai.

Cụ thể: **không** thêm Redis MCP và GitHub MCP, vì `redis-cli` trong `docker compose exec`
và `gh` CLI đã bao trọn nhu cầu của dự án mà không thêm process nào.

---

## 1. Context7 — ĐÃ BẬT (`.mcp.json`)

**Làm gì:** tra tài liệu chính thức, đúng phiên bản của thư viện ngay trong lúc code.

**Vì sao đáng bật cho dự án này:** stack gồm NestJS 11, Prisma, BullMQ, Zod — đều là thư
viện đổi API nhanh và **có nhiều tài liệu cũ trên mạng**. Đây là nguồn lỗi khó chịu nhất khi
để AI viết code: hàm trông rất hợp lý, tên đúng phong cách thư viện, nhưng thuộc phiên bản
2 năm trước. Với dự án mà Tâm phải review từng dòng, một API bịa mất nhiều thời gian hơn là
tra trước.

Không cần credential. Lần đầu chạy sẽ `npx` tải package (cần mạng).

**Cách dùng:** yêu cầu tra tài liệu trước khi viết code cho API lạ:

> "Trước khi implement, tra tài liệu Prisma về `$transaction` interactive và isolation level
> (dùng context7), rồi mới viết."

Có thể xin API key miễn phí ở context7.com để tăng rate limit. Khi có key, thêm vào
`.mcp.json`: `"args": ["-y", "@upstash/context7-mcp@latest", "--api-key", "..."]` —
**nhưng đừng làm thế**, vì `.mcp.json` được commit. Thay vào đó dùng
`claude mcp add --scope local` để key nằm ngoài repo.

**Phê duyệt:** phiên Claude Code tiếp theo sẽ hỏi có tin `.mcp.json` của project này không —
chọn có. Kiểm tra bằng `/mcp`.

---

## 2. Postgres MCP — bật khi tới Phase 2

**Làm gì:** đọc schema, chạy query read-only, chạy `EXPLAIN` mà không phải chui qua
`docker compose exec ... psql -c "..."` với ba tầng quote.

**Vì sao đợi tới Phase 2:** Phase 0–1 chưa có bảng nào để soi. Từ Phase 2 trở đi thì nó
đáng, vì deliverable của phase là *so sánh `EXPLAIN ANALYZE` trước/sau index* và việc đó cần
chạy EXPLAIN hàng chục lần.

```bash
claude mcp add --scope local postgres-local \
  -- npx -y @modelcontextprotocol/server-postgres \
     "postgresql://flashcore:flashcore@localhost:5432/flashcore"
```

Ba điều bắt buộc:

- **`--scope local`**, không phải project scope — connection string không được commit.
- **Chỉ trỏ vào DB local** trong Docker Compose. Không bao giờ đưa connection string Neon
  vào MCP: một câu query nặng qua MCP cũng tính vào 100 compute-giờ/tháng của Neon Free.
- Package `@modelcontextprotocol/server-postgres` là **read-only** và đã được archive
  (không còn cập nhật). Read-only chính là điều mình muốn ở đây: MCP để *đọc và đo*, còn
  migration/seed thì đi qua Prisma CLI để có phiên bản và có lịch sử.

Nếu muốn thứ mạnh hơn (đề xuất index, health check) thì có **Postgres MCP Pro**
(`crystaldba/postgres-mcp`, chạy bằng Docker hoặc pipx). Chỉ nên cân nhắc nếu thấy thiếu —
đừng bật sẵn.

---

## 3. Playwright MCP — bật khi tới Phase 3 (FE)

**Làm gì:** điều khiển browser thật, chụp screenshot, đọc DOM.

**Vì sao đáng, đúng một lần:** deliverable cuối của dự án là **video/GIF 2 phút** cảnh k6
chạy trong khi tồn kho trên FE rơi về 0 và **dừng đúng 0** (`docs/SPEC.md` §7). Đó là thứ
người tuyển dụng xem trước cả README. Playwright MCP giúp AI tự mở FE, tự bấm "Săn ngay",
tự chụp trạng thái — hữu ích cả cho việc kiểm tra 4 màn hình FE mà không cần Tâm click tay.

```bash
claude mcp add --scope local playwright -- npx -y @playwright/mcp@latest
```

FE được miễn trừ test/ADR/coverage (`docs/SPEC.md` §6, timebox 2 buổi tối) — nên dùng
Playwright MCP để *xem và chụp*, đừng biến nó thành cớ để viết bộ E2E test cho FE.

---

## 4. Đã cân nhắc và **không** thêm

| Server | Vì sao không |
|---|---|
| **Redis MCP** | `docker compose exec redis redis-cli` làm được mọi thứ cần: xem key tồn kho, chạy `EVAL` thử Lua script, `MONITOR` để xem lệnh thật. Thêm MCP chỉ để gọn hơn vài ký tự là không đáng |
| **GitHub MCP** | `gh` CLI đã có sẵn và đủ cho PR/issue. Hơn nữa dự án chỉ có một người và luật là **AI không push** — tự động hoá quanh GitHub là đi ngược quyết định #14 |
| **Docker MCP** | `docker compose` qua Bash đủ dùng và dễ đọc lại trong transcript |
| **Filesystem MCP** | Claude Code đã có Read/Write/Grep/Glob native, nhanh hơn |
| **Sequential-thinking / memory MCP** | Trùng với những gì model đã làm và với `docs/` của dự án. Thêm vào chỉ tốn context |

---

## Lệnh quản lý MCP

```bash
claude mcp list                  # xem server nào đang có, scope nào
claude mcp get <tên>             # chi tiết một server
claude mcp remove <tên>          # bỏ
```

Trong phiên Claude Code: `/mcp` để xem trạng thái kết nối và phê duyệt server từ `.mcp.json`.

## Ba scope, chọn đúng cái

| Scope | Lưu ở | Dùng khi |
|---|---|---|
| `local` (mặc định) | máy Tâm, không commit | **Mọi server có connection string / API key** |
| `project` | `.mcp.json`, commit vào repo | Server không cần credential (Context7) |
| `user` | toàn bộ máy | Server dùng cho mọi project, không riêng Flash-Core |
