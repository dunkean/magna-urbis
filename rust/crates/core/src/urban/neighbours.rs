//! Neighbouring towns. Towns are generated in a canonical order (population
//! descending, then key); a town receives the claims (`Claim`) of the towns
//! generated before it that are close (`Site::neighbours`). It never builds on
//! their land: the growth refuses it (`Mask::blocked` in the footprint), the
//! finish cuts what still overlaps it (`enforce`), and the last pass
//! (`settle`) checks again after the slope wards and the informal quarters.
//! Its regional roads stop at their land and their edge streets are offered
//! as roads to join (`roads`); the last pass ties dead ends and edge streets
//! together (`join`). Every finished layout carries its own claim (`claim`).
//!
//! A site without neighbours never enters the geometry of this module: every
//! entry point returns at once on `site.neighbours.is_empty()`, so its layout
//! is the same as without the feature, apart from the `claim` it carries.
use crate::urban::warnings;
use super::{Block, Layout, Point, Shape, Site, Street, Surface, geometry as g, network, par};
use serde::{Deserialize, Serialize};
use std::collections::HashSet;

/// The land and the edge streets a town holds, in world metres.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Claim {
    /// Site key of the town that holds the claim.
    pub key: String,
    /// Built blocks, places, reservations, enclosures with their works and
    /// quays, closed over the streets between them: a few simple outlines.
    #[serde(default)]
    pub land: Vec<Shape>,
    /// Stretches of the town's streets that reach the edge of `land`: exits,
    /// streets crossing the edge, dead ends near it. Each ends on its outer side.
    #[serde(default)]
    pub streets: Vec<Street>,
    /// A placed neighbour generated after this town (canonical order), with no
    /// land yet: this town keeps a core sized to its population free
    /// (`reserve_cores`). Real suburbs absorb villages whose cores remain.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reserve: Option<Reserve>,
}

/// The place a `Claim::reserve` stands for, as the region placed it.
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
pub struct Reserve {
    pub population: u32,
    #[serde(default)]
    pub culture: String,
    pub center: Point,
    /// Its site radius (m); 0 falls back to the placement's extent radius.
    #[serde(default)]
    pub radius: f64,
}

/// Clear band between a neighbour's land and this town's blocks: room for a
/// street where the two towns touch.
pub(super) const MARGIN: f64 = 8.0;
/// Raster cell of the claim outline (m), and the most cells along one side.
const CELL: f64 = 3.0;
const MAX_SIDE: f64 = 1600.0;
/// Closing radius (m): blocks across a street merge into one outline.
const CLOSE: f64 = 12.0;
/// Outline simplification tolerance (m).
const SIMPLIFY: f64 = 2.0;
/// Holes and pieces of the outline below these areas (m²) are filled or dropped.
const MIN_HOLE: f64 = 2500.0;
const MIN_LAND: f64 = 100.0;
/// Length of a claim street on each side of the edge (m), and the distance
/// to the edge within which a dead end counts as pointing out.
const STUB: f64 = 60.0;
const EDGE: f64 = 20.0;
/// Longest connector between this town's streets and a neighbour's (m).
const JOIN: f64 = 40.0;
/// Pieces of cut blocks and quarters below this area (m²) are dropped.
const MIN_PIECE: f64 = 20.0;
/// Search for a free centre: rings every `RELOCATE_STEP` m out to
/// `RELOCATE_REACH` site radii, never beyond `RELOCATE_MAX` m.
const RELOCATE_STEP: f64 = 15.0;
const RELOCATE_REACH: f64 = 3.0;
const RELOCATE_MAX: f64 = 3000.0;
/// Share of free dry ground a centre needs around it.
const RELOCATE_ROOM: f64 = 0.5;

type Box4 = (f64, f64, f64, f64);

fn point_box(p: Point) -> Box4 {
    (p.x, p.y, p.x, p.y)
}
fn dist(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}

/// The neighbours' land of a site, indexed for point and shape queries.
pub(super) struct Mask {
    keys: Vec<String>,
    /// Neighbours' land as claimed, with the claim index of each piece.
    land: Vec<Shape>,
    owner: Vec<usize>,
    land_grid: g::BoxGrid,
    edges: Vec<(Point, Point)>,
    edge_grid: g::BoxGrid,
    /// The same land grown by `MARGIN`: what this town's blocks keep clear of.
    grown: Vec<Shape>,
    grown_grid: g::BoxGrid,
    /// Edge streets of all neighbours.
    streets: Vec<Street>,
}

fn grow(s: &Shape) -> Vec<Shape> {
    use geo::Buffer;
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        g::shapes(geo::MultiPolygon(vec![g::polygon(s)]).buffer(MARGIN))
    }))
    .ok()
    .filter(|v: &Vec<Shape>| !v.is_empty())
    .unwrap_or_else(|| vec![s.clone()])
}

impl Mask {
    /// None for a site without neighbours (or whose neighbours hold nothing).
    pub(super) fn of(site: &Site) -> Option<Mask> {
        if site.neighbours.is_empty() {
            return None;
        }
        let mut land = vec![];
        let mut owner = vec![];
        for (k, c) in site.neighbours.iter().enumerate() {
            for s in &c.land {
                if s.outer.len() >= 3 && g::area(s) > 0.0 {
                    land.push(s.clone());
                    owner.push(k);
                }
            }
        }
        let streets: Vec<Street> = site.neighbours.iter().flat_map(|c| c.streets.iter())
            .filter(|s| s.path.len() >= 2 && s.path.len() == s.widths.len()).cloned().collect();
        if land.is_empty() && streets.is_empty() {
            return None;
        }
        let grown: Vec<Shape> = par::map(&land, |_, s| grow(s)).into_iter().flatten().collect();
        let mut edges = vec![];
        for r in land.iter().flat_map(|s| std::iter::once(&s.outer).chain(s.holes.iter())) {
            for (a, b) in r.iter().zip(r.iter().cycle().skip(1)).take(r.len()) {
                edges.push((*a, *b));
            }
        }
        Some(Mask {
            keys: site.neighbours.iter().map(|c| c.key.clone()).collect(),
            land_grid: g::BoxGrid::new(land.iter().map(g::bbox).collect()),
            edge_grid: g::BoxGrid::new(edges.iter().map(|(a, b)| (a.x.min(b.x), a.y.min(b.y), a.x.max(b.x), a.y.max(b.y))).collect()),
            grown_grid: g::BoxGrid::new(grown.iter().map(g::bbox).collect()),
            land,
            owner,
            edges,
            grown,
            streets,
        })
    }
    /// Within a neighbour's land or its margin: no block of this town there.
    pub(super) fn blocked(&self, p: Point) -> bool {
        self.grown_grid.query(point_box(p), 0.0).into_iter().any(|i| g::contains(&self.grown[i], p))
    }
    /// Within a neighbour's land itself: no street of this town there.
    fn on_land(&self, p: Point) -> bool {
        self.land_grid.query(point_box(p), 0.0).into_iter().any(|i| g::contains(&self.land[i], p))
    }
    /// Distance to the nearest neighbour land (0 inside), infinite beyond `reach`.
    fn land_distance(&self, p: Point, reach: f64) -> f64 {
        if self.on_land(p) {
            return 0.0;
        }
        self.edge_grid.query(point_box(p), reach).into_iter()
            .map(|i| g::distance(p, self.edges[i].0, self.edges[i].1).0)
            .filter(|d| *d <= reach)
            .fold(f64::INFINITY, f64::min)
    }
    /// `s` minus the neighbours' land (`raw`) or the land and its margin; None
    /// when `s` does not overlap it, so untouched geometry keeps its exact rings.
    fn cut(&self, s: &Shape, raw: bool) -> Option<Vec<Shape>> {
        let (shapes, grid) = if raw { (&self.land, &self.land_grid) } else { (&self.grown, &self.grown_grid) };
        if s.outer.len() < 3 {
            return None;
        }
        let hits = grid.query(g::bbox(s), 0.0);
        if hits.is_empty() {
            return None;
        }
        let before = g::area(s);
        let mut pieces = vec![s.clone()];
        for i in hits {
            let other = &shapes[i];
            let ob = g::bbox(other);
            pieces = pieces.into_iter().flat_map(|p| {
                if g::boxes_meet(g::bbox(&p), ob) { g::difference(&p, other) } else { vec![p] }
            }).collect();
        }
        let after: f64 = pieces.iter().map(g::area).sum();
        if after >= before - 0.5 {
            return None;
        }
        Some(pieces.into_iter().filter(|p| g::area(p) >= MIN_PIECE).collect())
    }
    /// `s` minus the neighbours' land and its margin (`s` itself when untouched).
    pub(super) fn cut_free(&self, s: &Shape) -> Vec<Shape> {
        self.cut(s, false).unwrap_or_else(|| vec![s.clone()])
    }
    /// Claim index of the first land piece `s` overlaps.
    fn touched_by(&self, s: &Shape) -> Option<usize> {
        if s.outer.len() < 3 {
            return None;
        }
        self.land_grid.query(g::bbox(s), 0.0).into_iter()
            .find(|&i| g::intersection(s, &self.land[i]).iter().map(g::area).sum::<f64>() > 0.5)
            .map(|i| self.owner[i])
    }
    /// The parts of a street outside the neighbours' land; None when the
    /// street does not enter it.
    fn cut_path(&self, path: &[Point], widths: &[f64]) -> Option<Vec<(Vec<Point>, Vec<f64>)>> {
        if path.len() < 2 || self.land.is_empty() {
            return None;
        }
        let width = |i: usize| widths.get(i).or(widths.last()).copied().unwrap_or(4.0);
        let mut pieces: Vec<(Vec<Point>, Vec<f64>)> = vec![];
        let mut current: (Vec<Point>, Vec<f64>) = (vec![], vec![]);
        let mut entered = false;
        let push = |piece: &mut (Vec<Point>, Vec<f64>), p: Point, w: f64| {
            if piece.0.last().is_none_or(|q: &Point| dist(*q, p) > 1e-9) {
                piece.0.push(p);
                piece.1.push(w);
            }
        };
        for k in 0..path.len() - 1 {
            let (a, b) = (path[k], path[k + 1]);
            let (wa, wb) = (width(k), width(k + 1));
            let bb = (a.x.min(b.x), a.y.min(b.y), a.x.max(b.x), a.y.max(b.y));
            let mut ts = vec![0.0, 1.0];
            for i in self.edge_grid.query(bb, 0.0) {
                if let Some((t, _)) = g::segment_hit(a, b, self.edges[i].0, self.edges[i].1) {
                    ts.push(t.clamp(0.0, 1.0));
                }
            }
            ts.sort_by(f64::total_cmp);
            ts.dedup_by(|x, y| (*x - *y).abs() < 1e-9);
            let at = |t: f64| Point { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            for w in ts.windows(2) {
                let (t0, t1) = (w[0], w[1]);
                if self.on_land(at((t0 + t1) * 0.5)) {
                    entered = true;
                    if current.0.len() >= 2 {
                        pieces.push(std::mem::take(&mut current));
                    } else {
                        current = (vec![], vec![]);
                    }
                } else {
                    push(&mut current, at(t0), wa + (wb - wa) * t0);
                    push(&mut current, at(t1), wa + (wb - wa) * t1);
                }
            }
        }
        if !entered {
            return None;
        }
        if current.0.len() >= 2 {
            pieces.push(current);
        }
        pieces.retain(|(p, _)| p.windows(2).map(|w| dist(w[0], w[1])).sum::<f64>() >= 2.0);
        Some(pieces)
    }
}

/// A site whose centre lies on a neighbour's land (or its margin), or has no
/// free dry ground around it, starts from the nearest centre that has: rings
/// every 15 m out to three site radii (at most 3 km). None when the centre is
/// free, the site has no neighbours, or nothing free is found within the bound.
pub(super) fn relocate(site: &Site, surface: Surface<'_>) -> Option<Site> {
    let mask = Mask::of(site)?;
    let probe = (site.radius * 0.5).clamp(40.0, 150.0);
    let free = |p: Point| !surface.wet(p) && !mask.blocked(p);
    let room = |p: Point| -> f64 {
        let mut n = 0;
        for ring in [0.5, 1.0] {
            for k in 0..8 {
                let a = k as f64 * std::f64::consts::TAU / 8.0 + ring;
                n += usize::from(free(Point { x: p.x + probe * ring * a.cos(), y: p.y + probe * ring * a.sin() }));
            }
        }
        n as f64 / 16.0
    };
    if free(site.center) && room(site.center) >= RELOCATE_ROOM {
        return None;
    }
    let bound = (site.radius * RELOCATE_REACH).clamp(RELOCATE_STEP * 4.0, RELOCATE_MAX);
    let mut r = RELOCATE_STEP;
    while r <= bound {
        let count = ((std::f64::consts::TAU * r / RELOCATE_STEP).ceil() as usize).max(16);
        let best = (0..count)
            .map(|k| {
                let a = k as f64 * std::f64::consts::TAU / count as f64;
                Point { x: site.center.x + r * a.cos(), y: site.center.y + r * a.sin() }
            })
            .filter(|&p| free(p))
            .map(|p| (room(p), p))
            .filter(|(share, _)| *share >= RELOCATE_ROOM)
            .fold(None, |best: Option<(f64, Point)>, c| if best.is_none_or(|b| c.0 > b.0) { Some(c) } else { best });
        if let Some((_, center)) = best {
            return Some(Site { center, ..site.clone() });
        }
        r += RELOCATE_STEP;
    }
    None
}

/// The roads a site with neighbours builds against: the regional roads cut
/// at the neighbours' land, plus their edge streets as ways to join. None
/// without neighbours (the roads are used as given).
pub(super) fn roads(site: &Site, roads: &[Street]) -> Option<Vec<Street>> {
    let mask = Mask::of(site)?;
    let mut out = Vec::with_capacity(roads.len() + mask.streets.len());
    for r in roads {
        match mask.cut_path(&r.path, &r.widths) {
            None => out.push(r.clone()),
            Some(pieces) => out.extend(pieces.into_iter().map(|(path, widths)| Street { path, widths, rank: r.rank, role: r.role.clone() })),
        }
    }
    out.extend(mask.streets.iter().cloned());
    Some(out)
}

/// The shapes the informal quarters keep out of (`shanty`): the neighbours'
/// land with its margin. Empty without neighbours.
pub(super) fn forbidden(site: &Site) -> Vec<Shape> {
    Mask::of(site).map_or_else(Vec::new, |m| m.grown)
}

/// A point free of the neighbours' land and margin. Always true without
/// neighbours. For sparse checks (slope wards); hot loops use `Mask::blocked`.
pub(super) fn clear(site: &Site, p: Point) -> bool {
    if site.neighbours.is_empty() {
        return true;
    }
    !site.neighbours.iter().flat_map(|c| &c.land).any(|s| {
        s.outer.len() >= 3 && (g::contains(s, p) || ring_distance(s, p) < MARGIN)
    })
}
fn ring_distance(s: &Shape, p: Point) -> f64 {
    std::iter::once(&s.outer).chain(s.holes.iter())
        .flat_map(|r| r.iter().zip(r.iter().cycle().skip(1)).take(r.len()))
        .map(|(a, b)| g::distance(p, *a, *b).0)
        .fold(f64::INFINITY, f64::min)
}

/// Cuts what a layout still holds on the neighbours' land: quarters, blocks
/// (places and reservations included), growth phases and allocated land
/// against the land and its margin; streets against the land itself.
/// Enclosures that cross the land are dropped (with a warning), as are
/// quays, gate villages and spring sites on it. With `drop_blocks` false
/// (after the programme), block indices are kept: a block keeps its largest
/// free piece, and one wholly on the land is left for the caller to report.
/// Returns whether anything changed.
pub(super) fn enforce(layout: &mut Layout, mask: &Mask, drop_blocks: bool) -> bool {
    let mut changed = false;
    // Quarters keep their indices (blocks and districts refer to them).
    let cut_quarters = par::map(&layout.quarters, |_, q| mask.cut(&q.shape, false));
    for (q, cut) in layout.quarters.iter_mut().zip(cut_quarters) {
        if let Some(pieces) = cut {
            changed = true;
            q.shape = pieces.into_iter().max_by(|a, b| g::area(a).total_cmp(&g::area(b)))
                .unwrap_or(Shape { outer: vec![], holes: vec![] });
        }
    }
    let cut_blocks = par::map(&layout.blocks, |_, b| mask.cut(&b.shape, false));
    if cut_blocks.iter().any(Option::is_some) {
        changed = true;
        let old = std::mem::take(&mut layout.blocks);
        for (b, cut) in old.into_iter().zip(cut_blocks) {
            match cut {
                None => layout.blocks.push(b),
                Some(mut pieces) if drop_blocks => {
                    pieces.sort_by(|a, b| g::area(b).total_cmp(&g::area(a)));
                    layout.blocks.extend(pieces.into_iter().map(|shape| Block { shape, ..b.clone() }));
                }
                Some(pieces) => {
                    let largest = pieces.into_iter().max_by(|a, b| g::area(a).total_cmp(&g::area(b)));
                    layout.blocks.push(match largest { Some(shape) => Block { shape, ..b }, None => b });
                }
            }
        }
    }
    for phase in &mut layout.phases {
        if let Some(cut) = cut_all(mask, &phase.shapes) {
            phase.shapes = cut;
            changed = true;
        }
    }
    if let Some(s) = layout.structure.as_mut() {
        if let Some(cut) = cut_all(mask, &s.allocated) {
            s.allocated = cut;
            s.metrics.allocated_area = s.allocated.iter().map(g::area).sum();
            s.metrics.components = s.allocated.len();
            changed = true;
        }
        if let Some(cut) = cut_all(mask, &s.reserve) {
            s.reserve = cut;
            changed = true;
        }
        let quays = s.quays.len();
        s.quays.retain(|q| mask.cut(&q.shape, false).is_none());
        let springs = s.spring_sites.len();
        s.spring_sites.retain(|w| mask.cut(&w.shape, false).is_none());
        let villages = s.gate_village_centers.len();
        s.gate_village_centers.retain(|&p| !mask.blocked(p));
        changed |= quays != s.quays.len() || springs != s.spring_sites.len() || villages != s.gate_village_centers.len();
    }
    // An enclosure never crosses a neighbour's land: a circuit that would is
    // not raised, and the town says so.
    let mut dropped = vec![];
    layout.enclosures.retain(|e| {
        let ring = Shape { outer: e.path.clone(), holes: vec![] };
        let hit = mask.touched_by(&ring).or_else(|| e.path.iter().any(|&p| mask.on_land(p)).then_some(usize::MAX));
        if let Some(k) = hit { dropped.push(k); false } else { true }
    });
    for k in dropped {
        changed = true;
        let key = mask.keys.get(k).map(String::as_str);
        // One line per neighbour, however many circuits it stops.
        let warning = warnings::wall_neighbour(key);
        if !layout.warnings.contains(&warning) { layout.warnings.push(warning); }
    }
    // Streets stop at the land itself; the margin is left for a street
    // between the towns. Cut streets keep their index (first piece); the
    // other pieces are appended; reservations follow their street.
    let cut_streets = par::map(&layout.streets, |_, s| mask.cut_path(&s.path, &s.widths));
    if cut_streets.iter().any(Option::is_some) {
        changed = true;
        let reserved = network::reserved_streets(layout);
        let mut extra = vec![];
        let mut gone = HashSet::new();
        for (i, cut) in cut_streets.into_iter().enumerate() {
            let Some(pieces) = cut else { continue };
            let s = &mut layout.streets[i];
            let mut pieces = pieces.into_iter();
            match pieces.next() {
                Some((path, widths)) => { s.path = path; s.widths = widths; }
                None => { gone.insert(i); }
            }
            extra.extend(pieces.map(|(path, widths)| Street { path, widths, rank: s.rank, role: s.role.clone() }));
        }
        let mut i = 0;
        layout.streets.retain(|_| { i += 1; !gone.contains(&(i - 1)) });
        layout.streets.extend(extra);
        network::remap_reservations(layout, &reserved);
    }
    changed
}

fn cut_all(mask: &Mask, shapes: &[Shape]) -> Option<Vec<Shape>> {
    let cuts = par::map(shapes, |_, s| mask.cut(s, false));
    if cuts.iter().all(Option::is_none) {
        return None;
    }
    Some(shapes.iter().zip(cuts).flat_map(|(s, c)| c.unwrap_or_else(|| vec![s.clone()])).collect())
}

/// Ties this town's streets to the neighbours' edge streets: a dead end near
/// a neighbour's land runs on to the nearest point of an edge street, and an
/// edge street whose outer end stops short of this town runs on to its
/// nearest street. A connector is at most `JOIN` m long and never crosses a
/// block of this town. Streets that only repeat an edge street (a regional
/// span taken from the roads) are dropped first. Returns the connectors added.
fn join(layout: &mut Layout, mask: &Mask) -> usize {
    if mask.streets.is_empty() {
        return 0;
    }
    let claim_segments: Vec<(Point, Point)> = mask.streets.iter()
        .flat_map(|s| s.path.windows(2).map(|w| (w[0], w[1]))).collect();
    let claim_grid = g::BoxGrid::new(claim_segments.iter().map(|(a, b)| (a.x.min(b.x), a.y.min(b.y), a.x.max(b.x), a.y.max(b.y))).collect());
    let near_claim = |p: Point, reach: f64| -> Option<(f64, Point)> {
        claim_grid.query(point_box(p), reach).into_iter()
            .map(|i| { let (d, _, q) = g::distance(p, claim_segments[i].0, claim_segments[i].1); (d, q) })
            .filter(|(d, _)| *d <= reach)
            .fold(None, |best: Option<(f64, Point)>, c| if best.is_none_or(|b| c.0 < b.0) { Some(c) } else { best })
    };
    // A street of this town lying on an edge street repeats it.
    let reserved = network::reserved_streets(layout);
    let before = layout.streets.len();
    layout.streets.retain(|s| !(s.path.len() >= 2 && s.path.iter().all(|&p| near_claim(p, 2.0).is_some())));
    if layout.streets.len() != before {
        network::remap_reservations(layout, &reserved);
    }
    let blocks = g::BoxGrid::new(layout.blocks.iter().map(|b| g::bbox(&b.shape)).collect());
    let crosses_block = |a: Point, b: Point| -> bool {
        let bb = (a.x.min(b.x), a.y.min(b.y), a.x.max(b.x), a.y.max(b.y));
        let hits = blocks.query(bb, 0.0);
        (1..8).any(|k| {
            let t = k as f64 / 8.0;
            let p = Point { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            hits.iter().any(|&i| g::contains(&layout.blocks[i].shape, p))
        })
    };
    // Vertices shared by two streets of this town are junctions, not dead ends.
    let quantize = |p: Point| ((p.x * 2.0).round() as i64, (p.y * 2.0).round() as i64);
    let mut degree: std::collections::HashMap<(i64, i64), usize> = Default::default();
    for s in &layout.streets {
        for (k, &p) in s.path.iter().enumerate() {
            *degree.entry(quantize(p)).or_default() += if k == 0 || k + 1 == s.path.len() { 1 } else { 2 };
        }
    }
    let mut connectors = vec![];
    for s in &layout.streets {
        if s.path.len() < 2 {
            continue;
        }
        let (first, last) = (s.widths.first().copied().unwrap_or(4.0), s.widths.last().copied().unwrap_or(4.0));
        for (end, width) in [(s.path[0], first), (*s.path.last().unwrap(), last)] {
            if degree.get(&quantize(end)).copied().unwrap_or(0) != 1 || mask.land_distance(end, MARGIN + EDGE).is_infinite() {
                continue;
            }
            if let Some((d, q)) = near_claim(end, JOIN)
                && d > 0.5 && !crosses_block(end, q)
            {
                connectors.push(Street { path: vec![end, q], widths: vec![width, width], rank: s.rank, role: s.role.clone() });
            }
        }
    }
    // Edge streets whose outer end stops short of this town.
    let own_segments: Vec<(usize, Point, Point)> = layout.streets.iter().enumerate()
        .flat_map(|(i, s)| s.path.windows(2).map(move |w| (i, w[0], w[1]))).collect();
    let own_grid = g::BoxGrid::new(own_segments.iter().map(|(_, a, b)| (a.x.min(b.x), a.y.min(b.y), a.x.max(b.x), a.y.max(b.y))).collect());
    for c in &mask.streets {
        let end = *c.path.last().unwrap();
        if mask.on_land(end) || connectors.iter().any(|k: &Street| dist(k.path[1], end) < 2.0 || dist(k.path[0], end) < 2.0) {
            continue;
        }
        let nearest = own_grid.query(point_box(end), JOIN).into_iter()
            .map(|i| { let (d, _, q) = g::distance(end, own_segments[i].1, own_segments[i].2); (d, q, own_segments[i].0) })
            .filter(|(d, _, _)| *d <= JOIN)
            .fold(None, |best: Option<(f64, Point, usize)>, c| if best.is_none_or(|b| c.0 < b.0) { Some(c) } else { best });
        if let Some((d, q, i)) = nearest
            && d > 0.5 && !crosses_block(end, q)
        {
            let s = &layout.streets[i];
            let width = *c.widths.last().unwrap();
            connectors.push(Street { path: vec![q, end], widths: vec![width, width], rank: s.rank.max(c.rank), role: s.role.clone() });
        }
    }
    let added = connectors.len();
    layout.streets.extend(connectors);
    added
}

/// The last pass of a town with neighbours, after its slope wards and
/// informal quarters: cut what still overlaps their land (blocks keep their
/// indices when an informal extension counts them), join the streets, and
/// warn when their land left the town short of its households or without
/// any room. Nothing happens without neighbours.
pub(super) fn settle(seed: &str, layout: &mut Layout, site: &Site, surface: Surface<'_>) {
    let Some(mask) = Mask::of(site) else { return };
    let informal = layout.structure.as_ref().is_some_and(|s| s.shanty.is_some());
    let blocks = layout.blocks.len();
    if enforce(layout, &mask, !informal) && layout.blocks.len() != blocks
        && let Some(context) = layout.programme.as_ref().map(|p| p.context.clone())
    {
        let _ = super::programme::prepare(layout, site.population, &context, surface);
    }
    join(layout, &mask);
    if site.population == 0 {
        return;
    }
    let empty = layout.blocks.iter().all(|b| b.kind == "reserve");
    let short = layout.structure.as_ref().is_none_or(|s| s.metrics.target_area > 0.0 && s.metrics.shortfall_area > 0.02 * s.metrics.target_area);
    if !empty && !short {
        return;
    }
    // A neighbour is named only when its land took something from this town:
    // for an empty town, land on its centre or within its site radius; else
    // land within `TOUCH` of its built blocks (it cut them or stopped their
    // growth there). A town short for its own reasons reports that itself.
    let mut near: Vec<&str> = vec![];
    for (k, c) in site.neighbours.iter().enumerate() {
        let key = mask.keys[k].as_str();
        let took = c.land.iter().filter(|s| s.outer.len() >= 3).any(|s| if empty {
            g::contains(s, layout.center) || ring_distance(s, layout.center) <= site.radius
        } else {
            touches(s, &layout.blocks)
        });
        if took && !near.contains(&key) {
            near.push(key);
        }
    }
    if near.is_empty() {
        return;
    }
    let keys = near.join(", ");
    if empty {
        layout.warnings.push(warnings::land_neighbours(&keys));
        return;
    }
    if let Some((wanted, housed)) = super::slopes::households(seed, layout)
        && wanted > 0.0 && housed < 0.98 * wanted
    {
        layout.warnings.push(warnings::housing_neighbours(housed, wanted, &keys));
    }
}

/// Distance within which a neighbour's land counts as touching this town's
/// blocks: the margin both towns keep, plus the claim's closing.
const TOUCH: f64 = 2.0 * MARGIN + CLOSE;

/// Some built block of the town comes within `TOUCH` of this piece of land.
fn touches(land: &Shape, blocks: &[Block]) -> bool {
    let b = g::bbox(land);
    blocks.iter().filter(|k| k.kind != "reserve").any(|k| {
        let kb = g::bbox(&k.shape);
        kb.0 <= b.2 + TOUCH && kb.2 >= b.0 - TOUCH && kb.1 <= b.3 + TOUCH && kb.3 >= b.1 - TOUCH
            && k.shape.outer.iter().any(|&p| g::contains(land, p) || ring_distance(land, p) <= TOUCH)
    })
}

/// The claim of a finished layout: its held land as a few simplified
/// outlines (a raster closing of the blocks, enclosures and quays, traced and
/// simplified) and the stretches of its streets that reach the edge.
pub(super) fn claim(layout: &Layout) -> Claim {
    let reserved: HashSet<usize> = layout.programme.iter().flat_map(|p| &p.reservations).map(|r| r.block).collect();
    let rings: Vec<Shape> = layout.enclosures.iter().filter(|e| e.path.len() >= 3)
        .map(|e| Shape { outer: e.path.clone(), holes: vec![] }).collect();
    let mut held: Vec<&Shape> = layout.blocks.iter().enumerate()
        .filter(|(i, b)| b.kind != "reserve" || reserved.contains(i)).map(|(_, b)| &b.shape).collect();
    held.extend(rings.iter());
    held.extend(layout.enclosures.iter().flat_map(|e| e.reserve.iter()));
    if let Some(s) = &layout.structure {
        held.extend(s.quays.iter().map(|q| &q.shape));
    }
    held.retain(|s| s.outer.len() >= 3);
    let key = layout.key.clone();
    let Some(raster) = Raster::new(&held) else {
        return Claim { key, land: vec![], streets: vec![], reserve: None };
    };
    let land = raster.outline();
    let streets = raster.stubs(&layout.streets);
    Claim { key, land, streets, reserve: None }
}

/// Sides of a reserved core's outline.
const CORE_SIDES: usize = 32;

/// A town whose neighbours include places generated after it (`Claim::reserve`):
/// each place is first laid out alone, as its own request would lay it (its
/// culture, the shared settings, none of this town's own choices), and keeps
/// that land grown by `MARGIN` together with a disc of the same area round its
/// centre (its own request may draw another shape): this town's growth,
/// quarters and finish flow around it, so the place keeps the homes it has
/// alone, whatever its land plan asks. A core that would reach this town's own
/// centre is left out (the larger town is not moved off its site for a smaller
/// one). None when no neighbour carries a reserve.
pub(super) fn reserve_cores(seed: &str, site: &Site, cfg: &super::LayoutConfig, surface: Surface<'_>, roads: &[Street]) -> Option<Site> {
    if !site.neighbours.iter().any(|c| c.reserve.is_some()) {
        return None;
    }
    let base = super::LayoutConfig::default();
    let alone = super::LayoutConfig {
        culture: "site".into(), preset: base.preset, recipe: base.recipe, params: base.params,
        tissue: base.tissue, zone: base.zone, radius: 0.0, radius_scale: base.radius_scale,
        ..cfg.clone()
    };
    let mut out = site.clone();
    out.neighbours = par::map(&site.neighbours, |_, c| -> Option<Claim> {
        let Some(r) = &c.reserve else { return Some(c.clone()) };
        if r.population == 0 || !r.center.x.is_finite() || !r.center.y.is_finite() {
            return None;
        }
        let place = Site {
            key: c.key.clone(), name: String::new(), population: r.population,
            culture: if r.culture.is_empty() { site.culture.clone() } else { r.culture.clone() },
            center: r.center,
            radius: if r.radius > 0.0 { r.radius } else { crate::settlements::extent_radius(r.population) },
            neighbours: vec![],
        };
        let layout = super::generate_quarters(seed, std::slice::from_ref(&place), &alone, surface, roads).ok()?.into_iter().next()?;
        let held: Vec<Shape> = layout.claim.land.iter().filter(|s| s.outer.len() >= 3).flat_map(grow).collect();
        let area: f64 = layout.claim.land.iter().map(g::area).sum();
        if !(area > 0.0) {
            return None;
        }
        // The place keeps `MARGIN` off this town's land: the disc carries that band too.
        let core = (area / std::f64::consts::PI).sqrt() + MARGIN;
        if dist(r.center, site.center) <= core + MARGIN + CLOSE || held.iter().any(|s| g::contains(s, site.center)) {
            return None;
        }
        let outer = (0..CORE_SIDES).map(|k| {
            let a = k as f64 * std::f64::consts::TAU / CORE_SIDES as f64;
            Point { x: r.center.x + core * a.cos(), y: r.center.y + core * a.sin() }
        }).collect();
        let disc = g::normalized(Shape { outer, holes: vec![] });
        let land = super::footprint::union(&[held, vec![disc]].concat());
        Some(Claim { key: c.key.clone(), land, streets: vec![], reserve: None })
    }).into_iter().flatten().collect();
    Some(out)
}

/// Cell raster of a town's held land.
struct Raster {
    x0: f64,
    y0: f64,
    cell: f64,
    nx: usize,
    ny: usize,
    on: Vec<bool>,
}
impl Raster {
    fn new(shapes: &[&Shape]) -> Option<Raster> {
        let (mut x0, mut y0, mut x1, mut y1) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
        for s in shapes {
            let b = g::bbox(s);
            if [b.0, b.1, b.2, b.3].iter().all(|v| v.is_finite()) {
                (x0, y0, x1, y1) = (x0.min(b.0), y0.min(b.1), x1.max(b.2), y1.max(b.3));
            }
        }
        if !(x0.is_finite() && x1 > x0 && y1 > y0) {
            return None;
        }
        let cell = CELL.max((x1 - x0).max(y1 - y0) / MAX_SIDE);
        let r = (CLOSE / cell).ceil() as usize;
        let pad = (r + 3) as f64 * cell;
        // Anchor cells in world coordinates so a distant block moving by a fraction of
        // a cell cannot shift the road handover at the opposite edge of the claim.
        let (x0, y0) = ((x0 / cell).floor() * cell - pad, (y0 / cell).floor() * cell - pad);
        let nx = ((x1 + pad - x0) / cell).ceil() as usize + 1;
        let ny = ((y1 + pad - y0) / cell).ceil() as usize + 1;
        let mut raster = Raster { x0, y0, cell, nx, ny, on: vec![false; nx * ny] };
        for s in shapes {
            raster.fill(s);
        }
        // Closing (blocks across a street become one), then one cell of pad so
        // the outline covers the held land.
        let on = spread(&raster.on, nx, ny, r, true);
        let on = spread(&on, nx, ny, r, false);
        raster.on = spread(&on, nx, ny, 1, true);
        Some(raster)
    }
    /// Sets the cells whose centre lies inside `s` (even-odd over its rings).
    fn fill(&mut self, s: &Shape) {
        let b = g::bbox(s);
        let row = |y: f64| (y - self.y0) / self.cell - 0.5;
        let j0 = row(b.1).ceil().max(0.0) as usize;
        let j1 = (row(b.3).floor().max(-1.0) + 1.0).min(self.ny as f64) as usize;
        let rings: Vec<&Vec<Point>> = std::iter::once(&s.outer).chain(s.holes.iter()).collect();
        let mut xs = vec![];
        for j in j0..j1 {
            let y = self.y0 + (j as f64 + 0.5) * self.cell;
            xs.clear();
            for r in &rings {
                for (a, c) in r.iter().zip(r.iter().cycle().skip(1)).take(r.len()) {
                    if (a.y <= y) != (c.y <= y) {
                        xs.push(a.x + (y - a.y) * (c.x - a.x) / (c.y - a.y));
                    }
                }
            }
            xs.sort_by(f64::total_cmp);
            for pair in xs.chunks_exact(2) {
                let i0 = ((pair[0] - self.x0) / self.cell - 0.5).ceil().max(0.0) as usize;
                let i1 = (((pair[1] - self.x0) / self.cell - 0.5).floor() + 1.0).clamp(0.0, self.nx as f64) as usize;
                for i in i0..i1.max(i0) {
                    self.on[j * self.nx + i] = true;
                }
            }
        }
    }
    fn at(&self, p: Point) -> bool {
        let i = ((p.x - self.x0) / self.cell).floor();
        let j = ((p.y - self.y0) / self.cell).floor();
        i >= 0.0 && j >= 0.0 && (i as usize) < self.nx && (j as usize) < self.ny && self.on[j as usize * self.nx + i as usize]
    }
    /// Some cell outside the land within `d` of `p`.
    fn near_edge(&self, p: Point, d: f64) -> bool {
        let k = (d / self.cell).ceil() as i64;
        let ci = ((p.x - self.x0) / self.cell).floor() as i64;
        let cj = ((p.y - self.y0) / self.cell).floor() as i64;
        (-k..=k).any(|dj| (-k..=k).any(|di| {
            let (i, j) = (ci + di, cj + dj);
            i < 0 || j < 0 || i >= self.nx as i64 || j >= self.ny as i64 || !self.on[j as usize * self.nx + i as usize]
        }))
    }
    /// Outlines of the set cells: boundary edges traced into rings (land on
    /// the left), collinear corners removed, simplified, holes matched to
    /// their outer ring; small holes are filled and small pieces dropped.
    fn outline(&self) -> Vec<Shape> {
        let (nx, ny) = (self.nx, self.ny);
        let on = |i: i64, j: i64| i >= 0 && j >= 0 && (i as usize) < nx && (j as usize) < ny && self.on[j as usize * nx + i as usize];
        let vid = |i: usize, j: usize| j * (nx + 1) + i;
        let mut out = vec![[u32::MAX; 2]; (nx + 1) * (ny + 1)];
        let mut add = |a: usize, b: usize| {
            let slot = if out[a][0] == u32::MAX { 0 } else { 1 };
            out[a][slot] = b as u32;
        };
        for j in 0..ny {
            for i in 0..nx {
                if !self.on[j * nx + i] {
                    continue;
                }
                let (ii, jj) = (i as i64, j as i64);
                if !on(ii, jj - 1) { add(vid(i, j), vid(i + 1, j)); }
                if !on(ii + 1, jj) { add(vid(i + 1, j), vid(i + 1, j + 1)); }
                if !on(ii, jj + 1) { add(vid(i + 1, j + 1), vid(i, j + 1)); }
                if !on(ii - 1, jj) { add(vid(i, j + 1), vid(i, j)); }
            }
        }
        let coords = |v: usize| (v % (nx + 1), v / (nx + 1));
        let point = |v: usize| { let (i, j) = coords(v); Point { x: self.x0 + i as f64 * self.cell, y: self.y0 + j as f64 * self.cell } };
        let direction = |a: usize, b: usize| {
            let ((ai, aj), (bi, bj)) = (coords(a), coords(b));
            (bi as i64 - ai as i64, bj as i64 - aj as i64)
        };
        let mut rings: Vec<Vec<Point>> = vec![];
        for start in 0..out.len() {
            while out[start][0] != u32::MAX {
                let mut ring = vec![];
                let mut cur = start;
                let mut incoming: Option<(i64, i64)> = None;
                loop {
                    let slots = out[cur];
                    let pick = if slots[1] == u32::MAX {
                        0
                    } else if let Some((dx, dy)) = incoming {
                        // At a saddle, turn right: diagonal cells stay apart.
                        let turn = |s: usize| { let (cx, cy) = direction(cur, slots[s] as usize); dx * cy - dy * cx };
                        if turn(0) <= turn(1) { 0 } else { 1 }
                    } else { 0 };
                    let next = slots[pick] as usize;
                    out[cur][pick] = out[cur][1 - pick];
                    out[cur][1] = u32::MAX;
                    let d = direction(cur, next);
                    if incoming != Some(d) {
                        ring.push(point(cur));
                    }
                    incoming = Some(d);
                    cur = next;
                    if cur == start {
                        break;
                    }
                }
                // The start may sit mid-way along a straight run.
                if ring.len() >= 3 {
                    rings.push(ring);
                }
            }
        }
        let simplified: Vec<Vec<Point>> = par::map(&rings, |_, r| {
            let mut closed = r.clone();
            closed.push(r[0]);
            let mut s = g::simplify(&closed, SIMPLIFY, |_| false);
            s.pop();
            s
        });
        let (outers, holes): (Vec<Vec<Point>>, Vec<Vec<Point>>) = simplified.into_iter()
            .filter(|r| r.len() >= 3)
            .partition(|r| g::signed(r) > 0.0);
        let mut shapes: Vec<Shape> = outers.into_iter().filter(|r| g::signed(r) >= MIN_LAND)
            .map(|outer| Shape { outer, holes: vec![] }).collect();
        for h in holes {
            if -g::signed(&h) < MIN_HOLE {
                continue;
            }
            if let Some(s) = shapes.iter_mut().filter(|s| g::contains(&Shape { outer: s.outer.clone(), holes: vec![] }, h[0]))
                .min_by(|a, b| g::signed(&a.outer).total_cmp(&g::signed(&b.outer)))
            {
                s.holes.push(h);
            }
        }
        shapes.into_iter().map(g::normalized).collect()
    }
    /// The stretches of `streets` that reach the edge of the land: `STUB` m
    /// on each side of a crossing of the edge, and the last `STUB` m of a
    /// dead end within `EDGE` m of it; each ends on its outer side.
    fn stubs(&self, streets: &[Street]) -> Vec<Street> {
        let mut out = vec![];
        for s in streets {
            if s.path.len() < 2 || s.widths.len() != s.path.len() || s.role == "quay" {
                continue;
            }
            let mut lengths = vec![0.0];
            for w in s.path.windows(2) {
                lengths.push(lengths.last().unwrap() + dist(w[0], w[1]));
            }
            let total = *lengths.last().unwrap();
            if total < 1.0 {
                continue;
            }
            let at = |d: f64| along(&s.path, &lengths, d);
            let mut stubs: Vec<(f64, f64, bool)> = vec![];
            let steps = (total / self.cell).ceil().max(1.0) as usize;
            let mut inside = self.at(s.path[0]);
            for k in 1..=steps {
                let d = total * k as f64 / steps as f64;
                let now = self.at(at(d));
                if now != inside {
                    // Leaving the land keeps the street's direction; entering reverses it.
                    stubs.push(((d - STUB).max(0.0), (d + STUB).min(total), now));
                }
                inside = now;
            }
            if self.at(s.path[0]) && self.near_edge(s.path[0], EDGE) {
                stubs.push((0.0, STUB.min(total), true));
            }
            if self.at(*s.path.last().unwrap()) && self.near_edge(*s.path.last().unwrap(), EDGE) {
                stubs.push(((total - STUB).max(0.0), total, false));
            }
            for (d0, d1, reverse) in stubs {
                let (mut path, mut widths) = sub_path(&s.path, &s.widths, &lengths, d0, d1);
                if path.len() < 2 || d1 - d0 < 5.0 {
                    continue;
                }
                if reverse {
                    path.reverse();
                    widths.reverse();
                }
                out.push(Street { path, widths, rank: s.rank, role: s.role.clone() });
            }
        }
        out
    }
}

fn along(path: &[Point], lengths: &[f64], d: f64) -> Point {
    let k = lengths.partition_point(|&l| l < d).clamp(1, path.len() - 1);
    let (a, b) = (path[k - 1], path[k]);
    let span = (lengths[k] - lengths[k - 1]).max(1e-12);
    let t = ((d - lengths[k - 1]) / span).clamp(0.0, 1.0);
    Point { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}
fn sub_path(path: &[Point], widths: &[f64], lengths: &[f64], d0: f64, d1: f64) -> (Vec<Point>, Vec<f64>) {
    let width = |d: f64| {
        let k = lengths.partition_point(|&l| l < d).clamp(1, path.len() - 1);
        let span = (lengths[k] - lengths[k - 1]).max(1e-12);
        let t = ((d - lengths[k - 1]) / span).clamp(0.0, 1.0);
        widths[k - 1] + (widths[k] - widths[k - 1]) * t
    };
    let mut p = vec![along(path, lengths, d0)];
    let mut w = vec![width(d0)];
    for k in 0..path.len() {
        if lengths[k] > d0 && lengths[k] < d1 {
            p.push(path[k]);
            w.push(widths[k]);
        }
    }
    p.push(along(path, lengths, d1));
    w.push(width(d1));
    (p, w)
}

/// Same raster closing as above, on a row-major grid: a cell becomes `value`
/// when any cell within `r` cells (square) has it.
fn spread(on: &[bool], nx: usize, ny: usize, r: usize, value: bool) -> Vec<bool> {
    let mut rows = vec![!value; on.len()];
    let mut prefix = vec![0usize; nx.max(ny) + 1];
    for y in 0..ny {
        for x in 0..nx {
            prefix[x + 1] = prefix[x] + usize::from(on[y * nx + x] == value);
        }
        for x in 0..nx {
            if prefix[(x + r + 1).min(nx)] > prefix[x.saturating_sub(r)] {
                rows[y * nx + x] = value;
            }
        }
    }
    let mut out = vec![!value; on.len()];
    for x in 0..nx {
        for y in 0..ny {
            prefix[y + 1] = prefix[y] + usize::from(rows[y * nx + x] == value);
        }
        for y in 0..ny {
            if prefix[(y + r + 1).min(ny)] > prefix[y.saturating_sub(r)] {
                out[y * nx + x] = value;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::super::{LayoutConfig, generate_quarters, geometry as g};
    use super::*;

    const WIDTH: f64 = 6000.0;

    fn flat() -> (Vec<f32>, Vec<u8>) {
        let n = 128;
        (vec![10.0; n * n], vec![0u8; n * n])
    }
    fn site(key: &str, population: u32, x: f64, y: f64) -> Site {
        Site {
            key: key.into(), name: String::new(), population, culture: "european-organic".into(),
            center: Point { x, y }, radius: crate::settlements::extent_radius(population), neighbours: vec![],
        }
    }
    fn road() -> Street {
        Street { path: vec![Point { x: 200.0, y: 3000.0 }, Point { x: 5800.0, y: 3000.0 }], widths: vec![6.0, 6.0], rank: 0, role: "regional".into() }
    }
    fn town(s: &Site, height: &[f32], water: &[u8]) -> Layout {
        let surface = Surface { geometry: None, width: WIDTH, n: 128, height, water, interpolation: Default::default() };
        generate_quarters("neighbours", std::slice::from_ref(s), &LayoutConfig::default(), surface, &[road()])
            .expect("layout").remove(0)
    }
    fn overlap(layout: &Layout, claim: &Claim) -> f64 {
        layout.blocks.iter().map(|b| claim.land.iter().map(|l| g::intersection(&b.shape, l).iter().map(g::area).sum::<f64>()).sum::<f64>()).sum()
    }
    fn on_claim_street(p: Point, claim: &Claim) -> bool {
        claim.streets.iter().any(|s| s.path.windows(2).any(|w| g::distance(p, w[0], w[1]).0 < 0.5))
    }
    fn built(layout: &Layout) -> usize {
        layout.blocks.iter().filter(|b| b.kind != "reserve").count()
    }

    #[test]
    fn a_subcell_change_to_a_block_keeps_the_opposite_claim_edge() {
        let outline = |west| {
            let block = g::rectangle(west, 21.0, 171.0, 120.0);
            Raster::new(&[&block]).unwrap().outline()
        };
        let original = outline(20.1);
        assert!(!original.is_empty());
        assert_eq!(original, outline(20.1 + 0.000_001));
    }

    #[test]
    fn a_second_town_keeps_off_the_first_and_joins_its_streets() {
        let (height, water) = flat();
        let first = town(&site("first", 3000, 2800.0, 3000.0), &height, &water);
        let claim = first.claim.clone();
        assert!(!claim.land.is_empty() && !claim.streets.is_empty(), "claim of the first town");
        let mut second = site("second", 3000, 3180.0, 3000.0);
        second.neighbours = vec![claim.clone()];
        let layout = town(&second, &height, &water);
        assert!(overlap(&layout, &claim) < 1.0, "blocks on the first town's land: {:.0} m²", overlap(&layout, &claim));
        assert!(layout.enclosures.iter().all(|e| e.path.iter().all(|&p| !claim.land.iter().any(|l| g::contains(l, p)))));
        assert!(layout.streets.iter().any(|s| s.path.first().into_iter().chain(s.path.last()).any(|&p| on_claim_street(p, &claim))),
            "no street of the second town ends on an edge street of the first");
        assert!(built(&layout) > 0);
        let short = layout.structure.as_ref().is_some_and(|s| s.metrics.shortfall_area > 0.02 * s.metrics.target_area);
        assert!(!short || has_neighbour_warning(&layout) || layout.warnings.iter().any(|w| w.starts_with("Town land ")),
            "{:?}", layout.warnings);
    }

    #[test]
    fn a_centre_inside_a_neighbour_moves_to_free_ground() {
        let (height, water) = flat();
        let first = town(&site("first", 3000, 2800.0, 3000.0), &height, &water);
        let claim = first.claim.clone();
        let mut second = site("inside", 1500, 2800.0, 3000.0);
        second.neighbours = vec![claim.clone()];
        let layout = town(&second, &height, &water);
        assert!(!claim.land.iter().any(|l| g::contains(l, layout.center)), "centre {:?} on the first town", layout.center);
        assert!(overlap(&layout, &claim) < 1.0);
        assert!(built(&layout) > 0 || has_neighbour_warning(&layout));
    }

    #[test]
    fn a_boxed_in_town_warns_and_does_not_panic() {
        let (height, water) = flat();
        let c = Point { x: 3000.0, y: 3000.0 };
        // Land all round a 30 m pocket.
        let ring = |r: f64| (0..32).map(|k| { let a = k as f64 * std::f64::consts::TAU / 32.0; Point { x: c.x + r * a.cos(), y: c.y + r * a.sin() } }).collect::<Vec<_>>();
        let mut hole = ring(30.0);
        hole.reverse();
        let claim = Claim { key: "around".into(), land: vec![Shape { outer: ring(2500.0), holes: vec![hole] }], streets: vec![], reserve: None };
        let mut boxed = site("boxed", 500, c.x, c.y);
        boxed.neighbours = vec![claim.clone()];
        let layout = town(&boxed, &height, &water);
        assert!(overlap(&layout, &claim) < 1.0);
        assert!(has_neighbour_warning(&layout), "{:?}", layout.warnings);
    }

    fn has_neighbour_warning(layout: &Layout) -> bool {
        layout.warnings.iter().any(|w| {
            w.contains(" — land claimed by ") || w.starts_with("No wall — neighbour too close")
        })
    }

    #[test]
    fn a_large_town_leaves_a_later_village_its_homes() {
        // The town comes first in the canonical order and receives the village
        // as a reserve; the village then grows against the town's claim and
        // houses as many households as it does alone. A nucleated village, so
        // the check does not depend on the street-village grammar.
        let (height, water) = flat();
        let surface = Surface { geometry: None, width: WIDTH, n: 128, height: &height, water: &water, interpolation: Default::default() };
        let cfg = LayoutConfig { settlement_form: "nucleated".into(), ..LayoutConfig::default() };
        let lay = |s: &Site| generate_quarters("neighbours", std::slice::from_ref(s), &cfg, surface, &[road()]).expect("layout").remove(0);
        let housed = |l: &Layout| super::super::slopes::households("neighbours", l).expect("village cadastre").1;
        let big_site = site("big", 12000, 2000.0, 3000.0);
        let village_site = site("village", 150, 2000.0 + 1.5 * big_site.radius, 3000.0);
        let alone = housed(&lay(&village_site));
        let mut big = big_site.clone();
        big.neighbours = vec![Claim { key: "village".into(), land: vec![], streets: vec![], reserve: Some(Reserve {
            population: 150, culture: village_site.culture.clone(), center: village_site.center, radius: village_site.radius }) }];
        let core = reserve_cores("neighbours", &big, &cfg, surface, &[road()]).expect("reserved core").neighbours.remove(0).land;
        assert!(core.iter().any(|l| g::contains(l, village_site.center)), "no core around the village");
        let town_layout = lay(&big);
        let inside: f64 = town_layout.blocks.iter()
            .map(|b| core.iter().map(|l| g::intersection(&b.shape, l).iter().map(g::area).sum::<f64>()).sum::<f64>()).sum();
        assert!(inside < 1.0, "the town builds {inside:.0} m² inside the village's core");
        let mut village = village_site.clone();
        village.neighbours = vec![town_layout.claim.clone()];
        let layout = lay(&village);
        let beside = housed(&layout);
        assert!(alone > 0.0 && beside >= 0.95 * alone, "village housed {beside:.0} households beside the town, {alone:.0} alone; {:?}", layout.warnings);
    }

    #[test]
    fn without_neighbours_the_layout_is_unchanged_apart_from_its_claim() {
        // Identity by construction: every entry point returns on an empty
        // `neighbours`. The run twice gives the same layout, and the claim
        // is the only field added to it.
        let (height, water) = flat();
        let s = site("alone", 3000, 3000.0, 3000.0);
        let a = town(&s, &height, &water);
        assert!(Mask::of(&s).is_none() && relocate(&s, Surface { geometry: None, width: WIDTH, n: 128, height: &height, water: &water, interpolation: Default::default() }).is_none());
        assert!(roads(&s, &[road()]).is_none() && forbidden(&s).is_empty() && clear(&s, s.center));
        let b = town(&s, &height, &water);
        let strip = |l: &Layout| { let mut v = serde_json::to_value(l).unwrap(); v.as_object_mut().unwrap().remove("claim"); v };
        assert_eq!(strip(&a), strip(&b));
        assert!(!a.claim.land.is_empty());
    }

    #[test]
    fn the_outline_closes_blocks_across_streets() {
        let blocks = [g::rectangle(0.0, 0.0, 50.0, 50.0), g::rectangle(58.0, 0.0, 108.0, 50.0)];
        let raster = Raster::new(&blocks.iter().collect::<Vec<_>>()).unwrap();
        let land = raster.outline();
        assert_eq!(land.len(), 1, "{land:?}");
        assert!(blocks.iter().all(|b| g::contains(&land[0], g::centroid(b))));
        let area = g::area(&land[0]);
        assert!(area > 108.0 * 50.0 && area < 120.0 * 62.0, "{area}");
        let street = Street { path: vec![Point { x: 25.0, y: 25.0 }, Point { x: 25.0, y: 200.0 }], widths: vec![5.0, 5.0], rank: 2, role: "street".into() };
        let stubs = raster.stubs(&[street]);
        assert_eq!(stubs.len(), 1);
        assert!(stubs[0].path.last().unwrap().y > 60.0);
    }
}
