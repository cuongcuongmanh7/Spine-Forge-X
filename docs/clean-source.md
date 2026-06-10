# Clean Source Folder — gỡ ảnh thừa

**Clean Source Folder** quét thư mục nguồn, tìm các ảnh **không được skeleton tham chiếu** rồi chuyển chúng sang thư mục backup. Hữu ích nhất ở chế độ **pack folder** (`packSource = imagefolders`) — vì khi đó Spine pack cả thư mục ảnh, ảnh thừa sẽ làm phình atlas.

> Mở bằng nút **"Dọn source folder"** (icon tẩy) ở **footer Sidebar** — luôn bấm được, không phụ thuộc session/bước wizard.

---

## 1. Nguồn tham chiếu (vì sao đáng tin)

`.spine` là file project nhị phân, **không parse trực tiếp được**; còn file `.json` nằm cạnh ảnh thường **cũ/stale**. App **export `.spine` qua Spine CLI có pack atlas** (`packAtlas: {}`) vào thư mục tạm, rồi đọc **tên region trong file `.atlas`** làm danh sách ảnh **đang được dùng** → luôn phản ánh đúng trạng thái hiện tại.

**Vì sao atlas chứ không phải JSON skeleton:** JSON export chỉ giữ **tên placeholder trần** (vd `head`) và làm **mất** hai thứ quan trọng — folder ảnh của từng skin và việc file bị đổi tên (vd placeholder `head` trỏ tới file `skin_order_of_light/head copy.png`). Region name trong atlas **giữ nguyên đường dẫn ảnh thật** (`skin_order_of_light/head copy`), nên đó mới là nguồn đáng tin. JSON skeleton chỉ dùng **dự phòng** khi không pack được atlas. Một `.spine` có nhiều skeleton thì references được **gộp từ mọi file xuất ra**.

Cần cấu hình **Spine executable** (như khi export) để dùng tính năng này.

## 2. Quy tắc match ảnh used/unused

Mỗi tham chiếu (region name của atlas) được match theo thứ tự (port từ Spine-Cleaner):

1. **Exact path** (vd `skin_a/body.png`)
2. **Exact path, bỏ đuôi** (`skin_a/body`)
3. **Unique basename** — tên trần `body` khớp ảnh duy nhất `…/body.png`
4. **Ambiguous** — nếu `body` khớp nhiều ảnh ở nhiều folder → **giữ tất cả** (coi là used), **không bao giờ move** (tránh xóa nhầm)
5. Không khớp ảnh nào → đánh dấu **missing**

Ảnh không thuộc tham chiếu nào → **unused** (ứng viên để dọn).

> Vì references lấy từ atlas nên ảnh nằm trong folder skin hoặc bị đổi tên vẫn match đúng (theo path bỏ đuôi). Ở nhánh dự phòng JSON, attachment kiểu **sequence** (animated) cũng được bung thành từng frame `<base><index>` để không báo nhầm các frame là thừa.

## 3. Quét nhiều folder cùng lúc

Chọn một thư mục tổng chứa nhiều folder con (mỗi folder 1 `.spine` + `images/`): app `WalkDir` tìm **mọi `.spine`** bên dưới, xử lý **độc lập từng folder** (match cô lập, không lẫn ảnh giữa các folder), chạy song song có giới hạn, có thể **Stop** giữa chừng.

- **Chọn folder con để quét**: khi gõ/chọn folder gốc, modal hiện **danh sách checkbox** mọi unit tìm được (lệnh `list_clean_units`, chỉ `WalkDir` — không export), mặc định tick hết, kèm nút **Select all / Clear**. Bỏ tick để **chỉ quét/dọn một số folder**; folder bỏ tick được truyền vào `excluded` nên không tốn lần gọi Spine nào. Nhãn hiển thị **đường dẫn tương đối so với folder gốc** (vd `Chibi/9901` vs `Splash/9901`) để phân biệt các nhánh trùng tên lá; id ở cuối luôn hiện đủ.
- **Tôn trọng list "không export"**: file `.spine` đã bị gỡ khỏi export-set của session sẽ **bị bỏ qua** khi scan/clean (gộp chung với các folder bị bỏ tick ở trên).
- **Cache theo từng unit (per-session)**: kết quả scan mỗi `.spine` được nhớ theo dấu vân tay (mtime+size của `.spine`, số ảnh + tổng dung lượng, target version). Lần quét sau **bỏ qua hẳn bước export CLI** cho unit chưa đổi → vòng lặp scan → sửa → scan lại gần như tức thì. Cache tự mất hiệu lực khi `.spine`/ảnh đổi hoặc sau khi move.
- **Song song theo số core**: số unit chạy đồng thời = `available_parallelism()` giới hạn trong khoảng 4–8 (phần lớn thời gian mỗi unit là khởi động Spine CLI nên scale song song hiệu quả; cap 8 để không quá tải RAM/GPU).

### An toàn khi chọn nhầm folder lớn

Mỗi `.spine` phải export qua Spine CLI nên scan folder lớn có thể tốn nhiều phút và mở Spine nhiều lần (scan **không** đụng file — chỉ đọc). Ba lớp bảo vệ:

1. **Liệt kê trước (preview)**: chọn/gõ folder → app liệt kê nhanh các `.spine` (chỉ `WalkDir`, không gọi CLI), hiện danh sách checkbox và dòng *"X/N folder đã chọn để quét"*. Lệnh `list_clean_units`.
2. **Cảnh báo theo ngưỡng**: nếu **số folder đã chọn** > **50**, bấm Scan sẽ hỏi xác nhận trước khi chạy.
3. **Overlay khóa + Stop**: trong lúc scan hiện overlay full-screen (spinner + tiến độ `x/total` + folder đang quét) chặn mọi thao tác khác; nút **Stop** dừng giữa chừng (ngừng spawn task mới, task đang chạy chạy nốt, trả **kết quả một phần**). Không đóng được modal khi đang scan để tránh orphan tiến trình.

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
