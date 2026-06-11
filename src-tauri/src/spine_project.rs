//! Best-effort decoder for the export settings embedded in `.spine` project files
//! (Spine editor 3.8.x). Reverse-engineered 2026-06 and validated against real
//! projects: parsed min/max + base preset reproduced an artist's manual export
//! byte-for-byte (see docs in the v0.2.14 plan / memory `spine-project-file-format`).
//!
//! Format facts (validated):
//! - A `.spine` project is a single raw-deflate stream (no zlib header).
//! - The inflated payload is a custom binary serialization. Strings are ASCII
//!   with the final byte OR'd with 0x80 (`"binar"` + 0xF9 == "binary").
//! - Integers are little-endian base-128 varints, **zigzag-encoded** (libGDX
//!   `writeInt(value, optimizePositive=false)`): n >= 0 is stored as 2n.
//!   Proven 2026-06-11 by a controlled editor export — padding 3 stored as 6,
//!   max 700 as 1400, min 128 as 256 (docs/research-padding-not-decoded.md §9).
//!   Floats (f32 BE) and bools (single 0/1 byte) are not affected.
//! - Pack-settings field ids are the 1-based index of the key in the
//!   `.export.json` `packAtlas` schema (paddingX = 22nd key = 0x16, ...).
//! - The last-export settings live near the end of the payload. Pack-atlas
//!   min/max sizes are the field-id/varint pairs `07 08 09 0A`
//!   (minWidth, minHeight, maxWidth, maxHeight), always followed by `0B <bool>`.
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

/// Read a zigzag varint and reject negative values. All int settings are
/// non-negative, so an odd raw varint (= negative after zigzag) means the
/// bytes are not the field we think they are.
fn read_zigzag(data: &[u8], pos: usize) -> Option<(u64, usize)> {
    let (raw, next) = read_varint(data, pos)?;
    if raw & 1 != 0 {
        return None;
    }
    Some((raw >> 1, next))
}

/// Page sizes are arbitrary in the editor (e.g. 700), not just powers of two;
/// the scan instead anchors on the `0B <bool>` field that follows the block.
fn is_valid_dimension(v: u64) -> bool {
    (16..=16384).contains(&v)
}

struct PackScan {
    sizes: PackSizes,
    /// Offset of the leading 0x07 field id.
    start: usize,
    /// Offset just past the maxHeight varint.
    end: usize,
}

/// Scan for `07 <varint> 08 <varint> 09 <varint> 0A <varint> 0B <bool>` where
/// all four zigzag-decoded values are in [16, 16384] and min <= max per axis.
/// The settings block sits near EOF, so the LAST match wins (earlier matches
/// in skeleton data would be coincidences).
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
        let (v, next) = read_zigzag(data, pos + 1)?;
        if !is_valid_dimension(v) {
            return None;
        }
        *val = v;
        pos = next;
    }
    if vals[0] > vals[2] || vals[1] > vals[3] {
        return None;
    }
    // Anchor: `0B <bool>` (pot) always follows maxHeight. Required now that
    // dimensions are no longer constrained to powers of two.
    if *data.get(pos)? != 0x0B || bool_value(*data.get(pos + 1)?).is_none() {
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
    decode_scale(data, scan.end, &mut d);
    decode_padding(data, scan.end, &mut d);
    decode_packing(data, scan.end, &mut d);
    decode_outer_fields(data, scan.start, &mut d);
    decode_trailing_strings(data, after_pack, &mut d);
    Some(d)
}

/// Tier A (validated 2026-06-11): `packing` is field `0x28`, stored near EOF in
/// the trailing region as `28 01 <enum>` where the enum byte is 2 = rectangles,
/// 3 = polygons. Proven by a controlled editor export — flipping only the
/// Packing dropdown to Polygons changed exactly this one byte (02 → 03); Chest
/// (02/rectangles) and Althea (03/polygons) independently agree. Unlike most
/// fields the editor always writes it, so absence means "not this block".
fn decode_packing(data: &[u8], pack_end: usize, d: &mut DecodedSettings) {
    let to = (pack_end + NEAR_WINDOW).min(data.len());
    let mut i = pack_end;
    while i + 2 < to {
        if data[i] == 0x28 && data[i + 1] == 0x01 {
            let packing = match data[i + 2] {
                2 => "rectangles",
                3 => "polygons",
                _ => return,
            };
            d.pack.insert("packing".into(), packing.into());
            return;
        }
        i += 1;
    }
}

/// Tier A (validated end-to-end 2026-06): pack-atlas `scale`. Spine stores scale
/// at full resolution; dropping it exports at the wrong resolution (e.g. 2x for
/// scale 0.5 — proven on 3001_Lucius: scale 0.5 reproduced the editor's 320px
/// pages, ignoring it gave ~640px). Encoding within the pack block, after
/// maxHeight: `13 <count varint> [02 <f32 BE>]...`.
///
/// Only single-scale is decoded — that is what was validated, and overriding a
/// 1-element `scale` keeps the preset's parallel `scaleSuffix`/`scaleResampling`
/// (also length 1) consistent. Multi-scale projects keep the preset's scale.
fn decode_scale(data: &[u8], pack_end: usize, d: &mut DecodedSettings) {
    let to = (pack_end + 96).min(data.len());
    let mut i = pack_end;
    while i + 6 < to {
        if data[i] == 0x13 {
            if let Some((count, p)) = read_varint(data, i + 1) {
                if count == 1 && data.get(p) == Some(&0x02) {
                    if let Some(raw) = data.get(p + 1..p + 5) {
                        let v = f32::from_be_bytes([raw[0], raw[1], raw[2], raw[3]]);
                        if v > 0.0 && v <= 8.0 {
                            d.pack
                                .insert("scale".into(), Value::Array(vec![Value::from(f64::from(v))]));
                            return;
                        }
                    }
                }
            }
        }
        i += 1;
    }
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
        let Some((threshold, end)) = read_zigzag(data, start + 11) else {
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
        // The 2026-06-10 "mismatch" (stored 6 vs artist's 3) that demoted this
        // field was the zigzag encoding, not stale data: 6 = zigzag(3).
        d.pack.insert("alphaThreshold".into(), threshold.into());
        return;
    }
}

/// Tier B (positional): right after maxHeight — `0B b 0C b 0D b` =
/// pot, multipleOfFour, square; then `0E 01 <string>` outputFormat and
/// `0F <f32 BE>` jpegQuality. Returns the offset where parsing stopped.
fn decode_suffix_fields(data: &[u8], pack_end: usize, d: &mut DecodedSettings) -> usize {
    let mut pos = pack_end;
    // multipleOfFour (0x0C): re-validated 2026-06-11 once min/max were no longer
    // doubled. With it on, a CLI re-export of 3001_Lucius reproduced the editor's
    // pages byte-for-byte (308/300/288/272, all ÷4); the 2026-06-10 demotion was
    // confounded by the zigzag-doubled sizes, not this field.
    let keys = [
        (0x0Bu8, Some("pot")),
        (0x0C, Some("multipleOfFour")),
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
    // `11 <bool> 12 <bool>` — premultiplyAlpha, bleed.
    // Both bits matched the dialog checkboxes in the 2026-06-11 experiment.
    if data.get(pos) == Some(&0x11) && data.get(pos + 2) == Some(&0x12) {
        if let (Some(pma), Some(bleed)) = (
            data.get(pos + 1).copied().and_then(bool_value),
            data.get(pos + 3).copied().and_then(bool_value),
        ) {
            d.pack.insert("premultiplyAlpha".into(), pma.into());
            d.pack.insert("bleed".into(), bleed.into());
            pos += 4;
        }
    }
    pos
}

/// Tier A (validated 2026-06-11): `16 <zigzag> 17 <zigzag> 18 <bool> 19 <bool>`
/// = paddingX, paddingY, edgePadding, duplicatePadding, scanned in the same
/// window after the pack block as `scale`. An editor export with padding 3
/// stored raw 6 — earlier reads of "16" for a real padding of 8 were the
/// zigzag doubling, not a different semantic (research doc §8–9).
fn decode_padding(data: &[u8], pack_end: usize, d: &mut DecodedSettings) {
    let to = (pack_end + 96).min(data.len());
    let mut i = pack_end;
    while i + 6 < to {
        if data[i] == 0x16 {
            if let Some((px, p)) = read_zigzag(data, i + 1) {
                if px <= 128 && data.get(p) == Some(&0x17) {
                    if let Some((py, q)) = read_zigzag(data, p + 1) {
                        let edge = data.get(q).filter(|&&b| b == 0x18).and_then(|_| {
                            data.get(q + 1).copied().and_then(bool_value)
                        });
                        let dup = data.get(q + 2).filter(|&&b| b == 0x19).and_then(|_| {
                            data.get(q + 3).copied().and_then(bool_value)
                        });
                        if let (true, Some(edge), Some(dup)) = (py <= 128, edge, dup) {
                            d.pack.insert("paddingX".into(), px.into());
                            d.pack.insert("paddingY".into(), py.into());
                            d.pack.insert("edgePadding".into(), edge.into());
                            d.pack.insert("duplicatePadding".into(), dup.into());
                            return;
                        }
                    }
                }
            }
        }
        i += 1;
    }
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
#[path = "spine_project_tests.rs"]
mod tests;
