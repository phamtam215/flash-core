import { Injectable } from '@nestjs/common';

import { decodeCursor, paginate } from '../../common';
import { ProductNotFoundError, SkuAlreadyExistsError, SkuNotFoundError, SlugAlreadyExistsError } from './product.errors';
import type { CreateProductDto, ListQueryDto, SkuInput, UpdateProductDto, UpdateSkuDto } from './product.dto';
import { ProductRepository } from './product.repository';
import { slugify } from './product.slug';

@Injectable()
export class ProductService {
  constructor(private readonly repo: ProductRepository) {}

  async createProduct(dto: CreateProductDto) {
    const slug = dto.slug ?? slugify(dto.name);

    const existing = await this.repo.findProductBySlug(slug);
    if (existing) throw new SlugAlreadyExistsError();

    return this.repo.createProduct(slug, dto);
  }

  async listProducts(query: ListQueryDto) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = await this.repo.listProducts(cursor, query.limit);
    return paginate(rows, query.limit);
  }

  async getProductWithSkus(id: string) {
    const product = await this.repo.findProductWithSkus(id);
    if (!product) throw new ProductNotFoundError();
    return product;
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    await this.assertProductExists(id);
    return this.repo.updateProduct(id, dto);
  }

  async archiveProduct(id: string): Promise<void> {
    await this.assertProductExists(id);
    await this.repo.archiveProduct(id);
  }

  async addSku(productId: string, sku: SkuInput) {
    const product = await this.repo.findProductById(productId);
    if (!product) throw new ProductNotFoundError();

    const existingSku = await this.repo.findSkuByVariant(productId, sku.size, sku.color);
    if (existingSku) throw new SkuAlreadyExistsError();

    return this.repo.createSku(productId, product.slug, sku);
  }

  async listSkusOfProduct(productId: string) {
    await this.assertProductExists(productId);
    return this.repo.findSkusByProduct(productId);
  }

  async listAllSkus(query: ListQueryDto) {
    const cursor = query.cursor ? decodeCursor(query.cursor) : undefined;
    const rows = await this.repo.listSkus(cursor, query.limit);
    return paginate(rows, query.limit);
  }

  async updateSku(skuId: string, dto: UpdateSkuDto) {
    const sku = await this.repo.findSkuById(skuId);
    if (!sku) throw new SkuNotFoundError();
    return this.repo.updateSku(skuId, dto);
  }

  async deactivateSku(skuId: string): Promise<void> {
    const sku = await this.repo.findSkuById(skuId);
    if (!sku) throw new SkuNotFoundError();
    await this.repo.deactivateSku(skuId);
  }

  private async assertProductExists(id: string): Promise<void> {
    const product = await this.repo.findProductById(id);
    if (!product) throw new ProductNotFoundError();
  }
}
