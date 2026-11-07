//! Signed coastal distance fields (port of web/src/render/terrainSea.ts
//! `coastDistances`): the Euclidean distance from each texel centre to the
//! sub-cell zero contour of the field (marching squares, linear crossings),
//! capped at the band, negative where the field is positive (land for a
//! height, water for a negated lake field).
//!
//! The distance is to the interpolated contour segments, not to raster cells,
//! so a pixel EDT would change it; this keeps the exact definition. Narrow
//! bands stamp each segment's neighbourhood; wide bands search a bounding
//! volume tree of the segments per texel (rows in parallel where rayon runs).

use super::contours::cell_segments;

#[derive(Clone, Copy)]
struct Segment {
    ax: f64,
    ay: f64,
    bx: f64,
    by: f64,
}

impl Segment {
    #[inline]
    fn distance2(&self, x: f64, y: f64) -> f64 {
        let (dx, dy) = (self.bx - self.ax, self.by - self.ay);
        let t = (((x - self.ax) * dx + (y - self.ay) * dy) / (dx * dx + dy * dy).max(1e-20)).clamp(0.0, 1.0);
        let (ex, ey) = (x - self.ax - t * dx, y - self.ay - t * dy);
        ex * ex + ey * ey
    }
}

/// Zero-contour segments of the field, sample (x, y) at ((x + 0.5) cell, (y + 0.5) cell).
fn zero_segments(height: &[f32], n: usize, cell: f64) -> Vec<Segment> {
    let (ox, oy) = (cell / 2.0, cell / 2.0);
    let point = |x: usize, y: usize, side: u8| -> [f64; 2] {
        // (edge from corner (x, y) to its right neighbour, or down for a vertical edge)
        let (cx, cy, vertical) = match side {
            0 => (x, y, false),
            1 => (x + 1, y, true),
            2 => (x, y + 1, false),
            _ => (x, y, true),
        };
        let a = height[cy * n + cx] as f64;
        let (b, dx, dy) = if vertical { (height[(cy + 1) * n + cx] as f64, 0.0, 1.0) } else { (height[cy * n + cx + 1] as f64, 1.0, 0.0) };
        let t = if a == b { 0.5 } else { (0.0 - a) / (b - a) };
        let tt = t.clamp(0.0, 1.0);
        [ox + (cx as f64 + dx * tt) * cell, oy + (cy as f64 + dy * tt) * cell]
    };
    let mut segments = Vec::new();
    for y in 0..n.saturating_sub(1) {
        for x in 0..n - 1 {
            let base = y * n + x;
            let (v0, v1, v2, v3) = (height[base] as f64, height[base + 1] as f64, height[base + n + 1] as f64, height[base + n] as f64);
            let (pairs, count) = cell_segments(v0, v1, v2, v3, 0.0);
            for &(a, b) in &pairs[..count] {
                let (p, q) = (point(x, y, a), point(x, y, b));
                segments.push(Segment { ax: p[0], ay: p[1], bx: q[0], by: q[1] });
            }
        }
    }
    segments
}

/// Signed distance to the zero contour of `height` (n × n, texel spacing
/// `cell`), capped at `band`.
pub fn coast_distances(height: &[f32], n: usize, cell: f64, band: f64) -> Vec<f32> {
    if n == 0 || height.len() < n * n {
        return Vec::new();
    }
    let segments = zero_segments(height, n, cell);
    let unsigned = if band <= 24.0 * cell { narrow(&segments, n, cell, band) } else { wide(segments, n, cell, band) };
    unsigned.iter().zip(height).map(|(&d, &h)| if h > 0.0 { -d as f32 } else { d as f32 }).collect()
}

/// Each segment updates only the texels within the band around it.
fn narrow(segments: &[Segment], n: usize, cell: f64, band: f64) -> Vec<f64> {
    if segments.is_empty() {
        return vec![band; n * n];
    }
    let mut best = vec![band * band; n * n];
    let last = (n - 1) as f64;
    for s in segments {
        let x0 = ((s.ax.min(s.bx) - band) / cell - 0.5).floor().max(0.0);
        let x1 = ((s.ax.max(s.bx) + band) / cell - 0.5).ceil().min(last);
        let y0 = ((s.ay.min(s.by) - band) / cell - 0.5).floor().max(0.0);
        let y1 = ((s.ay.max(s.by) + band) / cell - 0.5).ceil().min(last);
        if !(x0 <= x1 && y0 <= y1) {
            continue;
        }
        for y in y0 as usize..=y1 as usize {
            let py = (y as f64 + 0.5) * cell;
            let row = &mut best[y * n..y * n + n];
            for (x, slot) in row.iter_mut().enumerate().take(x1 as usize + 1).skip(x0 as usize) {
                let d = s.distance2((x as f64 + 0.5) * cell, py);
                if d < *slot {
                    *slot = d;
                }
            }
        }
    }
    best.into_iter().map(f64::sqrt).collect()
}

struct Node {
    min_x: f64,
    min_y: f64,
    max_x: f64,
    max_y: f64,
    /// Leaf: segment range; inner: children indices.
    leaf: bool,
    a: usize,
    b: usize,
}

impl Node {
    #[inline]
    fn distance2(&self, x: f64, y: f64) -> f64 {
        let dx = (self.min_x - x).max(0.0).max(x - self.max_x);
        let dy = (self.min_y - y).max(0.0).max(y - self.max_y);
        dx * dx + dy * dy
    }
}

/// Median split on the longer side of the box, leaves of at most 8 segments.
fn build(items: &mut [Segment], offset: usize, nodes: &mut Vec<Node>) -> usize {
    let (mut min_x, mut min_y, mut max_x, mut max_y) = (f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY);
    for s in items.iter() {
        min_x = min_x.min(s.ax).min(s.bx);
        max_x = max_x.max(s.ax).max(s.bx);
        min_y = min_y.min(s.ay).min(s.by);
        max_y = max_y.max(s.ay).max(s.by);
    }
    let index = nodes.len();
    nodes.push(Node { min_x, min_y, max_x, max_y, leaf: true, a: offset, b: offset + items.len() });
    if items.len() > 8 {
        if max_x - min_x >= max_y - min_y {
            items.sort_by(|p, q| (p.ax + p.bx).total_cmp(&(q.ax + q.bx)));
        } else {
            items.sort_by(|p, q| (p.ay + p.by).total_cmp(&(q.ay + q.by)));
        }
        let middle = items.len() >> 1;
        let (left, right) = items.split_at_mut(middle);
        let l = build(left, offset, nodes);
        let r = build(right, offset + middle, nodes);
        nodes[index].leaf = false;
        nodes[index].a = l;
        nodes[index].b = r;
    }
    index
}

struct Tree {
    nodes: Vec<Node>,
    segments: Vec<Segment>,
}

impl Tree {
    /// Nearest squared distance below `best`, with the index of that segment.
    fn nearest(&self, node: usize, x: f64, y: f64, best: f64, found: &mut Option<usize>) -> f64 {
        let nd = &self.nodes[node];
        if nd.distance2(x, y) >= best {
            return best;
        }
        let mut best = best;
        if nd.leaf {
            for i in nd.a..nd.b {
                let d = self.segments[i].distance2(x, y);
                if d < best {
                    best = d;
                    *found = Some(i);
                }
            }
            return best;
        }
        let (mut a, mut b) = (nd.a, nd.b);
        if self.nodes[a].distance2(x, y) > self.nodes[b].distance2(x, y) {
            std::mem::swap(&mut a, &mut b);
        }
        let best = self.nearest(a, x, y, best, found);
        self.nearest(b, x, y, best, found)
    }
}

fn wide(mut segments: Vec<Segment>, n: usize, cell: f64, band: f64) -> Vec<f64> {
    if segments.is_empty() {
        return vec![band; n * n];
    }
    let mut nodes = Vec::with_capacity(segments.len() / 4 + 1);
    build(&mut segments, 0, &mut nodes);
    let tree = Tree { nodes, segments };
    let limit = band * band;
    // The previous texel's nearest segment bounds this texel's search; the
    // minimum over all segments is unchanged.
    let rows = crate::urban::par::range(n, |y| {
        let py = (y as f64 + 0.5) * cell;
        let mut found: Option<usize> = None;
        (0..n)
            .map(|x| {
                let px = (x as f64 + 0.5) * cell;
                let mut start = limit;
                if let Some(i) = found {
                    let bound = tree.segments[i].distance2(px, py);
                    if bound < start { start = bound } else { found = None }
                }
                tree.nearest(0, px, py, start, &mut found).sqrt()
            })
            .collect::<Vec<f64>>()
    });
    rows.concat()
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    /// Fixture dumped from the TS `coastDistances` (both branches).
    #[test]
    fn coast_distances_match_typescript_fixture() {
        let fixture: Value = serde_json::from_str(include_str!("../../tests/fixtures/render-coast.json")).unwrap();
        let n = fixture["n"].as_u64().unwrap() as usize;
        let cell = fixture["cell"].as_f64().unwrap();
        let height: Vec<f32> = fixture["height"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap() as f32).collect();
        for branch in ["narrow", "wide"] {
            let band = fixture[branch]["band"].as_f64().unwrap();
            let got = coast_distances(&height, n, cell, band);
            let want = fixture[branch]["values"].as_array().unwrap();
            assert_eq!(got.len(), want.len());
            for (i, (g, w)) in got.iter().zip(want).enumerate() {
                let w = w.as_f64().unwrap() as f32;
                assert!((g - w).abs() <= 1e-5 * w.abs().max(1.0), "{branch} texel {i}: {g} vs {w}");
            }
        }
    }
}
