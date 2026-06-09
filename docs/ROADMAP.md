# SpineForge X — Roadmap & Progress

Source-of-truth tiến độ toàn dự án. Chi tiết kỹ thuật từng task xem `.kiro/specs/spineforge-x/tasks.md`.

**Quy ước:** `[x]` xong · `[ ]` chưa làm · `[~]` đang làm.

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

**Mục tiêu:** đóng nốt các mục treo sau v0.2.7, **không thêm tính năng user-facing lớn**. Đóng cổng verify e2e v0.2.6 (đang là điều kiện coi v0.2.6 thực sự xong). Chi tiết task tham chiếu `.kiro/specs/spineforge-x/tasks.md`.

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
