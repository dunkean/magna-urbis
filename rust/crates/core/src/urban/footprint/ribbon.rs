//! Road-aligned ribbon foundations and validated circulation within their dry land.
use super::archetypes::template;
use super::geometry::{area, at, distance, dry, subtract, union};
use super::lattice::{Grid, ShoreField};
use crate::urban::{
    LayoutConfig, Point, Shape, Street, Surface, UrbanCenter, geometry as g, macroplan, routing,
};
use geo::{Relate, Validation};

/// Retain only the existing ribbon foundation's own internal axis. This is
/// circulation inside attributed dry land, never a regional connection.
pub(super) fn internal_ribbon_guides(
    axes: &[Street], domains: &[Shape], surface: Surface<'_>, cfg: &LayoutConfig,
) -> Vec<Street> {
    let mut accepted = vec![];
    for domain in domains {
        if !domain.outer.iter().chain(domain.holes.iter().flatten())
            .all(|p| p.x.is_finite() && p.y.is_finite()) { continue; }
        let polygon = g::polygon(domain);
        if !polygon.is_valid() { continue; }
        // The full stroke must also be covered by the actual dry map clipping,
        // not merely have dry endpoints or pass an area-tolerance subtraction.
        let dry = geo::MultiPolygon(g::dry_clip(&surface, domain).iter().map(g::polygon).collect());
        if dry.0.is_empty() || !dry.is_valid() { continue; }
        let mut planner = routing::RoutePlanner::new(surface, g::bbox(domain));
        planner.set_adaptation(cfg.site_adaptation);
        for axis in axes {
            for clipped in macroplan::clip(axis, domain) {
                // ribbon()'s fallback is a straight, constant-width axis.
                // Unknown/variable-width paths are not silently simplified.
                if clipped.path.len() != 2 || clipped.widths.len() != 2 { continue; }
                let width = clipped.widths[0];
                if !width.is_finite() || width <= 0.0 || clipped.widths[1] != width { continue; }
                let (a, b) = (clipped.path[0], clipped.path[1]);
                let length = distance(a, b);
                if !length.is_finite() || length <= width { continue; }
                // Flat caps sit inside the domain by their physical half-width.
                let inset = width * 0.5 / length;
                let start = Point { x:a.x+(b.x-a.x)*inset, y:a.y+(b.y-a.y)*inset };
                let end = Point { x:b.x+(a.x-b.x)*inset, y:b.y+(a.y-b.y)*inset };
                let Some(path) = planner.route_within(start, end, cfg.max_street_grade, domain) else { continue; };
                if !routing::path_clear(surface, &path, cfg.max_street_grade) { continue; }
                let widths = vec![width; path.len()];
                let stroke = g::ribbon(&path, &widths);
                if stroke.is_empty() || !stroke.iter().all(|s| {
                    let p = g::polygon(s);
                    if !p.is_valid() || !p.relate(&polygon).is_coveredby() || !p.relate(&dry).is_coveredby() { return false; }
                    std::iter::once(&s.outer).chain(&s.holes).all(|ring| {
                        let mut closed = ring.clone();
                        if let Some(&first) = closed.first() { closed.push(first); }
                        routing::path_clear(surface, &closed, cfg.max_street_grade)
                    })
                }) { continue; }
                accepted.push(Street { path, widths, rank:clipped.rank, role:clipped.role });
            }
        }
    }
    accepted
}

#[allow(clippy::too_many_arguments)]
pub(super) fn ribbon(
    target: f64,
    cfg: &LayoutConfig,
    centers: &[UrbanCenter],
    radius: f64,
    angle: f64,
    fractions: &[f64],
    surface: Surface<'_>,
    roads: &[Street],
    water_affinity: f64,
) -> (Vec<Shape>, Vec<Vec<Shape>>, Vec<Street>) {
    let c = centers[0].point;
    let rx = radius * cfg.footprint.aspect.max(3.0).sqrt() * 1.55;
    let ry = radius / cfg.footprint.aspect.max(3.0).sqrt() * 1.35;
    let reserve = template(c, "rectangle", (rx * ry).sqrt(), rx / ry, angle, 0.0, 0.0);
    let bounds = g::bbox(&reserve);
    let step = (surface.width / surface.height_resolution() as f64)
        .max(((bounds.2 - bounds.0).max(bounds.3 - bounds.1) + radius * 4.0) / 160.0);
    let grid = Grid {
        x0: (bounds.0 - radius * 2.0).max(0.0),
        y0: (bounds.1 - radius * 2.0).max(0.0),
        step,
        nx: (((bounds.2 + radius * 2.0).min(surface.width) - (bounds.0 - radius * 2.0).max(0.0))
            / step)
            .floor() as usize
            + 1,
        ny: (((bounds.3 + radius * 2.0).min(surface.width) - (bounds.1 - radius * 2.0).max(0.0))
            / step)
            .floor() as usize
            + 1,
    };
    let shore = ShoreField::new(&grid, surface, macroplan::harbour::port_town(cfg));
    let paths: Vec<_> = roads
        .iter()
        .flat_map(|s| macroplan::clip(s, &reserve))
        .filter(|s| {
            s.path
                .windows(2)
                .any(|w| g::distance(c, w[0], w[1]).0 < radius * 0.65)
        })
        .collect();
    let fallback = paths.is_empty();
    let paths = if fallback {
        vec![Street {
            path: vec![
                at(
                    c,
                    Point {
                        x: -rx * 0.95,
                        y: 0.0,
                    },
                    angle,
                ),
                at(
                    c,
                    Point {
                        x: rx * 0.95,
                        y: 0.0,
                    },
                    angle,
                ),
            ],
            widths: vec![5.0; 2],
            rank: 1,
            role: "street".into(),
        }]
    } else {
        paths
    };
    let make = |width: f64| {
        union(
            &paths
                .iter()
                .flat_map(|s| {
                    let widths: Vec<_> = s
                        .path
                        .iter()
                        .map(|&p| width * (0.38 + 0.62 * (-distance(p, c) / radius.max(1.0)).exp()))
                        .collect();
                    let biased: Vec<_> = s
                        .path
                        .iter()
                        .zip(&widths)
                        .map(|(&p, &w)| {
                            let cell = grid.nearest(p);
                            let source = shore.sources[cell];
                            if source == usize::MAX || shore.distances[cell] > radius * 2.5 {
                                return p;
                            }
                            let q = grid.point(source);
                            let d = distance(p, q).max(1.0);
                            let shift = w * (0.08 + water_affinity * 0.25).min(0.25);
                            Point {
                                x: p.x + (q.x - p.x) / d * shift,
                                y: p.y + (q.y - p.y) / d * shift,
                            }
                        })
                        .collect();
                    g::ribbon(&biased, &widths)
                })
                .flat_map(|s| g::intersection(&s, &reserve))
                .collect::<Vec<_>>(),
        )
    };
    let (mut lo, mut hi) = (1.0, ry * 2.0);
    for _ in 0..12 {
        let mid = (lo + hi) * 0.5;
        if area(&make(mid)) < target {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    let width = (lo + hi) * 0.5;
    let mut previous: Vec<Shape> = vec![];
    let mut phases = vec![];
    for &fraction in fractions {
        let grown = union(&[previous.clone(), dry(surface, &make(width * fraction))].concat());
        phases.push(subtract(&grown, &previous));
        previous = grown;
    }
    (vec![reserve], phases, if fallback { paths } else { vec![] })
}
