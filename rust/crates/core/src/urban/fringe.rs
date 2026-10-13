//! Discontinuous outer frontage served directly by an open town's peripheral road.
use super::{Point, Quarter, Shape, Street, Surface, geometry as g, routing};
use crate::rng::Rng;

pub(super) fn frontages(
    quarters: &[Quarter],
    streets: &[Street],
    surface: Surface<'_>,
    depth: f64,
    grade: f64,
    rng: &mut Rng,
) -> Vec<(Shape, usize)> {
    let mut occupied = g::union(&quarters.iter().map(|q| q.shape.clone()).collect::<Vec<_>>());
    let mut budget = occupied.iter().map(g::area).sum::<f64>() * 0.08;
    let mut result = vec![];
    for street in streets.iter().filter(|s| s.role == "peripheral") {
        // Work in lengths along the road, independent of its curve tessellation.
        let mut chunks: Vec<Vec<Point>> = vec![];
        let mut chunk = vec![street.path[0]];
        let mut run = 0.0;
        for pair in street.path.windows(2) {
            let mut a = pair[0];
            let b = pair[1];
            loop {
                let length = (b.x - a.x).hypot(b.y - a.y);
                if run + length < 65.0 {
                    chunk.push(b);
                    run += length;
                    break;
                }
                let t = (65.0 - run) / length;
                let p = Point {
                    x: a.x + (b.x - a.x) * t,
                    y: a.y + (b.y - a.y) * t,
                };
                chunk.push(p);
                chunks.push(chunk);
                chunk = vec![p];
                run = 0.0;
                a = p;
            }
        }
        if run > 20.0 {
            chunks.push(chunk);
        }
        for (i, path) in chunks.into_iter().enumerate() {
            // Alternating sections guarantee gaps rather than another continuous belt.
            if i % 2 == 1 || budget < 150.0 {
                continue;
            }
            let width = street.widths.iter().copied().fold(0.0, f64::max);
            let depth = depth.clamp(14.0, 32.0).min(budget / 90.0);
            if depth < 6.0 {
                continue;
            }
            let bands = g::union(&g::ribbon(
                &path,
                &[width + 2.0 * depth * rng.range(0.75, 1.0)],
            ));
            let mut land = bands
                .into_iter()
                .flat_map(|s| g::dry_clip(&surface, &s))
                .collect::<Vec<_>>();
            for old in &occupied {
                land = land
                    .into_iter()
                    .flat_map(|s| g::difference(&s, old))
                    .collect();
            }
            for shape in land {
                let area = g::area(&shape);
                if area < 100.0
                    || area > budget
                    || !routing::path_clear(surface, &shape.outer, grade)
                {
                    continue;
                }
                let p = g::interior_point(&shape);
                let source = quarters
                    .iter()
                    .enumerate()
                    .min_by(|(_, a), (_, b)| {
                        let distance = |q: &Quarter| {
                            q.shape
                                .outer
                                .iter()
                                .map(|v| (v.x - p.x).hypot(v.y - p.y))
                                .fold(f64::INFINITY, f64::min)
                        };
                        distance(a).total_cmp(&distance(b))
                    })
                    .map(|(i, _)| i)
                    .unwrap_or(0);
                occupied.push(shape.clone());
                budget -= area;
                result.push((shape, source));
            }
        }
    }
    result
}
