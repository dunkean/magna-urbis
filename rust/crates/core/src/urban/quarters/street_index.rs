//! Incremental street segment bins and regional orientation queries.

use crate::urban::{Point, Street, geometry as g};

/// Uniform segment bins over the growing street list. Streets are only appended
/// while quarters are cut, so `sync` indexes the new tail incrementally. Queries
/// return exactly what a linear scan within the same reach returns.
pub(super) struct Bins {
    cell: f64,
    max_rank: usize,
    map: std::collections::HashMap<(i64, i64), Vec<(u32, u32)>>,
    indexed: usize,
}
impl Bins {
    /// Index only streets of rank <= `max_rank` (arterial queries stay cheap).
    pub(super) fn new(cell: f64, max_rank: usize) -> Self {
        Self {
            cell,
            max_rank,
            map: std::collections::HashMap::new(),
            indexed: 0,
        }
    }
    fn cells(&self, a: Point, b: Point, pad: f64) -> impl Iterator<Item = (i64, i64)> + use<> {
        let c = self.cell;
        let (x0, x1) = (
            ((a.x.min(b.x) - pad) / c).floor() as i64,
            ((a.x.max(b.x) + pad) / c).floor() as i64,
        );
        let (y0, y1) = (
            ((a.y.min(b.y) - pad) / c).floor() as i64,
            ((a.y.max(b.y) + pad) / c).floor() as i64,
        );
        (y0..=y1).flat_map(move |y| (x0..=x1).map(move |x| (x, y)))
    }
    pub(super) fn sync(&mut self, streets: &[Street]) {
        if streets.len() < self.indexed {
            self.map.clear();
            self.indexed = 0;
        }
        for (i, s) in streets.iter().enumerate().skip(self.indexed) {
            if s.rank > self.max_rank {
                continue;
            }
            for (j, w) in s.path.windows(2).enumerate() {
                for cell in self.cells(w[0], w[1], 0.0) {
                    self.map.entry(cell).or_default().push((i as u32, j as u32));
                }
            }
        }
        self.indexed = streets.len();
    }
    pub(super) fn around(&self, p: Point, reach: f64) -> impl Iterator<Item = (usize, usize)> + '_ {
        self.cells(p, p, reach)
            .filter_map(|cell| self.map.get(&cell))
            .flatten()
            .map(|&(i, j)| (i as usize, j as usize))
    }
    /// Nearest segment of rank <= `max_rank` within `reach`: distance and heading.
    pub(super) fn nearest(
        &self,
        p: Point,
        streets: &[Street],
        max_rank: usize,
        reach: f64,
    ) -> Option<(f64, f64)> {
        let mut best = (reach, None);
        for (i, j) in self.around(p, reach) {
            let s = &streets[i];
            if s.rank > max_rank {
                continue;
            }
            let (a, b) = (s.path[j], s.path[j + 1]);
            let d = g::distance(p, a, b).0;
            if d < best.0 || best.1.is_none() && d <= reach {
                best = (d, Some((b.y - a.y).atan2(b.x - a.x)));
            }
        }
        best.1.map(|angle| (best.0, angle))
    }
    /// Whether the open polyline crosses any indexed street.
    pub(super) fn crosses(&self, path: &[Point], streets: &[Street]) -> bool {
        path.windows(2).any(|cut| {
            self.cells(cut[0], cut[1], 0.0)
                .filter_map(|cell| self.map.get(&cell))
                .flatten()
                .any(|&(i, j)| {
                    let s = &streets[i as usize];
                    let j = j as usize;
                    g::segment_hit(cut[0], cut[1], s.path[j], s.path[j + 1]).is_some()
                })
        })
    }
}

/// `macroplan::regional_axis` over binned segments: only the segments within
/// `reach` contribute to a road's score, so visiting the 3x3 cells of size
/// `reach` around a point gives the same choice without scanning whole roads.
/// The answer is the tangent of a road segment, already piecewise constant, so
/// it is memoised per small cell (reach/50, 10-40 m) during tracing.
pub(super) struct RegionalIndex<'a> {
    roads: &'a [Street],
    reach: f64,
    map: std::collections::HashMap<(i64, i64), Vec<(u32, u32)>>,
    memo: std::sync::Mutex<std::collections::HashMap<(i64, i64), Option<f64>>>,
}
impl<'a> RegionalIndex<'a> {
    pub(super) fn new(roads: &'a [Street], reach: f64) -> Self {
        let reach = reach.max(1.0);
        let mut map: std::collections::HashMap<(i64, i64), Vec<(u32, u32)>> = Default::default();
        for (i, s) in roads.iter().enumerate() {
            if !matches!(
                s.role.as_str(),
                "regional" | "bridge" | "ford" | "causeway" | "approach"
            ) {
                continue;
            }
            for (j, w) in s.path.windows(2).enumerate() {
                let (x0, x1) = (
                    (w[0].x.min(w[1].x) / reach).floor() as i64,
                    (w[0].x.max(w[1].x) / reach).floor() as i64,
                );
                let (y0, y1) = (
                    (w[0].y.min(w[1].y) / reach).floor() as i64,
                    (w[0].y.max(w[1].y) / reach).floor() as i64,
                );
                for y in y0..=y1 {
                    for x in x0..=x1 {
                        map.entry((x, y)).or_default().push((i as u32, j as u32));
                    }
                }
            }
        }
        Self {
            roads,
            reach,
            map,
            memo: Default::default(),
        }
    }
    pub(super) fn axis(&self, p: Point) -> Option<f64> {
        let step = (self.reach / 50.0).clamp(10.0, 40.0);
        let key = ((p.x / step).floor() as i64, (p.y / step).floor() as i64);
        if let Some(&v) = self.memo.lock().unwrap().get(&key) {
            return v;
        }
        let centre = Point {
            x: (key.0 as f64 + 0.5) * step,
            y: (key.1 as f64 + 0.5) * step,
        };
        let v = self.exact(centre);
        self.memo.lock().unwrap().insert(key, v);
        v
    }
    fn exact(&self, p: Point) -> Option<f64> {
        let reach = self.reach;
        let (cx, cy) = ((p.x / reach).floor() as i64, (p.y / reach).floor() as i64);
        let mut segments: Vec<(u32, u32)> = vec![];
        for y in cy - 1..=cy + 1 {
            for x in cx - 1..=cx + 1 {
                if let Some(v) = self.map.get(&(x, y)) {
                    segments.extend(v);
                }
            }
        }
        segments.sort_unstable();
        segments.dedup();
        // (rank, score, index, nearest distance, angle) per road, in road order.
        let mut best: Option<(usize, f64, usize, f64)> = None;
        let mut current: Option<(usize, f64, f64, f64)> = None;
        let finish = |c: Option<(usize, f64, f64, f64)>,
                      best: &mut Option<(usize, f64, usize, f64)>| {
            if let Some((i, score, _, angle)) = c {
                let rank = self.roads[i].rank;
                let better = best.is_none_or(|(r, s, b, _)| {
                    rank.cmp(&r)
                        .then_with(|| s.total_cmp(&score))
                        .then_with(|| i.cmp(&b))
                        .is_lt()
                });
                if better {
                    *best = Some((rank, score, i, angle));
                }
            }
        };
        for (i, j) in segments {
            let (i, j) = (i as usize, j as usize);
            let s = &self.roads[i];
            let pair = [s.path[j], s.path[j + 1]];
            let length = (pair[0].x - pair[1].x).hypot(pair[0].y - pair[1].y);
            let (d, _, _) = g::distance(p, pair[0], pair[1]);
            if length <= 1e-6 || d > reach {
                continue;
            }
            if current.is_some_and(|c| c.0 != i) {
                finish(current.take(), &mut best);
            }
            let width = s
                .widths
                .get(j)
                .copied()
                .or_else(|| s.widths.last().copied())
                .unwrap_or(4.0);
            let gain = length.min(reach * 2.0) * width / (1.0 + d / (reach * 0.3).max(1.0)).powi(2);
            let angle = (pair[1].y - pair[0].y).atan2(pair[1].x - pair[0].x);
            let c = current.get_or_insert((i, 0.0, f64::INFINITY, angle));
            c.1 += gain;
            if d < c.2 {
                c.2 = d;
                c.3 = angle;
            }
        }
        finish(current.take(), &mut best);
        best.map(|b| b.3)
    }
}
