//! Least-cost road search on the terrain grid.
//!
//! Twenty-four directions (the eight neighbours, the knight moves and the (1, 3) moves) let a road
//! climb at a third of the slope or less, so switchbacks can hold a grade limit on steep ground. Reuse is per *move*, not
//! per cell: a road is cheap only when it follows an existing road move, which keeps a new route
//! from cutting chords across an existing one, and cells beside a road cost more than the road
//! itself, so two routes either share a road or keep apart instead of running side by side.
//!
//! The search state is a cell and the heading the road arrived with (one of eight sectors), and
//! each class has a sharpest turn per move. A hairpin is therefore a rounded loop a few cells
//! across rather than a reversal between neighbouring cells, so the legs of a switchback stay
//! apart; turning is priced on the square of the angle and dearer on steep ground, so a climb
//! uses long traverses and puts its few hairpins where the slope eases (spurs, benches).
use super::super::Point;
use super::super::grid::{Entry, Fields};
use super::profile::Profile;
use std::collections::{BTreeMap, BinaryHeap};

/// Moves in opposite pairs: `DIRS[d ^ 1]` is the reverse of `DIRS[d]`.
pub(super) const DIRS: [(isize, isize); 24] = [
    (1, 0),
    (-1, 0),
    (0, 1),
    (0, -1),
    (1, 1),
    (-1, -1),
    (1, -1),
    (-1, 1),
    (2, 1),
    (-2, -1),
    (2, -1),
    (-2, 1),
    (1, 2),
    (-1, -2),
    (1, -2),
    (-1, 2),
    (3, 1),
    (-3, -1),
    (3, -1),
    (-3, 1),
    (1, 3),
    (-1, -3),
    (1, -3),
    (-1, 3),
];
/// Heading sectors of the search state: the 24 directions binned by 45 degrees.
const HEADINGS: usize = 8;
/// Sector of each move and the angle in degrees between two moves.
struct Turns {
    sector: [usize; 24],
    angle: [[f64; 24]; 24],
}
fn turns() -> &'static Turns {
    static TURNS: std::sync::OnceLock<Turns> = std::sync::OnceLock::new();
    TURNS.get_or_init(|| {
        let mut t = Turns {
            sector: [0; 24],
            angle: [[0.0; 24]; 24],
        };
        for (a, &(ax, ay)) in DIRS.iter().enumerate() {
            let s = (ay as f64).atan2(ax as f64) / std::f64::consts::FRAC_PI_4;
            t.sector[a] = (s.round() as isize).rem_euclid(HEADINGS as isize) as usize;
            for (b, &(bx, by)) in DIRS.iter().enumerate() {
                let cos = (ax * bx + ay * by) as f64
                    / (((ax * ax + ay * ay) * (bx * bx + by * by)) as f64).sqrt();
                t.angle[a][b] = cos.clamp(-1.0, 1.0).acos().to_degrees();
            }
        }
        t
    })
}
/// Sharpest turn per move by class (highway … trail), in degrees. 45 degrees lets a road turn
/// round in four moves, so the legs of a switchback lie about three cells apart; tracks and
/// trails turn a little tighter. Square turns would let legs touch: the hatching of a road
/// zigzagging between neighbouring cells.
const MAX_TURN: [f64; 5] = [45.0, 45.0, 46.0, 64.0, 64.0];
/// Turning cost by class, in metres of road per 45-degree turn on flat ground: what a hairpin's
/// platform and retaining walls cost compared with plain road.
const TURN_METRES: [f64; 5] = [120.0, 90.0, 60.0, 35.0, 15.0];

pub(super) fn dir_between(n: usize, a: usize, b: usize) -> Option<usize> {
    let dx = (b % n) as isize - (a % n) as isize;
    let dy = (b / n) as isize - (a / n) as isize;
    DIRS.iter().position(|&d| d == (dx, dy))
}

/// Road state shared by successive searches.
pub(super) struct Net {
    /// Bit d set: the road move `DIRS[d]` leaves this cell.
    pub dirs: Vec<u32>,
    /// 2 next to a road, 1 two cells away, 0 elsewhere (and on roads).
    pub near: Vec<u8>,
    /// Inside a settlement: roads converge there freely.
    pub settled: Vec<bool>,
}
impl Net {
    pub fn on_road(&self, i: usize) -> bool {
        self.dirs[i] != 0
    }
    pub fn add_path(&mut self, n: usize, cells: &[usize]) {
        for w in cells.windows(2) {
            if let Some(d) = dir_between(n, w[0], w[1]) {
                self.dirs[w[0]] |= 1 << d;
                self.dirs[w[1]] |= 1 << (d ^ 1);
            }
        }
        for &c in cells {
            let (x, y) = ((c % n) as isize, (c / n) as isize);
            for dy in -2..=2_isize {
                for dx in -2..=2_isize {
                    let (xx, yy) = (x + dx, y + dy);
                    if xx < 0 || yy < 0 || xx >= n as isize || yy >= n as isize {
                        continue;
                    }
                    let j = yy as usize * n + xx as usize;
                    let level = if dx.abs().max(dy.abs()) == 1 { 2 } else { 1 };
                    self.near[j] = self.near[j].max(level);
                }
            }
        }
    }
}

/// Per-map cost inputs that do not depend on the route being searched.
pub(super) struct Costs {
    /// Open-ground multiplier (shores, flood plains).
    pub land: Vec<f32>,
    /// Smooth noise in about [-1, 1] for meandering.
    pub noise: Vec<f32>,
    pub crossing_cost: f64,
    pub grade_weight: f64,
    pub max_grade: f64,
    pub wobble: f64,
    /// Cost multiplier on existing road moves.
    pub discount: f64,
    /// Extra cost beside a road (×(1 + near) next to it).
    pub near: f64,
    /// No water within three cells: every long move from here is dry.
    pub dry_around: Vec<bool>,
}
impl Costs {
    pub fn dry_around(f: &Fields) -> Vec<bool> {
        let n = f.r.n;
        let k = n + 1;
        let mut sat = vec![0_u32; k * k];
        for y in 0..n {
            let mut row = 0;
            for x in 0..n {
                row += u32::from(f.r.water[y * n + x] != 0);
                sat[(y + 1) * k + x + 1] = sat[y * k + x + 1] + row;
            }
        }
        (0..n * n)
            .map(|i| {
                let (x, y) = (i % n, i / n);
                let (x0, y0) = (x.saturating_sub(3), y.saturating_sub(3));
                let (x1, y1) = ((x + 3).min(n - 1) + 1, (y + 3).min(n - 1) + 1);
                sat[y1 * k + x1] + sat[y0 * k + x0] == sat[y0 * k + x1] + sat[y1 * k + x0]
            })
            .collect()
    }
}

pub(super) struct Query<'a> {
    pub start: usize,
    pub goals: &'a [usize],
    /// Straight-line reference for straight-road cultures.
    pub origin: Point,
    pub target: Point,
    pub profile: &'a Profile,
    pub class: usize,
}

/// One search state, `cell * HEADINGS + sector`, kept together for locality.
#[derive(Clone, Copy, Default)]
struct Slot {
    d: f64,
    parent: u32,
    seen: u32,
    closed: u32,
    /// The exact move that reached this state (`u8::MAX` at the start).
    via: u8,
}
/// Reusable search buffers, stamped per search so a call costs what it explores.
pub(super) struct Search {
    slots: Vec<Slot>,
    goal: Vec<u32>,
    epoch: u32,
}
impl Search {
    pub fn new(size: usize) -> Self {
        Self {
            slots: vec![Slot::default(); size * HEADINGS],
            goal: vec![0; size],
            epoch: 0,
        }
    }
}

fn passable(f: &Fields, p: &Profile, i: usize) -> bool {
    match f.r.water[i] {
        0 | 3 => true,
        2 => p.causeway && (0.0..=8.0).contains(&f.r.lake_depth(i)) && f.r.lake_depth(i) > 0.0,
        _ => false,
    }
}
/// A move is allowed when its end cells and the cells it cuts through are passable. Knight moves
/// stay on dry land, so every water crossing is made by single steps that the crossing pass sees.
pub(super) fn move_ok(
    f: &Fields,
    p: &Profile,
    dry_around: &[bool],
    x: isize,
    y: isize,
    d: usize,
) -> Option<usize> {
    let n = f.r.n as isize;
    let (dx, dy) = DIRS[d];
    let (xx, yy) = (x + dx, y + dy);
    if xx < 0 || yy < 0 || xx >= n || yy >= n {
        return None;
    }
    let at = |x: isize, y: isize| (y * n + x) as usize;
    let j = at(xx, yy);
    if dry_around[at(x, y)] {
        return Some(j);
    }
    if !passable(f, p, j) {
        return None;
    }
    if dx.abs() + dy.abs() == 2 && dx != 0 && dy != 0 {
        if !passable(f, p, at(xx, y)) || !passable(f, p, at(x, yy)) {
            return None;
        }
    } else if dx.abs() + dy.abs() >= 3 {
        // Long moves stay on dry land along their whole line.
        let steps = 4 * dx.abs().max(dy.abs());
        for k in 0..=steps {
            let t = k as f64 / steps as f64;
            let cx = (x as f64 + 0.5 + dx as f64 * t).floor() as isize;
            let cy = (y as f64 + 0.5 + dy as f64 * t).floor() as isize;
            if f.r.water[at(cx.clamp(0, n - 1), cy.clamp(0, n - 1))] != 0 {
                return None;
            }
        }
    }
    Some(j)
}

/// First index of the long moves in [`DIRS`].
const LONG: usize = 8;
/// [`line_grade`] of every long move from every cell, `[cell * 16 + d - LONG]`.
pub(super) fn long_grades(f: &Fields) -> &[f32] {
    f.long_grades.get_or_init(|| {
        let n = f.r.n;
        let mut out = vec![0.0_f32; n * n * (DIRS.len() - LONG)];
        for i in 0..n * n {
            let (x, y) = ((i % n) as isize, (i / n) as isize);
            for (k, &(dx, dy)) in DIRS[LONG..].iter().enumerate() {
                out[i * (DIRS.len() - LONG) + k] = line_grade(f, x, y, dx, dy) as f32;
            }
        }
        out
    })
}
/// Steepest grade along a long move, sampled about once per cell: the two ends alone would let
/// a move step over a ravine or a crest.
fn line_grade(f: &Fields, x: isize, y: isize, dx: isize, dy: isize) -> f64 {
    let n = f.r.n;
    let len = ((dx * dx + dy * dy) as f64).sqrt();
    let steps = len.ceil() as usize;
    let h = |t: f64| {
        let gx = (x as f64 + dx as f64 * t).clamp(0.0, (n - 1) as f64);
        let gy = (y as f64 + dy as f64 * t).clamp(0.0, (n - 1) as f64);
        let (x0, y0) = (gx.floor() as usize, gy.floor() as usize);
        let (x1, y1) = ((x0 + 1).min(n - 1), (y0 + 1).min(n - 1));
        let (tx, ty) = (gx - x0 as f64, gy - y0 as f64);
        let at = |x: usize, y: usize| f.route_height[y * n + x] as f64;
        (at(x0, y0) * (1.0 - tx) + at(x1, y0) * tx) * (1.0 - ty)
            + (at(x0, y1) * (1.0 - tx) + at(x1, y1) * tx) * ty
    };
    let step = len * f.cell / steps as f64;
    let mut previous = h(0.0);
    let mut steepest = 0.0_f64;
    for k in 1..=steps {
        let next = h(k as f64 / steps as f64);
        steepest = steepest.max((next - previous).abs() / step);
        previous = next;
    }
    steepest
}

impl Search {
    /// Least-cost path from `start` to any goal; `river_penalty` multiplies crossings of given rivers.
    pub fn run(
        &mut self,
        f: &Fields,
        net: &Net,
        costs: &Costs,
        q: &Query<'_>,
        river_penalty: &BTreeMap<i32, f64>,
    ) -> Option<Vec<usize>> {
        let n = f.r.n;
        self.epoch = self.epoch.wrapping_add(1);
        if self.epoch == 0 {
            self.slots.fill(Slot::default());
            self.goal.fill(0);
            self.epoch = 1;
        }
        let e = self.epoch;
        // Search window: the box around both ends, widened for detours.
        let (sx, sy) = (q.start % n, q.start / n);
        let tx = ((q.target.x / f.cell) as usize).min(n - 1);
        let ty = ((q.target.y / f.cell) as usize).min(n - 1);
        let span = sx.abs_diff(tx).max(sy.abs_diff(ty));
        let margin = (span * 2 / 5).max(32);
        let window = (
            sx.min(tx).saturating_sub(margin),
            sy.min(ty).saturating_sub(margin),
            (sx.max(tx) + margin).min(n - 1),
            (sy.max(ty) + margin).min(n - 1),
        );
        let inside = |i: usize| {
            let (x, y) = (i % n, i / n);
            x >= window.0 && x <= window.2 && y >= window.1 && y <= window.3
        };
        let mut bounds = (n, n, 0, 0);
        let mut any = false;
        for &g in q.goals {
            if inside(g) {
                self.goal[g] = e;
                any = true;
                bounds.0 = bounds.0.min(g % n);
                bounds.1 = bounds.1.min(g / n);
                bounds.2 = bounds.2.max(g % n);
                bounds.3 = bounds.3.max(g / n);
            }
        }
        if !any {
            return None;
        }
        // Heuristic rate just above the cost of following an existing road: much faster than a
        // strictly admissible bound, yet never so high that a route skips a trunk it should share
        // (a higher rate pulls routes straight at the goal, alongside the roads already there).
        let h_rate = costs.discount.max(0.3) + 0.15;
        let heuristic = |i: usize| {
            let x = i % n;
            let y = i / n;
            let dx = bounds.0.saturating_sub(x).max(x.saturating_sub(bounds.2)) as f64;
            let dy = bounds.1.saturating_sub(y).max(y.saturating_sub(bounds.3)) as f64;
            f.cell * dx.hypot(dy) * h_rate
        };
        let line = (q.target.x - q.origin.x, q.target.y - q.origin.y);
        let line_len = line.0.hypot(line.1);
        let straight_scale = 0.1 * line_len + 3.0 * f.cell;
        let gmax = q.profile.class_grade(q.class, costs.max_grade);
        let gw = costs.grade_weight * (1.0 + q.profile.contour);
        let wobble = costs.wobble * q.profile.wobble;
        let river_base = costs.crossing_cost * q.profile.bridge;
        // Turning: squared angle, so a bend spreads over several moves; a hairpin costs a few
        // cells of road per 45 degrees, more on steep ground and for straight-road cultures.
        let class = q.class.min(4);
        let turn_cost = TURN_METRES[class] * (1.0 + 2.0 * q.profile.straightness);
        let max_turn = MAX_TURN[class] + 0.5;
        let long = long_grades(f);
        let turns = turns();

        let mut heap = BinaryHeap::new();
        let first = q.start * HEADINGS;
        self.slots[first] = Slot {
            d: 0.0,
            parent: 0,
            seen: e,
            closed: 0,
            via: u8::MAX,
        };
        heap.push(Entry(heuristic(q.start), first));
        while let Some(Entry(_, state)) = heap.pop() {
            if self.slots[state].closed == e {
                continue;
            }
            self.slots[state].closed = e;
            let i = state / HEADINGS;
            if self.goal[i] == e {
                let mut cells = vec![i];
                let mut at = state;
                while at != first {
                    at = self.slots[at].parent as usize;
                    cells.push(at / HEADINGS);
                }
                cells.reverse();
                return Some(cells);
            }
            let (x, y) = ((i % n) as isize, (i / n) as isize);
            let (came, here) = (self.slots[state].via, self.slots[state].d);
            // Junctions and settlements may turn sharply: roads meet there at any angle.
            let free = net.on_road(i) || net.settled[i];
            let steep = 1.0 + 1.5 * f64::from(f.slope_s[i]).min(1.0);
            for (d, &(dx, dy)) in DIRS.iter().enumerate() {
                let road = net.dirs[i] & (1 << d) != 0;
                let angle = if came == u8::MAX {
                    0.0
                } else {
                    turns.angle[came as usize][d]
                };
                if angle > if free { 136.0 } else { max_turn } {
                    continue;
                }
                // Window and closed states first: both are cheaper than the passability test.
                let (xx, yy) = (x + dx, y + dy);
                if xx < 0 || yy < 0 || xx >= n as isize || yy >= n as isize {
                    continue;
                }
                let j = yy as usize * n + xx as usize;
                let next = j * HEADINGS + turns.sector[d];
                if self.slots[next].closed == e
                    || !inside(j)
                    || move_ok(f, q.profile, &costs.dry_around, x, y, d).is_none()
                {
                    continue;
                }
                let dist = f.cell * ((dx * dx + dy * dy) as f64).sqrt();
                let wet = f.r.water[i] != 0 || f.r.water[j] != 0;
                // Over water the road height is the bridge deck or causeway (see `deck_height`).
                let grade = if d >= LONG {
                    long[i * (DIRS.len() - LONG) + d - LONG] as f64
                } else {
                    (f.route_height[i] - f.route_height[j]).abs() as f64 / dist
                };
                let excess = (grade / gmax - 1.0).max(0.0);
                let slope = 1.0
                    + gw * (5.0 * grade
                        + 80.0 * grade * grade
                        + 40.0 * excess
                        + 300.0 * excess * excess);
                let turn = if road {
                    0.0
                } else {
                    turn_cost * steep * (angle / 45.0).powi(2)
                };
                let mut m = if road {
                    // An existing road move (with its bridge, if any).
                    costs.discount * if wet { 2.0 } else { 1.0 }
                } else {
                    let ground = match f.r.water[j] {
                        3 => (if f.r.river_width[j] > 3.7 { 30.0 } else { 40.0 }) * river_base,
                        2 => 20.0 * costs.crossing_cost,
                        _ => costs.land[j] as f64,
                    };
                    let p = f.pos(j);
                    // Meandering fades on steep ground, where the grade rules the line: noise there
                    // would bunch switchbacks into its cheap patches.
                    let flat = 1.0 - super::super::smooth(f64::from(f.slope_s[j]), 0.08, 0.3);
                    let meander = (1.0 + wobble * flat * costs.noise[j] as f64).max(0.5);
                    let beside = if net.settled[j] || net.on_road(j) {
                        1.0
                    } else {
                        1.0 + costs.near * f64::from(net.near[j]) * 0.5
                    };
                    let straight = if q.profile.straightness > 0.0 && line_len > 0.0 {
                        let perp = ((p.x - q.origin.x) * line.1 - (p.y - q.origin.y) * line.0)
                            .abs()
                            / line_len;
                        1.0 + q.profile.straightness * (perp / straight_scale).min(5.0)
                    } else {
                        1.0
                    };
                    ground * meander * beside * straight
                };
                if f.r.water[j] == 3 {
                    m *= river_penalty.get(&f.r.river_ids[j]).copied().unwrap_or(1.0);
                }
                let cost = here + dist * slope * m + turn;
                let slot = &mut self.slots[next];
                if slot.seen != e || cost < slot.d {
                    slot.seen = e;
                    slot.d = cost;
                    slot.parent = state as u32;
                    slot.via = d as u8;
                    heap.push(Entry(cost + heuristic(j), next));
                }
            }
        }
        None
    }

    /// Repeats the search while a river is crossed more than once, making that river dearer.
    pub fn few_crossings(
        &mut self,
        f: &Fields,
        net: &Net,
        costs: &Costs,
        q: &Query<'_>,
    ) -> Option<Vec<usize>> {
        let mut penalty = BTreeMap::new();
        let mut best = None;
        let mut best_excess = usize::MAX;
        for _ in 0..4 {
            let Some(path) = self.run(f, net, costs, q, &penalty) else {
                break;
            };
            let mut counts = BTreeMap::<i32, usize>::new();
            let mut previous = -1;
            for &i in &path {
                let id = if f.r.water[i] == 3 {
                    f.r.river_ids[i]
                } else {
                    -1
                };
                if id >= 0 && id != previous {
                    *counts.entry(id).or_default() += 1;
                }
                if id >= 0 || f.r.water[i] != 3 {
                    previous = id;
                }
            }
            let excess = counts.values().map(|v| v.saturating_sub(1)).sum();
            if excess < best_excess {
                best_excess = excess;
                best = Some(path);
            }
            if excess == 0 {
                break;
            }
            for (id, count) in counts {
                if count > 1 {
                    *penalty.entry(id).or_insert(1.0) *= 6.0;
                }
            }
        }
        best
    }
}
