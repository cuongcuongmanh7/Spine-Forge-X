# SpineForge X — Roadmap & Progress

Source-of-truth tiến độ toàn dự án. Chi tiết kỹ thuật từng task xem `.kiro/specs/spineforge-x/tasks.md`.

**Quy ước:** `[x]` xong · `[ ]` chưa làm · `[~]` đang làm.

---

## v0.2.5 — Output Verification + True Parallel Jobs ✅ Done

Shipped ở commit `c133cac`.

- [x] Xác minh output sau CLI exit 0 (`FileOutcome` enum, `failed`/`skipped` trong `BatchExportResult`)
- [x] True parallel jobs (Tokio semaphore + `JoinSet`)
- [x] `spine-progress` chính xác theo completion order (`AtomicUsize`)
- [x] UI slider `parallelJobs` 1–8 (Settings → Advanced Runtime)
- [x] Summary "X thành công, Y lỗi, Z bỏ qua" sau batch

---

## v0.2.6 — Linked Project + finish v0.2.5 🔧 In progress

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

### Verify end-to-end (chưa làm)
- [ ] Chạy `npm run tauri dev`, kiểm tra Linked Project + Unicode theo kịch bản (xem plan)

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

### Đẩy sang backlog
- [ ] Hook-level tests (React Testing Library): session isolation (P3/P4), log routing khi switch session (P14) — cần render `useAppController`, để đợt sau

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

- [ ] Drag-drop folder/file vào drop zone
- [ ] Xử lý nhiều `.export.json` per project
- [ ] Dashboard kết quả per-project
- [ ] JSON post-processing path rewrite (an toàn, có backup)
