//! Offline reader for Spine **binary** skeleton exports (`.skel` / `.skel.bytes`), 3.8.x only.
//!
//! Unity-style exports ship a binary skeleton + `.atlas.txt` with no JSON, so the Library scan
//! (`library::read_skeleton_meta`) could not list animations/skins for them. This module ports the
//! reading half of spine-runtimes 3.8 `SkeletonBinary` — just enough to walk the stream and pull
//! out **skin names** and **animation names** (every other field is consumed but discarded).
//!
//! The binary format has no offset table: to reach the skins and animations blocks we must parse
//! every preceding block exactly, so the whole stream is decoded. Validated byte-exact against a
//! real 3.8.99 export (cursor lands on EOF). The 4.x format differs and is intentionally rejected.

/// Skin + animation names pulled from a binary skeleton. Mirrors the JSON path in `library.rs`,
/// including the `default` skin so the two sources behave the same.
#[derive(Debug)]
pub(crate) struct SkelNames {
    pub animations: Vec<String>,
    pub skins: Vec<String>,
}

/// Big-endian cursor with the Spine `DataInput` varint/string primitives. Every read is bounds
/// checked and returns `Err` on a short read rather than panicking.
struct Reader<'a> {
    b: &'a [u8],
    i: usize,
}

impl<'a> Reader<'a> {
    fn new(b: &'a [u8]) -> Self {
        Reader { b, i: 0 }
    }

    fn byte(&mut self) -> Result<u8, String> {
        let v = *self.b.get(self.i).ok_or("unexpected end of skel data")?;
        self.i += 1;
        Ok(v)
    }

    fn boolean(&mut self) -> Result<bool, String> {
        Ok(self.byte()? != 0)
    }

    /// Variable-length int (libGDX `DataInput`): up to 5 little-endian 7-bit groups. When
    /// `optimize_positive` is false the result is zigzag-decoded (matches `readInt(false)`).
    fn varint(&mut self, optimize_positive: bool) -> Result<u32, String> {
        let mut b = self.byte()? as u32;
        let mut result = b & 0x7f;
        if b & 0x80 != 0 {
            b = self.byte()? as u32;
            result |= (b & 0x7f) << 7;
            if b & 0x80 != 0 {
                b = self.byte()? as u32;
                result |= (b & 0x7f) << 14;
                if b & 0x80 != 0 {
                    b = self.byte()? as u32;
                    result |= (b & 0x7f) << 21;
                    if b & 0x80 != 0 {
                        b = self.byte()? as u32;
                        result |= (b & 0x7f) << 28;
                    }
                }
            }
        }
        Ok(if optimize_positive {
            result
        } else {
            (result >> 1) ^ (result & 1).wrapping_neg()
        })
    }

    /// `varint(true)` as a loop count; rejects absurd values so a misalignment fails fast instead
    /// of trying to allocate/iterate billions of times.
    fn count(&mut self) -> Result<usize, String> {
        let n = self.varint(true)? as usize;
        if n > self.b.len() {
            return Err("skel count exceeds file size (misaligned parse)".into());
        }
        Ok(n)
    }

    fn skip(&mut self, n: usize) -> Result<(), String> {
        self.i = self.i.checked_add(n).ok_or("skel skip overflow")?;
        if self.i > self.b.len() {
            return Err("unexpected end of skel data".into());
        }
        Ok(())
    }

    fn f32(&mut self) -> Result<(), String> {
        self.skip(4)
    }

    fn int32(&mut self) -> Result<(), String> {
        self.skip(4)
    }

    /// Length-prefixed UTF-8 string: 0 → null, 1 → "", else `len-1` bytes.
    fn string(&mut self) -> Result<Option<String>, String> {
        let n = self.varint(true)? as usize;
        if n == 0 {
            return Ok(None);
        }
        if n == 1 {
            return Ok(Some(String::new()));
        }
        let len = n - 1;
        let start = self.i;
        self.skip(len)?;
        Ok(Some(String::from_utf8_lossy(&self.b[start..start + len]).into_owned()))
    }

    /// String-table reference: 0 → null, else `strings[index-1]`.
    fn string_ref(&mut self, strings: &[Option<String>]) -> Result<Option<String>, String> {
        let idx = self.varint(true)? as usize;
        if idx == 0 {
            return Ok(None);
        }
        Ok(strings.get(idx - 1).and_then(|s| s.clone()))
    }
}

// Curve, timeline, and attachment type constants (Spine 3.8).
const CURVE_BEZIER: u8 = 2;
const SLOT_ATTACHMENT: u8 = 0;
const SLOT_COLOR: u8 = 1;
const SLOT_TWO_COLOR: u8 = 2;
const BONE_ROTATE: u8 = 0;
const PATH_MIX: u8 = 2;

fn read_curve(r: &mut Reader, frame_index: usize, frame_count: usize) -> Result<(), String> {
    if frame_index < frame_count - 1 && r.byte()? == CURVE_BEZIER {
        r.skip(16)?; // 4 floats
    }
    Ok(())
}

fn read_vertices(r: &mut Reader, vertex_count: usize) -> Result<(), String> {
    if !r.boolean()? {
        r.skip(vertex_count * 2 * 4)?; // verticesLength floats
        return Ok(());
    }
    for _ in 0..vertex_count {
        let bone_count = r.count()?;
        for _ in 0..bone_count {
            r.varint(true)?; // bone index
            r.skip(12)?; // x, y, weight floats
        }
    }
    Ok(())
}

fn read_short_array(r: &mut Reader) -> Result<(), String> {
    let n = r.count()?;
    r.skip(n * 2)
}

fn read_attachment(r: &mut Reader, strings: &[Option<String>], nonessential: bool) -> Result<(), String> {
    r.string_ref(strings)?; // attachment name override
    let type_ = r.byte()?;
    match type_ {
        0 => {
            // region
            r.string_ref(strings)?; // path
            r.skip(7 * 4)?; // rotation,x,y,scaleX,scaleY,width,height
            r.int32()?; // color
        }
        1 => {
            // boundingbox
            let vc = r.count()?;
            read_vertices(r, vc)?;
            if nonessential {
                r.int32()?;
            }
        }
        2 => {
            // mesh
            r.string_ref(strings)?; // path
            r.int32()?; // color
            let vc = r.count()?;
            r.skip(vc * 2 * 4)?; // uvs
            read_short_array(r)?; // triangles
            read_vertices(r, vc)?;
            r.varint(true)?; // hullLength
            if nonessential {
                read_short_array(r)?; // edges
                r.skip(8)?; // width, height
            }
        }
        3 => {
            // linkedmesh
            r.string_ref(strings)?; // path
            r.int32()?; // color
            r.string_ref(strings)?; // skin name
            r.string_ref(strings)?; // parent
            r.boolean()?; // inheritDeform
            if nonessential {
                r.skip(8)?; // width, height
            }
        }
        4 => {
            // path
            r.boolean()?; // closed
            r.boolean()?; // constantSpeed
            let vc = r.count()?;
            read_vertices(r, vc)?;
            r.skip((vc / 3) * 4)?; // lengths
            if nonessential {
                r.int32()?;
            }
        }
        5 => {
            // point
            r.skip(12)?; // rotation, x, y
            if nonessential {
                r.int32()?;
            }
        }
        6 => {
            // clipping
            r.varint(true)?; // endSlot
            let vc = r.count()?;
            read_vertices(r, vc)?;
            if nonessential {
                r.int32()?;
            }
        }
        other => return Err(format!("unknown attachment type {other}")),
    }
    Ok(())
}

/// Reads one skin, returning its name. Default skin (when present) is named "default".
fn read_skin(
    r: &mut Reader,
    strings: &[Option<String>],
    default_skin: bool,
    nonessential: bool,
) -> Result<Option<String>, String> {
    let (name, slot_count) = if default_skin {
        let slot_count = r.count()?;
        if slot_count == 0 {
            return Ok(None);
        }
        (Some("default".to_string()), slot_count)
    } else {
        let name = r.string_ref(strings)?;
        for _ in 0..r.count()? {
            r.varint(true)?; // bones
        }
        for _ in 0..r.count()? {
            r.varint(true)?; // ik
        }
        for _ in 0..r.count()? {
            r.varint(true)?; // transform
        }
        for _ in 0..r.count()? {
            r.varint(true)?; // path
        }
        (name, r.count()?)
    };

    for _ in 0..slot_count {
        r.varint(true)?; // slot index
        for _ in 0..r.count()? {
            r.string_ref(strings)?; // attachment key
            read_attachment(r, strings, nonessential)?;
        }
    }
    Ok(name)
}

fn read_animation(r: &mut Reader, strings: &[Option<String>], event_has_audio: &[bool]) -> Result<(), String> {
    // Slot timelines.
    for _ in 0..r.count()? {
        r.varint(true)?; // slot index
        for _ in 0..r.count()? {
            let tt = r.byte()?;
            let fc = r.count()?;
            match tt {
                SLOT_ATTACHMENT => {
                    for _ in 0..fc {
                        r.f32()?;
                        r.string_ref(strings)?;
                    }
                }
                SLOT_COLOR => {
                    for fi in 0..fc {
                        r.f32()?;
                        r.int32()?;
                        read_curve(r, fi, fc)?;
                    }
                }
                SLOT_TWO_COLOR => {
                    for fi in 0..fc {
                        r.f32()?;
                        r.int32()?;
                        r.int32()?;
                        read_curve(r, fi, fc)?;
                    }
                }
                other => return Err(format!("unknown slot timeline {other}")),
            }
        }
    }
    // Bone timelines.
    for _ in 0..r.count()? {
        r.varint(true)?; // bone index
        for _ in 0..r.count()? {
            let tt = r.byte()?;
            let fc = r.count()?;
            // ROTATE has 2 values/frame, the rest (translate/scale/shear) have 3.
            let values = if tt == BONE_ROTATE { 2 } else { 3 };
            for fi in 0..fc {
                r.skip(4 * values)?;
                read_curve(r, fi, fc)?;
            }
        }
    }
    // IK constraint timelines.
    for _ in 0..r.count()? {
        r.varint(true)?; // index
        let fc = r.count()?;
        for fi in 0..fc {
            r.skip(12)?; // time, mix, softness
            r.byte()?; // bendDirection
            r.boolean()?; // compress
            r.boolean()?; // stretch
            read_curve(r, fi, fc)?;
        }
    }
    // Transform constraint timelines.
    for _ in 0..r.count()? {
        r.varint(true)?; // index
        let fc = r.count()?;
        for fi in 0..fc {
            r.skip(20)?; // time + 4 mix floats
            read_curve(r, fi, fc)?;
        }
    }
    // Path constraint timelines.
    for _ in 0..r.count()? {
        r.varint(true)?; // index
        for _ in 0..r.count()? {
            let tt = r.byte()?;
            let fc = r.count()?;
            // POSITION/SPACING have 2 values/frame, MIX has 3.
            let values = if tt == PATH_MIX { 3 } else { 2 };
            for fi in 0..fc {
                r.skip(4 * values)?;
                read_curve(r, fi, fc)?;
            }
        }
    }
    // Deform timelines.
    for _ in 0..r.count()? {
        r.varint(true)?; // skin index
        for _ in 0..r.count()? {
            r.varint(true)?; // slot index
            for _ in 0..r.count()? {
                r.string_ref(strings)?; // attachment name
                let fc = r.count()?;
                for fi in 0..fc {
                    r.f32()?; // time
                    let end = r.count()?;
                    if end != 0 {
                        r.varint(true)?; // start
                        r.skip(end * 4)?; // deform floats
                    }
                    read_curve(r, fi, fc)?;
                }
            }
        }
    }
    // Draw-order timeline.
    let draw_order_count = r.count()?;
    for _ in 0..draw_order_count {
        r.f32()?; // time
        for _ in 0..r.count()? {
            r.varint(true)?; // slot index
            r.varint(true)?; // offset
        }
    }
    // Event timeline.
    let event_count = r.count()?;
    for _ in 0..event_count {
        r.f32()?; // time
        let idx = r.varint(true)? as usize;
        r.varint(false)?; // int value
        r.f32()?; // float value
        if r.boolean()? {
            r.string()?; // string value
        }
        if event_has_audio.get(idx).copied().unwrap_or(false) {
            r.skip(8)?; // volume, balance
        }
    }
    Ok(())
}

/// Runtime family ("3.8" vs "4.x") read from a binary skeleton's header alone — just the hash
/// and version strings, no full body parse.
///
/// This is what picks the player runtime in `list_export_assets`. It must NOT depend on
/// [`read_skel_names`] succeeding: that's a hand-ported parser with gaps, and a 3.8 file it
/// can't fully walk would otherwise be mislabeled 4.x and loaded by the wrong runtime —
/// misaligning every string and producing garbled region names ("Region not found in atlas").
///
/// A genuine 3.8 export stores its hash as a string, so the version reads cleanly as "3.8.x".
/// A 4.x export stores an 8-byte hash instead; we re-read it that way to recover the exact 4.x
/// minor ("4.2", "4.3", …), because the binary format differs between minors and each needs its
/// matching runtime. Unparseable 4.x falls back to the generic "4.x" key.
pub(crate) fn read_skel_version_family(bytes: &[u8]) -> String {
    // 3.8 path: hash is a length-prefixed string, version reads as "3.8.x".
    let mut r = Reader::new(bytes);
    let v38 = (|| {
        r.string()?; // hash (string in 3.8)
        Ok::<_, String>(r.string()?.unwrap_or_default())
    })()
    .unwrap_or_default();
    if v38.starts_with("3.8") {
        return "3.8".to_string();
    }
    // 4.x path: 8-byte hash (lowHash + highHash int32) then the version string ("4.2.43").
    let mut r4 = Reader::new(bytes);
    let v4 = (|| {
        r4.skip(8)?;
        Ok::<_, String>(r4.string()?.unwrap_or_default())
    })()
    .unwrap_or_default();
    let mut it = v4.split('.');
    match (it.next(), it.next()) {
        (Some(major), Some(minor)) if !major.is_empty() && !minor.is_empty() && minor.bytes().all(|c| c.is_ascii_digit()) => {
            format!("{major}.{minor}")
        }
        _ => "4.x".to_string(),
    }
}

/// Parse a 3.8.x binary skeleton, returning its skin + animation names. Returns `Err` for any
/// other version (4.x layout differs) or on a malformed/short stream.
pub(crate) fn read_skel_names(bytes: &[u8]) -> Result<SkelNames, String> {
    let mut r = Reader::new(bytes);
    r.string()?; // hash
    let version = r.string()?.unwrap_or_default();
    if !version.starts_with("3.8") {
        return Err(format!("unsupported binary skeleton version {version} (only 3.8.x)"));
    }
    r.skip(16)?; // x, y, width, height
    let nonessential = r.boolean()?;
    if nonessential {
        r.f32()?; // fps
        r.string()?; // images path
        r.string()?; // audio path
    }

    // String table.
    let string_count = r.count()?;
    let mut strings = Vec::with_capacity(string_count);
    for _ in 0..string_count {
        strings.push(r.string()?);
    }

    // Bones.
    let bone_count = r.count()?;
    for i in 0..bone_count {
        r.string()?; // name
        if i != 0 {
            r.varint(true)?; // parent
        }
        r.skip(8 * 4)?; // 8 transform floats
        r.varint(true)?; // transform mode
        r.boolean()?; // skinRequired
        if nonessential {
            r.int32()?; // color
        }
    }

    // Slots.
    let slot_count = r.count()?;
    for _ in 0..slot_count {
        r.string()?; // name
        r.varint(true)?; // bone
        r.int32()?; // color
        r.int32()?; // dark color
        r.string_ref(&strings)?; // attachment
        r.varint(true)?; // blend mode
    }

    // IK constraints.
    for _ in 0..r.count()? {
        r.string()?; // name
        r.varint(true)?; // order
        r.boolean()?; // skinRequired
        for _ in 0..r.count()? {
            r.varint(true)?; // bones
        }
        r.varint(true)?; // target
        r.skip(8)?; // mix, softness
        r.byte()?; // bendDirection
        r.boolean()?; // compress
        r.boolean()?; // stretch
        r.boolean()?; // uniform
    }

    // Transform constraints.
    for _ in 0..r.count()? {
        r.string()?; // name
        r.varint(true)?; // order
        r.boolean()?; // skinRequired
        for _ in 0..r.count()? {
            r.varint(true)?; // bones
        }
        r.varint(true)?; // target
        r.boolean()?; // local
        r.boolean()?; // relative
        r.skip(10 * 4)?; // 6 offset + 4 mix floats
    }

    // Path constraints.
    for _ in 0..r.count()? {
        r.string()?; // name
        r.varint(true)?; // order
        r.boolean()?; // skinRequired
        for _ in 0..r.count()? {
            r.varint(true)?; // bones
        }
        r.varint(true)?; // target
        r.varint(true)?; // position mode
        r.varint(true)?; // spacing mode
        r.varint(true)?; // rotate mode
        r.skip(5 * 4)?; // 5 floats
    }

    // Skins.
    let mut skins: Vec<String> = Vec::new();
    if let Some(name) = read_skin(&mut r, &strings, true, nonessential)? {
        skins.push(name);
    }
    for _ in 0..r.count()? {
        if let Some(name) = read_skin(&mut r, &strings, false, nonessential)? {
            skins.push(name);
        }
    }

    // Events (capture which carry audio, needed to size their animation timeline frames).
    let event_count = r.count()?;
    let mut event_has_audio = Vec::with_capacity(event_count);
    for _ in 0..event_count {
        r.string_ref(&strings)?; // name
        r.varint(false)?; // int
        r.f32()?; // float
        r.string()?; // string
        let audio = r.string()?; // audio path
        let has_audio = audio.is_some();
        if has_audio {
            r.skip(8)?; // volume, balance
        }
        event_has_audio.push(has_audio);
    }

    // Animations.
    let anim_count = r.count()?;
    let mut animations = Vec::with_capacity(anim_count);
    for _ in 0..anim_count {
        if let Some(name) = r.string()? {
            animations.push(name);
        }
        read_animation(&mut r, &strings, &event_has_audio)?;
    }

    Ok(SkelNames { animations, skins })
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Spine string encoding: 0 → null, 1 → "", else varint(len+1) then UTF-8 bytes.
    fn enc_string(s: &str) -> Vec<u8> {
        let mut out = vec![(s.len() + 1) as u8]; // small strings fit one varint byte
        out.extend_from_slice(s.as_bytes());
        out
    }

    fn header(version: &str) -> Vec<u8> {
        let mut b = vec![0x01]; // hash = "" (byteCount 1)
        b.extend(enc_string(version));
        b
    }

    #[test]
    fn rejects_non_3_8_version() {
        let mut data = header("4.0.00");
        data.extend([0u8; 17]); // x,y,w,h + nonessential — never reached, but harmless
        let err = read_skel_names(&data).unwrap_err();
        assert!(err.contains("unsupported"), "got: {err}");
    }

    #[test]
    fn version_family_from_header_only() {
        // A 3.8 header is enough to pick the runtime, even when the body can't be fully parsed
        // (truncated here) — the old "full parse must succeed" rule would have mislabeled this 4.x.
        let data = header("3.8.99");
        assert_eq!(read_skel_version_family(&data), "3.8");
        // Non-3.8 version string → 4.x family.
        let data = header("4.1.23");
        assert_eq!(read_skel_version_family(&data), "4.x");
        // Garbage/short blob → 4.x (safe default).
        assert_eq!(read_skel_version_family(b"\x00xyz"), "4.x");
    }

    #[test]
    fn version_family_4x_minor_from_real_header() {
        // A real 4.x header stores an 8-byte hash (not a string) before the version, so the
        // exact minor must be recovered to pick the matching runtime (4.2 ≠ 4.3 format).
        let mut data = vec![0u8; 8]; // 8-byte hash (lowHash + highHash)
        data.extend(enc_string("4.2.43"));
        assert_eq!(read_skel_version_family(&data), "4.2");
    }

    #[test]
    fn errors_on_truncated_stream() {
        // Valid 3.8 version but nothing after → short read while parsing the body.
        let data = header("3.8.99");
        assert!(read_skel_names(&data).is_err());
    }

    #[test]
    fn zigzag_varint_roundtrip() {
        // optimize_positive=false is zigzag; byte count is identical either way, but verify the
        // decoded value matches the Spine formula for a couple of encodings.
        let mut r = Reader::new(&[0x02]); // zigzag(2) = 1
        assert_eq!(r.varint(false).unwrap(), 1);
        let mut r = Reader::new(&[0x01]); // zigzag(1) = -1 → 0xFFFFFFFF as u32
        assert_eq!(r.varint(false).unwrap(), u32::MAX);
    }

    /// Opt-in end-to-end check against a real binary export. Validates the parser consumes the
    /// whole stream and returns non-empty names. Run with:
    ///   SPINE_SKEL_FIXTURE=/path/to/file.skel.bytes cargo test -- --ignored
    #[test]
    #[ignore]
    fn fixture_real_skel() {
        let path = std::env::var("SPINE_SKEL_FIXTURE").expect("set SPINE_SKEL_FIXTURE");
        let data = std::fs::read(&path).expect("read fixture");
        let names = read_skel_names(&data).expect("parse 3.8 skel");
        assert!(!names.animations.is_empty(), "expected some animations");
        assert!(!names.skins.is_empty(), "expected some skins");
        eprintln!("skins={:?}\nanims={:?}", names.skins, names.animations);
    }
}
