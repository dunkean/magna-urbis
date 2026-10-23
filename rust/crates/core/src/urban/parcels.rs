//! Street-fronting cadastral partitions, in metres. Every cut retains the
//! parent's frame and every unclaimed piece remains explicit back land.
use super::geometry::{area, difference, intersection};
use super::{Layout, Morph, Parcel, ParcelConfig, Partition, Point, Shape};
use crate::rng::Rng;
use std::collections::BTreeMap;
mod admission;
#[cfg(test)]
mod cadastral_tests;
mod contacts;
mod courts;
mod families;
mod landmark;
mod occupation;
mod pressure;
pub(super) use admission::{compact_fallback, witnessed_by};
pub(super) use occupation::{
    Kind as OccupationKind, Occupancy, kind as occupation_kind, preview_parts as occupation_preview,
};

#[derive(Clone, Copy)]
struct Front {
    a: Point,
    b: Point,
    rank: usize,
    street: usize,
    shared: bool,
    gate: bool,
}

fn dot(a: Point, b: Point) -> f64 {
    a.x * b.x + a.y * b.y
}
fn sub(a: Point, b: Point) -> Point {
    Point {
        x: a.x - b.x,
        y: a.y - b.y,
    }
}
fn add(a: Point, b: Point) -> Point {
    Point {
        x: a.x + b.x,
        y: a.y + b.y,
    }
}
fn scale(a: Point, s: f64) -> Point {
    Point {
        x: a.x * s,
        y: a.y * s,
    }
}
fn length(a: Point) -> f64 {
    a.x.hypot(a.y)
}
fn unit(a: Point) -> Point {
    scale(a, 1.0 / length(a).max(1e-12))
}
fn normal(a: Point) -> Point {
    Point { x: -a.y, y: a.x }
}
fn distance(p: Point, a: Point, b: Point) -> f64 {
    let d = sub(b, a);
    length(sub(
        p,
        add(
            a,
            scale(
                d,
                (dot(sub(p, a), d) / dot(d, d).max(1e-12)).clamp(0.0, 1.0),
            ),
        ),
    ))
}

fn frame_direction(inward: Point, axis: Point) -> Point {
    let v = normal(axis);
    let d = if dot(inward, axis).abs() >= dot(inward, v).abs() {
        axis
    } else {
        v
    };
    scale(d, if dot(inward, d) >= 0.0 { 1.0 } else { -1.0 })
}

fn bounds(shape: &Shape, axis: Point) -> (f64, f64) {
    shape
        .outer
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), p| {
            let d = dot(*p, axis);
            (a.min(d), b.max(d))
        })
}

/// An exact boolean half-plane, bounded beyond the complete parent shape.
fn half(shape: &Shape, axis: Point, at: f64, below: bool) -> Vec<Shape> {
    let v = normal(axis);
    let (a, b) = bounds(shape, axis);
    let (c, d) = bounds(shape, v);
    let margin = (b - a).hypot(d - c) + 1.0;
    let (lo, hi) = if below {
        (a - margin, at)
    } else {
        (at, b + margin)
    };
    if hi <= lo {
        return Vec::new();
    }
    let point = |u, w| add(scale(axis, u), scale(v, w));
    intersection(
        shape,
        &Shape {
            outer: vec![
                point(lo, c - margin),
                point(hi, c - margin),
                point(hi, d + margin),
                point(lo, d + margin),
            ],
            holes: Vec::new(),
        },
    )
}

/// Area of `shape` on the `dot(axis, p) <= at` side, holes included, without a
/// boolean operation: one Sutherland-Hodgman pass per ring (exact for any simple
/// ring against one half-plane, concave ones included).
fn half_area(shape: &Shape, axis: Point, at: f64) -> f64 {
    let plane = [(axis, at)];
    let ring = |r: &[Point]| occupation::ring_area(&occupation::clip(r, &plane)).abs();
    ring(&shape.outer) - shape.holes.iter().map(|h| ring(h)).sum::<f64>()
}

/// The real frontage of a territory as a polyline measured by arclength:
/// its contacts with `run`, ordered and oriented along `along`. Gaps between
/// contacts (a corner cut, a hole) do not count as frontage.
struct Stations {
    segments: Vec<(Point, Point, f64)>,
    total: f64,
}
impl Stations {
    fn new(shape: &Shape, run: &[Front], along: Point) -> Self {
        let mut segments: Vec<(Point, Point)> = contacts::boundary_contacts(shape, run)
            .into_iter()
            .map(|f| {
                if dot(sub(f.b, f.a), along) >= 0.0 {
                    (f.a, f.b)
                } else {
                    (f.b, f.a)
                }
            })
            .filter(|(a, b)| length(sub(*b, *a)) > 1e-6)
            .collect();
        segments.sort_by(|x, y| dot(add(x.0, x.1), along).total_cmp(&dot(add(y.0, y.1), along)));
        let mut total = 0.0;
        let segments = segments
            .into_iter()
            .map(|(a, b)| {
                total += length(sub(b, a));
                (a, b, total)
            })
            .collect();
        Self { segments, total }
    }
    /// Point and unit tangent at arclength `s`.
    fn at(&self, s: f64) -> (Point, Point) {
        let mut start = 0.0;
        let last = self.segments.len().saturating_sub(1);
        for (i, &(a, b, end)) in self.segments.iter().enumerate() {
            if s <= end + 1e-9 || i == last {
                let d = unit(sub(b, a));
                let t = (s - start).clamp(0.0, end - start);
                return (add(a, scale(d, t)), d);
            }
            start = end;
        }
        let (a, b, _) = *self.segments.last().unwrap();
        (b, unit(sub(b, a)))
    }
}

/// Cut directions (plane normals along the street) for internal cuts at the
/// given stations: the bisector of the two neighbouring lot chords, with the
/// turn between consecutive cuts limited so that two cuts `f` metres apart
/// never converge (or fan out) by more than half a lot inside the depth band.
fn cut_directions(
    st: &Stations,
    cuts: &[f64],
    fronts: &[f64],
    along: Point,
    band: f64,
) -> Vec<Point> {
    let n = cuts.len();
    if n == 0 {
        return vec![];
    }
    let point = |s: f64| st.at(s).0;
    let mut angles: Vec<f64> = (0..n)
        .map(|k| {
            let before = if k == 0 { 0.0 } else { cuts[k - 1] };
            let after = if k + 1 == n { st.total } else { cuts[k + 1] };
            let p = point(cuts[k]);
            let (pa, pb) = (point(before), point(after));
            let mut d = add(unit(sub(p, pa)), unit(sub(pb, p)));
            if length(d) < 1e-6 {
                d = st.at(cuts[k]).1;
            }
            let d = unit(d);
            let d = if dot(d, along) < 0.0 {
                scale(d, -1.0)
            } else {
                d
            };
            let cross = along.x * d.y - along.y * d.x;
            cross.atan2(dot(along, d)).clamp(-1.2, 1.2)
        })
        .collect();
    let ideal = angles.clone();
    let band = band.max(4.0);
    let step = |k: usize| (0.5 * fronts[k + 1] / band).clamp(0.02, 0.6);
    for k in 0..n.saturating_sub(1) {
        let s = step(k);
        angles[k + 1] = angles[k + 1].clamp(angles[k] - s, angles[k] + s);
    }
    for k in (0..n.saturating_sub(1)).rev() {
        let s = step(k);
        angles[k] = angles[k].clamp(angles[k + 1] - s, angles[k + 1] + s);
    }
    // The limiter lags behind a long curve; one uniform turn (which keeps every
    // step bound) centres the remaining deviation from the local normals.
    let (lo, hi) = ideal
        .iter()
        .zip(&angles)
        .map(|(a, b)| a - b)
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(l, h), d| {
            (l.min(d), h.max(d))
        });
    let shift = 0.5 * (lo + hi);
    angles
        .into_iter()
        .map(|a| a + shift)
        .map(|a| {
            let (sin, cos) = a.sin_cos();
            Point {
                x: along.x * cos - along.y * sin,
                y: along.x * sin + along.y * cos,
            }
        })
        .collect()
}

pub(super) struct FrontageIndex {
    cells: BTreeMap<(i32, i32), Vec<(usize, usize)>>,
}
impl FrontageIndex {
    pub(super) fn new(layout: &Layout) -> Self {
        let mut cells: BTreeMap<(i32, i32), Vec<(usize, usize)>> = BTreeMap::new();
        for (si, s) in layout.streets.iter().enumerate() {
            for (j, w) in s.path.windows(2).enumerate() {
                let x0 = ((w[0].x.min(w[1].x) - 14.0) / 64.0).floor() as i32;
                let x1 = ((w[0].x.max(w[1].x) + 14.0) / 64.0).floor() as i32;
                let y0 = ((w[0].y.min(w[1].y) - 14.0) / 64.0).floor() as i32;
                let y1 = ((w[0].y.max(w[1].y) + 14.0) / 64.0).floor() as i32;
                for y in y0..=y1 {
                    for x in x0..=x1 {
                        cells.entry((x, y)).or_default().push((si, j));
                    }
                }
            }
        }
        Self { cells }
    }
    fn candidates(&self, a: Point, b: Point, out: &mut Vec<(usize, usize)>) {
        out.clear();
        for y in (a.y.min(b.y) / 64.0).floor() as i32..=(a.y.max(b.y) / 64.0).floor() as i32 {
            for x in (a.x.min(b.x) / 64.0).floor() as i32..=(a.x.max(b.x) / 64.0).floor() as i32 {
                if let Some(v) = self.cells.get(&(x, y)) {
                    out.extend_from_slice(v);
                }
            }
        }
        // Preserve street/segment order, including the tie-break between
        // equally ranked frontages, while reusing the allocation per edge.
        out.sort_unstable();
        out.dedup();
    }
}
fn frontages(shape: &Shape, layout: &Layout, index: &FrontageIndex) -> Vec<Front> {
    contacts::street_contacts(shape, layout, index)
}
pub(super) fn access_fronts(
    shape: &Shape,
    layout: &Layout,
    index: &FrontageIndex,
) -> Vec<(Point, Point, usize)> {
    frontages(shape, layout, index)
        .iter()
        .map(|f| (f.a, f.b, f.street))
        .collect()
}

/// Continuous public-network contacts also serve uncut programme reserves.
pub(super) fn network_contacts(
    shape: &Shape,
    layout: &Layout,
    index: &FrontageIndex,
) -> Vec<super::ParcelContact> {
    frontages(shape, layout, index)
        .into_iter()
        .map(|f| super::ParcelContact {
            a: f.a,
            b: f.b,
            street: f.street,
            rank: f.rank,
            length: length(sub(f.b, f.a)),
            kind: access_kind(&f, layout).into(),
        })
        .collect()
}

pub(super) fn block_contacts(shape: &Shape, layout: &Layout) -> Vec<super::ParcelContact> {
    block_contacts_indexed(shape, layout, &FrontageIndex::new(layout))
}
pub(super) fn block_contacts_indexed(
    shape: &Shape,
    layout: &Layout,
    index: &FrontageIndex,
) -> Vec<super::ParcelContact> {
    network_contacts(shape, layout, index)
        .into_iter()
        .filter(|c| {
            !matches!(
                layout.streets[c.street].role.as_str(),
                "boundary" | "wall-lane" | "bridge"
            )
        })
        .collect()
}
pub(super) fn occupation_pressures(layout: &Layout) -> Vec<f64> {
    pressure::for_layout(layout)
}

fn parcel_fronts(p: &Parcel) -> Vec<Front> {
    if !p.contacts.is_empty() {
        return p
            .contacts
            .iter()
            .map(|c| Front {
                a: c.a,
                b: c.b,
                street: c.street,
                rank: c.rank,
                shared: c.kind == "collective",
                gate: matches!(c.kind.as_str(), "private" | "collective"),
            })
            .collect();
    }
    p.front
        .into_iter()
        .map(|[a, b]| Front {
            a,
            b,
            street: p.access.as_ref().and_then(|a| a.street).unwrap_or(0),
            rank: p.rank,
            shared: p.access.as_ref().is_some_and(|a| a.kind == "collective"),
            gate: p
                .access
                .as_ref()
                .is_some_and(|a| matches!(a.kind.as_str(), "private" | "collective")),
        })
        .collect()
}
/// Shared exact witness used by allocation as well as cadastral qualification.
/// Courtyard-family lots are entered through a gate: any contact as wide as
/// the access admits a house set anywhere inside the lot.
pub(super) fn parcel_envelope(
    p: &Parcel,
    width: f64,
    depth: f64,
    access_width: f64,
) -> Option<Shape> {
    let inward = p.family == "courtyard";
    let fronts: Vec<_> = parcel_fronts(p)
        .into_iter()
        .map(|f| Front {
            gate: f.gate || inward,
            ..f
        })
        .collect();
    families::envelope(&p.shape, &fronts, width, depth, access_width)
}
/// Uncut reserves use the same admission search without synthetic properties.
pub(super) fn contact_envelope(
    shape: &Shape,
    contacts: &[super::ParcelContact],
    width: f64,
    depth: f64,
    access_width: f64,
) -> Option<Shape> {
    let fronts: Vec<_> = contacts
        .iter()
        .map(|c| Front {
            a: c.a,
            b: c.b,
            street: c.street,
            rank: c.rank,
            shared: c.kind == "collective",
            gate: matches!(c.kind.as_str(), "private" | "collective"),
        })
        .collect();
    families::envelope(shape, &fronts, width, depth, access_width)
}
/// Largest connected, gently curved projected frontage; disjoint fronts never add.
pub(super) fn continuous_frontage(contacts: &[super::ParcelContact]) -> f64 {
    let fronts: Vec<_> = contacts
        .iter()
        .map(|c| Front {
            a: c.a,
            b: c.b,
            street: c.street,
            rank: c.rank,
            shared: c.kind == "collective",
            gate: matches!(c.kind.as_str(), "private" | "collective"),
        })
        .collect();
    (0..fronts.len())
        .map(|i| {
            let (lo, hi) = contacts::support_span(&fronts, i);
            hi - lo
        })
        .fold(0.0, f64::max)
}

/// Count actual shared boundary rather than an inferred frontage chord.
fn frontage(shape: &Shape, fronts: &[Front]) -> (f64, Option<Front>) {
    let contacts = contacts::boundary_contacts(shape, fronts);
    let total = contacts.iter().map(|f| length(sub(f.b, f.a))).sum();
    let best = contacts
        .into_iter()
        .max_by(|a, b| length(sub(a.b, a.a)).total_cmp(&length(sub(b.b, b.a))));
    (total, best)
}

fn parcel(shape: Shape, block: usize, axis: Point, fronts: &[Front], kind: &str) -> Parcel {
    let (len, f) = frontage(&shape, fronts);
    let id = identity(&shape, block);
    Parcel {
        id,
        pressure: 0.0,
        envelope: None,
        parent_ids: vec![format!("block-{block}")],
        provenance: vec![
            if kind == "garden" {
                "retained-backland"
            } else {
                "frontage-partition"
            }
            .into(),
        ],
        family: String::new(),
        reason: if kind == "garden" {
            "retained-backland"
        } else if len < 3.0 {
            "insufficient-frontage"
        } else {
            "frontage-qualified"
        }
        .into(),
        contacts: Vec::new(),
        shape,
        block,
        axis,
        use_kind: kind.to_owned(),
        front: f.filter(|_| len > 0.01).map(|f| [f.a, f.b]),
        rank: f.map_or(99, |f| f.rank),
        access: Some(super::ParcelAccess {
            kind: if len <= 0.01 {
                "unserved"
            } else if f.is_some_and(|f| f.shared) {
                "collective"
            } else {
                "public"
            }
            .into(),
            street: f.filter(|_| len > 0.01).map(|f| f.street),
            front_length: len,
        }),
    }
}

/// Geometry identity ignores ring start, winding and redundant collinear points.
/// Coordinates are rounded to 0.1mm only for the ID, never for geometry.
fn identity(shape: &Shape, block: usize) -> String {
    let mut rings = Vec::new();
    for ring in std::iter::once(&shape.outer).chain(shape.holes.iter()) {
        let mut points = ring.clone();
        loop {
            let n = points.len();
            let keep: Vec<_> = (0..n)
                .filter(|&i| {
                    let a = sub(points[i], points[(i + n - 1) % n]);
                    let b = sub(points[(i + 1) % n], points[i]);
                    length(a) > 1e-8 && length(b) > 1e-8 && dot(unit(a), unit(b)) < 1.0 - 1e-10
                })
                .map(|i| points[i])
                .collect();
            if keep.len() == n || keep.len() < 3 {
                break;
            }
            points = keep;
        }
        let mut quantized: Vec<_> = points
            .iter()
            .map(|p| {
                (
                    (p.x * 10000.0).round() as i64,
                    (p.y * 10000.0).round() as i64,
                )
            })
            .collect();
        // Canonical cyclic order preserves edge topology while ignoring ring
        // start/winding; sorting vertices would conflate distinct concavities.
        if let Some(first) = quantized.iter().min().copied() {
            let n = quantized.len();
            let canonical = (0..n)
                .filter(|&i| quantized[i] == first)
                .flat_map(|i| {
                    [
                        (0..n).map(|j| quantized[(i + j) % n]).collect::<Vec<_>>(),
                        (0..n)
                            .map(|j| quantized[(i + n - j) % n])
                            .collect::<Vec<_>>(),
                    ]
                })
                .min()
                .unwrap();
            rings.push(canonical);
        } else {
            rings.push(std::mem::take(&mut quantized));
        }
    }
    rings.sort();
    let mut hash = 0xcbf29ce484222325u64;
    for ring in rings {
        for (x, y) in ring {
            for byte in x.to_le_bytes().into_iter().chain(y.to_le_bytes()) {
                hash = (hash ^ byte as u64).wrapping_mul(0x100000001b3);
            }
        }
        hash = (hash ^ 255).wrapping_mul(0x100000001b3);
    }
    format!("block-{block}/{hash:016x}")
}

fn block_identity(layout: &Layout, shape: &Shape) -> String {
    let mut key = 0xcbf29ce484222325u64;
    for byte in layout.key.bytes() {
        key = (key ^ byte as u64).wrapping_mul(0x100000001b3);
    }
    let geometry = identity(shape, 0);
    format!(
        "layout-{key:016x}/block-{}",
        geometry.split_once('/').unwrap().1
    )
}
/// Operator-local lineage tokens are resolved to their retained owner before
/// export. Array position remains solely the p.block lookup, never identity.
fn resolve_identity(parcel: &mut Parcel, block: usize, owner: &str) {
    let root = format!("block-{block}");
    let map = |id: &str| {
        if id == root {
            owner.to_owned()
        } else if let Some(hash) = id.strip_prefix(&format!("{root}/")) {
            format!("{owner}/parcel-{hash}")
        } else {
            id.to_owned()
        }
    };
    parcel.id = map(&parcel.id);
    parcel.parent_ids = parcel.parent_ids.iter().map(|id| map(id)).collect();
}

fn ray_limit(shape: &Shape, p: Point, d: Point, fronts: &[Front], rank: usize) -> f64 {
    let mut hit = f64::INFINITY;
    let mut far_rank = None;
    for ring in std::iter::once(&shape.outer).chain(shape.holes.iter()) {
        for i in 0..ring.len() {
            let a = ring[i];
            let b = ring[(i + 1) % ring.len()];
            let e = sub(b, a);
            let cross = d.x * e.y - d.y * e.x;
            if cross.abs() < 1e-10 {
                continue;
            }
            let v = sub(a, p);
            let t = (v.x * e.y - v.y * e.x) / cross;
            let s = (v.x * d.y - v.y * d.x) / cross;
            if t > 0.01 && (0.0..=1.0).contains(&s) && t < hit {
                hit = t;
                let q = add(p, scale(d, t));
                far_rank = fronts
                    .iter()
                    .find(|f| distance(q, f.a, f.b) < 0.05)
                    .map(|f| f.rank);
            }
        }
    }
    far_rank.map_or(hit, |other| hit * depth_share(rank, other) + 1.2)
}

/// Invariant (back-to-back balance): the share of the depth between two
/// opposite fronts that the higher-ranked one claims. Rank buys depth, but at
/// most 60 % of it (it was 85 %, about 6:1), so two lots back to back differ in
/// depth by at most 3:2 plus the 1.2 m allowance, and in area by less than 3x
/// while their frontages differ by less than 1.5x (the audit's pair bound).
fn depth_share(rank: usize, other: usize) -> f64 {
    (0.5 + 0.17 * (other as f64 - rank as f64)).clamp(0.5, MAX_DEPTH_SHARE)
}
const MAX_DEPTH_SHARE: f64 = 0.6;

fn runs(fronts: &[Front]) -> Vec<Vec<Front>> {
    let mut result: Vec<Vec<Front>> = Vec::new();
    for f in fronts {
        let joins = result.last().and_then(|r| r.last()).is_some_and(|old| {
            old.street == f.street
                && length(sub(old.b, f.a)) < 0.03
                && dot(unit(sub(old.b, old.a)), unit(sub(f.b, f.a))) > 20.0_f64.to_radians().cos()
        });
        if joins {
            result.last_mut().unwrap().push(*f);
        } else {
            result.push(vec![*f]);
        }
    }
    if result.len() > 1 {
        let a = result.last().unwrap().last().unwrap();
        let b = result[0][0];
        if a.street == b.street
            && length(sub(a.b, b.a)) < 0.03
            && dot(unit(sub(a.b, a.a)), unit(sub(b.b, b.a))) > 20.0_f64.to_radians().cos()
        {
            let mut last = result.pop().unwrap();
            last.append(&mut result[0]);
            result[0] = last;
        }
    }
    result.sort_by(|a, b| {
        a.iter()
            .map(|f| f.rank)
            .min()
            .cmp(&b.iter().map(|f| f.rank).min())
            .then_with(|| {
                b.iter()
                    .map(|f| length(sub(f.b, f.a)))
                    .sum::<f64>()
                    .total_cmp(&a.iter().map(|f| length(sub(f.b, f.a))).sum::<f64>())
            })
    });
    result
}

/// A frontage run cut at street bends, with the radial seams it shares with its
/// neighbours on the same curve (`dot(p - point, m) >= 0` after `start`,
/// `<= 0` before `end`), so lots stay normal to the local frontage.
struct Bend {
    fronts: Vec<Front>,
    start: Option<(Point, Point)>,
    end: Option<(Point, Point)>,
}

/// Split every run once it has turned by more than 45 degrees from its first
/// piece (and is at least 8 m long): one inward depth plane cannot serve a
/// longer curve. Straight runs are never split, whatever their segmentation.
fn bend_runs(fronts: &[Front]) -> Vec<Bend> {
    let mut out = Vec::new();
    for run in runs(fronts) {
        let mut parts: Vec<Vec<Front>> = vec![vec![run[0]]];
        for f in run.into_iter().skip(1) {
            let current = parts.last().unwrap();
            let chord = length(sub(current.last().unwrap().b, current[0].a));
            let turn = dot(unit(sub(current[0].b, current[0].a)), unit(sub(f.b, f.a)));
            if chord >= 8.0 && turn < 45.0_f64.to_radians().cos() {
                parts.push(vec![f]);
            } else {
                parts.last_mut().unwrap().push(f);
            }
        }
        let chord = |r: &[Front]| unit(sub(r.last().unwrap().b, r[0].a));
        let n = parts.len();
        let seams: Vec<_> = (1..n)
            .map(|k| {
                (
                    parts[k][0].a,
                    unit(add(chord(&parts[k - 1]), chord(&parts[k]))),
                )
            })
            .collect();
        for (k, fronts) in parts.into_iter().enumerate() {
            out.push(Bend {
                fronts,
                start: (k > 0).then(|| seams[k - 1]),
                end: (k + 1 < n).then(|| seams[k]),
            });
        }
    }
    out
}

/// Inward cut direction of a run: the block frame when the street is within
/// 10 degrees of it (grids stay rectilinear), else the local street normal.
fn local_inward(inward: Point, axis: Point) -> Point {
    let framed = frame_direction(inward, axis);
    if dot(framed, inward) >= 10.0_f64.to_radians().cos() {
        framed
    } else {
        inward
    }
}

/// The culture's deepest ordinary lot: its catalogue plot depth, or the side of
/// a square lot of its largest house area when that is deeper (courtyard
/// cultures). Land behind stays garden or field; deep blocks keep a back seam
/// of gardens instead of 300 m strips (TODO bug 2b).
fn maximum_plot_depth(morph: &Morph, zone: &str) -> f64 {
    let [a, b] = morph.range("plotDepth", zone);
    let house = morph.range("houseArea", zone)[1].max(0.0).sqrt();
    b.max(a).max(house).max(1.0)
}

fn plot_depth(shape: &Shape, axis: Point, fronts: &[Front]) -> Option<f64> {
    let f = frontage(shape, fronts).1?;
    let inward = frame_direction(normal(unit(sub(f.b, f.a))), axis);
    Some(bounds(shape, inward).1 - dot(f.a, inward).min(dot(f.b, inward)))
}

/// Depth of a lot from its best real access: over every contact of at least
/// 3 m (any contact otherwise), the smallest reach of the lot behind its line.
fn lot_depth(shape: &Shape, fronts: &[Front]) -> f64 {
    let contacts = contacts::boundary_contacts(shape, fronts);
    let long = contacts.iter().any(|f| length(sub(f.b, f.a)) >= 3.0);
    contacts
        .iter()
        .filter(|f| !long || length(sub(f.b, f.a)) >= 3.0)
        .map(|f| {
            let n = normal(unit(sub(f.b, f.a)));
            shape
                .outer
                .iter()
                .map(|p| dot(sub(*p, f.a), n))
                .fold(0.0, f64::max)
        })
        .fold(f64::INFINITY, f64::min)
        .min(1e9)
}

fn bound_frontage_depth(p: Parcel, limit: f64) -> Vec<Parcel> {
    let Some([a, b]) = p.front.filter(|_| p.use_kind == "plot") else {
        return vec![p];
    };
    let inward = normal(unit(sub(b, a)));
    let base = dot(a, inward);
    let (lo, hi) = bounds(&p.shape, inward);
    if lo >= base - limit - 0.01 && hi <= base + limit + 0.01 {
        return vec![p];
    }
    // Concave territories may wrap behind the selected frontage. Bound both
    // sides of that frontage, and keep it authoritative after the cut rather
    // than silently selecting a different street on the new polygon.
    let front = [Front {
        a,
        b,
        rank: p.rank,
        street: p.access.as_ref().and_then(|a| a.street).unwrap_or(0),
        shared: p.access.as_ref().is_some_and(|a| a.kind == "collective"),
        gate: p
            .access
            .as_ref()
            .is_some_and(|a| matches!(a.kind.as_str(), "private" | "collective")),
    }];
    let mut out = vec![];
    let near = half(&p.shape, inward, base - limit, false);
    for rear in half(&p.shape, inward, base - limit, true) {
        out.push(parcel(rear, p.block, p.axis, &[], "garden"));
    }
    for cell in near {
        for rear in half(&cell, inward, base + limit, false) {
            out.push(parcel(rear, p.block, p.axis, &[], "garden"));
        }
        for built in half(&cell, inward, base + limit, true) {
            out.push(parcel(built, p.block, p.axis, &front, "plot"));
        }
    }
    for child in &mut out {
        child.parent_ids = vec![p.id.clone()];
        child.provenance = p.provenance.clone();
        child.provenance.push("depth-bound".into());
    }
    out
}

fn strips(
    shape: &Shape,
    block: usize,
    axis: Point,
    fronts: &[Front],
    morph: &Morph,
    zone: &str,
    rng: &mut Rng,
) -> Vec<Parcel> {
    let [depth_min, depth_max] = morph.range("plotDepth", zone);
    let [width_min, width_max] = morph.range("frontage", zone);
    let [coverage_min, coverage_max] = morph.range("coverage", zone);
    let coverage = rng.range(coverage_min, coverage_max);
    let depth_pressure = if morph.flag("deepFill") {
        1.0
    } else {
        ((coverage - 0.4) / 0.55).clamp(0.0, 1.0)
    };
    let maximum_depth = maximum_plot_depth(morph, zone);
    let faces = morph_faces(morph);
    let mut available = vec![shape.clone()];
    let mut plots = Vec::new();
    let pressure = morph.value["_occupationPressure"].as_f64().unwrap_or(0.5);
    let all_runs = bend_runs(fronts);
    // Run ends meeting another run at an angle are corners of the block.
    let mut corners: Vec<Point> = Vec::new();
    for r in &all_runs {
        let d = unit(sub(r.fronts.last().unwrap().b, r.fronts[0].a));
        let end = r.fronts.last().unwrap().b;
        for o in &all_runs {
            let e = unit(sub(o.fronts.last().unwrap().b, o.fronts[0].a));
            if length(sub(o.fronts[0].a, end)) < 0.05 && dot(d, e) < 45.0_f64.to_radians().cos() {
                corners.push(end);
            }
        }
    }
    for (ri, bend) in all_runs.into_iter().enumerate() {
        let run = bend.fronts;
        let mut rr = rng.fork(&format!("frontage:{ri}"));
        let first = run[0].a;
        let last = run.last().unwrap().b;
        if length(sub(last, first)) < 4.0 {
            continue;
        }
        let inward = local_inward(normal(unit(sub(last, first))), axis);
        let cut_axis = normal(inward);
        // Off-frame (curved or oblique) streets: each cut follows the local
        // street tangent instead of one run-wide axis, so lots stay normal to
        // their own frontage rather than becoming wedges.
        let sweep = dot(inward, normal(unit(sub(last, first)))) > 1.0 - 1e-9 && run.len() > 1;
        let rank = run.iter().map(|f| f.rank).min().unwrap_or(99);
        let target = rr.range(depth_min, depth_max).max(1.0);
        let mut limit = f64::NEG_INFINITY;
        let mut frontage_level = f64::INFINITY;
        let mut walled = false;
        for f in &run {
            for p in [f.a, add(f.a, scale(sub(f.b, f.a), 0.5)), f.b] {
                frontage_level = frontage_level.min(dot(p, inward));
                let start = add(p, scale(inward, 0.05));
                let cap = ray_limit(shape, start, inward, fronts, f.rank);
                let cap = if cap.is_finite() { cap } else { target };
                // Invariant (houses against the wall): a lot whose depth ray
                // ends on the inner face of the town wall, within 1.25x the
                // cultural depth, runs to the wall: the curtain is its rear
                // party wall, with no strip of land between them.
                let q = add(start, scale(inward, cap));
                if cap <= 1.25 * maximum_depth
                    && faces.iter().any(|&(a, b)| distance(q, a, b) < 0.1)
                {
                    walled = true;
                    limit = limit.max(dot(p, inward) + cap + 0.05);
                    continue;
                }
                let spare = (cap - target).max(0.0);
                let closure = (1.0 - (spare / 7.0).clamp(0.0, 1.0)).powi(2);
                let depth =
                    target.min(cap) + spare * (depth_pressure + (1.0 - depth_pressure) * closure);
                limit = limit.max(dot(p, inward) + depth);
            }
        }
        // This also bounds curved frontage runs, whose points do not all lie on
        // the same depth plane. Their inaccessible rear land stays a garden.
        limit = limit.min(frontage_level + maximum_depth * if walled { 1.25 } else { 1.0 });
        let mut territories = Vec::new();
        // A passage or court edge inside the block serves only the land in
        // front of it, alongside it: never land wrapping around its dead end.
        let lane = run.iter().all(|f| f.shared).then(|| {
            run.iter()
                .flat_map(|f| [f.a, f.b])
                .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), p| {
                    (a.min(dot(p, cut_axis)), b.max(dot(p, cut_axis)))
                })
        });
        // Lateral reach of the run: a frontage serves the land in front of it,
        // and at most a quarter of its depth (6 m) beyond its ends.
        let (r0, r1) = run
            .iter()
            .flat_map(|f| [dot(f.a, cut_axis), dot(f.b, cut_axis)])
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), s| {
                (a.min(s), b.max(s))
            });
        for cell in &available {
            let mut pieces = half(cell, inward, limit, true);
            // A front inside an inlet (a dead-end slot, a concave notch) must
            // not claim the block behind its own street: bound the band on its
            // street side and laterally, only when it actually reaches there.
            pieces = pieces
                .into_iter()
                .flat_map(|t| {
                    let (n0, _) = bounds(&t, inward);
                    let (l0, l1) = bounds(&t, cut_axis);
                    let reach = (0.25 * (limit - frontage_level)).clamp(0.0, 6.0);
                    if n0 >= frontage_level - 0.05 && l0 >= r0 - reach && l1 <= r1 + reach {
                        return vec![t];
                    }
                    half(&t, inward, frontage_level - 0.05, false)
                        .into_iter()
                        .flat_map(|t| half(&t, cut_axis, r0 - reach, false))
                        .flat_map(|t| half(&t, cut_axis, r1 + reach, true))
                        .collect()
                })
                .collect();
            if let Some((s0, s1)) = lane {
                pieces = pieces
                    .iter()
                    .flat_map(|t| half(t, inward, frontage_level - 0.05, false))
                    .flat_map(|t| half(&t, cut_axis, s0 - 0.05, false))
                    .flat_map(|t| half(&t, cut_axis, s1 + 0.05, true))
                    .collect();
            }
            if let Some((p, m)) = bend.start {
                pieces = pieces
                    .iter()
                    .flat_map(|t| half(t, m, dot(p, m), false))
                    .collect();
            }
            if let Some((p, m)) = bend.end {
                pieces = pieces
                    .iter()
                    .flat_map(|t| half(t, m, dot(p, m), true))
                    .collect();
            }
            for t in pieces {
                if frontage(&t, &run).0 >= 3.0 {
                    territories.push(t);
                }
            }
        }
        for territory in &territories {
            available = available
                .into_iter()
                .flat_map(|a| difference(&a, territory))
                .collect();
        }
        for territory in territories {
            let (s0, s1) = bounds(&territory, cut_axis);
            // Stations are measured along the real frontage, not its chord.
            let stations = Stations::new(&territory, &run, cut_axis);
            if stations.total < 3.0 || stations.segments.is_empty() {
                plots.push(parcel(territory, block, axis, fronts, "plot"));
                continue;
            }
            let extent = stations.total;
            let mut widths = Vec::new();
            let mut total = 0.0;
            let lo = width_min.max(3.6);
            let hi = width_max.max(lo);
            let module = (((lo + hi) * 0.5) * rr.range(0.94, 1.06)).clamp(lo, hi);
            let mut rhythm = 1.0;
            // Heavier tail: occasional merchant lots of two or three modules,
            // likelier on busy, high-rank frontage.
            let merge = morph.number("wideLotChance").clamp(0.0, 1.0)
                * (0.3 + 0.7 * pressure)
                * if rank <= 1 { 1.0 } else { 0.4 };
            while total < extent && widths.len() < 4096 {
                rhythm = (0.7 * rhythm + 0.3 * rr.range(0.8, 1.25)).clamp(0.8, 1.25);
                let mut w = (module * rhythm).max(lo);
                if merge > 0.0 && rr.chance(merge) {
                    w *= if rr.chance(0.3) { 3.0 } else { 2.0 };
                }
                widths.push(w);
                total += w;
            }
            if widths.len() > 1 && total - extent > 0.5 * widths[widths.len() - 1] {
                total -= widths.pop().unwrap();
            }
            // Explicit corner lots: the end lot on a block corner is wider, so
            // it can turn the corner with an L-shaped house.
            if widths.len() >= 4 {
                let last = widths.len() - 1;
                for (end, i) in [(s0, 0), (s1, last)] {
                    if corners
                        .iter()
                        .any(|c| (dot(*c, cut_axis) - end).abs() < 1.0)
                    {
                        total += widths[i] * 0.4;
                        widths[i] *= 1.4;
                    }
                }
            }
            let lots: Vec<f64> = widths.iter().map(|w| w * extent / total).collect();
            let count = lots.len();
            let nominal: Vec<f64> = lots
                .iter()
                .scan(0.0, |acc, w| {
                    *acc += w;
                    Some(*acc)
                })
                .take(count.saturating_sub(1))
                .collect();
            // Off-frame (curved or oblique) streets: each cut turns with the
            // street, limited between neighbours so lots never become wedges;
            // framed streets keep one parallel cut direction. Both admissible
            // orientations are evaluated when the territory's own sides are
            // oblique: cuts interpolated between those sides (parallelograms
            // or gentle trapezoids) win when they balance the lots better.
            let normal_cuts = if sweep {
                cut_directions(&stations, &nominal, &lots, cut_axis, limit - frontage_level)
            } else {
                vec![cut_axis; nominal.len()]
            };
            let narrowest = lo.min(extent / count as f64) * 0.75;
            let mut best = cut_strip(&territory, &stations, &lots, &normal_cuts, narrowest);
            if let Some(sided) = side_directions(&territory, &stations, &nominal, cut_axis)
                && sided
                    .iter()
                    .zip(&normal_cuts)
                    .any(|(a, b)| dot(*a, *b) < 10.0_f64.to_radians().cos())
            {
                let other = cut_strip(&territory, &stations, &lots, &sided, narrowest);
                if balance(&other) < 0.85 * balance(&best) {
                    best = other;
                }
            }
            for (piece, _, _) in best {
                plots.push(parcel(piece, block, axis, fronts, "plot"));
            }
        }
    }
    for cell in available {
        plots.push(parcel(cell, block, axis, &[], "garden"));
    }
    merge_slivers(&mut plots, fronts, Some(maximum_depth));
    plots
}

/// Invariant (edge reserves): open land left between the built fingers of a
/// town is not a blank. A vacant block with street frontage is enclosed as
/// crofts, orchards and market gardens, cut like lots at field scale (16-36 m
/// fronts, as deep as the block allows). They hold no house: use `garden`,
/// family `reserve`, so housing demand and population never move there.
fn edge_enclosures(
    shape: &Shape,
    block: usize,
    axis: Point,
    fronts: &[Front],
    morph: &Morph,
    zone: &str,
    rng: &mut Rng,
) -> Vec<Parcel> {
    let mut field = morph.clone();
    field.value["frontage"][zone] = serde_json::json!([16.0, 36.0]);
    field.value["plotDepth"][zone] = serde_json::json!([60.0, 160.0]);
    field.value["houseArea"][zone] = serde_json::json!([400.0, 900.0]);
    field.value["coverage"][zone] = serde_json::json!([0.95, 0.95]);
    field.value["deepFill"] = serde_json::json!(true);
    field.value["wideLotChance"] = serde_json::json!(0.15);
    let mut lots = strips(shape, block, axis, fronts, &field, zone, rng);
    for p in &mut lots {
        p.use_kind = "garden".into();
        p.reason = "edge-enclosure".into();
        p.family = "reserve".into();
        p.envelope = None;
        p.provenance.push("edge-enclosure".into());
    }
    lots
}

/// One strip partition of a territory: `lots` frontage lengths along the real
/// frontage, internal cuts in the given directions (plane normals along the
/// street). Each cut keeps its direction and slides along the frontage
/// (bounded to 35 % of a lot, monotone bisection on the exact half-plane area)
/// until its lot holds its frontage-weighted share of the territory. Returns
/// every piece with its lot index and that lot's actual frontage station span.
fn cut_strip(
    territory: &Shape,
    stations: &Stations,
    lots: &[f64],
    directions: &[Point],
    narrowest: f64,
) -> Vec<(Shape, usize, f64)> {
    let count = lots.len();
    let extent = stations.total;
    let whole = area(territory);
    let mut out = vec![];
    let mut rem = vec![territory.clone()];
    let (mut assigned, mut previous, mut nominal) = (0.0, 0.0, 0.0);
    for k in 0..count {
        if k + 1 == count {
            out.extend(rem.drain(..).map(|c| (c, k, extent - previous)));
            break;
        }
        nominal += lots[k];
        let direction = directions[k];
        let level_at = |s: f64| dot(stations.at(s).0, direction);
        let below = |s: f64| {
            rem.iter()
                .map(|c| half_area(c, direction, level_at(s)))
                .sum::<f64>()
        };
        let want = whole * nominal / extent - assigned;
        let reach = 0.35 * lots[k].min(lots[k + 1]);
        let lo_s = (nominal - reach).max(previous + narrowest);
        let hi_s = (nominal + reach)
            .min(extent - narrowest * (count - 1 - k) as f64)
            .max(lo_s);
        let station = if below(lo_s) >= want {
            lo_s
        } else if below(hi_s) <= want {
            hi_s
        } else {
            let (mut a, mut b) = (lo_s, hi_s);
            for _ in 0..16 {
                let m = 0.5 * (a + b);
                if below(m) < want {
                    a = m;
                } else {
                    b = m;
                }
                if b - a < 0.02 {
                    break;
                }
            }
            0.5 * (a + b)
        };
        let span = station - previous;
        previous = station;
        let level = level_at(station);
        let mut next = Vec::new();
        for cell in rem {
            for piece in half(&cell, direction, level, true) {
                assigned += area(&piece);
                out.push((piece, k, span));
            }
            next.extend(half(&cell, direction, level, false));
        }
        rem = next;
    }
    out
}

/// Worst neighbour ratio of depth-equivalent areas (area per metre of frontage).
fn balance(pieces: &[(Shape, usize, f64)]) -> f64 {
    let n = pieces.iter().map(|p| p.1 + 1).max().unwrap_or(0);
    let mut per = vec![(0.0, 0.0); n];
    for (s, k, span) in pieces {
        per[*k].0 += area(s);
        per[*k].1 = span.max(0.5);
    }
    let depth: Vec<f64> = per.iter().map(|(a, f)| a / f).collect();
    depth
        .windows(2)
        .map(|w| w[0].max(w[1]) / w[0].min(w[1]).max(1e-6))
        .fold(1.0, f64::max)
}

/// Cut directions interpolated, along the frontage, between the territory's
/// two side boundaries at the ends of its frontage (each within 50 degrees of
/// square). None when a side cannot be read.
fn side_directions(
    territory: &Shape,
    stations: &Stations,
    cuts: &[f64],
    along: Point,
) -> Option<Vec<Point>> {
    if cuts.is_empty() {
        return None;
    }
    let ring = &territory.outer;
    let n = ring.len();
    let on_front = |a: Point, b: Point| {
        let m = scale(add(a, b), 0.5);
        stations
            .segments
            .iter()
            .any(|(p, q, _)| distance(m, *p, *q) < 0.03)
    };
    // Plane normal of a cut parallel to the side leaving the frontage end `p`.
    let side = |p: Point| -> Option<f64> {
        let i =
            (0..n).min_by(|&i, &j| length(sub(ring[i], p)).total_cmp(&length(sub(ring[j], p))))?;
        if length(sub(ring[i], p)) > 0.05 {
            return None;
        }
        for step in [1, n - 1] {
            if on_front(ring[i], ring[(i + step) % n]) {
                continue;
            }
            // Walk the side until 3 m away from the frontage end.
            let mut j = i;
            for _ in 0..n {
                j = (j + step) % n;
                if length(sub(ring[j], p)) >= 3.0 {
                    break;
                }
            }
            let d = unit(sub(ring[j], p));
            let m = normal(d);
            let m = if dot(m, along) < 0.0 {
                scale(m, -1.0)
            } else {
                m
            };
            if dot(m, along) < 50.0_f64.to_radians().cos() {
                return None;
            }
            let cross = along.x * m.y - along.y * m.x;
            return Some(cross.atan2(dot(along, m)));
        }
        None
    };
    let first = side(stations.at(0.0).0)?;
    let last = side(stations.at(stations.total).0)?;
    Some(
        cuts.iter()
            .map(|s| {
                let a = first + (last - first) * s / stations.total;
                let (sin, cos) = a.sin_cos();
                Point {
                    x: along.x * cos - along.y * sin,
                    y: along.x * sin + along.y * cos,
                }
            })
            .collect(),
    )
}

fn minimum_angle(shape: &Shape) -> f64 {
    let mut angle = std::f64::consts::PI;
    for i in 0..shape.outer.len() {
        let p = shape.outer[i];
        let a = unit(sub(
            shape.outer[(i + shape.outer.len() - 1) % shape.outer.len()],
            p,
        ));
        let b = unit(sub(shape.outer[(i + 1) % shape.outer.len()], p));
        let convex_angle = dot(a, b).clamp(-1.0, 1.0).acos();
        let interior_angle = if a.x * b.y - a.y * b.x > 0.0 {
            std::f64::consts::TAU - convex_angle
        } else {
            convex_angle
        };
        angle = angle.min(interior_angle);
    }
    angle
}

/// Competing inward frontage planes. Unlike first-front wins, opposite fronts
/// meet at their equal-distance seam; non-convex results retain separate components.
fn frontage_territories(
    shape: &Shape,
    block: usize,
    axis: Point,
    fronts: &[Front],
    morph: &Morph,
    zone: &str,
    rng: &mut Rng,
) -> Vec<Parcel> {
    let rs = runs(fronts);
    let planes: Vec<_> = rs
        .iter()
        .filter_map(|run| {
            let a = run.first()?.a;
            let b = run.last()?.b;
            (length(sub(b, a)) > 3.0).then(|| (normal(unit(sub(b, a))), a, run))
        })
        .collect();
    let mut available = vec![shape.clone()];
    let mut plots = vec![];
    for (i, &(n, a, run)) in planes.iter().enumerate().take(64) {
        let mut territories = available.clone();
        for &(other, b, _) in &planes {
            let delta = sub(n, other);
            let len = length(delta);
            if len < 1e-8 {
                continue;
            }
            // n·(p-a) <= other·(p-b).
            let at = (dot(n, a) - dot(other, b)) / len;
            let d = scale(delta, 1.0 / len);
            territories = territories
                .into_iter()
                .flat_map(|s| half(&s, d, at, true))
                .collect();
        }
        territories.retain(|s| frontage(s, run).0 >= 3.0);
        for territory in territories {
            available = available
                .into_iter()
                .flat_map(|s| difference(&s, &territory))
                .collect();
            plots.extend(strips(
                &territory,
                block,
                axis,
                run,
                morph,
                zone,
                &mut rng.fork(&format!("territory:{i}")),
            ));
        }
    }
    // Global competing planes can eliminate every territory around a concave
    // access tree. Fall back once to local front bands instead of silently
    // returning the entire accessible block as one garden.
    if !plots.iter().any(|p| p.use_kind == "plot") && !fronts.is_empty() {
        let mut fallback = strips(
            shape,
            block,
            axis,
            fronts,
            morph,
            zone,
            &mut rng.fork("territory-fallback"),
        );
        for p in &mut fallback {
            p.provenance
                .push("concave-territory-frontage-fallback".into());
        }
        return fallback;
    }
    plots.extend(
        available
            .into_iter()
            .map(|s| parcel(s, block, axis, &[], "garden")),
    );
    merge_slivers(&mut plots, fronts, Some(maximum_plot_depth(morph, zone)));
    plots
}

fn courtyards(
    shape: &Shape,
    block: usize,
    axis: Point,
    fronts: &[Front],
    morph: &Morph,
    zone: &str,
    rng: &mut Rng,
) -> Vec<Parcel> {
    let [amin, amax] = morph.range("houseArea", zone);
    let amin = amin.max(20.0);
    let amax = amax.max(amin);
    let min_width = (amin.sqrt() * 0.55)
        .max(6.0)
        .max(morph.range("frontage", zone)[0]);
    let chinese = morph.text("plotOp") == "siheyuan";
    let mut queue = vec![shape.clone()];
    let mut done = Vec::new();
    let mut guard = 0;
    while let Some(cell) = queue.pop() {
        guard += 1;
        if guard > 4000 {
            done.push(cell);
            done.extend(queue);
            break;
        }
        let cell_area = area(&cell);
        let target = amin * (amax / amin).powf(rng.float());
        if cell_area <= target * 1.3 {
            done.push(cell);
            continue;
        }
        let v = normal(axis);
        let (u0, u1) = bounds(&cell, axis);
        let (v0, v1) = bounds(&cell, v);
        let directions = if u1 - u0 >= v1 - v0 {
            [axis, v]
        } else {
            [v, axis]
        };
        let fraction = rng
            .fork(&format!("split-position:{guard}"))
            .range(0.42, 0.58);
        let mut best = None;
        let mut score = f64::INFINITY;
        // Both admissible orientations are evaluated; each cut position is the
        // one that splits the *area* at the tried fraction (bisection on the
        // exact half-plane area), never a fraction of the projected box.
        for (di, d) in directions.into_iter().enumerate() {
            let (lo, hi) = bounds(&cell, d);
            for fraction_try in [fraction, 0.5, 0.43, 0.57, 0.36, 0.64] {
                let want = cell_area * fraction_try;
                let (mut a, mut b) = (lo, hi);
                for _ in 0..40 {
                    let m = 0.5 * (a + b);
                    if half_area(&cell, d, m) < want {
                        a = m;
                    } else {
                        b = m;
                    }
                    if b - a < 0.01 {
                        break;
                    }
                }
                let at = 0.5 * (a + b);
                let x = half(&cell, d, at, true);
                let y = half(&cell, d, at, false);
                // A concave cut may have several disconnected components. Keep
                // those exact pieces only when every component retains access.
                if x.is_empty() || y.is_empty() {
                    continue;
                }
                let parts: Vec<Shape> = x.into_iter().chain(y).collect();
                let mut valid = true;
                let mut aspect_penalty = 0.0;
                for p in &parts {
                    let (len, f) = frontage(p, fronts);
                    let (a, b) = bounds(p, axis);
                    let (c, d) = bounds(p, v);
                    let width = (b - a).min(d - c);
                    let aspect = (b - a).max(d - c) / width.max(1e-9);
                    if area(p) < amin * 0.55
                        || len < 3.5
                        || width < min_width
                        || aspect > 4.5
                        || minimum_angle(p) < if chinese { 12.0_f64.to_radians() } else { 0.35 }
                        || (chinese && f.is_none_or(|f| length(sub(f.b, f.a)) < 12.0))
                    {
                        valid = false;
                        break;
                    }
                    aspect_penalty += (aspect - 2.0).max(0.0) * 0.3;
                }
                if !valid {
                    continue;
                }
                let largest = parts.iter().map(area).fold(0.0, f64::max);
                let smallest = parts.iter().map(area).fold(f64::INFINITY, f64::min);
                let s = 0.3 * (largest - smallest) / cell_area
                    + di as f64 * 0.35
                    + (fraction_try - fraction).abs()
                    + aspect_penalty;
                if s < score {
                    score = s;
                    best = Some(parts);
                }
            }
        }
        if let Some(parts) = best {
            queue.extend(parts);
        } else {
            done.push(cell);
        }
    }
    let mut result: Vec<Parcel> = done
        .into_iter()
        .enumerate()
        .flat_map(|(i, s)| {
            if area(&s) > 3.0 * amax
                || (morph.text("plotOp") != "compound"
                    && plot_depth(&s, axis, fronts)
                        .is_some_and(|depth| depth > maximum_plot_depth(morph, zone) + 0.01))
            {
                // A courtyard cut can fail because its rear child has no street
                // access. Keep real frontages, and reserve the unserved interior
                // instead of returning a single enormous residential compound.
                strips(
                    &s,
                    block,
                    axis,
                    fronts,
                    morph,
                    zone,
                    &mut rng.fork(&format!("courtyard-frontage:{i}")),
                )
            } else {
                vec![parcel(s, block, axis, fronts, "plot")]
            }
        })
        .collect();
    merge_slivers(
        &mut result,
        fronts,
        (morph.text("plotOp") != "compound").then(|| maximum_plot_depth(morph, zone)),
    );
    result
}

fn shared(a: &Shape, b: &Shape) -> f64 {
    let mut len = 0.0;
    for i in 0..a.outer.len() {
        let p = a.outer[i];
        let q = a.outer[(i + 1) % a.outer.len()];
        let dir = unit(sub(q, p));
        let edge_len = length(sub(q, p));
        for j in 0..b.outer.len() {
            let r = b.outer[j];
            let s = b.outer[(j + 1) % b.outer.len()];
            if dot(dir, unit(sub(s, r))).abs() < 0.99999 {
                continue;
            }
            // Overlapping collinear edges may use different vertex splits.
            let off = sub(r, p);
            if (off.x * dir.y - off.y * dir.x).abs() > 0.01 {
                continue;
            }
            let u = dot(off, dir);
            let v = dot(sub(s, p), dir);
            len += (u.max(v).min(edge_len) - u.min(v).max(0.0)).max(0.0);
        }
    }
    len
}

fn joined(a: &Shape, b: &Shape) -> Option<Shape> {
    use geo::{BooleanOps, Coord, LineString, Polygon};
    let ring = |points: &[Point]| {
        let mut coords: Vec<Coord> = points.iter().map(|p| Coord { x: p.x, y: p.y }).collect();
        if let Some(first) = coords.first().copied() {
            coords.push(first);
        }
        LineString::new(coords)
    };
    let poly = |s: &Shape| Polygon::new(ring(&s.outer), s.holes.iter().map(|r| ring(r)).collect());
    // The overlay solver can abort on a folded ring: a failed join is no
    // join (native builds also survive a solver panic on odd input).
    let overlay = |x: &Shape, y: &Shape| std::panic::catch_unwind(|| poly(x).union(&poly(y))).ok();
    let mut union = overlay(a, b)?;
    if union.0.len() != 1 {
        // Neighbours cut by separate half-planes share their side only to
        // floating precision (sub-centimetre gaps): snap the vertices of each
        // lying on a side of the other onto it, then join again. Snapping a
        // sliver can fold it over itself: only simple rings are joined.
        let a2 = snap_onto(a, b, 0.02);
        let b2 = snap_onto(b, &a2, 0.02);
        if !super::geometry::simple(&a2) || !super::geometry::simple(&b2) {
            return None;
        }
        union = overlay(&a2, &b2)?;
        if union.0.len() != 1 {
            return None;
        }
    }
    let p = &union.0[0];
    let points = |r: &LineString| {
        r.0.iter()
            .take(r.0.len().saturating_sub(1))
            .map(|p| Point { x: p.x, y: p.y })
            .collect()
    };
    Some(Shape {
        outer: points(p.exterior()),
        holes: p.interiors().iter().map(points).collect(),
    })
}

/// `shape` with each vertex within `tolerance` of a side of `onto` moved onto
/// that side (its nearest point), so two neighbours share the side exactly.
fn snap_onto(shape: &Shape, onto: &Shape, tolerance: f64) -> Shape {
    let sides: Vec<(Point, Point)> = std::iter::once(&onto.outer)
        .chain(onto.holes.iter())
        .flat_map(|r| (0..r.len()).map(move |i| (r[i], r[(i + 1) % r.len()])))
        .collect();
    let snap = |p: Point| {
        sides
            .iter()
            .map(|&(a, b)| super::geometry::distance(p, a, b))
            .filter(|d| d.0 <= tolerance)
            .min_by(|x, y| x.0.total_cmp(&y.0))
            .map_or(p, |d| d.2)
    };
    Shape {
        outer: shape.outer.iter().map(|&p| snap(p)).collect(),
        holes: shape
            .holes
            .iter()
            .map(|r| r.iter().map(|&p| snap(p)).collect())
            .collect(),
    }
}

fn merge_slivers(cells: &mut Vec<Parcel>, fronts: &[Front], maximum_depth: Option<f64>) {
    for _ in 0..3 {
        let mut i = 0;
        while i < cells.len() {
            let cell = &cells[i];
            let a = area(&cell.shape);
            let (u0, u1) = bounds(&cell.shape, cell.axis);
            let (v0, v1) = bounds(&cell.shape, normal(cell.axis));
            let gate = frontage(&cell.shape, fronts).1.is_some_and(|f| f.gate);
            let bad = a < if cell.front.is_some() { 35.0 } else { 25.0 }
                || cell
                    .front
                    .is_some_and(|f| length(sub(f[1], f[0])) < if gate { 0.8 } else { 3.6 })
                || (a < 600.0 && (u1 - u0).min(v1 - v0) < 2.2);
            if !bad {
                i += 1;
                continue;
            }
            let mut best = None;
            let mut score = 0.01;
            for (j, other) in cells.iter().enumerate() {
                if i == j {
                    continue;
                }
                let s = shared(&cell.shape, &other.shape)
                    * (if other.front.is_some() { 1.5 } else { 1.0 });
                if s > score {
                    score = s;
                    best = Some(j);
                }
            }
            if let Some(j) = best
                && let Some(shape) = joined(&cells[j].shape, &cells[i].shape)
            {
                if maximum_depth.is_some_and(|limit| {
                    plot_depth(&shape, cells[j].axis, fronts)
                        .is_some_and(|depth| depth > limit + 0.01)
                }) {
                    i += 1;
                    continue;
                }
                let mut merged = parcel(shape, cells[j].block, cells[j].axis, fronts, "plot");
                merged.parent_ids = vec![cells[j].id.clone(), cells[i].id.clone()];
                merged.provenance = cells[j].provenance.clone();
                merged.provenance.push("sliver-merge".into());
                cells[j] = merged;
                cells.remove(i);
                continue;
            }
            if cells[i]
                .front
                .is_some_and(|f| length(sub(f[1], f[0])) < if gate { 0.8 } else { 3.0 })
            {
                cells[i].front = None;
                cells[i].use_kind = "residual".to_owned();
                cells[i].reason = "insufficient-frontage".into();
            }
            i += 1;
        }
    }
}

enum Repair {
    Merge(Shape, Shape),
    Split([(Shape, Shape); 2]),
}

/// The union of two neighbours cut again into two equal areas, parallel to
/// their longest common side (the original cut). None when that cut does not
/// leave exactly two connected lots.
fn rebalance(union: &Shape, a: &Shape, b: &Shape) -> Option<[Shape; 2]> {
    split_share(union, normal(common_side(a, b)?), 0.5)
}

/// Direction of the longest common side (> 0.5 m) of two neighbours.
fn common_side(a: &Shape, b: &Shape) -> Option<Point> {
    let mut best: Option<(f64, Point)> = None;
    for i in 0..a.outer.len() {
        let p = a.outer[i];
        let q = a.outer[(i + 1) % a.outer.len()];
        let edge = length(sub(q, p));
        if edge < 0.5 {
            continue;
        }
        let dir = unit(sub(q, p));
        for j in 0..b.outer.len() {
            let r = b.outer[j];
            let s = b.outer[(j + 1) % b.outer.len()];
            if dot(dir, unit(sub(s, r))).abs() < 0.9999 {
                continue;
            }
            let off = sub(r, p);
            if (off.x * dir.y - off.y * dir.x).abs() > 0.01 {
                continue;
            }
            let (u, v) = (dot(off, dir), dot(sub(s, p), dir));
            let overlap = u.max(v).min(edge) - u.min(v).max(0.0);
            if overlap > best.map_or(0.5, |b| b.0) {
                best = Some((overlap, dir));
            }
        }
    }
    best.map(|b| b.1)
}

/// `union` cut by one line normal to `n`, its `dot(n, p) <= at` side holding
/// `share` of the area. None unless both sides are single connected lots.
fn split_share(union: &Shape, n: Point, share: f64) -> Option<[Shape; 2]> {
    let whole = area(union);
    let (mut lo, mut hi) = bounds(union, n);
    for _ in 0..40 {
        let m = 0.5 * (lo + hi);
        if half_area(union, n, m) < share * whole {
            lo = m;
        } else {
            hi = m;
        }
        if hi - lo < 0.01 {
            break;
        }
    }
    let at = 0.5 * (lo + hi);
    let mut x = half(union, n, at, true);
    let mut y = half(union, n, at, false);
    (x.len() == 1 && y.len() == 1).then(|| [x.remove(0), y.remove(0)])
}

fn boxes_touch(a: (f64, f64, f64, f64), b: (f64, f64, f64, f64)) -> bool {
    a.0 <= b.2 + 0.05 && b.0 <= a.2 + 0.05 && a.1 <= b.3 + 0.05 && b.1 <= a.3 + 0.05
}

/// Extent, projected on `along`, of the common boundary of `a` and `b`.
fn shared_span(a: &Shape, b: &Shape, along: Point) -> Option<(f64, f64)> {
    let mut span: Option<(f64, f64)> = None;
    for i in 0..a.outer.len() {
        let p = a.outer[i];
        let q = a.outer[(i + 1) % a.outer.len()];
        let edge_len = length(sub(q, p));
        if edge_len < 1e-9 {
            continue;
        }
        let dir = unit(sub(q, p));
        for j in 0..b.outer.len() {
            let r = b.outer[j];
            let s = b.outer[(j + 1) % b.outer.len()];
            if dot(dir, unit(sub(s, r))).abs() < 0.99999 {
                continue;
            }
            let off = sub(r, p);
            if (off.x * dir.y - off.y * dir.x).abs() > 0.01 {
                continue;
            }
            let (u, v) = (dot(off, dir), dot(sub(s, p), dir));
            let (lo, hi) = (u.min(v).max(0.0), u.max(v).min(edge_len));
            if hi - lo < 1e-6 {
                continue;
            }
            for t in [lo, hi] {
                let x = dot(add(p, scale(dir, t)), along);
                span = Some(span.map_or((x, x), |(m, n)| (m.min(x), n.max(x))));
            }
        }
    }
    span
}

/// Invariant (residual slivers): a lot left without any admissible house
/// beside admitted lots is shared out among them along their common
/// boundary, each piece joining the lot behind it (a strip left along a street
/// by deep opposite lots extends those lots to the street). Refused, and the
/// cell stays residual, when a piece has no admitted neighbour, a receiving lot
/// loses its witness, reaches past `too_deep` or more than doubles past `cap`.
/// A receiver that would grow past 2.5x its smallest admitted neighbour turns
/// the cell into open garden land instead (returns true, cell kept).
fn share_out(
    cells: &mut Vec<Parcel>,
    i: usize,
    fronts: &[Front],
    witness: &dyn Fn(&Shape) -> Option<Shape>,
    too_deep: &dyn Fn(&Shape) -> bool,
    cap: f64,
) -> bool {
    let r = cells[i].shape.clone();
    let rb = super::geometry::bbox(&r);
    let mut near: Vec<(usize, f64)> = cells
        .iter()
        .enumerate()
        .filter(|(j, p)| {
            *j != i
                && p.use_kind == "plot"
                && p.envelope.is_some()
                && boxes_touch(rb, super::geometry::bbox(&p.shape))
        })
        .map(|(j, p)| (j, shared(&r, &p.shape)))
        .filter(|&(_, s)| s > 0.5)
        .collect();
    if near.is_empty() {
        return false;
    }
    near.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
    let Some(along) = common_side(&r, &cells[near[0].0].shape) else {
        return false;
    };
    let mut spans: Vec<(usize, f64, f64)> = near
        .iter()
        .filter_map(|&(j, _)| shared_span(&r, &cells[j].shape, along).map(|(lo, hi)| (j, lo, hi)))
        .collect();
    spans.sort_by(|a, b| (a.1 + a.2).total_cmp(&(b.1 + b.2)).then(a.0.cmp(&b.0)));
    let cuts: Vec<f64> = spans
        .windows(2)
        .map(|w| {
            let (m0, m1) = (0.5 * (w[0].1 + w[0].2), 0.5 * (w[1].1 + w[1].2));
            (0.5 * (w[0].2 + w[1].1)).clamp(m0, m1.max(m0))
        })
        .collect();
    let mut grown: Vec<(usize, Shape)> = spans
        .iter()
        .map(|&(j, _, _)| (j, cells[j].shape.clone()))
        .collect();
    for k in 0..spans.len() {
        let mut pieces = vec![r.clone()];
        if k > 0 {
            pieces = pieces
                .iter()
                .flat_map(|s| half(s, along, cuts[k - 1], false))
                .collect();
        }
        if k + 1 < spans.len() {
            pieces = pieces
                .iter()
                .flat_map(|s| half(s, along, cuts[k], true))
                .collect();
        }
        for piece in pieces.into_iter().filter(|p| area(p) > 1e-6) {
            let Some((g, s)) = grown
                .iter()
                .enumerate()
                .map(|(g, (_, s))| (g, shared(&piece, s)))
                .max_by(|a, b| a.1.total_cmp(&b.1).then(b.0.cmp(&a.0)))
            else {
                return false;
            };
            if s < 0.05 {
                return false;
            }
            let Some(joint) = joined(&grown[g].1, &piece) else {
                return false;
            };
            grown[g].1 = joint;
        }
    }
    let mut accepted = Vec::new();
    for (j, shape) in grown {
        let before = area(&cells[j].shape);
        if (area(&shape) - before).abs() < 1e-9 {
            continue;
        }
        if too_deep(&shape) || area(&shape) > cap.max(2.0 * before) {
            return false;
        }
        // Lot balance: a grown lot stays within 2.5x of its smallest admitted
        // neighbour (the bound merges already keep); else the cell becomes the
        // garden of the lot behind it, never a bloated lot.
        let sb = super::geometry::bbox(&shape);
        let smallest = cells
            .iter()
            .enumerate()
            .filter(|(k, p)| {
                *k != i
                    && *k != j
                    && p.use_kind == "plot"
                    && p.envelope.is_some()
                    && boxes_touch(sb, super::geometry::bbox(&p.shape))
                    && shared(&shape, &p.shape) > 1.0
            })
            .map(|(_, p)| area(&p.shape))
            .fold(f64::INFINITY, f64::min);
        if area(&shape) > 2.5 * smallest {
            // The land is kept open instead: the garden of the lot behind it.
            let cell = &mut cells[i];
            cell.use_kind = "garden".into();
            cell.reason = "retained-backland".into();
            cell.front = None;
            cell.envelope = None;
            cell.provenance.push("balance-garden".into());
            return true;
        }
        let Some(envelope) = witness(&shape) else {
            return false;
        };
        accepted.push((j, shape, envelope));
    }
    if accepted.is_empty() {
        return false;
    }
    let residual_id = cells[i].id.clone();
    for (j, shape, envelope) in accepted {
        let old = &cells[j];
        let mut lot = parcel(shape, old.block, old.axis, fronts, "plot");
        lot.parent_ids = vec![old.id.clone(), residual_id.clone()];
        lot.provenance = old.provenance.clone();
        lot.provenance.push("residual-shared".into());
        lot.reason = old.reason.clone();
        lot.envelope = Some(envelope);
        cells[j] = lot;
    }
    cells.remove(i);
    true
}

/// The redraw of the boundary between two neighbours `a` and `b` (union
/// `union`, area ratio `ratio`): one cut parallel to their common side, placed
/// so that each keeps an area in proportion to its frontage. It must leave two
/// connected lots, divide the ratio by at least 1.25, stay within the depth
/// bound and keep both witnesses. (Cuts across the lots' fronts were tried and
/// rejected: each such redraw unbalances a third neighbour, 87 -> 160 pairs on 01-l.)
fn redraw_pair(
    union: &Shape,
    a: &Parcel,
    b: &Parcel,
    ratio: f64,
    fronts: &[Front],
    witness: &dyn Fn(&Shape) -> Option<Shape>,
    too_deep: &dyn Fn(&Shape) -> bool,
) -> Option<(Shape, Shape, Shape, Shape)> {
    let n = normal(common_side(&a.shape, &b.shape)?);
    let fa = frontage(&a.shape, fronts).0.max(1.0);
    let fb = frontage(&b.shape, fronts).0.max(1.0);
    let a_below =
        dot(super::geometry::centroid(&a.shape), n) < dot(super::geometry::centroid(&b.shape), n);
    let share = fa / (fa + fb);
    let below = if a_below { share } else { 1.0 - share };
    let [x, y] = split_share(union, n, below.clamp(0.3, 0.7))?;
    let (na, nb) = if a_below { (x, y) } else { (y, x) };
    let after = area(&na).max(area(&nb)) / area(&na).min(area(&nb)).max(1e-6);
    if after > 0.8 * ratio || too_deep(&na) || too_deep(&nb) {
        return None;
    }
    let (ea, eb) = (witness(&na)?, witness(&nb)?);
    Some((na, nb, ea, eb))
}

/// Invariant (corner lots): a corner lot holding 3 times or more the area of
/// an admitted neighbour of similar frontage on its street gives its far part
/// along the side street to a lot of its own, cut square to that street, so
/// the corner keeps about 1.6 times its neighbour. Both parts keep a witness
/// and the depth bound, the side part a frontage on the side street; the
/// partition stays exact (two half-planes of the same lot).
fn split_corners(
    cells: &mut Vec<Parcel>,
    fronts: &[Front],
    witness: &dyn Fn(&Shape) -> Option<Shape>,
    too_deep: &dyn Fn(&Shape) -> bool,
) {
    let cos45 = 45.0_f64.to_radians().cos();
    let mut i = 0;
    while i < cells.len() {
        let corner = &cells[i];
        // A corner: street contacts of 3 m or more in two directions 45
        // degrees apart (the `corner-lot` rule of `qualify`).
        let long: Vec<Point> = contacts::boundary_contacts(&corner.shape, fronts)
            .iter()
            .filter(|f| length(sub(f.b, f.a)) >= 3.0)
            .map(|f| unit(sub(f.b, f.a)))
            .collect();
        let is_corner = long
            .iter()
            .enumerate()
            .any(|(k, u)| long[k + 1..].iter().any(|v| dot(*u, *v).abs() < cos45));
        if corner.use_kind != "plot" || corner.envelope.is_none() || !is_corner {
            i += 1;
            continue;
        }
        let ai = area(&corner.shape);
        let (fi, _) = frontage(&corner.shape, fronts);
        // The smallest admitted neighbour of similar frontage along a street.
        let neighbour = cells
            .iter()
            .enumerate()
            .filter(|(j, q)| *j != i && q.use_kind == "plot" && q.envelope.is_some())
            .filter(|(_, q)| shared(&corner.shape, &q.shape) >= 1.0)
            .filter_map(|(_, q)| {
                let (len, f) = frontage(&q.shape, fronts);
                let f = f?;
                (len > 0.0 && fi > 0.0 && ai >= 3.0 * area(&q.shape)).then_some((area(&q.shape), f))
            })
            .min_by(|a, b| a.0.total_cmp(&b.0));
        let Some((aj, fj)) = neighbour else {
            i += 1;
            continue;
        };
        let u1 = unit(sub(fj.b, fj.a));
        let contacts = contacts::boundary_contacts(&corner.shape, fronts);
        let side = contacts
            .iter()
            .filter(|f| dot(unit(sub(f.b, f.a)), u1).abs() < cos45)
            .max_by(|a, b| length(sub(a.b, a.a)).total_cmp(&length(sub(b.b, b.a))));
        let main = contacts
            .iter()
            .filter(|f| dot(unit(sub(f.b, f.a)), u1).abs() >= cos45)
            .max_by(|a, b| length(sub(a.b, a.a)).total_cmp(&length(sub(b.b, b.a))));
        let (Some(side), Some(main)) = (side, main) else {
            i += 1;
            continue;
        };
        let n = unit(sub(side.b, side.a));
        let (lo, hi) = bounds(&corner.shape, n);
        // The corner part is the one on the main street's side.
        let corner_low = dot(n, scale(add(main.a, main.b), 0.5)) < 0.5 * (lo + hi);
        let target = (1.6 * aj / ai).clamp(0.3, 0.7);
        let split = [target, 0.5, 0.6, 0.4].into_iter().find_map(|share| {
            let [x, y] = split_share(
                &corner.shape,
                n,
                if corner_low { share } else { 1.0 - share },
            )?;
            let (c, rest) = if corner_low { (x, y) } else { (y, x) };
            let (ac, ar) = (area(&c), area(&rest));
            if ac.max(aj) / ac.min(aj) >= 3.0
                || ar < 0.5 * aj
                || too_deep(&c)
                || too_deep(&rest)
                || frontage(&rest, fronts).0 < 3.0
            {
                return None;
            }
            Some((c.clone(), witness(&c)?, rest.clone(), witness(&rest)?))
        });
        let Some((c, ec, rest, er)) = split else {
            i += 1;
            continue;
        };
        let (block, axis) = (corner.block, corner.axis);
        let mut provenance = corner.provenance.clone();
        provenance.push("corner-split".into());
        let parent = corner.id.clone();
        let make = |shape: Shape, envelope: Shape| {
            let mut p = parcel(shape, block, axis, fronts, "plot");
            p.envelope = Some(envelope);
            p.parent_ids = vec![parent.clone()];
            p.provenance = provenance.clone();
            p.reason = "admissibility-repaired".into();
            p
        };
        cells[i] = make(c, ec);
        let mut side_lot = make(rest, er);
        side_lot.provenance.retain(|x| x != "corner-lot");
        cells.push(side_lot);
        i += 1;
    }
}

/// Invariant (lot balance): two admitted neighbours, whether on one street or
/// back to back on two, never hold areas in a ratio of 3 or more when their
/// common boundary can move: the boundary is redrawn parallel to itself so
/// each keeps an area in proportion to its frontage, provided both keep their
/// witness and depth bound. Pairs come from a sweep over bounding boxes.
fn balance_neighbours(
    cells: &mut [Parcel],
    fronts: &[Front],
    witness: &dyn Fn(&Shape) -> Option<Shape>,
    too_deep: &dyn Fn(&Shape) -> bool,
) {
    for _ in 0..2 {
        let lots: Vec<usize> = (0..cells.len())
            .filter(|&i| cells[i].use_kind == "plot" && cells[i].envelope.is_some())
            .collect();
        let boxes: Vec<_> = lots
            .iter()
            .map(|&i| super::geometry::bbox(&cells[i].shape))
            .collect();
        let areas: Vec<f64> = cells.iter().map(|p| area(&p.shape)).collect();
        let mut order: Vec<usize> = (0..lots.len()).collect();
        order.sort_by(|&a, &b| boxes[a].0.total_cmp(&boxes[b].0).then(a.cmp(&b)));
        let mut pairs = Vec::new();
        for (k, &a) in order.iter().enumerate() {
            for &b in &order[k + 1..] {
                if boxes[b].0 > boxes[a].2 + 0.05 {
                    break;
                }
                if !boxes_touch(boxes[a], boxes[b]) {
                    continue;
                }
                let (x, y) = (lots[a], lots[b]);
                let ratio = areas[x].max(areas[y]) / areas[x].min(areas[y]).max(1e-6);
                if ratio >= 2.5 && shared(&cells[x].shape, &cells[y].shape) >= 1.0 {
                    pairs.push((ratio, x.min(y), x.max(y)));
                }
            }
        }
        pairs.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.cmp(&b.1)).then(a.2.cmp(&b.2)));
        let mut touched = vec![false; cells.len()];
        let mut changed = false;
        for (ratio, a, b) in pairs {
            if touched[a] || touched[b] {
                continue;
            }
            let Some(union) = joined(&cells[a].shape, &cells[b].shape) else {
                continue;
            };
            let Some((na, nb, ea, eb)) = redraw_pair(
                &union, &cells[a], &cells[b], ratio, fronts, witness, too_deep,
            ) else {
                continue;
            };
            let parents = vec![cells[a].id.clone(), cells[b].id.clone()];
            for (k, shape, envelope) in [(a, na, ea), (b, nb, eb)] {
                let old = &cells[k];
                let mut lot = parcel(shape, old.block, old.axis, fronts, "plot");
                lot.parent_ids = parents.clone();
                lot.provenance = old.provenance.clone();
                lot.provenance.push("neighbour-balance".into());
                lot.reason = old.reason.clone();
                lot.envelope = Some(envelope);
                cells[k] = lot;
                touched[k] = true;
            }
            changed = true;
        }
        if !changed {
            break;
        }
    }
}

fn access_kind(front: &Front, layout: &Layout) -> &'static str {
    if front.shared {
        return "collective";
    }
    match layout.streets[front.street].role.as_str() {
        "private" | "derb" | "hutong" | "roji" => "private",
        "collective" | "close" => "collective",
        _ => "public",
    }
}
/// Two bounded local repair passes. Every accepted repair must contain the
/// cultural witness; courts, reserves and intentional gardens are immutable.
/// A lot is admitted by the primary native recipe or, failing that, by the
/// pack's compact `fallback`. With `inward` (courtyard families) the primary
/// house sits anywhere in its lot behind a gate: any contact as wide as the
/// recipe's access admits it, never a 30 m street frontage.
#[allow(clippy::too_many_arguments)]
fn qualify(
    cells: &mut Vec<Parcel>,
    fronts: &[Front],
    layout: &Layout,
    profile: &super::culture::UrbanAdmissibility,
    fallback: Option<&super::culture::UrbanAdmissibility>,
    inward: bool,
    family: &str,
    depth_limit: Option<f64>,
) {
    let tier = |shape: &Shape, a: &super::culture::UrbanAdmissibility, gated: bool| {
        if area(shape) + 1e-6 < a.min_area {
            return None;
        }
        let allowed: Vec<_> = fronts
            .iter()
            .filter(|f| !f.shared || a.shared_access)
            .map(|f| Front {
                gate: f.gate || gated,
                ..*f
            })
            .collect();
        families::envelope(
            shape,
            &allowed,
            a.min_frontage,
            a.min_depth,
            a.min_access_width,
        )
    };
    let witness = |shape: &Shape| {
        tier(shape, profile, inward).or_else(|| fallback.and_then(|f| tier(shape, f, false)))
    };
    for p in cells.iter_mut().filter(|p| p.use_kind == "plot") {
        p.envelope = witness(&p.shape);
    }
    // Lot size bound for merges: 2x the block's median admitted lot.
    let cap = {
        let mut admitted: Vec<f64> = cells
            .iter()
            .filter(|p| p.use_kind == "plot" && p.envelope.is_some())
            .map(|p| area(&p.shape))
            .collect();
        admitted.sort_by(f64::total_cmp);
        admitted
            .get(admitted.len() / 2)
            .map_or(f64::INFINITY, |m| 2.0 * m.max(2.0 * profile.min_area))
    };
    for _ in 0..2 {
        let mut i = 0;
        while i < cells.len() {
            if cells[i].use_kind != "plot" || cells[i].envelope.is_some() {
                i += 1;
                continue;
            }
            let mut candidates: Vec<_> = cells
                .iter()
                .enumerate()
                .filter(|(j, p)| *j != i && p.use_kind == "plot")
                .map(|(j, p)| (j, shared(&cells[i].shape, &p.shape)))
                .filter(|&(_, s)| s > 0.05)
                .collect();
            candidates.sort_by(|a, b| b.1.total_cmp(&a.1).then(a.0.cmp(&b.0)));
            let deep =
                |s: &Shape| depth_limit.is_some_and(|limit| lot_depth(s, fronts) > limit + 0.01);
            let repair = candidates.into_iter().take(8).find_map(|(j, _)| {
                let shape = joined(&cells[i].shape, &cells[j].shape)?;
                // A balanced re-split of the pair along their common side comes
                // first: two equal lots instead of one double lot beside a small one.
                if let Some(split) = rebalance(&shape, &cells[i].shape, &cells[j].shape) {
                    let envelopes = (witness(&split[0]), witness(&split[1]));
                    if let (Some(a), Some(b)) = envelopes
                        && !deep(&split[0])
                        && !deep(&split[1])
                    {
                        let [x, y] = split;
                        return Some((j, Repair::Split([(x, a), (y, b)])));
                    }
                }
                // No family may merge past the cultural lot depth (bug 2b), nor
                // past the block's lot size bound (no 10x lot beside its neighbours),
                // nor past 2.5x its smallest admitted neighbour: such a cell is
                // shared out among its neighbours below instead.
                if deep(&shape) || area(&shape) > cap {
                    return None;
                }
                let merged = area(&shape);
                let sb = super::geometry::bbox(&shape);
                let smallest = cells
                    .iter()
                    .enumerate()
                    .filter(|(k, p)| {
                        *k != i
                            && *k != j
                            && p.use_kind == "plot"
                            && p.envelope.is_some()
                            && boxes_touch(sb, super::geometry::bbox(&p.shape))
                            && shared(&shape, &p.shape) > 0.5
                    })
                    .map(|(_, p)| area(&p.shape))
                    .fold(f64::INFINITY, f64::min);
                if merged > 2.5 * smallest {
                    return None;
                }
                let envelope = witness(&shape)?;
                Some((j, Repair::Merge(shape, envelope)))
            });
            match repair {
                Some((j, Repair::Merge(shape, envelope))) => {
                    let mut repaired = parcel(shape, cells[i].block, cells[i].axis, fronts, "plot");
                    repaired.parent_ids = vec![cells[i].id.clone(), cells[j].id.clone()];
                    repaired.provenance = vec!["admissibility-merge".into()];
                    repaired.reason = "admissibility-repaired".into();
                    repaired.envelope = Some(envelope);
                    cells[i] = repaired;
                    cells.remove(j);
                    if j < i {
                        i = i.saturating_sub(1);
                    }
                }
                Some((j, Repair::Split(halves))) => {
                    let parents = vec![cells[i].id.clone(), cells[j].id.clone()];
                    for (k, (shape, envelope)) in [i, j].into_iter().zip(halves) {
                        let mut lot = parcel(shape, cells[k].block, cells[k].axis, fronts, "plot");
                        lot.parent_ids = parents.clone();
                        lot.provenance = vec!["admissibility-rebalance".into()];
                        lot.reason = "admissibility-repaired".into();
                        lot.envelope = Some(envelope);
                        cells[k] = lot;
                    }
                    i += 1;
                }
                None => i += 1,
            }
        }
    }
    // Through lots may reach a little past the cultural depth: their second
    // contact is a street, not back land.
    let through_deep =
        |s: &Shape| depth_limit.is_some_and(|limit| lot_depth(s, fronts) > 1.25 * limit + 0.01);
    let mut i = 0;
    while i < cells.len() {
        let leftover = (cells[i].use_kind == "plot" && cells[i].envelope.is_none())
            || (cells[i].use_kind == "residual" && cells[i].reason == "insufficient-frontage");
        if leftover && share_out(cells, i, fronts, &witness, &through_deep, cap) {
            continue;
        }
        i += 1;
    }
    let strict_deep =
        |s: &Shape| depth_limit.is_some_and(|limit| lot_depth(s, fronts) > limit + 0.01);
    balance_neighbours(cells, fronts, &witness, &strict_deep);
    split_corners(cells, fronts, &witness, &strict_deep);
    // Frontage rule of the tier that admitted the lot (the lenient one for refusals).
    let lenient = fallback.unwrap_or(profile);
    for p in cells.iter_mut() {
        p.family = family.into();
        let contacts = contacts::boundary_contacts(&p.shape, fronts);
        let primary = p
            .envelope
            .as_ref()
            .is_some_and(|e| witnessed_by(e, profile));
        let rule = if primary || fallback.is_none() {
            profile
        } else {
            lenient
        };
        let gated = inward && primary;
        if p.use_kind == "plot" {
            if p.envelope.is_none() {
                p.use_kind = "residual".into();
                p.reason = if !contacts.iter().enumerate().any(|(i, f)| {
                    let (lo, hi) = contacts::support_span(&contacts, i);
                    hi - lo + 1e-6
                        >= if f.gate {
                            lenient.min_access_width
                        } else {
                            lenient.min_frontage
                        }
                }) {
                    "insufficient-cultural-frontage"
                } else {
                    "no-admissible-envelope"
                }
                .into();
            } else if p.reason != "admissibility-repaired" {
                p.reason = "admissible-envelope".into();
            }
        } else if p.reason == "insufficient-frontage" {
            p.use_kind = "residual".into();
        }
        let minimum = if p.use_kind == "court" {
            1.2
        } else {
            rule.min_frontage
        };
        let best = contacts
            .iter()
            .enumerate()
            .map(|(i, f)| {
                let (lo, hi) = contacts::support_span(&contacts, i);
                (f, hi - lo)
            })
            .filter(|(f, span)| {
                *span + 1e-6
                    >= if f.gate || gated {
                        rule.min_access_width
                    } else {
                        minimum
                    }
                    && (!f.shared || rule.shared_access || p.use_kind == "court")
            })
            .min_by(|(a, sa), (b, sb)| {
                a.rank
                    .cmp(&b.rank)
                    .then(a.shared.cmp(&b.shared))
                    .then_with(|| sb.total_cmp(sa))
            });
        let support = best.map_or(0.0, |(_, span)| span);
        let best = best.map(|(f, _)| f);
        p.front = best.map(|f| [f.a, f.b]);
        p.rank = best.map_or(99, |f| f.rank);
        p.access = Some(super::ParcelAccess {
            // A court house is entered through its own gate, not a shop front.
            kind: best
                .map_or("unserved", |f| match access_kind(f, layout) {
                    "public" if gated => "private",
                    kind => kind,
                })
                .into(),
            street: best.map(|f| f.street),
            front_length: support,
        });
        if p.use_kind == "plot"
            && !p.provenance.iter().any(|x| x == "corner-lot")
            && contacts.iter().enumerate().any(|(i, f)| {
                contacts.iter().skip(i + 1).any(|g| {
                    length(sub(f.b, f.a)) >= 3.0
                        && length(sub(g.b, g.a)) >= 3.0
                        && dot(unit(sub(f.b, f.a)), unit(sub(g.b, g.a))).abs()
                            < 45.0_f64.to_radians().cos()
                })
            })
        {
            p.provenance.push("corner-lot".into());
        }
        p.contacts = contacts
            .iter()
            .map(|f| super::ParcelContact {
                a: f.a,
                b: f.b,
                street: f.street,
                rank: f.rank,
                length: length(sub(f.b, f.a)),
                kind: access_kind(f, layout).into(),
            })
            .collect();
    }
    // A retained rear property is attached through ownership, without inventing
    // a street facade. Its geometry and its owner's ID both stay inspectable.
    for i in 0..cells.len() {
        if cells[i].use_kind != "garden" || cells[i].reason != "retained-backland" {
            continue;
        }
        let neighbor = cells
            .iter()
            .enumerate()
            .filter(|(_, p)| p.use_kind == "plot")
            .map(|(j, p)| (j, shared(&cells[i].shape, &p.shape)))
            .filter(|&(_, s)| s > 0.05)
            .max_by(|a, b| a.1.total_cmp(&b.1));
        if let Some((j, _)) = neighbor {
            cells[i].parent_ids = vec![cells[j].id.clone()];
            cells[i].reason = "attached-rear-land".into();
            cells[i].provenance.push("rear-land-attachment".into());
            cells[i].access = Some(super::ParcelAccess {
                kind: "attached".into(),
                street: cells[j].access.as_ref().and_then(|a| a.street),
                front_length: 0.0,
            });
        }
    }
}
/// Share of court-house candidates (a run of neighbours on one street that
/// together hold the culture's court house) that become one paired lot: the
/// rest stay the culture's ordinary houses, so a block mixes both types.
const COURT_PAIR_SHARE: f64 = 0.55;

/// Court lot pairs (« parcelles appariées pour maisons à cour »): in a tissue
/// whose native house is a court house (atrium, dar, siheyuan) but whose lots
/// are mostly too small for it (only the compact tier admits them), two to
/// four admitted neighbours on the same street are joined into one lot when
/// together they hold the court house's own envelope. Exact: the new lot is
/// the union of its parts (same area, parents recorded), never deeper than
/// the cultural lot depth; it is admitted by the primary (court) profile, so
/// the programme gives it the court dwelling and the preview its court.
#[allow(clippy::too_many_arguments)]
fn pair_courts(
    cells: &mut Vec<Parcel>,
    fronts: &[Front],
    layout: &Layout,
    profile: &super::culture::UrbanAdmissibility,
    fallback: Option<&super::culture::UrbanAdmissibility>,
    family: &str,
    depth_limit: Option<f64>,
    pack: Option<&str>,
    share: f64,
    rng: &mut Rng,
) {
    if fallback.is_none()
        || share <= 0.0
        || !matches!(
            profile.native_layout.as_str(),
            "courtyard" | "atrium" | "peristyle" | "siheyuan"
        )
    {
        return;
    }
    let inward = family == "courtyard";
    let allowed: Vec<Front> = fronts
        .iter()
        .filter(|f| !f.shared || profile.shared_access)
        .map(|f| Front {
            gate: f.gate || inward,
            ..*f
        })
        .collect();
    // The court house of the pair is a `dwelling` court source of the pack,
    // so the programme's court dwelling keeps its court (`courts::court_kept`).
    let block = cells.first().map_or(0, |c| c.block);
    let court_house = |s: &Shape| {
        pack.is_some_and(|pack| {
            let mut probe = parcel(s.clone(), block, Point { x: 1.0, y: 0.0 }, fronts, "plot");
            probe.family = family.into();
            courts::holds_court(&probe, pack, Some("dwelling"))
        })
    };
    let holds = |s: &Shape| {
        court_house(s)
            && area(s) + 1e-6 >= profile.min_area
            && families::envelope(
                s,
                &allowed,
                profile.min_frontage,
                profile.min_depth,
                profile.min_access_width,
            )
            .is_some()
    };
    let street = |p: &Parcel| p.access.as_ref().and_then(|a| a.street);
    let candidate = |p: &Parcel| {
        p.use_kind == "plot"
            && p.envelope
                .as_ref()
                .is_some_and(|e| !witnessed_by(e, profile))
            && street(p).is_some()
    };
    let mut used = vec![false; cells.len()];
    let mut merged: Vec<(Vec<usize>, Shape)> = Vec::new();
    for i in 0..cells.len() {
        if used[i] || !candidate(&cells[i]) {
            continue;
        }
        let draw = rng.fork(&format!("court-pair:{i}")).float();
        if draw >= share {
            continue;
        }
        let mut group = vec![i];
        let mut shape = cells[i].shape.clone();
        let mut total = area(&shape);
        let mut found = false;
        while group.len() < 4 {
            let next = (0..cells.len())
                .filter(|&j| !used[j] && !group.contains(&j) && candidate(&cells[j]))
                .filter(|&j| street(&cells[j]) == street(&cells[i]))
                .map(|j| (j, shared(&shape, &cells[j].shape)))
                .filter(|&(_, s)| s >= 2.0)
                .max_by(|a, b| a.1.total_cmp(&b.1).then(b.0.cmp(&a.0)));
            let Some((j, _)) = next else { break };
            let Some(union) = joined(&shape, &cells[j].shape) else {
                break;
            };
            let sum = total + area(&cells[j].shape);
            // Exact union only (no snapped seam), no hole, within the depth.
            if (area(&union) - sum).abs() > 1e-6 * sum.max(1.0)
                || !union.holes.is_empty()
                || depth_limit.is_some_and(|limit| lot_depth(&union, fronts) > limit + 0.01)
            {
                break;
            }
            group.push(j);
            shape = union;
            total = sum;
            if holds(&shape) {
                found = true;
                break;
            }
        }
        if found {
            for &g in &group {
                used[g] = true;
            }
            merged.push((group, shape));
        }
    }
    if merged.is_empty() {
        return;
    }
    let mut out: Vec<Parcel> = Vec::with_capacity(cells.len());
    let mut lots: Vec<Option<Parcel>> = merged
        .iter()
        .map(|(group, shape)| {
            let first = &cells[group[0]];
            let mut lot = parcel(shape.clone(), first.block, first.axis, fronts, "plot");
            lot.parent_ids = group.iter().map(|&g| cells[g].id.clone()).collect();
            lot.provenance = first.provenance.clone();
            lot.provenance.push("court-pair".into());
            lot.reason = "admissibility-repaired".into();
            let mut one = vec![lot];
            qualify(
                &mut one,
                fronts,
                layout,
                profile,
                fallback,
                inward,
                family,
                depth_limit,
            );
            one.pop()
        })
        .collect();
    // The court profile must admit the union, else its parts stay as they were.
    let mut leader: BTreeMap<usize, Parcel> = BTreeMap::new();
    let mut gone = vec![false; cells.len()];
    for ((group, _), lot) in merged.iter().zip(lots.iter_mut()) {
        if let Some(lot) = lot.take().filter(|lot| {
            lot.use_kind == "plot"
                && lot
                    .envelope
                    .as_ref()
                    .is_some_and(|e| witnessed_by(e, profile))
        }) {
            for &g in group {
                gone[g] = true;
            }
            leader.insert(group[0], lot);
        }
    }
    for (i, cell) in std::mem::take(cells).into_iter().enumerate() {
        if let Some(lot) = leader.remove(&i) {
            out.push(lot);
        } else if !gone[i] {
            out.push(cell);
        }
    }
    *cells = out;
}

/// Stretches of a block's outline that lie on the inner face of a town wall
/// (within 0.35 m of offset `-ribbon_half` from the curtain path, on its inner
/// side). Palisades, hedges and earthworks are not party walls.
fn wall_faces(shape: &Shape, layout: &Layout) -> Vec<(Point, Point)> {
    let mut out = Vec::new();
    let (x0, y0, x1, y1) = super::geometry::bbox(shape);
    for e in layout
        .enclosures
        .iter()
        .filter(|e| e.kind == "wall" && e.path.len() >= 3)
    {
        let h = super::fortification::ribbon_half(&e.kind);
        let near: Vec<(Point, Point)> = (0..e.path.len())
            .map(|i| (e.path[i], e.path[(i + 1) % e.path.len()]))
            .filter(|(a, b)| {
                a.x.min(b.x) <= x1 + h + 1.0
                    && a.x.max(b.x) >= x0 - h - 1.0
                    && a.y.min(b.y) <= y1 + h + 1.0
                    && a.y.max(b.y) >= y0 - h - 1.0
            })
            .collect();
        if near.is_empty() {
            continue;
        }
        let wall = Shape {
            outer: e.path.clone(),
            holes: vec![],
        };
        let on_face = |p: Point| {
            let d = near
                .iter()
                .map(|&(a, b)| distance(p, a, b))
                .fold(f64::INFINITY, f64::min);
            (d - h).abs() <= 0.35
        };
        let ring = &shape.outer;
        for i in 0..ring.len() {
            let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
            let m = scale(add(a, b), 0.5);
            if length(sub(b, a)) >= 0.5
                && on_face(a)
                && on_face(b)
                && on_face(m)
                && super::geometry::contains(&wall, m)
            {
                out.push((a, b));
            }
        }
    }
    out
}

/// Length of `shape`'s outline lying on the given wall faces.
fn wall_contact(shape: &Shape, faces: &[(Point, Point)]) -> f64 {
    let ring = &shape.outer;
    (0..ring.len())
        .map(|i| (ring[i], ring[(i + 1) % ring.len()]))
        .filter(|&(a, b)| {
            let m = scale(add(a, b), 0.5);
            faces.iter().any(|&(p, q)| {
                distance(a, p, q) < 0.05 && distance(b, p, q) < 0.05 && distance(m, p, q) < 0.05
            })
        })
        .map(|(a, b)| length(sub(b, a)))
        .sum()
}

/// Wall faces carried by a block's morph (`_wallFace`, set by `generate`).
fn morph_faces(morph: &Morph) -> Vec<(Point, Point)> {
    morph.value["_wallFace"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter_map(|v| {
                    let v = v.as_array()?;
                    let n = |i: usize| v.get(i).and_then(|x| x.as_f64());
                    Some((Point { x: n(0)?, y: n(1)? }, Point { x: n(2)?, y: n(3)? }))
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Invariant (faubourg against the wall): a lean-to the fortification drew
/// against the outer face of the curtain (`Enclosure.attached`, side `out`)
/// and left outside its `reserve` is a real lot: a plot of the outer block it
/// touches, fronting the gate road along its side within 2 m (its street
/// edge, at least 3 m long). A lean-to still inside the reserve, or with no
/// road beside it, stays decor; nothing is ever drawn in the ditch or glacis,
/// which the fortification never offers.
fn lean_to_lots(layout: &Layout) -> Vec<Parcel> {
    let mut out = Vec::new();
    for (ei, e) in layout.enclosures.iter().enumerate() {
        for (ai, a) in e.attached.iter().enumerate() {
            if a.side != "out" || a.shape.outer.len() < 3 {
                continue;
            }
            let own = area(&a.shape);
            let reserved: f64 = e
                .reserve
                .iter()
                .flat_map(|r| intersection(&a.shape, r))
                .map(|x| area(&x))
                .sum();
            if own < 4.0 || reserved > 0.5 * own {
                continue;
            }
            let ring = &a.shape.outer;
            // The edge facing a road: nearest street ribbon within 2 m.
            let mut best: Option<(f64, Point, Point, usize)> = None;
            for i in 0..ring.len() {
                let (p, q) = (ring[i], ring[(i + 1) % ring.len()]);
                if length(sub(q, p)) < 3.0 {
                    continue;
                }
                let m = scale(add(p, q), 0.5);
                for (si, st) in layout.streets.iter().enumerate() {
                    for (j, w) in st.path.windows(2).enumerate() {
                        let half = 0.5 * st.widths.get(j).copied().unwrap_or(4.0);
                        let gap = distance(m, w[0], w[1]) - half;
                        if gap <= 2.0 && best.is_none_or(|b| gap < b.0) {
                            best = Some((gap, p, q, si));
                        }
                    }
                }
            }
            let Some((_, fa, fb, street)) = best else {
                continue;
            };
            let c = super::geometry::centroid(&a.shape);
            let Some(block) = layout
                .blocks
                .iter()
                .enumerate()
                .filter(|(_, b)| b.kind == "block")
                .map(|(i, b)| {
                    let r = &b.shape.outer;
                    let d = (0..r.len())
                        .map(|k| distance(c, r[k], r[(k + 1) % r.len()]))
                        .fold(f64::INFINITY, f64::min);
                    (i, d)
                })
                .min_by(|x, y| x.1.total_cmp(&y.1))
                .map(|(i, _)| i)
            else {
                continue;
            };
            let st = &layout.streets[street];
            let front = Front {
                a: fa,
                b: fb,
                rank: st.rank,
                street,
                shared: false,
                gate: false,
            };
            let mut lot = parcel(a.shape.clone(), block, unit(sub(fb, fa)), &[front], "plot");
            lot.family = "faubourg".into();
            lot.reason = "wall-lean-to".into();
            lot.provenance = vec![format!("lean-to:{ei}:{ai}")];
            lot.envelope = Some(a.shape.clone());
            lot.contacts = vec![super::ParcelContact {
                a: fa,
                b: fb,
                street,
                rank: st.rank,
                length: length(sub(fb, fa)),
                kind: access_kind(&front, layout).into(),
            }];
            resolve_identity(
                &mut lot,
                block,
                &block_identity(layout, &layout.blocks[block].shape),
            );
            out.push(lot);
        }
    }
    out
}

/// Share of a culture's own open land that an adapted tissue keeps in every
/// block: its lot gardens as drawn (`CapacityPlan.garden_share`) and, off the
/// core, the fringe fields the plan gave up. Densifying, borrowing a compact
/// cutting or filling the fringe may shrink yards, never erase them.
const GARDEN_FLOOR: f64 = 0.5;

/// Invariant (garden character): when the capacity plan adapted the tissue,
/// at least `floor` of the block stays garden. Admitted lots, deepest first,
/// give up their rear beyond their own witness (envelope + 2 m, never under
/// `keep`), uniformly in proportion, as gardens attached to the lot. The
/// witness stays inside the lot, so no lot loses its admission.
fn keep_gardens(cells: &mut Vec<Parcel>, fronts: &[Front], layout: &Layout, floor: f64, keep: f64) {
    let block: f64 = cells.iter().map(|p| area(&p.shape)).sum();
    let gardens: f64 = cells
        .iter()
        .filter(|p| p.use_kind == "garden")
        .map(|p| area(&p.shape))
        .sum();
    let deficit = floor * block - gardens;
    if deficit <= 1.0 {
        return;
    }
    // Rear land each admitted lot can give: beyond its witness depth.
    let spare: Vec<Option<(f64, f64, f64)>> = cells
        .iter()
        .map(|p| {
            let ([a, b], envelope) = (p.front?, p.envelope.as_ref()?);
            if p.use_kind != "plot" {
                return None;
            }
            let n = normal(unit(sub(b, a)));
            let base = dot(a, n);
            let reach = |s: &Shape| {
                s.outer
                    .iter()
                    .map(|v| (dot(*v, n) - base).abs())
                    .fold(0.0, f64::max)
            };
            let depth = reach(&p.shape);
            let minimum = (reach(envelope) + 2.0).max(keep);
            (depth > minimum + 1.0).then(|| {
                let width = area(&p.shape) / depth.max(1e-6);
                (depth, minimum, width * (depth - minimum))
            })
        })
        .collect();
    let available: f64 = spare.iter().flatten().map(|s| s.2).sum();
    if available <= 1.0 {
        return;
    }
    let r = (deficit / available).min(1.0);
    let mut out = Vec::with_capacity(cells.len());
    for (p, spare) in cells.drain(..).zip(spare) {
        let Some((depth, minimum, _)) = spare else {
            out.push(p);
            continue;
        };
        let limit = depth - r * (depth - minimum);
        let pieces = bound_frontage_depth(p.clone(), limit);
        let Some(built) = pieces.iter().find(|q| q.use_kind == "plot") else {
            out.push(p);
            continue;
        };
        let envelope = p.envelope.clone().unwrap();
        if pieces.iter().filter(|q| q.use_kind == "plot").count() != 1
            || super::geometry::difference(&envelope, &built.shape)
                .iter()
                .map(area)
                .sum::<f64>()
                > 1e-6
        {
            out.push(p);
            continue;
        }
        for mut q in pieces {
            q.family = p.family.clone();
            q.pressure = p.pressure;
            q.provenance.push("garden-floor".into());
            if q.use_kind == "plot" {
                q.reason = p.reason.clone();
                q.envelope = Some(envelope.clone());
                q.front = p.front;
                q.rank = p.rank;
                q.access = p.access.clone();
                q.contacts = contacts::boundary_contacts(&q.shape, fronts)
                    .iter()
                    .map(|f| super::ParcelContact {
                        a: f.a,
                        b: f.b,
                        street: f.street,
                        rank: f.rank,
                        length: length(sub(f.b, f.a)),
                        kind: access_kind(f, layout).into(),
                    })
                    .collect();
            } else {
                q.reason = "attached-rear-land".into();
                q.parent_ids = vec![p.id.clone()];
                q.access = Some(super::ParcelAccess {
                    kind: "attached".into(),
                    street: p.access.as_ref().and_then(|a| a.street),
                    front_length: 0.0,
                });
            }
            out.push(q);
        }
    }
    *cells = out;
}
fn cultural_context<'a>(layout: &'a Layout, block: &super::Block, fallback: &'a str) -> &'a str {
    block
        .phase
        .or_else(|| layout.quarters.get(block.quarter).map(|q| q.phase))
        .and_then(|phase| layout.phases.get(phase))
        .filter(|p| !p.culture.is_empty())
        .map_or(fallback, |p| p.culture.as_str())
}

/// One block's lots, warnings and area accounts, merged in block order.
#[derive(Default)]
struct BlockCut {
    parcels: Vec<Parcel>,
    warnings: Vec<String>,
    diagnostics: super::PartitionDiagnostics,
}

pub(super) fn generate(
    seed: &str,
    layout: &Layout,
    cfg: &ParcelConfig,
    morph: &Morph,
) -> Result<Partition, String> {
    let mut result = Partition {
        config: Some(cfg.clone()),
        programme: None,
        key: layout.key.clone(),
        parcels: Vec::new(),
        warnings: Vec::new(),
        diagnostics: None,
    };
    let mut diagnostics = super::PartitionDiagnostics::default();
    let root = Rng::new(seed).fork(&format!("parcels:{}", layout.key));
    let index = FrontageIndex::new(layout);
    let road_pressures = occupation_pressures(layout);
    let culture = if cfg.culture == "site" {
        &layout.culture
    } else {
        &cfg.culture
    };
    let phase_morphs = layout
        .phases
        .iter()
        .map(|p| {
            super::composition::phase_morph(
                if cfg.culture == "site" && !p.culture.is_empty() {
                    &p.culture
                } else {
                    culture
                },
                &p.recipe,
                if cfg.zone == "auto" {
                    &p.zone
                } else {
                    &cfg.zone
                },
                &cfg.preset,
                &cfg.recipe,
                cfg.density,
                &cfg.params,
                "parcels",
            )
        })
        .collect::<Result<Vec<_>, _>>()?;
    // Adaptive capacity (`footprint::capacity`): the same densified tissue as
    // the quarter stage, and the donor's lot cutting in its borrowed quarters.
    let plan = super::footprint::capacity::of(layout)
        .filter(|_| super::footprint::capacity::parcels_enabled(cfg));
    let population = layout.programme.as_ref().map_or_else(
        || {
            layout
                .structure
                .as_ref()
                .map_or(0, |s| s.metrics.planned_population.round() as u32)
        },
        |p| p.population,
    );
    let adapt = |m: &Morph, quarter: Option<usize>, p: &super::GrowthPhase| {
        super::footprint::capacity::adapt(
            m.clone(),
            plan,
            quarter,
            &p.recipe,
            if cfg.zone == "auto" {
                &p.zone
            } else {
                &cfg.zone
            },
            population,
            cfg.density,
            "parcels",
        )
    };
    let borrowed_morphs = match plan {
        Some(c) if !c.donor.is_empty() && !c.borrowed_quarters.is_empty() => phase_morphs
            .iter()
            .zip(&layout.phases)
            .map(|(m, p)| adapt(m, c.borrowed_quarters.first().copied(), p))
            .collect::<Vec<_>>(),
        _ => vec![],
    };
    let phase_morphs = phase_morphs
        .iter()
        .zip(&layout.phases)
        .map(|(m, p)| adapt(m, None, p))
        .collect::<Vec<_>>();
    // User edits of a quarter (« éditer un quartier »): its density and tissue
    // reach the lot cutting of that quarter's blocks only.
    let edits = layout.config.as_ref().map(|c| &c.overrides.quarters);
    let mut edited_morphs: BTreeMap<(usize, u64), Morph> = BTreeMap::new();
    for block in &layout.blocks {
        let edit = edits.and_then(|e| e.get(&block.quarter.to_string()));
        let phase_index = layout
            .quarters
            .get(block.quarter)
            .map(|q| block.phase.unwrap_or(q.phase));
        if let (Some(density), Some(pi)) = (edit.and_then(|e| e.density), phase_index)
            && density.is_finite()
            && layout.phases.get(pi).is_some()
        {
            let key = (pi, density.to_bits());
            if !edited_morphs.contains_key(&key) {
                let p = &layout.phases[pi];
                let m = super::composition::phase_morph(
                    if cfg.culture == "site" && !p.culture.is_empty() {
                        &p.culture
                    } else {
                        culture
                    },
                    &p.recipe,
                    if cfg.zone == "auto" {
                        &p.zone
                    } else {
                        &cfg.zone
                    },
                    &cfg.preset,
                    &cfg.recipe,
                    density.clamp(0.1, 10.0),
                    &cfg.params,
                    "parcels",
                )?;
                edited_morphs.insert(key, m);
            }
        }
    }
    // Blocks are cut independently (each forks its own random stream from its
    // geometric identity) and merged in block order: identical output on any
    // number of threads.
    let blocks = super::par::map(&layout.blocks, |bi, block| {
        let mut out = BlockCut::default();
        let block_id = block_identity(layout, &block.shape);
        let edit = edits.and_then(|e| e.get(&block.quarter.to_string()));
        let phase_index = layout
            .quarters
            .get(block.quarter)
            .map(|q| block.phase.unwrap_or(q.phase));
        let edited = match (edit.and_then(|e| e.density), phase_index) {
            (Some(density), Some(pi)) if density.is_finite() && layout.phases.get(pi).is_some() => {
                edited_morphs.get(&(pi, density.to_bits()))
            }
            _ => None,
        };
        let borrowed = plan.is_some_and(|c| c.borrowed_quarters.contains(&block.quarter));
        let morph = edited
            .or_else(|| {
                phase_index.and_then(|pi| {
                    if borrowed {
                        borrowed_morphs.get(pi)
                    } else {
                        phase_morphs.get(pi)
                    }
                })
            })
            .unwrap_or(morph);
        let tissue = edit
            .and_then(|e| e.tissue.as_deref())
            .filter(|t| *t != "culture")
            .or_else(|| {
                layout
                    .structure
                    .as_ref()
                    .and_then(|s| {
                        s.districts
                            .iter()
                            .find(|d| d.quarters.contains(&block.quarter))
                    })
                    .map(|d| d.tissue.as_str())
            })
            .unwrap_or("culture");
        let mut local_morph = super::with_tissue(morph.clone(), tissue);
        if cfg.operator != "culture" {
            local_morph.value["plotOp"] = serde_json::json!(match cfg.operator.as_str() {
                "strips" => "burgage",
                "oriented" => "compact",
                op => op,
            });
        }
        if cfg.operator == "culture"
            && cfg.preset == "culture"
            && cfg.params.get("plotOp").is_none()
        {
            let block_culture = cultural_context(layout, block, culture);
            if let Some(mapping) = super::culture::contextual_mapping(
                block_culture,
                layout
                    .programme
                    .as_ref()
                    .map_or("any", |p| p.context.period.as_str()),
                &block.zone,
                local_morph.text("plotOp"),
                "domestic",
            ) {
                if mapping.family == "inherited"
                    && !matches!(local_morph.text("plotOp"), "garden" | "wholeBlock")
                {
                    local_morph.value["plotOp"] = serde_json::json!("inherited");
                } else if mapping.family == "compact"
                    && !matches!(local_morph.text("plotOp"), "garden" | "wholeBlock")
                {
                    local_morph.value["plotOp"] = serde_json::json!("compact");
                } else if matches!(mapping.family.as_str(), "courtyard" | "compound")
                    && !matches!(local_morph.text("plotOp"), "garden" | "wholeBlock")
                {
                    local_morph.value["plotOp"] = serde_json::json!(mapping.family);
                }
            }
        }
        let block_culture = cultural_context(layout, block, culture);
        let zone = if cfg.zone == "auto" {
            &block.zone
        } else {
            &cfg.zone
        };
        let dense_souk = block_culture == "medina"
            && local_morph.text("id") == "medina-souk"
            && matches!(zone.as_str(), "core" | "middle")
            && cfg.operator == "culture"
            && cfg.preset == "culture"
            && ["plotOp", "plotDepth", "frontage", "houseArea"]
                .iter()
                .all(|key| cfg.params.get(key).is_none());
        let local_depth = local_morph.range("plotDepth", zone);
        let period = layout
            .programme
            .as_ref()
            .map_or("any", |p| p.context.period.as_str());
        let route = super::culture::contextual_mapping(
            block_culture,
            period,
            &block.zone,
            local_morph.text("plotOp"),
            "domestic",
        );
        let fallback = route
            .as_ref()
            .and_then(|c| compact_fallback(&c.architecture_pack, period, &c.admissibility));
        let pack = route.as_ref().map(|c| c.architecture_pack.clone());
        let admission = route.map(|c| c.admissibility);
        let occupation = layout
            .programme
            .as_ref()
            .and_then(|p| p.environment.iter().find(|e| e.block == bi))
            .map_or(road_pressures[bi], |e| e.pressure);
        // Lot sizes keep the culture's own ranges, floored by the smallest
        // native house that may occupy them (the compact tier when it exists),
        // not by a 30 m court house that only grand lots hold.
        let mut local_morph = pressure::apply(
            &local_morph,
            occupation,
            local_morph.text("streetOp") == "grid",
            fallback.as_ref().or(admission.as_ref()),
        );
        if dense_souk {
            let minimum = admission.as_ref().map_or(0.0, |p| p.min_depth);
            local_morph.value["plotDepth"][zone] =
                serde_json::json!(local_depth.map(|d| d.max(minimum)));
        }
        let faces = wall_faces(&block.shape, layout);
        if !faces.is_empty() {
            local_morph.value["_wallFace"] = serde_json::json!(
                faces
                    .iter()
                    .map(|(a, b)| [a.x, a.y, b.x, b.y])
                    .collect::<Vec<_>>()
            );
        }
        let backed = |p: &Parcel| wall_contact(&p.shape, &faces) >= 2.0;
        let morph = &local_morph;
        if block.kind == "reserve" {
            let fronts = frontages(&block.shape, layout, &index);
            if !fronts.is_empty() {
                let mut axis = unit(block.axis);
                if length(axis) < 0.5 {
                    axis = Point { x: 1.0, y: 0.0 };
                }
                let mut rng = root.fork(&super::edits::block_fork(
                    &format!("enclosure:{block_id}"),
                    layout,
                    block.quarter,
                )); // edits hook (urban/edits.rs): salt
                for mut p in edge_enclosures(&block.shape, bi, axis, &fronts, morph, zone, &mut rng)
                {
                    p.pressure = occupation;
                    p.contacts = network_contacts(&p.shape, layout, &index);
                    resolve_identity(&mut p, bi, &block_id);
                    // A field enclosed behind the others has no street of its own.
                    if p.access.as_ref().is_some_and(|a| a.kind == "unserved") {
                        out.diagnostics.unserved_area += area(&p.shape);
                    }
                    out.parcels.push(p);
                }
                out.diagnostics.covered_area += area(&block.shape);
                return out;
            }
        }
        if block.kind != "block" {
            out.diagnostics.covered_area += area(&block.shape);
            out.parcels.push(Parcel {
                pressure: occupation,
                envelope: None,
                id: identity(&block.shape, bi),
                parent_ids: vec![format!("block-{bi}")],
                provenance: vec!["preserved-reserve".into()],
                family: "reserve".into(),
                reason: block.kind.clone(),
                contacts: network_contacts(&block.shape, layout, &index),
                shape: block.shape.clone(),
                block: bi,
                axis: block.axis,
                use_kind: block.kind.split(':').next().unwrap_or("place").to_owned(),
                front: None,
                rank: 99,
                access: Some(super::ParcelAccess {
                    kind: "reserved".into(),
                    street: None,
                    front_length: 0.0,
                }),
            });
            resolve_identity(out.parcels.last_mut().unwrap(), bi, &block_id);
            return out;
        }
        let mut rng = root.fork(&super::edits::block_fork(&block_id, layout, block.quarter)); // edits hook (urban/edits.rs): salt
        let mut axis = unit(block.axis);
        if length(axis) < 0.5 {
            axis = Point { x: 1.0, y: 0.0 };
        }
        if morph.text("streetOp") != "grid" {
            let tilt = morph.number("plotTilt").clamp(0.0, 12.0);
            let angle = rng.fork("parcel-frame").range(-tilt, tilt).to_radians();
            axis = Point {
                x: axis.x * angle.cos() - axis.y * angle.sin(),
                y: axis.x * angle.sin() + axis.y * angle.cos(),
            };
        }
        let mut fronts = frontages(&block.shape, layout, &index);
        if admission.is_none() && super::culture::mapping(block_culture).is_some() {
            let mut retained = parcel(block.shape.clone(), bi, axis, &fronts, "residual");
            retained.reason = "unsupported-period-profile".into();
            retained.family = families::family(morph.text("plotOp")).into();
            retained.pressure = occupation;
            retained.contacts = network_contacts(&block.shape, layout, &index);
            retained
                .provenance
                .push("period-admission-unavailable".into());
            resolve_identity(&mut retained, bi, &block_id);
            out.parcels.push(retained);
            out.diagnostics.covered_area += area(&block.shape);
            return out;
        }
        if fronts.is_empty() && morph.text("plotOp") != "garden" {
            // A removed or impracticable road cannot confer residential access:
            // the land returns to open, non-urban ground (a strip between a
            // wall and the water, a block whose street was dropped), never a
            // residual lot.
            let mut unserved = parcel(block.shape.clone(), bi, axis, &[], "garden");
            unserved.pressure = occupation;
            unserved.use_kind = "reserve".into();
            unserved.reason = "no-street-contact".into();
            unserved.family = "reserve".into();
            unserved.rank = 99;
            // Counted in `unserved_area`: its access says so too.
            unserved.access = Some(super::ParcelAccess {
                kind: "unserved".into(),
                street: None,
                front_length: 0.0,
            });
            out.warnings.push(format!(
                "Îlot {bi} : aucun contact continu avec une rue ; terrain laissé en espace ouvert"
            ));
            resolve_identity(&mut unserved, bi, &block_id);
            out.parcels.push(unserved);
            out.diagnostics.covered_area += area(&block.shape);
            out.diagnostics.unserved_area += area(&block.shape);
            return out;
        }
        let block_culture = cultural_context(layout, block, culture);
        let shared_courts = matches!(cfg.operator.as_str(), "courtyard" | "compound")
            || super::culture::mapping(block_culture)
                .is_some_and(|m| m.admissibility.shared_access);
        let mut parcels = match morph.text("plotOp") {
            "garden" => {
                let mut p = parcel(block.shape.clone(), bi, axis, &fronts, "garden");
                p.reason = "intentional-garden".into();
                vec![p]
            }
            "compact" => courtyards(&block.shape, bi, axis, &fronts, morph, zone, &mut rng),
            "courtyard" if shared_courts => {
                families::derbs(&block.shape, bi, axis, &mut fronts, morph, zone, &mut rng)
            }
            "courtyard" | "compound" => {
                if shared_courts {
                    families::courts(&block.shape, bi, axis, &mut fronts, morph, zone, &mut rng)
                } else {
                    courtyards(&block.shape, bi, axis, &fronts, morph, zone, &mut rng)
                }
            }
            "inherited" => {
                families::inherited(&block.shape, bi, axis, &fronts, morph, zone, &mut rng)
            }
            "wholeBlock" => vec![parcel(block.shape.clone(), bi, axis, &fronts, "plot")],
            "frontage" => {
                frontage_territories(&block.shape, bi, axis, &fronts, morph, zone, &mut rng)
            }
            _ => {
                let house = morph.range("houseArea", zone)[1].max(60.0);
                let block_area = area(&block.shape);
                if block_area < 1.6 * house || (dense_souk && block_area < 3.0 * house) {
                    // A block of one or two houses is split by area into
                    // compact lots, never into a comb of slivers.
                    let mut lots =
                        courtyards(&block.shape, bi, axis, &fronts, morph, zone, &mut rng);
                    for p in &mut lots {
                        p.provenance.push("compact-small-block".into());
                    }
                    lots
                } else if dense_souk {
                    // Souk shops line only the main streets; behind them the
                    // block holds courtyard houses on its lanes and derbs.
                    let main: Vec<Front> = fronts.iter().filter(|f| f.rank <= 1).copied().collect();
                    let shops = if main.is_empty() {
                        vec![parcel(block.shape.clone(), bi, axis, &[], "garden")]
                    } else {
                        strips(&block.shape, bi, axis, &main, morph, zone, &mut rng)
                    };
                    let mut lots = vec![];
                    for (i, p) in shops.into_iter().enumerate() {
                        if p.use_kind != "garden"
                            || area(&p.shape) < morph.range("houseArea", zone)[0]
                        {
                            lots.push(p);
                            continue;
                        }
                        let mut rr = rng.fork(&format!("souk-court:{i}"));
                        for mut q in courtyards(&p.shape, bi, axis, &fronts, morph, zone, &mut rr) {
                            if frontage(&q.shape, &fronts).0 < 3.0 {
                                q.use_kind = "garden".into();
                                q.reason = "retained-backland".into();
                            }
                            q.provenance.push("souk-courtyard-house".into());
                            lots.push(q);
                        }
                    }
                    lots
                } else {
                    strips(&block.shape, bi, axis, &fronts, morph, zone, &mut rng)
                }
            }
        };
        if morph.text("plotOp") == "siheyuan" {
            let threshold = (morph.range("houseArea", zone)[1] * 1.8).max(1600.0);
            let mut refined = Vec::new();
            for (pi, p) in parcels.into_iter().enumerate() {
                if p.front.is_none() || area(&p.shape) <= threshold {
                    refined.push(p);
                    continue;
                }
                let parts = courtyards(
                    &p.shape,
                    bi,
                    axis,
                    &fronts,
                    morph,
                    zone,
                    &mut rng.fork(&format!("siheyuan:{pi}")),
                );
                let accessed = parts.iter().filter(|p| p.front.is_some()).count();
                if accessed >= 2 || accessed == 1 && parts.iter().any(|p| p.use_kind == "garden") {
                    refined.extend(parts);
                } else {
                    refined.push(p);
                }
            }
            parcels = refined;
        }
        if !matches!(morph.text("plotOp"), "compound" | "wholeBlock") {
            let depth = maximum_plot_depth(morph, zone);
            parcels = parcels
                .into_iter()
                .flat_map(|p| {
                    let d = if backed(&p) { 1.25 * depth } else { depth };
                    bound_frontage_depth(p, d)
                })
                .collect();
        }
        let mut admission = admission
            .clone()
            .unwrap_or(super::culture::UrbanAdmissibility {
                recipe_id: "explicit-fixture-envelope".into(),
                native_layout: "unknown".into(),
                floors: [1, 1],
                eras: Vec::new(),
                min_access_width: 0.8,
                min_frontage: morph.range("frontage", zone)[0].clamp(3.0, 5.0),
                min_area: 35.0,
                min_depth: morph.range("plotDepth", zone)[0].clamp(4.0, 8.0),
                max_slope: 0.15,
                shared_access: true,
                party_walls: true,
            });
        if matches!(morph.text("plotOp"), "courtyard" | "compound") && shared_courts {
            admission.shared_access = true;
        }
        let family = families::family(morph.text("plotOp"));
        let depth_limit = (!matches!(morph.text("plotOp"), "compound" | "wholeBlock"))
            .then(|| maximum_plot_depth(morph, zone));
        qualify(
            &mut parcels,
            &fronts,
            layout,
            &admission,
            fallback.as_ref(),
            family == "courtyard",
            family,
            depth_limit,
        );
        // Invariant (bug 2b): no admitted lot reaches deeper than the culture's
        // lot depth from its best access; the land behind becomes its garden.
        if let Some(limit) = depth_limit {
            // A lot against the town wall may reach 1.25x: the curtain is its
            // rear party wall, not back land.
            let reach = |p: &Parcel| if backed(p) { 1.25 * limit } else { limit };
            let (deep, kept): (Vec<_>, Vec<_>) = parcels.into_iter().partition(|p| {
                p.use_kind == "plot" && lot_depth(&p.shape, &fronts) > reach(p) + 0.5
            });
            parcels = kept;
            let mut bounded: Vec<_> = deep
                .into_iter()
                .flat_map(|p| {
                    let d = reach(&p);
                    bound_frontage_depth(p, d)
                })
                .collect();
            qualify(
                &mut bounded,
                &fronts,
                layout,
                &admission,
                fallback.as_ref(),
                family == "courtyard",
                family,
                depth_limit,
            );
            parcels.extend(bounded);
        }
        pair_courts(
            &mut parcels,
            &fronts,
            layout,
            &admission,
            fallback.as_ref(),
            family,
            depth_limit,
            pack.as_deref(),
            morph.number_or("courtPairShare", COURT_PAIR_SHARE),
            &mut rng.fork("court-pairs"),
        );
        if let Some(c) = plan.filter(|c| c.densify > 0.0 || borrowed || c.vacancy < 0.999) {
            // The culture's own open land: its lot gardens as drawn, and off
            // the core the fringe fields the plan gave up (`vacancy` < 1).
            let fields = if zone == "core" {
                0.0
            } else {
                (1.0 - c.vacancy).clamp(0.0, 1.0)
                    * super::footprint::capacity::fringe_fields(0.0, 1.0)
            };
            keep_gardens(
                &mut parcels,
                &fronts,
                layout,
                GARDEN_FLOOR * (c.garden_share + fields),
                morph.range("plotDepth", zone)[0],
            );
        }
        if dense_souk {
            let mut refined = Vec::new();
            for mut parent in parcels {
                if parent.use_kind != "plot"
                    || parent.reason != "admissibility-repaired"
                    || area(&parent.shape) < 2.0 * admission.min_area
                {
                    refined.push(parent);
                    continue;
                }
                // One bounded attempt with the existing oriented-cut operator.
                // The module is the native admission domain, not a smaller
                // invented house or a requirement to consume a rear garden.
                resolve_identity(&mut parent, bi, &block_id);
                let mut module = morph.clone();
                module.value["houseArea"][zone] =
                    serde_json::json!([admission.min_area, admission.min_area]);
                module.value["frontage"][zone] =
                    serde_json::json!([admission.min_frontage, admission.min_frontage]);
                let mut children = courtyards(
                    &parent.shape,
                    bi,
                    parent.axis,
                    &fronts,
                    &module,
                    zone,
                    &mut rng.fork(&format!("native-domain-repartition:{}", parent.id)),
                );
                if children.len() < 2 || children.len() > 8 {
                    refined.push(parent);
                    continue;
                }
                qualify(
                    &mut children,
                    &fronts,
                    layout,
                    &admission,
                    fallback.as_ref(),
                    family == "courtyard",
                    family,
                    depth_limit,
                );
                let admitted = children.len() >= 2
                    && children.iter().all(|p| {
                        p.use_kind == "plot"
                            && p.envelope.is_some()
                            && p.access.as_ref().is_some_and(|a| {
                                matches!(a.kind.as_str(), "public" | "private" | "collective")
                            })
                    });
                use geo::{Area, BooleanOps};
                let merged = geo::algorithm::bool_ops::unary_union(
                    children
                        .iter()
                        .map(|p| super::geometry::polygon(&p.shape))
                        .collect::<Vec<_>>()
                        .iter(),
                );
                let original = super::geometry::polygon(&parent.shape);
                let tolerance = 1e-5_f64.max(area(&parent.shape) * 1e-8);
                let difference = original.difference(&merged).unsigned_area()
                    + merged.difference(&original).unsigned_area();
                let overlap = (children.iter().map(|p| area(&p.shape)).sum::<f64>()
                    - merged.unsigned_area())
                .max(0.0);
                if admitted && difference + overlap <= tolerance {
                    for p in &mut children {
                        p.parent_ids = vec![parent.id.clone()];
                        p.provenance.extend(parent.provenance.clone());
                        p.provenance.push("native-domain-repartition".into());
                        p.reason = "admissibility-repartitioned".into();
                    }
                    refined.extend(children);
                } else {
                    refined.push(parent);
                }
            }
            parcels = refined;
        }
        for p in &mut parcels {
            p.pressure = occupation;
            if p.use_kind == "plot" && backed(p) {
                p.provenance.push("curtain-backed".into());
            }
        }
        if morph.text("plotOp") != "garden"
            && !parcels.iter().any(|p| p.use_kind == "plot")
            && parcels.iter().all(|p| p.use_kind == "garden")
        {
            for p in &mut parcels {
                p.use_kind = "residual".into();
                p.reason = "cadastral-operator-failed".into();
            }
        }
        // Boolean pieces retain exclusions as holes; an unresolved hole is
        // never replaced by a filled exterior ring.
        let actual: f64 = parcels.iter().map(|p| area(&p.shape)).sum();
        let expected = area(&block.shape);
        use geo::BooleanOps;
        let merged = geo::algorithm::bool_ops::unary_union(
            &parcels
                .iter()
                .map(|p| super::geometry::polygon(&p.shape))
                .collect::<Vec<_>>(),
        );
        let coverage =
            super::geometry::shapes(super::geometry::polygon(&block.shape).intersection(&merged))
                .iter()
                .map(area)
                .sum::<f64>();
        let union_area = super::geometry::shapes(merged)
            .iter()
            .map(area)
            .sum::<f64>();
        let residual = (expected - coverage).max(0.0) + (union_area - coverage).max(0.0);
        let overlap = (actual - union_area).max(0.0);
        out.diagnostics.covered_area += coverage;
        out.diagnostics.residual_area += residual;
        out.diagnostics.overlap_area += overlap;
        out.diagnostics.unserved_area += parcels
            .iter()
            .filter(|p| p.access.as_ref().is_some_and(|a| a.kind == "unserved"))
            .map(|p| area(&p.shape))
            .sum::<f64>();
        if residual + overlap > expected.max(1.0) * 1e-5 {
            out.warnings.push(format!(
                "Îlot {bi} : couverture résiduelle {residual:.3} m², chevauchement {overlap:.3} m²"
            ));
        }
        if (actual - expected).abs() > expected.max(1.0) * 1e-5 {
            out.warnings.push(format!(
                "Block {bi}: cadastral area residual {:.3} m²",
                actual - expected
            ));
        }
        for p in &mut parcels {
            resolve_identity(p, bi, &block_id);
        }
        out.parcels.extend(parcels);
        out
    });
    for cut in blocks {
        result.parcels.extend(cut.parcels);
        result.warnings.extend(cut.warnings);
        diagnostics.covered_area += cut.diagnostics.covered_area;
        diagnostics.residual_area += cut.diagnostics.residual_area;
        diagnostics.overlap_area += cut.diagnostics.overlap_area;
        diagnostics.unserved_area += cut.diagnostics.unserved_area;
    }
    result.parcels.extend(lean_to_lots(layout));
    result.diagnostics = Some(diagnostics);
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::super::geometry::rectangle;
    use super::super::{Block, Street};
    use super::*;
    use serde_json::json;

    #[test]
    fn frontage_keeps_rank_and_street_order_across_reused_spatial_bins() {
        let shape = rectangle(-96.0, 0.0, 96.0, 64.0);
        let mut layout: Layout = serde_json::from_value(json!({
            "key": "frontage-ties", "culture": "european-organic",
            "center": {"x": 0.0, "y": 32.0},
            "quarters": [], "blocks": [], "warnings": [], "streets": []
        }))
        .unwrap();
        // Each segment spans several bins. The first frontage loses to the
        // next street's rank, and the equal-rank third street must not win.
        layout.streets = [3, 1, 1]
            .into_iter()
            .map(|rank| Street {
                path: vec![Point { x: -96.0, y: -3.0 }, Point { x: 96.0, y: -3.0 }],
                widths: vec![6.0; 2],
                rank,
                role: "street".into(),
            })
            .collect();
        let index = FrontageIndex::new(&layout);
        let mut candidates = Vec::new();
        index.candidates(shape.outer[0], shape.outer[1], &mut candidates);
        assert_eq!(candidates, [(0, 0), (1, 0), (2, 0)]);
        index.candidates(
            Point { x: 500.0, y: 500.0 },
            Point { x: 501.0, y: 500.0 },
            &mut candidates,
        );
        assert!(candidates.is_empty());
        let fronts = frontages(&shape, &layout, &index);
        assert_eq!(fronts.len(), 1);
        assert_eq!((fronts[0].rank, fronts[0].street), (1, 1));
        assert_eq!((fronts[0].a, fronts[0].b), (shape.outer[0], shape.outer[1]));
    }

    #[test]
    fn concave_territory_cannot_wrap_behind_its_residential_frontage() {
        let shape = Shape {
            outer: [
                (0.0, 0.0),
                (10.0, 0.0),
                (10.0, 180.0),
                (-40.0, 180.0),
                (-40.0, -100.0),
                (0.0, -100.0),
            ]
            .into_iter()
            .map(|(x, y)| Point { x, y })
            .collect(),
            holes: vec![],
        };
        let expected = area(&shape);
        let parts = bound_frontage_depth(
            Parcel {
                pressure: 0.0,
                envelope: None,
                id: "concave-parent".into(),
                parent_ids: Vec::new(),
                provenance: Vec::new(),
                family: "frontage".into(),
                reason: String::new(),
                contacts: Vec::new(),
                shape,
                block: 0,
                axis: Point { x: 1.0, y: 0.0 },
                rank: 2,
                front: Some([Point { x: 0.0, y: 0.0 }, Point { x: 10.0, y: 0.0 }]),
                use_kind: "plot".into(),
                access: None,
            },
            60.0,
        );
        assert!((parts.iter().map(|p| area(&p.shape)).sum::<f64>() - expected).abs() < 0.01);
        assert!(parts.iter().any(|p| p.use_kind == "plot"));
        assert!(parts.iter().filter(|p| p.use_kind == "plot").all(|p| {
            let (lo, hi) = bounds(&p.shape, Point { x: 0.0, y: 1.0 });
            lo >= -60.01 && hi <= 60.01 && p.front.is_some()
        }));
    }

    #[test]
    fn oversized_sectors_keep_short_frontage_plots_and_exact_back_land() {
        let mut shape = rectangle(0.0, 0.0, 240.0, 400.0);
        shape.holes.push(
            rectangle(80.0, 170.0, 120.0, 210.0)
                .outer
                .into_iter()
                .rev()
                .collect(),
        );
        let layout = Layout {
            config: None,
            programme: None,
            key: "unserved-deep-sector".into(),
            structure: None,
            phases: vec![],
            archetype: "district".into(),
            culture: "european-organic".into(),
            center: Point { x: 120.0, y: 200.0 },
            quarters: vec![],
            enclosures: vec![],
            warnings: vec![],
            blocks: vec![Block {
                phase: None,
                shape: shape.clone(),
                quarter: 0,
                kind: "block".into(),
                axis: Point { x: 1.0, y: 0.0 },
                zone: "core".into(),
            }],
            streets: vec![Street {
                path: vec![Point { x: 0.0, y: -3.0 }, Point { x: 240.0, y: -3.0 }],
                widths: vec![6.0; 2],
                rank: 1,
                role: "street".into(),
            }],
        };
        let fronts = frontages(&shape, &layout, &FrontageIndex::new(&layout));
        for op in ["burgage", "machiya", "courtyard", "siheyuan"] {
            let morph = Morph {
                value: json!({"plotOp":op,"streetOp":"grid","plotTilt":0.0,"wideLotChance":0.0,"deepFill":true,
                "frontage":{"core":[8.0,12.0]},"plotDepth":{"core":[20.0,30.0]},"houseArea":{"core":[160.0,600.0]},"coverage":{"core":[0.9,0.95]}}),
            };
            let result =
                generate("bounded-depth", &layout, &ParcelConfig::default(), &morph).unwrap();
            let replay =
                generate("bounded-depth", &layout, &ParcelConfig::default(), &morph).unwrap();
            assert_eq!(
                serde_json::to_value(&result).unwrap(),
                serde_json::to_value(&replay).unwrap(),
                "{op}: replay"
            );
            assert!(result.warnings.is_empty(), "{op}: {:?}", result.warnings);
            assert!(
                (result.parcels.iter().map(|p| area(&p.shape)).sum::<f64>() - area(&shape)).abs()
                    < 0.01,
                "{op}: partition"
            );
            assert!(
                result.parcels.iter().filter(|p| p.front.is_some()).count() > 5,
                "{op}: frontage lots"
            );
            assert!(
                result
                    .parcels
                    .iter()
                    .filter(|p| p.use_kind == "garden")
                    .map(|p| area(&p.shape))
                    .sum::<f64>()
                    > 60000.0,
                "{op}: unserved back land"
            );
            for (i, p) in result.parcels.iter().enumerate() {
                assert!(
                    difference(&p.shape, &shape).iter().map(area).sum::<f64>() < 0.01,
                    "{op}: containment and hole"
                );
                if p.use_kind == "plot" {
                    assert!(frontage(&p.shape, &fronts).0 >= 3.0, "{op}: actual access");
                    assert!(
                        bounds(&p.shape, Point { x: 0.0, y: 1.0 }).1 <= 60.01,
                        "{op}: excessive depth"
                    );
                }
                for other in &result.parcels[..i] {
                    assert!(
                        intersection(&p.shape, &other.shape)
                            .iter()
                            .map(area)
                            .sum::<f64>()
                            < 0.01,
                        "{op}: overlap"
                    );
                }
            }
        }
        // A slender plot can fit the area budget and still have an implausible
        // residential depth. Its frontage must not legitimize a 180 m backyard.
        let mut narrow = layout.clone();
        narrow.blocks[0].shape = rectangle(0.0, 0.0, 20.0, 180.0);
        let morph = Morph {
            value: json!({"plotOp":"courtyard","streetOp":"grid","deepFill":true,
            "frontage":{"core":[8.0,12.0]},"plotDepth":{"core":[20.0,30.0]},
            "houseArea":{"core":[200.0,2000.0]},"coverage":{"core":[0.9,0.95]}}),
        };
        let result = generate("long-narrow", &narrow, &ParcelConfig::default(), &morph).unwrap();
        assert!(result.parcels.iter().any(|p| p.use_kind == "garden"));
        assert!((result.parcels.iter().map(|p| area(&p.shape)).sum::<f64>() - 3600.0).abs() < 0.01);
        assert!(
            result
                .parcels
                .iter()
                .filter(|p| p.use_kind == "plot")
                .all(|p| bounds(&p.shape, Point { x: 0.0, y: 1.0 }).1 <= 60.01)
        );
        // A deliberately large compound remains a compound-sized property: the
        // ordinary courtyard fallback must not replace a user's chosen typology.
        let morph = Morph {
            value: json!({"plotOp":"compound","streetOp":"grid","houseArea":{"core":[100000.0,110000.0]}}),
        };
        let compound = generate("compound", &layout, &ParcelConfig::default(), &morph).unwrap();
        assert_eq!(compound.parcels.len(), 1);
        assert_eq!(compound.parcels[0].use_kind, "plot");
        assert!((area(&compound.parcels[0].shape) - area(&shape)).abs() < 0.01);
    }

    #[test]
    fn seeded_parcels_preserve_holes_partition_and_actual_frontage() {
        let mut shape = rectangle(0.0, 0.0, 100.0, 80.0);
        shape.holes.push(
            rectangle(42.0, 32.0, 58.0, 48.0)
                .outer
                .into_iter()
                .rev()
                .collect(),
        );
        let layout = Layout {
            config: None,
            programme: None,
            key: "frontage-fixture".into(),
            structure: None,
            phases: vec![],
            archetype: "district".into(),
            culture: "european".into(),
            center: Point { x: 50.0, y: 40.0 },
            quarters: vec![],
            enclosures: vec![],
            warnings: vec![],
            blocks: vec![Block {
                phase: None,
                shape: shape.clone(),
                quarter: 0,
                kind: "block".into(),
                axis: Point { x: 1.0, y: 0.0 },
                zone: "core".into(),
            }],
            streets: vec![Street {
                path: vec![
                    Point { x: -3.0, y: -3.0 },
                    Point { x: 103.0, y: -3.0 },
                    Point { x: 103.0, y: 83.0 },
                    Point { x: -3.0, y: 83.0 },
                    Point { x: -3.0, y: -3.0 },
                ],
                widths: vec![6.0; 5],
                rank: 1,
                role: "lane".into(),
            }],
        };
        let cfg = ParcelConfig::default();
        for op in [
            "burgage",
            "machiya",
            "courtyard",
            "compound",
            "siheyuan",
            "garden",
        ] {
            let morph = Morph {
                value: json!({"plotOp":op,"streetOp":"organic","plotTilt":4.0,"wideLotChance":0.08,"deepFill":false,
                "frontage":{"core":[7.0,13.0]},"plotDepth":{"core":[20.0,35.0]},"houseArea":{"core":[120.0,600.0]},"coverage":{"core":[0.4,0.6]}}),
            };
            let result = generate("urban-parcel-regression", &layout, &cfg, &morph).unwrap();
            let replay = generate("urban-parcel-regression", &layout, &cfg, &morph).unwrap();
            assert_eq!(
                serde_json::to_value(&result).unwrap(),
                serde_json::to_value(&replay).unwrap()
            );
            assert!(result.warnings.is_empty(), "{op}: {:?}", result.warnings);
            assert!(
                (result.parcels.iter().map(|p| area(&p.shape)).sum::<f64>() - area(&shape)).abs()
                    < 0.01,
                "{op}"
            );
            let fronts = frontages(&shape, &layout, &FrontageIndex::new(&layout));
            for (i, p) in result.parcels.iter().enumerate() {
                assert!(
                    difference(&p.shape, &shape).iter().map(area).sum::<f64>() < 0.01,
                    "{op}: containment"
                );
                if p.front.is_some() {
                    assert!(frontage(&p.shape, &fronts).0 >= 3.0, "{op}: access");
                }
                for q in &result.parcels[..i] {
                    assert!(
                        intersection(&p.shape, &q.shape)
                            .iter()
                            .map(area)
                            .sum::<f64>()
                            < 0.01,
                        "{op}: overlap"
                    );
                }
            }
            if op != "garden" {
                assert!(
                    result.parcels.iter().filter(|p| p.front.is_some()).count() > 2,
                    "{op}: no plots"
                );
            }
        }
    }
    /// A Byzantine (courtyard-culture) block is filled with admitted lots:
    /// small native houses where a court house cannot fit, a derb reaching the
    /// deep middle, and no lot deeper than the culture allows (bug 2b).
    #[test]
    fn courtyard_culture_block_is_filled_with_bounded_lots() {
        let shape = rectangle(0.0, 0.0, 96.0, 84.0);
        let mut layout: Layout = serde_json::from_value(json!({
            "key": "byzantine-block", "culture": "byzantine-greek",
            "center": {"x": 48.0, "y": 42.0},
            "quarters": [], "blocks": [], "warnings": [], "streets": []
        }))
        .unwrap();
        layout.blocks = vec![Block {
            phase: None,
            shape: shape.clone(),
            quarter: 0,
            kind: "block".into(),
            axis: Point { x: 1.0, y: 0.0 },
            zone: "core".into(),
        }];
        layout.streets = vec![Street {
            path: vec![
                Point { x: -3.0, y: -3.0 },
                Point { x: 99.0, y: -3.0 },
                Point { x: 99.0, y: 87.0 },
                Point { x: -3.0, y: 87.0 },
                Point { x: -3.0, y: -3.0 },
            ],
            widths: vec![6.0; 5],
            rank: 2,
            role: "street".into(),
        }];
        let morph = Morph {
            value: json!({"plotOp":"burgage","streetOp":"organic","plotTilt":0.0,"wideLotChance":0.05,
            "frontage":{"core":[5.0,8.0]},"plotDepth":{"core":[10.0,18.0]},
            "houseArea":{"core":[120.0,400.0]},"coverage":{"core":[0.82,0.92]}}),
        };
        let result = generate("byzantine", &layout, &ParcelConfig::default(), &morph).unwrap();
        let plots: Vec<_> = result
            .parcels
            .iter()
            .filter(|p| p.use_kind == "plot")
            .collect();
        let built: f64 = result
            .parcels
            .iter()
            .filter(|p| matches!(p.use_kind.as_str(), "plot" | "court"))
            .map(|p| area(&p.shape))
            .sum();
        assert!(
            built / area(&shape) > 0.7,
            "usable share {}",
            built / area(&shape)
        );
        assert!(plots.len() >= 12, "{} lots", plots.len());
        assert!(
            plots
                .iter()
                .all(|p| p.envelope.is_some() && p.family == "courtyard")
        );
        assert!(
            result.parcels.iter().any(|p| p.use_kind == "court"),
            "a derb serves the middle"
        );
        let index = FrontageIndex::new(&layout);
        let mut fronts = frontages(&shape, &layout, &index);
        for p in result.parcels.iter().filter(|p| p.use_kind == "court") {
            for ring in std::iter::once(&p.shape.outer) {
                for (&a, &b) in ring
                    .iter()
                    .zip(ring.iter().cycle().skip(1))
                    .take(ring.len())
                {
                    fronts.push(Front {
                        a: b,
                        b: a,
                        street: 0,
                        rank: 3,
                        shared: true,
                        gate: true,
                    });
                }
            }
        }
        for p in &plots {
            assert!(lot_depth(&p.shape, &fronts) <= 20.0 + 0.6, "lot too deep");
        }
    }

    /// Area-driven cuts (TODO « parcelles déséquilibrées »): on a curved and on
    /// an oblique frontage, neighbouring lots of similar frontage keep similar
    /// areas (no wedge of 10x its neighbour), and every lot keeps its frontage.
    #[test]
    fn cut_placement_balances_areas_on_curved_and_oblique_frontages() {
        let morph = Morph {
            value: json!({"plotOp":"burgage","streetOp":"organic","wideLotChance":0.0,"deepFill":true,
                "frontage":{"core":[6.0,9.0]},"plotDepth":{"core":[24.0,30.0]},"houseArea":{"core":[80.0,300.0]},
                "coverage":{"core":[0.85,0.9]}}),
        };
        let front = |a: Point, b: Point| Front {
            a,
            b,
            rank: 1,
            street: 0,
            shared: false,
            gate: false,
        };
        // Curved street on the outside of a 70 m arc: lots fan towards the centre.
        let (r, n) = (70.0, 24);
        let arc: Vec<Point> = (0..=n)
            .map(|i| {
                let a = std::f64::consts::PI * (0.2 + 0.6 * i as f64 / n as f64);
                Point {
                    x: r * a.cos(),
                    y: r * a.sin(),
                }
            })
            .collect();
        // Block: the arc (clockwise, street side) closed through the centre.
        let mut outer: Vec<Point> = arc.iter().rev().copied().collect();
        outer.push(Point { x: 0.0, y: 0.0 });
        let curved = Shape {
            outer,
            holes: vec![],
        };
        let curved = super::super::geometry::normalized(curved);
        // Oblique block: a parallelogram whose sides meet the street at 50 degrees.
        let oblique = super::super::geometry::normalized(Shape {
            outer: vec![
                Point { x: 0.0, y: 0.0 },
                Point { x: 90.0, y: 0.0 },
                Point { x: 120.0, y: 36.0 },
                Point { x: 30.0, y: 36.0 },
            ],
            holes: vec![],
        });
        for (name, shape) in [("curved", curved), ("oblique", oblique)] {
            // Street contacts follow the block ring orientation.
            let ring = &shape.outer;
            let fronts: Vec<Front> = (0..ring.len())
                .map(|i| (ring[i], ring[(i + 1) % ring.len()]))
                .filter(|(a, b)| {
                    if name == "curved" {
                        length(*a) > 69.0 && length(*b) > 69.0
                    } else {
                        a.y.abs() < 1e-9 && b.y.abs() < 1e-9
                    }
                })
                .map(|(a, b)| front(a, b))
                .collect();
            let lots = strips(
                &shape,
                0,
                Point { x: 1.0, y: 0.0 },
                &fronts,
                &morph,
                "core",
                &mut Rng::new(name),
            );
            let plots: Vec<_> = lots.iter().filter(|p| p.use_kind == "plot").collect();
            assert!(plots.len() >= 6, "{name}: {} lots", plots.len());
            for (i, a) in plots.iter().enumerate() {
                let fa = frontage(&a.shape, &fronts).0;
                assert!(fa >= 3.0, "{name}: lot without frontage");
                for b in plots.iter().skip(i + 1) {
                    if shared(&a.shape, &b.shape) < 1.0 {
                        continue;
                    }
                    let fb = frontage(&b.shape, &fronts).0;
                    let (x, y) = (area(&a.shape), area(&b.shape));
                    if fa.max(fb) / fa.min(fb) <= 1.5 {
                        assert!(
                            x.max(y) / x.min(y) < 2.0,
                            "{name}: areas {x:.0} / {y:.0}, fronts {fa:.1} / {fb:.1}"
                        );
                    }
                }
            }
        }
    }

    /// A quarter edit (« éditer un quartier ») reaches the lot cutting: a lower
    /// density on the quarter widens its lots, other quarters are unchanged.
    #[test]
    fn quarter_density_override_reaches_the_lots() {
        let block = |x: f64, q: usize| Block {
            phase: None,
            shape: rectangle(x, 0.0, x + 120.0, 30.0),
            quarter: q,
            kind: "block".into(),
            axis: Point { x: 1.0, y: 0.0 },
            zone: "core".into(),
        };
        let mut layout = Layout {
            config: Some(super::super::LayoutConfig::default()),
            programme: None,
            key: "edited-quarter".into(),
            structure: None,
            phases: vec![super::super::GrowthPhase {
                culture: "european-organic".into(),
                kind: "core".into(),
                zone: "core".into(),
                recipe: "core".into(),
                population: 1000.0,
                target_area: 0.0,
                shapes: vec![],
            }],
            archetype: "district".into(),
            culture: "european-organic".into(),
            center: Point { x: 120.0, y: 15.0 },
            quarters: (0..2)
                .map(|q| super::super::Quarter {
                    shape: rectangle(q as f64 * 130.0, 0.0, q as f64 * 130.0 + 120.0, 30.0),
                    phase: 0,
                    zone: "core".into(),
                })
                .collect(),
            enclosures: vec![],
            warnings: vec![],
            blocks: vec![block(0.0, 0), block(130.0, 1)],
            streets: vec![Street {
                path: vec![Point { x: -10.0, y: -3.0 }, Point { x: 260.0, y: -3.0 }],
                widths: vec![6.0; 2],
                rank: 1,
                role: "street".into(),
            }],
        };
        let lots = |layout: &Layout, b: usize| {
            super::super::generate_parcels(
                "edit",
                std::slice::from_ref(layout),
                &ParcelConfig::default(),
            )
            .unwrap()[0]
                .parcels
                .iter()
                .filter(|p| p.block == b && p.front.is_some())
                .count()
        };
        let (a0, a1) = (lots(&layout, 0), lots(&layout, 1));
        layout.config.as_mut().unwrap().overrides.quarters.insert(
            "1".into(),
            super::super::QuarterOverride {
                density: Some(0.25),
                ..Default::default()
            },
        );
        let (b0, b1) = (lots(&layout, 0), lots(&layout, 1));
        assert_eq!(a0, b0, "an unedited quarter keeps its lots");
        assert!(
            b1 < a1,
            "a sparser quarter has fewer, wider lots: {a1} -> {b1}"
        );
    }

    /// A one-quarter european layout of the given blocks and streets.
    fn strip_layout(key: &str, blocks: Vec<Block>, streets: Vec<Street>) -> Layout {
        Layout {
            config: Some(super::super::LayoutConfig::default()),
            programme: None,
            key: key.into(),
            structure: None,
            phases: vec![super::super::GrowthPhase {
                culture: "european-organic".into(),
                kind: "core".into(),
                zone: "edge".into(),
                recipe: "core".into(),
                population: 1000.0,
                target_area: 0.0,
                shapes: vec![],
            }],
            archetype: "district".into(),
            culture: "european-organic".into(),
            center: Point { x: 0.0, y: 0.0 },
            quarters: vec![super::super::Quarter {
                shape: rectangle(-500.0, -500.0, 500.0, 500.0),
                phase: 0,
                zone: "edge".into(),
            }],
            enclosures: vec![],
            warnings: vec![],
            blocks,
            streets,
        }
    }
    fn road(a: (f64, f64), b: (f64, f64), rank: usize) -> Street {
        Street {
            path: vec![Point { x: a.0, y: a.1 }, Point { x: b.0, y: b.1 }],
            widths: vec![6.0; 2],
            rank,
            role: "street".into(),
        }
    }
    fn edge_block(shape: Shape, kind: &str) -> Block {
        Block {
            phase: None,
            shape,
            quarter: 0,
            kind: kind.into(),
            axis: Point { x: 1.0, y: 0.0 },
            zone: "edge".into(),
        }
    }

    /// Invariant (edge reserves): open land between the built fingers that
    /// fronts a street is enclosed as crofts and market gardens at field
    /// scale, never left as one blank reserve; it holds no house.
    #[test]
    fn edge_reserve_on_a_street_is_enclosed_as_fields_without_houses() {
        let shape = rectangle(0.0, 0.0, 240.0, 120.0);
        let layout = strip_layout(
            "edge-reserve",
            vec![edge_block(shape.clone(), "reserve")],
            vec![road((-20.0, -3.0), (260.0, -3.0), 2)],
        );
        let lots = &super::super::generate_parcels("edge", &[layout], &ParcelConfig::default())
            .unwrap()[0]
            .parcels;
        assert!(lots.len() >= 4, "{} enclosures", lots.len());
        assert!(
            lots.iter()
                .all(|p| p.use_kind == "garden" && p.family == "reserve" && p.envelope.is_none())
        );
        let total: f64 = lots.iter().map(|p| area(&p.shape)).sum();
        assert!((total - area(&shape)).abs() < 1e-3 * area(&shape));
        // Field scale: no enclosure is a house lot or the whole block.
        assert!(lots.iter().all(|p| area(&p.shape) < 0.5 * area(&shape)));
    }

    /// Invariant (residual slivers): the strip left along a street when the
    /// lots behind it were cut at their maximum depth holds no house; it is
    /// shared out among those lots along their common side, extending each to
    /// the street, and never left as a residual.
    #[test]
    fn street_strip_left_behind_deep_lots_is_shared_out_to_the_street() {
        let street_front = Front {
            a: Point { x: 0.0, y: 34.0 },
            b: Point { x: 30.0, y: 34.0 },
            rank: 2,
            street: 0,
            shared: false,
            gate: false,
        };
        let back_front = Front {
            a: Point { x: 30.0, y: 0.0 },
            b: Point { x: 0.0, y: 0.0 },
            rank: 1,
            street: 1,
            shared: false,
            gate: false,
        };
        let fronts = [street_front, back_front];
        let axis = Point { x: 1.0, y: 0.0 };
        let lot = |x0: f64, x1: f64| {
            let mut p = parcel(rectangle(x0, 0.0, x1, 30.0), 0, axis, &fronts, "plot");
            p.envelope = Some(rectangle(x0 + 1.0, 1.0, x1 - 1.0, 12.0));
            p
        };
        let strip = parcel(rectangle(0.0, 30.0, 30.0, 34.0), 0, axis, &fronts, "plot");
        let mut cells = vec![lot(0.0, 12.0), lot(12.0, 30.0), strip];
        let accept = |s: &Shape| Some(s.clone());
        let shallow = |_: &Shape| false;
        assert!(share_out(
            &mut cells,
            2,
            &fronts,
            &accept,
            &shallow,
            f64::INFINITY
        ));
        assert_eq!(cells.len(), 2);
        let areas: Vec<f64> = cells.iter().map(|p| area(&p.shape)).collect();
        assert!((areas[0] - 12.0 * 34.0).abs() < 1e-6, "{areas:?}");
        assert!((areas[1] - 18.0 * 34.0).abs() < 1e-6, "{areas:?}");
        assert!(
            cells
                .iter()
                .all(|p| p.provenance.iter().any(|q| q == "residual-shared"))
        );
        // A strip whose receivers would lose their witness stays residual.
        let mut cells = vec![lot(0.0, 12.0), lot(12.0, 30.0), cells[0].clone()];
        cells[2] = parcel(rectangle(0.0, 30.0, 30.0, 34.0), 0, axis, &fronts, "plot");
        let refuse = |_: &Shape| None;
        assert!(!share_out(
            &mut cells,
            2,
            &fronts,
            &refuse,
            &shallow,
            f64::INFINITY
        ));
        assert_eq!(cells.len(), 3);
    }

    /// Blocks are cut in parallel and merged in block order: one thread and
    /// many give the same partition. The same town also checks the lot
    /// balance invariant (neighbours with similar fronts stay within a 3x
    /// area ratio) and the depth bound (no admitted lot deeper than 100 m).
    #[test]
    fn parallel_parcel_stage_matches_serial_and_neighbours_stay_balanced() {
        let (n, width) = (256, 3000.0);
        let (height, water) = (vec![10.0_f32; n * n], vec![0_u8; n * n]);
        let surface = super::super::Surface {
            geometry: None,
            width,
            n,
            height: &height,
            water: &water,
        };
        let c = width * 0.5;
        let mut roads = vec![
            road((1.0, c - 40.0), (width - 1.0, c + 60.0), 0),
            road((c + 30.0, 1.0), (c - 50.0, width - 1.0), 0),
        ];
        for r in &mut roads {
            r.role = "regional".into();
            r.widths = vec![7.0; 2];
        }
        let site = super::super::Site {
            key: "probe".into(),
            name: "Probe".into(),
            population: 8_000,
            culture: "european-organic".into(),
            center: Point { x: c, y: c },
            radius: 300.0,
        };
        let layout = super::super::generate_quarters(
            "probe-city",
            std::slice::from_ref(&site),
            &super::super::LayoutConfig::default(),
            surface,
            &roads,
        )
        .unwrap()
        .remove(0);
        let run = |threads| {
            super::super::par::with_threads(threads, || {
                super::super::generate_parcels(
                    "parallel",
                    std::slice::from_ref(&layout),
                    &ParcelConfig::default(),
                )
                .unwrap()
                .remove(0)
            })
        };
        let serial = run(1);
        let parallel = run(8);
        assert!(serial.parcels.len() > 200, "{} lots", serial.parcels.len());
        assert!(
            serde_json::to_string(&serial).unwrap() == serde_json::to_string(&parallel).unwrap(),
            "parallel parcel stage differs from serial"
        );
        let lots: Vec<&Parcel> = serial
            .parcels
            .iter()
            .filter(|p| p.use_kind == "plot" && p.envelope.is_some())
            .collect();
        let mut by_block: BTreeMap<usize, Vec<&Parcel>> = BTreeMap::new();
        for p in &lots {
            by_block.entry(p.block).or_default().push(p);
        }
        let front = |p: &Parcel| p.access.as_ref().map_or(0.0, |a| a.front_length);
        let mut unbalanced = 0;
        for lots in by_block.values() {
            for (i, a) in lots.iter().enumerate() {
                for b in &lots[i + 1..] {
                    let (fa, fb) = (front(a), front(b));
                    if fa.min(fb) <= 0.0 || fa.max(fb) / fa.min(fb) > 1.5 {
                        continue;
                    }
                    let (aa, ab) = (area(&a.shape), area(&b.shape));
                    if aa.max(ab) / aa.min(ab) >= 3.0 && shared(&a.shape, &b.shape) >= 1.0 {
                        unbalanced += 1;
                    }
                }
            }
        }
        assert!(
            unbalanced * 100 <= lots.len(),
            "{unbalanced} unbalanced pairs among {} lots",
            lots.len()
        );
        let layout_ref = &layout;
        let index = FrontageIndex::new(layout_ref);
        let deepest = lots
            .iter()
            .map(|p| match (p.family.as_str(), p.front) {
                // Faubourg lean-tos stand outside their block, on an outer road:
                // their depth runs from their own front, not the block's streets.
                ("faubourg", Some([a, b])) => {
                    let n = normal(unit(sub(b, a)));
                    p.shape.outer.iter().map(|q| dot(sub(*q, a), n).abs()).fold(0.0, f64::max)
                }
                _ => lot_depth(&p.shape, &frontages(&layout_ref.blocks[p.block].shape, layout_ref, &index)),
            })
            .fold(0.0, f64::max);
        assert!(deepest <= 100.0, "deepest admitted lot {deepest:.1} m");
    }
}
