//! Measure curtain runs and joins between shore and water passages.

use crate::urban::{Gatehouse, Point, geometry as g};
use super::build::BuildContext;
use super::geometry::{add, dir, dist, turn_at};

/// Locate points and distances along a closed curtain.
pub(super) struct WallWalk<'a> {
    path: &'a [Point],
    cum: Vec<f64>,
    pub(super) total: f64,
}

impl<'a> WallWalk<'a> {
    pub(super) fn new(path: &'a [Point]) -> Self {
        let n_seg = path.len() - 1;
        let cum: Vec<f64> = std::iter::once(0.0).chain((0..n_seg).scan(0.0, |acc, i| { *acc += dist(path[i], path[i + 1]); Some(*acc) })).collect();
        let total = cum[n_seg].max(1e-9);
        Self { path, cum, total }
    }

    pub(super) fn segment_of(&self, p: Point) -> usize {
        let path = self.path;
        let n_seg = path.len() - 1;
        (0..n_seg)
            .min_by(|&a, &b| {
                g::distance(p, path[a], path[a + 1])
                    .0
                    .total_cmp(&g::distance(p, path[b], path[b + 1]).0)
            })
            .unwrap_or(0)
    }

    pub(super) fn arc(&self, p: Point) -> f64 {
        let k = self.segment_of(p);
        self.cum[k] + dist(self.path[k], p).min(dist(self.path[k], self.path[k + 1]))
    }

    pub(super) fn along(&self, s: f64) -> (Point, usize) {
        let Self { path, cum, total } = self;
        let n_seg = path.len() - 1;
        let s = s.rem_euclid(*total);
        let k = (0..n_seg).find(|&k| cum[k + 1] >= s).unwrap_or(n_seg - 1);
        (add(path[k], dir(path[k], path[k + 1]), s - cum[k]), k)
    }
}

/// Each entry immediately followed by an exit, including across the seam of a closed curtain.
pub(super) fn water_passages(banks: &[(Point, bool)]) -> impl Iterator<Item = (Point, Point)> + '_ {
    banks.iter().zip(banks.iter().cycle().skip(1))
        .filter_map(|(a, b)| (a.1 && !b.1).then_some((a.0, b.0)))
}

pub(super) fn merge_shore_passages(ctx: &BuildContext<'_>, walk: &WallWalk<'_>, banks: &[(Point, bool)]) -> Vec<(Point, bool)> {
    let &BuildContext { path, n_seg, ring, ns, street_lines, surface, style, .. } = ctx;
    let WallWalk { cum, total, .. } = walk;
    let total = *total;
    let arc = |p| walk.arc(p);
    let along = |s| walk.along(s);
    // Water runs that the curtain leaves only briefly (a spit, under 40 m) or
    // along a dry run that just hugs the shore with nothing built behind it
    // open as one passage: no stub of wall, tower or moat between them.
    let hugs = |q: Point, k: usize| [3.0, 6.0, 10.0].iter().any(|&d| surface.wet(add(q, ns[k], d)));
    // A cave circuit keeps every rock contact: its short barriers between the rock are the curtain.
    if style.cave { banks.to_vec() } else {
        let mut b: Vec<(Point, bool)> = banks.to_vec();
        // At a bank, the passage starts where the curtain stops
        // hugging the shore, when that run is short or has nothing behind it.
        let m = b.len();
        if m >= 2 {
            let arcs: Vec<f64> = b.iter().map(|x| arc(x.0)).collect();
            // Dry run length on each bank's land side, and how far it hugs.
            let side = |k: usize| if b[k].1 { (arcs[k] - arcs[(k + m - 1) % m]).rem_euclid(total) } else { (arcs[(k + 1) % m] - arcs[k]).rem_euclid(total) };
            let walk: Vec<f64> = (0..m).map(|k| {
                let sign = if b[k].1 { -1.0 } else { 1.0 };
                let (mut h, mut open) = (0.0, true);
                while h + 4.0 < side(k).min(200.0) {
                    let (q, j) = along(arcs[k] + sign * (h + 4.0));
                    if !hugs(q, j) || surface.wet(q) { break; }
                    open &= !street_lines.iter().any(|&(u, v)| g::distance(q, u, v).0 < 25.0);
                    h += 4.0;
                }
                if h >= 4.0 && (h < 40.0 || open) { h } else { 0.0 }
            }).collect();
            // A jog: past its last corner the curtain turns (over ~60°) and
            // runs on along the water, ending under 40 m from that corner. It
            // guards nothing; the curtain ends at the corner.
            let shore_near = |q: Point| (0..8).any(|a| {
                let t = f64::from(a) * std::f64::consts::FRAC_PI_4;
                [3.0, 6.0, 10.0].iter().any(|&d| surface.wet(add(q, (t.cos(), t.sin()), d)))
            });
            let walk: Vec<f64> = (0..m).map(|k| {
                let back = |s: f64| if b[k].1 { arcs[k] - s } else { arcs[k] + s };
                // The farthest such corner on the land side, the whole run by the water.
                let corner = (0..n_seg).filter_map(|v| {
                    let d = if b[k].1 { (arcs[k] - cum[v]).rem_euclid(total) } else { (cum[v] - arcs[k]).rem_euclid(total) };
                    if !(4.0..80.0).contains(&d) || dist(path[v], b[k].0) >= 40.0 || d >= side(k) - 4.0
                        || turn_at(ring, v) <= 1.05 { return None; }
                    let steps = (d / 4.0).ceil() as usize;
                    (0..=steps).all(|i| shore_near(along(back(d * i as f64 / steps as f64)).0)).then_some(d)
                }).fold(0.0, f64::max);
                walk[k].max(corner)
            }).collect();
            // A run hugged from both ends is one passage: its two banks go.
            let mut gone = vec![false; m];
            for k in (0..m).filter(|&k| !b[k].1) {
                let j = (k + 1) % m;
                if b[j].1 && walk[k] + walk[j] >= side(k) - 4.0 { gone[k] = true; gone[j] = true; }
            }
            let moved: Vec<(Point, bool)> = (0..m).filter(|&k| !gone[k]).map(|k| {
                (if walk[k] > 0.0 { along(arcs[k] + if b[k].1 { -walk[k] } else { walk[k] }).0 } else { b[k].0 }, b[k].1)
            }).collect();
            if moved.iter().any(|x| x.1) && moved.iter().any(|x| !x.1) { b = moved; }
        }
        loop {
            let m = b.len();
            if m < 4 { break; }
            let cut = (0..m).find(|&k| {
                let (x, y) = (b[k], b[(k + 1) % m]);
                if x.1 || !y.1 { return false; }
                let (s0, len) = (arc(x.0), (arc(y.0) - arc(x.0)).rem_euclid(total));
                if len < 40.0 { return true; }
                let n = (len / 4.0).ceil() as usize;
                (0..=n).all(|i| {
                    let (q, k) = along(s0 + len * i as f64 / n as f64);
                    hugs(q, k)
                        && !street_lines.iter().any(|&(u, v)| g::distance(q, u, v).0 < 25.0)
                })
            });
            let Some(k) = cut else { break; };
            let j = (k + 1) % m;
            b = b.into_iter().enumerate().filter(|&(i, _)| i != k && i != j).map(|(_, v)| v).collect();
        }
        b
    }
}

pub(super) fn shore_gaps(walk: &WallWalk<'_>, gatehouses: &[Gatehouse]) -> Vec<(f64, f64)> {
    gatehouses.iter().filter(|gh| gh.kind == "shore")
        .map(|gh| (walk.arc(gh.passage[0]), (walk.arc(gh.passage[1]) - walk.arc(gh.passage[0])).rem_euclid(walk.total))).collect()
}
