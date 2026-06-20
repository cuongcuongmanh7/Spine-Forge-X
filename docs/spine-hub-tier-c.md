# Spine Hub — Tier C (plan)

Tầng cuối của lộ trình "Spine Hub" (xem [sync.md](sync.md) cho Tier A/B). Tier A đồng bộ workspace
qua Google Drive; Tier B lấy owner/lịch sử/version qua Drive API. **Tier C biến Library từ "bảng kê
file" thành lớp tri thức** giúp lead/animator trả lời nhanh: *asset này ai phụ trách, đang được
project nào dùng, có animation/skin gì, version có lẫn lộn không, trông ra sao.*

> Trạng thái: **chưa bắt đầu** — đây là plan đề xuất, chốt phạm vi/ưu tiên trước khi code.

## Nguyên tắc
- **Tận dụng dữ liệu đã có trước.** `scan_library` đã trả mỗi `LibraryEntry` kèm `animations[]`,
  `skins[]`, `version`, `exported`, `spineFile`, `relPath` ([src/config.ts](src/config.ts)). Nhiều
  mục Tier C chỉ là lớp UI/đối chiếu trên dữ liệu sẵn có → rẻ, làm trước.
- **Đồng bộ thì đi qua Tier A.** Dữ liệu người dùng tạo (tags) lưu trong profile để máy khác thấy.
- **Ownership ưu tiên Drive (Tier B)** thay vì bắt nhập tay.

---

## 1. Search theo animation / skin  ⭐ ưu tiên 1 (rẻ, đã có data)
**Mục tiêu:** gõ tên một animation/skin → ra mọi `.spine` chứa nó (vd "tìm tất cả file có anim `attack`").
**Dữ liệu:** `entry.animations` / `entry.skins` đã có sẵn từ scan (chỉ với file đã export).
**Thiết kế:** mở rộng ô search Library hiện có thành chế độ "tìm trong anim/skin" (toggle hoặc cú pháp
`anim:attack`, `skin:red`); filter `entries` theo khớp tên; highlight chip animation khớp trong panel.
**Việc cần làm:** thêm vị từ match vào [src/library.ts](src/library.ts) (`entryMatchesFilter`), UI chip/route
trong [LibraryInventory.tsx](src/components/LibraryInventory.tsx). Frontend-only.
**Lưu ý:** file chưa export không có anim/skin → cần gợi ý "rescan/export để index".

## 2. Version-mix panel  ⭐ ưu tiên 2 (đã có một nửa)
**Mục tiêu:** một chỗ tổng hợp các nhóm/đơn vị đang **lẫn lộn editor version** (vd cùng nhân vật có
file 3.8 lẫn 4.3) để lead xử lý đồng bộ.
**Hiện trạng:** `groupByFolder` đã tính cờ `mixedVersion` + có badge cảnh báo trong từng nhóm.
**Thiết kế:** panel/tab "Version" liệt kê: phân bố version toàn thư viện (đã có StatCard theo major),
danh sách nhóm `mixedVersion`, và filter nhanh "chỉ hiện file lệch version so với phần còn lại của nhóm".
**Việc cần làm:** tổng hợp sẵn ở [src/library.ts](src/library.ts); thêm view. Frontend-only.

## 3. Used-by-projects  ⭐ ưu tiên 3 (đối chiếu in-app)
**Mục tiêu:** với mỗi asset, hiện **project/session nào đang dùng nó** (và ngược lại: asset "mồ côi"
không thuộc project nào → ứng viên dọn).
**Dữ liệu:** đối chiếu `entry.spineFile` với `session.config.inputFiles` / `inputPath` của các session
(đã có trong app state). Khớp path đã normalize (`\`→`/`, lowercase) — tái dùng helper của Tier A/clean.
**Thiết kế:** cột/badge "Dùng bởi N project" + tooltip liệt kê; bộ lọc "chưa dùng". Có thể thêm
hành động nhảy tới session.
**Việc cần làm:** hàm thuần `usageByEntry(entries, sessions)`; wire vào controller + UI. Frontend-only.

## 4. Tags / ownership  (cần persistence + sync)
**Mục tiêu:** gắn **tag** tự do (vd `boss`, `cần-review`, `wip`) và **người phụ trách** cho từng asset
hoặc folder; lọc/nhóm theo tag.
**Ownership:** lấy mặc định từ **Tier B** (người sửa cuối / owner Drive) — không bắt nhập tay; cho phép
override thủ công.
**Persistence:** map `relPath → { tags[], owner? }` lưu trong **profile sync** (Tier A) để máy khác thấy;
thêm vào `SyncProfile` (kèm tokenize nếu cần) — xem [src/sync.ts](src/sync.ts).
**Thiết kế:** chip tag editable trên dòng/nhóm; filter theo tag (mở rộng chip-row sẵn có); cột owner gộp
với dữ liệu Tier B.
**Việc cần làm:** kiểu dữ liệu + lưu/đồng bộ + UI chỉnh tag. Đụng cả sync schema → cần migrate cẩn thận.

## 5. Preview thumbnail  (nặng nhất, làm sau cùng)
**Mục tiêu:** xem nhanh asset trông thế nào ngay trong Library.
**Khó khăn:** `.spine` là binary; render skeleton thật cần runtime. Các mức độ:
- **MVP rẻ:** hiện 1 ảnh đại diện từ thư mục ảnh của unit (đã có `read_image_data_url`, lazy-load + cache
  như Clean detail) — không phải "skeleton preview" thật nhưng đủ nhận diện.
- **Đầy đủ (sau):** render skeleton (atlas+json đã export) bằng spine-runtime web, hoặc sinh preview qua
  công cụ ngoài. Phụ thuộc lớn, để cuối.
**Việc cần làm (MVP):** chọn ảnh đại diện + ô thumbnail trong dòng/nhóm, tái dùng pipeline thumbnail sẵn có.

---

## Thứ tự đề xuất
**1 → 2 → 3** (đều frontend-only trên dữ liệu sẵn có, ship nhanh) → **4** (tags/ownership, đụng sync
schema) → **5** (thumbnail, MVP ảnh đại diện trước, skeleton-render để cuối). Có thể gộp **1+2** vào một
release "Library search & version", **3** một release, **4** một release.

## Câu hỏi cần chốt
- Tag/owner đồng bộ qua profile (mọi máy thấy) hay machine-local? (đề xuất: đồng bộ).
- "Used-by" tính theo session hiện có, hay cả lịch sử export? (đề xuất: session hiện có).
- Preview: chấp nhận MVP "ảnh đại diện" trước, hay chờ skeleton-render thật?

## Verify (khi làm)
Mỗi mục: thêm test cho hàm thuần (`library.ts` matcher/usage/version-mix) theo mẫu
[src/library.test.ts]; `tsc` + `npm test` + `npm run build` xanh; e2e bằng `npm run tauri dev` trên một
thư viện thật.
