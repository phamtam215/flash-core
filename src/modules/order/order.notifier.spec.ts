import { PermanentMailError } from '../mail';
import { OrderNotifier } from './order.notifier';

/**
 * Consumer gửi email là chỗ duy nhất trong dự án có hệ quả **nằm ngoài DB**, nên không
 * transaction nào bao được cả dấu idempotent lẫn việc gửi. Dự án chọn *ghi dấu trước*
 * (ADR-004) — tức chấp nhận **mất** mail để chắc chắn **không gửi trùng**.
 *
 * Ba tính chất dưới đây là toàn bộ nội dung của lựa chọn đó. Sửa nhầm một cái là rơi về phía
 * bên kia của đánh đổi mà không ai nhận ra, vì cả hai phía đều "chạy được".
 */
describe('OrderNotifier', () => {
  const payload = { eventId: 'e1', orderId: 'o1', userId: 'u1', totalVnd: 199_000 };

  let idempotency: { claim: jest.Mock; release: jest.Mock };
  let mailer: { send: jest.Mock };
  let users: { findEmailById: jest.Mock };
  let notifier: OrderNotifier;

  beforeEach(() => {
    idempotency = { claim: jest.fn().mockResolvedValue(true), release: jest.fn() };
    mailer = { send: jest.fn().mockResolvedValue(undefined) };
    users = { findEmailById: jest.fn().mockResolvedValue('a@b.com') };
    notifier = new OrderNotifier(idempotency as never, mailer, users);
  });

  it('⭐ dấu đã bị người khác giành → KHÔNG gửi, thoát êm (bản trùng của cùng sự kiện)', async () => {
    idempotency.claim.mockResolvedValue(false);

    await notifier.sendConfirmation(payload);

    expect(mailer.send).not.toHaveBeenCalled();
  });

  it('⭐ ghi dấu TRƯỚC khi gửi — đây là nội dung của ADR-004', async () => {
    const order: string[] = [];
    idempotency.claim.mockImplementation(() => {
      order.push('claim');
      return Promise.resolve(true);
    });
    mailer.send.mockImplementation(() => {
      order.push('send');
      return Promise.resolve();
    });

    await notifier.sendConfirmation(payload);

    expect(order).toEqual(['claim', 'send']);
  });

  it('gửi đúng địa chỉ tra từ userId, không tin gì trong payload', async () => {
    await notifier.sendConfirmation(payload);

    expect(users.findEmailById).toHaveBeenCalledWith('u1');
    expect(mailer.send).toHaveBeenCalledWith(expect.objectContaining({ to: 'a@b.com' }));
  });

  it('⭐ lỗi TẠM THỜI → trả dấu lại để BullMQ retry còn chạy được', async () => {
    mailer.send.mockRejectedValue(new Error('SMTP tạm thời không phản hồi'));

    await expect(notifier.sendConfirmation(payload as never)).rejects.toThrow();

    expect(idempotency.release).toHaveBeenCalledWith('e1', 'order.email.confirm');
  });

  it('⭐ lỗi VĨNH VIỄN → GIỮ dấu lại: job có vào DLQ cũng không ai chạy lại rồi gửi trùng', async () => {
    mailer.send.mockRejectedValue(new PermanentMailError('địa chỉ không hợp lệ'));

    await expect(notifier.sendConfirmation(payload as never)).rejects.toBeInstanceOf(
      PermanentMailError,
    );

    expect(idempotency.release).not.toHaveBeenCalled();
  });

  it('không tra được email → coi là lỗi vĩnh viễn, retry bao nhiêu lần cũng vậy', async () => {
    users.findEmailById.mockResolvedValue(null);

    await expect(notifier.sendConfirmation(payload as never)).rejects.toBeInstanceOf(
      PermanentMailError,
    );

    expect(mailer.send).not.toHaveBeenCalled();
    expect(idempotency.release).not.toHaveBeenCalled();
  });
});
