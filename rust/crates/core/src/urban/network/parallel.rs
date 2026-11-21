//! Detect doubled parallel streets and transfer their junctions to the survivor.

use super::junctions::planarize;
use super::site_options::different_level;
use super::spatial::{BoxGrid, EPS, Key, distance, key, lerp, segment_box};
use super::street::{protected, width};
use crate::urban::{Enclosure, Point, Street, Surface};
use std::collections::{BTreeMap, BTreeSet};

/// Narrowest land between two parallel streets that still holds a lot (m).
pub(in crate::urban) const MIN_LAND: f64 = 4.0;
/// Invariant (no sliver between two streets): a street running within
/// `MIN_LAND` of the ribbon of a more important one along at least 90 % of
/// its length leaves between them a strip too thin for any lot; it doubles
/// that street and is removed (`shadowed_copies`, with the strip counted as
/// shared land), its junctions carried onto the survivor. A curtain between
/// the two keeps both: each serves its own side of the wall. Returns whether
/// a street went (the network is then planarized again).
pub(super) fn drop_narrow_doubles(
    streets: &mut Vec<Street>,
    enclosures: &[Enclosure],
    radius: f64,
) -> bool {
    let walls: Vec<(Point, Point)> = enclosures
        .iter()
        .flat_map(|e| e.path.windows(2).map(|w| (w[0], w[1])))
        .collect();
    let before = streets.len();
    drop_shadowed_within(streets, MIN_LAND, &walls, None);
    let changed = streets.len() < before;
    if changed {
        planarize(streets, radius);
    }
    changed
}
/// Invariant (no doubled corridor): a street whose ribbon overlaps the ribbon
/// of a more important one (lower rank, else wider, else earlier) along at
/// least 90 % of its length leaves no land between them: it is a copy of that
/// corridor, not a second road, and is removed. Protected roads are never
/// removed. Sampling is every 2 m against a 32 m bucket grid of segments.
/// Samples within `gap` of the dominating ribbon count as covered when no
/// `walls` segment runs between them. Returns each copy with the street that
/// survives it; streets that met a copy elsewhere than on its survivor are
/// carried onto the survivor's centreline (within its ribbon plus their own
/// width) by the caller, so the network keeps every junction.
pub(super) fn shadowed_copies(streets: &[Street], gap: f64, walls: &[(Point, Point)], surface: Option<Surface<'_>>) -> Vec<(usize, usize)> {
    const CELL: f64 = 32.0;
    let rank_key = |i: usize, s: &Street| {
        let w = s.widths.iter().copied().fold(0.0_f64, f64::max);
        (s.rank, std::cmp::Reverse((w * 1000.0).round() as i64), i)
    };
    let mut buckets: std::collections::HashMap<(i64, i64), Vec<(usize, usize)>> = Default::default();
    for (i, s) in streets.iter().enumerate() {
        for (k, w) in s.path.windows(2).enumerate() {
            let pad = width(s, k).max(width(s, k + 1)) * 0.5 + 10.0;
            let (x0, x1) = (w[0].x.min(w[1].x) - pad, w[0].x.max(w[1].x) + pad);
            let (y0, y1) = (w[0].y.min(w[1].y) - pad, w[0].y.max(w[1].y) + pad);
            for bx in (x0 / CELL).floor() as i64..=(x1 / CELL).floor() as i64 {
                for by in (y0 / CELL).floor() as i64..=(y1 / CELL).floor() as i64 {
                    buckets.entry((bx, by)).or_default().push((i, k));
                }
            }
        }
    }
    // Walls by their box: a sample's link to its dominating ribbon can only
    // cross a wall whose box meets the link (a metre of slack for the
    // tolerance of `segment_hit`).
    let wall_grid = BoxGrid::new(&walls.iter().map(|&(a, b)| segment_box(a, b, 0.0)).collect::<Vec<_>>(), CELL);
    let wall_between = |p: Point, q: Point| {
        let (x0, y0, x1, y1) = segment_box(p, q, 1.0);
        wall_grid.query(x0, y0, x1, y1).into_iter().any(|k| crate::urban::geometry::segment_hit(p, q, walls[k].0, walls[k].1).is_some())
    };
    // Streets are not mutated while shadows are searched: rank every one once.
    let keys: Vec<_> = streets.iter().enumerate().map(|(i, s)| rank_key(i, s)).collect();
    let mut order: Vec<usize> = (0..streets.len()).collect();
    order.sort_by_key(|&i| std::cmp::Reverse(keys[i]));
    let mut removed = vec![false; streets.len()];
    // `hit_by[j] == sample`: street `j` already covers the sample being tested.
    let mut hit_by = vec![0usize; streets.len()];
    let mut sample = 0usize;
    // (removed street, survivor)
    let mut replaced: Vec<(usize, usize)> = vec![];
    for &i in &order {
        let s = &streets[i];
        if protected(s) || s.path.len() < 2 {
            continue;
        }
        let length: f64 = s.path.windows(2).map(|w| distance(w[0], w[1])).sum();
        if length < 8.0 {
            continue;
        }
        let mine = keys[i];
        // Coverage by each dominating street, sampled along the path.
        let mut covered: BTreeMap<usize, f64> = BTreeMap::new();
        let mut hit: Vec<usize> = Vec::new();
        let mut total = 0.0;
        for (m, w) in s.path.windows(2).enumerate() {
            let own = width(s, m).min(width(s, m + 1));
            let l = distance(w[0], w[1]);
            let n = (l / 2.0).ceil().max(1.0) as usize;
            for k in 0..n {
                let p = lerp(w[0], w[1], (k as f64 + 0.5) / n as f64);
                let step = l / n as f64;
                total += step;
                let cell = ((p.x / CELL).floor() as i64, (p.y / CELL).floor() as i64);
                hit.clear();
                sample += 1;
                for &(j, seg) in buckets.get(&cell).into_iter().flatten() {
                    if j == i || removed[j] || hit_by[j] == sample {
                        continue;
                    }
                    let t = &streets[j];
                    if keys[j] >= mine {
                        continue;
                    }
                    // Ribbons that overlap leave no land between them.
                    let half = 0.5 * width(t, seg).max(width(t, seg + 1)) + 0.5 * own;
                    let (d, _, q) = crate::urban::geometry::distance(p, t.path[seg], t.path[seg + 1]);
                    // Out of reach first: the terrain probe only where it decides.
                    if !(d <= half + gap) || surface.is_some_and(|s| different_level(s, p, q)) { continue; }
                    if d <= half
                        || d <= half + gap
                            && !wall_between(p, q)
                    {
                        hit.push(j);
                        hit_by[j] = sample;
                    }
                }
                for &j in &hit {
                    *covered.entry(j).or_default() += step;
                }
            }
        }
        if let Some((&j, _)) = covered
            .iter()
            .filter(|&(_, &c)| c >= 0.9 * total)
            .min_by_key(|&(&j, _)| keys[j])
        {
            removed[i] = true;
            replaced.push((i, j));
        }
    }
    replaced
}
/// Removes the shadowed copies (`shadowed_copies`) and carries the streets
/// that ended on one onto its survivor.
pub(super) fn drop_shadowed_within(streets: &mut Vec<Street>, gap: f64, walls: &[(Point, Point)], surface: Option<Surface<'_>>) {
    let replaced = shadowed_copies(streets, gap, walls, surface);
    if replaced.is_empty() {
        return;
    }
    let mut removed = vec![false; streets.len()];
    for &(i, _) in &replaced {
        removed[i] = true;
    }
    // Reattach streets that ended on a removed copy (endpoint index, so the
    // pass is linear in the removed copies' vertices).
    let mut ends: BTreeMap<Key, Vec<(usize, bool)>> = BTreeMap::new();
    for (u, s) in streets.iter().enumerate() {
        if !removed[u] && s.path.len() >= 2 {
            ends.entry(key(s.path[0])).or_default().push((u, false));
            ends.entry(key(*s.path.last().unwrap()))
                .or_default()
                .push((u, true));
        }
    }
    for &(i, j) in &replaced {
        let survivor: BTreeSet<Key> = streets[j].path.iter().map(|&p| key(p)).collect();
        let copy: BTreeSet<Key> = streets[i].path.iter().map(|&p| key(p)).collect();
        for c in copy {
            if survivor.contains(&c) {
                continue;
            }
            for &(u, last) in ends.get(&c).into_iter().flatten() {
                if u == j {
                    continue;
                }
                let idx = if last { streets[u].path.len() - 1 } else { 0 };
                let p = streets[u].path[idx];
                let t = &streets[j];
                let Some((d, q, w)) = t
                    .path
                    .windows(2)
                    .enumerate()
                    .map(|(k, w)| {
                        let (d, _, q) = crate::urban::geometry::distance(p, w[0], w[1]);
                        (d, q, width(t, k).max(width(t, k + 1)))
                    })
                    .min_by(|a, b| a.0.total_cmp(&b.0))
                else {
                    continue;
                };
                if d < EPS || d > 0.5 * w + width(&streets[u], idx) + if surface.is_some() { gap } else { 0.0 }
                    || surface.is_some_and(|s| different_level(s, p, q)) {
                    continue;
                }
                let s = &mut streets[u];
                let wu = width(s, idx);
                if last {
                    s.path.push(q);
                    s.widths.push(wu);
                } else {
                    s.path.insert(0, q);
                    s.widths.insert(0, wu);
                }
            }
        }
    }
    let mut k = 0;
    streets.retain(|_| {
        k += 1;
        !removed[k - 1]
    });
}
