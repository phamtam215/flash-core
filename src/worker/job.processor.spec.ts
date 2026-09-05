import { UnrecoverableError, type Job } from 'bullmq';

import { JOB } from '../infra/queue';
import { PermanentMailError } from '../modules/mail';
import { JobProcessor } from './job.processor';

/**
 * Bộ điều phối job chỉ có một quyết định đáng test: **lỗi nào thì thôi không thử lại**.
 *
 * Không phân biệt được thì một email sai định dạng vẫn bị thử 5 lần với backoff tăng dần —
 * tốn thời gian, và làm DLQ đầy rác không giúp gì cho người đang tìm sự cố thật.
 */
describe('JobProcessor', () => {
  const notifier = { sendConfirmation: jest.fn() };
  const relay = { relayOnce: jest.fn() };
  const expiry = { cancelExpired: jest.fn(), sweepExpired: jest.fn() };
  const payments = { process: jest.fn() };
  // Metric giả: chỉ cần đếm được `inc` để kiểm nhánh completed/failed.
  const queueJobs = { inc: jest.fn() };
  const metrics = { queueJobs };

  const processor = new JobProcessor(
    relay as never,
    notifier as never,
    expiry as never,
    payments as never,
    metrics as never,
  );

  const emailJob = { name: JOB.EMAIL_CONFIRM, data: { eventId: 'e1' } } as Job;

  it('lỗi VĨNH VIỄN → UnrecoverableError, BullMQ dừng retry ngay', async () => {
    notifier.sendConfirmation.mockRejectedValueOnce(new PermanentMailError('địa chỉ sai'));

    await expect(processor.process(emailJob)).rejects.toBeInstanceOf(UnrecoverableError);
  });

  it('lỗi TẠM THỜI → ném nguyên lỗi gốc để BullMQ còn thử lại', async () => {
    const transient = new Error('SMTP tạm thời không phản hồi');
    notifier.sendConfirmation.mockRejectedValueOnce(transient);

    await expect(processor.process(emailJob)).rejects.toBe(transient);
  });

  it('tên job lạ → UnrecoverableError, không thử lại thứ không ai hiểu', async () => {
    await expect(processor.process({ name: 'job.khong-ton-tai' } as Job)).rejects.toBeInstanceOf(
      UnrecoverableError,
    );
  });

  it('job hỏng vẫn được ĐẾM trước khi ném lại — nếu không tỉ lệ lỗi luôn bằng 0', async () => {
    notifier.sendConfirmation.mockRejectedValueOnce(new Error('SMTP hỏng'));

    await expect(processor.process(emailJob)).rejects.toThrow();

    expect(queueJobs.inc).toHaveBeenCalledWith({ job: JOB.EMAIL_CONFIRM, outcome: 'failed' });
  });

  it('định tuyến đúng service cho từng tên job', async () => {
    await processor.process({ name: JOB.OUTBOX_RELAY } as Job);
    await processor.process({ name: JOB.ORDER_EXPIRE, data: { orderId: 'o1' } } as Job);
    await processor.process({ name: JOB.ORDER_EXPIRE_SWEEP } as Job);
    await processor.process({ name: JOB.PAYMENT_PROCESS, data: { eventId: 'p1' } } as Job);

    expect(relay.relayOnce).toHaveBeenCalledTimes(1);
    expect(expiry.cancelExpired).toHaveBeenCalledWith('o1');
    expect(expiry.sweepExpired).toHaveBeenCalledTimes(1);
    expect(payments.process).toHaveBeenCalledWith({ eventId: 'p1' });
  });
});
