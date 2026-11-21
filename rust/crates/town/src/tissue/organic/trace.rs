//! Tracing one street through the field, in 5 m steps from a seed inside a
//! piece until it reaches the piece's boundary.

use super::field::{Field, delta};
use super::grade::segment_clear;
use magna_urbis_geom::{ContainmentIndex, Point, Shape, bbox, contains, segment_hit};
use std::collections::HashMap;
use std::f64::consts::{FRAC_PI_2, PI};

/// Length of one integration step in metres.
const STEP: f64 = 5.0;
/// Steps after which a trace that has not reached the boundary is dropped.
const MAX_STEPS: usize = 800;
/// Heading offsets in radians tried in order when the desired step is too
/// steep or wet.
const DETOURS: [f64; 9] = [0.0, 0.12, -0.12, 0.28, -0.28, 0.5, -0.5, 0.8, -0.8];

/// Outer-ring edges of a piece in a uniform grid, shared by its cut
/// candidates: the first-hit and containment tests of a step only visit
/// nearby edges.
pub(super) struct TraceIndex {
    edges: Vec<(Point, Point)>,
    x0: f64,
    y0: f64,
    cell: f64,
    nx: usize,
    ny: usize,
    cells: Vec<Vec<u32>>,
    inside: Option<ContainmentIndex>,
}

impl TraceIndex {
    const PAD: f64 = 1e-3;

    pub(super) fn new(s: &Shape) -> Self {
        let edges: Vec<(Point, Point)> = s
            .outer
            .iter()
            .zip(s.outer.iter().cycle().skip(1))
            .take(s.outer.len())
            .map(|(&a, &b)| (a, b))
            .collect();
        let (x0, y0, x1, y1) = bbox(s);
        let (x0, y0) = (x0 - Self::PAD, y0 - Self::PAD);
        let (w, h) = (x1 + Self::PAD - x0, y1 + Self::PAD - y0);
        let cell = 10.0_f64.max(w.max(h) / 64.0);
        let nx = ((w / cell).floor() as usize + 1).min(65);
        let ny = ((h / cell).floor() as usize + 1).min(65);
        let mut me = Self {
            edges,
            x0,
            y0,
            cell,
            nx,
            ny,
            cells: vec![vec![]; nx * ny],
            inside: s.holes.is_empty().then(|| ContainmentIndex::new(s)),
        };
        for i in 0..me.edges.len() {
            let (a, b) = me.edges[i];
            let (cx0, cx1, cy0, cy1) = me.range(a, b);
            for cy in cy0..=cy1 {
                for cx in cx0..=cx1 {
                    me.cells[cy * nx + cx].push(i as u32);
                }
            }
        }
        me
    }

    fn range(&self, a: Point, b: Point) -> (usize, usize, usize, usize) {
        let c =
            |v: f64, o: f64, n: usize| (((v - o) / self.cell).floor().max(0.0) as usize).min(n - 1);
        (
            c(a.x.min(b.x) - Self::PAD, self.x0, self.nx),
            c(a.x.max(b.x) + Self::PAD, self.x0, self.nx),
            c(a.y.min(b.y) - Self::PAD, self.y0, self.ny),
            c(a.y.max(b.y) + Self::PAD, self.y0, self.ny),
        )
    }

    /// First hit of the segment on the ring (smallest `t`, earliest edge on ties).
    fn first_hit(&self, cur: Point, next: Point, scratch: &mut Vec<u32>) -> Option<(f64, Point)> {
        scratch.clear();
        let (cx0, cx1, cy0, cy1) = self.range(cur, next);
        for cy in cy0..=cy1 {
            for cx in cx0..=cx1 {
                scratch.extend_from_slice(&self.cells[cy * self.nx + cx]);
            }
        }
        scratch.sort_unstable();
        scratch.dedup();
        scratch
            .iter()
            .filter_map(|&i| {
                let (a, b) = self.edges[i as usize];
                segment_hit(cur, next, a, b)
            })
            .min_by(|a, b| a.0.total_cmp(&b.0))
    }

    fn contains(&self, s: &Shape, p: Point) -> bool {
        match &self.inside {
            Some(index) => index.contains(p),
            None => contains(s, p),
        }
    }
}

/// Segments of the path being traced, for the incremental self-intersection test.
struct PathGrid(HashMap<(i32, i32), Vec<u32>>);

impl PathGrid {
    const CELL: f64 = 8.0;
    const PAD: f64 = 1e-3;

    fn cells(a: Point, b: Point) -> impl Iterator<Item = (i32, i32)> {
        let c = |v: f64| (v / Self::CELL).floor() as i32;
        let (x0, x1) = (c(a.x.min(b.x) - Self::PAD), c(a.x.max(b.x) + Self::PAD));
        let (y0, y1) = (c(a.y.min(b.y) - Self::PAD), c(a.y.max(b.y) + Self::PAD));
        (y0..=y1).flat_map(move |y| (x0..=x1).map(move |x| (x, y)))
    }

    fn insert(&mut self, i: usize, a: Point, b: Point) {
        for k in Self::cells(a, b) {
            self.0.entry(k).or_default().push(i as u32);
        }
    }

    /// Whether the segment hits any traced segment of index below `below`.
    fn hits(&self, out: &[Point], below: usize, a: Point, b: Point) -> bool {
        Self::cells(a, b).any(|k| {
            self.0.get(&k).is_some_and(|v| {
                v.iter().any(|&i| {
                    let i = i as usize;
                    i < below && segment_hit(a, b, out[i], out[i + 1]).is_some()
                })
            })
        })
    }
}

/// Trace from `seed` along `heading` through the field until the street
/// reaches the boundary of piece `s`, its last point just inside the boundary.
/// Each step turns toward the nearest field direction, by at most the
/// curvature allowance, and detours by up to 0.8 rad around ground steeper
/// than `max_grade` or wet. `None` when the trace leaves the piece, crosses
/// itself, finds no admissible step or runs for 4 km.
pub(super) fn trace(
    field: &Field<'_>,
    s: &Shape,
    index: &TraceIndex,
    seed: Point,
    heading: f64,
    max_grade: f64,
) -> Option<Vec<Point>> {
    let mut out = vec![seed];
    let mut cur = seed;
    let mut head = heading;
    let turn = (field.params.curvature + field.params.site_adaptation * 1.5) * 5.0 * PI / 180.0;
    let mut own = PathGrid(HashMap::new());
    let mut scratch = vec![];
    for _ in 0..MAX_STEPS {
        let a = field.angle(cur);
        let dh = (0..4)
            .map(|k| delta(a + k as f64 * FRAC_PI_2, head))
            .min_by(|a, b| a.abs().total_cmp(&b.abs()))?;
        let desired = head + dh.clamp(-turn, turn);
        let (next_heading, nx, ends) = DETOURS
            .into_iter()
            .map(|offset| {
                let h = desired + offset;
                let next = Point {
                    x: cur.x + h.cos() * STEP,
                    y: cur.y + h.sin() * STEP,
                };
                match index.first_hit(cur, next, &mut scratch) {
                    Some((_, p)) => (
                        h,
                        Point {
                            x: p.x + (cur.x - p.x) * 1e-8,
                            y: p.y + (cur.y - p.y) * 1e-8,
                        },
                        true,
                    ),
                    None => (h, next, false),
                }
            })
            .find(|(_, next, _)| segment_clear(field.terrain, cur, *next, max_grade))?;
        head = next_heading;
        if ends {
            out.push(nx);
            return Some(out);
        }
        if !index.contains(s, nx) {
            return None;
        }
        if out.len() > 8 && own.hits(&out, out.len() - 7, cur, nx) {
            return None;
        }
        own.insert(out.len() - 1, cur, nx);
        out.push(nx);
        cur = nx;
    }
    None
}
