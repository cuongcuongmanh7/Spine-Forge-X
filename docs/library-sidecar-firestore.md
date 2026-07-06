# Library sidecar → Firestore (spec)

Hoàn tất phần **"Còn lại (pha sau)"** đã ghi ở [sync.md](sync.md) §Bảo vệ dữ liệu: chuyển 3 sidecar
JSON cuối cùng còn nằm trên Shared Drive sang Firestore, theo đúng pattern `library/list` /
`library/clean` / `library/trash` đã ship. Việc lớn → tách PR riêng theo mục "Chia PR" bên dưới.

> **Trạng thái:** PR1–PR4 **đã ship ở v0.4.41** (transport đổi sang Firestore), rules **đã deploy**.
> **PR5 (dọn code file sidecar cũ + seed) đã làm post-v0.4.41** — vì hiện chỉ 1 người dùng nên không
> cần chờ team; file sidecar cũ vẫn để nguyên trên Drive (chỉ bỏ code đọc). Còn lại: **realtime
> `onSnapshot`** (§7).

## 1. Bối cảnh

3 sidecar hiện là file thường trong `…\spine_app_data\library\`:

| File | Hook đọc/ghi | Dữ liệu |
|---|---|---|
| `spineforge-library-meta.json` | [useLibraryTags.ts](../src/useLibraryTags.ts) | tags + owner thủ công, key = `relPath` (`metaKeyForEntry`) |
| `spineforge-library-notes.json` | [useLibraryNotes.ts](../src/useLibraryNotes.ts) | ghi chú (author/ngày/resolved), key = `relPath` hoặc `dir:<folderKey>` |
| `spineforge-drive-meta.json` | [drive.ts](../src/drive.ts) + [useLibraryDrive.ts](../src/useLibraryDrive.ts) | cache owner/last-modified mỗi file (`DriveBasic`), key = `relPath` |

**Vấn đề (đã nêu ở ROADMAP):**
- Không được `firestore.rules` bảo vệ — ai có quyền ghi Content-manager trên Shared Drive cũng xoá/sửa
  bậy được (không có cách "cho ghi nhưng chặn xoá" thuần bằng phân quyền Drive — xem sync.md §6).
- Cần **mount Drive** mới đọc/ghi được → chặn đường mở web/mobile viewer sau này.

**Cả 3 đều dùng chung 1 cơ chế** (khác `list`/`clean`/`trash` vốn leader-curated): **mọi thành viên**
đều ghi được (ai cũng gắn tag/note/asset của mình), transport hiện tại là
`invoke('read_text_file'/'write_text_file')` + **merge-before-write ở tầng app** (đọc remote, ghi đè
đúng key vừa sửa, ghi lại cả file) vì filesystem không có upsert theo field.

## 2. Nguyên tắc thiết kế

- **Parity trước, cải tiến sau.** Giữ nguyên tên hook, tên hàm gọi từ component, localStorage mirror
  (đọc nhanh, hoạt động offline) — chỉ đổi transport bên trong `read*Sidecar`/`write*Sidecar`.
- **`org()`-writable, không phải `isLeader()`-only** — khác `library/{list,clean,trash}`, rule mới
  phải cho **mọi thành viên đã đăng nhập** ghi (xem §4 Rules).
- **Cải tiến thật:** Firestore `setDoc(ref, data, { merge: true })` **deep-merge object lồng** (khác
  `update()` với dot-string field path, vốn hiểu nhầm `.` trong `relPath` — vd `Heroes/3001/x.spine`
  — thành phân cách field). Truyền **object JS lồng thật** (`{ byLibrary: { [libId]: { [key]: value } } }`),
  không phải chuỗi `"byLibrary.libId.key"` phẳng, thì Firestore tự merge đúng field lồng đó, không đụng
  key khác/library khác. Xoá key dùng `deleteField()` ở đúng vị trí lồng. Nhờ vậy đọc-remote-trước-khi-ghi
  ở tầng app **không còn bắt buộc** cho tags/drive-meta (server tự merge) — thu hẹp hẳn race window hiện
  có (2 người sửa 2 key khác nhau gần như đồng thời, cùng đọc remote cũ, người ghi sau đè mất người ghi
  trước). Notes vẫn cần đọc field cũ trước khi union-by-id (mảng không tự merge được), nhưng chỉ đọc
  **đúng 1 field lồng** (`byLibrary.libId.key`) qua `getDoc` thay vì merge nguyên object thô ở app rồi
  ghi đè cả object — vẫn thu hẹp phạm vi so với hiện tại (đọc/ghi cả file).
- **Nhân tiện fix namespace theo library.** Hiện tại `metaKeyForEntry`/`metaKeyForFolder` chỉ dùng
  `relPath` toàn cục → **2 library khác nhau trùng `relPath` sẽ chia sẻ tag/note/drive-cache** (bug đã
  ghi nhận ở [spine-hub-tier-c.md §4](spine-hub-tier-c.md), "hiếm nhưng có thật"). Doc Firestore mới
  namespace theo `libraryId` (`byLibrary: { [libraryId]: {...} }`, giống `library/clean` đã làm với
  `states[libId]`) → tiện thể vá luôn.
- **Không cần script migrate dữ liệu cũ.** Giống cách `list`/`clean`/`trash` seed: máy đầu tiên mở app
  sau khi lên bản mới đọc sidecar file cũ (vẫn còn), rồi tự **push local state → Firestore** một lần
  (remote rỗng → seed). Không cần ai chạy migration thủ công. Giữ code đọc sidecar file cũ **read-only**
  thêm 1 bản (fallback nếu Firestore trống + file cũ có dữ liệu) rồi bỏ hẳn ở PR dọn cuối.

## 3. Thiết kế dữ liệu Firestore

Đặt cạnh `library/list|clean|trash` cho nhất quán, `envs/{env}/library/{doc}`:

### `envs/{env}/library/tags`
```jsonc
{
  "schema": 1,
  "updatedAt": /* serverTimestamp() */,
  "byLibrary": {
    "<libraryId>": {
      "<relPath>": { "tags": ["boss", "wip"], "owner": "user@ondigames.com" }
    }
  }
}
```

### `envs/{env}/library/notes`
```jsonc
{
  "schema": 1,
  "updatedAt": /* serverTimestamp() */,
  "byLibrary": {
    "<libraryId>": {
      "<relPath|dir:folderKey>": [
        { "id": "...", "text": "...", "authorEmail": "...", "createdAt": 0, "updatedAt": 0, "resolved": false }
      ]
    }
  }
}
```

### `envs/{env}/library/drive`
Cache **lớn nhất** trong 3 (một entry mỗi file trong thư viện — thư viện vài nghìn asset có thể chạm
gần trần 1MiB/doc nếu gộp chung `byLibrary` map như hai cái trên). Đề xuất **tách 1 doc/thư viện** thay
vì gộp:
```
envs/{env}/library/drive_<libraryId>   { schema: 1, updatedAt, entries: { [relPath]: DriveBasic } }
```
Đổi lại: doc nhỏ hơn theo từng thư viện, nhiều máy "Load Drive data" các thư viện khác nhau không
tranh nhau 1 doc/lock ghi. Tên `libraryId` vốn đã là chuỗi ổn định (không đổi qua rename) nên an toàn
làm hậu tố doc id.

## 4. Security rules

`firestore.rules` hiện tại (`match /envs/{env}/library/{doc}`) chỉ cho `isLeader()` ghi — đúng cho
`list`/`clean`/`trash`, **sai** cho 3 doc mới (cần mọi member ghi được). `list`, `clean`, `trash`,
`tags`, `notes`, `drive_<libraryId>` đều là doc đơn dưới cùng collection `library/` nên **cùng khớp
một path pattern** (`library/{doc}`) — không tách được bằng path, phải gộp điều kiện vào **cùng một**
`match` block (đã làm, xem `firestore.rules`):

```
match /envs/{env}/library/{doc} {
  allow read: if org();
  allow create, update: if isLeader() || (org() && (doc == 'tags' || doc == 'notes' || doc.matches('drive_.*')));
  allow delete: if false;
}
```

`delete: false` giữ nguyên tinh thần "không ai xoá được ở tầng client" (kể cả xoá 1 key trong map vẫn
là `update`, không phải `delete` document).

## 5. Chia PR

Làm tuần tự, mỗi PR verify độc lập (`tsc` + `npm test` + `npm run build` + smoke `tauri dev`), không
đổi UI/UX ở 3 PR đầu (chỉ đổi transport):

1. **PR1 — hạ tầng dùng chung.** Thêm hàm Firestore I/O theo đúng convention `read/write/build/apply
   LibraryXProfile` đã có trong [sync.ts](../src/sync.ts) (không đổi hook nào cả). Test round-trip +
   test riêng xác nhận `setDoc(..., {merge:true})` deep-merge đúng field lồng chứa `relPath` có dấu
   `.`/`/` mà không đụng key khác (đây là giả định kỹ thuật cốt lõi của cả spec — **verify bằng test
   thật ở PR này trước khi PR2-4 dựa vào nó**).
2. **PR2 — Tags/owner.** Đổi transport trong `useLibraryTags.ts`; giữ localStorage mirror + API hook y
   nguyên. Deploy rule `library/tags`. Fallback đọc sidecar file cũ nếu Firestore trống.
3. **PR3 — Notes.** Tương tự cho `useLibraryNotes.ts`, giữ union-by-id (`mergeNoteArrays`) ở đúng field
   lồng thay vì cả file.
4. **PR4 — Drive-meta.** Đổi `drive.ts`/`useLibraryDrive.ts`; quyết định doc-per-library (§3) nếu chưa
   chốt lại ở lúc code.
5. **PR5 — dọn (đã làm post-v0.4.41).** Vì hiện chỉ 1 người dùng, không cần chờ team lên bản mới. Đã xoá:
   code đọc file sidecar cũ trong 3 hook (`readLegacySidecar` ở tags/notes + seed block; `readDriveMetaSidecar`
   ở drive), `readDriveMetaSidecar`/`writeDriveMetaSidecar`/`DRIVE_META_FILE` trong [drive.ts](../src/drive.ts),
   `seedLibraryTags`/`seedLibraryNotes` trong [libraryMetaSync.ts](../src/libraryMetaSync.ts), và `libraryDir`
   khỏi Args của tags/notes (drive vẫn giữ cho `toDriveRelPath`). **Không** xoá file `.json` cũ trên Drive (để
   nguyên, vô hại). `read_text_file`/`write_text_file` vẫn dùng ở chỗ khác nên giữ.

## 6. Việc KHÔNG làm trong scope này

- Không đổi cách reconcile "pull-once-on-mount + merge-before-write-per-edit" hiện có sang mô hình
  `onSnapshot` realtime hay đưa vào vòng reconcile chung của `useSync.ts` — 3 sidecar này vốn không đi
  qua `useSync`, giữ nguyên kiến trúc riêng, chỉ đổi transport. Cân nhắc realtime là việc khác, sau khi
  đã ổn định transport mới.
- Không di trú lịch sử/audit trail — chỉ có state hiện tại (giống cách `list`/`clean`/`trash` seed).

## 7. Câu hỏi cần chốt

- **Doc-per-library cho drive-meta (đề xuất, §3)** — hay giữ 1 doc `byLibrary` map chung cho gọn code,
  chấp nhận rủi ro chạm trần 1MiB khi thư viện rất lớn (dễ vá sau nếu cần, không breaking vì key đã
  namespace theo `libraryId`)?
- **Thời điểm PR5 (dọn code cũ)** — chờ bao lâu sau PR2-4 để chắc mọi máy đã lên bản mới? (đề xuất: 1-2
  release, giống cách rollout `list`/`clean`/`trash` trước đây không có mốc thời gian cứng, chỉ dọn khi
  chắc chắn.)
