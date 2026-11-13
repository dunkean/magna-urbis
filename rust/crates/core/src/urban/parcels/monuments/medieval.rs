//! Medieval and early modern West and orthodox East (families `western`, `orthodox`): great churches with aisles and transepts, abbeys, castles and manors, guild and cloth halls, belfries, covered markets.
//!
//! See `mod.rs` for the contract: lay labelled, non-overlapping parts on the
//! site and return true for a role this family builds.
use super::classical::{aisled, axes, span};
use super::{Brief, Site};
use crate::rng::Rng;
use std::f64::consts::PI;

pub(super) fn build(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    let before = x.out.len();
    // Timber hall peoples raise their long hall whatever their monument family.
    let tribal = ["norse", "barbarian", "celtic", "gord"].iter().any(|k| q.culture.contains(k));
    if tribal && q.is("civic.longhall") {
        longhall(x, rng);
        return x.out.len() > before;
    }
    if !matches!(q.family, "western" | "orthodox") {
        return false;
    }
    if q.any(&["worship.cathedral", "worship.parish", "worship.church"]) {
        let cathedral = q.is("worship.cathedral");
        if q.family == "orthodox" {
            domed_church(x, cathedral, rng);
        } else {
            church(x, q, cathedral, rng);
        }
    } else if q.is("worship.monastery") {
        abbey(x, rng);
    } else if q.is("civic.guildhall") {
        guildhall(x, rng);
    } else if q.is("civic.townhall") {
        townhall(x);
    } else if q.is("commerce.market.hall") {
        cloth_hall(x);
    } else if q.is("civic.longhall") {
        longhall(x, rng);
    } else if q.is("elite.manor") {
        manor(x, rng);
    } else if q.is("elite.palace") {
        palace(x);
    } else {
        return false;
    }
    x.out.len() > before
}

/// Polygonal apse beyond `t`: half of a regular polygon of radius `r` whose
/// `n` sides are the inner chords of a ring of `n` wedges laid around it.
fn chevet(x: &mut Site, s: f64, t: f64, r: f64, n: usize, label: &'static str) -> bool {
    let pts: Vec<(f64, f64)> = (0..=n)
        .map(|k| {
            let a = PI * k as f64 / n as f64;
            (s + r * a.cos(), t + r * a.sin())
        })
        .collect();
    r > 1.0 && x.poly(&pts, label)
}

/// Latin church on the axis of the lot, west front on the street: the nave
/// (one part, so that it stays the main body its aisles lean against) with
/// lean-to aisles, transept arms laid against the nave's sides at the
/// crossing, the choir and its apse. A cathedral has twin west towers over the
/// first aisle bays and an ambulatory of radiating chapels; a parish church an
/// axial west tower; a share of the transept churches raise a crossing tower.
fn church(x: &mut Site, q: &Brief, cathedral: bool, rng: &mut Rng) -> bool {
    let (w, m) = (x.width(), x.mid());
    let t0 = x.ta + (0.08 * x.depth()).clamp(1.0, 8.0);
    let room = x.t1 - 0.5 - t0;
    let rich = cathedral || q.landmark || q.wealth > 0.6;
    let (wide, least) = if cathedral { ((0.24 * w).clamp(8.0, 15.0), 7.0) } else { ((0.3 * w).clamp(6.0, 10.0), 5.5) };
    // The nave narrows on a short site so that the whole church keeps its length.
    let nw = wide.min(room / 3.9);
    if nw < least || w < nw + 2.0 {
        return false;
    }
    let aw = 0.5 * nw;
    let aisles = rich && w >= 2.0 * nw + 1.0;
    let chevet_ring = cathedral && aisles && w >= 3.0 * nw + 1.0;
    let tsz = (0.62 * nw).clamp(4.0, 9.0);
    let al = if aisles { aw + 0.55 * nw } else { 0.7 * nw };
    let lc = if cathedral { 1.2 } else { 0.9 } * nw;
    let cw = if chevet_ring { nw } else { 0.8 * nw };
    let east = 0.5 * cw + if chevet_ring { aw } else { 0.0 };
    let twin = cathedral && w >= nw + 2.0 * tsz + 1.0;
    let fits = |west: f64| w >= nw + 2.0 * al + 1.0 && room - west - lc - east >= 3.0 * nw;
    let transept = rich && (cathedral || rng.chance(0.5)) && fits(if twin { 0.0 } else { 0.9 * nw });
    let lantern = transept && rng.chance(if cathedral { 0.35 } else { 0.25 });
    let towers = if lantern && !(twin && rng.chance(0.5)) { 0 } else if twin { 2 } else { 1 };
    let west = if towers == 1 { 0.9 * nw } else { 0.0 };
    let cross = if transept { nw } else { 0.0 };
    let ln = (room - west - lc - east - cross).min(if cathedral { 5.0 } else { 3.4 } * nw);
    if ln < 1.3 * nw {
        return false;
    }
    let (l, r) = (m - nw * 0.5, m + nw * 0.5);
    // Nave from `tn`, crossing from `tx`, choir from `tq`, apse chord at `te`.
    let tn = t0 + west;
    let tx = tn + ln;
    let tq = tx + cross;
    let te = tq + lc;
    match towers {
        2 => {
            x.rect(l - tsz, l, t0, t0 + tsz, "tower");
            x.rect(r, r + tsz, t0, t0 + tsz, "tower");
        }
        1 => {
            x.bar(m, 0.9 * nw, t0, tn, "tower");
        }
        _ => {}
    }
    let ok = if lantern {
        x.rect(l, r, tx, tq, "crossing");
        x.rect(l, r, tn, tx, "nave")
    } else {
        x.rect(l, r, tn, tq, "nave")
    };
    x.bar(m, cw, tq, te, "choir");
    if chevet_ring {
        chevet(x, m, te, 0.5 * nw, 5, "apse");
        x.wedges((m, te), (0.5 * nw + aw, 0.5 * nw + aw), aw, (0.0, PI), 5, "chapel");
    } else {
        x.apse(m, te, 0.5 * cw, "apse");
    }
    if aisles {
        let start = if towers == 2 { t0 + tsz } else { tn };
        for (a0, a1) in [(l - aw, l), (r, r + aw)] {
            x.rect(a0, a1, start, tx, "aisle");
            if chevet_ring {
                x.rect(a0, a1, tq, te, "aisle");
            }
        }
    }
    if transept {
        x.rect(l - al, l, tx, tq, "transept");
        x.rect(r, r + al, tx, tq, "transept");
    }
    ok
}

/// Orthodox cross-in-square: narthex on the street, the central dome on its
/// drum between four vaulted arms, the corner bays (domed on a cathedral),
/// one or three apses and a detached bell tower.
fn domed_church(x: &mut Site, cathedral: bool, rng: &mut Rng) -> bool {
    let (w, m) = (x.width(), x.mid());
    let t = x.ta + (0.1 * x.depth()).clamp(1.5, 10.0);
    let room = x.t1 - 1.0 - t;
    let q = (0.62 * w).min(room / 1.42).min(if cathedral { 30.0 } else { 17.0 });
    if q < 9.0 {
        return false;
    }
    x.bar(m, q, t, t + 0.25 * q, "narthex");
    let tg = t + 0.25 * q;
    // Three bays each way: corner, arm, corner (0.35, 0.30, 0.35 of the side).
    let cut = [0.0, 0.35 * q, 0.65 * q, q];
    let mut ok = false;
    for i in 0..3 {
        for j in 0..3 {
            let label = match (i == 1, j == 1) {
                (true, true) => "dome-drum",
                (false, false) if cathedral => "dome-drum-minor",
                (false, false) => "corner-bay",
                _ => "naos-arm",
            };
            ok |= x.rect(m - q * 0.5 + cut[i], m - q * 0.5 + cut[i + 1], tg + cut[j], tg + cut[j + 1], label);
        }
    }
    x.apse(m, tg + q, 0.15 * q, "apse");
    if cathedral && q >= 13.0 {
        x.apse(m - 0.325 * q, tg + q, 0.1 * q, "apse");
        x.apse(m + 0.325 * q, tg + q, 0.1 * q, "apse");
    }
    let bell = (0.26 * q).max(4.0);
    let side = if rng.chance(0.5) { m - q * 0.5 - bell - 2.0 } else { m + q * 0.5 + 2.0 };
    if side > x.s0 && side + bell < x.s1 {
        x.rect(side, side + bell, t, t + bell, "tower");
    }
    ok
}

/// Abbey: the church along one side (west tower, nave, apse, a lean-to aisle
/// on its outer side), the cloister against the nave: three ranges around the
/// garth and its covered walks.
fn abbey(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = (x.s0 + 0.5, x.s1 - 0.5, x.ta + 0.5, x.t1 - 0.5);
    let (w, d) = (b - a, e - c);
    if w < 24.0 || d < 22.0 {
        return false;
    }
    let left = rng.chance(0.5);
    // `u` runs across the site from the church's side.
    let put = |x: &mut Site, u0: f64, u1: f64, t0: f64, t1: f64, label: &'static str| {
        if left { x.rect(a + u0, a + u1, t0, t1, label) } else { x.rect(b - u1, b - u0, t0, t1, label) }
    };
    let nw = (0.2 * w).clamp(6.5, 11.0);
    let aw = 0.45 * nw;
    let tn = c + 0.8 * nw;
    let te = c + (d - 0.4 * nw).min(5.5 * nw);
    put(x, aw, aw + nw, c, tn, "tower");
    let ok = put(x, aw, aw + nw, tn, te, "nave");
    put(x, 0.0, aw, tn, te, "aisle");
    x.apse(if left { a + aw + 0.5 * nw } else { b - aw - 0.5 * nw }, te, 0.4 * nw, "apse");
    let uc = aw + nw;
    let side = (w - uc).min(te - tn).min(42.0);
    if side >= 16.0 {
        let rg = (0.2 * side).clamp(4.5, 8.0);
        let walk = (0.09 * side).clamp(2.2, 3.5);
        put(x, uc, uc + side - rg, tn, tn + rg, "abbey-range");
        put(x, uc, uc + side - rg, tn + side - rg, tn + side, "abbey-range");
        put(x, uc + side - rg, uc + side, tn, tn + side, "abbey-range");
        let (s0, s1) = if left { (a + uc, a + uc + side - rg) } else { (b - uc - side + rg, b - uc) };
        x.court([s0, s1, tn + rg, tn + side - rg], walk, 0.0, "cloister");
    }
    ok
}

/// Guildhall: a hall along the street behind one to three gabled
/// frontispieces, a stair tower at the back.
fn guildhall(x: &mut Site, rng: &mut Rng) -> bool {
    let (w, d, m) = (x.width(), x.depth(), x.mid());
    if w < 10.0 || d < 10.0 {
        return false;
    }
    let hw = (w - 1.0).min(34.0);
    let proj = (0.1 * d).clamp(1.5, 2.5);
    let depth = (0.5 * d).clamp(8.0, 16.0).min(d - proj - 1.0);
    let t = x.ta + 0.5 + proj;
    let ok = x.bar(m, hw, t, t + depth, "hall");
    let n = if hw < 14.0 { 1 } else if hw < 24.0 { 2 } else { 3 };
    let fw = (0.5 * hw / n as f64).clamp(4.0, 7.0);
    for k in 0..n {
        let s = m - hw * 0.5 + hw * (k as f64 + 0.5) / n as f64;
        x.bar(s, fw, t - proj, t, "frontispiece");
    }
    if d - proj - depth > 5.0 && rng.chance(0.6) {
        let s = m + if rng.chance(0.5) { hw * 0.5 - 3.4 } else { -hw * 0.5 + 0.4 };
        x.small(s, s + 3.0, t + depth, t + depth + 3.0, "stair-tower");
    }
    ok
}

/// Town hall: the belfry on the street, the hall behind it, an arcaded
/// gallery along the hall's front on both sides of the belfry.
fn townhall(x: &mut Site) -> bool {
    let (w, d, m) = (x.width(), x.depth(), x.mid());
    let bell = (0.2 * w).clamp(5.0, 8.0);
    if w < bell + 10.0 || d < bell + 10.0 {
        return false;
    }
    let hw = (w - 1.0).min(40.0);
    let t = x.ta + 0.5;
    let depth = (0.45 * d).clamp(9.0, 18.0).min(d - bell - 1.0);
    let gal = (0.45 * bell).clamp(2.5, 3.5);
    x.bar(m, bell, t, t + bell, "belfry");
    let ok = x.bar(m, hw, t + bell, t + bell + depth, "hall");
    x.rect(m - hw * 0.5, m - bell * 0.5, t + bell - gal, t + bell, "gallery");
    x.rect(m + bell * 0.5, m + hw * 0.5, t + bell - gal, t + bell, "gallery");
    ok
}

/// Cloth hall: a long hall between two open arcades along the longer side of
/// the site.
fn cloth_hall(x: &mut Site) -> bool {
    let deep = x.depth() >= x.width();
    let (start, c, len, wide) = axes(x, deep);
    let hw = (0.8 * wide).min(26.0);
    let hl = (len - 2.0).min(60.0).min(5.0 * hw);
    if hw < 9.0 || hl < 1.6 * hw {
        return false;
    }
    let l0 = start + (len - hl) * 0.5;
    aisled(x, deep, [l0, l0 + hl], c, (0.56 * hw, 0.22 * hw), ("hall", "gallery"))
}

/// Long timber hall: one long thatched body, lower and narrower end bays, a
/// porch on a long side (the street side when the hall runs along it).
fn longhall(x: &mut Site, rng: &mut Rng) -> bool {
    let deep = x.depth() > x.width();
    let (start, c, len, wide) = axes(x, deep);
    let hl = (0.85 * len).clamp(12.0, 42.0).min(len - 1.0);
    let hw = (0.5 * wide).clamp(5.5, 10.0).min(hl / 1.8);
    if hw < 4.5 || wide < hw + 2.0 {
        return false;
    }
    let l0 = start + (len - hl) * 0.5;
    let end = 0.12 * hl;
    let ok = span(x, deep, [l0 + end, l0 + hl - end], [c - hw * 0.5, c + hw * 0.5], "longhall");
    span(x, deep, [l0, l0 + end], [c - hw * 0.4, c + hw * 0.4], "longhall-end");
    span(x, deep, [l0 + hl - end, l0 + hl], [c - hw * 0.4, c + hw * 0.4], "longhall-end");
    let k = if deep && rng.chance(0.5) { 1.0 } else { -1.0 };
    let lp = l0 + hl * if rng.chance(0.5) { 0.3 } else { 0.62 };
    let pd = (0.5 * (wide - hw) - 0.3).min(2.2);
    let (p0, p1) = (c + k * hw * 0.5, c + k * (hw * 0.5 + pd));
    span(x, deep, [lp, lp + 2.6], [p0.min(p1), p0.max(p1)], "porch");
    ok
}

/// Manor: the hall between two cross-wings that project on both fronts, a
/// porch on the hall's door and a stair tower in a rear angle.
fn manor(x: &mut Site, rng: &mut Rng) -> bool {
    let (w, d, m) = (x.width(), x.depth(), x.mid());
    if w < 16.0 || d < 12.0 {
        return false;
    }
    let bw = (0.9 * w).min(46.0);
    let cw = (0.22 * bw).clamp(4.5, 8.0);
    let fore = (0.1 * d).clamp(1.0, 8.0);
    let hd = (0.4 * d).clamp(6.5, 10.0).min((d - fore - 1.0) / 1.6);
    let proj = (0.3 * hd).clamp(1.5, 4.0);
    let t0 = x.ta + fore;
    let (a, b) = (m - bw * 0.5, m + bw * 0.5);
    let ok = x.rect(a + cw, b - cw, t0 + proj, t0 + proj + hd, "hall");
    x.rect(a, a + cw, t0, t0 + hd + 2.0 * proj, "crosswing");
    x.rect(b - cw, b, t0, t0 + hd + 2.0 * proj, "crosswing");
    let door = m + (b - a - 2.0 * cw) * if rng.chance(0.5) { -0.2 } else { 0.2 };
    x.small(door - 1.4, door + 1.4, t0 + proj - proj.min(2.0), t0 + proj, "porch");
    if proj >= 2.0 {
        let s = if rng.chance(0.5) { a + cw } else { b - cw - proj };
        x.small(s, s + proj, t0 + proj + hd, t0 + 2.0 * proj + hd, "stair-tower");
    }
    ok
}

/// Palace: four ranges around a court between corner pavilions, the gate
/// pavilion on the street and the taller main range at the back.
fn palace(x: &mut Site) -> bool {
    let (w, d, m) = (x.width() - 1.0, x.depth() - 1.0, x.mid());
    if w < 26.0 || d < 26.0 {
        return false;
    }
    let (pw, pd) = (w.min(1.4 * d).min(80.0), d.min(1.4 * w).min(80.0));
    let (a, b, c) = (m - pw * 0.5, m + pw * 0.5, x.ta + 0.5);
    let e = c + pd;
    let pv = (0.16 * pw.min(pd)).clamp(5.5, 10.0);
    let rg = 0.78 * pv;
    let inset = (pv - rg) * 0.5;
    for (s, t) in [(a, c), (b - pv, c), (a, e - pv), (b - pv, e - pv)] {
        x.rect(s, s + pv, t, t + pv, "corner-pavilion");
    }
    let gate = (0.14 * pw).clamp(5.0, 9.0);
    x.bar(m, gate, c, c + pv, "gate-pavilion");
    x.rect(a + pv, m - gate * 0.5, c + inset, c + inset + rg, "palace-range");
    x.rect(m + gate * 0.5, b - pv, c + inset, c + inset + rg, "palace-range");
    x.rect(a + inset, a + inset + rg, c + pv, e - pv, "palace-range");
    x.rect(b - inset - rg, b - inset, c + pv, e - pv, "palace-range");
    x.rect(a + pv, b - pv, e - pv, e, "corps")
}

#[cfg(test)]
mod tests {
    use super::super::super::occupation::Frame;
    use super::*;
    use crate::urban::geometry::{area, intersection};
    use crate::urban::{Point, Shape};

    #[test]
    fn a_cathedral_has_aisles_and_a_chevet_without_overlap() {
        let (w, d) = (60.0, 110.0);
        let b = vec![Point { x: 0.0, y: 0.0 }, Point { x: w, y: 0.0 }, Point { x: w, y: d }, Point { x: 0.0, y: d }];
        let f = Frame { u: Point { x: 1.0, y: 0.0 }, n: Point { x: 0.0, y: 1.0 }, t0: 0.0 };
        let q = Brief { role: "worship.cathedral", family: "western", culture: "european-organic", zone: "core", function: "collective", wealth: 0.8, landmark: true };
        let mut x = Site { b: &b, f, s0: 0.0, s1: w, ta: 0.0, t1: d, out: vec![] };
        assert!(build(&mut x, &q, &mut Rng::new("cathedral")));
        for label in ["nave", "aisle", "transept", "choir", "apse", "chapel"] {
            assert!(x.out.iter().any(|p| p.2 == label), "{label}");
        }
        let shapes: Vec<Shape> = x.out.iter().map(|p| Shape { outer: p.0.clone(), holes: vec![] }).collect();
        for (i, s) in shapes.iter().enumerate() {
            for (j, t) in shapes[i + 1..].iter().enumerate() {
                let overlap: f64 = intersection(s, t).iter().map(area).sum();
                assert!(overlap < 0.05, "{} overlaps {}", x.out[i].2, x.out[i + 1 + j].2);
            }
        }
    }
}
