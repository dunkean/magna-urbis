//! Civic buildings any culture may fall back to: library, arena, lighthouse, observatory, prison, customs house, exchange, hippodrome, clock tower, palace, villa.
//!
//! See `mod.rs` for the contract: lay labelled, non-overlapping parts on the
//! site and return true for a role this family builds.
use super::classical::{amphitheatre, circus, theatre};
use super::{Brief, Site};
use crate::rng::Rng;

pub(super) fn build(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    let before = x.out.len();
    if q.is("civic.library") {
        library(x);
    } else if q.is("civic.theatre") {
        theatre(x, false);
    } else if q.any(&["civic.amphitheatre", "civic.arena"]) {
        amphitheatre(x, false);
    } else if q.is("civic.hippodrome") {
        circus(x);
    } else if q.is("civic.lighthouse") {
        lighthouse(x);
    } else if q.is("civic.observatory") {
        observatory(x, rng);
    } else if q.is("civic.prison") {
        prison(x);
    } else if q.is("civic.customs") {
        customs(x, rng);
    } else if q.is("commerce.exchange") {
        exchange(x);
    } else if q.is("civic.clocktower") {
        clocktower(x);
    } else if q.is("worship.baptistery") {
        baptistery(x);
    } else if q.is("worship.precinct") {
        precinct(x);
    } else if q.is("elite.villa") {
        villa(x, q);
    } else {
        return false;
    }
    x.out.len() > before
}

/// Library: the reading room along the street behind its porch; two wings
/// reach back from a wide one.
fn library(x: &mut Site) -> bool {
    let (w, d, m) = (x.width(), x.depth(), x.mid());
    if w < 10.0 || d < 9.0 {
        return false;
    }
    let hw = (0.8 * w).clamp(9.0, 30.0);
    let fore = (0.1 * d).clamp(1.5, 6.0);
    let hd = (0.4 * d).clamp(6.0, 12.0).min(d - fore - 1.0);
    let t = x.ta + fore;
    let ok = x.bar(m, hw, t, t + hd, "reading-room");
    x.small(m - 1.6, m + 1.6, t - (fore - 0.3).min(2.2), t, "porch");
    let back = d - fore - hd - 1.0;
    if back >= 5.0 && hw >= 16.0 {
        let ww = (0.24 * hw).clamp(4.0, 7.0);
        let wl = back.min(1.2 * hd);
        x.rect(m - hw * 0.5, m - hw * 0.5 + ww, t + hd, t + hd + wl, "wing");
        x.rect(m + hw * 0.5 - ww, m + hw * 0.5, t + hd, t + hd + wl, "wing");
    }
    ok
}

/// Lighthouse: the tiered tower in the middle of its low square base (four
/// ranges around the tower's foot).
fn lighthouse(x: &mut Site) -> bool {
    let (d, m) = (x.depth(), x.mid());
    let short = x.width().min(d);
    let tw = (0.3 * short).clamp(4.5, 9.0);
    let h = tw * 0.5;
    let b = (h + (0.22 * short).clamp(2.5, 7.0)).min(short * 0.5 - 0.5);
    let tc = x.ta + d * 0.5;
    let ok = x.bar(m, tw, tc - h, tc + h, "pharos");
    x.rect(m - b, m + b, tc - b, tc - h, "pharos-base");
    x.rect(m - b, m + b, tc + h, tc + b, "pharos-base");
    x.rect(m - b, m - h, tc - h, tc + h, "pharos-base");
    x.rect(m + h, m + b, tc - h, tc + h, "pharos-base");
    ok
}

/// Observatory: the domed tower behind a hall on the street (beside it on a
/// shallow site, alone on a small one).
fn observatory(x: &mut Site, rng: &mut Rng) -> bool {
    let (w, d, m) = (x.width(), x.depth(), x.mid());
    let tw = (0.4 * w.min(d)).clamp(5.0, 10.0);
    let hd = (0.3 * d).clamp(4.5, 8.0);
    let t = x.ta + 1.0;
    if d >= hd + tw + 1.5 {
        x.bar(m, (0.75 * w).clamp(8.0, 22.0).min(w - 1.0), t, t + hd, "reading-room");
        x.bar(m, tw, t + hd, t + hd + tw, "observatory-tower")
    } else if w >= 2.0 * tw + 1.0 {
        let k = if rng.chance(0.5) { -1.0 } else { 1.0 };
        x.bar(m - k * tw * 0.5, tw, t, t + tw.min(d - 1.5), "reading-room");
        x.bar(m + k * tw * 0.5, tw, t, t + tw.min(d - 1.5), "observatory-tower")
    } else {
        let s = tw.min(w - 1.0).min(d - 1.0);
        x.bar(m, s, x.ta + (d - s) * 0.5, x.ta + (d + s) * 0.5, "observatory-tower")
    }
}

/// Prison: the cell block in a yard closed by a blind wall between four
/// corner turrets, the gate on the street.
fn prison(x: &mut Site) -> bool {
    let (a, b, c, e) = (x.s0 + 0.5, x.s1 - 0.5, x.ta + 0.5, x.t1 - 0.5);
    let (w, d, m) = (b - a, e - c, x.mid());
    if w < 16.0 || d < 16.0 {
        return false;
    }
    let tw = (0.12 * w.min(d)).clamp(3.0, 5.0);
    let wall = 1.5;
    let inset = (tw - wall) * 0.5;
    for (s, t) in [(a, c), (b - tw, c), (a, e - tw), (b - tw, e - tw)] {
        x.rect(s, s + tw, t, t + tw, "turret");
    }
    x.rect(a + tw, m - 2.0, c + inset, c + inset + wall, "yard-wall");
    x.rect(m + 2.0, b - tw, c + inset, c + inset + wall, "yard-wall");
    x.rect(a + tw, b - tw, e - inset - wall, e - inset, "yard-wall");
    x.rect(a + inset, a + inset + wall, c + tw, e - tw, "yard-wall");
    x.rect(b - inset - wall, b - inset, c + tw, e - tw, "yard-wall");
    let yard = (0.12 * w.min(d)).clamp(2.0, 6.0);
    x.rect(a + tw + yard, b - tw - yard, c + tw + 1.5 * yard, e - tw - 0.5 * yard, "cell-block")
}

/// Customs house: a hall behind an arcade open on the quay or the gate road,
/// a stair tower at a rear corner of a large one.
fn customs(x: &mut Site, rng: &mut Rng) -> bool {
    let (w, d, m) = (x.width(), x.depth(), x.mid());
    if w < 10.0 || d < 9.0 {
        return false;
    }
    let hw = (w - 1.0).min(36.0);
    let gal = (0.12 * d).clamp(2.5, 3.5);
    let hd = (0.5 * d).clamp(6.0, 14.0).min(d - gal - 1.5);
    let t = x.ta + 0.5;
    x.bar(m, hw, t, t + gal, "gallery");
    let ok = x.bar(m, hw, t + gal, t + gal + hd, "hall");
    if w >= 20.0 && d - gal - hd >= 5.0 {
        let s = if rng.chance(0.5) { m - hw * 0.5 } else { m + hw * 0.5 - 3.5 };
        x.small(s, s + 3.5, t + gal + hd, t + gal + hd + 3.5, "stair-tower");
    }
    ok
}

/// Exchange: four ranges around a court lined with arcades, the entrance on
/// the street.
fn exchange(x: &mut Site) -> bool {
    let (c, m) = (x.ta + 0.5, x.mid());
    let (w, d) = (x.width() - 1.0, x.depth() - 1.0);
    if w < 20.0 || d < 20.0 {
        return false;
    }
    let (sw, sd) = (w.min(1.4 * d).min(50.0), d.min(1.4 * w).min(50.0));
    let (a, b, e) = (m - sw * 0.5, m + sw * 0.5, c + sd);
    let rg = (0.16 * sw.min(sd)).clamp(4.5, 7.5);
    let arcade = (0.08 * sw.min(sd)).clamp(2.5, 3.5);
    x.court([a, b, c, e], rg, 3.5, "exchange-range");
    x.court([a + rg, b - rg, c + rg, e - rg], arcade, 0.0, "exchange-arcade");
    true
}

/// Clock tower on the street, a low annex behind it when the lot is deep.
fn clocktower(x: &mut Site) -> bool {
    let (w, d, m) = (x.width(), x.depth(), x.mid());
    let tw = (0.45 * w.min(d)).clamp(4.0, 7.5);
    let t = x.ta + 0.5;
    let ok = x.bar(m, tw, t, t + tw, "clock-tower");
    if d - tw - 1.0 >= 5.0 {
        x.bar(m, (w - 1.0).min(2.2 * tw), t + tw, t + tw + (d - tw - 1.0).min(8.0), "annex");
    }
    ok
}

/// Baptistery: an octagon, a small apse behind it and a porch on the street.
fn baptistery(x: &mut Site) -> bool {
    let (w, d, m) = (x.width(), x.depth(), x.mid());
    let r = (0.42 * w.min(d)).min((d - 1.0) / 2.4).min(11.0);
    if r < 3.0 {
        return false;
    }
    let tc = x.ta + 0.5 + r + (d - 1.0 - 2.4 * r) * 0.5;
    let ok = x.rect(m - r, m + r, tc - r, tc + r, "baptistery");
    x.apse(m, tc + r, 0.35 * r, "apse");
    let pd = (tc - r - x.ta - 0.3).min(2.0);
    x.small(m - 1.5, m + 1.5, tc - r - pd, tc - r, "porch");
    ok
}

/// Sacred precinct: a wall around the lot, the gate building on the street,
/// the sanctuary towards the back and its altar in front of it.
fn precinct(x: &mut Site) -> bool {
    let (a, b, c, e) = (x.s0 + 0.5, x.s1 - 0.5, x.ta + 0.5, x.t1 - 0.5);
    let (w, d, m) = (b - a, e - c, x.mid());
    if w < 14.0 || d < 14.0 {
        return false;
    }
    let wall = 1.2;
    let pw = (0.2 * w).clamp(4.0, 8.0);
    x.bar(m, pw, c, c + 3.5, "propylon");
    x.rect(a, m - pw * 0.5, c, c + wall, "precinct-wall");
    x.rect(m + pw * 0.5, b, c, c + wall, "precinct-wall");
    x.rect(a, a + wall, c + wall, e - wall, "precinct-wall");
    x.rect(b - wall, b, c + wall, e - wall, "precinct-wall");
    x.rect(a, b, e - wall, e, "precinct-wall");
    let sw = (0.4 * w).clamp(5.0, 16.0);
    let sl = (0.4 * d).clamp(6.0, 24.0);
    let t = (e - wall - 1.5 - sl).min(c + 0.45 * d);
    let ok = x.bar(m, sw, t, t + sl, "sanctuary");
    if t - 5.0 > c + 4.5 {
        x.small(m - 1.2, m + 1.2, t - 5.0, t - 3.0, "altar");
    }
    ok
}

/// Villa: the main block between two wings that reach forward, a loggia
/// between them on the garden front and, for a rich one, a belvedere behind.
fn villa(x: &mut Site, q: &Brief) -> bool {
    let (w, d, m) = (x.width(), x.depth(), x.mid());
    if w < 14.0 || d < 12.0 {
        return false;
    }
    let bw = (0.5 * w).clamp(8.0, 20.0);
    let bd = (0.4 * d).clamp(7.0, 12.0);
    let fore = (0.15 * d).clamp(1.5, 10.0);
    let t = x.ta + fore;
    let ok = x.bar(m, bw, t, t + bd, "villa");
    let ww = ((w - 1.0 - bw) * 0.5).min(0.6 * bw);
    let proj = (fore - 0.5).min(0.4 * bd);
    if ww >= 3.0 {
        x.rect(m - bw * 0.5 - ww, m - bw * 0.5, t - proj, t + 0.8 * bd, "wing");
        x.rect(m + bw * 0.5, m + bw * 0.5 + ww, t - proj, t + 0.8 * bd, "wing");
    }
    let loggia = proj.min(3.0);
    if loggia >= 1.5 {
        x.bar(m, bw, t - loggia, t, "gallery");
    }
    let tower = 0.4 * bw;
    if (q.landmark || q.wealth > 0.7) && d - fore - bd - 1.0 >= tower {
        x.bar(m, tower, t + bd, t + bd + tower, "belvedere");
    }
    ok
}
