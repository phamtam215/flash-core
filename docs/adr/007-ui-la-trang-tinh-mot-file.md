# ADR-007: UI của Phase 5 là một trang tĩnh, không Vite/React/Tailwind

- **Ngày:** 2026-09-05
- **Trạng thái:** Đã chốt

## Bối cảnh

`docs/SPEC.md` §Phase 5 chốt từ đầu dự án là **Vite + React + Tailwind**, timebox 2 buổi tối.
Nhưng `project-context.md` quyết định #10 nói rõ vai của phần này: *"FE là **công cụ trực quan
hoá**, không phải sản phẩm. Giá trị duy nhất: cảnh k6 chạy trong khi tồn kho trên màn hình rơi
về 0 và **dừng đúng 0** → demo evidence."*

Hai câu đó không cùng hướng, và khi rà lại tài liệu ở đợt gom nguồn, chính tôi viết vào
`tech-playbook.md` §Phase 5 câu ngược với SPEC. Phải chốt một lần cho hết mâu thuẫn.

## Quyết định

**Một file `public/index.html`**, không dependency, không build step, do Nest phục vụ tĩnh
ngay trên cổng 3000. Bốn màn hình bằng show/hide, CSS viết tay, polling `fetch` 1,5 giây.

## Các lựa chọn đã cân nhắc

- **Trang tĩnh một file** ✅ — *ưu*: 0 dependency mới, không toolchain thứ hai, không CORS
  (cùng origin nên cookie `SameSite=Strict` tự gửi), mở file là chạy, và **toàn bộ thời gian
  còn lại dồn cho Phase 6**. *nhược*: không có component/state management, sửa nhiều sẽ mỏi;
  không kể được gì về React trong CV.
- **Vite + React + Tailwind** (SPEC gốc) — *ưu*: đúng cam kết ban đầu, có hot reload, dễ mở
  rộng. *nhược*: ~15 dependency, một toolchain thứ hai phải nuôi, phải cấu hình CORS +
  `credentials` cho cookie giữa hai origin, và nguy cơ tràn timebox cao. Với CV **backend**,
  phần này không cộng điểm — mà thời gian thì lấy từ Phase 6 (observability), thứ cộng điểm thật.
- **Chỉ 2 màn hình** (phương án dự phòng SPEC đã ghi) — *ưu*: nhanh nhất. *nhược*: bỏ màn "Đơn
  của tôi" là bỏ luôn chỗ nhìn thấy đơn `PENDING → PAID/CANCELLED`, tức mất phần trực quan hoá
  của cả Phase 4. Giữ lại 4 màn vì với trang tĩnh thì thêm 2 màn rẻ hơn nhiều so với React.

## Hệ quả & trade-off chấp nhận

**Được:** Phase 5 gọn trong một file; không có `node_modules` thứ hai; cùng origin nên không
phải đụng vào CORS — bài học CORS vẫn ghi ở `tech-playbook.md` §Phase 5 để biết khi nào nó xuất
hiện, chỉ là dự án này không cần trả giá cho nó.

**Mất:** một dòng trong CV về React. Đây là đánh đổi có ý thức, không phải quên: dự án này bán
câu chuyện **concurrency và reliability**, không bán câu chuyện frontend.

**Xem lại khi:** UI cần nhiều hơn ~600 dòng, hoặc cần nhiều người cùng sửa. Lúc đó dựng Vite
là việc một buổi, và trang tĩnh hiện tại thành bản đặc tả sống của những gì cần dựng lại.
