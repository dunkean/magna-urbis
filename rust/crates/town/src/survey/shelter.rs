use std::{collections::VecDeque, f64::consts::TAU};

use magna_urbis_geom::{Point, surface::TerrainView};

use super::{grid::CARDINAL, in_terrain, interpolate, offset};

const FETCH_LIMIT: f64 = 600.0;
const FETCH_STEP: f64 = 4.0;
const DIRECTIONS: usize = 32;
const APPROACH: f64 = 220.0;

struct Exposure {
    mean: f64,
    clearance: f64,
    sheltered: bool,
}

pub(super) fn score(terrain: &dyn TerrainView, path: &[Point], length: f64) -> Option<(f64, bool)> {
    let mut exposure: f64 = 0.0;
    let mut clearance: f64 = 60.0;
    let mut sheltered = true;
    for fraction in [0.25, 0.5, 0.75] {
        let (p, out) = seaward_at(path, fraction * length)?;
        let sample = sample_water(terrain, p, out)?;
        exposure = exposure.max(sample.mean);
        clearance = clearance.min(sample.clearance);
        sheltered &= sample.sheltered;
    }
    // Shoal clearance favours manoeuvring room. Lower fetch favours shelter.
    Some((clearance / FETCH_LIMIT - exposure, sheltered))
}

fn seaward_at(path: &[Point], mut station: f64) -> Option<(Point, Point)> {
    for segment in path.windows(2) {
        let (a, b) = (segment[0], segment[1]);
        let length = a.distance(b);
        if length > 0.0 && station <= length {
            let p = interpolate(a, b, station / length);
            let out = Point {
                x: (b.y - a.y) / length,
                y: (a.x - b.x) / length,
            };
            return Some((p, out));
        }
        station -= length;
    }
    None
}

fn sample_water(terrain: &dyn TerrainView, p: Point, out: Point) -> Option<Exposure> {
    let width = terrain.width();
    let water = |q| in_terrain(q, width) && terrain.wet(q);
    let along = |d| offset(p, out.x * d, out.y * d);
    let first = (1..=8).find(|&d| water(along(f64::from(d))))?;
    let probe = [16, 12, 8, 6, 4].into_iter().find_map(|d| {
        let q = along(f64::from(first + d));
        ((first..=first + d).all(|k| water(along(f64::from(k))))
            && (0..8).all(|i| {
                let angle = TAU * f64::from(i) / 8.0;
                water(offset(q, 4.0 * angle.cos(), 4.0 * angle.sin()))
            }))
        .then_some(q)
    })?;

    let mut total = 0.0;
    let mut longest: f64 = 0.0;
    let mut nearest: f64 = 60.0;
    let mut open = 0;
    for direction in 0..DIRECTIONS {
        let angle = TAU * direction as f64 / DIRECTIONS as f64;
        let (y, x) = angle.sin_cos();
        let mut fetch = 0.0;
        while fetch < FETCH_LIMIT {
            let d = fetch + FETCH_STEP;
            let q = offset(probe, x * d, y * d);
            if !in_terrain(q, width) {
                // A cropped map edge cannot act as a headland.
                fetch = FETCH_LIMIT;
                break;
            }
            if !terrain.wet(q) {
                break;
            }
            fetch = d;
        }
        if fetch >= FETCH_LIMIT - FETCH_STEP {
            open += 1;
        }
        total += fetch;
        longest = longest.max(fetch);
        nearest = nearest.min(fetch);
    }

    // A winding approach can reach more navigable water even when every ray
    // meets a bank. Small enclosed ponds fail both tests.
    if longest < APPROACH && !has_approach(terrain, probe, width) {
        return None;
    }
    let mean = total / (DIRECTIONS as f64 * FETCH_LIMIT);
    Some(Exposure {
        mean,
        clearance: nearest,
        sheltered: open <= 7 && mean < 0.36,
    })
}

fn has_approach(terrain: &dyn TerrainView, start: Point, width: f64) -> bool {
    const STEP: f64 = 6.0;
    let radius = (APPROACH / STEP).ceil() as isize;
    let side = 2 * radius + 1;
    let index = |x: isize, y: isize| ((y + radius) * side + x + radius) as usize;
    let point = |x: isize, y: isize| offset(start, x as f64 * STEP, y as f64 * STEP);
    let mut seen = vec![false; (side * side) as usize];
    seen[index(0, 0)] = true;
    let mut queue = VecDeque::from([(0, 0)]);
    while let Some((x, y)) = queue.pop_front() {
        let p = point(x, y);
        if p.distance(start) >= APPROACH {
            return true;
        }
        for (dx, dy) in CARDINAL {
            let (nx, ny) = (x + dx, y + dy);
            if nx.abs() > radius || ny.abs() > radius {
                continue;
            }
            let i = index(nx, ny);
            if seen[i] {
                continue;
            }
            let q = point(nx, ny);
            if in_terrain(q, width)
                && [1.0 / 3.0, 2.0 / 3.0, 1.0]
                    .into_iter()
                    .all(|t| terrain.wet(interpolate(p, q, t)))
            {
                seen[i] = true;
                queue.push_back((nx, ny));
            }
        }
    }
    false
}
