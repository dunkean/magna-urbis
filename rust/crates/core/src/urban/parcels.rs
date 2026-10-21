//! Street-fronting cadastral partitions, in metres. Every cut retains the
//! parent's frame and every unclaimed piece remains explicit back land.
use super::geometry::{area, difference, intersection};
use super::{Layout, Morph, Parcel, ParcelConfig, Partition, Point, Shape};
use crate::rng::Rng;
use std::collections::BTreeMap;
#[cfg(test)]
mod cadastral_tests;
mod contacts;
mod families;
mod pressure;

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
pub(super) fn parcel_envelope(
    p: &Parcel,
    width: f64,
    depth: f64,
    access_width: f64,
) -> Option<Shape> {
    families::envelope(&p.shape, &parcel_fronts(p), width, depth, access_width)
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
    far_rank.map_or(hit, |other| {
        hit * (0.5 + 0.17 * (other as f64 - rank as f64)).clamp(0.5, 0.85) + 1.2
    })
}

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

fn maximum_plot_depth(morph: &Morph, zone: &str) -> f64 {
    let [a, b] = morph.range("plotDepth", zone);
    // Deep filling may close a normal block's back seam. An unsplittable city
    // sector is not permission to stretch an ordinary property across the city.
    2.0 * b.max(a).max(1.0)
}

fn plot_depth(shape: &Shape, axis: Point, fronts: &[Front]) -> Option<f64> {
    let f = frontage(shape, fronts).1?;
    let inward = frame_direction(normal(unit(sub(f.b, f.a))), axis);
    Some(bounds(shape, inward).1 - dot(f.a, inward).min(dot(f.b, inward)))
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
    let mut available = vec![shape.clone()];
    let mut plots = Vec::new();
    for (ri, run) in runs(fronts).into_iter().enumerate() {
        let mut rr = rng.fork(&format!("frontage:{ri}"));
        let first = run[0].a;
        let last = run.last().unwrap().b;
        if length(sub(last, first)) < 4.0 {
            continue;
        }
        let inward = frame_direction(normal(unit(sub(last, first))), axis);
        let cut_axis = normal(inward);
        let target = rr.range(depth_min, depth_max).max(1.0);
        let mut limit = f64::NEG_INFINITY;
        let mut frontage_level = f64::INFINITY;
        for f in &run {
            for p in [f.a, add(f.a, scale(sub(f.b, f.a), 0.5)), f.b] {
                frontage_level = frontage_level.min(dot(p, inward));
                let cap = ray_limit(shape, add(p, scale(inward, 0.05)), inward, fronts, f.rank);
                let cap = if cap.is_finite() { cap } else { target };
                let spare = (cap - target).max(0.0);
                let closure = (1.0 - (spare / 7.0).clamp(0.0, 1.0)).powi(2);
                let depth =
                    target.min(cap) + spare * (depth_pressure + (1.0 - depth_pressure) * closure);
                limit = limit.max(dot(p, inward) + depth);
            }
        }
        // This also bounds curved frontage runs, whose points do not all lie on
        // the same depth plane. Their inaccessible rear land stays a garden.
        limit = limit.min(frontage_level + maximum_depth);
        let mut territories = Vec::new();
        for cell in &available {
            for t in half(cell, inward, limit, true) {
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
            let extent = s1 - s0;
            let mut widths = Vec::new();
            let mut total = 0.0;
            let lo = width_min.max(3.6);
            let hi = width_max.max(lo);
            let module = (((lo + hi) * 0.5) * rr.range(0.94, 1.06)).clamp(lo, hi);
            let mut rhythm = 1.0;
            while total < extent && widths.len() < 4096 {
                rhythm = (0.75 * rhythm + 0.25 * rr.range(0.85, 1.15)).clamp(0.85, 1.15);
                let w = module * rhythm;
                widths.push(w);
                total += w;
            }
            if widths.len() > 1 && total - extent > 0.5 * widths[widths.len() - 1] {
                total -= widths.pop().unwrap();
            }
            let mut rem = vec![territory];
            let mut at = s0;
            let count = widths.len();
            for (i, w) in widths.into_iter().enumerate() {
                at += w * extent / total;
                if i + 1 == count {
                    for cell in rem {
                        plots.push(parcel(cell, block, axis, fronts, "plot"));
                    }
                    break;
                }
                let mut next = Vec::new();
                for cell in rem {
                    for piece in half(&cell, cut_axis, at, true) {
                        plots.push(parcel(piece, block, axis, fronts, "plot"));
                    }
                    next.extend(half(&cell, cut_axis, at, false));
                }
                rem = next;
            }
        }
    }
    for cell in available {
        plots.push(parcel(cell, block, axis, &[], "garden"));
    }
    merge_slivers(&mut plots, fronts, Some(maximum_depth));
    plots
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
        for (di, d) in directions.into_iter().enumerate() {
            let (lo, hi) = bounds(&cell, d);
            for fraction_try in [fraction, 0.5, 0.43, 0.57, 0.36, 0.64] {
                let at = lo + (hi - lo) * fraction_try;
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
            if best.is_some() {
                break;
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
    let union = poly(a).union(&poly(b));
    if union.0.len() != 1 {
        return None;
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
fn qualify(
    cells: &mut Vec<Parcel>,
    fronts: &[Front],
    layout: &Layout,
    profile: &super::culture::UrbanAdmissibility,
    family: &str,
    depth_limit: f64,
) {
    let witness = |shape: &Shape| {
        if area(shape) + 1e-6 < profile.min_area {
            return None;
        }
        let allowed: Vec<_> = fronts
            .iter()
            .copied()
            .filter(|f| !f.shared || profile.shared_access)
            .collect();
        families::envelope(
            shape,
            &allowed,
            profile.min_frontage,
            profile.min_depth,
            profile.min_access_width,
        )
    };
    for p in cells.iter_mut().filter(|p| p.use_kind == "plot") {
        p.envelope = witness(&p.shape);
    }
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
            let repair = candidates.into_iter().take(8).find_map(|(j, _)| {
                let shape = joined(&cells[i].shape, &cells[j].shape)?;
                if family != "courtyard"
                    && plot_depth(&shape, cells[i].axis, fronts)
                        .is_some_and(|d| d > depth_limit + 0.01)
                {
                    return None;
                }
                let envelope = witness(&shape)?;
                Some((j, shape, envelope))
            });
            if let Some((j, shape, envelope)) = repair {
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
            } else {
                i += 1;
            }
        }
    }
    for p in cells.iter_mut() {
        p.family = family.into();
        let contacts = contacts::boundary_contacts(&p.shape, fronts);
        if p.use_kind == "plot" {
            if p.envelope.is_none() {
                p.use_kind = "residual".into();
                p.reason = if !contacts.iter().enumerate().any(|(i, f)| {
                    let (lo, hi) = contacts::support_span(&contacts, i);
                    hi - lo + 1e-6
                        >= if f.gate {
                            profile.min_access_width
                        } else {
                            profile.min_frontage
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
            profile.min_frontage
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
                    >= if f.gate {
                        profile.min_access_width
                    } else {
                        minimum
                    }
                    && (!f.shared || profile.shared_access || p.use_kind == "court")
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
            kind: best.map_or("unserved", |f| access_kind(f, layout)).into(),
            street: best.map(|f| f.street),
            front_length: support,
        });
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
fn cultural_context<'a>(layout: &'a Layout, block: &super::Block, fallback: &'a str) -> &'a str {
    block
        .phase
        .or_else(|| layout.quarters.get(block.quarter).map(|q| q.phase))
        .and_then(|phase| layout.phases.get(phase))
        .filter(|p| !p.culture.is_empty())
        .map_or(fallback, |p| p.culture.as_str())
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
    for (bi, block) in layout.blocks.iter().enumerate() {
        let block_id = block_identity(layout, &block.shape);
        let morph = layout
            .quarters
            .get(block.quarter)
            .and_then(|q| phase_morphs.get(block.phase.unwrap_or(q.phase)))
            .unwrap_or(morph);
        let tissue = layout
            .structure
            .as_ref()
            .and_then(|s| {
                s.districts
                    .iter()
                    .find(|d| d.quarters.contains(&block.quarter))
            })
            .map_or("culture", |d| d.tissue.as_str());
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
        let admission = super::culture::contextual_mapping(
            block_culture,
            layout
                .programme
                .as_ref()
                .map_or("any", |p| p.context.period.as_str()),
            &block.zone,
            local_morph.text("plotOp"),
            "domestic",
        )
        .map(|c| c.admissibility);
        let occupation = layout
            .programme
            .as_ref()
            .and_then(|p| p.environment.iter().find(|e| e.block == bi))
            .map_or(road_pressures[bi], |e| e.pressure);
        let mut local_morph = pressure::apply(
            &local_morph,
            occupation,
            local_morph.text("streetOp") == "grid",
            admission.as_ref(),
        );
        if dense_souk {
            let minimum = admission.as_ref().map_or(0.0, |p| p.min_depth);
            local_morph.value["plotDepth"][zone] =
                serde_json::json!(local_depth.map(|d| d.max(minimum)));
        }
        let morph = &local_morph;
        if block.kind != "block" {
            diagnostics.covered_area += area(&block.shape);
            result.parcels.push(Parcel {
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
            resolve_identity(result.parcels.last_mut().unwrap(), bi, &block_id);
            continue;
        }
        let mut rng = root.fork(&block_id);
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
            result.parcels.push(retained);
            diagnostics.covered_area += area(&block.shape);
            continue;
        }
        if fronts.is_empty() && morph.text("plotOp") != "garden" {
            // A removed or impracticable road cannot confer residential access.
            let mut unserved = parcel(block.shape.clone(), bi, axis, &[], "garden");
            unserved.pressure = occupation;
            unserved.use_kind = "residual".into();
            unserved.reason = "no-street-contact".into();
            unserved.family = families::family(morph.text("plotOp")).into();
            result.warnings.push(format!(
                "Îlot {bi} : aucun contact continu avec une rue ; terrain conservé comme résidu"
            ));
            resolve_identity(&mut unserved, bi, &block_id);
            result.parcels.push(unserved);
            diagnostics.covered_area += area(&block.shape);
            diagnostics.unserved_area += area(&block.shape);
            continue;
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
            _ => strips(&block.shape, bi, axis, &fronts, morph, zone, &mut rng),
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
                .flat_map(|p| bound_frontage_depth(p, depth))
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
        qualify(
            &mut parcels,
            &fronts,
            layout,
            &admission,
            families::family(morph.text("plotOp")),
            maximum_plot_depth(morph, zone),
        );
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
                    families::family(morph.text("plotOp")),
                    maximum_plot_depth(morph, zone),
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
        diagnostics.covered_area += coverage;
        diagnostics.residual_area += residual;
        diagnostics.overlap_area += overlap;
        diagnostics.unserved_area += parcels
            .iter()
            .filter(|p| p.access.as_ref().is_some_and(|a| a.kind == "unserved"))
            .map(|p| area(&p.shape))
            .sum::<f64>();
        if residual + overlap > expected.max(1.0) * 1e-5 {
            result.warnings.push(format!(
                "Îlot {bi} : couverture résiduelle {residual:.3} m², chevauchement {overlap:.3} m²"
            ));
        }
        if (actual - expected).abs() > expected.max(1.0) * 1e-5 {
            result.warnings.push(format!(
                "Block {bi}: cadastral area residual {:.3} m²",
                actual - expected
            ));
        }
        for p in &mut parcels {
            resolve_identity(p, bi, &block_id);
        }
        result.parcels.extend(parcels);
    }
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
}
