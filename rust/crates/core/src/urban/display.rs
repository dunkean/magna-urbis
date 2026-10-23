//! Compact display buffers of a city plan, for drawing (Canvas / WebGL) without
//! shipping the full JSON partitions. Geometry is f32 relative to an origin
//! (sub-millimetre at city scale), attributes are small codes into string tables.
//! Authoritative geometry stays in the layouts and partitions: this is a
//! projection for display only, never read back as cadastral truth.
//!
//! Layout of the blob (little endian):
//! `u32 header_len | header JSON (space-padded to 4) | sections…`, each section
//! named in `header.sections` with its byte offset, element type and length.
//! Polygon layers use `polys` (n+1 ring starts), `rings` (r+1 coordinate starts,
//! in points) and `coords` (x, y pairs); polylines use `lines` (n+1 point starts).
use super::{Layout, Partition, Point, Shape};
use serde_json::{Value, json};
use std::collections::BTreeMap;

/// String table: stable small codes, index 0 = "".
#[derive(Default)]
struct Table {
    codes: BTreeMap<String, u16>,
    names: Vec<String>,
}
impl Table {
    fn code(&mut self, name: &str) -> u16 {
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

#[derive(Default)]
struct Polygons {
    polys: Vec<u32>,
    rings: Vec<u32>,
    coords: Vec<f32>,
}
impl Polygons {
    fn push(&mut self, shape: &Shape, origin: Point) {
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

#[derive(Default)]
struct Writer {
    sections: Vec<(String, &'static str, Vec<u8>, usize)>,
}
impl Writer {
    fn u32s(&mut self, name: &str, v: &[u32]) {
        self.sections.push((
            name.into(),
            "u32",
            v.iter().flat_map(|x| x.to_le_bytes()).collect(),
            v.len(),
        ));
    }
    fn u16s(&mut self, name: &str, v: &[u16]) {
        self.sections.push((
            name.into(),
            "u16",
            v.iter().flat_map(|x| x.to_le_bytes()).collect(),
            v.len(),
        ));
    }
    fn u8s(&mut self, name: &str, v: &[u8]) {
        self.sections.push((name.into(), "u8", v.to_vec(), v.len()));
    }
    fn f32s(&mut self, name: &str, v: &[f32]) {
        self.sections.push((
            name.into(),
            "f32",
            v.iter().flat_map(|x| x.to_le_bytes()).collect(),
            v.len(),
        ));
    }
    fn polygons(&mut self, layer: &str, p: &Polygons) {
        self.u32s(&format!("{layer}.polys"), &p.polys);
        self.u32s(&format!("{layer}.rings"), &p.rings);
        self.f32s(&format!("{layer}.coords"), &p.coords);
    }
    fn finish(self, mut header: Value) -> Vec<u8> {
        let mut offset = 0usize;
        let mut sections = serde_json::Map::new();
        for (name, kind, bytes, len) in &self.sections {
            sections.insert(
                name.clone(),
                json!({"offset": offset, "type": kind, "length": len}),
            );
            offset += bytes.len().div_ceil(4) * 4;
        }
        header["sections"] = Value::Object(sections);
        let mut head = serde_json::to_vec(&header).unwrap_or_default();
        head.resize(head.len().div_ceil(4) * 4, b' ');
        let mut out = Vec::with_capacity(4 + head.len() + offset);
        out.extend_from_slice(&(head.len() as u32).to_le_bytes());
        out.extend_from_slice(&head);
        for (_, _, bytes, _) in self.sections {
            let padded = bytes.len().div_ceil(4) * 4;
            out.extend_from_slice(&bytes);
            out.resize(out.len() + padded - bytes.len(), 0);
        }
        out
    }
}

/// Display projection of the selected layouts and their partitions. `ids` adds
/// the parcel id table (needed only by an inspector that maps back to JSON).
pub fn display_buffers(layouts: &[Layout], partitions: &[Partition], ids: bool) -> Vec<u8> {
    let layouts: Vec<&Layout> = layouts.iter().collect();
    let partitions: Vec<&Partition> = partitions.iter().collect();
    display_buffers_refs(&layouts, &partitions, ids)
}

/// Same projection over borrowed plans (a native session selecting layout keys
/// without cloning geometry).
pub fn display_buffers_refs(layouts: &[&Layout], partitions: &[&Partition], ids: bool) -> Vec<u8> {
    let origin = layouts
        .first()
        .map_or(Point { x: 0.0, y: 0.0 }, |l| l.center);
    let mut tables: BTreeMap<&str, Table> = BTreeMap::new();
    let (mut blocks, mut parcels, mut quarters) = (
        Polygons::default(),
        Polygons::default(),
        Polygons::default(),
    );
    let (mut block_zone, mut block_kind, mut block_quarter, mut block_role, mut block_wealth) =
        (vec![], vec![], vec![], vec![], vec![]);
    let (
        mut parcel_block,
        mut parcel_use,
        mut parcel_role,
        mut parcel_landmark,
        mut parcel_households,
    ) = (vec![], vec![], vec![], vec![], vec![]);
    let mut parcel_ids = vec![];
    let (mut lines, mut line_coords, mut line_width, mut line_rank, mut line_role) =
        (vec![0u32], vec![], vec![], vec![], vec![]);
    let mut block_base = 0u32;
    let mut layout_blocks = vec![];
    for layout in layouts {
        let districts = layout
            .structure
            .as_ref()
            .map(|s| s.districts.as_slice())
            .unwrap_or(&[]);
        let quarter_district: BTreeMap<usize, usize> = districts
            .iter()
            .enumerate()
            .flat_map(|(i, d)| d.quarters.iter().map(move |&q| (q, i)))
            .collect();
        for q in &layout.quarters {
            quarters.push(&q.shape, origin);
        }
        for b in &layout.blocks {
            blocks.push(&b.shape, origin);
            block_zone.push(tables.entry("zone").or_default().code(&b.zone));
            block_kind.push(tables.entry("blockKind").or_default().code(&b.kind));
            block_quarter.push(b.quarter as u32);
            let district = quarter_district
                .get(&b.quarter)
                .and_then(|&i| districts.get(i));
            block_role.push(
                tables
                    .entry("districtRole")
                    .or_default()
                    .code(district.map_or("", |d| d.role.as_str())),
            );
            block_wealth
                .push(district.map_or(128, |d| (d.wealth.clamp(0.0, 1.0) * 255.0).round() as u8));
        }
        for s in &layout.streets {
            for p in &s.path {
                line_coords.push((p.x - origin.x) as f32);
                line_coords.push((p.y - origin.y) as f32);
            }
            lines.push((line_coords.len() / 2) as u32);
            line_width.push(s.widths.iter().copied().fold(0.0, f64::max) as f32);
            line_rank.push(s.rank.min(255) as u8);
            line_role.push(tables.entry("streetRole").or_default().code(&s.role));
        }
        layout_blocks.push((layout.key.clone(), block_base));
        block_base += layout.blocks.len() as u32;
    }
    for partition in partitions {
        let base = layout_blocks
            .iter()
            .find(|(k, _)| *k == partition.key)
            .map_or(0, |&(_, b)| b);
        let allocations: BTreeMap<&str, &super::programme::Allocation> = partition
            .programme
            .as_ref()
            .map(|p| {
                p.allocations
                    .iter()
                    .map(|a| (a.parcel_id.as_str(), a))
                    .collect()
            })
            .unwrap_or_default();
        for p in &partition.parcels {
            parcels.push(&p.shape, origin);
            parcel_block.push(base + p.block as u32);
            parcel_use.push(tables.entry("use").or_default().code(&p.use_kind));
            let a = allocations.get(p.id.as_str());
            parcel_role.push(
                tables
                    .entry("role")
                    .or_default()
                    .code(a.map_or("", |a| a.role.as_str())),
            );
            parcel_landmark.push(u8::from(a.is_some_and(|a| a.landmark)));
            parcel_households.push(a.map_or(0.0, |a| a.households) as f32);
            if ids {
                parcel_ids.push(p.id.clone());
            }
        }
    }
    let mut w = Writer::default();
    w.polygons("quarters", &quarters);
    w.polygons("blocks", &blocks);
    w.u16s("blocks.zone", &block_zone);
    w.u16s("blocks.kind", &block_kind);
    w.u32s("blocks.quarter", &block_quarter);
    w.u16s("blocks.districtRole", &block_role);
    w.u8s("blocks.wealth", &block_wealth);
    w.polygons("parcels", &parcels);
    w.u32s("parcels.block", &parcel_block);
    w.u16s("parcels.use", &parcel_use);
    w.u16s("parcels.role", &parcel_role);
    w.u8s("parcels.landmark", &parcel_landmark);
    w.f32s("parcels.households", &parcel_households);
    w.u32s("streets.lines", &lines);
    w.f32s("streets.coords", &line_coords);
    w.f32s("streets.width", &line_width);
    w.u8s("streets.rank", &line_rank);
    w.u16s("streets.role", &line_role);
    let tables: serde_json::Map<String, Value> = tables
        .into_iter()
        .map(|(k, t)| (k.to_string(), json!(t.names)))
        .collect();
    w.finish(json!({
        "format": "magna-city-display", "version": 1,
        "origin": {"x": origin.x, "y": origin.y},
        "layouts": layout_blocks.iter().map(|(k, b)| json!({"key": k, "blockBase": b})).collect::<Vec<_>>(),
        "tables": tables,
        "parcelIds": if ids { json!(parcel_ids) } else { Value::Null },
    }))
}

#[cfg(test)]
mod tests {
    use super::super::{Block, Layout, Parcel, Partition, Quarter, Shape, Street};
    use super::*;

    fn square(x: f64, y: f64, s: f64) -> Shape {
        Shape {
            outer: vec![
                Point { x, y },
                Point { x: x + s, y },
                Point { x: x + s, y: y + s },
                Point { x, y: y + s },
            ],
            holes: vec![],
        }
    }

    #[test]
    fn display_buffers_round_trip_geometry_and_codes() {
        let block = Block {
            shape: square(100.0, 100.0, 40.0),
            quarter: 0,
            kind: "block".into(),
            axis: Point { x: 1.0, y: 0.0 },
            zone: "core".into(),
            phase: None,
        };
        let mut with_hole = square(100.0, 100.0, 20.0);
        with_hole.holes.push(vec![
            Point { x: 105.0, y: 105.0 },
            Point { x: 108.0, y: 105.0 },
            Point { x: 108.0, y: 108.0 },
        ]);
        let layout: Layout = serde_json::from_value(json!({
            "key": "city", "culture": "european-organic", "center": {"x": 100.0, "y": 100.0},
            "quarters": [], "streets": [], "blocks": [], "warnings": []
        }))
        .unwrap();
        let mut layout = layout;
        layout.quarters.push(Quarter {
            shape: square(90.0, 90.0, 60.0),
            phase: 0,
            zone: "core".into(),
        });
        layout.blocks.push(block);
        layout.streets.push(Street {
            path: vec![Point { x: 90.0, y: 95.0 }, Point { x: 150.0, y: 95.0 }],
            widths: vec![6.0, 6.0],
            rank: 1,
            role: "market".into(),
        });
        let parcel: Parcel = serde_json::from_value(json!({
            "id": "p1", "shape": with_hole, "block": 0, "use": "plot", "front": null, "axis": {"x": 1.0, "y": 0.0}, "rank": 1
        }))
        .unwrap();
        let partition = Partition {
            config: None,
            programme: None,
            key: "city".into(),
            parcels: vec![parcel],
            warnings: vec![],
            diagnostics: None,
        };
        let blob = display_buffers(&[layout], &[partition], true);
        let head = u32::from_le_bytes(blob[0..4].try_into().unwrap()) as usize;
        let header: Value = serde_json::from_slice(&blob[4..4 + head]).unwrap();
        let body = &blob[4 + head..];
        let read_f32 = |name: &str| -> Vec<f32> {
            let s = &header["sections"][name];
            let (o, n) = (
                s["offset"].as_u64().unwrap() as usize,
                s["length"].as_u64().unwrap() as usize,
            );
            body[o..o + 4 * n]
                .chunks(4)
                .map(|c| f32::from_le_bytes(c.try_into().unwrap()))
                .collect()
        };
        let read_u32 = |name: &str| -> Vec<u32> {
            let s = &header["sections"][name];
            let (o, n) = (
                s["offset"].as_u64().unwrap() as usize,
                s["length"].as_u64().unwrap() as usize,
            );
            body[o..o + 4 * n]
                .chunks(4)
                .map(|c| u32::from_le_bytes(c.try_into().unwrap()))
                .collect()
        };
        // Parcel: one polygon, outer ring of 4 points then a 3-point hole, relative to the centre.
        assert_eq!(read_u32("parcels.polys"), vec![0, 2]);
        assert_eq!(read_u32("parcels.rings"), vec![0, 4, 7]);
        let coords = read_f32("parcels.coords");
        assert_eq!(coords[..2], [0.0, 0.0]);
        assert_eq!(coords[8..10], [5.0, 5.0]);
        assert_eq!(read_u32("streets.lines"), vec![0, 2]);
        assert_eq!(header["tables"]["streetRole"][1], "market");
        assert_eq!(header["parcelIds"][0], "p1");
        assert_eq!(blob.len() % 4, 0);
    }
}
