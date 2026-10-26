//! Camps and tribal villages planned without streets (catalogue
//! `campLayout`, opt-in per culture): the settlement is one quarter crossed
//! only by its regional roads (`macroplan` skips the street armature), and its
//! land is laid out here as the culture builds it:
//! - `ring` — a central enclosure ringed by rows of round dwellings, each row
//!   fronting a ring path on its inner side: the kraal (umuzi: beehive huts in
//!   a horseshoe around the cattle byre, the great hut at the back facing the
//!   entrance, a thorn hedge around all), the Plains camp circle (one great
//!   circle of lodges open to the east, the council ground in the middle), the
//!   Mongol ordu (rings of gers around the khan's compound, lanes to the four
//!   quarters, open to the south) and the plaza village (a few huge communal
//!   houses around the dance ground, Guarani tekoha);
//! - `rows` — a lattice of long lots in parallel rows, paths between the rows
//!   (Iroquoian longhouses, Northwest Coast plank houses along the beach).
//!
//! Clustered villages without a camp plan (Maori pā, Inuit winter camp) use
//! the organic cut (`parcellation: organic`) on footpath-wide streets.
//!
//! Correct by construction: every cell is the intersection of the block with
//! one tile of a global tessellation of the plane (concentric regular discs ×
//! angular wedges, or a rectangular lattice), the paths are cut from them, so
//! the pieces partition the block exactly and lots of neighbouring blocks
//! (split by a regional road) continue the same rings. The tessellation is
//! derived from the layout only (centre, blocks, streets, key), never from the
//! block, so every block call sees the same camp.
use super::super::geometry::{bbox, ribbon, union};
use super::*;
use std::f64::consts::{PI, TAU};

#[path = "camp_forms.rs"]
mod forms;

/// Whether the block's culture lays its land out as a camp.
pub(super) fn enabled(morph: &Morph) -> bool {
    !morph.text("campLayout").is_empty()
}

/// Camp lots of one block, plus the path parcels between them (their rings
/// are pushed to `fronts` as shared, gated fronts).
pub(super) fn lots(
    shape: &Shape,
    block: usize,
    axis: Point,
    fronts: &mut Vec<Front>,
    morph: &Morph,
    layout: &Layout,
) -> Vec<Parcel> {
    let frame = Frame::of(layout);
    let tiles = match morph.text("campLayout") {
        "rows" => rows(&frame, morph, layout),
        _ if !morph.text("campForm").is_empty() => forms::tiles(&frame, morph, layout),
        _ => ring(&frame, morph, layout),
    };
    let index = FrontageIndex::new(layout);
    let reached = regional_streets(layout);
    assemble_with_contacts(shape, block, axis, fronts, morph, tiles, |path| {
        contacts::street_contacts(path, layout, &index).into_iter()
            .filter(|f| reached.get(f.street).copied().unwrap_or(false)).collect()
    })
}

/// What a tile of the camp holds.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Hold {
    /// One dwelling (a hut, a tent, a long house).
    Dwelling,
    /// The head's dwelling (great hut, khan's compound): a larger lot.
    Head,
    /// The central enclosure: cattle byre, dance ground, council ground.
    Centre,
    /// Open ground (the horseshoe's opening, the fields inside the hedge).
    Open,
}

struct Tile {
    shape: Shape,
    hold: Hold,
    /// Nominal area: a clipped tile keeps its dwelling only while it holds
    /// most of it.
    nominal: f64,
    /// The tile is crossed by a path (a lane): cut it out.
    cut: bool,
}

/// The camp's global frame, shared by all blocks of the layout.
struct Frame {
    centre: Point,
    /// Farthest block corner from the centre.
    reach: f64,
    /// Nearest block land from the centre (0 when the centre stands on land).
    inner: f64,
    /// Radius of a disc of the blocks' total area.
    equivalent: f64,
    key: String,
}

impl Frame {
    fn of(layout: &Layout) -> Frame {
        // The camp stands in the middle of its land: the blocks' centroid.
        let blocks = layout.blocks.iter().filter(|b| b.kind == "block");
        let (mut sx, mut sy, mut sa) = (0.0, 0.0, 0.0);
        for b in blocks.clone() {
            let (a, c) = (area(&b.shape), super::super::geometry::centroid(&b.shape));
            (sx, sy, sa) = (sx + a * c.x, sy + a * c.y, sa + a);
        }
        let centre = if sa > 1.0 {
            Point {
                x: sx / sa,
                y: sy / sa,
            }
        } else {
            layout.center
        };
        let (mut reach, mut inner, mut total) = (0.0_f64, f64::INFINITY, 0.0);
        for b in blocks {
            total += area(&b.shape);
            let ring = &b.shape.outer;
            let mut near = f64::INFINITY;
            for k in 0..ring.len() {
                let (p, q) = (ring[k], ring[(k + 1) % ring.len()]);
                reach = reach.max(length(sub(p, centre)));
                near = near.min(distance(centre, p, q));
            }
            if super::super::geometry::contains(&b.shape, centre) {
                near = 0.0;
            }
            inner = inner.min(near);
        }
        Frame {
            centre,
            reach: reach.max(10.0),
            inner: if inner.is_finite() { inner } else { 0.0 },
            equivalent: (total / PI).sqrt().max(10.0),
            key: layout.key.clone(),
        }
    }
    fn at(&self, angle: f64, r: f64) -> Point {
        Point {
            x: self.centre.x + r * angle.cos(),
            y: self.centre.y + r * angle.sin(),
        }
    }
    /// Vertex count of the regular polygon standing for the circle of radius
    /// `r` (one vertex every ~5 m, 10 cm off the circle at 30 m), the same
    /// phase for every radius.
    fn sides(r: f64) -> usize {
        ((TAU * r / 5.0).round() as usize).clamp(24, 240)
    }
    fn disc(&self, r: f64) -> Shape {
        let n = Self::sides(r);
        Shape {
            outer: (0..n)
                .map(|i| self.at(i as f64 * TAU / n as f64, r))
                .collect(),
            holes: vec![],
        }
    }
    /// Point of the disc polygon of radius `r` on the ray at angle `a`: on
    /// its chord, so sectors cut exactly along the polygon's edges.
    fn on_disc(&self, r: f64, a: f64) -> Point {
        let step = TAU / Self::sides(r) as f64;
        let i = (a / step).floor();
        let (p, q) = (self.at(i * step, r), self.at((i + 1.0) * step, r));
        let d = Point {
            x: a.cos(),
            y: a.sin(),
        };
        let (e, w) = (sub(q, p), sub(p, self.centre));
        // centre + t d = p + s e  ->  t = cross(w, e) / cross(d, e)
        let t = (w.x * e.y - w.y * e.x) / (d.x * e.y - d.y * e.x);
        add(self.centre, scale(d, t))
    }
    /// The disc polygon's boundary from angle `a0` to `a1` at radius `r`.
    fn arc(&self, r: f64, a0: f64, a1: f64) -> Vec<Point> {
        let step = TAU / Self::sides(r) as f64;
        let mut pts = vec![self.on_disc(r, a0)];
        let mut i = (a0 / step).floor() + 1.0;
        while i * step < a1 - 1e-9 {
            if i * step > a0 + 1e-9 {
                pts.push(self.at(i * step, r));
            }
            i += 1.0;
        }
        pts.push(self.on_disc(r, a1));
        pts
    }
    /// Annular sector between the disc polygons of radii `r0` < `r1`, from
    /// `a0` to `a1` (counter-clockwise): built along the discs' own edges, so
    /// sectors tile their annulus exactly without a boolean operation.
    fn sector(&self, r0: f64, r1: f64, a0: f64, a1: f64) -> Shape {
        let mut outer = self.arc(r1, a0, a1);
        let mut inner = self.arc(r0, a0, a1);
        inner.reverse();
        outer.extend(inner);
        Shape {
            outer,
            holes: vec![],
        }
    }
}

/// Share of a camp's laid dwelling cells that end as admitted hut plots: a
/// cell clipped by the hedge or a road, cut by a footpath or merged with its
/// neighbour to hold the culture's compact house is lost (about a third on a
/// kraal crossed by its road, measured on the s3 P01 replays).
const ADMITTED: f64 = 0.8;

/// Narrowest street contact (m) that anchors a camp lane to its road.
const GATE_MIN: f64 = 2.0;

/// Dwelling cells the camp's programme fills: its households (one per cell,
/// or as many as a cell of `nominal` m² holds at the programme's own area per
/// household) and its facilities sited on a plot, over the `ADMITTED` share.
/// The camp lays out no more rows than this: the land beyond stays open
/// ground, never rings of empty lots. `None` without a programme (a capacity
/// probe): the land sets the rows.
fn need(layout: &Layout, nominal: f64) -> Option<usize> {
    let programme = layout.programme.as_ref()?;
    let mut cells = 0.0;
    for d in &programme.demands {
        if d.unit == "domesticUnits" {
            if d.requested > 0.0 {
                let per = (d.target_area / d.requested).max(1.0);
                cells += (d.requested / (nominal / per).floor().max(1.0)).ceil();
            }
        } else if d.placement == "parcel" {
            cells += d.sites.max(1) as f64;
        }
    }
    (cells > 0.0).then(|| (cells / ADMITTED).ceil() as usize + 1)
}

/// Whether `p` stands on the camp's land (one of the layout's blocks).
fn on_land(layout: &Layout, p: Point) -> bool {
    layout
        .blocks
        .iter()
        .any(|b| b.kind == "block" && super::super::geometry::contains(&b.shape, p))
}

/// Bearing of the camp's opening: a compass point, or toward the nearest
/// regional road (the kraal opens to its approach).
fn opening(frame: &Frame, morph: &Morph, layout: &Layout) -> f64 {
    match morph.text("campOpening") {
        "east" => 0.0,
        "south" => 0.5 * PI,
        "west" => PI,
        "north" => -0.5 * PI,
        _ => {
            let c = frame.centre;
            layout
                .streets
                .iter()
                .filter(|s| s.rank <= 1 || s.role == "regional")
                .flat_map(|s| s.path.windows(2))
                .map(|w| super::super::geometry::distance(c, w[0], w[1]))
                .filter(|d| d.0 > 1.0)
                .min_by(|a, b| a.0.total_cmp(&b.0))
                .map_or_else(
                    || Rng::new(&format!("camp-opening:{}", frame.key)).range(0.0, TAU),
                    |d| (d.2.y - c.y).atan2(d.2.x - c.x),
                )
        }
    }
}

/// Rows of dwellings around a central enclosure.
fn ring(frame: &Frame, morph: &Morph, layout: &Layout) -> (Vec<Tile>, Vec<Shape>) {
    let mut rng = Rng::new(&format!("camp-ring:{}", frame.key));
    let depth = morph.number_or("campRow", 10.0).max(4.0);
    let [arc_lo, arc_hi] = morph.pair("campArc");
    let (arc_lo, arc_hi) = (arc_lo.max(4.0), arc_hi.max(arc_lo.max(4.0)));
    let path = morph.number_or("campPath", 3.0).clamp(1.2, 8.0);
    let gap = morph
        .number_or("campGap", 0.0)
        .clamp(0.0, 150.0)
        .to_radians();
    let max_rows = morph.number_or("campRings", 0.0).max(0.0) as usize;
    let lanes = morph.number_or("campLanes", 1.0).clamp(0.0, 8.0) as usize;
    let head = morph.text("campHead");
    let beta = opening(frame, morph, layout);
    // The centre: a share of the camp; where the land already rings an open
    // centre (a camp drawn as a band), the first row starts at the land. A
    // road through the middle is no open centre: the gap is its ribbon, and
    // the byre or ground still takes its share of the camp across it.
    let road_through = layout
        .streets
        .iter()
        .flat_map(|s| s.path.windows(2))
        .any(|w| distance(frame.centre, w[0], w[1]) < frame.inner + 0.5);
    let centre_r = if frame.inner > path && !road_through {
        frame.inner - path
    } else {
        morph.number_or("campCentre", 0.3) * frame.equivalent
    }
    .max(6.0);
    let mean = 0.5 * (arc_lo + arc_hi);
    let span = TAU - gap;
    let gap1 = beta + 0.5 * gap;
    // Rows go out until they hold the programme's dwellings (cells on land).
    let need = need(layout, depth * mean);
    let mut held = 0;
    let mut radii = vec![centre_r];
    let mut r = centre_r;
    while r + path + 0.5 * depth < frame.reach
        && (max_rows == 0 || radii.len() <= max_rows)
        && need.is_none_or(|n| held < n)
    {
        let mid = r + path + 0.5 * depth;
        let n = ((span * mid / mean).floor() as usize).max(3);
        held += (0..n)
            .filter(|&i| on_land(layout, frame.at(gap1 + (i as f64 + 0.5) * span / n as f64, mid)))
            .count();
        r += path + depth;
        radii.push(r);
    }
    // Lanes: radial paths from the centre's edge out through every row (the
    // centre keeps its own fence unless it is the open ground).
    let from = if morph.text("campCentreUse") == "place" {
        0.0
    } else {
        centre_r
    };
    let bearings: Vec<f64> = (0..lanes)
        .map(|l| beta + l as f64 * TAU / lanes as f64)
        .collect();
    let mut paths: Vec<Shape> = bearings
        .iter()
        .flat_map(|&a| {
            ribbon(
                &[frame.at(a, from), frame.at(a, 2.0 * frame.reach + 20.0)],
                &[path],
            )
        })
        .collect();
    // Whether the sector [a0, a1] from radius r reaches a lane.
    let crossed = |a0: f64, a1: f64, r: f64| {
        let half = path / r.max(1.0);
        bearings.iter().any(|&b| {
            let rel = (b - a0).rem_euclid(TAU);
            rel < a1 - a0 + half || rel > TAU - half
        })
    };
    let mut tiles = vec![Tile {
        shape: frame.disc(centre_r),
        hold: Hold::Centre,
        nominal: 0.0,
        // Open central grounds also give up the lanes crossing them. A place
        // and its footpath are distinct parcels in the same exact partition.
        cut: lanes > 0,
    }];
    let gap0 = beta - 0.5 * gap;
    // Dwelling cells: (row, angle from the back, tile, middle).
    let mut dwellings = vec![];
    for k in 0..radii.len() - 1 {
        // The ring path on the inner side of row k, then the row itself.
        let (ri, ro) = (radii[k] + path, radii[k + 1]);
        paths.extend(difference(&frame.disc(ri), &frame.disc(radii[k])));
        let mid = 0.5 * (ri + ro);
        let n = ((span * mid / mean).floor() as usize).max(3);
        let step = span / n as f64;
        // Wedge bounds over the rows' arc, a little jitter, the head's
        // dwelling (two cells wide) at the back of the first row.
        let mut bounds: Vec<f64> = (0..=n)
            .map(|i| {
                let j = if i == 0 || i == n {
                    0.0
                } else {
                    rng.range(-0.15, 0.15) * step
                };
                gap1 + i as f64 * step + j
            })
            .collect();
        let mut head_at = None;
        if k == 0 && head == "back" && n >= 6 {
            let i = ((0.5 * span / step).round() as usize).clamp(1, n - 1);
            bounds.remove(i);
            head_at = Some(i - 1);
        }
        let nominal = depth * mean;
        for (i, w) in bounds.windows(2).enumerate() {
            let hold = if head_at == Some(i) {
                Hold::Head
            } else {
                Hold::Dwelling
            };
            if hold == Hold::Dwelling {
                let a = 0.5 * (w[0] + w[1]);
                let from_back = (a - beta - PI).rem_euclid(TAU);
                let at = frame.at(a, 0.5 * (ri + ro));
                dwellings.push((k, from_back.min(TAU - from_back), tiles.len(), at));
            }
            tiles.push(Tile {
                shape: frame.sector(ri, ro, w[0], w[1]),
                hold,
                nominal: nominal * if hold == Hold::Head { 2.0 } else { 1.0 },
                cut: crossed(w[0], w[1], ri),
            });
        }
        if gap > 0.0 {
            // The opening of the horseshoe: open ground between its horns.
            for (a0, a1) in [(gap0, beta), (beta, gap1)] {
                tiles.push(Tile {
                    shape: frame.sector(ri, ro, a0, a1),
                    hold: Hold::Open,
                    nominal: 0.0,
                    cut: crossed(a0, a1, ri),
                });
            }
        }
    }
    // The rows hold the programme's dwellings, the inner rows first, then
    // the last row from the back toward the opening: its horns beyond the
    // need are open ground, never empty lots.
    if let Some(n) = need {
        dwellings.retain(|d| on_land(layout, d.3));
        dwellings.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.total_cmp(&b.1)));
        for d in dwellings.iter().skip(n) {
            tiles[d.2].hold = Hold::Open;
        }
    }
    // Land beyond the last row: open ground inside the camp's fence.
    let far = 2.0 * frame.reach + 100.0;
    let square = super::super::geometry::rectangle(
        frame.centre.x - far,
        frame.centre.y - far,
        frame.centre.x + far,
        frame.centre.y + far,
    );
    for piece in difference(&square, &frame.disc(radii[radii.len() - 1])) {
        tiles.push(Tile {
            shape: piece,
            hold: Hold::Open,
            nominal: 0.0,
            cut: lanes > 0,
        });
    }
    (tiles, paths)
}

/// A lattice of long lots in parallel rows along the camp's axis, a path
/// between every two columns (the long houses' ends open onto it).
fn rows(frame: &Frame, morph: &Morph, layout: &Layout) -> (Vec<Tile>, Vec<Shape>) {
    let rng = Rng::new(&format!("camp-rows:{}", frame.key));
    // The axis of the largest block: the quarter field's orientation (road,
    // terrain or shore), the same for every block.
    let u = layout
        .blocks
        .iter()
        .filter(|b| b.kind == "block")
        .max_by(|a, b| area(&a.shape).total_cmp(&area(&b.shape)))
        .map(|b| unit(b.axis))
        .filter(|a| length(*a) > 0.5)
        .unwrap_or(Point { x: 1.0, y: 0.0 });
    let n = Point { x: -u.y, y: u.x };
    let [len_lo, len_hi] = morph.pair("campRowLength");
    let (len_lo, len_hi) = (len_lo.max(8.0), len_hi.max(len_lo.max(8.0)));
    let across = morph.number_or("campRow", 12.0).max(4.0);
    let path = morph.number_or("campPath", 3.0).clamp(1.2, 8.0);
    let max_rows = morph.number_or("campRings", 0.0).max(0.0) as usize;
    let reach = frame.reach + 10.0;
    let to = |s: f64, t: f64| add(frame.centre, add(scale(u, s), scale(n, t)));
    let rect = |s0: f64, s1: f64, t0: f64, t1: f64| Shape {
        outer: vec![to(s0, t0), to(s1, t0), to(s1, t1), to(s0, t1)],
        holes: vec![],
    };
    // Column bounds along the axis, from the centre outward both ways; each
    // column has its own house length (a path at every bound).
    let mut bounds = vec![-0.5 * path];
    let mut s = -0.5 * path;
    let mut k = 0;
    while s < reach {
        s += path + rng.fork(&format!("col+{k}")).range(len_lo, len_hi);
        bounds.push(s);
        k += 1;
    }
    let mut s = -0.5 * path;
    let mut k = 0;
    while s > -reach {
        s -= path + rng.fork(&format!("col-{k}")).range(len_lo, len_hi);
        bounds.insert(0, s);
        k += 1;
    }
    let half_rows = if max_rows == 0 {
        (reach / across).ceil() as i64 + 1
    } else {
        max_rows.div_ceil(2) as i64
    };
    let (t_lo, t_hi) = if max_rows == 0 || max_rows % 2 == 0 {
        (-(half_rows as f64) * across, half_rows as f64 * across)
    } else {
        (
            -(half_rows as f64 - 0.5) * across,
            (half_rows as f64 - 0.5) * across,
        )
    };
    let mut tiles = vec![];
    let mut paths = vec![];
    for w in bounds.windows(2) {
        // The path at the column's start, then its lots.
        paths.push(rect(w[0], w[0] + path, -reach, reach));
        let (s0, s1) = (w[0] + path, w[1]);
        let rows = ((t_hi - t_lo) / across).round() as usize;
        for j in 0..rows {
            let t0 = t_lo + j as f64 * across;
            tiles.push(Tile {
                shape: rect(s0, s1, t0 + path, t0 + across),
                hold: Hold::Dwelling,
                nominal: (s1 - s0) * (across - path),
                cut: false,
            });
        }
        // Beyond the rows: open ground (the fields inside the palisade).
        tiles.push(Tile {
            shape: rect(s0, s1, -reach, t_lo),
            hold: Hold::Open,
            nominal: 0.0,
            cut: false,
        });
        tiles.push(Tile {
            shape: rect(s0, s1, t_hi + path, reach),
            hold: Hold::Open,
            nominal: 0.0,
            cut: false,
        });
    }
    // An alley along every row (the houses' long sides), the last one
    // closing the rows: with the cross paths, one grid reaching every side of
    // the block, so every lot's path leads to the block's streets.
    let rows = ((t_hi - t_lo) / across).round() as usize;
    for j in 0..=rows {
        let t0 = t_lo + j as f64 * across;
        paths.push(rect(-reach - path, reach + path, t0, t0 + path));
    }
    // The lots nearest the centre hold the programme's dwellings; the rest
    // of the lattice is open ground (the fields inside the palisade).
    let mean = 0.5 * (len_lo + len_hi) * (across - path);
    if let Some(n) = need(layout, mean) {
        let mut lots: Vec<(f64, usize)> = tiles
            .iter()
            .enumerate()
            .filter(|(_, t)| t.hold == Hold::Dwelling)
            .map(|(i, t)| (super::super::geometry::centroid(&t.shape), i))
            .filter(|&(c, _)| on_land(layout, c))
            .map(|(c, i)| (length(sub(c, frame.centre)), i))
            .collect();
        lots.sort_by(|a, b| a.0.total_cmp(&b.0));
        for &(_, i) in lots.iter().skip(n) {
            tiles[i].hold = Hold::Open;
        }
    }
    let (first, last) = (bounds[0], *bounds.last().unwrap());
    tiles.push(Tile {
        shape: rect(first - reach, first, -reach, reach),
        hold: Hold::Open,
        nominal: 0.0,
        cut: true,
    });
    tiles.push(Tile {
        shape: rect(last, last + reach, -reach, reach),
        hold: Hold::Open,
        nominal: 0.0,
        cut: true,
    });
    (tiles, paths)
}

fn boxes_overlap(a: (f64, f64, f64, f64), b: (f64, f64, f64, f64)) -> bool {
    a.0 <= b.2 && b.0 <= a.2 && a.1 <= b.3 && b.1 <= a.3
}

/// Same 0.1mm junction keys as the existing final planar street graph.
/// This only checks existing connectivity: no snapping or street edit occurs.
fn regional_streets(layout: &Layout) -> Vec<bool> {
    use std::collections::{BTreeMap,BTreeSet};
    let key=|p:Point| ((p.x*10000.).round() as i64,(p.y*10000.).round() as i64);
    let mut members:BTreeMap<(i64,i64),Vec<usize>>=BTreeMap::new();
    for (i,s) in layout.streets.iter().enumerate() {
        for &p in &s.path { members.entry(key(p)).or_default().push(i); }
    }
    let mut reached=vec![false;layout.streets.len()];let mut queue=vec![];
    for (i,s) in layout.streets.iter().enumerate() {
        if s.role=="regional" && s.path.len()>1 {reached[i]=true;queue.push(i);}
    }
    let mut visited=BTreeSet::new();
    while let Some(i)=queue.pop() {
        for &p in &layout.streets[i].path {
            let k=key(p);if !visited.insert(k) {continue;}
            for &j in &members[&k] {
                if !reached[j] && layout.streets[j].path.len()>1 {reached[j]=true;queue.push(j);}
            }
        }
    }
    reached
}
fn reversed(p:&Shape)->Shape {
    let mut r=p.clone();r.outer.reverse();for h in &mut r.holes {h.reverse();}r
}
/// Eligibility is directional (the original path outer side). Certification
/// is per actual clipped connected component and a genuine street contact.
fn connected_path_fronts(
    block:&Shape, paths:&[Shape], eligible:&[Front],
    native_contacts:impl Fn(&Shape)->Vec<Front>, required_width:f64,
)->Vec<Front> {
    let mut result=vec![];
    for p in paths {
        if !difference(p,block).is_empty() {continue;}
        let entries=native_contacts(p);
        let anchor=entries.iter().enumerate().filter(|(_,f)|!f.shared)
            .filter(|(i,_)| { let (lo,hi)=contacts::support_span(&entries,*i);hi-lo>=required_width
                || contact_run(&entries,*i)>=required_width })
            .min_by_key(|(_,f)|(f.rank,f.street)).map(|(_,f)|*f);
        let Some(anchor)=anchor else {continue;};
        result.extend(contacts::boundary_contacts(&reversed(p),eligible).into_iter().map(|f|Front{
            street:anchor.street,rank:anchor.rank+1,shared:true,gate:true,..f
        }));
    }
    result
}
/// Length of the run of contacts with one street through `anchor`, its
/// pieces joined across hair gaps (≤ 5 cm). A block vertex on the street
/// edge splits a path's contact into pieces a few millimetres apart, or a
/// zero-length piece without direction: each alone narrower than the path,
/// they would leave a ring crossing the road unanchored, its row unserved.
fn contact_run(entries:&[Front], anchor:usize)->f64 {
    const HAIR:f64=0.05;
    let f=entries[anchor];
    let same=|g:&Front| g.street==f.street && g.rank==f.rank && !g.shared;
    let mut run=vec![anchor];
    let mut k=0;
    while k<run.len() {
        let c=entries[run[k]];
        for (j,g) in entries.iter().enumerate() {
            if !run.contains(&j) && same(g)
                && [(c.a,g.a),(c.a,g.b),(c.b,g.a),(c.b,g.b)].iter().any(|&(p,q)| length(sub(p,q))<=HAIR)
            {
                run.push(j);
            }
        }
        k+=1;
    }
    run.iter().map(|&j| length(sub(entries[j].b,entries[j].a))).sum()
}
fn without_existing_paths(links:Vec<Shape>, paths:&[Shape])->Vec<Shape> {
    links.into_iter().flat_map(|link| {
        let mut rest=vec![link];
        for p in paths {
            rest=rest.into_iter().flat_map(|q| {
                if boxes_overlap(bbox(&q),bbox(p)) {difference(&q,p)} else {vec![q]}
            }).collect();if rest.is_empty(){break;}
        }
        rest
    }).collect()
}

/// Existing construction classification, shared by final emission and the
/// effective-open ownership check. No size threshold changes here.
fn dwelling_fits(a:f64, nominal:f64)->bool {
    a >= (0.45 * nominal).min(250.0) && a >= 30.0
}

/// Assign only the uncovered part of discarded path caps to a contiguous
/// EXISTING open cell. If there is no such cell, preserve the old geometry;
/// the parent's partition diagnostics still expose the unresolved deficit.
fn assign_open_ground_caps(block: &Shape, cells: &mut [(Shape, Hold, f64)], rejected: &[Shape]) -> usize {
    let mut unassigned = 0;
    for cap in rejected {
        let mut missing = vec![cap.clone()];
        // A radial cap may already belong to a tile; never claim that land a
        // second time or take it from its existing owner.
        for (owned, _, _) in cells.iter() {
            let ob = bbox(owned);
            missing = missing.into_iter().flat_map(|p| {
                if boxes_overlap(bbox(&p), ob) { difference(&p, owned) }
                else { vec![p] }
            }).collect();
            if missing.is_empty() { break; }
        }
        for fragment in missing {
            let fb = bbox(&fragment);
            let mut owners: Vec<_> = cells.iter().enumerate()
                .filter(|(_, (p, hold, nominal))| {
                    // Clipped dwelling/head tiles failing the EXISTING final
                    // size gate already emit camp-open, not a dwelling. They
                    // are eligible without reclassifying any buildable cell.
                    let open = *hold == Hold::Open ||
                        (matches!(*hold, Hold::Dwelling | Hold::Head) && !dwelling_fits(area(p), *nominal));
                    open && boxes_overlap(bbox(p), fb)
                })
                .map(|(i, (p, _, _))| (i, shared(p, &fragment)))
                .collect();
            owners.sort_by(|a,b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
            let attached = owners.into_iter().find_map(|(i, _)| {
                // Do not use joined(): its conform/snap fallback would bridge
                // a real gap. This is only an ordinary set union.
                let mut joined = union(&[cells[i].0.clone(), fragment.clone()]);
                if joined.len() != 1 { return None; }
                let whole = joined.pop().unwrap();
                if !super::super::geometry::simple(&whole)
                    || !difference(&cells[i].0, &whole).is_empty()
                    || !difference(&fragment, &whole).is_empty()
                    || !difference(&whole, block).is_empty()
                { return None; }
                Some((i, whole))
            });
            if let Some((i, whole)) = attached {
                cells[i].0 = whole;
                // This was already non-built land before the union. Even if
                // its small addition crosses a size threshold, never turn the
                // restored cap into a newly buildable dwelling or capacity.
                cells[i].1 = Hold::Open;
            }
            else { unassigned += 1; }
        }
    }
    unassigned
}

/// The block's share of the tessellation: tiles clipped to the block, the
/// paths cut from them, clipped tiles too small for their dwelling opened.
#[cfg(test)]
fn assemble(
    shape: &Shape,
    block: usize,
    axis: Point,
    fronts: &mut Vec<Front>,
    morph: &Morph,
    (tiles, paths): (Vec<Tile>, Vec<Shape>),
) -> Vec<Parcel> {
    assemble_with_contacts(shape, block, axis, fronts, morph, (tiles, paths), |_| vec![])
}

fn assemble_with_contacts(
    shape: &Shape, block: usize, axis: Point, fronts: &mut Vec<Front>, morph: &Morph,
    (tiles, paths): (Vec<Tile>, Vec<Shape>),
    native_contacts: impl Fn(&Shape) -> Vec<Front>,
) -> Vec<Parcel> {
    let b = bbox(shape);
    let near_block = |p: Point, q: Point| {
        p.x.max(q.x) >= b.0 - 1.0
            && p.x.min(q.x) <= b.2 + 1.0
            && p.y.max(q.y) >= b.1 - 1.0
            && p.y.min(q.y) <= b.3 + 1.0
    };
    // Preserve which side of each original ring/row is a front, but do not
    // attach access to its unclipped global geometry or its nearest street.
    let eligible: Vec<Front> = paths.iter().filter(|p| boxes_overlap(bbox(p), b))
        .flat_map(|p| {
            let ring=super::super::geometry::normalized(p.clone()).outer;
            (0..ring.len()).filter_map(|k| {
                let (a,q)=(ring[(k+1)%ring.len()],ring[k]);
                near_block(a,q).then_some(Front{a,b:q,street:0,rank:0,shared:true,gate:true})
            }).collect::<Vec<_>>()
        }).collect();
    let (paths,rejected):(Vec<Shape>,Vec<Shape>) = union(&paths).iter()
        .filter(|p| boxes_overlap(bbox(p), b))
        .flat_map(|p| intersection(p, shape)).partition(|p| area(p)>0.5);
    // A lane meeting a road slantwise, or against the corner of a notch cut
    // for the road, keeps less than its full width as contact: a gate needs
    // only a passage's width (2 m), not the lane's.
    let gate = morph.number_or("campPath", 3.0).clamp(1.2, 3.0).min(GATE_MIN);
    let shared = connected_path_fronts(shape, &paths, &eligible, native_contacts, gate);
    let first_shared=fronts.len();
    fronts.extend(shared);
    let connected_shared: Vec<usize> = (first_shared..fronts.len()).collect();
    let centre_use = match morph.text("campCentreUse") {
        "plot" => "plot",
        "place" | "byre" => "place",
        _ => "garden",
    };
    let mut cells: Vec<(Shape, Hold, f64)> = vec![];
    for tile in tiles {
        if !boxes_overlap(bbox(&tile.shape), b) {
            continue;
        }
        // A tile wholly inside the block needs no clip (most of them).
        let tb = bbox(&tile.shape);
        let inside = tile
            .shape
            .outer
            .iter()
            .all(|&v| super::super::geometry::contains(shape, v))
            && !std::iter::once(&shape.outer)
                .chain(shape.holes.iter())
                .flatten()
                .any(|v| v.x > tb.0 && v.x < tb.2 && v.y > tb.1 && v.y < tb.3)
            // A narrow access notch (or hole) can cross a tile while every
            // endpoint lies outside its bbox. Test the whole tile boundary,
            // with the existing interval predicate, before skipping the clip.
            && tile.shape.outer.iter()
                .zip(tile.shape.outer.iter().cycle().skip(1))
                .take(tile.shape.outer.len())
                .all(|(&a, &b)| super::super::geometry::segment_within(shape, a, b));
        let clipped = if inside {
            vec![tile.shape.clone()]
        } else {
            intersection(&tile.shape, shape)
        };
        for piece in clipped {
            let mut pieces = vec![piece];
            for p in paths.iter().filter(|_| tile.cut) {
                if pieces.is_empty() {
                    break;
                }
                let pb = bbox(p);
                pieces = pieces
                    .iter()
                    .flat_map(|q| {
                        if boxes_overlap(pb, bbox(q)) {
                            difference(q, p)
                        } else {
                            vec![q.clone()]
                        }
                    })
                    .collect();
            }
            cells.extend(
                pieces
                    .into_iter()
                    .filter(|p| area(p) > 1e-6)
                    .map(|p| (p, tile.hold, tile.nominal)),
            );
        }
    }
    // Cap-specific stage, exact validated assignment and hold-commit rules.
    // Restored ground is an existing non-built cell, never navigation land.
    let _unassigned_caps = assign_open_ground_caps(shape, &mut cells, &rejected);
    // Cells reaching neither a street nor a camp path get a footpath along
    // the cell boundaries (organic's router).
    let width = morph.number_or("campPath", 3.0).clamp(1.2, 3.0);
    let shapes: Vec<Shape> = cells.iter().map(|c| c.0.clone()).collect();
    let forbidden:Vec<Shape>=cells.iter().filter(|(_,h,_)|*h==Hold::Centre && centre_use!="place").map(|(p,_,_)|p.clone()).collect();
    let (links, raw, link_fronts) = super::organic::footpaths_with_navigation(
        shape, &shapes, fronts, width, &connected_shared, &paths, &forbidden);
    // A link arriving on an existing path gives up only that already-owned
    // land. No threshold filters away a new fragment, and no old path moves.
    let links = without_existing_paths(links, &paths);
    let link_fronts: Vec<Front> = links.iter().flat_map(|p| {
        contacts::boundary_contacts(&reversed(p), &link_fronts)
    }).collect();
    fronts.extend(link_fronts);
    let mut out = Vec::with_capacity(cells.len() + paths.len() + links.len());
    for (cell, hold, nominal) in cells {
        for piece in super::organic::cut_out(cell, &raw)
            .into_iter()
            .filter(|p| area(p) > 1e-6)
        {
            let a = area(&piece);
            let (kind, tag) = match hold {
                Hold::Dwelling | Hold::Head if dwelling_fits(a, nominal) => (
                    "plot",
                    if hold == Hold::Head {
                        "camp-head"
                    } else {
                        "camp-dwelling"
                    },
                ),
                Hold::Centre => (centre_use, "camp-centre"),
                _ => ("garden", "camp-open"),
            };
            let pb = bbox(&piece);
            let near: Vec<Front> = fronts
                .iter()
                .filter(|f| {
                    f.a.x.max(f.b.x) >= pb.0 - 0.1
                        && f.a.x.min(f.b.x) <= pb.2 + 0.1
                        && f.a.y.max(f.b.y) >= pb.1 - 0.1
                        && f.a.y.min(f.b.y) <= pb.3 + 0.1
                })
                .copied()
                .collect();
            let mut p = parcel(piece, block, axis, &near, kind);
            p.use_kind = kind.into();
            p.provenance = vec![tag.into()];
            if kind != "plot" {
                p.reason = tag.into();
            }
            out.push(p);
        }
    }
    for path in paths.into_iter().chain(links) {
        let mut p = parcel(path, block, axis, fronts, "court");
        p.use_kind = "court".into();
        p.reason = "shared-footpath".into();
        p.provenance = vec!["camp-path".into()];
        out.push(p);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::super::super::geometry::rectangle;
    use super::*;

    fn layout(shape: &Shape) -> Layout {
        serde_json::from_value(serde_json::json!({
            "key": "camp-test", "culture": "kraal", "center": {"x": 0.0, "y": 0.0},
            "quarters": [], "streets": [{"path": [{"x": -200.0, "y": -80.0}, {"x": 200.0, "y": -80.0}],
                "widths": [6.0, 6.0], "rank": 0, "role": "regional"}],
            "blocks": [{"shape": shape, "quarter": 0, "kind": "block", "axis": {"x": 1.0, "y": 0.0}, "zone": "village"}],
            "warnings": []
        }))
        .unwrap()
    }

    /// Invariant: a kraal is a central byre ringed by whole hut lots facing
    /// ring paths, the great hut at the back, all in an exact partition.
    #[test]
    fn a_kraal_is_a_byre_ringed_by_huts_on_paths_in_an_exact_partition() {
        let old_shape=rectangle(-75.0,-78.0,75.0,75.0);
        let original=layout(&old_shape);
        assert!(contacts::street_contacts(&old_shape,&original,&FrontageIndex::new(&original)).is_empty(),
            "the former manual front is not a real Native street contact");
        // Derive the positive's land edge from the ACTUAL street ribbon, not
        // a guessed coordinate or a looser contact threshold. The old negative
        // fixture above remains exactly -78/-80/width6.
        let road=&original.streets[0];
        let kerb=ribbon(&road.path,&road.widths).iter().map(|p|bbox(p).3).fold(f64::NEG_INFINITY,f64::max);
        let shape = rectangle(-75.0,kerb,75.0,75.0);
        let l = layout(&shape);
        let mut fronts=contacts::street_contacts(&shape,&l,&FrontageIndex::new(&l));
        assert!(!fronts.is_empty(),"the positive starts from real street contacts");
        let morph = Morph {
            value: serde_json::json!({"campLayout":"ring","campRow":9.5,"campArc":[9.0,10.5],
                "campPath":2.5,"campGap":50.0,"campCentre":0.3,"campHead":"back","campCentreUse":"byre"}),
        };
        let lots = lots(&shape, 0, Point { x: 1.0, y: 0.0 }, &mut fronts, &morph, &l);
        let total: f64 = lots.iter().map(|p| area(&p.shape)).sum();
        assert!(
            (total - area(&shape)).abs() < 1e-4 * area(&shape),
            "{total}"
        );
        let huts: Vec<_> = lots.iter().filter(|p| p.use_kind == "plot").collect();
        assert!(huts.len() >= 25, "{}", huts.len());
        assert_eq!(
            lots.iter()
                .filter(|p| p.provenance[0] == "camp-head")
                .count(),
            1
        );
        let byre: Vec<_> = lots.iter().filter(|p| p.use_kind == "place").collect();
        assert_eq!(byre.len(), 1);
        assert!(area(&byre[0].shape) > 1000.0, "{}", area(&byre[0].shape));
        for p in &huts {
            assert!(frontage(&p.shape, &fronts).0 >= 3.0, "{:?}", p.shape.outer);
            assert!(area(&p.shape) < 260.0, "{}", area(&p.shape));
        }
        // The opening faces the road (north, -y): no hut lot straddles it.
        assert!(huts.iter().all(|p| {
            let c = super::super::super::geometry::centroid(&p.shape);
            !(c.y < -20.0 && c.x.abs() < 0.2 * c.y.abs())
        }));
    }

    /// Invariant: a camp lays out the rows its households fill, not its whole
    /// land. 20 households and two facility plots ask for 29 dwelling cells
    /// (22 over the admitted share, and one):
    /// the rings stop there (the last one from the back toward the opening),
    /// the land beyond is one open ground, never rings of empty lots.
    #[test]
    fn camp_rows_follow_households_and_leave_the_rest_open() {
        let shape = rectangle(-75.0, -78.0, 75.0, 75.0);
        let mut l = layout(&shape);
        let demand =
            |id: &str, unit: &str, requested: f64, area: f64, placement: &str, sites: usize| {
                serde_json::json!({"id": id, "function": id, "unit": unit, "requested": requested,
                "targetArea": area, "targetFrontage": 4.0, "provenance": [], "requires": [],
                "parcelCapacity": 0.0, "builtCapacity": 0.0, "deficit": requested, "reasons": [],
                "placement": placement, "sites": sites})
            };
        l.programme = Some(
            serde_json::from_value(serde_json::json!({
                "version": 1, "population": 160, "context": {}, "cultures": [],
                "demands": [demand("domestic", "domesticUnits", 20.0, 1400.0, "", 0),
                    demand("granary", "usefulAreaM2", 190.0, 95.0, "parcel", 2),
                    demand("kraal", "usefulAreaM2", 1650.0, 1650.0, "block", 1)],
                "reservations": [], "allocations": [], "adjacency": [], "environment": [],
                "reconciliationPasses": 0, "warnings": []
            }))
            .unwrap(),
        );
        let r = &shape.outer;
        let mut fronts: Vec<Front> = vec![Front {
            a: r[0],
            b: r[1],
            rank: 0,
            street: 0,
            shared: false,
            gate: false,
        }];
        let morph = Morph {
            value: serde_json::json!({"campLayout":"ring","campRow":9.5,"campArc":[9.0,10.5],
                "campPath":2.5,"campGap":50.0,"campCentre":0.3,"campHead":"back","campCentreUse":"byre"}),
        };
        let lots = lots(&shape, 0, Point { x: 1.0, y: 0.0 }, &mut fronts, &morph, &l);
        let total: f64 = lots.iter().map(|p| area(&p.shape)).sum();
        assert!(
            (total - area(&shape)).abs() < 1e-4 * area(&shape),
            "{total}"
        );
        let huts = lots
            .iter()
            .filter(|p| p.provenance[0] == "camp-dwelling")
            .count();
        assert!((25..=29).contains(&huts), "{huts} hut lots for 29 cells");
        // The land beyond the rows is open ground, most of the block.
        let open: f64 = lots
            .iter()
            .filter(|p| p.provenance[0] == "camp-open")
            .map(|p| area(&p.shape))
            .sum();
        assert!(open > 0.4 * area(&shape), "{open}");
    }

    /// Invariant: a road through the camp's middle is no open centre ringed
    /// by its land: the byre keeps its share of the camp across the road,
    /// not the 6 m disc a band camp's empty middle would leave it.
    #[test]
    fn a_road_through_the_middle_leaves_the_byre_its_share() {
        let mut l = layout(&rectangle(-75.0, 4.0, 75.0, 75.0));
        l.streets[0].path = vec![Point { x: -200.0, y: 0.0 }, Point { x: 200.0, y: 0.0 }];
        l.streets[0].widths = vec![8.0, 8.0];
        let mut south = l.blocks[0].clone();
        south.shape = rectangle(-75.0, -75.0, 75.0, -4.0);
        l.blocks.push(south);
        let frame = Frame::of(&l);
        assert!(frame.inner > 3.0, "the middle lies in the road");
        let morph = Morph {
            value: serde_json::json!({"campLayout":"ring","campRow":9.5,"campArc":[9.0,10.5],
                "campPath":2.5,"campGap":50.0,"campCentre":0.3,"campHead":"back","campCentreUse":"byre"}),
        };
        let (tiles, _) = ring(&frame, &morph, &l);
        let centre = tiles.iter().find(|t| t.hold == Hold::Centre).unwrap();
        let r = (area(&centre.shape) / PI).sqrt();
        assert!(r > 0.25 * frame.equivalent, "{r} of {}", frame.equivalent);
    }

    /// Invariant: a path's contact with a street, split by block vertices
    /// into a zero-length piece and hair gaps, still counts whole.
    #[test]
    fn a_contact_split_by_block_vertices_counts_whole() {
        let f = |ax: f64, bx: f64| Front {
            a: Point { x: ax, y: 0.0 },
            b: Point { x: bx, y: 0.0 },
            rank: 0,
            street: 0,
            shared: false,
            gate: false,
        };
        let entries = vec![f(0.0, 2.1), f(2.1, 2.1), f(2.1003, 2.5), f(30.0, 30.5)];
        let (lo, hi) = contacts::support_span(&entries, 0);
        assert!(hi - lo < 2.5, "the split run alone is narrower than the path");
        assert!((contact_run(&entries, 0) - 2.5).abs() < 1e-3);
        assert!((contact_run(&entries, 3) - 0.5).abs() < 1e-9);
    }
}

#[cfg(test)]
#[path = "camp_consumer_regression_tests.rs"]
mod consumer_regression_tests;

#[cfg(test)]
#[path = "camp_connected_fronts_tests.rs"]
mod connected_fronts_tests;

#[cfg(test)]
#[path = "camp_cap_ground_tests.rs"]
mod cap_ground_tests;
