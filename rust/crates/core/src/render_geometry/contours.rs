//! Marching squares with chained polylines (port of web/src/gen/terrain/contour.ts
//! `marchingSquares` with its `ContourWorkspace`, for the render contour sets).
//!
//! Values strictly greater than the level count as inside. Paths come out in the
//! TS order: open paths from their free ends in first-touch order of the edges,
//! then the closed loops by segment order; closed paths do not repeat their
//! first point.

/// Edge sides of a cell: 0 top, 1 right, 2 bottom, 3 left.
pub(crate) type Side = u8;

/// Segments of one cell (corner values clockwise from the top left), as the
/// `switch` of contour.ts (saddles resolved by the centre average).
pub(crate) fn cell_segments(v0: f64, v1: f64, v2: f64, v3: f64, level: f64) -> ([(Side, Side); 2], usize) {
    let c = (v0 > level) as u8 | ((v1 > level) as u8) << 1 | ((v2 > level) as u8) << 2 | ((v3 > level) as u8) << 3;
    let one = |a: Side, b: Side| ([(a, b), (0, 0)], 1);
    match c {
        1 | 14 => one(3, 0),
        2 | 13 => one(0, 1),
        3 | 12 => one(3, 1),
        4 | 11 => one(1, 2),
        6 | 9 => one(0, 2),
        7 | 8 => one(3, 2),
        5 => {
            if (v0 + v1 + v2 + v3) / 4.0 > level { ([(0, 1), (2, 3)], 2) } else { ([(3, 0), (1, 2)], 2) }
        }
        10 => {
            if (v0 + v1 + v2 + v3) / 4.0 > level { ([(3, 0), (1, 2)], 2) } else { ([(0, 1), (2, 3)], 2) }
        }
        _ => ([(0, 0), (0, 0)], 0),
    }
}

/// Edge id of a cell side (`base * 2`, +1 for a vertical edge), as contour.ts.
#[inline]
pub(crate) fn edge_id(base: usize, w: usize, side: Side) -> usize {
    match side {
        0 => base * 2,
        1 => (base + 1) * 2 + 1,
        2 => (base + w) * 2,
        _ => base * 2 + 1,
    }
}

/// World point of an edge crossing (`edgePoint`).
#[inline]
pub(crate) fn edge_point(f: &[f32], w: usize, id: usize, level: f64, cell: f64, ox: f64, oy: f64) -> [f64; 2] {
    let vertical = id & 1 == 1;
    let base = id >> 1;
    let (x, y) = (base % w, base / w);
    let a = f[y * w + x] as f64;
    let (b, dx, dy) = if vertical { (f[(y + 1) * w + x] as f64, 0.0, 1.0) } else { (f[y * w + x + 1] as f64, 1.0, 0.0) };
    let t = if a == b { 0.5 } else { (level - a) / (b - a) };
    let tt = t.clamp(0.0, 1.0);
    [ox + (x as f64 + dx * tt) * cell, oy + (y as f64 + dy * tt) * cell]
}

/// One chained contour line.
#[derive(Clone, Debug, PartialEq)]
pub struct ContourPath {
    pub pts: Vec<[f64; 2]>,
    pub closed: bool,
}

const BLOCK: usize = 16;

/// Contour lines of several levels of one field (`origin` = world position of
/// sample (0, 0), `cell` = spacing). Blocks of 16×16 cells entirely on one side
/// of a level are skipped, as with the TS workspace.
pub fn contour_levels(f: &[f32], w: usize, h: usize, levels: &[f64], cell: f64, ox: f64, oy: f64) -> Vec<Vec<ContourPath>> {
    if w < 2 || h < 2 || f.len() < w * h {
        return levels.iter().map(|_| Vec::new()).collect();
    }
    let columns = (w - 1).div_ceil(BLOCK);
    let rows = (h - 1).div_ceil(BLOCK);
    let mut minimum = vec![f32::INFINITY; columns * rows];
    let mut maximum = vec![f32::NEG_INFINITY; columns * rows];
    for by in 0..rows {
        for bx in 0..columns {
            let block = by * columns + bx;
            for y in by * BLOCK..=(h - 1).min(by * BLOCK + BLOCK) {
                for x in bx * BLOCK..=(w - 1).min(bx * BLOCK + BLOCK) {
                    let v = f[y * w + x];
                    minimum[block] = minimum[block].min(v);
                    maximum[block] = maximum[block].max(v);
                }
            }
        }
    }
    let mut first = vec![0u32; w * h * 2];
    let mut second = vec![0i64; w * h * 2];
    let mut stamps = vec![0u32; w * h * 2];
    let mut epoch = 0u32;
    let mut out = Vec::with_capacity(levels.len());
    for &level in levels {
        epoch += 1;
        let mut seg_a: Vec<usize> = Vec::new();
        let mut seg_b: Vec<usize> = Vec::new();
        for y in 0..h - 1 {
            let mut x = 0;
            while x < w - 1 {
                if x % BLOCK == 0 {
                    let block = (y / BLOCK) * columns + x / BLOCK;
                    if (maximum[block] as f64) <= level || (minimum[block] as f64) > level {
                        x += BLOCK;
                        continue;
                    }
                }
                let base = y * w + x;
                let (v0, v1, v2, v3) = (f[base] as f64, f[base + 1] as f64, f[base + w + 1] as f64, f[base + w] as f64);
                let (segments, count) = cell_segments(v0, v1, v2, v3, level);
                for &(a, b) in &segments[..count] {
                    seg_a.push(edge_id(base, w, a));
                    seg_b.push(edge_id(base, w, b));
                }
                x += 1;
            }
        }
        let n_seg = seg_a.len();
        let mut touched: Vec<usize> = Vec::new();
        for i in 0..n_seg {
            for id in [seg_a[i], seg_b[i]] {
                if stamps[id] != epoch {
                    stamps[id] = epoch;
                    first[id] = i as u32;
                    second[id] = -1;
                    touched.push(id);
                } else {
                    second[id] = i as i64;
                }
            }
        }
        let mut used = vec![false; n_seg];
        let point = |id: usize| edge_point(f, w, id, level, cell, ox, oy);
        let walk = |start_seg: usize, start_id: usize, used: &mut [bool]| -> Vec<usize> {
            let mut ids = Vec::new();
            let (mut segment, mut from) = (start_seg, start_id);
            loop {
                used[segment] = true;
                let to = if seg_a[segment] == from { seg_b[segment] } else { seg_a[segment] };
                ids.push(to);
                let (a, b) = (first[to] as usize, second[to]);
                let next = if !used[a] {
                    a
                } else if b >= 0 && !used[b as usize] {
                    b as usize
                } else {
                    break;
                };
                segment = next;
                from = to;
            }
            ids
        };
        let mut paths = Vec::new();
        for &id in &touched {
            if second[id] < 0 && !used[first[id] as usize] {
                let mut ids = vec![id];
                ids.extend(walk(first[id] as usize, id, used.as_mut_slice()));
                paths.push(ContourPath { pts: ids.into_iter().map(point).collect(), closed: false });
            }
        }
        for segment in 0..n_seg {
            if !used[segment] {
                let start = seg_a[segment];
                let mut ids = vec![start];
                ids.extend(walk(segment, start, used.as_mut_slice()));
                if ids.len() > 1 && ids.last() == Some(&start) {
                    ids.pop();
                }
                paths.push(ContourPath { pts: ids.into_iter().map(point).collect(), closed: true });
            }
        }
        out.push(paths);
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::Value;

    /// Fixture dumped from the TS `marchingSquares` with a `ContourWorkspace`.
    #[test]
    fn contour_levels_match_typescript_fixture() {
        let fixture: Value = serde_json::from_str(include_str!("../../tests/fixtures/render-contours.json")).unwrap();
        let num = |k: &str| fixture[k].as_f64().unwrap();
        let field: Vec<f32> = fixture["field"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap() as f32).collect();
        let expected = fixture["levels"].as_array().unwrap();
        let levels: Vec<f64> = expected.iter().map(|l| l["level"].as_f64().unwrap()).collect();
        let got = contour_levels(&field, num("w") as usize, num("h") as usize, &levels, num("cell"), num("ox"), num("oy"));
        for (paths, want) in got.iter().zip(expected) {
            let want = want["paths"].as_array().unwrap();
            assert_eq!(paths.len(), want.len());
            for (path, w) in paths.iter().zip(want) {
                assert_eq!(path.closed, w["closed"].as_bool().unwrap());
                let pts: Vec<f64> = w["pts"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
                assert_eq!(path.pts.len() * 2, pts.len());
                for (p, q) in path.pts.iter().zip(pts.chunks_exact(2)) {
                    assert!((p[0] - q[0]).abs() < 1e-9 && (p[1] - q[1]).abs() < 1e-9, "{p:?} vs {q:?}");
                }
            }
        }
    }
}
