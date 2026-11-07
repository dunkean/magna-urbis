use super::*;
pub(super) fn resample(xs: &[f64], ys: &[f64], step: f64) -> (Vec<f64>, Vec<f64>) {
    let (mut ox, mut oy, mut s) = (Vec::new(), Vec::new(), Vec::new());
    resample_into(xs, ys, step, &mut ox, &mut oy, &mut s);
    (ox, oy)
}
pub(super) fn resample_into(xs: &[f64], ys: &[f64], step: f64, ox: &mut Vec<f64>, oy: &mut Vec<f64>, s: &mut Vec<f64>) {
    let n = xs.len();
    s.resize(n, 0.0);
    s[0] = 0.0;
    for i in 1..n {
        let (dx, dy) = (xs[i] - xs[i - 1], ys[i] - ys[i - 1]);
        s[i] = s[i - 1] + (dx * dx + dy * dy).sqrt()
    }
    let length = s[n - 1];
    let m = (length / step + 0.5).floor().max(1.0) as usize;
    ox.resize(m + 1, 0.0);
    oy.resize(m + 1, 0.0);
    ox[0] = xs[0];
    oy[0] = ys[0];
    let mut k = 0;
    for j in 1..m {
        let t = length * j as f64 / m as f64;
        while k < n - 2 && s[k + 1] < t {
            k += 1
        }
        let f = (t - s[k]) / (s[k + 1] - s[k]).max(1e-9);
        ox[j] = xs[k] + (xs[k + 1] - xs[k]) * f;
        oy[j] = ys[k] + (ys[k + 1] - ys[k]) * f
    }
    ox[m] = xs[n - 1];
    oy[m] = ys[n - 1];
}
pub(super) fn smooth_chain(xs: &[f64], ys: &[f64], sigma: f64) -> (Vec<f64>, Vec<f64>) {
    let n = xs.len();
    let radius = (2.5 * sigma).ceil() as usize;
    let weights: Vec<f64> = (0..=radius)
        .map(|k| (-(k as f64) * (k as f64) / (2.0 * sigma * sigma)).exp())
        .collect();
    let (mut ox, mut oy) = (xs.to_vec(), ys.to_vec());
    for i in 1..n.saturating_sub(1) {
        let r = radius.min(i).min(n - 1 - i);
        let (mut sx, mut sy, mut sw) = (xs[i], ys[i], 1.0);
        for k in 1..=r {
            sx += weights[k] * (xs[i - k] + xs[i + k]);
            sy += weights[k] * (ys[i - k] + ys[i + k]);
            sw += 2.0 * weights[k]
        }
        ox[i] = sx / sw;
        oy[i] = sy / sw
    }
    (ox, oy)
}
pub(super) fn spline(xs: &[f64], ys: &[f64], step: f64) -> (Vec<f64>, Vec<f64>) {
    let n = xs.len();
    if n == 0 {
        return (Vec::new(), Vec::new());
    }
    let (mut ox, mut oy) = (vec![xs[0]], vec![ys[0]]);
    for i in 0..n - 1 {
        let i0 = i.saturating_sub(1);
        let i3 = (i + 2).min(n - 1);
        let (x0, y0) = if i0 < i {
            (xs[i0], ys[i0])
        } else {
            (2.0 * xs[i] - xs[i + 1], 2.0 * ys[i] - ys[i + 1])
        };
        let (x3, y3) = if i3 > i + 1 {
            (xs[i3], ys[i3])
        } else {
            (2.0 * xs[i + 1] - xs[i], 2.0 * ys[i + 1] - ys[i])
        };
        let (x1, y1, x2, y2) = (xs[i], ys[i], xs[i + 1], ys[i + 1]);
        let nz = |v: f64| if v == 0.0 { 1e-6 } else { v };
        let t1 = nz((x1 - x0).hypot(y1 - y0).sqrt());
        let t2 = t1 + nz((x2 - x1).hypot(y2 - y1).sqrt());
        let t3 = t2 + nz((x3 - x2).hypot(y3 - y2).sqrt());
        let m = ((x2 - x1).hypot(y2 - y1) / step).ceil() as usize;
        for j in 1..m {
            let t = t1 + (t2 - t1) * j as f64 / m as f64;
            let (ax1, ay1) = (((t1 - t) * x0 + t * x1) / t1, ((t1 - t) * y0 + t * y1) / t1);
            let (ax2, ay2) = (
                ((t2 - t) * x1 + (t - t1) * x2) / (t2 - t1),
                ((t2 - t) * y1 + (t - t1) * y2) / (t2 - t1),
            );
            let (ax3, ay3) = (
                ((t3 - t) * x2 + (t - t2) * x3) / (t3 - t2),
                ((t3 - t) * y2 + (t - t2) * y3) / (t3 - t2),
            );
            let (bx1, by1) = (
                ((t2 - t) * ax1 + t * ax2) / t2,
                ((t2 - t) * ay1 + t * ay2) / t2,
            );
            let (bx2, by2) = (
                ((t3 - t) * ax2 + (t - t1) * ax3) / (t3 - t1),
                ((t3 - t) * ay2 + (t - t1) * ay3) / (t3 - t1),
            );
            ox.push(((t2 - t) * bx1 + (t - t1) * bx2) / (t2 - t1));
            oy.push(((t2 - t) * by1 + (t - t1) * by2) / (t2 - t1))
        }
        ox.push(x2);
        oy.push(y2)
    }
    (ox, oy)
}
pub(super) fn hermite(
    a: (f64, f64),
    ta: (f64, f64),
    b: (f64, f64),
    tb: (f64, f64),
    step: f64,
) -> (Vec<f64>, Vec<f64>) {
    let m = ((b.0 - a.0).hypot(b.1 - a.1) / step).ceil().max(2.0) as usize;
    let (mut xs, mut ys) = (Vec::new(), Vec::new());
    for j in 0..=m {
        let t = j as f64 / m as f64;
        let (t2, t3) = (t * t, t * t * t);
        let (h00, h10, h01, h11) = (
            2.0 * t3 - 3.0 * t2 + 1.0,
            t3 - 2.0 * t2 + t,
            -2.0 * t3 + 3.0 * t2,
            t3 - t2,
        );
        xs.push(h00 * a.0 + h10 * ta.0 + h01 * b.0 + h11 * tb.0);
        ys.push(h00 * a.1 + h10 * ta.1 + h01 * b.1 + h11 * tb.1)
    }
    (xs, ys)
}
pub(super) fn thalweg(
    xs: &mut [f64],
    ys: &mut [f64],
    limit: &[f64],
    ctx: &Context,
    shore: usize,
    reach: f64,
    iterations: usize,
) {
    let n = xs.len();
    if n < 3 {
        return;
    }
    let mut zs = vec![f64::NAN; n];
    let (mut nx, mut ny, mut nz) = (xs.to_vec(), ys.to_vec(), zs.clone());
    let offsets = [-1.0, -0.5, 0.5, 1.0];
    let fits = |i: usize, x: f64, y: f64, z: f64, xs: &[f64], ys: &[f64]| {
        z <= limit[i] && (i >= shore || !ctx.wet(x, y, Some(z)) || ctx.wet(xs[i], ys[i], None))
    };
    for it in 0..iterations {
        nx.copy_from_slice(xs);
        ny.copy_from_slice(ys);
        nz.copy_from_slice(&zs);
        for i in 1..n - 1 {
            let (dx, dy) = (
                (xs[i - 1] + xs[i + 1]) / 2.0 - xs[i],
                (ys[i - 1] + ys[i + 1]) / 2.0 - ys[i],
            );
            for f in [0.5, 0.25, 0.125, 0.0625] {
                let (px, py) = (xs[i] + dx * f, ys[i] + dy * f);
                let z = ctx.terrain(px, py);
                if fits(i, px, py, z, xs, ys) {
                    nx[i] = px;
                    ny[i] = py;
                    nz[i] = z;
                    break;
                }
            }
        }
        xs.copy_from_slice(&nx);
        ys.copy_from_slice(&ny);
        std::mem::swap(&mut zs, &mut nz);
        if it as f64 >= 0.75 * iterations as f64 {
            continue;
        }
        if it % 2 != 0 {
            for i in 1..n - 1 {
                let (x, y, h) = (xs[i - 1], ys[i - 1], reach);
                let (gx, gy) = (
                    (ctx.terrain(x + h, y) - ctx.terrain(x - h, y)) / (2.0 * h),
                    (ctx.terrain(x, y + h) - ctx.terrain(x, y - h)) / (2.0 * h),
                );
                let g = (gx * gx + gy * gy).sqrt();
                if g < 0.002 {
                    continue;
                }
                let (tx, ty) = (xs[i + 1] - xs[i - 1], ys[i + 1] - ys[i - 1]);
                let tl = nonzero((tx * tx + ty * ty).sqrt());
                let (fx, fy) = (-gx / g, -gy / g);
                if (fx * tx + fy * ty) / tl < 0.5 {
                    continue;
                }
                let d = (xs[i] - x).hypot(ys[i] - y);
                let (ox, oy) = (ty / tl, -tx / tl);
                let shift = (((x + fx * d - xs[i]) * ox + (y + fy * d - ys[i]) * oy) / 2.0)
                    .clamp(-reach / 2.0, reach / 2.0);
                let (px, py) = (xs[i] + ox * shift, ys[i] + oy * shift);
                let z = ctx.terrain(px, py);
                if fits(i, px, py, z, xs, ys) {
                    xs[i] = px;
                    ys[i] = py;
                    zs[i] = z
                }
            }
            continue;
        }
        for i in 1..n - 1 {
            let (tx, ty) = (xs[i + 1] - xs[i - 1], ys[i + 1] - ys[i - 1]);
            let tl = nonzero((tx * tx + ty * ty).sqrt());
            let (ox, oy) = (ty / tl, -tx / tl);
            let mut best = if zs[i].is_nan() {
                ctx.terrain(xs[i], ys[i])
            } else {
                zs[i]
            } - 0.02;
            let mut bt = 0.0;
            for t in offsets {
                let (x, y) = (xs[i] + ox * t * reach, ys[i] + oy * t * reach);
                let z = ctx.terrain(x, y);
                if z < best && fits(i, x, y, z, xs, ys) {
                    best = z;
                    bt = t
                }
            }
            if bt != 0.0 {
                xs[i] += ox * bt * reach;
                ys[i] += oy * bt * reach;
                zs[i] = best
            }
        }
    }
}
pub(super) fn profile(xs: &[f64], ys: &[f64], valley: &dyn Fn(f64, f64) -> f64) -> Vec<f64> {
    let mut level = f64::INFINITY;
    xs.iter()
        .zip(ys)
        .map(|(&x, &y)| {
            level = level.min(valley(x, y));
            level
        })
        .collect()
}
pub(super) fn valley_grid(
    xs: &[f64],
    ys: &[f64],
    us: &[f64],
    from: usize,
    to: usize,
    level_at: &dyn Fn(f64) -> f64,
    cell: f64,
    n: usize,
    outside: f64,
) -> impl Fn(f64, f64) -> f64 + use<> {
    let (mut x0, mut y0, mut x1, mut y1) = (isize::MAX, isize::MAX, isize::MIN, isize::MIN);
    for k in from..=to {
        let (gx, gy) = (
            (xs[k] / cell).floor() as isize,
            (ys[k] / cell).floor() as isize,
        );
        x0 = x0.min(gx);
        y0 = y0.min(gy);
        x1 = x1.max(gx);
        y1 = y1.max(gy)
    }
    x0 = (x0 - 16).max(0);
    y0 = (y0 - 16).max(0);
    x1 = (x1 + 16).min(n as isize - 1);
    y1 = (y1 + 16).min(n as isize - 1);
    let (w, hgt) = ((x1 - x0 + 1) as usize, (y1 - y0 + 1) as usize);
    let mut level = vec![f64::NAN; w * hgt];
    let mut queue = Vec::new();
    for k in from..=to {
        let c = ((ys[k] / cell).floor() as isize - y0) * w as isize
            + (xs[k] / cell).floor() as isize
            - x0;
        // A fixed node can sit on the outer map border. The TS typed-array
        // write at an out-of-range index is ignored (and never enqueued).
        if c < 0 || c >= level.len() as isize {
            continue;
        }
        let c = c as usize;
        let z = level_at(us[k]);
        if level[c].is_nan() {
            level[c] = z;
            queue.push(c)
        } else {
            level[c] = level[c].min(z)
        }
    }
    let mut head = 0;
    while head < queue.len() {
        let c = queue[head];
        head += 1;
        let (x, y) = ((c % w) as isize, (c / w) as isize);
        for k in 0..8 {
            let (xx, yy) = (x + DX[k], y + DY[k]);
            if xx < 0 || yy < 0 || xx >= w as isize || yy >= hgt as isize {
                continue;
            }
            let nb = yy as usize * w + xx as usize;
            if level[nb].is_nan() {
                level[nb] = level[c];
                queue.push(nb)
            }
        }
    }
    move |x, y| {
        let (gx, gy) = (
            (x / cell).floor() as isize - x0,
            (y / cell).floor() as isize - y0,
        );
        if gx < 0 || gy < 0 || gx >= w as isize || gy >= hgt as isize {
            outside
        } else {
            level[gy as usize * w + gx as usize]
        }
    }
}
pub(super) fn find_cutoff(
    xs: &[f64],
    ys: &[f64],
    distance: f64,
    min_gap: usize,
    entry: usize,
    exit: usize,
) -> Option<(usize, usize)> {
    let n = xs.len();
    let mut bins: HashMap<(i32, i32), Vec<usize>> = HashMap::default();
    for i in 0..n {
        bins.entry((
            (xs[i] / distance).floor() as i32,
            (ys[i] / distance).floor() as i32,
        ))
        .or_default()
        .push(i)
    }
    for i in entry..n.saturating_sub(exit) {
        let (gx, gy) = (
            (xs[i] / distance).floor() as i32,
            (ys[i] / distance).floor() as i32,
        );
        let mut best = None;
        for ox in -1..=1 {
            for oy in -1..=1 {
                if let Some(bin) = bins.get(&(gx + ox, gy + oy)) {
                    for &j in bin {
                        if j <= i + min_gap || j >= n - exit || best.is_some_and(|b| j <= b) {
                            continue;
                        }
                        let (dx, dy) = (xs[j] - xs[i], ys[j] - ys[i]);
                        if dx * dx + dy * dy < distance * distance {
                            best = Some(j)
                        }
                    }
                }
            }
        }
        if let Some(j) = best {
            return Some((i, j));
        }
    }
    None
}
pub(super) fn relax(p: &mut [f64], level: &[f64], ctx: &Context, tolerance: f64) {
    let cos40 = (40.0_f64.to_radians()).cos();
    let cos75 = (75.0_f64.to_radians()).cos();
    for _ in 0..12 {
        let mut moved = 0;
        for i in 1..p.len() / 2 - 1 {
            let (ax, ay, bx, by) = (
                p[2 * i] - p[2 * i - 2],
                p[2 * i + 1] - p[2 * i - 1],
                p[2 * i + 2] - p[2 * i],
                p[2 * i + 3] - p[2 * i + 1],
            );
            let (la, lb) = ((ax * ax + ay * ay).sqrt(), (bx * bx + by * by).sqrt());
            let turn = if la != 0.0 && lb != 0.0 {
                (ax * bx + ay * by) / (la * lb)
            } else {
                1.0
            };
            if turn >= cos40 {
                continue;
            }
            let (x, y) = (p[2 * i], p[2 * i + 1]);
            let (mx, my) = (
                (p[2 * i - 2] + p[2 * i + 2]) / 2.0 - x,
                (p[2 * i - 1] + p[2 * i + 3]) / 2.0 - y,
            );
            let ceiling =
                ctx.terrain(x, y).max(level[i] + tolerance) + if turn < cos75 { 0.7 } else { 0.0 };
            for f in [1.0, 0.5, 0.25, 0.125] {
                let (px, py) = (x + mx * f, y + my * f);
                let z = ctx.terrain(px, py);
                if z <= ceiling && (!ctx.wet(px, py, Some(z)) || ctx.wet(x, y, None)) {
                    p[2 * i] = px;
                    p[2 * i + 1] = py;
                    moved += 1;
                    break;
                }
            }
        }
        if moved == 0 {
            break;
        }
    }
}
pub(super) fn unfold(p: &mut Vec<f64>, values: &mut [&mut Vec<f64>]) {
    let mut i = 0;
    while 2 * i + 2 < p.len() {
        let mut arc = 0.0;
        for j in i + 1..=(i + 10).min(p.len() / 2 - 1) {
            arc += (p[2 * j] - p[2 * j - 2]).hypot(p[2 * j + 1] - p[2 * j - 1]);
            if j - i < 2 || arc < 10.0 {
                continue;
            }
            if (p[2 * j] - p[2 * i]).hypot(p[2 * j + 1] - p[2 * i + 1]) < 0.25 * arc {
                p.drain(2 * i + 2..2 * j);
                for v in values.iter_mut() {
                    v.drain(i + 1..j);
                }
                break;
            }
        }
        i += 1
    }
}
pub(super) fn despike(p: &mut Vec<f64>, values: &mut [&mut Vec<f64>]) {
    loop {
        let mut removed = false;
        let mut i = 1;
        while 2 * i + 3 < p.len() {
            let (ax, ay, bx, by) = (
                p[2 * i] - p[2 * i - 2],
                p[2 * i + 1] - p[2 * i - 1],
                p[2 * i + 2] - p[2 * i],
                p[2 * i + 3] - p[2 * i + 1],
            );
            let (la, lb) = (ax * ax + ay * ay, bx * bx + by * by);
            if la > 0.0 && lb > 0.0 && ax * bx + ay * by >= -0.5 * (la * lb).sqrt() {
                i += 1;
                continue;
            }
            p.drain(2 * i..2 * i + 2);
            for v in values.iter_mut() {
                v.remove(i);
            }
            removed = true;
        }
        if !removed {
            break;
        }
    }
}
pub(super) fn uncross(p: &mut Vec<f64>, size: f64, values: &mut [&mut Vec<f64>]) {
    for _ in 0..100 {
        let mut bins: HashMap<i64, Vec<usize>> = HashMap::default();
        let mut cut = None;
        for i in 0..p.len() / 2 - 1 {
            let (ax, ay) = (p[2 * i], p[2 * i + 1]);
            let (rx, ry) = (p[2 * i + 2] - ax, p[2 * i + 3] - ay);
            let (x0, x1) = (
                (ax.min(ax + rx) / size).floor() as i64,
                (ax.max(ax + rx) / size).floor() as i64,
            );
            let (y0, y1) = (
                (ay.min(ay + ry) / size).floor() as i64,
                (ay.max(ay + ry) / size).floor() as i64,
            );
            let mut first = usize::MAX;
            let (mut cx, mut cy) = (0.0, 0.0);
            for gx in x0..=x1 {
                for gy in y0..=y1 {
                    if let Some(bin) = bins.get(&(gx * 1048576 + gy)) {
                        for &j in bin {
                            if j + 1 >= i || j >= first {
                                continue;
                            }
                            let (bx, by) = (p[2 * j], p[2 * j + 1]);
                            let (sx, sy) = (p[2 * j + 2] - bx, p[2 * j + 3] - by);
                            let den = rx * sy - ry * sx;
                            if den.abs() < 1e-12 {
                                continue;
                            }
                            let (t, u) = (
                                ((bx - ax) * sy - (by - ay) * sx) / den,
                                ((bx - ax) * ry - (by - ay) * rx) / den,
                            );
                            if (0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&u) {
                                first = j;
                                cx = ax + rx * t;
                                cy = ay + ry * t
                            }
                        }
                    }
                }
            }
            if first != usize::MAX {
                cut = Some((first, i, cx, cy));
                break;
            }
            for gx in x0..=x1 {
                for gy in y0..=y1 {
                    bins.entry(gx * 1048576 + gy).or_default().push(i)
                }
            }
        }
        let Some((j, i, cx, cy)) = cut else { return };
        p.splice(2 * j + 2..2 * i + 2, [cx, cy]);
        for v in values.iter_mut() {
            let value = v[i];
            v.splice(j + 1..i + 1, [value]);
        }
    }
}
pub(super) struct Near {
    pub d: f64,
    pub x: f64,
    pub y: f64,
    pub line: usize,
    pub index: usize,
}
pub(super) struct SegmentIndex {
    size: f64,
    bins: HashMap<i64, Vec<usize>>,
    segments: Vec<[f64; 4]>,
    owners: Vec<(usize, usize)>,
}
impl SegmentIndex {
    pub fn new(size: f64) -> Self {
        Self {
            size,
            bins: HashMap::default(),
            segments: Vec::new(),
            owners: Vec::new(),
        }
    }
    pub fn add(&mut self, p: &[f64], line: usize) {
        for i in (0..p.len().saturating_sub(3)).step_by(2) {
            let id = self.segments.len();
            self.segments.push([p[i], p[i + 1], p[i + 2], p[i + 3]]);
            self.owners.push((line, i / 2));
            for gx in (p[i].min(p[i + 2]) / self.size).floor() as i64
                ..=(p[i].max(p[i + 2]) / self.size).floor() as i64
            {
                for gy in (p[i + 1].min(p[i + 3]) / self.size).floor() as i64
                    ..=(p[i + 1].max(p[i + 3]) / self.size).floor() as i64
                {
                    self.bins.entry(gx * 1048576 + gy).or_default().push(id)
                }
            }
        }
    }
    pub fn crossing(&self, ax: f64, ay: f64, bx: f64, by: f64) -> f64 {
        let mut first = f64::INFINITY;
        for gx in (ax.min(bx) / self.size).floor() as i64..=(ax.max(bx) / self.size).floor() as i64
        {
            for gy in
                (ay.min(by) / self.size).floor() as i64..=(ay.max(by) / self.size).floor() as i64
            {
                if let Some(bin) = self.bins.get(&(gx * 1048576 + gy)) {
                    for &i in bin {
                        let p = self.segments[i];
                        let (cx, cy, rx, ry, sx, sy) =
                            (p[0], p[1], bx - ax, by - ay, p[2] - p[0], p[3] - p[1]);
                        let den = rx * sy - ry * sx;
                        if den.abs() < 1e-12 {
                            continue;
                        }
                        let (t, u) = (
                            ((cx - ax) * sy - (cy - ay) * sx) / den,
                            ((cx - ax) * ry - (cy - ay) * rx) / den,
                        );
                        if (0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&u) && t < first {
                            first = t
                        }
                    }
                }
            }
        }
        first
    }
    pub fn nearest(&self, x: f64, y: f64, radius: f64) -> Option<Near> {
        let mut best: Option<Near> = None;
        for gx in
            ((x - radius) / self.size).floor() as i64..=((x + radius) / self.size).floor() as i64
        {
            for gy in ((y - radius) / self.size).floor() as i64
                ..=((y + radius) / self.size).floor() as i64
            {
                if let Some(bin) = self.bins.get(&(gx * 1048576 + gy)) {
                    for &i in bin {
                        let p = self.segments[i];
                        let (ax, ay, dx, dy) = (p[0], p[1], p[2] - p[0], p[3] - p[1]);
                        let t = (((x - ax) * dx + (y - ay) * dy) / nonzero(dx * dx + dy * dy))
                            .clamp(0.0, 1.0);
                        let (qx, qy) = (ax + dx * t, ay + dy * t);
                        let d = (qx - x).hypot(qy - y);
                        if d <= radius && best.as_ref().map_or(true, |b| d < b.d) {
                            best = Some(Near {
                                d,
                                x: qx,
                                y: qy,
                                line: self.owners[i].0,
                                index: self.owners[i].1,
                            })
                        }
                    }
                }
            }
        }
        best
    }
}
pub(super) fn nearest_on_line(p: &[f64], x: f64, y: f64) -> (f64, f64) {
    let (mut best, mut bx, mut by) = (f64::INFINITY, p[0], p[1]);
    for i in (0..p.len().saturating_sub(3)).step_by(2) {
        let (ax, ay, dx, dy) = (p[i], p[i + 1], p[i + 2] - p[i], p[i + 3] - p[i + 1]);
        let t = (((x - ax) * dx + (y - ay) * dy) / nonzero(dx * dx + dy * dy)).clamp(0.0, 1.0);
        let (px, py) = (ax + dx * t, ay + dy * t);
        let d = (px - x).powi(2) + (py - y).powi(2);
        if d < best {
            best = d;
            bx = px;
            by = py
        }
    }
    (bx, by)
}
pub(super) fn interleave(xs: &[f64], ys: &[f64]) -> Vec<f64> {
    xs.iter().zip(ys).flat_map(|(&x, &y)| [x, y]).collect()
}
