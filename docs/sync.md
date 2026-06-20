# Đồng bộ dữ liệu app qua Google Drive (Sync — Tier A)

**Sync** giúp animator làm việc xen kẽ giữa máy công ty và máy nhà: toàn bộ **project / session / cấu hình** được mirror vào một file JSON đặt trong thư mục Google Drive dùng chung, nên mở app ở máy khác là có sẵn workspace, không phải set-up lại. Đường dẫn source spine được lưu **tương đối** so với một gốc Drive chung và **tự ghép lại** cho đúng ổ đĩa của từng máy (G:\ vs H:\).

> Đây là **Tier A** (file-based, không cần mạng/OAuth) — dựa vào Google Drive for desktop tự đồng bộ file giữa các máy. Tier B (lấy owner/lịch sử/version qua Drive API) là việc tương lai, xem [ROADMAP.md](ROADMAP.md).

---

## 1. Khái niệm

| Khái niệm | Ý nghĩa |
|-----------|---------|
| **Google Drive folder** | Thư mục **ghi được** để đặt file profile — chọn **bên trong một shared drive** (vd `G:\Shared drives\FD`). ⚠️ KHÔNG chọn cấp ảo `G:\Shared drives` vì Google Drive for desktop **không cho ghi file** ở cấp đó (chỉ ghi được bên trong từng shared drive). |
| **Rebase anchor (tự suy ra)** | Gốc quy đổi đường dẫn, **tự suy** từ folder đã chọn: nếu folder nằm dưới một mount `…\Shared drives` thì anchor = chính mount đó (`G:\Shared drives`) — nhờ vậy project ở các drive khác (FD/DH) đều portable; ngược lại anchor = folder đã chọn. |
| **Profile file** | `spineforge-profile.json` nằm trong folder đã chọn; chứa appConfig (trừ `spinePath`), projects, sessions, libraries. Có bản backup `spineforge-profile.bak.json`. |
| **`${SPINE_ROOT}` token** | Mọi path nằm dưới rebase anchor được lưu dạng `${SPINE_ROOT}/...`; khi load ở máy khác, token được thay bằng anchor của máy đó. |

**Không bao giờ đồng bộ** (machine-local, lưu riêng mỗi máy): đường dẫn Spine.exe (`spinePath`), bản thân vị trí gốc Drive, theme/ngôn ngữ.

## 2. Cách dùng

1. Settings ▸ **Sync (Google Drive)**. Toggle **mặc định bật**.
2. **Google Drive folder**: lần đầu app **tự dò** shared drive **ghi được** đầu tiên (vd `G:\Shared drives\FD`) và điền sẵn. Không dò được → cảnh báo, chọn thủ công một folder bên trong shared drive.
3. Tạo/sửa project, session… → app **debounce ~1.5s** rồi ghi vào profile. Chấm trạng thái trên nút tài khoản (sidebar): **xám** = tắt/chưa cấu hình · **vàng** = chưa lưu/đang ghi · **xanh** = đã đồng bộ · **đỏ** = lỗi.
4. Máy thứ hai: bật sync + đặt gốc Drive = `<ổ>:\Shared drives` của máy đó → app đọc profile, rebase path, **reload một lần** để hiện đủ workspace.

## 3. Nhiều project ở các nhánh khác nhau

Vì gốc chung là **cha chung** nên nhiều project ở các shared drive khác nhau đều rebase được:

```
G:\Shared drives\FD\[FD] Animation\...  →  ${SPINE_ROOT}/FD/[FD] Animation/...
G:\Shared drives\DH\[DH] Animation\...  →  ${SPINE_ROOT}/DH/[DH] Animation/...
```

⚠️ **Đừng** đặt gốc vào folder một project (vd `…\[FD] Animation`) — khi đó path của project khác (DH) nằm **ngoài** gốc, giữ tuyệt đối và **không** rebase được sang máy khác. Path ngoài gốc luôn giữ nguyên tuyệt đối (không đồng bộ portable).

> `outputPath` / `unityRoot` (Unity) hiện vẫn lưu tuyệt đối — chưa token hóa (để dành `${UNITY_ROOT}` cho sau).

## 4. Quy tắc hợp nhất (reconcile)

Khi khởi động hoặc bấm **Đồng bộ ngay**, lấy bản mới hơn giữa (local, remote):

1. Chưa có profile remote → **seed** bằng dữ liệu local.
2. Local và remote giống nhau (bỏ qua `updatedAt`) → chỉ nhận timestamp, không ghi/không reload.
3. `remote.updatedAt > lastSyncedAt` → **remote thắng**: apply + `window.location.reload()` để nạp lại.
4. Ngược lại → **local đi trước**: ghi local lên profile.

Sau đó mọi thay đổi local được debounce ghi lên (last-write-wins theo `updatedAt`).

**An toàn:** không ghi lên profile trước khi reconcile đầu tiên thiết lập baseline, cũng không ghi khi đang reconcile → máy mới (rỗng) không thể đè dữ liệu rỗng lên profile của máy cũ.

## 5. Code

| Phần | File |
|------|------|
| Logic thuần (tokenize/rebase, build/apply profile, IPC) | `src/sync.ts` |
| Hook điều phối (reconcile, debounce, auto-detect) | `src/useSync.ts` (wire trong `src/useAppController.tsx`) |
| Chấm trạng thái (trong nút tài khoản) | `src/components/AccountBadge.tsx` + `.css` |
| Settings ▸ Sync | `src/components/SettingsModal.tsx` |
| Đọc/ghi file + dò Drive | Rust `system::read_text_file`, `system::write_text_file`, `system::detect_drive_root` |
| i18n | `src/i18n/{vi,en}.ts` (key `sync*`) |
| Test | `src/sync.test.ts` (rebase round-trip, profile round-trip) |

## 6. Giới hạn đã biết / hướng mở rộng

- **Một gốc duy nhất**: chỉ rebase được path dưới một cha chung. Nếu source trải trên nhiều mount khác hẳn nhau (vd có cả `My Drive` lẫn ổ local), cần nâng cấp **multi-root mapping** (đã cân nhắc, tạm hoãn — dùng cha chung là đủ cho setup Shared drives hiện tại).
- ~~**Tier B**~~ → đã làm, xem mục dưới.

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
