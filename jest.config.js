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
