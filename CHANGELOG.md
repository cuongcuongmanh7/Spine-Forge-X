# Changelog

## v0.4.33
- **Xem trước động ngay trong panel** — chọn 1 asset, panel bên phải giờ phát skeleton sống (không chỉ ảnh tĩnh): có nút phóng/thu, đặt lại khung, **Phóng to** (mở lại trong cửa sổ lớn) và **toàn màn hình**. Cửa sổ xem trước lớn dùng chung đúng trình phát đó nên hành vi nhất quán.

## v0.4.32
- **Bảng chi tiết bên phải (inspector) cho Inventory** — khi chọn asset, một panel bên phải hiện ra: chọn **1 asset** → ảnh xem trước + nút Preview + thông tin (version, dung lượng .spine/ảnh, số anim/skin) + các nút thao tác (Export nhanh, Tạo session, Kiểm tra export, Chuyển vào thùng rác); chọn **nhiều asset** → tổng quan (tổng dung lượng, tổng animation, thanh trạng thái clean/cần kiểm tra), danh sách asset đã chọn, và nút Export hàng loạt / Tạo project. (Xem trước động ngay trong panel sẽ thêm ở bản sau.)

## v0.4.31
- **Chọn nhiều asset trong Inventory** — mỗi card/hàng giờ có ô tích để chọn; card được chọn có viền xanh nổi bật. Thanh phía trên danh sách có nút **Chọn** (chọn/bỏ tất cả kết quả đang lọc) và hiển thị số "kết quả" hoặc số "đã chọn", kèm nút **Bỏ chọn**. Mỗi **folder/nhóm** cũng có ô tích riêng để chọn nhanh cả nhóm (hiện dấu gạch khi mới chọn một phần). (Các thao tác hàng loạt trên vùng chọn sẽ thêm ở bản sau.)

## v0.4.30
- **Thẻ thống kê Inventory gọn theo dashboard** — hàng thẻ đầu Inventory giờ là 6 thẻ cố định: **Tổng asset · File .spine · Dung lượng ảnh · Chưa scan · Đã clean · Cần kiểm tra** (bỏ các thẻ tách theo version). Lọc theo version vẫn dùng được qua chip bộ lọc như cũ.

## v0.4.29
- **Tìm kiếm "đảo" (invert)** — bật nút đảo cạnh ô tìm kiếm để chỉ hiện các mục **không** chứa từ khoá. Ví dụ gõ `idle` rồi bật đảo → ẩn hết mục có `idle`, hiện phần còn lại. Bỏ trống ô tìm thì nút đảo không ảnh hưởng gì. Chỉ áp cho từ khoá tìm — các chip lọc (nhóm/loại/version…) vẫn hoạt động như thường.
- **Tìm theo đường dẫn (`path:`)** — thêm cú pháp `path:bk` để lọc **chỉ** theo đường dẫn file (bỏ qua tên anim/skin), nhất quán với `anim:` / `skin:`. (Gõ chữ thường không prefix vẫn tìm cả path + anim + skin như cũ.)
- **Thùng rác cho Library** — mở menu ⋯ của file → **Chuyển vào thùng rác** để loại mục đó khỏi inventory; rescan vẫn ẩn (không hiện lại). Mỗi thư viện có thùng rác riêng và **đồng bộ cho cả nhóm**: thành viên khác cũng thấy mục đã ẩn. Khi quét/nhập lại thư viện mà có mục nằm trong thùng rác, app tự ẩn và báo nhẹ số lượng. Mở chip **Thùng rác (n)** để xem lại và **Khôi phục** từng mục hoặc tất cả.
- **Bộ lọc thu gọn vẫn thấy chip đang chọn** — khi thu gọn thẻ Bộ lọc, các chip đang chọn hiện ngay trên tiêu đề (bấm × để bỏ); nếu nhiều quá thì nút `… +k` mở danh sách đầy đủ.
- **Mỗi thư viện nhớ bộ lọc riêng** — đổi/nhập thư viện mới thì bộ lọc reset sạch, quay lại thư viện cũ thì khôi phục đúng bộ lọc đã đặt (thay vì dùng chung một bộ lọc cho mọi thư viện như trước).

## v0.4.28
- **Thông báo (chuông) giờ dùng chung trên mọi máy** — trước đây mỗi máy giữ danh sách thông báo riêng (lưu cục bộ), nên cùng một tài khoản đăng nhập ở máy khác lại thấy danh sách khác và badge số khác nhau. Nay thông báo thay đổi trên Drive được đồng bộ chung cho cả nhóm: máy nào phát hiện cũng góp vào một danh sách, các máy đều thấy giống nhau. Trạng thái **đã đọc / đã xoá** đi theo tài khoản — đọc ở máy này thì máy kia cũng hết badge. Mỗi thay đổi chỉ hiện một lần dù nhiều máy cùng phát hiện. Chưa đăng nhập thì vẫn chạy cục bộ như cũ.

## v0.4.27
- **Sửa vài file bị lỗi hình ảnh (viền sáng/quầng) do Premultiply Alpha** — trình phát 3.8 mặc định coi mọi texture là premultiplied, nên file export **tắt** Premultiply alpha (straight alpha) bị render viền/vùng bán trong suốt sáng lóa. Nay app tự nhận diện từng file là PMA hay straight-alpha (quét pixel page đầu) và báo player render đúng — không cần re-export hay sửa setting. Thumbnail tạo lại để áp dụng.
- **Sửa file binary 3.8 có tên layer tiếng Trung/Nhật/Hàn không load được** — trình phát 3.8 đọc byte skeleton dạng có dấu (signed) nên ký tự nhiều byte (vd `祥云 Copy`, `图层`) bị giải mã sai → tên attachment không khớp atlas → báo "could not load skeleton / Region not found in atlas" → trắng cả thumbnail lẫn xem trước. Nay đọc byte đúng kiểu unsigned, các file này hiện đúng. Ảnh hỏng sẽ tự tạo lại.
- **Sửa thumbnail/xem trước trắng khi folder export có nhiều bộ** — nhiều unit export ra cả rig chính (vd `9905`) lẫn atlas hiệu ứng riêng (vd `9905_Portal`) trong cùng thư mục `export/`. Trước đây app chọn skeleton và atlas **độc lập** nên dễ ghép nhầm (skeleton chính + atlas hiệu ứng) → không tìm thấy region → ảnh trắng. Nay ghép skeleton ↔ atlas **theo tên gốc** và ưu tiên bộ khớp tên/ID thư mục (vd folder `9912` chọn bộ `Splash_9912`, bỏ qua bộ `Splash_9911` thừa do copy nhầm), nên chọn đúng cặp/đúng nhân vật. Thumbnail hỏng sẽ tự tạo lại.
- **Thêm "Kiểm tra export" cho từng file trong Library** — với file đã export nhưng không hiện thumbnail / không xem trước được, mở menu ⋯ → Kiểm tra export để xem ngay vì sao: đủ thư mục export chưa, có skeleton + atlas không, từng ảnh texture mà atlas trỏ tới có nằm trên đĩa và đúng dung lượng không, version/runtime khớp chưa. Có nút **Copy cho AI** và **Lưu report** (xuất `health-report.md` kèm nội dung atlas + header skeleton) để nhờ phân tích sâu.

## v0.4.26
- **Sửa thumbnail file 4.x luôn trống** — trình phát 4.x mặc định "bay" camera vào khung trong ~0.25s, mà thumbnail chụp ngay sau khi nạp (~2 frame) nên chụp đúng lúc nhân vật chưa vào khung → ra ảnh trống và bị loại. Nay khung được căn tức thì khi chụp (và tắt spinner loading đè lên), nên thumbnail 4.x hiện đúng. Thumbnail cũ sẽ tự tạo lại.

## v0.4.25
- **Inventory hiện được danh sách anim/skin cho file 4.x binary** — trước đây file export dạng binary 4.x (`.skel`/`.skel.bytes`, không có JSON) không đọc được tên anim/skin nên cột đếm, sort, tìm kiếm và panel mở rộng đều trống. Nay app tự parse bằng runtime khớp version (không cần WebGL) và điền vào — đầy đủ số đếm, sort, search theo tên.
- **Sửa thumbnail / xem trước bị trống với rig kiểu "skin-folder"** — nhiều rig để skin `default` gần như rỗng và đặt art ở các skin riêng (`A/Body_0`, `A/Weapon_0`…). Trước đây app luôn chọn `default` nên ra ảnh trống. Nay chọn skin có nhiều ảnh nhất nên hiện đúng nhân vật ở cả thumbnail lẫn khung xem trước. Thumbnail cũ sẽ tự tạo lại.

## v0.4.24
- **Sửa xem trước / thumbnail không hiện cho file Spine 4.2** — runtime đi kèm chỉ là 4.3, mà 4.2 và 4.3 không tương thích định dạng nên file 4.2 đọc bị lệch (trắng / báo lỗi). Nay app nhận đúng minor version (3.8 / 4.2 / 4.3…) từ chính file export và nạp runtime khớp — file 4.2 dùng player 4.2, file 4.3 dùng player 4.3. Thumbnail 4.2 cũ (trắng) sẽ tự tạo lại.

## v0.4.23
- **Xem trước anim: hiện danh sách event + thời điểm** — popup xem trước giờ liệt kê các event có trong animation đang chạy, kèm icon riêng và thời điểm theo cả giây lẫn frame (ví dụ `event_a (1.5s - 45f)`).
- **Event gắn thẳng lên thanh tua** — mỗi event là một vạch + nhãn ngay trên thanh progress gốc của trình phát (thanh này giờ luôn hiện, không còn tự ẩn khi rê chuột), khớp đúng vị trí thời gian và vẫn tua được như cũ.
- **Tự sáng event khi playhead đi qua** — khi chạy tới event nào thì dòng event đó (và vạch tương ứng) sáng lên; hai event trùng thời điểm sẽ cùng sáng.

## v0.4.22
- **Inventory: nhớ bộ lọc & từ khoá tìm kiếm khi đổi tab** — trước đây chuyển Inventory → Workspace → Inventory là mất sạch lựa chọn lọc và ô tìm kiếm. Nay toàn bộ trạng thái lọc (nhóm, loại, version, người, tag, các chip) cùng từ khoá search được giữ lại (qua cả lần mở app sau).
- **Inventory: bộ lọc "Trạng thái" độc lập với nhóm** — thêm hàng chip lọc theo trạng thái (**Chưa export / Chưa scan / Cần kiểm tra / Đã clean**) dùng được cùng lúc với bất kỳ cách nhóm nào — ví dụ nhóm "Theo loại" + chip `pet` + lọc "Chưa export". Chọn nhiều chip = OR. Khi đang nhóm "Theo trạng thái" thì hàng này tự ẩn cho khỏi trùng.
- **Inventory (chế độ Bảng): bỏ icon `.spine` lặp ở mỗi dòng** — icon đã có sẵn ở tiêu đề cột nên gỡ khỏi từng dòng cho gọn; vẫn giữ cảnh báo khi file `.spine` quá nặng.

## v0.4.21
- **Icon riêng cho từng loại stat** — file `.spine`, ảnh, animation và skin giờ mỗi loại có icon riêng, dùng nhất quán ở mọi nơi hiển thị số liệu: thẻ Thống kê, tiêu đề cột bảng, thẻ Lưới, và panel mở rộng anim/skin.
- **Inventory: thêm nhóm/lọc "Chưa export"** — trong group "Theo trạng thái" có thêm nhóm **Chưa export** cho các file chưa export (trước đây gộp chung vào "Chưa scan"). Bấm chip để lọc nhanh đúng nhóm này.

## v0.4.20
- **Sửa thumbnail bị trống ở một số file** — trình tạo thumbnail trước đây chụp skin mặc định `default`, mà nhiều rig để skin này rỗng ảnh (đồ thật nằm ở `skin_default`) nên ra thẻ trắng. Nay ưu tiên `skin_default` → `default` → skin đầu tiên (giống khung xem trước), và tự tạo lại toàn bộ thumbnail cũ.
- **Sửa lỗi xem trước báo "Region not found in atlas" với tên méo** — file `.skel` 3.8 đôi khi bị nhận nhầm là 4.x rồi nạp sai runtime, làm lệch dữ liệu và hỏng tên vùng ảnh. Nay nhận diện phiên bản từ header của file nên nạp đúng runtime.
- **Inventory: dọn lại phần đầu bảng** — thứ tự Thống kê → Bộ lọc → Tìm kiếm; khi thu gọn, thẻ Thống kê vẫn hiện nhanh số liệu chính (tổng / đã clean / cần kiểm tra) và thẻ Bộ lọc vẫn cho đổi nhóm + chế độ Bảng/Lưới ngay trên tiêu đề; ô tìm kiếm thẳng hàng với các thẻ và đưa icon kính lúp vào trong ô.
- **Menu `⋯` của file/thư mục không còn bị cắt** — menu giờ nổi đè lên mọi thành phần (kể cả thanh dưới cùng) và tự lật lên khi ở sát đáy, thay vì bị khung danh sách che mất.
- **Đồng bộ trạng thái dọn thư viện theo thời gian thực giữa các máy** — clean-state cập nhật qua lại giữa các máy mà không cần quét lại thủ công.

## v0.4.19
- **Workspace: thêm cơ chế output "Folder export cạnh file"** — mỗi file `.spine` xuất vào thư mục `export` (tự tạo) nằm ngay trong thư mục chứa file đó, không cần chọn output root.
- **Inventory: nút "Quick export" trong menu từng dòng** — bấm `⋯` ở dòng file (xuất đúng file đó) hoặc dòng thư mục (xuất cả nhóm) để export ngay bằng preset + output đang chọn ở tab Workspace, khỏi phải tạo session.
- **Inventory: giãn khoảng cách các dòng bộ lọc** cho dễ nhìn hơn.

## v0.4.18
- **Inventory: thu gọn được cụm Thống kê & Bộ lọc** — hai cụm này giờ là thẻ gập/mở (đồng bộ với tab Cài đặt) để nhường chỗ cho danh sách; trạng thái gập được nhớ cho lần mở sau. Khi đang lọc, thẻ "Bộ lọc" hiện số bộ lọc đang bật ngay cả lúc đã gập.
- **Bớt thông báo "Đã scan" khi tự quét lại** — các lần quét lại tự động (theo dõi Drive/ổ đĩa, hoặc sau khi dọn ảnh) không còn bật thông báo "Đã scan N file" nữa; chỉ khi bấm nút Quét lại thủ công mới hiện. Đồng thời bỏ qua thay đổi trong thư mục backup ảnh đã dọn nên không báo nhầm.

## v0.4.17
- **Tự phát hiện thay đổi trên Drive — không cần bấm "Tải dữ liệu Drive"** — khi đang mở tab Thư viện, app tự dò Drive vài giây một lần: ai sửa / đổi tên / thêm / xoá file `.spine`, cập nhật ảnh nguồn (kể cả trong thư mục con như `images/skin_default`), hay export lại đều được nhận diện và tự cập nhật lên bảng. Vẫn giữ nút "Tải dữ liệu Drive" để tải lại toàn bộ khi cần.
- **Chuông thông báo "ai vừa làm gì"** — thêm icon chuông ở thanh tiêu đề (luôn thấy ở mọi tab) báo từng thay đổi kèm thư mục, ví dụ "Cường vừa sửa `9901.spine` ở `[…\9901]`" hay "vừa thêm 8 ảnh ở `[…]`"; thay đổi hàng loạt được gộp lại cho gọn. Lưu 20 thông báo gần nhất, bấm vào để xem.

## v0.4.16
- **Inventory: nhóm "Theo trạng thái"** — thêm lựa chọn nhóm thứ ba (cạnh "Theo loại" / "Theo ID") để gom file theo trạng thái dọn ảnh: **Chưa scan → Cần kiểm tra → Đã clean**. Bấm chip một trạng thái để lọc nhanh đúng nhóm đó.
- **Sửa filter "Hiện ghi chú đã xử lý"** — trước đây bật/tắt ở thanh lọc gần như không thấy tác dụng (chỉ ảnh hưởng bên trong popup, mà popup lại che thanh lọc). Nay nút này là **bộ lọc thật**: khi bật, file/thư mục dù ghi chú đã xử lý hết vẫn hiện số đếm + tô sáng để nổi lên trong danh sách. Đồng thời thêm **nút bật/tắt ngay trong popup ghi chú** (đồng bộ với nút ở thanh lọc) nên xem được ghi chú đã xử lý ngay tại chỗ.
- **Chế độ Lưới: icon dẫn nghĩa trên thẻ** — thêm icon người cạnh tên người phụ trách và icon đồng hồ cạnh thời gian sửa cuối, dễ phân biệt hai dòng ở chân thẻ.

## v0.4.15
- **Sửa "Tải dữ liệu Drive" treo & trả rỗng trên thư viện lớn** — với thư viện nhiều file (vài trăm `.spine`), nút Tải dữ liệu Drive trước đây có thể chạy 5–10 phút rồi im lặng không ra kết quả (mục "Lần tải Drive" trống). Nay mỗi yêu cầu có giới hạn thời gian nên một kết nối bị treo không còn làm kẹt cả lượt tải; các file được tra song song nên nhanh hơn nhiều (vài chục giây thay vì nhiều phút); nút hiện tiến độ N/tổng trong lúc tải thay vì chỉ quay vòng im lặng.
- **Tự thử lại khi Google giới hạn tốc độ** — gặp lỗi rate-limit (429/403) sẽ tự chờ rồi thử lại (chờ tăng dần) theo khuyến nghị của Google, thay vì để file đó lỗi luôn.
- **Nhớ dữ liệu Drive giữa các lần mở app** — lần tải sau dùng lại thông tin đã tra trước đó nên nhanh hơn hẳn và đỡ tốn hạn mức Google; tự làm mới khi file/thư mục trên Drive bị đổi.

## v0.4.14
- **Sửa đồng bộ thư viện** — không còn đẩy trạng thái dọn thư viện rỗng lên cloud khi máy chưa có dữ liệu local, tránh xoá nhầm clean-state của nhóm.
- **Sửa quy trình release** — bản `v0.4.13` đã bị bỏ qua vì artifact vẫn mang version app `0.4.12`, khiến auto-updater không nhận là bản mới. `v0.4.14` bump đúng version app/installer/updater manifest và thay thế `v0.4.13`.

## v0.4.12
- **Ghi chú cho file & thư mục trong Thư viện** — để lại nhiều ghi chú (kèm người viết + thời gian) cho từng file hoặc cả thư mục; file/thư mục có ghi chú chưa xử lý được tô sáng và hiện số đếm. Mỗi ghi chú **đánh dấu đã xử lý** (làm mờ) hoặc xoá (tác giả của ghi chú, hoặc trưởng nhóm); có nút bật/tắt hiện ghi chú đã xử lý. Ô nhập tự nối tiếp danh sách: gõ `1.` hay `- ` rồi Enter sẽ tự thêm dòng kế. Ghi chú dùng chung cả nhóm qua Drive (offline vẫn ghi được, nối mạng tự đồng bộ).

## v0.4.11
- **Xem trước Spine: thêm điều khiển khung nhìn** — phóng to/thu nhỏ bằng nút hoặc lăn chuột, **giữ chuột phải để kéo di chuyển** (con trỏ thành bàn tay), nút đưa khung hình về mặc định, nút phóng to toàn màn hình, và kéo giãn được kích thước cửa sổ (nhớ lại cho lần sau). Góc khung hiện thêm FPS và thời lượng animation.
- **Tự chọn skin/animation khi xem trước** — ưu tiên skin `skin_default` (không có thì `default`) và animation `idle` nếu có.

## v0.4.10
- **Bảo vệ dữ liệu đồng bộ** — workspace và danh sách thư viện giờ được lưu an toàn hơn: không ai xoá được dữ liệu của người khác, lỡ tay vẫn khôi phục lại được, và mất mạng vẫn làm việc bình thường (nối mạng lại tự đồng bộ). File `.spine` gốc vẫn nằm trên Google Drive như cũ. Lưu ý: giờ cần đăng nhập Google để đồng bộ; ai đã đăng nhập từ trước có thể cần đăng nhập lại một lần.
- **Quyền quản lý thư viện** — chỉ trưởng nhóm mới thêm/xoá được thư viện trong danh sách chung; các thành viên khác xem và dùng danh sách đó (không còn nút thêm/xoá), tránh sửa nhầm danh sách của cả nhóm.
- **Ảnh xem trước (thumbnail) dùng chung qua đám mây** — thumbnail giờ được chia sẻ qua dịch vụ lưu trữ đám mây thay vì thư mục Drive: máy khác mở lên là thấy ngay không phải dựng lại, và xem được cả khi chưa kết nối ổ Drive chung.

## v0.4.9
- **Tab "Dọn ảnh": hiệu ứng khi đang quét/dọn** — hiện lớp phủ chuyển động và chặn thao tác trong lúc quét hoặc dọn ảnh (giống tab Inventory), tránh bấm nhầm giữa chừng.
- **Tách dữ liệu bản dev và bản chính thức** — bản chạy thử (`tauri dev`) ghi vào thư mục `spine_app_data\dev` riêng, không đụng dữ liệu thật của nhóm (vẫn cùng tài khoản Google); thanh tiêu đề hiện nhãn "dev" để khỏi nhầm.
- **Lọc theo người dùng ở "Used by"** — thêm hàng chip "Người dùng": chọn một/nhiều người (người phụ trách đặt tay hoặc tên Google Drive) để lọc nhanh file theo người. Tên Drive hiện sau khi bấm "Tải dữ liệu Drive".
- **Báo trạng thái đồng bộ rõ hơn** — khi đang lưu/đang đồng bộ, hiện một dòng trạng thái nhỏ ngay dưới nút tài khoản (tự ẩn khi đã đồng bộ xong — trạng thái bình thường vẫn gọn). Khi mở app mà có bản mới hơn từ máy khác, app báo "Đang tải workspace mới nhất…" trước khi tự refresh, không còn bị giật mình.

## v0.4.8
- **Đồng bộ kiểu mới: workspace riêng theo người, thư viện dùng chung** — không còn chọn thư mục sync (app tự dùng `Shared drives\Pamvis\spine_app_data`). Mỗi người đăng nhập Google Drive có workspace (project/session) riêng theo email, không đè nhau; còn danh sách thư viện + tag/người phụ trách + thumbnail thì cả nhóm dùng chung. Chưa đăng nhập thì vẫn xem được thư viện chung, chỉ workspace cần đăng nhập để đồng bộ.
- **Thumbnail xem trước dùng chung qua Google Drive** — ảnh skeleton giờ lưu vào thư mục dữ liệu chung `Shared drives\Pamvis\spine_app_data\thumbs` (app tự dò đúng ổ Drive trên từng máy) thay vì cache riêng từng máy; nên máy khác trong nhóm mở lên là thấy ngay, không phải render lại.
- **Cảnh báo khi không thấy ổ dữ liệu chung** — nếu máy chưa mount được `Shared drives\Pamvis`, tab Thư viện hiện banner báo dữ liệu chung sẽ không đồng bộ (lúc đó thumbnail tạm lưu cache cục bộ).

## v0.4.7
- **Thẻ ở chế độ Lưới hiện ảnh xem trước thật** — mỗi thẻ render thumbnail skeleton (skin/animation mặc định) ngay trên đầu thẻ, chỉ dựng khi thẻ cuộn vào tầm nhìn và lưu lại vào cache nên mở lại app không phải dựng lại; file chưa export vẫn hiện icon như cũ. Nút xem trước (👁) chuyển lên góc thumbnail.
- **Tinh chỉnh giao diện Inventory** — thẻ thống kê gọn hơn, vùng tìm kiếm/bộ lọc và nút "Tạo project" có nền tách khỏi danh sách để dành thêm chỗ cho list; nút chuyển Theo thư mục / Theo ID và Bảng / Lưới đổi sang màu xanh chủ đạo (thay xanh lá), chip lọc nhỏ gọn hơn, thẻ ở chế độ Lưới nổi nhẹ khi rê chuột.
- **Gộp chỉ báo đồng bộ vào nút tài khoản** — chấm trạng thái sync (xám/vàng/xanh/đỏ) giờ nằm ngay trên nút tài khoản ở góc dưới sidebar thay vì ở thanh tiêu đề; bấm vẫn mở Settings ▸ Sync.

## v0.4.6
- **Thư viện: thêm chế độ xem dạng lưới thẻ** — nút chuyển **Bảng / Lưới** ở tab Inventory; mỗi unit hiện thành một thẻ (tên, version, dung lượng, "dùng bởi", tag, người phụ trách, preview, menu). Lựa chọn được nhớ qua các lần mở app; ở chế độ Lưới có thêm ô sắp xếp riêng.
- **Gộp tab "Phiên bản" vào Inventory** — thay bằng chip lọc **"Lệch version"** (chỉ hiện khi có folder lẫn version editor), bớt một tab mà vẫn giữ chức năng.
- **Đổi tên tab "Ảnh thừa" → "Dọn ảnh"** và bỏ tab "Coverage" chưa dùng.
- **Sidebar Thư viện thêm icon thư mục** cho đồng bộ giao diện với Workspace.

## v0.4.5
- **Thư viện: xem trước skeleton ngay trong app** — mỗi file đã export có nút 👁 ở cột riêng; bấm để mở cửa sổ preview render skeleton thật (trình phát của Spine), chọn **animation** và **skin** để xem chuyển động. Hỗ trợ cả file bản 3.8 lẫn 4.x.
- **Cửa sổ mặc định rộng hơn ~50%** để có thêm chỗ cho bảng Thư viện.
- **Bấm nút Sync hoặc nút tài khoản** giờ mở Settings và mở sẵn mục **Sync** (trước đây mục này bị thu gọn).

## v0.4.4
- **Thư viện: "Dùng bởi N project"** — mỗi file `.spine` cho biết đang được session/project nào dùng (rê chuột xem danh sách, bấm để nhảy tới session), kèm bộ lọc **"Chỉ file chưa dùng"** để tìm asset mồ côi cần dọn.
- **Thư viện: gắn tag & người phụ trách** — gắn tag tự do (vd `boss`, `cần review`, `wip`) và đặt người phụ trách cho từng file; lọc nhanh theo tag. Người phụ trách mặc định lấy từ Google Drive, có thể sửa tay. Tag/người phụ trách được đồng bộ qua Drive nên máy khác / đồng đội đều thấy.
- **Panel Người sửa & lịch sử có nút đóng (✕)** để thu gọn nhanh ngay tại chỗ.
- **Cột bảng Thư viện cân đối lại** cho cột File rộng hơn (đủ chỗ hiện tên file + nhãn "dùng bởi"); thêm dòng **"Tải Drive lần cuối"** dưới "Lần quét cuối".

## v0.4.3
- **Thư viện: tìm theo animation / skin** — gõ tên một animation hay skin để lọc ra mọi file `.spine` chứa nó. Dùng `anim:attack` hoặc `skin:red` để tìm đúng loại; tên khớp được tô sáng ngay trong danh sách. Đọc được cả với export **binary** (`.skel.bytes` kiểu Unity, bản 3.8) — trước đây các file này không liệt kê được anim/skin.
- **Thư viện: tab "Phiên bản"** — gom các nhóm đang lẫn lộn phiên bản editor (vd cùng nhân vật có file 3.8 lẫn 4.3) vào một chỗ, kèm bộ lọc "chỉ hiện file lệch version" để xử lý đồng bộ nhanh.
- **Double-click thanh tiêu đề** để phóng to / thu gọn cửa sổ.
- **Bảng Thư viện gọn hơn**: tên file luôn hiện đầy đủ (chỉ rút gọn phần thư mục), cột Sửa lần cuối / thao tác thu lại nhường chỗ cho cột tên; sửa các khe hở khi cuộn và canh thẳng nút theo cột.

## v0.4.2
- **Thư viện: dữ liệu "Tải dữ liệu Drive" (Người sửa / Sửa lần cuối) giờ được lưu lại và đồng bộ qua Google Drive** — mở lại app, hay mở ở máy khác cùng Shared drive, đều thấy ngay mà không phải tải lại; bấm "Tải dữ liệu Drive" để cập nhật.

## v0.4.1
- **Sửa: đăng nhập Google Drive bị mất sau khi thoát app** — giờ token được lưu vào Windows Credential Manager nên mở lại app vẫn còn đăng nhập, không phải đăng nhập lại.

## v0.4.0
- **Thư viện: người sửa, lịch sử & version file spine từ Google Drive (Tier B)**: đăng nhập Google ngay ở badge góc dưới trái (hoặc Settings ▸ Sync). Mỗi dòng có menu **⋯** mở panel lịch sử để xem người sửa cuối, thời gian và các phiên bản trước — bấm một version để **mở bản cũ đó trong Spine** (so sánh khi animation bị hỏng). Nút **Tải dữ liệu Drive** thêm 2 cột **Người sửa / Sửa lần cuối** (sort được, tô nổi file đổi trong 7 ngày). Chỉ đọc, không đụng tới file trên Drive.
- **Gom nút thao tác mỗi dòng Thư viện vào menu ⋯** (hiện khi rê chuột) cho gọn.
- **Ngày tháng hiển thị thống nhất dạng dd/mm/yyyy** trên toàn app.

## v0.3.9
- **Sửa lỗi đồng bộ Google Drive không chạy**: chọn nhầm cấp `G:\Shared drives` (thư mục ảo, không ghi được) làm sync báo lỗi. Giờ app tự chọn một shared drive ghi được; đường dẫn vẫn khớp đúng giữa các máy. Bản cũ đã lỡ chọn cấp ảo sẽ tự sửa khi mở lại.

## v0.3.8
- **Đồng bộ qua Google Drive**: làm ở công ty rồi về nhà mở app là có sẵn toàn bộ project/session/cấu hình, không phải set-up lại. Bật trong Settings ▸ Sync — app tự dò thư mục Shared drives, trạng thái hiện ở góc trên (xanh = đã đồng bộ). Đường dẫn tự khớp đúng dù ổ đĩa khác nhau giữa các máy.
- **Preset mặc định giờ là binary + pack** (thay cho JSON).
- **Sửa lỗi Thư viện**: dòng cuộn không còn đè lên tiêu đề cột.

## v0.3.7
- **Thư viện asset Spine (Asset Library) — lớp quản lý asset offline ngoài luồng export**: bổ sung một chế độ mới bên cạnh workspace export. Import một "master folder", app quét toàn bộ `.spine` thành một **inventory**, đọc version editor **offline** (parse trực tiếp file `.spine`, không cần Spine CLi), phân loại theo phiên bản (3.x/4.x) và cảnh báo các trường hợp đáng chú ý (folder ảnh nặng, file `.spine` nặng, lẫn lộn version). Giao diện chia hai tab **Inventory** và **Clean** với mode toggle ở cấp cao nhất, bộ lọc chip dùng chung (loại / dải ID / version, chọn nhiều), nhóm thu gọn được, sidebar kéo giãn được. Tab Clean theo dõi trạng thái dọn theo từng entry (hiện hành / cần xem lại / chưa rõ), mở rộng mỗi folder thành lưới thumbnail ảnh **thừa (đỏ)** và **đang dùng (xanh)** — thumbnail tải lười (giới hạn 8 luồng, cache khi đóng/mở lại). Thêm hành động **mở file trong Spine** (dò Spine.com→.exe) và **mở folder chứa**. Backend thêm `library::scan_library`, `spine_project::read_editor_version`, `system::open_in_spine`, tái dùng `discover_clean_units` + `collect_images` qua `concurrent::run_indexed`. Ngưỡng cảnh báo cấu hình được trong Settings; kèm chuỗi i18n vi/en và test cho helper `library.ts`.
- **Đổi font UI sang IBM Plex Sans/Mono (self-host)**: thay Inter bằng **IBM Plex Sans** (UI) và **IBM Plex Mono** (mono/đường dẫn), tự đóng gói các subset latin + latin-ext + vietnamese trong app (vẫn offline, không ping mạng). Cải thiện a11y cho toast (vùng `aria-live`), kèm `IBMPlex-LICENSE.txt`.

## v0.3.6
- **Chuyển CI/CD từ GitLab sang GitHub Actions**: repo đã dời từ GitLab sang GitHub, nên toàn bộ quy trình phát hành được viết lại. Pipeline cũ (`.gitlab-ci.yml`, ~180 dòng PowerShell tự upload Generic Package Registry + gọi Release API + workaround UTF-8/Latin-1) được thay bằng một workflow gọn dùng `tauri-apps/tauri-action` chạy trên runner `windows-latest`: push tag `v*.*.*` là tự build installer NSIS, tạo GitHub Release và đính kèm installer, chữ ký `.sig`, cùng `latest.json` cho auto-updater. Endpoint auto-updater (`tauri.conf.json`) và link "phiên bản/changelog" trong app đổi sang GitHub Releases; `SECURITY.md` đổi kênh báo lỗ hổng sang GitHub. Không đổi hành vi nhìn thấy được của app (ngoài việc bản cập nhật giờ lấy từ GitHub). README cũng tách thành hai phần song ngữ Anh/Việt.

## v0.3.5
- **Đổi font UI sang Inter + self-host (bỏ phụ thuộc Google Fonts, siết CSP)**: trước đây font Be Vietnam Pro tải từ `fonts.googleapis.com` mỗi lần mở app — là dependency mạng duy nhất, gây nhấp nháy font (FOUT) và buộc CSP phải mở 2 domain Google. Bản này đóng gói font ngay trong app: chuyển sang **Inter** (variable, 100–900, có sẵn dấu tiếng Việt) tải về `src/assets/fonts/InterVariable.woff2` + `@font-face` local, nên app chạy **offline**, không ping Google, không FOUT. Nhờ đó CSP siết tiếp về `font-src 'self'` và `style-src 'self' 'unsafe-inline'` (gỡ `fonts.googleapis.com`/`fonts.gstatic.com`). Font dùng chung cho cả mode tiếng Anh lẫn tiếng Việt như trước. Kèm `Inter-LICENSE.txt` (SIL OFL 1.1) theo yêu cầu license của font.

## v0.3.4
- **Bảo mật: bật Content-Security-Policy + thêm LICENSE và SECURITY.md (chuẩn bị public repo)**: trước đây `app.security.csp` để `null` (tắt hoàn toàn CSP). Vì app có các lệnh ghi/xoá file trên đường dẫn tuỳ ý (`write_text_file`, `clean_source_folders`, `move_unused_images`), một XSS trong webview — nếu sau này lỡ render nội dung không tin cậy — sẽ gọi được thẳng các lệnh đó. Bản này khoá CSP về `default-src 'self'` và chỉ mở đúng những gì app cần: `data:`/`blob:`/`asset:` cho thumbnail ảnh, `'unsafe-inline'` style + `fonts.googleapis.com`/`fonts.gstatic.com` cho font Be Vietnam Pro, `ipc:`/`asset.localhost` cho cầu IPC của Tauri; chặn `object-src`, `base-uri`, `frame-ancestors`. Không đổi hành vi nhìn thấy được. Đồng thời thêm `LICENSE` (MIT) + khai báo `license` trong `package.json`/`Cargo.toml`, và `SECURITY.md` (báo lỗ hổng riêng qua email) để repo đủ chuẩn trước khi chuyển sang public.

## v0.3.3
- **Tái cấu trúc backend — tách `lib.rs` thành các module theo nhóm (không đổi hành vi)**: bước cuối của chuỗi dọn nợ v0.3.x. `src-tauri/src/lib.rs` (command hub ~2780 dòng, lâu nay được miễn trừ khỏi guard kích thước) được chẻ thành: `model.rs` (toàn bộ kiểu dữ liệu dùng chung), `util.rs` (helper lá: dò Spine/parse version, predicate path, temp-dir cho Unicode workaround, process), `export.rs` (engine export một file + dựng plan + lệnh dò trùng output), `clean.rs` (quét/dọn ảnh thừa + lệnh liên quan), và `tests.rs` (toàn bộ unit/property test). `lib.rs` còn **449 dòng** — chỉ còn các lệnh nhỏ + `run()`; và đã **gỡ luôn miễn trừ guard** (giờ mọi file Rust đều nằm dưới trần 800). Không thay đổi gì nhìn thấy được với người dùng; `cargo test` 58 + clippy (không warning mới) + frontend 26 + build xanh.

## v0.3.2
- **Tái cấu trúc frontend — tách file i18n + 2 modal lớn (không đổi hành vi)**: tiếp tục dọn nợ v0.3.x ở phía giao diện, không thêm/đổi tính năng nào nhìn thấy được. (1) `i18n.ts` (727 dòng, gần trần 800) tách thành `i18n/{vi,en,types,index}.ts` — mỗi locale một file; `en` giờ được TypeScript bắt buộc khớp đúng tập key của `vi` nên hai ngôn ngữ không thể lệch nhau âm thầm. (2) `CleanSourceFolderModal` (467→318 dòng) tách phần chọn folder, bảng kết quả và overlay đang-quét ra các component con (`cleanSource/`). (3) `PresetEditorModal` (376→117 dòng) tách toàn bộ tab biểu mẫu ra `preset/PresetFormTab`. API import của i18n giữ nguyên (`./i18n`); toàn bộ test (`cargo test` 58, frontend 26) + build + file-size guard vẫn xanh.

## v0.3.1
- **Tái cấu trúc backend — gom code lặp (không đổi hành vi)**: tiếp nối chuỗi dọn nợ v0.3.x, bản này gom các đoạn lặp đi lặp lại trong backend Rust thành module dùng chung, không thêm/đổi tính năng nào nhìn thấy được. (1) `paths.rs` — gom các helper xử lý đường dẫn (bỏ dấu nháy quanh path do kéo-thả/dán để lại, `Path`→`String`, kiểm tra non-ASCII, chuẩn hoá `packSource`) vốn nằm rải rác + lặp `trim_matches('"')` ở ~24 chỗ. (2) `error.rs` — trait `ResultExt` (`.str_err()` / `.context(...)`) thay cho ~40 lần lặp `.map_err(|e| e.to_string())` / `.map_err(|e| format!("…: {e}"))`. (3) `concurrent.rs` — bộ lập lịch song song dùng chung (`run_indexed`: semaphore giới hạn job + đếm tiến độ theo thứ tự hoàn thành + tôn trọng nút Stop) cho cả export hàng loạt lẫn quét Clean Source, vốn trước đây chép gần như y hệt ở hai nơi. Toàn bộ test (`cargo test` 58, frontend 26) + build vẫn xanh.

## v0.3.0
- **Tái cấu trúc nội bộ — tách "god-hook" `useAppController` (không đổi hành vi)**: hook điều khiển trung tâm đã phình tới ~1690 dòng (vượt xa trần 800 của file-size guard). Bản này tách nó theo domain thành các hook riêng — `useWorkspace` (dự án/session + runtime + vòng đời), `useScanInput` (quét input + danh sách file), `useExportEngine` (export đơn/hàng loạt + overlay + log/output), `useSpineDetection`, `useLinkedProjects` — cùng module helper thuần `controllerHelpers`. `useAppController` giờ chỉ compose các hook và giữ nguyên context API, còn **636 dòng** (lọt trần mặc định; đã gỡ baseline grandfather). Không có thay đổi nào nhìn thấy được với người dùng; toàn bộ test (`cargo test`, 26 test frontend) + build vẫn xanh. Mở màn cho chuỗi refactor v0.3.x.

## v0.2.27
- **Sửa: file đã loại khỏi export vẫn bị tính trùng (badge vẫn sáng)**: phần dò overlap chỉ lọc `excludedFiles` ở nhánh quét-folder, nên khi danh sách file lấy từ cache runtime (session đang mở) hoặc từ `inputFiles` thì file đã chuyển sang "không export" vẫn lọt vào → badge cảnh báo vẫn hiện oan. Giờ `excludedFiles` được lọc cho **mọi nguồn** file trước khi tính trùng.
- **Icon ⚠️ ngay cạnh từng file `.spine` bị trùng cross-session trong section Input**: thay vì chỉ có badge ở cấp session, mỗi dòng file giờ hiện icon hổ phách nếu file đó cũng nằm ở session khác **trong cùng dự án**, tooltip nêu rõ tên (các) session kia ("Cũng được dùng ở: …"). Giúp pinpoint đúng file để loại, thay vì phải tự dò. (Trùng output folder vẫn để ở badge session vì nó là cấp thư mục, không quy về 1 file.)

## v0.2.26
- **Sửa build CI hỏng ở v0.2.25 (file-size guard)**: phần tính status + overlap làm `useAppController.tsx` và `styles.css` vượt trần dòng. Tách logic resolve file/output + dò overlap ra module riêng `src/sessionStatus.ts` (`computeSessionStatuses`), và chuyển CSS badge sang `src/components/Sidebar.css`. Không đổi hành vi — chỉ tách module cho gọn; v0.2.25 không ra được artifact nên gộp tính năng badge vào bản này.

## v0.2.25
- **Badge cảnh báo trùng lặp ngay trên danh sách session** (tiếp nối v0.2.24): thay vì chỉ báo lúc bấm Export all, mỗi session row giờ hiện badge ⚠️ khi phát hiện trùng với session khác **trong cùng dự án**, ở hai mức: **vàng** = dùng chung file `.spine` (chú ý — có thể cố ý), **đỏ** = ghi ra cùng folder đích (nguy hiểm, Export all sẽ đè nhau). Việc dò trùng tận dụng `refreshSessionStatuses` (vốn đã quét tất cả session để tính chấm trạng thái), gọi thêm `resolve_output_dirs` mỗi phiên và đối chiếu input/output trong phạm vi từng dự án. Tooltip giải thích rõ từng mức.

## v0.2.24
- **Export-all cảnh báo khi nhiều session ghi trùng folder đích**: khi cùng một file `.spine` (hoặc nhiều session) resolve ra **cùng một thư mục output** trong cùng một lần Export all, phiên chạy sau sẽ âm thầm đè kết quả của phiên trước. Trước đây không có cảnh báo nào vì kiểm tra ghi đè cũ chỉ soi các folder **đã tồn tại sẵn trên đĩa** — bỏ sót trường hợp folder chưa tồn tại nhưng hai phiên cùng nhắm tới. Giờ hộp xác nhận Export all báo rõ "{count} folder bị {n} phiên ghi trùng" để user kiểm tra lại trước khi chạy. Thêm command `resolve_output_dirs` (trả về mọi output dir đã resolve, kể cả chưa tồn tại) để frontend so trùng giữa các phiên.
- **Nút bấm có hiệu ứng hover/active mượt hơn**: thêm transition + nhấc nhẹ khi hover (`translateY(-1px)`) và đổ bóng cho nút chính, cho cả primary/secondary/ghost/icon button.

## v0.2.23
- **Icon + màu nút "Chuyển ảnh thừa → backup" hợp lý hơn**: đổi từ icon thùng rác (gây hiểu là xoá) sang icon hộp lưu trữ, và từ màu đỏ (danger) sang màu hổ phách (warning) ở cả nút từng folder lẫn nút tổng — thao tác này chuyển ảnh vào `_unused_backup` và **khôi phục được**, không phải xoá vĩnh viễn.
- **Popup "Đang quét" chi tiết hơn**: hiện danh sách từng folder kèm trạng thái cập nhật trực tiếp (✓ đã quét xong / ○ đang chờ) và % tiến độ bên cạnh số đếm, thay vì chỉ một dòng tên file.
- **Input path rỗng có gợi ý nhẹ**: khi để trống/xoá đường dẫn giờ hiện gợi ý xanh "Nhập đường dẫn hoặc chọn folder/file để bắt đầu" thay vì im lặng — vẫn **không** báo đỏ oan (đỏ chỉ dành cho path đã quét mà ra 0 file).
- **Thumbnail trong popup chi tiết folder hiện trạng thái đang tải**: ảnh chưa tải xong hiện hiệu ứng skeleton nhấp nháy thay vì ô xám trống, phân biệt rõ "đang tải" với "tải lỗi".

## v0.2.22
- **Sửa lỗi nghiêm trọng của parallel jobs làm hỏng export hàng loạt**: khi chạy nhiều job song song, các job được lập kế hoạch trong cùng một mili-giây/cùng tiến trình dùng chung **một file settings tạm** (tên chỉ gồm timestamp + PID), nên job xong đầu tiên xóa file đó khiến các job còn lại chết với `Export settings JSON file does not exist`. Giờ mỗi job có file tạm riêng (thêm bộ đếm tăng dần), export song song chạy đúng. Lỗi chỉ xuất hiện khi parallel > 1; chạy tuần tự không bị.
- **Popup "Đang xử lý" hiển thị rõ từng job đang chạy + đồng hồ**: thêm danh sách các file đang export song song (mỗi dòng có spinner và thời gian riêng), cùng tổng thời gian đã chạy của cả lần export. Khi Export-all, đồng hồ tổng tính cho cả batch.
- **Cụm Input path xử lý sửa/xoá path an toàn hơn**: chỉnh đường dẫn sẽ xoá ngay danh sách file đã quét (trước đây list cũ vẫn nằm đó và có thể bị export theo path cũ); danh sách file đã loại trừ tự lọc theo path mới (đổi thư mục thì bỏ, thu/mở rộng cùng cây thì giữ). Border đỏ giờ tách 2 trạng thái: đã quét đúng path mà ra 0 file → đỏ + cảnh báo; vừa sửa chưa quét lại → chỉ gợi ý "bấm Scan", không báo đỏ oan.
- **Dashboard thống kê thời gian export mỗi session**: thêm cột "Thời gian" cho từng lần chạy và tổng ở chân bảng (định dạng gọn: `45s`, `1m 23s`, `1h 02m`). Bản ghi cũ chưa có dữ liệu thời gian hiển thị "—".
- Nội bộ: tách `buildExportRequestFrom`/`resolveLinkedTarget` ra `src/exportRequest.ts` và chuyển CSS overlay sang `components/RunOverlay.css` để các file chính nằm dưới trần kích thước; thêm `builds/` vào `.gitignore`.

## v0.2.21
- **Modal "Clean unused source images" giờ bỏ tick sẵn đúng các file đã loại khỏi danh sách export của session**: trước đây mọi `.spine` con đều hiện tick xanh kể cả file đã bị ẩn/loại khỏi export, nhưng backend vẫn âm thầm bỏ qua chúng — UI và kết quả quét lệch nhau, số "đã chọn X/Y" và cảnh báo quét-lớn cũng tính sai. Giờ file đã loại khỏi export được bỏ tick ngay khi mở modal, khớp đúng những gì một lần export của session sẽ xử lý.
- **Picker trong modal trở thành nguồn quyết định duy nhất**: muốn quét một file đã-loại vẫn được — chỉ cần tick lại; trước đây tick lại không có tác dụng vì backend luôn ép loại trừ theo danh sách của session.

## v0.2.20
- **Đổi tên lựa chọn export strategy thứ hai thành "Dùng settings từ từng .spine"** (trước là "Preset nền + min/max từ từng .spine"): tên cũ làm tưởng chỉ đọc kích thước pack, trong khi giờ decoder đọc gần trọn settings (min/max, scale, padding, packing, cleanUp, format...). Mô tả hover cũng cập nhật theo.
- **Cảnh báo rõ khi gặp file `.spine` được save bởi Spine 4.x**: định dạng project 4.x khác 3.8 nên chưa đọc settings được — trước đây file như vậy chỉ hiện lỗi chung chung rồi âm thầm export bằng preset nền, dễ bỏ sót. Giờ log ghi `[WARN]` kèm đúng version (vd "save bởi Spine 4.3.17 — decoder chỉ hỗ trợ format 3.8.x") để biết ngay file nào đang dùng preset nền thay vì settings riêng.
- Lưu ý phân biệt: **export ra target 4.3** (nâng cấp 3.8 → 4.3) vẫn hoạt động bình thường với mode này — cảnh báo trên chỉ dành cho file nguồn vốn đã save bằng editor 4.x.

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
