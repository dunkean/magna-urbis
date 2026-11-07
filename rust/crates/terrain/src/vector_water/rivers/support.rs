use super::*;
impl Context<'_> {
    pub(super) fn floor_path(
        &self,
        from: usize,
        targets: &HashSet<usize>,
        bounds: (usize, usize, usize, usize),
        lowest: f64,
        allow_water: bool,
    ) -> Option<Vec<usize>> {
        let (x0, y0, x1, y1) = bounds;
        let n = self.h.n;
        let w = x1 - x0 + 1;
        let size = w * (y1 - y0 + 1);
        let local = |c: usize| (c / n - y0) * w + c % n - x0;
        let mut target = vec![false; size];
        for &c in targets {
            target[local(c)] = true;
        }
        let mut cost = vec![f64::INFINITY; size];
        let mut previous = vec![-1_i32; size];
        let mut heap = Heap::new(false);
        cost[local(from)] = 0.0;
        heap.push(from, 0.0);
        while let Some((c, _)) = heap.pop() {
            let lc = local(c);
            if target[lc] {
                let mut path = vec![c];
                let mut k = previous[lc];
                while k >= 0 {
                    path.push((y0 + k as usize / w) * n + x0 + k as usize % w);
                    k = previous[k as usize]
                }
                path.reverse();
                return Some(path);
            }
            for (nb, d) in neighbours(c, n) {
                let (x, y) = (nb % n, nb / n);
                if x < x0 || y < y0 || x > x1 || y > y1 {
                    continue;
                }
                let lnb = local(nb);
                let g = &self.h.grids;
                let z = self.h.height[nb] as f64;
                if (!allow_water && self.still[nb] != 0)
                    || (allow_water && z > g.filled[from] as f64 + 0.01)
                    || ((g.filled[nb] as f64 - z) <= 0.01 && !target[lnb])
                {
                    continue;
                }
                let step = d * (1.0 + (z - lowest).max(0.0) / 5.0);
                if cost[lc] + step < cost[lnb] {
                    cost[lnb] = cost[lc] + step;
                    previous[lnb] = lc as i32;
                    heap.push(nb, cost[lnb])
                }
            }
        }
        None
    }
    pub(super) fn across_beds(
        &self,
        cells: Vec<usize>,
        parent: Option<&[usize]>,
        bed: &mut HashSet<usize>,
        allow_water: bool,
    ) -> Vec<usize> {
        let n = self.h.n;
        let g = &self.h.grids;
        let height = &self.h.height;
        let mut result = cells;
        let on_parent: HashSet<usize> = parent.unwrap_or(&[]).iter().copied().collect();
        let parent_in = |bounds: (usize, usize, usize, usize)| -> HashSet<usize> {
            let (x0, y0, x1, y1) = bounds;
            parent
                .unwrap_or(&[])
                .iter()
                .copied()
                .filter(|&c| c % n >= x0 && c % n <= x1 && c / n >= y0 && c / n <= y1)
                .collect()
        };
        let bounds = |cells: &[usize], entry: usize, exit: usize, margin: usize| {
            let (mut x0, mut y0, mut x1, mut y1, mut lowest) = (n, n, 0, 0, f64::INFINITY);
            for &c in &cells[entry..=exit] {
                x0 = x0.min(c % n);
                x1 = x1.max(c % n);
                y0 = y0.min(c / n);
                y1 = y1.max(c / n);
                lowest = lowest.min(height[c] as f64)
            }
            (
                (
                    x0.saturating_sub(margin),
                    y0.saturating_sub(margin),
                    (x1 + margin).min(n - 1),
                    (y1 + margin).min(n - 1),
                ),
                lowest,
            )
        };
        let mut i = 0;
        while i < result.len() {
            if g.filled[result[i]] as f64 - height[result[i]] as f64 <= 3.0 {
                i += 1;
                continue;
            }
            let mut j = i;
            while i > 0 && g.filled[result[i - 1]] as f64 - height[result[i - 1]] as f64 > 0.01 {
                i -= 1
            }
            while j + 1 < result.len()
                && g.filled[result[j + 1]] as f64 - height[result[j + 1]] as f64 > 0.01
            {
                j += 1
            }
            let entry = i.saturating_sub(1);
            let exit = (j + 1).min(result.len() - 1);
            let (b, lowest) = bounds(&result, entry, exit, 24);
            let mut targets = if exit == result.len() - 1 {
                parent_in(b)
            } else {
                HashSet::default()
            };
            let mut path = if !targets.is_empty() && !on_parent.contains(&result[exit]) {
                self.floor_path(result[entry], &targets, b, lowest, allow_water)
            } else {
                None
            };
            if path.is_none() {
                targets.insert(result[exit]);
                path = self.floor_path(result[entry], &targets, b, lowest, allow_water)
            }
            let Some(path) = path.filter(|p| p.len() >= 2) else {
                i = j + 1;
                continue;
            };
            for &c in &path[1..path.len() - 1] {
                bed.insert(c);
            }
            let mut next = result[..entry].to_vec();
            next.extend_from_slice(&path);
            if *path.last().unwrap() == result[exit] {
                next.extend_from_slice(&result[exit + 1..])
            }
            result = next;
            i = entry + path.len();
        }
        if let Some(_) = parent {
            let last = result.len().saturating_sub(1);
            if last > 0
                && !on_parent.contains(&result[last])
                && g.filled[result[last]] as f64 - height[result[last]] as f64 > 0.01
            {
                let mut i = last;
                while i > 0 && g.filled[result[i - 1]] as f64 - height[result[i - 1]] as f64 > 0.01
                {
                    i -= 1
                }
                let entry = i.saturating_sub(1);
                let (b, lowest) = bounds(&result, entry, last, 64);
                let targets = parent_in(b);
                if !targets.is_empty() {
                    if let Some(path) = self
                        .floor_path(result[entry], &targets, b, lowest, allow_water)
                        .filter(|p| p.len() >= 2)
                    {
                        for &c in &path[1..path.len() - 1] {
                            bed.insert(c);
                        }
                        result.truncate(entry);
                        result.extend(path)
                    }
                }
            }
        }
        result
    }
    pub(super) fn to_standing(&self, from: usize) -> Vec<usize> {
        let n = self.h.n;
        let g = &self.h.grids;
        let mut downstream = Vec::new();
        let mut visited = [from].into_iter().collect::<HashSet<_>>();
        let mut c = g.receiver[from];
        while c >= 0 && !visited.contains(&(c as usize)) {
            let at = c as usize;
            visited.insert(at);
            downstream.push(at);
            if self.standing[at] != 0 {
                return downstream;
            }
            if g.filled[at] != g.filled[from] {
                break;
            }
            c = g.receiver[at]
        }
        let mut previous = [(from, -1_i32)].into_iter().collect::<HashMap<_, _>>();
        let mut queue = vec![from];
        let mut i = 0;
        while i < queue.len() {
            let c = queue[i];
            i += 1;
            if self.standing[c] != 0 {
                let mut path = Vec::new();
                let mut k = c;
                while k != from {
                    path.push(k);
                    k = previous[&k] as usize
                }
                path.reverse();
                return path;
            }
            for (nb, _) in neighbours(c, n) {
                if self.still[nb] != 0 && !previous.contains_key(&nb) {
                    previous.insert(nb, c as i32);
                    queue.push(nb)
                }
            }
        }
        Vec::new()
    }
    pub(super) fn reangle(
        &self,
        out: &mut Vec<f64>,
        us: &mut Vec<f64>,
        kind: &mut Vec<f64>,
        lv: &mut Vec<f64>,
        target: &Line,
        angle: f64,
        width: f64,
        traced: &SegmentIndex,
    ) {
        let m = out.len() / 2 - 1;
        let tp = &target.points;
        if m < 3 {
            return;
        }
        let (jx, jy) = (out[2 * m], out[2 * m + 1]);
        let (mut best, mut pk) = (f64::INFINITY, 0);
        for k in (0..tp.len() - 3).step_by(2) {
            let (ax, ay, dx, dy) = (tp[k], tp[k + 1], tp[k + 2] - tp[k], tp[k + 3] - tp[k + 1]);
            let t =
                (((jx - ax) * dx + (jy - ay) * dy) / nonzero(dx * dx + dy * dy)).clamp(0.0, 1.0);
            let d = (ax + dx * t - jx).hypot(ay + dy * t - jy);
            if d < best {
                best = d;
                pk = k
            }
        }
        if best > self.cell {
            return;
        }
        let (k0, k1) = (pk.saturating_sub(4), (pk + 6).min(tp.len() - 2));
        let (mut px, mut py) = (tp[k1] - tp[k0], tp[k1 + 1] - tp[k0 + 1]);
        let pl = px.hypot(py);
        if pl < 1e-6 {
            return;
        }
        px /= pl;
        py /= pl;
        let reach = (2.0 * self.cell).max((8.0 * self.cell).min(3.0 * width));
        let (mut k, mut arc) = (m, 0.0);
        while k > 1 && arc < reach {
            arc += (out[2 * k] - out[2 * k - 2]).hypot(out[2 * k + 1] - out[2 * k - 1]);
            k -= 1
        }
        if arc < 1.5 * self.cell {
            return;
        }
        let (ax, ay) = (out[2 * k], out[2 * k + 1]);
        let (vx, vy) = (ax - jx, ay - jy);
        let along = vx * px + vy * py;
        let (mut nx, mut ny) = (vx - along * px, vy - along * py);
        let nl = nx.hypot(ny);
        if nl < 0.2 * arc {
            return;
        }
        nx /= nl;
        ny /= nl;
        let theta = angle.to_radians();
        let (tx, ty) = (
            theta.cos() * px - theta.sin() * nx,
            theta.cos() * py - theta.sin() * ny,
        );
        let (sx, sy) = (
            out[2 * k + 2] - out[2 * k - 2],
            out[2 * k + 3] - out[2 * k - 1],
        );
        let sl = nonzero(sx.hypot(sy));
        let (hx, hy) = hermite(
            (ax, ay),
            (sx / sl * arc, sy / sl * arc),
            (jx, jy),
            (tx * arc, ty * arc),
            self.cell / 3.0,
        );
        let mut ceiling = f64::NEG_INFINITY;
        for j in k..=m {
            ceiling = ceiling.max(self.terrain(out[2 * j], out[2 * j + 1]))
        }
        for j in 1..hx.len() {
            if self.terrain(hx[j], hy[j]) > ceiling + 0.25 || self.wet(hx[j], hy[j], None) {
                return;
            }
            if j < hx.len() - 2 && traced.crossing(hx[j - 1], hy[j - 1], hx[j], hy[j]) <= 1.0 {
                return;
            }
        }
        let (u, z) = (us[m], lv[m]);
        out.truncate(2 * k + 2);
        us.truncate(k + 1);
        kind.truncate(k + 1);
        lv.truncate(k + 1);
        for j in 1..hx.len() {
            out.extend([hx[j], hy[j]]);
            us.push(u);
            kind.push(2.0);
            lv.push(z)
        }
    }
}
pub(super) fn side_channels(
    mx: &[f64],
    my: &[f64],
    ax: &[f64],
    ay: &[f64],
    width: f64,
    fits: &dyn Fn(f64, f64) -> bool,
    mut r: Rng,
    cell: f64,
) -> Vec<(Vec<f64>, Vec<f64>)> {
    let (sx, sy) = smooth_chain(ax, ay, 6.0);
    let m = sx.len();
    let mut arc = vec![0.0; m];
    for k in 1..m {
        arc[k] = arc[k - 1] + (sx[k] - sx[k - 1]).hypot(sy[k] - sy[k - 1])
    }
    let total = arc[m - 1];
    let main = interleave(mx, my);
    let mut index = SegmentIndex::new((4.0 * width).max(cell));
    index.add(&main, 0);
    let at = |s: f64| {
        let mut k = 0;
        while k < m - 2 && arc[k + 1] < s {
            k += 1
        }
        let f = (s - arc[k]) / (arc[k + 1] - arc[k]).max(1e-9);
        let (tx, ty) = (sx[k + 1] - sx[k], sy[k + 1] - sy[k]);
        let tl = nonzero(tx.hypot(ty));
        (sx[k] + tx * f, sy[k] + ty * f, ty / tl, -tx / tl)
    };
    let mut result = Vec::new();
    let mut s0 = r.range(10.0, 30.0) * width;
    while s0 + 20.0 * width < total - 10.0 * width {
        let s1 = (total - 10.0 * width).min(s0 + r.range(20.0, 50.0) * width);
        if s1 - s0 < 15.0 * width {
            break;
        }
        if r.chance(0.6) {
            let b = r.range(2.5, 5.0) * width;
            let phase = r.range(0.0, std::f64::consts::TAU);
            let sides = if r.chance(0.5) {
                [1.0, -1.0]
            } else {
                [-1.0, 1.0]
            };
            for side in sides {
                let steps = ((s1 - s0) / (0.75 * width)).ceil() as usize;
                let (mut xs, mut ys) = (Vec::new(), Vec::new());
                let mut ok = true;
                for j in 0..=steps {
                    if !ok {
                        break;
                    }
                    let t = j as f64 / steps as f64;
                    let (x, y, nx, ny) = at(s0 + (s1 - s0) * t);
                    if j == 0 || j == steps {
                        let (qx, qy) = nearest_on_line(&main, x, y);
                        xs.push(qx);
                        ys.push(qy);
                        continue;
                    }
                    let o = side * b * (std::f64::consts::PI * t).sin().powf(0.6)
                        + 0.4
                            * width
                            * (std::f64::consts::TAU * (s0 + (s1 - s0) * t) / (8.0 * width)
                                + phase)
                                .sin()
                            * (std::f64::consts::PI * t).sin();
                    xs.push(x + nx * o);
                    ys.push(y + ny * o);
                    ok = fits(x + nx * o, y + ny * o)
                }
                for j in 2..xs.len().saturating_sub(1) {
                    if !ok {
                        break;
                    }
                    ok = index.crossing(xs[j - 1], ys[j - 1], xs[j], ys[j]) > 1.0
                }
                if !ok {
                    continue;
                }
                result.push(spline(&xs, &ys, cell / 3.0));
                break;
            }
        }
        s0 = s1 + r.range(20.0, 60.0) * width
    }
    result
}
pub(super) fn braid_threads(
    ctx: &Context,
    out: &[f64],
    lv: &[f64],
    area: &[f64],
    k0: usize,
    k1: usize,
    id: usize,
    mut r: Rng,
    s: &Settings,
) -> Option<(Vec<Line>, usize, f64)> {
    let m = k1 - k0 + 1;
    if m < 6 {
        return None;
    }
    let mut arc = vec![0.0; m];
    for k in k0 + 1..=k1 {
        arc[k - k0] =
            arc[k - k0 - 1] + (out[2 * k] - out[2 * k - 2]).hypot(out[2 * k + 1] - out[2 * k - 1])
    }
    let width = channel_width(area[(k0 + k1) / 2], s.width_scale).max(0.5 * ctx.cell);
    let length = arc[m - 1];
    if length < 15.0 * width {
        return None;
    }
    let normal = |k: usize| {
        let a = k.saturating_sub(2);
        let b = (k + 2).min(out.len() / 2 - 1);
        let (tx, ty) = (out[2 * b] - out[2 * a], out[2 * b + 1] - out[2 * a + 1]);
        let tl = nonzero(tx.hypot(ty));
        (ty / tl, -tx / tl)
    };
    let depth = 0.5 + 0.02 * width + 0.5;
    let open =
        |x: f64, y: f64, k: usize| !ctx.wet(x, y, None) && ctx.terrain(x, y) <= lv[k] + depth;
    let (mut left, mut right) = (vec![0.0; m], vec![0.0; m]);
    for j in 0..m {
        let k = k0 + j;
        let (nx, ny) = normal(k);
        let (x, y) = (out[2 * k], out[2 * k + 1]);
        for (side, extent) in [(1.0, &mut right), (-1.0, &mut left)] {
            let mut t = 0.0;
            while t < 8.0 * width
                && open(
                    x + side * nx * (t + 0.5 * width),
                    y + side * ny * (t + 0.5 * width),
                    k,
                )
            {
                t += 0.5 * width
            }
            extent[j] = t
        }
    }
    let smooth = |a: &[f64]| -> Vec<f64> {
        (0..m)
            .map(|j| {
                let mut sum = 0.0;
                let mut w = 0;
                for q in j.saturating_sub(4)..=(j + 4).min(m - 1) {
                    sum += a[q];
                    w += 1
                }
                sum / w as f64
            })
            .collect()
    };
    let (l, rgt) = (smooth(&left), smooth(&right));
    let mut mean = 0.0;
    for j in 0..m {
        mean += l[j] + rgt[j]
    }
    if mean / (m as f64) < 3.0 * width {
        return None;
    }
    let count = if s.braiding >= 2.0 { 3 } else { 2 };
    let seed = r.int(0, 1 << 30);
    let mut threads = Vec::new();
    for q in 0..count {
        let wavelength = r.range(5.0, 10.0) * width;
        let shift = r.range(0.0, 100.0);
        let mut offsets = vec![0.0; m];
        for j in 0..m {
            let k = k0 + j;
            let taper = smoothstep(arc[j].min(length - arc[j]) / (4.0 * width));
            let f = (1.4 * value_noise(arc[j] / wavelength + shift, 17.3 * q as f64 + 0.37, seed))
                .clamp(-1.0, 1.0);
            let mut o = f * if f > 0.0 { rgt[j] } else { l[j] } * 0.85 * taper;
            let (nx, ny) = normal(k);
            for _ in 0..3 {
                if o == 0.0 || open(out[2 * k] + nx * o, out[2 * k + 1] + ny * o, k) {
                    break;
                }
                o /= 2.0
            }
            if !open(out[2 * k] + nx * o, out[2 * k + 1] + ny * o, k) {
                o = 0.0
            }
            offsets[j] = o
        }
        for forward in [true, false] {
            for t in 1..m {
                let j = if forward { t } else { m - 1 - t };
                let p = if forward { j - 1 } else { j + 1 };
                let reach = if sign(offsets[p]) == sign(offsets[j]) {
                    offsets[p].abs()
                } else {
                    0.0
                } + 0.5 * (arc[j] - arc[p]).abs();
                if offsets[j].abs() > reach {
                    offsets[j] = sign(offsets[j]) * reach
                }
            }
        }
        let mut j = 0;
        while j < m {
            if offsets[j] == 0.0 {
                j += 1;
                continue;
            }
            let mut e = j;
            while e + 1 < m && sign(offsets[e + 1]) == sign(offsets[j]) {
                e += 1
            }
            let mut peak = 0.0_f64;
            for t in j..=e {
                peak = peak.max(offsets[t].abs())
            }
            let a = j.saturating_sub(1);
            let b = (e + 1).min(m - 1);
            if peak >= 0.4 * width && b - a >= 3 {
                let (mut points, mut levels, mut areas) = (Vec::new(), Vec::new(), Vec::new());
                for t in a..=b {
                    let k = k0 + t;
                    let (nx, ny) = normal(k);
                    let o = if t == a || t == b { 0.0 } else { offsets[t] };
                    points.extend([out[2 * k] + nx * o, out[2 * k + 1] + ny * o]);
                    levels.push(lv[k]);
                    areas.push(area[k] / (count + 1) as f64)
                }
                let len = areas.len();
                threads.push(Line {
                    points,
                    area: areas,
                    level: levels,
                    kind: vec![3.0; len],
                    id: Some(id),
                    ..Line::default()
                })
            }
            j = e + 1
        }
    }
    (!threads.is_empty()).then_some((threads, count + 1, length))
}
pub(super) fn sign(x: f64) -> f64 {
    if x == 0.0 { 0.0 } else { x.signum() }
}
