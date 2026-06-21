# SpineForge X

**English** · [Tiếng Việt](#tiếng-việt)

> Desktop tool for batch-exporting and version-upgrading Spine files — without breaking each project's own texture-atlas configuration.

**SpineForge X** solves a specific problem: a studio has hundreds of `.spine` files that need upgrading from Spine 3.8.x to 4.3+ and re-exporting runtime data, but each project carries its own atlas-packing settings (min/max size, padding, packing…). Doing it by hand means opening every file, picking a version, choosing an export setting, and clicking export. SpineForge X automates the whole thing with realtime logs, parallel runs, output verification, and an error summary.

Stack: **Tauri** (Rust backend + React/TypeScript frontend). Windows first, macOS later.

---

## Features

- **Batch export** every `.spine` under a root folder via the Spine CLI, with a per-file timeout, output verification after exit 0, and a "X done / Y failed / Z skipped" summary.
- **True parallel jobs** — run multiple Spine processes at once (Tokio semaphore + `JoinSet`), slider 1–8.
- **Per-project export settings from `.spine`** — read the export settings stored inside each project file (atlas min/max, scale, padding, Rectangles/Polygons packing…) and override the base preset, no manual `.export.json` per file.
- **Linked Project (Unity)** — route output straight into the Unity asset tree (`unityRoot/<Type>/<IdFolder>`), matching id by source folder name.
- **Clean Source Folder** — scan and remove unused images (not referenced by the skeleton) when packing per folder; the used/unused list comes from the packed atlas, so it never mislabels images in a skin folder or renamed files.
- **Asset Library (Spine Hub)** — inventory every `.spine` under a library root (version, size, animations/skins) in a table or a **card grid with real skeleton thumbnails**, search by `anim:`/`skin:`, a version-mix panel, "used by N projects", free-form tags + owner, Google Drive metadata (last editor / history / past revisions), and a **live skeleton preview** via the Spine web player (3.8 + 4.x). Data syncs to a fixed, auto-detected Google Drive folder — your **per-user workspace** (projects/sessions, keyed by Google account) stays separate from the **shared team library** (library list + tags + thumbnails).
- **Background tray** + single instance — closing/minimizing hides to tray; reopening restores the exact hidden window.
- **Region-based drag & drop** — drop a folder/file on the left half to set input, the right half to set output.
- **Per-project dashboard**, **in-app changelog**, **auto-updater** with a "What's new" button.
- **Unicode path workaround** — copy-to-temp-ASCII for paths with non-ASCII characters (a Spine CLI quirk).

---

## Requirements

- [Node.js](https://nodejs.org/) 18+ and npm
- [Rust](https://www.rust-lang.org/tools/install) (stable toolchain) + [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/)
- **Spine editor** installed (needs `Spine.com` on Windows to run the CLI batch)

---

## Getting started

```bash
# Install frontend dependencies
npm install

# Run the app in dev mode (Vite + Tauri)
npm run tauri dev
```

### Release build

```bash
npm run tauri build
```

> Note: `npm run tauri build` may **exit 1 at the updater-signing step** while the bundles (`.exe`/`.msi`) are still produced successfully — this is a known situation, check the `src-tauri/target/release/bundle/` folder.

---

## Development & testing

```bash
npm run dev          # frontend only (Vite)
npm test             # frontend unit tests (Vitest + jsdom + RTL)
npm run build        # file-size check + tsc + vite build
npm run lint:size    # guard: block new files > 800 lines

cd src-tauri
cargo test           # backend unit + property tests (proptest)
cargo clippy
```

The project follows a **keep files small** convention: `scripts/check-file-size.mjs` blocks files past the threshold; logic is split by domain (frontend hooks, separate Rust modules for `cleaner`, `presets`, `system`, `spine_project`, `tray`).

---

## Release & CI/CD

Releases are published via **GitHub Actions**. Pushing a `v*.*.*` tag triggers [.github/workflows/release.yml](.github/workflows/release.yml), which uses `tauri-apps/tauri-action` on `windows-latest` to build the NSIS installer, create the GitHub Release, and attach the installer, `.sig`, and `latest.json` (consumed by the in-app auto-updater).

```bash
git tag -a v0.3.6 -m "v0.3.6"
git push origin v0.3.6
```

Required repository secrets: `TAURI_SIGNING_PRIVATE_KEY` and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

---

## Project structure

```
src/                    React/TypeScript frontend (domain hooks, components, i18n)
src-tauri/              Rust backend
  src/lib.rs            Command hub (Tauri commands)
  src/spine_project.rs  .spine parser (raw deflate, varint zigzag) — reads export settings
  src/cleaner.rs        Scan/remove unused images in the source folder
  src/presets.rs        Export-preset management
  src/tray.rs           System tray + single instance
docs/                   Design doc, ROADMAP, research notes
  ROADMAP.md            Source-of-truth for whole-project progress
  SpineForge_Design_Doc.md
export-sample/          Spine's official export sample script
CHANGELOG.md            User-facing changelog (CI extracts per-version release notes)
```

---

## `.spine` format (reference)

A 3.8.x `.spine` file is **raw deflate**. Integers in the settings block are stored by Spine (libGDX `writeInt`) as **varint zigzag** — reading them as plain unsigned doubles the value. The decoder currently reads atlas min/max pack, scale, padding, the booleans, and packing (Rectangles/Polygons). Details: [docs/research-padding-not-decoded.md](docs/research-padding-not-decoded.md) and [docs/SpineForge_Design_Doc.md](docs/SpineForge_Design_Doc.md) §XI.

> Reliability note: settings inside a `.spine` are accurate only **right after an export from the editor's Export window**. Exporting via script/preset/CLI does not write back to the file → values may be stale. Studios using a shared preset should pick the "use preset for all files" mode.

---

## Roadmap & versions

Whole-project progress lives in [docs/ROADMAP.md](docs/ROADMAP.md); the user-facing change history (with the current version) is in [CHANGELOG.md](CHANGELOG.md).

---
---

# Tiếng Việt

[English](#spineforge-x) · **Tiếng Việt**

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
- **Asset Library (Spine Hub)** — kiểm kê mọi `.spine` dưới thư mục thư viện (version, dung lượng, animation/skin) ở dạng bảng hoặc **lưới thẻ kèm thumbnail skeleton thật**, tìm theo `anim:`/`skin:`, tab gom version lẫn lộn, "dùng bởi N project", gắn tag + người phụ trách, dữ liệu Google Drive (người sửa cuối / lịch sử / mở bản cũ), và **xem trước skeleton trực tiếp** bằng Spine web player (3.8 + 4.x). Dữ liệu đồng bộ vào một thư mục Google Drive cố định (tự dò) — **workspace riêng từng người** (project/session, theo tài khoản Google) tách khỏi **thư viện dùng chung của nhóm** (danh sách + tag + thumbnail).
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

## Release & CI/CD

Release được phát hành qua **GitHub Actions**. Push tag `v*.*.*` sẽ kích hoạt [.github/workflows/release.yml](.github/workflows/release.yml), dùng `tauri-apps/tauri-action` trên `windows-latest` để build installer NSIS, tạo GitHub Release, và đính kèm installer, `.sig`, `latest.json` (auto-updater trong app dùng file này).

```bash
git tag -a v0.3.6 -m "v0.3.6"
git push origin v0.3.6
```

Secrets cần khai trên repo: `TAURI_SIGNING_PRIVATE_KEY` và `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

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

## Roadmap & phiên bản

Tiến độ toàn dự án ở [docs/ROADMAP.md](docs/ROADMAP.md); lịch sử thay đổi user-facing (kèm phiên bản hiện tại) ở [CHANGELOG.md](CHANGELOG.md).
