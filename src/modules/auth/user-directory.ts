/**
 * Cửa công khai duy nhất của `auth` cho các module khác hỏi về người dùng.
 *
 * Vì sao là interface + token chứ không export thẳng `AuthRepository`: bảng `users` do module
 * `auth` sở hữu, và cửa này cố tình **chỉ** cho hỏi đúng một thứ. Export cả repository là mở
 * toang bảng cho mọi module ghi — đúng kiểu xói mòn ranh giới mà `architecture.md` quy tắc 1
 * muốn chặn.
 *
 * Phase 4 cần nó để worker gửi email biết địa chỉ người nhận.
 */
export interface UserDirectory {
  findEmailById(userId: string): Promise<string | null>;
}

export const USER_DIRECTORY = Symbol('USER_DIRECTORY');
