/**
 * Service chính của ứng dụng.
 * Service trong NestJS chứa logic nghiệp vụ của ứng dụng.
 * Chúng có thể được inject vào controller hoặc service khác.
 * AppService cung cấp method getHello() trả về thông điệp chào mừng.
 */
import { Injectable } from '@nestjs/common';

@Injectable() // Đánh dấu class này là provider có thể được inject
export class AppService {
  // Method trả về chuỗi "Hello World!"
  getHello(): string {
    return 'Hello World!';
  }
}
