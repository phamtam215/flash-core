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
  /**
   * Ngưỡng là **bánh cóc**, không phải mục tiêu: đặt hơi thấp hơn số đang đo để một thay đổi
   * bình thường không làm đỏ CI, nhưng xoá test hoặc thêm nhánh không test thì đỏ ngay.
   *
   * Chỉ đặt cho những chỗ unit test là công cụ ĐÚNG — logic quyết định, không có SQL.
   * `order.repository.ts` cố tình KHÔNG có ngưỡng: nó gần như chỉ có raw SQL, mà unit test SQL
   * bằng cách mock Prisma rồi so chuỗi câu lệnh thì chỉ chứng minh "chuỗi không đổi", không
   * chứng minh câu lệnh chạy đúng. Thứ khoá nó là 90 integration test trên Postgres thật.
   */
  coverageThreshold: {
    // **Bẫy của Jest, đã vấp:** file nào trúng một ngưỡng theo-đường-dẫn bên dưới thì bị
    // LOẠI khỏi phép tính `global`. Nên con số này (~41%) là phần CÒN LẠI của dự án, không
    // phải coverage toàn cục — toàn cục đang là ~52%, xem `npm run test:cov`.
    // Bẫy thứ hai: khoá của `coverageThreshold` tính từ **cwd**, không phải `rootDir`. Viết
    // './modules/...' thì Jest im lặng bỏ qua ngưỡng đó ("Coverage data ... was not found")
    // và mình tưởng đã có hàng rào trong khi không có gì cả.
    global: { statements: 38, lines: 36 },
    './src/modules/order/order.service.ts': { statements: 90, branches: 75 },
    './src/modules/order/order.expiry.service.ts': { statements: 90, branches: 80 },
    './src/modules/order/order.notifier.ts': { statements: 90, branches: 85 },
    './src/modules/order/order-payment.service.ts': { statements: 90, branches: 80 },
    './src/modules/order/strategies/': { statements: 90, branches: 85 },
  },
  testEnvironment: 'node',
  clearMocks: true,
};
