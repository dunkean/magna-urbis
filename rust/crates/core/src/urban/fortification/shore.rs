//! Measure curtain runs and pair the banks of water passages.

use crate::urban::{Gatehouse, Point, geometry as g};
use super::geometry::{add, dir, dist};

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

/// The rock faces a cave circuit leaves open, as (arc, length) along the curtain.
pub(super) fn shore_gaps(walk: &WallWalk<'_>, gatehouses: &[Gatehouse]) -> Vec<(f64, f64)> {
    gatehouses.iter().filter(|gh| gh.kind == "shore")
        .map(|gh| (walk.arc(gh.passage[0]), (walk.arc(gh.passage[1]) - walk.arc(gh.passage[0])).rem_euclid(walk.total))).collect()
}
