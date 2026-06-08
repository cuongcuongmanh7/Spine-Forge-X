# Clean Source Folder — gỡ ảnh thừa

**Clean Source Folder** quét thư mục nguồn, tìm các ảnh **không được skeleton tham chiếu** rồi chuyển chúng sang thư mục backup. Hữu ích nhất ở chế độ **pack folder** (`packSource = imagefolders`) — vì khi đó Spine pack cả thư mục ảnh, ảnh thừa sẽ làm phình atlas.

> Mở bằng nút **"Dọn source folder"** (icon tẩy) ở **footer Sidebar** — luôn bấm được, không phụ thuộc session/bước wizard.

---

## 1. Nguồn tham chiếu (vì sao đáng tin)

`.spine` là file project nhị phân, **không parse trực tiếp được**; còn file `.json` nằm cạnh ảnh thường **cũ/stale**. Vì vậy app **export `.spine` ra một JSON skeleton tạm bằng Spine CLI** rồi mới đọc danh sách attachment từ đó → luôn phản ánh đúng trạng thái hiện tại của project.

Cần cấu hình **Spine executable** (như khi export) để dùng tính năng này.

## 2. Quy tắc match ảnh used/unused

Mỗi tham chiếu được match theo thứ tự (port từ Spine-Cleaner):

1. **Exact path** (vd `skin_a/body.png`)
2. **Exact path, bỏ đuôi** (`skin_a/body`)
3. **Unique basename** — tên trần `body` khớp ảnh duy nhất `…/body.png`
4. **Ambiguous** — nếu `body` khớp nhiều ảnh ở nhiều folder → **giữ tất cả** (coi là used), **không bao giờ move** (tránh xóa nhầm)
5. Không khớp ảnh nào → đánh dấu **missing**

Ảnh không thuộc tham chiếu nào → **unused** (ứng viên để dọn).

## 3. Quét nhiều folder cùng lúc

Chọn một thư mục tổng chứa nhiều folder con (mỗi folder 1 `.spine` + `images/`): app `WalkDir` tìm **mọi `.spine`** bên dưới, xử lý **độc lập từng folder** (match cô lập, không lẫn ảnh giữa các folder), chạy song song có giới hạn, có thể **Stop** giữa chừng.

- **Tôn trọng list "không export"**: file `.spine` đã bị gỡ khỏi export-set của session sẽ **bị bỏ qua** khi scan/clean.
- **Cache theo session**: kết quả scan (đường dẫn + danh sách) được nhớ riêng cho từng session; đóng/mở lại modal hiện ngay, bấm **Scan** để làm mới.

## 4. Xem chi tiết (thumbnail)

Bấm vào một dòng folder trong bảng để mở **modal chi tiết**:

- 2 section: **Unused** (chấm đỏ) và **Used/đang dùng** (chấm xanh), kèm thumbnail (lazy-load).
- Header hiện số lượng Unused/Used; footer có **Back/Next** để duyệt nhanh các folder cùng đợt scan, và nút **Move unused** cho folder đang xem.

> TGA không hiển thị thumbnail (trình duyệt không hỗ trợ) → hiện ô trống; ảnh PNG/JPG/WebP/BMP hiển thị bình thường.

## 5. Dọn (move)

- **Theo từng folder**: nút thùng rác ở mỗi dòng (hoặc trong modal chi tiết) — dùng luôn kết quả đã scan, **không export lại**.
- **Tất cả**: nút **"Move unused → backup"** ở footer modal.

Ảnh unused được chuyển vào `<thư-mục-cha-của-images>/_unused_backup/<YYYY-MM-DD_HH-mm-ss>`, **giữ nguyên cấu trúc thư mục con** → có thể khôi phục bằng tay. App **từ chối** move bất kỳ file nào nằm ngoài thư mục ảnh.

Sau khi move, dot của folder chuyển **xanh** và số Unused về 0 ngay (không cần scan lại).

## 6. Gợi ý trong wizard

Khi export setting đang ở **pack folder** (đọc từ generated settings hoặc preset đang chọn), bước **Output** hiện một **notice gợi ý** nên dọn source, kèm link mở công cụ; lúc export cũng có dòng log nhắc.

> **Không có** chế độ auto-clean trước export — dọn ảnh luôn là thao tác **thủ công, có chủ đích** để tránh rủi ro xóa nhầm.

## 7. Liên quan

- Tùy chọn **"Tự mở folder output khi export xong"** (Output section) — mở thư mục output sau khi export hoàn tất (bỏ qua nếu vừa mở đúng folder đó).
