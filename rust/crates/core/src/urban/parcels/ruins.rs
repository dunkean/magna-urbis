//! Decay of an empty building (`.abandoned` role suffix, programme `state`):
//! the preview reads the settlement's condition by construction. The share
//! of empty buildings follows the state's decay (services.json `states`,
//! programme.rs); each empty lot then draws, from its own seed, how far it has
//! fallen: still standing (shuttered), roof fallen in at the back, a roofless
//! shell, or a few stubs in an overgrown lot. A declining town (decay 0.2)
//! thus shows a few derelict lots, an abandoned one (decay 1) mostly shells.
//! Ruins (`.ruin`) are already broken walls (occupation.rs `ruined`).
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
/// three quarters roofless or partial, a tenth reduced to fragments.
const SHUTTERED: f64 = 0.25;
const PARTIAL: f64 = 0.55;
const SHELL: f64 = 0.9;
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
    for (shape, label) in parts {
        if matches!(label, "ruin" | "wall" | "wheel") {
            out.push((shape, label));
            continue;
        }
        match decay {
            Decay::Partial if shape.holes.is_empty() => {
                partial(&shape, label, street, &mut rng, &mut out)
            }
            Decay::Fragments => {
                for r in rings(&shape) {
                    walls(&r, None, 0.5, (0.25, 0.6), &mut rng, &mut out);
                }
            }
            // A roofless shell (a court building's shell keeps its court walls).
            _ => {
                for r in rings(&shape) {
                    walls(&r, None, 0.12, (0.75, 1.0), &mut rng, &mut out);
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
            walls(&r, None, 0.12, (0.75, 1.0), rng, out);
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
        walls(&r, Some((n, cut)), 0.25, (0.5, 1.0), rng, out);
    }
}

/// Broken stretches of a ring's walls: each wall of 2 m or more stands along
/// `keep` of its length unless it fell (`fall`); walls on the cut `open`
/// (the roofed part's own wall) are not doubled.
fn walls(
    ring: &[Point],
    open: Option<(Point, f64)>,
    fall: f64,
    keep: (f64, f64),
    rng: &mut Rng,
    out: &mut Vec<(Shape, &'static str)>,
) {
    let mut r = ring.to_vec();
    if ring_area(&r) < 0.0 {
        r.reverse();
    }
    let n = r.len();
    for i in 0..n {
        let (a, b) = (r[i], r[(i + 1) % n]);
        let len = length(sub(b, a));
        let on_cut =
            open.is_some_and(|(m, c)| (dot(m, a) - c).abs() < 1e-6 && (dot(m, b) - c).abs() < 1e-6);
        if len < 2.0 || on_cut || rng.chance(fall) {
            continue;
        }
        let d = unit(sub(b, a));
        let inward = normal(d);
        let kept = rng.range(keep.0, keep.1) * len;
        let start = rng.range(0.0, len - kept);
        let p = add(a, scale(d, start));
        let q = add(a, scale(d, start + kept));
        let k = WALL.min(len * 0.25);
        let strip = vec![p, q, add(q, scale(inward, k)), add(p, scale(inward, k))];
        if ring_area(&strip).abs() >= 0.5 {
            out.push((
                Shape {
                    outer: strip,
                    holes: vec![],
                },
                "ruin",
            ));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::urban::geometry::rectangle;

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
        assert!((120..=170).contains(&roofless), "{roofless}");
        assert_eq!(changed, roofless);
    }
}
