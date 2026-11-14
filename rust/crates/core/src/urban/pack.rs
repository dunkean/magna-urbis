//! Shared writer of the binary city formats (`magna-city-display`,
//! `magna-city-sites`, `magna-city-parcels`).
//!
//! Layout of a blob (little endian): `u32 header_len | header JSON (space-padded)
//! | sections…`, each section named in `header.sections` with its byte offset
//! (from the end of the header), element type and length in elements. The
//! display formats pad to 4 bytes; the parcel pack pads to 8 so that f64
//! sections can be viewed in place (`Float64Array`).
use super::{Point, Shape};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap};

/// String table: stable small codes, index 0 = "". Saturates at `u16::MAX`
/// (display formats only).
#[derive(Default)]
pub(super) struct Table {
    codes: BTreeMap<String, u16>,
    pub(super) names: Vec<String>,
}
impl Table {
    pub(super) fn code(&mut self, name: &str) -> u16 {
        if self.names.is_empty() {
            self.names.push(String::new());
            self.codes.insert(String::new(), 0);
        }
        if let Some(&c) = self.codes.get(name) {
            return c;
        }
        let c = self.names.len().min(u16::MAX as usize) as u16;
        self.codes.insert(name.to_string(), c);
        self.names.push(name.to_string());
        c
    }
}

/// String table with u32 codes by first appearance, index 0 = "": never
/// aliases, fails past `u32::MAX` names. Borrows its strings.
pub(super) struct Codes<'a> {
    codes: HashMap<&'a str, u32>,
    pub(super) names: Vec<&'a str>,
}
impl<'a> Codes<'a> {
    pub(super) fn new() -> Self {
        Self { codes: HashMap::from([("", 0u32)]), names: vec![""] }
    }
    pub(super) fn code(&mut self, name: &'a str) -> Result<u32, String> {
        if let Some(&c) = self.codes.get(name) {
            return Ok(c);
        }
        let c = u32::try_from(self.names.len()).map_err(|_| "string table exceeds u32 codes".to_string())?;
        self.codes.insert(name, c);
        self.names.push(name);
        Ok(c)
    }
}

/// Display polygons: f32 coordinates relative to an origin.
#[derive(Default)]
pub(super) struct Polygons {
    polys: Vec<u32>,
    rings: Vec<u32>,
    coords: Vec<f32>,
}
impl Polygons {
    pub(super) fn push(&mut self, shape: &Shape, origin: Point) {
        if self.polys.is_empty() {
            self.polys.push(0);
            self.rings.push(0);
        }
        for ring in std::iter::once(&shape.outer).chain(shape.holes.iter()) {
            for p in ring {
                self.coords.push((p.x - origin.x) as f32);
                self.coords.push((p.y - origin.y) as f32);
            }
            self.rings.push((self.coords.len() / 2) as u32);
        }
        self.polys.push((self.rings.len() - 1) as u32);
    }
}

/// Strings as one UTF-8 text plus n+1 UTF-16 offsets: the reader decodes the
/// text once and slices it, without one decoder call per string.
#[derive(Default)]
pub(super) struct Strings {
    pub(super) offsets: Vec<u32>,
    pub(super) text: String,
    units: u32,
}
impl Strings {
    pub(super) fn push(&mut self, s: &str) {
        if self.offsets.is_empty() {
            self.offsets.push(0);
        }
        self.text.push_str(s);
        self.units += s.encode_utf16().count() as u32;
        self.offsets.push(self.units);
    }
    /// `push` with an error instead of a wrapped offset past `u32::MAX` units.
    pub(super) fn try_push(&mut self, s: &str) -> Result<(), String> {
        let units = u32::try_from(s.encode_utf16().count())
            .ok()
            .and_then(|n| self.units.checked_add(n))
            .ok_or_else(|| "string offsets exceed u32".to_string())?;
        if self.offsets.is_empty() {
            self.offsets.push(0);
        }
        self.text.push_str(s);
        self.units = units;
        self.offsets.push(units);
        Ok(())
    }
    /// Writes `<name>.offsets` (at least `[0]`) and `<name>.text`.
    pub(super) fn write(self, w: &mut Writer, name: &str) {
        let offsets = if self.offsets.is_empty() { vec![0] } else { self.offsets };
        w.u32s(&format!("{name}.offsets"), &offsets);
        w.u8_owned(&format!("{name}.text"), self.text.into_bytes());
    }
}

/// Collects `(name, type, bytes, length)` sections, then writes the blob.
pub(super) struct Writer {
    sections: Vec<(String, &'static str, Vec<u8>, usize)>,
    align: usize,
}
impl Default for Writer {
    /// 4-byte padding: the display formats.
    fn default() -> Self {
        Self { sections: Vec::new(), align: 4 }
    }
}
impl Writer {
    /// 8-byte padding of the header end and of every section (f64 views).
    pub(super) fn aligned8() -> Self {
        Self { sections: Vec::new(), align: 8 }
    }
    pub(super) fn u32s(&mut self, name: &str, v: &[u32]) {
        self.sections.push((
            name.into(),
            "u32",
            v.iter().flat_map(|x| x.to_le_bytes()).collect(),
            v.len(),
        ));
    }
    pub(super) fn u16s(&mut self, name: &str, v: &[u16]) {
        self.sections.push((
            name.into(),
            "u16",
            v.iter().flat_map(|x| x.to_le_bytes()).collect(),
            v.len(),
        ));
    }
    pub(super) fn u8s(&mut self, name: &str, v: &[u8]) {
        self.sections.push((name.into(), "u8", v.to_vec(), v.len()));
    }
    pub(super) fn u8_owned(&mut self, name: &str, v: Vec<u8>) {
        let len = v.len();
        self.sections.push((name.into(), "u8", v, len));
    }
    pub(super) fn f32s(&mut self, name: &str, v: &[f32]) {
        self.sections.push((
            name.into(),
            "f32",
            v.iter().flat_map(|x| x.to_le_bytes()).collect(),
            v.len(),
        ));
    }
    pub(super) fn f64s(&mut self, name: &str, v: &[f64]) {
        self.sections.push((
            name.into(),
            "f64",
            v.iter().flat_map(|x| x.to_le_bytes()).collect(),
            v.len(),
        ));
    }
    pub(super) fn polygons(&mut self, layer: &str, p: &Polygons) {
        self.u32s(&format!("{layer}.polys"), &p.polys);
        self.u32s(&format!("{layer}.rings"), &p.rings);
        self.f32s(&format!("{layer}.coords"), &p.coords);
    }
    pub(super) fn finish(self, header: Value) -> Vec<u8> {
        self.try_finish(header, None).unwrap_or_default()
    }
    /// Writes the blob. `raw` = `(key, json)` appends a member whose value is
    /// already serialised JSON text (kept in its own key order) to the header.
    pub(super) fn try_finish(self, mut header: Value, raw: Option<(&str, &[u8])>) -> Result<Vec<u8>, String> {
        let align = self.align;
        let mut offset = 0usize;
        let mut sections = serde_json::Map::new();
        for (name, kind, bytes, len) in &self.sections {
            sections.insert(
                name.clone(),
                json!({"offset": offset, "type": kind, "length": len}),
            );
            offset += bytes.len().div_ceil(align) * align;
        }
        header["sections"] = Value::Object(sections);
        let mut head = serde_json::to_vec(&header).map_err(|e| e.to_string())?;
        if let Some((key, text)) = raw {
            if head.pop() != Some(b'}') {
                return Err("blob header is not a JSON object".into());
            }
            if head.last() != Some(&b'{') {
                head.push(b',');
            }
            head.extend_from_slice(&serde_json::to_vec(key).map_err(|e| e.to_string())?);
            head.push(b':');
            head.extend_from_slice(text);
            head.push(b'}');
        }
        // Header end at a multiple of `align` from the start of the blob.
        let pad = (align - (4 + head.len()) % align) % align;
        head.resize(head.len() + pad, b' ');
        let head_len = u32::try_from(head.len()).map_err(|_| "blob header exceeds u32 bytes".to_string())?;
        let mut out = Vec::with_capacity(4 + head.len() + offset);
        out.extend_from_slice(&head_len.to_le_bytes());
        out.extend_from_slice(&head);
        for (_, _, bytes, _) in self.sections {
            let padded = bytes.len().div_ceil(align) * align;
            out.extend_from_slice(&bytes);
            out.resize(out.len() + padded - bytes.len(), 0);
        }
        Ok(out)
    }
}
