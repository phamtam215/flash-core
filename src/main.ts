/**
 * ĐIỂM BẮT ĐẦU CỦA TOÀN BỘ APP.
 *
 * Khi chạy `npm run dev` hoặc `node dist/main.js`, Node đọc file này trước tiên. Mọi thứ
 * khác trong `src/` chỉ chạy vì file này gọi tới.
 *
 * File chỉ có ~20 dòng lệnh, nhưng THỨ TỰ của chúng quan trọng: đảo hai dòng là app hỏng
 * theo kiểu rất khó đoán. Mỗi khối dưới đây ghi rõ *vì sao* nó phải nằm đúng chỗ đó.
 *
 * Đọc file này xong, đọc tiếp `app.module.ts` — nơi các mảnh được ráp lại.
 *
 * (Ghi chú: file này được comment kỹ hơn mức bình thường vì nó là cửa vào của dự án và
 * dùng để học. Các file khác comment gọn hơn — chỉ ghi "vì sao", không giải thích lại
 * kiến thức nền.)
 */

// ---------------------------------------------------------------------------------------
// BƯỚC 1 — Nạp file .env vào bộ nhớ
// ---------------------------------------------------------------------------------------
//
// LÀM GÌ: đọc file `.env` ở thư mục gốc và đổ từng dòng vào `process.env` — cái kho biến
// môi trường toàn cục của Node.
//
// VÌ SAO PHẢI LÀ IMPORT ĐẦU TIÊN: JavaScript chạy các `import` theo đúng thứ tự viết, và
// chạy XONG HẾT chúng trước khi vào thân hàm. Dòng `import { AppModule }` bên dưới kéo theo
// cả cây module, trong đó `ConfigModule` sẽ đọc `process.env` để validate. Nếu `dotenv`
// chưa chạy tại thời điểm đó thì `process.env` còn rỗng.
//
// NẾU ĐẢO THỨ TỰ: app báo `DATABASE_URL là bắt buộc` và chết lúc khởi động, **dù file .env
// của anh hoàn toàn đầy đủ**. Đây là loại lỗi tốn hàng giờ vì thông báo lỗi trỏ sai chỗ —
// nó nói "thiếu biến", còn nguyên nhân thật là "đọc quá sớm".
//
// PHƯƠNG ÁN KHÁC:
//   - `node --env-file=.env` (Node 20+): không cần thư viện, nhưng phải nhớ thêm cờ ở mọi
//     nơi chạy app (script npm, Dockerfile, CI) — quên một chỗ là hỏng một chỗ.
//   - `ConfigModule.forRoot()` của `@nestjs/config`: tự nạp .env, nhưng dự án không dùng
//     thư viện đó (lý do ở `docs/adr/002-nen-mong-ky-thuat-phase-0.md`).
//
// LÊN PRODUCTION: Cloud Run không có file `.env` — biến môi trường được tiêm thẳng vào
// process. Lúc đó dòng này không tìm thấy file và **im lặng bỏ qua**, đúng như mong muốn.
import 'dotenv/config';

import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';

import { AppModule } from './app.module';
import { ENV, type Env } from './config';

/**
 * Hàm khởi động app.
 *
 * Là `async` vì hầu hết các bước bên trong đều phải chờ: dựng cây module, kết nối Postgres,
 * mở cổng mạng. Tên `bootstrap` là quy ước của NestJS — mọi dự án Nest đều dùng tên này.
 */
async function bootstrap(): Promise<void> {
  // -------------------------------------------------------------------------------------
  // BƯỚC 2 — Dựng app
  // -------------------------------------------------------------------------------------
  //
  // LÀM GÌ: `NestFactory.create` đọc `AppModule`, đi theo cây `imports` để tìm hết mọi
  // module, rồi **tạo sẵn một instance cho từng provider** (service, config, PrismaService…)
  // và tự cắm chúng vào nhau qua constructor. Cái máy làm việc này gọi là IoC container.
  //
  // Đây là lý do trong code không bao giờ thấy `new HealthService(...)`: mình chỉ khai báo
  // "tôi cần PrismaService", container lo phần tìm và đưa vào. Nhờ vậy lúc viết test có thể
  // đưa vào một bản giả mà không sửa code thật.
  //
  // LƯU Ý: mọi lỗi cấu hình nổ ra ở ĐÂY, không phải lúc có request. Ví dụ thiếu
  // `DATABASE_URL` thì `ConfigModule` throw ngay trong dòng này. Đó là chủ đích — xem
  // `src/config/env.schema.ts`.
  const app = await NestFactory.create(AppModule, {
    // `bufferLogs: true` — GIỮ LOG LẠI TRONG BỘ NHỚ, chưa in ra vội.
    //
    // VÌ SAO: logger Pino của dự án nằm trong `LoggerModule`, mà module đó chỉ tồn tại SAU
    // KHI dòng `create()` này chạy xong. Khoảng thời gian ở giữa là "vùng chưa có logger".
    //
    // NẾU KHÔNG BẬT: Nest dùng logger mặc định của nó cho giai đoạn đó → log khởi động ra
    // một định dạng, log về sau ra một định dạng khác (JSON). Khi lên production và gom log
    // bằng máy, những dòng đầu tiên sẽ không parse được — mà đó lại đúng là những dòng
    // quan trọng nhất khi app chết lúc khởi động.
    //
    // Bật cờ này thì Nest ngậm log lại, chờ tới khi `useLogger()` ở bước 3 chỉ định logger
    // thật, rồi phát lại toàn bộ qua logger đó. Không mất dòng nào.
    bufferLogs: true,
  });

  // -------------------------------------------------------------------------------------
  // BƯỚC 3 — Chỉ định logger thật
  // -------------------------------------------------------------------------------------
  //
  // LÀM GÌ: `app.get(Logger)` hỏi container "đưa tôi instance Logger của nestjs-pino".
  // `app.useLogger(...)` bảo Nest: từ giờ mọi log nội bộ của framework cũng đi qua nó.
  //
  // VÌ SAO QUAN TRỌNG: đây là lúc đống log đang bị giữ ở bước 2 được xả ra. Và từ đây mọi
  // dòng log — kể cả của chính NestJS — đều là JSON có `correlationId`, tức là truy vết
  // được (xem `src/common/logger/logger.module.ts`).
  //
  // NẾU BỎ DÒNG NÀY: `bufferLogs: true` ở trên thành có hại — log bị giữ lại mà không ai
  // xả ra, coi như mất trắng phần khởi động. Hai dòng này là một cặp, luôn đi cùng nhau.
  app.useLogger(app.get(Logger));

  // -------------------------------------------------------------------------------------
  // BƯỚC 4 — Đăng ký dọn dẹp khi bị tắt
  // -------------------------------------------------------------------------------------
  //
  // LÀM GÌ: bảo Nest lắng nghe tín hiệu tắt của hệ điều hành (SIGTERM khi cloud thay
  // phiên bản, SIGINT khi anh bấm Ctrl+C). Khi nhận được, Nest gọi `onModuleDestroy()` của
  // mọi service trước khi cho process chết.
  //
  // VÌ SAO CẦN: mặc định Node **chết ngay lập tức** khi nhận SIGTERM, không chạy dọn dẹp gì.
  // Trong dự án này, `PrismaService.onModuleDestroy()` là nơi đóng connection pool tới
  // Postgres (xem `src/infra/prisma/prisma.service.ts`).
  //
  // NẾU KHÔNG BẬT — hai thiệt hại cụ thể:
  //   1. Mỗi lần deploy lại, các connection cũ bị bỏ rơi và Postgres phải chờ hết timeout
  //      mới thu hồi. Neon Free giới hạn số connection, nên deploy vài lần liên tiếp có thể
  //      hết connection dù chẳng có ai dùng app.
  //   2. Từ Phase 4 (BullMQ), job đang chạy dở sẽ bị cắt giữa chừng — đơn hàng xử lý một nửa.
  //
  // PHƯƠNG ÁN KHÁC: tự viết `process.on('SIGTERM', ...)`. Nhược điểm: phải tự nhớ gọi dọn
  // dẹp cho từng service, và mỗi service mới thêm vào lại phải sửa file này. Cách của Nest
  // gọi tự động toàn bộ, không sót.
  //
  // ĐẶT ĐÚNG CHỖ: phải gọi TRƯỚC `listen()`. Đăng ký sau khi đã mở cổng thì có một khoảng
  // app đã nhận request nhưng chưa biết cách tắt an toàn.
  app.enableShutdownHooks();

  // -------------------------------------------------------------------------------------
  // BƯỚC 5 — Mở cổng, bắt đầu nhận request
  // -------------------------------------------------------------------------------------
  //
  // `app.get<Env>(ENV)` lấy object cấu hình ĐÃ ĐƯỢC VALIDATE ở bước 2. Không đọc thẳng
  // `process.env.PORT` ở đây, vì `process.env` luôn trả về chuỗi (`"3000"`) và không ai
  // kiểm tra nó có phải số hợp lệ hay không. `env.PORT` thì chắc chắn là số — Zod đã ép
  // kiểu và kiểm tra rồi. Quy tắc của dự án: **chỉ `src/config/` được đọc `process.env`.**
  const env = app.get<Env>(ENV);

  // `'0.0.0.0'` = lắng nghe trên MỌI card mạng, không chỉ localhost.
  //
  // VÌ SAO GHI RÕ: khi app chạy trong container (Docker, Cloud Run), "localhost" là
  // localhost *bên trong container đó* — bên ngoài gọi vào sẽ bị từ chối, và triệu chứng
  // là "app log ra là đã chạy, nhưng curl không thấy gì". Ghi rõ `0.0.0.0` để ý định này
  // nằm trong code chứ không phụ thuộc vào giá trị mặc định của thư viện.
  await app.listen(env.PORT, '0.0.0.0');

  // Dòng log đầu tiên của app, và cũng là tín hiệu "mọi bước trên đã qua an toàn".
  app.get(Logger).log(`Flash-Core đang chạy tại http://localhost:${env.PORT} (${env.NODE_ENV})`);
}

// -----------------------------------------------------------------------------------------
// GỌI HÀM KHỞI ĐỘNG
// -----------------------------------------------------------------------------------------
//
// `bootstrap()` là hàm async nên nó trả về một Promise. Ở tầng ngoài cùng của file không có
// gì để `await` cả, nên ta không chờ nó.
//
// VÌ SAO CÓ TỪ KHOÁ `void`: đây là lời tuyên bố "tôi CỐ Ý không chờ Promise này". ESLint của
// dự án bật rule `no-floating-promises` — nó chặn việc bỏ quên Promise, vì Promise bị bỏ
// quên là nguồn bug im lặng kinh điển (lỗi xảy ra nhưng không ai bắt được). Viết `void` là
// cách nói với linter: trường hợp này có chủ đích.
//
// PHƯƠNG ÁN KHÁC: `bootstrap().catch((e) => { console.error(e); process.exit(1); })` — bắt
// lỗi khởi động rồi tự thoát. Dự án không làm vậy vì hành vi mặc định của Node khi Promise
// bị reject cũng là in stack trace rồi thoát với mã lỗi khác 0 — tức là đã đủ "chết ồn ào",
// đúng điều mình muốn cho lỗi cấu hình. Thêm `.catch` chỉ để in đẹp hơn thì chưa đáng.
void bootstrap();
