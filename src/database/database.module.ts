/**
 * Module quản lý kết nối database sử dụng Prisma.
 * DatabaseModule cung cấp PrismaService để các phần khác của ứng dụng
 * có thể tương tác với database. Nó export PrismaService để các module khác import.
 */
import { Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Module({
  providers: [PrismaService], // Đăng ký PrismaService như một provider
  exports: [PrismaService], // Export để các module khác có thể inject PrismaService
})
export class DatabaseModule {}
