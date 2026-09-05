import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { join } from 'node:path';

/**
 * Controller duy nhất KHÔNG thuộc module nghiệp vụ nào: nó chỉ trả trang demo của Phase 5.
 *
 * Vì sao khai tường minh route `GET /` thay vì để `useStaticAssets` tự trả `index.html`:
 * middleware tĩnh chạy TRƯỚC router của Nest, nên bật `index: true` là để nó tự quyết định
 * đường dẫn nào trả HTML — và khi nó đoán sai thì một endpoint API bỗng trả về trang web,
 * loại lỗi rất khó lần. Khai ở đây thì ý định nằm trong code, và mọi đường dẫn khác vẫn rơi
 * đúng vào 404 JSON của exception filter.
 */
@Controller()
export class AppController {
  @Get()
  index(@Res() res: Response): void {
    res.sendFile(join(__dirname, '..', 'public', 'index.html'));
  }
}
