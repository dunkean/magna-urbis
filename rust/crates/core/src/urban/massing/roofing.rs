//! Roof forms and division of large bodies along their ridge.

use super::*;

pub(super) struct Roof {
    pub(super) kind: &'static str,
    pub(super) rise: f64,
    pub(super) ridges: Vec<Value>,
}
/// Roof of one convex volume: ridges strictly inside the ring, along axis `u`
/// (gable, hip, barrel, shed). `high` points to the shed's high side.
pub(super) fn roof_of(ring: &[Point], mut kind: &'static str, mut pitch: f64, u: Point, high: Point) -> Roof {
    let flat = Roof { kind: "flat", rise: 0.0, ridges: vec![] };
    if kind == "flat" || ring.len() < 3 || reflex_count(ring) > 0 {
        return flat;
    }
    let area = ring_area(ring);
    let g = ring_centroid(ring);
    if matches!(kind, "pyramid" | "cone" | "tent" | "dome") {
        let Some(f) = min_frame(ring) else { return flat };
        let reach = f.half_w.max(f.half_l.min(f.half_w * 1.4));
        let rise = match kind {
            "dome" => f.half_w.min(f.half_l) * 0.9,
            "tent" => reach * pitch.max(30.0).to_radians().tan().min(0.75),
            _ => reach * pitch.to_radians().tan(),
        };
        return Roof { kind, rise, ridges: vec![seg(g, g)] };
    }
    let fr = frame_along(ring, u);
    if fr.half_l < 1e-6 {
        return flat;
    }
    let half = area / (4.0 * fr.half_l);
    if half < 1.4 && matches!(kind, "gable" | "hip" | "barrel") {
        kind = "shed";
        pitch = pitch.min(20.0);
    }
    let tan = pitch.to_radians().tan();
    let n = perp(u);
    let tg = g.x * n.x + g.y * n.y;
    let Some((s0, s1)) = chord(ring, u, tg) else { return flat };
    let e = 0.05;
    let ridge = |a: f64, b: f64, t: f64| {
        if b - a < 0.1 {
            let m = at_st(u, (a + b) / 2.0, t);
            seg(m, m)
        } else {
            seg(at_st(u, a, t), at_st(u, b, t))
        }
    };
    match kind {
        "gable" => Roof { kind, rise: half * tan, ridges: vec![ridge(s0 + e, s1 - e, tg)] },
        "barrel" => Roof { kind, rise: half * 0.8, ridges: vec![ridge(s0 + e, s1 - e, tg)] },
        "hip" => {
            let inset = half.min((s1 - s0) / 2.0 - e).max(e);
            Roof { kind, rise: half * tan, ridges: vec![ridge(s0 + inset, s1 - inset, tg)] }
        }
        _ => {
            let sign = if high.x * n.x + high.y * n.y >= 0.0 { 1.0 } else { -1.0 };
            let ts = ring.iter().map(|p| p.x * n.x + p.y * n.y);
            let ext = if sign > 0.0 { ts.fold(f64::MIN, f64::max) } else { ts.fold(f64::MAX, f64::min) };
            let full = s1 - s0;
            let mut r = None;
            for k in 0..8 {
                let t = ext - sign * (0.05 + k as f64 * 0.24 * half);
                if let Some((a, b)) = chord(ring, u, t) {
                    if b - a >= 0.5 * full {
                        r = Some(ridge(a + e, b - e, t));
                        break;
                    }
                }
            }
            Roof { kind: "shed", rise: 2.0 * half * tan, ridges: vec![r.unwrap_or_else(|| ridge(s0 + e, s1 - e, tg))] }
        }
    }
}

/// A long or large convex body splits along its ridge axis into volumes of
/// different heights (segments with a raised part or a cross-gable, or two
/// side strips); returns (ring, storey delta, ridge turned across).
pub(super) fn split_body(ring: &[Point], u: Point, n: u32, kind: &str, rng: &mut Rng) -> Vec<(Vec<Point>, i32, bool)> {
    let single = || vec![(ring.to_vec(), 0, false)];
    if !matches!(kind, "gable" | "hip" | "flat") || reflex_count(ring) > 0 {
        return single();
    }
    let f = frame_along(ring, u);
    let (l, w) = (2.0 * f.half_l, 2.0 * f.half_w);
    let area = ring_area(ring);
    let s_lo = f.c.x * u.x + f.c.y * u.y - f.half_l;
    let nrm = perp(u);
    let t_lo = f.c.x * nrm.x + f.c.y * nrm.y - f.half_w;
    let long = l >= 15.0 || (area >= 150.0 && l >= 11.0);
    let mut out: Vec<(Vec<Point>, i32, bool)> = Vec::new();
    if long && rng.chance(0.85) {
        let cuts: Vec<f64> = if l >= 26.0 { vec![rng.range(0.28, 0.38), rng.range(0.62, 0.72)] } else { vec![rng.range(0.4, 0.6)] };
        let mut edges = vec![0.0];
        edges.extend(cuts);
        edges.push(1.0);
        let mut raised = false;
        for k in 0..edges.len() - 1 {
            let (a, b) = (s_lo + edges[k] * l, s_lo + edges[k + 1] * l);
            let part = clip_band(ring, u, a - 1e-9, b + 1e-9);
            let delta = if k == 0 {
                0
            } else if n <= 1 {
                i32::from(rng.chance(0.6))
            } else if rng.chance(0.5) {
                1
            } else {
                -1
            };
            raised |= delta != 0;
            let cross = kind != "flat" && (b - a) <= 1.5 * w && w >= 5.0 && rng.chance(0.5);
            out.push((part, delta, cross));
        }
        if !raised {
            if let Some(last) = out.last_mut() {
                last.1 = 1;
            }
        }
    } else if w >= 10.0 && area >= 110.0 && n >= 2 && rng.chance(0.5) {
        let cut = t_lo + w * rng.range(0.5, 0.62);
        out.push((clip_half(ring, nrm, cut), 0, false));
        out.push((clip_half(ring, Point { x: -nrm.x, y: -nrm.y }, -cut), -1, false));
    } else {
        return single();
    }
    if out.iter().any(|(p, _, _)| p.len() < 3 || ring_area(p) < 4.0) {
        return single();
    }
    out
}
