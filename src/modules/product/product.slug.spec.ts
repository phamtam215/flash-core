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
    it('ghép đúng thứ tự productCode-colorCode-size, viết hoa, bỏ dấu', () => {
      expect(generateSkuCode('ao-thun-basic', 'Đen', 'M')).toBe('AOTHUNBASIC-DEN-M');
    });

    it('hai màu khác nhau trên cùng sản phẩm ra hai mã khác nhau', () => {
      const den = generateSkuCode('ao-thun-basic', 'Đen', 'M');
      const trang = generateSkuCode('ao-thun-basic', 'Trắng', 'M');
      expect(den).not.toBe(trang);
    });
  });
});
