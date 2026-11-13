//! Monument and utility forms on a free-standing plot (an isolated chapel,
//! temple, inn or monastery of the countryside): the forms of `monuments` and
//! `landmark` laid on a rectangle of open ground, outside any lot.
use super::occupation::{Frame, ring_area, thickness};
use super::*;

/// Thinnest side of a range (a court's wing), as a town lot's `minWing`.
const RANGE_M: f64 = 3.0;

/// The labelled parts of the building of `role` on the rectangle centred on
/// `centre`: `width` along the unit axis `u` (the side facing its access),
/// `depth` along the unit axis `n` (from that side to the back). The parts are
/// those a town lot of that role, culture and shape would get (`monuments`
/// first, then the older forms of `landmark`), cleaned as the lot's are: valid
/// simple rings, never thinner than their structural minimum, never
/// overlapping, all inside the rectangle. None when no form builds that role
/// on that ground.
#[allow(clippy::too_many_arguments)]
pub(in crate::urban) fn parts(role: &str, culture: &str, centre: Point, u: Point, n: Point, width: f64, depth: f64, wealth: f64, seed: &str) -> Option<Vec<(Shape, &'static str)>> {
    if !(width.is_finite() && depth.is_finite()) || width < 4.0 || depth < 4.0 {
        return None;
    }
    let (s0, ta) = (dot(u, centre) - width * 0.5, dot(n, centre) - depth * 0.5);
    let (s1, t1) = (s0 + width, ta + depth);
    let frame = Frame { u, n, t0: ta };
    let at = |s: f64, t: f64| add(scale(u, s), scale(n, t));
    let mut rect = vec![at(s0, ta), at(s1, ta), at(s1, t1), at(s0, t1)];
    if ring_area(&rect) < 0.0 {
        rect.reverse();
    }
    // The monument families read the culture from the tissue id.
    let morph = Morph { value: serde_json::json!({ "id": format!("{culture}/village") }) };
    let o = Occupancy {
        morph: &morph,
        zone: "village",
        function: "collective",
        role,
        landmark: true,
        party_walls: false,
        wealth,
        seed,
        pack: super::super::culture::architecture_pack(culture).unwrap_or(""),
        court_lot: false,
        court_kept: None,
    };
    let mut rng = Rng::new(seed).fork("standalone");
    let laid = super::landmark::massing(&o, &rect, frame, (s0, s1, ta, t1), &mut rng)?;
    let mut out: Vec<(Shape, &'static str)> = vec![];
    for (outer, hole, label) in laid {
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
        let piece = Shape { outer, holes: hole.into_iter().collect() };
        if !valid(&piece, label) {
            continue;
        }
        let overlaps = out.iter().any(|(other, _)| intersection(other, &piece).iter().map(area).sum::<f64>() > 0.05);
        if !overlaps {
            out.push((piece, label));
        }
    }
    (!out.is_empty()).then_some(out)
}

/// A part a lot would keep (`occupation::finish`): a simple ring of at least
/// 4 m² (a home's light parts their own minimum), no needle corner, at least
/// as thick as its structural minimum.
fn valid(s: &Shape, label: &str) -> bool {
    use super::super::forms::plan;
    let light = plan::is_house_part(label) && label != "building" && plan::min_side(label) < 1.5;
    let minimum = match label {
        "building" | "range" => RANGE_M - 1e-6,
        _ if light => plan::min_side(label) - 1e-6,
        _ => 1.5,
    };
    // Walls and wheels are thin by nature; any other part keeps every corner at 20 degrees or more.
    let blunt = matches!(label, "wall" | "wheel")
        || (0..s.outer.len()).all(|i| {
            let k = s.outer.len();
            let (a, v, b) = (s.outer[(i + k - 1) % k], s.outer[i], s.outer[(i + 1) % k]);
            let (p, q) = (sub(a, v), sub(b, v));
            let (lp, lq) = (length(p), length(q));
            lp < 1.0 || lq < 1.0 || dot(p, q) / (lp * lq) <= 20.0_f64.to_radians().cos()
        });
    s.outer.len() >= 3
        && area(s) >= if light { minimum * minimum } else { 4.0 }
        && blunt
        && super::super::geometry::simple(s)
        && thickness(&s.outer, s.holes.first().map(|h| h.as_slice())) >= minimum
}

/// The ring without its repeated points (closer than 5 mm).
fn dedup(ring: Vec<Point>) -> Vec<Point> {
    let mut out: Vec<Point> = Vec::with_capacity(ring.len());
    for p in ring {
        if out.last().is_none_or(|q| length(sub(p, *q)) > 5e-3) {
            out.push(p);
        }
    }
    while out.len() > 1 && length(sub(out[0], out[out.len() - 1])) <= 5e-3 {
        out.pop();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A country chapel is a small church of its culture, a road inn a court
    /// of ranges: several labelled parts, inside the ground, never overlapping.
    #[test]
    fn a_free_standing_plot_takes_the_forms_of_a_town_lot() {
        let (u, n) = (Point { x: 0.6, y: 0.8 }, Point { x: -0.8, y: 0.6 });
        let centre = Point { x: 500.0, y: 400.0 };
        for (role, culture, w, d, label) in [
            ("worship.parish", "european-organic", 12.0, 26.0, "nave"),
            ("worship.monastery", "european-organic", 34.0, 38.0, "abbey-range"),
            ("commerce.inn", "european-organic", 30.0, 34.0, "stable-range"),
            ("worship.masjid", "medina", 16.0, 14.0, "prayer-hall"),
        ] {
            let parts = parts(role, culture, centre, u, n, w, d, 0.5, "standalone-test").unwrap_or_else(|| panic!("{role}: no form"));
            assert!(parts.len() >= 2 && parts.iter().any(|p| p.1 == label), "{role}: {:?}", parts.iter().map(|p| p.1).collect::<Vec<_>>());
            for (i, (shape, _)) in parts.iter().enumerate() {
                for p in &shape.outer {
                    let (s, t) = (dot(u, sub(*p, centre)), dot(n, sub(*p, centre)));
                    assert!(s.abs() <= w * 0.5 + 1e-6 && t.abs() <= d * 0.5 + 1e-6, "{role}: part {i} leaves its ground");
                }
                for (other, _) in &parts[i + 1..] {
                    assert!(intersection(shape, other).iter().map(area).sum::<f64>() < 0.05, "{role}: parts overlap");
                }
            }
        }
        // No form for a role nobody builds, nor on a ground too small for the role.
        assert!(parts("craft.activity", "european-organic", centre, u, n, 30.0, 30.0, 0.5, "x").is_none());
        assert!(parts("worship.parish", "european-organic", centre, u, n, 6.0, 8.0, 0.5, "x").is_none());
    }
}
