/**
 * Chuẩn hoá chuỗi tiếng Việt có dấu thành ASCII — dùng để tự sinh `slug` (từ `name`) và
 * `sku_code` (từ `slug` + `color` + `size`, xem `docs/specs/phase2-product-inventory.md`).
 *
 * `normalize('NFD')` tách chữ có dấu thành chữ gốc + dấu rời (vd "ế" → "e" + dấu sắc), rồi bỏ
 * hết phần dấu bằng dải Unicode "combining diacritical marks" (U+0300–U+036F). Riêng "đ"/"Đ"
 * KHÔNG bị NFD tách (nó là một chữ cái riêng trong Unicode, không phải "d" + dấu), nên phải
 * thay tay. Dùng `̀-ͯ` (escape) thay vì gõ thẳng ký tự dấu vào regex — ký tự dấu gõ
 * trực tiếp dễ dính vào ký tự đứng trước khi hiển thị, đọc nhầm thành lỗi.
 */
function stripDiacritics(input: string): string {
  return input
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D');
}

/** `"Áo Thun Basic"` → `"ao-thun-basic"`. Dùng khi client không tự đặt `slug`. */
export function slugify(input: string): string {
  return stripDiacritics(input)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** `"Đen"` → `"DEN"`, dùng để ghép `sku_code`. */
function toAsciiCode(input: string, maxLength: number): string {
  const code = stripDiacritics(input).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return code.slice(0, maxLength) || 'X';
}

/**
 * Sinh `sku_code` đọc được cho vận hành, vd `productSlug="ao-thun-basic"`, `color="Đen"`,
 * `size="M"` → `"AOTHUNBASIC-DEN-M"`.
 *
 * Trần độ dài (16/12 ký tự) để `sku_code` không phình vô hạn theo `name` sản phẩm dài. Đây là
 * mã ĐỌC ĐƯỢC cho vận hành, không phải khoá kỹ thuật — trùng mã cực hiếm (hai sản phẩm có
 * slug trùng 16 ký tự đầu VÀ trùng màu VÀ trùng size) rơi vào lỗi `UNIQUE` thật của cột
 * `sku_code`, filter lỗi chung sẽ trả 500 kèm `correlationId` — biết ngay để xử lý, không
 * nuốt lỗi. Chưa map riêng thành lỗi nghiệp vụ vì đây là edge case chưa có trong spec.
 */
export function generateSkuCode(productSlug: string, color: string, size: string): string {
  const productCode = toAsciiCode(productSlug, 16);
  const colorCode = toAsciiCode(color, 12);
  return `${productCode}-${colorCode}-${size}`;
}
