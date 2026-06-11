# Nghiên cứu: vì sao `padding` cố tình KHÔNG đọc từ `.spine`

> Trạng thái: quyết định kỹ thuật cho mode `lastExportSettings` (v0.2.15). Liên quan: design doc §XI, `src-tauri/src/spine_project.rs`.
>
> **Update 2026-06-11: đã tìm ra nguyên nhân gốc — xem §8. Field không phải "2× padding" về ngữ nghĩa; nó là varint zigzag (signed), decoder hiện đọc như unsigned nên ra gấp đôi. Giả thuyết "tổng 2 biên" ở §4 bị bác bỏ.**

## 1. Bối cảnh

Mode `lastExportSettings` parse pack settings từ binary `.spine` (3.8.x) rồi merge lên base preset (chi tiết format: design doc §XI). Khi mở rộng decoder ở v0.2.15 để đọc thêm `scale`, câu hỏi đặt ra là có nên đọc luôn `paddingX/paddingY` không. Kết luận: **không** — và đây là lý do, có số liệu.

## 2. Vấn đề quan sát được

Trong khối pack settings, sau `maxHeight`, có cặp field `0x16`/`0x17` đứng đúng vị trí `paddingX`/`paddingY` theo thứ tự schema JSON (`...scale(0x13), scaleSuffix(0x14), scaleResampling(0x15), paddingX(0x16), paddingY(0x17), edgePadding(0x18)...`). Nhưng **giá trị đọc thẳng ra không tái tạo được export thật**.

Ví dụ 3001_Lucius: decode `0x16 = 16`. Export bằng padding 16 cho ra page **364×364**; trong khi export thật từ editor ra **~310–320×310-320**. Phải dùng padding **8** mới khớp.

## 3. Bằng chứng (3 file ground-truth)

Đọc field `0x16` thực tế (`D:\temp\read-padding-field.js`) so với padding đã được verify là đúng:

| File | `max` | field `0x16` | padding thật (đã chứng minh) | cách verify | tỉ lệ |
|------|-------|--------------|------------------------------|-------------|-------|
| Chest.spine | 4096 | **4** | **2** | template padding 2 → atlas+PNG **byte-identical** artist | 2× |
| 3001_Lucius.spine | 1024 | **16** | **8** | padding 8 + scale 0.5 → page ~310 khớp editor (80/80 region); padding 16 → page 364 (lệch) | 2× |
| 0003_Althea.spine | 4096 | **16** | *không xác định* | page layout không reproduce được bất kể padding (xem §5) | — |

→ **2/2 file xác minh được đều cho field `0x16` = đúng 2× padding thật.**

## 4. Phát hiện chính

Field `0x16`/`0x17` trong `.spine` **không phải** là giá trị `paddingX`/`paddingY` mà JSON `.export.json` mong đợi, mà bằng **2 lần** giá trị đó.

Giả thuyết hợp lý (chưa xác nhận chắc): Spine serialize padding dạng "tổng cả hai biên" (mỗi region được đệm padding ở cả 2 phía → tổng = 2× per-side), trong khi field `paddingX` của texture packer JSON là giá trị **một biên**. Cả 2 file đều bật `edgePadding=true`, phù hợp với cách hiểu này.

## 5. Vì sao chưa decode padding (kể cả với công thức ÷2)

Quyết định v0.2.15: **không decode padding, luôn lấy từ base preset.** Lý do:

1. **Đọc thẳng (as-is) chắc chắn sai** — đã chứng minh field 16 → padding 16 làm atlas phình (364 vs 310). Nếu ship as-is sẽ âm thầm cho sai kích thước, đúng loại bug mode này muốn tránh.
2. **Công thức `field ÷ 2` mới chỉ có 2 datapoint.** Đủ để *nghi* mạnh, chưa đủ để ship một phép biến đổi vào code production — nhất là sau bài học `alphaThreshold`/`multipleOfFour` (cũng "có vẻ đúng" rồi lệch trên file thật). Cần ≥ 3–4 file độc lập, lý tưởng là có padding khác nhau (vd 1 file padding lẻ như 3, 5) để loại trừ trùng hợp "×2".
3. **Althea không xác minh được** — page layout của nó không reproduce qua CLI (packing nondeterminism + có thể field khác chưa giải mã), nên không cô lập được padding để kiểm chứng datapoint thứ 3.
4. **Tác động thấp, rủi ro cao** — padding ảnh hưởng kích thước atlas ít hơn nhiều so với min/max và scale. Lấy padding từ preset (giá trị studio cố ý đặt) an toàn và gần như luôn đúng ý; decode sai padding thì lợi bất cập hại.

## 6. Điều kiện để decode padding an toàn (tương lai)

Chỉ nên bật decode padding khi:

- [ ] Có ≥ 4 file ground-truth (export từ editor, biết padding thật), gồm cả padding **lẻ** (3/5/7) để xác nhận công thức không phải "×2" trùng hợp mà là quan hệ thật.
- [ ] Hiểu được *tại sao* field = 2× (đọc thêm field lân cận, hoặc test toggle `edgePadding`/`duplicatePadding` xem có đổi hệ số không).
- [ ] Validate end-to-end: `field ÷ 2` + scale + min/max → tái tạo đúng nhiều file.

Nếu đủ, sửa `decode` trong `spine_project.rs` thêm `paddingX = field0x16 / 2` (+ guard chia hết, range hợp lệ), kèm test fixture.

## 7. Kết luận

Padding **vẫn lấy từ base preset** trong v0.2.15. Đây là lựa chọn đúng: tránh sai âm thầm, và phản ánh đúng độ chắc chắn của dữ liệu reverse-engineered. Pattern "field = 2× padding" được ghi lại ở đây để lần sau có thêm datapoint thì biết bắt đầu từ đâu — không phải dò lại từ số 0.

> Nhắc lại giới hạn nền: kể cả khi decode padding chuẩn, giá trị trong `.spine` chỉ tươi **ngay sau export từ Export window của editor**; export qua script/preset/CLI không ghi ngược (design doc §XI). Với studio dùng preset chung, padding từ preset vẫn là nguồn đúng.

## 8. Nguyên nhân gốc (update 2026-06-11): varint zigzag, không phải "2× ngữ nghĩa"

Phân tích lại block settings của cả 3 file (`D:\temp\zigzag-analysis.js`) cho thấy hệ số ×2 không nằm ở ngữ nghĩa padding, mà ở **tầng encoding varint**:

Spine editor (nền libGDX) serialize int qua `DataOutput.writeInt(value, optimizePositive)`. Với `optimizePositive=false`, giá trị được **zigzag-encode** như protobuf signed varint: `n ≥ 0 → 2n` (tổng quát: `(n << 1) ^ (n >> 31)`). Decoder của ta (`read_varint`) đọc varint như **unsigned thuần** → mọi field int kiểu này ra đúng gấp đôi.

### Bằng chứng (3 datapoint, 2 field khác nhau)

| File | Field | raw đọc được | zigzag-decode | giá trị thật đã verify |
|------|-------|--------------|---------------|------------------------|
| Chest | `0x16/0x17` padding | 4 | **2** | 2 (byte-identical repro) |
| 3001_Lucius | `0x16/0x17` padding | 16 | **8** | 8 (page ~310 khớp editor) |
| 0003_Althea | `0x06` alphaThreshold | 6 | **3** | 3 (calibration note trong `spine_project.rs` — trước đây tưởng là "settings stale", thực ra là zigzag) |

Datapoint Althea quan trọng nhất: nó là field **khác hẳn** padding, giá trị **lẻ** (3), và đã được verify độc lập khi calibrate v0.2.14 — đúng yêu cầu "padding lẻ để loại trừ trùng hợp ×2" mà §6 đặt ra, chỉ là ở field khác.

### Giả thuyết §4 ("tổng 2 biên" + edgePadding) bị bác bỏ

Dump byte thực tế: Chest có `edgePadding` (field `0x18`) = **1** nhưng Lucius = **0**. Hai file khác giá trị edgePadding mà cùng cho hệ số ×2 → hệ số không liên quan edgePadding. (§4 ghi "cả 2 file đều bật edgePadding=true" là sai — lúc đó chưa dump field 0x18.)

### Hệ quả & việc cần làm

1. **Công thức decode đúng là zigzag** (`(raw >> 1) ^ -(raw & 1)`), không phải "÷2 heuristic". Padding/threshold không âm → raw hợp lệ luôn **chẵn**; raw lẻ = field không phải kiểu này → guard tốt.
2. **Float (`scale`, `jpegQuality`) và bool không bị ảnh hưởng** — giải thích vì sao scale decode đúng ngay từ đầu còn các int thì "lệch".

## 9. Thí nghiệm phân định (2026-06-11): XÁC NHẬN — mọi varint int đều zigzag, kể cả min/max

Setup: mở `G:\Shared drives\FD\[FD] Animation\Hero\Chibi\Chibi_3xxx\3001_Lucius\3001_Lucius.spine` trong editor 3.8.99, đặt **padding 3 (lẻ)**, **min 128, max 700 (non-default, non-pow2)**, alphaThreshold 0, scale 0.5, Square + Div4 + EdgePadding + PMA bật, Bleed tắt → export. File project được ghi lại (mtime trùng lúc export). Dump bằng `D:\temp\zigzag-verify-experiment.js`:

| Field | Editor | Raw trong file | Zigzag |
|---|---|---|---|
| paddingX/Y `0x16/0x17` | 3 | **6** | **3** ✓ |
| maxW/H `0x09/0x0A` | 700 | **1400** | **700** ✓ |
| minW/H `0x07/0x08` | 128 | **256** | **128** ✓ |
| alphaThreshold `0x06` | 0 | 0 | 0 ✓ |
| scale `0x13` (f32) | 0.5 | 0.5 | — ✓ |
| bools (square/div4/edgePad/PMA/bleed) | 1/1/1/0… | raw byte khớp hết | — ✓ |

Export thật ra 4 page 308/300/288/272 vuông, chia hết 4, ≤350 (=700×0.5) — khớp settings, khép kín end-to-end.

### Ba bug đã xác nhận trong decoder ship (`spine_project.rs`)

1. **min/max (Tier A, đang ship) bị đọc GẤP ĐÔI.** `07–0A` cũng zigzag → Chest thật là min 128/max 2048 chứ không phải 256/4096. Min gấp đôi có thể ép page phình to hơn ý artist (page bị pad lên min); max gấp đôi cho phép page to quá giới hạn. Cần sửa ngay: zigzag-decode 4 field này.
2. **`is_valid_dimension` đòi power-of-two là quá chặt** — file thật có max raw 1400 (= zigzag 700, non-pow2). Với project như vậy, scanner hiện tại *không tìm thấy block* → toàn bộ decode fail. Cần nới: chấp nhận giá trị chẵn (zigzag của int dương) trong khoảng hợp lệ, pow2 chỉ là heuristic phụ.
3. **Padding và alphaThreshold decode được** bằng zigzag — các lần "calibration demote" trước (alphaThreshold 6≠3, padding 16≠8) đều là hiểu nhầm staleness, thực chất là zigzag. Lưu ý: calibration cũ của `multipleOfFour` cũng có thể bị nhiễu bởi chính min/max-gấp-đôi (layout drift đổ lỗi nhầm cho mof) — nên calibrate lại sau khi sửa sizes.

Điều kiện §6 coi như thỏa (datapoint lẻ ✓, hiểu cơ chế ✓, validate end-to-end ✓).

## 10. Đã sửa trong code (2026-06-11)

`spine_project.rs` sau fix:

- `read_zigzag`: decode varint zigzag, reject raw lẻ (= số âm, không bao giờ hợp lệ cho settings) — dùng cho min/max, alphaThreshold, paddingX/Y.
- Scanner bỏ yêu cầu power-of-two, thay bằng anchor `0B <bool>` (pot) ngay sau maxHeight — có mặt trong 100% sample.
- Re-promote: `alphaThreshold`, `paddingX/Y`, `edgePadding`, `duplicatePadding`, `premultiplyAlpha`, `bleed`, **`multipleOfFour`** (0x0C, đọc thẳng bool — calibration cũ demote là do min/max gấp đôi làm lệch layout, nay min/max đúng thì khớp), **`packing`** (xem dưới).
- Tests tách ra `spine_project_tests.rs`; thêm regression test `experiment_block_lucius_2026_06_11` ghim đúng bytes block của thí nghiệm §9.

Validate cuối (mạnh nhất): decode file thí nghiệm → merge lên preset → Spine CLI export → so với export editor: **cả 4 PNG + atlas.txt + skel.bytes giống từng byte (MD5)**, không chỉnh tay field nào. Page 308/300/288/272 (đều ÷4 vì multipleOfFour=true). Điểm mấu chốt để khớp tuyệt đối: `multipleOfFour=true` **và** `packing=rectangles` — cả hai giờ ra thẳng từ decoder.

## 11. packing (Rectangles/Polygons): field 0x28, đã decode đủ cả hai (2026-06-11)

Giả thuyết ban đầu "packing = field 0x10 (key 16 trong schema)" **SAI** — field 0x10 không hề xuất hiện kể cả ở bản Polygons. Thí nghiệm phân định: export lại Lucius chỉ đổi mỗi dropdown Packing → Polygons; so byte-by-byte với bản Rectangles thì **đúng 1 byte đổi**, nằm tận cuối block: `28 01 02` (rect) → `28 01 03` (poly).

→ **packing là field `0x28`**, encode `28 01 <enum>` với enum **2 = rectangles, 3 = polygons**. Bốn datapoint nhất quán:

| File | bytes | packing |
|------|-------|---------|
| Chest | `28 01 02` | rectangles |
| 3001_Lucius (export rect) | `28 01 02` | rectangles |
| 3001_Lucius (export poly) | `28 01 03` | polygons |
| 0003_Althea | `28 01 03` | polygons |

Phát hiện phụ: **Althea vốn là Polygons** — đây chính là lý do §5 cũ than "page layout Althea không reproduce được dù chỉnh padding nào": vì lúc đó export bằng rectangles. Không phải packing nondeterminism như từng nghĩ, mà do sai packing.

Khác với hầu hết field, editor **luôn ghi** 0x28 (không omit ở default), nên decode đơn giản: quét vùng trailing tìm `28 01 <2|3>`. Validate end-to-end: decode bản Polygons → merge → CLI export → **atlas.txt + cả 4 PNG byte-identical** với editor-poly. (skel.bytes lệch vùng hash = nondeterminism CLI; 2 bản editor rect/poly có skel giống hệt nhau → skel độc lập packing, xác nhận diff không do settings.)
