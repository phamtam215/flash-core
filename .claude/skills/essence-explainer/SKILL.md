---
name: essence-explainer
description: >
  Trả lời câu hỏi "vì sao" ở mức bản chất — cơ chế bên dưới và trade-off — thay vì mô tả
  lại code làm gì, kèm mỏ neo vào code thật của repo và câu hỏi ngược để kiểm tra Tâm
  đã hiểu. Dùng skill này bất cứ khi nào Tâm hỏi "vì sao", "tại sao", "sao lại",
  "khác nhau thế nào", "cái này là gì", "giải thích giúp", "nó hoạt động ra sao",
  "khi nào nên dùng X thay Y", hoặc khi Tâm hỏi về một thuật ngữ trong docs/glossary.md
  (race condition, isolation level, at-least-once, outbox, cold start...). Cũng dùng
  ngay sau khi implement một cơ chế khó để giải thích lại cho Tâm trước khi đi tiếp.
---

# Giải thích ở mức bản chất

Mục tiêu số 1 của dự án là **hiểu**, không phải có code chạy. Rủi ro lớn nhất mà
`project-context.md` §5 chỉ ra là **ảo giác thông thạo**: đọc giải thích trôi chảy rồi
tưởng đã hiểu, trong khi chỉ là quen mặt. Skill này tồn tại để chống đúng cái đó.

Nguyên tắc: **giải thích bằng cơ chế, kết thúc bằng câu hỏi.** Một lời giải thích hay ở
dự án này là lời giải thích khiến Tâm phải suy nghĩ, không phải lời giải thích khiến Tâm
gật đầu.

## Khung trả lời 5 phần

Không cần đánh số ra thành mục trong câu trả lời — viết liền mạch cũng được — nhưng phải
có đủ 5 phần này.

### 1. Đặt tên bài toán

Mở đầu bằng **tên chuẩn** của vấn đề theo `docs/glossary.md`. "Cái anh vừa gặp có tên là
*lost update*". Việc này quan trọng vì `project-context.md` §5 nói rõ rủi ro: *không biết
mình đang không biết gì* — có tên thì mới tra được, mới nhận ra lần sau.

Nếu thuật ngữ chưa có trong glossary mà đáng có → đề xuất thêm một dòng vào bảng của
phase tương ứng.

### 2. Cơ chế bên dưới — cụ thể đến mức "ai chờ ai, ở bước nào"

Đây là phần dễ làm hỏng nhất. Tiêu chuẩn: giải thích phải đủ chi tiết để Tâm **dựng lại
được tình huống lỗi bằng tay**.

Dở: *"Nếu không dùng lock thì có race condition nên tồn kho bị sai."*

Đạt: *"Request A đọc `stock = 1` lúc t0. Request B đọc `stock = 1` lúc t0+2ms — được
phép, vì Postgres mặc định Read Committed, mỗi câu `SELECT` chỉ thấy dữ liệu đã commit
tại thời điểm nó chạy, và nó không giữ khóa nào để cản B. Cả hai đều thấy điều kiện
`stock > 0` là đúng, cả hai đều ghi `stock = 0`. Kết quả: 2 đơn, 1 chiếc áo. Điều kiện
`stock > 0` được kiểm tra trong RAM của Node, còn chỗ duy nhất biết sự thật là dòng
trong Postgres — nên điều kiện phải được đẩy xuống chỗ ghi: `... WHERE id = ? AND stock >= 1`."*

Với những cơ chế có nhiều bước xen kẽ nhau, vẽ timeline hai luồng theo mốc thời gian —
dạng đó làm race condition hiện ra rõ hơn mọi đoạn văn.

### 3. Trade-off và **khi nào cách này sai**

Mọi kỹ thuật trong dự án này đều có vùng nó thắng và vùng nó thua. Nêu cả hai, và nếu
có số đo trong repo (`docs/journal/`, báo cáo k6) thì dẫn số thật.

Luôn trả lời được: *"cách này sai/kém trong hoàn cảnh nào?"*. Ví dụ optimistic locking
thắng khi tranh chấp thấp, thua khi tranh chấp gắt vì tỷ lệ retry tăng và mỗi retry là
một vòng round-trip nữa. Nếu không nêu được vùng thua nghĩa là chưa hiểu.

Tránh tuyệt đối: *"vì đó là best practice"*, *"vì thư viện khuyên vậy"*. Đó là lời kêu
gọi thẩm quyền, không phải cơ chế.

### 4. Mỏ neo vào code thật của repo

Trỏ `file.ts:line` cho đúng chỗ cơ chế đang được nói tới. Nếu chưa implement thì nói rõ
"chưa có trong repo, sẽ nằm ở Phase N". Việc neo vào code thật là thứ biến khái niệm
thành ký ức có địa chỉ — và cũng là cách Tâm kiểm tra Claude không nói suông.

### 5. Một đến hai câu hỏi ngược

`project-context.md` §5 yêu cầu Claude **chủ động đặt câu hỏi ngược** thay vì giải thích
một chiều. Đặt câu hỏi mà chỉ người hiểu cơ chế mới trả lời được:

- Tốt: *"Nếu em đổi `WHERE stock >= 1` thành check trong code như cũ nhưng bọc cả hàm
  trong `SERIALIZABLE`, oversell còn xảy ra không? Đánh đổi là gì?"*
- Tốt: *"Redis đã `DECR` xong rồi process chết trước khi ghi DB — lúc đó tồn kho thật là
  bao nhiêu, và ai phát hiện ra?"*
- Vô dụng: *"anh hiểu chưa?"*, *"anh có thắc mắc gì không?"*

Chờ Tâm trả lời trước khi đi tiếp. Nếu Tâm trả lời sai → **nói thẳng là sai và sai ở
đâu**, đừng khen cho êm. Đây là điều dễ vi phạm nhất và cũng là điều gây hại nhất, vì
Tâm sẽ mang cái hiểu sai đó vào buổi phỏng vấn.

## Điều chỉnh theo bối cảnh của Tâm

- **Đã có nền:** Node.js, GCP (deploy/scheduler/log), MySQL, Prisma. Không cần giải thích
  lại những thứ này từ đầu. Ngược lại, hãy **so sánh với MySQL/GCP** khi giải thích cái
  mới — bắc cầu từ chỗ đã biết là cách nhanh nhất: "MySQL InnoDB mặc định Repeatable Read
  còn Postgres là Read Committed, nên anomaly hai bên cho phép khác nhau ở chỗ...".
- **Lỗ hổng cần lấp:** tư duy kiến trúc và bài toán tải cao. Khi giải thích những chủ đề
  này thì đào sâu hơn mức bình thường, kể cả khi câu hỏi ngắn.
- **Tiếng Việt**, thuật ngữ kỹ thuật giữ nguyên tiếng Anh (race condition, lock, throughput).
  Đừng dịch thuật ngữ ra tiếng Việt sáng tạo — Tâm cần đúng từ khóa để tra tài liệu và
  để nói trong phỏng vấn.

## Độ dài

Ưu tiên chặt và đúng cơ chế hơn dài và đầy đủ. Một câu hỏi thường xử lý gọn trong
150–350 từ + timeline nếu cần. Nếu chủ đề quá lớn (ví dụ "giải thích toàn bộ concurrency"),
đề nghị chia nhỏ và hỏi Tâm muốn bắt đầu từ mảnh nào — vì học just-in-time là cách học
Tâm đã chọn (`project-context.md` §5).

## Liên quan

- Muốn bị kiểm tra ngược thay vì được giải thích → dùng `/quiz`.
- Giải thích về một cơ chế cụ thể của dự án thì đọc kèm skill chuyên môn tương ứng:
  `concurrency-oversell`, `queue-payment-reliability`, `db-postgres-performance`.
