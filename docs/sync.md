# Đồng bộ dữ liệu app qua Google Drive (Sync — Tier A)

**Sync** giúp animator làm việc xen kẽ giữa máy công ty và máy nhà: toàn bộ **project / session / cấu hình** được mirror vào một file JSON đặt trong thư mục Google Drive dùng chung, nên mở app ở máy khác là có sẵn workspace, không phải set-up lại. Đường dẫn source spine được lưu **tương đối** so với một gốc Drive chung và **tự ghép lại** cho đúng ổ đĩa của từng máy (G:\ vs H:\).

> Đây là **Tier A** (file-based, không cần mạng/OAuth) — dựa vào Google Drive for desktop tự đồng bộ file giữa các máy. Tier B (lấy owner/lịch sử/version qua Drive API) là việc tương lai, xem [ROADMAP.md](ROADMAP.md).

---

## 1. Khái niệm

| Khái niệm | Ý nghĩa |
|-----------|---------|
| **Google Drive root (gốc chung)** | Một thư mục duy nhất, VỪA là nơi lưu file profile, VỪA là gốc quy đổi đường dẫn. Chọn **cha chung** chứa mọi project — vd `G:\Shared drives` — chứ không phải folder của một project. |
| **Profile file** | `spineforge-profile.json` nằm trong gốc chung; chứa appConfig (trừ `spinePath`), projects, sessions, libraries. Có bản backup `spineforge-profile.bak.json`. |
| **`${SPINE_ROOT}` token** | Mọi path nằm dưới gốc chung được lưu dạng `${SPINE_ROOT}/...`; khi load ở máy khác, token được thay bằng gốc chung của máy đó. |

**Không bao giờ đồng bộ** (machine-local, lưu riêng mỗi máy): đường dẫn Spine.exe (`spinePath`), bản thân vị trí gốc Drive, theme/ngôn ngữ.

## 2. Cách dùng

1. Settings ▸ **Sync (Google Drive)**. Toggle **mặc định bật**.
2. **Google Drive root**: lần đầu app **tự dò** `<ổ>:\Shared drives` (Google Drive for desktop mount mọi Shared drive ở đây). Dò được → tự điền; không được → cảnh báo, chọn thủ công.
3. Tạo/sửa project, session… → app **debounce ~1.5s** rồi ghi vào profile. Status dot trên titlebar: **xám** = tắt/chưa cấu hình · **vàng** = chưa lưu/đang ghi · **xanh** = đã đồng bộ · **đỏ** = lỗi.
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
| Status dot (titlebar) | `src/components/SyncStatusDot.tsx` + `.css` |
| Settings ▸ Sync | `src/components/SettingsModal.tsx` |
| Đọc/ghi file + dò Drive | Rust `system::read_text_file`, `system::write_text_file`, `system::detect_drive_root` |
| i18n | `src/i18n/{vi,en}.ts` (key `sync*`) |
| Test | `src/sync.test.ts` (rebase round-trip, profile round-trip) |

## 6. Giới hạn đã biết / hướng mở rộng

- **Một gốc duy nhất**: chỉ rebase được path dưới một cha chung. Nếu source trải trên nhiều mount khác hẳn nhau (vd có cả `My Drive` lẫn ổ local), cần nâng cấp **multi-root mapping** (đã cân nhắc, tạm hoãn — dùng cha chung là đủ cho setup Shared drives hiện tại).
- **Tier B** (owner email / lịch sử sửa / version các file spine): đọc file qua folder Drive KHÔNG lấy được — cần Google Drive REST API + OAuth + secure token. 3 quyết định cần chốt trước khi code: OAuth client embedded vs user-nhập; lưu token keyring vs stronghold; chỉ đọc metadata vs cả restore version.
