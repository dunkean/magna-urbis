//! Frontage-strip territories, cutting and recutting along street runs.

use super::lot_envelopes;
use super::tidy;
use super::bisect::bisect;
use super::consolidation::merge_slivers;
use super::contacts::{Front, bend_runs, frontage};
use super::cut_geometry::{add, bounds, distance, dot, frame_direction, half, length, normal, scale, sub, unit};
use super::depth::maximum_plot_depth;
use super::identity::parcel;
use super::seams::joined;
use super::strip_placement::{Stations, balance, cut_directions, cut_strip, side_directions};
use super::wall_lots::morph_faces;
use crate::rng::Rng;
use crate::urban::{Morph, Parcel, Point, Shape};
use crate::urban::geometry::{area, difference};

#[allow(clippy::too_many_arguments)]
pub(super) fn ray_limit(
    shape: &Shape,
    p: Point,
    d: Point,
    fronts: &[Front],
    rank: usize,
    target: f64,
    row: f64,
) -> f64 {
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
    // Rank buys depth only up to the culture's wished lot depth: once half
    // the block already holds it, the two rows back to back share it evenly
    // instead of the main street taking an oversized lot.
    // Invariant (a row holds a house): two rows back to back each keep the depth
    // of the smallest house. Ground too shallow for two is one row of through
    // lots: two rows there are all refused, then repaired into odd shapes.
    far_rank.map_or(hit, |other| {
        if hit < 2.0 * row {
            return hit + 1.2;
        }
        ((hit * depth_share(rank, other)).min((0.5 * hit).max(target)) + 1.2)
            .min((hit - row).max(row))
    })
}

/// Invariant (back-to-back balance): the share of the depth between two
/// opposite fronts that the higher-ranked one claims. Rank buys depth, but at
/// most 55 % of it (85 % at first, about 6:1, then 60 %: main-street lots
/// still read oversized beside their back-lane neighbours), so two lots back
/// to back differ in depth by at most 11:9 plus the 1.2 m allowance.
fn depth_share(rank: usize, other: usize) -> f64 {
    (0.5 + 0.17 * (other as f64 - rank as f64)).clamp(0.5, MAX_DEPTH_SHARE)
}
pub(super) const MAX_DEPTH_SHARE: f64 = 0.55;

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

pub(super) fn strips(
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
    let floor = tidy::floor_of(morph);
    let row = morph.value["_witness"][1].as_f64().unwrap_or(0.0);
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
        // Depth counts from the street's mean line: on an oblique or curved
        // run one plane from its farthest point would deepen every other lot.
        let reach_of = |f: &Front| length(sub(f.b, f.a));
        let level = run
            .iter()
            .map(|f| reach_of(f) * dot(add(f.a, f.b), inward) * 0.5)
            .sum::<f64>()
            / run.iter().map(reach_of).sum::<f64>().max(1e-9);
        for f in &run {
            for p in [f.a, add(f.a, scale(sub(f.b, f.a), 0.5)), f.b] {
                frontage_level = frontage_level.min(dot(p, inward));
                let start = add(p, scale(inward, 0.05));
                let cap = ray_limit(shape, start, inward, fronts, f.rank, target, row);
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
                limit = limit.max(level + depth);
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
            // A front serves the land it faces: a long thin arm reached only
            // through its last lot stays available (next run, or rear land).
            for t in pieces {
                if frontage(&t, &run).0 >= 3.0 {
                    territories.push(tidy::without_arms(t, &run, floor));
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
            // on busy, high-rank frontage: a village street has no merchants.
            let merge = morph.number("wideLotChance").clamp(0.0, 1.0)
                * pressure
                * pressure
                * if rank <= 1 { 1.0 } else { 0.4 };
            // Lineages (`_lotSpread`, street villages): a few large compounds,
            // many medium, some small ones, never under the smallest house.
            let spread = morph.number("_lotSpread").clamp(0.0, 1.0);
            let smallest = morph.value["_witness"][0].as_f64().unwrap_or(0.0) * 1.1;
            while total < extent && widths.len() < 4096 {
                rhythm = (0.7 * rhythm + 0.3 * rr.range(0.8, 1.25)).clamp(0.8, 1.25);
                let mut w = (module * rhythm).max(lo);
                if merge > 0.0 && rr.chance(merge) {
                    w *= if rr.chance(0.3) { 3.0 } else { 2.0 };
                }
                if spread > 0.0 {
                    let u = rr.float();
                    w *= if u < 0.15 * spread {
                        rr.range(1.8, 2.8)
                    } else if u < 0.45 * spread {
                        rr.range(0.55, 0.8)
                    } else {
                        rr.range(1.0 - 0.25 * spread, 1.0 + 0.3 * spread)
                    };
                    w = w.max(smallest).max(3.6);
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
            // Fitted to the street, no lot falls under the frontage its smallest
            // house needs: it would fail its witness and be repaired by a merge.
            let house = morph.value["_witness"][0].as_f64().unwrap_or(0.0);
            while widths.len() > 1
                && widths.iter().copied().fold(f64::MAX, f64::min) * extent / total < house
            {
                total -= widths.pop().unwrap();
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
            let narrowest = (lo.min(extent / count as f64) * 0.75).max(house.min(extent / count as f64));
            let least = 0.55 * morph.range("houseArea", zone)[0].max(20.0);
            // The lot is judged as `qualify` will judge it: the same witness.
            let witness = morph.value["_witness"].as_array().map(|w| {
                let at = |i: usize| w[i].as_f64().unwrap_or(0.0);
                [at(0), at(1), at(2), at(3)]
            });
            let sound = |s: &Shape| {
                area(s) >= least
                    && tidy::oriented(s).0 >= 0.75 * lo
                    && tidy::pointed(s) >= SOUND_ANGLE
                    && tidy::solidity(s) >= floor
                    && frontage(s, fronts).0 >= 3.0
                    && witness.is_none_or(|[f, d, a, m]| {
                        area(s) >= m && lot_envelopes::envelope(s, fronts, f, d, a).is_some()
                    })
            };
            let mut best =
                cut_strip(&territory, &stations, &lots, &normal_cuts, narrowest, &sound);
            if let Some(sided) = side_directions(&territory, &stations, &nominal, cut_axis)
                && sided
                    .iter()
                    .zip(&normal_cuts)
                    .any(|(a, b)| dot(*a, *b) < 10.0_f64.to_radians().cos())
            {
                let other = cut_strip(&territory, &stations, &lots, &sided, narrowest, &sound);
                if balance(&other) < 0.85 * balance(&best) {
                    best = other;
                }
            }
            let depth = (limit - frontage_level).max(1.0);
            let drawn: Vec<(Shape, f64)> = best
                .into_iter()
                .map(|(piece, k, _)| {
                    let wished = lots[k.min(count - 1)] * depth;
                    (piece, wished)
                })
                .collect();
            for (piece, recut) in recut_unsound(drawn, &sound, &mut |ground, at| {
                let mut stream = rr.fork(&format!("recut:{at}"));
                bisect(ground, axis, fronts, morph, zone, &mut stream)
            }) {
                let mut lot = parcel(piece, block, axis, fronts, "plot");
                if recut {
                    lot.provenance.push("constrained-recut".into());
                }
                plots.push(lot);
            }
        }
    }
    for cell in available {
        plots.push(parcel(cell, block, axis, &[], "garden"));
    }
    merge_slivers(&mut plots, fronts, Some(maximum_depth), floor);
    plots
}

/// A lot corner sharper than this (radians) is a fan blade, as in `bisect`.
const SOUND_ANGLE: f64 = 0.35;
/// A lot over this multiple of the area it was drawn for is oversized.
const OVERSIZE: f64 = 1.5;

/// Invariant (constrained ground): a frontage cut cannot see the ground it cuts,
/// so on a narrow, triangular or curved territory some of its lots are unsound
/// before any repair. Each stretch of unsound lots, with one neighbour on each
/// side, is cut again by `bisect`, which judges every child before drawing it.
/// A lot holding far more ground than the frontage and depth it was drawn for
/// (a corner of the territory fell to it) counts as unsound too: constrained
/// ground never pays for its shape with bigger lots.
/// The new cut is kept only if it has as many lots, fewer of them unsound, and
/// leaves no lot under a third of the largest around it.
/// Sound stretches keep the culture's frontage rhythm. `drawn` follow the street
/// with the area each was drawn for.
fn recut_unsound(
    drawn: Vec<(Shape, f64)>,
    sound: &dyn Fn(&Shape) -> bool,
    cut: &mut dyn FnMut(&Shape, usize) -> Vec<Shape>,
) -> Vec<(Shape, bool)> {
    let good: Vec<bool> = drawn
        .iter()
        .map(|(s, wished)| sound(s) && area(s) <= OVERSIZE * wished)
        .collect();
    let lots: Vec<Shape> = drawn.into_iter().map(|(s, _)| s).collect();
    let mut out: Vec<(Shape, bool)> = Vec::with_capacity(lots.len());
    let mut i = 0;
    while i < lots.len() {
        if good[i] {
            out.push((lots[i].clone(), false));
            i += 1;
            continue;
        }
        let mut j = i;
        while j + 1 < lots.len() && !good[j + 1] {
            j += 1;
        }
        // The neighbour before is the last lot kept, unless it was recut.
        let before = i > 0 && out.last().is_some_and(|l| !l.1);
        let first = if before { i - 1 } else { i };
        let last = (j + 1).min(lots.len() - 1);
        let ground = lots[first + 1..=last]
            .iter()
            .try_fold(lots[first].clone(), |u, s| joined(&u, s));
        let fresh = ground
            .filter(|g| g.holes.is_empty())
            .map(|g| cut(&g, i))
            .filter(|new| {
                let count = last - first + 1;
                let old = good[first..=last].iter().filter(|g| !**g).count();
                // No new small lot beside a big one (the 3x of `balance_neighbours`).
                let around = lots[first.saturating_sub(1)..=(last + 1).min(lots.len() - 1)]
                    .iter()
                    .chain(new.iter())
                    .map(area)
                    .fold(0.0, f64::max);
                let smallest = new.iter().map(area).fold(f64::INFINITY, f64::min);
                new.len() >= count
                    && around < 3.0 * smallest
                    && new.iter().filter(|s| !sound(s)).count() < old
            });
        match fresh {
            Some(new) => {
                if before {
                    out.pop();
                }
                out.extend(new.into_iter().map(|s| (s, true)));
                i = last + 1;
            }
            None => {
                out.extend(lots[i..=j].iter().map(|s| (s.clone(), false)));
                i = j + 1;
            }
        }
    }
    out
}
