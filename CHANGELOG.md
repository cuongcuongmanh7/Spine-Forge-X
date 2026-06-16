# Changelog

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
