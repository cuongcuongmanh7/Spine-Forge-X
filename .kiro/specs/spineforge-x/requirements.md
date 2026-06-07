# Tài Liệu Yêu Cầu: SpineForge X

## Giới Thiệu

SpineForge X là ứng dụng desktop được xây dựng bằng Tauri (Rust backend + TypeScript/React frontend), cho phép studio game thực hiện batch export và nâng cấp version hàng loạt file `.spine` mà không cần mở từng file thủ công trong Spine Editor. Ứng dụng hướng đến trạng thái production-ready: hỗ trợ đa nền tảng (Windows trước, macOS sau), quản lý session/project, streaming log realtime, xác minh output, và xử lý an toàn các edge case như Unicode path, file thiếu `.export.json`, và Spine CLI timeout.

Tài liệu này bao phủ toàn bộ phạm vi từ trạng thái hiện tại (v0.2.4) đến roadmap production-ready, phục vụ làm định nghĩa hoàn chỉnh cho dự án.

---

## Bảng Từ Điển (Glossary)

- **SpineForgeX**: Ứng dụng desktop chính, bao gồm Frontend (React/TypeScript) và Backend (Rust/Tauri).
- **Frontend**: Tầng giao diện React/TypeScript chạy trong WebView Tauri.
- **Backend**: Tầng Rust chạy các lệnh CLI Spine, quét file, xác minh output và phát sự kiện.
- **Session**: Một bộ cấu hình export độc lập (input path, export mode, output path, v.v.) có thể được đặt tên, nhân bản và lưu trữ liên tục.
- **Project**: Nhóm tổ chức chứa một hoặc nhiều Session trong sidebar.
- **SpineCLI**: Tiến trình `Spine.com` (Windows) hoặc `Spine` (macOS) được gọi dưới dạng command-line để thực hiện export/upgrade.
- **ExportMode**: Chế độ xác định cách truyền tham số `--export` cho SpineCLI. Các giá trị hợp lệ: `PerProjectJson`, `GlobalJson`, `BuiltIn`, `GeneratedSettings`, `InternalExperimental`.
- **FallbackMode**: Hành vi khi một file `.spine` không tìm thấy `.export.json` cạnh nó. Các giá trị: `BuiltIn`, `GlobalJson`, `Skip`.
- **OutputPolicy**: Quy tắc đặt tên thư mục output. Các giá trị: `Timestamp`, `SourceFolderName`.
- **ExportPreset**: File `.export.json` được quản lý bởi SpineForgeX (built-in hoặc user-defined), chứa cấu hình atlas packing và skeleton export.
- **BatchExportRequest**: Payload gửi từ Frontend xuống Backend khi bắt đầu batch export, chứa toàn bộ tham số của một Session.
- **RunOverlay**: Màn hình phủ toàn ứng dụng hiển thị trong khi batch đang chạy, với progress bar và log realtime.
- **PerProjectJson**: ExportMode dùng file `.export.json` đặt cạnh từng file `.spine`.
- **GlobalJson**: ExportMode ép toàn bộ file dùng một `.export.json` chung do user chọn.
- **BuiltIn**: ExportMode dùng format export tích hợp sẵn của SpineCLI (ví dụ `binary+pack`, `json+pack`).
- **GeneratedSettings**: ExportMode sinh file `.export.json` tạm từ các tùy chọn UI, sau đó xóa sau khi export xong.
- **InternalExperimental**: ExportMode thực nghiệm không truyền `--export`; hiện tại bị vô hiệu hóa vì chưa được xác nhận qua test thực tế.
- **Unicode Path Workaround**: Cơ chế sao chép file `.spine` vào đường dẫn ASCII tạm, chạy export, rồi sao chép output trở lại, áp dụng khi SpineCLI gặp lỗi với đường dẫn non-ASCII.
- **Timestamp Folder**: Tên thư mục output có dạng `export_<version>_DDMMYYYY_HHMMSS`.
- **Auto-updater**: Cơ chế kiểm tra và cài đặt bản cập nhật ứng dụng tự động qua plugin `tauri-plugin-updater`.
- **Linked Project**: Một cấu hình liên kết dùng lại được, ánh xạ cây thư mục nguồn `.spine` sang cây thư mục đích trong dự án Unity. Chứa `name`, `unityRoot`, `sourceRoot` và danh sách `LinkedType`. Được lưu trong AppConfig để dùng chung cho nhiều Session.
- **LinkedType**: Một cặp ánh xạ `sourceName → destName` trong một Linked Project — tên thư mục type bên nguồn (số ít, ví dụ `Hero`, `Enemy`, `Eidolon`) ánh xạ sang tên thư mục type bên đích Unity (số nhiều, ví dụ `Heroes`, `Enemy`, `Eidolons`).
- **DestType / IdFolder**: Cấu trúc thư mục đích trong Unity dạng `unityRoot/<DestType>/<IdFolder>`. `DestType` là `LinkedType.destName`; `IdFolder` là thư mục id của từng đối tượng (ví dụ `0001_Fighter`, `10001`).
- **OutputPolicy `linkedProject`**: Giá trị OutputPolicy thứ ba, định tuyến output vào cây thư mục Unity của một Linked Project thay vì theo timestamp hoặc tên thư mục nguồn.
- **Unity Headless Trigger**: (Pha 2 — future) Cơ chế cho phép kích hoạt pipeline export từ chính Unity Editor qua chế độ headless CLI của SpineForgeX. Hiện ngoài phạm vi, sẽ spec riêng sau.

---

## Yêu Cầu

### Yêu Cầu 1: Cấu Hình Spine Executable

**User Story:** Là một animator trong studio, tôi muốn SpineForgeX tự động tìm và xác nhận đường dẫn đến Spine executable, để tôi không phải nhớ hoặc nhập thủ công mỗi lần cài đặt mới.

#### Tiêu Chí Chấp Nhận

1. WHEN người dùng nhấn nút Auto Detect, THE SpineForgeX SHALL tìm kiếm Spine executable theo thứ tự ưu tiên: path do người dùng nhập → biến môi trường `SPINE_PATH` → registry Windows → các đường dẫn phổ biến (`C:\Program Files\Spine\Spine.com`, `C:\Program Files (x86)\Spine\Spine.com`, `/Applications/Spine.app/Contents/MacOS/Spine`).

2. WHEN người dùng chọn hoặc nhập đường dẫn Spine executable, THE Backend SHALL kiểm tra sự tồn tại của file tại đường dẫn đó và trả về kết quả xác thực.

3. WHEN người dùng chạy `detect_spine_version` với đường dẫn hợp lệ, THE Backend SHALL thực thi `SpineCLI --version`, parse số phiên bản từ stdout/stderr và trả về chuỗi phiên bản.

4. IF người dùng chọn `Spine.exe` trên Windows thay vì `Spine.com`, THEN THE SpineForgeX SHALL hiển thị cảnh báo rằng `Spine.exe` là GUI executable và không nên dùng cho batch CLI.

5. THE SpineForgeX SHALL lưu trữ đường dẫn Spine executable vào AppConfig và khôi phục giá trị này khi khởi động lại ứng dụng.

---

### Yêu Cầu 2: Quản Lý Session và Project

**User Story:** Là một technical artist, tôi muốn lưu nhiều bộ cấu hình export dưới dạng session riêng biệt được tổ chức theo project, để tôi có thể chuyển đổi nhanh giữa các tập file hoặc export mode khác nhau mà không cần cấu hình lại từ đầu.

#### Tiêu Chí Chấp Nhận

1. THE SpineForgeX SHALL cho phép người dùng tạo, đặt tên, đổi tên, nhân bản và xóa Session.

2. THE SpineForgeX SHALL cho phép người dùng tạo, đặt tên, đổi tên và xóa Project; mỗi Project chứa một hoặc nhiều Session.

3. WHEN người dùng xóa một Project, THE SpineForgeX SHALL xóa tất cả Session con của Project đó sau khi người dùng xác nhận.

4. THE SpineForgeX SHALL lưu trữ toàn bộ danh sách Project, Session và cấu hình vào localStorage sau mỗi thay đổi và khôi phục chính xác khi khởi động lại.

5. WHEN người dùng chuyển đổi giữa các Session, THE SpineForgeX SHALL lưu runtime state (danh sách file, log, tiến trình) của Session hiện tại trước khi tải runtime state của Session mới.

6. WHILE một Session đang chạy batch export, THE SpineForgeX SHALL ngăn không cho bắt đầu thêm bất kỳ Session nào khác.

7. THE SpineForgeX SHALL hiển thị trạng thái sẵn sàng của từng Session bằng màu chỉ thị (xanh lá = sẵn sàng, vàng = cảnh báo, đỏ = lỗi cấu hình) trong sidebar.

8. THE SpineForgeX SHALL hỗ trợ thu gọn/mở rộng từng Project trong sidebar để giảm chiều dài danh sách.

---

### Yêu Cầu 3: Chọn Input File

**User Story:** Là một animator, tôi muốn có thể chọn một thư mục hoặc nhiều file `.spine` cụ thể làm đầu vào, để tôi linh hoạt trong việc export toàn bộ project hoặc chỉ một tập con file cần cập nhật.

#### Tiêu Chí Chấp Nhận

1. WHEN người dùng chọn một thư mục input, THE Backend SHALL quét đệ quy toàn bộ thư mục đó và trả về danh sách các file `.spine` hợp lệ, loại trừ file tạm có tên bắt đầu bằng `.~`.

2. WHEN người dùng chọn nhiều file `.spine` cụ thể thay vì thư mục, THE SpineForgeX SHALL sử dụng danh sách file đó trực tiếp mà không cần quét thư mục.

3. THE SpineForgeX SHALL hiển thị tổng số file `.spine` tìm thấy và số file bị bỏ qua sau khi quét.

4. THE SpineForgeX SHALL cho phép người dùng loại trừ từng file khỏi danh sách trước khi bắt đầu export, và khôi phục lại file đã loại trừ.

5. WHEN người dùng thay đổi input path cho một Session có `inputPath` đã được thiết lập, THE SpineForgeX SHALL tự động khởi động lại quét file và cập nhật danh sách.

6. IF người dùng nhập một input path không tồn tại, THEN THE Backend SHALL trả về lỗi rõ ràng thay vì danh sách rỗng.

---

### Yêu Cầu 4: Cấu Hình Export Strategy

**User Story:** Là một technical artist, tôi muốn chọn chính xác cách SpineForgeX truyền tham số export cho Spine CLI, để đảm bảo mỗi project giữ đúng cấu hình atlas size riêng của nó.

#### Tiêu Chí Chấp Nhận

1. THE SpineForgeX SHALL hỗ trợ bốn ExportMode đang hoạt động: `PerProjectJson`, `GlobalJson`, `BuiltIn`, `GeneratedSettings`.

2. WHEN ExportMode là `PerProjectJson`, THE Backend SHALL tìm file `.export.json` trong cùng thư mục với từng file `.spine` và truyền đường dẫn đó vào tham số `--export` của SpineCLI.

3. WHEN ExportMode là `PerProjectJson` và không tìm thấy `.export.json` cạnh file `.spine`, THE Backend SHALL áp dụng FallbackMode: nếu `BuiltIn` thì dùng built-in format; nếu `GlobalJson` thì dùng file global JSON; nếu `Skip` thì bỏ qua file đó và ghi log cảnh báo.

4. WHEN ExportMode là `GlobalJson`, THE Backend SHALL dùng đường dẫn `.export.json` được người dùng chỉ định cho tất cả file và truyền vào `--export` của SpineCLI.

5. WHEN ExportMode là `BuiltIn`, THE Backend SHALL truyền giá trị built-in format (ví dụ `binary+pack`, `json+pack`) vào `--export` của SpineCLI.

6. WHEN ExportMode là `GeneratedSettings`, THE Backend SHALL sinh một file `.export.json` tạm từ các tùy chọn do người dùng cấu hình trong UI, truyền đường dẫn file tạm đó vào `--export`, và xóa file tạm sau khi SpineCLI kết thúc (bất kể thành công hay thất bại).

7. WHERE ExportMode là `InternalExperimental`, THE SpineForgeX SHALL từ chối bắt đầu export và hiển thị thông báo lỗi giải thích rằng chế độ này bị vô hiệu hóa vì SpineCLI yêu cầu tham số `--export`.

8. WHEN ExportMode là `PerProjectJson` và một thư mục `.spine` chứa nhiều file `.export.json`, THE Backend SHALL chạy nhiều lần export cho cùng một file `.spine` (một lần cho mỗi `.export.json`) theo đúng hành vi mẫu của Spine.

---

### Yêu Cầu 5: Cấu Hình Output

**User Story:** Là một technical artist, tôi muốn kiểm soát cách đặt tên và tổ chức thư mục output, để output từ nhiều lần export không ghi đè lẫn nhau và dễ nhận biết.

#### Tiêu Chí Chấp Nhận

1. WHEN OutputPolicy là `Timestamp`, THE Backend SHALL tạo thư mục output có tên dạng `export_<version>_DDMMYYYY_HHMMSS` trong thư mục chứa file `.spine` (nếu không có output root) hoặc trong output root được chỉ định.

2. WHEN OutputPolicy là `Timestamp` và người dùng đã chỉ định output root cùng với tùy chọn `preserveRelativePaths = true`, THE Backend SHALL tái tạo cấu trúc thư mục tương đối từ input root vào trong output root trước khi thêm tên thư mục timestamp.

3. WHEN OutputPolicy là `SourceFolderName`, THE Backend SHALL đặt output của mỗi file `.spine` vào thư mục `<outputRoot>/<tên thư mục chứa file .spine>`.

4. IF OutputPolicy là `SourceFolderName` và người dùng chưa chỉ định output root, THEN THE SpineForgeX SHALL từ chối bắt đầu export và hiển thị thông báo lỗi.

5. WHERE tùy chọn `cleanFolderName` được bật, THE Backend SHALL rút gọn tên thư mục source bằng cách lấy phần trước dấu gạch dưới đầu tiên (ví dụ `3001_Lucius` thành `3001`).

6. WHEN người dùng nhấn nút "Xóa Timestamp Exports", THE Backend SHALL quét thư mục input và xóa tất cả thư mục có tên khớp pattern `export_<version>_DDMMYYYY_HHMMSS`, trả về danh sách các thư mục đã xóa và các thư mục xóa thất bại.

7. WHEN SpineForgeX phát hiện thư mục output đích đã tồn tại và không rỗng trước khi chạy, THE SpineForgeX SHALL cảnh báo người dùng về collision output trước khi bắt đầu batch.

8. THE SpineForgeX SHALL hỗ trợ thêm giá trị OutputPolicy thứ ba là `linkedProject`, định tuyến output vào cây thư mục đích trong dự án Unity của một Linked Project; hành vi chi tiết được mô tả trong Yêu Cầu 20.

---

### Yêu Cầu 6: Tham Số Nâng Cao Runtime

**User Story:** Là một technical artist, tôi muốn kiểm soát các tham số JVM và giới hạn thời gian của từng tiến trình Spine, để batch không bị treo vô thời hạn và không tiêu thụ quá nhiều RAM.

#### Tiêu Chí Chấp Nhận

1. THE SpineForgeX SHALL cho phép người dùng chỉ định target version của Spine (ví dụ `4.3.xx`, `4.3.39`, `lateststable`) và truyền giá trị đó vào tham số `--update` của SpineCLI.

2. THE SpineForgeX SHALL cho phép người dùng cấu hình số parallel jobs trong khoảng từ 1 đến 8.

3. THE SpineForgeX SHALL cho phép người dùng cấu hình bộ nhớ JVM tối đa dạng `-Xmx<value>` (ví dụ `512m`, `1024m`) và truyền vào SpineCLI dưới dạng JVM argument đầu tiên.

4. THE SpineForgeX SHALL cho phép người dùng cấu hình timeout tính bằng giây cho mỗi file, với giá trị mặc định là 300 giây (5 phút) và giá trị tối thiểu là 30 giây.

5. IF một tiến trình SpineCLI vượt quá timeout đã cấu hình, THEN THE Backend SHALL kill tiến trình đó, đánh dấu file là thất bại và ghi log timeout.

6. THE SpineForgeX SHALL cho phép người dùng bật tùy chọn `--clean`, truyền flag đó vào SpineCLI để xóa thư mục output trước khi export.

---

### Yêu Cầu 7: Thực Thi Batch Export

**User Story:** Là một animator, tôi muốn bắt đầu batch export và thấy tiến trình realtime, để tôi biết quá trình đang diễn ra như thế nào và không cần ngồi đợi mà không có thông tin.

#### Tiêu Chí Chấp Nhận

1. WHEN người dùng nhấn nút Start Export, THE Backend SHALL xác thực toàn bộ tham số trước khi bắt đầu và từ chối với thông báo lỗi cụ thể nếu có lỗi validation.

2. WHEN batch export đang chạy, THE Backend SHALL phát sự kiện `spine-log` cho mỗi dòng stdout của SpineCLI, sự kiện `spine-error` cho mỗi dòng stderr, và sự kiện `spine-progress` cho mỗi file được xử lý, bao gồm số thứ tự hiện tại, tổng số file và tên file.

3. WHEN batch export đang chạy, THE Frontend SHALL hiển thị RunOverlay bao phủ giao diện chính, với progress bar determinate theo số file, tên file hiện tại và log realtime dạng terminal monospace.

4. WHEN SpineCLI thoát với exit code khác 0 cho một file, THE Backend SHALL đánh dấu file đó là thất bại, ghi log lỗi và tiếp tục xử lý file tiếp theo mà không dừng toàn bộ batch.

5. WHEN tất cả file trong batch đã được xử lý, THE Backend SHALL trả về `BatchExportResult` bao gồm số file hoàn thành, tổng số file, danh sách thư mục output và trạng thái `stopped`.

6. WHEN batch export hoàn tất, THE Frontend SHALL hiển thị tổng kết: số file thành công, số lỗi, số bỏ qua, tổng thời gian và nút mở thư mục output.

7. WHILE batch export đang chạy, THE Backend SHALL ghi lại PID của mỗi tiến trình SpineCLI đang chạy để hỗ trợ dừng tiến trình khi cần.

---

### Yêu Cầu 8: Xác Minh Output Sau Export

**User Story:** Là một technical artist, tôi muốn SpineForgeX kiểm tra xem file output thực sự được tạo ra sau khi Spine CLI báo thành công, để phát hiện trường hợp CLI thoát với exit code 0 nhưng thực tế không sinh output.

#### Tiêu Chí Chấp Nhận

1. WHEN SpineCLI thoát với exit code 0 cho một file, THE Backend SHALL kiểm tra sự tồn tại của ít nhất một file output (`.skel`, `.json` hoặc `.atlas`) trong thư mục output tương ứng.

2. IF SpineCLI thoát với exit code 0 nhưng không tìm thấy file output nào trong thư mục output, THEN THE Backend SHALL đánh dấu file đó là thất bại với cảnh báo "CLI exit 0 nhưng không tìm thấy file output" và ghi vào log.

3. THE Backend SHALL phân biệt rõ giữa ba trạng thái kết quả của từng file: `completed` (thành công và có output), `failed` (lỗi CLI hoặc timeout), và `skipped` (bị bỏ qua do FallbackMode = Skip).

---

### Yêu Cầu 9: Dừng Batch Export

**User Story:** Là một animator, tôi muốn có thể dừng batch export đang chạy bất cứ lúc nào, để không lãng phí thời gian khi phát hiện cấu hình sai.

#### Tiêu Chí Chấp Nhận

1. WHEN người dùng nhấn nút Stop, THE Backend SHALL đặt cờ `stop_requested = true` để ngăn bắt đầu file mới và kill tất cả tiến trình SpineCLI đang chạy.

2. WHEN cờ `stop_requested` được đặt, THE Backend SHALL không bắt đầu xử lý file tiếp theo trong queue.

3. WHEN batch bị dừng, THE Backend SHALL trả về `BatchExportResult` với trường `stopped = true` và số file đã hoàn thành trước khi dừng.

4. WHEN người dùng xóa một Session hoặc Project đang chạy batch, THE SpineForgeX SHALL tự động gọi stop_batch_export trước khi xóa.

---

### Yêu Cầu 10: Quản Lý Export Preset

**User Story:** Là một technical artist, tôi muốn quản lý thư viện các file `.export.json` ngay trong ứng dụng, để tôi không phải tìm kiếm file thủ công trên filesystem mỗi khi cần thay đổi cấu hình export.

#### Tiêu Chí Chấp Nhận

1. THE SpineForgeX SHALL cung cấp tập preset built-in (ví dụ `binary-pack`, `json-pack`) được đóng gói cùng ứng dụng và không cho phép xóa hoặc sửa trực tiếp.

2. THE SpineForgeX SHALL cho phép người dùng import file `.export.json` từ filesystem vào thư viện user preset, xác thực rằng nội dung là JSON hợp lệ trước khi lưu.

3. THE SpineForgeX SHALL cho phép người dùng tạo user preset mới từ đầu hoặc tạo bản sao từ preset built-in, chỉnh sửa nội dung JSON trong editor và lưu với tên tùy chọn.

4. THE SpineForgeX SHALL cho phép người dùng xóa user preset; THE SpineForgeX SHALL không cho phép xóa preset built-in.

5. WHEN người dùng chọn một user preset, THE SpineForgeX SHALL hiển thị preview nội dung JSON của preset đó trong UI.

6. THE SpineForgeX SHALL lưu user preset vào thư mục dữ liệu ứng dụng (`app_data_dir`) để tồn tại qua các lần cập nhật ứng dụng.

7. WHEN Backend nhận file `.export.json` từ import, THE Backend SHALL kiểm tra tên file chỉ chứa ký tự hợp lệ cho tên file và phần mở rộng là `.export.json`.

---

### Yêu Cầu 11: Xử Lý Unicode Path

**User Story:** Là một studio có tên project tiếng Việt hoặc tiếng Trung, tôi muốn SpineForgeX cảnh báo và xử lý đường dẫn chứa ký tự non-ASCII, để tránh lỗi Spine CLI silent failure với Unicode path.

#### Tiêu Chí Chấp Nhận

1. WHEN input path hoặc output path chứa ký tự non-ASCII, THE SpineForgeX SHALL hiển thị cảnh báo cho người dùng trước khi bắt đầu batch.

2. WHERE Unicode Path Workaround được bật trong cấu hình, THE Backend SHALL sao chép file `.spine` và các file phụ thuộc vào đường dẫn ASCII tạm, thực thi SpineCLI với đường dẫn tạm đó, sao chép output trở lại đường dẫn đích, và xóa thư mục tạm sau khi hoàn tất.

3. IF Unicode Path Workaround gặp lỗi trong quá trình sao chép, THEN THE Backend SHALL xóa thư mục tạm (nếu đã tạo), đánh dấu file là thất bại và ghi log lỗi cụ thể.

---

### Yêu Cầu 12: Parallel Jobs Thực Sự

**User Story:** Là một technical artist xử lý hàng trăm file, tôi muốn batch export chạy nhiều tiến trình Spine song song, để rút ngắn tổng thời gian export.

#### Tiêu Chí Chấp Nhận

1. WHEN `parallelJobs` được cấu hình lớn hơn 1, THE Backend SHALL chạy tối đa `parallelJobs` tiến trình SpineCLI đồng thời thay vì tuần tự.

2. WHEN `parallelJobs` lớn hơn 1, THE Backend SHALL theo dõi PID của tất cả tiến trình đang chạy đồng thời để có thể kill tất cả khi người dùng nhấn Stop.

3. WHEN `parallelJobs` lớn hơn 1, THE Backend SHALL phát sự kiện `spine-progress` chính xác phản ánh tổng số file đã hoàn thành trong tất cả các luồng song song.

4. IF `parallelJobs` vượt quá giá trị 8, THEN THE Backend SHALL giới hạn số job thực tế xuống còn 8.

---

### Yêu Cầu 13: Export Tất Cả Sessions Song Song

**User Story:** Là một technical artist quản lý nhiều project, tôi muốn bắt đầu export tất cả session có trạng thái sẵn sàng trong một thao tác, để không phải click từng session một.

#### Tiêu Chí Chấp Nhận

1. WHEN người dùng kích hoạt "Export All Sessions", THE SpineForgeX SHALL lần lượt chạy batch export cho từng Session có trạng thái `green` (sẵn sàng), theo thứ tự từng session một.

2. WHILE "Export All Sessions" đang chạy, THE Frontend SHALL hiển thị tiến trình tổng thể dạng "Session X / Y" cùng với progress chi tiết của session đang chạy.

3. WHEN một Session trong "Export All Sessions" thất bại hoàn toàn, THE SpineForgeX SHALL ghi log lỗi và tiếp tục xử lý Session tiếp theo mà không dừng toàn bộ chuỗi.

4. WHEN người dùng nhấn Stop trong khi "Export All Sessions" đang chạy, THE SpineForgeX SHALL dừng session hiện tại và không bắt đầu session tiếp theo.

---

### Yêu Cầu 14: Giao Diện Người Dùng

**User Story:** Là một animator, tôi muốn giao diện rõ ràng, responsive và nhất quán trên màn hình laptop nhỏ, để tôi có thể thao tác hiệu quả mà không bị cuộn nhiều hoặc nhầm lẫn giữa các section.

#### Tiêu Chí Chấp Nhận

1. THE Frontend SHALL tổ chức workspace theo layout một cột với các collapsible section theo thứ tự: Spine Executable → Input Files → Export Strategy → Advanced Runtime → Run → Log & Results.

2. THE Frontend SHALL hiển thị icon check (xanh), warning (vàng) hoặc error (đỏ) cạnh từng field cấu hình để phản ánh trạng thái validation mà không chỉ dựa vào text log.

3. WHEN người dùng thêm file hoặc thư mục vào Input vào giao diện, THE Frontend SHALL chấp nhận thao tác kéo thả (drag-and-drop) folder hoặc file `.spine`.

4. THE Frontend SHALL giới hạn chiều cao của vùng log và danh sách file, cho phép scroll độc lập trong từng vùng đó để không làm vỡ layout tổng thể.

5. THE Frontend SHALL hỗ trợ hai theme: Light và Dark; người dùng có thể chuyển đổi trong Settings và lựa chọn được lưu trữ liên tục.

6. THE Frontend SHALL hỗ trợ hai ngôn ngữ giao diện: Tiếng Việt và English; người dùng có thể chuyển đổi trong Settings và lựa chọn được lưu trữ liên tục.

7. WHILE batch export đang chạy, THE Frontend SHALL hiển thị RunOverlay bao phủ toàn bộ workspace với progress bar determinate, ngăn người dùng thay đổi cấu hình của session đang chạy.

8. THE Frontend SHALL cung cấp nút "Mở thư mục output" mở thư mục output gần nhất trong file explorer của hệ điều hành sau khi batch hoàn tất.

---

### Yêu Cầu 15: Logging và Lưu Log

**User Story:** Là một technical artist, tôi muốn xem log đầy đủ của từng batch export và lưu log ra file để điều tra lỗi sau này.

#### Tiêu Chí Chấp Nhận

1. THE Frontend SHALL hiển thị log realtime dạng terminal monospace với auto-scroll xuống dòng mới nhất khi có log mới.

2. THE Frontend SHALL gắn timestamp `HH:MM:SS` vào đầu mỗi dòng log trước khi hiển thị.

3. THE Frontend SHALL cho phép người dùng lọc log để chỉ hiển thị các dòng có lỗi (dòng stderr từ SpineCLI).

4. THE Frontend SHALL cung cấp nút Clear để xóa log của session hiện tại.

5. WHEN người dùng nhấn Save Log, THE Frontend SHALL mở dialog lưu file cho phép người dùng chọn đường dẫn và lưu nội dung log hiện tại ra file `.txt`.

6. WHEN người dùng chuyển đổi sang Session khác trong khi một Session đang chạy, THE Backend SHALL tiếp tục ghi log vào runtime buffer của Session đang chạy thay vì Session đang hiển thị.

---

### Yêu Cầu 16: Validation Trước Khi Chạy

**User Story:** Là một animator, tôi muốn SpineForgeX kiểm tra cấu hình trước khi bắt đầu batch, để tôi không mất thời gian chờ đợi rồi mới phát hiện lỗi cấu hình hiển nhiên.

#### Tiêu Chí Chấp Nhận

1. WHEN cấu hình thay đổi (spinePath, outputPath, outputPolicy, exportMode, globalJsonPath), THE SpineForgeX SHALL tự động chạy lại validate settings và cập nhật trạng thái validation trong vòng 500ms.

2. THE Backend SHALL kiểm tra các điều kiện sau trong validate_settings: Spine executable tồn tại → output directory hợp lệ (nếu có) → global JSON tồn tại (nếu exportMode yêu cầu) → InternalExperimental bị từ chối.

3. IF có lỗi validation, THEN THE SpineForgeX SHALL vô hiệu hóa nút Start Export và hiển thị danh sách lỗi rõ ràng cho người dùng.

4. IF chỉ có cảnh báo (không có lỗi), THEN THE SpineForgeX SHALL cho phép bắt đầu export nhưng hiển thị danh sách cảnh báo để người dùng biết.

5. WHEN người dùng nhập giá trị `maxMemory` không hợp lệ (không khớp pattern `\d+[kKmMgG]?`), THE SpineForgeX SHALL hiển thị cảnh báo format không hợp lệ.

---

### Yêu Cầu 17: Auto-Updater

**User Story:** Là một studio dùng SpineForgeX, tôi muốn ứng dụng tự động kiểm tra và cài đặt bản cập nhật, để tôi luôn có phiên bản mới nhất mà không cần tải thủ công.

#### Tiêu Chí Chấp Nhận

1. WHEN SpineForgeX khởi động, THE SpineForgeX SHALL tự động kiểm tra bản cập nhật trong nền với timeout 30 giây.

2. WHEN có bản cập nhật mới, THE SpineForgeX SHALL tự động tải xuống và hiển thị tiến trình download với progress bar.

3. WHEN download hoàn tất, THE SpineForgeX SHALL hiển thị nút "Cài đặt và Khởi động lại" để người dùng chủ động kích hoạt cài đặt.

4. IF kiểm tra cập nhật thất bại (lỗi mạng hoặc timeout), THEN THE SpineForgeX SHALL ghi log lỗi và hiển thị thông báo lỗi tạm thời trong tối đa 6 giây mà không làm gián đoạn workflow của người dùng.

5. THE SpineForgeX SHALL cho phép người dùng kiểm tra cập nhật thủ công và hiển thị thông báo "Ứng dụng đã ở phiên bản mới nhất" nếu không có cập nhật.

---

### Yêu Cầu 18: Hỗ Trợ macOS

**User Story:** Là một studio có cả máy Windows và macOS, tôi muốn SpineForgeX hoạt động đúng trên cả hai nền tảng, để không phải dùng hai công cụ khác nhau.

#### Tiêu Chí Chấp Nhận

1. WHEN chạy trên macOS, THE SpineForgeX SHALL sử dụng đường dẫn Spine executable mặc định `/Applications/Spine.app/Contents/MacOS/Spine` trong quá trình auto-detect.

2. WHEN mở thư mục output trên macOS, THE Backend SHALL sử dụng lệnh `open` thay vì `explorer`.

3. THE SpineForgeX SHALL build và đóng gói được trên macOS với code signing và notarization đáp ứng yêu cầu của macOS Gatekeeper.

4. WHEN chạy trên macOS, THE SpineForgeX SHALL không cảnh báo về việc dùng `Spine.exe` (cảnh báo này chỉ áp dụng trên Windows).

---

### Yêu Cầu 19: Độ Bền Vững và Không Gây Panic

**User Story:** Là người dùng thực tế trong môi trường production, tôi muốn SpineForgeX không crash hay treo khi gặp lỗi môi trường như UI đóng giữa chừng hoặc file bị xóa trong quá trình chạy.

#### Tiêu Chí Chấp Nhận

1. WHEN Backend phát sự kiện Tauri về Frontend và Frontend đã đóng hoặc không nhận được, THE Backend SHALL bỏ qua lỗi emit mà không panic.

2. WHEN Backend đọc hoặc ghi file và gặp lỗi I/O, THE Backend SHALL trả về lỗi có mô tả cụ thể dưới dạng `Result::Err(String)` thay vì sử dụng `unwrap()` hoặc `expect()`.

3. THE Backend SHALL không sử dụng `unwrap()` hoặc `expect()` trong các đường dẫn mã xử lý sự kiện realtime hoặc kết quả I/O của tiến trình Spine.

4. WHEN ứng dụng không tìm thấy Spine executable trong lần đầu chạy, THE SpineForgeX SHALL hiển thị hướng dẫn cài đặt rõ ràng thay vì trạng thái lỗi không giải thích.

---

### Yêu Cầu 20: Linked Project — Liên Kết Dự Án Unity

**User Story:** Là một technical artist tích hợp asset Spine vào dự án Unity, tôi muốn export đi thẳng vào đúng thư mục trong cây asset Unity (theo type và id) thay vì phải copy thủ công sau mỗi lần export, để giảm thao tác lặp và tránh đặt nhầm thư mục.

#### Tiêu Chí Chấp Nhận

1. THE SpineForgeX SHALL cho phép người dùng tạo, đặt tên, chỉnh sửa và xóa Linked Project; mỗi Linked Project chứa `name`, `unityRoot` (thư mục gốc đích trong Unity, ví dụ `.../Animations/Spine`), `sourceRoot` (thư mục gốc chứa file `.spine` nguồn) và danh sách `LinkedType` (`sourceName → destName`).

2. THE SpineForgeX SHALL lưu trữ danh sách Linked Project trong AppConfig (dùng chung cho mọi Session) và khôi phục chính xác khi khởi động lại.

3. WHEN người dùng nhấn "Auto-fill từ Unity root" trong trình quản lý Linked Project, THE Backend SHALL liệt kê các thư mục con trực tiếp của `unityRoot` (qua `list_subdirectories`) để điền sẵn bảng `LinkedType`, với `destName` là tên thư mục con tìm được.

4. WHEN OutputPolicy là `linkedProject`, THE SpineForgeX SHALL yêu cầu người dùng chọn một Linked Project và đúng một `LinkedType` (theo `sourceName`) cho Session; output của mỗi file SHALL được đặt vào `unityRoot/<destName>/<IdFolder>`.

5. WHEN xác định `IdFolder` cho một file `.spine`, THE Backend SHALL tách id token từ tên thư mục nguồn (phần trước dấu gạch dưới đầu tiên, ví dụ `3001_Lucius` → `3001`), sau đó tìm thư mục đích đã tồn tại theo thứ tự ưu tiên: khớp tên đúng bằng id → khớp tiền tố `<id>_` → nếu không tìm thấy thì tạo thư mục mới theo nguyên tên thư mục nguồn.

6. THE Backend SHALL không tạo thư mục đích trùng lặp cạnh một thư mục id đã tồn tại; nếu đã có thư mục khớp id (đúng tên hoặc theo tiền tố) thì SHALL tái sử dụng thư mục đó.

7. WHEN OutputPolicy là `linkedProject`, THE Frontend SHALL hiển thị preview thư mục đích real-time cho file input đầu tiên (ví dụ `→ …\Spine\Enemy\4001\`), và chú thích `(sẽ tạo mới)` nếu thư mục đích chưa tồn tại.

8. WHEN OutputPolicy là `linkedProject`, THE SpineForgeX SHALL từ chối bắt đầu export nếu chưa chọn Linked Project hợp lệ hoặc chưa chọn `LinkedType`; `validate_settings` SHALL bắt buộc `output_path` (= `unityRoot`) và `linked_dest_type` (= `destName`) không rỗng.

9. WHEN thư mục đích đã tồn tại và không rỗng, THE SpineForgeX SHALL áp dụng cảnh báo collision output như Yêu Cầu 5.7 trước khi bắt đầu batch.

> **Phạm vi tương lai (Pha 2):** Kích hoạt pipeline export trực tiếp từ Unity Editor qua chế độ headless CLI của SpineForgeX (Unity Headless Trigger) hiện **ngoài phạm vi** của tài liệu này và sẽ được spec riêng sau khi Pha 1 (Linked Project trong UI) đã được verify.
