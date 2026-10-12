//! Certificates for shared finite Raw masks of feature roof sectors.
//! The feature domain stays authoritative; no approximate cut is reused.
use crate::model::{Point, Surface};
use num_rational::BigRational;
use num_traits::{Signed, Zero};
use std::cmp::Ordering;

type R = BigRational;
type V = [R; 2];

fn vector(p: Point) -> Result<V, String> {
    Ok([
        R::from_float(p.x).ok_or("Rayon de galerie non fini.")?,
        R::from_float(p.y).ok_or("Rayon de galerie non fini.")?,
    ])
}
fn sub(a: &V, b: &V) -> V {
    [&a[0] - &b[0], &a[1] - &b[1]]
}
fn cross(a: &V, b: &V) -> R {
    &a[0] * &b[1] - &a[1] * &b[0]
}
fn side(a: &V, b: &V, p: &V) -> R {
    cross(&sub(b, a), &sub(p, a))
}
fn angle(a: &V, b: &V) -> Ordering {
    let upper = |v: &V| v[1].is_positive() || (v[1].is_zero() && !v[0].is_negative());
    match upper(b).cmp(&upper(a)) {
        Ordering::Equal => R::zero().cmp(&cross(a, b)),
        order => order,
    }
}
fn area(ring: &[V]) -> R {
    if ring.len() < 3 {
        return R::zero();
    }
    ring.iter()
        .zip(ring.iter().cycle().skip(1))
        .take(ring.len())
        .map(|(a, b)| cross(&sub(a, &ring[0]), &sub(b, &ring[0])))
        .sum::<R>()
        / R::from_integer(2.into())
}
fn clipped(mut ring: Vec<V>, triangle: &[V; 3]) -> Vec<V> {
    for i in 0..3 {
        let a = &triangle[i];
        let b = &triangle[(i + 1) % 3];
        let mut out = vec![];
        for (p, q) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            let one = side(a, b, p);
            let two = side(a, b, q);
            if !one.is_negative() {
                out.push(p.clone());
            }
            if one.is_negative() != two.is_negative() {
                let t = &one / (&one - &two);
                let direction = sub(q, p);
                out.push([&p[0] + &t * &direction[0], &p[1] + &t * &direction[1]]);
            }
        }
        ring = out;
    }
    ring
}

/// Exact positive/empty areas after clipping the original rings to each mask.
/// A shared, convex fan with one angular turn covers the complete source.
pub(super) fn certify(surface: &Surface, origin: Point, rays: &[Point]) -> Result<Vec<R>, String> {
    if surface.len() != 1 || rays.len() < 8 {
        return Err("Galerie radiale sans domaine unique ou huit secteurs explicites.".into());
    }
    let origin = vector(origin)?;
    let rays: Vec<_> = rays.iter().copied().map(vector).collect::<Result<_, _>>()?;
    let directions: Vec<_> = rays.iter().map(|p| sub(p, &origin)).collect();
    let n = rays.len();
    let mut wraps = 0;
    for i in 0..n {
        let j = (i + 1) % n;
        if !cross(&directions[i], &directions[j]).is_positive()
            || !side(&rays[i], &rays[j], &rays[(i + 2) % n]).is_positive()
            || !side(&rays[i], &rays[j], &origin).is_positive()
        {
            return Err("Éventail Raw de galerie non strictement convexe et orienté.".into());
        }
        wraps += usize::from(angle(&directions[i], &directions[j]) == Ordering::Greater);
    }
    if wraps != 1 {
        return Err("Éventail Raw de galerie ne faisant pas un seul tour.".into());
    }
    let polygon = &surface[0];
    let rings: Vec<Vec<V>> = std::iter::once(&polygon.outer)
        .chain(&polygon.holes)
        .map(|r| r.iter().copied().map(vector).collect())
        .collect::<Result<_, _>>()?;
    for point in rings.iter().flatten() {
        if (0..n).any(|i| !side(&rays[i], &rays[(i + 1) % n], point).is_positive()) {
            return Err("Anneau de galerie hors confinement strict du masque Raw.".into());
        }
    }
    let mut areas = vec![];
    for i in 0..n {
        let triangle = [origin.clone(), rays[i].clone(), rays[(i + 1) % n].clone()];
        let value = rings
            .iter()
            .enumerate()
            .map(|(index, ring)| {
                let value = area(&clipped(ring.clone(), &triangle)).abs();
                if index == 0 { value } else { -value }
            })
            .sum::<R>();
        if value.is_negative() {
            return Err("Secteur de galerie avec aire exacte négative.".into());
        }
        areas.push(value);
    }
    let source = area(&rings[0]).abs() - rings.iter().skip(1).map(|r| area(r).abs()).sum::<R>();
    if areas.iter().cloned().sum::<R>() != source {
        return Err("Partition Raw de galerie ne conservant pas son aire exacte.".into());
    }
    Ok(areas)
}

pub(super) fn real_portion(exact: &R, approximate_area: f64) -> Result<bool, String> {
    if exact.is_zero() {
        return Ok(false);
    }
    if exact.is_negative() || !approximate_area.is_finite() || approximate_area <= 0.000_01 {
        return Err("Secteur de galerie positif perdu par la découpe approchée du repère.".into());
    }
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn source() -> (Surface, Point, Vec<Point>) {
        let fixture: serde_json::Value =
            serde_json::from_str(include_str!("../tests/fixtures/gallery32-source.json")).unwrap();
        (
            serde_json::from_value(fixture["surface"].clone()).unwrap(),
            serde_json::from_value(fixture["center"].clone()).unwrap(),
            serde_json::from_value(fixture["rays"].clone()).unwrap(),
        )
    }
    #[test]
    fn varied_tulou_raw_fan_preserves_all_32_positive_sectors() {
        let (surface, origin, rays) = source();
        let areas = certify(&surface, origin, &rays).unwrap();
        assert_eq!(areas.len(), 32);
        assert!(areas.iter().all(|area| area > &R::from_integer(4.into())));
        assert_eq!(surface[0].outer.len(), 128);
        assert_eq!(surface[0].holes[0].len(), 128);
    }
    #[test]
    fn duplicated_or_reordered_raw_rays_are_rejected() {
        let (surface, origin, mut rays) = source();
        rays[4] = rays[3];
        assert!(certify(&surface, origin, &rays).is_err());
        let (_, _, mut rays) = source();
        rays.swap(2, 3);
        assert!(certify(&surface, origin, &rays).is_err());
    }
    #[test]
    fn positive_local_turns_do_not_accept_a_three_turn_star() {
        let (surface, origin, rays) = source();
        let star: Vec<_> = (0..rays.len())
            .map(|i| rays[(i * 3) % rays.len()])
            .collect();
        assert!(
            certify(&surface, origin, &star)
                .unwrap_err()
                .contains("tour")
        );
    }
    #[test]
    fn source_vertex_on_or_beyond_fan_is_rejected() {
        let (mut surface, origin, rays) = source();
        surface[0].outer[0] = rays[0];
        assert!(certify(&surface, origin, &rays).is_err());
        surface[0].outer[0].x += 0.000_000_1;
        assert!(certify(&surface, origin, &rays).is_err());
    }
    #[test]
    fn disconnected_radial_source_is_rejected() {
        let (mut surface, origin, rays) = source();
        surface.push(surface[0].clone());
        assert!(certify(&surface, origin, &rays).is_err());
    }
    #[test]
    fn positive_sub_threshold_sector_cannot_be_silently_omitted() {
        let small = R::from_float(1e-30).unwrap();
        assert!(real_portion(&small, 1e-30).is_err());
        assert!(real_portion(&small, 0.0).is_err());
        assert!(!real_portion(&R::zero(), 0.0).unwrap());
        assert!(real_portion(&R::from_integer(1.into()), 1.0).unwrap());
    }
}
