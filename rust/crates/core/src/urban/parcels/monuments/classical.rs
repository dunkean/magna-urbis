//! Classical antiquity (family `antique`): forum, basilica, theatre, amphitheatre, circus, stoa, thermae, library, triumphal arch, horreum.
//!
//! See `mod.rs` for the contract: lay labelled, non-overlapping parts on the
//! site and return true for a role this family builds.
use super::{Brief, Site};
use crate::rng::Rng;
use std::f64::consts::PI;

pub(super) fn build(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    if q.family != "antique" {
        return false;
    }
    let before = x.out.len();
    if q.any(&["civic.theatre", "civic.odeon"]) {
        theatre(x, true);
    } else if q.any(&["civic.amphitheatre", "civic.arena"]) {
        amphitheatre(x, true);
    } else if q.any(&["civic.hippodrome", "civic.circus"]) {
        circus(x);
    } else if q.is("civic.forum") {
        forum(x);
    } else if q.is("civic.basilica") {
        basilica(x);
    } else if q.is("civic.library") {
        library(x, rng);
    } else if q.is("civic.thermae") {
        thermae(x);
    } else if q.is("storage.horreum") {
        horreum(x);
    } else if q.is("civic.arch") {
        arch(x);
    } else {
        return false;
    }
    x.out.len() > before
}

/// The long and the cross axes of a form that runs into the lot (`deep`) or
/// along the street: start of the long axis, centre of the cross axis, length
/// and width of the site along them.
pub(super) fn axes(x: &Site, deep: bool) -> (f64, f64, f64, f64) {
    if deep {
        (x.ta, x.mid(), x.depth(), x.width())
    } else {
        (x.s0, x.ta + x.depth() * 0.5, x.width(), x.depth())
    }
}

/// A rectangle given along (`l`) and across (`c`) the long axis of `axes`.
pub(super) fn span(x: &mut Site, deep: bool, [l0, l1]: [f64; 2], [c0, c1]: [f64; 2], label: &'static str) -> bool {
    if deep { x.rect(c0, c1, l0, l1, label) } else { x.rect(l0, l1, c0, c1, label) }
}

/// A basilican hall along the long axis: the tall nave centred on `c` between
/// two lean-to aisles.
pub(super) fn aisled(x: &mut Site, deep: bool, l: [f64; 2], c: f64, (nave, aisle): (f64, f64), (hall, side): (&'static str, &'static str)) -> bool {
    let ok = span(x, deep, l, [c - nave * 0.5, c + nave * 0.5], hall);
    span(x, deep, l, [c - nave * 0.5 - aisle, c - nave * 0.5], side);
    span(x, deep, l, [c + nave * 0.5, c + nave * 0.5 + aisle], side);
    ok
}

/// Concentric rings of `n` seating wedges from the outer radii `r` inwards,
/// each `(thickness, label)`: the rings share their chords, so they touch
/// without overlapping and step down towards the middle.
pub(super) fn seats(x: &mut Site, c: (f64, f64), r: (f64, f64), arc: (f64, f64), n: usize, rings: &[(f64, &'static str)]) -> bool {
    let (mut rs, mut rt) = r;
    let mut ok = false;
    for &(thick, label) in rings {
        ok |= x.wedges(c, (rs, rt), thick, arc, n, label);
        rs -= thick;
        rt -= thick;
    }
    ok
}

/// Theatre: a half ring of stepped seating around the orchestra, open to the
/// stage; the stage stands between the two wings of the stage building, whose
/// tall wall closes the theatre on the street. `grand`: three tiers of seats
/// and up to a 48 m radius (a plain theatre keeps two tiers and 26 m).
pub(super) fn theatre(x: &mut Site, grand: bool) -> bool {
    let (w, d, m) = (x.width(), x.depth(), x.mid());
    let sd = (0.14 * d).clamp(3.0, 8.0);
    let stage = (0.08 * d).clamp(1.8, 5.0);
    let r = (0.48 * w).min(d - 1.0 - sd - stage).min(if grand { 48.0 } else { 26.0 });
    if r < 7.5 {
        return false;
    }
    let t0 = x.ta + (d - sd - stage - r) * 0.5;
    let tc = t0 + sd + stage;
    x.bar(m, 2.0 * r, t0, t0 + sd, "scaena");
    x.bar(m, 1.3 * r, tc - stage, tc, "pulpitum");
    for k in [-1.0, 1.0] {
        x.bar(m + k * 0.825 * r, 0.35 * r, tc - stage, tc, "scaena");
    }
    // Seats from the outer wall down to the orchestra (0.3 r).
    let n = ((PI * r / 6.0).round() as usize).clamp(5, 12);
    if grand && r >= 16.0 {
        seats(x, (m, tc), (r, r), (0.0, PI), n, &[(0.22 * r, "cavea-3"), (0.24 * r, "cavea-2"), (0.24 * r, "cavea-1")])
    } else {
        seats(x, (m, tc), (r, r), (0.0, PI), n, &[(0.33 * r, "cavea-2"), (0.37 * r, "cavea-1")])
    }
}

/// Amphitheatre: elliptical rings of stepped seating around the open arena,
/// the long axis along the longer side of the site; a large one stands inside
/// an outer arcade wall.
pub(super) fn amphitheatre(x: &mut Site, grand: bool) -> bool {
    let (w, d, m) = (x.width(), x.depth(), x.mid());
    let short = (0.48 * w.min(d)).min(if grand { 44.0 } else { 24.0 });
    if short < 9.0 {
        return false;
    }
    let long = (0.48 * w.max(d)).min(1.3 * short);
    let r = if w >= d { (long, short) } else { (short, long) };
    let c = (m, x.ta + d * 0.5);
    // The arena keeps half of the short axis.
    let th = (0.5 * short).clamp(4.5, 20.0);
    let n = ((PI * (long + short) / 6.0).round() as usize).clamp(12, 28);
    let full = (0.0, 2.0 * PI);
    if grand && short >= 20.0 {
        seats(x, c, r, full, n, &[(0.14 * th, "arcade-wall"), (0.28 * th, "cavea-3"), (0.29 * th, "cavea-2"), (0.29 * th, "cavea-1")])
    } else if short >= 13.0 {
        seats(x, c, r, full, n, &[(0.32 * th, "cavea-3"), (0.34 * th, "cavea-2"), (0.34 * th, "cavea-1")])
    } else {
        seats(x, c, r, full, n, &[(0.5 * th, "cavea-2"), (0.5 * th, "cavea-1")])
    }
}

/// Circus: two tiers of seats along both long sides and around the curved
/// end, the starting gates across the other end, and the spina with its
/// obelisk down the middle of the track.
pub(super) fn circus(x: &mut Site) -> bool {
    let deep = x.depth() > x.width();
    let (start, c, len, wide) = axes(x, deep);
    let l = (len - 1.0).min(240.0);
    let cw = (wide - 1.0).min(l / 3.2).min(60.0);
    if l < 36.0 || cw < 14.0 {
        return false;
    }
    let l0 = start + (len - l) * 0.5;
    let r = cw * 0.5;
    let th = (0.2 * cw).clamp(3.2, 9.0);
    let gate = (0.04 * l).clamp(3.0, 6.0);
    // Centre of the curved end.
    let end = l0 + l - r;
    span(x, deep, [l0, l0 + gate], [c - r, c + r], "carceres");
    for k in [-1.0, 1.0] {
        let (o, h, i) = (c + k * r, c + k * (r - th * 0.5), c + k * (r - th));
        span(x, deep, [l0 + gate, end], [o.min(h), o.max(h)], "cavea-2");
        span(x, deep, [l0 + gate, end], [h.min(i), h.max(i)], "cavea-1");
    }
    let n = ((PI * r / 5.0).round() as usize).clamp(6, 14);
    let (centre, arc) = if deep { ((c, end), (0.0, PI)) } else { ((end, c), (-0.5 * PI, 0.5 * PI)) };
    let ok = seats(x, centre, (r, r), arc, n, &[(th * 0.5, "cavea-2"), (th * 0.5, "cavea-1")]);
    // Spina in two lengths, the obelisk between them.
    let sp = (0.05 * cw).clamp(1.6, 3.0);
    let (a, b) = (l0 + gate + 0.16 * l, end - 0.2 * r);
    let mid = (a + b) * 0.5;
    span(x, deep, [a, mid - sp * 0.5], [c - sp * 0.5, c + sp * 0.5], "spina");
    span(x, deep, [mid + sp * 0.5, b], [c - sp * 0.5, c + sp * 0.5], "spina");
    if deep {
        x.small(c - sp * 0.5, c + sp * 0.5, mid - sp * 0.5, mid + sp * 0.5, "obelisk");
    } else {
        x.small(mid - sp * 0.5, mid + sp * 0.5, c - sp * 0.5, c + sp * 0.5, "obelisk");
    }
    ok
}

/// Forum: a square closed by porticoes on the street and on both sides, the
/// entrance on its axis, and the basilica (nave between two aisles) across its
/// back; a large forum has a podium temple at the head of the square.
fn forum(x: &mut Site) -> bool {
    let (a, b, c, e) = (x.s0 + 0.5, x.s1 - 0.5, x.ta + 0.5, x.t1 - 0.5);
    let (w, d, m) = (b - a, e - c, x.mid());
    if w < 22.0 || d < 26.0 {
        return false;
    }
    let bd = (0.26 * d).clamp(9.0, 24.0);
    let aw = 0.22 * bd;
    let tb = e - bd;
    x.rect(a, b, tb + aw, e - aw, "basilica");
    x.rect(a, b, tb, tb + aw, "aisle");
    x.rect(a, b, e - aw, e, "aisle");
    let pr = (0.1 * w.min(d)).clamp(3.5, 7.0);
    let gate = (0.2 * w).clamp(4.0, 10.0);
    x.rect(a, m - gate * 0.5, c, c + pr, "stoa");
    x.rect(m + gate * 0.5, b, c, c + pr, "stoa");
    x.rect(a, a + pr, c + pr, tb, "stoa");
    x.rect(b - pr, b, c + pr, tb, "stoa");
    let (cw, cd) = (w - 2.0 * pr, tb - c - pr);
    if cw >= 22.0 && cd >= 30.0 {
        let tw = (0.28 * cw).clamp(7.0, 16.0);
        let len = (1.9 * tw).min(0.5 * cd);
        let back = tb - (0.06 * cd).clamp(2.0, 5.0);
        x.bar(m, tw, back - len, back - 0.65 * len, "portico");
        x.bar(m, tw, back - 0.65 * len, back, "cella");
    }
    true
}

/// Basilica: a tall nave between lean-to aisles along the longer side of the
/// site; when it runs into the lot, the tribunal apse closes its far end.
fn basilica(x: &mut Site) -> bool {
    let deep = x.depth() >= x.width();
    let (start, c, len, wide) = axes(x, deep);
    let mut bw = (0.85 * wide).min(30.0);
    let bl = (len - 1.5 - if deep { 0.2 * bw } else { 0.0 }).min(3.0 * bw);
    bw = bw.min(bl / 1.5);
    if bw < 8.0 {
        return false;
    }
    let r = if deep { 0.2 * bw } else { 0.0 };
    let l0 = start + (len - bl - r) * 0.5;
    let ok = aisled(x, deep, [l0, l0 + bl], c, (0.52 * bw, 0.24 * bw), ("basilica", "aisle"));
    if deep {
        x.apse(c, l0 + bl, r, "apse");
    }
    ok
}

/// Library: a reading hall behind its colonnade, a statue apse at the back
/// and, on a wide site, a lower reading room on one side.
fn library(x: &mut Site, rng: &mut Rng) -> bool {
    let (w, d, m) = (x.width(), x.depth(), x.mid());
    if w < 10.0 || d < 10.0 {
        return false;
    }
    let hw = (0.62 * w).clamp(8.0, 24.0);
    let start = x.ta + (0.08 * d).clamp(0.8, 6.0);
    let pd = (0.14 * d).clamp(2.2, 5.0);
    let r = 0.18 * hw;
    let hd = (0.55 * d).clamp(6.0, 22.0).min(x.t1 - 0.5 - r - start - pd);
    if hd < 5.0 {
        return false;
    }
    let t = start + pd;
    x.bar(m, hw, start, t, "colonnade");
    let ok = x.bar(m, hw, t, t + hd, "library-hall");
    x.apse(m, t + hd, r, "apse");
    let side = (0.5 * (w - hw) - 0.5).min(0.5 * hw);
    if side >= 4.0 {
        let k = if rng.chance(0.5) { -1.0 } else { 1.0 };
        let s = m + k * (hw + side) * 0.5;
        x.bar(s, side, t + 0.15 * hd, t + 0.85 * hd, "reading-room");
    }
    ok
}

/// Imperial baths on one axis: the entrance hall, the great vaulted
/// frigidarium across it, the tepidarium between two hot rooms and the domed
/// caldarium projecting at the back; a porticoed palaestra on each side.
fn thermae(x: &mut Site) -> bool {
    let (a, c, e, m) = (x.s0 + 0.5, x.ta + 0.5, x.t1 - 0.5, x.mid());
    let w = x.width() - 1.0;
    if w < 26.0 || e - c < 30.0 {
        return false;
    }
    let dd = (e - c).min(1.3 * w).min(100.0);
    let ww = w.min(1.2 * dd).min(90.0);
    let a = a + (w - ww) * 0.5;
    let fw = 0.5 * ww;
    let (h1, h2, h3) = (0.14 * dd, 0.26 * dd, 0.14 * dd);
    let (t1, t2, t3) = (c + h1, c + h1 + h2, c + h1 + h2 + h3);
    x.bar(m, fw, c, t1, "cold-room");
    let ok = x.bar(m, fw, t1, t2, "frigidarium");
    let tw = 0.3 * ww;
    x.bar(m, tw, t2, t3, "warm-room");
    x.rect(m - fw * 0.5, m - tw * 0.5, t2, t3, "hot-room");
    x.rect(m + tw * 0.5, m + fw * 0.5, t2, t3, "hot-room");
    let rc = (0.16 * ww).min(0.22 * dd).clamp(4.0, 13.0);
    x.disk(m, t3 + rc, rc, "caldarium");
    // Furnaces against the hot rooms, clear of the rotunda.
    let fl = fw * 0.5 - rc - 1.5;
    if fl > 3.0 {
        x.rect(m - fw * 0.5, m - fw * 0.5 + fl, t3, t3 + 3.0, "furnace");
        x.rect(m + fw * 0.5 - fl, m + fw * 0.5, t3, t3 + 3.0, "furnace");
    }
    let pw = (ww - fw) * 0.5;
    for s0 in [a, m + fw * 0.5] {
        if pw >= 12.0 {
            x.court([s0, s0 + pw, c, t2], (0.2 * pw).clamp(3.0, 5.0), 0.0, "stoa");
        } else {
            x.rect(s0, s0 + pw, t1, t2, "cold-room");
        }
    }
    ok
}

/// Horreum: parallel store ranges with loading lanes between them, behind a
/// gate range on the street.
fn horreum(x: &mut Site) -> bool {
    let (a, b, c, e, m) = (x.s0 + 0.5, x.s1 - 0.5, x.ta + 0.5, x.t1 - 0.5, x.mid());
    let w = b - a;
    if w < 14.0 || e - c < 16.0 {
        return false;
    }
    let rg = (0.22 * w).clamp(4.5, 8.0);
    let rows = (((w + 4.5) / (rg + 4.5)).floor() as usize).clamp(2, 6);
    let lane = (w - rows as f64 * rg) / (rows as f64 - 1.0);
    let back = e.min(c + 80.0);
    // Gate range when the yard behind it keeps useful ranges.
    let front = if back - c > 3.0 * rg + 8.0 {
        x.rect(a, m - 2.0, c, c + rg, "horreum-range");
        x.rect(m + 2.0, b, c, c + rg, "horreum-range");
        c + rg + lane.clamp(3.5, 6.0)
    } else {
        c
    };
    let mut ok = false;
    for k in 0..rows {
        let s = a + k as f64 * (rg + lane);
        ok |= x.rect(s, s + rg, front, back, "horreum-range");
    }
    ok
}

/// Triumphal arch: one massive block across the way, its attic set back.
fn arch(x: &mut Site) -> bool {
    let (w, d, m) = (x.width(), x.depth(), x.mid());
    let aw = (0.6 * w).clamp(6.0, 22.0);
    let ad = (0.32 * aw).clamp(3.0, 7.0).min(d - 1.0);
    let t = x.ta + (d - ad) * 0.5;
    x.bar(m, aw, t, t + ad, "triumphal-arch")
}

#[cfg(test)]
mod tests {
    use super::super::super::occupation::Frame;
    use super::*;
    use crate::urban::geometry::{area, intersection};
    use crate::urban::{Point, Shape};

    fn site(b: &[Point], w: f64, d: f64) -> Site<'_> {
        let f = Frame { u: Point { x: 1.0, y: 0.0 }, n: Point { x: 0.0, y: 1.0 }, t0: 0.0 };
        Site { b, f, s0: 0.0, s1: w, ta: 0.0, t1: d, out: vec![] }
    }

    #[test]
    fn seating_forms_stay_inside_the_site_without_overlap() {
        let (w, d) = (70.0, 90.0);
        let b = vec![Point { x: 0.0, y: 0.0 }, Point { x: w, y: 0.0 }, Point { x: w, y: d }, Point { x: 0.0, y: d }];
        for form in ["theatre", "amphitheatre", "circus", "forum", "thermae"] {
            let mut x = site(&b, w, d);
            let ok = match form {
                "theatre" => theatre(&mut x, true),
                "amphitheatre" => amphitheatre(&mut x, true),
                "circus" => circus(&mut x),
                "forum" => forum(&mut x),
                _ => thermae(&mut x),
            };
            assert!(ok && x.out.len() >= 8, "{form}");
            let shapes: Vec<Shape> = x.out.iter().map(|p| Shape { outer: p.0.clone(), holes: vec![] }).collect();
            for (i, s) in shapes.iter().enumerate() {
                for (j, t) in shapes[i + 1..].iter().enumerate() {
                    let overlap: f64 = intersection(s, t).iter().map(area).sum();
                    assert!(overlap < 0.05, "{form}: {} overlaps {}", x.out[i].2, x.out[i + 1 + j].2);
                }
            }
        }
    }
}
