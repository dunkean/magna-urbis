//! Discontinuous outer frontage served directly by an open town's peripheral road.
use super::{Point, Quarter, Shape, Street, Surface, geometry as g, routing};
use crate::rng::Rng;

/// The 65 m sections of every peripheral road, in road order: (street,
/// index along its road, path). Lengths are measured along the road,
/// independent of its curve tessellation.
fn sections(streets: &[Street]) -> Vec<(usize, usize, Vec<Point>)> {
    let mut out = vec![];
    for (si, street) in streets.iter().enumerate().filter(|(_, s)| s.role == "peripheral") {
        let mut chunks: Vec<Vec<Point>> = vec![];
        let mut chunk = vec![street.path[0]];
        let mut run = 0.0;
        for pair in street.path.windows(2) {
            let mut a = pair[0];
            let b = pair[1];
            for _ in 0..4096 {
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
                if p == a { break; }
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
        out.extend(chunks.into_iter().enumerate().map(|(i, path)| (si, i, path)));
    }
    out
}

pub(super) fn frontages(
    quarters: &[Quarter],
    streets: &[Street],
    surface: Surface<'_>,
    depth: f64,
    grade: f64,
    rng: &mut Rng,
) -> Vec<(Shape, usize)> {
    let town = g::union(&quarters.iter().map(|q| q.shape.clone()).collect::<Vec<_>>());
    let mut budget = town.iter().map(g::area).sum::<f64>() * 0.08;
    // Frontage laid so far: a later band is cut by the town, then by these.
    let mut occupied: Vec<Shape> = vec![];
    let mut result = vec![];
    // The band of a section, clipped dry and cut by the town's land.
    let band = |path: &[Point], width: f64| -> Vec<Shape> {
        let mut land = g::union(&g::ribbon(path, &[width]))
            .into_iter()
            .flat_map(|s| g::dry_clip(&surface, &s))
            .collect::<Vec<_>>();
        for old in &town {
            land = land
                .into_iter()
                .flat_map(|s| g::difference(&s, old))
                .collect();
        }
        land
    };
    let sections = sections(streets);
    // Speculation, in parallel: every even section at the full depth, with
    // the draws taken in order. A band is used below only when the depth and
    // draw it really gets are those (the budget has not run short and no
    // section was skipped before it); otherwise it is cut there.
    let full = depth.clamp(14.0, 32.0);
    let mut ahead = rng.clone();
    let guesses: Vec<(usize, f64)> = sections
        .iter()
        .enumerate()
        .filter(|(_, s)| s.1 % 2 == 0)
        .map(|(n, _)| (n, ahead.range(0.75, 1.0)))
        .collect();
    let mut cut: Vec<Option<Vec<Shape>>> = super::par::map(&guesses, |_, &(n, draw)| {
        let (street, _, path) = &sections[n];
        let width = streets[*street].widths.iter().copied().fold(0.0, f64::max);
        Some(band(path, width + 2.0 * full * draw))
    });
    let mut guess = 0;
    for (n, (street, i, path)) in sections.iter().enumerate() {
        let street = &streets[*street];
        let speculated = guesses.get(guess).filter(|g| g.0 == n).map(|g| (g.1, guess));
        if speculated.is_some() {
            guess += 1;
        }
        // Alternating sections guarantee gaps rather than another continuous belt.
        if i % 2 == 1 || budget < 150.0 {
            continue;
        }
        let width = street.widths.iter().copied().fold(0.0, f64::max);
        let depth = depth.clamp(14.0, 32.0).min(budget / 90.0);
        if depth < 6.0 {
            continue;
        }
        let draw = rng.range(0.75, 1.0);
        let mut land = match speculated {
            Some((d, k)) if d.to_bits() == draw.to_bits() && depth.to_bits() == full.to_bits() => {
                cut[k].take().expect("speculated band")
            }
            _ => band(path, width + 2.0 * depth * draw),
        };
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
    result
}
