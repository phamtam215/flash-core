# Spec: RBAC — hai vai trò, chặn ghi catalog

- **Phase:** 7 (nợ chuyển tiếp từ Phase 2)
- **Ngày:** 2026-09-21
- **Trạng thái:** Đã implement 2026-09-21

## Mục tiêu

Trả nợ ghi từ [spec Phase 2](phase2-product-inventory.md): *"Role/permission (admin) thật sự
(RBAC) — Phase 1 chưa làm, Phase 2 tạm dùng… Ghi rõ đây là nợ kỹ thuật chuyển tiếp, không phải
giải pháp cuối."*

Trước commit này, **bất kỳ ai đăng ký xong đều tạo/sửa/xoá được product và SKU**. Với một dự
án portfolio thì đây là chỗ lộ liễu nhất khi người phỏng vấn mở code ra xem.

## Phạm vi — cố tình nhỏ

Hai vai trò, một cột, một guard. **Không** làm hệ permission đầy đủ (role → permission →
resource): dự án không có màn quản trị nào phức tạp, nên bộ máy đó sẽ là thứ không ai dùng.
Khi thật sự cần vai trò thứ ba thì thêm — lúc đó đã **biết** nó cần quyền gì, thay vì đoán
trước.

| | |
|---|---|
| `USER` (mặc định) | Mua hàng, xem/huỷ đơn của chính mình, **đọc** catalog |
| `ADMIN` | Thêm quyền **ghi** catalog: 6 endpoint product/SKU |

## Thiết kế

### Vai trò nằm trong access token, không truy vấn DB

`RolesGuard` đọc `request.role` do `AccessTokenGuard` gắn từ payload JWT. Không có round-trip
DB nào thêm — cùng lựa chọn stateless đã chốt cho `AccessTokenGuard` ở Phase 1.

**Đánh đổi phải nói ra: hạ quyền một người chỉ có hiệu lực sau khi access token của họ hết hạn
(≤15 phút).** Đây **không** phải bug, và test #5–#7 khoá lại hành vi đó để nó không đổi im
lặng. Muốn tức thì thì phải hỏi DB ở **mọi** request — thêm một round-trip vào mọi endpoint để
rút ngắn một khe 15 phút mà dự án chưa có nhu cầu. Đúng là đánh đổi đã ghi cho việc xoá user ở
[`access-token.guard.ts`](../../src/modules/auth/access-token.guard.ts), không phải ngoại lệ mới.

`POST /auth/refresh` đọc lại `role` từ DB, nên khe chờ là **15 phút** (hạn access token), không
phải 7 ngày (hạn refresh token).

### Nâng quyền bằng script, không bằng endpoint

`npm run make-admin -- tam@example.com`.

Một endpoint tự nâng quyền là **bề mặt leo thang đặc quyền** — chỉ cần một lỗ ở đó là mọi lớp
phòng thủ khác thành vô nghĩa. Nâng quyền là việc hiếm, làm tay, và nên để lại dấu vết ở shell
chứ không phải trong log HTTP.

### Guard KHÔNG toàn cục — khác `CsrfGuard`

`CsrfGuard` đăng ký bằng `APP_GUARD` vì luật của nó **đúng cho mọi endpoint ghi**. Vai trò thì
mỗi route một khác, nên guard toàn cục sẽ phải mang một danh sách đường dẫn — thứ luôn lệch với
code thật. Ở đây dùng `@UseGuards(AccessTokenGuard, RolesGuard)` + `@Roles(Role.ADMIN)`.

**Thứ tự trong `@UseGuards` quan trọng:** Nest chạy guard theo đúng thứ tự khai báo, và
`RolesGuard` đọc `request.role` do `AccessTokenGuard` gắn. Đảo lại thì `role` là `undefined`.
Guard **fail-closed** ở ca đó (chặn, không mở) — test unit #5 khoá lại, vì nếu mở thì một lỗi
thứ tự khai báo biến mọi người thành admin mà không test nào khác bắt được.

## Migration

```sql
CREATE TYPE "Role" AS ENUM ('USER', 'ADMIN');
ALTER TABLE "users" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'USER';
```

Từ Postgres 11, thêm cột `NOT NULL` kèm `DEFAULT` **hằng số** là thao tác **metadata-only** —
giá trị mặc định lưu trong catalog, không ghi lại từng dòng. Chạy tức thì kể cả khi `users` đã
lớn. `DEFAULT 'USER'` cũng là lựa chọn an toàn duy nhất: mọi tài khoản đang có và sẽ có đều
**không** phải admin cho tới khi có người chủ động nâng.

## Test cases — đã pass

Unit ([`roles.guard.spec.ts`](../../src/modules/auth/roles.guard.spec.ts)), 6 test:
route không khai `@Roles` → cho qua; `@Roles()` rỗng → cho qua; đúng vai trò → qua;
⭐ USER gọi route đòi ADMIN → 403; ⭐ `role` rỗng → **chặn**; nhiều vai trò → khớp một là qua.

Integration ([`test/rbac.e2e-spec.ts`](../../test/rbac.e2e-spec.ts)), 9 test:

1. Đăng ký mặc định là `USER`.
2. ⭐ USER `POST /products` → `403 FORBIDDEN_ROLE`, **và không product nào được tạo** (chặn
   trước khi chạm DB).
3. ADMIN `POST /products` → `201`.
4. USER vẫn `GET /products` → `200` — RBAC chỉ chặn ghi.
5. ⭐ Nâng quyền **sau** khi đã đăng nhập → token cũ vẫn `USER` → vẫn `403`.
6. ⭐ …đăng nhập lại → `201` ngay.
7. `POST /auth/refresh` cũng cập nhật vai trò.
8. USER `PATCH`/`DELETE` product → `403`, dữ liệu **không đổi**.
9. Chưa đăng nhập → `401` (`AccessTokenGuard` chặn trước `RolesGuard`).

**Tổng sau thay đổi: 163 unit + 120 integration, `npm run check` sạch.**

## Ngoài phạm vi (Non-goals)

- **Vai trò thứ ba** (moderator, support…). Chưa có việc cho nó làm.
- **Permission theo tài nguyên** ("admin này chỉ sửa được product của shop X"). Dự án một shop.
- **Màn quản trị trên UI.** Trang demo là công cụ trực quan hoá, không phải sản phẩm (ADR-007).
- **Audit log ai đổi gì.** Đáng làm khi có nhiều admin thật; giờ ghi ra làm nợ.
- **Endpoint tự nâng quyền.** Cố tình không làm — xem §Thiết kế.
