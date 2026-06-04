# TÀI LIỆU THIẾT KẾ KỸ THUẬT: SPINEFORGE X

**Dự án:** Công cụ xuất hàng loạt và nâng cấp phiên bản Spine (Batch Export & Upgrade Tool)  
**Tên ứng dụng đề xuất:** **SpineForge X**  
**Nền tảng:** Windows trước, macOS sau khi xác minh CLI path và signing  
**Công nghệ:** Tauri (Rust Backend + HTML/CSS/TypeScript Frontend)

---

## I. MỤC TIÊU DỰ ÁN

* **Giải quyết bài toán chính:** Nâng cấp hàng trăm file `.spine` từ Spine 3.8.99 lên Spine 4.3+ và export lại dữ liệu runtime mà không làm sai cấu hình texture atlas riêng của từng project.
* **Giảm thao tác thủ công:** Artist/Animator không phải mở từng file, chọn version, chọn export setting và bấm export thủ công.
* **Tối ưu bộ cài:** Dùng Tauri để tạo app desktop nhẹ hơn giải pháp Python đóng gói. Mục tiêu kích thước cần đo bằng build release thực tế, không mặc định cam kết `< 10MB`.
* **Tăng độ an toàn batch:** Có log realtime, timeout từng file, xác minh output, tổng kết lỗi và khả năng dừng tiến trình đang chạy.

---

## II. NGUYÊN TẮC CLI CỦA SPINE

Theo sample script của hãng trong `export-sample`, flow export chính thức luôn truyền `--export`/`-e`.

* Windows nên ưu tiên `Spine.com` vì đây là command-line executable, chờ process kết thúc và trả stdout/stderr. `Spine.exe` là GUI executable, không nên là lựa chọn mặc định cho batch CLI.
* macOS dùng executable bên trong app bundle: `/Applications/Spine.app/Contents/MacOS/Spine`.
* Export settings hợp lệ có thể là:
  * File `.export.json`.
  * Built-in format như `binary`, `json`, `binary+pack`, `json+pack`.
* `.export.json` cạnh file `.spine` là cách chính thức để mỗi project có export setting riêng.

**Lưu ý quan trọng:** Giả thuyết "bỏ `-e` để Spine tự dùng export settings lưu nội bộ trong `.spine`" chưa được sample hãng hoặc repo tham khảo xác nhận. Nếu cần dùng, phải coi là chế độ experimental và test thực tế trước khi đưa vào flow chính.

---

## III. KIẾN TRÚC HỆ THỐNG

Ứng dụng chia làm 2 tầng:

1. **Frontend:** Nhận input path, output path, Spine executable, export mode, version, concurrency, timeout; hiển thị danh sách file, tiến trình, log và kết quả.
2. **Backend:** Quét file, build lệnh Spine CLI, chạy process nền, stream stdout/stderr, kiểm tra exit code, xác minh output và phát event về UI.

Backend cần chạy process bằng task nền để UI không bị treo. Tránh gọi blocking process trực tiếp trong async command nếu không bọc bằng worker thread hoặc runtime task phù hợp.

---

## IV. THIẾT KẾ GIAO DIỆN

Giao diện tham khảo từ repo `dreamstring/SpineForge` dùng một cửa sổ dạng Fluent, scroll dọc, chia workflow thành các card có thể thu gọn. SpineForge X nên giữ cấu trúc này vì phù hợp với tool vận hành: người dùng cấu hình từ trên xuống, chạy batch, rồi đọc log ở cuối.

Quy tắc UI chính:

* Một cửa sổ duy nhất, layout một cột, có `ScrollView`.
* Mỗi nhóm chức năng là một collapsible section với header rõ ràng và icon chevron.
* Ưu tiên control native/familiar: input path, Browse button, checkbox, radio/segmented mode, combobox, progress bar, log terminal.
* Các trạng thái hợp lệ/không hợp lệ hiển thị bằng icon check/warning/error cạnh field, không chỉ bằng text log.
* Log và danh sách file dùng vùng có chiều cao giới hạn, scroll độc lập để không làm vỡ layout.

### 1. Path Configuration

* **Spine Executable:** Ô path + nút Browse + nút Auto Detect.
  * Windows default: `C:\Program Files\Spine\Spine.com`.
  * macOS default: `/Applications/Spine.app/Contents/MacOS/Spine`.
* **Input Directory / File Selection:** Chọn thư mục gốc hoặc chọn nhiều file `.spine`; hỗ trợ kéo thả folder/file.
* **Selected Files Preview:** Khi có nhiều file, hiển thị danh sách compact có icon file, path ellipsis, tooltip full path và nút remove từng file.
* **Output Directory:** Chọn thư mục output. Nếu để trống, app có thể dùng output cạnh file gốc hoặc theo setting trong `.export.json` tùy mode. Có tùy chọn giữ cấu trúc thư mục tương đối từ input.

### 2. Export Settings

* **Target Spine Version:** Dropdown hoặc input text, ví dụ `4.3.xx`, `4.3.39`, `lateststable`.
* **Export Format:** `binary+pack` mặc định, hoặc `json+pack`, `binary`, `json`.
* **Atlas Settings Mode:**
  * **Use `.export.json` next to each `.spine`:** Chế độ chính thức. Tool tìm `.export.json` trong cùng thư mục với từng `.spine`. Nếu có nhiều file `.export.json`, chạy nhiều export cho cùng một project giống sample hãng.
  * **Use internal project settings (Experimental):** Không truyền `-e`. Chỉ bật sau khi test chứng minh Spine version hiện tại thực sự export đúng và giữ atlas size nội bộ.
  * **Force global settings:** Ép toàn bộ file dùng một `.export.json` chung hoặc built-in export format.
* **Fallback When Missing `.export.json`:**
  * Dùng built-in format mặc định `binary+pack`.
  * Dùng global `.export.json`.
  * Báo lỗi và bỏ qua file.
* **Animation Cleanup:** Mapping sang `--clean`. Nếu `.export.json` có `cleanUp = true`, Spine có thể vẫn cleanup dù toggle app tắt.
* **Parallel Jobs:** Số process Spine chạy đồng thời, mặc định 1 hoặc 2.
* **Max Memory:** Tham số JVM heap dạng `-Xmx512m`, `-Xmx1024m`.
* **Timeout Per File:** Mặc định 5 phút, cho phép cấu hình.
* **Path Cleanup / JSON Post-processing:** Không bật mặc định. Nếu cần sửa `images`/`audio` path trong JSON export, phải dùng JSON parser và backup file trước khi ghi.
* **File Prefix:** Chỉ nên là optional advanced setting. Không bật mặc định vì batch upgrade thường cần giữ tên file runtime ổn định.

### 3. Status & Logging

* Card **Run** có InfoBar trạng thái hiện tại, nút **Start**, **Stop**, **Open Output Folder**.
* Khi đang chạy, Start disabled hoặc đổi thành trạng thái `Running...`; Stop enabled.
* Progress dùng determinate progress bar theo số job: `Processing: 12 / 145 files`.
* Có progress ring nhỏ chỉ cho trạng thái đang chuẩn bị hoặc đang scan, không thay thế progress bar chính.
* Card **Conversion Log** dùng terminal-style textarea font monospace, auto-scroll, có nút Clear và Save Log.
* Summary cuối batch: số thành công, số lỗi, số skipped, tổng thời gian, link mở output.

### 4. Collapsible Sections Đề Xuất

1. **Spine Executable**
   * Path readonly/input.
   * Browse.
   * Auto Detect.
   * Version check bằng `--version`.
   * Warning nếu user chọn `Spine.exe` trên Windows thay vì `Spine.com`.
2. **Input Files**
   * Drop zone chọn folder hoặc nhiều file.
   * Scan recursive preview.
   * Count tổng `.spine`.
   * Danh sách file có remove từng item.
3. **Export Strategy**
   * Atlas Settings Mode.
   * Fallback policy khi thiếu `.export.json`.
   * Global `.export.json` picker.
   * Built-in export format picker.
4. **Advanced Runtime**
   * Target version.
   * Parallel jobs.
   * Max memory.
   * Timeout.
   * Clean animation toggle.
   * Unicode path warning/workaround.
5. **Run**
   * Validate settings.
   * Start/Stop.
   * Progress bar.
   * Current file.
6. **Log & Results**
   * Realtime log.
   * Error filter.
   * Failed files list.
   * Save log.
   * Open output.

### 5. UI Khác Biệt So Với Repo Tham Khảo

Repo tham khảo đặt cả export settings, output, advanced path reset, atlas max width/height và source/target version trong một card "Conversion Settings". SpineForge X nên tách nhỏ hơn vì bài toán chính là chọn đúng export strategy. Atlas size manual không nên đặt nổi bật ở default view, vì dễ khiến user vô tình ép toàn bộ project về cùng một size.

Những điểm nên giữ từ repo tham khảo:

* Collapsible card workflow.
* InfoBar cho cảnh báo/hướng dẫn ngắn.
* Icon check/error cạnh field.
* File list preview với remove item.
* Log monospace trong vùng scroll riêng.
* Nút mở output directory.

Những điểm cần chỉnh:

* Không dùng height cố định quá cao như `800 x 1100`; Tauri cần responsive tốt ở laptop nhỏ.
* Không dùng ProgressRing làm tiến trình chính cho batch.
* Không bật prefix/path rewrite mặc định.
* Không ưu tiên manual max width/max height trong flow chính nếu mục tiêu là giữ setting riêng từng project.

---

## V. LOGIC XỬ LÝ

### 1. Quét file đệ quy

* Dùng `walkdir` để quét toàn bộ input directory.
* Chỉ lấy file `.spine`.
* Bỏ qua file tạm như `.~*.spine`.
* Có thể thêm ignore pattern cho folder output, backup hoặc cache để tránh quét nhầm.

### 2. Chọn Spine executable

Thứ tự đề xuất:

1. Path user chọn.
2. Biến môi trường `SPINE_PATH`.
3. Registry Windows nếu có.
4. Common paths:
   * `C:\Program Files\Spine\Spine.com`
   * `C:\Program Files (x86)\Spine\Spine.com`
   * `/Applications/Spine.app/Contents/MacOS/Spine`

### 3. Build lệnh export

**Mode A: `.export.json` cạnh project**

```bash
Spine.com -Xmx512m --update 4.3.xx --input "D:\Project\char.spine" --export "D:\Project\char.export.json"
```

Nếu output trong `.export.json` không hợp lệ, có thể fallback bằng cách thêm `--output`:

```bash
Spine.com -Xmx512m --update 4.3.xx --input "D:\Project\char.spine" --output "D:\Output" --export "D:\Project\char.export.json"
```

**Mode B: Force global settings**

```bash
Spine.com -Xmx512m --update 4.3.xx --input "D:\Project\char.spine" --output "D:\Output" --export "D:\Config\global.export.json"
```

**Mode C: Built-in fallback**

```bash
Spine.com -Xmx512m --update 4.3.xx --input "D:\Project\char.spine" --output "D:\Output" --export binary+pack
```

**Mode D: Internal project settings (Experimental)**

```bash
Spine.com -Xmx512m --update 4.3.xx --input "D:\Project\char.spine" --output "D:\Output"
```

Mode D chỉ được xem là hợp lệ nếu test thực tế sinh đủ `.skel`/`.json`, `.atlas`, `.png` và giữ đúng atlas max size từng file.

### 4. Chạy process và stream log

* Dùng process async hoặc `spawn_blocking`.
* Redirect stdout/stderr và emit từng dòng về UI.
* Không dùng `unwrap()` khi emit event; nếu UI đóng, backend không được panic.
* Kiểm tra `exit_code == 0` trước khi đánh dấu thành công.
* Sau khi exit code 0, vẫn verify output file tồn tại.

### 5. Stop và timeout

* Mỗi job có timeout riêng.
* Nếu timeout, kill process và đánh dấu failed.
* Nút Stop phải kill các Spine process đang chạy và không start job mới.

### 6. Unicode path

Spine CLI có thể gặp vấn đề với path chứa ký tự non-ASCII tùy môi trường. Tool cần:

* Cảnh báo khi input/output path có Unicode.
* Ưu tiên test trực tiếp với `Spine.com`.
* Nếu cần workaround, copy project sang temp ASCII path, chạy export, rồi copy output về. Workaround này phải cẩn thận vì file `.spine` có thể phụ thuộc thư mục `images`, `audio` và relative paths.

---

## VI. CẤU TRÚC MÃ NGUỒN MẪU

### Backend command mẫu

```rust
use std::process::Stdio;
use tauri::{Emitter, Window};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
enum ExportMode {
    PerProjectJson,
    GlobalJson,
    BuiltIn,
    InternalExperimental,
}

#[tauri::command]
async fn export_spine_file(
    window: Window,
    spine_path: String,
    version: String,
    input_file: String,
    output_dir: String,
    export_mode: ExportMode,
    export_arg: Option<String>,
    clean: bool,
    max_memory: String,
) -> Result<(), String> {
    let mut cmd = Command::new(spine_path);
    cmd.arg(format!("-Xmx{}", max_memory))
        .arg("--update").arg(version)
        .arg("--input").arg(&input_file)
        .arg("--output").arg(&output_dir);

    if clean {
        cmd.arg("--clean");
    }

    match export_mode {
        ExportMode::PerProjectJson | ExportMode::GlobalJson | ExportMode::BuiltIn => {
            let value = export_arg.ok_or("Missing export argument")?;
            cmd.arg("--export").arg(value);
        }
        ExportMode::InternalExperimental => {}
    }

    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());

    let mut child = cmd.spawn().map_err(|e| e.to_string())?;

    let stdout_task = if let Some(stdout) = child.stdout.take() {
        let window = window.clone();
        Some(tokio::spawn(async move {
            let mut lines = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = window.emit("spine-log", line);
            }
        }))
    } else {
        None
    };

    let stderr_task = if let Some(stderr) = child.stderr.take() {
        let window = window.clone();
        Some(tokio::spawn(async move {
            let mut lines = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let _ = window.emit("spine-error", line);
            }
        }))
    } else {
        None
    };

    let status = child.wait().await.map_err(|e| e.to_string())?;

    if let Some(task) = stdout_task {
        let _ = task.await;
    }
    if let Some(task) = stderr_task {
        let _ = task.await;
    }

    if !status.success() {
        return Err(format!("Spine CLI failed with status: {}", status));
    }

    Ok(())
}
```

### Frontend invoke mẫu

```typescript
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

await listen<string>('spine-log', (event) => {
  console.log(event.payload);
});

await invoke('export_spine_file', {
  spinePath: 'C:\\Program Files\\Spine\\Spine.com',
  version: '4.3.xx',
  inputFile: 'D:\\Project\\char.spine',
  outputDir: 'D:\\Project\\Output',
  exportMode: 'BuiltIn',
  exportArg: 'binary+pack',
  clean: false,
  maxMemory: '512m'
});
```

---

## VII. QUY TRÌNH KIỂM THỬ

1. **Spike internal settings:** Chọn 3 file `.spine` đã biết atlas max size là 512, 1024, 2048. Chạy command không `--export`. Nếu không sinh output hoặc sai atlas size, tắt mode experimental khỏi default flow.
2. **Per-project `.export.json`:** Tạo mỗi folder một `.export.json` khác nhau, kiểm tra output giữ đúng max size.
3. **Missing `.export.json`:** Kiểm tra từng fallback: dùng `binary+pack`, dùng global JSON, hoặc skip.
4. **Multiple `.export.json`:** Một `.spine` cùng folder với nhiều `.export.json` phải chạy nhiều export hoặc yêu cầu user chọn policy.
5. **Exit code và output verification:** CLI exit 0 nhưng thiếu `.atlas`/`.png`/`.skel` phải cảnh báo.
6. **Timeout và Stop:** Process treo quá timeout phải bị kill; bấm Stop phải dừng queue và kill process đang chạy.
7. **Unicode path:** Test path tiếng Việt/tiếng Trung cho input, output, images.
8. **Performance:** Test 200+ file với parallel jobs 1, 2, 4; đo RAM, thời gian và số lỗi.

---

## VIII. TÍNH NĂNG THAM KHẢO TỪ REPO `dreamstring/SpineForge`

Nên tham khảo:

* Auto-detect Spine executable từ registry, common paths và env var.
* Validate settings trước khi chạy.
* Log batch có timestamp và summary.
* Timeout từng process.
* Redirect stdout/stderr realtime.
* Verify output file sau khi CLI chạy xong.
* Nút mở output directory.
* Cảnh báo hoặc workaround cho Unicode path.

Không nên copy nguyên:

* Ép toàn bộ file qua một default/global export JSON nếu mục tiêu là giữ Max Size riêng từng project.
* Hậu xử lý JSON bằng regex. Nếu cần sửa JSON export, dùng JSON parser.
* Fallback command không giống sample hãng nếu chưa test bằng Spine CLI thật.
