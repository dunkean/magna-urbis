use super::*;
struct Stream {
    cells: Vec<usize>,
    end: i32,
    parent: i32,
}
fn join_course(
    ctx: &Context,
    traced: &SegmentIndex,
    lines: &[Option<Line>],
    thalwegs: &[Option<(Vec<f64>, Vec<f64>)>],
    join_to: usize,
    out: &mut Vec<f64>,
    us: &mut Vec<f64>,
    kind: &mut Vec<f64>,
    lv: &mut Vec<f64>,
    level: &[f64],
    count: usize,
) {
    let cell = ctx.cell;
    let tp = &lines[join_to].as_ref().unwrap().points;
    let m = out.len() / 2 - 1;
    let (ex, ey) = (out[2 * m], out[2 * m + 1]);
    let back = m.saturating_sub(3);
    let (qx, qy) = nearest_on_line(tp, ex, ey);
    let (mut tx, mut ty) = (ex - out[2 * back], ey - out[2 * back + 1]);
    let mut tl = tx.hypot(ty);
    if tl < 1e-6 {
        tx = qx - ex;
        ty = qy - ey;
        tl = nonzero(tx.hypot(ty))
    }
    tx /= tl;
    ty /= tl;
    let mut candidates = Vec::new();
    for k in 0..tp.len() / 2 {
        let (vx, vy) = (tp[2 * k] - ex, tp[2 * k + 1] - ey);
        let d = vx.hypot(vy);
        if d <= 12.0 * cell {
            candidates.push((d - 0.7 * (vx * tx + vy * ty), k))
        }
    }
    candidates.sort_by(|a, b| a.0.total_cmp(&b.0));
    let (mut best, mut nearest_vertex) = (f64::INFINITY, 0);
    for k in 0..tp.len() / 2 {
        let d = (tp[2 * k] - qx).powi(2) + (tp[2 * k + 1] - qy).powi(2);
        if d < best {
            best = d;
            nearest_vertex = k
        }
    }
    candidates.push((f64::INFINITY, nearest_vertex));
    let excess = |hx: &[f64], hy: &[f64]| {
        let ceiling = lv[m].max(ctx.terrain(*hx.last().unwrap(), *hy.last().unwrap())) + 0.5;
        let mut worst = f64::NEG_INFINITY;
        for k in 0..hx.len() {
            worst = worst.max(ctx.terrain(hx[k], hy[k]) - ceiling)
        }
        worst
    };
    let mut best_curve = None;
    let mut best_excess = f64::INFINITY;
    for &(_, j) in candidates.iter().take(8).chain(candidates.last()) {
        if best_excess <= 0.0 {
            break;
        }
        let (jx, jy) = (tp[2 * j], tp[2 * j + 1]);
        let (k0, k1) = (j.saturating_sub(1), (j + 1).min(tp.len() / 2 - 1));
        let pl = nonzero((tp[2 * k1] - tp[2 * k0]).hypot(tp[2 * k1 + 1] - tp[2 * k0 + 1]));
        let (px, py) = (
            (tp[2 * k1] - tp[2 * k0]) / pl,
            (tp[2 * k1 + 1] - tp[2 * k0 + 1]) / pl,
        );
        let d = (jx - ex).hypot(jy - ey);
        let (ax, ay) = (tx + px, ty + py);
        let al = nonzero(ax.hypot(ay));
        for f in [0.8, 0.4] {
            let (hx, hy) = hermite(
                (ex, ey),
                (tx * f * d, ty * f * d),
                (jx, jy),
                (ax / al * f * d, ay / al * f * d),
                cell / 3.0,
            );
            let e = excess(&hx, &hy);
            if e < best_excess {
                best_curve = Some((hx, hy));
                best_excess = e
            }
            if e <= 0.0 {
                break;
            }
        }
    }
    if best_excess > 0.0 {
        if let Some((gx, gy)) = &thalwegs[join_to] {
            let mut start = None;
            let mut nearest = (2.0 * cell).powi(2);
            for k in 0..gx.len() {
                let d = (gx[k] - ex).powi(2) + (gy[k] - ey).powi(2);
                if d < nearest {
                    nearest = d;
                    start = Some(k)
                }
            }
            if let Some(start) = start {
                let (mut wx, mut wy) = (vec![ex], vec![ey]);
                for k in start..gx.len().min(start + 300) {
                    if let Some(touch) = traced.nearest(gx[k], gy[k], 1.5) {
                        wx.push(touch.x);
                        wy.push(touch.y);
                        let e = excess(&wx, &wy);
                        if e < best_excess {
                            best_curve = Some((wx, wy));
                            best_excess = e
                        }
                        break;
                    }
                    let lx = *wx.last().unwrap();
                    let ly = *wy.last().unwrap();
                    let t = traced.crossing(lx, ly, gx[k], gy[k]);
                    if t <= 1.0 {
                        wx.push(lx + (gx[k] - lx) * t);
                        wy.push(ly + (gy[k] - ly) * t);
                        let e = excess(&wx, &wy);
                        if e < best_excess {
                            best_curve = Some((wx, wy));
                            best_excess = e
                        }
                        break;
                    }
                    wx.push(gx[k]);
                    wy.push(gy[k]);
                }
            }
        }
    }
    let straight = resample(&[ex, qx], &[ey, qy], cell / 3.0);
    if best_curve.is_none() || excess(&straight.0, &straight.1) < best_excess - 1.0 {
        best_curve = Some(straight)
    }
    let (hx, hy) = best_curve.unwrap();
    let z = lv[m].min(level[count - 1]);
    for k in 1..hx.len() {
        let t = traced.crossing(hx[k - 1], hy[k - 1], hx[k], hy[k]);
        let last = t <= 1.0 || k == hx.len() - 1;
        out.extend(if t <= 1.0 {
            [
                hx[k - 1] + (hx[k] - hx[k - 1]) * t,
                hy[k - 1] + (hy[k] - hy[k - 1]) * t,
            ]
        } else {
            [hx[k], hy[k]]
        });
        us.push((count - 1) as f64);
        kind.push(2.0);
        lv.push(z);
        if last {
            break;
        }
    }
}
fn low_route(
    ctx: &Context,
    ax: f64,
    ay: f64,
    ex: f64,
    ey: f64,
    level: f64,
    avoid: &SegmentIndex,
) -> Option<(Vec<f64>, Vec<f64>)> {
    let from = ctx.at(ax, ay)?;
    let to = ctx.at(ex, ey)?;
    let n = ctx.h.n;
    let x0 = (from % n).min(to % n).saturating_sub(12);
    let x1 = ((from % n).max(to % n) + 12).min(n - 1);
    let y0 = (from / n).min(to / n).saturating_sub(12);
    let y1 = ((from / n).max(to / n) + 12).min(n - 1);
    let w = x1 - x0 + 1;
    let size = w * (y1 - y0 + 1);
    let local = |c: usize| (c / n - y0) * w + c % n - x0;
    let mut cost = vec![f64::INFINITY; size];
    let mut previous = vec![-1_i32; size];
    let mut heap = Heap::new(true);
    cost[local(from)] = 0.0;
    heap.push(from, 0.0);
    while let Some((c, _)) = heap.pop() {
        let lc = local(c);
        if c != from && ctx.standing[c] != 0 && ctx.h.grids.sea[c] != 0 {
            let (mut xs, mut ys) = (Vec::new(), Vec::new());
            let mut k = lc as i32;
            while k >= 0 {
                xs.push((x0 as f64 + (k as usize % w) as f64 + 0.5) * ctx.cell);
                ys.push((y0 as f64 + (k as usize / w) as f64 + 0.5) * ctx.cell);
                k = previous[k as usize]
            }
            xs.reverse();
            ys.reverse();
            xs[0] = ax;
            ys[0] = ay;
            return Some((xs, ys));
        }
        for (nb, d) in neighbours(c, n) {
            let (xx, yy) = (nb % n, nb / n);
            if xx < x0 || yy < y0 || xx > x1 || yy > y1 {
                continue;
            }
            let rise = ctx.h.height[nb] as f64 - level;
            if rise > 2.5 && ctx.standing[nb] == 0 {
                continue;
            }
            let (cx, cy) = ((xx as f64 + 0.5) * ctx.cell, (yy as f64 + 0.5) * ctx.cell);
            let crowded = (cx - ax).hypot(cy - ay) > 3.0 * ctx.cell
                && ctx.standing[nb] == 0
                && avoid.nearest(cx, cy, 2.0 * ctx.cell).is_some();
            let lnb = local(nb);
            let step = d * (1.0 + rise.max(0.0) * 4.0) * if crowded { 12.0 } else { 1.0 };
            if cost[lc] + step < cost[lnb] {
                cost[lnb] = cost[lc] + step;
                previous[lnb] = lc as i32;
                heap.push(nb, cost[lnb])
            }
        }
    }
    None
}
fn deltas(
    ctx: &Context,
    s: &Settings,
    order: &[usize],
    streams: &[Stream],
    lines: &[Option<Line>],
    rng: &Rng,
    network: &mut Network,
) {
    let cell = ctx.cell;
    let mut fan = SegmentIndex::new(4.0 * cell);
    for &id in order {
        let Some(line) = &lines[id] else { continue };
        let stream = &streams[id];
        if stream.end < 0 || ctx.h.grids.sea[stream.end as usize] == 0 {
            continue;
        }
        let p = &line.points;
        let m = p.len() / 2 - 1;
        let mouth = line.area[m];
        if mouth < 30.0 * s.river_area * 1e6 {
            continue;
        }
        let width = channel_width(mouth, s.width_scale);
        let sea0 = line.level[m].max(0.0);
        let (mut k, mut arc) = (m, 0.0);
        while k > 1 && arc < 12000.0_f64.min(40.0 * width) {
            let step = (p[2 * k] - p[2 * k - 2]).hypot(p[2 * k + 1] - p[2 * k - 1]);
            if line.level[k - 1] - sea0 > 0.0015 * (arc + step) + 1.0 {
                break;
            }
            arc += step;
            k -= 1
        }
        let apex_height = line.level[k].max(ctx.terrain(p[2 * k], p[2 * k + 1])) + 1.5;
        if arc < (20.0 * width).max(4.0 * cell) {
            continue;
        }
        let (ax, ay) = (p[2 * k], p[2 * k + 1]);
        let dl = (p[2 * m] - ax).hypot(p[2 * m + 1] - ay);
        if dl < 2.0 * cell {
            continue;
        }
        let (dx, dy) = ((p[2 * m] - ax) / dl, (p[2 * m + 1] - ay) / dl);
        let branches = if mouth > 2000e6 {
            4
        } else if mouth > 500e6 {
            3
        } else {
            2
        };
        let mut r = rng.fork(&format!("delta:{id}"));
        let mut own = SegmentIndex::new(4.0 * cell);
        own.add(&p[..2 * k], id);
        own.add(&p[(2 * k + 6).min(p.len())..], id);
        let mut made = 0;
        for b in 0..branches {
            let phi = ((b as f64 + 0.5) / branches as f64 - 0.5) * 1.6 + r.range(-0.15, 0.15);
            let (ux, uy) = (
                dx * phi.cos() - dy * phi.sin(),
                dx * phi.sin() + dy * phi.cos(),
            );
            let mut found = None;
            let mut t = 0.3 * dl;
            while t < 2.5 * dl {
                if ctx.wet(ax + ux * t, ay + uy * t, None) {
                    found = Some(t);
                    break;
                }
                t += cell / 2.0
            }
            let Some(found) = found else { continue };
            let (ex, ey) = (ax + ux * found, ay + uy * found);
            if (ex - p[2 * m]).hypot(ey - p[2 * m + 1]) < 8.0 * width {
                continue;
            }
            let Some((rx, ry)) = low_route(ctx, ax, ay, ex, ey, apex_height - 1.5, &own) else {
                continue;
            };
            let (rx, ry) = smooth_chain(&rx, &ry, 2.0);
            let (hx, hy) = spline(&rx, &ry, cell / 3.0);
            let phase = r.range(0.0, std::f64::consts::TAU);
            let mut points = Vec::new();
            let mut ok = true;
            let mut arc_length = 0.0;
            for j in 0..hx.len() {
                if j > 0 {
                    arc_length += (hx[j] - hx[j - 1]).hypot(hy[j] - hy[j - 1])
                }
                let t = j as f64 / (hx.len() - 1) as f64;
                let wiggle = 0.6
                    * width
                    * (arc_length / (6.0 * width) + phase).sin()
                    * (std::f64::consts::PI * t).sin();
                let (nx, ny) = if j + 1 < hx.len() {
                    (hy[j + 1] - hy[j], hx[j] - hx[j + 1])
                } else {
                    (hy[j] - hy[j - 1], hx[j - 1] - hx[j])
                };
                let nl = nonzero(nx.hypot(ny));
                let (x, y) = (hx[j] + nx / nl * wiggle, hy[j] + ny / nl * wiggle);
                if j > 0 && ctx.wet(x, y, None) {
                    points.extend([x, y]);
                    break;
                }
                if j > 3 && points.len() >= 2 {
                    let (px, py) = (points[points.len() - 2], points[points.len() - 1]);
                    let t = own.crossing(px, py, x, y).min(fan.crossing(px, py, x, y));
                    if t <= 1.0 {
                        ok = j as f64 >= 0.4 * hx.len() as f64;
                        points.extend([px + (x - px) * t, py + (y - py) * t]);
                        break;
                    }
                }
                points.extend([x, y])
            }
            if !ok || points.len() < 8 {
                continue;
            }
            fan.add(&points, id);
            network.distributaries.push(Line::uniform(
                points,
                mouth / (branches + 1) as f64,
                line.level[k].max(0.0),
                5.0,
                Some(id),
            ));
            made += 1
        }
        if made > 0 {
            network.deltas += 1
        }
    }
}
fn clear_oxbows(
    ctx: &Context,
    s: &Settings,
    traced: &SegmentIndex,
    oxbows: Vec<Line>,
) -> Vec<Line> {
    let mut clear = Vec::new();
    for oxbow in oxbows {
        let p = &oxbow.points;
        if p.len() < 4 {
            continue;
        }
        let width = channel_width(oxbow.area[0], s.width_scale).max(0.5 * ctx.cell);
        if (0..p.len() - 3)
            .step_by(2)
            .any(|k| traced.crossing(p[k], p[k + 1], p[k + 2], p[k + 3]) <= 1.0)
            || (0..p.len())
                .step_by(2)
                .any(|k| ctx.wet(p[k], p[k + 1], None))
        {
            continue;
        }
        let (mut first, mut last) = (0, p.len() / 2 - 1);
        while first < last
            && traced
                .nearest(p[2 * first], p[2 * first + 1], width)
                .is_some()
        {
            first += 1
        }
        while last > first
            && traced
                .nearest(p[2 * last], p[2 * last + 1], width)
                .is_some()
        {
            last -= 1
        }
        if last - first < 3 {
            continue;
        }
        let (mut length, mut enclosed) = (0.0, 0.0);
        for k in first..=last {
            let j = if k == last { first } else { k + 1 };
            if k < last {
                length += (p[2 * j] - p[2 * k]).hypot(p[2 * j + 1] - p[2 * k + 1])
            }
            enclosed += p[2 * k] * p[2 * j + 1] - p[2 * j] * p[2 * k + 1]
        }
        if length < 6.0 * width || (enclosed / 2.0).abs() < 0.035 * length * length {
            continue;
        }
        let mut sharp = false;
        let heading = |j: usize| (p[2 * j + 3] - p[2 * j + 1]).atan2(p[2 * j + 2] - p[2 * j]);
        for k in first + 1..last {
            if sharp {
                break;
            }
            let (mut turn, mut arc) = (0.0, 0.0);
            let mut j = k;
            while j < last && arc < width {
                let mut t = heading(j) - heading(j - 1);
                t -= std::f64::consts::TAU * (t / std::f64::consts::TAU + 0.5).floor();
                turn += t;
                arc += (p[2 * j + 2] - p[2 * j]).hypot(p[2 * j + 3] - p[2 * j + 1]);
                if turn.abs() > 1.3 {
                    sharp = true
                }
                j += 1
            }
        }
        if sharp {
            continue;
        }
        let reach = 3.0 * width;
        if traced
            .nearest(p[2 * first], p[2 * first + 1], reach)
            .is_none()
            || traced
                .nearest(p[2 * last], p[2 * last + 1], reach)
                .is_none()
        {
            continue;
        }
        clear.push(Line {
            points: p[2 * first..2 * last + 2].to_vec(),
            area: oxbow.area[first..last + 1].to_vec(),
            level: oxbow.level[first..last + 1].to_vec(),
            kind: oxbow.kind[first..last + 1].to_vec(),
            ..Line::default()
        })
    }
    clear
}
fn lerp(values: &[f64], u: f64) -> f64 {
    let i = (u.floor() as usize).min(values.len() - 2);
    let f = u - i as f64;
    values[i] + (values[i + 1] - values[i]) * f
}
struct Run {
    ia: usize,
    ib: usize,
    points: Vec<f64>,
    us: Vec<f64>,
    kind: Vec<f64>,
    level: Vec<f64>,
    oxbows: Vec<Line>,
    braids: Vec<Line>,
    avulsions: usize,
    length: f64,
}
fn trace_run(
    ctx: &Context,
    s: &Settings,
    id: usize,
    parent: i32,
    rng: &Rng,
    owner: &[i32],
    target: &[f32],
    px: &[f64],
    py: &[f64],
    du: &[f64],
    node_of: &[usize],
    area: &[f64],
    level: &[f64],
    plain: &[f64],
    a: usize,
    b: usize,
    aridity: f64,
) -> Option<Run> {
    let (ia, ib) = (node_of[a], node_of[b]);
    let cell = ctx.cell;
    let width = channel_width(area[b], s.width_scale).max(0.5 * cell);
    let chord = (px[ib] - px[ia]).hypot(py[ib] - py[ia]);
    if chord < (6.0 * cell).max(15.0 * width) || b - a < 4 {
        return None;
    }
    let level_at = |u| lerp(level, u);
    let bottom = level_at(du[ib]);
    let valley = valley_grid(px, py, du, ia, ib, &level_at, cell, ctx.h.n, bottom);
    let depth = 0.5 + 0.02 * channel_width(area[b], 1.0);
    let allowed = |x: f64, y: f64, water: f64| {
        let Some(c) = ctx.at(x, y) else { return false };
        if ctx.still[c] != 0 || (owner[c] != id as i32 && owner[c] != parent) {
            return false;
        }
        let z = ctx.terrain(x, y);
        z > 0.0 && z <= valley(x, y).min(water) + depth
    };
    let target_at = |x: f64, y: f64| ctx.at(x, y).map_or(1.0, |c| target[c] as f64);
    let (mut axis_x, mut axis_y) = (px[ia..ib + 1].to_vec(), py[ia..ib + 1].to_vec());
    let flats = plain[a..b + 1].iter().sum::<f64>();
    if flats >= 0.5 * (b - a + 1) as f64 {
        let (ta, tb) = (ia.saturating_sub(9), (ib + 9).min(px.len() - 1));
        let tal = nonzero((px[ia] - px[ta]).hypot(py[ia] - py[ta]));
        let tbl = nonzero((px[tb] - px[ib]).hypot(py[tb] - py[ib]));
        let reach = (0.5 * chord).min(40.0 * width);
        let (in_x, in_y) = if ia > ta {
            ((px[ia] - px[ta]) / tal, (py[ia] - py[ta]) / tal)
        } else {
            ((px[ib] - px[ia]) / chord, (py[ib] - py[ia]) / chord)
        };
        let (out_x, out_y) = if tb > ib {
            ((px[tb] - px[ib]) / tbl, (py[tb] - py[ib]) / tbl)
        } else {
            ((px[ib] - px[ia]) / chord, (py[ib] - py[ia]) / chord)
        };
        let (hx, hy) = hermite(
            (px[ia], py[ia]),
            (in_x * reach, in_y * reach),
            (px[ib], py[ib]),
            (out_x * reach, out_y * reach),
            cell / 4.0,
        );
        let water = profile(&hx, &hy, &valley);
        if (0..hx.len()).all(|k| allowed(hx[k], hy[k], water[k.saturating_sub(1)])) {
            axis_x = hx;
            axis_y = hy
        }
    }
    let resistance = |x: f64, y: f64, water: f64| {
        let rise = ctx.terrain(x, y) - valley(x, y).min(water);
        if rise <= 0.0 {
            1.0
        } else {
            1.0 / (1.0 + (rise / depth).powi(2))
        }
    };
    let resist = if s.terrain_influence {
        Some(&resistance as &dyn Fn(f64, f64, f64) -> f64)
    } else {
        None
    };
    let mut result = meander::meander(
        &axis_x,
        &axis_y,
        width,
        rng.fork(&format!("{id}:{a}")),
        &valley,
        &allowed,
        &target_at,
        cell / 2.0,
        s.avulsions,
        resist,
    );
    if !result.meandered && axis_x.len() != ib - ia + 1 {
        result = meander::meander(
            &px[ia..ib + 1],
            &py[ia..ib + 1],
            width,
            rng.fork(&format!("{id}:{a}:thalweg")),
            &valley,
            &allowed,
            &target_at,
            cell / 2.0,
            s.avulsions,
            resist,
        )
    }
    let (mx, my) = spline(&result.xs, &result.ys, cell / 3.0);
    let water = profile(&mx, &my, &valley);
    let last = mx.len() - 1;
    let mut near_of = vec![0; last + 1];
    let mut gap_of = vec![0.0; last + 1];
    let mut vu = vec![0.0; last + 1];
    let mut vl = vec![0.0; last + 1];
    let mut stride = 0.0_f64;
    for j in ia..ib {
        stride = stride.max((px[j + 1] - px[j]).hypot(py[j + 1] - py[j]))
    }
    stride = stride * (1.0 + 1e-9) + 1e-9;
    let (mut near, mut u) = (ia, du[ia]);
    for k in 0..=last {
        let mut best = f64::INFINITY;
        let mut j = ia.max(near.saturating_sub(60));
        while j <= ib.min(near + 60) {
            let d = (px[j] - mx[k]).powi(2) + (py[j] - my[k]).powi(2);
            if d < best {
                best = d;
                near = j;
                j += 1;
                continue;
            }
            let skip =
                ((d.sqrt() * (1.0 - 1e-9) - best.sqrt() * (1.0 + 1e-9) - 1e-6) / stride).floor();
            if skip > 0.0 {
                j += skip as usize
            }
            j += 1
        }
        u = u.max(du[near]);
        near_of[k] = if k == last { ib } else { near };
        gap_of[k] = best.sqrt();
        vu[k] = if k == last { du[ib] } else { u };
        vl[k] = if k == last {
            bottom
        } else {
            water[k].max(level_at(u))
        }
    }
    let above = |k: usize| {
        let ceiling = vl[k] + depth + 0.5;
        let z = ctx.terrain(mx[k], my[k]);
        if z > ceiling || ctx.wet(mx[k], my[k], Some(z)) {
            return true;
        }
        if k == last {
            return false;
        }
        let (hx, hy) = ((mx[k] + mx[k + 1]) / 2.0, (my[k] + my[k + 1]) / 2.0);
        let hz = ctx.terrain(hx, hy);
        hz > ceiling || ctx.wet(hx, hy, Some(hz))
    };
    let on_thalweg = (0.3 * width).max(cell / 2.0);
    let (mut points, mut us, mut kind, mut lv) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    let mut emitted = Vec::new();
    let mut k = 1;
    while k <= last {
        if !above(k) {
            points.extend([mx[k], my[k]]);
            us.push(vu[k]);
            kind.push(1.0);
            lv.push(vl[k]);
            emitted.push(k);
            k += 1;
            continue;
        }
        let mut q = k;
        while q < last && (above(q) || gap_of[q] > on_thalweg) {
            q += 1
        }
        while emitted.last().is_some_and(|&e| gap_of[e] > on_thalweg) {
            emitted.pop();
            points.truncate(points.len() - 2);
            us.pop();
            kind.pop();
            lv.pop();
        }
        let from = emitted.last().map_or(ia, |&e| near_of[e]);
        for j in from + 1..=near_of[q] {
            points.extend([px[j], py[j]]);
            us.push(us.last().copied().unwrap_or(du[ia]).max(du[j]));
            kind.push(0.0);
            lv.push(
                lv.last()
                    .copied()
                    .unwrap_or(level_at(du[ia]))
                    .min(level_at(du[j])),
            )
        }
        k = q + 1
    }
    let mut length = 0.0;
    for k in 0..kind.len() {
        if kind[k] == 1.0 {
            let (x, y) = if k == 0 {
                (px[ia], py[ia])
            } else {
                (points[2 * k - 2], points[2 * k - 1])
            };
            length += (points[2 * k] - x).hypot(points[2 * k + 1] - y)
        }
    }
    let mut oxbows = Vec::new();
    for (ox, oy) in result.oxbows {
        let (ox, oy) = spline(&ox, &oy, cell / 3.0);
        let mut p = interleave(&ox, &oy);
        uncross(&mut p, cell, &mut []);
        oxbows.push(Line::uniform(p, area[b], level[b], 1.0, None))
    }
    let mut braids = Vec::new();
    if s.anabranching
        && aridity >= 0.8
        && area[b] >= 25.0 * s.river_area * 1e6
        && flats >= 0.5 * (b - a + 1) as f64
    {
        let fits = |x, y| !ctx.wet(x, y, None) && allowed(x, y, valley(x, y));
        for (sx, sy) in side_channels(
            &mx,
            &my,
            &px[ia..ib + 1],
            &py[ia..ib + 1],
            width,
            &fits,
            rng.fork(&format!("{id}:{a}:anabranch")),
            cell,
        ) {
            braids.push(Line::uniform(
                interleave(&sx, &sy),
                0.35 * area[b],
                level[b],
                4.0,
                Some(id),
            ))
        }
    }
    Some(Run {
        ia,
        ib,
        points,
        us,
        kind,
        level: lv,
        oxbows,
        braids,
        avulsions: result.avulsions,
        length,
    })
}
struct Prepared {
    area: Vec<f64>,
    level: Vec<f64>,
    braid: Vec<u8>,
    px: Vec<f64>,
    py: Vec<f64>,
    du: Vec<f64>,
    count: usize,
    nodes: usize,
    made: Vec<Option<Run>>,
}
pub(crate) fn vector_rivers(
    h: &Hydrology,
    lake: &[u8],
    field: &LakeField,
    s: &Settings,
    seed: &str,
    aridity: f64,
    discharge_scale: f64,
    angle: Option<f64>,
) -> Network {
    let n = h.n;
    let total = n * n;
    let cell = h.width / n as f64;
    let threshold = s.river_area * 1e6;
    let g = &h.grids;
    let height = &h.height;
    let rng = Rng::new(&format!("rivers:{seed}"));
    let mut standing = vec![0; total];
    for c in 0..total {
        standing[c] = u8::from(g.sea[c] != 0 || lake[c] != 0 || height[c] <= 0.0)
    }
    let mut body = vec![-1; total];
    let mut bodies = 0;
    for start in 0..total {
        if standing[start] == 0 || body[start] >= 0 {
            continue;
        }
        let mut stack = vec![start];
        body[start] = bodies;
        while let Some(c) = stack.pop() {
            for (nb, _) in neighbours(c, n) {
                if standing[nb] != 0 && body[nb] < 0 {
                    body[nb] = bodies;
                    stack.push(nb)
                }
            }
        }
        bodies += 1
    }
    let mut back = vec![-2; total];
    let below = |r: i32, a: usize| {
        r < 0 || standing[r as usize] == 1 || g.filled[r as usize] != g.filled[a]
    };
    for c in 0..total {
        if standing[c] == 0 {
            continue;
        }
        let r = g.receiver[c];
        if below(r, c) || back[r as usize] != -2 {
            continue;
        }
        let mut path = Vec::new();
        let (mut a, mut q) = (c, r);
        while !below(q, a) && back[q as usize] == -2 {
            path.push(q as usize);
            a = q as usize;
            q = g.receiver[a]
        }
        let into = if !below(q, a) {
            back[q as usize]
        } else if q >= 0 && standing[q as usize] != 0 && g.filled[q as usize] == g.filled[a] {
            body[q as usize]
        } else {
            -1
        };
        for p in path {
            back[p] = into
        }
    }
    let mut link = vec![0; total];
    for c in 0..total {
        if standing[c] == 0 {
            continue;
        }
        let mut r = g.receiver[c];
        while r >= 0
            && standing[r as usize] == 0
            && back[r as usize] >= 0
            && back[r as usize] != body[c]
            && link[r as usize] == 0
        {
            link[r as usize] = 1;
            r = g.receiver[r as usize]
        }
    }
    let still: Vec<u8> = (0..total)
        .map(|c| u8::from(standing[c] != 0 || (back[c] >= 0 && link[c] == 0)))
        .collect();
    let mut river: Vec<u8> = (0..total)
        .map(|c| u8::from(still[c] == 0 && g.accumulation[c] as f64 >= threshold))
        .collect();
    if s.headwaters > 0.0 {
        // Headwaters: a river goes up its talweg to the head of the valley the relief shows, and takes the side
        // valleys it passes. Receivers come first in flood order, so one pass grows the network upstream.
        let low = threshold * (1.0 - (1.0 - HEADWATER_SHARE) * s.headwaters.min(1.0));
        let original = river.clone();
        for &c in &g.order {
            let c = c as usize;
            let r = g.receiver[c];
            if river[c] == 0
                && still[c] == 0
                && r >= 0
                && river[r as usize] != 0
                && g.accumulation[c] as f64 >= low
                && valley_cell(height, &g.receiver, n, cell, c)
            {
                river[c] = 1
            }
        }
        // A source continues up its own talweg whatever the length; a side valley is a river from six cells on:
        // shorter ones are folds of the bank. `up`: cells of the longest added course above and including a cell;
        // `lead`: the added donor of a cell with the largest catchment; `fed`: river cells with a river donor.
        const SIDE_VALLEY: u32 = 6;
        let (mut up, mut lead, mut fed) = (vec![0_u32; total], vec![-1_i32; total], vec![0_u8; total]);
        for &c in g.order.iter().rev() {
            let c = c as usize;
            let r = g.receiver[c];
            if r < 0 || river[c] == 0 {
                continue;
            }
            let r = r as usize;
            if original[c] != 0 {
                fed[r] = 1;
                continue;
            }
            up[c] += 1;
            if original[r] == 0 {
                up[r] = up[r].max(up[c])
            }
            if lead[r] < 0 || g.accumulation[c] > g.accumulation[lead[r] as usize] {
                lead[r] = c as i32
            }
        }
        for &c in &g.order {
            let c = c as usize;
            if river[c] == 0 || original[c] != 0 {
                continue;
            }
            let r = g.receiver[c] as usize;
            let continues = lead[r] == c as i32 && (original[r] == 0 || fed[r] == 0);
            if river[r] == 0 || !(continues || up[c] >= SIDE_VALLEY) {
                river[c] = 0
            }
        }
    }
    let mut main = vec![-1; total];
    for c in 0..total {
        let r = g.receiver[c];
        if river[c] == 0 || r < 0 || river[r as usize] == 0 {
            continue;
        }
        let r = r as usize;
        if main[r] < 0 || g.accumulation[c] > g.accumulation[main[r] as usize] {
            main[r] = c as i32
        }
    }
    let mut lake_donor = vec![-1; total];
    for c in 0..total {
        let r = g.receiver[c];
        if lake[c] != 0
            && r >= 0
            && river[r as usize] != 0
            && main[r as usize] < 0
            && (lake_donor[r as usize] < 0
                || g.accumulation[c] > g.accumulation[lake_donor[r as usize] as usize])
        {
            lake_donor[r as usize] = c as i32
        }
    }
    let mut streams = Vec::new();
    let mut stream_of = vec![-1; total];
    for source in 0..total {
        if river[source] == 0 || main[source] >= 0 {
            continue;
        }
        let id = streams.len();
        let mut cells = vec![source];
        stream_of[source] = id as i32;
        let mut end = -1;
        loop {
            // Public Rust callers need the same bounded traversal as wire callers.
            if cells.len() >= total { break; }
            let last = *cells.last().unwrap();
            let r = g.receiver[last];
            if r < 0 {
                break;
            }
            let at = r as usize;
            if (river[at] != 0 && main[at] == last as i32) || (river[at] == 0 && still[at] == 0) {
                cells.push(at);
                stream_of[at] = id as i32;
                continue;
            }
            end = r;
            break;
        }
        streams.push(Stream {
            cells,
            end,
            parent: -1,
        })
    }
    for stream in &mut streams {
        if stream.end >= 0 && river[stream.end as usize] != 0 {
            stream.parent = stream_of[stream.end as usize]
        }
    }
    let ctx = Context {
        h,
        field,
        still: &still,
        standing: &standing,
        cell,
    };
    let mut sinuosity = vec![1.0_f32; total];
    let mut flat = vec![0; total];
    let mut braided = vec![0; total];
    let vegetation = ((aridity - 0.2) / 0.6).clamp(0.0, 1.0);
    let braid_factor = if s.braiding >= 2.0 { 0.6 } else { 1.2 }
        * if aridity < 0.5 { 0.7 } else { 1.0 }
        * (1.0 + vegetation);
    let flat_gradient = s.flat_slope / 1000.0;
    let window = 4.0 * cell;
    for stream in &streams {
        let cells = &stream.cells;
        let count = cells.len();
        let mut arc = vec![0.0; count];
        for i in 1..count {
            let (a, b) = (cells[i - 1], cells[i]);
            arc[i] = arc[i - 1]
                + if a % n != b % n && a / n != b / n {
                    std::f64::consts::SQRT_2
                } else {
                    1.0
                } * cell
        }
        let (mut j0, mut j1) = (0, 0);
        for i in 0..count {
            while arc[i] - arc[j0] > window {
                j0 += 1
            }
            while j1 < count - 1 && arc[j1] - arc[i] < window {
                j1 += 1
            }
            let c = cells[i];
            let gradient = (g.filled[cells[j0]] as f64 - g.filled[cells[j1]] as f64)
                / cell.max(arc[j1] - arc[j0]);
            let filled_depression = g.filled[c] as f64 - height[c] as f64 > 0.01;
            flat[c] = u8::from(filled_depression || gradient < flat_gradient);
            let share = if flat[c] != 0 {
                1.0
            } else {
                0.35 * (1.0 - (gradient / flat_gradient).ln() / 10.0_f64.ln()).max(0.0)
            };
            let size = (0.4 + 0.15 * (g.accumulation[c] as f64 / threshold).log2()).clamp(0.4, 1.0);
            sinuosity[c] = (1.0 + (s.sinuosity - 1.0) * share * size) as f32;
            if s.braiding > 0.0 && !filled_depression && g.accumulation[c] as f64 >= 4.0 * threshold
            {
                let q = 0.5 * (g.accumulation[c] as f64 / 1e6).powf(0.8) * discharge_scale;
                if gradient > braid_factor * 0.012 * q.powf(-0.44) && gradient < 0.04 {
                    braided[c] = 1;
                    sinuosity[c] = 1.0;
                    flat[c] = 0
                }
            }
        }
    }
    let mut owner = vec![-1; total];
    let mut target = vec![0.0; total];
    let mut queue = Vec::new();
    for c in 0..total {
        if stream_of[c] >= 0 {
            owner[c] = stream_of[c];
            target[c] = sinuosity[c];
            queue.push(c)
        }
    }
    let mut head = 0;
    while head < queue.len() {
        let c = queue[head];
        head += 1;
        for (nb, _) in neighbours(c, n) {
            if owner[nb] < 0 {
                owner[nb] = owner[c];
                target[nb] = target[c];
                queue.push(nb)
            }
        }
    }
    let mut by_area: Vec<usize> = (0..streams.len()).collect();
    by_area.sort_by(|&a, &b| {
        g.accumulation[*streams[b].cells.last().unwrap()]
            .total_cmp(&g.accumulation[*streams[a].cells.last().unwrap()])
            .then(a.cmp(&b))
    });
    let mut order = Vec::new();
    let mut ordered = vec![false; streams.len()];
    for id in by_area {
        let mut ancestors = Vec::new();
        let mut at = id as i32;
        while at >= 0 && !ordered[at as usize] {
            ordered[at as usize] = true;
            ancestors.push(at as usize);
            at = streams[at as usize].parent
        }
        ancestors.reverse();
        order.extend(ancestors)
    }
    let mut lines: Vec<Option<Line>> = vec![None; streams.len()];
    let mut absorbed_by = vec![-1_i32; streams.len()];
    let mut thalwegs: Vec<Option<(Vec<f64>, Vec<f64>)>> = vec![None; streams.len()];
    let mut chains: Vec<Option<Vec<usize>>> = vec![None; streams.len()];
    let mut traced = SegmentIndex::new(4.0 * cell);
    let mut widest = 0.0_f64;
    let mut network = Network {
        width_scale: s.width_scale,
        ..Network::default()
    };
    let mut oxbows = Vec::new();
    let mut braids = Vec::new();
    // Independent dry routes cannot enter across_beds' parent-dependent searches.
    // Prepare their terrain tracing and meanders together, then merge in the original
    // parent/area order so confluences, truncation and random choices stay identical.
    let prepare = |id: usize, parent_chain: Option<&[usize]>| {
        let stream = &streams[id];
        let mut bed = HashSet::default();
        let mut cells = stream.cells.clone();
        if lake_donor[cells[0]] >= 0 {
            cells.insert(0, lake_donor[cells[0]] as usize)
        }
        if stream.end >= 0 {
            cells.push(stream.end as usize)
        }
        cells = ctx.across_beds(cells, parent_chain, &mut bed, false);
        let shoal = if stream.end >= 0
            && standing[stream.end as usize] == 0
            && still[stream.end as usize] != 0
        {
            ctx.to_standing(stream.end as usize)
        } else {
            Vec::new()
        };
        cells.extend_from_slice(&shoal);
        let (mut xs, mut ys, mut area, mut level, mut local, mut plain, mut braid) = (
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
            Vec::new(),
        );
        for &c in &cells {
            let (x, y) = ctx.centre(c);
            let on_bed = bed.contains(&c);
            xs.push(x);
            ys.push(y);
            area.push(if on_bed {
                f64::NAN
            } else {
                g.accumulation[c] as f64
            });
            level.push(if on_bed {
                height[c] as f64
            } else {
                g.filled[c] as f64
            });
            local.push(if !on_bed && river[c] != 0 {
                sinuosity[c] as f64
            } else {
                1.0
            });
            plain.push(if !on_bed && river[c] != 0 {
                flat[c] as f64
            } else {
                0.0
            });
            braid.push(if !on_bed && river[c] != 0 {
                braided[c]
            } else {
                0
            })
        }
        let floor = level.clone();
        for i in 0..cells.len() {
            if !bed.contains(&cells[i]) {
                continue;
            }
            for k in i.saturating_sub(2)..=(i + 2).min(cells.len() - 1) {
                if bed.contains(&cells[k]) {
                    level[i] = level[i].max(floor[k])
                }
            }
            level[i] = level[i].min(g.filled[cells[i]] as f64)
        }
        for i in 0..cells.len() {
            if !bed.contains(&cells[i]) {
                continue;
            }
            let (j0, j1) = (i.saturating_sub(4), (i + 4).min(cells.len() - 1));
            let gradient =
                (level[j0] - level[j1]).abs() / cell.max((xs[j1] - xs[j0]).hypot(ys[j1] - ys[j0]));
            let share = if gradient < flat_gradient {
                1.0
            } else {
                0.35 * (1.0 - (gradient / flat_gradient).ln() / 10.0_f64.ln()).max(0.0)
            };
            let size = (0.4 + 0.15 * (g.accumulation[cells[j1]] as f64 / threshold).log2())
                .clamp(0.4, 1.0);
            local[i] = 1.0 + (s.sinuosity - 1.0) * share * size;
            plain[i] = if gradient < flat_gradient { 1.0 } else { 0.0 }
        }
        if stream.end >= 0 && *cells.last().unwrap() != stream.end as usize {
            *area.last_mut().unwrap() = g.accumulation[*stream.cells.last().unwrap()] as f64
        }
        let last_area = *area.last().unwrap();
        for k in cells.len() - shoal.len()..cells.len() {
            area[k] = last_area
        }
        let mut i = 0;
        while i < area.len() {
            if !area[i].is_nan() {
                i += 1;
                continue;
            }
            let mut j = i;
            while j < area.len() && area[j].is_nan() {
                j += 1
            }
            let a0 = if i > 0 {
                area[i - 1]
            } else {
                area.get(j).copied().unwrap_or(f64::NAN)
            };
            let a1 = area.get(j).copied().unwrap_or(a0);
            for k in i..j {
                area[k] = a0 + (a1 - a0) * (k - i + 1) as f64 / (j - i + 1) as f64
            }
            i = j + 1
        }
        if stream.end >= 0 {
            let last = area.len() - 1;
            area[last] = (g.accumulation[*stream.cells.last().unwrap()] as f64).max(area[last - 1]);
            local[last] = local[last - 1];
            plain[last] = plain[last - 1];
            braid[last] = braid[last - 1]
        } else {
            let c = *cells.last().unwrap();
            let (x, y) = ctx.centre(c);
            let bx = if c % n == 0 {
                0.0
            } else if c % n == n - 1 {
                h.width
            } else {
                x
            };
            let by = if c / n == 0 {
                0.0
            } else if c / n == n - 1 {
                h.width
            } else {
                y
            };
            if bx != x || by != y {
                xs.push(bx);
                ys.push(by);
                area.push(*area.last().unwrap());
                level.push(*level.last().unwrap());
                local.push(*local.last().unwrap());
                plain.push(*plain.last().unwrap());
                braid.push(*braid.last().unwrap())
            }
        }
        let count = xs.len();
        if count < 2 {
            return (cells, None);
        }
        let level_at = |u| lerp(&level, u);
        let (mut px, mut py, mut du, mut node_of) =
            (Vec::new(), Vec::new(), Vec::new(), Vec::new());
        for i in 0..count - 1 {
            let m = ((xs[i + 1] - xs[i]).hypot(ys[i + 1] - ys[i]) / (cell / 3.0))
                .ceil()
                .max(1.0) as usize;
            node_of.push(px.len());
            for j in 0..m {
                px.push(xs[i] + (xs[i + 1] - xs[i]) * j as f64 / m as f64);
                py.push(ys[i] + (ys[i + 1] - ys[i]) * j as f64 / m as f64);
                du.push(i as f64 + j as f64 / m as f64)
            }
        }
        node_of.push(px.len());
        px.push(xs[count - 1]);
        py.push(ys[count - 1]);
        du.push((count - 1) as f64);
        let nodes = px.len();
        let limit: Vec<f64> = (0..nodes)
            .map(|k| (level_at(du[k]) + 0.3).max(ctx.terrain(px[k], py[k])))
            .collect();
        let shore = if stream.end >= 0 && still[stream.end as usize] != 0 {
            node_of[count.saturating_sub(3)]
        } else {
            nodes
        };
        thalweg(&mut px, &mut py, &limit, &ctx, shore, cell / 4.0, 60);
        let mut arc = vec![0.0; count];
        for i in 1..count {
            arc[i] = arc[i - 1] + (xs[i] - xs[i - 1]).hypot(ys[i] - ys[i - 1])
        }
        let mut runs: Vec<(usize, usize)> = Vec::new();
        let mut i = 0;
        while i < count {
            if local[i] < 1.02 {
                i += 1;
                continue;
            }
            let mut j = i;
            while j + 1 < count && local[j + 1] >= 1.02 {
                j += 1
            }
            if let Some(previous) = runs.last_mut().filter(|p| arc[i] - arc[p.1] <= 3.0 * cell) {
                previous.1 = j
            } else {
                runs.push((i, j))
            }
            i = j + 1
        }
        let make_run = |&(a, b): &(usize, usize)| {
            trace_run(
                &ctx,
                s,
                id,
                stream.parent,
                &rng,
                &owner,
                &target,
                &px,
                &py,
                &du,
                &node_of,
                &area,
                &level,
                &plain,
                a,
                b,
                aridity,
            )
        };
        // Indexed collect preserves run order and every run forks its own RNG.
        #[cfg(any(not(target_arch = "wasm32"), feature = "threads"))]
        let made: Vec<Option<Run>> = {
            use rayon::prelude::*;
            runs.par_iter().map(make_run).collect()
        };
        #[cfg(all(target_arch = "wasm32", not(feature = "threads")))]
        let made: Vec<Option<Run>> = runs.iter().map(make_run).collect();
        (
            cells,
            Some(Prepared {
                area,
                level,
                braid,
                px,
                py,
                du,
                count,
                nodes,
                made,
            }),
        )
    };
    #[cfg(any(not(target_arch = "wasm32"), feature = "threads"))]
    let mut prepared: Vec<_> = {
        use rayon::prelude::*;
        streams
            .par_iter()
            .enumerate()
            .map(|(id, stream)| {
                let dry = |c: usize| g.filled[c] as f64 - height[c] as f64 <= 0.01;
                let independent = stream.parent < 0
                    || (stream.cells.iter().all(|&c| dry(c))
                        && (stream.end < 0 || dry(stream.end as usize))
                        && (lake_donor[stream.cells[0]] < 0
                            || dry(lake_donor[stream.cells[0]] as usize)));
                independent.then(|| prepare(id, None))
            })
            .collect()
    };
    #[cfg(all(target_arch = "wasm32", not(feature = "threads")))]
    let mut prepared: Vec<Option<(Vec<usize>, Option<Prepared>)>> =
        (0..streams.len()).map(|_| None).collect();
    for &id in &order {
        let stream = &streams[id];
        let (cells, prepared) = prepared[id].take().unwrap_or_else(|| {
            prepare(
                id,
                if stream.parent >= 0 {
                    chains[stream.parent as usize].as_deref()
                } else {
                    None
                },
            )
        });
        chains[id] = Some(cells.clone());
        let Some(Prepared {
            area,
            level,
            braid,
            px,
            py,
            du,
            count,
            nodes,
            made,
        }) = prepared
        else {
            continue;
        };
        let level_at = |u| lerp(&level, u);
        thalwegs[id] = Some((px.clone(), py.clone()));
        let (mut out, mut us, mut kind, mut lv) =
            (vec![px[0], py[0]], vec![0.0], vec![0.0], vec![level[0]]);
        let mut cursor = 0;
        for run in made.into_iter().flatten() {
            for k in cursor + 1..=run.ia {
                out.extend([px[k], py[k]]);
                us.push(du[k]);
                kind.push(0.0);
                lv.push(level_at(du[k]))
            }
            out.extend(run.points);
            us.extend(run.us);
            kind.extend(run.kind);
            lv.extend(run.level);
            oxbows.extend(run.oxbows);
            braids.extend(run.braids);
            network.avulsions += run.avulsions;
            network.meander_km += run.length / 1000.0;
            network.meander_runs += 1;
            cursor = run.ib
        }
        for k in cursor + 1..nodes {
            out.extend([px[k], py[k]]);
            us.push(du[k]);
            kind.push(0.0);
            lv.push(level_at(du[k]))
        }
        let below = |ax: f64, ay: f64, bx: f64, by: f64, ceiling: f64| {
            let steps = ((bx - ax).hypot(by - ay) / (cell / 4.0)).ceil().max(1.0) as usize;
            (0..=steps).all(|j| {
                ctx.terrain(
                    ax + (bx - ax) * j as f64 / steps as f64,
                    ay + (by - ay) * j as f64 / steps as f64,
                ) <= ceiling
            })
        };
        let (mut joined, mut beside, mut absorbed) = (false, -1_i32, false);
        let mut k = 0;
        while k < out.len() / 2 {
            let (x, y) = (out[2 * k], out[2 * k + 1]);
            let own = channel_width(lerp(&area, us[k]), s.width_scale);
            if let Some(near) = traced.nearest(x, y, (0.75 * cell).max(0.5 * (own + widest))) {
                let other = channel_width(
                    lines[near.line].as_ref().unwrap().area[near.index],
                    s.width_scale,
                );
                let gap = (0.75 * cell).max(0.5 * (own + other));
                let mut ahead = false;
                if near.d < gap {
                    let (mut j, mut arc) = (k, 0.0);
                    while j + 1 < out.len() / 2 && arc < 3.0 * gap && !ahead {
                        ahead = traced.crossing(
                            out[2 * j],
                            out[2 * j + 1],
                            out[2 * j + 2],
                            out[2 * j + 3],
                        ) <= 1.0;
                        arc += (out[2 * j + 2] - out[2 * j]).hypot(out[2 * j + 3] - out[2 * j + 1]);
                        j += 1
                    }
                }
                if near.d < gap && !ahead && below(x, y, near.x, near.y, lv[k] + 1.0) {
                    if k == 0 {
                        absorbed = true
                    }
                    out.truncate(2 * k + 2);
                    us.truncate(k + 1);
                    kind.truncate(k + 1);
                    lv.truncate(k + 1);
                    beside = near.line as i32;
                    break;
                }
            }
            if 2 * k + 3 >= out.len() {
                break;
            }
            let (bx, by) = (out[2 * k + 2], out[2 * k + 3]);
            let t = traced.crossing(x, y, bx, by);
            if t <= 1.0 && (k > 0 || t > 0.0) {
                let (u, z, kd) = (
                    us[k] + (us[k + 1] - us[k]) * t,
                    lv[k] + (lv[k + 1] - lv[k]) * t,
                    kind[k],
                );
                out.truncate(2 * k + 2);
                us.truncate(k + 1);
                kind.truncate(k + 1);
                lv.truncate(k + 1);
                out.extend([x + (bx - x) * t, y + (by - y) * t]);
                us.push(u);
                kind.push(kd);
                lv.push(z);
                joined = true;
                break;
            }
            k += 1
        }
        if absorbed {
            absorbed_by[id] = beside;
            continue;
        }
        let mut join_to = beside;
        if join_to < 0 && !joined && stream.parent >= 0 {
            let m = out.len() / 2 - 1;
            let mut parent_id = stream.parent as usize;
            while absorbed_by[parent_id] >= 0 {
                parent_id = absorbed_by[parent_id] as usize
            }
            if lines[parent_id].is_some() {
                join_to = parent_id as i32
            }
            if join_to < 0 {
                join_to = traced
                    .nearest(out[2 * m], out[2 * m + 1], 12.0 * cell)
                    .map_or(-1, |n| n.line as i32)
            }
        }
        if join_to >= 0 {
            join_course(
                &ctx,
                &traced,
                &lines,
                &thalwegs,
                join_to as usize,
                &mut out,
                &mut us,
                &mut kind,
                &mut lv,
                &level,
                count,
            )
        }
        let mut joins = join_to;
        if joins >= 0 || joined {
            joins = traced
                .nearest(out[out.len() - 2], out[out.len() - 1], 1.0)
                .map_or(joins, |n| n.line as i32)
        }
        if let Some(angle) = angle {
            if joins >= 0 {
                if let Some(target) = &lines[joins as usize] {
                    ctx.reangle(
                        &mut out,
                        &mut us,
                        &mut kind,
                        &mut lv,
                        target,
                        angle,
                        channel_width(*target.area.last().unwrap(), s.width_scale),
                        &traced,
                    )
                }
            }
        }
        unfold(&mut out, &mut [&mut us, &mut kind, &mut lv]);
        despike(&mut out, &mut [&mut us, &mut kind, &mut lv]);
        uncross(&mut out, cell, &mut [&mut us, &mut kind, &mut lv]);
        relax(&mut out, &lv, &ctx, 0.3);
        uncross(&mut out, cell, &mut [&mut us, &mut kind, &mut lv]);
        if stream.end >= 0 && still[stream.end as usize] != 0 && joins < 0 {
            let (wx, wy) = ctx.centre(*cells.last().unwrap());
            if !ctx.wet(out[out.len() - 2], out[out.len() - 1], None) && ctx.wet(wx, wy, None) {
                out.extend([wx, wy]);
                us.push((count - 1) as f64);
                kind.push(0.0);
                lv.push(*lv.last().unwrap())
            }
            let mut k = out.len() / 2 - 1;
            while k > 0 && ctx.wet(out[2 * k], out[2 * k + 1], None) {
                k -= 1
            }
            if k < out.len() / 2 - 1 && !ctx.wet(out[2 * k], out[2 * k + 1], None) {
                let (ax, ay, bx, by) = (out[2 * k], out[2 * k + 1], out[2 * k + 2], out[2 * k + 3]);
                let (mut lo, mut hi) = (0.0, 1.0);
                for _ in 0..16 {
                    let mid = (lo + hi) / 2.0;
                    if ctx.wet(ax + (bx - ax) * mid, ay + (by - ay) * mid, None) {
                        hi = mid
                    } else {
                        lo = mid
                    }
                }
                let (u, z, kd) = (us[k + 1], lv[k + 1], kind[k + 1]);
                out.truncate(2 * k + 2);
                us.truncate(k + 1);
                kind.truncate(k + 1);
                lv.truncate(k + 1);
                out.extend([ax + (bx - ax) * hi, ay + (by - ay) * hi]);
                us.push(u);
                kind.push(kd);
                lv.push(z)
            }
        }
        if stream.end < 0 && joins < 0 {
            let c = *cells.last().unwrap();
            let (ex, ey) = (out[out.len() - 2], out[out.len() - 1]);
            let mut edges = Vec::new();
            if c % n == 0 {
                edges.push((0.0, ey))
            }
            if c % n == n - 1 {
                edges.push((h.width, ey))
            }
            if c / n == 0 {
                edges.push((ex, 0.0))
            }
            if c / n == n - 1 {
                edges.push((ex, h.width))
            }
            edges.sort_by(|a, b| {
                (a.0 - ex)
                    .hypot(a.1 - ey)
                    .total_cmp(&(b.0 - ex).hypot(b.1 - ey))
            });
            if let Some(&(x, y)) = edges.first() {
                out.extend([x, y]);
                us.push((count - 1) as f64);
                kind.push(0.0);
                lv.push(*lv.last().unwrap())
            }
        }
        if out.len() < 4 {
            continue;
        }
        let line_area: Vec<f64> = us.iter().map(|&u| lerp(&area, u)).collect();
        let mut threads = vec![1.0; us.len()];
        if s.braiding > 0.0 {
            let is_braid: Vec<bool> = us
                .iter()
                .enumerate()
                .map(|(k, &u)| {
                    kind[k] == 0.0 && braid[((u + 0.5).floor() as usize).min(count - 1)] == 1
                })
                .collect();
            let mut k0 = 0;
            while k0 < is_braid.len() {
                if !is_braid[k0] {
                    k0 += 1;
                    continue;
                }
                let mut k1 = k0;
                while k1 + 1 < is_braid.len() && is_braid[k1 + 1] {
                    k1 += 1
                }
                if let Some((made, cnt, length)) = braid_threads(
                    &ctx,
                    &out,
                    &lv,
                    &line_area,
                    k0,
                    k1,
                    id,
                    rng.fork(&format!("{id}:{k0}:braid")),
                    s,
                ) {
                    braids.extend(made);
                    for k in k0..=k1 {
                        threads[k] = cnt as f64;
                        kind[k] = 3.0
                    }
                    network.braided_km += length / 1000.0
                }
                k0 = k1 + 1
            }
        }
        chains[id] =
            Some(cells[..cells.len().min(us.last().unwrap().floor() as usize + 2)].to_vec());
        widest = widest.max(channel_width(*line_area.last().unwrap(), s.width_scale));
        traced.add(&out, id);
        lines[id] = Some(Line {
            points: out,
            area: line_area,
            level: lv,
            kind,
            id: Some(id),
            joins: Some(joins),
            threads: Some(threads),
            outlet: cells.last().copied(),
        });
    }
    if s.deltas {
        deltas(&ctx, s, &order, &streams, &lines, &rng, &mut network)
    }
    for line in lines.iter().flatten() {
        let stream = &streams[line.id.unwrap()];
        if line.joins.unwrap_or(-1) >= 0
            || stream.end < 0
            || still[stream.end as usize] == 0
            || g.sea[stream.end as usize] != 0
        {
            continue;
        }
        let mut route = Vec::new();
        let mut seen = HashSet::default();
        let mut c = stream.end;
        let mut target_line = None;
        while c >= 0 && seen.insert(c) {
            let at = c as usize;
            route.push(at);
            if g.sea[at] != 0 {
                break;
            }
            if still[at] == 0 && river[at] != 0 {
                let mut id = stream_of[at];
                while id >= 0 && absorbed_by[id as usize] >= 0 {
                    id = absorbed_by[id as usize]
                }
                if id >= 0 && lines[id as usize].is_some() && Some(id as usize) != line.id {
                    target_line = lines[id as usize].as_ref();
                    break;
                }
            }
            c = g.receiver[at]
        }
        let floor = ctx.across_beds(route, None, &mut HashSet::default(), true);
        let mut points = line.points[line.points.len() - 2..].to_vec();
        for c in floor {
            let (x, y) = ctx.centre(c);
            points.extend([x, y])
        }
        if let Some(target) = target_line {
            let (x, y) = nearest_on_line(
                &target.points,
                points[points.len() - 2],
                points[points.len() - 1],
            );
            points.extend([x, y])
        }
        if points.len() < 4 {
            continue;
        }
        for _ in 0..2 {
            let mut next = points[..2].to_vec();
            for k in (0..points.len() - 3).step_by(2) {
                next.extend([
                    0.75 * points[k] + 0.25 * points[k + 2],
                    0.75 * points[k + 1] + 0.25 * points[k + 3],
                    0.25 * points[k] + 0.75 * points[k + 2],
                    0.25 * points[k + 1] + 0.75 * points[k + 3],
                ])
            }
            next.extend_from_slice(&points[points.len() - 2..]);
            points = next
        }
        let mut link = Line::uniform(
            points,
            *line.area.last().unwrap(),
            *line.level.last().unwrap(),
            2.0,
            None,
        );
        link.joins = Some(target_line.and_then(|t| t.id).map_or(-1, |i| i as i32));
        network.lake_links.push(link)
    }
    network.oxbows = clear_oxbows(&ctx, s, &traced, oxbows);
    network.braids = braids
        .into_iter()
        .filter(|line| {
            let p = &line.points;
            for k in (2..p.len().saturating_sub(5)).step_by(2) {
                if let Some(near) = traced.nearest(p[k], p[k + 1], 0.5) {
                    if Some(near.line) != line.id {
                        return false;
                    }
                }
            }
            true
        })
        .collect();
    network.rivers = lines.into_iter().flatten().collect();
    let mut length = 0.0;
    for line in &network.rivers {
        for k in (2..line.points.len()).step_by(2) {
            length +=
                (line.points[k] - line.points[k - 2]).hypot(line.points[k + 1] - line.points[k - 1])
        }
    }
    network.length_km = length / 1000.0;
    network
}
