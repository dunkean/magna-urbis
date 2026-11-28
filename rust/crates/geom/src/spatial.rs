use crate::{Point, Shape, bbox, contains, intersection, rectangle};

/// The rings of a shape projected on an orthonormal frame `(along, across)`,
/// each edge as `[p.along, p.across, q.along, q.across]` with its ring, and
/// binned by its across range so a band query visits only nearby edges.
pub struct BandEdges {
    rings: usize,
    edges: Vec<(usize, [f64; 4])>,
    low: f64,
    cell: f64,
    bins: Vec<Vec<u32>>,
}
impl BandEdges {
    fn bin(&self, c: f64) -> usize {
        (((c - self.low) / self.cell).floor().max(0.0) as usize).min(self.bins.len() - 1)
    }
}
pub fn band_edges(shape: &Shape, along: Point, across: Point) -> BandEdges {
    let rings: Vec<&Vec<Point>> = std::iter::once(&shape.outer)
        .chain(shape.holes.iter())
        .collect();
    let edges: Vec<(usize, [f64; 4])> = rings
        .iter()
        .enumerate()
        .flat_map(|(k, r)| {
            r.iter()
                .zip(r.iter().cycle().skip(1))
                .take(r.len())
                .map(move |(p, q)| {
                    (
                        k,
                        [
                            p.x * along.x + p.y * along.y,
                            p.x * across.x + p.y * across.y,
                            q.x * along.x + q.y * along.y,
                            q.x * across.x + q.y * across.y,
                        ],
                    )
                })
        })
        .collect();
    let (lo, hi) = edges
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(lo, hi), (_, e)| {
            (lo.min(e[1]).min(e[3]), hi.max(e[1]).max(e[3]))
        });
    let (low, span) = if lo.is_finite() && hi.is_finite() {
        (lo, hi - lo)
    } else {
        (0.0, 0.0)
    };
    let count = (edges.len() / 2).clamp(1, 512);
    let mut index = BandEdges {
        rings: rings.len(),
        edges,
        low,
        cell: (span / count as f64).max(1e-6),
        bins: vec![Vec::new(); count],
    };
    for (k, (_, e)) in index.edges.iter().enumerate() {
        let (b0, b1) = (index.bin(e[1].min(e[3])), index.bin(e[1].max(e[3])));
        for b in b0..=b1 {
            index.bins[b].push(k as u32);
        }
    }
    index
}

/// Exact rectangle containment for a row of positions, swept once instead
/// of one edge scan per position. The rectangles are `[p, p + len]` along
/// (`p` in `ps`, ascending) × `[lo, hi]` across, in the frame of `edges`
/// (`band_edges`), and are decided like the cadastral `rect_within`: no
/// boundary edge enters the rectangle shrunk by 0.1 mm, and its centre is
/// inside (even/odd, holes excluded). Each edge clipped to the band gives
/// the interval of positions it blocks; positions within `TIE` of an
/// interval end are left to `exact` for a per-position check. A position
/// free of every edge is half the
/// rectangle away from the contour, where the centre's parity along the
/// band's middle line is exact. `out[k]` receives the verdict of `ps[k]`.
#[allow(clippy::too_many_arguments)]
pub fn band_within(
    edges: &BandEdges,
    lo: f64,
    hi: f64,
    len: f64,
    ps: &[f64],
    mut exact: impl FnMut(usize) -> bool,
    certain: &mut Vec<i32>,
    possible: &mut Vec<i32>,
    crossings: &mut Vec<Vec<f64>>,
    out: &mut Vec<bool>,
) {
    const EPS: f64 = 1e-4;
    const TIE: f64 = 1e-6;
    certain.clear();
    certain.resize(ps.len() + 1, 0);
    possible.clear();
    possible.resize(ps.len() + 1, 0);
    crossings.resize(edges.rings, Vec::new());
    crossings.iter_mut().for_each(Vec::clear);
    out.clear();
    let (s0, s1) = (lo + EPS, hi - EPS);
    let mid = lo + (hi - lo) * 0.5;
    // First position index with p > x (or p >= x when `inclusive`): the
    // positions are an even grid, so start from its arithmetic guess and walk
    // to the exact partition point (the same answer as a binary search).
    let (p0, pitch) = match ps {
        [first, .., last] if last > first => (*first, (last - first) / (ps.len() - 1) as f64),
        _ => (0.0, 0.0),
    };
    let first = |x: f64, inclusive: bool| {
        let before = |p: f64| if inclusive { p < x } else { p <= x };
        let mut k = if pitch > 0.0 {
            ((x - p0) / pitch).floor().clamp(0.0, ps.len() as f64) as usize
        } else {
            0
        };
        while k > 0 && !before(ps[k - 1]) {
            k -= 1;
        }
        while k < ps.len() && before(ps[k]) {
            k += 1;
        }
        k
    };
    // Only edges whose across range meets the widened band can enter a
    // rectangle or cross the middle line; each is visited once, in the
    // first bin of the query it occupies.
    let (q0, q1) = (edges.bin(s0 - 2.0 * TIE), edges.bin(s1 + 2.0 * TIE));
    for b in q0..=q1 {
        for &e in &edges.bins[b] {
            let (k, [pa, pc, qa, qc]) = edges.edges[e as usize];
            if edges.bin(pc.min(qc)).max(q0) != b {
                continue;
            }
            if (pc > mid) != (qc > mid) {
                crossings[k].push(pa + (mid - pc) * (qa - pa) / (qc - pc));
            }
            // The edge clipped to the across band [l, h]: its along range.
            let clip = |l: f64, h: f64| -> Option<(f64, f64)> {
                if pc.max(qc) < l || pc.min(qc) > h {
                    return None;
                }
                let dc = qc - pc;
                let (t0, t1) = if dc.abs() < 1e-12 {
                    (0.0, 1.0)
                } else {
                    let (x, y) = ((l - pc) / dc, (h - pc) / dc);
                    (x.min(y).max(0.0), x.max(y).min(1.0))
                };
                if t0 > t1 {
                    return None;
                }
                let (y0, y1) = (pa + (qa - pa) * t0, pa + (qa - pa) * t1);
                Some((y0.min(y1), y0.max(y1)))
            };
            // Possibly entering: band and rectangle widened by TIE.
            if let Some((m0, m1)) = clip(s0 - TIE, s1 + TIE) {
                let (i, j) = (
                    first(m0 - len + EPS - TIE, true),
                    first(m1 - EPS + TIE, false),
                );
                if i < j {
                    possible[i] += 1;
                    possible[j] -= 1;
                }
            }
            // Certainly entering: a point strictly inside the shrunk rectangle.
            if s1 - s0 > 2.0 * TIE
                && let Some((m0, m1)) = clip(s0 + TIE, s1 - TIE)
            {
                let (i, j) = (
                    first(m0 - len + EPS + TIE, false),
                    first(m1 - EPS - TIE, true),
                );
                if i < j {
                    certain[i] += 1;
                    certain[j] -= 1;
                }
            }
        }
    }
    crossings.iter_mut().for_each(|c| c.sort_by(f64::total_cmp));
    let (mut c, mut q) = (0i32, 0i32);
    for (k, &p) in ps.iter().enumerate() {
        c += certain[k];
        q += possible[k];
        out.push(if c > 0 {
            false
        } else if q > 0 {
            exact(k)
        } else {
            let centre = p + len * 0.5;
            let odd = |xs: &Vec<f64>| (xs.len() - xs.partition_point(|&x| x <= centre)) % 2 == 1;
            !crossings.is_empty() && odd(&crossings[0]) && !crossings[1..].iter().any(odd)
        });
    }
}

/// Exact even/odd containment with edges binned by ordinate. Phase lookups use
/// the same arithmetic as contains(), but skip edges that cannot cross the ray.
pub struct ContainmentIndex {
    bounds: (f64, f64, f64, f64),
    rows: Vec<Vec<(Point, Point)>>,
}
impl ContainmentIndex {
    pub fn new(shape: &Shape) -> Self {
        let bounds = bbox(shape);
        let mut index = Self {
            bounds,
            // A long coastline should not scan scores of unrelated edges for
            // every exact shore probe. Small rings keep a small index.
            rows: vec![
                vec![];
                ((shape.outer.len() + shape.holes.iter().map(Vec::len).sum::<usize>()) / 4)
                    .clamp(16, 1024)
            ],
        };
        for ring in std::iter::once(&shape.outer).chain(shape.holes.iter()) {
            for (&a, &b) in ring
                .iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
            {
                if a.y == b.y {
                    continue;
                }
                let low = index.row(a.y.min(b.y));
                let high = index.row(a.y.max(b.y));
                for row in low..=high {
                    index.rows[row].push((a, b));
                }
            }
        }
        index
    }
    /// The original shape's bounds, retained with its parity index.
    pub fn bounds(&self) -> (f64, f64, f64, f64) {
        self.bounds
    }

    fn row(&self, y: f64) -> usize {
        (((y - self.bounds.1) / (self.bounds.3 - self.bounds.1).max(1e-12) * self.rows.len() as f64)
            .floor() as usize)
            .min(self.rows.len() - 1)
    }
    pub fn contains(&self, p: Point) -> bool {
        let (x0, y0, x1, y1) = self.bounds;
        if p.x < x0 || p.x > x1 || p.y < y0 || p.y > y1 {
            return false;
        }
        let mut inside = false;
        for &(a, b) in &self.rows[self.row(p.y)] {
            if (a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x {
                inside = !inside;
            }
        }
        inside
    }
}
type Box4 = (f64, f64, f64, f64);

fn box_finite(b: Box4) -> bool {
    b.0.is_finite() && b.1.is_finite() && b.2.is_finite() && b.3.is_finite()
}
/// Closed boxes meet (touching counts).
pub fn boxes_meet(a: Box4, b: Box4) -> bool {
    a.0 <= b.2 && a.2 >= b.0 && a.1 <= b.3 && a.3 >= b.1
}

/// Uniform grid over bounding boxes: which boxes meet a query box, without
/// scanning every box. The cell is twice the median box extent; a box spanning
/// too many cells is kept in a short list tested by every query. Answers are
/// exact (the final test is on the boxes themselves) and in ascending index order.
pub struct BoxGrid {
    cell: f64,
    cells: std::collections::HashMap<(i64, i64), Vec<u32>>,
    wide: Vec<u32>,
    boxes: Vec<Box4>,
}
impl BoxGrid {
    /// Cells a box may cover before it goes to the `wide` list, and cells a query may visit before it scans linearly.
    const MAX_CELLS: f64 = 1024.0;
    /// Boxes that are not finite (empty shapes) are never returned.
    pub fn new(boxes: Vec<Box4>) -> Self {
        let mut spans: Vec<f64> = boxes
            .iter()
            .filter(|b| box_finite(**b))
            .map(|b| (b.2 - b.0).max(b.3 - b.1))
            .collect();
        let cell = if spans.is_empty() {
            1.0
        } else {
            let mid = spans.len() / 2;
            (*spans.select_nth_unstable_by(mid, f64::total_cmp).1 * 2.0).max(1.0)
        };
        let mut grid = Self {
            cell,
            cells: Default::default(),
            wide: vec![],
            boxes,
        };
        for i in 0..grid.boxes.len() {
            let b = grid.boxes[i];
            if !box_finite(b) {
                continue;
            }
            let (cx0, cy0, cx1, cy1) = grid.range(b);
            if ((cx1 - cx0 + 1) as f64) * ((cy1 - cy0 + 1) as f64) > Self::MAX_CELLS {
                grid.wide.push(i as u32);
                continue;
            }
            for cx in cx0..=cx1 {
                for cy in cy0..=cy1 {
                    grid.cells.entry((cx, cy)).or_default().push(i as u32);
                }
            }
        }
        grid
    }
    fn range(&self, b: Box4) -> (i64, i64, i64, i64) {
        let at = |v: f64| (v / self.cell).floor() as i64;
        (at(b.0), at(b.1), at(b.2), at(b.3))
    }
    /// Indices of the boxes that meet `b` grown by `pad`, ascending.
    pub fn query(&self, b: Box4, pad: f64) -> Vec<usize> {
        let q = (b.0 - pad, b.1 - pad, b.2 + pad, b.3 + pad);
        if !box_finite(q) {
            return vec![];
        }
        let (cx0, cy0, cx1, cy1) = self.range(q);
        let mut out: Vec<usize> = Vec::new();
        if ((cx1 - cx0 + 1) as f64) * ((cy1 - cy0 + 1) as f64) > 4.0 * Self::MAX_CELLS {
            out.extend(
                (0..self.boxes.len())
                    .filter(|&i| box_finite(self.boxes[i]) && boxes_meet(self.boxes[i], q)),
            );
            return out;
        }
        for cx in cx0..=cx1 {
            for cy in cy0..=cy1 {
                if let Some(v) = self.cells.get(&(cx, cy)) {
                    out.extend(v.iter().map(|&i| i as usize));
                }
            }
        }
        out.extend(self.wide.iter().map(|&i| i as usize));
        out.sort_unstable();
        out.dedup();
        out.retain(|&i| boxes_meet(self.boxes[i], q));
        out
    }
}

/// A region (shapes plus the grid of their boundary edges and outlines) that
/// shapes are clipped against without a boolean operation against the whole of it.
pub struct Region {
    shapes: Vec<Shape>,
    outlines: BoxGrid,
    edges: BoxGrid,
}
impl Region {
    pub fn new(shapes: Vec<Shape>) -> Self {
        let outlines = BoxGrid::new(shapes.iter().map(bbox).collect());
        let mut edges = vec![];
        for r in shapes
            .iter()
            .flat_map(|s| std::iter::once(&s.outer).chain(s.holes.iter()))
        {
            for (a, b) in r.iter().zip(r.iter().cycle().skip(1)).take(r.len()) {
                edges.push((a.x.min(b.x), a.y.min(b.y), a.x.max(b.x), a.y.max(b.y)));
            }
        }
        Self {
            shapes,
            outlines,
            edges: BoxGrid::new(edges),
        }
    }
    /// `shape ∩ region`, pieces in region order. Where no boundary edge of the
    /// region meets the box of `shape`, the shape lies wholly inside or wholly
    /// outside: nothing when outside; when inside, the overlay runs against the
    /// bounding rectangle of the region shape that holds it instead of the shape
    /// itself. The overlay grid depends only on the bounds of its operands, so the
    /// result is the very ring (reduced, snapped, same start) that the overlay
    /// against the whole region gives, at the cost of a 4-vertex operand.
    /// Elsewhere the overlay runs against the region shapes whose box meets it.
    pub fn clip(&self, shape: &Shape) -> Vec<Shape> {
        let bb = bbox(shape);
        if !box_finite(bb) {
            return vec![];
        }
        if self.edges.query(bb, 0.0).is_empty() {
            let p = shape.outer[0];
            let Some(i) = self
                .outlines
                .query((p.x, p.y, p.x, p.y), 0.0)
                .into_iter()
                .find(|&i| contains(&self.shapes[i], p))
            else {
                return vec![];
            };
            let b = self.outlines.boxes[i];
            return intersection(shape, &rectangle(b.0, b.1, b.2, b.3));
        }
        self.outlines
            .query(bb, 0.0)
            .into_iter()
            .flat_map(|i| intersection(shape, &self.shapes[i]))
            .collect()
    }
    /// `clip`, with the overlay always run against the region shape itself (never its
    /// bounding rectangle): the very ring `region.iter().flat_map(|k| intersection(shape, k))`
    /// gives, vertex order included. Region shapes whose boxes do not meet the shape, and
    /// those that cannot hold a shape no region edge crosses, are skipped.
    pub fn clip_whole(&self, shape: &Shape) -> Vec<Shape> {
        let bb = bbox(shape);
        if !box_finite(bb) {
            return vec![];
        }
        if self.edges.query(bb, 0.0).is_empty() {
            let p = shape.outer[0];
            let Some(i) = self
                .outlines
                .query((p.x, p.y, p.x, p.y), 0.0)
                .into_iter()
                .find(|&i| contains(&self.shapes[i], p))
            else {
                return vec![];
            };
            return intersection(shape, &self.shapes[i]);
        }
        self.outlines
            .query(bb, 0.0)
            .into_iter()
            .flat_map(|i| intersection(shape, &self.shapes[i]))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn adaptive_containment_rows_preserve_rays_and_boundary_answers() {
        let mut shape = rectangle(-20.0, -30.0, 40.0, 50.0);
        shape.holes = vec![rectangle(-10.0, -10.0, 10.0, 10.0).outer];
        for extra in [0, 257, 4096] {
            let a = shape.outer[0];
            let b = shape.outer[1];
            let mut subdivided = shape.clone();
            subdivided.outer.splice(
                1..1,
                (0..extra).map(|i| {
                    let t = (i + 1) as f64 / (extra + 1) as f64;
                    Point {
                        x: a.x + (b.x - a.x) * t,
                        y: a.y + (b.y - a.y) * t,
                    }
                }),
            );
            let index = ContainmentIndex::new(&subdivided);
            for y in -31..=51 {
                for x in -21..=41 {
                    for shift in [0.0, 1e-10, -1e-10] {
                        let p = Point {
                            x: x as f64 + shift,
                            y: y as f64 + shift,
                        };
                        assert_eq!(index.contains(p), contains(&subdivided, p));
                    }
                }
            }
        }
    }
}
