//! Contemporary, futuristic and alien forms of the modern styles: housing
//! slabs and point towers, malls, stadiums, power plants with their cooling
//! towers, broadcast masts, arcologies, megastructure spines, habitat domes,
//! vertical farms, monuments, alien hives and organic spires.
//!
//! See `mod.rs` for the contract. Like `modern.rs`, this family builds only
//! for the cultures whose traits state an `era` (`forms/styles_modern.json`),
//! and only the roles below, so it never takes a role from another family.
//! The parts are raised by the rules of `forms/roles_modern.json`, which the
//! styles' override groups (`roleGroups`) re-raise in their own way (soviet
//! slabs of five to nine storeys, cyberpunk towers of two hundred metres).
use super::classical::{axes, span as along};
use super::modern::around;
use super::utility::{edges, end, laid};
use super::{Brief, Site};
use crate::rng::Rng;
use std::f64::consts::TAU;

pub(super) fn build(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    if crate::urban::forms::kit::traits(q.culture).era.is_empty() {
        return false;
    }
    laid(x, |x| form(x, q, rng))
}

fn form(x: &mut Site, q: &Brief, rng: &mut Rng) -> bool {
    if q.is("housing.slab") {
        slab(x)
    } else if q.is("housing.tower") {
        tower(x, rng)
    } else if q.is("commerce.mall") {
        mall(x, rng)
    } else if q.is("civic.stadium") {
        stadium(x)
    } else if q.is("civic.power-plant") {
        power_plant(x, q.is("civic.power-plant.atomic"))
    } else if q.is("civic.tv-tower") {
        mast(x, rng)
    } else if q.is("civic.arcology") {
        arcology(x)
    } else if q.is("civic.megastructure") {
        megastructure(x)
    } else if q.is("civic.habitat-dome") {
        habitat_dome(x, rng)
    } else if q.is("civic.vertical-farm") {
        vertical_farm(x, rng)
    } else if q.is("civic.monument") {
        monument(x)
    } else if q.is("civic.hive") {
        hive(x, rng)
    } else if q.is("civic.organic-spire") {
        organic_spire(x, rng)
    } else {
        false
    }
}

/// Housing slab: a long slab set back from the street behind its lobby and,
/// on a deep lot, a second slab parallel to it across a lawn.
fn slab(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 20.0 || room < 14.0 {
        return false;
    }
    let m = x.mid();
    let len = span.min(120.0);
    let depth = 12.0f64.min(room - 2.0);
    let fore = ((room - depth) * 0.3).clamp(0.0, 10.0);
    let t = c + fore;
    let ok = x.bar(m, len, t, t + depth, "slab-block");
    if fore >= 3.5 {
        x.bar(m, (0.1 * len).clamp(4.0, 8.0), t - 3.0, t, "slab-lobby");
    }
    let gap = (2.0 * depth).max(18.0);
    if e - (t + depth + gap) >= depth {
        x.bar(m, len, t + depth + gap, t + 2.0 * depth + gap, "slab-block");
    }
    ok
}

/// Point tower: one square tower (two on a wide lot) back from the street,
/// on some lots rising out of a podium that fills the front of the lot.
fn tower(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 16.0 || room < 16.0 {
        return false;
    }
    let m = x.mid();
    let side = (0.5 * span.min(room)).clamp(14.0, 26.0);
    let twin = span >= 2.0 * side + 14.0;
    let tc = c + ((room - side) * 0.5).min(12.0);
    let gap = ((span - 2.0 * side) * 0.5).clamp(8.0, 30.0);
    let centres = if twin { vec![m - 0.5 * (side + gap), m + 0.5 * (side + gap)] } else { vec![m] };
    let mut ok = false;
    for s in centres {
        ok |= x.bar(s, side, tc, tc + side, "res-tower");
    }
    if !twin && span.min(room) >= side + 10.0 && rng.chance(0.5) {
        let w = span.min(side + 24.0);
        let back = (c + side + 20.0).min(e).max(tc + side);
        around(x, [m - w * 0.5, m + w * 0.5, c, back], [m - side * 0.5, m + side * 0.5, tc, tc + side], "res-podium");
    }
    ok
}

/// Shopping mall: a long low hall between two anchor stores behind its car
/// park, a vaulted atrium in the middle of the hall, and on some lots a
/// parking deck at a front corner.
fn mall(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 40.0 || room < 30.0 {
        return false;
    }
    let w = span.min(220.0);
    let (l, r) = (x.mid() - w * 0.5, x.mid() + w * 0.5);
    let fore = if room >= 54.0 { (0.3 * room).min(50.0) } else { 0.0 };
    let t = c + fore;
    let d = (e - t).min(80.0);
    let anchor = (0.18 * w).clamp(14.0, 40.0);
    let both = w >= 3.0 * anchor + 20.0;
    let (h0, h1) = (l + anchor, if both { r - anchor } else { r });
    x.rect(l, h0, t, t + d, "mall-anchor");
    if both {
        x.rect(h1, r, t, t + d, "mall-anchor");
    }
    let (i0, i1) = (t + 0.15 * d, t + 0.85 * d);
    let atrium = (0.2 * (h1 - h0)).clamp(10.0, 30.0);
    let ok = if h1 - h0 >= atrium + 20.0 {
        let mid = (h0 + h1) * 0.5;
        let left = x.rect(h0, mid - atrium * 0.5, i0, i1, "mall-hall");
        x.rect(mid - atrium * 0.5, mid + atrium * 0.5, i0, i1, "mall-atrium");
        x.rect(mid + atrium * 0.5, h1, i0, i1, "mall-hall") || left
    } else {
        x.rect(h0, h1, i0, i1, "mall-hall")
    };
    if fore >= 26.0 && rng.chance(0.5) {
        let (p0, p1) = end(l, r, (0.3 * w).min(60.0), rng.chance(0.5));
        x.rect(p0, p1, c, t - 6.0, "parking-deck");
    }
    ok
}

/// Stadium: the oval bowl of stands around its open pitch.
fn stadium(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 60.0 || room < 50.0 {
        return false;
    }
    let (rs, rt) = ((0.5 * span).min(120.0), (0.5 * room).min(95.0));
    let thick = (0.28 * rs.min(rt)).clamp(10.0, 32.0);
    let m = x.mid();
    x.wedges((m, c + rt), (rs, rt), thick, (0.0, TAU), 20, "stand")
}

/// Power plant: the turbine hall along the street, a chimney or (atomic) a
/// reactor dome beside it, and a row of cooling towers behind.
fn power_plant(x: &mut Site, atomic: bool) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 50.0 || room < 50.0 {
        return false;
    }
    let w = span.min(240.0);
    let (l, r) = (x.mid() - w * 0.5, x.mid() + w * 0.5);
    let t = c + 2.0;
    let hall = (0.22 * room).clamp(12.0, 30.0);
    let hall_end = r.min(l + (0.6 * w).max(30.0));
    let ok = x.rect(l, hall_end, t, t + hall, "turbine-hall");
    if atomic {
        let d = (r - hall_end - 4.0).min(hall + 6.0).min(40.0);
        if d >= 14.0 {
            x.disk(hall_end + 2.0 + d * 0.5, t + d * 0.5, d * 0.5, "reactor-dome");
        }
    } else if r - hall_end >= 8.0 {
        x.bar(hall_end + 5.0, 4.0, t + 2.0, t + 6.0, "factory-chimney");
    }
    let t2 = t + hall + 8.0;
    let dia = (0.4 * w).min(e - t2).min(90.0);
    if dia >= 30.0 {
        let n = ((w + 10.0) / (dia + 10.0)).floor().clamp(1.0, 4.0) as usize;
        let step = w / n as f64;
        for k in 0..n {
            x.disk(l + (k as f64 + 0.5) * step, t2 + dia * 0.5, dia * 0.475, "cooling-tower");
        }
    }
    ok
}

/// Broadcast tower (or airship mooring mast): the slender round shaft in the
/// middle of its lot, a low base building beside it on a wide one.
fn mast(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    let side = (0.4 * span.min(room)).clamp(8.0, 16.0);
    if span < side + 2.0 || room < side + 2.0 {
        return false;
    }
    let (m, tc) = (x.mid(), c + (room - side) * 0.5);
    let ok = x.disk(m, tc + side * 0.5, side * 0.5, "mast-shaft");
    if span >= side + 16.0 {
        let (b0, b1) = end(a, b, ((span - side) * 0.5 - 2.0).min(20.0), rng.chance(0.5));
        x.rect(b0, b1, tc, tc + side, "mast-base");
    }
    ok
}

/// Arcology: the stepped megastructure in the middle of its lot, a skirt of
/// lower terraces around it.
fn arcology(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 40.0 || room < 40.0 {
        return false;
    }
    let side = (0.6 * span.min(room)).clamp(30.0, 160.0);
    let (m, tc) = (x.mid(), c + (room - side) * 0.5);
    let core = [m - side * 0.5, m + side * 0.5, tc, tc + side];
    let ok = x.rect(core[0], core[1], core[2], core[3], "arcology-tier");
    let skirt = (0.15 * side).clamp(8.0, 30.0);
    around(x, [core[0] - skirt, core[1] + skirt, core[2] - skirt, core[3] + skirt], core, "arcology-skirt");
    ok
}

/// Megastructure spine: a continuous high block along the longer side of the
/// lot, broken by taller towers at regular intervals.
fn megastructure(x: &mut Site) -> bool {
    let deep = x.depth() >= x.width();
    let (start, centre, long, short) = axes(x, deep);
    if long < 60.0 || short < 24.0 {
        return false;
    }
    let wide = (0.6 * short).clamp(18.0, 50.0);
    let length = (long - 4.0).min(400.0);
    let l0 = start + (long - length) * 0.5;
    let tower = (1.1 * wide).min(0.25 * length);
    let n = ((length / (3.0 * tower)).floor() as usize).clamp(1, 5);
    let pitch = length / n as f64;
    let across = [centre - wide * 0.5, centre + wide * 0.5];
    let mut ok = false;
    for k in 0..n {
        let s = l0 + k as f64 * pitch;
        let (t0, t1) = (s + (pitch - tower) * 0.5, s + (pitch + tower) * 0.5);
        ok |= along(x, deep, [s, t0], across, "spine-block");
        along(x, deep, [t0, t1], [centre - wide * 0.6, centre + wide * 0.6], "spine-tower");
        along(x, deep, [t1, s + pitch], across, "spine-block");
    }
    ok
}

/// Habitat dome: the great pressurised dome in the middle of its lot, vaulted
/// modules on its axes, each behind a small airlock.
fn habitat_dome(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 20.0 || room < 20.0 {
        return false;
    }
    let r = (0.36 * span.min(room)).clamp(8.0, 60.0);
    let (m, tc) = (x.mid(), c + room * 0.5);
    let ok = x.disk(m, tc, r, "habitat-dome");
    let module = (0.35 * r).clamp(4.0, 10.0);
    let len = (0.5 * span.min(room) - r - 1.5).min(2.5 * module);
    if len >= module {
        let lock = (0.4 * module).max(1.5);
        let pair = |p: f64, q: f64| (p.min(q), p.max(q));
        for (ds, dt) in [(1.0, 0.0), (-1.0, 0.0), (0.0, 1.0), (0.0, -1.0)] {
            if !rng.chance(0.75) {
                continue;
            }
            let (s0, s1, t0, t1, l0, l1, k0, k1) = if dt == 0.0 {
                let (s0, s1) = pair(m + ds * (r + 1.0), m + ds * (r + 1.0 + len));
                let (l0, l1) = pair(m + ds * r, m + ds * (r + 1.0));
                (s0, s1, tc - module * 0.5, tc + module * 0.5, l0, l1, tc - lock * 0.5, tc + lock * 0.5)
            } else {
                let (t0, t1) = pair(tc + dt * (r + 1.0), tc + dt * (r + 1.0 + len));
                let (k0, k1) = pair(tc + dt * r, tc + dt * (r + 1.0));
                (m - module * 0.5, m + module * 0.5, t0, t1, m - lock * 0.5, m + lock * 0.5, k0, k1)
            };
            x.rect(s0, s1, t0, t1, "hab-module");
            x.small(l0, l1, k0, k1, "airlock");
        }
    }
    ok
}

/// Vertical farm: a terraced tower at one front corner, glasshouse bays
/// beside it and behind it.
fn vertical_farm(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 16.0 || room < 16.0 {
        return false;
    }
    let side = (0.5 * span.min(room)).clamp(14.0, 30.0);
    let left = rng.chance(0.5);
    let (s0, s1) = end(a, b, side, left);
    let ok = x.rect(s0, s1, c, c + side, "farm-tower");
    let (g0, g1) = if left { (s1 + 2.0, b) } else { (a, s0 - 2.0) };
    if g1 - g0 >= 8.0 {
        let bay = 9.0;
        let mut t = c;
        while t + bay <= e.min(c + 63.0) {
            x.rect(g0, g1, t, t + bay - 1.0, "greenhouse");
            t += bay;
        }
    }
    if e - (c + side) >= 10.0 {
        x.rect(s0, s1, c + side + 2.0, (c + side + 22.0).min(e), "greenhouse");
    }
    ok
}

/// Monument: a column or statue on its stepped plinth in the middle of its square.
fn monument(x: &mut Site) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 10.0 || room < 10.0 {
        return false;
    }
    let (m, tm) = (x.mid(), c + room * 0.5);
    let p = (0.35 * span.min(room)).clamp(5.0, 16.0);
    let col = (0.3 * p).clamp(2.0, 4.0);
    let inner = [m - col * 0.5, m + col * 0.5, tm - col * 0.5, tm + col * 0.5];
    let ok = x.small(inner[0], inner[1], inner[2], inner[3], "monument-column");
    around(x, [m - p * 0.5, m + p * 0.5, tm - p * 0.5, tm + p * 0.5], inner, "monument-plinth");
    ok
}

/// Alien hive: a tall spire in the middle and rings of domed cells around it,
/// the inner ring higher than the outer ones.
fn hive(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 24.0 || room < 24.0 {
        return false;
    }
    let (m, tm) = (x.mid(), c + room * 0.5);
    let core = (0.18 * span.min(room)).clamp(5.0, 16.0);
    let ok = x.disk(m, tm, core, "hive-spire");
    let cell = (0.5 * core).clamp(3.0, 9.0);
    let step = 2.0 * cell + 2.0;
    let mut radius = core + cell + 1.0;
    for ring in 0..3 {
        if radius + cell > 0.5 * span.min(room) {
            break;
        }
        let n = ((TAU * radius) / step).floor() as usize;
        let phase = rng.float() * TAU;
        for k in 0..n {
            let ang = phase + k as f64 * TAU / n as f64;
            if rng.chance(0.85) {
                x.disk(m + radius * ang.cos(), tm + radius * ang.sin(), cell, if ring == 0 { "hive-cell" } else { "hive-cell-low" });
            }
        }
        radius += step;
    }
    ok
}

/// Organic spire: a tapering living spire, a few domed roots around its foot.
fn organic_spire(x: &mut Site, rng: &mut Rng) -> bool {
    let (a, b, c, e) = edges(x);
    let (span, room) = (b - a, e - c);
    if span < 12.0 || room < 12.0 {
        return false;
    }
    let (m, tm) = (x.mid(), c + room * 0.5);
    let r = (0.22 * span.min(room)).clamp(4.0, 14.0);
    let ok = x.disk(m, tm, r, "organic-spire");
    let root = (0.45 * r).clamp(2.0, 6.0);
    let n = 3 + (rng.float() * 3.0) as usize;
    let phase = rng.float() * TAU;
    for k in 0..n {
        let ang = phase + k as f64 * TAU / n as f64;
        let d = r + root + 1.0 + rng.float() * root;
        x.disk(m + d * ang.cos(), tm + d * ang.sin(), root, "spire-root");
    }
    ok
}

#[cfg(test)]
mod tests {
    use super::super::super::occupation::Frame;
    use super::super::super::super::{Point, Shape, geometry};
    use super::*;

    const ROLES: [&str; 14] = [
        "housing.slab", "housing.tower", "commerce.mall", "civic.stadium", "civic.power-plant", "civic.power-plant.atomic",
        "civic.tv-tower", "civic.arcology", "civic.megastructure", "civic.habitat-dome", "civic.vertical-farm",
        "civic.monument", "civic.hive", "civic.organic-spire",
    ];

    fn parts(role: &str, culture: &str, w: f64, d: f64) -> Vec<super::super::super::landmark::Part> {
        let b = vec![Point { x: 0.0, y: 0.0 }, Point { x: w, y: 0.0 }, Point { x: w, y: d }, Point { x: 0.0, y: d }];
        let f = Frame { u: Point { x: 1.0, y: 0.0 }, n: Point { x: 0.0, y: 1.0 }, t0: 0.0 };
        let mut x = Site { b: &b, f, s0: 0.0, s1: w, ta: 0.0, t1: d, out: vec![] };
        let q = Brief { role, family: "western", culture, zone: "core", function: "collective", wealth: 0.5, landmark: false };
        build(&mut x, &q, &mut Rng::new(&format!("{role}/{w}")));
        x.out
    }

    #[test]
    fn metropolis_forms_lay_disjoint_ruled_parts_inside_the_lot() {
        for role in ROLES {
            for (w, d) in [(80.0, 110.0), (180.0, 220.0)] {
                let out = parts(role, "cyberpunk", w, d);
                assert!(w < 100.0 || !out.is_empty(), "{role} {w}x{d}: nothing laid");
                for (i, (ring, _, label)) in out.iter().enumerate() {
                    assert!(crate::urban::forms::roles::rule(label, &["cyberpunk"]).is_some(), "{role}: {label} has no mass rule");
                    assert!(ring.iter().all(|p| p.x > -1e-6 && p.x < w + 1e-6 && p.y > -1e-6 && p.y < d + 1e-6), "{role}: {label} leaves the lot");
                    let sa = Shape { outer: ring.clone(), holes: vec![] };
                    for (other, _, l2) in &out[i + 1..] {
                        let overlap: f64 = geometry::intersection(&sa, &Shape { outer: other.clone(), holes: vec![] }).iter().map(geometry::area).sum();
                        assert!(overlap < 0.01, "{role} {w}x{d}: {label} overlaps {l2}");
                    }
                }
            }
        }
    }

    #[test]
    fn cultures_without_an_era_are_declined() {
        for role in ROLES {
            assert!(parts(role, "european-organic", 180.0, 220.0).is_empty(), "{role}");
        }
    }
}
