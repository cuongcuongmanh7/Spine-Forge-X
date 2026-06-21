# Setup Firebase cho SpineForge X (sync metadata + thumbnail)

Hướng dẫn này **DEV làm một lần**. Animator không đụng tới — họ chỉ "Đăng nhập Google" như cũ.
Kiến trúc & lý do: xem [docs/sync.md ▸ "Bảo vệ dữ liệu"](sync.md).

> Dùng lại **GCP project `spineforge-x`** đã tạo cho Tier B (Google Drive API) — không cần project mới.

---

## 1. Bật Firebase trên project sẵn có

1. Vào <https://console.firebase.google.com> → **Add project** → chọn **import project có sẵn** `spineforge-x` (cùng project GCP của Tier B).
2. **Build ▸ Firestore Database ▸ Create database** → **Production mode** → chọn region (vd `asia-southeast1`).
   - Sau khi tạo: **⋯ ▸ Settings**, bật **Point-in-time recovery (PITR)**.
3. **Build ▸ Storage ▸ Get started** → Production mode → cùng region. (Cần bật **Blaze**/billing — metadata + thumbnail nằm gọn trong hạn mức free, chi phí ≈ $0.)

## 2. Bật đăng nhập Google (tái dùng OAuth Tier B)

1. **Build ▸ Authentication ▸ Get started ▸ Sign-in method ▸ Google ▸ Enable**, lưu.
2. App đăng nhập bằng **id_token** lấy từ OAuth "Desktop app" của Tier B (luồng Rust). Để Firebase tin token đó:
   - Mở **Web SDK configuration** trong mục Google provider → đảm bảo **Whitelist client IDs** có **client ID OAuth "Desktop app"** (cái dùng cho `SPINEFORGE_GOOGLE_CLIENT_ID`). Cùng project nên thường đã được tin; nếu lỗi `auth/invalid-credential` thì thêm client ID đó vào đây.
   - (Nếu cần hạn chế domain: tổ chức là Workspace `ondigames.com` — rules đã chặn email ngoài `@ondigames.com` rồi.)

## 3. Lấy web config + điền .env.local

1. **Project settings (⚙) ▸ General ▸ Your apps ▸ Add app ▸ Web (</>)** → đặt tên (vd `spineforge-x`). **Không** cần Hosting.
2. Copy đoạn `firebaseConfig` rồi tạo file **`.env.local`** ở gốc repo (đã gitignore) theo mẫu `.env.example`:

```
VITE_FIREBASE_API_KEY=AIza...
VITE_FIREBASE_AUTH_DOMAIN=spineforge-x.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=spineforge-x
VITE_FIREBASE_APP_ID=1:1234567890:web:abc...
VITE_FIREBASE_STORAGE_BUCKET=spineforge-x.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=1234567890
```

> Các giá trị này **không phải secret** (web config công khai theo thiết kế; an toàn nhờ rules). Thiếu chúng → app vẫn chạy, chỉ tắt lớp Firebase.

## 4. Seed danh sách leader (role)

Leader **không hardcode** — nằm trong doc Firestore. Tạo bằng Console:

- **Firestore ▸ Start collection** `config` → **Document ID** `roles` → thêm field:
  - `leaderEmails` (kiểu **array**) = `["cuongdm@ondigames.com"]` *(viết thường)*.
- Sau này đổi/thêm leader = sửa đúng array này, **không động code, không redeploy**. App cập nhật ngay (live).

## 5. Deploy rules

Đã có `firebase.json`, `.firebaserc` (project `spineforge-x`), `firestore.rules`, `storage.rules` trong repo.

```bash
npm i -g firebase-tools      # nếu chưa có
firebase login               # đăng nhập tài khoản có quyền trên project
firebase deploy --only firestore:rules,storage
```

## 6. Chạy thử

```bash
npm run tauri dev            # bản dev ghi vào envs/dev (tách prod)
```

- Đăng nhập Google (nút tài khoản góc dưới sidebar). App tự đổi sang phiên Firebase (không đăng nhập 2 lần).
  - ⚠️ Tài khoản đã đăng nhập Drive **trước** bản này cần **đăng xuất rồi đăng nhập lại** một lần để cấp scope `openid`.
- Tạo/sửa project → kiểm Firestore Console thấy doc `envs/dev/workspaces/<uid>` cập nhật (có `updatedAt` server).
- Mở tab Library: với `cuongdm@ondigames.com` thấy nút thêm `+`/xoá; tài khoản khác thì ẩn.
- Thumbnail: duyệt Library → ảnh xuất hiện và được upload lên `envs/dev/thumbs/...` (máy khác mở khỏi render lại).

## 7. CI (release build)

`.github/workflows/release.yml` đã nhận 6 biến `VITE_FIREBASE_*` từ **repo secrets**. Vào
**GitHub ▸ Settings ▸ Secrets and variables ▸ Actions** thêm 6 secrets cùng tên với giá trị ở bước 3
(bản release dùng `envs/prod`). Thiếu → bản release vẫn chạy nhưng tắt lớp Firebase.

---

### Checklist nhanh
- [ ] Firestore (Production) + PITR
- [ ] Storage (Production)
- [ ] Auth ▸ Google enabled + whitelist Desktop client ID
- [ ] Web app → `.env.local` (6 biến)
- [ ] `config/roles.leaderEmails = ["cuongdm@ondigames.com"]`
- [ ] `firebase deploy --only firestore:rules,storage`
- [ ] 6 GitHub secrets `VITE_FIREBASE_*` (cho CI)
