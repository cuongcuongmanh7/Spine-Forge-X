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

/// Encode a non-negative int the way the editor does: zigzag varint (2n).
fn zigzag_bytes(v: u64) -> Vec<u8> {
    varint_bytes(v * 2)
}

fn hibit(s: &str) -> Vec<u8> {
    let mut b = s.as_bytes().to_vec();
    *b.last_mut().unwrap() |= 0x80;
    b
}

/// Header version stamp: mimics the layout dumped from real projects —
/// `<byte> '0'|80 ' ' '0'|80 ' ' <version digits, last |0x80>`.
/// (3001_Lucius.spine: `12 B0 20 B0 20 "3.8.9" B9`; the 4.3 re-save:
/// `47 B0 20 B0 20 "4.3.1" B7`.)
#[test]
fn detects_editor_version_in_header() {
    let mut v43 = vec![0x47, 0xB0, 0x20, 0xB0, 0x20];
    v43.extend(hibit("4.3.17"));
    assert_eq!(detect_editor_version(&v43).as_deref(), Some("4.3.17"));

    let mut v38 = vec![0x12, 0xB0, 0x20, 0xB0, 0x20];
    v38.extend(hibit("3.8.99"));
    assert_eq!(detect_editor_version(&v38).as_deref(), Some("3.8.99"));

    // No version stamp → None (error message stays generic).
    assert_eq!(detect_editor_version(&[0x00, 0x01, 0x02, 0x03]), None);
}

fn pack_block(min: u64, max: u64) -> Vec<u8> {
    let mut b = Vec::new();
    for (id, v) in [(0x07u8, min), (0x08, min), (0x09, max), (0x0A, max)] {
        b.push(id);
        b.extend(zigzag_bytes(v));
    }
    b
}

/// Pack block plus the `0B <bool>` (pot) anchor the scanner requires.
fn anchored_pack_block(min: u64, max: u64) -> Vec<u8> {
    let mut b = pack_block(min, max);
    b.extend([0x0B, 0x00]);
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

#[test]
fn zigzag_known_values() {
    // Values observed in real projects: padding 3 stored as 6, min 128 as 256,
    // max 700 as 1400 (controlled editor export, 2026-06-11).
    assert_eq!(read_zigzag(&[0x06], 0), Some((3, 1)));
    assert_eq!(read_zigzag(&[0x80, 0x02], 0), Some((128, 2)));
    assert_eq!(read_zigzag(&[0xF8, 0x0A], 0), Some((700, 2)));
    // Odd raw = negative after zigzag — never a valid setting.
    assert_eq!(read_zigzag(&[0x05], 0), None);
}

proptest! {
    #[test]
    fn varint_roundtrip(v in 0u64..=u64::MAX / 2) {
        let bytes = varint_bytes(v);
        prop_assert_eq!(read_varint(&bytes, 0), Some((v, bytes.len())));
    }

    #[test]
    fn zigzag_roundtrip(v in 0u64..=u64::MAX / 4) {
        let bytes = zigzag_bytes(v);
        prop_assert_eq!(read_zigzag(&bytes, 0), Some((v, bytes.len())));
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
    data.extend(anchored_pack_block(256, 4096));
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
fn scan_accepts_non_power_of_two() {
    // Real case: the editor allows arbitrary sizes like 700.
    let data = anchored_pack_block(128, 700);
    let scan = scan_pack_sizes(&data).expect("700 is a legal page size");
    assert_eq!(scan.sizes.min_width, 128);
    assert_eq!(scan.sizes.max_width, 700);
}

#[test]
fn scan_rejects_invalid_dimensions() {
    for (min, max) in [(8, 4096), (16, 32768), (4096, 256)] {
        let data = anchored_pack_block(min, max);
        assert!(
            scan_pack_sizes(&data).is_none(),
            "should reject min={min} max={max}"
        );
    }
}

#[test]
fn scan_rejects_odd_raw_varint() {
    // Odd raw varints decode to negative ints under zigzag — not a pack block.
    let data = [0x07, 0x41, 0x08, 0x41, 0x09, 0x41, 0x0A, 0x41, 0x0B, 0x00];
    assert!(scan_pack_sizes(&data).is_none());
}

#[test]
fn scan_requires_pot_anchor() {
    // Without the trailing `0B <bool>` the four pairs are treated as noise.
    let data = pack_block(256, 4096);
    assert!(scan_pack_sizes(&data).is_none());
}

#[test]
fn scan_takes_last_match() {
    let mut data = anchored_pack_block(16, 1024);
    data.extend(vec![0u8; 8]);
    data.extend(anchored_pack_block(512, 2048));
    let scan = scan_pack_sizes(&data).unwrap();
    assert_eq!(scan.sizes.min_width, 512);
    assert_eq!(scan.sizes.max_width, 2048);
}

#[test]
fn scan_empty_returns_none() {
    assert!(scan_pack_sizes(&[]).is_none());
    assert!(scan_pack_sizes(&[0u8; 256]).is_none());
}

/// The exact settings block written by editor 3.8.99 for the 2026-06-11
/// controlled export (3001_Lucius on the shared drive): padding 3, min 128,
/// max 700, alphaThreshold 0, scale 0.5, square + div4 + edgePadding + PMA on,
/// bleed + duplicatePadding off, packing Polygons. Verbatim trailing bytes from
/// the real `.spine` (after re-exporting with Packing=Polygons). Regression-pins
/// the zigzag decoding and the `28 01 03` packing enum.
#[test]
fn experiment_block_lucius_2026_06_11() {
    let mut data: Vec<u8> = vec![
        0x01, 0x01, 0x02, 0x01, 0x03, 0x01, 0x04, 0x01, 0x05, 0x01, 0x06, 0x00, // prefix
        0x07, 0x80, 0x02, 0x08, 0x80, 0x02, 0x09, 0xF8, 0x0A, 0x0A, 0xF8, 0x0A, // sizes
        0x0B, 0x00, 0x0C, 0x01, 0x0D, 0x01, // pot, div4, square
        0x0E, 0x01, 0x70, 0x6E, 0xE7, // outputFormat "png"
        0x0F, 0x3F, 0x66, 0x66, 0x66, // jpegQuality 0.9
        0x11, 0x01, 0x12, 0x00, // premultiplyAlpha, bleed
        0x13, 0x01, 0x02, 0x3F, 0x00, 0x00, 0x00, // scale [0.5]
        0x14, 0x01, 0x02, 0x81, 0x15, 0x01, 0x02, 0x01, 0x03, // suffix/resample arrays
        0x16, 0x06, 0x17, 0x06, 0x18, 0x01, 0x19, 0x00, // padding 3/3, edge, dup
        0x1A, 0x01, 0x02, 0x1B, 0xE8, 0x6E, 0x1C, 0x01, 0x02, 0x1D, 0xE9, 0x6E, // filter/wrap
        0x1E, 0x01, 0x07, 0x1F, 0x01, // format enum, atlasExtension marker
    ];
    data.extend(hibit(".atlas.txt"));
    data.extend([
        0x20, 0x00, 0x21, 0x00, 0x22, 0x00, 0x23, 0x00, 0x24, 0x00, 0x25, 0x01, 0x27, 0x01,
        0x28, 0x01, 0x03, // packing = polygons
        0x04, 0x01,
    ]);
    data.extend(hibit("imagefolders"));

    let d = decode(&data).expect("decode experiment block");
    assert_eq!(
        d.pack_sizes,
        PackSizes {
            min_width: 128,
            min_height: 128,
            max_width: 700,
            max_height: 700
        }
    );
    assert_eq!(d.pack.get("paddingX"), Some(&3.into()));
    assert_eq!(d.pack.get("paddingY"), Some(&3.into()));
    assert_eq!(d.pack.get("edgePadding"), Some(&true.into()));
    assert_eq!(d.pack.get("duplicatePadding"), Some(&false.into()));
    assert_eq!(d.pack.get("alphaThreshold"), Some(&0.into()));
    assert_eq!(d.pack.get("premultiplyAlpha"), Some(&true.into()));
    assert_eq!(d.pack.get("bleed"), Some(&false.into()));
    assert_eq!(d.pack.get("pot"), Some(&false.into()));
    // multipleOfFour: the dialog's "Divisible by 4" — true here (0x0C = 1).
    assert_eq!(d.pack.get("multipleOfFour"), Some(&true.into()));
    assert_eq!(d.pack.get("square"), Some(&true.into()));
    // packing = polygons (0x28 01 03).
    assert_eq!(d.pack.get("packing"), Some(&"polygons".into()));
    assert_eq!(d.pack.get("atlasExtension"), Some(&".atlas.txt".into()));
    assert_eq!(d.pack.get("outputFormat"), Some(&"png".into()));
    assert_eq!(
        d.pack.get("scale"),
        Some(&Value::Array(vec![Value::from(f64::from(0.5f32))]))
    );
}

/// `28 01 02` decodes to rectangles (Chest / pre-toggle Lucius).
#[test]
fn packing_rectangles_enum() {
    let mut d = DecodedSettings::default();
    decode_packing(&[0x28, 0x01, 0x02, 0x04], 0, &mut d);
    assert_eq!(d.pack.get("packing"), Some(&"rectangles".into()));
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
    // strip/rotation/alias/ignoreBlank bools + alphaThreshold 3 (zigzag 6)
    payload.extend([0x01, 0x01, 0x02, 0x01, 0x03, 0x01, 0x04, 0x01, 0x05, 0x00, 0x06, 0x06]);
    payload.extend(pack_block(1024, 4096));
    payload.extend([0x0B, 0x00, 0x0C, 0x01, 0x0D, 0x00]); // pot, mof, square
    payload.extend([0x0E, 0x01]);
    payload.extend(hibit("png"));
    payload.push(0x0F);
    payload.extend(0.9f32.to_be_bytes());
    payload.extend([0x11, 0x00, 0x12, 0x01]); // premultiplyAlpha=false, bleed=true
    // scale [0.5]: field 0x13, count 1, element type 0x02, f32 BE
    payload.extend([0x13, 0x01, 0x02]);
    payload.extend(0.5f32.to_be_bytes());
    // paddingX=2, paddingY=2 (zigzag 4), edgePadding=true, duplicatePadding=false
    payload.extend([0x16, 0x04, 0x17, 0x04, 0x18, 0x01, 0x19, 0x00]);
    payload.extend([0x1F, 0x01]);
    payload.extend(hibit(".atlas.txt"));
    payload.extend([0x28, 0x01, 0x02]); // packing = rectangles
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
    // Re-promoted after the zigzag fix (stored 6 = zigzag 3):
    assert_eq!(d.pack.get("alphaThreshold"), Some(&3.into()));
    // Re-promoted after the zigzag fix unconfounded the calibration:
    assert_eq!(d.pack.get("multipleOfFour"), Some(&true.into()));
    assert_eq!(d.pack.get("outputFormat"), Some(&"png".into()));
    assert_eq!(d.pack.get("premultiplyAlpha"), Some(&false.into()));
    assert_eq!(d.pack.get("bleed"), Some(&true.into()));
    assert_eq!(d.pack.get("packing"), Some(&"rectangles".into()));
    assert_eq!(d.pack.get("paddingX"), Some(&2.into()));
    assert_eq!(d.pack.get("paddingY"), Some(&2.into()));
    assert_eq!(d.pack.get("edgePadding"), Some(&true.into()));
    assert_eq!(d.pack.get("duplicatePadding"), Some(&false.into()));
    assert_eq!(d.pack.get("atlasExtension"), Some(&".atlas.txt".into()));
    assert_eq!(
        d.pack.get("jpegQuality"),
        Some(&Value::from(f64::from(0.9f32)))
    );
    // scale decoded as a single-element array (validated: critical for resolution).
    assert_eq!(
        d.pack.get("scale"),
        Some(&Value::Array(vec![Value::from(f64::from(0.5f32))]))
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
/// Expected for Chest.spine: min 128, max 2048 (zigzag-decoded).
#[test]
#[ignore]
fn real_fixture() {
    let path = std::env::var("SPINE_FIXTURE").expect("set SPINE_FIXTURE");
    let d = read_export_settings(Path::new(&path)).expect("decode real project");
    eprintln!("decoded: outer={:?} pack={:?}", d.outer, d.pack);
    assert!(d.pack_sizes.min_width >= 16);
}
