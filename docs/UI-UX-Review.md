# UI/UX Review — Spine Forge X

| | |
|---|---|
| **App** | Spine Forge X (React + TypeScript + Tauri desktop app) |
| **Ngày review** | 2026-06-19 |
| **Phương pháp** | Bộ tiêu chí `ui-ux-pro-max` (10 nhóm ưu tiên + pre-delivery checklist) — `D:\Projects\ui-ux-pro-max-skill` |
| **Phạm vi** | App **desktop**. Các rule chỉ dành cho mobile (touch-target 44pt, safe-area, bottom-nav, gesture, viewport zoom) được đánh dấu **N/A — desktop**, không tính là lỗi. |
| **Lưu ý** | Một số mục cần kiểm chứng lúc chạy thật (tỉ lệ contrast chính xác, hành vi screen-reader) → ghi là *"cần verify"* thay vì khẳng định. |

---

## 1. Executive Summary

Spine Forge X có một nền tảng UI **trưởng thành và nhất quán**: design token hoá toàn bộ màu sắc qua CSS variables, hỗ trợ light/dark song song, có focus ring cho keyboard, tôn trọng `prefers-reduced-motion`, và dùng SVG icon (lucide-react) thay vì emoji. Đây là điểm xuất phát tốt hơn phần lớn app desktop nội bộ.

Các điểm cần cải thiện đều ở mức **tinh chỉnh, không phải làm lại**: kiểm chứng contrast của text phụ, mở rộng responsive (hiện chỉ 1 breakpoint), bổ sung `aria-live` thật cho toast, thêm skeleton cho thao tác scan dài, và tách `styles.css` (2.568 dòng) theo domain.

### Bảng điểm

| # | Nhóm | Mức | Một dòng tóm tắt |
|---|------|-----|------------------|
| 1 | Accessibility | ⚠️ | Nền tảng tốt (focus ring, aria-modal, reduced-motion); cần verify contrast + sửa toast aria-live |
| 2 | Touch & Interaction | ✅ / N-A phần mobile | Hover/active/disabled rõ ràng; touch-target 44pt là N/A desktop |
| 3 | Performance | ⚠️ | Font self-host + CSP tốt; thiếu skeleton cho scan dài, chưa rõ virtualize danh sách lớn |
| 4 | Style Selection | ✅ | Flat/minimal nhất quán, 1 icon family, không emoji-as-icon |
| 5 | Layout & Responsive | ⚠️ | Sidebar resize tốt; chỉ 1 breakpoint 720px cho app có thể phóng to/thu nhỏ tự do |
| 6 | Typography & Color | ✅ / ⚠️ | Token semantic hoá tốt; focus ring & status color đang hardcode hex; verify text-muted |
| 7 | Animation | ✅ | 120–180ms + easing nhất quán, reduced-motion được tôn trọng |
| 8 | Forms & Feedback | ✅ / ⚠️ | Validation theo field + confirm trước hành động phá huỷ; rải rác placeholder-as-label cần soát |
| 9 | Navigation | ✅ | Mode toggle role=tablist, active state rõ, sidebar cho secondary nav đúng chuẩn |
| 10 | Charts & Data | ⚠️ | Inventory/Dashboard là bảng (sortable cần verify); chưa có chart thật → phần lớn N/A |

**Verdict:** UI ở mức **tốt (B+)**. Xử lý xong nhóm Critical/High bên dưới là đạt mức chuyên nghiệp đầy đủ.

---

## 2. Findings theo từng nhóm

### 1 — Accessibility (CRITICAL) — ⚠️

**Làm tốt**
- Focus ring cho keyboard: `button/[role=button]/.session-row/.project-header:focus-visible { outline: 2px solid #7aa7ff; outline-offset: 2px }` — [styles.css:1133](src/styles.css:1133). Dùng `:focus-visible` nên không hiện khi click chuột (đúng chuẩn).
- Modal nhất quán có `role="dialog" aria-modal="true"` — 8 modal: [SettingsModal.tsx:32](src/components/SettingsModal.tsx:32), [PresetEditorModal.tsx:75](src/components/PresetEditorModal.tsx:75), [LinkedProjectModal.tsx:108](src/components/LinkedProjectModal.tsx:108), v.v.
- Overlay export dùng `role="alertdialog" aria-modal="true" aria-busy="true"` — [RunOverlay.tsx:30](src/components/RunOverlay.tsx:30).
- Notice trong form dùng `role="status" aria-live="polite"` — [InputSection.tsx:99](src/components/workspace/InputSection.tsx:99), [RunDock.tsx:34](src/components/workspace/RunDock.tsx:34).
- `prefers-reduced-motion: reduce` được xử lý ở [styles.css:2213](src/styles.css:2213) và [styles.css:2532](src/styles.css:2532).
- Row trong sidebar có `role="button"`, `tabIndex={0}`, keyboard Enter/Space/Escape.

**Gap / rủi ro**
- ❌ **Toast không có vùng `aria-live` bền vững.** [Toasts.tsx:6](src/components/Toasts.tsx:6) trả về `null` khi không có toast, và mỗi toast là `role="status"` được mount/unmount động. Screen reader thường **không đọc** nội dung chèn vào một region vừa xuất hiện. → Cần một container `aria-live="polite"` (hoặc `role="status"`) **luôn tồn tại trong DOM**, toast chèn vào trong đó.
- ⚠️ **Contrast text phụ cần verify.** `--text-muted: #5d6678` trên `--surface #ffffff` (light) và `#a8b0bf` trên `--surface #1f2937` (dark) — [styles.css:10,33](src/styles.css:10). Label phụ thường ở 12px, cần đạt ≥ 4.5:1 (hoặc ≥3:1 nếu coi là large/secondary). Verify bằng công cụ contrast cho cả 2 theme.
- ⚠️ **Focus ring màu hardcode `#7aa7ff`** không phải token, nên không đổi theo theme. Cân nhắc đưa thành `--focus-ring` để đồng bộ light/dark.

**Khuyến nghị (ưu tiên cao):** thêm live-region cố định cho toast; chạy kiểm tra contrast cho `--text-muted` ở cả 2 theme; token-hoá màu focus ring.

---

### 2 — Touch & Interaction (CRITICAL) — ✅ (phần mobile N/A)

**Làm tốt**
- State hover/active/disabled phân biệt rõ: hover dùng `--sidebar-hover`, active dùng `--sidebar-active` (tint primary), `button:disabled { opacity: .5; cursor: not-allowed }`.
- Tương tác chính dùng click/tap, không phụ thuộc hover (menu 3 chấm hiện khi hover **nhưng** vẫn focus được bằng keyboard).
- Nút async (Run, Scan) có spinner `.spin` và bị disable khi đang chạy.

**N/A — desktop:** `touch-target-size 44pt`, `touch-spacing 8px`, `haptic`, `system-gestures`, `safe-area`. Không áp dụng cho app chuột/bàn phím.

**Gap nhỏ**
- ⚠️ Menu chỉ hiện khi hover row có thể khó khám phá với người dùng chỉ dùng keyboard — verify rằng nút menu vẫn nhận Tab focus và hiện ra khi focus.

---

### 3 — Performance (HIGH) — ⚠️

**Làm tốt**
- Font self-host (**IBM Plex Sans variable + IBM Plex Mono**, subset latin/latin-ext/vietnamese), không phụ thuộc Google Fonts, CSP `font-src 'self'` — phù hợp app offline desktop. *(Cập nhật 2026-06-19: đổi từ Inter sang superfamily IBM Plex, xem mục 6.)*
- Transition dùng `transform`/`opacity` + easing token, không animate width/height bừa bãi.

**Gap / rủi ro**
- ⚠️ **Thiếu skeleton/progress cho thao tác >1s.** Scan library và clean-source chạy Spine trên nhiều file (lâu). Hiện có overlay/spinner nhưng nên dùng **skeleton hoặc progress có % và file hiện tại** để giảm cảm giác đơ. RunOverlay đã làm tốt cho export — nên áp dụng pattern tương tự cho scan.
- ⚠️ **Virtualize danh sách lớn — cần verify.** Inventory có thể liệt kê hàng trăm `.spine`/ảnh. Với >50 item nên virtualize để giữ scroll mượt. Cần kiểm tra LibraryInventory/CleanSourceTable có virtualization không.
- ⚠️ `styles.css` 2.568 dòng → CSS critical-path lớn (xem nhóm 6 về maintainability).

---

### 4 — Style Selection (HIGH) — ✅

**Làm tốt**
- Phong cách **flat/minimal** nhất quán toàn app; bo góc đồng nhất `--radius-lg: 12px`.
- **Không dùng emoji làm icon** — toàn bộ icon từ `lucide-react` (1 icon family, stroke nhất quán). Đạt rule `no-emoji-icons`.
- Light/dark được thiết kế **cùng nhau** qua token, không phải đảo màu (`--primary` đổi từ `#2563eb` → `#60a5fa` cho nền tối — đúng chuẩn desaturate cho dark mode).
- Mỗi màn hình có 1 CTA chính rõ ràng (Run / Import / Scan).

---

### 5 — Layout & Responsive (HIGH) — ⚠️

**Làm tốt**
- Sidebar **resize được** + double-click reset; trạng thái lưu qua `useSidebarWidth`.
- Layout flex/grid, không fixed-px container; nội dung chính max-width ~980px căn giữa, dễ đọc.
- `index.html` có `<meta viewport>` đúng và **không** chặn zoom (`user-scalable=no`) — đạt.

**Gap / rủi ro**
- ⚠️ **Chỉ một breakpoint `@media (max-width: 720px)`** ([styles.css:2030](src/styles.css:2030), [2203](src/styles.css:2203)). App desktop có thể resize tự do; nên có thêm điểm cho cửa sổ hẹp (sidebar + main chồng dọc, hoặc thu gọn sidebar thành icon) để tránh bóp méo ở 600–800px.
- ⚠️ Verify không có **horizontal scroll** ở bảng Inventory/Dashboard khi cửa sổ hẹp — bảng nhiều cột dễ tràn ngang.

---

### 6 — Typography & Color (MEDIUM) — ✅ / ⚠️

**Làm tốt**
- **Token semantic hoá tốt:** `--bg / --surface / --surface-soft / --border / --text / --text-muted / --primary` định nghĩa ở `:root` và `[data-theme="dark"]` ([styles.css:3–44](src/styles.css:3)). Component **không** hardcode hex (đúng `color-semantic`).
- Type scale rõ: body 14px line-height 1.5, label 12px uppercase letter-spacing, monospace cho log/preset.
- Easing token chung `--ease: cubic-bezier(0.2, 0.8, 0.2, 1)`.
- ✅ **(2026-06-19) Superfamily nhất quán:** đổi sang **IBM Plex Sans** (UI, variable 100–700) + **IBM Plex Mono** (log/preset/path) — cùng designer, khớp x-height. Khắc phục điểm yếu trước đây: UI dùng Inter còn mono phó mặc font hệ thống (`SFMono/Consolas`) → giờ log và label đồng bộ. Tự host subset latin/latin-ext/vietnamese, OFL-1.1. File: [fonts.css](src/fonts.css), [styles.css:49](src/styles.css:49).

**Gap / rủi ro**
- ⚠️ **Status color (green/amber/red) đang hardcode hex inline** trong component thay vì token semantic (`--success / --warning / --danger`). Nên đưa vào token để đồng bộ và dễ chỉnh dark mode.
- ⚠️ **Focus ring `#7aa7ff` hardcode** (lặp lại từ nhóm 1).
- ⚠️ **`styles.css` 2.568 dòng** — đi ngược nguyên tắc *keep files small* của dự án. Đề xuất tách theo domain: `tokens.css`, `sidebar.css`, `modals.css`, `forms.css`, `library.css` (đã có sẵn vài CSS theo component, mở rộng pattern này).

---

### 7 — Animation (MEDIUM) — ✅

**Làm tốt**
- Thời lượng micro-interaction 120–180ms (`transition: background 0.15s var(--ease)`), nằm trong khoảng khuyến nghị 150–300ms.
- `prefers-reduced-motion: reduce` rút animation về ~0 ở 2 chỗ ([styles.css:2213](src/styles.css:2213), [2532](src/styles.css:2532)).
- Animation có ý nghĩa: `.pulse` cho session đang chạy, `.spin` cho loading, `toast-in` fade+slide.

**Gap nhỏ**
- ⚠️ Verify exit animation ngắn hơn enter (~60–70%) cho toast/modal để cảm giác phản hồi nhanh (tinh chỉnh, không bắt buộc).

---

### 8 — Forms & Feedback (MEDIUM) — ✅ / ⚠️

**Làm tốt**
- Validation **theo từng field** với icon trạng thái (`FieldStatus` ✓/⚠/✗ trong [common.tsx](src/components/common.tsx)), lỗi đặt ngay cạnh field (đúng `error-placement`).
- **Confirm trước hành động phá huỷ:** delete session/project, move unused images → backup, đóng preset editor khi có thay đổi chưa lưu (dirty-state).
- Toast **auto-dismiss 3.5s** ([useAppController.tsx:89](src/useAppController.tsx:89)) — đúng khoảng 3–5s.
- Empty state có heading + hint + action (New session / Browse folder).
- Helper qua component `Hint()` (icon ? + tooltip).

**Gap / rủi ro**
- ⚠️ **Soát placeholder-as-label.** Một số input (search, path) có thể chỉ dùng placeholder làm nhãn. Đảm bảo input quan trọng có label nhìn thấy hoặc `aria-label`.
- ⚠️ **Toast steal-focus / aria-live** (trùng nhóm 1): toast hiện `role="status"` nhưng container không bền vững.

---

### 9 — Navigation (HIGH) — ✅

**Làm tốt**
- **Mode toggle** dùng `role="tablist"` + `role="tab"` + `aria-selected` ([ModeToggle.tsx](src/components/ModeToggle.tsx)) — phân tách rõ Workspace vs Library.
- **Sidebar cho secondary navigation** (projects/sessions, settings, dashboard) — đúng `drawer-usage`; không nhồi primary action vào đó.
- **Active state rõ:** `.session-row.active`, `.library-tab.active` tint primary + chữ đậm — đạt `nav-state-active`.
- Vị trí navigation nhất quán giữa các màn hình; không trộn lẫn tab + bottom-nav + sidebar cùng cấp.
- Modal **không** bị dùng làm luồng điều hướng chính (đúng `modal-vs-navigation`); modal đều có nút đóng + Escape.

**N/A — desktop:** `bottom-nav-limit`, `tab-bar-ios`, `gesture-nav`, `deep-linking` (app không dùng URL route).

**Gap nhỏ**
- ⚠️ Tab "Coverage" disabled (coming soon) hiện ở dạng `opacity: 0.4` — tốt, nhưng cân nhắc tooltip *"sắp ra mắt"* để giải thích vì sao không bấm được (đạt `empty-nav-state`).

---

### 10 — Charts & Data (LOW) — ⚠️ (phần lớn N/A)

**Hiện trạng**
- App **chưa có chart** đúng nghĩa; dữ liệu hiển thị dạng **bảng** (Inventory, ProjectDashboard với done/failed/skipped/duration).

**Gap / rủi ro**
- ⚠️ **Sortable table — cần verify.** Bảng dữ liệu nên hỗ trợ sort với `aria-sort`. Kiểm tra Inventory/Dashboard.
- ⚠️ **Tabular figures cho cột số.** Cột số (file count, duration, MB) nên dùng `font-variant-numeric: tabular-nums` để tránh nhảy layout.
- ⚠️ Empty-data state cho Dashboard/Inventory khi chưa scan — verify có thông điệp hướng dẫn thay vì bảng trống.

---

## 3. Danh sách hành động ưu tiên

### 🔴 Critical (accessibility, làm trước)
1. **Toast live-region bền vững** — thêm container `aria-live="polite"` luôn tồn tại trong DOM; toast render bên trong. File: [Toasts.tsx](src/components/Toasts.tsx).
2. **Verify contrast `--text-muted`** ở cả light (`#5d6678` trên `#fff`) và dark (`#a8b0bf` trên `#1f2937`); chỉnh nếu < 4.5:1. File: [styles.css:10,33](src/styles.css:10).

### 🟠 High
3. **Token-hoá màu focus ring + status** (`--focus-ring`, `--success/--warning/--danger`) thay cho hex hardcode. File: [styles.css](src/styles.css).
4. **Thêm breakpoint cho cửa sổ hẹp** (sidebar thu gọn / chồng dọc) ngoài 720px; verify không tràn ngang bảng. File: [styles.css:2030](src/styles.css:2030).
5. **Skeleton/progress chi tiết cho scan dài** (library scan, clean-source) giống RunOverlay. File: [LibraryView.tsx](src/components/LibraryView.tsx), [CleanSourceScanOverlay.tsx](src/components/cleanSource/CleanSourceScanOverlay.tsx).

### 🟡 Medium
6. **Tách `styles.css`** (2.568 dòng) theo domain — phù hợp nguyên tắc keep-files-small của dự án.
7. **Soát placeholder-as-label**; bổ sung `aria-label` cho input chỉ có placeholder.
8. **Verify virtualization** danh sách Inventory/clean khi >50 item.

### ⚪ Low
9. `aria-sort` + `tabular-nums` cho bảng dữ liệu.
10. Tooltip "sắp ra mắt" cho tab Coverage; exit animation ngắn hơn enter.

---

## 4. Pre-Delivery Checklist (adapt cho desktop)

**Visual Quality**
- ✅ Không dùng emoji làm icon (toàn bộ lucide-react SVG)
- ✅ Một icon family nhất quán
- ✅ Token semantic, không hardcode màu trong component… **⚠️ trừ** status color & focus ring (hardcode hex)
- ✅ Pressed-state không làm xê dịch layout

**Interaction**
- ✅ Hover/active/disabled rõ ràng
- 🔲 N/A — touch-target 44pt (desktop)
- ✅ Micro-interaction 120–180ms + easing token
- ✅ Disabled state rõ (`opacity .5`, `cursor: not-allowed`)
- ⚠️ Focus order vs visual order — *cần verify bằng Tab thực tế*

**Light/Dark Mode**
- ⚠️ Contrast text chính/phụ ≥4.5/3:1 — *cần verify, đặc biệt `--text-muted`*
- ✅ Border/divider có token riêng cho 2 theme
- ✅ Modal scrim đủ đậm (backdrop z-900)
- ⚠️ Test thực tế cả 2 theme (đừng suy từ 1 theme)

**Layout**
- ✅ Sidebar resize + reset
- ⚠️ Verify scroll không bị che bởi titlebar/footer cố định
- ⚠️ Chỉ 1 breakpoint — kiểm tra cửa sổ hẹp & bảng nhiều cột
- ✅ Nhịp spacing nhất quán

**Accessibility**
- ✅ Icon-button có `title`/`aria-label`
- ✅ Form field có label + status + thông báo lỗi
- ⚠️ Color không phải chỉ-báo-duy-nhất — status có **cả icon** (tốt), verify badge overlap
- ✅ Reduced-motion được tôn trọng
- ❌ Toast aria-live region bền vững — **cần sửa**

---

*Review dựa trên đọc tĩnh source (`src/App.tsx`, `src/components/*`, `src/styles.css`, `src/i18n/*`, `src/useAppController.tsx`). Các mục ⚠️ "cần verify" nên kiểm chứng bằng cách chạy app thật + công cụ contrast/screen-reader trước khi kết luận cuối cùng.*
