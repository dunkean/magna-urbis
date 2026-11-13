//! Islamic lands (families `maghreb`, `persian`): mosques, madrasas, caravanserais and khans, hammams, bazaars, palaces, mausolea.
//!
//! See `mod.rs` for the contract: lay labelled, non-overlapping parts on the
//! site and return true for a role this family builds.
use super::classical::{axes, span};
use super::{Brief, Site};
use crate::rng::Rng;

pub(super) fn build(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    if !matches!(q.family, "maghreb" | "persian") {
        return false;
    }
    let before = x.out.len();
    let persian = q.family == "persian";
    if q.any(&["worship.mosque", "worship.masjid"]) {
        let friday = q.role == "worship.mosque.friday";
        if q.culture == "ottoman" {
            domed_mosque(x, friday);
        } else if persian {
            iwan_mosque(x, friday);
        } else {
            hypostyle(x, friday);
        }
    } else if q.is("civic.madrasa") {
        madrasa(x, persian);
    } else if q.any(&["commerce.caravanserai", "commerce.funduq"]) {
        khan(x, persian);
    } else if q.is("civic.hammam") {
        hammam(x);
    } else if q.any(&["commerce.bazaar", "commerce.souk"]) {
        souk(x);
    } else if q.any(&["elite.palace", "civic.palace"]) {
        palace(x, rng);
    } else {
        return false;
    }
    x.out.len() > before
}

/// A court's side range from `t0` to `t1`, with an iwan `iw` long in its
/// middle when the range is long enough for it.
fn side(x: &mut Site, [s0, s1]: [f64; 2], [t0, t1]: [f64; 2], iw: f64, label: &'static str) {
    let tm = (t0 + t1) * 0.5;
    if iw > 0.0 && t1 - t0 > iw + 6.0 {
        x.rect(s0, s1, t0, tm - iw * 0.5, label);
        x.rect(s0, s1, tm - iw * 0.5, tm + iw * 0.5, "iwan");
        x.rect(s0, s1, tm + iw * 0.5, t1, label);
    } else {
        x.rect(s0, s1, t0, t1, label);
    }
}

/// Hypostyle mosque: the prayer hall at the back as parallel naves running to
/// the qibla wall, the wider central one ending under the mihrab dome; flat
/// arcades around the court, the ablution fountain in its middle and a square
/// minaret (on the axis of the front arcade for a Friday mosque).
fn hypostyle(x: &mut Site, friday: bool) -> bool {
    let (a, b, c, e) = (x.s0 + 0.5, x.s1 - 0.5, x.ta + 0.5, x.t1 - 0.5);
    let (w, d, m) = (b - a, e - c, x.mid());
    if w < 18.0 || d < 24.0 {
        return false;
    }
    let hall = (if friday { 0.42 } else { 0.38 } * d).clamp(9.0, 40.0);
    let h = e - hall;
    let cn = (0.14 * w).clamp(4.5, 8.0);
    let wing = (w - cn) * 0.5;
    let k = ((wing / 5.0).round() as usize).clamp(1, 8);
    let bay = wing / k as f64;
    x.bar(m, cn, e - cn, e, "mihrab-dome");
    x.bar(m, cn, h, e - cn, "prayer-nave");
    let mut ok = false;
    for i in 0..k {
        let o = i as f64 * bay;
        ok |= x.rect(a + o, a + o + bay, h, e, "prayer-bay");
        ok |= x.rect(m + cn * 0.5 + o, m + cn * 0.5 + o + bay, h, e, "prayer-bay");
    }
    let arc = (0.08 * w).clamp(3.0, 5.5);
    let tall = (0.11 * w.min(d)).clamp(4.0, if friday { 8.0 } else { 5.5 });
    if friday {
        // Minaret on the axis, a gate on each side of it.
        x.bar(m, tall, c, c + tall, "minaret");
        x.rect(a, m - tall * 0.5 - 3.0, c, c + arc, "riwaq");
        x.rect(m + tall * 0.5 + 3.0, b, c, c + arc, "riwaq");
        x.rect(a, a + arc, c + arc, h, "riwaq");
    } else {
        x.rect(a, a + tall, c, c + tall, "minaret");
        x.rect(a + tall, m - 1.5, c, c + arc, "riwaq");
        x.rect(m + 1.5, b, c, c + arc, "riwaq");
        x.rect(a, a + arc, c + tall.max(arc), h, "riwaq");
    }
    x.rect(b - arc, b, c + arc, h, "riwaq");
    if h - c - arc > 10.0 {
        x.disk(m, (c + arc + h) * 0.5, (0.05 * w).clamp(1.5, 3.0), "ablution");
    }
    ok
}

/// Four-iwan mosque: ranges around the court with an iwan in the middle of
/// each side, the entrance portal on the street between round minarets, and
/// behind the qibla iwan the domed chamber between two low prayer halls.
fn iwan_mosque(x: &mut Site, friday: bool) -> bool {
    let (a, b, c, e) = (x.s0 + 0.5, x.s1 - 0.5, x.ta + 0.5, x.t1 - 0.5);
    let (w, d, m) = (b - a, e - c, x.mid());
    if w < 26.0 || d < 30.0 {
        return false;
    }
    let rg = (0.14 * w.min(d)).clamp(4.5, 9.0);
    let dc = (0.26 * w).clamp(8.0, 18.0).min(0.3 * d);
    let iw = (0.5 * dc).clamp(4.0, 8.0);
    let ok = x.bar(m, dc, e - dc, e, "dome-chamber");
    x.bar(m, dc, e - dc - iw, e - dc, "iwan");
    x.rect(a, m - dc * 0.5, e - dc, e, "shabestan");
    x.rect(m + dc * 0.5, b, e - dc, e, "shabestan");
    let si = (0.6 * dc).clamp(5.0, 10.0);
    side(x, [a, a + rg], [c + rg, e - dc], si, "riwaq");
    side(x, [b - rg, b], [c + rg, e - dc], si, "riwaq");
    // Portal on the axis; each minaret stands between it and the front range.
    let pg = (0.5 * dc).clamp(5.0, 9.0);
    let rm = (0.035 * w).clamp(1.3, 2.2);
    x.bar(m, pg, c, c + rg, "pishtaq");
    for k in [-1.0, 1.0] {
        let gap = if friday || k > 0.0 { 2.2 * rm } else { 0.0 };
        let (s0, s1) = (m + k * (pg * 0.5 + gap), if k < 0.0 { a } else { b });
        x.rect(s0.min(s1), s0.max(s1), c, c + rg, "riwaq");
        if gap > 0.0 {
            x.disk(m + k * (pg * 0.5 + 1.1 * rm), c + 1.1 * rm, rm, "minaret");
        }
    }
    if e - dc - iw - c - rg > 12.0 {
        x.disk(m, (c + rg + e - dc - iw) * 0.5, (0.04 * w).clamp(1.5, 3.0), "ablution");
    }
    ok
}

/// Central-dome mosque: the great dome between four half-domes and four
/// corner domes, a porticoed court with its fountain on the street side,
/// slender minarets at the corners of the hall (and of the court for a large
/// Friday mosque).
fn domed_mosque(x: &mut Site, friday: bool) -> bool {
    let (c, e, m) = (x.ta + 0.5, x.t1 - 0.5, x.mid());
    let (w, d) = (x.width() - 1.0, e - c);
    if w < 22.0 || d < 28.0 {
        return false;
    }
    let rm = (0.03 * w).clamp(1.3, 2.0);
    let hall = (w - 4.4 * rm).min(0.56 * d).min(54.0);
    let q = hall / 1.6;
    if q < 8.0 {
        return false;
    }
    let (a, h) = (m - hall * 0.5, e - hall);
    // Three bays each way: 0.3, 1 and 0.3 of the dome's span.
    let cut = [0.0, 0.3 * q, 1.3 * q, hall];
    let mut ok = false;
    for i in 0..3 {
        for j in 0..3 {
            let label = match (i == 1, j == 1) {
                (true, true) => "dome-hall",
                (false, false) => "corner-dome",
                _ => "half-dome",
            };
            ok |= x.rect(a + cut[i], a + cut[i + 1], h + cut[j], h + cut[j + 1], label);
        }
    }
    let court = h - c;
    if court >= 9.0 {
        x.court([a, a + hall, c, h], (0.12 * hall).clamp(3.0, 5.0), 3.5, "riwaq");
        if court >= 16.0 {
            x.disk(m, (c + h) * 0.5, (0.05 * hall).clamp(1.5, 2.8), "ablution");
        }
    }
    for k in [-1.0, 1.0] {
        let s = m + k * (hall * 0.5 + 1.1 * rm);
        x.disk(s, h + 1.1 * rm, rm, "minaret");
        if friday && hall >= 30.0 && court >= 12.0 {
            x.disk(s, c + 1.1 * rm, rm, "minaret");
        }
    }
    ok
}

/// Madrasa: two storeys of cells around a court, the portal on the street and
/// the prayer room in the middle of the back range (an iwan in Persia, where a
/// long court also has side iwans; a pyramid-roofed qubba in the Maghreb).
fn madrasa(x: &mut Site, persian: bool) -> bool {
    let (c, m) = (x.ta + 0.5, x.mid());
    let (w, d) = (x.width() - 1.0, x.depth() - 1.0);
    if w < 18.0 || d < 18.0 {
        return false;
    }
    let (sw, sd) = (w.min(1.3 * d).min(50.0), d.min(1.4 * w).min(60.0));
    let (a, b, e) = (m - sw * 0.5, m + sw * 0.5, c + sd);
    let rg = (0.17 * sw.min(sd)).clamp(4.0, 7.5);
    let iw = (0.34 * sw).clamp(6.0, 14.0);
    let ok = x.bar(m, iw, e - 1.25 * rg, e, if persian { "iwan" } else { "qubba" });
    x.rect(a, m - iw * 0.5, e - rg, e, "madrasa-cells");
    x.rect(m + iw * 0.5, b, e - rg, e, "madrasa-cells");
    let si = if persian { (0.2 * sd).clamp(5.0, 9.0) } else { 0.0 };
    side(x, [a, a + rg], [c + rg, e - rg], si, "madrasa-cells");
    side(x, [b - rg, b], [c + rg, e - rg], si, "madrasa-cells");
    let pg = (0.25 * sw).clamp(4.5, 8.0);
    x.bar(m, pg, c, c + rg, "pishtaq");
    x.rect(a, m - pg * 0.5, c, c + rg, "madrasa-cells");
    x.rect(m + pg * 0.5, b, c, c + rg, "madrasa-cells");
    if sw - 2.0 * rg >= 9.0 && sd - 2.25 * rg >= 9.0 {
        x.disk(m, c + rg + (sd - 2.25 * rg) * 0.5, 1.6, "ablution");
    }
    ok
}

/// Caravanserai or funduq: a square court of two-storey ranges between
/// projecting corner towers (round in Persia, square in the Maghreb), a tall
/// gate block on the street, an iwan facing it in Persia and a kiosk in the
/// middle of a large court.
fn khan(x: &mut Site, persian: bool) -> bool {
    let (c, m) = (x.ta + 0.5, x.mid());
    let size = (x.width().min(x.depth()) - 1.0).min(60.0);
    if size < 22.0 {
        return false;
    }
    let (a, b, e) = (m - size * 0.5, m + size * 0.5, c + size);
    let rg = (0.16 * size).clamp(4.5, 8.0);
    // Ranges stand `p` behind the outer line, the towers `tw` wide project by it.
    let p = 0.3 * rg;
    let tw = rg + p;
    for (s, t) in [(a, c), (b - tw, c), (a, e - tw), (b - tw, e - tw)] {
        if persian {
            x.disk(s + tw * 0.5, t + tw * 0.5, tw * 0.5, "khan-tower");
        } else {
            x.rect(s, s + tw, t, t + tw, "khan-tower");
        }
    }
    let gate = (0.18 * size).clamp(4.5, 8.0);
    x.bar(m, gate, c, c + tw, "khan-gate");
    x.rect(a + tw, m - gate * 0.5, c + p, c + tw, "khan-range");
    x.rect(m + gate * 0.5, b - tw, c + p, c + tw, "khan-range");
    let ok = x.rect(a + p, a + tw, c + tw, e - tw, "khan-range");
    x.rect(b - tw, b - p, c + tw, e - tw, "khan-range");
    if persian {
        x.bar(m, gate, e - tw, e - p, "iwan");
        x.rect(a + tw, m - gate * 0.5, e - tw, e - p, "khan-range");
        x.rect(m + gate * 0.5, b - tw, e - tw, e - p, "khan-range");
    } else {
        x.rect(a + tw, b - tw, e - tw, e - p, "khan-range");
    }
    if size - 2.0 * tw >= 14.0 {
        x.bar(m, 3.6, c + size * 0.5 - 1.8, c + size * 0.5 + 1.8, "kiosk");
    }
    ok
}

/// Hammam on one axis: the domed changing hall on the street, the small warm
/// room, the domed hot room between two alcoves and the furnace behind.
fn hammam(x: &mut Site) -> bool {
    let (w, d, m) = (x.width(), x.depth(), x.mid());
    if w < 10.0 || d < 16.0 {
        return false;
    }
    let unit = ((d - 3.6) / 3.1).clamp(4.0, 8.0);
    let hall = (0.7 * w).clamp(8.0, 16.0).min(1.25 * unit);
    let t1 = x.ta + 1.0 + hall;
    let t2 = t1 + 0.7 * unit;
    let t3 = t2 + 0.9 * hall;
    let ok = x.bar(m, hall, x.ta + 1.0, t1, "hammam-dome");
    x.bar(m, 0.7 * hall, t1, t2, "hammam-cell");
    x.bar(m, 0.9 * hall, t2, t3, "hammam-dome");
    let al = (0.3 * hall).min(0.5 * (w - 0.9 * hall) - 0.5);
    if al >= 2.2 {
        for k in [-1.0, 1.0] {
            let s = m + k * (0.45 * hall + 0.5 * al);
            x.bar(s, al, t2 + 0.2 * hall, t2 + 0.2 * hall + al, "hammam-cell");
        }
    }
    x.bar(m, (0.4 * hall).max(3.0), t3, t3 + 2.5, "furnace");
    ok
}

/// Bazaar: a vaulted lane along the longer side of the site between two rows
/// of shops, crossed under a dome every twenty metres or so by a short vaulted
/// lane that opens on both flanks.
fn souk(x: &mut Site) -> bool {
    let deep = x.depth() >= x.width();
    let (start, c, len, wide) = axes(x, deep);
    if len < 20.0 || wide < 9.0 {
        return false;
    }
    let lane = 4.0;
    let row = ((wide - lane) * 0.5 - 0.5).clamp(2.5, 6.5);
    let l = (len - 1.0).min(120.0);
    let l0 = start + (len - l) * 0.5;
    let n = ((l / 24.0).round() as usize).clamp(1, 5);
    let (i0, i1, o0, o1) = (c - lane * 0.5, c + lane * 0.5, c - lane * 0.5 - row, c + lane * 0.5 + row);
    let mut ok = false;
    let mut from = l0;
    for k in 0..=n {
        // The stretch up to the next crossing (or to the end), then the crossing.
        let cross = l0 + (k + 1) as f64 * l / (n + 1) as f64;
        let to = if k < n { cross - lane * 0.5 } else { l0 + l };
        ok |= span(x, deep, [from, to], [i0, i1], "souk-vault");
        span(x, deep, [from, to], [o0, i0], "souk-shops");
        span(x, deep, [from, to], [i1, o1], "souk-shops");
        if k < n {
            span(x, deep, [to, to + lane], [i0, i1], "souk-dome");
            span(x, deep, [to, to + lane], [o0, i0], "souk-vault");
            span(x, deep, [to, to + lane], [i1, o1], "souk-vault");
            from = to + lane;
        }
    }
    ok
}

/// Palace: two courts in sequence on the axis. The outer court is closed by
/// ranges with the gate on the street; the inner one ends on the reception
/// halls on both sides of the domed throne room, a kiosk in its garden.
fn palace(x: &mut Site, rng: &mut Rng) -> bool {
    let (c, m) = (x.ta + 0.5, x.mid());
    let (w, d) = (x.width() - 1.0, x.depth() - 1.0);
    if w < 24.0 || d < 34.0 {
        return false;
    }
    let pw = w.min(60.0);
    let (a, b) = (m - pw * 0.5, m + pw * 0.5);
    let dd = d.min(2.2 * pw).min(110.0);
    let (mid, e) = (c + 0.42 * dd, c + dd);
    let rg = (0.14 * pw).clamp(4.5, 8.0);
    x.court([a, b, c, mid], rg, 4.0, "palace-range");
    let hd = (0.3 * (e - mid)).clamp(7.0, 14.0);
    let qs = (1.1 * hd).min(0.3 * pw);
    let ok = x.bar(m, qs, e - hd, e, "qubba");
    x.rect(a, m - qs * 0.5, e - hd, e, "palace-hall");
    x.rect(m + qs * 0.5, b, e - hd, e, "palace-hall");
    x.rect(a, a + rg, mid, e - hd, "palace-range");
    x.rect(b - rg, b, mid, e - hd, "palace-range");
    let garden = (pw - 2.0 * rg).min(e - hd - mid);
    if garden >= 14.0 {
        let ks = (0.22 * garden).clamp(3.5, 6.0);
        let t = mid + (e - hd - mid) * if rng.chance(0.5) { 0.5 } else { 0.38 };
        x.bar(m, ks, t - ks * 0.5, t + ks * 0.5, "kiosk");
    }
    ok
}
