use std::f64::consts::TAU;

use magna_urbis_geom::{Point, surface::TerrainView};

use super::{
    StrongPoint, SurveySpec,
    cost::access_grades,
    grid::{CARDINAL, Grid},
    in_terrain, offset,
};

pub(super) fn strong_points(
    grid: &Grid,
    terrain: &dyn TerrainView,
    spec: &SurveySpec,
) -> Vec<StrongPoint> {
    let mut elevations: Vec<_> = grid
        .cells
        .iter()
        .filter(|cell| !cell.closed)
        .map(|cell| cell.elevation)
        .collect();
    if elevations.is_empty() {
        return Vec::new();
    }
    let middle = elevations.len() / 2;
    let median = *elevations.select_nth_unstable_by(middle, f64::total_cmp).1;
    let mut peaks = Vec::new();
    for index in summit_cells(
        grid,
        median + spec.strong_point_min_rise,
        spec.strong_point_top_grade,
    ) {
        let cell = &grid.cells[index];
        let Some(ring) = ring_mean(terrain, grid.width, cell.position, spec.strong_point_radius)
        else {
            continue;
        };
        let prominence = cell.elevation - ring;
        if prominence >= spec.strong_point_min_prominence {
            let rise = cell.elevation - median;
            let score = rise + 1.5 * prominence;
            peaks.push((index, rise, prominence, score));
        }
    }
    if peaks.is_empty() {
        return Vec::new();
    }
    peaks.sort_unstable_by(|a, b| b.3.total_cmp(&a.3).then(a.0.cmp(&b.0)));

    let access = access_grades(grid, spec);
    let radius = spec.strong_point_radius * (2.0 / 3.0);
    let mut found: Vec<StrongPoint> = Vec::new();
    let mut visited = vec![usize::MAX; grid.cells.len()];
    for (index, rise, prominence, score) in peaks {
        let position = grid.cells[index].position;
        if !access[index].is_finite()
            || found
                .iter()
                .any(|peak| position.distance(peak.position) < radius)
        {
            continue;
        }
        let drop = (0.45 * rise).clamp(3.0, 14.0);
        let top_area = top_area(
            grid,
            index,
            radius,
            drop,
            spec.strong_point_top_grade,
            &mut visited,
        );
        if top_area >= spec.strong_point_min_top_area {
            found.push(StrongPoint {
                position,
                top_area,
                prominence,
                access_slope: access[index],
                score,
            });
        }
    }
    found
}

fn summit_cells(grid: &Grid, min_height: f64, top_grade: f64) -> Vec<usize> {
    const LEVEL: f64 = 1e-6;

    let mut seen = vec![false; grid.cells.len()];
    let mut peaks = Vec::new();
    let mut plateau = Vec::new();
    for cell in &grid.cells {
        let start = cell.index;
        if cell.closed || seen[start] || cell.elevation < min_height {
            continue;
        }
        plateau.clear();
        plateau.push(start);
        seen[start] = true;
        let mut summit = true;
        let mut cursor = 0;
        while cursor < plateau.len() {
            let current = plateau[cursor];
            cursor += 1;
            for (next, _) in grid.neighbours(current) {
                let other = &grid.cells[next];
                if other.bank_id != cell.bank_id || !other.elevation.is_finite() {
                    continue;
                }
                let rise = other.elevation - cell.elevation;
                summit &= rise <= LEVEL;
                if rise.abs() <= LEVEL && !seen[next] {
                    seen[next] = true;
                    plateau.push(next);
                }
            }
        }
        if !summit {
            continue;
        }
        let center = plateau.iter().fold(Point::default(), |sum, &i| {
            let p = grid.cells[i].position;
            offset(sum, p.x, p.y)
        });
        let center = Point {
            x: center.x / plateau.len() as f64,
            y: center.y / plateau.len() as f64,
        };
        if let Some(index) = plateau
            .iter()
            .copied()
            .filter(|&i| !grid.cells[i].closed && grid.cells[i].slope <= top_grade)
            .min_by(|&a, &b| {
                grid.cells[a]
                    .position
                    .distance(center)
                    .total_cmp(&grid.cells[b].position.distance(center))
                    .then(a.cmp(&b))
            })
        {
            peaks.push(index);
        }
    }
    peaks
}

fn ring_mean(terrain: &dyn TerrainView, width: f64, center: Point, radius: f64) -> Option<f64> {
    const SAMPLES: i32 = 12;
    let mut sum = 0.0;
    for k in 0..SAMPLES {
        let angle = f64::from(k) * TAU / f64::from(SAMPLES);
        let p = offset(center, radius * angle.cos(), radius * angle.sin());
        if !in_terrain(p, width) {
            return None;
        }
        let height = terrain.height_at(p);
        if !height.is_finite() {
            return None;
        }
        sum += height;
    }
    Some(sum / f64::from(SAMPLES))
}

fn top_area(
    grid: &Grid,
    peak: usize,
    radius: f64,
    drop: f64,
    top_grade: f64,
    visited: &mut [usize],
) -> f64 {
    let summit = &grid.cells[peak];
    let mut top = vec![peak];
    visited[peak] = peak;
    let mut cursor = 0;
    while cursor < top.len() {
        let index = top[cursor];
        cursor += 1;
        for (dx, dy) in CARDINAL {
            let Some(next) = grid.neighbour(index, dx, dy) else {
                continue;
            };
            let cell = &grid.cells[next];
            if visited[next] != peak
                && !cell.closed
                && cell.slope <= top_grade
                && cell.elevation >= summit.elevation - drop
                && cell.position.distance(summit.position) <= radius
            {
                visited[next] = peak;
                top.push(next);
            }
        }
    }
    top.len() as f64 * grid.step * grid.step
}
