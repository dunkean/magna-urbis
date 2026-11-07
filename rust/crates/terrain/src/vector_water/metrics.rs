use super::*;
use rivers::{Network, channel_width};
#[derive(Default, Serialize)]
pub struct Metrics {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hack: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub flint: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub bifurcation: Option<f64>,
    pub order: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub wavelength: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sinuosity: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub confluence: Option<f64>,
}
fn slope(xs: &[f64], ys: &[f64]) -> Option<f64> {
    let n = xs.len();
    if n < 3 {
        return None;
    }
    let (mut mx, mut my) = (0.0, 0.0);
    for i in 0..n {
        mx += xs[i];
        my += ys[i]
    }
    mx /= n as f64;
    my /= n as f64;
    let (mut sxy, mut sxx) = (0.0, 0.0);
    for i in 0..n {
        sxy += (xs[i] - mx) * (ys[i] - my);
        sxx += (xs[i] - mx).powi(2)
    }
    (sxx > 1e-9).then(|| sxy / sxx)
}
fn median(values: &[f64]) -> Option<f64> {
    if values.is_empty() {
        return None;
    }
    let mut s = values.to_vec();
    s.sort_by(f64::total_cmp);
    Some(s[s.len() / 2])
}
fn bin(bins: &mut Vec<(i32, Vec<f64>)>, key: i32, value: f64) {
    if let Some((_, v)) = bins.iter_mut().find(|(k, _)| *k == key) {
        v.push(value)
    } else {
        bins.push((key, vec![value]))
    }
}
fn binned_slope(bins: &[(i32, Vec<f64>)]) -> Option<f64> {
    let (mut x, mut y) = (Vec::new(), Vec::new());
    for (key, values) in bins {
        if values.len() >= 5 {
            x.push(*key as f64 / 4.0);
            y.push(median(values).unwrap())
        }
    }
    slope(&x, &y)
}
pub(super) fn river_metrics(
    h: &Hydrology,
    still: &[u8],
    network: Option<&Network>,
    river_area: f64,
    width_scale: f64,
) -> Metrics {
    let n = h.n;
    let total = n * n;
    let cell = h.width / n as f64;
    let threshold = river_area * 1e6;
    let g = &h.grids;
    let river: Vec<bool> = (0..total)
        .map(|c| g.sea[c] == 0 && g.accumulation[c] as f64 >= threshold)
        .collect();
    let channel: Vec<bool> = (0..total).map(|c| river[c] && still[c] == 0).collect();
    let dist = |c: usize, r: usize| {
        if c % n != r % n && c / n != r / n {
            std::f64::consts::SQRT_2 * cell
        } else {
            cell
        }
    };
    let mut bins = Vec::new();
    for c in 0..total {
        let r = g.receiver[c];
        if !channel[c] || r < 0 {
            continue;
        }
        let s = (g.filled[c] as f64 - g.filled[r as usize] as f64) / dist(c, r as usize);
        if s <= 1e-4 {
            continue;
        }
        let key = ((g.accumulation[c] as f64).log10() * 4.0 + 0.5).floor() as i32;
        bin(&mut bins, key, s.log10())
    }
    let flint = binned_slope(&bins).map(|v| -v);
    let (mut strahler, mut top, mut count) =
        (vec![0_u8; total], vec![0_u8; total], vec![0_u8; total]);
    for &cc in g.order.iter().rev() {
        let c = cc as usize;
        if !river[c] {
            continue;
        }
        if strahler[c] == 0 {
            strahler[c] = 1
        }
        let r = g.receiver[c];
        if r < 0 || !river[r as usize] {
            continue;
        }
        let r = r as usize;
        if strahler[c] > top[r] {
            top[r] = strahler[c];
            count[r] = 1
        } else if strahler[c] == top[r] {
            count[r] = count[r].wrapping_add(1)
        }
        strahler[r] = strahler[r].max(if count[r] >= 2 {
            top[r].wrapping_add(1)
        } else {
            top[r]
        })
    }
    let mut segments = vec![0; 256];
    for c in 0..total {
        if river[c] && top[c] != strahler[c] {
            segments[strahler[c] as usize] += 1
        }
    }
    let max_order = (1..256).filter(|&k| segments[k] > 0).max().unwrap_or(0);
    let mut ratios = Vec::new();
    for k in 1..max_order {
        if segments[k] > 0 && segments[k + 1] > 0 {
            ratios.push((segments[k] as f64 / segments[k + 1] as f64).ln())
        }
    }
    let bifurcation =
        (!ratios.is_empty()).then(|| (ratios.iter().sum::<f64>() / ratios.len() as f64).exp());
    let mut length = vec![0.0_f32; total];
    let mut main = vec![-1_i32; total];
    for &cc in g.order.iter().rev() {
        let c = cc as usize;
        let r = g.receiver[c];
        if r < 0 || g.sea[c] != 0 {
            continue;
        }
        let r = r as usize;
        if main[r] < 0 || g.accumulation[c] > g.accumulation[main[r] as usize] {
            main[r] = c as i32
        }
    }
    for &cc in g.order.iter().rev() {
        let c = cc as usize;
        let d = main[c];
        if d >= 0 {
            length[c] = (length[d as usize] as f64 + dist(c, d as usize)) as f32
        }
    }
    let mut hack = Vec::new();
    for c in 0..total {
        if !river[c] || length[c] <= 0.0 {
            continue;
        }
        let key = ((g.accumulation[c] as f64).log10() * 4.0 + 0.5).floor() as i32;
        bin(&mut hack, key, (length[c] as f64).log10())
    }
    let mut metrics = Metrics {
        hack: binned_slope(&hack),
        flint,
        bifurcation,
        order: max_order,
        ..Metrics::default()
    };
    let Some(network) = network else {
        return metrics;
    };
    let (mut wavelengths, mut sinuosities) = (Vec::new(), Vec::new());
    for line in &network.rivers {
        let p = &line.points;
        let m = line.kind.len();
        let mut i = 0;
        while i < m {
            if line.kind[i] != 1.0 {
                i += 1;
                continue;
            }
            let mut j = i;
            while j + 1 < m && line.kind[j + 1] == 1.0 {
                j += 1
            }
            if j - i >= 8 {
                let width = channel_width(line.area[(i + j) / 2], width_scale);
                let mut arc = 0.0;
                let mut last = None;
                let mut last_sign = 0.0;
                let mut arc_at = vec![0.0];
                for k in i + 1..=j {
                    arc += (p[2 * k] - p[2 * k - 2]).hypot(p[2 * k + 1] - p[2 * k - 1]);
                    arc_at.push(arc)
                }
                sinuosities.push(
                    arc / (p[2 * j] - p[2 * i])
                        .hypot(p[2 * j + 1] - p[2 * i + 1])
                        .max(1.0),
                );
                for k in i + 3..=j - 3 {
                    let (ax, ay, bx, by) = (
                        p[2 * k] - p[2 * k - 6],
                        p[2 * k + 1] - p[2 * k - 5],
                        p[2 * k + 6] - p[2 * k],
                        p[2 * k + 7] - p[2 * k + 1],
                    );
                    let sign = {
                        let v = ax * by - ay * bx;
                        if v == 0.0 { 0.0 } else { v.signum() }
                    };
                    if sign == 0.0 || sign == last_sign {
                        continue;
                    }
                    if let Some(last) = last {
                        let half = arc_at[k - i] - arc_at[last - i];
                        if half >= width {
                            wavelengths.push(2.0 * half / width)
                        }
                    }
                    last_sign = sign;
                    last = Some(k)
                }
            }
            i = j + 1
        }
    }
    metrics.wavelength = median(&wavelengths);
    metrics.sinuosity = (!sinuosities.is_empty())
        .then(|| sinuosities.iter().sum::<f64>() / sinuosities.len() as f64);
    let mut angles = Vec::new();
    for line in &network.rivers {
        let Some(joins) = line.joins.filter(|&j| j >= 0) else {
            continue;
        };
        let Some(parent) = network.rivers.iter().find(|l| l.id == Some(joins as usize)) else {
            continue;
        };
        let p = &line.points;
        let m = p.len() / 2 - 1;
        let (jx, jy) = (p[2 * m], p[2 * m + 1]);
        let (mut k, mut arc) = (m, 0.0);
        while k > 0 && arc < 3.0 * cell {
            arc += (p[2 * k] - p[2 * k - 2]).hypot(p[2 * k + 1] - p[2 * k - 1]);
            k -= 1
        }
        if arc < cell {
            continue;
        }
        let (tx, ty) = (jx - p[2 * k], jy - p[2 * k + 1]);
        let q = &parent.points;
        let (mut best, mut pk) = (f64::INFINITY, None);
        for i in (0..q.len() - 3).step_by(2) {
            let d = ((q[i] + q[i + 2]) / 2.0 - jx).hypot((q[i + 1] + q[i + 3]) / 2.0 - jy);
            if d < best {
                best = d;
                pk = Some(i)
            }
        }
        let Some(pk) = pk.filter(|_| best <= 2.0 * cell) else {
            continue;
        };
        let (a0, a1) = (pk.saturating_sub(6), (pk + 8).min(q.len() - 2));
        let (px, py) = (q[a1] - q[a0], q[a1 + 1] - q[a0 + 1]);
        let denom = tx.hypot(ty) * px.hypot(py);
        let cos = (tx * px + ty * py) / if denom == 0.0 { 1.0 } else { denom };
        angles.push(cos.clamp(-1.0, 1.0).acos() * 180.0 / std::f64::consts::PI)
    }
    metrics.confluence = median(&angles);
    metrics
}
