/**
 * Controller chính của ứng dụng.
 * Controller trong NestJS chịu trách nhiệm xử lý các request HTTP
 * và trả về response. Ở đây, AppController xử lý route gốc "/"
 * với method GET, trả về một thông điệp chào mừng.
 */
import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';

@Controller() // Định nghĩa controller cho route gốc (không có prefix)
export class AppController {
  // Inject AppService vào constructor để sử dụng logic từ service
  constructor(private readonly appService: AppService) {}

  @Get() // Xử lý request GET đến route "/"
  getHello(): string {
    return this.appService.getHello(); // Gọi method từ service
  }
}
