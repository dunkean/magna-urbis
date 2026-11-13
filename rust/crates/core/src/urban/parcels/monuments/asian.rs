//! East, South and South-East Asia (families `chinese`, `japanese`, `indic`): pagodas, stupas, temple and palace compounds, drum and bell towers, stepwells, ghats, tanks.
//!
//! See `mod.rs` for the contract: lay labelled, non-overlapping parts on the
//! site and return true for a role this family builds.
use super::utility::{edges, holed, laid};
use super::{Brief, Site};
use crate::rng::Rng;

pub(super) fn build(x: &mut Site, q: &Brief, _rng: &mut Rng) -> bool {
    let east = matches!(q.family, "chinese" | "japanese");
    let indic = q.family == "indic";
    let steppe = matches!(q.culture, "mongol-ordu" | "nomad-camp") || q.culture.starts_with("steppe");
    if !(east || indic || steppe) {
        return false;
    }
    laid(x, |x| {
        if q.is("civic.khan-tent") {
            steppe && khan_tent(x)
        } else if !(east || indic) {
            false
        } else if q.is("worship.pagoda") {
            pagoda(x)
        } else if q.is("worship.stupa") {
            stupa(x)
        } else if east && q.any(&["civic.yamen", "elite.palace", "civic.palace"]) {
            compound(x)
        } else if indic && q.is("civic.stepwell") {
            stepwell(x)
        } else if indic && q.is("civic.tank") {
            tank(x)
        } else if indic && q.is("civic.ghat") {
            ghat(x)
        } else {
            false
        }
    })
}

/// Pagoda: one square tower raised in tiers on its terrace; a precinct deep
/// enough has a gate hall on the street and a worship hall behind the tower.
fn pagoda(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    let short = span.min(room);
    let p = (0.3 * short).clamp(5.0, 12.0);
    let gate = if room >= 24.0 && span >= 14.0 { 4.5 } else { 0.0 };
    let pad = (0.25 * p).clamp(1.5, 3.0);
    let behind = if gate > 0.0 && room - gate - p - 2.0 * pad >= 16.0 { 9.0 } else { 0.0 };
    // The tower stands in the middle of what the gate hall and the rear hall leave.
    let t = c + gate + (room - gate - behind - p) * 0.5;
    if short >= p + 2.0 * pad + 6.0 {
        holed(x, [m - p * 0.5 - pad, m + p * 0.5 + pad, t - pad, t + p + pad], [m - p * 0.5, m + p * 0.5, t, t + p], "podium");
    }
    x.bar(m, p, t, t + p, "pagoda");
    if gate > 0.0 {
        x.bar(m, (1.6 * p).clamp(7.0, 16.0).min(span), c, c + gate, "gate-hall");
    }
    if behind > 0.0 {
        x.bar(m, (2.2 * p).clamp(10.0, 24.0).min(span), e - behind + 1.5, e, "axis-hall");
    }
    true
}

/// Stupa: the round mound on its stepped drum (rule `stupa`), a railed
/// terrace around it with a gate at each cardinal point.
fn stupa(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    let short = span.min(room);
    let r = 0.5 * (0.55 * short).clamp(6.0, 36.0);
    let t = c + room * 0.5;
    let pad = (0.28 * r).clamp(1.5, 4.0);
    let o = r + pad;
    if short >= 2.0 * o + 3.2 && holed(x, [m - o, m + o, t - o, t + o], [m - r, m + r, t - r, t + r], "stupa-terrace") {
        let g = (0.12 * r).clamp(1.1, 2.0);
        x.small(m - g, m + g, t - o - 1.4, t - o, "torana");
        x.small(m - g, m + g, t + o, t + o + 1.4, "torana");
        x.small(m - o - 1.4, m - o, t - g, t + g, "torana");
        x.small(m + o, m + o + 1.4, t - g, t + g, "torana");
    }
    x.bar(m, 2.0 * r, t - r, t + r, "stupa");
    true
}

/// Yamen or palace compound on its axis: a walled enclosure entered through
/// a gate hall, the main hall on its terrace across the first court, lesser
/// halls behind it, side ranges along the walls of a wide compound.
fn compound(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    if span < 17.0 || room < 25.0 {
        return false;
    }
    let cw = span.min(80.0);
    let cd = room.min(2.2 * cw).min(140.0);
    let (a, b, e) = (m - cw * 0.5, m + cw * 0.5, c + cd);
    let wall = 1.2;
    let gw = (0.22 * cw).clamp(6.0, 14.0);
    let gd = (0.5 * gw).clamp(4.0, 6.0);
    // The gate hall fills the gap of the front wall.
    x.court([a, b, c, e], wall, gw, "compound-wall");
    x.bar(m, gw, c, c + gd, "gate-hall");
    let iw = cw - 2.0 * wall;
    let sw = (0.12 * cw).clamp(3.5, 5.5);
    let sw = if iw >= 15.6 + 2.0 * sw { sw } else { 0.0 };
    // Halls keep a passage to the side ranges (or the walls) and room for the terrace.
    let hw = (0.5 * cw).clamp(9.0, 30.0).min(iw - 2.0 * sw - if sw > 0.0 { 6.6 } else { 4.6 });
    let hd = (0.42 * hw).clamp(6.0, 13.0);
    let back = e - wall - 1.5;
    let mut t = c + gd + (0.16 * cd).clamp(5.0, 18.0);
    let mut halls = 0;
    while halls < 3 {
        let (w, d) = (hw * (1.0 - 0.12 * halls as f64), hd * (1.0 - 0.1 * halls as f64));
        let pad = if halls == 0 { 1.8 } else { 0.0 };
        if t + d + 2.0 * pad > back {
            break;
        }
        if halls == 0 {
            holed(x, [m - w * 0.5 - pad, m + w * 0.5 + pad, t, t + d + 2.0 * pad], [m - w * 0.5, m + w * 0.5, t + pad, t + pad + d], "podium");
        }
        x.bar(m, w, t + pad, t + pad + d, if halls == 0 { "main-hall" } else { "axis-hall" });
        t += d + 2.0 * pad + (0.1 * cd).clamp(4.0, 12.0);
        halls += 1;
    }
    if halls == 0 {
        return false;
    }
    if sw > 0.0 {
        let (t0, t1) = (c + gd + 2.0, e - wall - 2.0);
        // A long range breaks at the middle court for a side gate.
        let cuts: &[(f64, f64)] = if t1 - t0 > 28.0 { &[(0.0, 0.47), (0.53, 1.0)] } else { &[(0.0, 1.0)] };
        for &(p0, p1) in cuts {
            let (u0, u1) = (t0 + (t1 - t0) * p0, t0 + (t1 - t0) * p1);
            x.rect(a + wall, a + wall + sw, u0, u1, "side-hall");
            x.rect(b - wall - sw, b - wall, u0, u1, "side-hall");
        }
    }
    true
}

/// A stepped basin in the rectangle: concentric terraces lower towards the
/// water in the middle (three, two on a small basin). False when too small.
fn basin(x: &mut Site, [s0, s1, t0, t1]: [f64; 4]) -> bool {
    let short = (s1 - s0).min(t1 - t0);
    let th = (0.09 * short).clamp(1.6, 4.0);
    let n = if short >= 6.0 * th + 4.0 {
        3
    } else if short >= 4.0 * th + 3.0 {
        2
    } else {
        return false;
    };
    let labels = ["step-high", "step-mid", "step-low"];
    let mut ok = false;
    for k in 0..n {
        let (o, i) = (th * k as f64, th * (k + 1) as f64);
        ok |= holed(x, [s0 + o, s1 - o, t0 + o, t1 - o], [s0 + i, s1 - i, t0 + i, t1 - i], labels[k + 3 - n]);
    }
    ok
}

/// Temple tank: a broad stepped basin, a pavilion at each street corner of
/// its embankment.
fn tank(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    let (cw, cd) = (span.min(70.0), room.min(70.0));
    let pav = if cd >= 20.0 && cw >= 14.0 { 3.2 } else { 0.0 };
    let t0 = c + (room - cd) * 0.5;
    if !basin(x, [m - cw * 0.5, m + cw * 0.5, t0 + pav, t0 + cd]) {
        return false;
    }
    if pav > 0.0 {
        x.rect(m - cw * 0.5, m - cw * 0.5 + pav, t0, t0 + pav, "well-pavilion");
        x.rect(m + cw * 0.5 - pav, m + cw * 0.5, t0, t0 + pav, "well-pavilion");
    }
    true
}

/// Stepwell: a long narrow stepped basin into the lot, the entry pavilion on
/// the street and the tower over the well shaft at the far end.
fn stepwell(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    let wd = (0.55 * span).clamp(8.0, 16.0).min(span);
    let pav = (0.35 * wd).clamp(3.0, 5.0);
    let len = (room - 2.0 * pav).min(3.2 * wd).min(60.0);
    let t0 = c + (room - len) * 0.5;
    if !basin(x, [m - wd * 0.5, m + wd * 0.5, t0, t0 + len]) {
        return false;
    }
    x.bar(m, 0.6 * wd, t0 - pav, t0, "well-pavilion");
    x.bar(m, 0.8 * wd, t0 + len, t0 + len + pav, "well-tower");
    true
}

/// Ghat: three flights of steps across the back of the lot (the river), a
/// row of small shrines along their top.
fn ghat(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    let th = (0.1 * room).clamp(2.0, 4.0);
    if room < 3.0 * th + 5.0 {
        return false;
    }
    let cw = span.min(120.0);
    let a = m - cw * 0.5;
    for (k, label) in ["step-low", "step-mid", "step-high"].iter().enumerate() {
        x.rect(a, a + cw, e - th * (k + 1) as f64, e - th * k as f64, *label);
    }
    let top = e - 3.0 * th;
    let sz = (0.35 * (top - c)).clamp(3.0, 5.0);
    let n = ((cw / 10.0).round() as usize).clamp(1, 6);
    for k in 0..n {
        x.bar(a + cw * (k as f64 + 0.5) / n as f64, sz, top - sz, top, "ghat-shrine");
    }
    true
}

/// The khan's tent: a great round tent, the smaller tents of his household
/// either side of it, two towards the street and two behind.
fn khan_tent(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    let short = span.min(room);
    let r = (0.28 * short).clamp(3.4, 11.0);
    let t = c + room * 0.55;
    x.disk(m, t, r, "great-tent");
    let q = (0.4 * r).clamp(2.0, 3.6);
    // Centre distance that keeps the 12-gons of two tents 1.5 m apart.
    let off = (r + q) * 1.04 + 1.5;
    for (ds, dt) in [(-1.0, -0.45), (1.0, -0.45), (-1.0, 0.55), (1.0, 0.55)] {
        let (s, u) = (m + ds * off, t + dt * off);
        if s - q >= a && s + q <= b && u - q >= c && u + q <= e {
            x.disk(s, u, q, "household-tent");
        }
    }
    true
}
