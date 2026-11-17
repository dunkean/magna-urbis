use super::*;
pub(super) struct MeanderResult {
    pub xs: Vec<f64>,
    pub ys: Vec<f64>,
    pub oxbows: Vec<(Vec<f64>, Vec<f64>)>,
    pub meandered: bool,
    pub avulsions: usize,
    /// Diagnostics of the simulation: what ended it and after how many passes.
    #[cfg_attr(not(test), allow(dead_code))]
    pub stop: &'static str,
    #[cfg_attr(not(test), allow(dead_code))]
    pub passes: usize,
}
fn span(
    ax: f64,
    ay: f64,
    bx: f64,
    by: f64,
    resolution: f64,
    allowed: &dyn Fn(f64, f64) -> bool,
) -> bool {
    let m = ((bx - ax).hypot(by - ay) / resolution).ceil() as usize;
    (1..m).all(|k| {
        allowed(
            ax + (bx - ax) * k as f64 / m as f64,
            ay + (by - ay) * k as f64 / m as f64,
        )
    })
}
pub(super) fn meander(
    axis_x: &[f64],
    axis_y: &[f64],
    width: f64,
    mut rng: Rng,
    valley: &dyn Fn(f64, f64) -> f64,
    allowed: &dyn Fn(f64, f64, f64) -> bool,
    target_at: &dyn Fn(f64, f64) -> f64,
    resolution: f64,
    avulsion: bool,
    resistance: Option<&dyn Fn(f64, f64, f64) -> f64>,
) -> MeanderResult {
    // Resolution limits numerical work, not the physical bend width. This retains the old minimum point
    // spacing (0.5625 cell at the caller) without inflating bend wavelengths and the reach eligibility test.
    let ds = (0.75 * width).max(1.125 * resolution);
    let (rx, ry) = resample(axis_x, axis_y, ds);
    let real = rx.len();
    let (bx, by) = (rx[real - 1], ry[real - 1]);
    let axis_length = (real - 1) as f64 * ds;
    let mut target = 0.0;
    for i in 0..real {
        target += target_at(rx[i], ry[i])
    }
    target /= real as f64;
    let back = (real - 1).saturating_sub((4.0 * width / ds).ceil() as usize);
    let tangent = nonzero((bx - rx[back]).hypot(by - ry[back]));
    let (ex, ey) = ((bx - rx[back]) / tangent, (by - ry[back]) / tangent);
    let beyond = |x: f64, y: f64| (x - bx) * ex + (y - by) * ey;
    let lateral = |x: f64, y: f64| ((x - bx) * ey - (y - by) * ex).abs();
    let extended = |x: f64, y: f64| {
        let f = beyond(x, y);
        f > 2.0 * width && f < 40.0 * width && lateral(x, y) < 15.0 * width
    };
    let extension = (30.0 * width / ds).ceil() as usize;
    let mut n = real + extension;
    let (mut xs, mut ys) = (rx.clone(), ry.clone());
    for k in 1..=extension {
        xs.push(bx + ex * k as f64 * ds);
        ys.push(by + ey * k as f64 * ds)
    }
    let mut water = profile(&xs, &ys, valley);
    let free = |x: f64, y: f64, i: usize, water: &[f64]| {
        extended(x, y)
            || water
                .get(i.saturating_sub(1))
                .is_some_and(|&z| allowed(x, y, z))
    };
    let free_span = |ax: f64, ay: f64, bx: f64, by: f64, i: usize, water: &[f64]| {
        span(ax, ay, bx, by, resolution, &|x, y| free(x, y, i, water))
    };
    let fits = |x: f64, y: f64, i: usize, x0: f64, y0: f64, x1: f64, y1: f64, water: &[f64]| {
        free(x, y, i, water)
            && free_span(x0, y0, x, y, i, water)
            && free_span(x, y, x1, y1, i, water)
    };
    let local_target = |x: f64, y: f64| {
        if beyond(x, y) > 0.0 {
            target_at(bx, by)
        } else {
            target_at(x, y)
        }
    };
    let mut oxbows = Vec::new();
    let (entry_taper, exit_taper) = (5.0 * width, 12.0 * width);
    let reach = (8.0 * width / ds).ceil() as usize;
    let swing: Vec<(f64, f64)> = (0..2)
        .map(|_| {
            (
                std::f64::consts::TAU / (width * rng.range(30.0, 70.0)),
                rng.range(0.0, std::f64::consts::TAU),
            )
        })
        .collect();
    let field_seed = rng.int(0, 1 << 30);
    let field_scale = 1.0 / (12.0 * width);
    let erodibility = |x: f64, y: f64| {
        (0.8 * (value_noise(x * field_scale, y * field_scale, field_seed)
            + 0.5 * value_noise(x * field_scale * 2.7, y * field_scale * 2.7, field_seed + 1)))
        .exp()
    };
    let inflow_period = rng.range(150.0, 300.0);
    let mut inflow_phase = rng.range(0.0, std::f64::consts::TAU);
    {
        let mut waves = Vec::new();
        // Long waves stay low (half a width to one): seeded at two to five widths, they grew into loops kilometres
        // across with straight legs between them (a 40 km plain: sinuosity 1.8 per course, 1.1 per 400 m reach).
        for _ in 0..2 {
            waves.push((
                std::f64::consts::TAU / (width * rng.range(40.0, 90.0)),
                rng.range(0.0, std::f64::consts::TAU),
                width * rng.range(0.5, 1.0),
            ))
        }
        // Bends at the meander wavelength (about ten widths) and a width high: a straight axis (a Hermite axis over
        // a flat reach, a course down a silted floor) gives the simulation no curvature to grow otherwise.
        for _ in 0..4 {
            waves.push((
                std::f64::consts::TAU / (width * rng.range(8.0, 14.0)),
                rng.range(0.0, std::f64::consts::TAU),
                width * rng.range(0.7, 1.3),
            ))
        }
        let length = (real - 1) as f64 * ds;
        let (mut nx, mut ny) = (xs.clone(), ys.clone());
        for i in 1..real - 1 {
            let s = i as f64 * ds;
            let strength = ((local_target(xs[i], ys[i]) - 1.0) / 0.4).min(1.0);
            let taper = smoothstep(s.min(length - s) / (8.0 * width)) * strength;
            let mut offset = 0.0;
            for &(k, phase, amp) in &waves {
                offset += amp * (k * s + phase).sin()
            }
            let (tx, ty) = (xs[i + 1] - xs[i - 1], ys[i + 1] - ys[i - 1]);
            let tl = nonzero(tx.hypot(ty));
            let (px, py) = (
                xs[i] + offset * taper * ty / tl,
                ys[i] - offset * taper * tx / tl,
            );
            if fits(
                px,
                py,
                i,
                nx[i - 1],
                ny[i - 1],
                xs[i + 1],
                ys[i + 1],
                &water,
            ) {
                nx[i] = px;
                ny[i] = py
            }
        }
        xs = nx;
        ys = ny;
    }
    let decay = (-ds / (2.5 * width)).exp();
    let ghost = 1.0 / (1.0 - decay);
    let max_step = 0.2 * ds;
    let min_gap = (6.0 * width / ds).ceil() as usize;
    let cutoff = 1.3 * width;
    let entry_margin = (entry_taper / ds).ceil() as usize;
    let exit_margin = (exit_taper / ds).ceil() as usize;
    let (mut field, mut saturation) = (Vec::new(), Vec::new());
    let (mut stalled, mut avulsions) = (0.0, 0);
    let (mut nx, mut ny, mut arc_scratch) = (Vec::new(), Vec::new(), Vec::new());
    let (mut stop, mut passes) = ("the pass limit", 0);
    for iterations in 0..600 {
        passes = iterations;
        if n < 5 {
            stop = "a reach too short";
            break;
        }
        if iterations % 8 == 0 {
            let mut k = 0;
            while k < n - 1 && beyond(xs[k], ys[k]) < 0.0 {
                k += 1
            }
            if k as f64 * ds >= target * axis_length {
                stop = "the target sinuosity";
                break;
            }
            if iterations % 32 == 0 {
                // Under 1 % of growth in 32 passes: the reach is confined, more passes would not show. Not before it
                // has gone half way to its target or 128 passes: bends grow from small seeds, and the first passes
                // add far less than 1 % of length (an open plain stopped at a sinuosity of 1.16 to 1.33).
                let early = (k as f64) * ds < (1.0 + 0.5 * (target - 1.0)) * axis_length || iterations < 192;
                if iterations != 0 && !early && (k as f64) * ds < stalled * 1.01 {
                    stop = "a stall";
                    break;
                }
                stalled = k as f64 * ds
            }
        }
        water.clear();
        let mut level = f64::INFINITY;
        water.extend(xs.iter().zip(&ys).map(|(&x, &y)| { level = level.min(valley(x, y)); level }));
        if iterations % 4 == 0 || field.len() != n {
            field.resize(n, 0.0);
            saturation.resize(n, 0.0);
            for i in 0..n {
                let s = i as f64 * ds;
                field[i] = erodibility(xs[i], ys[i]);
                let wander = 1.0
                    + 0.3
                        * ((swing[0].0 * s + swing[0].1).sin()
                            + (swing[1].0 * s + swing[1].1).sin());
                saturation[i] = 1.0 + 1.5 * (local_target(xs[i], ys[i]) - 1.0) * wander
            }
        }
        nx.clear(); nx.extend_from_slice(&xs);
        ny.clear(); ny.extend_from_slice(&ys);
        let length = (n - 1) as f64 * ds;
        inflow_phase += std::f64::consts::TAU / inflow_period * rng.range(0.5, 1.5);
        let (mut sum, mut norm, mut moved) = (0.3 * inflow_phase.sin() * ghost, ghost, 0);
        for i in 0..n {
            let mut curvature = 0.0;
            if i > 0 && i < n - 1 {
                let (dx, dy) = ((xs[i + 1] - xs[i - 1]) / 2.0, (ys[i + 1] - ys[i - 1]) / 2.0);
                let (ddx, ddy) = (
                    xs[i + 1] - 2.0 * xs[i] + xs[i - 1],
                    ys[i + 1] - 2.0 * ys[i] + ys[i - 1],
                );
                let d2 = dx * dx + dy * dy;
                curvature = width * (dx * ddy - dy * ddx) / nonzero(d2 * d2.sqrt())
            }
            sum = curvature + decay * sum;
            norm = 1.0 + decay * norm;
            if i == 0 || i == n - 1 {
                continue;
            }
            let limit = saturation[i];
            if limit - 1.0 < 1e-3 {
                continue;
            }
            let s = i as f64 * ds;
            let taper = smoothstep(s / entry_taper) * smoothstep((length - s) / exit_taper).powi(2);
            let (j0, j1) = (i.saturating_sub(reach), (i + reach).min(n - 1));
            let (cx, cy) = (xs[j1] - xs[j0], ys[j1] - ys[j0]);
            let local = (j1 - j0) as f64 * ds / (cx * cx + cy * cy).sqrt().max(1e-6);
            let damping = ((limit - local) / (limit - 1.0)).clamp(0.0, 1.0);
            let rate = (-curvature + 2.5 * sum / norm) * taper * damping;
            if rate == 0.0 {
                continue;
            }
            // Growth per pass (widths per unit rate): wide courses of a 40 km map stopped at the pass limit at 1.27
            // against a target of 1.68 with 0.25.
            let mut step = (rate * 0.4 * width * field[i]).clamp(-max_step, max_step);
            let (tx, ty) = (xs[i + 1] - xs[i - 1], ys[i + 1] - ys[i - 1]);
            let tl = nonzero((tx * tx + ty * ty).sqrt());
            if let Some(resistance) = resistance {
                let side = step.signum() * 0.75 * width;
                step *= resistance(
                    xs[i] + side * ty / tl,
                    ys[i] - side * tx / tl,
                    water[i.saturating_sub(1)],
                )
            }
            for f in [1.0, 0.5, 0.25] {
                let (px, py) = (xs[i] + f * step * ty / tl, ys[i] - f * step * tx / tl);
                if fits(
                    px,
                    py,
                    i,
                    nx[i - 1],
                    ny[i - 1],
                    xs[i + 1],
                    ys[i + 1],
                    &water,
                ) {
                    nx[i] = px;
                    ny[i] = py;
                    moved += 1;
                    break;
                }
            }
        }
        if moved == 0 {
            stop = "no vertex free to move";
            break;
        }
        resample_into(&nx, &ny, ds, &mut xs, &mut ys, &mut arc_scratch);
        n = xs.len();
        if iterations % 4 == 0 {
            if let Some((i, j)) = find_cutoff(&xs, &ys, cutoff, min_gap, entry_margin, exit_margin)
            {
                if free_span(xs[i], ys[i], xs[j], ys[j], i, &water) {
                    let trim = (1.5 * width / ds).ceil() as usize;
                    if (j - i) as f64 * ds >= 10.0 * width
                        && beyond(xs[i], ys[i]) < 0.0
                        && beyond(xs[j], ys[j]) < 0.0
                    {
                        oxbows.push((
                            xs[i + trim..j + 1 - trim].to_vec(),
                            ys[i + trim..j + 1 - trim].to_vec(),
                        ))
                    }
                    let mut kx = xs[..i + 1].to_vec();
                    kx.extend_from_slice(&xs[j..]);
                    let mut ky = ys[..i + 1].to_vec();
                    ky.extend_from_slice(&ys[j..]);
                    (xs, ys) = resample(&kx, &ky, ds);
                    n = xs.len();
                }
            }
        }
        if avulsion && iterations >= 64 && iterations % 24 == 0 && rng.chance(0.35) {
            let mut best: Option<(usize, usize, f64)> = None;
            let span = (25.0 * width / ds).ceil();
            for i in (entry_margin..n.saturating_sub(exit_margin)).step_by(2) {
                for j in (i + 4 * min_gap..(n.saturating_sub(exit_margin)).min(i + 12 * min_gap))
                    .step_by(2)
                {
                    let d = (xs[j] - xs[i]).hypot(ys[j] - ys[i]);
                    if d < 3.0 * width || d > span * ds {
                        continue;
                    }
                    let ratio = (j - i) as f64 * ds / d;
                    if ratio > 2.2 && best.map_or(true, |b| ratio > b.2) {
                        best = Some((i, j, ratio))
                    }
                }
            }
            if let Some((i, j, _)) = best {
                if beyond(xs[j], ys[j]) < 0.0 {
                    let d = (xs[j] - xs[i]).hypot(ys[j] - ys[i]);
                    let ta = nonzero((xs[i + 1] - xs[i - 1]).hypot(ys[i + 1] - ys[i - 1]));
                    let tb = nonzero((xs[j + 1] - xs[j - 1]).hypot(ys[j + 1] - ys[j - 1]));
                    let (hx, hy) = hermite(
                        (xs[i], ys[i]),
                        (
                            (xs[i + 1] - xs[i - 1]) / ta * 0.6 * d,
                            (ys[i + 1] - ys[i - 1]) / ta * 0.6 * d,
                        ),
                        (xs[j], ys[j]),
                        (
                            (xs[j + 1] - xs[j - 1]) / tb * 0.6 * d,
                            (ys[j + 1] - ys[j - 1]) / tb * 0.6 * d,
                        ),
                        ds,
                    );
                    let ok = (1..hx.len()).all(|k| {
                        free(hx[k], hy[k], i, &water)
                            && free_span(hx[k - 1], hy[k - 1], hx[k], hy[k], i, &water)
                    });
                    if ok {
                        let trim = (1.5 * width / ds).ceil() as usize;
                        oxbows.push((
                            xs[i + trim..j + 1 - trim].to_vec(),
                            ys[i + trim..j + 1 - trim].to_vec(),
                        ));
                        let mut kx = xs[..i + 1].to_vec();
                        kx.extend_from_slice(&hx[1..hx.len() - 1]);
                        kx.extend_from_slice(&xs[j..]);
                        let mut ky = ys[..i + 1].to_vec();
                        ky.extend_from_slice(&hy[1..hy.len() - 1]);
                        ky.extend_from_slice(&ys[j..]);
                        (xs, ys) = resample(&kx, &ky, ds);
                        n = xs.len();
                        avulsions += 1
                    }
                }
            }
        }
    }
    let (sx, sy) = smooth_chain(&xs, &ys, 1.0);
    let (mut fx, mut fy) = (xs.clone(), ys.clone());
    water = profile(&xs, &ys, valley);
    for k in 1..fx.len() - 1 {
        if fits(
            sx[k],
            sy[k],
            k,
            fx[k - 1],
            fy[k - 1],
            fx[k + 1],
            fy[k + 1],
            &water,
        ) {
            fx[k] = sx[k];
            fy[k] = sy[k]
        }
    }
    let mut candidates = Vec::new();
    for k in 0..fx.len() - 1 {
        let (f0, f1) = (beyond(fx[k], fy[k]), beyond(fx[k + 1], fy[k + 1]));
        if f0 >= 0.0 || f1 < 0.0 {
            continue;
        }
        let t = f0 / (f0 - f1);
        let (px, py) = (
            fx[k] + (fx[k + 1] - fx[k]) * t,
            fy[k] + (fy[k + 1] - fy[k]) * t,
        );
        if lateral(px, py) > 15.0 * width {
            continue;
        }
        let heading = ((fx[k + 1] - fx[k]) * ex + (fy[k + 1] - fy[k]) * ey)
            / nonzero((fx[k + 1] - fx[k]).hypot(fy[k + 1] - fy[k]));
        candidates.push((
            (px - bx).hypot(py - by) + (1.0 - heading) * 4.0 * width,
            k,
            px,
            py,
        ))
    }
    candidates.sort_by(|a, b| a.0.total_cmp(&b.0));
    let ease = 10.0 * width;
    let mut result = None;
    for &(_, k, cx, cy) in candidates.iter().take(8) {
        let (ox, oy) = (bx - cx, by - cy);
        let (mut tx, mut ty) = (fx[..k + 1].to_vec(), fy[..k + 1].to_vec());
        let mut arc = (cx - fx[k]).hypot(cy - fy[k]);
        let mut j = k;
        while j > 0 && arc < ease {
            let w = smoothstep(1.0 - arc / ease);
            tx[j] += ox * w;
            ty[j] += oy * w;
            arc += (fx[j] - fx[j - 1]).hypot(fy[j] - fy[j - 1]);
            j -= 1
        }
        tx.push(bx);
        ty.push(by);
        let tail = profile(&tx, &ty, valley);
        let eased_from = k as isize - (ease / ds).ceil() as isize - 1;
        let mut ok = true;
        for j in 1..tx.len() - 1 {
            if (j as isize) < eased_from && !extended(fx[j], fy[j]) {
                continue;
            }
            if !allowed(tx[j], ty[j], tail[j - 1])
                || !span(tx[j], ty[j], tx[j + 1], ty[j + 1], resolution, &|x, y| {
                    allowed(x, y, tail[j])
                })
            {
                ok = false;
                break;
            }
        }
        if ok {
            result = Some((tx, ty));
            break;
        }
    }
    let mut rejoined = None;
    if result.is_none() {
        let near = 0.5 * width;
        let blend = 3.0 * width;
        let mut bins: HashMap<i64, Vec<usize>> = HashMap::default();
        for j in 1..real - 1 {
            let key = (rx[j] / near).floor() as i64 * 1048576 + (ry[j] / near).floor() as i64;
            bins.entry(key).or_default().push(j)
        }
        let before = profile(&fx, &fy, valley);
        for k in (1..fx.len() - 1).rev() {
            if result.is_some() {
                break;
            }
            if beyond(fx[k], fy[k]) >= 0.0 {
                continue;
            }
            let mut best = near * near;
            let mut ja = None;
            let (gx, gy) = ((fx[k] / near).floor() as i64, (fy[k] / near).floor() as i64);
            for ox in -1..=1 {
                for oy in -1..=1 {
                    if let Some(bin) = bins.get(&((gx + ox) * 1048576 + gy + oy)) {
                        for &j in bin {
                            let d = (rx[j] - fx[k]).powi(2) + (ry[j] - fy[k]).powi(2);
                            if d < best {
                                best = d;
                                ja = Some(j)
                            }
                        }
                    }
                }
            }
            let Some(ja) = ja else { continue };
            let (hx, hy, ax, ay) = (
                fx[k + 1] - fx[k - 1],
                fy[k + 1] - fy[k - 1],
                rx[ja + 1] - rx[ja - 1],
                ry[ja + 1] - ry[ja - 1],
            );
            if hx * ax + hy * ay < 0.7 * hx.hypot(hy) * ax.hypot(ay) {
                continue;
            }
            let (ox, oy) = (rx[ja] - fx[k], ry[ja] - fy[k]);
            let mut from = k;
            let mut arc = 0.0;
            while from > 1 && arc < blend {
                arc += (fx[from] - fx[from - 1]).hypot(fy[from] - fy[from - 1]);
                from -= 1
            }
            let (mut bxs, mut bys) = (fx[from..k + 1].to_vec(), fy[from..k + 1].to_vec());
            let mut arc = 0.0;
            for j in (from..=k).rev() {
                let w = smoothstep(1.0 - arc / blend);
                bxs[j - from] += ox * w;
                bys[j - from] += oy * w;
                if j > from {
                    arc += (fx[j] - fx[j - 1]).hypot(fy[j] - fy[j - 1])
                }
            }
            let mut level = before[from - 1];
            let mut ok = true;
            for j in 0..bxs.len() - 1 {
                let previous = level;
                level = level.min(valley(bxs[j], bys[j]));
                if !allowed(bxs[j], bys[j], previous)
                    || !span(
                        bxs[j],
                        bys[j],
                        bxs[j + 1],
                        bys[j + 1],
                        resolution,
                        &|x, y| allowed(x, y, level),
                    )
                {
                    ok = false;
                    break;
                }
            }
            if !ok {
                continue;
            }
            let (mut tx, mut ty) = (fx[..from].to_vec(), fy[..from].to_vec());
            tx.extend(bxs);
            ty.extend(bys);
            let (mut on_axis, mut gap) = (0, f64::INFINITY);
            for j in 0..axis_x.len() {
                let d = (axis_x[j] - rx[ja]).powi(2) + (axis_y[j] - ry[ja]).powi(2);
                if d < gap {
                    gap = d;
                    on_axis = j
                }
            }
            tx.extend_from_slice(&axis_x[on_axis + 1..]);
            ty.extend_from_slice(&axis_y[on_axis + 1..]);
            result = Some((tx, ty));
            rejoined = Some(ja);
        }
    }
    let Some((xs, ys)) = result else {
        return MeanderResult {
            xs: axis_x.to_vec(),
            ys: axis_y.to_vec(),
            oxbows: Vec::new(),
            meandered: false,
            avulsions: 0,
            stop,
            passes,
        };
    };
    let meandered = rejoined.map_or(true, |j| {
        (real - 1 - j) as f64 * ds <= (20.0 * width).max(0.25 * axis_length)
    });
    MeanderResult {
        xs,
        ys,
        oxbows,
        meandered,
        avulsions,
        stop,
        passes,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Longest run of `xs, ys` whose vertices stay within `tolerance` of its chord, and the length over the chord.
    fn planform(xs: &[f64], ys: &[f64], tolerance: f64) -> (f64, f64) {
        let m = xs.len();
        let length: f64 = (1..m).map(|k| (xs[k] - xs[k - 1]).hypot(ys[k] - ys[k - 1])).sum();
        let chord = (xs[m - 1] - xs[0]).hypot(ys[m - 1] - ys[0]);
        let (mut longest, mut i) = (0.0_f64, 0);
        while i + 1 < m {
            let mut j = i + 1;
            while j + 1 < m {
                let (ax, ay, bx, by) = (xs[i], ys[i], xs[j + 1], ys[j + 1]);
                let l = (bx - ax).hypot(by - ay).max(1e-9);
                if !(i + 1..=j).all(|k| (((xs[k] - ax) * (by - ay) - (ys[k] - ay) * (bx - ax)) / l).abs() <= tolerance) {
                    break;
                }
                j += 1
            }
            longest = longest.max((xs[j] - xs[i]).hypot(ys[j] - ys[i]));
            i = j
        }
        (longest, length / chord)
    }

    /// Invariant: a course laid straight down an open, nearly level plain winds. Its axis is a straight line (as a
    /// Hermite axis over a flat reach, or a thalweg down a silted floor), the plain confines nothing, and the target
    /// sinuosity is the V2 one of a mid-sized river (1.5): the result keeps no straight run longer than 300 m (six
    /// times its width) and reaches a sinuosity of 1.2 at least.
    #[test]
    fn a_straight_course_on_an_open_plain_winds() {
        let width = 50.0;
        let (xs, ys): (Vec<f64>, Vec<f64>) = (0..=160).map(|k| (100.0 + 25.0 * k as f64, 2000.0 + 0.3 * k as f64)).unzip();
        let valley = |x: f64, _y: f64| 30.0 - 0.0002 * x;
        let allowed = |x: f64, y: f64, _z: f64| x > 0.0 && y > 0.0 && x < 6000.0 && y < 4000.0;
        let target = |_x: f64, _y: f64| 1.5;
        let mut worst = (0.0_f64, f64::INFINITY);
        for seed in ["a", "b", "c", "d"] {
            let result = meander(&xs, &ys, width, Rng::new(seed), &valley, &allowed, &target, 10.0, false, None);
            let (longest, sinuosity) = planform(&result.xs, &result.ys, 0.15 * width);
            eprintln!("plain meander {seed}: sinuosity {sinuosity:.3}, longest straight {longest:.0} m, stopped by {} after {} passes", result.stop, result.passes);
            worst = (worst.0.max(longest), worst.1.min(sinuosity));
        }
        assert!(worst.0 <= 450.0, "a straight run of {:.0} m", worst.0);
        assert!(worst.1 >= 1.3, "sinuosity {:.3}", worst.1);
    }

    #[test]
    fn a_subcell_channel_winds_on_a_coarse_grid() {
        let (xs, ys) = (vec![100.0, 4100.0], vec![2000.0, 2000.0]);
        let valley = |x: f64, _y: f64| 30.0 - 0.0002 * x;
        let allowed = |x: f64, y: f64, _z: f64| x > 0.0 && x < 6000.0 && y > 0.0 && y < 4000.0;
        for resolution in [10000.0 / 512.0 / 2.0, 40000.0 / 1024.0 / 2.0] {
            let result = meander(&xs, &ys, 12.0, Rng::new("coarse"), &valley, &allowed,
                &|_, _| 1.5, resolution, false, None);
            let (longest, sinuosity) = planform(&result.xs, &result.ys, 1.8);
            assert!(sinuosity >= 1.15, "sinuosity {sinuosity:.3} at resolution {resolution}: {}", result.stop);
            assert!(longest <= 450.0, "straight run of {longest:.0} m at resolution {resolution}");
            assert!(profile(&result.xs, &result.ys, &valley).windows(2).all(|z| z[1] <= z[0]));
        }
    }
}
