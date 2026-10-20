use crate::geometry as g;
use crate::model::{Point, Surface};
const EPS: f64 = 1.0e-8;

/// Finite analytic segment intersections avoid snapping a thin clipping strip.
pub(super) fn line_intervals(a: Point, b: Point, domain: &Surface) -> Vec<(f64, f64)> {
    use geo::{Contains, Intersects};
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let mut ts = vec![0.0, 1.0];
    for ring in domain
        .iter()
        .flat_map(|p| std::iter::once(&p.outer).chain(&p.holes))
    {
        for (p, q) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            let ex = q.x - p.x;
            let ey = q.y - p.y;
            let den = dx * ey - dy * ex;
            if den.abs() > EPS {
                let px = p.x - a.x;
                let py = p.y - a.y;
                let t = (px * ey - py * ex) / den;
                let u = (px * dy - py * dx) / den;
                if (-EPS..=1.0 + EPS).contains(&t) && (-EPS..=1.0 + EPS).contains(&u) {
                    ts.push(t.clamp(0.0, 1.0));
                }
            } else if (dx * (p.y - a.y) - dy * (p.x - a.x)).abs() < 1e-7 {
                let den = dx * dx + dy * dy;
                ts.extend(
                    [
                        ((p.x - a.x) * dx + (p.y - a.y) * dy) / den,
                        ((q.x - a.x) * dx + (q.y - a.y) * dy) / den,
                    ]
                    .into_iter()
                    .filter(|t| (-EPS..=1.0 + EPS).contains(t))
                    .map(|t| t.clamp(0.0, 1.0)),
                );
            }
        }
    }
    ts.sort_by(f64::total_cmp);
    ts.dedup_by(|a, b| (*a - *b).abs() < EPS);
    let geometry = g::to_geo(domain);
    ts.windows(2)
        .filter(|p| p[1] - p[0] > EPS)
        .filter_map(|p| {
            let t = (p[0] + p[1]) * 0.5;
            let midpoint = geo::Point::new(a.x + dx * t, a.y + dy * t);
            (geometry.contains(&midpoint) || geometry.intersects(&midpoint)).then_some((p[0], p[1]))
        })
        .collect()
}
