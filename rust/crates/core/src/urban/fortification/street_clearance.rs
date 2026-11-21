//! Index curtain segments and build street ribbons for clearance and causeways.

use crate::urban::{Point, Shape, Street, geometry as g, par};
use super::geometry::dist;

/// Uniform grid of curtain segments, for "is this street segment near the wall".
pub(in super::super) struct Near {
    cell: f64,
    cells: std::collections::HashMap<(i64, i64), Vec<usize>>,
    segs: Vec<(Point, Point)>,
}
impl Near {
    pub(in super::super) fn new(path: &[Point], cell: f64) -> Self {
        let mut cells: std::collections::HashMap<(i64, i64), Vec<usize>> = Default::default();
        let segs: Vec<(Point, Point)> = path.windows(2).map(|w| (w[0], w[1])).collect();
        for (i, &(a, b)) in segs.iter().enumerate() {
            let k = (dist(a, b) / cell).ceil().max(1.0) as usize;
            for j in 0..=k {
                let t = j as f64 / k as f64;
                let key = (
                    ((a.x + (b.x - a.x) * t) / cell).floor() as i64,
                    ((a.y + (b.y - a.y) * t) / cell).floor() as i64,
                );
                let v = cells.entry(key).or_default();
                if v.last() != Some(&i) {
                    v.push(i);
                }
            }
        }
        Near { cell, cells, segs }
    }
    /// Curtain segments in the cells segment ab passes (candidates for a
    /// crossing), in index order.
    pub(in super::super) fn crossed(&self, a: Point, b: Point) -> Vec<usize> {
        let k = (dist(a, b) / self.cell).ceil().max(1.0) as usize;
        let mut seen = Vec::new();
        for j in 0..=k {
            let t = j as f64 / k as f64;
            let (cx, cy) = (
                ((a.x + (b.x - a.x) * t) / self.cell).floor() as i64,
                ((a.y + (b.y - a.y) * t) / self.cell).floor() as i64,
            );
            for dx in -1..=1 {
                for dy in -1..=1 {
                    seen.extend(self.cells.get(&(cx + dx, cy + dy)).into_iter().flatten());
                }
            }
        }
        seen.sort_unstable();
        seen.dedup();
        seen
    }
    /// Distance from segment ab to the curtain (0 when it crosses it), or
    /// infinity beyond `cell`.
    pub(in super::super) fn distance(&self, a: Point, b: Point) -> f64 {
        let mut best = f64::INFINITY;
        let k = (dist(a, b) / self.cell).ceil().max(1.0) as usize;
        let mut seen: Vec<usize> = Vec::new();
        for j in 0..=k {
            let t = j as f64 / k as f64;
            let (cx, cy) = (
                ((a.x + (b.x - a.x) * t) / self.cell).floor() as i64,
                ((a.y + (b.y - a.y) * t) / self.cell).floor() as i64,
            );
            for dx in -1..=1 {
                for dy in -1..=1 {
                    for &s in self.cells.get(&(cx + dx, cy + dy)).into_iter().flatten() {
                        if seen.contains(&s) {
                            continue;
                        }
                        seen.push(s);
                        let (c, d) = self.segs[s];
                        let d = if g::segment_hit(a, b, c, d).is_some() {
                            0.0
                        } else {
                            g::distance(a, c, d)
                                .0
                                .min(g::distance(b, c, d).0)
                                .min(g::distance(c, a, b).0)
                                .min(g::distance(d, a, b).0)
                        };
                        if d < self.cell {
                            best = best.min(d);
                        }
                    }
                }
            }
        }
        best
    }
}

/// Width a street will have once the network hierarchy has re-ranked it
/// (`network::hierarchy` widens through routes after this stage): a street
/// crossing the curtain becomes an arterial gate street.
pub(super) fn final_width(s: &Street, i: usize, crossing: bool, predicted: &Predicted) -> f64 {
    let w = s.widths.get(i).or(s.widths.first()).copied().unwrap_or(4.0);
    if !matches!(
        s.role.as_str(),
        "street" | "lane" | "radial" | "ring" | "market" | "gate-street" | "processional"
    ) {
        return w;
    }
    let rank = if crossing {
        s.rank.min(predicted.arterial)
    } else {
        s.rank
    };
    w.max(predicted.widths[rank.min(4)])
}
/// Rank widths the later hierarchy applies (`network::rank_widths` × the
/// gate-street factor) and the arterial rank for this population.
#[derive(Clone, Copy)]
pub(in super::super) struct Predicted {
    pub widths: [f64; 5],
    pub arterial: usize,
    /// Smallest dwelling lot the culture admits (frontage, depth, m): a
    /// faubourg lean-to is laid at least this size, so it can be built.
    pub dwelling: [f64; 2],
}
/// Street centre segments within `reach` of the curtain (wall-lanes aside).
pub(super) fn street_segments(path: &[Point], streets: &[Street], reach: f64) -> Vec<(Point, Point)> {
    let near = Near::new(path, reach);
    streets
        .iter()
        .filter(|s| s.role != "wall-lane")
        .flat_map(|s| s.path.windows(2).map(|w| (w[0], w[1])))
        .filter(|&(a, b)| near.distance(a, b).is_finite())
        .collect()
}

/// Street ribbons (+1 m) within `reach` of the curtain.
pub(super) fn street_clear(
    path: &[Point],
    streets: &[Street],
    reach: f64,
    predicted: &Predicted,
) -> Vec<Shape> {
    let near = Near::new(path, reach);
    let runs: Vec<(Vec<Point>, Vec<f64>)> = streets
        .iter()
        .filter(|s| s.role != "wall-lane")
        .flat_map(|s| {
            let mut runs = vec![];
            let (mut pts, mut ws): (Vec<Point>, Vec<f64>) = (vec![], vec![]);
            let crossing = s.path.windows(2).any(|w| near.distance(w[0], w[1]) == 0.0);
            let w = |i: usize| final_width(s, i, crossing, predicted) + 1.0;
            for i in 0..s.path.len().saturating_sub(1) {
                if near.distance(s.path[i], s.path[i + 1]).is_finite() {
                    if pts.is_empty() {
                        pts.push(s.path[i]);
                        ws.push(w(i));
                    }
                    pts.push(s.path[i + 1]);
                    ws.push(w(i + 1));
                } else if !pts.is_empty() {
                    runs.push((std::mem::take(&mut pts), std::mem::take(&mut ws)));
                }
            }
            if pts.len() >= 2 {
                runs.push((pts, ws));
            }
            runs
        })
        .collect();
    par::map(&runs, |_, (p, w)| g::ribbon(p, w))
        .into_iter()
        .flatten()
        .collect()
}

/// Ribbons (`width(street, vertex)`) of the street runs within `reach` of the
/// closed `path`, leaving out the segments inside `inner` whose ribbon cannot
/// reach the curtain.
pub(super) fn near_ribbons(
    path: &[Point],
    streets: &[&Street],
    reach: f64,
    inner: &Shape,
    width: impl Fn(&Street, usize, bool) -> f64 + Sync,
) -> Vec<Shape> {
    let near = Near::new(path, reach);
    let wanted = |s: &Street, i: usize| {
        let d = near.distance(s.path[i], s.path[i + 1]);
        d.is_finite()
            && (d <= width(s, i, false).max(width(s, i + 1, false)) * 0.5 + 1.0
                || !g::contains(inner, s.path[i])
                || !g::contains(inner, s.path[i + 1]))
    };
    let runs: Vec<(Vec<Point>, Vec<f64>)> = streets
        .iter()
        .flat_map(|s| {
            let mut runs = vec![];
            let (mut pts, mut ws): (Vec<Point>, Vec<f64>) = (vec![], vec![]);
            let crossing = s.path.windows(2).any(|w| near.distance(w[0], w[1]) == 0.0);
            for i in 0..s.path.len().saturating_sub(1) {
                if wanted(s, i) {
                    if pts.is_empty() {
                        pts.push(s.path[i]);
                        ws.push(width(s, i, crossing));
                    }
                    pts.push(s.path[i + 1]);
                    ws.push(width(s, i + 1, crossing));
                } else if !pts.is_empty() {
                    runs.push((std::mem::take(&mut pts), std::mem::take(&mut ws)));
                }
            }
            if pts.len() >= 2 {
                runs.push((pts, ws));
            }
            runs
        })
        .collect();
    par::map(&runs, |_, (p, w)| g::ribbon(p, w))
        .into_iter()
        .flatten()
        .collect()
}
