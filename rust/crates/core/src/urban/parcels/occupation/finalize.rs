//! Footprint validation and finalization.

use super::*;

/// A ruin keeps broken stretches of its walls and no roofed body: the walls
/// of every piece break into stubs, corners and rubble (ruins.rs
/// `broken_walls`, some walls fallen entirely). Abandoned buildings stay whole
/// (their role suffix flags them).
pub(super) fn ruined(o: &Occupancy, pieces: Vec<Piece>, rng: &mut Rng) -> Vec<Piece> {
    if !o.role.ends_with(".ruin") {
        return pieces;
    }
    let (mut out, mut budget) = (vec![], super::super::ruins::RUIN_BUDGET);
    for (outer, hole, _) in pieces {
        for r in std::iter::once(outer).chain(hole) {
            super::super::ruins::broken_walls(&r, None, 0.3, (0.4, 1.0), rng, &mut budget, &mut out);
        }
    }
    out.into_iter().map(|(s, label)| (s.outer, None, label)).collect()
}

/// Clean pieces: keep valid simple rings only, orient them, drop any piece
/// thinner than its structural minimum (bodies and wings `wing`, landmark
/// parts 1.5 m, ruin walls 0.3 m), and keep the parcel's reserved holes
/// unbuilt, keeping every valid component of what remains.
pub(super) fn finish(shape: &Shape, pieces: Vec<Piece>, wing: f64) -> Vec<(Shape, &'static str)> {
    // The light parts of a home's plan (porch, bay: forms/plan.rs) are
    // thinner and smaller than any other mass: they keep their own minimum.
    let light = |label: &str| {
        use super::super::super::forms::plan;
        plan::is_house_part(label) && label != "building" && plan::min_side(label) < 1.5
    };
    let minimum = |label: &str| match label {
        "building" | "range" => wing - 1e-6,
        l if super::super::ruins::is_ruin(l) => 0.3,
        l if light(l) => super::super::super::forms::plan::min_side(l) - 1e-6,
        _ => 1.5,
    };
    // No needle: a built piece keeps every interior angle at 20 degrees or
    // more (walls, wheels and ruins are thin by nature).
    let blunt = |r: &[Point], label: &str| {
        super::super::ruins::is_ruin(label) || matches!(label, "wall" | "wheel")
            || (0..r.len()).all(|i| {
                let n = r.len();
                let (a, v, b) = (r[(i + n - 1) % n], r[i], r[(i + 1) % n]);
                let (u, w) = (sub(a, v), sub(b, v));
                let (lu, lw) = (length(u), length(w));
                lu < 1.0
                    || lw < 1.0
                    || (u.x * w.x + u.y * w.y) / (lu * lw) <= 20.0_f64.to_radians().cos()
            })
    };
    let valid = |s: &Shape, label: &str| {
        s.outer.len() >= 3
            && area(s)
                >= if super::super::ruins::is_ruin(label) {
                    0.5
                } else if light(label) {
                    minimum(label) * minimum(label)
                } else {
                    4.0
                }
            && blunt(&s.outer, label)
            && simple(&s.outer)
            && s.holes.iter().all(|h| h.len() >= 3 && simple(h))
            && thickness(&s.outer, s.holes.first().map(|h| h.as_slice())) >= minimum(label)
    };
    // Reserved holes are real areas: cadastral merges leave zero-area rings
    // (collinear triples, seams) that reserve nothing, yet their difference
    // breaks every piece of the lot into invalid rings.
    let reserved: Vec<Shape> = shape
        .holes
        .iter()
        .filter(|h| h.len() >= 3 && ring_area(h).abs() >= 0.5)
        .map(|h| Shape {
            outer: h.clone(),
            holes: vec![],
        })
        .collect();
    let mut out = vec![];
    for (outer, hole, label) in pieces {
        let mut outer = dedup(outer);
        if outer.len() < 3 {
            continue;
        }
        if ring_area(&outer) < 0.0 {
            outer.reverse();
        }
        // Courts are clockwise holes whatever the frame handedness.
        let hole = hole.map(dedup).filter(|h| h.len() >= 3).map(|mut h| {
            if ring_area(&h) > 0.0 {
                h.reverse();
            }
            h
        });
        let piece = Shape {
            outer,
            holes: hole.into_iter().collect(),
        };
        if reserved.is_empty() {
            if valid(&piece, label) {
                out.push((piece, label));
            }
        } else {
            // Rare: reserved holes inside the parcel stay unbuilt.
            let mut rest = vec![piece];
            for h in &reserved {
                rest = rest.iter().flat_map(|s| difference(s, h)).collect();
            }
            out.extend(
                rest.into_iter()
                    .map(|s| super::super::super::geometry::normalized(s))
                    .filter(|s| s.holes.len() <= 1 && valid(s, label))
                    .map(|s| (s, label)),
            );
        }
    }
    out
}

pub(super) fn dedup(ring: Vec<Point>) -> Vec<Point> {
    let mut out: Vec<Point> = Vec::with_capacity(ring.len());
    for p in ring {
        if out.last().is_none_or(|q| length(sub(p, *q)) > 5e-3) {
            out.push(p);
        }
    }
    while out.len() > 1 && length(sub(out[0], *out.last().unwrap())) <= 5e-3 {
        out.pop();
    }
    // Drop exactly collinear vertices and doubled-back ones: a spike whose
    // two sides retrace each other within 2 degrees has no width (clipping
    // leaves them with millimetre offsets, beyond an exact test). Vertices
    // within 5 mm, including neighbours left by a removed spike, collapse.
    let mut changed = true;
    while changed && out.len() >= 3 {
        changed = false;
        let n = out.len();
        for i in 0..n {
            let (a, b, c) = (out[(i + n - 1) % n], out[i], out[(i + 1) % n]);
            let (u, v) = (sub(b, a), sub(c, b));
            let (lu, lv) = (length(u).max(1e-9), length(v).max(1e-9));
            let cross = (u.x * v.y - u.y * v.x).abs();
            let back = u.x * v.x + u.y * v.y < 0.0 && cross <= 2.0_f64.to_radians().sin() * lu * lv;
            if cross <= 1e-9 * lu * lv || back || length(sub(c, a)) <= 5e-3 {
                out.remove(i);
                if out.len() >= 2 && i < out.len() {
                    let j = if i == 0 { out.len() - 1 } else { i - 1 };
                    if length(sub(out[i % out.len()], out[j])) <= 5e-3 {
                        out.remove(i % out.len());
                    }
                }
                changed = true;
                break;
            }
        }
    }
    out
}
