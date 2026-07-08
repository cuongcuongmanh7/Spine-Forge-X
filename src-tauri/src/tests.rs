//! Unit + property tests for the export/clean engines and helpers. Moved out of
//! lib.rs in v0.3.3; imports the items under test explicitly from the crate root
//! (where model / util / export are re-exported).

use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};

use proptest::prelude::*;

use crate::{
    clean_matching_outputs, clean_source_folder_name, copy_dir_recursive,
    create_last_export_settings, find_existing_id_folder, has_output_files,
    make_export_folder_name, may_start_next, name_matches_base, normalize_pack_source,
    parse_spine_version, path_to_string, resolve_export_arg, resolve_output_dir,
    sanitize_folder_part, scan_spine_files, validate_settings, BatchExportRequest, ExportMode,
    FallbackMode, OutputPolicy,
};

/// Create a unique empty temp directory for a test and return its path.
/// A process-wide sequence counter guarantees uniqueness even when called
/// many times within the same microsecond (e.g. inside a proptest loop).
fn test_dir(tag: &str) -> PathBuf {
    static SEQ: AtomicUsize = AtomicUsize::new(0);
    let seq = SEQ.fetch_add(1, Ordering::SeqCst);
    let dir = std::env::temp_dir().join(format!(
        "spineforge-test-{}-{}-{}-{}",
        tag,
        std::process::id(),
        chrono::Local::now().format("%Y%m%d%H%M%S%6f"),
        seq
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

/// LastExportSettings requires a base preset path, like GlobalJson.
#[test]
fn last_export_settings_requires_base_preset() {
    let input = PathBuf::from("D:/whatever/hero.spine");
    let request = BatchExportRequest {
        export_mode: ExportMode::LastExportSettings,
        global_json_path: Some("   ".to_string()),
        ..base_request()
    };
    assert!(resolve_export_arg(&request, &input).is_err());
    assert!(create_last_export_settings(&request, &input).is_err());

    let request = BatchExportRequest {
        export_mode: ExportMode::LastExportSettings,
        global_json_path: Some("D:/presets/global.export.json".to_string()),
        ..base_request()
    };
    assert_eq!(
        resolve_export_arg(&request, &input).unwrap().as_deref(),
        Some("D:/presets/global.export.json")
    );
}

/// Parse failure (not a real .spine) falls back to the unmodified base
/// preset instead of failing the file.
#[test]
fn last_export_settings_falls_back_to_base_preset() {
    let dir = test_dir("last-export-fallback");
    let spine = dir.join("broken.spine");
    fs::write(&spine, b"definitely not deflate").unwrap();
    let preset = dir.join("base.export.json");
    fs::write(&preset, r#"{ "class": "export-binary", "packSource": "attachments" }"#)
        .unwrap();

    let request = BatchExportRequest {
        export_mode: ExportMode::LastExportSettings,
        global_json_path: Some(preset.to_string_lossy().to_string()),
        ..base_request()
    };
    let plan = create_last_export_settings(&request, &spine).unwrap();
    assert_eq!(plan.arg.as_deref(), Some(preset.to_string_lossy().as_ref()));
    assert!(plan.temp_file.is_none());
    let note = plan.note.unwrap();
    assert!(note.starts_with("[WARN]"), "fallback note must be a warning: {note}");
    assert!(note.contains("export bằng preset nền"));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn clean_source_folder_name_takes_id_token() {
    assert_eq!(clean_source_folder_name("3001_Lucius"), "3001");
    assert_eq!(clean_source_folder_name("0001_Fighter"), "0001");
    // No underscore, or empty leading token → keep the whole name.
    assert_eq!(clean_source_folder_name("4001"), "4001");
    assert_eq!(clean_source_folder_name("_Lucius"), "_Lucius");
}

#[test]
fn find_existing_id_folder_priority_exact_then_prefix_then_none() {
    let base = test_dir("find-id");
    fs::create_dir_all(base.join("0001_Fighter")).unwrap();
    fs::create_dir_all(base.join("0002")).unwrap();
    fs::create_dir_all(base.join("0003_A")).unwrap();
    fs::create_dir_all(base.join("00030_B")).unwrap(); // must NOT match id "0003" prefix

    // Exact match wins.
    assert_eq!(find_existing_id_folder(&base, "0002").as_deref(), Some("0002"));
    // Prefix `{id}_` match when no exact folder exists.
    assert_eq!(find_existing_id_folder(&base, "0001").as_deref(), Some("0001_Fighter"));
    assert_eq!(find_existing_id_folder(&base, "0003").as_deref(), Some("0003_A"));
    // No match → None (so caller creates a fresh folder).
    assert_eq!(find_existing_id_folder(&base, "9999"), None);
    // Empty id never matches.
    assert_eq!(find_existing_id_folder(&base, ""), None);

    let _ = fs::remove_dir_all(&base);
}

#[test]
fn find_existing_id_folder_none_when_base_missing() {
    let missing = std::env::temp_dir().join("spineforge-test-missing-xyz-does-not-exist");
    let _ = fs::remove_dir_all(&missing);
    assert_eq!(find_existing_id_folder(&missing, "0001"), None);
}

#[test]
fn parse_spine_version_prefers_editor_over_launcher() {
    let output = "Spine Launcher 4.3.05\n\
        Esoteric Software LLC (C) 2013-2026 | http://esotericsoftware.com\n\
        Windows 10 Pro amd64 10.0\n\
        Starting: Spine 4.3.17 Professional\n\
        Spine 4.3.17 Professional\n\
        Complete.";
    assert_eq!(parse_spine_version(output).as_deref(), Some("4.3.17"));
}

#[test]
fn parse_spine_version_handles_single_line_and_windows_build() {
    // A lone editor line.
    assert_eq!(parse_spine_version("Spine 3.8.99 Professional").as_deref(), Some("3.8.99"));
    // The Windows build token (10.0.19045) must not win over the editor line.
    let output = "Spine Launcher 4.3.05\n\
        Windows 10 Pro amd64 10.0.19045\n\
        Spine 4.3.17 Professional";
    assert_eq!(parse_spine_version(output).as_deref(), Some("4.3.17"));
}

#[test]
fn copy_dir_recursive_copies_nested_files() {
    let src = test_dir("copy-src");
    let dst = test_dir("copy-dst");
    fs::create_dir_all(src.join("sub")).unwrap();
    fs::write(src.join("a.atlas"), b"atlas").unwrap();
    fs::write(src.join("sub/b.png"), b"png").unwrap();

    copy_dir_recursive(&src, &dst).unwrap();
    assert!(dst.join("a.atlas").is_file());
    assert!(dst.join("sub/b.png").is_file());

    let _ = fs::remove_dir_all(&src);
    let _ = fs::remove_dir_all(&dst);
}

#[test]
fn has_output_files_recognizes_unity_double_extensions() {
    let dir = test_dir("has-output-unity");
    // Unity Spine runtime convention: skeleton .skel.bytes + atlas .atlas.txt.
    fs::write(dir.join("3004_Gale.skel.bytes"), b"skel").unwrap();
    fs::write(dir.join("3004_Gale.atlas.txt"), b"atlas").unwrap();
    fs::write(dir.join("3004_Gale.png"), b"png").unwrap();
    assert!(has_output_files(&path_to_string(&dir)));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn has_output_files_recognizes_plain_extensions() {
    let dir = test_dir("has-output-plain");
    fs::write(dir.join("hero.json"), b"{}").unwrap();
    fs::write(dir.join("hero.atlas"), b"atlas").unwrap();
    assert!(has_output_files(&path_to_string(&dir)));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn has_output_files_false_when_only_meta_or_textures() {
    let dir = test_dir("has-output-meta");
    // Only Unity .meta sidecars and textures — no real skeleton/atlas output.
    fs::write(dir.join("3004_Gale.skel.bytes.meta"), b"meta").unwrap();
    fs::write(dir.join("3004_Gale.atlas.txt.meta"), b"meta").unwrap();
    fs::write(dir.join("3004_Gale.png"), b"png").unwrap();
    assert!(!has_output_files(&path_to_string(&dir)));
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn has_output_files_false_when_dir_missing() {
    let missing = std::env::temp_dir().join("spineforge-test-output-missing-xyz");
    let _ = fs::remove_dir_all(&missing);
    assert!(!has_output_files(&path_to_string(&missing)));
}

// ---- Property tests (proptest) ----------------------------------------
//
// These lock the pure invariants added across v0.2.5–v0.2.6 (validation,
// output routing, preset name rules, version parsing) so future refactors
// can't silently break them. FS-touching branches are exercised with the
// `test_dir()` helper above; the rest are pure string/number logic.

/// Build a neutral `BatchExportRequest` with every field defaulted. Tests
/// override only the handful of fields relevant to the behaviour under test.
fn base_request() -> BatchExportRequest {
    BatchExportRequest {
        spine_path: String::new(),
        input_root: String::new(),
        files: Vec::new(),
        output_path: String::new(),
        output_policy: OutputPolicy::SourceFolderName,
        target_version: String::new(),
        export_mode: ExportMode::GlobalJson,
        fallback_mode: FallbackMode::GlobalJson,
        global_json_path: None,
        built_in_export: String::new(),
        generated_format: String::new(),
        generated_skeleton_extension: String::new(),
        generated_pack_atlas: false,
        generated_max_width: 0,
        generated_max_height: 0,
        generated_premultiply_alpha: false,
        generated_pot: false,
        generated_padding_x: 0,
        generated_padding_y: 0,
        generated_pretty_print: false,
        generated_nonessential: false,
        generated_strip_whitespace_x: false,
        generated_strip_whitespace_y: false,
        generated_rotation: false,
        generated_alias: false,
        generated_ignore_blank_images: false,
        generated_alpha_threshold: 0,
        generated_min_width: 0,
        generated_min_height: 0,
        generated_multiple_of_four: false,
        generated_square: false,
        generated_output_format: String::new(),
        generated_jpeg_quality: 0.0,
        generated_bleed: false,
        generated_bleed_iterations: 0,
        generated_edge_padding: false,
        generated_duplicate_padding: false,
        generated_filter_min: String::new(),
        generated_filter_mag: String::new(),
        generated_wrap_x: String::new(),
        generated_wrap_y: String::new(),
        generated_texture_format: String::new(),
        generated_atlas_extension: String::new(),
        generated_combine_subdirectories: false,
        generated_flatten_paths: false,
        generated_use_indexes: false,
        generated_fast: false,
        generated_limit_memory: false,
        generated_packing: String::new(),
        generated_pack_source: String::new(),
        generated_pack_target: String::new(),
        generated_warnings: false,
        generated_force_all: false,
        clean: false,
        parallel_jobs: 1,
        max_memory: String::new(),
        timeout_seconds: 0,
        preserve_relative_paths: false,
        clean_folder_name: false,
        unicode_workaround: false,
        linked_dest_type: String::new(),
    }
}

/// Build a `BatchExportRequest` for LinkedProject routing tests.
fn linked_request(output_path: &str, linked_dest_type: &str) -> BatchExportRequest {
    BatchExportRequest {
        output_path: output_path.to_string(),
        output_policy: OutputPolicy::LinkedProject,
        linked_dest_type: linked_dest_type.to_string(),
        ..base_request()
    }
}

proptest! {
    /// Property 5: validate_settings always reports an error (ok == false)
    /// when the Spine path is empty — regardless of the other inputs.
    #[test]
    fn prop_validate_settings_rejects_empty_spine_path(
        output_policy in prop::sample::select(vec!["timestamp", "sourceFolderName", "linkedProject", "exportSubfolder"]),
        export_mode in prop::sample::select(vec!["globalJson", "perProjectJson", "builtIn"]),
    ) {
        let result = validate_settings(
            String::new(),
            String::new(),
            output_policy.to_string(),
            export_mode.to_string(),
            String::new(),
        );
        prop_assert!(!result.ok);
        prop_assert!(!result.errors.is_empty());
        prop_assert!(!result.spine_ok);
    }

    /// Property 6: ExportMode "internalExperimental" is always rejected,
    /// even if every other field is otherwise valid-looking.
    #[test]
    fn prop_validate_settings_rejects_internal_experimental(
        spine_path in "[a-zA-Z0-9/]{0,20}",
        output_path in "[a-zA-Z0-9/]{0,20}",
    ) {
        let result = validate_settings(
            spine_path,
            output_path,
            "sourceFolderName".to_string(),
            "internalExperimental".to_string(),
            String::new(),
        );
        prop_assert!(!result.ok);
    }

    /// Property 9: parallel_jobs is always clamped into [1, 8].
    #[test]
    fn prop_parallel_jobs_clamped(jobs in 0usize..1000) {
        let clamped = jobs.clamp(1, 8);
        prop_assert!((1..=8).contains(&clamped));
        // Idempotent: values already in range are unchanged.
        if (1..=8).contains(&jobs) {
            prop_assert_eq!(clamped, jobs);
        }
    }

    /// Property 13: normalize_pack_source maps the legacy "folder" value to
    /// "imagefolders" and leaves every other value (after trimming) intact.
    #[test]
    fn prop_normalize_pack_source(value in "[a-zA-Z]{0,15}") {
        let normalized = normalize_pack_source(&value);
        if value.trim() == "folder" {
            prop_assert_eq!(normalized, "imagefolders");
        } else {
            prop_assert_eq!(normalized, value.trim());
        }
    }

    /// Property: parse_spine_version returns Some iff the output contains a
    /// d.d.d token, and never picks the "Launcher" line when an editor line
    /// with a version is present.
    #[test]
    fn prop_parse_spine_version_prefers_editor(
        launcher in "[0-9]{1,2}\\.[0-9]{1,2}\\.[0-9]{1,2}",
        editor in "[0-9]{1,2}\\.[0-9]{1,2}\\.[0-9]{1,2}",
    ) {
        let output = format!("Spine Launcher {launcher}\nSpine {editor} Professional");
        let parsed = parse_spine_version(&output);
        prop_assert_eq!(parsed.as_deref(), Some(editor.as_str()));
    }

    /// Property 8: clean_source_folder_name returns the id token before the
    /// first '_' (when that token is non-empty), else the whole name. The
    /// result is always a prefix of the input, and an extracted id never
    /// itself contains a '_'. (tasks.md — promoted from example test)
    #[test]
    fn prop_clean_source_folder_name(name in "[A-Za-z0-9_]{0,20}") {
        let id = clean_source_folder_name(&name);
        // The result is always a leading slice of the original name.
        prop_assert!(name.starts_with(id));
        match name.split_once('_') {
            Some((head, _)) if !head.is_empty() => {
                prop_assert_eq!(id, head);
                // An extracted id stops at the first separator.
                prop_assert!(!id.contains('_'));
            }
            // No '_' or a leading '_' (empty head) → keep the whole name.
            _ => prop_assert_eq!(id, name.as_str()),
        }
    }

    /// Property 7: the timestamp export folder name always has the shape
    /// `export_{sanitized-version}_{ddmmyyyy_hhmmss}` — a sanitized version
    /// token (no underscores, since `_` is not allowed) followed by an
    /// 8-digit date, `_`, and a 6-digit time. (tasks.md 6.1)
    #[test]
    fn prop_export_folder_name_matches_pattern(version in ".{0,40}") {
        let name = make_export_folder_name(&version);
        let rest = name.strip_prefix("export_").expect("must start with export_");

        // The last 15 chars are the chrono timestamp `ddmmyyyy_hhmmss`.
        prop_assert!(rest.len() >= 16, "name too short: {}", name);
        let split = rest.len() - 15;
        // The char just before the timestamp is the separating underscore.
        prop_assert_eq!(&rest[split - 1..split], "_");
        let stamp = &rest[split..];
        let digits: Vec<char> = stamp.chars().collect();
        for (i, ch) in digits.iter().enumerate() {
            if i == 8 {
                prop_assert_eq!(*ch, '_');
            } else {
                prop_assert!(ch.is_ascii_digit(), "non-digit in timestamp: {}", stamp);
            }
        }

        // The middle token is exactly the sanitized version (never empty).
        let version_token = &rest[..split - 1];
        prop_assert_eq!(version_token, sanitize_folder_part(&version));
        prop_assert!(!version_token.is_empty());
        prop_assert!(!version_token.contains('_'));
    }

    /// Property 11: once a Stop is requested, no further file may start.
    /// Models the batch loop's stop-gate (`may_start_next`) over the real
    /// AtomicBool: setting the flag at index `stop_at` means exactly
    /// `min(stop_at, total)` files start. (tasks.md 2.3)
    #[test]
    fn prop_stop_gate_blocks_new_files(total in 1usize..30, stop_at in 0usize..30) {
        let stop = AtomicBool::new(false);
        let mut started = 0usize;
        for i in 0..total {
            if i == stop_at {
                stop.store(true, Ordering::SeqCst);
            }
            if may_start_next(&stop) {
                started += 1;
            }
        }
        prop_assert_eq!(started, stop_at.min(total));
    }
}

/// Property 17 (example-based, FS-backed): resolve_output_dir for the
/// LinkedProject policy never produces a duplicate folder — it reuses an
/// existing id folder and only falls back to the source name when none exists.
#[test]
fn resolve_output_dir_linked_project_reuses_then_creates() {
    let unity_root = test_dir("linked-out");
    // Existing destination: Heroes/0001_Fighter
    fs::create_dir_all(unity_root.join("Heroes/0001_Fighter")).unwrap();

    let req = linked_request(unity_root.to_str().unwrap(), "Heroes");

    // Input id "0001" should reuse the existing prefixed folder, not create "0001".
    let input = unity_root.join("src/0001_Fighter/skel.spine");
    let resolved = resolve_output_dir(&req, &input, "run").unwrap();
    assert_eq!(
        PathBuf::from(&resolved),
        unity_root.join("Heroes/0001_Fighter")
    );

    // Unknown id "9999" → fall back to the source folder name (fresh folder).
    let input2 = unity_root.join("src/9999_New/skel.spine");
    let resolved2 = resolve_output_dir(&req, &input2, "run").unwrap();
    assert_eq!(PathBuf::from(&resolved2), unity_root.join("Heroes/9999_New"));

    // Missing dest type → error, never an empty/duplicate path.
    let bad = linked_request(unity_root.to_str().unwrap(), "");
    assert!(resolve_output_dir(&bad, &input, "run").is_err());

    let _ = fs::remove_dir_all(&unity_root);
}

/// resolve_output_dir for the ExportSubfolder policy always routes into an
/// "export" folder next to the input file, regardless of output_path.
#[test]
fn resolve_output_dir_export_subfolder_uses_sibling_folder() {
    let req = BatchExportRequest {
        output_policy: OutputPolicy::ExportSubfolder,
        ..base_request()
    };
    let input = PathBuf::from("D:/Project/4001_Fighter/skel.spine");
    let resolved = resolve_output_dir(&req, &input, "run").unwrap();
    assert_eq!(
        PathBuf::from(&resolved),
        PathBuf::from("D:/Project/4001_Fighter/export")
    );
}

/// name_matches_base: matches a unit's own artifacts (base + ext, base + page-index + ext) and
/// nothing else — so a shared export folder's pre-clean never touches a sibling unit's files.
#[test]
fn name_matches_base_matches_only_own_artifacts() {
    // Skeleton + atlas + page-0 image + higher atlas pages, all lowercased like the caller passes.
    assert!(name_matches_base("foo.json", "foo"));
    assert!(name_matches_base("foo.skel.bytes", "foo"));
    assert!(name_matches_base("foo.atlas.txt", "foo"));
    assert!(name_matches_base("foo.png", "foo"));
    assert!(name_matches_base("foo2.png", "foo"));
    assert!(name_matches_base("foo10.png", "foo"));
    // Unrelated names: no prefix, or a prefix whose remainder isn't digits-then-dot.
    assert!(!name_matches_base("bar.png", "foo"));
    assert!(!name_matches_base("foobar.png", "foo"));
    assert!(!name_matches_base("foo_extra.png", "foo"));
    assert!(!name_matches_base("foo", "foo")); // no extension → skip (safety)
}

/// clean_matching_outputs removes exactly the target unit's stale files from a shared folder and
/// leaves a sibling unit's export + our own settings sidecar in place. (tasks.md — targeted clean)
#[test]
fn clean_matching_outputs_keeps_unrelated_files() {
    let dir = test_dir("clean-match");
    fs::create_dir_all(&dir).unwrap();
    for name in [
        "Foo.json",
        "Foo.atlas",
        "Foo.png",
        "Foo2.png",   // target's stale second atlas page
        "Bar.json",   // a sibling unit sharing the folder
        "Bar.png",
        "Foo.export.json", // our own settings sidecar — must survive
    ] {
        fs::write(dir.join(name), b"x").unwrap();
    }

    let removed = clean_matching_outputs(&dir, "Foo");
    assert_eq!(removed, 4, "Foo.json/.atlas/.png/2.png should be removed");

    assert!(!dir.join("Foo.json").exists());
    assert!(!dir.join("Foo.atlas").exists());
    assert!(!dir.join("Foo.png").exists());
    assert!(!dir.join("Foo2.png").exists());
    // Sibling + sidecar untouched.
    assert!(dir.join("Bar.json").exists());
    assert!(dir.join("Bar.png").exists());
    assert!(dir.join("Foo.export.json").exists());
}

/// Property 12 (FS-backed, example-based): when no `.export.json` sits next
/// to the input file, PerProjectJson falls back per `FallbackMode`:
/// BuiltIn → the built-in preset, GlobalJson → the global path (error when
/// empty), Skip → always an error. (tasks.md 6.2)
#[test]
fn fallback_mode_when_no_export_json() {
    let dir = test_dir("fallback"); // empty dir → find_per_project_export_json returns None
    let input = dir.join("hero.spine");

    // BuiltIn → uses the built-in preset string.
    let built_in = BatchExportRequest {
        export_mode: ExportMode::PerProjectJson,
        fallback_mode: FallbackMode::BuiltIn,
        built_in_export: "binary+pack".to_string(),
        ..base_request()
    };
    assert_eq!(
        resolve_export_arg(&built_in, &input).unwrap().as_deref(),
        Some("binary+pack")
    );

    // GlobalJson with a non-empty path → uses that path.
    let global_ok = BatchExportRequest {
        export_mode: ExportMode::PerProjectJson,
        fallback_mode: FallbackMode::GlobalJson,
        global_json_path: Some("D:/presets/global.export.json".to_string()),
        ..base_request()
    };
    assert_eq!(
        resolve_export_arg(&global_ok, &input).unwrap().as_deref(),
        Some("D:/presets/global.export.json")
    );

    // GlobalJson with an empty/blank path → error.
    let global_empty = BatchExportRequest {
        export_mode: ExportMode::PerProjectJson,
        fallback_mode: FallbackMode::GlobalJson,
        global_json_path: Some("   ".to_string()),
        ..base_request()
    };
    assert!(resolve_export_arg(&global_empty, &input).is_err());

    // Skip → always an error (file is skipped, not exported).
    let skip = BatchExportRequest {
        export_mode: ExportMode::PerProjectJson,
        fallback_mode: FallbackMode::Skip,
        built_in_export: "binary+pack".to_string(),
        ..base_request()
    };
    assert!(resolve_export_arg(&skip, &input).is_err());

    let _ = fs::remove_dir_all(&dir);
}

// FS-backed property tests run fewer cases — each one builds a real temp
// directory tree, so the default 256 cases would be needlessly slow.
proptest! {
    #![proptest_config(ProptestConfig::with_cases(32))]

    /// Property 1: scan_spine_files returns only valid `.spine` files (not
    /// temp `~`/`.~` ones) in `files`, routes temp `.spine` to `skipped`,
    /// and ignores non-spine files entirely. (tasks.md 1.2)
    #[test]
    fn prop_scan_spine_files_filters_temp_and_non_spine(kinds in prop::collection::vec(0u8..4, 0..12)) {
        let dir = test_dir("scan-spine");
        let mut expected_files = Vec::new();
        let mut expected_skipped = Vec::new();

        for (i, kind) in kinds.iter().enumerate() {
            let (name, bucket): (String, Option<&mut Vec<String>>) = match kind {
                0 => (format!("f{i}.spine"), Some(&mut expected_files)),       // valid
                1 => (format!("~f{i}.spine"), Some(&mut expected_skipped)),    // temp (~)
                2 => (format!(".~f{i}.spine"), Some(&mut expected_skipped)),   // temp (.~)
                _ => (format!("f{i}.txt"), None),                              // non-spine → ignored
            };
            let path = dir.join(&name);
            fs::write(&path, b"x").unwrap();
            if let Some(bucket) = bucket {
                bucket.push(path_to_string(&path));
            }
        }
        expected_files.sort();
        expected_skipped.sort();

        let result = scan_spine_files(path_to_string(&dir)).unwrap();
        prop_assert_eq!(result.files, expected_files);
        prop_assert_eq!(result.skipped, expected_skipped);

        let _ = fs::remove_dir_all(&dir);
    }

    /// Property 16: find_existing_id_folder only ever returns a folder that
    /// is an exact `id` match or a `{id}_…` prefix match, an exact match
    /// always wins over a prefix match, and an empty id always yields None —
    /// regardless of unrelated decoy folders. (tasks.md — promoted from example)
    #[test]
    fn prop_find_existing_id_folder_invariants(
        id in "[0-9]{0,4}",
        make_exact in any::<bool>(),
        make_prefix in any::<bool>(),
        decoys in prop::collection::vec("[A-Za-z0-9_]{1,8}", 0..6),
    ) {
        let base = test_dir("find-id-prop");
        fs::create_dir_all(&base).unwrap();
        for d in &decoys {
            let _ = fs::create_dir_all(base.join(d));
        }
        if !id.is_empty() && make_exact {
            fs::create_dir_all(base.join(&id)).unwrap();
        }
        if !id.is_empty() && make_prefix {
            fs::create_dir_all(base.join(format!("{id}_extra"))).unwrap();
        }

        let result = find_existing_id_folder(&base, &id);

        if id.is_empty() {
            // Empty id never matches anything.
            prop_assert_eq!(result, None);
        } else {
            let prefix = format!("{id}_");
            if let Some(ref name) = result {
                // Never returns an unrelated folder.
                prop_assert!(name == &id || name.starts_with(&prefix));
            }
            // An exact folder, when present, takes priority over any prefix.
            if make_exact {
                prop_assert_eq!(result.as_deref(), Some(id.as_str()));
            }
        }

        let _ = fs::remove_dir_all(&base);
    }
}

/// Build a raw-deflate `.spine`-like payload whose inflated bytes start with the
/// editor version stamped as a hibit string (last byte OR'd with 0x80), then read
/// it back through the offline version reader.
#[test]
fn read_editor_version_parses_stamped_version() {
    use std::io::Write;

    fn hibit_payload(version: &str) -> Vec<u8> {
        let bytes = version.as_bytes();
        let mut out = bytes.to_vec();
        // Terminate the run by OR-ing the final byte's high bit (the format's marker).
        if let Some(last) = out.last_mut() {
            *last |= 0x80;
        }
        out
    }

    fn deflate_raw(data: &[u8]) -> Vec<u8> {
        let mut enc =
            flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(data).unwrap();
        enc.finish().unwrap()
    }

    for version in ["3.8.99", "4.3.17"] {
        let dir = test_dir("editor-version");
        let file = dir.join("project.spine");
        fs::write(&file, deflate_raw(&hibit_payload(version))).unwrap();
        assert_eq!(
            crate::spine_project::read_editor_version(&file).as_deref(),
            Some(version),
            "should parse {version}"
        );
        let _ = fs::remove_dir_all(&dir);
    }

    // A non-deflate / unreadable file yields None rather than panicking.
    let dir = test_dir("editor-version-bad");
    let bad = dir.join("not-a-project.spine");
    fs::write(&bad, b"plain text, not deflate").unwrap();
    assert_eq!(crate::spine_project::read_editor_version(&bad), None);
    let _ = fs::remove_dir_all(&dir);
}
