# SpineForge X — Roadmap & Progress

Source-of-truth tiến độ toàn dự án.

**Quy ước:** `[x]` xong · `[ ]` chưa làm · `[~]` đang làm.

---

## v0.2.26 — Tách module để qua file-size guard (build fix cho v0.2.25) ✅ Done

> Bump `0.2.25 → 0.2.26`; tag `v0.2.26`. v0.2.25 fail CI ở `check-file-size`, không ra artifact.

- [x] **`src/sessionStatus.ts`** (`computeSessionStatuses`): gánh phần probe từng session (validate + resolve file-list + `resolve_output_dirs`) và `computeOverlaps` theo dự án. `refreshSessionStatuses` trong `useAppController.tsx` còn là wrapper mỏng → file tụt dưới trần.
- [x] **`src/components/Sidebar.css`**: chuyển style `.session-overlap-badge` khỏi `styles.css` (đang +11 dòng quá trần), import trong `Sidebar.tsx`. Theo tiền lệ `RunOverlay.css`.

## v0.2.25 — Badge cảnh báo trùng lặp inline trên session list ✅ Done

> Bump `0.2.24 → 0.2.25`; tag `v0.2.25`.

**Bối cảnh:** v0.2.24 chỉ cảnh báo lúc Export all (trong dialog xác nhận). User muốn thấy ngay trên UI khi các session dùng chung file/đè output, không phải chờ tới lúc export.

- [x] **`SessionOverlap` type** (`src/config.ts`): `{ sharedInput, outputCollision }`.
- [x] **`refreshSessionStatuses` tính overlap** (`useAppController.tsx`): chuyển từ chỉ đếm file sang resolve cả file-list + `resolve_output_dirs` mỗi phiên; phase 2 dựng `fileOwners`/`dirOwners` **theo từng dự án** (Export all chạy 1 dự án/lần), file/dir có >1 owner → đánh dấu các phiên liên quan. Lưu vào state `sessionOverlaps`, expose qua context.
- [x] **Badge trong Sidebar** (`SessionRow`): icon `AlertTriangle`, `danger` (đỏ, outputCollision) lấn át `warn` (vàng, sharedInput). CSS `.session-overlap-badge.warn/.danger` trong `styles.css`.
- [x] **i18n** `overlapInputBadge` / `overlapOutputBadge` (vi + en).

## v0.2.24 — Export-all: cảnh báo session ghi trùng folder đích ✅ Done

> Bump `0.2.23 → 0.2.24`; tag `v0.2.24`.

**Bối cảnh:** file `.spine` không thuộc độc quyền session nào — cùng file có thể nằm trong nhiều session. Khi Export all, nếu hai session resolve ra cùng output dir, phiên sau đè phiên trước mà không cảnh báo (collision check cũ chỉ soi folder đã tồn tại trên đĩa).

- [x] **Backend `resolve_output_dirs`** (`src-tauri/src/lib.rs`): sibling của `check_output_collisions`, trả về toàn bộ output dir đã resolve bất kể có tồn tại hay chưa. Đăng ký trong `invoke_handler`.
- [x] **Frontend overlap detection** (`exportProjectSessions` trong `useAppController.tsx`): gom `dirOwners: Map<dir, Set<sessionId>>` từ `resolve_output_dirs` mỗi phiên; folder có >1 owner → cảnh báo trong hộp xác nhận Export all (kèm số folder + số phiên liên quan). Giữ nguyên cảnh báo ghi đè folder-đã-tồn-tại.
- [x] **i18n** `sessionOverlapConfirmBody` (vi + en).

## v0.2.23 — UI polish: icon backup, overlay quét, hint input, skeleton thumbnail ✅ Done

> Bump `0.2.22 → 0.2.23`; tag `v0.2.23`.

**Bối cảnh:** gom các món polish UI nhỏ theo phản hồi của user thành một release nhanh, không đổi backend.

- [x] **Icon + màu "Chuyển ảnh thừa → backup"**: `Trash2` → `Archive`, class `danger`/`danger-button` → `warning`/`warning-button` (amber) ở cả 3 nút (`CleanSourceFolderModal` per-row + tổng, `CleanFolderDetailModal`). Thêm style `.warning-button` + `.icon-button.warning` trong `styles.css` (mirror `.danger-button`, màu `#d97706`/`#a36500`).
- [x] **Overlay quét chi tiết**: tận dụng `spine-progress` (emit `file = folder` khi mỗi unit xong) — tích luỹ set `scannedFolders`, render checklist từng folder (✓ done / ○ pending) + `%` cạnh số đếm. CSS `.scan-overlay-list` trong `RunOverlay.css`. Fallback dòng file cũ khi chưa list được units.
- [x] **Hint input rỗng**: thêm `isEmpty` → notice `info` "Nhập đường dẫn…" (không đỏ); border đỏ vẫn chỉ cho `scanCameUpEmpty`. Key `inputEmptyHint` (VI/EN).
- [x] **Skeleton thumbnail**: phân biệt `url === undefined` (đang tải → `.thumb-loading` shimmer, có `prefers-reduced-motion`) với `url === null` (lỗi → `empty-thumb`).
- [x] Verify: `tsc --noEmit` xanh.

---

## v0.2.22 — Sửa parallel-jobs hỏng export hàng loạt + overlay job list + polish input/dashboard ✅ Done

> Bump `0.2.21 → 0.2.22`; tag `v0.2.22`.

**Bối cảnh:** parallel jobs > 1 làm hỏng export hàng loạt do dùng chung file settings tạm; nhân tiện gom thêm vài polish overlay/input/dashboard.

- [x] **Fix temp-file parallel jobs**: mỗi job có file settings tạm riêng (thêm bộ đếm tăng dần) thay vì chỉ timestamp + PID — job xong đầu không còn xoá file của job khác (`Export settings JSON file does not exist`).
- [x] **Overlay "Đang xử lý" liệt kê job**: danh sách file đang export song song (spinner + thời gian riêng từng job) + tổng thời gian cả lần export/batch.
- [x] **Input path an toàn hơn**: sửa path xoá ngay list file đã quét; lọc `excludedFiles` theo path mới; tách border đỏ (`scanCameUpEmpty`) vs hint Scan (`needsRescan`).
- [x] **Dashboard cột thời gian**: thời gian mỗi lần chạy + tổng ở chân bảng (`45s`/`1m 23s`/`1h 02m`); bản ghi cũ hiện "—".
- [x] Nội bộ: tách `buildExportRequestFrom`/`resolveLinkedTarget` ra `src/exportRequest.ts`; CSS overlay → `components/RunOverlay.css`; thêm `builds/` vào `.gitignore`.

---

## v0.2.21 — Clean-unused modal khớp danh sách loại trừ của session ✅ Done

> Bump `0.2.20 → 0.2.21`; tag `v0.2.21`.

**Bối cảnh:** modal "Clean unused source images" tick sẵn mọi `.spine` con, nhưng `mergeExcluded` luôn ép loại trừ theo `excludedFiles` của session → UI (tick xanh, số "đã chọn X/Y", cảnh báo quét-lớn) lệch với những gì backend thực sự quét; tick lại file đã-loại cũng vô tác dụng.

- [x] **Default-untick theo session exclusions**: khi list units, file có `spineFile` nằm trong `merged.excludedFiles` được bỏ tick sẵn (so khớp path đã normalize `\`→`/` + lowercase).
- [x] **Picker là nguồn quyết định duy nhất**: bỏ phần ép `excludedFiles` trong `mergeExcluded` (xoá luôn param `excludedFiles` khỏi `useCleanSource`) — scan/clean chỉ loại trừ theo đúng các unit user bỏ tick, nên tick lại file đã-loại giờ thực sự đưa nó vào quét.
- [x] Verify: `tsc --noEmit` + `npm test` (26) xanh.

---

## v0.2.20 — Đổi tên mode đọc .spine + cảnh báo file 4.x ✅ Done

> Bump `0.2.19 → 0.2.20`; tag `v0.2.20`.

**Bối cảnh:** user test file `.spine` save bởi editor 4.3 với mode đọc settings — file fail parse và âm thầm fallback preset nền, output "trông khớp" gây hiểu nhầm là đã support 4.3. Cần label chuẩn hơn + cảnh báo lộ rõ fallback.

- [x] **Đổi tên mode**: "Preset nền + min/max từ từng .spine" → **"Dùng settings từ từng .spine"** (EN "Use settings from each .spine") — decoder giờ đọc gần trọn settings, không chỉ min/max. Help text liệt kê đủ (min/max, scale, padding, packing, cleanUp, format...).
- [x] **Detect version editor trong payload** (`detect_editor_version`): cả file 3.8 lẫn 4.3 đều đóng dấu version dạng hibit-string đầu payload (`3.8.99`/`4.3.17`). Scan fail trên file 4.x → lỗi ghi rõ "save bởi Spine {v} — decoder chỉ hỗ trợ 3.8.x" thay vì "không tìm thấy pack settings". Validate trên file thật `3001_Lucius_4_3.spine`.
- [x] **Note fallback thành `[WARN]`**: file không parse được giờ hiện `[WARN] ... file này export bằng preset nền` trong log — không còn lọt âm thầm.
- [x] **Xác nhận bằng file thật**: parser fail trên `.spine` 4.3 (format đổi, không còn block `07 08 09 0A` + neo `0B`); export "4.3" user thấy khớp là **target version** 4.3 đọc settings từ file 3.8 (đúng thiết kế), không phải đọc file 4.3. Test files ghi trong memory.
- [x] Verify: `cargo test` (56) + `npm test` (26) + build xanh.

---

## v0.2.19 — Quality release: slider Parallel jobs + default 4 + củng cố test ✅ Done

> Bump `0.2.18 → 0.2.19`; tag `v0.2.19`.

**Bối cảnh:** gom các món polish nhỏ thành một release nhanh, không thêm tính năng lớn.

- [x] **Parallel jobs → slider** (`SettingsModal`): range 1–8 + badge giá trị + thang min/max + `Hint` nhắc trade-off RAM. Thay ô number (range ẩn, gõ ngoài [1,8] bị clamp ngầm khó hiểu). CSS tách `src/slider.css` (import global ở `main.tsx`) thay vì nhồi `styles.css` (đụng file-size guard) — đúng convention `toggle.css`/`DropOverlay.css`.
- [x] **Default `parallelJobs` 1 → 4** (`config.ts`): hợp CPU phổ thông 4–6 nhân (vd i5-12400F 6 nhân/12 luồng). Chỉ áp dụng cài đặt mới (config cũ đã persist).
- [x] **Nâng P8/P16 lên property test**: `prop_clean_source_folder_name` (hàm thuần) + `prop_find_existing_id_folder_invariants` (FS-backed, 32 cases). `cargo test` 55 xanh (was 53).
- [x] **Audit cache invalidation Clean Source**: xác minh **đúng hoàn toàn** (sig = version + spine mtime/size + img count/bytes; `_unused_backup` trong `IGNORED_DIRS` + là thư mục anh em → không đếm lại sau move). Không có bug, không sửa code.
- [x] **Đính chính cờ `--last-export-settings`**: xác minh 3 nguồn chính chủ (CLI docs, forum, spine-scripts) — cờ này **không tồn tại** ở mọi version. Sửa claim sai ở ROADMAP v0.2.14 + design doc §XI + memory. Thêm backlog "per-project settings cho 4.3.x" (cần mở rộng parser binary, không có đường tắt native).
- [x] Verify: `cargo test` (55) + `npm test` (26) + `npm run build` xanh; clippy không lỗi mới.

> Không làm trong release này (chờ điều kiện): TGA thumbnail (cần thêm crate `image`), nút +Add LinkedProject, mở rộng decoder tier B (cần thí nghiệm editor để validate byte-identical).

---

## v0.2.18 — Decode .spine bằng zigzag: sửa min/max, thêm padding/packing/multipleOfFour ✅ Done

> Bump `0.2.17 → 0.2.18`; tag `v0.2.18`.

**Bối cảnh:** số nguyên trong block settings của `.spine` được Spine (libGDX `writeInt` với `optimizePositive=false`) lưu dạng **varint zigzag** (n ≥ 0 → 2n); decoder cũ đọc unsigned thuần nên mọi field int ra **gấp đôi**. Thí nghiệm có kiểm soát (export Lucius với padding 3, min 128, max 700) chốt: file ghi padding 6, min 256, max 1400. Chi tiết: `docs/research-padding-not-decoded.md`.

- [x] **`read_zigzag`** (zigzag-decode + reject raw lẻ = số âm) dùng cho min/max, alphaThreshold, paddingX/Y. **Sửa bug min/max đọc gấp đôi** — đây là field tier A đang dùng thật (vd Chest bị báo 256/4096 thay vì 128/2048).
- [x] **Bỏ ràng buộc power-of-two** cho page size (project thật dùng size tùy ý như 700); neo scan vào field `0B <bool>` (pot) ngay sau maxHeight.
- [x] **Re-promote:** `alphaThreshold`, `multipleOfFour`, `paddingX/Y`, `edgePadding`, `duplicatePadding`, `premultiplyAlpha`, `bleed`. Demote cũ của alphaThreshold/multipleOfFour là do zigzag + min/max gấp đôi làm lệch layout, không phải dữ liệu stale.
- [x] **Decode `packing`** (field 0x28: `28 01 02` rectangles / `28 01 03` polygons). Giải luôn bí ẩn cũ: 0003_Althea không reproduce được dưới rectangles vì nó vốn là **Polygons**.
- [x] **Validate end-to-end cả 2 packing mode**: decode → merge preset → Spine CLI export tái tạo **atlas + toàn bộ PNG byte-identical** với export từ editor.
- [x] Tách test sang `spine_project_tests.rs` (giữ `spine_project.rs` < 800 dòng), thêm regression fixture ghim bytes thí nghiệm; `cargo test` (53) xanh, clippy + file-size guard pass.

---

## v0.2.17 — Single instance (tái dùng bản đang ẩn ở tray) ✅ Done

> Bump `0.2.15 → 0.2.17`; tag `v0.2.17` (v0.2.16 đã bị tag protected, build CI fail vì file-size guard nên phải bump tiếp).

**Bối cảnh:** app chạy ngầm ở tray (v0.2.12) thiếu khóa single-instance — mở lại app khi đang ẩn sẽ spawn tiến trình thứ hai (hai tray icon, hai bản dùng chung file cấu hình → ghi đè lẫn nhau).

- [x] **`tauri-plugin-single-instance`** đăng ký làm plugin đầu tiên; callback gọi `tray::show_main_window` để un-minimize + show + focus cửa sổ đang ẩn thay vì tạo tiến trình mới.
- [x] Không cần sửa capabilities (plugin không expose command frontend).
- [x] **File-size guard**: `lib.rs` (command hub, lớn dần theo feature) được miễn trừ hẳn khỏi guard thay vì nhích baseline mỗi release.

---

## v0.2.15 — lastExportSettings: scale + cảnh báo divergence ✅ Done

> Bump `0.2.14 → 0.2.15`; tag `v0.2.15`.

**Bối cảnh:** test thực tế trên 3001_Lucius lộ 2 vấn đề của mode `lastExportSettings`: (a) parser bỏ qua `scale` → project scale 0.5 export sai gấp đôi res; (b) giá trị min/max trong `.spine` có thể stale so với ý định artist mà không ai biết.

- [x] **Decode `scale`** (field 0x13, float, tier A): validate end-to-end — file scale 0.5 + max 1024 tái tạo đúng page ~310 như export từ editor (80/80 region khớp). Bỏ scale thì ra ~640 (gấp đôi).
- [x] **KHÔNG decode `padding`**: giá trị trong file (16) không reproduce export thật (dùng 8) → padding luôn lấy base preset. Loại như alphaThreshold/multipleOfFour.
- [x] **Cảnh báo divergence**: `create_last_export_settings` so pack max parse được vs base preset; lệch → `spine-log [WARN]` (gợi ý .spine chưa export lại từ editor).
- [x] **Phát hiện trigger persistence** (ghi vào design doc §XI): `.spine` chỉ lưu đúng settings **ngay sau khi export từ Export window trong editor**; export qua script/preset/CLI không ghi ngược → stale. Studio dùng preset chung nên dùng "Dùng preset cho mọi file".
- [x] Verify: `cargo test` (46) + `npm test` (26) + build xanh; real-merge dump + CLI export khớp editor.

---

## v0.2.14 — Per-project export settings từ .spine ✅ Done

> Bump `0.2.13 → 0.2.14`; tag `v0.2.14`.

**Mục tiêu:** batch export theo settings riêng (đặc biệt min/max pack atlas) của TỪNG project mà không cần save `.export.json` thủ công cho mỗi file. Spine CLI **không** có cờ nào dùng settings lưu trong `.spine` (xác minh 2026-06: cờ `-e/--export` chỉ nhận path `.export.json` hoặc tên built-in `binary`/`json`; không có `--last-export-settings`), nên cách duy nhất là **tự parse binary `.spine`** rồi sinh temp `.export.json` truyền qua `-e`. Chi tiết format: design doc §XI.

- [x] **Parser `.spine`** (`src-tauri/src/spine_project.rs`): `.spine` 3.8.x là raw deflate (`flate2`); decode hibit-string + varint, scan pack min/max (field `07 08 09 0A`, heuristic power-of-two ∈ [16,16384], lấy match cuối). Thêm `cleanUp`, class/extension, packSource/packTarget, outputFormat, atlasExtension. Unit test + proptest + fixture test `#[ignore]` qua env `SPINE_FIXTURE`.
- [x] **Mode `lastExportSettings`** (`resolve_export_plan` → `create_last_export_settings`): merge per-field lên base preset; field không decode được giữ preset; parse fail toàn phần → fallback base preset (log lý do). `PlanError { Skip, Fail }` thay check chuỗi literal cũ. Command preview `read_spine_export_settings`.
- [x] **Calibration trên project thật**: Chest.spine cho atlas + PNG **byte-identical** bản artist export. Loại `alphaThreshold` + `multipleOfFour` khỏi decoder (giá trị lưu trong project = lần *save* cuối, lệch lần *export* thật) — luôn lấy từ preset.
- [x] **UI**: Export strategy thành 2 radio card ("Dùng preset cho mọi file" / "Preset nền + min/max từ từng .spine"), dropdown đổi tên "Base preset" dùng chung cả 2 mode; sanitizer giữ mode mới qua restart. CSS riêng `.strategy-source` (label trên, card full-width).
- [x] **Nội bộ**: tách `presets.rs` + `system.rs` khỏi `lib.rs` (ratchet baseline 2761 → 2713 dù thêm tính năng).
- [x] Verify: `cargo test` (46) + `npm test` (26) + `npm run build` xanh; `npm run tauri dev` chạy OK.

> Backlog liên quan: "Xử lý nhiều `.export.json` per project" vẫn mở — mode này giải quyết hướng *không cần* `.export.json`, chưa phải multi-export.

---

## v0.2.13 — Drag-drop zones + Toggle switches ✅ Done

> Bump `0.2.12 → 0.2.13`; tag `v0.2.13`.

- [x] **Kéo-thả theo vùng**: overlay tách thành ô input (trái) / output (phải), hit-test theo trục ngang ở mốc giữa màn hình (`dropZoneAt` trong `useDragDrop.ts`); thả 1 folder vào ô output gọi `updateOutputPath`. Ô output ẩn khi `outputPolicy === 'linkedProject'`. CSS tách ra `components/DropOverlay.css`.
- [x] **Kéo-thả an toàn hơn**: drop sai (file không phải `.spine`, nhiều folder) → toast cảnh báo; path 1 phần tử chỉ nhận là folder sau khi xác minh là thư mục thật trên disk (qua `list_subdirectories`).
- [x] **Toggle switch toàn app**: mọi `.checkbox-line input[type=checkbox]` render thành công tắc gạt kiểu macOS bằng CSS thuần (`toggle.css`, import global ở `main.tsx`) — không đổi markup TSX.
- [x] **Settings → Hoạt động gọn hơn**: dòng tip "chạy ngầm" chuyển sang icon `Hint` hover (card thu lại).

---

## v0.2.12 — Tray + Drag-drop + Dashboard ✅ Done

> Bump `0.2.11 → 0.2.12`; tag `v0.2.12`.

- [x] **Clean Source Folder an toàn hơn**: đếm trước số `.spine` (`count_clean_units`) + cảnh báo khi > 50, overlay khóa khi scan (spinner + tiến độ `x/total`) với nút Stop, không đóng được modal giữa chừng. Chi tiết: [clean-source.md](clean-source.md) mục 3.
- [x] **Drag-drop input**: kéo-thả folder hoặc file `.spine` vào app để đặt input (Tauri v2 `onDragDropEvent`); overlay gợi ý khi hover; bỏ qua khi đang export.
- [x] **Dashboard per-project**: nút Dashboard ở sidebar mở modal tổng hợp lần export gần nhất của từng session (Xong/Lỗi/Bỏ qua/Tổng) + tổng cộng project. Lưu `lastExport` trong `SessionConfig` (persist qua `pickKnown`).
- [x] **Chạy ngầm ở tray**: đóng (X) hoặc thu nhỏ → ẩn app xuống system tray thay vì thoát; icon tray có menu Show/Quit. Toggle trong Settings (mặc định bật), đồng bộ sang Rust qua `set_run_in_background`. Code tray ở `src-tauri/src/tray.rs`.
- [x] **Guard kích thước file** + tách `useAppController` (god-hook 2106 dòng) thành các hook: `useAppUpdater`, `useDragDrop`, `useCleanSource`, `usePresets` (còn ~1700). Script `scripts/check-file-size.mjs` chặn file mới > 800 dòng.

---

## v0.2.5 — Output Verification + True Parallel Jobs ✅ Done

Shipped ở commit `c133cac`.

- [x] Xác minh output sau CLI exit 0 (`FileOutcome` enum, `failed`/`skipped` trong `BatchExportResult`)
- [x] True parallel jobs (Tokio semaphore + `JoinSet`)
- [x] `spine-progress` chính xác theo completion order (`AtomicUsize`)
- [x] UI slider `parallelJobs` 1–8 (Settings → Advanced Runtime)
- [x] Summary "X thành công, Y lỗi, Z bỏ qua" sau batch

---

## v0.2.6 — Linked Project + finish v0.2.5 ✅ Done

**Mục tiêu:** export đi thẳng vào cây asset Unity (`unityRoot/<destType>/<idFolder>`); hoàn thiện Unicode workaround; đồng bộ version.

> Code-complete; `cargo test` (5/5) + `tsc --noEmit` xanh. Còn lại: verify end-to-end trong app thật (`npm run tauri dev`).
> Hướng dẫn dùng Linked Project: [linked-project.md](linked-project.md).
> UI: policy `timestamp` tạm ẩn (backend vẫn hỗ trợ); các dòng tip chuyển sang icon hover (`Hint`).

### Linked Project (ưu tiên 1)
- [x] A1 — Data model: `OutputPolicy 'linkedProject'`, types `LinkedType`/`LinkedProject`, `linkedProjects` (appConfig), `linkedProjectId`/`linkedTypeName` (session)
- [x] A2 — Backend: `OutputPolicy::LinkedProject`, `resolve_output_dir` branch, `find_existing_id_folder`, command `list_subdirectories`, validate
- [x] A3 — Controller: routing trong `buildExportRequestFrom`, CRUD Linked Project, preview, `canStart`/status
- [x] A4 — UI: radio + select Project/Type + preview (OutputSection), `LinkedProjectModal` (CRUD + auto-fill), i18n vi/en

### Setup wizard + Auto-detect Type (UX)
- [x] Session mới đi wizard tuần tự (Spine?→Input→Export→Output); duplicate đã xong thì bỏ qua (`wizardCompleted`)
- [x] Bước Output: Auto-detect Type theo path input (1 Type/session + cảnh báo khi nhiều loại)

### Accessibility & UX polish (theo docs/ui-design-rules.md mục 7)
- [x] `prefers-reduced-motion` toàn cục; focus ring `:focus-visible`; keyboard activation cho session/project row
- [x] `aria-label` cho nút icon-only; `FieldStatus`/status dot có `role`+`aria-label`; notice dùng `role=alert`/`aria-live`
- [x] base `line-height` 1.5; đếm file format locale; contrast đo ≥ 4.5:1

### Unicode path workaround
- [x] B1 — Nối `unicodeWorkaround` vào request payload (đã bị rớt)
- [x] B2 — Backend: `has_non_ascii`, copy-to-temp-ASCII trong `export_one_file`, `TempDirGuard` cleanup
- [x] B3 — UI: checkbox + warning banner khi path non-ASCII

### Polish & tests
- [x] C — Rà field rớt payload; bump version `package.json`/`Cargo.toml`/`tauri.conf.json` → `0.2.6`
- [x] D — Backend unit tests: `find_existing_id_folder`, `has_non_ascii`, `clean_source_folder_name`, `copy_dir_recursive`

### Verify end-to-end
- [x] Chạy `npm run tauri dev`, kiểm tra Linked Project ("FD") + Unicode theo kịch bản — xanh (đóng cổng tại v0.2.8)

---

## v0.2.7 — Hardening & Test Suite ✅ Done

> Không thêm tính năng user-facing; chỉ củng cố test. `cargo test` (14) + `npm test` (16) xanh, `npm run build` ok.

### Backend (proptest)
- [x] Thêm `[dev-dependencies] proptest`; union feature `schemars` cho `tauri-utils` để test profile build được (quirk 2.9.2: bật `schema` mà không bật `schemars`)
- [x] Property tests: `validate_settings` (P5 empty spine, P6 internalExperimental), `parallelJobs` clamp (P9), `validate_preset_file_name` (P10), `normalize_pack_source` (P13), `parse_spine_version`
- [x] `resolve_output_dir(LinkedProject)` không sinh path trùng (P17, FS-backed)

### Frontend (Vitest)
- [x] Dựng Vitest + jsdom (`vitest.config.ts`, `src/test-setup.ts`, script `test`/`test:watch`)
- [x] Trích logic thuần ra `src/validation.ts` (`computeCanStart`, `statusFromValidation`); hook import lại
- [x] `validation.test.ts`: `canStart`/`statusFromValidation` mọi tổ hợp (P15)
- [x] `sessions.test.ts`: persistence migration round-trip A/B/C/D, `sanitizeConfig`/`pickKnown`, ẩn timestamp→sourceFolder (P2)

### Chuyển sang v0.2.8
- [ ] Hook-level tests (React Testing Library): session isolation (P3/P4), log routing khi switch session (P14) — cần render `useAppController`

---

## v0.2.8 — Test coverage hoàn tất + Validation polish ✅ Done

**Mục tiêu:** đóng nốt các mục treo sau v0.2.7, **không thêm tính năng user-facing lớn**. Đóng cổng verify e2e v0.2.6 (đang là điều kiện coi v0.2.6 thực sự xong).

### A. Frontend hook-level tests (Vitest + React Testing Library) — ưu tiên 1
- [x] Thêm `@testing-library/react`; mock `@tauri-apps/api` (`invoke`/`event.listen`) trong `src/test-setup.ts` để render được `useAppController`
- [x] P3 — Session isolation: switch session **không mất** runtime (logs/files) của session khác (`runtimeByIdRef`)
- [x] P4 — Xóa project → xóa hết session con
- [x] P14 — Log routing: `spine-log` event vào đúng slot session đang chạy kể cả sau khi switch
- _tasks.md 10.2, 11.2 — `src/useAppController.test.tsx`_

### B. Backend property tests còn lại
- [x] P1 — `scan_spine_files` chỉ trả `.spine` hợp lệ, bỏ file tạm `.~`/`~` (_tasks.md 1.2_)
- [x] P7 — timestamp folder name khớp đúng pattern chrono (_tasks.md 6.1_)
- [x] P11 — `stop_requested` ngăn bắt đầu file mới giữa batch — qua helper `may_start_next` (_tasks.md 2.3_)
- [x] P12 — `FallbackMode` tác động đúng khi thiếu `.export.json` (_tasks.md 6.2_)
- _Ghi chú: P8 (`clean_source_folder_name`) và P16 (`find_existing_id_folder`) đã có example test; nâng lên proptest là optional._

### C. UX validation Linked Project + đóng cổng v0.2.6
- [x] `FieldStatus` trong `LinkedProjectModal`: cảnh báo tên project rỗng, `sourceName` trùng nhau, Unity root chưa tồn tại (mục #6 review UI) — thêm chuỗi i18n vi/en + command `path_exists`
- [ ] (optional) Nút "+ Add" ngay đầu `.linked-list`, cân nhắc gọn nút ở footer (#7)
- [x] **Đóng cổng verify e2e v0.2.6**: `npm run tauri dev`, chạy kịch bản Linked Project ("FD") + Unicode workaround (tasks.md 13.6) → đã xanh, v0.2.6 khóa

### Verify v0.2.8 (end-to-end)
1. [x] `cd src-tauri && cargo test` — thêm 4 property test mới (P1/P7/P11/P12), tất cả xanh (22/22).
2. [x] `npm test` — thêm 3 hook-level test (P3/P4/P14, jsdom + RTL), tất cả xanh (25/25).
3. [x] `npm run build` — tsc + vite không lỗi.
4. [x] Bump `0.2.7 → 0.2.8` (`package.json`/`Cargo.toml`/`tauri.conf.json`).
5. [ ] Push tag → CI release tự build installer (sau khi đóng cổng e2e ở C).

> Sau v0.2.8, v0.2.6 và toàn bộ test-suite coi như khóa hẳn.

---

## v0.2.9 — Clean Source Folder (gỡ ảnh thừa) ✅ Done

**Mục tiêu:** ở chế độ **pack folder** (`packSource = imagefolders`), Spine pack cả thư mục ảnh nên ảnh thừa làm phình atlas. Thêm công cụ quét + chuyển ảnh không được skeleton tham chiếu sang `_unused_backup`. Port logic match từ Spine-Cleaner sang Rust. Hướng dẫn: [clean-source.md](clean-source.md).

### Backend
- [x] Module `src-tauri/src/cleaner.rs`: path utils, `extract_json_references`, image index + matcher (exact → no-ext → unique-basename), `move_unused` (backup timestamp, từ chối file ngoài images_dir). Ảnh thuộc ref **ambiguous được coi là used** (không xóa nhầm). 8 unit test.
- [x] Nguồn refs = **export `.spine` → JSON tạm qua Spine CLI** rồi parse (`.spine` là binary; JSON cạnh ảnh bị bỏ qua vì hay stale).
- [x] Command `scan_source_folders` / `clean_source_folders` (nhận `excluded` để bỏ qua file ngoài export-set) + `move_unused_images` (move 1 folder bằng paths đã scan, không export lại) + `read_image_data_url` (thumbnail base64). `WalkDir` tìm mọi `.spine` dưới root, mỗi unit độc lập, match cô lập theo `images_dir`, chạy song song (cap 4) + `spine-progress`, tôn trọng Stop. Backup riêng `_unused_backup/<timestamp>` mỗi folder. Temp dir mỗi unit là duy nhất (counter) tránh đụng nhau khi chạy song song.

### Frontend
- [x] `CleanSourceFolderModal`: nút công cụ **global ở sidebar**; chọn thư mục → Scan (bảng per-folder: dot trạng thái, used/unused/issues + dung lượng) → Move unused tổng hoặc **từng folder**. Tôn trọng list "không export" của session.
- [x] `CleanFolderDetailModal`: bấm 1 folder → xem thumbnail **Unused/Used** (lazy-load, cache), header có stat + dot, footer **Back/Next** duyệt folder cùng đợt + nút Move riêng.
- [x] **Cache scan theo từng session** (root + summary) → mở lại modal không phải scan lại; user bấm Scan để làm mới.
- [x] Detect pack-folder từ **generated settings hoặc preset đang chọn** (`packSource ∈ {imagefolders, folder}`): notice gợi ý dọn source ở bước Output + log nhắc lúc export. **Không** auto-clean (đã bỏ vì rủi ro).
- [x] Checkbox **"tự mở folder output khi export xong"** (opt-in, dedup folder vừa mở). Command `path_exists`; i18n vi/en.

### Verify v0.2.9
1. [x] `cargo test` — +8 test cleaner, tất cả xanh (30/30).
2. [x] `npm test` (25/25) + `npm run build` ok.
3. [x] **E2E**: Scan folder mẫu + thư mục tổng nhiều folder con, thumbnail, move từng folder/tổng, tôn trọng exclude — đã xanh.
4. [x] Bump `0.2.8 → 0.2.9`; merge `main` + tag `v0.2.9`.

---

## v0.2.11 — In-app changelog + preset discard guard ✅ Done

**Mục tiêu:** cho user đọc được changelog ngay trong app, và chặn mất edit khi đóng nhầm modal preset.

> v0.2.10 bị bỏ qua: CI fail ở bước tạo GitLab Release (PowerShell 5.1 gửi body string non-ASCII bằng Latin-1 → 400), và tag v0.2.10 đã protected nên phải bump tiếp.

- [x] Badge version ở titlebar click ra trang releases (command Rust `open_url`)
- [x] Updater hiện nút "What's new" lấy `notes` từ manifest (`UpdateUiState.notes`)
- [x] `CHANGELOG.md` user-facing ở gốc repo; CI trích section theo version cho `latest.json` notes + description release (hết hardcode)
- [x] CI gửi body release dạng UTF-8 bytes (`charset=utf-8`) để notes tiếng Việt không lỗi 400
- [x] `PresetEditorModal`: theo dõi dirty (name + nội dung + lỗi JSON) → confirm trước khi đóng (backdrop/X/Cancel); i18n `presetDiscard*`
- [x] Bump `0.2.9 → 0.2.11`; tag `v0.2.11`

---

## v0.3.0 — macOS Support 📋 Planned

- [ ] Verify auto-detect path macOS + không cảnh báo `.exe`
- [ ] `tauri.conf.json` macOS bundle: signingIdentity / entitlements / minimumSystemVersion
- [ ] `icon.icns`
- [ ] Notarization + CI job macOS

---

## v0.4.0 — Unity Headless Trigger (Pha 2) 📋 Planned

- [ ] Tách core export khỏi GUI
- [ ] Parse CLI args + định dạng job file
- [ ] Trả log về Unity console
- [ ] Package menu/nút "Export to SpineForge" trong Unity Editor

> Lên plan chi tiết riêng sau khi Pha 1 (Linked Project) verify xong — design doc mục IX.

---

## Backlog / ý tưởng (chưa lên lịch)

- [x] Drag-drop folder/file vào drop zone _(xong — xem Unreleased)_
- [ ] Xử lý nhiều `.export.json` per project
- [x] Dashboard kết quả per-project _(xong — xem Unreleased)_
- [ ] JSON post-processing path rewrite (an toàn, có backup)
- [ ] **Per-project settings cho `.spine` 4.3.x** — parser hiện chỉ đọc format 3.8.x. Spine CLI **không** có cờ dùng settings nội bộ (đã xác minh 2026-06), nên buộc phải mở rộng parser binary cho layout 4.x. Cần file `.spine` 4.3 thật + bản export editor 4.3 để reverse-engineer và validate byte-identical (như đã làm với 3.8). Hiện file 4.3 đưa vào mode này sẽ tự fallback về preset nền.
