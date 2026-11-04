//! Decay of an empty building (`.abandoned` role suffix, programme `state`):
//! the preview reads the settlement's condition by construction. The share
//! of empty buildings follows the state's decay (services.json `states`,
//! programme.rs); each empty lot then draws, from its own seed, how far it has
//! fallen: still standing (shuttered), roof fallen in at the back, a roofless
//! shell, or a few stubs in an overgrown lot. A declining town (decay 0.2)
//! thus shows a few derelict lots, an abandoned one (decay 1) roofless shells
//! among shut houses. Ruins (`.ruin`) are broken walls (occupation.rs
//! `ruined`); every broken wall comes from `broken_walls`.
use super::occupation::{Occupancy, clip_parts, ring_area, thickness};
use super::*;

/// How far an empty building has fallen.
#[derive(Clone, Copy, Debug, PartialEq)]
pub(super) enum Decay {
    /// Standing, closed: the masses stay whole.
    Shuttered,
    /// The roof fell in at the back: the street part stands, the rest is walls.
    Partial,
    /// Every roof fell: the walls stand, open to the sky.
    Shell,
    /// A few stubs of wall in an overgrown lot.
    Fragments,
}

/// Shares of the four conditions among empty buildings (cumulative bounds):
/// half stand shut, a fifth lost their back roof, the rest are shells and a
/// few fragments.
const SHUTTERED: f64 = 0.5;
const PARTIAL: f64 = 0.7;
const SHELL: f64 = 0.92;
/// Wall strip thickness of a broken wall (as `ruined`), and the smallest
/// roofed part kept standing.
const WALL: f64 = 0.6;
const ROOFED_MIN: f64 = 3.0;

pub(super) fn decay_of(o: &Occupancy) -> Option<Decay> {
    if !o.role.ends_with(".abandoned") {
        return None;
    }
    let u = Rng::new(o.seed).fork("decay").float();
    Some(if u < SHUTTERED {
        Decay::Shuttered
    } else if u < PARTIAL {
        Decay::Partial
    } else if u < SHELL {
        Decay::Shell
    } else {
        Decay::Fragments
    })
}

/// The previewed parts of an empty building after its decay; other lots are
/// returned unchanged. Broken walls carry the `ruin` label (the renderer and
/// the houses side already read it); a standing street part keeps its label.
pub(in super::super) fn decayed(
    p: &Parcel,
    o: &Occupancy,
    parts: Vec<(Shape, &'static str)>,
) -> Vec<(Shape, &'static str)> {
    let Some(decay) = decay_of(o) else {
        return parts;
    };
    if decay == Decay::Shuttered || parts.is_empty() {
        return parts;
    }
    let mut rng = Rng::new(o.seed).fork("decay-walls");
    let street = street_point(p);
    let mut out = vec![];
    let mut budget = RUIN_BUDGET;
    for (shape, label) in parts {
        if is_ruin(label) || matches!(label, "wall" | "wheel") {
            out.push((shape, label));
            continue;
        }
        match decay {
            Decay::Partial if shape.holes.is_empty() => {
                partial(&shape, label, street, &mut rng, &mut budget, &mut out)
            }
            Decay::Fragments => {
                for r in rings(&shape) {
                    broken_walls(&r, None, 0.5, (0.25, 0.6), &mut rng, &mut budget, &mut out);
                }
            }
            // A roofless shell (a court building's shell keeps its court walls).
            _ => {
                for r in rings(&shape) {
                    broken_walls(&r, None, 0.12, (0.75, 1.0), &mut rng, &mut budget, &mut out);
                }
            }
        }
    }
    out
}

/// The point of the lot's street frontage (longest contact), else its centre.
fn street_point(p: &Parcel) -> Point {
    p.contacts
        .iter()
        .max_by(|a, b| a.length.total_cmp(&b.length))
        .map(|c| scale(add(c.a, c.b), 0.5))
        .or(p.front.map(|[a, b]| scale(add(a, b), 0.5)))
        .unwrap_or_else(|| super::super::geometry::centroid(&p.shape))
}

fn rings(s: &Shape) -> Vec<Vec<Point>> {
    std::iter::once(s.outer.clone())
        .chain(s.holes.iter().cloned())
        .collect()
}

/// The street part of the body keeps its roof (40-65 % of its depth from the
/// street); the back stands as walls, open on the cut.
fn partial(
    shape: &Shape,
    label: &'static str,
    street: Point,
    rng: &mut Rng,
    budget: &mut usize,
    out: &mut Vec<(Shape, &'static str)>,
) {
    // The cut runs parallel to the body's own wall that best faces the
    // street, so the fallen back is a range of the body, not a wedge.
    let c = super::super::geometry::centroid(shape);
    let toward = unit(sub(c, street));
    let k = shape.outer.len();
    let n = (0..k)
        .map(|i| sub(shape.outer[(i + 1) % k], shape.outer[i]))
        .filter(|e| length(*e) >= 2.0)
        .map(|e| {
            let m = normal(unit(e));
            if dot(m, toward) < 0.0 {
                scale(m, -1.0)
            } else {
                m
            }
        })
        .max_by(|a, b| dot(*a, toward).total_cmp(&dot(*b, toward)))
        .unwrap_or(toward);
    let ts: Vec<f64> = shape.outer.iter().map(|&q| dot(n, q)).collect();
    let (t0, t1) = ts
        .iter()
        .fold((f64::MAX, f64::MIN), |(a, b), &t| (a.min(t), b.max(t)));
    let cut = t0 + rng.range(0.4, 0.65) * (t1 - t0);
    let roofed = clip_parts(&shape.outer, &[(n, cut)]);
    let fallen = clip_parts(&shape.outer, &[(scale(n, -1.0), -cut)]);
    let standing = |r: &Vec<Point>| ring_area(r).abs() >= 4.0 && thickness(r, None) >= ROOFED_MIN;
    if roofed.is_empty() || !roofed.iter().all(standing) {
        for r in rings(shape) {
            broken_walls(&r, None, 0.12, (0.75, 1.0), rng, budget, out);
        }
        return;
    }
    for r in roofed {
        out.push((
            Shape {
                outer: r,
                holes: vec![],
            },
            label,
        ));
    }
    for r in fallen {
        broken_walls(&r, Some((n, cut)), 0.25, (0.5, 1.0), rng, budget, out);
    }
}

/// Labels of the one ruin representation: wall stubs, corners standing to
/// the eaves, rubble mounds (massing.rs `ruin_piece` raises them).
pub(in super::super) fn is_ruin(label: &str) -> bool {
    matches!(label, "ruin" | "ruin-corner" | "rubble")
}

/// Pieces one ruined building may show (walls and mounds), bounding its mesh.
pub(in super::super) const RUIN_BUDGET: usize = 14;

/// Broken walls of a ring, the one ruin representation of every ruined or
/// fallen building: each wall of 2 m or more stands along `keep` of its
/// length unless it fell (`fall`, leaving a mound inside), cut by door and
/// window gaps into stubs (`ruin`); a quarter of the walls keep their corner
/// standing to the eaves (`ruin-corner`); fallen stone lies in `rubble`
/// mounds inside. Walls on the cut `open` are not doubled; at most `budget`
/// pieces.
pub(in super::super) fn broken_walls(
    ring: &[Point],
    open: Option<(Point, f64)>,
    fall: f64,
    keep: (f64, f64),
    rng: &mut Rng,
    budget: &mut usize,
    out: &mut Vec<(Shape, &'static str)>,
) {
    let mut r = ring.to_vec();
    if ring_area(&r) < 0.0 {
        r.reverse();
    }
    let body = Shape { outer: r.clone(), holes: vec![] };
    let n = r.len();
    // Larger bodies (halls, giants' houses) have thicker walls and longer stubs.
    let size = (ring_area(&r).abs().sqrt() / 9.0).clamp(1.0, 2.5);
    let mut mounds = 0;
    for i in 0..n {
        let (a, b) = (r[i], r[(i + 1) % n]);
        let len = length(sub(b, a));
        let on_cut =
            open.is_some_and(|(m, c)| (dot(m, a) - c).abs() < 1e-6 && (dot(m, b) - c).abs() < 1e-6);
        if len < 2.0 || on_cut || *budget == 0 {
            continue;
        }
        let d = unit(sub(b, a));
        let inward = normal(d);
        let k = (WALL * size).min(len * 0.25);
        if rng.chance(fall) {
            if mounds < 3 && rng.chance(0.6) {
                mounds += usize::from(mound(&body, add(a, scale(d, len * rng.range(0.3, 0.7))), inward, k, size, rng, budget, out));
            }
            continue;
        }
        let kept = rng.range(keep.0, keep.1) * len;
        let corner = rng.chance(0.25);
        let mut t = if corner { 0.0 } else { rng.range(0.0, len - kept) };
        let end = t + kept;
        let mut first = true;
        while t < end - 0.4 * size && *budget > 0 {
            let s = (size * rng.range(1.2, 3.2)).min(end - t);
            let p = add(a, scale(d, t));
            let q = add(a, scale(d, t + s));
            let strip = vec![p, q, add(q, scale(inward, k)), add(p, scale(inward, k))];
            if ring_area(&strip).abs() >= 0.5 {
                out.push((Shape { outer: strip, holes: vec![] }, if corner && first { "ruin-corner" } else { "ruin" }));
                *budget -= 1;
            }
            first = false;
            // Door and window gaps between the stubs.
            t += s + size * rng.range(0.7, 1.3);
        }
    }
    // Stone fallen from the standing walls.
    if mounds == 0 && n >= 3 {
        let i = rng.int(0, n as u32 - 1) as usize;
        let (a, b) = (r[i], r[(i + 1) % n]);
        let len = length(sub(b, a));
        if len >= 2.0 {
            let d = unit(sub(b, a));
            mound(&body, add(a, scale(d, len * rng.range(0.25, 0.75))), normal(d), (WALL * size).min(len * 0.25), size, rng, budget, out);
        }
    }
}

/// A rubble mound (hexagon of 0.5-1 m by `size`) just inside a wall, kept
/// only when it lies wholly inside the building.
#[allow(clippy::too_many_arguments)]
fn mound(body: &Shape, at: Point, inward: Point, wall: f64, size: f64, rng: &mut Rng, budget: &mut usize, out: &mut Vec<(Shape, &'static str)>) -> bool {
    if *budget == 0 {
        return false;
    }
    let radius = size * rng.range(0.5, 1.0);
    let c = add(at, scale(inward, wall + radius + 0.15));
    let turn = rng.range(0.0, 1.0);
    let outer: Vec<Point> = (0..6)
        .map(|j| {
            let t = (j as f64 + turn) * std::f64::consts::PI / 3.0;
            add(c, Point { x: radius * t.cos(), y: radius * t.sin() })
        })
        .collect();
    if !outer.iter().all(|&q| super::super::geometry::contains(body, q)) {
        return false;
    }
    out.push((Shape { outer, holes: vec![] }, "rubble"));
    *budget -= 1;
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::urban::geometry::rectangle;

    /// One ruin representation: stubs, corners and mounds inside the body,
    /// bounded; giants keep ruins in villages, not in towns (culture data).
    #[test]
    fn broken_walls_stay_inside_and_bounded() {
        let body = rectangle(0.0, 0.0, 12.0, 9.0);
        let mut corners = 0;
        for i in 0..60 {
            let (mut rng, mut budget, mut out) = (Rng::new(&format!("ruin-{i}")), RUIN_BUDGET, vec![]);
            broken_walls(&body.outer, None, 0.3, (0.4, 1.0), &mut rng, &mut budget, &mut out);
            assert!(!out.is_empty() && out.len() <= RUIN_BUDGET, "{}", out.len());
            assert!(out.iter().all(|(s, l)| is_ruin(l)
                && s.outer.iter().all(|q| q.x >= -1e-6 && q.x <= 12.0 + 1e-6 && q.y >= -1e-6 && q.y <= 9.0 + 1e-6)));
            corners += out.iter().filter(|(_, l)| *l == "ruin-corner").count();
        }
        assert!(corners > 10, "{corners}");
        assert!(crate::urban::roles::ruin_share("giant-hold", "village") > 0.0);
        assert_eq!(crate::urban::roles::ruin_share("giant-hold", "town"), 0.0);
    }

    /// Empty buildings of a whole abandoned town: most lose their roofs, by
    /// each lot's own seed; every piece stays inside its building.
    #[test]
    fn empty_buildings_decay_by_their_own_seed() {
        let morph = Morph {
            value: serde_json::json!({}),
        };
        let lot = Parcel {
            pressure: 0.5,
            envelope: None,
            id: "lot".into(),
            parent_ids: vec![],
            provenance: vec![],
            family: "frontage".into(),
            reason: String::new(),
            shape: rectangle(0.0, 0.0, 10.0, 24.0),
            block: 0,
            use_kind: "plot".into(),
            front: None,
            axis: Point { x: 1.0, y: 0.0 },
            rank: 1,
            access: None,
            contacts: vec![super::super::super::ParcelContact {
                a: Point { x: 0.0, y: 0.0 },
                b: Point { x: 10.0, y: 0.0 },
                street: 0,
                rank: 1,
                length: 10.0,
                kind: "public".into(),
            }],
        };
        let body = vec![(rectangle(0.5, 0.0, 9.5, 12.0), "building")];
        let (mut roofless, mut changed) = (0, 0);
        for i in 0..200 {
            let seed = format!("town/parcel-{i}");
            let o = Occupancy {
                morph: &morph,
                zone: "core",
                function: "domestic",
                role: "dwelling.house.abandoned",
                landmark: false,
                party_walls: true,
                wealth: 0.5,
                seed: &seed,
                pack: "EUR-MED",
                court_lot: false,
                court_kept: None,
            };
            let parts = decayed(&lot, &o, body.clone());
            let roofed: f64 = parts
                .iter()
                .filter(|(_, l)| *l == "building")
                .map(|(s, _)| area(s))
                .sum();
            assert!(parts.iter().all(|(s, _)| {
                s.outer.iter().all(|q| {
                    q.x >= 0.5 - 1e-6 && q.x <= 9.5 + 1e-6 && q.y >= -1e-6 && q.y <= 12.0 + 1e-6
                })
            }));
            roofless += usize::from(roofed < 0.7 * 108.0);
            changed += usize::from(parts != body);
            // A thriving lot keeps its masses.
            let thriving = Occupancy {
                role: "dwelling.house",
                ..o
            };
            assert_eq!(decayed(&lot, &thriving, body.clone()), body);
        }
        assert!((80..=120).contains(&roofless), "{roofless}");
        assert_eq!(changed, roofless);
    }
}
