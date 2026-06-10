//! Best-effort decoder for the export settings embedded in `.spine` project files
//! (Spine editor 3.8.x). Reverse-engineered 2026-06 and validated against real
//! projects: parsed min/max + base preset reproduced an artist's manual export
//! byte-for-byte (see docs in the v0.2.14 plan / memory `spine-project-file-format`).
//!
//! Format facts (validated):
//! - A `.spine` project is a single raw-deflate stream (no zlib header).
//! - The inflated payload is a custom binary serialization. Strings are ASCII
//!   with the final byte OR'd with 0x80 (`"binar"` + 0xF9 == "binary").
//! - Integers are protobuf-style little-endian base-128 varints.
//! - The last-export settings live near the end of the payload. Pack-atlas
//!   min/max sizes are the field-id/varint pairs `07 08 09 0A`
//!   (minWidth, minHeight, maxWidth, maxHeight).
//!
//! Caveat (validated): the stored settings reflect the last project *save*, not
//! necessarily the last export — the editor dialog can be changed after saving.
//! Fields are therefore decoded in confidence tiers; anything ambiguous is left
//! out so the caller falls back to the base preset per-field.

use serde::Serialize;
use serde_json::{Map, Value};
use std::io::Read;
use std::path::Path;

/// Hard cap for the inflated payload; the largest real project seen so far
/// inflates to ~30 MB, so 512 MB is generous while still bounding memory.
const MAX_INFLATED_BYTES: u64 = 512 * 1024 * 1024;

/// How far around the pack-size anchor we look for related fields. The whole
/// settings block has been ~200 bytes in every sample; 512 leaves slack.
const NEAR_WINDOW: usize = 512;

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PackSizes {
    pub min_width: u32,
    pub min_height: u32,
    pub max_width: u32,
    pub max_height: u32,
}

/// Decoded fields, already keyed by their `.export.json` names so merging into
/// a preset is a plain per-key override.
#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodedSettings {
    /// Top-level export settings keys (`class`, `extension`, `cleanUp`, ...).
    pub outer: Map<String, Value>,
    /// Keys inside `packAtlas` (`minWidth`, `alphaThreshold`, ...).
    pub pack: Map<String, Value>,
    pub pack_sizes: PackSizes,
}

impl DecodedSettings {
    /// One-line summary for the per-file export log.
    pub fn summary(&self) -> String {
        let s = self.pack_sizes;
        let extra = self.outer.len() + self.pack.len() - 4; // 4 = the min/max keys
        format!(
            "min {}x{} max {}x{} (+{} field)",
            s.min_width, s.min_height, s.max_width, s.max_height, extra
        )
    }
}

/// Merge fields decoded from a `.spine` project over a base preset JSON.
/// Only keys the decoder produced are overridden; everything else keeps the
/// preset value. Pack-atlas keys are skipped when the preset has packing
/// disabled (`packAtlas` null/missing) — sizes are meaningless without it.
pub fn merge_decoded_settings(
    base_preset: &str,
    decoded: &DecodedSettings,
) -> Result<Value, String> {
    let mut value: Value = serde_json::from_str(base_preset)
        .map_err(|e| format!("Preset nền không phải JSON hợp lệ: {e}"))?;
    let root = value
        .as_object_mut()
        .ok_or_else(|| "Preset nền không phải JSON object.".to_string())?;

    for (key, val) in &decoded.outer {
        if key == "packSource" {
            if let Some(source) = val.as_str() {
                root.insert(key.clone(), crate::normalize_pack_source(source).into());
                continue;
            }
        }
        root.insert(key.clone(), val.clone());
    }

    if let Some(pack) = root.get_mut("packAtlas").and_then(|p| p.as_object_mut()) {
        for (key, val) in &decoded.pack {
            pack.insert(key.clone(), val.clone());
        }
    }

    Ok(value)
}

pub fn read_export_settings(path: &Path) -> Result<DecodedSettings, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("đọc file thất bại: {e}"))?;
    let data = inflate_project(&bytes)?;
    decode(&data).ok_or_else(|| "không tìm thấy pack settings trong project".to_string())
}

/// `.spine` projects are raw deflate (no zlib header).
fn inflate_project(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    flate2::read::DeflateDecoder::new(bytes)
        .take(MAX_INFLATED_BYTES)
        .read_to_end(&mut out)
        .map_err(|e| format!("inflate thất bại (không phải project 3.8?): {e}"))?;
    if out.is_empty() {
        return Err("inflate ra rỗng".to_string());
    }
    Ok(out)
}

/// Little-endian base-128 varint. Returns (value, position after the varint).
fn read_varint(data: &[u8], mut pos: usize) -> Option<(u64, usize)> {
    let mut result: u64 = 0;
    let mut shift = 0u32;
    loop {
        let b = *data.get(pos)?;
        pos += 1;
        result |= u64::from(b & 0x7f) << shift;
        if b & 0x80 == 0 {
            return Some((result, pos));
        }
        shift += 7;
        if shift > 63 {
            return None;
        }
    }
}

fn is_valid_dimension(v: u64) -> bool {
    (16..=16384).contains(&v) && v.is_power_of_two()
}

struct PackScan {
    sizes: PackSizes,
    /// Offset of the leading 0x07 field id.
    start: usize,
    /// Offset just past the maxHeight varint.
    end: usize,
}

/// Scan for `07 <varint> 08 <varint> 09 <varint> 0A <varint>` where all four
/// values are powers of two in [16, 16384] and min <= max per axis. The
/// settings block sits near EOF, so the LAST match wins (earlier matches in
/// skeleton data would be coincidences).
fn scan_pack_sizes(data: &[u8]) -> Option<PackScan> {
    let mut found = None;
    for i in 0..data.len().saturating_sub(8) {
        if data[i] == 0x07 {
            if let Some(scan) = try_pack_at(data, i) {
                found = Some(scan);
            }
        }
    }
    found
}

fn try_pack_at(data: &[u8], start: usize) -> Option<PackScan> {
    let mut vals = [0u64; 4];
    let mut pos = start;
    for (idx, val) in vals.iter_mut().enumerate() {
        if *data.get(pos)? != 0x07 + idx as u8 {
            return None;
        }
        let (v, next) = read_varint(data, pos + 1)?;
        if !is_valid_dimension(v) {
            return None;
        }
        *val = v;
        pos = next;
    }
    if vals[0] > vals[2] || vals[1] > vals[3] {
        return None;
    }
    Some(PackScan {
        sizes: PackSizes {
            min_width: vals[0] as u32,
            min_height: vals[1] as u32,
            max_width: vals[2] as u32,
            max_height: vals[3] as u32,
        },
        start,
        end: pos,
    })
}

/// All high-bit-terminated ASCII strings in `data[range]`, as
/// (start_offset, decoded string). Minimum 3 chars to skip noise.
fn hibit_strings(data: &[u8], from: usize, to: usize) -> Vec<(usize, String)> {
    let mut out = Vec::new();
    let mut run_start = from;
    let mut run = Vec::new();
    let to = to.min(data.len());
    let mut i = from;
    while i < to {
        let b = data[i];
        if (0x20..=0x7e).contains(&b) {
            if run.is_empty() {
                run_start = i;
            }
            run.push(b);
        } else if b & 0x80 != 0 && (0x20..=0x7e).contains(&(b & 0x7f)) && !run.is_empty() {
            run.push(b & 0x7f);
            if run.len() >= 3 {
                out.push((run_start, String::from_utf8_lossy(&run).into_owned()));
            }
            run.clear();
        } else {
            run.clear();
        }
        i += 1;
    }
    out
}

fn bool_value(b: u8) -> Option<bool> {
    match b {
        0 => Some(false),
        1 => Some(true),
        _ => None,
    }
}

fn decode(data: &[u8]) -> Option<DecodedSettings> {
    let scan = scan_pack_sizes(data)?;
    let mut d = DecodedSettings {
        pack_sizes: scan.sizes,
        ..Default::default()
    };
    let s = scan.sizes;
    d.pack.insert("minWidth".into(), s.min_width.into());
    d.pack.insert("minHeight".into(), s.min_height.into());
    d.pack.insert("maxWidth".into(), s.max_width.into());
    d.pack.insert("maxHeight".into(), s.max_height.into());

    decode_prefix_fields(data, scan.start, &mut d);
    let after_pack = decode_suffix_fields(data, scan.end, &mut d);
    decode_outer_fields(data, scan.start, &mut d);
    decode_trailing_strings(data, after_pack, &mut d);
    Some(d)
}

/// Tier B (positional): the field run right before minWidth —
/// `01 b 02 b 03 b 04 b 05 b 06 <varint>` = stripWhitespaceX/Y, rotation,
/// alias, ignoreBlankImages, alphaThreshold. Decoded only when the byte
/// pattern matches exactly and ends flush against the pack-size anchor.
fn decode_prefix_fields(data: &[u8], pack_start: usize, d: &mut DecodedSettings) {
    // alphaThreshold <= 255 → varint is 1 or 2 bytes.
    for vlen in 1..=2usize {
        let need = 11 + vlen; // five id+bool pairs + id 06 + varint
        let Some(start) = pack_start.checked_sub(need) else {
            continue;
        };
        let seg = &data[start..pack_start];
        let ids_ok = seg[0] == 0x01
            && seg[2] == 0x02
            && seg[4] == 0x03
            && seg[6] == 0x04
            && seg[8] == 0x05
            && seg[10] == 0x06;
        if !ids_ok {
            continue;
        }
        let bools: Option<Vec<bool>> = [seg[1], seg[3], seg[5], seg[7], seg[9]]
            .iter()
            .map(|&b| bool_value(b))
            .collect();
        let Some(bools) = bools else { continue };
        let Some((threshold, end)) = read_varint(data, start + 11) else {
            continue;
        };
        if end != pack_start || threshold > 255 {
            continue;
        }
        for (key, val) in [
            "stripWhitespaceX",
            "stripWhitespaceY",
            "rotation",
            "alias",
            "ignoreBlankImages",
        ]
        .iter()
        .zip(&bools)
        {
            d.pack.insert((*key).into(), (*val).into());
        }
        // Calibration 2026-06-10 (Althea): the stored alphaThreshold (6) did not
        // match the artist's actual export (3) — region sizes diverged. Parsed
        // only to validate the block layout; the preset value wins.
        let _ = threshold;
        return;
    }
}

/// Tier B (positional): right after maxHeight — `0B b 0C b 0D b` =
/// pot, multipleOfFour, square; then `0E 01 <string>` outputFormat and
/// `0F <f32 BE>` jpegQuality. Returns the offset where parsing stopped.
fn decode_suffix_fields(data: &[u8], pack_end: usize, d: &mut DecodedSettings) -> usize {
    let mut pos = pack_end;
    // Calibration 2026-06-10 (Chest + Althea): applying the stored 0x0C value as
    // multipleOfFour reproduced neither artist export (it alone caused the whole
    // page-layout drift), so it is parsed for position but never emitted.
    let keys = [
        (0x0Bu8, Some("pot")),
        (0x0C, None),
        (0x0D, Some("square")),
    ];
    for (id, key) in keys {
        let (Some(&fid), Some(&val)) = (data.get(pos), data.get(pos + 1)) else {
            return pos;
        };
        let Some(b) = bool_value(val) else { return pos };
        if fid != id {
            return pos;
        }
        if let Some(key) = key {
            d.pack.insert(key.into(), b.into());
        }
        pos += 2;
    }
    // 0E 01 "png" — output image format.
    if data.get(pos) == Some(&0x0E) && data.get(pos + 1) == Some(&0x01) {
        if let Some((start, value)) = hibit_strings(data, pos + 2, pos + 2 + 16).first() {
            if *start == pos + 2 && matches!(value.as_str(), "png" | "jpg" | "jpeg") {
                d.pack.insert("outputFormat".into(), value.clone().into());
                pos = pos + 2 + value.len();
            }
        }
    }
    // 0F <f32 big-endian> — jpegQuality in [0, 1].
    if data.get(pos) == Some(&0x0F) {
        if let Some(raw) = data.get(pos + 1..pos + 5) {
            let q = f32::from_be_bytes([raw[0], raw[1], raw[2], raw[3]]);
            if (0.0..=1.0).contains(&q) {
                d.pack
                    .insert("jpegQuality".into(), Value::from(f64::from(q)));
                pos += 5;
            }
        }
    }
    pos
}

/// Tier A: outer export-settings fields anchored on the skeleton extension
/// string (".skel.bytes" / ".json" / ...) just before the pack block:
/// `<name> 5A 01 08 00 01 <extension> 01 <nonessential> 02 <cleanUp> ...`
/// where <name> is "binary" or "json" → the export class.
fn decode_outer_fields(data: &[u8], pack_start: usize, d: &mut DecodedSettings) {
    let from = pack_start.saturating_sub(NEAR_WINDOW);
    let strings = hibit_strings(data, from, pack_start);
    // Extension = the LAST dotted string before the pack block.
    let Some((ext_start, ext)) = strings
        .iter()
        .filter(|(_, s)| s.starts_with('.') && s.len() <= 32)
        .next_back()
    else {
        return;
    };
    d.outer.insert("extension".into(), ext.clone().into());

    // Export class from the last "binary"/"json" name before the extension.
    if let Some((_, name)) = strings
        .iter()
        .filter(|(start, s)| start < ext_start && matches!(s.as_str(), "binary" | "json"))
        .next_back()
    {
        let class = if name == "binary" {
            "export-binary"
        } else {
            "export-json"
        };
        d.outer.insert("class".into(), class.into());
        d.outer.insert(
            "format".into(),
            if name == "binary" { "Binary" } else { "JSON" }.into(),
        );
    }

    // `01 <bool> 02 <bool>` right after the extension = nonessential, cleanUp.
    // cleanUp is validated (toggling it reproduced a real export byte-for-byte).
    let p = ext_start + ext.len();
    if data.get(p) == Some(&0x01) && data.get(p + 2) == Some(&0x02) {
        if let (Some(non), Some(clean)) = (
            data.get(p + 1).copied().and_then(bool_value),
            data.get(p + 3).copied().and_then(bool_value),
        ) {
            d.outer.insert("nonessential".into(), non.into());
            d.outer.insert("cleanUp".into(), clean.into());
        }
    }
}

/// Tier A strings after the pack block: atlasExtension, packSource, packTarget.
fn decode_trailing_strings(data: &[u8], after_pack: usize, d: &mut DecodedSettings) {
    let strings = hibit_strings(data, after_pack, after_pack + NEAR_WINDOW);
    if let Some((_, s)) = strings
        .iter()
        .find(|(_, s)| s.starts_with('.') && s.len() <= 32)
    {
        d.pack.insert("atlasExtension".into(), s.clone().into());
    }
    if let Some((_, s)) = strings
        .iter()
        .find(|(_, s)| matches!(s.as_str(), "attachments" | "imagefolders" | "folder"))
    {
        d.outer.insert("packSource".into(), s.clone().into());
    }
    if let Some((_, s)) = strings
        .iter()
        .find(|(_, s)| matches!(s.as_str(), "perskeleton" | "combined"))
    {
        d.outer.insert("packTarget".into(), s.clone().into());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proptest::prelude::*;
    use std::io::Write;

    fn varint_bytes(mut v: u64) -> Vec<u8> {
        let mut out = Vec::new();
        loop {
            let b = (v & 0x7f) as u8;
            v >>= 7;
            if v == 0 {
                out.push(b);
                return out;
            }
            out.push(b | 0x80);
        }
    }

    fn hibit(s: &str) -> Vec<u8> {
        let mut b = s.as_bytes().to_vec();
        *b.last_mut().unwrap() |= 0x80;
        b
    }

    fn pack_block(min: u64, max: u64) -> Vec<u8> {
        let mut b = Vec::new();
        for (id, v) in [(0x07u8, min), (0x08, min), (0x09, max), (0x0A, max)] {
            b.push(id);
            b.extend(varint_bytes(v));
        }
        b
    }

    #[test]
    fn varint_known_values() {
        assert_eq!(read_varint(&[0x05], 0), Some((5, 1)));
        assert_eq!(read_varint(&[0x80, 0x02], 0), Some((256, 2)));
        assert_eq!(read_varint(&[0x80, 0x20], 0), Some((4096, 2)));
        assert_eq!(read_varint(&[0x80], 0), None); // truncated
        assert_eq!(read_varint(&[], 0), None);
    }

    proptest! {
        #[test]
        fn varint_roundtrip(v in 0u64..=u64::MAX / 2) {
            let bytes = varint_bytes(v);
            prop_assert_eq!(read_varint(&bytes, 0), Some((v, bytes.len())));
        }
    }

    #[test]
    fn hibit_string_decode() {
        let data = hibit("binary");
        let found = hibit_strings(&data, 0, data.len());
        assert_eq!(found, vec![(0, "binary".to_string())]);
    }

    #[test]
    fn scan_finds_valid_pattern_in_noise() {
        let mut data = vec![0u8; 64];
        data.extend(pack_block(256, 4096));
        data.extend(vec![0xFFu8; 16]);
        let scan = scan_pack_sizes(&data).expect("should find");
        assert_eq!(
            scan.sizes,
            PackSizes {
                min_width: 256,
                min_height: 256,
                max_width: 4096,
                max_height: 4096
            }
        );
    }

    #[test]
    fn scan_rejects_invalid_dimensions() {
        for (min, max) in [(100, 4096), (8, 4096), (16, 32768), (4096, 256)] {
            let data = pack_block(min, max);
            assert!(
                scan_pack_sizes(&data).is_none(),
                "should reject min={min} max={max}"
            );
        }
    }

    #[test]
    fn scan_takes_last_match() {
        let mut data = pack_block(16, 1024);
        data.extend(vec![0u8; 8]);
        data.extend(pack_block(512, 2048));
        let scan = scan_pack_sizes(&data).unwrap();
        assert_eq!(scan.sizes.min_width, 512);
        assert_eq!(scan.sizes.max_width, 2048);
    }

    #[test]
    fn scan_empty_returns_none() {
        assert!(scan_pack_sizes(&[]).is_none());
        assert!(scan_pack_sizes(&[0u8; 256]).is_none());
    }

    /// Synthetic settings block mirroring the layout observed in real
    /// 3.8.99 projects (see module docs), run through the full pipeline.
    #[test]
    fn full_pipeline_synthetic_project() {
        let mut payload = vec![0u8; 128]; // fake skeleton data
        payload.extend(hibit("binary"));
        payload.extend([0x5A, 0x01, 0x08, 0x00, 0x01]);
        payload.extend(hibit(".skel.bytes"));
        payload.extend([0x01, 0x01, 0x02, 0x01]); // nonessential=true, cleanUp=true
        payload.extend([0x03, 0x64, 0x01, 0x26, 0x01]); // observed filler before pack block
        payload.extend([0x01, 0x01, 0x02, 0x01, 0x03, 0x01, 0x04, 0x01, 0x05, 0x00, 0x06, 0x03]);
        payload.extend(pack_block(1024, 4096));
        payload.extend([0x0B, 0x00, 0x0C, 0x01, 0x0D, 0x00]); // pot, mof, square
        payload.extend([0x0E, 0x01]);
        payload.extend(hibit("png"));
        payload.push(0x0F);
        payload.extend(0.9f32.to_be_bytes());
        payload.extend([0x1F, 0x01]);
        payload.extend(hibit(".atlas.txt"));
        payload.extend([0x04, 0x01]);
        payload.extend(hibit("attachments"));
        payload.extend([0x05, 0x01]);
        payload.extend(hibit("perskeleton"));

        let mut enc =
            flate2::write::DeflateEncoder::new(Vec::new(), flate2::Compression::default());
        enc.write_all(&payload).unwrap();
        let compressed = enc.finish().unwrap();

        let dir = std::env::temp_dir().join(format!("sfx-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("synthetic.spine");
        std::fs::write(&path, &compressed).unwrap();

        let d = read_export_settings(&path).expect("decode should succeed");
        std::fs::remove_dir_all(&dir).ok();

        assert_eq!(d.pack_sizes.min_width, 1024);
        assert_eq!(d.pack_sizes.max_width, 4096);
        assert_eq!(d.outer.get("extension"), Some(&".skel.bytes".into()));
        assert_eq!(d.outer.get("class"), Some(&"export-binary".into()));
        assert_eq!(d.outer.get("cleanUp"), Some(&true.into()));
        assert_eq!(d.outer.get("nonessential"), Some(&true.into()));
        assert_eq!(d.outer.get("packSource"), Some(&"attachments".into()));
        assert_eq!(d.outer.get("packTarget"), Some(&"perskeleton".into()));
        assert_eq!(d.pack.get("stripWhitespaceX"), Some(&true.into()));
        assert_eq!(d.pack.get("ignoreBlankImages"), Some(&false.into()));
        assert_eq!(d.pack.get("pot"), Some(&false.into()));
        // Demoted by calibration — parsed for position but never emitted:
        assert_eq!(d.pack.get("alphaThreshold"), None);
        assert_eq!(d.pack.get("multipleOfFour"), None);
        assert_eq!(d.pack.get("outputFormat"), Some(&"png".into()));
        assert_eq!(d.pack.get("atlasExtension"), Some(&".atlas.txt".into()));
        assert_eq!(
            d.pack.get("jpegQuality"),
            Some(&Value::from(f64::from(0.9f32)))
        );
    }

    #[test]
    fn inflate_rejects_garbage() {
        assert!(inflate_project(&[0xDE, 0xAD, 0xBE, 0xEF]).is_err());
    }

    /// merge_decoded_settings overrides exactly the decoded keys; everything
    /// else in the base preset stays untouched, and packAtlas overrides are
    /// dropped when the preset has packing disabled.
    #[test]
    fn merge_decoded_settings_overrides_only_decoded_keys() {
        let base = r#"{
            "class": "export-binary",
            "extension": ".skel",
            "cleanUp": false,
            "nonessential": true,
            "packAtlas": { "minWidth": 16, "minHeight": 16, "maxWidth": 2048,
                           "maxHeight": 2048, "paddingX": 2, "bleed": false },
            "packSource": "attachments",
            "warnings": true
        }"#;
        let mut decoded = DecodedSettings {
            pack_sizes: PackSizes {
                min_width: 256,
                min_height: 256,
                max_width: 4096,
                max_height: 4096,
            },
            ..Default::default()
        };
        decoded.outer.insert("cleanUp".into(), true.into());
        decoded.outer.insert("packSource".into(), "folder".into());
        decoded.pack.insert("minWidth".into(), 256.into());
        decoded.pack.insert("maxWidth".into(), 4096.into());

        let merged = merge_decoded_settings(base, &decoded).unwrap();
        // Overridden by the decoder:
        assert_eq!(merged["cleanUp"], true);
        assert_eq!(merged["packAtlas"]["minWidth"], 256);
        assert_eq!(merged["packAtlas"]["maxWidth"], 4096);
        // Legacy packSource value gets normalized on the way in.
        assert_eq!(merged["packSource"], "imagefolders");
        // Untouched preset values:
        assert_eq!(merged["extension"], ".skel");
        assert_eq!(merged["nonessential"], true);
        assert_eq!(merged["packAtlas"]["paddingX"], 2);
        assert_eq!(merged["packAtlas"]["bleed"], false);
        assert_eq!(merged["warnings"], true);

        // packAtlas null → pack overrides are dropped, outer ones still apply.
        let no_pack = r#"{ "class": "export-binary", "packAtlas": null }"#;
        let merged = merge_decoded_settings(no_pack, &decoded).unwrap();
        assert_eq!(merged["packAtlas"], Value::Null);
        assert_eq!(merged["cleanUp"], true);

        // Invalid base JSON → error.
        assert!(merge_decoded_settings("not json", &decoded).is_err());
    }

    /// Dev tool for calibrating the decoder against real projects. Decodes
    /// SPINE_FIXTURE, merges over BASE_PRESET and writes OUT_JSON, which can
    /// then be fed to the Spine CLI and diffed against an artist's export:
    /// `SPINE_FIXTURE=... BASE_PRESET=... OUT_JSON=... cargo test --ignored calibration_merge_dump`
    #[test]
    #[ignore]
    fn calibration_merge_dump() {
        let fixture = std::env::var("SPINE_FIXTURE").expect("set SPINE_FIXTURE");
        let base = std::env::var("BASE_PRESET").expect("set BASE_PRESET");
        let out = std::env::var("OUT_JSON").expect("set OUT_JSON");
        let decoded = read_export_settings(Path::new(&fixture)).unwrap();
        eprintln!("decoded {}: {}", fixture, decoded.summary());
        let merged = merge_decoded_settings(
            &std::fs::read_to_string(&base).unwrap(),
            &decoded,
        )
        .unwrap();
        std::fs::write(&out, serde_json::to_string_pretty(&merged).unwrap()).unwrap();
        eprintln!("merged settings written to {out}");
    }

    /// Manual check against a real production project. Run with:
    /// `SPINE_FIXTURE=D:\Resources\SI\UI\Chest\Chest.spine cargo test --ignored real_fixture`
    /// Expected for Chest.spine: min 256, max 4096.
    #[test]
    #[ignore]
    fn real_fixture() {
        let path = std::env::var("SPINE_FIXTURE").expect("set SPINE_FIXTURE");
        let d = read_export_settings(Path::new(&path)).expect("decode real project");
        eprintln!("decoded: outer={:?} pack={:?}", d.outer, d.pack);
        assert!(d.pack_sizes.min_width >= 16);
    }
}
