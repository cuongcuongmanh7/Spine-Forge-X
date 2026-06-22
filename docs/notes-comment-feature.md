# Tính năng: Note/Comment cho file & folder trong Library

> Trạng thái: **implemented** — đã code theo plan này (unit test xanh; còn cần chạy app verify thủ công theo §Kiểm thử).

## Bối cảnh

Use-case: leader sau khi check file Spine muốn để lại ghi chú cho người làm — ví dụ "file này đang thiếu anim attack", "cần export lại". Hiện app chỉ có **tags/owner** gắn vào entry (sidecar `spineforge-library-meta.json`, keyed theo `relPath`, merge-before-write, mirror localStorage). Không có chỗ để lại ghi chú tự do, nhiều dòng, có tác giả/thời gian.

Tính năng cần:
- Gắn **nhiều** note vào 1 file **hoặc 1 folder** trong Library view.
- File/folder có note (chưa resolved) được **highlight** + badge số lượng.
- **Thêm / xoá** note; **resolve** (đánh dấu đã xử lý → làm mờ) + filter toàn cục ẩn/hiện note đã resolved.

### Quyết định đã chốt với user
- **Phạm vi:** chỉ **Library view** (entry + folder). Không đụng Workspace.
- **Quyền:** ai cũng thêm note; **tác giả xoá note của mình, leader xoá mọi note** (gate ở UI bằng cờ `isLeader` + `driveAccount.email`; sidecar không enforce — chấp nhận được như tags).
- **Ẩn/hiện:** mỗi note có nút **resolve** (note bị làm mờ); toggle "hiện note đã resolved" có ở **cả thanh lọc Inventory lẫn header popup** (chung 1 state). Toggle này là **filter thật**: khi TẮT, badge/highlight chỉ tính note *chưa resolved* (file hết note chưa resolved thì bỏ highlight); khi BẬT, badge/highlight tính **cả note đã resolved** nên file chỉ-còn-resolved vẫn nổi lên. _(Cập nhật v0.4.16 — trước đó toggle chỉ ảnh hưởng danh sách trong popup.)_

### Lựa chọn kiến trúc
Tái dùng **đúng pattern sidecar của tags** (`useLibraryTags` / `library.ts`) thay vì tạo collection Firestore mới: hoạt động offline + sync qua Drive, không cần đổi `firestore.rules` hay listener real-time (chưa có). Note là dữ liệu mảng theo key nên merge sẽ **union theo note id** để giảm mất note khi 2 leader sửa cùng file.

---

## Thay đổi

### 1. `src/library.ts` — types + pure helpers (mirror phần tags, dòng ~363–429)
Thêm cạnh `EntryMeta`/`LibraryMeta`:
```ts
export type LibraryNote = {
  id: string;            // crypto.randomUUID()
  text: string;
  authorEmail: string;   // denormalized để hiển thị
  createdAt: number;     // Date.now()
  updatedAt: number;
  resolved: boolean;
  resolvedBy?: string;
};
export type LibraryNotes = Record<string, LibraryNote[]>; // key: relPath (file) hoặc dir-key (folder)
```
Helpers thuần (return map mới, immutable như `addTag`/`removeTag`):
- `metaKeyForFolder(folderRelPath): string` → prefix `dir:` để không đụng key file. (`metaKeyForEntry` đã có, dùng cho file.)
- `addNote(notes, key, note)`, `removeNote(notes, key, id)`, `setNoteResolved(notes, key, id, resolved, by)` — prune key khi rỗng (giống `withMetaEntry`).
- `notesFor(notes, key): LibraryNote[]`, `unresolvedCount(notes, key): number`.
- `mergeNoteArrays(a, b): LibraryNote[]` — union theo `id`, mỗi id lấy bản `updatedAt` mới hơn (dùng khi merge-before-write).

### 2. `src/useLibraryNotes.ts` — NEW hook (mirror `useLibraryTags.ts` gần như 1-1)
- Sidecar file mới: `spineforge-library-notes.json` (hằng `LIBRARY_NOTES_FILE`), localStorage key `spineforge.library.notes`.
- Tái dùng `metaFilePath`/read/write qua `invoke('read_text_file'|'write_text_file')`, `useEffect` merge khi `libraryDir` đổi.
- Khác biệt quan trọng ở `commit`: khi push 1 key, **không ghi đè** mà `mergeNoteArrays(remote[key], next[key])` rồi mới write — giảm race khi 2 người note cùng file.
- Nhận thêm `{ authorEmail, isLeader }` để dựng note mới và quyết định quyền xoá.
- Export API: `notesFor(key)`, `unresolvedCount(key)`, `addEntryNote/addFolderNote`, `removeNote(key,id)`, `toggleResolved(key,id)`, `canDelete(note)`.

### 3. `src/components/NotesModal.tsx` + `NotesModal.css` — NEW
- Modal chuẩn theo `docs/ui-design-rules.md` §1 (backdrop click-to-close, `role="dialog"`, header `.modal-close` icon `X`, footer tự mang padding nếu body cuộn riêng).
- Header: tên target (file/folder) + badge số note.
- Body cuộn: list note (text, `authorEmail`, thời gian `toLocaleString`), mỗi note có nút **resolve** (`CheckCircle2`) làm mờ + nút **xoá** (`Trash2`) chỉ hiện khi `canDelete`. Note resolved bị làm mờ; ẩn khi filter tắt resolved.
- Footer/ô nhập: `<textarea>` + nút `primary-button` (`Plus`) để thêm note.
- Icon `lucide-react`. Mọi chuỗi qua `t.*`.

### 4. Indicator + highlight ở entry & folder (table + grid)
Plumbing đi theo đúng đường của `tagsApi` hiện tại (`useLibraryTags` instantiate trong `LibraryInventory`, truyền xuống qua `LibraryViewShared` → `LibraryTable`/`LibraryGrid`). Đại diện:
- `src/components/LibraryInventory.tsx` (~dòng 83): thêm `const notes = useLibraryNotes({ libraryDir, authorEmail: driveAccount?.email ?? '', isLeader })`; state `notesTarget: {key,label}|null`; toggle `showResolved`; render `<NotesModal>`.
- `src/components/LibraryViewShared.tsx`: thêm props chuyển `notes` API + `openNotes(key,label)` xuống.
- `src/components/LibraryTable.tsx` (row `<tr>` ~dòng 206, folder section header): thêm 1 cell/nút **NotesIndicator** (icon `MessageSquare` + badge `unresolvedCount`); class `library-has-notes` trên `<tr>`/section khi `unresolvedCount>0`; click mở modal với key tương ứng (`metaKeyForEntry` cho file, `metaKeyForFolder` cho section).
- `src/components/LibraryGrid.tsx`: tương tự trên card + folder group header.
- Toolbar inventory: 1 toggle "Hiện note đã xử lý" (đặt cạnh `unusedOnly`/`divergingOnly`).

### 5. `src/styles.css` — highlight + badge
- `.library-has-notes` (tô nền/viền nhẹ bằng `color-mix` với `--warning`/`--primary`, không chỉ dựa màu — kèm icon, theo §7 accessibility).
- `.notes-indicator` + `.notes-badge` (badge số đếm), dùng biến theme sẵn có.

### 6. `src/i18n.ts` — chuỗi mới ở **cả `vi` và `en`**
`notes`, `notesAdd`, `notesEmpty`, `notesPlaceholder`, `notesResolve`, `notesUnresolve`, `notesDelete`, `notesShowResolved`, `notesFor` (template tên target), `notesBy`, v.v.

---

## Files
| Loại | Path |
|---|---|
| Sửa: types + helpers | `src/library.ts` |
| Mới: hook sidecar | `src/useLibraryNotes.ts` |
| Mới: modal | `src/components/NotesModal.tsx`, `NotesModal.css` |
| Sửa: wiring + state | `src/components/LibraryInventory.tsx`, `LibraryViewShared.tsx` |
| Sửa: indicator/highlight | `src/components/LibraryTable.tsx`, `LibraryGrid.tsx` |
| Sửa: styles | `src/styles.css` |
| Sửa: i18n | `src/i18n.ts` |

Tái dùng: `metaFilePath`/sidecar I/O & merge-before-write từ `src/useLibraryTags.ts`; `withMetaEntry`/`metaKeyForEntry` từ `src/library.ts` (~dòng 373); `driveAccount`/`isLeader` từ context; pattern modal từ `src/components/LinkedProjectModal.tsx`.

---

## Kiểm thử
1. **Unit (Vitest)**: file `src/library.notes.test.ts` cho `addNote/removeNote/setNoteResolved/mergeNoteArrays/unresolvedCount` (round-trip, prune key rỗng, merge union theo id giữ bản updatedAt mới). Mẫu: `src/sync.test.ts`, `src/roles.test.ts`.
2. **Chạy app** (`npm run tauri dev`):
   - Mở Library → chọn 1 entry → thêm 2 note → entry có highlight + badge "2".
   - Resolve 1 note → badge còn "1", note bị mờ; tắt toggle "hiện note đã xử lý" → note resolved ẩn trong popup.
   - Resolve nốt → highlight biến mất (toggle TẮT); BẬT toggle (ở thanh lọc hoặc header popup) → badge hiện lại đếm cả resolved + highlight trở lại.
   - Thêm note cho 1 folder header → folder highlight.
   - Xoá: với note của mình thấy nút xoá; (giả lập) note người khác + không phải leader → ẩn nút xoá.
3. **Sync**: kiểm tra `spineforge-library-notes.json` xuất hiện trong `…\spine_app_data\library`; sửa thủ công thêm 1 note key khác rồi mở lại → merge không mất note.
