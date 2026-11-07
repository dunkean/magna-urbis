use super::geom::*;
use serde::{Deserialize, Serialize};
pub const D8: [(isize, isize); 8] = [
    (1, 0),
    (1, 1),
    (0, 1),
    (-1, 1),
    (-1, 0),
    (-1, -1),
    (0, -1),
    (1, -1),
];
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
pub struct Window {
    pub x0: isize,
    pub y0: isize,
    pub x1: isize,
    pub y1: isize,
}
pub fn class_window(c: &[u8], w: usize, h: usize, k: u8) -> Option<Window> {
    let mut win = Window {
        x0: w as isize,
        y0: h as isize,
        x1: -1,
        y1: -1,
    };
    for (i, &v) in c.iter().enumerate() {
        if v != k {
            continue;
        }
        let (x, y) = ((i % w) as isize, (i / w) as isize);
        win.x0 = win.x0.min(x);
        win.x1 = win.x1.max(x);
        win.y0 = win.y0.min(y);
        win.y1 = win.y1.max(y);
    }
    (win.x1 >= 0).then_some(win)
}
pub fn blur(data: &[f32], w: usize, h: usize, r: usize, passes: usize) -> Vec<f32> {
    let mut src = data.to_vec();
    let mut tmp = vec![0_f32; w * h];
    let mut col = vec![0_f64; w];
    for _ in 0..passes {
        for y in 0..h {
            let row = y * w;
            let mut s = 0.0;
            for x in 0..w.min(r) {
                s += src[row + x] as f64;
            }
            for x in 0..w {
                if x + r < w {
                    s += src[row + x + r] as f64;
                }
                if x > r {
                    s -= src[row + x - r - 1] as f64;
                }
                let lo = x.saturating_sub(r);
                let hi = (x + r).min(w - 1);
                tmp[row + x] = (s / (hi - lo + 1) as f64) as f32;
            }
        }
        col.fill(0.0);
        for y in 0..h {
            if y == 0 {
                for yy in 0..=(h - 1).min(r) {
                    for x in 0..w {
                        col[x] += tmp[yy * w + x] as f64;
                    }
                }
            } else {
                if y + r < h {
                    for x in 0..w {
                        col[x] += tmp[(y + r) * w + x] as f64;
                    }
                }
                if y > r {
                    for x in 0..w {
                        col[x] -= tmp[(y - r - 1) * w + x] as f64;
                    }
                }
            }
            let count = (h - 1).min(y + r) - y.saturating_sub(r) + 1;
            for x in 0..w {
                src[y * w + x] = (col[x] / count as f64) as f32;
            }
        }
    }
    src
}
pub fn distance_field(
    mask: &[u8],
    w: usize,
    h: usize,
    cell: f64,
    carry: Option<&[f32]>,
) -> (Vec<f32>, Vec<f32>) {
    let mut d = vec![1e9_f32; w * h];
    let mut v = vec![0_f32; if carry.is_some() { w * h } else { 0 }];
    for i in 0..w * h {
        if mask[i] != 0 {
            d[i] = 0.0;
            if let Some(c) = carry {
                v[i] = c[i];
            }
        }
    }
    fn relax(d: &mut [f32], v: &mut [f32], i: usize, j: usize, wt: f64) {
        let nd = d[j] as f64 + wt;
        if nd < d[i] as f64 {
            d[i] = nd as f32;
            if !v.is_empty() {
                v[i] = v[j];
            }
        }
    }
    let s = std::f64::consts::SQRT_2;
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            if x > 0 {
                relax(&mut d, &mut v, i, i - 1, 1.0);
            }
            if y > 0 {
                relax(&mut d, &mut v, i, i - w, 1.0);
                if x > 0 {
                    relax(&mut d, &mut v, i, i - w - 1, s);
                }
                if x + 1 < w {
                    relax(&mut d, &mut v, i, i - w + 1, s);
                }
            }
        }
    }
    for y in (0..h).rev() {
        for x in (0..w).rev() {
            let i = y * w + x;
            if x + 1 < w {
                relax(&mut d, &mut v, i, i + 1, 1.0);
            }
            if y + 1 < h {
                relax(&mut d, &mut v, i, i + w, 1.0);
                if x + 1 < w {
                    relax(&mut d, &mut v, i, i + w + 1, s);
                }
                if x > 0 {
                    relax(&mut d, &mut v, i, i + w - 1, s);
                }
            }
        }
    }
    for x in &mut d {
        *x = (*x as f64 * cell) as f32;
    }
    (d, v)
}
pub fn near_line(a: &[Point], w: usize, h: usize, cell: f64, r: f64, mut f: impl FnMut(usize)) {
    // Reuse capacity across the many short road segments on each worker.
    thread_local! { static SEEN: std::cell::RefCell<super::hash::HashSet<usize>> = std::cell::RefCell::new(super::hash::HashSet::default()); }
    SEEN.with(|seen| {
        let mut seen = seen.borrow_mut();
        seen.clear();
        for a in a.windows(2) {
            let b = bbox(a).grow(r);
            let x0 = (b.x0 / cell).floor().max(0.0) as isize;
            let x1 = (b.x1 / cell).floor().min(w as f64 - 1.0) as isize;
            let y0 = (b.y0 / cell).floor().max(0.0) as isize;
            let y1 = (b.y1 / cell).floor().min(h as f64 - 1.0) as isize;
            for y in y0..=y1 {
                for x in x0..=x1 {
                    let p = p((x as f64 + 0.5) * cell, (y as f64 + 0.5) * cell);
                    let q = nearest(p, a[0], a[1]);
                    if dist(p, q) <= r {
                        let i = y as usize * w + x as usize;
                        if seen.insert(i) {
                            f(i);
                        }
                    }
                }
            }
        }
    });
}
pub fn rasterize(rings: &[Polygon], w: usize, h: usize, cell: f64, out: &mut [u8]) {
    let b = bbox(&rings.iter().flatten().copied().collect::<Vec<_>>());
    if !b.y0.is_finite() {
        return;
    }
    let r0 = (b.y0 / cell - 0.5).floor().max(0.0) as isize;
    let r1 = (b.y1 / cell - 0.5).ceil().min(h as f64 - 1.0) as isize;
    for r in r0..=r1 {
        let y = (r as f64 + 0.5) * cell;
        let mut xs = vec![];
        for ring in rings {
            if ring.is_empty() {
                continue;
            }
            let mut j = ring.len() - 1;
            for i in 0..ring.len() {
                let (a, b) = (ring[i], ring[j]);
                if (a.y > y) != (b.y > y) {
                    xs.push(a.x + (y - a.y) * (b.x - a.x) / (b.y - a.y));
                }
                j = i;
            }
        }
        xs.sort_by(f64::total_cmp);
        for pair in xs.chunks_exact(2) {
            let c0 = (pair[0] / cell - 0.5).ceil().max(0.0) as isize;
            let c1 = (pair[1] / cell - 0.5).floor().min(w as f64 - 1.0) as isize;
            for c in c0..=c1 {
                out[r as usize * w + c as usize] = 1;
            }
        }
    }
}
pub fn raster_regions(r: &[Region], w: usize, h: usize, cell: f64, out: &mut [u8]) {
    for a in r {
        let rings = std::iter::once(a.outer.clone())
            .chain(a.holes.clone())
            .collect::<Vec<_>>();
        rasterize(&rings, w, h, cell, out);
    }
}
pub fn idx(p: Point, w: usize, h: usize, cell: f64) -> usize {
    (p.y / cell).floor().clamp(0.0, h as f64 - 1.0) as usize * w
        + (p.x / cell).floor().clamp(0.0, w as f64 - 1.0) as usize
}
pub fn sample(data: &[f32], w: usize, h: usize, cell: f64, x: f64, y: f64) -> f64 {
    let fx = x / cell - 0.5;
    let fy = y / cell - 0.5;
    let x0 = fx.floor();
    let y0 = fy.floor();
    let tx = fx - x0;
    let ty = fy - y0;
    let get = |x: f64, y: f64| {
        data[y.clamp(0.0, h as f64 - 1.0) as usize * w + x.clamp(0.0, w as f64 - 1.0) as usize]
            as f64
    };
    (get(x0, y0) * (1.0 - tx) + get(x0 + 1.0, y0) * tx) * (1.0 - ty)
        + (get(x0, y0 + 1.0) * (1.0 - tx) + get(x0 + 1.0, y0 + 1.0) * tx) * ty
}

/// Same cropped FP32 blur, padded marching squares, smoothing and nesting as rural.ts.
/// Serial on every target: this entry point is also called on the browser main thread.
pub fn vectorize(
    ind: &[f32],
    w: usize,
    h: usize,
    cell: f64,
    min_area: f64,
    win: Window,
) -> Vec<Region> {
    if w == 0 || h == 0 || ind.len() != w * h || !cell.is_finite() || cell <= 0.0 {
        return vec![];
    }
    let x0 = (win.x0 - 2).max(0);
    let y0 = (win.y0 - 2).max(0);
    let x1 = (win.x1 + 2).min(w as isize - 1);
    let y1 = (win.y1 + 2).min(h as isize - 1);
    if x1 < x0 || y1 < y0 {
        return vec![];
    }
    let (cw, ch) = ((x1 - x0 + 1) as usize, (y1 - y0 + 1) as usize);
    // Read the crop directly. Keep the exact f64 running-sum order and FP32
    // intermediate of blur(), writing the vertical result straight into padding.
    let mut tmp = vec![0_f32; cw * ch];
    for y in 0..ch {
        let row = &ind[(y + y0 as usize) * w + x0 as usize..][..cw];
        let mut sum = row[0] as f64;
        for x in 0..cw {
            if x + 1 < cw {
                sum += row[x + 1] as f64;
            }
            if x > 1 {
                sum -= row[x - 2] as f64;
            }
            let count = (x + 1).min(cw - 1) - x.saturating_sub(1) + 1;
            tmp[y * cw + x] = (sum / count as f64) as f32;
        }
    }
    let (pw, ph) = (cw + 2, ch + 2);
    let mut pad = vec![0_f32; pw * ph];
    let mut col = vec![0_f64; cw];
    for yy in 0..ch.min(2) {
        for (sum, &v) in col.iter_mut().zip(&tmp[yy * cw..(yy + 1) * cw]) {
            *sum += v as f64;
        }
    }
    for y in 0..ch {
        if y > 0 {
            if y + 1 < ch {
                for (sum, &v) in col.iter_mut().zip(&tmp[(y + 1) * cw..(y + 2) * cw]) {
                    *sum += v as f64;
                }
            }
            if y > 1 {
                for (sum, &v) in col.iter_mut().zip(&tmp[(y - 2) * cw..(y - 1) * cw]) {
                    *sum -= v as f64;
                }
            }
        }
        let count = (y + 1).min(ch - 1) - y.saturating_sub(1) + 1;
        for (out, &sum) in pad[(y + 1) * pw + 1..][..cw].iter_mut().zip(&col) {
            *out = (sum / count as f64) as f32;
        }
    }
    drop(tmp);
    let loops: Vec<Polygon> = contours(
        &pad,
        pw,
        ph,
        cell,
        (x0 as f64 - 0.5) * cell,
        (y0 as f64 - 0.5) * cell,
    )
    .into_iter()
    .filter_map(|(a, closed)| {
        if !closed || a.len() < 4 {
            return None;
        }
        let a = chaikin(&a, 2);
        let mut out = vec![a[0]];
        for q in &a[1..a.len() - 1] {
            if dist(*q, *out.last().unwrap()).powi(2) >= (0.3 * cell).powi(2) {
                out.push(*q);
            }
        }
        out.push(*a.last().unwrap());
        (out.len() >= 3 && area(&out).abs() >= min_area * 0.4).then_some(out)
    })
    .collect();
    let areas: Vec<f64> = loops.iter().map(|a| area(a).abs()).collect();
    let boxes: Vec<_> = loops.iter().map(|a| bbox(a)).collect();
    let inside = |j: usize, p: Point| boxes[j].contains(p) && contains(&loops[j], p);
    let depths: Vec<usize> = loops
        .iter()
        .enumerate()
        .map(|(i, l)| {
            (0..loops.len())
                .filter(|&j| j != i && areas[j] > areas[i] && inside(j, l[0]))
                .count()
        })
        .collect();
    let mut out = vec![];
    let mut outer_ids = vec![];
    for i in 0..loops.len() {
        if depths[i] % 2 == 0 && areas[i] >= min_area {
            outer_ids.push(i);
            out.push(Region {
                outer: loops[i].clone(),
                holes: vec![],
            });
        }
    }
    for i in 0..loops.len() {
        if depths[i] % 2 == 1 && areas[i] >= min_area * 0.5 {
            let mut best = None;
            let mut ba = f64::INFINITY;
            for (k, &j) in outer_ids.iter().enumerate() {
                if areas[j] > areas[i] && areas[j] < ba && inside(j, loops[i][0]) {
                    ba = areas[j];
                    best = Some(k);
                }
            }
            if let Some(k) = best {
                out[k].holes.push(loops[i].clone());
            }
        }
    }
    out
}
fn contours(f: &[f32], w: usize, h: usize, cell: f64, ox: f64, oy: f64) -> Vec<(Polygon, bool)> {
    let mut segs = vec![];
    // At most two segments meet at a grid edge. XOR their one-based IDs:
    // the other segment is adj[edge] ^ (current + 1). Zero denotes an endpoint.
    let mut adj = vec![0_u32; w * h * 2];
    for y in 0..h - 1 {
        for x in 0..w - 1 {
            let i = y * w + x;
            let v = [
                f[i] as f64,
                f[i + 1] as f64,
                f[i + w + 1] as f64,
                f[i + w] as f64,
            ];
            let c = v
                .iter()
                .enumerate()
                .fold(0, |c, (i, &v)| c | if v > 0.5 { 1 << i } else { 0 });
            if c == 0 || c == 15 {
                continue;
            }
            let e = [i * 2, (i + 1) * 2 + 1, (i + w) * 2, i * 2 + 1];
            let mut push = |a: usize, b: usize| {
                let id = (segs.len() + 1) as u32;
                adj[e[a]] ^= id;
                adj[e[b]] ^= id;
                segs.push((e[a], e[b]));
            };
            match c {
                1 | 14 => push(3, 0),
                2 | 13 => push(0, 1),
                3 | 12 => push(3, 1),
                4 | 11 => push(1, 2),
                6 | 9 => push(0, 2),
                7 | 8 => push(3, 2),
                5 | 10 => {
                    let center = v.iter().sum::<f64>() / 4.0 > 0.5;
                    if center == (c == 5) {
                        push(0, 1);
                        push(2, 3);
                    } else {
                        push(3, 0);
                        push(1, 2);
                    }
                }
                _ => (),
            }
        }
    }
    let mut used = vec![false; segs.len()];
    let mut paths = vec![];
    fn walk(
        start: usize,
        id: usize,
        segs: &[(usize, usize)],
        adj: &[u32],
        used: &mut [bool],
    ) -> Vec<usize> {
        let mut ids = vec![id];
        let (mut seg, mut from) = (start, id);
        loop {
            used[seg] = true;
            let (a, b) = segs[seg];
            let to = if a == from { b } else { a };
            ids.push(to);
            let next = adj[to] ^ (seg as u32 + 1);
            if next != 0 && !used[next as usize - 1] {
                seg = next as usize - 1;
                from = to;
            } else {
                break;
            }
        }
        ids
    }
    for (i, &(a, b)) in segs.iter().enumerate() {
        for id in [a, b] {
            if adj[id] == i as u32 + 1 && !used[i] {
                paths.push((walk(i, id, &segs, &adj, &mut used), false));
            }
        }
    }
    for i in 0..segs.len() {
        if !used[i] {
            let mut ids = walk(i, segs[i].0, &segs, &adj, &mut used);
            if ids.first() == ids.last() {
                ids.pop();
            }
            paths.push((ids, true));
        }
    }
    paths
        .into_iter()
        .map(|(ids, c)| {
            (
                ids.into_iter()
                    .map(|id| {
                        let base = id >> 1;
                        let (x, y) = (base % w, base / w);
                        let (x2, y2) = if id & 1 == 1 { (x, y + 1) } else { (x + 1, y) };
                        let (a, b) = (f[y * w + x] as f64, f[y2 * w + x2] as f64);
                        let t = if a == b {
                            0.5
                        } else {
                            ((0.5 - a) / (b - a)).clamp(0.0, 1.0)
                        };
                        p(
                            ox + (x as f64 + (x2 - x) as f64 * t) * cell,
                            oy + (y as f64 + (y2 - y) as f64 * t) * cell,
                        )
                    })
                    .collect(),
                c,
            )
        })
        .collect()
}
