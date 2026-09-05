/**
 * Lỗi nghiệp vụ.
 *
 * Vì sao không dùng thẳng `HttpException` của NestJS trong service: service không nên biết
 * gì về HTTP. Cùng một lỗi "hết hàng" phải dùng được cho cả HTTP handler và cho worker
 * BullMQ (Phase 4) — nơi không có response nào để trả. Service throw `DomainError`, còn
 * việc map sang status code là việc của exception filter ở biên.
 *
 * `httpStatus` vẫn nằm ở đây (thay vì một bảng map riêng) vì nó là *phân loại* lỗi chứ
 * không phải chi tiết giao thức: 409 nghĩa là "xung đột trạng thái, client thử lại được",
 * và ý đó đúng ở mọi tầng.
 */
export abstract class DomainError extends Error {
  /** Status code HTTP tương ứng khi lỗi này lọt ra biên HTTP. */
  abstract readonly httpStatus: number;

  /** Mã lỗi ổn định để client xử lý theo nhánh — không dùng message để so sánh. */
  abstract readonly code: string;

  /**
   * Mức log khi lỗi này lọt ra biên HTTP. Mặc định suy từ `httpStatus`: 5xx là `error`, còn
   * lại là `warn`.
   *
   * Vì sao cần override được (nợ ghi ở `architecture.md` §Một chỗ chưa ổn từ Phase 0):
   * `/ready` trả **503** khi Postgres chớp, mà Cloud Run gọi `/ready` vài giây một lần ⇒ hàng
   * chục dòng `error` cho một sự cố vận hành *bình thường*. Đến khi gắn cảnh báo theo số dòng
   * `error` thì chuông kêu sai, và cảnh báo kêu sai vài lần là người ta tắt tiếng nó — lần thứ
   * n có sự cố thật thì không ai nghe.
   *
   * Đặt thuộc tính này ở **lớp lỗi** chứ không ở filter, vì nó trả lời câu *"lỗi này có đáng
   * gọi người dậy lúc 3 giờ sáng không"* — đó là tính chất của lỗi, không phải của filter.
   */
  get logLevel(): 'warn' | 'error' {
    return this.httpStatus >= 500 ? 'error' : 'warn';
  }

  constructor(
    message: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    // Không có dòng này thì `error.name` luôn là "Error" và log khó đọc.
    this.name = new.target.name;
  }
}
