//! A uniform grid over the live edges of one level, and the segment tests it serves.

use std::collections::HashMap;

use magna_urbis_geom::Point;

use super::key::EdgeId;

/// Distance under which two points, or a point and a line, are taken as touching (metres).
pub(super) const TOUCH: f64 = 1e-7;

/// Widest span of cells, per axis, a segment or query box may cover; guards against absurd extents.
const MAX_SPAN: i64 = 1 << 20;

/// Edges by grid cell. Each edge is listed in every cell its segments' boxes cover.
#[derive(Clone, Debug)]
pub(super) struct Grid {
    cell: f64,
    cells: HashMap<(i64, i64), Vec<EdgeId>>,
    bounds: Option<[f64; 4]>,
}

impl Grid {
    pub(super) fn new(cell: f64) -> Self {
        Self {
            cell: if cell.is_finite() && cell > 0.0 {
                cell
            } else {
                32.0
            },
            cells: HashMap::new(),
            bounds: None,
        }
    }

    fn range(&self, b: [f64; 4]) -> Option<[i64; 4]> {
        let at = |v: f64| (v / self.cell).floor() as i64;
        let r = [at(b[0]), at(b[1]), at(b[2]), at(b[3])];
        (b.iter().all(|v| v.is_finite()) && r[2] - r[0] < MAX_SPAN && r[3] - r[1] < MAX_SPAN)
            .then_some(r)
    }

    pub(super) fn insert(&mut self, edge: EdgeId, polyline: &[Point]) {
        for w in polyline.windows(2) {
            let Some(r) = self.range(bbox(w)) else {
                continue;
            };
            for cx in r[0]..=r[2] {
                for cy in r[1]..=r[3] {
                    let list = self.cells.entry((cx, cy)).or_default();
                    if list.last() != Some(&edge) {
                        list.push(edge);
                    }
                }
            }
        }
        let b = bbox(polyline);
        self.bounds = Some(match self.bounds {
            Some(o) => [
                o[0].min(b[0]),
                o[1].min(b[1]),
                o[2].max(b[2]),
                o[3].max(b[3]),
            ],
            None => b,
        });
    }

    pub(super) fn remove(&mut self, edge: EdgeId, polyline: &[Point]) {
        for w in polyline.windows(2) {
            let Some(r) = self.range(bbox(w)) else {
                continue;
            };
            for cx in r[0]..=r[2] {
                for cy in r[1]..=r[3] {
                    if let Some(list) = self.cells.get_mut(&(cx, cy)) {
                        list.retain(|&e| e != edge);
                        if list.is_empty() {
                            self.cells.remove(&(cx, cy));
                        }
                    }
                }
            }
        }
    }

    /// Edges listed in the cells a box covers, ascending, without duplicates.
    pub(super) fn candidates(&self, b: [f64; 4]) -> Vec<EdgeId> {
        let Some(r) = self.range(b) else {
            return vec![];
        };
        let mut out = Vec::new();
        for cx in r[0]..=r[2] {
            for cy in r[1]..=r[3] {
                if let Some(list) = self.cells.get(&(cx, cy)) {
                    out.extend_from_slice(list);
                }
            }
        }
        out.sort_unstable();
        out.dedup();
        out
    }

    /// Box of every polyline ever indexed, or `None` before the first.
    pub(super) fn bounds(&self) -> Option<[f64; 4]> {
        self.bounds
    }
}

/// `[min x, min y, max x, max y]` of a set of points.
pub(super) fn bbox(points: &[Point]) -> [f64; 4] {
    points.iter().fold(
        [
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ],
        |b, p| [b[0].min(p.x), b[1].min(p.y), b[2].max(p.x), b[3].max(p.y)],
    )
}

/// How two segments meet.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum Contact {
    /// At a single point.
    Point(Point),
    /// Along a stretch of positive length.
    Overlap,
}

fn cross(o: Point, a: Point, b: Point) -> f64 {
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
}

/// Where segments `ab` and `cd` meet, within `TOUCH`.
pub(super) fn contact(a: Point, b: Point, c: Point, d: Point) -> Option<Contact> {
    let (lab, lcd) = (a.distance(b), c.distance(d));
    if lab < TOUCH || lcd < TOUCH {
        return None;
    }
    // Signed distances of each end from the other segment's line.
    let (d1, d2) = (cross(c, d, a) / lcd, cross(c, d, b) / lcd);
    let (d3, d4) = (cross(a, b, c) / lab, cross(a, b, d) / lab);
    if d1.abs() < TOUCH && d2.abs() < TOUCH {
        let (ux, uy) = ((b.x - a.x) / lab, (b.y - a.y) / lab);
        let along = |p: Point| (p.x - a.x) * ux + (p.y - a.y) * uy;
        let (tc, td) = (along(c), along(d));
        let (lo, hi) = (tc.min(td).max(0.0), tc.max(td).min(lab));
        return if hi - lo > TOUCH {
            Some(Contact::Overlap)
        } else if hi - lo >= -TOUCH {
            let s = 0.5 * (lo + hi);
            Some(Contact::Point(Point {
                x: a.x + ux * s,
                y: a.y + uy * s,
            }))
        } else {
            None
        };
    }
    let apart = |u: f64, v: f64| (u > TOUCH && v < -TOUCH) || (u < -TOUCH && v > TOUCH);
    if apart(d1, d2) && apart(d3, d4) {
        let t = d1 / (d1 - d2);
        return Some(Contact::Point(Point {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
        }));
    }
    let within = |p: Point, q: Point, r: Point| {
        let len = p.distance(q);
        let s = ((r.x - p.x) * (q.x - p.x) + (r.y - p.y) * (q.y - p.y)) / len;
        (-TOUCH..=len + TOUCH).contains(&s)
    };
    if d1.abs() < TOUCH && within(c, d, a) {
        Some(Contact::Point(a))
    } else if d2.abs() < TOUCH && within(c, d, b) {
        Some(Contact::Point(b))
    } else if d3.abs() < TOUCH && within(a, b, c) {
        Some(Contact::Point(c))
    } else if d4.abs() < TOUCH && within(a, b, d) {
        Some(Contact::Point(d))
    } else {
        None
    }
}

/// Every contact between the segments of two polylines.
pub(super) fn contacts(p: &[Point], q: &[Point]) -> Vec<Contact> {
    let mut out = Vec::new();
    for s in p.windows(2) {
        let bs = bbox(s);
        for t in q.windows(2) {
            let bt = bbox(t);
            if bs[0] > bt[2] + TOUCH
                || bt[0] > bs[2] + TOUCH
                || bs[1] > bt[3] + TOUCH
                || bt[1] > bs[3] + TOUCH
            {
                continue;
            }
            if let Some(c) = contact(s[0], s[1], t[0], t[1]) {
                out.push(c);
            }
        }
    }
    out
}

/// Distance from `p` to a polyline, the segment reached and the nearest point on it.
pub(super) fn nearest_on(polyline: &[Point], p: Point) -> (f64, usize, Point) {
    let mut best = (f64::INFINITY, 0, polyline[0]);
    for (i, w) in polyline.windows(2).enumerate() {
        let (d, _, q) = magna_urbis_geom::distance(p, w[0], w[1]);
        if d < best.0 {
            best = (d, i, q);
        }
    }
    best
}
