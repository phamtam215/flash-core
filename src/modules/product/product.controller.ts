import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';

import { AccessTokenGuard } from '../auth';
import { ZodValidationPipe } from '../../common';
import {
  createProductSchema,
  listQuerySchema,
  skuInputSchema,
  updateProductSchema,
  updateSkuSchema,
  type CreateProductDto,
  type ListQueryDto,
  type SkuInput,
  type UpdateProductDto,
  type UpdateSkuDto,
} from './product.dto';
import { ProductService } from './product.service';

/**
 * Controller chỉ làm ba việc: validate qua pipe, gọi service, gói lại đúng hình dạng response
 * trong spec. Không có logic nghiệp vụ — đó là việc của service (cùng convention với
 * `AuthController`).
 *
 * Auth: ghi (POST/PATCH/DELETE) dùng `AccessTokenGuard` có sẵn của Phase 1 — Phase 1 chưa có
 * role/admin, đây là nợ kỹ thuật đã ghi ở spec (Câu hỏi mở #1), không phải giải pháp cuối.
 * Đọc (GET) để public — client duyệt catalog chưa cần đăng nhập.
 */
@Controller()
export class ProductController {
  constructor(private readonly products: ProductService) {}

  @Post('products')
  @UseGuards(AccessTokenGuard)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body(new ZodValidationPipe(createProductSchema)) dto: CreateProductDto) {
    const product = await this.products.createProduct(dto);
    return { product };
  }

  @Get('products')
  async list(@Query(new ZodValidationPipe(listQuerySchema)) query: ListQueryDto) {
    return this.products.listProducts(query);
  }

  @Get('products/:id')
  async detail(@Param('id') id: string) {
    const { skus, ...product } = await this.products.getProductWithSkus(id);
    return { product, skus };
  }

  @Patch('products/:id')
  @UseGuards(AccessTokenGuard)
  async update(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(updateProductSchema)) dto: UpdateProductDto,
  ) {
    const product = await this.products.updateProduct(id, dto);
    return { product };
  }

  @Delete('products/:id')
  @UseGuards(AccessTokenGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async archive(@Param('id') id: string): Promise<void> {
    await this.products.archiveProduct(id);
  }

  @Post('products/:id/skus')
  @UseGuards(AccessTokenGuard)
  @HttpCode(HttpStatus.CREATED)
  async addSku(
    @Param('id') productId: string,
    @Body(new ZodValidationPipe(skuInputSchema)) dto: SkuInput,
  ) {
    const sku = await this.products.addSku(productId, dto);
    return { sku };
  }

  @Get('products/:id/skus')
  async listSkusOfProduct(@Param('id') productId: string) {
    const items = await this.products.listSkusOfProduct(productId);
    return { items };
  }

  @Patch('products/:id/skus/:skuId')
  @UseGuards(AccessTokenGuard)
  async updateSku(
    @Param('skuId') skuId: string,
    @Body(new ZodValidationPipe(updateSkuSchema)) dto: UpdateSkuDto,
  ) {
    const sku = await this.products.updateSku(skuId, dto);
    return { sku };
  }

  @Delete('products/:id/skus/:skuId')
  @UseGuards(AccessTokenGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  async deactivateSku(@Param('skuId') skuId: string): Promise<void> {
    await this.products.deactivateSku(skuId);
  }

  @Get('skus')
  async listAllSkus(@Query(new ZodValidationPipe(listQuerySchema)) query: ListQueryDto) {
    return this.products.listAllSkus(query);
  }
}
