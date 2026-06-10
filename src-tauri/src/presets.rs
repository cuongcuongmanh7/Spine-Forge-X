//! Export-preset management: listing, importing, editing and deleting the
//! `.export.json` presets (bundled built-ins + user presets in app data).

use crate::path_to_string;
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
};
use tauri::{AppHandle, Manager};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ExportPreset {
    pub(crate) name: String,
    pub(crate) path: String,
    pub(crate) built_in: bool,
}

#[tauri::command]
pub(crate) fn list_export_presets(app: AppHandle) -> Result<Vec<ExportPreset>, String> {
    let mut presets = Vec::new();

    for dir in built_in_preset_dirs(&app) {
        collect_presets_from_dir(&dir, true, &mut presets);
    }

    let user_dir = user_preset_dir(&app)?;
    fs::create_dir_all(&user_dir).map_err(|e| e.to_string())?;
    collect_presets_from_dir(&user_dir, false, &mut presets);

    presets.sort_by(|a, b| {
        b.built_in
            .cmp(&a.built_in)
            .then_with(|| a.name.to_ascii_lowercase().cmp(&b.name.to_ascii_lowercase()))
    });
    presets.dedup_by(|a, b| a.built_in == b.built_in && a.name.eq_ignore_ascii_case(&b.name));

    Ok(presets)
}

#[tauri::command]
pub(crate) fn import_user_export_preset(
    app: AppHandle,
    source_path: String,
) -> Result<ExportPreset, String> {
    let source = PathBuf::from(source_path.trim_matches('"'));
    if !source.is_file() {
        return Err("Preset source không tồn tại.".to_string());
    }

    let name = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| "Không đọc được tên preset.".to_string())?;
    let safe_name = validate_preset_file_name(name)?;
    let content = fs::read_to_string(&source).map_err(|e| e.to_string())?;
    validate_export_json_content(&content)?;

    let user_dir = user_preset_dir(&app)?;
    fs::create_dir_all(&user_dir).map_err(|e| e.to_string())?;
    let target = user_dir.join(&safe_name);
    fs::write(&target, content).map_err(|e| e.to_string())?;

    Ok(ExportPreset {
        name: safe_name,
        path: path_to_string(&target),
        built_in: false,
    })
}

#[tauri::command]
pub(crate) fn read_user_export_preset(app: AppHandle, name: String) -> Result<String, String> {
    let safe_name = validate_preset_file_name(&name)?;
    let path = user_preset_dir(&app)?.join(safe_name);
    fs::read_to_string(path).map_err(|e| e.to_string())
}

/// Read any .export.json preset by absolute path (built-in resource or user), for the editor.
#[tauri::command]
pub(crate) fn read_export_preset(path: String) -> Result<String, String> {
    let target = PathBuf::from(path.trim_matches('"'));
    if !target
        .file_name()
        .and_then(|name| name.to_str())
        .map(|name| name.ends_with(".export.json"))
        .unwrap_or(false)
    {
        return Err("Chỉ đọc được file .export.json.".to_string());
    }
    fs::read_to_string(&target).map_err(|e| e.to_string())
}

/// Save (create or overwrite) a user preset from edited content, into the user preset dir.
#[tauri::command]
pub(crate) fn save_user_export_preset(
    app: AppHandle,
    name: String,
    content: String,
) -> Result<ExportPreset, String> {
    let safe_name = validate_preset_file_name(&name)?;
    validate_export_json_content(&content)?;
    let user_dir = user_preset_dir(&app)?;
    fs::create_dir_all(&user_dir).map_err(|e| e.to_string())?;
    let target = user_dir.join(&safe_name);
    fs::write(&target, content).map_err(|e| e.to_string())?;
    Ok(ExportPreset {
        name: safe_name,
        path: path_to_string(&target),
        built_in: false,
    })
}

#[tauri::command]
pub(crate) fn delete_user_export_preset(app: AppHandle, name: String) -> Result<(), String> {
    let safe_name = validate_preset_file_name(&name)?;
    let path = user_preset_dir(&app)?.join(safe_name);
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn built_in_preset_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        dirs.push(resource_dir.join("export-presets"));
    }

    dirs.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("export-presets"));
    dirs
}

fn user_preset_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("export-presets"))
        .map_err(|e| e.to_string())
}

fn collect_presets_from_dir(dir: &Path, built_in: bool, presets: &mut Vec<ExportPreset>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };

    for entry in entries.filter_map(Result::ok) {
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };

        if path.is_file() && name.ends_with(".export.json") {
            presets.push(ExportPreset {
                name: name.to_string(),
                path: path_to_string(&path),
                built_in,
            });
        }
    }
}

pub(crate) fn validate_preset_file_name(name: &str) -> Result<String, String> {
    let trimmed = name.trim();
    if !trimmed.ends_with(".export.json") {
        return Err("Preset phải có đuôi .export.json.".to_string());
    }

    if trimmed.is_empty()
        || trimmed.contains('/')
        || trimmed.contains('\\')
        || trimmed.contains(':')
        || trimmed == ".export.json"
    {
        return Err("Tên preset không hợp lệ.".to_string());
    }

    Ok(trimmed.to_string())
}

pub(crate) fn validate_export_json_content(content: &str) -> Result<(), String> {
    let value: serde_json::Value = serde_json::from_str(content)
        .map_err(|e| format!("Preset không phải JSON hợp lệ: {e}"))?;
    let class = value
        .get("class")
        .and_then(|value| value.as_str())
        .unwrap_or_default();

    if !class.starts_with("export-") {
        return Err("Preset không giống Spine export settings JSON: thiếu class export-*.".to_string());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;

    proptest! {
        /// Property 10: validate_preset_file_name accepts a clean *.export.json
        /// name and rejects anything with a path separator, colon, or the bare
        /// ".export.json".
        // The leading char is constrained to a non-space so the trimmed stem is
        // never empty — a whitespace-only stem would collapse to the bare
        // ".export.json", which the validator legitimately rejects.
        #[test]
        fn prop_validate_preset_file_name(stem in "[a-zA-Z0-9_-][a-zA-Z0-9 _-]{0,29}") {
            let valid = format!("{stem}.export.json");
            prop_assert_eq!(validate_preset_file_name(&valid).unwrap(), valid.trim().to_string());

            // Path separators / colon must be rejected.
            for bad in [
                format!("a/{stem}.export.json"),
                format!("a\\{stem}.export.json"),
                format!("C:{stem}.export.json"),
            ] {
                prop_assert!(validate_preset_file_name(&bad).is_err());
            }

            // Wrong / missing extension is rejected.
            prop_assert!(validate_preset_file_name(&stem).is_err());
            prop_assert!(validate_preset_file_name(".export.json").is_err());
        }
    }
}
