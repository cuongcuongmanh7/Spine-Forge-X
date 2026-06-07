# Tài Liệu Thiết Kế: SpineForge X

## Overview

## Tổng Quan

SpineForge X là ứng dụng desktop cross-platform được xây dựng bằng **Tauri v2** (Rust backend + TypeScript/React frontend). Ứng dụng giải quyết bài toán batch export và nâng cấp version hàng loạt file `.spine` mà không cần mở thủ công từng file trong Spine Editor.

Tài liệu này mô tả kiến trúc, data model, luồng xử lý và các quyết định kỹ thuật của SpineForge X từ v0.2.4 đến trạng thái production-ready. Bao gồm tính năng **Linked Project** (Pha 1) — định tuyến output thẳng vào cây thư mục dự án Unity.

> **Phạm vi tương lai (Pha 2):** Kích hoạt pipeline export trực tiếp từ Unity Editor qua chế độ headless CLI (Unity Headless Trigger) — yêu cầu tách core export khỏi GUI, parse CLI args, job file và trả log về Unity console. Hiện **ngoài phạm vi** tài liệu này, sẽ spec riêng sau khi Pha 1 đã verify.

---

## Architecture

## Kiến Trúc Hệ Thống

SpineForge X chia thành hai tầng giao tiếp qua Tauri IPC:

```
┌─────────────────────────────────────────────────────────────┐
│                    Frontend (WebView)                       │
│  React + TypeScript                                         │
│  ┌──────────────┐  ┌───────────────┐  ┌─────────────────┐  │
│  │  useApp      │  │  Components   │  │  sessions.ts    │  │
│  │  Controller  │  │  (UI Layer)   │  │  (Persistence)  │  │
│  └──────────────┘  └───────────────┘  └─────────────────┘  │
│          │                                      │           │
│     invoke() ◄──────────────────────────► listen()         │
└──────────────────────┬──────────────────────────────────────┘
                       │  Tauri IPC (JSON serialization)
┌──────────────────────▼──────────────────────────────────────┐
│                    Backend (Rust)                           │
│  Tauri Commands + Tokio async runtime                       │
│  ┌────────────┐  ┌────────────┐  ┌──────────────────────┐  │
│  │ File Ops   │  │  Export    │  │     AppState         │  │
│  │ (scan,     │  │  Engine    │  │  (stop_requested,    │  │
│  │  validate) │  │  (batch)   │  │   running_children)  │  │
│  └────────────┘  └────────────┘  └──────────────────────┘  │
│                       │                                     │
│              ┌────────▼────────┐                            │
│              │  SpineCLI       │                            │
│              │  (tokio::process│                            │
│              │   ::Command)    │                            │
│              └─────────────────┘                            │
└─────────────────────────────────────────────────────────────┘
```

### Quyết định công nghệ

- **Tauri v2** thay vì Electron: binary nhỏ hơn, dùng WebView native của OS, Rust backend an toàn hơn.
- **Tokio async runtime**: cho phép spawn nhiều SpineCLI process đồng thời mà không block UI thread.
- **localStorage** cho persistence: đơn giản, không cần SQLite cho use case này; state nhỏ (vài KB).
- **React Context + single controller hook** (`useAppController`): một nguồn sự thật duy nhất thay vì nhiều store phân tán, dễ debug.

---

## Data Models

### Backend (Rust)

#### `AppState` (shared mutable state qua Tauri `State<Arc<AppState>>`)

```rust
struct AppState {
    stop_requested: AtomicBool,       // flag dừng batch, atomic để thread-safe
    running_children: Mutex<Vec<u32>> // PID của các SpineCLI process đang chạy
}
```

#### `BatchExportRequest`

Payload đầy đủ từ Frontend xuống Backend khi bắt đầu batch. Được deserialize từ JSON qua Tauri IPC.

```rust
struct BatchExportRequest {
    spine_path: String,
    input_root: String,
    files: Vec<String>,
    output_path: String,
    output_policy: OutputPolicy,        // Timestamp | SourceFolderName | LinkedProject
    linked_dest_type: String,           // tên folder đích (destName) đã resolve sẵn ở FE; "" nếu policy khác
    target_version: String,
    export_mode: ExportMode,            // PerProjectJson | GlobalJson | BuiltIn | GeneratedSettings
    fallback_mode: FallbackMode,        // BuiltIn | GlobalJson | Skip
    global_json_path: Option<String>,
    built_in_export: String,            // e.g. "binary+pack"
    generated_*: ...,                   // ~40 fields cho GeneratedSettings mode
    clean: bool,
    parallel_jobs: usize,
    max_memory: String,                 // e.g. "512m"
    timeout_seconds: u64,
    preserve_relative_paths: bool,
    clean_folder_name: bool,
}
```

#### `ScanResult` / `ValidateResult` / `BatchExportResult`

```rust
struct ScanResult     { files: Vec<String>, skipped: Vec<String> }
struct ValidateResult { ok: bool, warnings: Vec<String>, errors: Vec<String>,
                        spine_ok: bool, spine_warning: bool,
                        output_ok: bool, output_warning: bool }
struct BatchExportResult { completed: usize, total: usize,
                           output_folders: Vec<String>, stopped: bool }
```

#### `ExportPlan` (nội bộ)

```rust
struct ExportPlan {
    arg: Option<String>,       // giá trị truyền vào --export
    temp_file: Option<PathBuf> // file tạm cần xóa sau khi CLI xong
}
```

### Frontend (TypeScript)

#### `AppConfig` (dùng chung toàn app, lưu trong localStorage)

```typescript
type AppConfig = {
    spinePath: string,
    parallelJobs: number,         // 1-8
    maxMemory: string,            // e.g. "512m"
    timeoutSeconds: number,       // mặc định 300
    linkedProjects: LinkedProject[] // các Linked Project dùng chung cho mọi session
}
```

#### `SessionConfig` (per-session, lưu trong localStorage)

```typescript
type SessionConfig = {
    inputPath: string,
    inputFiles: string[],      // explicit file list (khi không dùng folder scan)
    excludedFiles: string[],   // paths bị loại trừ khỏi scan result
    outputPath: string,
    outputPolicy: OutputPolicy,
    clean: boolean,
    preserveRelativePaths: boolean,
    cleanFolderName: boolean,
    targetVersion: string,
    exportMode: ExportMode,
    fallbackMode: FallbackMode,
    globalJsonPath: string,
    builtInExport: string,
    generatedFormat: string,
    generatedSkeletonExtension: string,
    // ... ~30 fields cho GeneratedSettings
    linkedProjectId: string,   // FK tới LinkedProject.id (khi outputPolicy = linkedProject)
    linkedTypeName: string,    // = LinkedType.sourceName của type được chọn
}

#### `LinkedType` và `LinkedProject` (cho OutputPolicy `linkedProject`)

```typescript
type LinkedType = {
    sourceName: string,   // subfolder nguồn, vd "Enemy", "Hero" (số ít)
    destName: string      // subfolder Unity, vd "Enemy", "Heroes" (số nhiều)
}

type LinkedProject = {
    id: string,           // UUID v4
    name: string,         // vd "FD"
    unityRoot: string,    // .../Animations/Spine — thư mục gốc đích trong Unity
    sourceRoot: string,   // .../[FD] Animation — thư mục gốc chứa .spine nguồn
    types: LinkedType[]   // bảng ánh xạ sourceName → destName
}
```
```

#### `Session` và `Project`

```typescript
type Project = {
    id: string,         // UUID v4
    name: string,
    autoNamed: boolean, // true = tên tự động (chưa user đặt)
    createdAt: number,
    updatedAt: number
}

type Session = {
    id: string,
    projectId: string,  // FK tới Project
    name: string,
    autoNamed: boolean,
    config: SessionConfig,
    createdAt: number,
    updatedAt: number
}
```

#### `SessionRuntime` (ephemeral, không persist)

```typescript
type SessionRuntime = {
    files: string[],           // kết quả scan hiện tại
    skippedFiles: string[],
    logs: string[],
    lastOutputFolders: string[],
    currentIndex: number       // tiến trình batch hiện tại
}
```

Runtime được lưu trong `runtimeByIdRef: Record<string, SessionRuntime>` (React ref, không trigger re-render) khi user switch session.

---

## Luồng Xử Lý Chính

### 1. Khởi Động Ứng Dụng

```
App mount
  → loadPersistedState() từ localStorage
      → Migration cascade: legacy format → flat sessions → projects format
  → autoDetectSpine() (silent, không show error nếu không tìm thấy)
  → checkForAppUpdate() với timeout 30s
  → loadExportPresets() (built-in + user presets)
  → Auto-scan session đang active (nếu có inputPath, chưa scan lần này)
```

### 2. Quét File Input

```
User chọn folder / drop folder
  Frontend → invoke('scan_spine_files', { inputPath })
    Backend:
      1. Kiểm tra path tồn tại → Err nếu không
      2. WalkDir đệ quy toàn bộ folder
      3. Lọc: chỉ lấy extension .spine, bỏ qua file bắt đầu .~ hoặc ~
      4. Sort → trả về ScanResult { files, skipped }
  Frontend:
      - Áp dụng excludedFiles filter
      - Update files state
      - Trigger validateSettings
```

### 3. Validate Settings (debounced 500ms)

```
Khi spinePath / outputPath / outputPolicy / exportMode / globalJsonPath thay đổi:
  Frontend → invoke('validate_settings', ...)
    Backend (pure, sync):
      1. Kiểm tra spinePath tồn tại
      2. Cảnh báo nếu Windows dùng Spine.exe thay Spine.com
      3. Kiểm tra outputPath (nếu có); cảnh báo nếu chưa tồn tại
      4. Kiểm tra globalJsonPath tồn tại (nếu mode yêu cầu)
      5. Từ chối InternalExperimental
      → ValidateResult { ok, warnings[], errors[] }
  Frontend: cập nhật trạng thái icon check/warning/error cạnh từng field
            vô hiệu hóa nút Start nếu có lỗi
```

### 4. Batch Export

```
User nhấn Start Export
  Frontend:
    1. Kiểm tra canStart (validation.ok && files.length > 0 && !anyRunning)
    2. check_output_collisions() → cảnh báo nếu folder output đã tồn tại
    3. Hiển thị RunOverlay
    4. invoke('start_batch_export', batchRequest)

  Backend (async, Tokio):
    1. Đặt stop_requested = false
    2. Validate files không rỗng
    3. Sinh run_folder_name = "export_<version>_DDMMYYYY_HHMMSS"
    4. Loop qua từng file (sequential hiện tại, parallel jobs = 1..8 trong tương lai):
       a. Kiểm tra stop_requested flag
       b. Emit spine-progress { current, total, file }
       c. Gọi export_one_file():
          i.   resolve_output_dir() → tính thư mục output theo OutputPolicy
          ii.  resolve_export_plan() → tính tham số --export
               - GeneratedSettings: tạo file .export.json tạm
               - PerProjectJson: tìm .export.json cạnh .spine → fallback nếu không có
               - GlobalJson: dùng globalJsonPath
               - BuiltIn: dùng builtInExport value
               - normalize_preset_file(): sửa packSource "folder" → "imagefolders"
          iii. Build Command: Spine.com -Xmx<mem> --update <ver> --input <file>
               --output <dir> [--clean] --export <arg>
          iv.  apply_no_window() trên Windows (CREATE_NO_WINDOW flag)
          v.   spawn() → lưu PID vào running_children
          vi.  Stream stdout → emit "spine-log"
               Stream stderr → emit "spine-error"
          vii. time::timeout(timeout_seconds) → kill nếu vượt quá
          viii. Kiểm tra exit_code == 0
          ix.  Xóa temp file (nếu có), bất kể thành/thất bại
          x.   Trả về output_dir string
    5. Trả về BatchExportResult { completed, total, output_folders, stopped }

  Frontend:
    - Nhận spine-log / spine-error → append vào logs với timestamp
    - Nhận spine-progress → cập nhật progress bar + currentFile
    - Khi invocation hoàn tất → ẩn RunOverlay, hiển thị summary
```

### 5. Stop Batch

```
User nhấn Stop
  Frontend → invoke('stop_batch_export')
    Backend:
      1. stop_requested.store(true, SeqCst)
      2. Lấy snapshot running_children
      3. Kill tất cả PID:
         - Windows: taskkill /PID <pid> /T /F
         - macOS/Linux: kill -TERM <pid>
  Backend loop tự dừng khi kiểm tra stop_requested ở đầu mỗi iteration
```

### 6. Switch Session

```
User chọn session khác trong sidebar
  Frontend:
    1. captureActiveRuntime() → lưu { files, skippedFiles, logs, lastOutputFolders,
       currentIndex } vào runtimeByIdRef[activeSessionId]
    2. setActiveSessionId(newId)
    3. loadRuntime(newSession) → khôi phục state từ runtimeByIdRef hoặc empty
    NOTE: Nếu session cũ đang running, backend tiếp tục chạy và log
          được ghi vào runtimeByIdRef[runningId] qua recordRunLog()
```

### 7. Export Preset Management

```
list_export_presets():
  1. Đọc built-in presets từ resource_dir/export-presets/ và CARGO_MANIFEST_DIR/export-presets/
  2. Đọc user presets từ app_data_dir/export-presets/
  3. Sort: built-in trước, rồi alphabetical; dedup by name

import_user_export_preset(source_path):
  1. Validate tên file (kết thúc bằng .export.json, không có path separator)
  2. Đọc nội dung, validate JSON hợp lệ và có "class": "export-*"
  3. Sao chép vào app_data_dir/export-presets/

save_user_export_preset(name, content):
  1. Validate tên file
  2. Validate JSON content
  3. Ghi vào app_data_dir/export-presets/<name>

GeneratedSettings mode:
  1. Build serde_json::Value từ ~40 generated_* fields trong BatchExportRequest
  2. normalize_pack_source(): "folder" → "imagefolders"
  3. Ghi ra std::env::temp_dir()/spineforge-x-<timestamp>-<pid>.export.json
  4. Truyền path này vào --export
  5. Xóa sau khi SpineCLI kết thúc (bất kể success/failure)
```

### 8. Linked Project (OutputPolicy `linkedProject`)

```
Thiết lập (1 lần / dự án):
  User mở OutputSection → chọn policy "Linked Project" → nút "Manage…" → LinkedProjectModal
    1. Nhập name; Browse unityRoot + sourceRoot
    2. "Auto-fill từ Unity root" → invoke('list_subdirectories', unityRoot)
       → điền bảng LinkedType (destName = tên subfolder; user sửa sourceName cho khớp số ít)
    3. Save → push vào appConfig.linkedProjects (localStorage)

Mỗi lần export:
  User chọn Project + Type → FE hiển thị preview đích cho file đầu:
    id = clean_source_folder_name(folder nguồn)
    invoke('list_subdirectories', unityRoot/destName) → kiểm tra khớp id
       khớp  → "→ …/<destName>/<idFolder>/"
       chưa  → "→ …/<destName>/<id>/ (sẽ tạo mới)"
  Start:
    buildExportRequestFrom resolve output_path = unityRoot, linked_dest_type = destName
    Backend resolve_output_dir(LinkedProject) → find_existing_id_folder → tái dùng / tạo mới
```

---

## Components and Interfaces

## Cấu Trúc Component Frontend

```
App.tsx
├── Titlebar          – window controls + update status indicator
├── Sidebar           – project/session tree, status dots, CRUD actions
│   ├── Project row   – collapsible, rename, add session, delete project
│   └── Session row   – rename, duplicate, delete, status dot
├── SessionMain       – workspace của active session
│   ├── InputSection         – spine executable picker + input path/files
│   ├── ExportStrategySection – export mode selector + preset picker
│   ├── OutputSection        – output path, output policy (Timestamp / SourceFolderName /
│   │                           LinkedProject: select Project + Type + nút "Manage…" + preview đích)
│   ├── (Advanced params)    – target version, parallel jobs, memory, timeout
│   └── RunDock              – validate status, Start/Stop button, progress
├── LogSection        – monospace log display + filter + save + clear
├── RunOverlay        – full-screen overlay khi batch đang chạy
├── SettingsModal     – app-wide config (spine path, language, theme)
├── PresetEditorModal – JSON editor cho export preset
├── LinkedProjectModal – CRUD Linked Project (name, Browse unityRoot/sourceRoot,
│                        bảng LinkedType với nút "Auto-fill từ Unity root"); mẫu theo PresetEditorModal
├── NameSessionModal  – dialog đặt tên session mới
├── NameProjectModal  – dialog đặt tên project mới
└── Toasts            – notification stack (tự dismiss sau 3.5s)
```

### Controller Pattern

`useAppController.tsx` export một React Context chứa toàn bộ state và handler functions. Toàn bộ component chỉ đọc context — không có local state business logic. Điều này đảm bảo:
- Một nguồn sự thật duy nhất
- Dễ test business logic tách biệt khỏi rendering
- Không có prop drilling

---

## Cơ Chế Persistence

### localStorage Keys

| Key | Nội dung |
|-----|----------|
| `spineforge.appConfig` | `AppConfig` JSON |
| `spineforge.projects` | `Project[]` JSON |
| `spineforge.sessions` | `Session[]` JSON |
| `spineforge.activeSessionId` | string |
| `spineforge.activeProjectId` | string |
| `spineforge.collapsedProjects` | `string[]` (project IDs) |
| `spineforge.language` | `"vi"` hoặc `"en"` |
| `spineforge.theme` | `"light"` hoặc `"dark"` |

> `linkedProjects: LinkedProject[]` được lưu như một phần của `AppConfig` (key `spineforge.appConfig`); `linkedProjectId` và `linkedTypeName` được lưu trong `SessionConfig` của từng Session. `sanitizeConfig()`/`pickKnown()` đảm bảo các field mới này có default rỗng khi load session cũ.

### Migration Strategy

`loadPersistedState()` xử lý 4 case theo thứ tự ưu tiên:
1. **Case A**: Format mới (có `spineforge.projects` key) — đọc trực tiếp
2. **Case B**: Flat sessions không có projects — tạo default project, gán tất cả sessions vào đó
3. **Case C**: Legacy single-session format (`spineforge.settings`) — migrate sang project+session
4. **Case D**: Không có gì — khởi động với state rỗng

`sanitizeConfig()` luôn áp dụng `defaultSessionConfig` làm template và chỉ giữ các key đã biết (`pickKnown()`), đảm bảo các field mới được thêm sẽ có default value đúng khi load session cũ.

---

## Output Directory Resolution

### OutputPolicy: `Timestamp`

```
Không có outputPath:
  → <folder chứa .spine>/export_<version>_DDMMYYYY_HHMMSS/

Có outputPath, preserveRelativePaths = false:
  → <outputPath>/export_<version>_DDMMYYYY_HHMMSS/

Có outputPath, preserveRelativePaths = true:
  → <outputPath>/<relative path từ inputRoot đến folder chứa .spine>/export_.../
```

### OutputPolicy: `SourceFolderName`

```
(Bắt buộc có outputPath)
cleanFolderName = false:
  → <outputPath>/<tên folder chứa .spine>/

cleanFolderName = true:
  → <outputPath>/<phần trước _ đầu tiên của tên folder>/
  Ví dụ: "3001_Lucius" → "3001"
```

### OutputPolicy: `LinkedProject`

```
(Bắt buộc có output_path = unityRoot và linked_dest_type = destName, đều resolve sẵn ở Frontend)

base   = unityRoot.join(linked_dest_type)            // lỗi nếu 1 trong 2 rỗng
id     = clean_source_folder_name(source_folder_name) // token trước '_' đầu tiên
folder = find_existing_id_folder(&base, &id)          // tìm folder đích đã tồn tại theo id
            .unwrap_or_else(|| source_folder_name)     // fallback: giữ nguyên tên folder nguồn
→ base.join(folder)
```

**Helper `find_existing_id_folder(base: &Path, id: &str) -> Option<String>`**: `read_dir(base)`,
trả về tên folder con theo thứ tự ưu tiên: (1) khớp tên đúng bằng `id`, (2) khớp tiền tố
`"{id}_"`, (3) `None` nếu không có folder nào khớp. Đảm bảo không tạo folder trùng cạnh folder id
đã tồn tại (vd `0001` khớp `Heroes/0001_Fighter` thay vì tạo `Heroes/0001`).

**Command `list_subdirectories(path: String) -> Result<Vec<String>, String>`**: liệt kê các thư
mục con trực tiếp của `path`. Frontend dùng để (1) Auto-fill bảng `LinkedType` từ `unityRoot`, và
(2) sinh preview thư mục đích real-time (kiểm tra `IdFolder` đã tồn tại hay sẽ tạo mới).

Frontend (`buildExportRequestFrom`) chịu trách nhiệm resolve `linked_dest_type`: tra
`LinkedProject` theo `linkedProjectId`, tìm `LinkedType` theo `linkedTypeName`, set
`output_path = project.unityRoot` và `linked_dest_type = type.destName` trước khi gửi request.

---

## Export Argument Resolution

`resolve_export_plan()` theo thứ tự:

```
ExportMode::InternalExperimental → Err (disabled)
ExportMode::GlobalJson           → arg = globalJsonPath
ExportMode::BuiltIn              → arg = builtInExport (e.g. "binary+pack")
ExportMode::GeneratedSettings    → tạo temp .export.json từ generated_* fields
ExportMode::PerProjectJson       → tìm .export.json cạnh .spine:
    Tìm thấy  → arg = path tìm được
    Không thấy → FallbackMode::BuiltIn  → arg = builtInExport
               → FallbackMode::GlobalJson → arg = globalJsonPath
               → FallbackMode::Skip       → Err (skip file này)
```

Sau khi có `arg`, `normalize_preset_file()` kiểm tra nếu là file `.export.json` có `packSource = "folder"` thì rewrite thành `"imagefolders"` trong temp file (Spine không nhận giá trị legacy này).

---

## Error Handling

## Xử Lý Lỗi

### Nguyên tắc Backend

- **Không dùng `unwrap()` / `expect()`** trong bất kỳ code path xử lý I/O hoặc event realtime.
- Tất cả `window.emit()` kết quả được bỏ qua với `let _ = ...` — Frontend có thể đã đóng.
- Mọi lỗi được trả về dạng `Result<T, String>` với message tiếng Việt mô tả rõ nguyên nhân.
- Temp files luôn được xóa trong cả success và failure path (không dùng defer/RAII vì Rust borrow checker yêu cầu explicit cleanup trước `return`).

### Phân loại kết quả file trong batch

| Trạng thái | Điều kiện |
|-----------|-----------|
| `completed` | CLI exit 0 + có ít nhất 1 file output tồn tại |
| `failed` | CLI exit ≠ 0, timeout, hoặc CLI exit 0 nhưng không có file output |
| `skipped` | FallbackMode = Skip và không có .export.json |

### Unicode Path

Khi input/output path chứa ký tự non-ASCII:
1. Frontend hiển thị warning banner trước khi Start
2. Nếu `unicodeWorkaround` bật: Backend copy `.spine` và dependencies vào ASCII temp path, chạy CLI, copy output về, xóa temp
3. Nếu copy thất bại: xóa temp (nếu đã tạo), đánh dấu file failed với log lỗi cụ thể

---

## Auto-Updater

Dùng `tauri-plugin-updater`:

```
App start → check(timeout: 30s)
  Không có update → setUpdateUi(idle) [silent]
  Có update → tự động download với progress events
    → setUpdateUi(ready, version)
    → User nhấn "Cài đặt & Khởi động lại"
    → update.install() + relaunch()

Lỗi mạng/timeout → log error + showTemporaryUpdateStatus('error', 6000ms)
                    (không làm gián đoạn workflow)
```

---

## Đa Ngôn Ngữ và Theme

- **i18n**: `src/i18n.ts` export `getCopy(language)` trả về `Translations` object với toàn bộ strings UI. Không dùng thư viện ngoài — đơn giản và type-safe.
- **Theme**: CSS custom properties, toggle qua `document.documentElement.dataset.theme = 'dark'|'light'`. Persist vào localStorage.
- Cả hai được đọc từ localStorage khi mount, áp dụng ngay trước khi render để tránh flash.

---

## Cross-Platform

| Hành vi | Windows | macOS |
|---------|---------|-------|
| Spine executable | `Spine.com` (preferred), `Spine.exe` (warning) | `/Applications/Spine.app/Contents/MacOS/Spine` |
| Mở folder output | `explorer <path>` | `open <path>` |
| Kill process | `taskkill /PID /T /F` | `kill -TERM <pid>` |
| Suppress console | `CREATE_NO_WINDOW` flag | N/A |
| Auto-detect paths | registry + Program Files | /Applications |
| Warning Spine.exe | Có | Không |

---

## Testing Strategy

Chiến lược kiểm thử hai tầng:

**Unit/Property tests** (pure functions trong Backend Rust):
- `scan_spine_files` với mock filesystem
- `validate_settings` với mọi tổ hợp input
- `resolve_output_dir`, `resolve_export_plan`, helper functions
- `parse_spine_version`, `is_timestamp_export_folder`, `clean_source_folder_name`
- Dùng thư viện `proptest` (Rust) cho property-based testing

**Integration tests**:
- Batch export end-to-end với Spine CLI thật (Windows CI)
- Auto-updater với mock server
- Persistence round-trip với real localStorage

**Frontend tests**:
- `useAppController` logic với React Testing Library + jsdom
- Session switch / runtime isolation
- Validation state → canStart logic

## Correctness Properties

*Một property là đặc tính hoặc hành vi phải đúng trên tất cả các đầu vào hợp lệ của hệ thống — về cơ bản là một phát biểu hình thức về những gì hệ thống phải làm. Properties là cầu nối giữa đặc tả có thể đọc được và đảm bảo tính đúng đắn có thể kiểm chứng tự động.*

### Property 1: Quét file chỉ trả về file .spine hợp lệ

*Với bất kỳ* cấu trúc thư mục nào, kết quả `ScanResult.files` từ `scan_spine_files` chỉ chứa các file có extension `.spine` và không bắt đầu bằng `.~` hoặc `~`; `ScanResult.skipped` chứa tất cả file `.spine` tạm bị loại trừ.

**Validates: Requirements 3.1, 3.3**

### Property 2: Persist/restore state là round-trip

*Với bất kỳ* `AppConfig`, danh sách `Project[]` và `Session[]` hợp lệ nào, việc serialize vào localStorage rồi đọc lại qua `loadPersistedState()` phải cho ra state tương đương (cùng id, name, config values cho tất cả entities).

**Validates: Requirements 2.4, 1.5**

### Property 3: Session isolation — switch không mất runtime

*Với bất kỳ* cặp session (A, B) nào có runtime state khác nhau, sau khi switch A→B→A thì runtime của A (files, logs, currentIndex) phải được khôi phục đúng với state trước khi switch.

**Validates: Requirements 2.5**

### Property 4: Xóa project xóa hết session con

*Với bất kỳ* project P chứa N sessions, sau khi xóa P thì không còn session nào trong danh sách có `projectId === P.id`.

**Validates: Requirements 2.3**

### Property 5: validate_settings luôn disable Start khi có lỗi

*Với bất kỳ* cấu hình nào mà `validate_settings` trả về `errors.length > 0`, thì `canStart` phải bằng `false` và `validation.ok` phải bằng `false`.

**Validates: Requirements 16.2, 16.3**

### Property 6: ExportMode::InternalExperimental luôn bị từ chối

*Với bất kỳ* `BatchExportRequest` nào có `export_mode = "internalExperimental"`, cả `validate_settings` lẫn `resolve_export_arg` đều phải trả về lỗi mô tả tại sao mode này bị tắt.

**Validates: Requirements 4.7, 16.2**

### Property 7: Timestamp folder name khớp đúng pattern

*Với bất kỳ* chuỗi `target_version` hợp lệ nào, kết quả của `make_export_folder_name(version)` phải khớp pattern `export_<sanitized_version>_DDMMYYYY_HHMMSS` và `is_timestamp_export_folder()` phải trả về `true` cho tên đó.

**Validates: Requirements 5.1**

### Property 8: cleanFolderName rút gọn trước dấu gạch dưới

*Với bất kỳ* tên thư mục source nào chứa ít nhất một dấu `_`, `clean_source_folder_name()` phải trả về phần trước `_` đầu tiên và phần này không được rỗng. Với tên không có `_`, phải trả về nguyên tên.

**Validates: Requirements 5.5**

### Property 9: parallelJobs bị giới hạn trong khoảng [1, 8]

*Với bất kỳ* giá trị `parallel_jobs` nào được truyền vào `start_batch_export`, số job thực tế sử dụng phải là `parallel_jobs.clamp(1, 8)`. Nếu đầu vào là 0 thì dùng 1; nếu là 100 thì dùng 8.

**Validates: Requirements 6.2, 12.4**

### Property 10: validate_preset_file_name chấp nhận/từ chối đúng

*Với bất kỳ* chuỗi tên file nào kết thúc bằng `.export.json`, không chứa path separator (`/`, `\`, `:`), và không phải chính xác `.export.json` thì phải được chấp nhận. Bất kỳ chuỗi nào vi phạm một trong các điều kiện trên phải bị từ chối với lỗi rõ ràng.

**Validates: Requirements 10.7**

### Property 11: stop_requested ngăn bắt đầu file mới

*Với bất kỳ* trạng thái batch nào mà `stop_requested = true`, vòng lặp trong `start_batch_export` không được bắt đầu xử lý file tiếp theo sau khi kiểm tra flag. `BatchExportResult.stopped` phải là `true`.

**Validates: Requirements 9.1, 9.2, 9.3**

### Property 12: FallbackMode tác động đúng khi thiếu .export.json

*Với bất kỳ* file `.spine` nào không có `.export.json` cạnh bên và `export_mode = PerProjectJson`, hành vi phải là:
- `FallbackMode::BuiltIn` → `export_plan.arg = Some(built_in_export)`
- `FallbackMode::GlobalJson` → `export_plan.arg = Some(global_json_path)`
- `FallbackMode::Skip` → `Result::Err` (file bị bỏ qua)

**Validates: Requirements 4.3**

### Property 13: normalize_pack_source sửa giá trị "folder"

*Với bất kỳ* file `.export.json` nào có `packSource = "folder"`, `normalize_preset_file()` phải tạo temp file với `packSource = "imagefolders"`. Với bất kỳ giá trị `packSource` khác, không tạo temp file.

**Validates: Requirements 4.2, 4.4** (đảm bảo preset hợp lệ được truyền cho SpineCLI)

### Property 14: Log routing đúng session đang chạy

*Với bất kỳ* scenario nào mà session A đang chạy và user switch sang session B, các dòng log từ batch của A phải được append vào `runtimeByIdRef[A]`, không phải vào logs state đang hiển thị (của B).

**Validates: Requirements 15.6**

### Property 15: Session status nhất quán giữa sidebar và main panel

*Với bất kỳ* session nào, `statusFromValidation()` khi áp dụng cho cùng một session và cùng `validation` + `files.length` phải trả về cùng `SessionStatus` bất kể được gọi từ sidebar hay từ main panel.

**Validates: Requirements 2.7, 16.1**

### Property 16: find_existing_id_folder khớp đúng thứ tự ưu tiên

*Với bất kỳ* `base` chứa tập folder con và một `id` token nào, `find_existing_id_folder(base, id)` phải trả về: folder có tên `== id` nếu tồn tại; nếu không, folder đầu tiên có tên bắt đầu bằng `"{id}_"`; nếu không có folder nào khớp thì `None`. Hàm không bao giờ trả về folder không liên quan tới `id`.

**Validates: Requirements 20.5, 20.6**

### Property 17: resolve_output_dir(LinkedProject) không sinh path trùng

*Với bất kỳ* tên folder nguồn nào mà id token của nó khớp một folder id đã tồn tại trong `unityRoot/<destType>` (đúng tên hoặc theo tiền tố), `resolve_output_dir` với `OutputPolicy::LinkedProject` phải trả về đúng folder đã tồn tại đó — không tạo tên folder mới cạnh nó. Chỉ khi không có folder nào khớp, kết quả mới là `base/<tên folder nguồn>`.

**Validates: Requirements 20.5, 20.6**
