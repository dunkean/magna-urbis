use std::collections::VecDeque;

use magna_urbis_geom::{ContainmentIndex, Point, Shape, surface::TerrainView};

use super::{SurveyCell, SurveySpec, in_terrain, interpolate, offset};

pub(super) const CARDINAL: [(isize, isize); 4] = [(1, 0), (0, 1), (-1, 0), (0, -1)];
pub(super) const DIAGONAL: [(isize, isize); 4] = [(1, 1), (-1, 1), (-1, -1), (1, -1)];

pub(super) struct Grid {
    pub(super) cells: Vec<SurveyCell>,
    pub(super) center: Point,
    pub(super) step: f64,
    pub(super) columns: usize,
    pub(super) rows: usize,
    pub(super) width: f64,
    first: Point,
    reach: f64,
    radius: Option<f64>,
    claims: Vec<ContainmentIndex>,
}

impl Grid {
    pub(super) fn sample(
        terrain: &dyn TerrainView,
        center: Point,
        reach: f64,
        radius: Option<f64>,
        claims: &[Shape],
        spec: &SurveySpec,
    ) -> Result<Self, String> {
        let width = terrain.width();
        if !width.is_finite() || !in_terrain(center, width) {
            return Err("Survey centre is outside the terrain".into());
        }
        if !nonnegative(reach) || radius.is_some_and(|r| !nonnegative(r)) {
            return Err("Invalid survey reach or imposed radius".into());
        }
        if !valid_spec(spec) {
            return Err("Invalid survey specification".into());
        }

        // Place a sample exactly at the requested centre, even on a cropped map.
        let step = spec.cell_size;
        let half = (reach / step).floor();
        let axis = |c: f64| {
            let before = half.min((c / step).floor());
            let after = half.min((((width - c) / step).ceil() - 1.0).max(0.0));
            (before, (before + after + 1.0) as usize)
        };
        let (x, columns) = axis(center.x);
        let (y, rows) = axis(center.y);
        let first = offset(center, -x * step, -y * step);
        let count = columns
            .checked_mul(rows)
            .ok_or("Survey grid is too large")?;
        let mut cells = Vec::new();
        cells
            .try_reserve_exact(count)
            .map_err(|_| "Survey grid is too large")?;
        let mut grid = Self {
            cells,
            center,
            step,
            columns,
            rows,
            width,
            first,
            reach,
            radius,
            claims: claims.iter().map(ContainmentIndex::new).collect(),
        };
        for index in 0..count {
            let p = offset(
                center,
                ((index % columns) as f64 - x) * step,
                ((index / columns) as f64 - y) * step,
            );
            let surveyed = grid.in_extent(p);
            let restricted = !surveyed || grid.restricted(p);
            let (mut wet, mut water_code, mut navigable) = (false, 0, false);
            let (mut elevation, mut gradient, mut slope) = (0.0, (0.0, 0.0), 0.0);
            let mut cliff = false;
            if surveyed {
                wet = terrain.wet(p);
                if wet {
                    water_code = terrain.water_code(p);
                    // Sea and lake codes identify navigable bodies. A channel
                    // or an unclassified wet run still has to be wide enough.
                    navigable = matches!(water_code, 1 | 2)
                        || wide_water(terrain, width, p, spec.navigable_width);
                }
                elevation = terrain.height_at(p);
                gradient = slope_at(terrain, width, p, (step * 0.5).min(width * 0.25), elevation);
                slope = gradient.0.hypot(gradient.1);
                cliff = !elevation.is_finite() || !slope.is_finite() || slope > spec.cliff_limit;
            }
            grid.cells.push(SurveyCell {
                index,
                position: p,
                elevation,
                gradient,
                slope,
                cliff,
                slope_break: false,
                crest: false,
                wet,
                water_code,
                navigable,
                bank_id: None,
                closed: restricted || wet || cliff,
                surveyed,
                restricted,
            });
        }
        grid.mark_relief(spec.slope_break);
        grid.mark_banks();
        Ok(grid)
    }

    fn in_extent(&self, p: Point) -> bool {
        in_terrain(p, self.width) && p.distance(self.center) <= self.reach
    }

    pub(super) fn restricted(&self, p: Point) -> bool {
        self.radius.is_some_and(|r| p.distance(self.center) > r)
            || self.claims.iter().any(|claim| claim.contains(p))
    }

    pub(super) fn index_at(&self, p: Point) -> Option<usize> {
        if !self.in_extent(p) {
            return None;
        }
        let x = ((p.x - self.first.x) / self.step + 0.5).floor();
        let y = ((p.y - self.first.y) / self.step + 0.5).floor();
        if x < 0.0 || y < 0.0 || x >= self.columns as f64 || y >= self.rows as f64 {
            return None;
        }
        let index = y as usize * self.columns + x as usize;
        self.cells[index].surveyed.then_some(index)
    }

    pub(super) fn open_at(&self, p: Point) -> Option<usize> {
        self.path_cell(p).filter(|&index| !self.cells[index].closed)
    }

    pub(super) fn path_cell(&self, p: Point) -> Option<usize> {
        self.index_at(p).filter(|_| !self.restricted(p))
    }

    pub(super) fn neighbour(&self, index: usize, dx: isize, dy: isize) -> Option<usize> {
        let x = (index % self.columns).checked_add_signed(dx)?;
        let y = (index / self.columns).checked_add_signed(dy)?;
        if x < self.columns && y < self.rows {
            let next = y * self.columns + x;
            return self.cells[next].surveyed.then_some(next);
        }
        None
    }

    pub(super) fn neighbours(&self, index: usize) -> impl Iterator<Item = (usize, f64)> + '_ {
        CARDINAL
            .into_iter()
            .chain(DIAGONAL)
            .filter_map(move |(dx, dy)| {
                let next = self.neighbour(index, dx, dy)?;
                let length = if dx != 0 && dy != 0 {
                    self.step * std::f64::consts::SQRT_2
                } else {
                    self.step
                };
                Some((next, length))
            })
    }

    /// Both sides of a diagonal must be passable so it cannot cut a corner.
    pub(super) fn connects(
        &self,
        a: usize,
        b: usize,
        allows: impl Fn(&SurveyCell) -> bool,
    ) -> bool {
        if !allows(&self.cells[a]) || !allows(&self.cells[b]) {
            return false;
        }
        let (ax, ay) = (a % self.columns, a / self.columns);
        let (bx, by) = (b % self.columns, b / self.columns);
        ax.abs_diff(bx) <= 1
            && ay.abs_diff(by) <= 1
            && (ax == bx
                || ay == by
                || allows(&self.cells[ay * self.columns + bx])
                    && allows(&self.cells[by * self.columns + ax]))
    }

    pub(super) fn clip_segment(&self, a: Point, b: Point) -> Option<(Point, Point)> {
        let mut enter: f64 = 0.0;
        let mut leave: f64 = 1.0;
        let half = self.step * 0.5;
        for (p, q, min, count) in [
            (a.x, b.x, self.first.x - half, self.columns),
            (a.y, b.y, self.first.y - half, self.rows),
        ] {
            let max = min + count as f64 * self.step;
            let delta = q - p;
            if !delta.is_finite() {
                return None;
            }
            if delta == 0.0 {
                if p < min || p > max {
                    return None;
                }
            } else {
                let t0 = (min - p) / delta;
                let t1 = (max - p) / delta;
                enter = enter.max(t0.min(t1));
                leave = leave.min(t0.max(t1));
            }
        }
        if enter > leave {
            return None;
        }
        let from = if enter == 0.0 {
            a
        } else {
            interpolate(a, b, enter)
        };
        let to = if leave == 1.0 {
            b
        } else {
            interpolate(a, b, leave)
        };
        Some((from, to))
    }

    fn mark_relief(&mut self, threshold: f64) {
        for i in 0..self.cells.len() {
            let cell = &self.cells[i];
            if !cell.surveyed || cell.wet || !cell.elevation.is_finite() {
                continue;
            }
            let mut slope_break = false;
            let mut crest = false;
            for (dx, dy) in [(1, 0), (0, 1), (1, 1), (-1, 1)] {
                let (Some(a), Some(b)) = (self.neighbour(i, -dx, -dy), self.neighbour(i, dx, dy))
                else {
                    continue;
                };
                let (a, b) = (&self.cells[a], &self.cells[b]);
                if a.wet || b.wet {
                    continue;
                }
                let length = a.position.distance(cell.position);
                let uphill = (cell.elevation - a.elevation) / length;
                let downhill = (cell.elevation - b.elevation) / length;
                let change = uphill + downhill;
                slope_break |= change.abs() >= threshold;
                crest |= uphill >= 0.0 && downhill >= 0.0 && change >= 0.25 * threshold;
            }
            self.cells[i].slope_break = slope_break;
            self.cells[i].crest = crest;
        }
    }

    fn mark_banks(&mut self) {
        let mut queue = VecDeque::new();
        for start in 0..self.cells.len() {
            let cell = &self.cells[start];
            if !cell.surveyed || cell.wet || cell.bank_id.is_some() {
                continue;
            }
            // The outer scan finds the component's minimum index before any
            // other member. Claims and slopes do not change bank identity.
            self.cells[start].bank_id = Some(start);
            queue.push_back(start);
            while let Some(index) = queue.pop_front() {
                for (dx, dy) in CARDINAL {
                    let Some(next) = self.neighbour(index, dx, dy) else {
                        continue;
                    };
                    let cell = &mut self.cells[next];
                    if !cell.wet && cell.bank_id.is_none() {
                        cell.bank_id = Some(start);
                        queue.push_back(next);
                    }
                }
            }
        }
    }
}

fn nonnegative(value: f64) -> bool {
    value.is_finite() && value >= 0.0
}

fn valid_spec(spec: &SurveySpec) -> bool {
    [
        spec.cell_size,
        spec.cliff_limit,
        spec.terrace_limit,
        spec.slope_power,
        spec.slope_break,
        spec.navigable_width,
        spec.harbour_min_front,
        spec.harbour_bank_grade,
        spec.strong_point_radius,
        spec.strong_point_min_rise,
        spec.strong_point_min_prominence,
        spec.strong_point_min_top_area,
        spec.strong_point_top_grade,
        spec.lane_grade,
    ]
    .into_iter()
    .all(|value| value.is_finite() && value > 0.0)
        && nonnegative(spec.water_charge)
        && nonnegative(spec.harbour_reach)
}

fn slope_at(
    terrain: &dyn TerrainView,
    width: f64,
    p: Point,
    step: f64,
    elevation: f64,
) -> (f64, f64) {
    if p.x >= step && p.y >= step && p.x + step < width && p.y + step < width {
        return terrain.slope_at(p, step);
    }
    let grade = |dx, dy| {
        let (a, b) = (offset(p, -dx, -dy), offset(p, dx, dy));
        match (in_terrain(a, width), in_terrain(b, width)) {
            (true, true) => (terrain.height_at(b) - terrain.height_at(a)) / (2.0 * step),
            (false, true) => (terrain.height_at(b) - elevation) / step,
            (true, false) => (elevation - terrain.height_at(a)) / step,
            (false, false) => 0.0,
        }
    };
    (grade(step, 0.0), grade(0.0, step))
}

/// Estimate channel width by the shortest wet run through the sample in four
/// directions. Use subcell probes so a single very narrow wet cell is not a channel.
fn wide_water(terrain: &dyn TerrainView, width: f64, p: Point, minimum: f64) -> bool {
    use std::f64::consts::FRAC_1_SQRT_2 as D;

    let step = (minimum / 4.0).min(2.0);
    // Count the wet sample at the centre as one interval of the width estimate.
    let steps = ((minimum / step).ceil() as usize).saturating_sub(1);
    let wet = |x, y| {
        let q = offset(p, x, y);
        in_terrain(q, width) && terrain.wet(q)
    };
    [(1.0, 0.0), (0.0, 1.0), (D, D), (D, -D)]
        .into_iter()
        .all(|(x, y)| {
            let left = (1..=steps)
                .take_while(|&k| wet(-x * step * k as f64, -y * step * k as f64))
                .count();
            left >= steps
                || (1..=steps - left).all(|k| wet(x * step * k as f64, y * step * k as f64))
        })
}
