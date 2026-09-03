import { Injectable } from '@nestjs/common';

import type { Cursor } from '../../common';
import { PrismaService } from '../../infra/prisma';
import type { CreateProductDto, SkuInput, UpdateProductDto, UpdateSkuDto } from './product.dto';
import { generateSkuCode } from './product.slug';

/**
 * Toàn bộ truy cập DB của module product nằm ở đây — quy tắc số 2 trong docs/architecture.md.
 *
 * Vì sao check-tồn-tại-trước-rồi-mới-ghi (thay vì bắt lỗi UNIQUE của DB): cùng cách
 * `AuthRepository`/`AuthService` đang làm với email trùng — đơn giản hơn, và catalog write
 * (Phase 2) không phải chỗ có tranh chấp cao như tồn kho (Phase 3), nên chấp nhận khe hở nhỏ
 * (hai request tạo cùng slug/sku ở đúng cùng một khoảnh khắc có thể cả hai qua được check rồi
 * một trong hai vỡ ở UNIQUE constraint thật của DB — khi đó lộ ra thành lỗi 500 kèm
 * `correlationId`, không phải oversell, không phải mất dữ liệu).
 */
@Injectable()
export class ProductRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findProductBySlug(slug: string) {
    return this.prisma.product.findUnique({ where: { slug } });
  }

  async findProductById(id: string) {
    return this.prisma.product.findUnique({ where: { id } });
  }

  async findProductWithSkus(id: string) {
    return this.prisma.product.findUnique({
      where: { id },
      include: { skus: true },
    });
  }

  /**
   * Tạo Product, và nếu có `skus` kèm theo thì tạo cả lô trong CÙNG một transaction — Product
   * và lô SKU đầu tiên cùng tồn tại hoặc cùng không, không có trạng thái nửa vời.
   *
   * Transaction chỉ bọc đúng hai lệnh ghi này — không có lời gọi mạng nào bên trong, đúng
   * luật "transaction boundary hẹp nhất có thể" trong CLAUDE.md.
   */
  async createProduct(slug: string, dto: CreateProductDto) {
    return this.prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          name: dto.name,
          slug,
          description: dto.description,
          attributes: dto.attributes,
        },
      });

      if (dto.skus && dto.skus.length > 0) {
        await tx.productSku.createMany({
          data: dto.skus.map((sku) => this.toSkuCreateInput(product.id, product.slug, sku)),
        });
      }

      return product;
    });
  }

  async updateProduct(id: string, dto: UpdateProductDto) {
    return this.prisma.product.update({ where: { id }, data: dto });
  }

  async archiveProduct(id: string): Promise<void> {
    await this.prisma.product.update({ where: { id }, data: { status: 'ARCHIVED' } });
  }

  /**
   * Cursor pagination theo `(createdAt, id)` DESC. Prisma không có row-value comparison
   * (`WHERE (a, b) < (x, y)` thẳng), nên viết lại tương đương bằng OR — xem
   * docs/specs/phase2-product-inventory.md §Cursor pagination.
   *
   * Lấy dư 1 dòng (`limit + 1`) để service biết còn trang sau hay không mà không cần thêm
   * một câu `COUNT` riêng.
   */
  async listProducts(cursor: Cursor | undefined, limit: number) {
    return this.prisma.product.findMany({
      where: {
        status: { not: 'ARCHIVED' },
        ...(cursor && {
          OR: [
            { createdAt: { lt: cursor.createdAt } },
            { createdAt: cursor.createdAt, id: { lt: cursor.id } },
          ],
        }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  }

  async findSkuByVariant(productId: string, size: SkuInput['size'], color: string) {
    return this.prisma.productSku.findUnique({
      where: { productId_size_color: { productId, size, color } },
    });
  }

  async findSkuById(id: string) {
    return this.prisma.productSku.findUnique({ where: { id } });
  }

  async findSkusByProduct(productId: string) {
    return this.prisma.productSku.findMany({
      where: { productId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async createSku(productId: string, productSlug: string, sku: SkuInput) {
    return this.prisma.productSku.create({
      data: this.toSkuCreateInput(productId, productSlug, sku),
    });
  }

  async updateSku(id: string, dto: UpdateSkuDto) {
    return this.prisma.productSku.update({ where: { id }, data: dto });
  }

  async deactivateSku(id: string): Promise<void> {
    await this.prisma.productSku.update({ where: { id }, data: { isActive: false } });
  }

  /** Cùng cơ chế cursor với `listProducts`, không lọc theo `productId` — API `GET /skus`. */
  async listSkus(cursor: Cursor | undefined, limit: number) {
    return this.prisma.productSku.findMany({
      where: cursor
        ? {
            OR: [
              { createdAt: { lt: cursor.createdAt } },
              { createdAt: cursor.createdAt, id: { lt: cursor.id } },
            ],
          }
        : undefined,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
  }

  private toSkuCreateInput(productId: string, productSlug: string, sku: SkuInput) {
    return {
      productId,
      size: sku.size,
      color: sku.color,
      skuCode: generateSkuCode(productSlug, sku.color, sku.size),
      priceVnd: sku.priceVnd,
      stock: sku.stock,
    };
  }
}
