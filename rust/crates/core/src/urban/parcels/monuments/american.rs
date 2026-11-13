//! The Americas (family `american` and the native cultures): ballcourts, kallankas, ushnus, kancha palaces, kivas, council houses.
//!
//! See `mod.rs` for the contract: lay labelled, non-overlapping parts on the
//! site and return true for a role this family builds.
use super::utility::{edges, holed, laid};
use super::{Brief, Site};
use crate::rng::Rng;

pub(super) fn build(x: &mut Site, q: &Brief, _rng: &mut Rng) -> bool {
    let native = q.culture.starts_with("native-") || q.culture == "mississippian";
    if !(q.family == "american" || native || matches!(q.culture, "aztec" | "maya" | "inca")) {
        return false;
    }
    laid(x, |x| {
        if q.is("civic.ballcourt") {
            ballcourt(x)
        } else if q.is("civic.kallanka") {
            kallanka(x)
        } else if q.is("worship.ushnu") {
            ushnu(x)
        } else if q.is("elite.kancha-palace") {
            kancha_palace(x)
        } else if q.is("worship.kiva") {
            kiva(x)
        } else if native && q.is("civic.council-house") {
            council_house(x)
        } else {
            false
        }
    })
}

/// Ballcourt, an I in plan: a playing alley between two banks (a low bench
/// under a higher bank on each side), a walled end zone across each end.
fn ballcourt(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    // The court runs along the lot's longer side: `u` along it from its
    // start, `v` across it from its axis.
    let deep = room >= span;
    let (long, short) = if deep { (room, span) } else { (span, room) };
    let len = long.min(70.0);
    let wide = short.min(0.55 * len).min(36.0);
    if wide < 12.0 || len < 22.0 {
        return false;
    }
    let (u0, v0) = if deep { (c + (room - len) * 0.5, x.mid()) } else { (x.mid() - len * 0.5, c + room * 0.5) };
    // Site rectangle `[s0, s1, t0, t1]` of a court rectangle.
    let at = |(ua, ub): (f64, f64), (va, vb): (f64, f64)| if deep { [v0 + va, v0 + vb, u0 + ua, u0 + ub] } else { [u0 + ua, u0 + ub, v0 + va, v0 + vb] };
    fn lay(x: &mut Site, [s0, s1, t0, t1]: [f64; 4], label: &'static str) {
        x.rect(s0, s1, t0, t1, label);
    }
    let alley = (0.2 * wide).clamp(3.5, 7.0) * 0.5;
    let bank = (0.16 * wide).clamp(2.2, 6.0);
    let bench = (0.4 * bank).clamp(1.3, 2.4);
    let (core, half, wall) = (alley + bench + bank, wide * 0.5, 1.2);
    let zone = (0.18 * len).clamp(4.0, 12.0);
    for side in [-1.0, 1.0] {
        let across = |v0: f64, v1: f64| if side > 0.0 { (v0, v1) } else { (-v1, -v0) };
        lay(x, at((zone, len - zone), across(alley, alley + bench)), "ball-bench");
        lay(x, at((zone, len - zone), across(alley + bench, core)), "ball-bank");
        // End zone walls on this side: along the zone, and the shoulder back to the bank.
        for (u, s) in [((wall, zone), (zone - wall, zone)), ((len - zone, len - wall), (len - zone, len - zone + wall))] {
            lay(x, at(u, across(half - wall, half)), "ball-wall");
            lay(x, at(s, across(core, half - wall)), "ball-wall");
        }
    }
    lay(x, at((0.0, wall), (-half, half)), "ball-wall");
    lay(x, at((len - wall, len), (-half, half)), "ball-wall");
    true
}

/// Kallanka: one very long hall across the back of its plaza, lesser halls
/// closing the sides of a large plaza.
fn kallanka(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    if span < 14.0 || room < 12.0 {
        return false;
    }
    let len = span.min(75.0);
    let hd = (0.2 * len).clamp(7.0, 14.0).min(0.45 * room);
    x.bar(m, len, e - hd, e, "kallanka");
    let plaza = room - hd;
    if plaza >= 20.0 && len >= 30.0 {
        let (t1, sl) = (e - hd - 3.0, (0.5 * plaza).clamp(9.0, 18.0));
        x.rect(m - len * 0.5, m - len * 0.5 + 6.0, t1 - sl, t1, "kancha-hall");
        x.rect(m + len * 0.5 - 6.0, m + len * 0.5, t1 - sl, t1, "kancha-hall");
    }
    true
}

/// Ushnu: a low platform raised in steps (rule `ushnu`), its stair towards the street.
fn ushnu(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    let side = (0.55 * span.min(room)).clamp(7.0, 28.0);
    let stair = (0.18 * side).clamp(1.5, 4.0);
    let stair = if room - side >= stair + 0.5 { stair } else { 0.0 };
    let t = c + stair + (room - stair - side) * 0.5;
    x.bar(m, side, t, t + side, "ushnu");
    if stair > 0.0 {
        let sw = (0.25 * side).clamp(2.0, 5.0) * 0.5;
        x.small(m - sw, m + sw, t - stair, t, "ushnu-stair");
    }
    true
}

/// Kancha palace: a walled enclosure entered by one door, courts in a row
/// inside it, each with separate halls on its sides (the corners stay open).
fn kancha_palace(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    if span < 19.0 || room < 19.0 {
        return false;
    }
    let (cw, cd, wall) = (span.min(44.0), room.min(90.0), 1.2);
    let (a, b, e) = (m - cw * 0.5, m + cw * 0.5, c + cd);
    x.court([a, b, c, e], wall, 2.4, "kancha-wall");
    let (ia, ib, ic, ie) = (a + wall + 1.0, b - wall - 1.0, c + wall + 1.5, e - wall - 1.0);
    let n = (((ie - ic + 2.0) / 22.0).floor() as usize).clamp(1, 3);
    let each = (ie - ic - 2.0 * (n - 1) as f64) / n as f64;
    let h = (0.17 * (ib - ia).min(each)).clamp(3.5, 6.0);
    for k in 0..n {
        let t0 = ic + k as f64 * (each + 2.0);
        let t1 = t0 + each;
        x.rect(ia, ia + h, t0 + h + 1.0, t1 - h - 1.0, "kancha-hall");
        x.rect(ib - h, ib, t0 + h + 1.0, t1 - h - 1.0, "kancha-hall");
        x.rect(ia + h + 1.0, ib - h - 1.0, t1 - h, t1, "kancha-hall");
        if k > 0 {
            // Inner courts are closed on their fourth side, either side of the way in.
            x.rect(ia + h + 1.0, m - 1.5, t0, t0 + h, "kancha-hall");
            x.rect(m + 1.5, ib - h - 1.0, t0, t0 + h, "kancha-hall");
        }
    }
    true
}

/// Kiva: a round chamber, its antechamber behind it when the lot allows.
fn kiva(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    let r = (0.32 * span.min(room)).clamp(3.0, 10.0);
    // The 12-gon of the disk reaches 4 % past its radius.
    let ante = if room >= 2.78 * r + 1.0 { 0.7 * r } else { 0.0 };
    let t = c + (room - ante) * 0.5;
    x.disk(m, t, r, "kiva");
    if ante > 0.0 {
        x.bar(m, 1.1 * r, t + 1.04 * r, t + 1.04 * r + ante, "kiva-room");
    }
    true
}

/// Council house of a native town: a great round house under a conical
/// roof, on a low earth mound with its ramp to the street when the lot allows.
fn council_house(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room, m) = (b - a, e - c, x.mid());
    let short = span.min(room);
    let half = 0.5 * (0.6 * short).clamp(7.0, 30.0);
    let pad = (0.32 * half).clamp(1.5, 5.0);
    let t = c + room * 0.5;
    let mound = short >= 14.0 && holed(x, [m - half, m + half, t - half, t + half], [m - half + pad, m + half - pad, t - half + pad, t + half - pad], "council-mound");
    let h = if mound { half - pad } else { 0.85 * half };
    x.bar(m, 2.0 * h, t - h, t + h, "council-house");
    if mound && t - half - 2.0 >= c {
        x.small(m - 1.5, m + 1.5, t - half - 2.0, t - half, "council-ramp");
    }
    true
}
