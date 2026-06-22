# Web Viewer — preview Library trên browser (plan)

Một **web app chạy trên trình duyệt** cho đối tượng **non-animator trong công ty** chỉ muốn
**preview nhanh animation trong Library** — không cài app desktop, không có Spine CLI, không dùng
workspace/export. Bổ sung cho lộ trình Spine Hub (xem [sync.md](sync.md), [spine-hub-tier-c.md](spine-hub-tier-c.md)).

> Trạng thái: **plan** (2026-06-22). Chưa code. Phase 0 (PoC) → Phase 1 (MVP) → Phase 2 (polish).

## Bối cảnh & quyết định đã chốt
- **Đối tượng:** đồng nghiệp non-animator, **có gmail công ty (`ondigames.com`)** nhưng **không mount
  shared drive** theo cách app desktop làm, và không có Spine 2D CLI để export. Họ chỉ cần *xem* asset
  trông thế nào. Có thể phục vụ cả trên **web** lẫn **app desktop ở "viewer-mode"** (người không mount).
- **Insight then chốt (2026-06-22):** inventory hiện tại **dựng từ filesystem** (`scan_library` đọc đĩa
  mount; thumbnail render local; sidecar tag/notes là file trên đĩa) → **không tái dùng được** cho người
  không mount. Họ cần một **data-path đọc-từ-cloud**, không phải mở rộng đường filesystem. (Bản thân OAuth
  `drive.readonly` chạy được mà không cần mount — mount chỉ là tiện cho filesystem.)
- **Scope phase 1:** **list + preview, read-only**. Không tạo/sửa/export/comment.
- **Nguồn asset:** **backend proxy đọc shared drive Pamvis** (KHÔNG dùng Cloud Storage để chứa asset).
- **Cách chạm drive:** **Google Drive API + service account** được add làm member của Shared Drive
  → đọc không cần mount, chạy được bất kỳ đâu. Tận dụng code Tier B (`feat/sync-drive-tier-b`).
- **Auth:** **Firebase Auth (Google)** phía web, khoá domain `ondigames.com`; backend verify ID token.

## Nguyên tắc
- **Một component preview, hai môi trường.** `LibrarySpinePreviewModal` + `useSpinePreview` render bằng
  Spine web player (WebGL) — **đã browser-native**, không đụng Tauri/Node. Tái dùng gần như nguyên si.
- **Chỉ phân nhánh ở `AssetProvider` + build target.** Desktop = TauriProvider (IPC), web = HttpProvider (fetch).
- **Secret chỉ ở backend.** Service account key không bao giờ ra browser; web chỉ cầm Firebase token.
- **Drive API đắt & chậm → cache index.** Không quét lại cây thư mục mỗi request.

---

## Kiến trúc

```
┌─────────────────┐   HTTPS + Firebase ID token    ┌──────────────────┐   Drive API (svc acct)  ┌──────────────────┐
│  Web app (Vite) │ ─────────────────────────────> │  Backend proxy   │ ──────────────────────> │ Pamvis Shared    │
│  read-only      │   GET /units                   │  - verify token  │                         │ Drive            │
│  Firebase Auth  │ <───────────────────────────── │  - traverse Drive│ <───────────────────── │ spine_app_data\… │
│  Spine player   │   GET /units/:id/assets/:file  │  - cache index   │                         │                  │
└─────────────────┘                                └──────────────────┘                         └──────────────────┘
```

---

## 1. AssetProvider abstraction (frontend)
**Mục tiêu:** tách 2 chỗ duy nhất preview đụng Tauri để web swap được backend.
**Hiện trạng:** `useSpinePreview.ts` gọi `invoke('list_export_assets')` (line ~278) và `buildRawDataURIs`
gọi `invoke('read_file_data_url')` (`spineRuntime.ts` line ~57). Phần render sau đó thuần WebGL.
**Thiết kế:** interface
```ts
interface AssetProvider {
  listAssets(unitId): Promise<ExportAssets>          // skeleton/atlas/pages
  assetUrl(unitId, file): string | Promise<string>   // URL để player nạp
}
```
- `TauriAssetProvider` — bọc 2 lệnh invoke hiện tại (giữ nguyên hành vi desktop).
- `HttpAssetProvider` — `listAssets` = `GET /units/:id/assets`; `assetUrl` trả URL `GET /assets/...`.
**Việc cần làm:** trừu tượng hoá trong `useSpinePreview`/`spineRuntime`; inject provider qua context theo
build target. Desktop không đổi hành vi.
**Lưu ý:** web **không cần base64 data URI** — Spine player nhận URL thật, browser tự fetch + cache → nhẹ hơn
desktop. (Vẫn cần header CORS + `connect-src` CSP phù hợp.)

## 2. Build target web (frontend)
**Mục tiêu:** build ra bundle tĩnh chạy trên browser, loại bỏ code Tauri.
**Thiết kế:** thêm config/flag Vite (vd `VITE_TARGET=web`) gate các import Tauri (`@tauri-apps/api`) sau
một lớp adapter; entry web chỉ mount màn Library + preview (bỏ workspace, settings desktop…).
**Việc cần làm:** entry riêng (vd `src/web/main.tsx`), tree-shake/guard mọi đường dẫn chạm `invoke`/Drive OAuth
của Tauri; output `web-dist/`.
**Lưu ý:** kiểm tra không lọt `invoke` nào vào bundle web (dễ vỡ runtime). Có thể alias `@tauri-apps/api` →
stub khi build web để fail-fast lúc compile.

## 3. Backend proxy (mới)
**Mục tiêu:** server đọc shared drive qua Drive API, verify auth, serve list + file cho web.
**Endpoints (read-only):**
- `GET /units` → danh sách unit (id, tên, version, animations/skins nếu rẻ, thumbnail nếu có).
- `GET /units/:id/assets` → `{ skeleton, atlas, pages[] }` (mỗi cái là file id/URL tương đối).
- `GET /assets/:fileId` → **stream** `files.get?alt=media` về browser, kèm `Cache-Control`.
**Drive API:**
- Service account là **member của Shared Drive**; mọi call set `supportsAllDrives=true`,
  `includeItemsFromAllDrives=true`, `corpora=drive`, `driveId=<Pamvis>`.
- Map cấu trúc `spine_app_data\…\<unit>\export\` (·`ex\`) → tìm skeleton(`.json`/`.skel`) + `.atlas` + pages,
  song song với logic `list_export_assets` ở `src-tauri/src/library.rs` (port sang lời gọi Drive).
**Cache index (bắt buộc):** map `unit → {folderId, fileIds, mtime}` trong bộ nhớ/Redis/file; refresh theo TTL
hoặc Drive `changes` API. Tránh duyệt cây mỗi request (chậm + dính quota).
**Việc cần làm:** chọn stack (xem Câu hỏi cần chốt), implement traversal + cache + token-verify + stream.
Tận dụng tối đa Tier B (`feat/sync-drive-tier-b`) cho phần Drive auth/list.
**Lưu ý:** quota Drive API có giới hạn; stream file nặng (PNG atlas) cần backpressure + cache header tốt.

## 4. Auth (web + backend)
**Mục tiêu:** chỉ người trong công ty xem được; không cần cài gì.
**Web:** Firebase Auth Web SDK, đăng nhập Google, **chặn email ngoài `ondigames.com`** (kiểm domain sau khi
sign-in, từ chối nếu lệch). Tái dùng config Firebase đã có ([firebase-setup.md](firebase-setup.md)).
**Backend:** mỗi request kèm Firebase **ID token** ở header; backend verify chữ ký + domain bằng Firebase
Admin SDK trước khi gọi Drive. Không có token hợp lệ → 401.
**Lưu ý:** lock domain ở **cả hai** phía (client chỉ là UX, backend mới là rào thật).

---

## 5. Hướng kiến trúc: publish-index vs proxy duyệt Drive (cần chốt)

Có **hai cách** lấy danh sách + metadata + thumbnail cho viewer. Quyết định này tách theo **lớp dữ liệu**,
không loại trừ nhau:

**A — Backend proxy duyệt Drive mỗi request (đang mô tả ở §3).** Server dùng service account `files.list`
duyệt cây `spine_app_data` theo yêu cầu, cache index. Đơn giản về nguồn sự thật (luôn là Drive), nhưng
duyệt cây + đọc metadata từng file để biết version/anim/skin thì **chậm & tốn quota** với lib lớn.

**B — "Publish index" (đề xuất cho lớp list + thumbnail).** Animator (máy *có* mount) vốn đã `scan_library`
→ **publish** inventory per-file lên **Firestore** (anim/skin/version/bytes) + thumbnail lên **Cloud
Storage**. Viewer (web hoặc desktop viewer-mode) chỉ **đọc index + URL thumbnail từ cloud** → nhanh, rẻ,
không cần mount, không phải tải-parse từng `.spine`. Tận dụng hạ tầng **Tier A đã dựng** (Firestore +
thumbnail-L2 Cloud Storage + Firebase Auth gmail→Firebase đã bridge). Phân quyền khớp sẵn: viewer là
"member" read-only.

**Khuyến nghị:** lớp **list/metadata/thumbnail → đi B** (publish-index, rẻ + chạy được web thuần Firebase
SDK, không cần backend). Lớp **preview spine động** (skeleton+atlas+pages, §1–§3) vẫn cần asset thật →
hoặc upload asset lên Cloud Storage, **hoặc** proxy stream qua service-account như §3. Thumbnail tĩnh phủ
~80% nhu cầu "xem nhanh"; preview động là follow-up nặng hơn.

**Còn thiếu để chạy B:**
1. **Publish per-file inventory lên Firestore** — hiện Firestore mới giữ *library list* + clean-state,
   chưa có anim/skin/version/bytes từng file. Thêm bước ghi sau khi scan (ở app animator).
2. **Upload thumbnail L2 (Cloud Storage) ổn định** — hiện đang optional.
3. **Preview động trên web:** export assets phải reachable (Cloud Storage hoặc proxy §3).

> Web thuần (chỉ list + thumbnail tĩnh, hướng B) có thể **không cần backend proxy** — web đọc thẳng
> Firestore + Cloud Storage bằng Firebase SDK. Backend §3 chỉ cần khi muốn **preview động** mà không đẩy
> asset lên Storage. Cân nhắc khi chốt §3.

---

## Phân kỳ
- **Phase 0 — PoC (chứng minh đường đi):** backend trả 1 unit hardcode + web build render được **1 animation**
  lấy từ Drive qua proxy. Mục tiêu: Drive API → stream → spine-player trong browser thông suốt.
- **Phase 1 — MVP:** list mọi unit trong `spine_app_data`, preview + chọn skin/animation, Firebase Auth khoá
  domain, cache index, deploy thật.
- **Phase 2 — polish:** thumbnail grid, loading/empty states, search cơ bản, hardening quota/cache.

## Câu hỏi cần chốt (cho buổi sau)
0. **Hướng kiến trúc (§5):** list/thumbnail đi **B (publish-index, Firestore + Cloud Storage)** hay
   **A (backend proxy duyệt Drive)**? Nếu chọn B cho list và chỉ cần thumbnail tĩnh → có thể **bỏ luôn
   backend proxy** ở phase đầu (web đọc thẳng Firebase). Quyết cái này trước vì nó định hình §1–§3.
1. **Stack backend:** Node (googleapis, dễ deploy serverless) hay **Rust (axum) tái dùng thẳng code Tier B**?
   (Tradeoff: reuse code Drive vs. hệ sinh thái deploy/Firebase Admin.) — *chỉ cần nếu làm A hoặc preview động.*
2. **Deploy backend ở đâu:** Cloud Run / VPS / serverless? (ảnh hưởng cold start + cách giữ cache index.)
3. **Cache:** in-memory đơn giản (1 instance) hay store ngoài (Redis/file) để scale + giữ qua restart?
4. **`/units` lấy version & anim/skin:** đọc nhẹ từ metadata sẵn có hay phải tải skeleton? (đắt → cân nhắc lazy.)
5. **Thumbnail:** dùng lại thumbnail đã có trên Cloud Storage (Tier hybrid) hay sinh ở backend?

## Verify (khi làm)
- Phase 0: render 1 anim thật trên browser từ Drive (e2e thủ công), không lọt secret ra client.
- Phase 1: test hàm thuần (traversal/map asset) như mẫu `library.test.ts`; `tsc` + `npm test` +
  `vite build --outDir web-dist` xanh; smoke test auth (email ngoài domain bị từ chối ở backend);
  đo latency `/units` + `/assets` với cache nóng/lạnh.
