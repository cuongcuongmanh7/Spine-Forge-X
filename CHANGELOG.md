# Changelog

## v0.2.19
- **Số job song song giờ là thanh trượt (slider) thay vì ô số**: kéo chọn 1–8, thấy ngay giá trị đang chọn và giới hạn, không gõ nhầm được giá trị ngoài khoảng. Thêm gợi ý (hover) nhắc rằng nhiều job chạy nhanh hơn nhưng tốn RAM ≈ số job × Max memory.
- **Mặc định số job song song = 4** (trước là 1): hợp với CPU phổ thông hiện nay (4–6 nhân) để export nhanh hơn nhiều ngay từ lần đầu; máy yếu vẫn kéo xuống được, máy mạnh kéo lên tới 8. (Chỉ áp dụng cho cài đặt mới; máy đã chạy app giữ giá trị cũ — chỉnh tay nếu muốn.)
- Nội bộ: củng cố test suite (nâng 2 kiểm thử ví dụ lên property test cho `clean_source_folder_name` và `find_existing_id_folder`); đính chính tài liệu nội bộ về việc Spine CLI **không** có cờ dùng settings lưu sẵn trong `.spine` (cách duy nhất vẫn là tự parse — đã xác minh qua tài liệu chính chủ).

## v0.2.18
- **Tìm ra nguyên nhân gốc các giá trị "lệch ×2" khi đọc `.spine` — và sửa decoder**: số nguyên trong project file được Spine lưu dạng varint **zigzag** (n ≥ 0 lưu thành 2n); decoder cũ đọc unsigned thuần nên mọi field int ra gấp đôi. Đã chứng minh bằng thí nghiệm có kiểm soát (padding 3 → file ghi 6, max 700 → 1400, min 128 → 256) — xem `docs/research-padding-not-decoded.md`.
- **Sửa bug min/max đọc gấp đôi** ở mode "Preset nền + min/max từng .spine": ví dụ project đặt max 2048 trước đây bị đọc thành 4096 (min cũng vậy → có thể ép page phình to hơn ý artist).
- **Decoder giờ nhận page size tùy ý** (vd max 700) thay vì chỉ power-of-two — trước đây project dùng size lẻ bị báo "không tìm thấy pack settings" và rơi hết về preset.
- **Đọc thêm được từ `.spine`**: `paddingX/Y`, `edgePadding`, `duplicatePadding`, `alphaThreshold`, `premultiplyAlpha`, `bleed`, `multipleOfFour`, và **`packing` (cả Rectangles lẫn Polygons)** — các lần "demote" trước (`multipleOfFour`, `alphaThreshold`) là do nhiễu bởi bug min/max gấp đôi + hiểu nhầm zigzag, nay đã loại.
- **Validate end-to-end mạnh nhất**: decode `.spine` → merge lên preset → Spine CLI export → **toàn bộ atlas + PNG giống từng byte** bản export từ editor, cho cả 2 chế độ packing (Rectangles và Polygons), không chỉnh tay field nào. (`skel.bytes` lệch ở vùng hash là đặc tính nondeterminism của CLI re-export, không liên quan settings.)
- Giờ mode "Preset nền + min/max từng .spine" gần như lấy trọn cấu hình pack atlas từ file: min/max, scale, padding, các bool, và packing — chỉ còn vài field runtime (filter/wrap/format) lấy từ preset nền.

## v0.2.17
- **Chạy một bản duy nhất (single instance)**: trước đây khi app đang ẩn ở khay hệ thống, mở lại app sẽ chạy một tiến trình mới hoàn toàn (hai icon tray, hai bản dùng chung file cấu hình → có thể ghi đè lẫn nhau). Giờ mở lại app sẽ khôi phục đúng cửa sổ đang ẩn ở tray thay vì tạo tiến trình mới.

## v0.2.15
- **Mode "Preset nền + min/max từ từng .spine" giờ đọc thêm `scale` (texture scale)**: trước đây bỏ qua scale → atlas của project dùng scale ≠ 1 bị export sai độ phân giải (vd scale 0.5 ra gấp đôi). Đã validate end-to-end: file scale 0.5 tái tạo đúng kích thước page như export từ editor.
- **Cảnh báo khi giá trị trong .spine lệch preset nền**: nếu pack max đọc từ `.spine` khác preset đang chọn, log `[WARN]` ngay (gợi ý file chưa được export lại từ editor nên settings trong file có thể cũ) — tránh âm thầm xuất sai kích thước.
- `padding` **cố tình không đọc từ .spine**: giá trị lưu trong file không tái tạo đúng kết quả export (file ghi 16 nhưng export thật dùng 8), nên padding luôn lấy từ preset nền.
- Lưu ý quan trọng về độ tin cậy: settings trong `.spine` chỉ chính xác **ngay sau khi export từ Export window trong Spine editor**. Export qua script/preset/CLI **không** ghi ngược vào file → giá trị có thể cũ. Mode này hợp nhất với người export trực tiếp từ editor; studio dùng preset chung nên dùng "Dùng preset cho mọi file".

## v0.2.14
- **Mode export mới — "Preset nền + min/max từ từng .spine"**: Export strategy giờ là 2 lựa chọn ("Dùng preset cho mọi file" / "Preset nền + min/max từ từng .spine"). Chọn cái thứ 2, app tự đọc settings export lưu trong từng project (min/max pack atlas tinh chỉnh riêng, cleanUp, format binary/json, extension, packSource/packTarget...) và ghi đè lên preset nền đang chọn — không cần mở editor save `.export.json` cho từng file nữa. Preset nền vẫn dùng chung cho cả 2 mode (làm gốc + fallback).
- Field nào không đọc được thì giữ giá trị preset nền; file không parse được vẫn export bằng preset nền và ghi rõ lý do trong log.
- Đã calibrate trên project thật: atlas + PNG tái tạo giống từng byte bản artist export; 2 field không đáng tin (alphaThreshold, multipleOfFour — giá trị lưu trong project lệch với lần export thật) bị loại khỏi decoder, luôn lấy từ preset.
- Lưu ý: settings trong project là của lần *save* cuối — nếu artist chỉnh dialog export sau khi save thì có thể lệch (hạn chế của chính Spine, đã ghi trong tooltip).
- Nội bộ: tách `presets.rs` + `system.rs` khỏi `lib.rs` (file gọn hơn ~250 dòng dù thêm tính năng); parser `.spine` nằm riêng ở `spine_project.rs` với unit test + proptest.

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
