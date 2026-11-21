//! Street indexing, continuous boundary contacts and the runs used by cutters.
//! All tolerances are in metres and independent of polyline segmentation.

use super::cut_geometry::{add, dot, length, normal, scale, sub, unit};
use crate::urban::{Layout, Parcel, Point, Shape};
use std::collections::BTreeMap;

/// Projected support on one local tangent. Only touching contacts of the same
/// street/class join; the complete support stays within 20 degrees of it.
pub(super) fn support_span(fronts: &[Front], anchor: usize) -> (f64, f64) {
    let f = fronts[anchor];
    let u = unit(sub(f.b, f.a));
    let compatible = |g: &Front| {
        g.street == f.street
            && g.rank == f.rank
            && g.gate == f.gate
            && g.shared == f.shared
            && dot(unit(sub(g.b, g.a)), u) >= 20.0_f64.to_radians().cos()
    };
    let mut selected = vec![false; fronts.len()];
    selected[anchor] = true;
    let mut queue = vec![anchor];
    let (mut lo, mut hi) = (0.0_f64, length(sub(f.b, f.a)));
    while let Some(i) = queue.pop() {
        let current = fronts[i];
        for (j, other) in fronts.iter().enumerate() {
            if selected[j] || !compatible(other) {
                continue;
            }
            // Numerical tolerance only: offset-corner gaps remain gaps.
            if length(sub(current.b, other.a)).min(length(sub(other.b, current.a))) > 1e-5 {
                continue;
            }
            selected[j] = true;
            queue.push(j);
            for p in [other.a, other.b] {
                let projected = dot(sub(p, f.a), u);
                lo = lo.min(projected);
                hi = hi.max(projected);
            }
        }
    }
    (lo, hi)
}

/// `support_span` of every contact. The touching contacts are found once, so a
/// chain of `k` contacts costs its own length per anchor, not `k` squared.
pub(super) fn support_spans(fronts: &[Front]) -> Vec<(f64, f64)> {
    let mut starts: Vec<usize> = (0..fronts.len()).collect();
    starts.sort_by(|&i, &j| fronts[i].a.x.total_cmp(&fronts[j].a.x).then(i.cmp(&j)));
    let mut links: Vec<Vec<usize>> = vec![Vec::new(); fronts.len()];
    for (i, f) in fronts.iter().enumerate() {
        let from = starts.partition_point(|&j| fronts[j].a.x < f.b.x - 1e-5);
        for &j in starts[from..]
            .iter()
            .take_while(|&&j| fronts[j].a.x <= f.b.x + 1e-5)
        {
            if j != i && length(sub(f.b, fronts[j].a)) <= 1e-5 {
                links[i].push(j);
                links[j].push(i);
            }
        }
    }
    (0..fronts.len())
        .map(|anchor| {
            let f = fronts[anchor];
            let u = unit(sub(f.b, f.a));
            let compatible = |g: &Front| {
                g.street == f.street
                    && g.rank == f.rank
                    && g.gate == f.gate
                    && g.shared == f.shared
                    && dot(unit(sub(g.b, g.a)), u) >= 20.0_f64.to_radians().cos()
            };
            let mut selected = vec![false; fronts.len()];
            selected[anchor] = true;
            let mut queue = vec![anchor];
            let (mut lo, mut hi) = (0.0_f64, length(sub(f.b, f.a)));
            while let Some(i) = queue.pop() {
                for &j in &links[i] {
                    if selected[j] || !compatible(&fronts[j]) {
                        continue;
                    }
                    selected[j] = true;
                    queue.push(j);
                    for p in [fronts[j].a, fronts[j].b] {
                        let projected = dot(sub(p, f.a), u);
                        lo = lo.min(projected);
                        hi = hi.max(projected);
                    }
                }
            }
            (lo, hi)
        })
        .collect()
}

fn clip(interval: &mut (f64, f64), a: f64, b: f64) -> bool {
    // a + b*t >= 0
    if b.abs() < 1e-12 {
        return a >= -1e-10;
    }
    let t = -a / b;
    if b > 0.0 {
        interval.0 = interval.0.max(t);
    } else {
        interval.1 = interval.1.min(t);
    }
    interval.1 - interval.0 > 1e-9
}

pub(super) fn merge(mut fronts: Vec<Front>) -> Vec<Front> {
    let mut out: Vec<Front> = Vec::new();
    for f in fronts.drain(..) {
        if let Some(last) = out.last_mut()
            && last.street == f.street
            && last.rank == f.rank
            && last.shared == f.shared
            && last.gate == f.gate
            && length(sub(last.b, f.a)) < 1e-6
            && dot(unit(sub(last.b, last.a)), unit(sub(f.b, f.a))) > 1.0 - 1e-10
        {
            last.b = f.b;
        } else {
            out.push(f);
        }
    }
    if out.len() > 1 {
        let first = out[0];
        let last = *out.last().unwrap();
        if first.street == last.street
            && first.rank == last.rank
            && first.shared == last.shared
            && first.gate == last.gate
            && length(sub(last.b, first.a)) < 1e-6
            && dot(unit(sub(last.b, last.a)), unit(sub(first.b, first.a))) > 1.0 - 1e-10
        {
            out[0].a = last.a;
            out.pop();
        }
    }
    out
}

pub(super) fn street_contacts(shape: &Shape, layout: &Layout, index: &FrontageIndex) -> Vec<Front> {
    let mut result = Vec::new();
    let mut candidates = Vec::new();
    for ring in std::iter::once(&shape.outer).chain(shape.holes.iter()) {
        let mut ring_contacts = Vec::new();
        for (&a, &b) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            let edge = sub(b, a);
            if length(edge) < 1e-7 {
                continue;
            }
            let inward = normal(unit(edge));
            index.candidates(a, b, &mut candidates);
            let mut intervals = Vec::new();
            for &(si, k) in &candidates {
                let street = &layout.streets[si];
                let p = street.path[k];
                let d = sub(street.path[k + 1], p);
                if length(d) < 1e-7 || dot(unit(d), unit(edge)).abs() < 20.0_f64.to_radians().cos()
                {
                    continue;
                }
                let u0 = dot(sub(a, p), d) / dot(d, d);
                let du = dot(edge, d) / dot(d, d);
                let outside0 = sub(add(p, scale(d, u0)), a);
                let outside_delta = sub(scale(d, du), edge);
                let h0 = -dot(outside0, inward);
                let dh = -dot(outside_delta, inward);
                let w0 = street.widths.get(k).copied().unwrap_or(4.0) * 0.5;
                let dw = street.widths.get(k + 1).copied().unwrap_or(4.0) * 0.5 - w0;
                let width0 = w0 + dw * u0;
                let width_delta = dw * du;
                // Union of the absolute (0.8m) and proportional (30%) bands.
                // Each is linear, including tapered streets.
                for proportional in [false, true] {
                    let (tol0, dtol) = if proportional {
                        (width0 * 0.3, width_delta * 0.3)
                    } else {
                        (0.8, 0.0)
                    };
                    let mut span = (0.0_f64, 1.0_f64);
                    if [
                        (u0, du),
                        (1.0 - u0, -du),
                        (h0 + 0.15, dh),
                        (14.0 - h0, -dh),
                        (tol0 - h0 + width0, dtol - dh + width_delta),
                        (tol0 + h0 - width0, dtol + dh - width_delta),
                    ]
                    .into_iter()
                    .all(|(c, d)| clip(&mut span, c, d))
                    {
                        intervals.push((span.0, span.1, street.rank, si));
                    }
                }
            }
            let mut breaks = intervals
                .iter()
                .flat_map(|&(lo, hi, _, _)| [lo, hi])
                .collect::<Vec<_>>();
            breaks.sort_by(f64::total_cmp);
            breaks.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
            for pair in breaks.windows(2) {
                let mid = (pair[0] + pair[1]) * 0.5;
                if let Some(&(_, _, rank, street)) = intervals
                    .iter()
                    .filter(|&&(lo, hi, _, _)| mid >= lo && mid <= hi)
                    .min_by_key(|&&(_, _, rank, street)| (rank, street))
                {
                    ring_contacts.push(Front {
                        a: add(a, scale(edge, pair[0])),
                        b: add(a, scale(edge, pair[1])),
                        rank,
                        street,
                        shared: false,
                        gate: matches!(
                            layout.streets[street].role.as_str(),
                            "private" | "derb" | "hutong" | "roji" | "collective" | "close"
                        ),
                    });
                }
            }
        }
        result.extend(merge(ring_contacts));
    }
    result
}

/// Intersect both boundary interval sets, allowing either side to be split.
pub(super) fn boundary_contacts(shape: &Shape, fronts: &[Front]) -> Vec<Front> {
    // A front kept below lies within 0.025 m of a side over part of the side's
    // extent, so it meets the shape's box grown by 0.025 m: fronts outside the
    // box grown by 0.05 m are dropped first, the others keep their order.
    let (x0, y0, x1, y1) = super::super::geometry::bbox(shape);
    let near: Vec<Front> = fronts.iter().filter(|f| {
        f.a.x.max(f.b.x) >= x0 - 0.05 && f.a.x.min(f.b.x) <= x1 + 0.05
            && f.a.y.max(f.b.y) >= y0 - 0.05 && f.a.y.min(f.b.y) <= y1 + 0.05
    }).copied().collect();
    let fronts = near.as_slice();
    // Front geometry is immutable for this call. Evaluate the ORIGINAL
    // unit(sub(b,a)) once per front, lazily at the first nondegenerate edge,
    // rather than once for each (ring edge, front) pair. No candidate
    // reordering, predicate/tolerance or arithmetic formula changes.
    let directions=std::cell::OnceCell::<Vec<Point>>::new();
    let mut result = Vec::new();
    for ring in std::iter::once(&shape.outer).chain(shape.holes.iter()) {
        let mut pieces = Vec::new();
        for (&a, &b) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            let edge = sub(b, a);
            let len = length(edge);
            if len < 1e-7 {
                continue;
            }
            let axis = scale(edge, 1.0 / len);
            let mut spans = Vec::new();
            let directions=directions.get_or_init(||fronts.iter().map(|f|unit(sub(f.b,f.a))).collect());
            for (f,&direction) in fronts.iter().zip(directions) {
                if dot(direction, axis) < 1.0 - 1e-8
                    || dot(sub(f.a, a), normal(axis)).abs() > 0.025
                    || dot(sub(f.b, a), normal(axis)).abs() > 0.025
                {
                    continue;
                }
                let lo = dot(sub(f.a, a), axis).max(0.0);
                let hi = dot(sub(f.b, a), axis).min(len);
                if hi - lo > 1e-7 {
                    spans.push((lo, hi, *f));
                }
            }
            spans.sort_by(|a, b| a.0.total_cmp(&b.0));
            let mut end = 0.0_f64;
            for (lo, hi, f) in spans {
                let lo = lo.max(end);
                if hi - lo > 1e-7 {
                    pieces.push(Front {
                        a: add(a, scale(axis, lo)),
                        b: add(a, scale(axis, hi)),
                        ..f
                    });
                }
                end = end.max(hi);
            }
        }
        result.extend(merge(pieces));
    }
    #[cfg(test)]
    prepared_direction_tests::assert_legacy(shape,fronts,&result);
    result
}

#[cfg(test)]
#[path="contacts_prepared_direction_tests.rs"]
mod prepared_direction_tests;

#[derive(Clone, Copy)]
pub(in crate::urban) struct Front {
    pub(super) a: Point,
    pub(super) b: Point,
    pub(super) rank: usize,
    pub(super) street: usize,
    pub(super) shared: bool,
    pub(super) gate: bool,
}

pub(in crate::urban) struct FrontageIndex {
    cells: BTreeMap<(i32, i32), Vec<(usize, usize)>>,
}
impl FrontageIndex {
    pub(in crate::urban) fn new(layout: &Layout) -> Self {
        let mut cells: BTreeMap<(i32, i32), Vec<(usize, usize)>> = BTreeMap::new();
        for (si, s) in layout.streets.iter().enumerate() {
            if s.role == "track" && s.rank >= 4 { continue; }
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
pub(super) fn frontages(shape: &Shape, layout: &Layout, index: &FrontageIndex) -> Vec<Front> {
    street_contacts(shape, layout, index)
}
pub(in crate::urban) fn access_fronts(
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
pub(in crate::urban) fn network_contacts(
    shape: &Shape,
    layout: &Layout,
    index: &FrontageIndex,
) -> Vec<crate::urban::ParcelContact> {
    frontages(shape, layout, index)
        .into_iter()
        .map(|f| crate::urban::ParcelContact {
            a: f.a,
            b: f.b,
            street: f.street,
            rank: f.rank,
            length: length(sub(f.b, f.a)),
            kind: access_kind(&f, layout).into(),
        })
        .collect()
}

/// The wall walk (`wall-lane`, inside the curtain) is a street like another:
/// a block backed on the wall reaches the town by it, as its lots do.
pub(in crate::urban) fn block_contacts(shape: &Shape, layout: &Layout) -> Vec<crate::urban::ParcelContact> {
    block_contacts_indexed(shape, layout, &FrontageIndex::new(layout))
}
pub(in crate::urban) fn block_contacts_indexed(
    shape: &Shape,
    layout: &Layout,
    index: &FrontageIndex,
) -> Vec<crate::urban::ParcelContact> {
    network_contacts(shape, layout, index)
        .into_iter()
        .filter(|c| {
            !matches!(
                layout.streets[c.street].role.as_str(),
                "boundary" | "bridge"
            )
        })
        .collect()
}

pub(super) fn parcel_fronts(p: &Parcel) -> Vec<Front> {
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

/// Largest connected, gently curved projected frontage; disjoint fronts never add.
pub(in crate::urban) fn continuous_frontage(contacts: &[crate::urban::ParcelContact]) -> f64 {
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
            let (lo, hi) = support_span(&fronts, i);
            hi - lo
        })
        .fold(0.0, f64::max)
}

/// Count actual shared boundary rather than an inferred frontage chord.
pub(super) fn frontage(shape: &Shape, fronts: &[Front]) -> (f64, Option<Front>) {
    let contacts = boundary_contacts(shape, fronts);
    let total = contacts.iter().map(|f| length(sub(f.b, f.a))).sum();
    let best = contacts
        .into_iter()
        .max_by(|a, b| length(sub(a.b, a.a)).total_cmp(&length(sub(b.b, b.a))));
    (total, best)
}

/// Invariant (one street, one frontage): a street ribbon leaves, at every vertex
/// of its path, a jog of 5 to 80 cm in the block outline and specks of contact
/// with no direction of their own. For cutting a block neither ends a frontage:
/// a run cut there has its own depth draw, depth plane and lateral bound, so the
/// rear line steps every 12 m and the land left between the steps wraps around
/// the lots behind them (`RUN_GAP` covers 99.9 % of the jogs measured on 18
/// towns). A house reads its lot's own sides instead: `runs` keeps them apart.
const RUN_GAP: f64 = 1.5;
const RUN_SPECK: f64 = 0.05;

/// The straight sides of a lot's frontage, for the frame of its house.
pub(super) fn runs(fronts: &[Front]) -> Vec<Vec<Front>> {
    runs_within(fronts, 0.03, 0.0)
}

/// The frontages of a block, for its cuts.
pub(super) fn street_runs(fronts: &[Front]) -> Vec<Vec<Front>> {
    runs_within(fronts, RUN_GAP, RUN_SPECK)
}

fn runs_within(fronts: &[Front], gap: f64, speck: f64) -> Vec<Vec<Front>> {
    let mut result: Vec<Vec<Front>> = Vec::new();
    for f in fronts.iter().filter(|f| length(sub(f.b, f.a)) >= speck) {
        let joins = result.last().and_then(|r| r.last()).is_some_and(|old| {
            old.street == f.street
                && length(sub(old.b, f.a)) < gap
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
            && length(sub(a.b, b.a)) < gap
            && dot(unit(sub(a.b, a.a)), unit(sub(b.b, b.a))) > 20.0_f64.to_radians().cos()
        {
            let mut last = result.pop().unwrap();
            last.append(&mut result[0]);
            result[0] = last;
        }
    }
    // Invariant (a lot follows the street that serves it): the main run is the
    // best-ranked street among the runs that make a real front (at least
    // `DOMINANT_RUN` of the longest one); a short end on a major street never
    // turns the lot away from its long side.
    let span = |r: &Vec<Front>| r.iter().map(|f| length(sub(f.b, f.a))).sum::<f64>();
    let longest = result.iter().map(span).fold(0.0, f64::max);
    let minor = |r: &Vec<Front>| span(r) < DOMINANT_RUN * longest;
    result.sort_by(|a, b| {
        minor(a)
            .cmp(&minor(b))
            .then_with(|| {
                a.iter()
                    .map(|f| f.rank)
                    .min()
                    .cmp(&b.iter().map(|f| f.rank).min())
            })
            .then_with(|| span(b).total_cmp(&span(a)))
    });
    result
}
/// A frontage run shorter than this share of the longest run is only a short
/// end of the lot: it does not give the lot its orientation.
const DOMINANT_RUN: f64 = 0.35;

/// A frontage run cut at street bends, with the radial seams it shares with its
/// neighbours on the same curve (`dot(p - point, m) >= 0` after `start`,
/// `<= 0` before `end`), so lots stay normal to the local frontage.
pub(super) struct Bend {
    pub(super) fronts: Vec<Front>,
    pub(super) start: Option<(Point, Point)>,
    pub(super) end: Option<(Point, Point)>,
}

/// Split every run once it has turned by more than 45 degrees from its first
/// piece (and is at least 8 m long): one inward depth plane cannot serve a
/// longer curve. Straight runs are never split, whatever their segmentation.
pub(super) fn bend_runs(fronts: &[Front]) -> Vec<Bend> {
    let mut out = Vec::new();
    for run in street_runs(fronts) {
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

pub(super) fn access_kind(front: &Front, layout: &Layout) -> &'static str {
    if front.shared {
        return "collective";
    }
    match layout.streets[front.street].role.as_str() {
        "private" | "derb" | "hutong" | "roji" => "private",
        "collective" | "close" => "collective",
        _ => "public",
    }
}

#[cfg(test)]
mod index_tests {
    use super::*;
    use crate::urban::{Street, geometry::rectangle};
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
}
