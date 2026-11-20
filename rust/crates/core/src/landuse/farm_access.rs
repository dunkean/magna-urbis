//! Farm drives routed over the ground, not drawn as straight spurs.
//!
//! A land-use farm (a settlement farmstead, a farm by a road, a farm the cultivated land
//! asks for) reaches the network by the cheapest way over the terrain: around water,
//! other farms' lots and steep ground, joining the nearest road or street, or the drive of
//! a farm already placed (lanes merge into shared field ways instead of each running its
//! own line to the main road). One bounded Dijkstra per farm on the land-use raster, from
//! the gate to any network cell; the path ends exactly on the road or drive it joins.
//! A farm no way reaches within its range keeps no drive (never a line across a river).
//! Planned lanes (the hamlet street) stay as they were planned: they do not come here.
use super::geom::{Point, contains, dist, nearest, p, simplify};
use super::raster::near_line;
use std::cmp::Reverse;
use std::collections::BinaryHeap;

/// Steepest grade a farm track takes; steeper cells are walked around.
const MAX_GRADE: f64 = 0.3;
/// Grade at which a metre of track costs two on the flat.
const EASY_GRADE: f64 = 0.08;
/// Cost budget per metre of range: a track may wind up to this factor of its range.
const DETOUR: f64 = 3.0;

/// Network cell: 1 = road or street, 2 = drive of a placed farm.
const ROAD: u8 = 1;
const DRIVE: u8 = 2;

pub(super) struct FarmAccess {
    w: usize,
    h: usize,
    cell: f64,
    /// Network cells (ROAD / DRIVE), 0 elsewhere.
    goal: Vec<u8>,
    /// Lots of placed farms: a drive never crosses another farm's yard.
    lots: Vec<u8>,
    roads: Vec<Vec<Point>>,
    drives: Vec<Vec<Point>>,
    // Search state, allocated on the first route and reused (epoch stamps).
    cost: Vec<f32>,
    prev: Vec<u32>,
    stamp: Vec<u32>,
    epoch: u32,
}

impl FarmAccess {
    /// `roads`: every road and street polyline with its width (m).
    pub(super) fn new<'a>(
        w: usize,
        h: usize,
        cell: f64,
        roads: impl IntoIterator<Item = (&'a [Point], f64)>,
    ) -> Self {
        let mut goal = vec![0_u8; w * h];
        let mut lines = vec![];
        for (path, width) in roads {
            if path.len() < 2 {
                continue;
            }
            near_line(path, w, h, cell, (width / 2.0).max(0.75 * cell), |i| {
                goal[i] = ROAD
            });
            lines.push(path.to_vec());
        }
        FarmAccess {
            w,
            h,
            cell,
            goal,
            lots: vec![0; w * h],
            roads: lines,
            drives: vec![],
            cost: vec![],
            prev: vec![],
            stamp: vec![],
            epoch: 0,
        }
    }

    /// A placed farm: its lot is closed to later drives, its drive (when it has one) joins the network.
    pub(super) fn add_farm(&mut self, lot: &[Point], drive: &[Point]) {
        if lot.len() >= 3 {
            super::raster::rasterize(&[lot.to_vec()], self.w, self.h, self.cell, &mut self.lots);
        }
        if drive.len() >= 2 && dist(drive[0], drive[drive.len() - 1]) > 0.5 {
            let goal = &mut self.goal;
            near_line(drive, self.w, self.h, self.cell, 0.75 * self.cell, |i| {
                if goal[i] == 0 {
                    goal[i] = DRIVE;
                }
            });
            self.drives.push(drive.to_vec());
        }
    }

    fn at(&self, i: usize) -> Point {
        p(
            ((i % self.w) as f64 + 0.5) * self.cell,
            ((i / self.w) as f64 + 0.5) * self.cell,
        )
    }

    fn index(&self, q: Point) -> Option<usize> {
        let (x, y) = ((q.x / self.cell).floor(), (q.y / self.cell).floor());
        (x >= 0.0 && y >= 0.0 && (x as usize) < self.w && (y as usize) < self.h)
            .then(|| y as usize * self.w + x as usize)
    }

    /// The point of the network line of `kind` nearest to `q`.
    fn snap(&self, q: Point, kind: u8) -> Point {
        let lines = if kind == DRIVE {
            &self.drives
        } else {
            &self.roads
        };
        let mut best = (f64::INFINITY, q);
        for line in lines {
            for s in line.windows(2) {
                let n = nearest(q, s[0], s[1]);
                let d = dist(n, q);
                if d < best.0 {
                    best = (d, n);
                }
            }
        }
        best.1
    }

    /// The drive of a farm whose gate is `from`, from the network point it joins to the gate
    /// (`[network, ..., gate]`), at most `range` metres away as the crow flies; `own` is the
    /// farm's lot, which the drive leaves by its gate. None when no way reaches the network.
    pub(super) fn route(
        &mut self,
        height: &[f32],
        water: &[u8],
        from: Point,
        own: &[Point],
        range: f64,
    ) -> Option<Vec<Point>> {
        self.search(height, water, from, own, range)
            .or_else(|| self.search(height, water, from, &[], range))
    }

    fn wet(water: &[u8], i: usize) -> bool {
        water.get(i).is_some_and(|&v| v != 0)
    }

    /// The track rule every returned segment obeys, sampled cell by cell from `a` to `b`: no
    /// water and no other farm's lot (except on the existing network, whose bridges and road
    /// surface it may follow from one network cell to the next), and no step between two cells
    /// steeper than `MAX_GRADE`. The search moves by the same rule, so the routed cells pass it;
    /// the simplified line, the rounded corners and the end connectors are checked with it.
    fn passable(&self, height: &[f32], water: &[u8], a: Point, b: Point) -> bool {
        let steps = ((dist(a, b) / (self.cell / 3.0)).ceil() as usize).max(1);
        let mut last: Option<usize> = None;
        for k in 0..=steps {
            let t = k as f64 / steps as f64;
            let Some(i) = self.index(p(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) else {
                return false;
            };
            if last == Some(i) {
                continue;
            }
            let on_network = self.goal[i] != 0 && last.is_none_or(|j| self.goal[j] != 0);
            if !on_network && (Self::wet(water, i) || self.lots[i] != 0) {
                return false;
            }
            if let Some(j) = last {
                let grade = height.get(i).zip(height.get(j)).map_or(0.0, |(x, y)| {
                    (*x as f64 - *y as f64).abs() / dist(self.at(i), self.at(j))
                });
                if grade > MAX_GRADE {
                    return false;
                }
            }
            last = Some(i);
        }
        true
    }

    fn passable_line(&self, height: &[f32], water: &[u8], line: &[Point]) -> bool {
        line.windows(2)
            .all(|s| self.passable(height, water, s[0], s[1]))
    }

    fn search(
        &mut self,
        height: &[f32],
        water: &[u8],
        from: Point,
        own: &[Point],
        range: f64,
    ) -> Option<Vec<Point>> {
        let start = self.index(from)?;
        let n = self.w * self.h;
        if self.cost.len() != n {
            self.cost = vec![0.0; n];
            self.prev = vec![u32::MAX; n];
            self.stamp = vec![0; n];
        }
        self.epoch = self.epoch.wrapping_add(1);
        if self.epoch == 0 {
            self.stamp.iter_mut().for_each(|s| *s = 0);
            self.epoch = 1;
        }
        let (w, h, cell, epoch) = (self.w as isize, self.h as isize, self.cell, self.epoch);
        let budget = (range * DETOUR) as f32;
        let window = range * 1.25 + cell;
        let blocked = |i: usize, me: &Self| {
            Self::wet(water, i) || me.lots[i] != 0 || (!own.is_empty() && contains(own, me.at(i)))
        };
        let mut heap = BinaryHeap::new();
        self.cost[start] = 0.0;
        self.prev[start] = u32::MAX;
        self.stamp[start] = epoch;
        heap.push(Reverse((0_u32, start as u32)));
        let mut reached = None;
        while let Some(Reverse((bits, i))) = heap.pop() {
            let i = i as usize;
            let c = f32::from_bits(bits);
            if c > self.cost[i] {
                continue;
            }
            // A network cell is the end only when its last metres to the exact network point
            // obey the track rule (the corridor is wider than the road: a scarp, a ditch or a
            // stream can lie between the cell and the road line). Otherwise the search goes on.
            if self.goal[i] != 0 {
                let origin = if i == start { from } else { self.at(i) };
                let end = self.snap(origin, self.goal[i]);
                if self.passable(height, water, origin, end) {
                    reached = Some((i, end));
                    break;
                }
            }
            if c > budget {
                break;
            }
            let (x, y) = ((i % self.w) as isize, (i / self.w) as isize);
            for (dx, dy) in [
                (1, 0),
                (-1, 0),
                (0, 1),
                (0, -1),
                (1, 1),
                (1, -1),
                (-1, 1),
                (-1, -1),
            ] {
                let (nx, ny) = (x + dx, y + dy);
                if nx < 0 || ny < 0 || nx >= w || ny >= h {
                    continue;
                }
                let j = (ny * w + nx) as usize;
                // A network cell over water (a bridge) is followed along the network, never entered from the bank.
                let open = |k: usize, me: &Self| {
                    if me.goal[k] != 0 {
                        !Self::wet(water, k) || me.goal[i] != 0
                    } else {
                        !blocked(k, me)
                    }
                };
                if !open(j, self) {
                    continue;
                }
                // No diagonal squeeze between two closed cells (a pond corner, two lots).
                if dx != 0
                    && dy != 0
                    && !(open((y * w + nx) as usize, self) && open((ny * w + x) as usize, self))
                {
                    continue;
                }
                if dist(self.at(j), from) > window {
                    continue;
                }
                let len = if dx != 0 && dy != 0 {
                    cell * std::f64::consts::SQRT_2
                } else {
                    cell
                };
                let grade = height
                    .get(j)
                    .zip(height.get(i))
                    .map_or(0.0, |(a, b)| (*a as f64 - *b as f64).abs() / len);
                if grade > MAX_GRADE {
                    continue;
                }
                let next = c + (len * (1.0 + (grade / EASY_GRADE).powi(2))) as f32;
                if self.stamp[j] != epoch || next < self.cost[j] {
                    self.stamp[j] = epoch;
                    self.cost[j] = next;
                    self.prev[j] = i as u32;
                    heap.push(Reverse((next.to_bits(), j as u32)));
                }
            }
        }
        let (goal, end) = reached?;
        // Cells from the network back to the gate.
        let mut cells = vec![goal];
        let mut at = goal;
        while self.prev[at] != u32::MAX && at != start {
            at = self.prev[at] as usize;
            cells.push(at);
        }
        // The raw track: the exact network point, the centres of the routed cells (the goal cell's
        // included: its connector was checked from there), then the gate inside the start cell.
        let mut raw: Vec<Point> = vec![end];
        if goal != start {
            raw.extend(cells.iter().map(|&i| self.at(i)));
        }
        raw.push(from);
        raw.dedup_by(|a, b| dist(*a, *b) < 1e-6);
        if raw.len() < 2 {
            return Some(vec![from, from]);
        }
        if !self.passable_line(height, water, &raw) {
            return None;
        }
        // Simplified only when the straighter line still obeys the rule, then rounded where the cut does.
        let simple = simplify(&raw, 0.3 * cell);
        let line = if self.passable_line(height, water, &simple) {
            simple
        } else {
            raw
        };
        let rounded = smooth_open(&line, 2.0 * cell, |a, b| self.passable(height, water, a, b));
        let out = if self.passable_line(height, water, &rounded) {
            rounded
        } else {
            line
        };
        Some(if out.len() == 2 && dist(out[0], out[1]) <= 0.5 {
            vec![from, from]
        } else {
            out
        })
    }
}

/// Rounds the inner corners of an open polyline (ends kept exact): the cell staircase becomes
/// a lane. Each corner is cut at most `max_cut` metres (a quarter of a side) back along its
/// sides, and only when `clear` accepts the cut.
fn smooth_open(a: &[Point], max_cut: f64, clear: impl Fn(Point, Point) -> bool) -> Vec<Point> {
    if a.len() < 3 {
        return a.to_vec();
    }
    let mut out = Vec::with_capacity(a.len() * 2);
    out.push(a[0]);
    for k in 1..a.len() - 1 {
        let (u, v, w) = (a[k - 1], a[k], a[k + 1]);
        let toward = |q: Point| {
            let d = dist(v, q);
            if d < 1e-9 {
                v
            } else {
                let t = (max_cut / d).min(0.25);
                p(v.x + (q.x - v.x) * t, v.y + (q.y - v.y) * t)
            }
        };
        let (b, c) = (toward(u), toward(w));
        if clear(b, c) {
            out.push(b);
            out.push(c);
        } else {
            out.push(v);
        }
    }
    out.push(a[a.len() - 1]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 60 × 60 cells of 10 m; a north-south road at x = 50 m.
    fn grid() -> (usize, f64, Vec<f32>, Vec<u8>, Vec<Point>) {
        let (n, cell) = (60, 10.0);
        (
            n,
            cell,
            vec![10.0; n * n],
            vec![0; n * n],
            vec![p(50.0, 0.0), p(50.0, 600.0)],
        )
    }
    fn deviation(path: &[Point]) -> f64 {
        let (a, b) = (path[0], path[path.len() - 1]);
        path.iter()
            .map(|&q| dist(q, nearest(q, a, b)))
            .fold(0.0, f64::max)
    }

    /// The reported failure: a farm behind a pond took a straight line to the nearest road
    /// point, across the water. The routed drive goes round the pond, ends on the road and
    /// never enters a water cell.
    #[test]
    fn drive_goes_round_water_and_ends_on_the_road() {
        let (n, cell, height, mut water, road) = grid();
        // A pond between the farm and the road: x 150..350 m, y 200..400 m.
        for y in 20..40 {
            for x in 15..35 {
                water[y * n + x] = 1;
            }
        }
        let mut access = FarmAccess::new(n, n, cell, [(road.as_slice(), 6.0)]);
        let gate = p(455.0, 305.0);
        let drive = access
            .route(&height, &water, gate, &[], 1500.0)
            .expect("a way round the pond");
        assert_eq!(*drive.last().unwrap(), gate);
        assert!(
            (drive[0].x - 50.0).abs() < 1e-6,
            "the drive ends on the road: {:?}",
            drive[0]
        );
        for s in drive.windows(2) {
            for k in 0..=20 {
                let q = p(
                    s[0].x + (s[1].x - s[0].x) * k as f64 / 20.0,
                    s[0].y + (s[1].y - s[0].y) * k as f64 / 20.0,
                );
                let i = (q.y / cell) as usize * n + (q.x / cell) as usize;
                assert_eq!(water[i], 0, "the drive crosses the pond at {q:?}");
            }
        }
        assert!(
            drive.len() > 2 && deviation(&drive) > 50.0,
            "not a straight spur"
        );
        assert!(
            access.passable_line(&height, &water, &drive),
            "every segment, rounded corners included, obeys the track rule"
        );
    }

    /// Coarse map (20 m cells): the gate stands in the road's corridor cell, on a terrace 20 m above
    /// the road, the scarp between them inside the corridor. The former shortcut snapped the gate
    /// straight down the scarp to the road. The drive now reaches the road by the ramp to the
    /// south, every step (end connector, simplified line, rounded corners) within the grade limit.
    #[test]
    fn short_connector_down_a_scarp_in_the_road_corridor_is_refused() {
        let (n, cell) = (40, 20.0);
        // Road at x = 58 m: corridor cells x = 2 (centre 50) and x = 3 (centre 70).
        let road = vec![p(58.0, 0.0), p(58.0, 800.0)];
        let mut height = vec![0.0_f32; n * n];
        for y in 0..n {
            for x in 0..n {
                height[y * n + x] = if x <= 2 {
                    10.0
                } else if y >= 30 {
                    // The ramp: from the road level up to the terrace towards the east.
                    10.0 + 20.0 * (x as f32 - 2.0) / 38.0
                } else {
                    30.0
                };
            }
        }
        let water = vec![0_u8; n * n];
        let mut access = FarmAccess::new(n, n, cell, [(road.as_slice(), 6.0)]);
        let gate = p(75.0, 305.0);
        assert_ne!(
            access.goal[access.index(gate).unwrap()],
            0,
            "the gate stands in the road corridor"
        );
        assert!(
            !access.passable(&height, &water, gate, p(58.0, 305.0)),
            "the straight connector goes down the scarp"
        );
        let drive = access
            .route(&height, &water, gate, &[], 1500.0)
            .expect("a way by the ramp");
        assert_eq!(*drive.last().unwrap(), gate);
        assert!(
            (drive[0].x - 58.0).abs() < 1e-6,
            "the drive ends exactly on the road: {:?}",
            drive[0]
        );
        assert!(
            drive[0].y > 590.0,
            "the drive joins the road below the ramp: {:?}",
            drive[0]
        );
        assert!(drive.len() > 3, "a winding track, not a spur: {drive:?}");
        assert!(
            access.passable_line(&height, &water, &drive),
            "every step within the grade limit: {drive:?}"
        );
    }

    /// A steep scarp between farm and road: the drive takes the gentle gap, not the face.
    #[test]
    fn drive_avoids_steep_ground() {
        let (n, cell, mut height, water, road) = grid();
        // A 20 m step at x = 250 m, except a ramp for y 500..600 m.
        for y in 0..n {
            for x in 0..n {
                let base = if x >= 25 { 30.0 } else { 10.0 };
                height[y * n + x] = if y >= 50 {
                    10.0 + 20.0 * (x as f32 / n as f32)
                } else {
                    base
                };
            }
        }
        let mut access = FarmAccess::new(n, n, cell, [(road.as_slice(), 6.0)]);
        let drive = access
            .route(&height, &water, p(455.0, 105.0), &[], 1500.0)
            .expect("a way by the ramp");
        assert!(
            drive.iter().any(|q| q.y > 480.0),
            "the drive climbs by the ramp: {drive:?}"
        );
    }

    /// A second farm joins the first one's drive instead of running its own line to the road,
    /// and no farm without a way to the network gets an invented line.
    #[test]
    fn drives_merge_and_unreachable_farms_get_none() {
        let (n, cell, height, mut water, road) = grid();
        let mut access = FarmAccess::new(n, n, cell, [(road.as_slice(), 6.0)]);
        let first = access
            .route(&height, &water, p(455.0, 305.0), &[], 1500.0)
            .unwrap();
        access.add_farm(&[], &first);
        let second = access
            .route(&height, &water, p(455.0, 365.0), &[], 1500.0)
            .unwrap();
        assert!(
            second[0].x > 100.0,
            "the second farm joins the first drive near it, not the road: {:?}",
            second[0]
        );
        // A farm cut off by a river from the only road: no line across the water.
        for y in 0..n {
            for x in 40..44 {
                water[y * n + x] = 1;
            }
        }
        let mut cut_off = FarmAccess::new(n, n, cell, [(road.as_slice(), 6.0)]);
        assert!(
            cut_off
                .route(&height, &water, p(555.0, 305.0), &[], 1500.0)
                .is_none()
        );
    }
}
