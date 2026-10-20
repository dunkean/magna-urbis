//! Interior roof apertures preserve their current contours and native K order.
use super::*;
use geo::{Contains, Intersects, LineString};

pub(super) fn collective(unit: &HouseUnit) -> bool {
    unit.bodies
        .iter()
        .any(|b| b.cells.iter().any(|c| c.household_id.is_some()))
        && unit
            .rooms
            .iter()
            .filter_map(|r| r.household_id.as_ref())
            .collect::<BTreeSet<_>>()
            .len()
            >= 2
}

fn line(r: &[Point]) -> LineString<f64> {
    LineString::from(
        r.iter()
            .chain(r.first())
            .map(|p| (p.x, p.y))
            .collect::<Vec<_>>(),
    )
}

fn canonical(r: &[Point]) -> Vec<Point> {
    crate::geometry::canonical_ring(&line(r), false)
}

fn bits_equal(a: &[Point], b: &[Point]) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b)
            .all(|(a, b)| a.x.to_bits() == b.x.to_bits() && a.y.to_bits() == b.y.to_bits())
}

fn simple(r: &[Point]) -> bool {
    if r.len() < 3
        || r.iter().any(|p| !p.x.is_finite() || !p.y.is_finite())
        || !signed_area(r).is_finite()
        || signed_area(r) == 0.0
    {
        return false;
    }
    for i in 0..r.len() {
        if r[i] == r[(i + 1) % r.len()] {
            return false;
        }
        let a = LineString::from(vec![
            (r[i].x, r[i].y),
            (r[(i + 1) % r.len()].x, r[(i + 1) % r.len()].y),
        ]);
        for j in i + 1..r.len() {
            if j == i + 1 || (i == 0 && j == r.len() - 1) {
                continue;
            }
            let b = LineString::from(vec![
                (r[j].x, r[j].y),
                (r[(j + 1) % r.len()].x, r[(j + 1) % r.len()].y),
            ]);
            if a.intersects(&b) {
                return false;
            }
        }
    }
    true
}

fn ring_surface(r: &[Point]) -> Surface {
    vec![Polygon {
        outer: r.to_vec(),
        holes: vec![],
    }]
}

fn closed_overlap(a: &[Point], b: &[Point]) -> bool {
    to_geo(&ring_surface(a)).intersects(&to_geo(&ring_surface(b)))
}

fn strict_inside(r: &[Point], p: &Polygon) -> bool {
    simple(r)
        && simple(&p.outer)
        && to_geo(&ring_surface(&p.outer)).contains(&to_geo(&ring_surface(r)))
        && !line(r).intersects(&line(&p.outer))
        && p.holes.iter().all(|old| !closed_overlap(r, old))
}

fn sort_holes(p: &mut Polygon) {
    p.holes
        .sort_by(|a, b| a[0].x.total_cmp(&b[0].x).then(a[0].y.total_cmp(&b[0].y)));
}

/// Only the true offset quadrilateral is inserted; all other cuts retain
/// the complete existing boolean operation and its ordering.
pub(super) fn cut(surface: &Surface, aperture: &Surface) -> Surface {
    if aperture.len() != 1
        || !aperture[0].holes.is_empty()
        || aperture[0].outer.len() != 4
        || !simple(&aperture[0].outer)
    {
        return difference(surface, aperture);
    }
    let r = canonical(&aperture[0].outer);
    if r.len() != 4 {
        return difference(surface, aperture);
    }
    let existing: Vec<_> = surface
        .iter()
        .enumerate()
        .filter(|(_, p)| p.holes.iter().any(|old| bits_equal(old, &r)))
        .map(|(i, _)| i)
        .collect();
    if existing.len() == 1
        && surface.iter().enumerate().all(|(i, p)| {
            i == existing[0] || !to_geo(&ring_surface(&r)).intersects(&to_geo(&vec![p.clone()]))
        })
    {
        return surface.clone();
    }
    if !to_geo(surface).intersects(&to_geo(aperture)) {
        return surface.clone();
    }
    let owners: Vec<_> = surface
        .iter()
        .enumerate()
        .filter(|(_, p)| strict_inside(&r, p))
        .map(|(i, _)| i)
        .collect();
    if owners.len() != 1
        || surface
            .iter()
            .enumerate()
            .any(|(i, p)| i != owners[0] && to_geo(aperture).intersects(&to_geo(&vec![p.clone()])))
    {
        return difference(surface, aperture);
    }
    let mut result = surface.clone();
    result[owners[0]].holes.push(r);
    sort_holes(&mut result[owners[0]]);
    result
}

/// The operands are the CURRENT native slab surfaces, in Body/Level order.
/// Rejected holes remain operands; failed assignment abandons the full attempt.
pub(super) fn conservative_union(sources: &[Surface]) -> Surface {
    let polygons: Vec<_> = sources.iter().flat_map(|s| s.iter()).collect();
    let holes: Vec<_> = polygons
        .iter()
        .enumerate()
        .flat_map(|(i, p)| p.holes.iter().enumerate().map(move |(j, h)| (i, j, h)))
        .collect();
    let eligible: Vec<_> = holes
        .iter()
        .filter(|(i, j, h)| {
            simple(h)
                && bits_equal(h, &canonical(h))
                && strict_inside(
                    h,
                    &Polygon {
                        outer: polygons[*i].outer.clone(),
                        holes: vec![],
                    },
                )
                && holes
                    .iter()
                    .all(|(oi, oj, other)| (*oi == *i && *oj == *j) || !closed_overlap(h, other))
                && polygons.iter().enumerate().all(|(oi, other)| {
                    oi == *i
                        || !to_geo(&ring_surface(h)).intersects(&to_geo(&vec![(*other).clone()]))
                })
        })
        .copied()
        .collect();
    if eligible.is_empty() {
        return unite(sources);
    }
    let mut operands = sources.to_vec();
    let mut pi = 0;
    for surface in &mut operands {
        for p in surface {
            let mut hi = 0;
            p.holes.retain(|_| {
                let keep = !eligible.iter().any(|(i, j, _)| *i == pi && *j == hi);
                hi += 1;
                keep
            });
            pi += 1;
        }
    }
    let mut native = unite(&operands);
    let mut assigned = vec![];
    for (_, _, h) in &eligible {
        let owners: Vec<_> = native
            .iter()
            .enumerate()
            .filter(|(_, p)| strict_inside(h, p))
            .map(|(i, _)| i)
            .collect();
        if owners.len() != 1 {
            return unite(sources);
        }
        assigned.push((owners[0], *h));
    }
    for (owner, h) in assigned {
        native[owner].holes.push(h.clone());
    }
    for p in &mut native {
        sort_holes(p);
    }
    native
}

pub(super) fn walk_surface(unit: &HouseUnit, z: i64) -> Result<Surface, String> {
    let mut sources = vec![];
    for body in &unit.bodies {
        for level in &body.levels {
            if let Some(slab) = &level.roof_slab
                && slab.walkable
            {
                if !slab.z_m.is_finite() {
                    return Err("Composante de toiture sans cote finie.".into());
                }
                if libm::round(slab.z_m * 1000.0) as i64 == z {
                    sources.push(slab.surface.clone());
                }
            }
        }
    }
    Ok(if collective(unit) {
        conservative_union(&sources)
    } else {
        unite(&sources)
    })
}

#[cfg(test)]
#[path = "roof_apertures_tests.rs"]
mod tests;

#[cfg(test)]
pub(super) fn capture_before_routes(unit: &HouseUnit) {
    tests::capture_before_routes(unit);
}
