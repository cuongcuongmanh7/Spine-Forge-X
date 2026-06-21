# Đồng bộ dữ liệu app qua Google Drive (Sync — Tier A)

**Sync** giúp animator làm việc xen kẽ giữa máy công ty và máy nhà. **Mô hình v2:**
- **Path cố định, không phải chọn**: dữ liệu nằm dưới `…\Shared drives\Pamvis\spine_app_data` (app **tự dò** đúng ổ trên mỗi máy — xem `resolve_app_data_dir`/`useAppData`).
- **Workspace riêng theo người**: project / session / cấu hình của mỗi user lưu ở folder con riêng theo **email Google Drive** (`workspaces/<emailSlug>/profile.json`) — hai người không đè nhau.
- **Library dùng chung**: danh sách thư viện + tag/người phụ trách + owner Drive + thumbnail là một nguồn chung cho cả nhóm (`library/…`).

Đường dẫn source spine được lưu **tương đối** so với mount Shared drives và **tự ghép lại** cho đúng ổ đĩa của từng máy (G:\ vs H:\).

> Tier A là file-based (Google Drive for desktop tự đồng bộ file). **Workspace cần đăng nhập Drive** để lấy email định danh; library chung thì xem được cả khi chưa đăng nhập. Tier B (owner/lịch sử/version qua Drive API) ở mục 7.

---

## 1. Khái niệm

| Khái niệm | Ý nghĩa |
|-----------|---------|
| **App-data root (cố định)** | `<ổ>:\Shared drives\Pamvis\spine_app_data` — gốc dữ liệu chung, **tự dò** đúng ổ trên mỗi máy. Không có UI chọn folder. Không mount được → banner cảnh báo. **Bản dev** (`tauri dev`, `cfg!(debug_assertions)`) ghi vào subfolder `…\spine_app_data\dev\` riêng để khỏi đụng dữ liệu thật; bản `tauri build` dùng root. Titlebar hiện badge "dev". |
| **Workspace profile (per-user)** | `workspaces/<emailSlug>/profile.json` (+ `.bak`); chứa appConfig (trừ `spinePath`), projects, sessions. `emailSlug` = email Google sanitize. |
| **Library list (shared)** | `library/libraries.json` (+ `.bak`); danh sách thư viện đăng ký, dùng chung. Sidecar tag/owner (`library/spineforge-library-meta.json`) + drive-meta (`library/spineforge-drive-meta.json`) cũng nằm trong `library/`. |
| **Rebase anchor (tự suy ra)** | Mount `…\Shared drives` suy từ app-data root (`deriveAnchor`) — project ở các drive khác (FD/DH) đều portable. |
| **`${SPINE_ROOT}` token** | Mọi path dưới anchor lưu dạng `${SPINE_ROOT}/...`; load ở máy khác token được thay bằng anchor của máy đó. |

**Không bao giờ đồng bộ** (machine-local): Spine.exe (`spinePath`), cache quét thư viện + trạng thái clean, theme/ngôn ngữ, active project/session id.

## 2. Cách dùng

1. App **tự dò** ổ Pamvis. Không thấy `Shared drives\Pamvis` → tab Thư viện hiện **banner cảnh báo** (dữ liệu chung không đồng bộ).
2. **Đăng nhập Google Drive** (nút tài khoản góc dưới sidebar) để đồng bộ workspace riêng của bạn. Chưa đăng nhập: vẫn xem được thư viện chung, workspace không ghi.
3. Tạo/sửa project, session… → app **debounce ~1.5s** rồi ghi vào workspace profile; thêm/sửa thư viện → ghi `library/libraries.json`. Chấm trạng thái trên nút tài khoản: **xám** = tắt · **vàng** = đang ghi · **xanh** = đã đồng bộ · **đỏ** = lỗi.
4. Máy/người khác: workspace của họ **riêng** (theo email); thư viện + tag + thumbnail **thấy chung**. Remote mới hơn → **reload một lần** để nạp lại.

## 3. Nhiều project ở các nhánh khác nhau

Vì gốc chung là **cha chung** nên nhiều project ở các shared drive khác nhau đều rebase được:

```
G:\Shared drives\FD\[FD] Animation\...  →  ${SPINE_ROOT}/FD/[FD] Animation/...
G:\Shared drives\DH\[DH] Animation\...  →  ${SPINE_ROOT}/DH/[DH] Animation/...
```

⚠️ **Đừng** đặt gốc vào folder một project (vd `…\[FD] Animation`) — khi đó path của project khác (DH) nằm **ngoài** gốc, giữ tuyệt đối và **không** rebase được sang máy khác. Path ngoài gốc luôn giữ nguyên tuyệt đối (không đồng bộ portable).

> `outputPath` / `unityRoot` (Unity) hiện vẫn lưu tuyệt đối — chưa token hóa (để dành `${UNITY_ROOT}` cho sau).

## 4. Quy tắc hợp nhất (reconcile)

Khi khởi động (hoặc khi đổi định danh: ổ Drive / email) và khi bấm **Đồng bộ ngay**, reconcile chạy **độc lập cho 2 scope** — workspace (theo email) và library list — mỗi cái lấy bản mới hơn giữa (local, remote):

1. Chưa có file remote → **seed** bằng dữ liệu local.
2. Local và remote giống nhau (bỏ qua `updatedAt`) → chỉ nhận timestamp.
3. `remote.updatedAt > <stamp scope đó>` → **remote thắng**: apply.
4. Ngược lại → **local đi trước**: ghi local lên.

Nếu bất kỳ scope nào apply remote → báo toast "Đang tải workspace mới nhất…" rồi `window.location.reload()` **một lần** sau ~0.8s (đỡ giật mình; `reloadingRef` chặn ghi trong lúc chờ). Mỗi scope có timestamp riêng (`workspaceSyncedAt` / `librarySyncedAt`). Sau đó thay đổi local được debounce ghi lên scope tương ứng; trạng thái đang ghi/chờ hiện dòng transient dưới nút tài khoản (xem [AccountBadge](../src/components/AccountBadge.tsx)).

**An toàn:** không ghi lên profile trước khi reconcile đầu tiên thiết lập baseline, cũng không ghi khi đang reconcile → máy mới (rỗng) không thể đè dữ liệu rỗng lên profile của máy cũ.

## 5. Code

| Phần | File |
|------|------|
| Logic thuần (tokenize/rebase, build/apply workspace+library profile, path helpers, IPC) | `src/sync.ts` |
| Hook điều phối (reconcile kép, debounce) | `src/useSync.ts` (wire trong `src/useAppController.tsx`) |
| Dò app-data root | `src/useAppData.ts` ↔ Rust `system::resolve_app_data_dir` |
| Sidecar tag/owner + drive-meta (folder `library/`) | `src/useLibraryTags.ts`, `src/drive.ts`, `src/useLibraryDrive.ts` |
| Chấm trạng thái (trong nút tài khoản) | `src/components/AccountBadge.tsx` + `.css` |
| Settings ▸ Sync (hiện path + trạng thái, không picker) | `src/components/SettingsModal.tsx` |
| Đọc/ghi file | Rust `system::read_text_file`, `system::write_text_file` |
| i18n | `src/i18n/{vi,en}.ts` (key `sync*`) |
| Test | `src/sync.test.ts` (rebase + workspace/library profile round-trip, path helpers) |

## 6. Giới hạn đã biết / hướng mở rộng

- **Một gốc duy nhất**: chỉ rebase được path dưới một cha chung. Nếu source trải trên nhiều mount khác hẳn nhau (vd có cả `My Drive` lẫn ổ local), cần nâng cấp **multi-root mapping** (đã cân nhắc, tạm hoãn — dùng cha chung là đủ cho setup Shared drives hiện tại).
- ~~**Tier B**~~ → đã làm, xem mục dưới.

### Bảo vệ dữ liệu — lớp metadata chuyển sang Firestore (hybrid, ĐÃ LÀM)

**Vấn đề:** khi metadata sync là file thường trong `spine_app_data`, ai có quyền cũng xoá/đổi folder được, và **không thể vừa-cho-ghi vừa-chặn-xoá chỉ bằng phân quyền** Drive-for-desktop (Contributor trên desktop chỉ ĐỌC; muốn ghi phải Content manager — mà Content manager thì TRASH được). Nguồn: [How file access works in shared drives](https://support.google.com/a/users/answer/12380484).

**Giải pháp đã chọn (hybrid):** chuyển **lớp metadata** (workspace profile + library list) sang **Firebase Firestore** và **thumbnail** sang **Cloud Storage**; **chỉ source `.spine` ở lại Shared Drive** (Spine.exe mở trực tiếp qua filesystem — Firebase không thay thế được phần này).

| Dữ liệu | Lưu ở |
|---|---|
| Workspace profile (per-user) | Firestore `envs/{dev\|prod}/workspaces/{uid}` (uid = Firebase Auth) |
| Library list (shared) | Firestore `envs/{dev\|prod}/library/list` — **leader-curated** |
| Thumbnail (cache) | **Cloud Storage** `envs/{dev\|prod}/thumbs/{key}.png` (L2 chung) + cache cục bộ L1 mỗi máy |
| Source `.spine` / atlas / png | **Shared Drive** (filesystem) — không đổi |
| Sidecar tag/owner + drive-meta | **Shared Drive** (`library/…`) — chưa chuyển (pha sau) |

**Role leader/member (library leader-curated).** Chỉ **leader** được **thêm/xoá library** trong danh sách chung; member nhận **list chỉ đọc** (nút thêm `+`/xoá ẩn) và dùng chung. App: member **pull-only** cho scope library (không bao giờ ghi `library/list`); reconcile chỉ kéo bản leader về. Server: `firestore.rules` cho `library/list` chỉ leader ghi được — đây mới là ranh giới thật, UI chỉ là UX. Workspace vẫn riêng từng người (ai cũng ghi của mình). *(Lưu ý: khi cắt sang Firestore, list của leader là nguồn chuẩn — library chỉ-local của member sẽ bị thay bằng list leader khi pull.)*

> **Leader KHÔNG hardcode.** Danh sách leader nằm trong doc Firestore **`config/roles`** = `{ leaderEmails: ["cuongdm@ondigames.com"] }` (lowercase). App đọc live qua `subscribeLeaderEmails` (onSnapshot) để gate UI; `firestore.rules` cũng `get()` chính doc đó cho `isLeader()`. **Đổi leader = sửa 1 document trên Firebase Console**, không động code/redeploy, có hiệu lực ngay. Doc này client **chỉ đọc** (`allow write: if false`) — chỉ sửa qua Console; seed lần đầu cũng bằng Console.

**Thumbnail (Cloud Storage, 3 tầng).** Mở thẻ Library: (1) **L1** cache cục bộ mỗi máy (Rust `thumb_cache_*`, nhanh, chạy offline, không cần Drive) → trúng thì dùng luôn; (2) **L2** Cloud Storage — dùng thẳng download URL làm `<img>` src (không cần mount Drive, dùng được trên web/mobile sau này); (3) miss cả hai → render WebGL rồi lưu L1 + upload L2 để máy khác khỏi render lại. Không migration: 215 thumb cũ tự tái sinh dần khi duyệt (cache tái tạo được). Thumbnail là cache nên rule cho **mọi member** ghi (`storage.rules`), `delete:false`.

**Vì sao an toàn hơn filesystem:**
- **Security rules chặn xoá ở server** (`firestore.rules`): chỉ tài khoản `@ondigames.com` đã đăng nhập mới đọc/ghi; `delete` **luôn bị từ chối**; workspace chỉ **chủ sở hữu** (uid) ghi được. Không còn lỗ hổng phân quyền của filesystem.
- **Point-in-time recovery (7 ngày)** + ghi luôn qua rules ⇒ khôi phục được khi lỡ tay.
- **Server timestamp** cho `updatedAt` ⇒ newer-wins không còn phụ thuộc giờ máy (đọc lại giá trị server đã chốt nên không lệch/không reload thừa).
- **Offline cache (IndexedDB):** mất mạng vẫn sửa được, nối lại mạng tự đồng bộ.

> ⚠️ **Ranh giới:** hybrid **chỉ bảo vệ metadata**. Source `.spine` vẫn trên Drive với đúng rủi ro trash/xoá như cũ → vẫn nên cấu hình **quyền Shared Drive** (member = Content manager, **leader = Manager duy nhất**) cho lớp assets.

> Đăng nhập: tái dùng OAuth Google của Tier B — luồng Rust lấy thêm scope `openid email profile`, trả `id_token`, frontend đổi sang phiên Firebase (`signInWithCredential`). **Không đăng nhập 2 lần.** Tài khoản đăng nhập trước khi thêm scope này cần **đăng nhập Drive lại một lần** để cấp `openid`. Khi chưa đăng nhập, sync ở trạng thái "cần đăng nhập" (trước đây library xem chung được cả khi signed-out; giờ mọi truy cập metadata qua Firestore đều cần đăng nhập — dữ liệu cache cục bộ vẫn hiển thị).

**Set-up Firebase — DEV làm một lần.** ✅ Đã cấu hình & live trên project `spineforge-x` (2026-06-21). Các bước bấm-từng-nút / tái lập: [docs/firebase-setup.md](firebase-setup.md).
- Dùng lại GCP project của Tier B → bật **Firestore** (Native mode) + **Point-in-time recovery**, và bật **Cloud Storage**.
- Deploy rules: `firestore.rules` + `storage.rules`.
- **Seed leader:** tạo doc `config/roles` = `{ leaderEmails: ["cuongdm@ondigames.com"] }` (lowercase) trên Console. Đổi leader sau này = sửa doc này, không động code.
- Ở **Firebase Auth ▸ Sign-in method ▸ Google**, đảm bảo client ID OAuth "Desktop app" (của Tier B) được tin (whitelist) để `id_token` đổi được phiên.
- Nhúng config web lúc build qua env (giống `SPINEFORGE_GOOGLE_CLIENT_ID`): `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`, `VITE_FIREBASE_APP_ID`, `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`. Thiếu config → metadata sync + thumbnail-chung tắt (không crash, thumbnail về cache cục bộ). Bản dev ghi `envs/dev`, bản release ghi `envs/prod`.
- *(Thumbnail hiển thị qua `<img src=downloadURL>` nên KHÔNG cần cấu hình CORS bucket; chỉ cần `img-src`/`connect-src` cho `firebasestorage.googleapis.com` — đã set trong `tauri.conf.json`.)*

**Code:** init/auth/db/storage + `subscribeLeaderEmails` `src/firebase.ts`; IO Firestore + rebase `src/sync.ts`; điều phối + role-gate `src/useSync.ts`; helper role thuần `src/roles.ts` (`computeIsLeader`); auth + role live `src/useFirebaseAuth.ts` + lệnh Rust `drive_id_token` (`src-tauri/src/drive.rs`); thumbnail 3 tầng `src/useSpineThumbnail.ts`; UI gate thêm/xoá `src/components/LibraryView.tsx`; CSP (`tauri.conf.json`); rules `firestore.rules` (gồm `config/roles`) + `storage.rules`. Test: `src/sync.firestore.test.ts`, `src/roles.test.ts`.

**Còn lại (pha sau):** chuyển sidecar tag/drive-meta sang Firestore; thay `window.location.reload()` bằng `onSnapshot` real-time.

---

## 7. Tier B — Owner / lịch sử sửa / version (Google Drive API)

Tier A đọc *folder* Drive qua filesystem nên KHÔNG biết ai là chủ file `.spine`, sửa lần cuối khi nào, hay lịch sử version. Tier B lấy các thông tin đó qua **Google Drive REST API**.

**Cách dùng**
1. Settings ▸ **Sync (Google Drive)** ▸ mục **Tài khoản Google Drive** ▸ **Đăng nhập**. Trình duyệt mở trang consent của Google; sau khi đồng ý là xong (refresh token lưu an toàn trong **Windows Credential Manager**, không phải đăng nhập lại mỗi lần mở app). Trạng thái đăng nhập cũng hiện ở **góc dưới trái** (badge avatar + email) — bấm vào là mở Settings.
2. Trong **Library ▸ Inventory**, mở menu **⋯** của một dòng ▸ **Owner & lịch sử**. Panel hiện **chủ sở hữu**, **sửa lần cuối + người sửa**, và **danh sách version** (ngày · người sửa · dung lượng). Tải **on demand** (chỉ khi bấm), cache trong phiên.
3. **Dashboard người-sửa/sửa-cuối**: nút **Tải dữ liệu Drive** (toolbar) lấy người sửa + thời gian sửa cho các dòng đang lọc → hiện thành 2 cột **Người sửa / Sửa lần cuối** (sort được; file đổi trong 7 ngày được tô nổi). Batch dùng cache drive-name→ID + folder→ID nên mỗi folder chỉ tra một lần. *(File shared drive không có owner riêng — cả drive sở hữu — nên cột "Người sửa" lấy `lastModifyingUser`; cột header để là "Người sửa"/"Editor" cho đúng nghĩa.)*
4. Các nút thao tác mỗi dòng (lịch sử, clean, mở folder, mở Spine, tạo session) gom trong **menu ⋯** (hiện khi rê chuột).
5. **Mở revision cũ trong Spine**: trong panel lịch sử, mỗi version có nút mở → tải bản đó về file tạm rồi mở trong Spine để so sánh/truy vết regression. Chỉ đọc, không ghi lên Drive. ⚠️ Ảnh liên kết có thể không hiện vì file tạm nằm ngoài folder gốc — đủ để xem skeleton/animation.
6. File nằm ngoài gốc Drive đang đồng bộ → báo "không nằm trên Google Drive".

**Thiết kế / quyết định**
- **Scope chỉ đọc** (`drive.readonly`) — không sửa/không restore file trên Drive. *(Phải dùng `drive.readonly` chứ không phải `drive.metadata.readonly` hẹp hơn, vì `drives.list` — dùng để map tên shared drive → ID — chỉ chấp nhận `drive` hoặc `drive.readonly`.)*
- **OAuth client nhúng sẵn** (loại "Desktop app"), luồng installed-app: loopback `127.0.0.1` + PKCE. Toàn bộ HTTP gọi Drive chạy ở **Rust** (reqwest), nên webview không gọi googleapis (CSP `connect-src` không đổi; chỉ mở `img-src` cho avatar `*.googleusercontent.com`).
- Ánh xạ local→Drive: tái dùng anchor của Tier A. Path dưới mount `…\Shared drives` có dạng `<tên-shared-drive>/<folder>/…/file.spine`; Rust tra `drives.list` (tên→driveId) rồi đi từng folder bằng `files.list` để ra file ID (cache theo path).

**Set-up GCP — DEV làm một lần, animator không đụng tới.** Animator chỉ bấm "Đăng nhập" rồi chọn Gmail; client ID nhúng sẵn trong app. (Mọi app gọi Google API đều bắt buộc có 1 OAuth client — không bỏ được bước này, nhưng chỉ làm một lần.)
- Tạo project Google Cloud → bật **Google Drive API**.
- **OAuth consent screen → User Type = Internal** (vì `ondigames.com` là Google Workspace). Nhờ Internal: **không cần** thêm test user, **không cần** Google verification, và **bất kỳ ai trong tổ chức** `@ondigames.com` login Gmail là dùng được. Quyền xem file vẫn do Shared drive/tổ chức quản lý. *(Nếu tài khoản KHÔNG phải Workspace thì phải dùng External + chế độ Testing + thêm từng test user.)*
- Thêm scope `https://www.googleapis.com/auth/drive.readonly` (ở **OAuth consent screen ▸ Data access**). Lưu ý: `drive.metadata.readonly` KHÔNG đủ cho `drives.list` → phải dùng `drive.readonly`.
- **Credentials → Create OAuth client ID → Desktop app** → lấy client ID + secret (loại Desktop tự cho phép loopback `127.0.0.1`, không cần khai báo redirect URI).
- Nhúng lúc build qua biến môi trường `SPINEFORGE_GOOGLE_CLIENT_ID` + `SPINEFORGE_GOOGLE_CLIENT_SECRET` (xem `src-tauri/src/drive.rs`) — vd đặt trong `src-tauri/.cargo/config.toml` `[env]` (nhớ gitignore vì có secret).

**Code**: `src-tauri/src/drive.rs` (OAuth + API; lệnh `drive_account`/`drive_sign_in`/`drive_sign_out`/`drive_file_metadata`/`drive_files_basic`/`drive_open_revision`), state token + cache drive-name/folder-id trong `model.rs`, đăng ký trong `lib.rs`. Mở URL OAuth qua `rundll32` (không dùng `cmd start` vì `&` trong URL bị cắt). Frontend: `src/drive.ts` (IPC + `toDriveRelPath`), `src/useDrive.ts` (auth), `src/components/AccountBadge.tsx` (badge góc dưới trái), Settings ▸ Sync, `LibraryInventory.tsx` (panel metadata + cột dashboard + mở revision). i18n key `drive*`. Test: `src/drive.test.ts`.
