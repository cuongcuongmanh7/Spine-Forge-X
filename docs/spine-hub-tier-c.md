# Spine Hub — Tier C (plan)

Tầng cuối của lộ trình "Spine Hub" (xem [sync.md](sync.md) cho Tier A/B). Tier A đồng bộ workspace
qua Google Drive; Tier B lấy owner/lịch sử/version qua Drive API. **Tier C biến Library từ "bảng kê
file" thành lớp tri thức** giúp lead/animator trả lời nhanh: *asset này ai phụ trách, đang được
project nào dùng, có animation/skin gì, version có lẫn lộn không, trông ra sao.*

> Trạng thái: **#1 + #2 đã ship ở v0.4.3** (Library search & version). **#3 + #4 đã ship ở v0.4.4.** **#5 đã làm** (preview skeleton thật, xem dưới) — Tier C hoàn tất.

## Nguyên tắc
- **Tận dụng dữ liệu đã có trước.** `scan_library` đã trả mỗi `LibraryEntry` kèm `animations[]`,
  `skins[]`, `version`, `exported`, `spineFile`, `relPath` ([src/config.ts](src/config.ts)). Nhiều
  mục Tier C chỉ là lớp UI/đối chiếu trên dữ liệu sẵn có → rẻ, làm trước.
- **Đồng bộ thì đi qua Tier A.** Dữ liệu người dùng tạo (tags) lưu trong profile để máy khác thấy.
- **Ownership ưu tiên Drive (Tier B)** thay vì bắt nhập tay.

---

## 1. Search theo animation / skin  ✅ Done (v0.4.3)
**Mục tiêu:** gõ tên một animation/skin → ra mọi `.spine` chứa nó (vd "tìm tất cả file có anim `attack`").
**Dữ liệu:** `entry.animations` / `entry.skins` đã có sẵn từ scan (chỉ với file đã export).
**Thiết kế:** mở rộng ô search Library hiện có thành chế độ "tìm trong anim/skin" (toggle hoặc cú pháp
`anim:attack`, `skin:red`); filter `entries` theo khớp tên; highlight chip animation khớp trong panel.
**Việc cần làm:** thêm vị từ match vào [src/library.ts](src/library.ts) (`entryMatchesFilter`), UI chip/route
trong [LibraryInventory.tsx](src/components/LibraryInventory.tsx). Frontend-only.
**Lưu ý:** file chưa export không có anim/skin → cần gợi ý "rescan/export để index".
**Đã làm thêm (v0.4.3):** đọc anim/skin từ export **binary** `.skel.bytes` (3.8) qua `src-tauri/src/skel_binary.rs`
(port reader spine-runtimes 3.8, validate byte-exact trên file thật). Export `.skel` 4.x vẫn chưa đọc được
(layout khác — cần file 4.x thật để reverse).

## 2. Version-mix panel  ✅ Done (v0.4.3)
**Mục tiêu:** một chỗ tổng hợp các nhóm/đơn vị đang **lẫn lộn editor version** (vd cùng nhân vật có
file 3.8 lẫn 4.3) để lead xử lý đồng bộ.
**Hiện trạng:** `groupByFolder` đã tính cờ `mixedVersion` + có badge cảnh báo trong từng nhóm.
**Thiết kế:** panel/tab "Version" liệt kê: phân bố version toàn thư viện (đã có StatCard theo major),
danh sách nhóm `mixedVersion`, và filter nhanh "chỉ hiện file lệch version so với phần còn lại của nhóm".
**Việc cần làm:** tổng hợp sẵn ở [src/library.ts](src/library.ts); thêm view. Frontend-only.

## 3. Used-by-projects  ✅ Done (v0.4.4)
**Mục tiêu:** với mỗi asset, hiện **project/session nào đang dùng nó** (và ngược lại: asset "mồ côi"
không thuộc project nào → ứng viên dọn).
**Dữ liệu:** đối chiếu `entry.spineFile` với `session.config.inputFiles` / `inputPath` của các session
(đã có trong app state). Khớp path đã normalize (`\`→`/`, lowercase) — tái dùng helper của Tier A/clean.
**Thiết kế:** cột/badge "Dùng bởi N project" + tooltip liệt kê; bộ lọc "chưa dùng". Có thể thêm
hành động nhảy tới session.
**Việc cần làm:** hàm thuần `usageByEntry(entries, sessions)`; wire vào controller + UI. Frontend-only.

## 4. Tags / ownership  ✅ Done (v0.4.4)
**Mục tiêu:** gắn **tag** tự do (vd `boss`, `cần-review`, `wip`) và **người phụ trách** cho từng asset
hoặc folder; lọc/nhóm theo tag.
**Ownership:** lấy mặc định từ **Tier B** (người sửa cuối / owner Drive) — không bắt nhập tay; cho phép
override thủ công.
**Persistence:** map `relPath → { tags[], owner? }` lưu trong **profile sync** (Tier A) để máy khác thấy;
thêm vào `SyncProfile` (kèm tokenize nếu cần) — xem [src/sync.ts](src/sync.ts).
**Thiết kế:** chip tag editable trên dòng/nhóm; filter theo tag (mở rộng chip-row sẵn có); cột owner gộp
với dữ liệu Tier B.
**Việc cần làm:** kiểu dữ liệu + lưu/đồng bộ + UI chỉnh tag. Đụng cả sync schema → cần migrate cẩn thận.
**Đã làm (khác plan một chút):** thay vì nhồi vào `SyncProfile`, dùng **sidecar `spineforge-library-meta.json`**
trong sync root, **merge-before-write** (đúng pattern Drive-meta v0.4.2) → không đụng schema sync lõi (an toàn,
không cần migrate) và tránh clobber khi nhiều người sửa đồng thời. Key = `relPath` (machine-independent) nên
team-shared. Helper thuần trong `src/library.ts` (`addTag/removeTag/setOwner/allTags/entryMatchesTags`), state +
IO trong `src/useLibraryTags.ts`; UI tách `LibraryTagCell.tsx` + `LibraryOwnerCell.tsx` (owner thủ công gộp owner
Drive Tier B). Lưu ý hạn chế: 2 library khác nhau có relPath trùng sẽ chia sẻ tag (hiếm).

## 5. Preview skeleton thật  ✅ Done
**Mục tiêu:** xem nhanh asset trông thế nào ngay trong Library.
**Đã làm (khác plan gốc):** bỏ hướng "ảnh đại diện" — ảnh trong `imagesDir` toàn là part lẻ, không nhận
diện được unit. Thay vào đó **render skeleton thật** bằng Spine web player (widget có sẵn dropdown
animation + skin + timeline). Nút **"Preview"** trong panel mở rộng của dòng Inventory → mở **modal riêng**
(`LibrarySpinePreviewModal`). Lazy: chỉ nạp runtime + skeleton khi mở.
- **Backend:** `list_export_assets(folder)` ([library.rs]) quét `export/`·`ex/`, trả skeleton (json/skel) +
  atlas + danh sách page, và **detect version** (json: `skeleton.spine`; skel: thử parser 3.8, fail ⇒ 4.x).
  Command generic `read_file_data_url(path)` ([system.rs]) nạp mọi file thành base64 data URI.
- **Feed local:** player nhận `rawDataURIs` (skeleton/atlas/page → data URI) nên không cần network. CSP
  thêm `data:` vào `connect-src` (XHR data-URI của AssetManager).
- **Hai runtime, khoá theo version:** npm `@esotericsoftware/spine-player@4.3` chỉ có 4.x → **vendor bản
  prebuilt 3.8** vào `public/spine-player-3.8/` (classic script, set global `spine`; xem NOTICE license).
  `useSpinePreview` chọn runtime theo version detect được; cả hai nạp lazy (4.x là dynamic-import chunk riêng).
- **Hạn chế:** chỉ 3.8 và 4.x (4.0–4.3); version 3.8 cần đúng prebuilt 3.8, các minor 4.x khác editor có thể
  lệch → player báo lỗi (hiện message). Một unit nhiều bộ export → lấy bộ đầu.

---

## Thứ tự đề xuất
~~**1 → 2**~~ đã ship ở **v0.4.3** (release "Library search & version"). ~~**3 → 4**~~ đã ship ở **v0.4.4**:
used-by-projects + tags/ownership. ~~**5**~~ đã làm: **preview skeleton thật** (Spine web player, 3.8 vendored
+ 4.x npm) — Tier C hoàn tất.

## Câu hỏi cần chốt
- Tag/owner đồng bộ qua profile (mọi máy thấy) hay machine-local? (đề xuất: đồng bộ).
- "Used-by" tính theo session hiện có, hay cả lịch sử export? (đề xuất: session hiện có).
- Preview: chấp nhận MVP "ảnh đại diện" trước, hay chờ skeleton-render thật?

## Verify (khi làm)
Mỗi mục: thêm test cho hàm thuần (`library.ts` matcher/usage/version-mix) theo mẫu
[src/library.test.ts]; `tsc` + `npm test` + `npm run build` xanh; e2e bằng `npm run tauri dev` trên một
thư viện thật.
