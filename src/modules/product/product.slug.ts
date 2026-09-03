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
 * Băm chuỗi thành 4 ký tự base36 (FNV-1a 32-bit). Không phải hash mật mã — chỉ cần phân biệt
 * được các slug có 16 ký tự đầu giống nhau, và cần **xác định** (cùng input ra cùng output).
 */
function shortHash(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36).toUpperCase().padStart(4, '0').slice(-4);
}

/**
 * Sinh `sku_code` đọc được cho vận hành, vd `productSlug="ao-thun-basic"`, `color="Đen"`,
 * `size="M"` → `"AOTHUNBASIC-DEN-M-3K7Q"`.
 *
 * Trần độ dài (12/8 ký tự) để mã không phình vô hạn theo `name` sản phẩm dài, cộng 4 ký tự
 * băm ở cuối để phần bị CẮT vẫn còn ảnh hưởng tới mã.
 *
 * **Vì sao có phần băm** (Phase 3 mới phát hiện, trước đó chỉ là edge case ghi trong comment):
 * bản đầu chỉ lấy 16 ký tự đầu của slug, nên hai slug dài dùng chung tiền tố sẽ ra CÙNG một
 * `sku_code` và vỡ `UNIQUE` → 500. Comment cũ ghi "cực hiếm", nhưng script seed benchmark
 * (`k6/seed-target.js`) dùng slug `ao-benchmark-<timestamp>` đã làm nó xảy ra ở **mọi** lần
 * chạy thứ hai trở đi — 16 ký tự đầu cắt đúng chỗ timestamp. Bài học: "cực hiếm" là phỏng
 * đoán, và phỏng đoán về tần suất thì phải kiểm bằng cách dùng thật.
 */
export function generateSkuCode(productSlug: string, color: string, size: string): string {
  const productCode = toAsciiCode(productSlug, 12);
  const colorCode = toAsciiCode(color, 8);
  const suffix = shortHash(`${productSlug}|${color}|${size}`);
  return `${productCode}-${colorCode}-${size}-${suffix}`;
}
