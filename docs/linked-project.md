# Linked Project — Export thẳng vào Unity

**Linked Project** cho phép SpineForge X export `.spine` đi thẳng vào đúng thư mục trong cây asset Unity, bỏ thao tác copy thủ công. Mỗi lần export, app tự tìm thư mục đích theo **id** lấy từ tên folder nguồn.

---

## 1. Khái niệm

Một **Linked Project** lưu (dùng chung cho mọi session, lưu trong app config):

| Trường | Ý nghĩa | Ví dụ |
|--------|---------|-------|
| **Name** | Tên gợi nhớ | `FD` |
| **Unity root** | Thư mục Unity mà output ghi vào | `D:\Projects\FD\Assets\_Assets\Animations\Spine` |
| **Source root** | Cây art chứa `.spine` (chỉ để tiện, không bắt buộc) | `D:\Art\[FD] Animation` |
| **Types** | Bảng ánh xạ `sourceName → destName` (số ít → số nhiều) | `Hero → Heroes` |

Mỗi **session** chọn 1 Linked Project + 1 Type.

## 2. Quy tắc định tuyến output

```
output = <Unity root> / <destName của Type> / <id folder>
```

Trong đó **id folder** được tìm như sau:

1. Lấy **id** = phần trước dấu `_` đầu tiên của tên folder chứa file `.spine`.
   Ví dụ folder `0001_Fighter` → id `0001`; folder `4001` → id `4001`.
2. Tìm thư mục đích đã tồn tại dưới `<Unity root>/<destName>` theo thứ tự ưu tiên:
   - **Khớp đúng tên** = id (vd có sẵn `Heroes/0001`) → dùng lại.
   - **Khớp tiền tố** `id_` (vd có sẵn `Heroes/0001_Fighter`) → dùng lại.
   - **Không có** → tạo mới một thư mục **theo đúng tên folder nguồn** (không phải chỉ id).

> Nhờ vậy id `0001` sẽ tái dùng `Heroes/0001_Fighter` thay vì tạo thêm `Heroes/0001` trùng lặp.

## 3. Cách dùng

1. Ở section **Output**, chọn policy **Linked Project (Unity)**.
2. Bấm **Quản lý…** để mở modal:
   - **Thêm Project**, đặt **Name**.
   - **Browse** chọn **Unity root** và (tùy chọn) **Source root**.
   - Thêm các **Type** thủ công, hoặc bấm **Auto-fill từ Unity root** để app tự liệt kê các thư mục con của Unity root thành các Type (mặc định `dir → dir`, sửa lại `destName` nếu cần).
   - Bấm **Xong**.
3. Quay lại Output, chọn **Project** và **Type**.
4. Dòng **Đích** hiển thị preview thư mục sẽ ghi, kèm `(tái dùng)` hoặc `(sẽ tạo mới)`.
5. Chọn input `.spine`, bấm **Start**.

## 4. Ví dụ cụ thể — dự án "FD"

**Cấu hình Linked Project:**

- Unity root: `D:\Projects\FD\Assets\_Assets\Animations\Spine`
- Source root: `D:\Art\[FD] Animation`
- Types:
  - `Enemy → Enemy`
  - `Hero → Heroes`
  - `Eidolon → Eidolons`

**Trường hợp A — Enemy id 4001:**

- Input: `D:\Art\[FD] Animation\Enemy\4001\char.spine` → id = `4001`
- Type chọn: `Enemy → Enemy`
- Unity có sẵn `…\Spine\Enemy\4001\` → **dùng lại**
- Output: `D:\Projects\FD\Assets\_Assets\Animations\Spine\Enemy\4001\`

**Trường hợp B — Hero id 0001 (khớp tiền tố):**

- Input: `…\[FD] Animation\Hero\0001_Fighter\hero.spine` → id = `0001`
- Type chọn: `Hero → Heroes`
- Unity có sẵn `…\Spine\Heroes\0001_Fighter\` (không phải `Heroes\0001`) → **dùng lại theo tiền tố `0001_`**
- Output: `…\Spine\Heroes\0001_Fighter\`

**Trường hợp C — id chưa có folder đích (tạo mới):**

- Input: `…\[FD] Animation\Eidolon\7777_NewGuy\e.spine` → id = `7777`
- Type chọn: `Eidolon → Eidolons`
- Unity chưa có thư mục nào tên `7777` hay `7777_*` → **tạo mới** theo tên folder nguồn
- Output: `…\Spine\Eidolons\7777_NewGuy\`

## 5. Wizard khi tạo session mới + Auto-detect Type

Session **mới** đi qua wizard bắt buộc theo bước: (Spine exe nếu chưa cấu hình) → **Input** → **Export** → **Output**. Nút *Tiếp* khóa cho tới khi bước hiện tại hợp lệ; *Hoàn tất* ở bước cuối mới mở full view + nút Run. Session **duplicate** (đã hoàn tất wizard) thì bỏ qua, vào thẳng full view.

Ở bước **Output** với policy Linked Project, app **tự dò Type theo path**: quét các segment đường dẫn file input, khớp `sourceName` của Type (không phân biệt hoa thường) → tự chọn Type. Có nút **Tự dò Type theo path** để chạy lại thủ công.

- Mô hình hiện tại là **1 Type / session**. Nếu các file input thuộc **nhiều loại** (vd có cả `\Hero\` lẫn `\Enemy\`), app chọn loại khớp nhiều nhất và **cảnh báo** — nên tách mỗi loại một session.
- Nếu không file nào khớp Type nào → cảnh báo, chọn Type thủ công.

## 6. Lưu ý

- Cảnh báo ghi đè vẫn áp dụng: nếu thư mục đích đã có file, app hỏi xác nhận trước khi Start.
- Một Linked Project dùng lại cho mọi session — chỉ cần cấu hình một lần.
- Nếu bật **Unicode path workaround**, việc định tuyến không đổi; app chỉ export qua temp ASCII rồi copy kết quả về đúng thư mục đích đã resolve.
