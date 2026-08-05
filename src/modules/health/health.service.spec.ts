import { HealthService } from './health.service';
import type { PrismaService } from '../../infra/prisma';

/**
 * Unit test cho HealthService.
 *
 * Ở đây mock Prisma là ĐÚNG, vì thứ đang test là *logic phân loại* của service ("DB trả lời
 * được thì ready, không thì không ready"), không phải hành vi của Postgres. Ngược lại, test
 * concurrency ở Phase 3 thì tuyệt đối không được mock — race condition chỉ hiện ra trên DB
 * thật (xem skill `test-contract`).
 */
describe('HealthService', () => {
  const makeService = (queryRaw: jest.Mock): HealthService =>
    new HealthService({ $queryRaw: queryRaw } as unknown as PrismaService);

  describe('liveness', () => {
    it('luôn trả về ok kèm uptime, không phụ thuộc DB', () => {
      const queryRaw = jest.fn().mockRejectedValue(new Error('DB chết'));

      const result = makeService(queryRaw).liveness();

      expect(result.status).toBe('ok');
      expect(result.uptimeSeconds).toBeGreaterThanOrEqual(0);
      // Điểm quan trọng nhất của test này: liveness KHÔNG được chạm tới DB. Nếu nó chạm,
      // DB chết sẽ khiến Cloud Run restart container một cách vô ích.
      expect(queryRaw).not.toHaveBeenCalled();
    });
  });

  describe('readiness', () => {
    it('ready = true khi DB trả lời được', async () => {
      const queryRaw = jest.fn().mockResolvedValue([{ '1': 1 }]);

      const result = await makeService(queryRaw).readiness();

      expect(result).toEqual({ ready: true, checks: { database: 'up' } });
      expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    it('ready = false khi DB lỗi, và KHÔNG throw ra ngoài', async () => {
      const queryRaw = jest.fn().mockRejectedValue(new Error('connection refused'));

      // Không throw là yêu cầu nghiệp vụ: controller cần đọc được report để trả 503 kèm
      // thông tin check nào fail. Nếu service throw, client chỉ nhận 500 vô nghĩa.
      const result = await makeService(queryRaw).readiness();

      expect(result).toEqual({ ready: false, checks: { database: 'down' } });
    });
  });
});
