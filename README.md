# SpineForge X

> Công cụ desktop xuất hàng loạt (batch export) và nâng cấp phiên bản file Spine — không làm sai cấu hình texture atlas riêng của từng project.

**SpineForge X** giải quyết bài toán: studio có hàng trăm file `.spine` cần nâng cấp từ Spine 3.8.x lên 4.3+ và export lại runtime data, nhưng mỗi project lại có settings pack atlas riêng (min/max size, padding, packing…). Làm thủ công thì phải mở từng file, chọn version, chọn export setting rồi bấm export. SpineForge X tự động hoá toàn bộ với log realtime, chạy song song, xác minh output và tổng kết lỗi.

Nền tảng: **Tauri** (Rust backend + React/TypeScript frontend). Windows trước, macOS sau.

---

## Tính năng chính

- **Batch export** mọi `.spine` dưới một thư mục gốc qua Spine CLI, có timeout từng file, xác minh output sau exit 0, và tổng kết "X xong / Y lỗi / Z bỏ qua".
- **True parallel jobs** — chạy nhiều process Spine đồng thời (Tokio semaphore + `JoinSet`), slider 1–8.
- **Per-project export settings từ `.spine`** — đọc thẳng settings export lưu trong từng project file (min/max pack atlas, scale, padding, packing Rectangles/Polygons…) và ghi đè lên preset nền, không cần `.export.json` thủ công cho từng file.
- **Linked Project (Unity)** — định tuyến output thẳng vào cây asset Unity (`unityRoot/<Type>/<IdFolder>`), tự khớp id theo tên thư mục nguồn.
- **Clean Source Folder** — quét và gỡ ảnh thừa (không được skeleton tham chiếu) khi pack theo folder; danh sách "used/unused" lấy từ atlas đã pack nên không báo nhầm ảnh trong skin-folder hoặc bị đổi tên.
- **Chạy ngầm ở tray** + single instance — đóng/thu nhỏ là ẩn xuống khay; mở lại khôi phục đúng cửa sổ đang ẩn.
- **Kéo-thả theo vùng** — thả folder/file vào nửa trái đặt input, nửa phải đặt output.
- **Dashboard per-project**, **in-app changelog**, **auto-updater** với nút "What's new".
- **Unicode path workaround** — copy-to-temp-ASCII cho path có ký tự non-ASCII (Spine CLI quirk).

---

## Yêu cầu

- [Node.js](https://nodejs.org/) 18+ và npm
- [Rust](https://www.rust-lang.org/tools/install) (toolchain stable) + [tiền đề Tauri v2](https://v2.tauri.app/start/prerequisites/)
- **Spine editor** đã cài (cần `Spine.com` trên Windows để chạy CLI batch)

---

## Bắt đầu

```bash
# Cài dependency frontend
npm install

# Chạy app ở chế độ dev (Vite + Tauri)
npm run tauri dev
```

### Build release

```bash
npm run tauri build
```

> Lưu ý: `npm run tauri build` có thể **exit 1 ở bước ký updater** trong khi các bundle (`.exe`/`.msi`) vẫn được tạo thành công — đây là tình huống đã biết, kiểm tra thư mục `src-tauri/target/release/bundle/`.

---

## Phát triển & Kiểm thử

```bash
npm run dev          # chỉ frontend (Vite)
npm test             # unit test frontend (Vitest + jsdom + RTL)
npm run build        # check file-size + tsc + vite build
npm run lint:size    # guard: chặn file mới > 800 dòng

cd src-tauri
cargo test           # unit + property test backend (proptest)
cargo clippy
```

Dự án có quy ước **giữ file nhỏ**: script `scripts/check-file-size.mjs` chặn file vượt ngưỡng; logic được tách theo domain (hook frontend, module Rust riêng cho `cleaner`, `presets`, `system`, `spine_project`, `tray`).

---

## Cấu trúc

```
src/                    Frontend React/TypeScript (hook theo domain, components, i18n)
src-tauri/              Backend Rust
  src/lib.rs            Command hub (Tauri commands)
  src/spine_project.rs  Parser .spine (raw deflate, varint zigzag) — đọc settings export
  src/cleaner.rs        Quét/gỡ ảnh thừa trong source folder
  src/presets.rs        Quản lý export preset
  src/tray.rs           System tray + single instance
docs/                   Design doc, ROADMAP, ghi chú nghiên cứu
  ROADMAP.md            Source-of-truth tiến độ toàn dự án
  SpineForge_Design_Doc.md
export-sample/          Sample script export chính thức của Spine
CHANGELOG.md            Changelog user-facing (CI trích theo version cho release notes)
```

---

## Định dạng `.spine` (tham khảo)

File `.spine` 3.8.x là **raw deflate**. Số nguyên trong block settings được Spine (libGDX `writeInt`) lưu dạng **varint zigzag** — đọc unsigned thuần sẽ ra gấp đôi. Decoder hiện đọc được min/max pack, scale, padding, các bool, và packing (Rectangles/Polygons). Chi tiết: [docs/research-padding-not-decoded.md](docs/research-padding-not-decoded.md) và [docs/SpineForge_Design_Doc.md](docs/SpineForge_Design_Doc.md) §XI.

> Lưu ý độ tin cậy: settings trong `.spine` chỉ chính xác **ngay sau khi export từ Export window trong editor**. Export qua script/preset/CLI không ghi ngược vào file → giá trị có thể stale. Studio dùng preset chung nên chọn mode "Dùng preset cho mọi file".

---

## Roadmap

Xem [docs/ROADMAP.md](docs/ROADMAP.md) (source-of-truth tiến độ). Tóm tắt:

- ✅ **v0.2.x** — batch export, parallel jobs, Linked Project, Clean Source, tray, per-project `.spine` settings (mới nhất: v0.2.18 — decode zigzag, packing).
- 📋 **v0.3.0** — macOS support (signing, notarization, `.icns`).
- 📋 **v0.4.0** — Unity Headless Trigger (nút "Export to SpineForge" trong Unity Editor).

---

## Phiên bản

Hiện tại: **v0.2.18**. Lịch sử thay đổi user-facing ở [CHANGELOG.md](CHANGELOG.md).
