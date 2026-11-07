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
use super::super::grid::Fields;
use super::profile::Profile;
use std::collections::BTreeMap;

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
    /// Narrow corridor around the straight line (long routes to a known goal).
    pub tight: bool,
}

/// One search state, `cell * HEADINGS + sector`, kept together for locality (16 bytes).
#[derive(Clone, Copy, Default)]
struct Slot {
    d: f64,
    /// `2 * epoch` once reached in this search, `2 * epoch + 1` once closed.
    stamp: u32,
    /// Parent state in the low [`VIA_SHIFT`] bits, the exact move that reached this state above
    /// ([`NO_VIA`] at the start).
    link: u32,
}
const VIA_SHIFT: u32 = 27;
const NO_VIA: u32 = 31;
impl Slot {
    fn parent(self) -> usize {
        (self.link & ((1 << VIA_SHIFT) - 1)) as usize
    }
    fn via(self) -> u32 {
        self.link >> VIA_SHIFT
    }
}
/// Exact min-queue on (cost, state): a 4-ary heap ordered like [`Entry`] (`total_cmp`, then the
/// smaller state), so it pops the same sequence as `BinaryHeap<Entry>` (keys are distinct
/// except for exact duplicates, which are interchangeable).
struct Queue {
    v: Vec<(i64, u32)>,
}
impl Queue {
    fn key(cost: f64) -> i64 {
        let b = cost.to_bits() as i64;
        b ^ ((((b >> 63) as u64) >> 1) as i64)
    }
    fn push(&mut self, cost: f64, state: u32) {
        let item = (Self::key(cost), state);
        let v = &mut self.v;
        let mut at = v.len();
        v.push(item);
        while at > 0 {
            let up = (at - 1) / 4;
            if v[up] <= item {
                break;
            }
            v[at] = v[up];
            at = up;
        }
        v[at] = item;
    }
    fn pop(&mut self) -> Option<u32> {
        let v = &mut self.v;
        let top = v.first()?.1;
        let last = v.pop().unwrap();
        let len = v.len();
        if len > 0 {
            let mut at = 0;
            loop {
                let c = 4 * at + 1;
                if c >= len {
                    break;
                }
                let end = (c + 4).min(len);
                let mut best = c;
                for k in c + 1..end {
                    if v[k] < v[best] {
                        best = k;
                    }
                }
                if v[best] >= last {
                    break;
                }
                v[at] = v[best];
                at = best;
            }
            v[at] = last;
        }
        Some(top)
    }
}
/// Reusable search buffers, stamped per search so a call costs what it explores.
pub(super) struct Search {
    slots: Vec<Slot>,
    goal: Vec<u32>,
    epoch: u32,
    queue: Queue,
    /// Ground cost of entering each cell off-road in the current search (`ground × meander ×
    /// beside × straight`), with the epoch it was computed in: a cell is entered from up to
    /// 24 moves × 8 headings, its cost depends only on the query and the network.
    cell_cost: Vec<(u32, f64)>,
}
impl Search {
    pub fn new(size: usize) -> Self {
        assert!(size * HEADINGS < 1 << VIA_SHIFT, "road search grid too large");
        Self {
            slots: vec![Slot::default(); size * HEADINGS],
            goal: vec![0; size],
            epoch: 0,
            queue: Queue { v: Vec::new() },
            cell_cost: vec![(0, 0.0); size],
        }
    }
}

fn passable(f: &Fields, causeway: bool, i: usize) -> bool {
    match f.r.water[i] {
        0 | 3 => true,
        2 => causeway && (0.0..=8.0).contains(&f.r.lake_depth(i)) && f.r.lake_depth(i) > 0.0,
        _ => false,
    }
}
/// A move is allowed when its end cells and the cells it cuts through are passable. Knight moves
/// stay on dry land, so every water crossing is made by single steps that the crossing pass sees.
pub(super) fn move_ok(
    f: &Fields,
    p: bool,
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

/// Bit d set: [`move_ok`] allows `DIRS[d]` from this cell, for profiles without (`[0]`) and with
/// (`[1]`) causeways. Computed by the first road search on this terrain.
fn move_masks(f: &Fields, causeway: bool) -> &[u32] {
    f.move_masks[usize::from(causeway)].get_or_init(|| {
        let n = f.r.n;
        let dry_around = Costs::dry_around(f);
        let rows = crate::urban::par::range(n, |y| {
            (0..n)
                .map(|x| {
                    (0..DIRS.len()).fold(0_u32, |mask, d| {
                        if move_ok(f, causeway, &dry_around, x as isize, y as isize, d).is_some() {
                            mask | 1 << d
                        } else {
                            mask
                        }
                    })
                })
                .collect::<Vec<u32>>()
        });
        rows.concat()
    })
}

/// First index of the long moves in [`DIRS`].
const LONG: usize = 8;
/// [`line_grade`] of every long move from every cell, `[cell * 16 + d - LONG]`.
pub(super) fn long_grades(f: &Fields) -> &[f32] {
    f.long_grades.get_or_init(|| {
        let n = f.r.n;
        let per = DIRS.len() - LONG;
        // Rows in parallel, joined in row order.
        let rows = crate::urban::par::range(n, |y| {
            let mut row = vec![0.0_f32; n * per];
            for x in 0..n {
                for (k, &(dx, dy)) in DIRS[LONG..].iter().enumerate() {
                    row[x * per + k] = line_grade(f, x as isize, y as isize, dx, dy) as f32;
                }
            }
            row
        });
        rows.concat()
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
        self.epoch += 1;
        if self.epoch >= 1 << 30 {
            self.slots.fill(Slot::default());
            self.goal.fill(0);
            self.cell_cost.fill((0, 0.0));
            self.epoch = 1;
        }
        let e = self.epoch;
        let (open, closed) = (2 * e, 2 * e + 1);
        // Search window: the box around both ends, widened for detours.
        let (sx, sy) = (q.start % n, q.start / n);
        let tx = ((q.target.x / f.cell) as usize).min(n - 1);
        let ty = ((q.target.y / f.cell) as usize).min(n - 1);
        let span = sx.abs_diff(tx).max(sy.abs_diff(ty));
        let margin = if q.tight { 24 } else { (span * 2 / 5).max(32) };
        let window = (
            sx.min(tx).saturating_sub(margin),
            sy.min(ty).saturating_sub(margin),
            (sx.max(tx) + margin).min(n - 1),
            (sy.max(ty) + margin).min(n - 1),
        );
        // A tight query is further limited to a corridor along the straight line.
        let axis = (q.target.x - q.origin.x, q.target.y - q.origin.y);
        let axis_len = axis.0.hypot(axis.1).max(1.0);
        let corridor = 30.0 * f.cell;
        let inside = |i: usize| {
            let (x, y) = (i % n, i / n);
            if !(x >= window.0 && x <= window.2 && y >= window.1 && y <= window.3) {
                return false;
            }
            if !q.tight {
                return true;
            }
            let p = f.pos(i);
            ((p.x - q.origin.x) * axis.1 - (p.y - q.origin.y) * axis.0).abs() / axis_len <= corridor
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
        // With no road yet there is nothing to share, so the full ground cost applies.
        let h_rate = if net.dirs.iter().any(|&d| d != 0) {
            costs.discount.max(0.3) + 0.15
        } else {
            0.9
        };
        let heuristic = |i: usize| {
            let x = i % n;
            let y = i / n;
            let dx = bounds.0.saturating_sub(x).max(x.saturating_sub(bounds.2)) as f64;
            let dy = bounds.1.saturating_sub(y).max(y.saturating_sub(bounds.3)) as f64;
            // Whole cell counts: one zero axis gives the other exactly, as `hypot` does.
            let len = if dx == 0.0 {
                dy
            } else if dy == 0.0 {
                dx
            } else {
                dx.hypot(dy)
            };
            f.cell * len * h_rate
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

        // Per-move constants, computed exactly as the move loop would.
        let mut dist = [0.0_f64; 24];
        for (d, &(dx, dy)) in DIRS.iter().enumerate() {
            dist[d] = f.cell * ((dx * dx + dy * dy) as f64).sqrt();
        }
        // Moves allowed after arriving by `came` (index 24: the start), off and on junctions.
        let mut allowed = [[0_u32; 25]; 2];
        for came in 0..25 {
            for d in 0..DIRS.len() {
                let angle = if came == 24 { 0.0 } else { turns.angle[came][d] };
                if angle <= max_turn {
                    allowed[0][came] |= 1 << d;
                }
                if angle <= 136.0 {
                    allowed[1][came] |= 1 << d;
                }
            }
        }
        let moves = move_masks(f, q.profile.causeway);
        let per = DIRS.len() - LONG;

        let queue = &mut self.queue;
        queue.v.clear();
        let first = q.start * HEADINGS;
        self.slots[first] = Slot {
            d: 0.0,
            stamp: open,
            link: NO_VIA << VIA_SHIFT,
        };
        queue.push(heuristic(q.start), first as u32);
        while let Some(state) = queue.pop() {
            let state = state as usize;
            let current = self.slots[state];
            if current.stamp == closed {
                continue;
            }
            self.slots[state].stamp = closed;
            let i = state / HEADINGS;
            if self.goal[i] == e {
                let mut cells = vec![i];
                let mut at = state;
                while at != first {
                    at = self.slots[at].parent();
                    cells.push(at / HEADINGS);
                }
                cells.reverse();
                return Some(cells);
            }
            let (x, y) = ((i % n) as isize, (i / n) as isize);
            let (came, here) = (current.via(), current.d);
            // Junctions and settlements may turn sharply: roads meet there at any angle.
            let free = net.on_road(i) || net.settled[i];
            let steep = 1.0 + 1.5 * f64::from(f.slope_s[i]).min(1.0);
            let came_index = if came == NO_VIA { 24 } else { came as usize };
            // Turn limit and passability (which includes the map bounds) as one mask.
            let mut mask = allowed[usize::from(free)][came_index] & moves[i];
            let road_dirs = net.dirs[i];
            let wet_i = f.r.water[i] != 0;
            let height_i = f.route_height[i];
            while mask != 0 {
                let d = mask.trailing_zeros() as usize;
                mask &= mask - 1;
                let (dx, dy) = DIRS[d];
                let road = road_dirs & (1 << d) != 0;
                let j = (y + dy) as usize * n + (x + dx) as usize;
                let next = j * HEADINGS + turns.sector[d];
                if self.slots[next].stamp == closed || !inside(j) {
                    continue;
                }
                let dist = dist[d];
                let wet = wet_i || f.r.water[j] != 0;
                // Over water the road height is the bridge deck or causeway (see `deck_height`).
                let grade = if d >= LONG {
                    long[i * per + d - LONG] as f64
                } else {
                    (height_i - f.route_height[j]).abs() as f64 / dist
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
                    let angle = if came == NO_VIA { 0.0 } else { turns.angle[came as usize][d] };
                    turn_cost * steep * (angle / 45.0).powi(2)
                };
                let mut m = if road {
                    // An existing road move (with its bridge, if any).
                    costs.discount * if wet { 2.0 } else { 1.0 }
                } else if self.cell_cost[j].0 == e {
                    self.cell_cost[j].1
                } else {
                    let ground = match f.r.water[j] {
                        3 => (if f.r.river_width[j] > 3.7 { 30.0 } else { 40.0 }) * river_base,
                        2 => 20.0 * costs.crossing_cost,
                        _ => costs.land[j] as f64,
                    };
                    // Meandering fades on steep ground, where the grade rules the line: noise there
                    // would bunch switchbacks into its cheap patches.
                    let flat = f.flat[j];
                    let meander = (1.0 + wobble * flat * costs.noise[j] as f64).max(0.5);
                    let beside = if net.settled[j] || net.on_road(j) {
                        1.0
                    } else {
                        1.0 + costs.near * f64::from(net.near[j]) * 0.5
                    };
                    let straight = if q.profile.straightness > 0.0 && line_len > 0.0 {
                        let p = f.pos(j);
                        let perp = ((p.x - q.origin.x) * line.1 - (p.y - q.origin.y) * line.0)
                            .abs()
                            / line_len;
                        1.0 + q.profile.straightness * (perp / straight_scale).min(5.0)
                    } else {
                        1.0
                    };
                    let value = ground * meander * beside * straight;
                    self.cell_cost[j] = (e, value);
                    value
                };
                if f.r.water[j] == 3 && !river_penalty.is_empty() {
                    m *= river_penalty.get(&f.r.river_ids[j]).copied().unwrap_or(1.0);
                }
                let cost = here + dist * slope * m + turn;
                let slot = &mut self.slots[next];
                if slot.stamp != open || cost < slot.d {
                    slot.stamp = open;
                    slot.d = cost;
                    slot.link = state as u32 | (d as u32) << VIA_SHIFT;
                    queue.push(cost + heuristic(j), next as u32);
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
