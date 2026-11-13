//! Sub-Saharan Africa (family `african`): mud mosques with buttress towers, royal enclosures, palaver halls, raised granaries.
//!
//! See `mod.rs` for the contract: lay labelled, non-overlapping parts on the
//! site and return true for a role this family builds.
use super::utility::{edges, laid};
use super::{Brief, Site};
use crate::rng::Rng;
use std::f64::consts::{FRAC_PI_2, PI, TAU};

pub(super) fn build(x: &mut Site, q: &Brief, _rng: &mut Rng) -> bool {
    // The coral-stone towns of the coast keep the shared forms.
    if q.family != "african" || q.culture.starts_with("swahili") {
        return false;
    }
    laid(x, |x| {
        if q.any(&["worship.mosque", "worship.masjid"]) {
            mosque(x, q.landmark || q.role == "worship.mosque.friday")
        } else if q.any(&["elite.palace", "civic.palace", "elite.royal-enclosure"]) {
            royal_enclosure(x)
        } else if q.any(&["civic.palaver", "civic.council-house"]) {
            palaver(x)
        } else if q.any(&["storage.granary", "storage.barn"]) {
            granaries(x)
        } else {
            false
        }
    })
}

/// Mud mosque: the prayer hall behind its towered qibla wall on the street
/// (the tallest tower in the middle), buttresses along the side walls, a
/// court between galleries behind the hall of a great mosque.
fn mosque(x: &mut Site, great: bool) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    if span < 9.0 || room < 10.0 {
        return false;
    }
    // One metre is kept each side for the buttresses.
    let hw = (span - 2.0).min(if great { 44.0 } else { 26.0 });
    let tp = (0.12 * hw).clamp(2.0, 3.5);
    let tw = (0.14 * hw).clamp(2.4, 5.0);
    let court = room - tp >= 30.0;
    let hd = if court { (0.45 * (room - tp)).clamp(10.0, 30.0) } else { (room - tp).min(0.9 * hw).min(24.0) };
    let (f0, h) = (c + tp, hw * 0.5);
    x.bar(m, hw, f0, f0 + hd, "mud-hall");
    x.bar(m, tw, c, f0, "mud-tower-main");
    if hw >= 14.0 {
        x.bar(m - 0.32 * hw, 0.85 * tw, c, f0, "mud-tower");
        x.bar(m + 0.32 * hw, 0.85 * tw, c, f0, "mud-tower");
    }
    let n = ((hd / 4.5).round() as usize).clamp(2, 6);
    for k in 0..n {
        let t = f0 + hd * (k as f64 + 0.5) / n as f64;
        x.small(m - h - 1.0, m - h, t - 0.6, t + 0.6, "mud-buttress");
        x.small(m + h, m + h + 1.0, t - 0.6, t + 0.6, "mud-buttress");
    }
    if court {
        let g = (0.12 * hw).clamp(3.0, 5.0);
        let (t0, t1) = (f0 + hd, (f0 + hd + 0.8 * hw).min(e));
        x.rect(m - h, m - h + g, t0, t1 - g, "mud-gallery");
        x.rect(m + h - g, m + h, t0, t1 - g, "mud-gallery");
        x.rect(m - h, m + h, t1 - g, t1, "mud-gallery");
    }
    true
}

/// Royal enclosure: an oval wall open towards the street, the ruler's great
/// round house towards the back and the houses of the household in a ring
/// inside the wall.
fn royal_enclosure(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    let short = span.min(room);
    if short < 22.0 {
        return false;
    }
    let (rs, rt) = (0.5 * span.min(1.3 * short).min(80.0), 0.5 * room.min(1.3 * short).min(80.0));
    let t = c + room * 0.5;
    // A 4 m gate at the street end of the oval.
    let gate = (2.0 / rs).min(0.2);
    let n = ((TAU * 0.5 * (rs + rt) / 6.0).round() as usize).clamp(10, 32);
    x.wedges((m, t), (rs, rt), 1.4, (-FRAC_PI_2 + gate, 1.5 * PI - gate), n, "enclosure-wall");
    let least = rs.min(rt);
    x.disk(m, t + 0.15 * rt, (0.22 * least).clamp(3.0, 8.0), "royal-hall");
    let hut = (0.11 * least).clamp(1.8, 3.2);
    let huts = ((TAU * 0.68 * 0.5 * (rs + rt) / (2.0 * hut + 3.0)).round() as usize).clamp(5, 12);
    for k in 0..huts {
        let ang = FRAC_PI_2 + TAU * k as f64 / huts as f64;
        // The way in from the gate stays clear.
        if ang.sin() > -0.8 {
            x.disk(m + 0.68 * rs * ang.cos(), t + 0.68 * rt * ang.sin(), hut, "royal-hut");
        }
    }
    true
}

/// Palaver hall: one open-sided hall under a deep hipped roof, set back
/// behind its meeting ground.
fn palaver(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    let hw = (0.55 * span).clamp(7.0, 20.0).min(span);
    let hd = (0.6 * hw).clamp(5.0, 11.0).min(room);
    let t = c + (room - hd) * 0.4;
    x.bar(m, hw, t, t + hd, "palaver-hall")
}

/// Raised granaries: round stores on stilts under conical caps, in rows.
fn granaries(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    let r = 1.6;
    // Centre spacing: the 12-gon of a store and 1.3 m between two of them.
    let step = 2.08 * r + 1.3;
    let cols = (((span + 1.3) / step).floor() as usize).clamp(1, 5);
    let rows = (((room + 1.3) / step).floor() as usize).clamp(1, 3);
    for i in 0..cols {
        for j in 0..rows {
            let s = m + (i as f64 - (cols as f64 - 1.0) * 0.5) * step;
            let t = c + room * 0.5 + (j as f64 - (rows as f64 - 1.0) * 0.5) * step;
            x.disk(s, t, r, "granary-pot");
        }
    }
    true
}
