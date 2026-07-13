//! Export health check: diagnose why a Library unit's already-exported skeleton does (or doesn't)
//! render in the thumbnail/preview player. Unlike [`crate::library::list_export_assets`] (which
//! bails on the first missing piece), this collects every check and the raw atlas text + skeleton
//! header so a blank thumbnail / failed preview can be traced. Split out of `library.rs` to keep
//! that file under the line-size guard.

use std::path::PathBuf;

use serde_json::Value;

use crate::library::{atlas_page_names, json_skeleton_version, pick_export_pair};
use crate::model::{HealthPage, HealthReport};
use crate::paths::{parse_quoted_path, path_to_string};
use crate::skel_binary;

/// Diagnose a unit's export. Offline; never errors (a missing export is reported as a problem,
/// not an `Err`). Pairs skeleton+atlas the same way the player does (see [`pick_export_pair`]).
#[tauri::command]
pub(crate) fn health_check_entry(
    folder: String,
    spine_file: String,
    rel_path: String,
    editor_version: Option<String>,
) -> HealthReport {
    let unit_folder = parse_quoted_path(&folder);
    let mut report = HealthReport {
        rel_path,
        spine_file,
        folder: path_to_string(&unit_folder),
        editor_version,
        export_dirs: Vec::new(),
        export_files: Vec::new(),
        skeleton_path: None,
        skeleton_format: None,
        skeleton_bytes: 0,
        detected_version: None,
        skeleton_header: None,
        atlas_path: None,
        atlas_content: None,
        pages: Vec::new(),
        problems: Vec::new(),
        ok: false,
    };

    if !unit_folder.exists() {
        report.problems.push("Folder của unit không tồn tại.".to_string());
        return report;
    }

    // Collect export/ex dirs.
    let mut export_dirs: Vec<PathBuf> = Vec::new();
    if let Ok(children) = std::fs::read_dir(&unit_folder) {
        for child in children.filter_map(Result::ok) {
            if !child.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                continue;
            }
            let name = child.file_name().to_string_lossy().to_ascii_lowercase();
            if name == "export" || name == "ex" {
                export_dirs.push(child.path());
            }
        }
    }
    report.export_dirs = export_dirs.iter().map(|p| path_to_string(p)).collect();
    if export_dirs.is_empty() {
        report.problems.push("Chưa export — không có thư mục export/ hoặc ex/.".to_string());
        return report;
    }

    // List every file in the export dirs (name + size) for eyeballing; note which kinds exist.
    let mut has_skeleton = false;
    let mut has_atlas = false;
    for dir in &export_dirs {
        let Ok(files) = std::fs::read_dir(dir) else { continue };
        for file in files.filter_map(Result::ok) {
            let path = file.path();
            if !path.is_file() {
                continue;
            }
            let size = file.metadata().map(|m| m.len()).unwrap_or(0);
            let display = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            report.export_files.push(format!("{display} ({size} B)"));
            let lname = display.to_ascii_lowercase();
            if lname.ends_with(".export.json") {
                continue;
            }
            if lname.contains(".atlas") {
                has_atlas = true;
            } else if lname.ends_with(".json") || lname.contains(".skel") {
                has_skeleton = true;
            }
        }
    }

    // Pick the skeleton + atlas that belong together (paired by base name — see pick_export_pair).
    let requested_stem = parse_quoted_path(&report.spine_file)
        .file_stem()
        .map(|n| n.to_string_lossy().to_ascii_lowercase())
        .unwrap_or_default();
    let pair = export_dirs.iter().find_map(|d| pick_export_pair(d, &requested_stem));
    if let Some((skel_path, format, atlas_path)) = &pair {
        report.skeleton_path = Some(path_to_string(skel_path));
        report.skeleton_format = Some(format.clone());
        report.skeleton_bytes = std::fs::metadata(skel_path).map(|m| m.len()).unwrap_or(0);
        if format == "json" {
            if let Ok(content) = std::fs::read_to_string(skel_path) {
                report.detected_version = json_skeleton_version(&content);
                // The `skeleton{}` header object carries spine version + hash + size.
                if let Ok(root) = serde_json::from_str::<Value>(&content) {
                    if let Some(head) = root.get("skeleton") {
                        let mut s = head.to_string();
                        s.truncate(2000);
                        report.skeleton_header = Some(s);
                    }
                }
            }
        } else if let Ok(data) = std::fs::read(skel_path) {
            report.detected_version = Some(skel_binary::read_skel_version_family(&data));
            let hex: String = data.iter().take(16).map(|b| format!("{b:02x} ")).collect();
            report.skeleton_header = Some(format!("first 16 bytes: {}", hex.trim_end()));
        }

        // Atlas + its referenced pages.
        report.atlas_path = Some(path_to_string(atlas_path));
        let atlas_dir = atlas_path.parent().unwrap_or(&unit_folder).to_path_buf();
        match std::fs::read_to_string(atlas_path) {
            Ok(content) => {
                let names = atlas_page_names(&content);
                if names.is_empty() {
                    report.problems.push("Atlas không khai báo texture page nào.".to_string());
                }
                for name in names {
                    let page_path = atlas_dir.join(&name);
                    let (exists, bytes) = std::fs::metadata(&page_path)
                        .map(|m| (true, m.len()))
                        .unwrap_or((false, 0));
                    if !exists {
                        report.problems.push(format!("Thiếu texture page trên đĩa: {name}"));
                    } else if bytes == 0 {
                        report.problems.push(format!("Texture page rỗng (0 byte): {name}"));
                    }
                    report.pages.push(HealthPage {
                        name,
                        path: path_to_string(&page_path),
                        exists,
                        bytes,
                    });
                }
                report.atlas_content = Some(content);
            }
            Err(_) => report.problems.push("Không đọc được file atlas.".to_string()),
        }
    } else {
        if !has_skeleton {
            report.problems.push("Không tìm thấy skeleton (.json hoặc .skel) trong export/.".to_string());
        }
        if !has_atlas {
            report.problems.push("Không tìm thấy file atlas (.atlas) trong export/.".to_string());
        }
        if has_skeleton && has_atlas {
            report.problems.push("Có skeleton và atlas nhưng không ghép được cặp hợp lệ.".to_string());
        }
    }

    // Runtime-version warning: a generic/binary 4.x can load with the wrong minor runtime.
    if report.detected_version.as_deref() == Some("4.x") {
        report.problems.push(
            "Không xác định được minor 4.x — có thể nạp nhầm runtime (4.2 vs 4.3).".to_string(),
        );
    } else if report.skeleton_format.as_deref() == Some("skel")
        && report.detected_version.as_deref().is_some_and(|v| v.starts_with('4'))
    {
        report.problems.push(
            "Skeleton binary 4.x — nếu version header sai sẽ lệch runtime ('Bone name must not be null').".to_string(),
        );
    }

    report.ok = report.problems.is_empty();
    report
}
