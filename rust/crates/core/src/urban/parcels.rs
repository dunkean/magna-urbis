//! Street-fronting cadastral partitions, in metres. Every cut retains the
//! parent's frame and every unclaimed piece remains explicit back land.
use super::geometry::{area, difference, intersection};
use super::{Layout, Morph, Parcel, ParcelConfig, Partition, Point, Shape};
use crate::rng::Rng;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy)]
struct Front {
    a: Point,
    b: Point,
    rank: usize,
    street: usize,
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

struct FrontageIndex {
    cells: BTreeMap<(i32, i32), Vec<(usize, usize)>>,
}
impl FrontageIndex {
    fn new(layout: &Layout) -> Self {
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
    fn candidates(&self, a: Point, b: Point) -> BTreeSet<(usize, usize)> {
        let mut out = BTreeSet::new();
        for y in (a.y.min(b.y) / 64.0).floor() as i32..=(a.y.max(b.y) / 64.0).floor() as i32 {
            for x in (a.x.min(b.x) / 64.0).floor() as i32..=(a.x.max(b.x) / 64.0).floor() as i32 {
                if let Some(v) = self.cells.get(&(x, y)) {
                    out.extend(v);
                }
            }
        }
        out
    }
}
fn frontages(shape: &Shape, layout: &Layout, index: &FrontageIndex) -> Vec<Front> {
    let mut out = Vec::new();
    for i in 0..shape.outer.len() {
        let a = shape.outer[i];
        let b = shape.outer[(i + 1) % shape.outer.len()];
        if length(sub(b, a)) < 0.5 {
            continue;
        }
        let mut best: Option<(usize, usize)> = None;
        for (si, k) in index.candidates(a, b) {
            let street = &layout.streets[si];
            let segment = &street.path[k..=k + 1];
            let p = segment[0];
            let q = segment[1];
            let d = sub(q, p);
            let l2 = dot(d, d);
            let mut contact = true;
            for j in 0..=4 {
                let sample = add(a, scale(sub(b, a), f64::from(j) / 4.0));
                let t = (dot(sub(sample, p), d) / l2.max(1e-12)).clamp(0.0, 1.0);
                let hw = (street.widths.get(k).copied().unwrap_or(4.0) * (1.0 - t)
                    + street.widths.get(k + 1).copied().unwrap_or(4.0) * t)
                    * 0.5;
                let dist = length(sub(sample, add(p, scale(d, t))));
                if dist >= 14.0 || (dist - hw).abs() > (0.3 * hw).max(0.8) {
                    contact = false;
                    break;
                }
                // The centreline must be outside the block, not beyond an
                // unrelated boundary which happens to be equally close.
                let outside = sub(add(p, scale(d, t)), sample);
                if dot(outside, normal(unit(sub(b, a)))) > 0.15 {
                    contact = false;
                    break;
                }
            }
            if contact && best.is_none_or(|(rank, _)| street.rank < rank) {
                best = Some((street.rank, si));
            }
        }
        if let Some((rank, street)) = best {
            out.push(Front { a, b, rank, street });
        }
    }
    out
}

/// Count actual shared boundary rather than an inferred frontage chord.
fn frontage(shape: &Shape, fronts: &[Front]) -> (f64, Option<Front>) {
    let mut total = 0.0;
    let mut best: Option<Front> = None;
    for i in 0..shape.outer.len() {
        let a = shape.outer[i];
        let b = shape.outer[(i + 1) % shape.outer.len()];
        let len = length(sub(b, a));
        if len < 0.05 {
            continue;
        }
        for f in fronts {
            if distance(a, f.a, f.b) < 0.025 && distance(b, f.a, f.b) < 0.025 {
                total += len;
                if best.is_none_or(|old| length(sub(old.b, old.a)) < len) {
                    best = Some(Front { a, b, ..*f });
                }
                break;
            }
        }
    }
    (total, best)
}

fn parcel(shape: Shape, block: usize, axis: Point, fronts: &[Front], kind: &str) -> Parcel {
    let (len, f) = frontage(&shape, fronts);
    Parcel {
        shape,
        block,
        axis,
        use_kind: if len >= 3.0 { kind } else { "garden" }.to_owned(),
        front: f.filter(|_| len >= 3.0).map(|f| [f.a, f.b]),
        rank: f.map_or(99, |f| f.rank),
    }
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
        street: 0,
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
    let deep =
        (coverage >= 0.68 || morph.flag("deepFill")) && zone != "faubourg" && zone != "village";
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
                let depth = if deep || cap - target < 7.0 {
                    cap
                } else {
                    target.min(cap)
                };
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
            while total < extent && widths.len() < 4096 {
                let mut w = rr.range(width_min.max(3.6), width_max.max(width_min).max(3.6));
                if rr.chance(morph.number("wideLotChance").clamp(0.0, 1.0)) {
                    w *= rr.range(1.8, 2.8);
                }
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
    let min_width = (amin.sqrt() * 0.55).max(6.0);
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
            let bad = a < if cell.front.is_some() { 35.0 } else { 25.0 }
                || cell.front.is_some_and(|f| length(sub(f[1], f[0])) < 3.6)
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
                let merged = parcel(shape, cells[j].block, cells[j].axis, fronts, "plot");
                cells[j] = merged;
                cells.remove(i);
                continue;
            }
            if cells[i]
                .front
                .is_some_and(|f| length(sub(f[1], f[0])) < 3.0)
            {
                cells[i].front = None;
                cells[i].use_kind = "garden".to_owned();
            }
            i += 1;
        }
    }
}

pub(super) fn generate(
    seed: &str,
    layout: &Layout,
    cfg: &ParcelConfig,
    morph: &Morph,
) -> Result<Partition, String> {
    let mut result = Partition {
        key: layout.key.clone(),
        parcels: Vec::new(),
        warnings: Vec::new(),
    };
    let root = Rng::new(seed).fork(&format!("parcels:{}", layout.key));
    let index = FrontageIndex::new(layout);
    for (bi, block) in layout.blocks.iter().enumerate() {
        let zone = if cfg.zone == "auto" {
            &block.zone
        } else {
            &cfg.zone
        };
        if block.kind != "block" {
            result.parcels.push(Parcel {
                shape: block.shape.clone(),
                block: bi,
                axis: block.axis,
                use_kind: block.kind.split(':').next().unwrap_or("place").to_owned(),
                front: None,
                rank: 99,
            });
            continue;
        }
        let mut rng = root.fork(&format!("block:{bi}"));
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
        let fronts = frontages(&block.shape, layout, &index);
        if fronts.is_empty() {
            // A removed or impracticable road cannot confer residential access.
            result
                .parcels
                .push(parcel(block.shape.clone(), bi, axis, &[], "garden"));
            continue;
        }
        let mut parcels = match morph.text("plotOp") {
            "garden" => vec![parcel(block.shape.clone(), bi, axis, &[], "garden")],
            "courtyard" | "compound" => {
                courtyards(&block.shape, bi, axis, &fronts, morph, zone, &mut rng)
            }
            "wholeBlock" => vec![parcel(block.shape.clone(), bi, axis, &fronts, "plot")],
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
        // Boolean pieces retain exclusions as holes; an unresolved hole is
        // never replaced by a filled exterior ring.
        let actual: f64 = parcels.iter().map(|p| area(&p.shape)).sum();
        let expected = area(&block.shape);
        if (actual - expected).abs() > expected.max(1.0) * 1e-5 {
            result.warnings.push(format!(
                "Block {bi}: cadastral area residual {:.3} m²",
                actual - expected
            ));
        }
        result.parcels.extend(parcels);
    }
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::super::geometry::rectangle;
    use super::super::{Block, Street};
    use super::*;
    use serde_json::json;

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
                shape,
                block: 0,
                axis: Point { x: 1.0, y: 0.0 },
                rank: 2,
                front: Some([Point { x: 0.0, y: 0.0 }, Point { x: 10.0, y: 0.0 }]),
                use_kind: "plot".into(),
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
            key: "unserved-deep-sector".into(),
            culture: "european-organic".into(),
            center: Point { x: 120.0, y: 200.0 },
            quarters: vec![],
            enclosures: vec![],
            warnings: vec![],
            blocks: vec![Block {
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
            key: "frontage-fixture".into(),
            culture: "european".into(),
            center: Point { x: 50.0, y: 40.0 },
            quarters: vec![],
            enclosures: vec![],
            warnings: vec![],
            blocks: vec![Block {
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
