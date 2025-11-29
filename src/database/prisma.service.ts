/**
 * Service cung cấp truy cập đến database thông qua Prisma.
 * PrismaService kế thừa từ PrismaClient của Prisma ORM,
 * cho phép thực hiện các truy vấn database một cách type-safe.
 * Service này có thể được inject vào các controller hoặc service khác.
 */
import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable() // Cho phép inject vào các class khác
export class PrismaService extends PrismaClient {} // Kế thừa các method từ PrismaClient
