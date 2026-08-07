/**
 * Jest cho UNIT test — chạy nhanh, không cần Docker.
 * Integration test (Postgres/Redis thật qua Testcontainers) nằm ở
 * `test/jest-integration.json` và chạy bằng `npm run test:int`.
 *
 * Vì sao tách hai config: unit test phải chạy được liên tục trong lúc code (vài giây),
 * còn integration test mất hàng chục giây vì phải dựng container. Trộn chung thì mình sẽ
 * ngừng chạy test thường xuyên — và test không được chạy thì bằng không có test.
 */
module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: 'src',
  testRegex: '.*\\.spec\\.ts$',
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/../tsconfig.json' }],
  },
  // Prisma 7 sinh import kèm đuôi ".js" (đúng chuẩn moduleResolution node16), nhưng file
  // thật trên đĩa là ".ts" vì client được generate ra dạng TypeScript source. Resolver của
  // Jest chỉ thử thêm đuôi khi đường dẫn CHƯA có đuôi, nên "./internal/class.js" không bao
  // giờ tìm thấy "./internal/class.ts". Map ngược lại ở đây.
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  collectCoverageFrom: [
    '**/*.ts',
    '!**/*.module.ts',
    '!**/index.ts',
    '!main.ts',
    '!generated/**', // code do prisma generate sinh ra
  ],
  coverageDirectory: '../coverage',
  testEnvironment: 'node',
  clearMocks: true,
};
