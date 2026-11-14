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
use super::pack::{Polygons, Strings, Table, Writer};
use super::{Layout, Partition, Point};
use serde_json::{Value, json};
use std::collections::BTreeMap;

/// Retained terrain knows the physical water levels separately from its bed.
/// Direct core callers keep the bank-height fallback produced by the planner.
pub fn quay_water_levels(layouts: &mut [Layout], width: f64, n: usize, water: &[u8], levels: &[f32]) {
    if n == 0 || water.len() != n * n || levels.len() != n * n { return; }
    let cell = width / n as f64;
    let level_at = |p: Point| {
        let x = (p.x / cell).floor().clamp(0.0, (n - 1) as f64) as usize;
        let y = (p.y / cell).floor().clamp(0.0, (n - 1) as f64) as usize;
        let mut best = (f64::INFINITY, None);
        for j in y.saturating_sub(2)..=(y + 2).min(n - 1) { for i in x.saturating_sub(2)..=(x + 2).min(n - 1) {
            let k = j * n + i;
            if water[k] == 0 || !levels[k].is_finite() { continue; }
            let d = (p.x - (i as f64 + 0.5) * cell).hypot(p.y - (j as f64 + 0.5) * cell);
            if d < best.0 { best = (d, Some(levels[k] as f64)); }
        } }
        best.1
    };
    for structure in layouts.iter_mut().filter_map(|l| l.structure.as_mut()) {
        let mut quays = vec![];
        for q in std::mem::take(&mut structure.quays) {
            let (lo, hi) = q.shape.outer.iter().filter_map(|&p| level_at(p))
                .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), z| (lo.min(z), hi.max(z)));
            let shapes = if hi - lo > 0.8 {
                let (x0, y0, x1, y1) = super::geometry::bbox(&q.shape);
                let horizontal = x1 - x0 > y1 - y0;
                let (mut at, end) = if horizontal { (x0, x1) } else { (y0, y1) };
                let mut shapes = vec![];
                while at < end {
                    let next = (at + 40.0).min(end);
                    let tile = if horizontal { super::geometry::rectangle(at, y0 - 1.0, next, y1 + 1.0) }
                        else { super::geometry::rectangle(x0 - 1.0, at, x1 + 1.0, next) };
                    shapes.extend(super::geometry::intersection(&q.shape, &tile)); at = next;
                }
                shapes
            } else { vec![q.shape.clone()] };
            for shape in shapes {
                let level = shape.outer.iter().filter_map(|&p| level_at(p)).reduce(f64::min);
                let mut part = q.clone(); part.shape = shape;
                if let Some(level) = level { part.deck_z_m = level + 1.0; }
                quays.push(part);
            }
        }
        structure.quays = quays;
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
    let mut quays = Polygons::default();
    let (mut quay_kind, mut quay_material, mut quay_deck) = (vec![], vec![], vec![]);
    let mut parcel_ids = vec![];
    let (mut lines, mut line_coords, mut line_width, mut line_rank, mut line_role) =
        (vec![0u32], vec![], vec![], vec![], vec![]);
    let mut block_base = 0u32;
    let mut layout_blocks = vec![];
    for layout in layouts {
        for q in layout.structure.iter().flat_map(|s| &s.quays) {
            quays.push(&q.shape, origin);
            quay_kind.push(tables.entry("quayKind").or_default().code(&q.kind));
            quay_material.push(tables.entry("quayMaterial").or_default().code(&q.material));
            quay_deck.push(q.deck_z_m as f32);
        }
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
    w.polygons("quays", &quays);
    w.u16s("quays.kind", &quay_kind);
    w.u16s("quays.material", &quay_material);
    w.f32s("quays.deckZ", &quay_deck);
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

/// One building-site request reduced to what the display blob keeps. Built
/// where the request is generated (any thread), so the request tree is dropped
/// at once and only this flat record travels to the accumulator.
pub struct SiteRow {
    function: String,
    culture: String,
    preview: bool,
    ground: f32,
    entrance: [f32; 2],
    id: String,
    parcel_id: String,
    access_id: String,
    /// Surface points (x, y relative to the origin) of all rings in order.
    coords: Vec<f32>,
    /// Point count of each ring, outer ring of a piece first.
    ring_lens: Vec<u32>,
    /// Ring count of each piece.
    piece_rings: Vec<u32>,
    /// Lot programme as JSON (`null` when the request has none).
    programme: Vec<u8>,
}
/// Programme fields that no display reads: the housing-need evidence is about a
/// third of each programme and stays in the complete request (read by id).
const NOT_DISPLAYED: &[&str] = &["housing_floor_need"];
/// A lot programme serialised without `NOT_DISPLAYED`, other keys in their order.
struct DisplayProgramme<'a>(&'a serde_json::Map<String, Value>);
impl serde::Serialize for DisplayProgramme<'_> {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        let mut map = s.serialize_map(None)?;
        for (k, v) in self.0.iter().filter(|(k, _)| !NOT_DISPLAYED.contains(&k.as_str())) {
            map.serialize_entry(k, v)?;
        }
        map.end()
    }
}
impl SiteRow {
    /// `version` 1: the programme as the request carries it (`null` when absent);
    /// 2: without the fields no display reads.
    pub fn new(r: &Value, origin: Point, version: u32) -> Self {
        let has = |v: &Value| v.as_array().is_some_and(|a| !a.is_empty());
        let fun = r["function"].as_str().unwrap_or("");
        let is_preview = has(&r["preview"]);
        let surface = if is_preview {
            &r["preview"]
        } else if fun != "open_space" && has(&r["placement_hint"]) {
            &r["placement_hint"]
        } else {
            &r["buildable"]
        };
        let (mut coords, mut ring_lens, mut piece_rings) = (Vec::new(), Vec::new(), Vec::new());
        fn ring(coords: &mut Vec<f32>, ring_lens: &mut Vec<u32>, ring: &Value, origin: Point) {
            let mut points = 0u32;
            for q in ring.as_array().map(Vec::as_slice).unwrap_or(&[]) {
                coords.push((q["x"].as_f64().unwrap_or(0.0) - origin.x) as f32);
                coords.push((q["y"].as_f64().unwrap_or(0.0) - origin.y) as f32);
                points += 1;
            }
            ring_lens.push(points);
        }
        for piece in surface.as_array().map(Vec::as_slice).unwrap_or(&[]) {
            let before = ring_lens.len();
            ring(&mut coords, &mut ring_lens, &piece["outer"], origin);
            for hole in piece["holes"].as_array().map(Vec::as_slice).unwrap_or(&[]) {
                ring(&mut coords, &mut ring_lens, hole, origin);
            }
            piece_rings.push((ring_lens.len() - before) as u32);
        }
        let access = &r["accesses"][0];
        let (ex, ey) = if access.is_object() {
            let s = &access["segment"];
            let c = |k: &str| (s[0][k].as_f64().unwrap_or(0.0) + s[1][k].as_f64().unwrap_or(0.0)) / 2.0;
            (c("x"), c("y"))
        } else {
            let first = &surface[0]["outer"][0];
            (first["x"].as_f64().unwrap_or(0.0), first["y"].as_f64().unwrap_or(0.0))
        };
        let mut programme = Vec::new();
        match &r["programme"] {
            Value::Object(map) if version >= 2 => {
                let _ = serde_json::to_writer(&mut programme, &DisplayProgramme(map));
            }
            Value::Object(_) => {
                let _ = serde_json::to_writer(&mut programme, &r["programme"]);
            }
            _ => programme.extend_from_slice(b"null"),
        }
        Self {
            function: fun.to_owned(),
            culture: r["culture"].to_string(),
            preview: is_preview,
            ground: r["terrain"]["ground_z_m"].as_f64().unwrap_or(0.0) as f32,
            entrance: [(ex - origin.x) as f32, (ey - origin.y) as f32],
            id: r["id"].as_str().unwrap_or("").to_owned(),
            parcel_id: r["parcel_id"].as_str().unwrap_or("").to_owned(),
            access_id: access["id"].as_str().unwrap_or("").to_owned(),
            coords,
            ring_lens,
            piece_rings,
            programme,
        }
    }
}

/// Accumulates `SiteRow`s in site order into the columns of the display blob.
/// Surfaces: `sites` (n+1 piece starts), `pieces` (p+1 ring starts, outer ring
/// first), `rings` (r+1 point starts) and `coords` (x, y relative to the origin).
pub struct SiteDisplay {
    origin: Point,
    count: usize,
    tables: BTreeMap<&'static str, Table>,
    sites: Vec<u32>,
    pieces: Vec<u32>,
    rings: Vec<u32>,
    coords: Vec<f32>,
    function: Vec<u16>,
    culture: Vec<u16>,
    preview: Vec<u8>,
    ground: Vec<f32>,
    entrance: Vec<f32>,
    ids: Strings,
    parcel_ids: Strings,
    access_ids: Strings,
    /// Version 1: `[p0,p1,…` JSON array under construction (one record per
    /// site). Version 2: `p0,p1,…,` (each record followed by a comma).
    programmes: Vec<u8>,
    /// Version 2: n+1 byte offsets of each site's `record,` in `programmes`, so
    /// that a reader parses a run of sites at a time (no whole-town string).
    programme_offsets: Vec<u32>,
    version: u32,
}
impl SiteDisplay {
    /// `version` 1 or 2 (see `SiteRow::new` and `finish`).
    pub fn new(origin: Point, expected_sites: usize, version: u32) -> Self {
        let mut programmes = Vec::with_capacity(expected_sites.saturating_mul(1024).min(1 << 30));
        if version < 2 {
            programmes.push(b'[');
        }
        Self {
            version,
            programme_offsets: if version < 2 { Vec::new() } else { Vec::with_capacity(expected_sites + 1) },
            origin,
            count: 0,
            tables: BTreeMap::new(),
            sites: Vec::with_capacity(expected_sites + 1),
            pieces: Vec::with_capacity(expected_sites + 1),
            rings: Vec::with_capacity(expected_sites * 2 + 1),
            coords: Vec::with_capacity(expected_sites * 24),
            function: Vec::with_capacity(expected_sites),
            culture: Vec::with_capacity(expected_sites),
            preview: Vec::with_capacity(expected_sites),
            ground: Vec::with_capacity(expected_sites),
            entrance: Vec::with_capacity(expected_sites * 2),
            ids: Strings::default(),
            parcel_ids: Strings::default(),
            access_ids: Strings::default(),
            programmes,
        }
    }

    pub fn push(&mut self, row: SiteRow) {
        if self.sites.is_empty() {
            self.sites.push(0);
            self.pieces.push(0);
            self.rings.push(0);
        }
        let (mut ring_at, mut point_at) = (0usize, 0usize);
        for &rings in &row.piece_rings {
            for _ in 0..rings {
                let points = row.ring_lens[ring_at] as usize;
                ring_at += 1;
                self.coords.extend_from_slice(&row.coords[2 * point_at..2 * (point_at + points)]);
                point_at += points;
                self.rings.push((self.coords.len() / 2) as u32);
            }
            self.pieces.push((self.rings.len() - 1) as u32);
        }
        self.sites.push((self.pieces.len() - 1) as u32);
        self.function.push(self.tables.entry("function").or_default().code(&row.function));
        self.culture.push(self.tables.entry("culture").or_default().code(&row.culture));
        self.preview.push(u8::from(row.preview));
        self.ground.push(row.ground);
        self.entrance.extend_from_slice(&row.entrance);
        self.ids.push(&row.id);
        self.parcel_ids.push(&row.parcel_id);
        self.access_ids.push(&row.access_id);
        if self.version >= 2 {
            if self.programme_offsets.is_empty() {
                self.programme_offsets.push(0);
            }
            self.programmes.extend_from_slice(&row.programme);
            self.programmes.push(b',');
            // Saturates past 4 GiB of programme text; the page cannot hold such a town anyway.
            self.programme_offsets.push(u32::try_from(self.programmes.len()).unwrap_or(u32::MAX));
        } else {
            if self.count > 0 {
                self.programmes.push(b',');
            }
            self.programmes.extend_from_slice(&row.programme);
        }
        self.count += 1;
    }

    pub fn finish(mut self) -> Vec<u8> {
        let mut w = Writer::default();
        let first = |v: &[u32]| if v.is_empty() { vec![0] } else { v.to_vec() };
        w.u32s("sites.polys", &first(&self.sites));
        w.u32s("sites.pieces", &first(&self.pieces));
        w.u32s("sites.rings", &first(&self.rings));
        w.f32s("sites.coords", &self.coords);
        w.u16s("sites.function", &self.function);
        w.u16s("sites.culture", &self.culture);
        w.u8s("sites.preview", &self.preview);
        w.f32s("sites.groundZ", &self.ground);
        w.f32s("sites.entrance", &self.entrance);
        for (name, s) in [("sites.id", self.ids), ("sites.parcelId", self.parcel_ids), ("sites.accessId", self.access_ids)] {
            let offsets = if s.offsets.is_empty() { vec![0] } else { s.offsets };
            w.u32s(&format!("{name}.offsets"), &offsets);
            w.u8_owned(&format!("{name}.text"), s.text.into_bytes());
        }
        // Lot programmes (role, wealth, massing…) stay nested records. Version 1:
        // one JSON array for the whole town; version 2: `record,` per site
        // (`sites.programme.offsets`: n+1 byte offsets into `sites.programme.text`).
        if self.version >= 2 {
            let offsets = if self.programme_offsets.is_empty() { vec![0] } else { self.programme_offsets };
            w.u32s("sites.programme.offsets", &offsets);
            w.u8_owned("sites.programme.text", self.programmes);
        } else {
            self.programmes.push(b']');
            w.u8_owned("sites.programme", self.programmes);
        }
        let tables: serde_json::Map<String, Value> = self
            .tables
            .into_iter()
            .map(|(k, t)| (k.to_string(), json!(t.names)))
            .collect();
        w.finish(json!({
            "format": "magna-city-sites", "version": self.version.max(1),
            "origin": {"x": self.origin.x, "y": self.origin.y},
            "count": self.count,
            "tables": tables,
        }))
    }
}

/// Display projection of native building-site requests (the city volumes the
/// V2 draws): per site the drawn surface (city preview, else the oriented
/// admission hint, else the buildable land), function, culture, preview flag,
/// ground height, entrance, identities and lot programme. Cadastral, reserve,
/// neighbour and access geometry stay in the engine and are read by id.
/// `version` 1 or 2 (`SiteDisplay::finish`).
pub fn site_display_buffers(requests: &[Value], origin: Point, version: u32) -> Vec<u8> {
    let mut display = SiteDisplay::new(origin, requests.len(), version);
    for r in requests {
        display.push(SiteRow::new(r, origin, version));
    }
    display.finish()
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
        layout.structure = Some(super::super::UrbanStructure {
            quays: vec![super::super::macroplan::harbour::Quay { kind: "quay".into(), shape: square(90.0, 95.0, 12.0), deck_z_m: 3.0, material: "stone".into() }],
            ..Default::default()
        });
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
            enclosure: None,
        };
        quay_water_levels(std::slice::from_mut(&mut layout), 200.0, 4, &[1; 16], &[7.0; 16]);
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
        assert_eq!(read_u32("quays.polys"), vec![0, 1]);
        assert_eq!(read_f32("quays.deckZ"), vec![8.0]);
        assert_eq!(header["tables"]["quayMaterial"][1], "stone");
        assert_eq!(read_u32("streets.lines"), vec![0, 2]);
        assert_eq!(header["tables"]["streetRole"][1], "market");
        assert_eq!(header["parcelIds"][0], "p1");
        assert_eq!(blob.len() % 4, 0);
    }

    #[test]
    fn narrow_minor_bridges_are_retained_in_display_buffers() {
        let mut layout: Layout = serde_json::from_value(json!({
            "key": "bridges", "culture": "bastide", "center": {"x": 100.0, "y": 100.0},
            "quarters": [], "streets": [], "blocks": [], "warnings": []
        })).unwrap();
        for width in [1.5, 3.0, 8.0] {
            layout.streets.push(Street { path: vec![Point { x: 90.0, y: 100.0 + width }, Point { x: 120.0, y: 100.0 + width }],
                widths: vec![width; 2], rank: 4, role: "bridge".into() });
        }
        let blob = display_buffers(&[layout], &[], false);
        let head = u32::from_le_bytes(blob[..4].try_into().unwrap()) as usize;
        let header: Value = serde_json::from_slice(&blob[4..4 + head]).unwrap();
        let body = &blob[4 + head..];
        let roles = &header["sections"]["streets.role"];
        let offset = roles["offset"].as_u64().unwrap() as usize;
        assert_eq!(roles["length"], 3);
        for bytes in body[offset..offset + 6].chunks_exact(2) {
            let code = u16::from_le_bytes(bytes.try_into().unwrap()) as usize;
            assert_eq!(header["tables"]["streetRole"][code], "bridge");
        }
        assert_eq!(header["sections"]["streets.width"]["length"], 3);
    }

    #[test]
    fn site_display_buffers_keep_drawn_surface_identity_and_programme() {
        let sq = |x: f64| json!([{"outer": [{"x": x, "y": 0.0}, {"x": x + 4.0, "y": 0.0}, {"x": x + 4.0, "y": 4.0}], "holes": []}]);
        let requests = vec![
            json!({"id": "s1", "parcel_id": "p1", "function": "domestic", "culture": {"culture": "c", "pack": "p", "mode": "m", "borrowing": null},
                "preview": sq(10.0), "buildable": sq(50.0), "terrain": {"ground_z_m": 12.5},
                "accesses": [{"id": "a1", "segment": [{"x": 10.0, "y": 0.0}, {"x": 14.0, "y": 0.0}]}], "programme": {"role": "house", "households": 2.0}}),
            json!({"id": "s2é", "parcel_id": "p2", "function": "open_space", "culture": {"culture": "c", "pack": "p", "mode": "m", "borrowing": null},
                "placement_hint": sq(30.0), "buildable": sq(60.0), "terrain": {"ground_z_m": 3.0}, "accesses": [], "programme": null}),
        ];
        let blob = site_display_buffers(&requests, Point { x: 10.0, y: 0.0 }, 1);
        let head = u32::from_le_bytes(blob[..4].try_into().unwrap()) as usize;
        let header: Value = serde_json::from_slice(&blob[4..4 + head]).unwrap();
        let body = &blob[4 + head..];
        let bytes = |name: &str| {
            let s = &header["sections"][name];
            let (o, n) = (s["offset"].as_u64().unwrap() as usize, s["length"].as_u64().unwrap() as usize);
            let size = match s["type"].as_str().unwrap() { "u8" => 1, "u16" => 2, _ => 4 };
            body[o..o + n * size].to_vec()
        };
        let f32s = |name: &str| bytes(name).chunks_exact(4).map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect::<Vec<_>>();
        assert_eq!(header["count"], 2);
        // Preview wins for the first site; the open space keeps its buildable land, not the hint.
        assert_eq!(f32s("sites.coords")[..2], [0.0, 0.0]);
        assert_eq!(f32s("sites.coords")[6..8], [50.0, 0.0]);
        assert_eq!(bytes("sites.preview"), vec![1, 0]);
        assert_eq!(f32s("sites.groundZ"), vec![12.5, 3.0]);
        assert_eq!(f32s("sites.entrance")[..2], [2.0, 0.0]);
        assert_eq!(String::from_utf8(bytes("sites.id.text")).unwrap(), "s1s2é");
        let offsets: Vec<u32> = bytes("sites.id.offsets").chunks_exact(4).map(|b| u32::from_le_bytes(b.try_into().unwrap())).collect();
        assert_eq!(offsets, vec![0, 2, 5]);
        let programmes: Value = serde_json::from_slice(&bytes("sites.programme")).unwrap();
        assert_eq!(programmes[0]["role"], "house");
        assert!(programmes[1].is_null());
        assert_eq!(header["tables"]["function"][2], "open_space");
        assert_eq!(blob.len() % 4, 0);
    }

    /// Version 2: per-site `programme,` texts without the housing need, every other
    /// section byte-identical to version 1. Writes the fixture read by
    /// `web/tests/cityDisplayBuffers.test.ts`.
    #[test]
    fn site_display_buffers_v2_split_programmes_and_drop_housing_need() {
        let sq = |x: f64| json!([{"outer": [{"x": x, "y": 0.0}, {"x": x + 4.0, "y": 0.0}, {"x": x + 4.0, "y": 4.0}], "holes": []}]);
        let culture = json!({"culture": "c", "pack": "p", "mode": "m", "borrowing": null});
        let requests = vec![
            json!({"id": "s1", "parcel_id": "p1", "function": "domestic", "culture": culture, "preview": sq(10.0), "buildable": sq(50.0),
                "terrain": {"ground_z_m": 12.5}, "accesses": [{"id": "a1", "segment": [{"x": 10.0, "y": 0.0}, {"x": 14.0, "y": 0.0}]}],
                "programme": {"role": "dwelling.row", "households": 2.0, "housing_floor_need": {"requested_m2": 99.0}, "label": "Fontaine Saint-Éloi",
                    "massing": [{"eave_m": 2.66, "floors": 1, "roof": "gable", "ridges": [[10.5, 1.25, 13.5, 1.25]], "cover": "tile", "wall": "timber",
                        "volumes": [{"ring": [[10.0, 0.0], [14.0, 0.0], [14.0, 4.0]], "eave_m": 2.66, "rise_m": 3.06, "roof": "gable", "ridges": [], "cover": "tile", "wall": "timber"}]}]}}),
            json!({"id": "s2", "parcel_id": "p2", "function": "open_space", "culture": culture, "buildable": sq(60.0),
                "terrain": {"ground_z_m": 3.0}, "accesses": [], "programme": null}),
        ];
        let origin = Point { x: 10.0, y: 0.0 };
        let parse = |blob: &[u8]| {
            let head = u32::from_le_bytes(blob[..4].try_into().unwrap()) as usize;
            let header: Value = serde_json::from_slice(&blob[4..4 + head]).unwrap();
            (header, blob[4 + head..].to_vec())
        };
        let (h1, b1) = parse(&site_display_buffers(&requests, origin, 1));
        let blob = site_display_buffers(&requests, origin, 2);
        let (h2, b2) = parse(&blob);
        assert_eq!(h2["version"], 2);
        assert!(h2["sections"].get("sites.programme").is_none());
        let bytes = |h: &Value, b: &[u8], name: &str| {
            let s = &h["sections"][name];
            let (o, n) = (s["offset"].as_u64().unwrap() as usize, s["length"].as_u64().unwrap() as usize);
            let size = match s["type"].as_str().unwrap() { "u8" => 1, "u16" => 2, _ => 4 };
            b[o..o + n * size].to_vec()
        };
        for (name, _) in h1["sections"].as_object().unwrap().iter().filter(|(k, _)| k.as_str() != "sites.programme") {
            assert_eq!(bytes(&h1, &b1, name), bytes(&h2, &b2, name), "{name}");
        }
        let offsets: Vec<u32> = bytes(&h2, &b2, "sites.programme.offsets").chunks_exact(4).map(|b| u32::from_le_bytes(b.try_into().unwrap())).collect();
        let text = bytes(&h2, &b2, "sites.programme.text");
        assert_eq!(offsets.len(), 3);
        assert_eq!(&text[offsets[1] as usize..], b"null,");
        let first: Value = serde_json::from_slice(&text[..offsets[1] as usize - 1]).unwrap();
        let mut expected = requests[0]["programme"].clone();
        expected.as_object_mut().unwrap().remove("housing_floor_need");
        assert_eq!(first, expected);
        // Other keys keep their order.
        let v1: Value = serde_json::from_slice(&bytes(&h1, &b1, "sites.programme")).unwrap();
        let keys = |v: &Value| v.as_object().unwrap().keys().filter(|k| k.as_str() != "housing_floor_need").cloned().collect::<Vec<_>>();
        assert_eq!(keys(&first), keys(&v1[0]));
        assert_eq!(blob.len() % 4, 0);
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../web/tests/fixtures");
        std::fs::write(dir.join("site-visuals-v2.bin"), &blob).unwrap();
        std::fs::write(dir.join("site-visuals-v1.bin"), site_display_buffers(&requests, origin, 1)).unwrap();
    }
}
