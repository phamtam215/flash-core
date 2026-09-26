import { SetMetadata } from '@nestjs/common';

export const IP_RATE_LIMIT_KEY = 'ip_rate_limit';

export interface IpRateLimitOptions {
  /** Đi vào khoá Redis: `ratelimit:ip:<name>:<ip>`. Đổi tên = reset bộ đếm. */
  readonly name: string;
  readonly max: number;
  readonly windowSeconds: number;
}

/**
 * Giới hạn số lần gọi một endpoint theo **địa chỉ IP**.
 *
 * Khác `assertNotRateLimited` của `auth.service` (đếm theo **email**) — và hai cái giải hai
 * bài toán khác nhau, không thay được cho nhau:
 *
 * | | Theo email | Theo IP |
 * |---|---|---|
 * | Dùng cho | Đăng nhập — đã biết đang nói về tài khoản nào | Đăng ký — **chưa có tài khoản nào để khoá** |
 * | Chặn được | Dò mật khẩu một tài khoản từ nghìn IP | Tạo hàng loạt tài khoản từ một máy |
 * | Né được bằng | — | Đổi IP (botnet, proxy rẻ) |
 *
 * IP không hoàn hảo: cả một quán net hay một văn phòng dùng chung NAT sẽ chung một IP. Vì vậy
 * ngưỡng phải **rộng rãi** — chặn script, không chặn người thật.
 */
export const IpRateLimit = (options: IpRateLimitOptions) => SetMetadata(IP_RATE_LIMIT_KEY, options);
