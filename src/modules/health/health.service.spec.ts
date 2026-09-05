import { HealthService } from './health.service';
import type { PrismaService } from '../../infra/prisma';
import type { RedisService } from '../../infra/redis';

/**
 * Unit test cho HealthService.
 *
 * Ở đây mock Prisma là ĐÚNG, vì thứ đang test là *logic phân loại* của service ("DB trả lời
 * được thì ready, không thì không ready"), không phải hành vi của Postgres. Ngược lại, test
 * concurrency ở Phase 3 thì tuyệt đối không được mock — race condition chỉ hiện ra trên DB
 * thật (xem skill `test-contract`).
 */
describe('HealthService', () => {
  const makeService = (queryRaw: jest.Mock, ping: jest.Mock = jest.fn().mockResolvedValue('PONG')): HealthService =>
    new HealthService({ $queryRaw: queryRaw } as unknown as PrismaService, {
      client: { ping },
    } as unknown as RedisService);

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

      expect(result).toEqual({
        ready: true,
        checks: { database: 'up', redis: 'up', shuttingDown: false },
      });
      expect(queryRaw).toHaveBeenCalledTimes(1);
    });

    it('ready = false khi DB lỗi, và KHÔNG throw ra ngoài', async () => {
      const queryRaw = jest.fn().mockRejectedValue(new Error('connection refused'));

      // Không throw là yêu cầu nghiệp vụ: controller cần đọc được report để trả 503 kèm
      // thông tin check nào fail. Nếu service throw, client chỉ nhận 500 vô nghĩa.
      const result = await makeService(queryRaw).readiness();

      expect(result.ready).toBe(false);
      expect(result.checks.database).toBe('down');
    });

    it('ready = false khi REDIS lỗi, dù DB vẫn sống', async () => {
      // Trước Phase 6 instance này vẫn báo "sẵn sàng" — nên request cứ được gửi vào một
      // instance mà chiến lược tồn kho `redis`, rate limit và toàn bộ queue đều đang hỏng.
      const queryRaw = jest.fn().mockResolvedValue([{ '1': 1 }]);
      const ping = jest.fn().mockRejectedValue(new Error('connection refused'));

      const result = await makeService(queryRaw, ping).readiness();

      expect(result.ready).toBe(false);
      expect(result.checks).toMatchObject({ database: 'up', redis: 'down' });
    });

    it('sau beginShutdown() → ready = false dù mọi dependency đều sống', async () => {
      // Đây là cơ chế rút khỏi vòng phục vụ: load balancer thấy 503 thì ngừng gửi request
      // mới, trong khi app vẫn xử lý nốt request đang chạy dở.
      const service = makeService(jest.fn().mockResolvedValue([{ '1': 1 }]));

      service.beginShutdown();
      const result = await service.readiness();

      expect(result.ready).toBe(false);
      expect(result.checks).toMatchObject({ database: 'up', redis: 'up', shuttingDown: true });
    });
  });
});
