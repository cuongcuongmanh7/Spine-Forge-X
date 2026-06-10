# Changelog

## v0.2.13
- Kéo-thả theo vùng: overlay chia 2 ô — thả vào nửa trái để đặt input, thả một folder vào nửa phải để đặt output (ô output ẩn khi đang dùng Linked Project).
- Kéo-thả an toàn hơn: thả sai (file không phải `.spine`, hay nhiều folder cùng lúc) hiện cảnh báo thay vì nhận nhầm thành đường dẫn.
- Tất cả ô tick chuyển sang dạng công tắc gạt (toggle) kiểu macOS.
- Settings → Hoạt động: dòng mô tả thu lại thành icon, rê chuột mới hiện để gọn hơn.
- Dọn source folder — lọc ảnh thừa **chính xác hơn nhiều**: lấy danh sách ảnh đang dùng từ **atlas đã pack** thay vì JSON skeleton, nên ảnh nằm trong folder skin hoặc bị đổi tên (vd `head copy.png`) không còn bị báo nhầm là thừa; xử lý cả attachment `sequence` và `.spine` nhiều skeleton.
- Dọn source folder — **chọn folder con để quét**: danh sách checkbox các unit (Select all/Clear), bỏ tick để chỉ quét/dọn một số folder; nhãn hiện đường dẫn tương đối để phân biệt các nhánh trùng tên lá.
- Dọn source folder — **nhanh hơn**: cache kết quả theo từng unit (bỏ qua export lại folder chưa đổi) và chạy song song theo số core (4–8).

## v0.2.12
- Chạy ngầm ở khay hệ thống: đóng (X) hoặc thu nhỏ sẽ thu app xuống tray thay vì thoát; icon tray có menu Show/Quit. Bật/tắt trong Settings → Hoạt động (mặc định bật).
- Kéo-thả: thả folder hoặc file .spine thẳng vào app để đặt input.
- Dashboard kết quả export: nút Dashboard ở sidebar mở bảng tổng hợp lần export gần nhất của từng session trong project (Xong/Lỗi/Bỏ qua/Tổng).
- Dọn source folder an toàn hơn: hiện trước số skeleton sẽ quét và cảnh báo khi folder lớn; trong lúc quét có màn hình tiến độ + nút Dừng.

## v0.2.11
- Xem changelog ngay trong app: click vào số version trên titlebar để mở trang releases.
- Khi có bản cập nhật: hiện nút "What's new" kèm ghi chú phiên bản trước khi cài.
- Modal sửa preset: hỏi xác nhận trước khi đóng nếu có thay đổi chưa lưu (tránh mất khi bấm nhầm ra ngoài).

## v0.2.9
- Clean Source Folder: quét và chuyển ảnh thừa (không được skeleton tham chiếu) sang _unused_backup khi pack folder.
- Tùy chọn tự mở folder output sau khi export xong.
