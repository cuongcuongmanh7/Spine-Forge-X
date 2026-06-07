# UI Design Rules — SpineForge X

Quy ước UI dùng chung. Đọc trước khi thêm/sửa component để giữ nhất quán và tránh lỗi layout lặp lại.

---

## 1. Modal

Cấu trúc chuẩn (xem [NameProjectModal](../src/components/NameProjectModal.tsx), [PresetEditorModal](../src/components/PresetEditorModal.tsx), [LinkedProjectModal](../src/components/LinkedProjectModal.tsx)):

```tsx
<div className="modal-backdrop" onClick={close}>
  <div className="modal <variant>" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
    <div className="modal-header"> <h2/> <button className="modal-close"><X/></button> </div>
    <div className="modal-body"> … </div>
    <div className="modal-footer"> <secondary/> <primary/> </div>
  </div>
</div>
```

- Luôn có backdrop click-to-close + `stopPropagation` trên `.modal`.
- Header dùng `.modal-header` + `.modal-close` (icon `X`).
- Nút: `.secondary-button` (hủy/phụ) trước, `.primary-button` (hành động chính) sau.

### ⚠️ Quy tắc footer (lỗi đã gặp: nút dính border)

`.modal-footer` **mặc định KHÔNG có padding** — nó dựa vào padding của `.modal-body` bao quanh.

- **Footer nằm TRONG `.modal-body`** (modal đơn giản, body có `padding`): không cần làm gì thêm.
- **Footer nằm NGOÀI `.modal-body`** (modal có body cuộn riêng / pinned / 2 cột với body `padding:0`): footer **PHẢI tự mang** padding + `border-top` + background, theo mẫu `.preset-editor .modal-footer` / `.linked-modal .modal-footer`:
  ```css
  .<variant> .modal-footer {
    flex: 0 0 auto;
    margin-top: 0;
    padding: 14px 18px;
    border-top: 1px solid var(--border);
    background: color-mix(in srgb, var(--surface), var(--bg) 20%);
  }
  ```
  Tương tự nếu pin một toolbar phía trên body cuộn (xem `.preset-editor .preset-toolbar`).

### Modal chiều cao cố định + body cuộn

Khi nội dung có thể dài (danh sách, form lớn): KHÔNG để modal cao theo nội dung. Dùng:
```css
.<variant> { display: flex; flex-direction: column; max-height: 86vh; overflow: hidden; }
.<variant> .modal-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
```
Header/footer `flex: 0 0 auto` để pin; chỉ body cuộn.

### Danh sách nhiều mục → master–detail, không xếp dọc

Khi một modal quản lý **nhiều item cùng loại** (vd Linked Projects): dùng 2 cột — list cuộn bên trái, editor của item đang chọn bên phải (xem `.linked-list` / `.linked-detail`). KHÔNG render tất cả item ở dạng card mở rộng xếp dọc (modal sẽ dài vô hạn). Vùng con dài (bảng types…) cũng cap `max-height` + `overflow-y:auto`.

---

## 2. Tip / mô tả → chỉ hiện khi hover

KHÔNG để các dòng mô tả/tip chiếm chỗ cố định. Dùng component `Hint` ([common.tsx](../src/components/common.tsx)) — icon `?` muted, text hiện qua native `title` khi hover:
```tsx
<strong>{label}<Hint text={description} /></strong>
```
Ngoại lệ giữ hiển thị: thông tin **động cần thấy ngay** (vd dòng preview thư mục đích của Linked Project), và `FieldStatus` (icon trạng thái có sẵn tooltip).

---

## 2b. Wizard tạo session mới

Session mới (`wizardCompleted === false`) hiển thị `SessionWizard` (inline stepper) thay cho full view; xong → `completeWizard(id)` chuyển sang full view. Wizard **tái dùng các Section sẵn có** (InputSection/ExportStrategySection/OutputSection) — không nhân bản UI. `wizardCompleted` là field **session-level** (cạnh `autoNamed`, không nằm trong `SessionConfig`): session load từ storage default `true`, `createSession` đặt `false`, `cloneSession` kế thừa. Tính năng phụ thuộc input (vd Auto-detect Type) đặt trong chính Section để chạy được cả trong wizard lẫn full view.

## 3. Section (card thu gọn)

Mỗi nhóm chức năng bọc trong `Section` ([common.tsx](../src/components/common.tsx)): header có chevron, click để mở/đóng, `defaultOpen` tùy nhóm.

---

## 4. Trạng thái field

Dùng `FieldStatus` (icon ok/warning/error + `title`) cạnh input thay vì in text dài. Lỗi/cảnh báo cấp toàn cục dùng `.notice danger|warning|info` (xem RunDock).

---

## 5. i18n

Mọi chuỗi hiển thị thêm vào **cả `vi` và `en`** trong [i18n.ts](../src/i18n.ts). Không hardcode chuỗi tiếng Việt/Anh trong component.

---

## 6. Kiến trúc file (xem memory: prefer-small-files)

- App.tsx mỏng; logic ở `useAppController`; UI ở `components/**`.
- Icon dùng `lucide-react`. Browse thư mục/file dùng `open()` của `@tauri-apps/plugin-dialog`.

---

## 7. UX checklist (desktop)

Chắt lọc các guideline framework-agnostic phù hợp app desktop (Tauri + React + CSS), bỏ phần mobile/marketing. Nguồn tham khảo: bộ rule "UI UX Pro Max". `✓` = đã làm trong app; `☐` = còn cần rà thủ công.

**Accessibility**
- ✓ Không dùng emoji làm icon — dùng SVG (`lucide-react`).
- ✓ Không truyền thông tin **chỉ bằng màu** — status dot có `title` + `aria-label`; `FieldStatus` có icon + `role="img"` + `aria-label`.
- ✓ Nút chỉ-icon có **`aria-label`** (workspace, modals, sidebar, titlebar, wizard).
- ✓ **Keyboard nav** + **focus ring**: `:focus-visible` cho button/`[role=button]`; hàng `session-row`/`project-header` kích hoạt bằng Enter/Space.
- ✓ Lỗi announce bằng `role="alert"`; cảnh báo/info dùng `role="status"` + `aria-live="polite"` (RunDock, OutputSection, InputSection).
- ✓ Tương phản chữ ≥ **4.5:1** (đã đo): `--text` ~10–16:1; `--text-muted` ~4.8:1 (light) / ~6–7.5:1 (dark) trên `--bg`/`--surface`.

**Trạng thái tương tác**
- ✓ Disabled: giảm opacity + đổi cursor.
- ✓ Nút async: disable + spinner (Start/Browse/Detect/Scan…); thao tác > 300ms đều có spinner/overlay.
- ✓ Confirm trước hành động phá hủy / không hoàn tác (`confirm()` khi xóa, ghi đè).
- ✓ Hover/active transition **120–150ms** (`var(--ease)`), trong ngưỡng micro-interaction.

**Feedback**
- ✓ Empty state có hướng dẫn + hành động (`EmptyState`).
- ✓ Progress nhiều bước (wizard stepper, progress bar khi export).
- ✓ Toast cho kết quả ngắn; lỗi hiện gần chỗ phát sinh (`FieldStatus` cạnh input).

**Motion**
- ✓ Tôn trọng `prefers-reduced-motion`: rule toàn cục gần như tắt animation/transition + dừng `.spin` + tắt smooth-scroll.
- ✓ Animation có ý nghĩa (spinner = đang chạy, stepper = tiến trình), không trang trí thuần.

**Typography & nội dung**
- ✓ Cắt chuỗi dài bằng ellipsis + tooltip full (`file-pill`, `linked-card-title`).
- ✓ `line-height` base body = 1.5.
- ✓ Số đếm file format theo locale (`toLocaleString`); ngày giờ log dùng `toLocaleTimeString`.

> Toàn bộ checklist đã đạt. Khi đổi palette/đổi theme sau này, đo lại contrast (≥ 4.5:1 cho text thường).
