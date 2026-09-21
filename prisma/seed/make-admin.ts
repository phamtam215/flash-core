/**
 * Nâng một tài khoản đã có lên `ADMIN`.
 *
 * **Vì sao là script chứ không phải endpoint:** một endpoint tự nâng quyền là bề mặt leo thang
 * đặc quyền — chỉ cần một lỗ ở đó là mọi lớp phòng thủ khác thành vô nghĩa. Nâng quyền là việc
 * hiếm, làm tay, và nên để lại dấu vết ở shell chứ không phải trong log HTTP.
 *
 * Dùng `pg` thẳng, cùng lý do với `seed-skus.ts`: Prisma Client sinh import kèm đuôi `.js`
 * nhưng file thật là `.ts`, và `ts-node` không có gì remap nên `require` vỡ ngay lúc nạp.
 *
 * Chạy: `npm run make-admin -- tam@example.com`
 */
import 'dotenv/config';

import { Client } from 'pg';

async function main(): Promise<void> {
  const email = process.argv[2]?.trim();
  if (!email) {
    console.error('Thiếu email.\n  npm run make-admin -- tam@example.com');
    process.exitCode = 1;
    return;
  }

  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ email: string; role: string }>(
      `UPDATE users SET role = 'ADMIN' WHERE email = $1 RETURNING email, role`,
      [email],
    );

    if (rows.length === 0) {
      // Không tự tạo user: tạo tài khoản phải đi qua `/auth/register` để mật khẩu được băm
      // bằng Argon2 đúng cách. Script này chỉ đổi đúng một cột.
      console.error(`Không tìm thấy tài khoản ${email}. Đăng ký trước rồi chạy lại.`);
      process.exitCode = 1;
      return;
    }

    console.log(`✓ ${rows[0]?.email} giờ là ${rows[0]?.role}`);
    console.log('  Lưu ý: người đó phải ĐĂNG NHẬP LẠI (hoặc chờ ≤15 phút) thì quyền mới có');
    console.log('  hiệu lực — vai trò nằm trong access token, xem roles.guard.ts.');
  } finally {
    await client.end();
  }
}

void main();
