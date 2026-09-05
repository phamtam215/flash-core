/**
 * Hợp đồng gửi mail. Phase 4 KHÔNG gửi mail thật (spec §Non-goals) — bài học của phase là
 * hàng đợi và tính idempotent, không phải SMTP.
 *
 * Vì sao vẫn tách thành interface thay vì gọi thẳng `logger.log`: nhờ nó mà test đếm được số
 * lần gửi, và đó chính là cách kiểm chứng "không gửi email trùng" — cổng chính của phase.
 * Đổi sang SMTP thật sau này chỉ là thêm một implementation, không đụng vào worker.
 */
export interface MailSender {
  send(mail: { to: string; subject: string; body: string }): Promise<void>;
}

export const MAIL_SENDER = Symbol('MAIL_SENDER');

/**
 * Lỗi mà retry KHÔNG cứu được (địa chỉ sai định dạng, người nhận không tồn tại).
 *
 * Phân biệt lỗi tạm thời với lỗi vĩnh viễn là việc bắt buộc: thử lại 5 lần cho một email
 * viết sai chính tả chỉ tốn thời gian và làm DLQ đầy rác — bug đã ghi ở tech-playbook
 * §Phase 4 ("job retry mãi cho lỗi không thể sửa").
 */
export class PermanentMailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentMailError';
  }
}
