//! Footprint validation and finalization.

use super::*;

/// A ruin keeps broken stretches of its walls and no roofed body: the walls
/// of every piece break into stubs, corners and rubble (ruins.rs
/// `broken_walls`, some walls fallen entirely). Abandoned buildings stay whole
/// (their role suffix flags them). The breaks draw from the lot's own
/// `occupation-ruin` stream, forked from its `seed`, whatever its form drew.
pub(super) fn ruined(o: &Occupancy, pieces: Vec<Piece>, seed: &Rng) -> Vec<Piece> {
    if !o.role.ends_with(".ruin") {
        return pieces;
    }
    let mut rng = seed.fork("occupation-ruin");
    let (mut out, mut budget) = (vec![], super::super::ruins::RUIN_BUDGET);
    for (outer, hole, _) in pieces {
        for r in std::iter::once(outer).chain(hole) {
            super::super::ruins::broken_walls(&r, None, 0.3, (0.4, 1.0), &mut rng, &mut budget, &mut out);
        }
    }
    out.into_iter().map(|(s, label)| (s.outer, None, label)).collect()
}

/// Clean pieces: keep valid simple rings only, orient them, drop any piece
/// thinner than its structural minimum, and keep the parcel's reserved holes
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
        // These roofed ranges need a usable interior width. Fixtures such as
        // wheels and curtain walls keep their own 1.5 m minimum below.
        "lean-rear" | "nave" => 2.5 - 1e-6,
        l if super::super::ruins::is_ruin(l) => 0.3,
        l if light(l) => super::super::super::forms::plan::min_side(l) - 1e-6,
        _ => 1.5,
    };
    let valid = |s: &Shape, label: &str| {
        let min = minimum(label);
        let a = area(s);
        s.outer.len() >= 3
            && a
                >= if super::super::ruins::is_ruin(label) {
                    0.5
                } else if light(label) {
                    minimum(label) * minimum(label)
                } else {
                    4.0
                }
            && blunt(&s.outer)
            && simple(&s.outer)
            && s.holes.iter().all(|h| h.len() >= 3 && simple(h))
            // Facing-edge thickness can miss a triangle with an oblique
            // vertex normal. Its exact width is the altitude to its longest edge.
            && (s.outer.len() != 3
                || s.outer.iter().zip(s.outer.iter().cycle().skip(1))
                    .all(|(&p, &q)| 2.0 * a >= min * length(sub(q, p))))
            && thickness(&s.outer, s.holes.first().map(|h| h.as_slice())) >= min
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
    let mut unsplit = vec![];
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
        let mut keep = |s: Shape| {
            if valid(&s, label) {
                out.push((s, label));
            } else if matches!(label, "building" | "range" | "lean-rear" | "nave")
                && s.holes.is_empty() && simple(&s.outer)
            {
                unsplit.push((s, label));
            }
        };
        if reserved.is_empty() {
            keep(piece);
        } else {
            // Rare: reserved holes inside the parcel stay unbuilt.
            let mut rest = vec![piece];
            for h in &reserved {
                rest = rest.iter().flat_map(|s| difference(s, h)).collect();
            }
            for s in rest.into_iter().filter(|s| s.holes.len() <= 1) {
                keep(super::super::super::geometry::normalized(s));
            }
        }
    }
    // A clipped piece may no longer support a separate roof. Undo the split
    // where it meets a suitable body and the combined footprint is sound.
    for (piece, label) in unsplit {
        for (body, body_label) in &mut out {
            let same_body = *body_label == label
                || matches!((label, *body_label),
                    ("lean-rear", "building" | "shop-body" | "smithy-forge")
                    | ("range", "building") | ("building", "range"));
            if !same_body || super::super::seams::shared(body, &piece) < 0.05 {
                continue;
            }
            let mut parts = super::super::super::geometry::union(&[body.clone(), piece.clone()]);
            if parts.len() == 1 && valid(&parts[0], body_label)
                && (area(&parts[0]) - area(body) - area(&piece)).abs() < 1e-3
            {
                *body = parts.remove(0);
                break;
            }
        }
    }
    out
}

/// Short edges can still form a convex needle. For reflex notches, keep
/// the existing metre-scale test so tiny clipping jogs do not reject a body.
fn blunt(ring: &[Point]) -> bool {
    let cos = 20.0_f64.to_radians().cos();
    let n = ring.len();
    (0..n).all(|i| {
        let u = sub(ring[(i + n - 1) % n], ring[i]);
        let v = sub(ring[(i + 1) % n], ring[i]);
        let uv = dot(u, v);
        if uv <= 0.0 {
            return true;
        }
        let (uu, vv) = (dot(u, u), dot(v, v));
        (u.x * v.y - u.y * v.x >= 0.0 && uu.min(vv) < 1.0)
            || uv * uv <= cos * cos * uu * vv
    })
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
