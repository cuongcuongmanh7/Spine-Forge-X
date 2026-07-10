# SpineForge X — Roadmap & Progress

Source-of-truth tiến độ toàn dự án.

**Quy ước:** `[x]` xong · `[ ]` chưa làm · `[~]` đang làm.

---

## 🔜 Dự kiến (chưa làm)

_Không có mục nào đang chờ (chỉ còn backlog dài hạn rải rác bên dưới: multi-root mapping, per-project settings 4.3.x, Unity, macOS)._

## v0.4.48 — Surface lỗi thumbnail L2 ra bảng Log ✅ Done

> Bump `0.4.47 → 0.4.48`; tag `v0.4.48`.

- [x] **`l2log.ts` bus + wire vào bảng Log** ([l2log.ts](../src/l2log.ts)) — thumbnail pipeline nuốt mọi lỗi L2 (upload/download fail → fallback render cục bộ), nên outage thật (auth hết hạn, storage-rule chặn, billing account đóng → HTTP 403) trông y như "chưa có gì để sync". `reportL2Failure/onL2Log` dedup theo (op, reason)/phiên + `console.warn`; [firebase.ts](../src/firebase.ts) `getThumbDownloadUrl` phân biệt `object-not-found` (im) với lỗi thật (báo `download`); [useSpineThumbnail.ts](../src/useSpineThumbnail.ts) báo từ các catch upload/backfill; [useWorkspace.ts](../src/useWorkspace.ts) subscribe → `appendLog` (release không kèm devtools nên vào thẳng bảng Log). i18n `thumbCloudSyncFailed` (vi+en).
- [x] **Bối cảnh** — billing account project `spineforge-x` bị đóng (delinquent) ~07-08→07-09 chặn toàn bộ L2 I/O trong im lặng; đã mở lại billing + thêm observability này để lần sau hiện lỗi ngay.
- [x] Verify: `tsc` + test sync/firebase (20) + file-size guard xanh.

## v0.4.47 — Backfill thumbnail legacy L1→L2 ✅ Done

> Bump `0.4.46 → 0.4.47`; tag `v0.4.47`. Gộp trên nền v0.4.46 (capture-registry đồng bộ ảnh chụp tay).

- [x] **`backfillThumbToL2` + memo `l2Present`** ([useSpineThumbnail.ts](../src/useSpineThumbnail.ts)) — luồng cũ "trúng L1 là `return`" khiến thumb auto-render có trước khi có sync (chỉ nằm ở L1 mỗi máy) không bao giờ lên L2; 2 máy chung account không thấy thumb của nhau. Nay tại nhánh L1-hit (cả lazy path lẫn `useThumbnailWarm`), key chưa có trên L2 → tự upload (nền, best-effort). Content-addressed → union merge an toàn, không xung đột. Memo `localStorage` `spineforge.thumbL2Present` đảm bảo mỗi key chỉ đối soát 1 lần/máy (không truy vấn mạng lặp). Cũng tự vá thumb render lúc offline/chưa đăng nhập. Không cần cờ tắt: sau khi di trú xong feature tự im (check in-memory), phần safety-net chạy mãi cho case offline.
- [x] **Phối hợp với capture-registry (v0.4.46)** — backfill có guard `!captureRegistry.has(key)`: chỉ đẩy ảnh auto-render, tránh đè ảnh chụp tay mà luồng capture đang quản (khớp chốt `!captureRegistry.has(key)` remote đặt ở đường upload sau render). Đường capture cũng `markL2Present` sau upload để hai memo nhất quán.
- [x] Verify: `tsc` + `npm test` + file-size guard xanh sau khi resolve merge.

## v0.4.43 — FS watcher tự rescan khi export xong ✅ Done

> Bump `0.4.42 → 0.4.43`; tag `v0.4.43`.

- [x] **`is_structural_event` nhận artifact export** ([library.rs](../src-tauri/src/library.rs)) — thêm `is_export_artifact`: skeleton/atlas (`.json`/`.skel*`/`.atlas*`) xuất hiện trong thư mục `export`/`ex` giờ trigger `library-fs-changed` → tự quét lại. Bỏ qua `.export.json` (sidecar cấu hình) + `.png` (không flip cờ `exported`). Vá case export xong nhưng card kẹt "chưa export" + không thumbnail vì bản quét cache cũ (watcher trước chỉ bắt thay đổi `.spine`/folder). +1 test.

## v0.4.42 — Library metadata realtime + dọn code sidecar + help-text ✅ Done

> Bump `0.4.41 → 0.4.42`; tag `v0.4.42`. Gom 3 việc post-v0.4.41. Spec: [library-sidecar-firestore.md](library-sidecar-firestore.md).

- [x] **Realtime `onSnapshot`** cho tags/notes/drive-meta — thay pull-once-on-mount, thay đổi từ máy khác hiện ngay không cần mở lại tab. tags/notes replace theo doc authoritative (xoá cũng propagate); drive-meta merge (cache cộng dồn). `subscribeLibraryTagsRemote`/`NotesRemote`/`DriveRemote` trong [libraryMetaSync.ts](../src/libraryMetaSync.ts) + wire vào 3 hook. §7 spec. +4 test realtime.
- [x] **Dọn code file sidecar cũ** — xoá `readLegacySidecar`/seed (tags/notes), `readDriveMetaSidecar`/`writeDriveMetaSidecar`/`DRIVE_META_FILE` ([drive.ts](../src/drive.ts)), `seedLibraryTags/Notes`; bỏ `libraryDir` khỏi Args tags/notes. File `.json` cũ để nguyên trên Drive. (Không cần chờ team vì hiện 1 người dùng.)
- [x] **Help-text mục "Shared data folder"** (Settings) phản ánh vai trò mới sau migration (mốc rebase + tra Drive; metadata đã lên Firebase). i18n vi + en.
- [x] Verify: `tsc` + `npm test` (134) + file-size guard xanh. (Rules không đổi — subscribe chỉ cần `read` đã có.)

## v0.4.41 — 3 sidecar Thư viện (tags/owner · notes · drive-meta) lên Firestore ✅ Done

> Bump `0.4.40 → 0.4.41`; tag `v0.4.41`. Spec + chia PR: [library-sidecar-firestore.md](library-sidecar-firestore.md).

- [x] **PR1 — hạ tầng** [libraryMetaSync.ts](../src/libraryMetaSync.ts): read/write `envs/{env}/library/tags|notes|drive_<libId>` qua `setDoc(...,{merge:true})` deep-merge object lồng thật (không phải field-path phẳng → relPath chứa `.`/`/` không bị hiểu nhầm), namespace theo `libraryId`, `deleteField()` xoá đúng key lồng, drive-meta 1 doc/library. Export `tsToMillis` từ [sync.ts](../src/sync.ts). Test [libraryMetaSync.test.ts](../src/libraryMetaSync.test.ts) pin hành vi deep-merge (isolation theo key/library, xoá key, server timestamp).
- [x] **Rules** [firestore.rules](../firestore.rules): gộp điều kiện cho `tags`/`notes`/`drive_*` được mọi member `org()` ghi (khác `list`/`clean`/`trash` leader-only) — cùng 1 `match` block vì Firestore không tách path theo tên doc; `delete` vẫn `false`.
- [x] **PR2 — tags/owner** [useLibraryTags.ts](../src/useLibraryTags.ts): pull map theo library khi mở, ghi 1 key/lần (server-side merge, bỏ read-before-write race), localStorage mirror namespace theo `libraryId` (vá bug 2 library trùng relPath), seed một lần từ file sidecar cũ khi doc trống. Expose `firebaseUid` ra context ([useAppController.tsx](../src/useAppController.tsx)) để hook gate.
- [x] **PR3 — notes** [useLibraryNotes.ts](../src/useLibraryNotes.ts): tương tự, union theo note id (`mergeNoteArrays`) đọc mảng của đúng 1 key trước khi ghi; key rỗng → xoá key (giữ semantics sidecar cũ).
- [x] **PR4 — drive-meta** [useLibraryDrive.ts](../src/useLibraryDrive.ts): doc-per-library `drive_<libId>`, batch write `writeLibraryDriveEntries` (merge server-side), seed từ file cũ.
- [x] Migration không cần thao tác tay (seed lần đầu); chưa đăng nhập → chỉ mirror/cache cục bộ. **Chưa** xoá code file sidecar cũ (còn dùng cho seed) + **chưa** deploy rules — xem mục Dự kiến.
- [x] Verify: `tsc` + `npm test` (130) + file-size guard xanh.

## v0.4.40 — Capture thumbnail (off-screen, đúng frame + khung) · tách focus/select · icon Google Drive ✅ Done

> Bump `0.4.39 → 0.4.40`; tag `v0.4.40`.

- [x] **Capture thumbnail** — nút `Camera` trong [SpinePreviewView.tsx](../src/components/SpinePreviewView.tsx) → `useSpinePreview.captureThumbnail()` đọc pose live (skin từ `config.skin`/`skeleton.skin`, animation + `getAnimationTime`/`trackTime` từ track) + `currentViewport`, gọi `renderFramedThumbnail(assets, raw, viewport, pose)`. Đọc canvas WebGL on-screen **không tin cậy trong WebView2** (buffer không giữ ngoài render loop → `toDataURL` blank; xác nhận qua chẩn đoán `raw 3KB`), nên **render lại off-screen** (pipeline thumbnail sẵn có) rồi ghi đè cache theo `thumbKey` (L1 `thumb_cache_put` + L2 `uploadThumb`) + override map (`notifyThumb` + subscribe trong `useSpineThumbnail`) để thẻ đổi ngay, guard blank (payload < 1000B → lỗi thật). `applyPose` (set skin thẳng trên skeleton + **core** `animationState.setAnimation` để không reframe camera + gán `trackTime` + `pause`/`update`/`apply` giữ đúng frame) trong [spineRuntime.ts](../src/spineRuntime.ts). [useSpineThumbnail.ts](../src/useSpineThumbnail.ts), [useSpinePreview.ts](../src/useSpinePreview.ts).
- [x] **Tách focus (preview) khỏi select (checkbox)** — state `focused` (transient, clear khi đổi view mode) trong [useLibraryFilter.ts](../src/useLibraryFilter.ts) + `LibraryViewProps`. Click thân card → `setFocused` (không toggle checkbox); checkbox → `toggleSelected` (bulk). `LibraryInspector` render single theo `focusedEntry ?? selectedEntries[0]`, `>1` → bulk. Checkbox bỏ `opacity:0` (idle 0.85, luôn hiện) + ring `.library-card.focused`. [LibraryGrid.tsx](../src/components/LibraryGrid.tsx)/[.css](../src/components/LibraryGrid.css), [LibraryInspector.tsx](../src/components/LibraryInspector.tsx), [LibraryInventory.tsx](../src/components/LibraryInventory.tsx).
- [x] **Icon Google Drive** — asset `src/assets/google-drive.png` + component `GoogleDriveIcon` (inline-block + vertical-align middle để nằm cùng dòng với text trong `<h2>`, mirror API lucide). Áp: nút Load Drive data, menu "Quản lý phiên bản", header modal history, mục Drive account (Settings), chip [AccountBadge](../src/components/AccountBadge.tsx). [GoogleDriveIcon.tsx](../src/components/GoogleDriveIcon.tsx).
- [x] **"Owner & lịch sử" → "Quản lý phiên bản"** — đổi chuỗi chung `driveInfoTitle` (áp menu + header modal + nút inspector). Cột modal `grid-template-columns` `150px → 190px` (ngày sửa), editor `1fr` tự co ([LibraryMeta.css](../src/components/LibraryMeta.css)). Tooltip `libraryRescanHelp` cho nút Rescan. i18n `libraryThumbCapture`/`libraryThumbCaptured`/`libraryThumbCaptureFailed`.
- [x] Verify: `tsc` + `npm test` (120) + file-size guard xanh.

## v0.4.39 — Export detection chặt hơn · fix grid expand · highlight search · folder trash · Owner&history modal ✅ Done

> Bump `0.4.38 → 0.4.39`; tag `v0.4.39`. (ROADMAP nhảy từ v0.4.37 — bản 0.4.38 chỉ ghi ở CHANGELOG.)

- [x] **Export = chỉ skeleton** — `read_skeleton_meta` bỏ `.atlas` khỏi `is_artifact`; chỉ `.json`/`.skel`(+`.skel.bytes`) set `exported=true`. Folder export atlas-only (thiếu skeleton) → "chưa export". [src-tauri/src/library.rs](../src-tauri/src/library.rs).
- [x] **Fix grid expand kéo cả hàng** — `.library-grid` thêm `align-items: start` (mặc định `stretch` khiến mọi card cùng row cao theo card đang expand). [LibraryGrid.css](../src/components/LibraryGrid.css).
- [x] **Highlight keyword** — `HighlightText` (case-insensitive, bọc đoạn khớp bằng `<mark.library-hl>`) tô tên + đường dẫn khi `parsedQuery.scope` ∈ `all|path`; áp ở Grid + Table, CSS `.library-hl` ([LibraryView.css](../src/components/LibraryView.css)). Scope `anim:`/`skin:` để chip lo. [LibraryViewShared.tsx](../src/components/LibraryViewShared.tsx), [LibraryGrid.tsx](../src/components/LibraryGrid.tsx), [LibraryTable.tsx](../src/components/LibraryTable.tsx).
- [x] **Folder trash (1 đơn vị)** — trash set chứa thêm key `dir:{topFolder}` (tương thích `string[]` sync sẵn, không đổi schema Firestore); `isEntryTrashed` ẩn entry theo `relPath` ∪ `dir:`; thêm `addFolderToTrash`/`restoreFolderFromTrash` + dẫn xuất `trashedFolders`/`trashedFiles` ([useLibrary.ts](../src/useLibrary.ts)). Section-menu action chỉ hiện ở facet `folder` (`onMoveSectionToTrash`) — [LibraryRowMenu.tsx](../src/components/LibraryRowMenu.tsx) + Grid/Table. Modal liệt kê folder (kèm số file) + file lẻ ([LibraryTrashModal.tsx](../src/components/LibraryTrashModal.tsx)). i18n `libraryMoveFolderToTrash`.
- [x] **Owner & history → modal** — `LibraryDriveHistoryModal` mới (tái dùng `LibraryDriveInfoPanel` + chrome modal); bỏ panel inline ở Grid/Table/Inspector, thay bằng `onDriveHistory`/`loadDriveInfo` mở modal; gỡ `expandedInfo`/`toggleDriveInfo` + wrapper `LibraryDriveInfoRow` (dead). Lịch sử version dạng **bảng** (cột `v{n}` + badge "Mới nhất", canh cột, kẻ dòng) — i18n `driveColVersion`/`driveColSize`/`driveLatest`. Gom modal Inventory vào [LibraryInventoryModals.tsx](../src/components/LibraryInventoryModals.tsx) để `LibraryInventory` < 800 dòng ([[keep-files-small]]). [LibraryDriveHistoryModal.tsx](../src/components/LibraryDriveHistoryModal.tsx), [useLibraryDrive.ts](../src/useLibraryDrive.ts), [LibraryInspector.tsx](../src/components/LibraryInspector.tsx).
- [x] Verify: `tsc` + `npm test` (120) + `cargo check` + file-size guard xanh.

## v0.4.37 — Báo cáo giữ kết quả + badge số lượng · badge cảnh báo nhóm gộp đủ loại · bố cục lại thẻ Lưới ✅ Done

> Bump `0.4.36 → 0.4.37`; tag `v0.4.37`. (ROADMAP nhảy từ v0.4.29 — các bản 0.4.30–0.4.36 chỉ ghi ở CHANGELOG.)

- [x] **Tab Báo cáo: lift health-batch lên cha** — `useHealthBatch(included)` chuyển từ trong `MissingAttachmentsReport`/`DuplicateAtlasesReport` (unmount khi đổi sub-tab → mất data) lên `LibraryReports`; một lượt quét dùng chung, chỉ reset khi `included` đổi. Badge số lượng cho Missing (`missingCount`) + Duplicate (`duplicateCount`), tổng `totalCount` đẩy lên `LibraryView` qua `onReportTotal` → badge trên tiêu đề tab. [LibraryReports.tsx](../src/components/LibraryReports.tsx), [LibraryView.tsx](../src/components/LibraryView.tsx), [LibraryView.css](../src/components/LibraryView.css).
- [x] **Badge cảnh báo nhóm** — `groupWarningCount(entries, thresholds, statusOf)` đếm file dính oversize (`hasAnyWarning`) ∪ lệch version (majority trong nhóm, dùng `minorKey`) ∪ needs-review (`statusOf === 'warning'`), mỗi file tính một lần. Badge hiện khi `warnCount > 0`; ẩn icon clean-status `warning` thừa khi đã có badge; số lượng asset thành chip `.library-count-chip` (icon `Layers`). i18n `libraryGroupWarnings`. [library.ts](../src/library.ts), [LibraryGrid.tsx](../src/components/LibraryGrid.tsx), [LibraryTable.tsx](../src/components/LibraryTable.tsx).
- [x] **Bố cục thẻ Lưới** — stat .spine/ảnh/anim thành chip pill; meta-row (version · used-by · .spine · ảnh) tách khỏi `.library-card-animrow` (anim riêng một hàng); cụm anim/skin mở rộng bọc trong panel `.library-card-anims`. Path thành chip (`.library-card-path-chip`) với icon `Folder` + đường dẫn đầy đủ (bỏ truncate `.../`) + nút copy (`navigator.clipboard` + toast). i18n `libraryCopyPath`/`libraryCopiedPath`. [LibraryGrid.tsx](../src/components/LibraryGrid.tsx), [LibraryGrid.css](../src/components/LibraryGrid.css).
- [x] Verify: `tsc` xanh.

## v0.4.29 — Inventory: invert search + `path:` scope + per-library filter + chip preview + Trash (sync) ✅ Done

> Bump `0.4.28 → 0.4.29`; tag `v0.4.29`. (ROADMAP nhảy từ v0.4.22 — các bản 0.4.23–0.4.28 chỉ ghi ở CHANGELOG.)

- [x] **Invert search** — `invert` (persistent) trong [useLibraryFilter.ts](../src/useLibraryFilter.ts); `entryMatchesFilter` đảo kết quả `entryMatchesQuery` khi `invert` và term không rỗng (term rỗng → match tất cả, không đảo). Nút toggle `SearchX` trong ô search, truyền `invert` vào cả Inventory & Clean. [library.ts](../src/library.ts), [LibraryInventory.tsx](../src/components/LibraryInventory.tsx), [LibraryClean.tsx](../src/components/LibraryClean.tsx).
- [x] **Scope `path:`** — `SearchScope` thêm `'path'`; `parseQuery` regex `(anim|animation|skin|path)`; `entryMatchesQuery` trả riêng `relPath.includes`. `matchedNames` không tô chip cho path. [library.ts](../src/library.ts).
- [x] **Filter theo từng library** — `useLibraryFilter(libraryId)` namespace key `libraryFilter.<id>.*`; `LibraryView` tách `LibraryContent` render `key={activeLibraryId}` để remount → reload đúng namespace (vì `usePersistentState` chỉ đọc localStorage lúc mount). [LibraryView.tsx](../src/components/LibraryView.tsx).
- [x] **Chip preview + overflow popup** — tách `MenuPopover` ra [MenuPopover.tsx](../src/components/MenuPopover.tsx) (dùng chung với row-menu); `filtersPreview` hiện ≤4 chip removable + nút `… +k` mở popover liệt kê hết. [LibraryInventory.tsx](../src/components/LibraryInventory.tsx), [LibraryFilters.css](../src/components/LibraryFilters.css).
- [x] **Trash per-library + sync team** — định danh `relPath`; persist `spineforge.libraryTrash.<id>` ([sessions.ts](../src/sessions.ts)); `useLibrary` lọc trashed khỏi `libraryScan`, `addToTrash`/`restoreFromTrash`/`reloadTrash` + toast "đã ẩn n" sau scan thủ công ([useLibrary.ts](../src/useLibrary.ts)). Row-menu "Chuyển vào thùng rác" + modal khôi phục ([LibraryTrashModal.tsx](../src/components/LibraryTrashModal.tsx)). Sync: `LibraryTrashProfile` doc `library/trash` (relPath portable, không cần anchor) mirror clean-state — build/apply/same/read/write/subscribe trong [sync.ts](../src/sync.ts); push/reconcile/realtime + `onRemoteTrashApplied` trong [useSync.ts](../src/useSync.ts) → `reloadTrash` ([useAppController.tsx](../src/useAppController.tsx)). Rule `library/{doc}` đã bao doc mới.
- [x] Verify: `tsc` + `npm test` (120) + `npm run build` (file-size guard, tách `MenuPopover`/`LibraryTrashModal`) xanh.

## v0.4.22 — Inventory: nhớ filter/search qua tab + filter "Status" độc lập + dọn icon bảng ✅ Done

> Bump `0.4.21 → 0.4.22`; tag `v0.4.22`. (ROADMAP nhảy từ v0.4.16 — các bản 0.4.17–0.4.21 chỉ ghi ở CHANGELOG.)

- [x] **Persist filter/search qua chuyển tab** — `LibraryView` (và `LibraryInventory`) unmount khi rời `viewMode === 'library'` nên state lọc/search reset. Thêm hook `usePersistentState` + `usePersistentSet` (localStorage, nuốt lỗi quota; `Set` memo theo `arr` để identity ổn định). Áp cho facet/cats/versions/query trong [useLibraryFilter.ts](../src/useLibraryFilter.ts) và các chip cục bộ (unusedOnly/divergingOnly/showResolved/tags/users/statuses) trong [LibraryInventory.tsx](../src/components/LibraryInventory.tsx). [usePersistentState.ts](../src/usePersistentState.ts).
- [x] **Filter "Status" độc lập với facet** — `selectedStatuses` (Set, multi-select OR) lọc theo `statusOf` (`not-exported | unknown | warning | clean`), kết hợp với mọi facet/search/chip. Chip + nhãn dùng lại `groupByStatus`/`statusLabel`. Tự ẩn + bỏ qua khi `facet === 'status'` (chip category đã làm việc đó). Nhãn `libraryFilterStatus`. [LibraryInventory.tsx](../src/components/LibraryInventory.tsx), [library.ts](../src/library.ts).
- [x] **Chế độ Bảng: bỏ `SpineFileIcon` lặp ở cột `.spine` mỗi dòng** (đã có ở header), giữ `AlertTriangle` khi nặng. [LibraryTable.tsx](../src/components/LibraryTable.tsx).
- [x] Verify: `tsc` xanh.

## v0.4.16 — Inventory "By status" group + sửa filter Show-resolved-notes + icon thẻ Lưới ✅ Done

> Bump `0.4.15 → 0.4.16`; tag `v0.4.16`.

- [x] **Nhóm "By status"** — facet thứ ba `'status'` (cạnh `folder`/`id`), key thô `'unknown' | 'warning' | 'clean'`, sắp xếp theo triage rank Chưa scan → Cần kiểm tra → Đã clean (`STATUS_RANK`). `groupByStatus(entries, statusOf)` + `entryMatchesFilter` nhận `statusOf` (host bơm `libraryCleanState`). Chip/section dịch nhãn qua `libraryStat*`. Facet dùng chung nên [LibraryClean.tsx](../src/components/LibraryClean.tsx) cũng xử lý `status`. [library.ts](../src/library.ts), [useLibraryFilter.ts](../src/useLibraryFilter.ts), [LibraryInventory.tsx](../src/components/LibraryInventory.tsx).
- [x] **Filter "Show resolved notes" thành filter thật + toggle trong popup** — badge/highlight đổi sang `noteCount` = chỉ-chưa-resolved khi tắt, đếm-tất-cả khi bật (host quyết qua `showResolved`). Prop view `unresolvedNotes` → `noteCount`. Thêm `noteCount`/`countForKey` helper + toggle `CheckCircle2` ở header [NotesModal.tsx](../src/components/NotesModal.tsx) (chung state với nút thanh lọc). [library.ts](../src/library.ts), [useLibraryNotes.ts](../src/useLibraryNotes.ts), [LibraryViewShared.tsx](../src/components/LibraryViewShared.tsx).
- [x] **Icon thẻ Lưới** — `User` cạnh owner, `Clock` cạnh thời gian sửa ở `.library-card-foot`. [LibraryGrid.tsx](../src/components/LibraryGrid.tsx), [LibraryGrid.css](../src/components/LibraryGrid.css).
- [x] Verify: `tsc` + `npm test` (109, thêm test `groupByStatus`/`noteCount`) xanh.

## v0.4.15 — Drive "Load data": timeout + song song giới hạn + retry/backoff + cache ID bền ✅ Done

> Bump `0.4.14 → 0.4.15`; tag `v0.4.15`. (ROADMAP nhảy từ v0.4.9 — các bản 0.4.10–0.4.14 chỉ ghi ở CHANGELOG.)

- [x] **Timeout mọi call Drive REST** — `drive_client()` (connect 15s / total 30s) dùng cho toàn bộ read-path + sign-in. Sửa root cause: một socket stall trước đây treo cả batch vĩnh viễn → "Tải dữ liệu Drive" chạy 5–10p rồi trả rỗng, timestamp không set. [drive/mod.rs](../src-tauri/src/drive/mod.rs).
- [x] **Fan-out song song có giới hạn** — `futures::stream::buffer_unordered` (concurrency 8), warm cache 1 lookup tuần tự trước khi fan-out để tránh trùng request folder gốc. Event `drive-basics-progress {done,total}` → nút hiện N/total thay vì spinner câm. [useLibraryDrive.ts](../src/useLibraryDrive.ts), [LibraryInventory.tsx](../src/components/LibraryInventory.tsx).
- [x] **Retry + truncated exponential backoff** (1→16s + jitter, ≤5 lần) cho `429` và rate-limit `403` theo guidance Google; `send_with_retry` bọc toàn read-path; permission-403/404 trả ngay không retry. [drive/mod.rs](../src-tauri/src/drive/mod.rs).
- [x] **Cache `path → Drive ID` bền giữa session** (`app_cache_dir/drive-folder-ids.json`): lần load sau gần như chỉ còn `files.get` (5 units) thay vì `files.list` (100 units). Self-heal khi ID stale (folder/file xóa+tạo lại): lookup "not found" → xóa prefix cache + resolve cold 1 lần. Xóa cache khi sign-out. [drive/mod.rs](../src-tauri/src/drive/mod.rs).
- [x] **Tách `drive.rs` (978 dòng > ceiling 800) → `drive/mod.rs` (REST metadata) + `drive/auth.rs` (OAuth/token/keyring/loopback)** ([[keep-files-small]]). [drive/auth.rs](../src-tauri/src/drive/auth.rs).
- [x] Verify: `cargo check` + `tsc` + `npm test` + `npm run build` (file-size guard) xanh.

## v0.4.9 — Sync feedback + Cleanup scan motion + dev/prod data split + user filter ✅ Done

> Bump `0.4.8 → 0.4.9`; tag `v0.4.9`.

- [x] **Phản hồi đồng bộ rõ hơn**: dòng trạng thái transient dưới nút tài khoản (chỉ khi pending/syncing/error, tự ẩn khi synced); toast "Đang tải workspace mới nhất…" + delay trước khi reconcile reload (kèm `reloadingRef` chặn ghi trong lúc chờ). [AccountBadge.tsx](../src/components/AccountBadge.tsx), [useSync.ts](../src/useSync.ts).
- [x] **Tab "Dọn ảnh": overlay chặn khi quét/dọn** — tách `LibraryScanningOverlay` dùng chung (Inventory empty-state + Cleanup overlay); `working` → `busyLabel`. [LibraryScanningOverlay.tsx](../src/components/LibraryScanningOverlay.tsx), [LibraryClean.tsx](../src/components/LibraryClean.tsx).
- [x] **Tách data dev/prod**: `resolve_app_data_dir` thêm subfolder `dev` khi `cfg!(debug_assertions)` → `tauri dev` ghi `spine_app_data\dev\…`, `tauri build` ghi root (cùng gmail). Badge "dev" ở titlebar khi `import.meta.env.DEV`. [system.rs](../src-tauri/src/system.rs), [Titlebar.tsx](../src/components/Titlebar.tsx).
- [x] **Lọc theo người dùng** ở hàng "Used by": chip "Người dùng" theo owner hiệu lực (đặt tay / Drive owner-editor), multi-select + count. [LibraryInventory.tsx](../src/components/LibraryInventory.tsx).
- [x] Verify: `tsc` + `npm test` (85) + `npm run build` + `cargo check` xanh.

## v0.4.8 — Shared app-data root + sync v2 (per-user workspace, shared library) ✅ Done

> Bump `0.4.7 → 0.4.8`; tag `v0.4.8`. Chi tiết sync: [sync.md](sync.md).

- [x] **App-data root cố định, tự dò**: `…\Shared drives\Pamvis\spine_app_data` qua Rust `system::resolve_app_data_dir` + hook `src/useAppData.ts`; banner cảnh báo trong tab Thư viện khi không mount được ([spine-app-data-path](../../memory)).
- [x] **Thumbnail dùng chung qua Drive**: cache `spine_app_data/thumbs`, key theo `relPath`+size+version (độc lập máy); fallback `app_cache_dir` khi không có Drive. `thumb_cache_get/put` nhận `dir`.
- [x] **Sync v2** — bỏ picker chọn folder; tách **workspace per-user** (`workspaces/<emailSlug>/profile.json`, theo email Google, cần đăng nhập) khỏi **library dùng chung** (`library/libraries.json` + sidecar tag/owner + drive-meta + thumbs). `sync.ts` tách build/apply workspace+library; `useSync` reconcile kép (timestamp riêng mỗi scope), thêm `syncNeedsSignIn`. `useLibraryTags`/`useLibraryDrive` nhận `libraryDir`.
- [x] Verify: `tsc` + `npm test` (85) + `npm run build` xanh.

## v0.4.7 — Inventory thumbnails (phase 2) + UI polish + sync dot merge ✅ Done

> Bump `0.4.6 → 0.4.7`; tag `v0.4.7`.

- [x] **B4 phase 2 — thumbnail skeleton thật trên card Lưới**: render off-screen bằng Spine player (`preserveDrawingBuffer` → `toDataURL`), queue 1-slot tránh cạn WebGL context, lazy bằng IntersectionObserver + debounce; reject ảnh trống. Hook `useSpineThumbnail` + `spineRuntime.ts` (tách loader dùng chung với preview modal) + `LibraryCardThumb`. Nút 👁 dời lên góc thumbnail.
- [x] **Polish UI Inventory**: stat card gọn, segmented control active đổi xanh-lá → **primary**, header/footer có nền tách list, chip lọc gọn, table header/group row dịu, grid card bo 8px + hover nhấc nhẹ; badge/tag/pill về token `--primary`.
- [x] **Gộp chấm sync vào nút tài khoản** (bỏ `SyncStatusDot` ở titlebar) — pip trạng thái nằm trên `AccountBadge` ở sidebar.

---

## v0.4.6 — Library UI: Card/Grid view + dọn tab ✅ Done

> Bump `0.4.5 → 0.4.6`; tag `v0.4.6`. Polish UI tab Library (không đổi backend).

- [x] **Card/Grid view cho Inventory (B4 phase 1)**: toggle **Bảng / Lưới** (lưu `appConfig.libraryViewMode`, nhớ qua restart). Tách host giữ 1 nguồn sự thật → `LibraryTable` + `LibraryGrid` cùng nhận `LibraryViewProps` (không desync tag/owner/drive); helper/type chung ở `LibraryViewShared.tsx`. Tách button-only (`LibraryPreviewButton`, `LibraryRowMenuButton`, `LibraryDriveInfoPanel`) để bảng & card chung markup. Card giữ group header theo folder/id (thanh tint nhẹ + viền), cụm action 👁/⋯ dồn góc phải hiện-khi-hover, panel Drive stack dọc vừa card. Chưa có thumbnail (để phase 2). Grid có dropdown sort riêng; `LibraryInventory` 799 → 477 dòng.
- [x] **Gộp tab "Phiên bản" vào Inventory**: thay bằng chip lọc **"Lệch version"** (helper thuần `divergingFileSet` trong `library.ts`), chỉ hiện khi có folder lẫn version. Xóa `LibraryVersion.tsx`/CSS + key i18n mồ côi.
- [x] **Bỏ tab "Coverage"** (placeholder); **đổi tên tab "Ảnh thừa" → "Dọn ảnh"**; **sidebar Library thêm icon thư mục** cho đồng bộ với Workspace.
- [x] Verify: `tsc` + `npm test` (82) + `npm run build` (file-size guard) xanh.

> Phase 2 (chưa làm): render thumbnail thật cho card (offscreen Spine player → cache sidecar PNG); cân nhắc virtualize khi list lớn.

## v0.4.5 — Spine Hub Tier C (5): Preview skeleton thật ✅ Done

> Bump `0.4.4 → 0.4.5`; tag `v0.4.5`. Plan: [spine-hub-tier-c.md](spine-hub-tier-c.md) mục 5 — Tier C hoàn tất.

- [x] **Tier C #5 — Preview skeleton thật**: nút 👁 ở cột riêng mỗi dòng đã export → modal `LibrarySpinePreviewModal` render skeleton bằng Spine web player (dropdown animation + skin + timeline có sẵn). Backend `list_export_assets` (quét export/ex, detect version json/skel, lấy atlas + pages) + `read_file_data_url` generic ([library.rs](../src-tauri/src/library.rs), [system.rs](../src-tauri/src/system.rs)); feed local qua `rawDataURIs`. Hai runtime khoá theo version: npm `@esotericsoftware/spine-player@4.3` cho 4.x + **vendor bản 3.8 prebuilt** trong `public/spine-player-3.8/` (npm không có 3.8); chọn runtime theo version, nạp lazy. CSP thêm `data:` vào `connect-src`. Hook `useSpinePreview` + cell tách `LibraryPreviewCell` (giữ LibraryInventory dưới guard).
- [x] **Cửa sổ mặc định rộng +50%** (width 980 → 1470) trong [tauri.conf.json](../src-tauri/tauri.conf.json).
- [x] **Settings mở từ nút Sync / tài khoản tự bung mục Sync**: `openSettings(focusSync)` trong [useAppController.tsx](../src/useAppController.tsx); AccountBadge (gồm chấm sync)/Drive-opener dùng `openSettings(true)`, nút bánh răng dùng `openSettings(false)`.

---

## v0.4.4 — Spine Hub Tier C (3+4): Used-by-projects & tags/ownership ✅ Done

> Bump `0.4.3 → 0.4.4`; tag `v0.4.4`. Plan: [spine-hub-tier-c.md](spine-hub-tier-c.md) mục 3 & 4. Frontend-only trên dữ liệu scan + session sẵn có.

- [x] **Tier C #3 — Used-by-projects**: hàm thuần `usageByEntry(entries, sessions)` + `normalizePath` trong [src/library.ts](src/library.ts) (khớp `entry.spineFile` vs `session.config.inputFiles`, normalize `\`→`/` + lowercase). UI: badge "Dùng bởi N" trong cột File (tooltip `Project › Session`, bấm → nhảy tới session); bộ lọc chip **"Chỉ file chưa dùng"** (tìm asset mồ côi).
- [x] **Tier C #4 — Tags / ownership**: helper thuần trong `library.ts` (`EntryMeta`/`LibraryMeta`, `addTag/removeTag/setOwner/allTags/entryMatchesTags`, key=`relPath`). **Lưu qua sidecar `spineforge-library-meta.json`** (merge-before-write như Drive-meta v0.4.2) thay vì `SyncProfile` → không đụng schema sync lõi, không clobber khi nhiều người sửa, team-shared. State+IO: `src/useLibraryTags.ts`. UI: cột **Tag** (`LibraryTagCell.tsx` chip + thêm inline) + hàng lọc theo tag; cột **Owner** gộp owner thủ công (sửa inline `LibraryOwnerCell.tsx`) lên trên owner Drive Tier B.
- [x] **Polish UI**: nút đóng (✕) cho panel Owner & history (`LibraryDriveInfoRow.tsx`); cân lại width cột cho cột File rộng hơn; thêm dòng "Tải Drive lần cuối" dưới "Lần quét cuối". Tách `LibraryRowMenu.tsx` + CSS `LibraryMeta.css` để giữ `LibraryInventory` dưới mốc 800 dòng.
- [x] Verify: `tsc` + `npm test` (82, +12) + `npm run build` (file-size guard pass) xanh.

## v0.4.3 — Spine Hub Tier C (1+2): Library search & version ✅ Done

> Bump `0.4.2 → 0.4.3`; tag `v0.4.3`. Plan: [spine-hub-tier-c.md](spine-hub-tier-c.md) mục 1 & 2. Frontend-only trên dữ liệu scan sẵn có.

- [x] **Tier C #1 — Search theo animation / skin**: query Library nhận cú pháp scope `anim:attack` / `skin:red` (mặc định `all` = path + anim + skin như cũ). Tách `parseQuery`/`entryMatchesQuery`/`matchedNames` thuần trong [src/library.ts](src/library.ts); chip animation/skin khớp được tô sáng (class `.matched`) + panel tự bung khi có khớp. Placeholder search gợi ý cú pháp.
- [x] **Tier C #1b — đọc anim/skin từ export binary `.skel.bytes`**: trước chỉ đọc từ `.json` skeleton nên export binary (Unity, 3.8) không có anim/skin để search. Thêm `src-tauri/src/skel_binary.rs` — port phần đọc của spine-runtimes 3.8 `SkeletonBinary` (chỉ bóc tên skin + animation, consume hết các block khác). Validate **byte-exact** trên file thật (cursor dừng đúng EOF) + đối chiếu parser tham chiếu Python. `library::read_skeleton_meta` gọi parser cho file `.skel*` khi không có `.json`; 4.x/file hỏng → bỏ qua (vẫn tính exported). 3 unit test + 1 fixture test `#[ignore]` qua `SPINE_SKEL_FIXTURE`.
- [x] **Tier C #2 — Version-mix panel**: tab **Phiên bản** mới (`LibraryVersion.tsx` + CSS riêng) — StatCard phân bố version + đếm nhóm lẫn version, liệt kê từng nhóm `mixedVersion` với version **chính (majority)** và cờ `diverges` cho file lệch, kèm filter "chỉ hiện file lệch version". Hàm thuần `versionMixGroups` trong `library.ts`.
- [x] **Polish UI bảng Library + titlebar**: double-click titlebar → `toggleMaximize` (sửa race với `startDragging`); sticky header/group-row hết hở khi cuộn (đo header bằng JS cho `--lib-thead-h`, bỏ `padding-top` vùng cuộn, group-row gộp 1 ô `colSpan=8`); tên file luôn hiện đầy đủ (`splitRelPath`: dir co + name cố định); cân lại width cột (owner/modified cố định, actions 144→60, File co giãn); `scrollbar-gutter: stable` cho head/foot khớp mép cột với bảng.
- [x] Verify: `tsc` + `npm test` (70, +12) + `npm run build` (file-size guard pass) + `cargo test` (+3 skel) + clippy (không warning mới) xanh.

---

## v0.4.1 — Fix đăng nhập Google Drive mất sau khi thoát app ✅ Done

> Bump `0.4.0 → 0.4.1`; tag `v0.4.1`.

- [x] **Fix keyring**: `keyring` v3 không bật backend nào theo mặc định → rơi về mock store in-memory, refresh token mất khi thoát app (phải đăng nhập lại mỗi lần mở). Bật feature `windows-native` (Windows Credential Manager) → token sống qua các phiên.

---

## v0.4.0 — Spine Hub Tier B: Google Drive API (owner / lịch sử / version) ✅ Done

> Bump `0.3.9 → 0.4.0`; tag `v0.4.0`. Chi tiết: [sync.md](sync.md) §7.

- [x] **OAuth installed-app** (loopback 127.0.0.1 + PKCE), client nhúng sẵn; refresh token trong Windows Credential Manager; toàn bộ HTTP gọi Drive ở Rust (`reqwest`) → không đổi `connect-src` CSP (chỉ mở `img-src` cho avatar). Scope **`drive.readonly`** (bắt buộc cho `drives.list`).
- [x] **Panel Owner & lịch sử** mỗi file (lazy fetch): người sửa cuối, thời gian, danh sách revision. **Mở revision cũ trong Spine** (tải bản tạm) để truy vết regression.
- [x] **Dashboard**: nút "Tải dữ liệu Drive" → cột **Người sửa / Sửa lần cuối** sort được, tô nổi file đổi < 7 ngày.
- [x] **Badge tài khoản** góc dưới trái (đăng nhập trực tiếp); luồng đăng nhập có nút **Hủy** (không kẹt loading nếu đóng browser giữa chừng).
- [x] **Polish chung**: ngày dd/mm/yyyy toàn app; gom nút mỗi dòng Library vào menu **⋯**; mở URL OAuth qua `rundll32` (cmd `start` cắt `&`).
- [x] Build creds qua `SPINEFORGE_GOOGLE_CLIENT_ID/SECRET` (local `.cargo/config.toml`, GitHub Secrets ở CI).
- [x] Verify: `cargo check` + clippy + `tsc` + `npm test` (58) + `npm run build` xanh.

---

## v0.3.8/v0.3.9 — Spine Hub: Sync (Tier A) + binary preset + Library polish ✅ Done

> Đã release (Tier A ship ở v0.3.8; v0.3.9 fix gốc Drive ảo). Bối cảnh: Library tab đang lớn thành "Spine Hub" — quản lý source spine dùng chung; animator làm xen kẽ công ty/nhà qua Google Drive. Plan 3 tầng A/B/C.

- [x] **Sync Tier A (file-based)** — mirror project/session/config vào `spineforge-profile.json` trong gốc Google Drive chung; token `${SPINE_ROOT}` + rebase per-máy. `src/sync.ts` (logic thuần) + `src/useSync.ts` (reconcile newer-wins, debounce, auto-detect) wire trong `useAppController`. Backend `system::read_text_file` + `detect_drive_root`. Chi tiết: [sync.md](sync.md).
- [x] **Gộp folder + Spine root thành một gốc Drive**, toggle **mặc định ON**, **tự dò** `<ổ>:\Shared drives` (cảnh báo nếu fail). Setting cũ migrate sang `root` mới.
- [x] **Chấm trạng thái** global xám/vàng/xanh/đỏ (gộp vào nút tài khoản ở sidebar; trước đây là dot riêng trên titlebar) + Settings ▸ Sync (layout riêng). Guard chống máy mới đè dữ liệu rỗng + fix dot kẹt "pending" (ổn định identity callback).
- [x] **Base preset mặc định binary+pack** (`defaultExportPreset`).
- [x] **Fix Library header bị dòng cuộn đè** (`border-collapse: separate`); group-row sticky tầng dưới header.
- [x] Verify: `tsc` + `npm test` (47) + `cargo check` + `npm run build` xanh.
- [x] **Tier B — Google Drive API** → đã làm, xem **v0.4.0** ở trên.
- [x] **Tier C — Spine Hub roadmap** → plan: **[spine-hub-tier-c.md](spine-hub-tier-c.md)**. #1 search anim/skin + #2 version-mix panel **xong ở v0.4.3**; #3 used-by-projects + #4 tags/ownership **xong ở v0.4.4**; #5 preview skeleton thật **xong ở v0.4.5** → Tier C hoàn tất.
- [ ] (Tạm hoãn) **Multi-root mapping** — khi source trải nhiều mount khác hẳn nhau; hiện dùng cha chung `G:\Shared drives` là đủ.

## v0.3.6 — Chuyển CI/CD GitLab → GitHub Actions ✅ Done

> Bump `0.3.5 → 0.3.6`; tag `v0.3.6`.

**Bối cảnh:** repo đã dời từ GitLab sang GitHub. Quy trình release viết lại quanh GitHub Actions + `tauri-action` thay cho pipeline PowerShell thủ công của GitLab.

- [x] **Workflow mới** (`.github/workflows/release.yml`): trigger `push` tag `v*.*.*`, runner `windows-latest`, dùng `tauri-apps/tauri-action` build NSIS → tạo Release → đính installer + `.sig` + `latest.json` (`includeUpdaterJson`). Release notes trích từ `CHANGELOG.md` qua bước PowerShell ghi ra `$GITHUB_OUTPUT` (UTF-8). Xoá `.gitlab-ci.yml`.
- [x] **Đổi endpoint auto-updater** (`tauri.conf.json`) và `releasesUrl` (`src/config.ts`) sang GitHub Releases; `SECURITY.md` đổi kênh báo lỗ hổng sang GitHub issues.
- [x] **README song ngữ**: tách thành hai phần English / Tiếng Việt + thêm mục Release & CI/CD.
- [x] **Secrets GitHub**: `TAURI_SIGNING_PRIVATE_KEY` + `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (đã thêm trên repo).

## v0.3.5 — Inter self-host + siết CSP (bỏ Google Fonts) ✅ Done

> Bump `0.3.4 → 0.3.5`; tag `v0.3.5`.

**Bối cảnh:** nối tiếp v0.3.4 — Google Fonts là dependency mạng duy nhất còn lại và là lý do CSP phải mở 2 domain Google. Self-host font để app offline-safe, không FOUT, CSP gọn hơn.

- [x] **Đổi sang Inter, self-host** (`src/assets/fonts/InterVariable.woff2`, ~352KB variable 100–900, có dấu tiếng Việt): `@font-face` local trong `styles.css`, `font-family` ưu tiên `Inter`; bỏ dòng `@import` Google Fonts. Dùng chung cho en + vi.
- [x] **Siết CSP** (`tauri.conf.json`): `font-src 'self'`, `style-src 'self' 'unsafe-inline'` — gỡ `fonts.googleapis.com`/`fonts.gstatic.com`.
- [x] **`Inter-LICENSE.txt`** (SIL OFL 1.1) kèm theo font.

## v0.3.4 — Bật CSP + LICENSE/SECURITY.md (chuẩn bị public repo) ✅ Done

> Bump `0.3.3 → 0.3.4`; tag `v0.3.4`.

**Bối cảnh:** rà soát bảo mật trước khi chuyển repo GitLab sang public. Không lộ secret (token CI qua biến môi trường, pubkey updater vốn công khai, không có key file nào bị track), lệnh CLI an toàn (không qua shell). Khe hở chính: CSP để `null`.

- [x] **Bật CSP** (`src-tauri/tauri.conf.json` `app.security.csp`): `default-src 'self'` + mở đúng nhu cầu (data/blob/asset cho thumbnail, unsafe-inline + Google Fonts cho font, ipc/asset.localhost cho IPC). Defense-in-depth cho các lệnh ghi/xoá file trên path tuỳ ý.
- [x] **LICENSE (MIT)** + `license` field trong `package.json` & `Cargo.toml`.
- [x] **SECURITY.md**: hướng dẫn báo lỗ hổng riêng qua email, supported versions, scope (loại trừ lỗi của Spine editor).
- [x] **Việc thủ công còn lại trước khi public**: GitHub Actions secrets (`TAURI_SIGNING_PRIVATE_KEY`, `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`) **đã thêm** (các release v0.4.x build/ký qua `tauri-action` trên `windows-latest` chạy tốt → CSP + auto-updater đã xác nhận).

## v0.2.27 — Fix excluded-file overlap + icon trùng per-file trong Input ✅ Done

> Bump `0.2.26 → 0.2.27`; tag `v0.2.27`.

**Bối cảnh:** hai edge case sau v0.2.25/26: (1) file đã loại khỏi export vẫn làm badge sáng; (2) badge ở cấp session không chỉ rõ file nào trùng.

- [x] **Fix exclusion leak** (`src/sessionStatus.ts` `probeSession`): lọc `excludedFiles` cho mọi nguồn file (runtime cache / `inputFiles` / scan), không chỉ nhánh scan. Cache runtime của session đang mở có thể giữ snapshot trước khi loại → trước đây lọt.
- [x] **Per-file shared-input map** (`computeOverlaps` → trả thêm `SharedInputMap`: `sessionId → file → otherSessionIds[]`). Lưu state `sharedInputFiles`, expose qua context.
- [x] **Icon per-file trong InputSection** (`src/components/workspace/InputSection.tsx`): dòng file có icon `AlertTriangle` hổ phách nếu file nằm ở session khác cùng dự án; tooltip `sharedWithSessions` nêu tên các session. CSS tách ra `InputSection.css` (styles.css sát trần). Chỉ tín hiệu chung-input; trùng output vẫn ở badge session.
- [x] **i18n** `sharedWithSessions` (vi + en).

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
- [x] Hook-level tests (React Testing Library): session isolation (P3/P4), log routing khi switch session (P14) — [useAppController.test.tsx](../src/useAppController.test.tsx)

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

## v0.3.x — Refactor & dọn nợ kỹ thuật ✅ Done

> Mục tiêu: tách file vượt trần, gom duplication, **không đổi hành vi user-facing**.
> Mỗi bản giữ `cargo test` + `npm test` + `npm run build` xanh, file-size guard pass.
> Bối cảnh: sau nhiều feature v0.2.x, các điểm vượt chuẩn: `useAppController.tsx` (1689 dòng, grandfather 1701), `i18n.ts` (727), `lib.rs` (2562, miễn guard) + duplication backend (path-trim 25+, error-to-string 23+, parallel-scheduler lặp). macOS Support dời xuống v0.5.0.

- [x] **v0.3.0 — Tách god-hook `useAppController` theo domain** ✅: `useWorkspace` (dự án/session + runtime + vòng đời + config-updater + recordRun), `useScanInput`, `useExportEngine`, `useSpineDetection`, `useLinkedProjects` + helper thuần `controllerHelpers`. `useAppControllerValue` compose lại, **giữ nguyên context API** (`useApp()`). `useAppController.tsx` 1689 → **636 dòng**; đã gỡ baseline grandfather trong `scripts/check-file-size.mjs`. `tsc` + 26 test frontend + `cargo test` + build xanh; không đổi hành vi user-facing.
- [x] **v0.3.1 — Backend: gom duplication** ✅: `src/paths.rs` (`parse_quoted_path`/`unquote`, `path_to_string`, `has_non_ascii`, `normalize_pack_source`) — gom ~24 chỗ lặp `PathBuf::from(x.trim_matches('"'))`; `src/error.rs` `ResultExt` (`.str_err()` + `.context()`) thay ~40 lần `.map_err(|e| e.to_string())` / `format!`; `src/concurrent.rs` `run_indexed` (semaphore + `JoinSet` + counter hoàn thành + stop-gate) dùng chung cho `start_batch_export` và `run_clean_units` (xoá ~25 dòng boilerplate mỗi nơi). Không đổi hành vi user-facing; `cargo test` 58 (+2 unit test `paths`) + frontend 26 + build + clippy (không warning mới) xanh.
- [x] **v0.3.2 — i18n split + chẻ modal lớn** ✅: `i18n.ts` (727) → `i18n/{vi,en,types,index}.ts` (giữ API `./i18n`; `en: Translations` ép khớp key với `vi`). `CleanSourceFolderModal` (467→318) → `cleanSource/{CleanSourcePicker,CleanSourceTable,CleanSourceScanOverlay,helpers}`. `PresetEditorModal` (376→117) → `preset/PresetFormTab` (280). Không đổi hành vi; `tsc` + frontend 26 + `cargo test` 58 + build + file-size guard (76 files) xanh.
- [x] **v0.3.3 — `lib.rs` → tách module theo nhóm** ✅: `lib.rs` (~2784) chẻ thành `model.rs` (kiểu dữ liệu, 277), `util.rs` (helper lá, 333), `export.rs` (engine + plan + lệnh collision, 681), `clean.rs` (clean-source + lệnh, 527), `tests.rs` (unit/property test, 591). `lib.rs` còn **449 dòng** (lệnh nhỏ + `run()`). Đã **gỡ miễn trừ guard** trong `scripts/check-file-size.mjs` — mọi file Rust giờ dưới trần 800. Wiring qua `pub(crate) use` re-export ở crate root nên `generate_handler!` (lệnh moved gọi theo path `export::`/`clean::`) + test (`use crate::{…}`) vẫn resolve. Không đổi hành vi; `cargo test` 58 + clippy (không warning mới) + build xanh. (Không chẻ `export_one_file` — giữ nguyên để khỏi đổi luồng.)

---

## v0.6.0 — Unity Headless Trigger (Pha 2) 📋 Planned

> (Đổi số từ v0.4.0 → v0.6.0: v0.4.0 đã dùng cho Spine Hub Tier B; v0.5.0 là macOS Support.)

- [ ] Tách core export khỏi GUI
- [ ] Parse CLI args + định dạng job file
- [ ] Trả log về Unity console
- [ ] Package menu/nút "Export to SpineForge" trong Unity Editor

> Lên plan chi tiết riêng sau khi Pha 1 (Linked Project) verify xong — design doc mục IX.

---

## v0.5.0 — macOS Support 📋 Deferred

> Tạm hoãn từ v0.3.0 (2026-06): ưu tiên dọn nợ kỹ thuật v0.3.x trước khi mở rộng nền tảng.

- [ ] Verify auto-detect path macOS + không cảnh báo `.exe`
- [ ] `tauri.conf.json` macOS bundle: signingIdentity / entitlements / minimumSystemVersion
- [ ] `icon.icns`
- [ ] Notarization + CI job macOS

---

## Backlog / ý tưởng (chưa lên lịch)

- [x] Drag-drop folder/file vào drop zone _(xong — xem Unreleased)_
- [ ] Xử lý nhiều `.export.json` per project
- [x] Dashboard kết quả per-project _(xong — xem Unreleased)_
- [ ] JSON post-processing path rewrite (an toàn, có backup)
- [ ] **Per-project settings cho `.spine` 4.3.x** — parser hiện chỉ đọc format 3.8.x. Spine CLI **không** có cờ dùng settings nội bộ (đã xác minh 2026-06), nên buộc phải mở rộng parser binary cho layout 4.x. Cần file `.spine` 4.3 thật + bản export editor 4.3 để reverse-engineer và validate byte-identical (như đã làm với 3.8). Hiện file 4.3 đưa vào mode này sẽ tự fallback về preset nền.
