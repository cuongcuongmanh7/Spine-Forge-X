# Implementation Plan: SpineForge X

## Overview

Danh sách task này bao phủ toàn bộ con đường từ v0.2.4 (codebase hiện tại) đến trạng thái production-ready, bao gồm: hoàn thiện các tính năng còn dang dở, bổ sung parallel jobs thực sự, xác minh output sau export, unicode path workaround, hỗ trợ macOS và bộ test backend.

Ngôn ngữ: **Rust** (backend Tauri) + **TypeScript/React** (frontend).

---

## v0.2.5 Milestone — Output Verification + True Parallel Jobs

> Scope tối thiểu để ship v0.2.5. Tất cả task dưới đây phải hoàn thành cùng lúc vì `BatchExportResult` có breaking change (thêm `failed`/`skipped`).

### Bắt buộc

- [~] **1.1** — Backend: Xác minh output sau CLI exit 0 (`FileOutcome` enum + `failed`/`skipped` trong `BatchExportResult`)
- [~] **2.1** — Backend: Refactor `start_batch_export` sang Tokio semaphore + `FuturesUnordered`
- [~] **2.2** — Backend: `spine-progress` chính xác trong parallel mode (`AtomicUsize`)
- [~] **3** — Checkpoint: `cargo test` xanh, `BatchExportResult` serialize đúng sang frontend
- [~] **5.3** — Frontend: Summary hiển thị "X thành công, Y lỗi, Z bỏ qua" sau batch

### Tùy chọn (nếu còn capacity)

- [~] **5.1** — Frontend: UI slider `parallelJobs` 1–8 trong Advanced Runtime section
- [~] **1.2\*** — Property test: scan filter chỉ trả về `.spine` hợp lệ
- [~] **2.3\*** — Property test: parallel jobs clamp + stop flag

### Không đưa vào v0.2.5

- Task 4 (Unicode workaround) → v0.2.6
- Task 13 (Linked Project) → v0.3.0

---

## Tasks

- [x] 1. Hoàn thiện Backend Rust — Output Verification và File Tracking
  - [x] 1.1 Triển khai xác minh output sau khi SpineCLI exit 0
    - Sau khi `child.wait()` trả về `exit_code == 0`, quét thư mục `output_dir` tìm ít nhất một file `.skel`, `.json` hoặc `.atlas`
    - Nếu không tìm thấy: trả về `Err("CLI exit 0 nhưng không tìm thấy file output")` và ghi log warning
    - Thêm enum `FileOutcome { Completed, Failed(String), Skipped }` để phân biệt ba trạng thái
    - Cập nhật `BatchExportResult` thêm field `failed: usize` và `skipped: usize`
    - _Requirements: 8.1, 8.2, 8.3_

  - [ ]* 1.2 Viết property test cho output verification
    - **Property 1: Quét file chỉ trả về file .spine hợp lệ**
    - **Validates: Requirements 3.1, 3.3**
    - Dùng `proptest` sinh cây thư mục ngẫu nhiên với mix file `.spine`, `.~spine`, `~spine`, `other.ext`
    - Assert `ScanResult.files` chỉ chứa `.spine` không bắt đầu `.~`/`~`; `skipped` chứa đúng file tạm
    - _Requirements: 3.1, 3.3_

- [x] 2. Triển Khai Parallel Jobs Thực Sự (Tokio)
  - [x] 2.1 Refactor `start_batch_export` sang mô hình semaphore + FuturesUnordered
    - Thêm `tokio::sync::Semaphore` với `permits = parallel_jobs.clamp(1, 8)`
    - Chuyển loop tuần tự sang `FuturesUnordered` — spawn một task per file, acquire permit trước khi gọi `export_one_file`
    - `running_children` cần `Mutex<Vec<u32>>` (đã có) — đảm bảo mỗi task push/pop PID thread-safe
    - Xóa log cũ "Parallel jobs hiện đang chạy tuần tự" và thay bằng "Running N parallel jobs"
    - _Requirements: 12.1, 12.2, 12.3, 12.4_

  - [x] 2.2 Đảm bảo `spine-progress` chính xác trong parallel mode
    - Dùng `AtomicUsize` cho `completed_count` (shared qua `Arc`) thay vì biến local
    - Mỗi task emit `spine-progress { current: completed_count.fetch_add(1), total, file }` sau khi hoàn thành
    - Đảm bảo `stop_requested` được kiểm tra trước khi acquire semaphore permit
    - _Requirements: 12.3, 9.1, 9.2_

  - [ ]* 2.3 Viết property test cho parallel jobs clamp và stop flag
    - **Property 9: parallelJobs bị giới hạn trong khoảng [1, 8]**
    - **Validates: Requirements 6.2, 12.4**
    - **Property 11: stop_requested ngăn bắt đầu file mới**
    - **Validates: Requirements 9.1, 9.2, 9.3**

- [ ] 3. Checkpoint — Backend Core
  - Đảm bảo tất cả Rust tests pass (`cargo test`), không có `unwrap()`/`expect()` mới trong code path I/O
  - Kiểm tra `BatchExportResult` serialize đúng sang frontend với các field mới
  - Hỏi người dùng nếu có câu hỏi.

- [ ] 4. Unicode Path Workaround — Backend
  - [x] 4.1 Thêm field `unicode_workaround: bool` vào `BatchExportRequest`
    - Thêm field vào struct `BatchExportRequest` (Rust) và type `SessionConfig` (TypeScript)
    - Cập nhật `defaultSessionConfig` với `unicodeWorkaround: false`
    - Cập nhật `sanitizeConfig` để pick field mới
    - _Requirements: 11.1, 11.2_

  - [~] 4.2 Triển khai logic copy-to-temp-ASCII trong `export_one_file`
    - Hàm `has_non_ascii(path: &str) -> bool` kiểm tra ký tự non-ASCII trong path
    - Hàm `copy_spine_to_temp(input_file: &Path) -> Result<(PathBuf, PathBuf), String>`:
      - Tạo thư mục tạm ASCII trong `std::env::temp_dir()`: `spineforge-unicode-<pid>-<idx>/`
      - Copy file `.spine` và tất cả file trong cùng folder (images, atlas source) vào temp
      - Trả về `(temp_input_file, temp_dir)`
    - Hàm `copy_output_back(temp_output: &Path, real_output: &Path) -> Result<(), String>`
    - Trong `export_one_file`: nếu `unicode_workaround && (has_non_ascii(file) || has_non_ascii(&output_dir))`, wrap toàn bộ call bằng copy logic; cleanup temp dù success hay fail
    - _Requirements: 11.2, 11.3_

  - [ ]* 4.3 Viết unit test cho unicode detection và path helpers
    - Test `has_non_ascii` với ASCII paths, Vietnamese paths, Chinese paths
    - Test cleanup khi copy thất bại (temp dir không còn tồn tại sau lỗi)
    - _Requirements: 11.2, 11.3_

- [ ] 5. Frontend — Cập Nhật UI cho Parallel Jobs và Unicode
  - [~] 5.1 Thêm UI control cho `parallelJobs` vào Advanced Runtime section
    - Trong `SessionMain` (hoặc section tương ứng), thêm number input / slider cho `parallelJobs` (1–8)
    - Bind vào `sessionConfig.parallelJobs` qua controller patch handler
    - Hiển thị giá trị hiện tại và giải thích ngắn
    - _Requirements: 6.2, 12.4_

  - [~] 5.2 Thêm toggle Unicode Path Workaround vào Advanced Runtime section
    - Checkbox `unicodeWorkaround` trong Advanced section
    - WHEN input path hoặc output path chứa non-ASCII, hiển thị warning banner phía trên nút Start
    - Logic detect: `containsNonAscii(path: string): boolean`
    - _Requirements: 11.1, 11.2_

  - [x] 5.3 Cập nhật `BatchExportResult` handling trong frontend
    - Đọc thêm `failed` và `skipped` count từ result mới
    - Hiển thị summary "X thành công, Y lỗi, Z bỏ qua" sau khi batch hoàn tất
    - _Requirements: 7.6, 8.3_

- [ ] 6. Backend Rust — Property Tests cho Pure Functions
  - [~] 6.1 Viết property tests cho `validate_settings` và `resolve_output_dir`
    - **Property 5: validate_settings luôn disable Start khi có lỗi**
    - **Validates: Requirements 16.2, 16.3**
    - **Property 6: ExportMode::InternalExperimental luôn bị từ chối**
    - **Validates: Requirements 4.7, 16.2**
    - **Property 7: Timestamp folder name khớp đúng pattern**
    - **Validates: Requirements 5.1**
    - **Property 8: cleanFolderName rút gọn trước dấu gạch dưới**
    - **Validates: Requirements 5.5**
    - Thêm `#[cfg(test)] mod tests` cuối `lib.rs`; dùng `proptest::prelude::*`

  - [~] 6.2 Viết property tests cho preset và export plan resolution
    - **Property 10: validate_preset_file_name chấp nhận/từ chối đúng**
    - **Validates: Requirements 10.7**
    - **Property 12: FallbackMode tác động đúng khi thiếu .export.json**
    - **Validates: Requirements 4.3**
    - **Property 13: normalize_pack_source sửa giá trị "folder"**
    - **Validates: Requirements 4.2, 4.4**

- [~] 7. Checkpoint — Frontend + Backend Integration
  - Build Tauri dev (`cargo tauri dev`) và kiểm tra:
    - Parallel jobs slider hoạt động và giá trị truyền đúng xuống backend
    - Unicode warning hiển thị khi path chứa tiếng Việt
    - Summary sau batch hiển thị đúng failed/skipped counts
  - Hỏi người dùng nếu có câu hỏi.

- [ ] 8. Hỗ Trợ macOS — Build và Code Signing
  - [~] 8.1 Bổ sung macOS auto-detect path và validate không cảnh báo Spine.exe
    - `spine_candidates()` đã có `/Applications/Spine.app/Contents/MacOS/Spine` — verify đúng thứ tự ưu tiên
    - `validate_settings`: cảnh báo `.exe` chỉ emit khi `cfg!(windows)` (đã có) — thêm test assert macOS không warn
    - `open_path`: `cfg!(target_os = "macos")` branch dùng `open` (đã có) — verify không regression
    - _Requirements: 18.1, 18.2, 18.4_

  - [~] 8.2 Cấu hình `tauri.conf.json` cho macOS bundle
    - Thêm `macOS` section vào `tauri.conf.json`: `signingIdentity`, `entitlements`, `minimumSystemVersion`
    - Tạo `entitlements.plist` nếu chưa có (hardened runtime cho notarization)
    - Cập nhật CI (`.gitlab-ci.yml`) thêm macOS build job với runner macOS
    - _Requirements: 18.3_

  - [~] 8.3 Thêm macOS icon assets
    - Tạo `icons/icon.icns` từ icon hiện có (dùng `iconutil` hoặc `tauri-icon` tool)
    - Đăng ký trong `tauri.conf.json` `bundle.icon` array
    - _Requirements: 18.3_

- [x] 9. `parse_spine_version` — Mở Rộng Pattern
  - [x] 9.1 Refactor `parse_spine_version` để parse semver pattern tổng quát
    - Hiện tại hardcode `["3.8.99", "4.3.11"]` — thay bằng regex/pattern `\d+\.\d+\.\d+` match từ output
    - Giữ backward compat với các version string Spine thực tế (4.x, 3.8.x)
    - _Requirements: 1.3_

  - [ ]* 9.2 Viết property test cho `parse_spine_version`
    - Sinh chuỗi output ngẫu nhiên có/không chứa semver token
    - Assert: nếu output chứa `X.Y.Z` thì parse trả về `Some`; nếu không có pattern nào thì `None`
    - _Requirements: 1.3_

- [ ] 10. Persistence Round-Trip và Session Isolation Tests (Frontend)
  - [~] 10.1 Viết unit tests cho `loadPersistedState` migration paths
    - **Property 2: Persist/restore state là round-trip**
    - **Validates: Requirements 2.4, 1.5**
    - Test 4 case migration (A/B/C/D) bằng mock localStorage (jsdom trong Vitest)
    - Assert: session ids, names, config values được preserve chính xác
    - _Requirements: 2.4, 1.5_

  - [~] 10.2 Viết unit tests cho session runtime isolation
    - **Property 3: Session isolation — switch không mất runtime**
    - **Validates: Requirements 2.5**
    - **Property 4: Xóa project xóa hết session con**
    - **Validates: Requirements 2.3**
    - Dùng React Testing Library để test `useAppController` hook với jsdom
    - _Requirements: 2.3, 2.5_

- [ ] 11. Frontend Tests — Validation và canStart Logic
  - [~] 11.1 Viết unit tests cho `canStart` và `statusFromValidation`
    - **Property 15: Session status nhất quán giữa sidebar và main panel**
    - **Validates: Requirements 2.7, 16.1**
    - Test mọi tổ hợp `validation.ok`, `files.length`, `anyRunning`
    - Assert: `canStart === false` khi bất kỳ điều kiện nào fail
    - _Requirements: 16.2, 16.3_

  - [~] 11.2 Viết unit tests cho Log routing khi switch session
    - **Property 14: Log routing đúng session đang chạy**
    - **Validates: Requirements 15.6**
    - Mock `spine-log` events trong jsdom, switch session, assert log vào đúng runtimeByIdRef slot
    - _Requirements: 15.6_

- [~] 12. Checkpoint Cuối — Full Test Suite
  - Chạy `cargo test` — tất cả Rust unit/property tests pass
  - Chạy `npm test` (hoặc `vitest --run`) — tất cả frontend tests pass
  - Chạy `cargo build --release` và smoke test: batch export 2–3 file .spine thật trên Windows
  - Hỏi người dùng nếu có câu hỏi.

- [ ] 13. Linked Project — Liên Kết Dự Án Unity
  - [~] 13.1 Data model + OutputPolicy `linkedProject`
    - Thêm type `LinkedType { sourceName, destName }` và `LinkedProject { id, name, unityRoot, sourceRoot, types }` vào `src/config.ts`
    - `defaultAppConfig`: thêm `linkedProjects: [] as LinkedProject[]`
    - `defaultSessionConfig`: thêm `linkedProjectId: ''`, `linkedTypeName: ''`
    - `OutputPolicy` (`src/types.ts`): thêm giá trị `'linkedProject'`
    - Cập nhật `sanitizeConfig`/`pickKnown` để pick các field mới
    - _Requirements: 20.1, 20.2_

  - [~] 13.2 Backend Rust — resolve output + helpers
    - Enum `OutputPolicy` (`lib.rs`): thêm variant `LinkedProject`
    - `BatchExportRequest`: thêm field `linked_dest_type: String` (default `""`)
    - `resolve_output_dir`: thêm nhánh `LinkedProject` (base = `unityRoot/destType`, id = `clean_source_folder_name`, `find_existing_id_folder` → fallback tên nguồn)
    - Helper MỚI `find_existing_id_folder(base, id) -> Option<String>` (exact → prefix `{id}_` → None)
    - Command MỚI `list_subdirectories(path) -> Result<Vec<String>>` (đăng ký trong `invoke_handler`)
    - `validate_settings`: policy `linkedProject` → bắt buộc `output_path` + `linked_dest_type` không rỗng
    - _Requirements: 20.4, 20.5, 20.6, 20.8_

  - [~] 13.3 Nối Frontend + persistence
    - `buildExportRequestFrom`: khi `outputPolicy === 'linkedProject'`, tra `LinkedProject` theo `linkedProjectId`, tìm `LinkedType` theo `linkedTypeName`, set `outputPath = unityRoot`, `linkedDestType = destName`
    - Lưu/đọc `linkedProjects` qua app config trong `src/sessions.ts`
    - _Requirements: 20.2, 20.4_

  - [~] 13.4 UI — OutputSection + LinkedProjectModal + i18n
    - `OutputSection.tsx`: thêm radio policy `linkedProject`; khi chọn hiển thị `<select>` Project, `<select>` Type (label `sourceName → destName`), nút "Manage…", và dòng preview đích real-time (`(sẽ tạo mới)` nếu chưa có)
    - MỚI `src/components/LinkedProjectModal.tsx` (mẫu theo `PresetEditorModal.tsx`): CRUD name, Browse `unityRoot`/`sourceRoot`, bảng types với nút "Auto-fill từ Unity root"
    - i18n: thêm label mới (cạnh nơi định nghĩa `t.sourceFolderPolicy`)
    - _Requirements: 20.1, 20.3, 20.7_

  - [ ]* 13.5 Property tests cho Linked Project (backend)
    - **Property 16: find_existing_id_folder khớp đúng thứ tự ưu tiên**
    - **Property 17: resolve_output_dir(LinkedProject) không sinh path trùng**
    - **Validates: Requirements 20.5, 20.6**
    - Dùng `proptest` sinh tập folder con + id token; assert đúng thứ tự exact → prefix → tạo mới

  - [~] 13.6 Checkpoint — Linked Project end-to-end
    - `npm run tauri dev`; tạo Linked Project "FD" (unityRoot = `.../Animations/Spine`, sourceRoot = `[FD] Animation`, types `Enemy→Enemy`, `Hero→Heroes`, `Eidolon→Eidolons`)
    - Input `…/Enemy/4001/*.spine` → output vào `…/Spine/Enemy/4001/` (tái dùng, không tạo trùng)
    - Input Hero id `0001` → khớp `Heroes/0001_Fighter/` theo prefix
    - Input id chưa có folder đích → tạo mới đúng tên; cảnh báo ghi đè vẫn đúng
    - Hỏi người dùng nếu có câu hỏi.

---

## Notes

- Tasks đánh dấu `*` là optional — có thể bỏ qua cho MVP nhanh
- Mỗi task tham chiếu requirements cụ thể để traceability
- Checkpoint đảm bảo validate incremental, không để lỗi tích lũy
- Property tests dùng `proptest` (Rust) và `fast-check` hoặc Vitest với manual generators (TypeScript)
- Parallel jobs (Task 2) là thay đổi lớn nhất về backend — cần review kỹ race condition trước khi merge
- Task 13 (Linked Project) là Pha 1 của tích hợp Unity; **Pha 2** (headless CLI + nút Export trong Unity) ngoài phạm vi, sẽ lên plan riêng sau khi Pha 1 verify xong

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "4.1", "9.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "4.2", "9.2"] },
    { "id": 2, "tasks": ["2.2", "4.3", "5.1", "5.2", "6.1"] },
    { "id": 3, "tasks": ["2.3", "5.3", "6.2", "8.1"] },
    { "id": 4, "tasks": ["8.2", "8.3", "10.1"] },
    { "id": 5, "tasks": ["10.2", "11.1"] },
    { "id": 6, "tasks": ["11.2"] },
    { "id": 7, "tasks": ["13.1"] },
    { "id": 8, "tasks": ["13.2", "13.3"] },
    { "id": 9, "tasks": ["13.4", "13.5"] },
    { "id": 10, "tasks": ["13.6"] }
  ]
}
```
