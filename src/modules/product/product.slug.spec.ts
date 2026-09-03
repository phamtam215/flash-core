import { generateSkuCode, slugify } from './product.slug';

describe('product.slug', () => {
  describe('slugify', () => {
    it('bỏ dấu tiếng Việt và đổi khoảng trắng thành gạch ngang', () => {
      expect(slugify('Áo Thun Basic')).toBe('ao-thun-basic');
    });

    it('xử lý đúng "đ"/"Đ" — chữ cái riêng, không bị normalize NFD tách', () => {
      expect(slugify('Đầm Suông Đẹp')).toBe('dam-suong-dep');
    });

    it('gộp nhiều khoảng trắng/ký tự lạ liên tiếp thành MỘT gạch ngang, không dư ở đầu/cuối', () => {
      expect(slugify('  Áo   Thun!!  ')).toBe('ao-thun');
    });
  });

  describe('generateSkuCode', () => {
    it('ghép đúng thứ tự productCode-colorCode-size-hash, viết hoa, bỏ dấu', () => {
      expect(generateSkuCode('ao-thun-basic', 'Đen', 'M')).toMatch(/^AOTHUNBASIC-DEN-M-[0-9A-Z]{4}$/);
    });

    it('xác định: cùng input luôn ra cùng mã', () => {
      expect(generateSkuCode('ao-thun-basic', 'Đen', 'M')).toBe(
        generateSkuCode('ao-thun-basic', 'Đen', 'M'),
      );
    });

    it('hai màu khác nhau trên cùng sản phẩm ra hai mã khác nhau', () => {
      const den = generateSkuCode('ao-thun-basic', 'Đen', 'M');
      const trang = generateSkuCode('ao-thun-basic', 'Trắng', 'M');
      expect(den).not.toBe(trang);
    });

    it('hai slug DÀI dùng chung tiền tố vẫn ra mã khác nhau — bug tìm thấy ở Phase 3', () => {
      // Trước khi có phần băm, hai slug này ra CÙNG một mã (16 ký tự đầu giống nhau) và làm
      // vỡ UNIQUE của cột sku_code → 500. Đúng tình huống script seed benchmark gặp phải.
      const a = generateSkuCode('ao-benchmark-1788449231000', 'Đen', 'M');
      const b = generateSkuCode('ao-benchmark-1788449299000', 'Đen', 'M');
      expect(a).not.toBe(b);
    });
  });
});
