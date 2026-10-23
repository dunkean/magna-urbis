//! Native quarter fixture, guidance field, recursive street cuts and ribbon carving.
use super::footprint::capacity;
use super::geometry as g;
use super::{
    Block, CapacityPlan, Layout, LayoutConfig, Morph, Point, Quarter, Shape, Site, Street, Surface,
    composition, macroplan, network, profiles, routing,
};
use crate::{noise::Noise, rng::Rng};
use geo::BooleanOps;
use std::f64::consts::{FRAC_PI_2, PI, TAU};
use std::sync::OnceLock;

#[derive(Clone, Copy)]
struct Frame {
    c: Point,
    u: Point,
    v: Point,
    hu: f64,
    hv: f64,
}
fn frame(s: &Shape) -> Frame {
    let mut best = None;
    let mut ba = f64::INFINITY;
    for i in 0..s.outer.len() {
        let a = s.outer[i];
        let b = s.outer[(i + 1) % s.outer.len()];
        let l = (b.x - a.x).hypot(b.y - a.y);
        if l < 1e-8 {
            continue;
        }
        let u = Point {
            x: (b.x - a.x) / l,
            y: (b.y - a.y) / l,
        };
        let v = Point { x: -u.y, y: u.x };
        let (mut x0, mut y0, mut x1, mut y1) = (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        );
        for p in &s.outer {
            let x = p.x * u.x + p.y * u.y;
            let y = p.x * v.x + p.y * v.y;
            x0 = x0.min(x);
            x1 = x1.max(x);
            y0 = y0.min(y);
            y1 = y1.max(y)
        }
        let ar = (x1 - x0) * (y1 - y0);
        if ar < ba {
            ba = ar;
            let mut f = Frame {
                c: Point {
                    x: u.x * (x0 + x1) * 0.5 + v.x * (y0 + y1) * 0.5,
                    y: u.y * (x0 + x1) * 0.5 + v.y * (y0 + y1) * 0.5,
                },
                u,
                v,
                hu: (x1 - x0) * 0.5,
                hv: (y1 - y0) * 0.5,
            };
            if f.hu < f.hv {
                std::mem::swap(&mut f.u, &mut f.v);
                std::mem::swap(&mut f.hu, &mut f.hv)
            }
            best = Some(f)
        }
    }
    best.unwrap_or(Frame {
        c: g::centroid(s),
        u: Point { x: 1.0, y: 0.0 },
        v: Point { x: 0.0, y: 1.0 },
        hu: 0.0,
        hv: 0.0,
    })
}
fn len(path: &[Point]) -> f64 {
    path.windows(2)
        .map(|q| (q[0].x - q[1].x).hypot(q[0].y - q[1].y))
        .sum()
}
fn smooth(x: f64, a: f64, b: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
fn zone_at(p: Point, center: Point, radius: f64, population: u32) -> &'static str {
    let d = (p.x - center.x).hypot(p.y - center.y) / radius;
    if population < 500 {
        "village"
    } else if d < 0.4 {
        "core"
    } else if d < 0.72 {
        "middle"
    } else {
        "edge"
    }
}
fn delta(a: f64, b: f64) -> f64 {
    (a - b + PI).rem_euclid(TAU) - PI
}
fn nearest(p: Point, streets: &[Street], max_rank: usize) -> Option<(f64, f64)> {
    let mut best = f64::INFINITY;
    let mut segment = None;
    for q in streets
        .iter()
        .filter(|s| s.rank <= max_rank)
        .flat_map(|s| s.path.windows(2))
    {
        let dx = (q[0].x.min(q[1].x) - p.x)
            .max(0.0)
            .max(p.x - q[0].x.max(q[1].x));
        let dy = (q[0].y.min(q[1].y) - p.y)
            .max(0.0)
            .max(p.y - q[0].y.max(q[1].y));
        if dx * dx + dy * dy > best * best {
            continue;
        }
        let d = g::distance(p, q[0], q[1]).0;
        if d < best {
            best = d;
            segment = Some((q[0], q[1]));
        }
    }
    segment.map(|(a, b)| (best, (b.y - a.y).atan2(b.x - a.x)))
}
/// Uniform segment bins over the growing street list. Streets are only appended
/// while quarters are cut, so `sync` indexes the new tail incrementally. Queries
/// return exactly what a linear scan within the same reach returns.
pub(super) struct Bins {
    cell: f64,
    max_rank: usize,
    map: std::collections::HashMap<(i64, i64), Vec<(u32, u32)>>,
    indexed: usize,
}
impl Bins {
    /// Index only streets of rank <= `max_rank` (arterial queries stay cheap).
    pub(super) fn new(cell: f64, max_rank: usize) -> Self {
        Self {
            cell,
            max_rank,
            map: std::collections::HashMap::new(),
            indexed: 0,
        }
    }
    fn cells(&self, a: Point, b: Point, pad: f64) -> impl Iterator<Item = (i64, i64)> + use<> {
        let c = self.cell;
        let (x0, x1) = (
            ((a.x.min(b.x) - pad) / c).floor() as i64,
            ((a.x.max(b.x) + pad) / c).floor() as i64,
        );
        let (y0, y1) = (
            ((a.y.min(b.y) - pad) / c).floor() as i64,
            ((a.y.max(b.y) + pad) / c).floor() as i64,
        );
        (y0..=y1).flat_map(move |y| (x0..=x1).map(move |x| (x, y)))
    }
    pub(super) fn sync(&mut self, streets: &[Street]) {
        if streets.len() < self.indexed {
            self.map.clear();
            self.indexed = 0;
        }
        for (i, s) in streets.iter().enumerate().skip(self.indexed) {
            if s.rank > self.max_rank {
                continue;
            }
            for (j, w) in s.path.windows(2).enumerate() {
                for cell in self.cells(w[0], w[1], 0.0) {
                    self.map.entry(cell).or_default().push((i as u32, j as u32));
                }
            }
        }
        self.indexed = streets.len();
    }
    fn around(&self, p: Point, reach: f64) -> impl Iterator<Item = (usize, usize)> + '_ {
        self.cells(p, p, reach)
            .filter_map(|cell| self.map.get(&cell))
            .flatten()
            .map(|&(i, j)| (i as usize, j as usize))
    }
    /// Nearest segment of rank <= `max_rank` within `reach`: distance and heading.
    pub(super) fn nearest(
        &self,
        p: Point,
        streets: &[Street],
        max_rank: usize,
        reach: f64,
    ) -> Option<(f64, f64)> {
        let mut best = (reach, None);
        for (i, j) in self.around(p, reach) {
            let s = &streets[i];
            if s.rank > max_rank {
                continue;
            }
            let (a, b) = (s.path[j], s.path[j + 1]);
            let d = g::distance(p, a, b).0;
            if d < best.0 || best.1.is_none() && d <= reach {
                best = (d, Some((b.y - a.y).atan2(b.x - a.x)));
            }
        }
        best.1.map(|angle| (best.0, angle))
    }
    /// Whether the open polyline crosses any indexed street.
    pub(super) fn crosses(&self, path: &[Point], streets: &[Street]) -> bool {
        path.windows(2).any(|cut| {
            self.cells(cut[0], cut[1], 0.0)
                .filter_map(|cell| self.map.get(&cell))
                .flatten()
                .any(|&(i, j)| {
                    let s = &streets[i as usize];
                    let j = j as usize;
                    g::segment_hit(cut[0], cut[1], s.path[j], s.path[j + 1]).is_some()
                })
        })
    }
}
/// Ribbon polygons binned by bounding box: a piece visits only the ribbons
/// whose box shares a cell with its own, in ascending ribbon order (the order
/// of the former linear scan, so the successive differences are unchanged).
struct RibbonBins {
    cell: f64,
    map: std::collections::HashMap<(i64, i64), Vec<u32>>,
}
impl RibbonBins {
    fn new(ribbons: &[(geo::Polygon<f64>, (f64, f64, f64, f64))]) -> Self {
        let cell = 100.0;
        let mut map: std::collections::HashMap<(i64, i64), Vec<u32>> = Default::default();
        for (k, (_, b)) in ribbons.iter().enumerate() {
            for y in (b.1 / cell).floor() as i64..=(b.3 / cell).floor() as i64 {
                for x in (b.0 / cell).floor() as i64..=(b.2 / cell).floor() as i64 {
                    map.entry((x, y)).or_default().push(k as u32);
                }
            }
        }
        Self { cell, map }
    }
    fn candidates(&self, b: (f64, f64, f64, f64)) -> Vec<usize> {
        let c = self.cell;
        let mut out: Vec<usize> = vec![];
        for y in (b.1 / c).floor() as i64..=(b.3 / c).floor() as i64 {
            for x in (b.0 / c).floor() as i64..=(b.2 / c).floor() as i64 {
                if let Some(v) = self.map.get(&(x, y)) {
                    out.extend(v.iter().map(|&k| k as usize));
                }
            }
        }
        out.sort_unstable();
        out.dedup();
        out
    }
}
/// `macroplan::regional_axis` over binned segments: only the segments within
/// `reach` contribute to a road's score, so visiting the 3x3 cells of size
/// `reach` around a point gives the same choice without scanning whole roads.
/// The answer is the tangent of a road segment, already piecewise constant, so
/// it is memoised per small cell (reach/50, 10-40 m) during tracing.
pub(super) struct RegionalIndex<'a> {
    roads: &'a [Street],
    reach: f64,
    map: std::collections::HashMap<(i64, i64), Vec<(u32, u32)>>,
    memo: std::sync::Mutex<std::collections::HashMap<(i64, i64), Option<f64>>>,
}
impl<'a> RegionalIndex<'a> {
    pub(super) fn new(roads: &'a [Street], reach: f64) -> Self {
        let reach = reach.max(1.0);
        let mut map: std::collections::HashMap<(i64, i64), Vec<(u32, u32)>> = Default::default();
        for (i, s) in roads.iter().enumerate() {
            if !matches!(
                s.role.as_str(),
                "regional" | "bridge" | "ford" | "causeway" | "approach"
            ) {
                continue;
            }
            for (j, w) in s.path.windows(2).enumerate() {
                let (x0, x1) = (
                    (w[0].x.min(w[1].x) / reach).floor() as i64,
                    (w[0].x.max(w[1].x) / reach).floor() as i64,
                );
                let (y0, y1) = (
                    (w[0].y.min(w[1].y) / reach).floor() as i64,
                    (w[0].y.max(w[1].y) / reach).floor() as i64,
                );
                for y in y0..=y1 {
                    for x in x0..=x1 {
                        map.entry((x, y)).or_default().push((i as u32, j as u32));
                    }
                }
            }
        }
        Self {
            roads,
            reach,
            map,
            memo: Default::default(),
        }
    }
    pub(super) fn axis(&self, p: Point) -> Option<f64> {
        let step = (self.reach / 50.0).clamp(10.0, 40.0);
        let key = ((p.x / step).floor() as i64, (p.y / step).floor() as i64);
        if let Some(&v) = self.memo.lock().unwrap().get(&key) {
            return v;
        }
        let centre = Point {
            x: (key.0 as f64 + 0.5) * step,
            y: (key.1 as f64 + 0.5) * step,
        };
        let v = self.exact(centre);
        self.memo.lock().unwrap().insert(key, v);
        v
    }
    fn exact(&self, p: Point) -> Option<f64> {
        let reach = self.reach;
        let (cx, cy) = ((p.x / reach).floor() as i64, (p.y / reach).floor() as i64);
        let mut segments: Vec<(u32, u32)> = vec![];
        for y in cy - 1..=cy + 1 {
            for x in cx - 1..=cx + 1 {
                if let Some(v) = self.map.get(&(x, y)) {
                    segments.extend(v);
                }
            }
        }
        segments.sort_unstable();
        segments.dedup();
        // (rank, score, index, nearest distance, angle) per road, in road order.
        let mut best: Option<(usize, f64, usize, f64)> = None;
        let mut current: Option<(usize, f64, f64, f64)> = None;
        let finish = |c: Option<(usize, f64, f64, f64)>,
                      best: &mut Option<(usize, f64, usize, f64)>| {
            if let Some((i, score, _, angle)) = c {
                let rank = self.roads[i].rank;
                let better = best.is_none_or(|(r, s, b, _)| {
                    rank.cmp(&r)
                        .then_with(|| s.total_cmp(&score))
                        .then_with(|| i.cmp(&b))
                        .is_lt()
                });
                if better {
                    *best = Some((rank, score, i, angle));
                }
            }
        };
        for (i, j) in segments {
            let (i, j) = (i as usize, j as usize);
            let s = &self.roads[i];
            let pair = [s.path[j], s.path[j + 1]];
            let length = (pair[0].x - pair[1].x).hypot(pair[0].y - pair[1].y);
            let (d, _, _) = g::distance(p, pair[0], pair[1]);
            if length <= 1e-6 || d > reach {
                continue;
            }
            if current.is_some_and(|c| c.0 != i) {
                finish(current.take(), &mut best);
            }
            let width = s
                .widths
                .get(j)
                .copied()
                .or_else(|| s.widths.last().copied())
                .unwrap_or(4.0);
            let gain = length.min(reach * 2.0) * width / (1.0 + d / (reach * 0.3).max(1.0)).powi(2);
            let angle = (pair[1].y - pair[0].y).atan2(pair[1].x - pair[0].x);
            let c = current.get_or_insert((i, 0.0, f64::INFINITY, angle));
            c.1 += gain;
            if d < c.2 {
                c.2 = d;
                c.3 = angle;
            }
        }
        finish(current.take(), &mut best);
        best.map(|b| b.3)
    }
}
fn acute_ends(s: &Shape, path: &[Point]) -> bool {
    let r = &s.outer;
    for (i, &p) in r.iter().enumerate() {
        if ![path[0], *path.last().unwrap()]
            .iter()
            .any(|q| (q.x - p.x).hypot(q.y - p.y) < 0.05)
        {
            continue;
        }
        let a = r[(i + r.len() - 1) % r.len()];
        let b = r[(i + 1) % r.len()];
        let u = Point {
            x: a.x - p.x,
            y: a.y - p.y,
        };
        let v = Point {
            x: b.x - p.x,
            y: b.y - p.y,
        };
        let angle = ((u.x * v.x + u.y * v.y) / (u.x.hypot(u.y) * v.x.hypot(v.y)).max(1e-9))
            .clamp(-1.0, 1.0)
            .acos();
        if angle < 25.0 * PI / 180.0 {
            return true;
        }
    }
    false
}
/// A read of the street network by a quarter cut: what the network before the
/// pass plus the cut's own streets gave (`own`), and the answer the cut used
/// (`seen`, with the other quarters' streets it was shown). A cut depends on
/// the other quarters only through these reads, so it is exact for the true
/// earlier streets when every read gives the same answer with them.
enum Read {
    Near {
        p: Point,
        max_rank: usize,
        reach: f64,
        own: Option<f64>,
        seen: Option<f64>,
    },
    Cross {
        path: Vec<Point>,
        own: bool,
        seen: bool,
    },
}
/// Streets of other quarters shown to a cut, with their bins.
type Layer<'a> = (&'a [Street], &'a Bins);
impl Read {
    /// Whether the read gives the answer the cut used when the other
    /// quarters' streets are `layers`.
    fn holds(&self, layers: &[Layer<'_>]) -> bool {
        match self {
            Read::Near {
                p,
                max_rank,
                reach,
                own,
                seen,
            } => {
                let answer = layers
                    .iter()
                    .filter_map(|(s, b)| b.nearest(*p, s, *max_rank, *reach))
                    .map(|v| v.0)
                    .chain(*own)
                    .min_by(f64::total_cmp);
                answer.map(f64::to_bits) == seen.map(f64::to_bits)
            }
            Read::Cross { path, own, seen } => {
                (*own || layers.iter().any(|(s, b)| b.crosses(path, s))) == *seen
            }
        }
    }
}
struct Field<'a> {
    regional: &'a RegionalIndex<'a>,
    align_regional: bool,
    adaptation: f64,
    p: &'a Morph,
    center: Point,
    angle: f64,
    terrain: f64,
    water: f64,
    surface: Surface<'a>,
    noise: Noise,
    radius: f64,
    population: u32,
    radial: bool,
    phases: &'a [super::GrowthPhase],
    phase_morphs: &'a [Morph],
    phase_index: &'a [(usize, g::ContainmentIndex)],
    /// The network before this pass (shared by every quarter cut in
    /// parallel) and its bins, for junction and crossing tests.
    base: &'a [Street],
    base_bins: &'a Bins,
    /// Streets of the earlier quarters of this pass shown to this cut (empty
    /// in the first, speculative parallel cut; see `Read`).
    others: &'a [Layer<'a>],
    /// Streets this cut added itself, indexed incrementally.
    bins: &'a std::sync::Mutex<Bins>,
    /// Log of the network reads of a speculative cut (see `Read`).
    reads: Option<&'a std::sync::Mutex<Vec<Read>>>,
    /// Rank <= 1 streets of `base`, which steer the local street field (no
    /// pass adds a street of rank <= 1).
    major: &'a Bins,
    /// Planned grid frame: the orientation of the grid at the quarter's centre,
    /// shared by every grid piece around that centre on gentle ground, so a
    /// castrum, a ward city or a bastide keeps continuous streets and 4-way
    /// crossings across its quarters instead of re-aiming each block.
    frame: Option<f64>,
}
impl Field<'_> {
    /// Distance to the nearest street of rank <= `max_rank` within `reach`,
    /// over the shared network and the streets `local` of this pass.
    fn street_distance(
        &self,
        p: Point,
        local: &[Street],
        max_rank: usize,
        reach: f64,
    ) -> Option<f64> {
        let local_near = {
            let mut bins = self.bins.lock().unwrap();
            bins.sync(local);
            bins.nearest(p, local, max_rank, reach)
        };
        let min = |a: Option<f64>, b: Option<f64>| a.into_iter().chain(b).min_by(f64::total_cmp);
        let own = min(
            self.base_bins
                .nearest(p, self.base, max_rank, reach)
                .map(|v| v.0),
            local_near.map(|v| v.0),
        );
        let seen = self
            .others
            .iter()
            .filter_map(|(s, b)| b.nearest(p, s, max_rank, reach))
            .map(|v| v.0)
            .fold(own, |a, d| min(a, Some(d)));
        if let Some(reads) = self.reads {
            reads.lock().unwrap().push(Read::Near {
                p,
                max_rank,
                reach,
                own,
                seen,
            });
        }
        seen
    }
    /// Whether the open polyline crosses the shared network or `local`.
    fn crosses_street(&self, path: &[Point], local: &[Street]) -> bool {
        let own = self.base_bins.crosses(path, self.base) || {
            let mut bins = self.bins.lock().unwrap();
            bins.sync(local);
            bins.crosses(path, local)
        };
        let seen = own || self.others.iter().any(|(s, b)| b.crosses(path, s));
        if let Some(reads) = self.reads {
            reads.lock().unwrap().push(Read::Cross {
                path: path.to_vec(),
                own,
                seen,
            });
        }
        seen
    }
    fn phase_at(&self, p: Point) -> Option<usize> {
        if !self.phase_index.is_empty() {
            return self
                .phase_index
                .iter()
                .find(|(_, s)| s.contains(p))
                .map(|(i, _)| *i);
        }
        self.phases
            .iter()
            .position(|phase| phase.shapes.iter().any(|s| g::contains(s, p)))
    }
    fn morph_at(&self, p: Point) -> &Morph {
        self.phase_at(p)
            .and_then(|i| self.phase_morphs.get(i))
            .unwrap_or(self.p)
    }
    fn gradient(&self, p: Point, r: f64) -> (f64, f64) {
        (
            (self.surface.height_at(Point { x: p.x + r, y: p.y })
                - self.surface.height_at(Point { x: p.x - r, y: p.y }))
                / (2.0 * r),
            (self.surface.height_at(Point { x: p.x, y: p.y + r })
                - self.surface.height_at(Point { x: p.x, y: p.y - r }))
                / (2.0 * r),
        )
    }
    fn adapt_angle(&self, p: Point, angle: f64) -> f64 {
        if self.adaptation == 0.0 {
            return angle;
        }
        let (gx, gy) = self.gradient(
            p,
            (self.surface.width / self.surface.n as f64).clamp(10.0, 35.0),
        );
        let slope = gx.hypot(gy);
        let w = (self.adaptation * 0.85 * smooth(slope, 0.015, 0.10)).min(0.92);
        let contour = gy.atan2(gx) + FRAC_PI_2;
        let mut cx = (1.0 - w) * (4.0 * angle).cos() + w * (4.0 * contour).cos();
        let mut cy = (1.0 - w) * (4.0 * angle).sin() + w * (4.0 * contour).sin();
        let (mut wx, mut wy, mut weight) = (0.0, 0.0, 0.0);
        // The physical sampling stencil is identical at every integration
        // step. Compute its trigonometry once, retaining the accumulation order.
        static PROBES: OnceLock<[(Point, Point, f64); 48]> = OnceLock::new();
        let probes = PROBES.get_or_init(|| {
            std::array::from_fn(|j| {
                let radius = [15.0, 35.0, 70.0][j / 16];
                let a = (j % 16) as f64 * TAU / 16.0;
                let v = (-radius / 35.0_f64).exp();
                (
                    Point {
                        x: radius * a.cos(),
                        y: radius * a.sin(),
                    },
                    Point {
                        x: a.cos() * v,
                        y: a.sin() * v,
                    },
                    v,
                )
            })
        });
        for &(offset, contribution, v) in probes {
            let q = Point {
                x: p.x + offset.x,
                y: p.y + offset.y,
            };
            // The 15-70 m bank stencil only orients the field: the terrain
            // raster suffices, without an exact vector-water test per probe.
            let n = self.surface.n;
            if q.x >= 0.0
                && q.y >= 0.0
                && q.x < self.surface.width
                && q.y < self.surface.width
                && self.surface.water[((q.y / self.surface.width * n as f64) as usize).min(n - 1)
                    * n
                    + ((q.x / self.surface.width * n as f64) as usize).min(n - 1)]
                    != 0
            {
                wx += contribution.x;
                wy += contribution.y;
                weight += v;
            }
        }
        if weight > 0.0 && wx.hypot(wy) > 0.1 {
            let tangent = wy.atan2(wx) + FRAC_PI_2;
            let w = (self.adaptation * wx.hypot(wy) / (weight + 1.0)).min(0.90);
            cx = (1.0 - w) * cx + w * (4.0 * tangent).cos();
            cy = (1.0 - w) * cy + w * (4.0 * tangent).sin();
        }
        cy.atan2(cx) / 4.0
    }
    /// Noise and cultural/regional base orientation of the field at `p`.
    fn base(&self, p: Point, m: &Morph) -> (f64, f64) {
        let wl = m.number("fieldWavelength").max(1.0);
        let nz = m.number("fieldNoise").to_radians() * self.noise.fbm(p.x / wl, p.y / wl, 2);
        let cultural_base = match m.text("orientation") {
            "cardinal" => 0.0,
            "terrain" => self.terrain,
            "water" => self.water,
            _ => self.angle,
        };
        let base = if self.align_regional {
            self.regional.axis(p).unwrap_or(cultural_base)
        } else {
            cultural_base
        };
        (nz, base)
    }
    fn grid_angle(&self, p: Point, m: &Morph) -> f64 {
        let (nz, base) = self.base(p, m);
        self.adapt_angle(
            p,
            base + nz
                + m.number("gridSkew") * self.noise.fbm(p.x / 600.0 + 9.0, p.y / 600.0 - 3.0, 2),
        )
    }
    /// Grid orientation at a quarter centre, whatever the tissue found there.
    fn grid_frame(&self, p: Point) -> f64 {
        self.grid_angle(p, self.morph_at(p))
    }
    fn angle(&self, p: Point) -> f64 {
        let m = self.morph_at(p);
        let (nz, base) = self.base(p, m);
        let (gx, gy) = self.gradient(p, 70.0);
        let slope = gx.hypot(gy);
        if m.text("streetOp") == "grid" {
            if let Some(frame) = self.frame.filter(|_| slope < 0.08) {
                return frame;
            }
            return self.grid_angle(p, m);
        }
        let contour = gy.atan2(gx) + FRAC_PI_2;
        let cf = m.number_or("contourFollow", 0.0);
        let th = if self.radial {
            (p.y - self.center.y).atan2(p.x - self.center.x)
        } else {
            base
        } + m.number("fieldTwist");
        let mut cx = (4.0 * th).cos();
        let mut cy = (4.0 * th).sin();
        if cf > 0.0 {
            let w = cf * smooth(slope, 0.02, 0.06);
            cx = (1.0 - w) * (4.0 * self.terrain).cos() + w * (4.0 * contour).cos();
            cy = (1.0 - w) * (4.0 * self.terrain).sin() + w * (4.0 * contour).sin();
            return self.adapt_angle(p, cy.atan2(cx) / 4.0);
        }
        let wr = m.number("fieldRandom");
        let psi = PI * self.noise.fbm(p.x / 260.0 + 31.7, p.y / 260.0 - 12.3, 2);
        cx = (1.0 - wr) * cx + wr * (4.0 * psi).cos();
        cy = (1.0 - wr) * cy + wr * (4.0 * psi).sin();
        // Beyond 150 m the street's pull (0.85 exp(-d/35)) is below 1 %.
        let near = self.major.nearest(p, self.base, 1, 150.0);
        if let Some((d, a)) = near {
            let w = 0.85 * (-d / 35.0).exp();
            cx = (1.0 - w) * cx + w * (4.0 * a).cos();
            cy = (1.0 - w) * cy + w * (4.0 * a).sin()
        }
        let cb = m.number_or("contourBlend", 0.0);
        let w = (0.75 * smooth(slope, 0.06, 0.14)).max(cb * smooth(slope, 0.025, 0.08));
        cx = (1.0 - w) * cx + w * (4.0 * contour).cos();
        cy = (1.0 - w) * cy + w * (4.0 * contour).sin();
        self.adapt_angle(p, cy.atan2(cx) / 4.0)
            + nz * (0.5
                + 0.5
                    * smooth(
                        (p.x - self.center.x).hypot(p.y - self.center.y),
                        20.0,
                        120.0,
                    ))
    }
    fn trace(&self, s: &Shape, seed: Point, heading: f64, max_grade: f64) -> Option<Vec<Point>> {
        let mut out = vec![seed];
        let mut cur = seed;
        let mut head = heading;
        let turn = (self.p.number("curvature") + self.adaptation * 1.5) * 5.0 * PI / 180.0;
        for _ in 0..800 {
            let a = self.angle(cur);
            let dh = (0..4)
                .map(|k| delta(a + k as f64 * FRAC_PI_2, head))
                .min_by(|a, b| a.abs().total_cmp(&b.abs()))?;
            let desired = head + dh.clamp(-turn, turn);
            let (next_heading, nx, ends) = [0.0, 0.12, -0.12, 0.28, -0.28, 0.5, -0.5, 0.8, -0.8]
                .into_iter()
                .map(|offset| {
                    let h = desired + offset;
                    let next = Point {
                        x: cur.x + h.cos() * 5.0,
                        y: cur.y + h.sin() * 5.0,
                    };
                    let hit = s
                        .outer
                        .iter()
                        .zip(s.outer.iter().cycle().skip(1))
                        .take(s.outer.len())
                        .filter_map(|(&a, &b)| g::segment_hit(cur, next, a, b))
                        .min_by(|a, b| a.0.total_cmp(&b.0));
                    if let Some((_, p)) = hit {
                        (
                            h,
                            Point {
                                x: p.x + (cur.x - p.x) * 1e-8,
                                y: p.y + (cur.y - p.y) * 1e-8,
                            },
                            true,
                        )
                    } else {
                        (h, next, false)
                    }
                })
                .find(|(_, next, _)| routing::segment_clear(self.surface, cur, *next, max_grade))?;
            head = next_heading;
            if ends {
                out.push(nx);
                return Some(out);
            }
            if !g::contains(s, nx) {
                return None;
            }
            if out.len() > 8
                && out[..out.len() - 6]
                    .windows(2)
                    .any(|q| g::segment_hit(cur, nx, q[0], q[1]).is_some())
            {
                return None;
            }
            out.push(nx);
            cur = nx;
        }
        None
    }
}
fn add(
    streets: &mut Vec<Street>,
    path: Vec<Point>,
    rank: usize,
    role: &str,
    m: &Morph,
    rng: &mut Rng,
) {
    if path.len() < 2 || len(&path) < 0.2 {
        return;
    }
    // Width changes are gradual along the street, not a new jitter every 5 m.
    let wa = m.width(rank, rng);
    let wb = m.width(rank, rng);
    let length = len(&path);
    let mut at = 0.0;
    let widths = path
        .iter()
        .enumerate()
        .map(|(i, p)| {
            if i > 0 {
                at += (p.x - path[i - 1].x).hypot(p.y - path[i - 1].y);
            }
            let width = wa + (wb - wa) * at / length;
            if role == "stairs" {
                width.min(2.2)
            } else {
                width
            }
        })
        .collect();
    streets.push(Street {
        path,
        widths,
        rank,
        role: role.into(),
    })
}
#[derive(Clone)]
struct Piece {
    shape: Shape,
    level: usize,
    kind: String,
}
type Candidate = (f64, Shape, Shape, Vec<Point>, usize, bool, bool);
/// One quarter cut: its pieces, the streets it added, its edited phase.
type CutQuarter = (Vec<Piece>, Vec<Street>, Option<super::GrowthPhase>);
/// Orientation of a planned grid's armature: the straight quarter street
/// nearest the lattice origin, taken modulo a right angle, on the side
/// closest to the field's own grid orientation `hint`.
fn armature_frame(streets: &[Street], origin: Point, hint: f64) -> Option<f64> {
    streets
        .iter()
        .filter(|s| s.role == "street" && s.rank <= 1 && s.path.len() == 2)
        .filter(|s| len(&s.path) > 20.0)
        .min_by(|a, b| {
            g::distance(origin, a.path[0], a.path[1])
                .0
                .total_cmp(&g::distance(origin, b.path[0], b.path[1]).0)
        })
        .map(|s| {
            let t = (s.path[1].y - s.path[0].y).atan2(s.path[1].x - s.path[0].x);
            [t, t + FRAC_PI_2]
                .into_iter()
                .max_by(|a, b| (a - hint).cos().abs().total_cmp(&(b - hint).cos().abs()))
                .unwrap()
        })
}

/// Whether a line of the planned grid lattice (wards first, then lanes)
/// crosses `shape` with at least `minWidth` of land on each side.
fn lattice_lines(shape: &Shape, field: &Field<'_>, m: &Morph) -> bool {
    let angle = field.angle(g::interior_point(shape));
    let lanes = m.pair("laneSpacing");
    let coarse = m.pair("gridSpacing");
    let ward = g::area(shape) >= m.number("wardArea") || (lanes[0] <= 0.0 && lanes[1] <= 0.0);
    let spacing = if ward { coarse } else { lanes };
    let margin = m.number("minWidth");
    (0..2).any(|fi| {
        let heading = angle + fi as f64 * FRAC_PI_2;
        let n = Point {
            x: -heading.sin(),
            y: heading.cos(),
        };
        let sp = spacing[if (heading - field.frame.unwrap_or(field.angle)).cos().abs() > 0.7 {
            0
        } else {
            1
        }];
        if sp <= 0.0 {
            return false;
        }
        let project = |p: Point| (p.x - field.center.x) * n.x + (p.y - field.center.y) * n.y;
        let (lo, hi) = shape
            .outer
            .iter()
            .map(|&p| project(p))
            .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), v| {
                (a.min(v), b.max(v))
            });
        let k = ((lo + margin) / sp).ceil();
        k * sp < hi - margin
    })
}

/// One recursive cut through `seed` along `heading`: traced within the street
/// grades, snapped onto the piece's junctions, connected to the network, and
/// both children admissible. Returns its cost (balance, grade, slenderness).
#[allow(clippy::too_many_arguments)]
fn cut_candidate(
    pc: &Piece,
    field: &Field<'_>,
    cfg: &LayoutConfig,
    streets: &[Street],
    m: &Morph,
    seed: Point,
    heading: f64,
    rank: usize,
    places: usize,
    a0: f64,
    rng: &mut Rng,
) -> Option<Candidate> {
    if !g::contains(&pc.shape, seed) {
        return None;
    }
    let grade = if rank < 3 {
        cfg.max_street_grade
    } else {
        cfg.max_lane_grade
    };
    let trace = |limit| {
        Some((
            field.trace(&pc.shape, seed, heading + PI, limit)?,
            field.trace(&pc.shape, seed, heading, limit)?,
        ))
    };
    let Some((mut back, front)) =
        trace(grade)
            .or_else(|| trace(cfg.max_lane_grade))
            .or_else(|| {
                if cfg.allow_stairs {
                    trace(cfg.max_stair_grade)
                } else {
                    None
                }
            })
    else {
        return None;
    };
    back.reverse();
    back.extend(front.into_iter().skip(1));
    // The 5 m integration steps carry no shape below half a metre.
    // Fewer vertices make every later split, ribbon and boolean cheaper.
    let simple = g::simplify(&back, 0.5, |_| false);
    if simple.len() < back.len() && routing::path_clear(field.surface, &simple, cfg.max_stair_grade)
    {
        back = simple;
    }
    // Snap onto shared junction vertices, preserving the exact boundary partition.
    let mut snapped = back.clone();
    for end in [0, back.len() - 1] {
        if let Some(&v) = pc
            .shape
            .outer
            .iter()
            .filter(|p| (p.x - back[end].x).hypot(p.y - back[end].y) < 6.0)
            .min_by(|a, b| {
                (a.x - back[end].x)
                    .hypot(a.y - back[end].y)
                    .total_cmp(&(b.x - back[end].x).hypot(b.y - back[end].y))
            })
        {
            snapped[end] = v;
        }
    }
    let allowed = if cfg.allow_stairs {
        cfg.max_stair_grade
    } else {
        cfg.max_lane_grade
    };
    let snapped_split = if routing::path_clear(field.surface, &snapped, allowed) {
        g::split(&pc.shape, &snapped)
    } else {
        None
    };
    if snapped_split.is_some() {
        back = snapped;
    }
    // Every recursive street must connect to the existing primary or recursive network.
    let connected = [back[0], *back.last().unwrap()].iter().any(|&p| {
        field
            .street_distance(p, streets, 4, 0.2)
            .is_some_and(|d| d < 0.2)
    }) || field.crosses_street(&back, streets);
    if !connected {
        return None;
    }
    // The snap validation already computed these exact children.
    let Some((a, b)) = snapped_split.or_else(|| g::split(&pc.shape, &back)) else {
        return None;
    };
    let aa = g::area(&a);
    let ab = g::area(&b);
    let can_place = |ar: f64| {
        m.text("streetOp") == "organic"
            && ar >= 120.0
            && ar <= m.number("placeThreshold")
            && places < 6
    };
    let bad_a = aa < m.number("minBlock") || acute_ends(&a, &back);
    let bad_b = ab < m.number("minBlock") || acute_ends(&b, &back);
    let pa = bad_a && can_place(aa);
    let pb = bad_b && can_place(ab);
    if bad_a && !pa || bad_b && !pb {
        return None;
    }
    let fa = frame(&a);
    let fb = frame(&b);
    if fa.hv * 2.0 < if pa { 6.0 } else { m.number("minWidth") }
        || fb.hv * 2.0 < if pb { 6.0 } else { m.number("minWidth") }
    {
        return None;
    }
    let steepest = back
        .windows(2)
        .map(|p| routing::segment_grade(field.surface, p[0], p[1]))
        .fold(0.0, f64::max);
    let cost = (aa - ab).abs() / a0
        + if steepest > cfg.max_lane_grade {
            0.8
        } else if steepest > grade {
            0.2
        } else {
            0.0
        }
        + 0.25
            * ((fa.hu / fa.hv.max(1.0) - 2.5).max(0.0) + (fb.hu / fb.hv.max(1.0) - 2.5).max(0.0))
        + rng.float() * 0.08;
    Some((cost, a, b, back, rank, pa, pb))
}
/// Straight cut of a large piece through holes: from a street contact (or the
/// middle) across to the outer edge on both sides. The land splits along a
/// hairline; the street is the chord without its stretches over holes, each
/// stretch kept within the stair grade. Both sides must stay real blocks and
/// the chord must reach the network.
fn straight_cut(
    pc: &Piece,
    field: &Field<'_>,
    cfg: &LayoutConfig,
    streets: &[Street],
    m: &Morph,
    half_width: f64,
) -> Option<(Vec<Shape>, Vec<Vec<Point>>)> {
    let ring = &pc.shape.outer;
    let a0 = g::area(&pc.shape);
    let f = frame(&pc.shape);
    let mut seeds = street_anchors(&pc.shape, field, streets, half_width);
    for t in [0.0, -0.3, 0.3] {
        let c = Point {
            x: f.c.x + f.u.x * f.hu * t,
            y: f.c.y + f.u.y * f.hu * t,
        };
        if g::contains(&pc.shape, c) {
            for heading in [f.u.y.atan2(f.u.x) + FRAC_PI_2, f.u.y.atan2(f.u.x)] {
                seeds.push((c, heading));
            }
        }
    }
    let reach = 2.0 * (f.hu + f.hv) + 10.0;
    let mut best: Option<(f64, Vec<Shape>, Vec<Vec<Point>>)> = None;
    for (seed, heading) in seeds {
        let d = Point {
            x: heading.cos(),
            y: heading.sin(),
        };
        // Nearest outer-ring crossing on each side of the seed.
        let end = |sign: f64| {
            let far = Point {
                x: seed.x + d.x * sign * reach,
                y: seed.y + d.y * sign * reach,
            };
            ring.iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
                .enumerate()
                .filter_map(|(k, (&a, &b))| g::segment_hit(seed, far, a, b).map(|h| (h, k)))
                .min_by(|a, b| a.0.0.total_cmp(&b.0.0))
                .map(|(h, k)| (h.1, k))
        };
        let (Some((a, ia)), Some((b, ib))) = (end(-1.0), end(1.0)) else {
            continue;
        };
        if ia == ib {
            continue;
        }
        let chord = vec![a, b];
        if (b.x - a.x).hypot(b.y - a.y) < 2.0 * m.number("minWidth").max(10.0) {
            continue;
        }
        let connected = chord.iter().any(|&p| {
            field
                .street_distance(p, streets, 4, 0.5)
                .is_some_and(|d| d < 0.5)
        }) || field.crosses_street(&chord, streets);
        if !connected {
            continue;
        }
        // Exact split along the chord (both ends lie on the outer ring); the
        // holes it crosses stay holes on either side.
        let length = (b.x - a.x).hypot(b.y - a.y);
        let mut parts = chord_split(&pc.shape, a, ia, b, ib);
        parts.sort_by(|p, q| g::area(q).total_cmp(&g::area(p)));
        if !(2..=4).contains(&parts.len())
            || parts[..2].iter().any(|p| g::area(p) < m.number("minBlock"))
            || (parts.iter().map(g::area).sum::<f64>() - a0).abs() > a0 * 1e-3
        {
            continue;
        }
        // The street: the chord's stretches over land, sampled every 2 m.
        let steps = (length / 2.0).ceil().max(2.0) as usize;
        let at = |k: usize| Point {
            x: a.x + (b.x - a.x) * k as f64 / steps as f64,
            y: a.y + (b.y - a.y) * k as f64 / steps as f64,
        };
        let mut paths = vec![];
        let mut run: Vec<Point> = vec![];
        for k in 0..=steps {
            let p = at(k);
            let inside = k == 0 || k == steps || g::contains(&pc.shape, p);
            if inside {
                run.push(p);
            }
            if !inside || k == steps {
                if run.len() >= 2 {
                    let path = vec![run[0], *run.last().unwrap()];
                    let grade = if cfg.allow_stairs {
                        cfg.max_stair_grade
                    } else {
                        cfg.max_lane_grade
                    };
                    if routing::path_clear(field.surface, &path, grade) {
                        paths.push(path);
                    }
                }
                run.clear();
            }
        }
        if paths.is_empty() {
            continue;
        }
        let (pa, pb) = (g::area(&parts[0]), g::area(&parts[1]));
        let cost = (pa - pb).abs() / a0 + 0.2 * (parts.len() - 2) as f64;
        if best.as_ref().is_none_or(|b| cost < b.0) {
            best = Some((cost, parts, paths));
        }
    }
    best.map(|(_, parts, paths)| (parts, paths))
}
/// The two sides of a chord from `a` (on outer edge `ia`) to `b` (on edge
/// `ib`): each ring walk closed by the chord, intersected with the shape so
/// its holes stay holes. Every resulting piece is returned.
fn chord_split(shape: &Shape, a: Point, ia: usize, b: Point, ib: usize) -> Vec<Shape> {
    let ring = &shape.outer;
    let n = ring.len();
    let walk = |from: usize, to: usize, start: Point, end: Point| {
        let mut r = vec![start];
        let mut k = (from + 1) % n;
        for _ in 0..n {
            r.push(ring[k]);
            if k == to {
                break;
            }
            k = (k + 1) % n;
        }
        r.push(end);
        Shape {
            outer: r,
            holes: vec![],
        }
    };
    [walk(ia, ib, a, b), walk(ib, ia, b, a)]
        .iter()
        .flat_map(|side| g::intersection(shape, side))
        .filter(|p| g::area(p) > 1.0)
        .collect()
}
/// Seeds of cuts square to the piece's street contacts: for its longest edges
/// lying on a street, a point a short way inside, heading away from the street.
fn street_anchors(
    shape: &Shape,
    field: &Field<'_>,
    streets: &[Street],
    half_width: f64,
) -> Vec<(Point, f64)> {
    let ring = &shape.outer;
    let mut contacts: Vec<(f64, Point, Point)> = ring
        .iter()
        .zip(ring.iter().cycle().skip(1))
        .take(ring.len())
        .filter_map(|(&a, &b)| {
            let length = (b.x - a.x).hypot(b.y - a.y);
            if length < 12.0 {
                return None;
            }
            let mid = Point {
                x: (a.x + b.x) * 0.5,
                y: (a.y + b.y) * 0.5,
            };
            field
                .street_distance(mid, streets, 4, 0.5)
                .is_some_and(|d| d < 0.5)
                .then(|| {
                    let n = Point {
                        x: -(b.y - a.y) / length,
                        y: (b.x - a.x) / length,
                    };
                    (length, mid, n)
                })
        })
        .collect();
    contacts.sort_by(|a, b| b.0.total_cmp(&a.0));
    let depth = (half_width * 0.5).clamp(6.0, 30.0);
    contacts
        .into_iter()
        .take(8)
        .filter_map(|(_, mid, n)| {
            [1.0, -1.0].into_iter().find_map(|sign| {
                let seed = Point {
                    x: mid.x + n.x * sign * depth,
                    y: mid.y + n.y * sign * depth,
                };
                g::contains(shape, seed).then(|| (seed, (n.y * sign).atan2(n.x * sign)))
            })
        })
        .collect()
}
fn split_quarter(
    q: &Quarter,
    field: &Field<'_>,
    cfg: &LayoutConfig,
    streets: &mut Vec<Street>,
    rng: &mut Rng,
) -> Vec<Piece> {
    let mut queue = vec![Piece {
        shape: q.shape.clone(),
        level: 1,
        kind: "block".into(),
    }];
    let mut out = vec![];
    let mut places = 0;
    let mut guard = 0;
    // A safety bound on the cuts, scaled with the quarter's land (a quarter
    // the macro plan left whole holds thousands of blocks).
    let bound = 4000 + (g::area(&q.shape) / 400.0) as usize;
    while let Some(pc) = queue.pop() {
        guard += 1;
        if guard > bound {
            out.push(pc);
            out.extend(queue);
            break;
        }
        let a0 = g::area(&pc.shape);
        let f = frame(&pc.shape);
        let point = g::interior_point(&pc.shape);
        let m = field.morph_at(point);
        let zone = if let Some(phase) = field.phase_at(point) {
            field.phases[phase].zone.as_str()
        } else if cfg.zone == "auto" {
            zone_at(f.c, field.center, field.radius, field.population)
        } else {
            &q.zone
        };
        let bs = m.range("blockSize", zone);
        let target = bs[0].max(1.0)
            * (bs[1].max(bs[0].max(1.0)) / bs[0].max(1.0)).powf(rng.float())
            * (0.85
                + 0.15
                    * smooth(
                        (f.c.x - field.center.x).hypot(f.c.y - field.center.y),
                        50.0,
                        320.0,
                    ));
        // A planned grid subdivides by its lattice, not by a random block
        // target: a piece is cut while a lattice line still crosses it, so
        // neighbouring pieces receive the same lines and junctions stay 4-way.
        let lattice = (m.text("streetOp") == "grid").then(|| lattice_lines(&pc.shape, field, m));
        let small = match lattice {
            Some(lines) => !lines,
            None => {
                a0 < target && f.hu / f.hv.max(1.0) < if cfg.zone == "faubourg" { 7.0 } else { 2.6 }
            }
        };
        if pc.kind != "block" || small || a0 < 2.0 * m.number("minBlock") {
            out.push(pc);
            continue;
        }
        let angle = field.angle(f.c);
        let mut best: Option<Candidate> = None;
        for fi in 0..2 {
            let heading = angle + fi as f64 * FRAC_PI_2;
            let d = Point {
                x: heading.cos(),
                y: heading.sin(),
            };
            let n = Point { x: -d.y, y: d.x };
            let mut seeds = vec![];
            // A cut through land worth many blocks is a street; the rest are lanes.
            let mut rank = if pc.level <= 1 || a0 > 4.0 * bs[1].max(bs[0]) {
                2
            } else {
                3
            };
            if m.text("streetOp") == "grid" {
                let lanes = m.pair("laneSpacing");
                let coarse = m.pair("gridSpacing");
                let grid_angle = match m.text("orientation") {
                    "cardinal" => 0.0,
                    "terrain" => field.terrain,
                    "water" => field.water,
                    _ => field.angle,
                };
                for (spacing, lane) in [(coarse, false), (lanes, true)] {
                    if !lane && a0 < m.number("wardArea") && (lanes[0] > 0.0 || lanes[1] > 0.0) {
                        continue;
                    }
                    rank = if lane { 3 } else { 2 };
                    let sp = spacing[if (heading - field.frame.unwrap_or(grid_angle)).cos().abs()
                        > 0.7
                    {
                        0
                    } else {
                        1
                    }];
                    if sp > 0.0 {
                        let project =
                            |p: Point| (p.x - field.center.x) * n.x + (p.y - field.center.y) * n.y;
                        let c = project(f.c);
                        let lo = pc
                            .shape
                            .outer
                            .iter()
                            .map(|&p| project(p))
                            .fold(f64::INFINITY, f64::min)
                            + m.number("minWidth");
                        let hi = pc
                            .shape
                            .outer
                            .iter()
                            .map(|&p| project(p))
                            .fold(f64::NEG_INFINITY, f64::max)
                            - m.number("minWidth");
                        // Lattice lines pass through the town centre (cardo and
                        // decumanus) at the culture's spacing.
                        let mut lines = vec![];
                        let mut k = (lo / sp).ceil();
                        while k * sp < hi && lines.len() < 512 {
                            lines.push(k * sp);
                            k += 1.0
                        }
                        lines.sort_by(|a, b| (a - c).abs().total_cmp(&(b - c).abs()));
                        for l in lines.into_iter().take(3) {
                            let o = Point {
                                x: f.c.x + n.x * (l - c),
                                y: f.c.y + n.y * (l - c),
                            };
                            let a = Point {
                                x: o.x - d.x * 100000.0,
                                y: o.y - d.y * 100000.0,
                            };
                            let b = Point {
                                x: o.x + d.x * 100000.0,
                                y: o.y + d.y * 100000.0,
                            };
                            let mut hits: Vec<_> = pc
                                .shape
                                .outer
                                .iter()
                                .zip(pc.shape.outer.iter().cycle().skip(1))
                                .take(pc.shape.outer.len())
                                .filter_map(|(&c, &e)| g::segment_hit(a, b, c, e))
                                .collect();
                            hits.sort_by(|a, b| a.0.total_cmp(&b.0));
                            for pair in hits.as_chunks::<2>().0 {
                                seeds.push(Point {
                                    x: (pair[0].1.x + pair[1].1.x) * 0.5,
                                    y: (pair[0].1.y + pair[1].1.y) * 0.5,
                                })
                            }
                        }
                    }
                    if !seeds.is_empty() {
                        break;
                    }
                }
            } else {
                for t in [0.5, 0.4, 0.6, 0.33, 0.67] {
                    let v = (t + rng.range(-0.04, 0.04) - 0.5) * 2.0 * f.hu * 0.92;
                    let w = rng.range(-0.15, 0.15) * f.hv;
                    seeds.push(Point {
                        x: f.c.x + f.u.x * v + f.v.x * w,
                        y: f.c.y + f.u.y * v + f.v.y * w,
                    })
                }
            }
            for seed in seeds {
                if let Some(c) = cut_candidate(
                    &pc, field, cfg, streets, m, seed, heading, rank, places, a0, rng,
                ) && best.as_ref().is_none_or(|b| c.0 < b.0)
                {
                    best = Some(c);
                }
            }
        }
        // Invariant: a piece worth several blocks is subdivided while it has a
        // street. When no cut from its middle reaches the network (a quarter
        // touching streets on a short stretch, holes in the way), cuts are
        // anchored on its own street contacts, square to the street.
        if best.is_none() && a0 > 2.0 * target.max(m.number("minBlock")) {
            let rank = if pc.level <= 1 || a0 > 4.0 * bs[1].max(bs[0]) {
                2
            } else {
                3
            };
            for (seed, heading) in street_anchors(&pc.shape, field, streets, f.hv) {
                if let Some(c) = cut_candidate(
                    &pc, field, cfg, streets, m, seed, heading, rank, places, a0, rng,
                ) && best.as_ref().is_none_or(|b| c.0 < b.0)
                {
                    best = Some(c);
                }
            }
        }
        // A piece worth many blocks that no traced cut can split (water holes
        // in the way, a quarter left whole by the macro plan) is crossed by a
        // straight street from one of its street contacts to its far edge;
        // the street stops at the holes, the land on both sides is split.
        if best.is_none()
            && a0 > 4.0 * target.max(m.number("minBlock"))
            && let Some((parts, paths)) = straight_cut(&pc, field, cfg, streets, m, f.hv)
        {
            for path in paths {
                add(streets, path, 2, "street", m, rng);
            }
            for shape in parts {
                queue.push(Piece {
                    shape,
                    level: pc.level + 1,
                    kind: "block".into(),
                });
            }
            continue;
        }
        if let Some((_, a, b, path, mut rank, pa, pb)) = best {
            let lc = m.number_or("longCut", 0.0);
            if lc > 0.0
                && len(&path) >= lc
                && routing::path_clear(field.surface, &path, cfg.max_street_grade)
            {
                rank = rank.min(2)
            }
            let steepest = path
                .windows(2)
                .map(|p| routing::segment_grade(field.surface, p[0], p[1]))
                .fold(0.0, f64::max);
            if steepest > cfg.max_street_grade {
                rank = 3;
            }
            let role = if steepest > cfg.max_lane_grade {
                rank = 3;
                "stairs"
            } else if rank <= 2 {
                "street"
            } else {
                "lane"
            };
            add(streets, path, rank, role, m, rng);
            if pa || pb {
                places += 1
            }
            queue.push(Piece {
                shape: a,
                level: pc.level + 1,
                kind: if pa { "place" } else { "block" }.into(),
            });
            queue.push(Piece {
                shape: b,
                level: pc.level + 1,
                kind: if pb { "place" } else { "block" }.into(),
            });
        } else {
            out.push(pc)
        }
    }
    out
}

/// Close operator, including the dead-end trees that a preset lists among its
/// street operators (medina, ksar, Mesopotamia) while `closeOp` stays `none`.
fn close_op(m: &Morph) -> &str {
    let listed = |k: &str| {
        m.value["streets"]
            .as_array()
            .is_some_and(|a| a.iter().any(|v| v.as_str() == Some(k)))
    };
    match m.text("closeOp") {
        "none" if listed("culDeSacTree") => "culDeSacTree",
        "none" if listed("roji") => "roji",
        "none" if listed("closes") => "closes",
        op => op,
    }
}
fn closes(
    pieces: &[Piece],
    streets: &mut Vec<Street>,
    field: &Field<'_>,
    cfg: &LayoutConfig,
    rng: &mut Rng,
) {
    let m = field.p;
    let op = close_op(m);
    if op == "none" {
        return;
    }
    if op != "closes" {
        tree_closes(pieces, streets, m, op, field, rng);
        return;
    }
    for pc in pieces {
        if pc.kind != "block" || !rng.chance(m.number("deadEndRatio")) {
            continue;
        }
        let f = frame(&pc.shape);
        let pd = m.range(
            "plotDepth",
            if cfg.zone == "auto" {
                "middle"
            } else {
                &cfg.zone
            },
        )[1];
        if f.hv < pd * 0.95 && op == "closes" {
            continue;
        }
        let mut edges: Vec<_> = pc
            .shape
            .outer
            .iter()
            .zip(pc.shape.outer.iter().cycle().skip(1))
            .take(pc.shape.outer.len())
            .filter_map(|(&a, &b)| {
                let p = Point {
                    x: (a.x + b.x) * 0.5,
                    y: (a.y + b.y) * 0.5,
                };
                let l = (a.x - b.x).hypot(a.y - b.y);
                let near = field.street_distance(p, streets, 4, 0.3);
                if near.is_some_and(|d| d < 0.3) {
                    Some((l, a, b))
                } else {
                    None
                }
            })
            .collect();
        edges.sort_by(|a, b| b.0.total_cmp(&a.0));
        let Some((l, a, b)) = edges.first().copied() else {
            continue;
        };
        if l < 25.0 {
            continue;
        }
        let t = rng.range(0.35, 0.65);
        let s = Point {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
        };
        let n = Point {
            x: -(b.y - a.y) / l,
            y: (b.x - a.x) / l,
        };
        let far = Point {
            x: s.x + n.x * 10000.0,
            y: s.y + n.y * 10000.0,
        };
        let hit = pc
            .shape
            .outer
            .iter()
            .zip(pc.shape.outer.iter().cycle().skip(1))
            .take(pc.shape.outer.len())
            .filter_map(|(&a, &b)| g::segment_hit(s, far, a, b))
            .min_by(|a, b| a.0.total_cmp(&b.0));
        let Some((_, h)) = hit else { continue };
        let dist = (h.x - s.x).hypot(h.y - s.y);
        let length = (dist * m.number("slitDepth")).min(dist - 16.0).min(70.0);
        if length < 18.0 {
            continue;
        }
        let end = Point {
            x: s.x + n.x * length,
            y: s.y + n.y * length,
        };
        let start = Point {
            x: s.x - n.x * 2.0,
            y: s.y - n.y * 2.0,
        };
        add(streets, vec![start, end], 4, "close", m, rng);
    }
}

/// Shadow-distance access tree; hutong is cardinal, roji follows the local frontage.
fn tree_closes(
    pieces: &[Piece],
    streets: &mut Vec<Street>,
    m: &Morph,
    op: &str,
    field: &Field<'_>,
    rng: &mut Rng,
) {
    let orthogonal = op == "hutong" || op == "roji";
    let depth = m.number("accessDepth").max(4.0);
    let width = m.value["widthByRank"][4].as_f64().unwrap_or(3.0) * m.number("widthScale");
    for pc in pieces.iter().filter(|p| p.kind == "block") {
        let ring = &pc.shape.outer;
        let boundary_distance = |p| {
            ring.iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
                .map(|(&a, &b)| g::distance(p, a, b).0)
                .fold(f64::INFINITY, f64::min)
        };
        let mut access = vec![];
        for (&a, &b) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            let l = (b.x - a.x).hypot(b.y - a.y);
            if l < 4.0 {
                continue;
            }
            let mid = Point {
                x: (a.x + b.x) * 0.5,
                y: (a.y + b.y) * 0.5,
            };
            let near = field.street_distance(mid, streets, 3, 0.3);
            if near.is_none_or(|d| d > 0.3) {
                continue;
            }
            let margin = if orthogonal { width * 0.5 + 7.5 } else { 0.0 };
            if l <= 2.0 * margin {
                continue;
            }
            let dir = Point {
                x: (b.x - a.x) / l,
                y: (b.y - a.y) / l,
            };
            access.push((
                Point {
                    x: a.x + dir.x * margin,
                    y: a.y + dir.y * margin,
                },
                Point {
                    x: b.x - dir.x * margin,
                    y: b.y - dir.y * margin,
                },
                Point {
                    x: -dir.y,
                    y: dir.x,
                },
            ));
        }
        if access.is_empty() {
            continue;
        }
        let axis = if op == "roji" {
            let &(a, b, _) = access
                .iter()
                .max_by(|a, b| {
                    (a.1.x - a.0.x)
                        .hypot(a.1.y - a.0.y)
                        .total_cmp(&(b.1.x - b.0.x).hypot(b.1.y - b.0.y))
                })
                .unwrap();
            let l = (b.x - a.x).hypot(b.y - a.y);
            Point {
                x: (b.x - a.x) / l,
                y: (b.y - a.y) / l,
            }
        } else {
            Point { x: 1.0, y: 0.0 }
        };
        let across = Point {
            x: -axis.y,
            y: axis.x,
        };
        let (x0, y0, x1, y1) = g::bbox(&pc.shape);
        let mut samples = vec![];
        // Four metre samples as in the source; cap only the lattice resolution on oversized wards.
        let step = 4.0_f64.max(((x1 - x0) * (y1 - y0) / 100_000.0).sqrt());
        let mut y = y0 + 2.0;
        while y < y1 {
            let mut x = x0 + 2.0;
            while x < x1 {
                let p = Point { x, y };
                if g::contains(&pc.shape, p) && boundary_distance(p) > 2.0 {
                    let d = access
                        .iter()
                        .map(|&(a, b, _)| g::distance(p, a, b).0)
                        .fold(f64::INFINITY, f64::min);
                    samples.push((p, d));
                }
                x += step;
            }
            y += step;
        }
        let mut slits: Vec<Vec<Point>> = vec![];
        let budget = if op == "roji" {
            ((samples.len() as f64 * step * step / (depth * depth)).ceil() as usize).clamp(60, 160)
        } else {
            60
        };
        for _ in 0..budget {
            let Some((bi, &(target, _))) = samples
                .iter()
                .enumerate()
                .filter(|(_, s)| s.1 > depth)
                .max_by(|a, b| a.1.1.total_cmp(&b.1.1))
            else {
                break;
            };
            let mut roots: Vec<_> = access
                .iter()
                .map(|&(a, b, n)| {
                    let (d, _, q) = g::distance(target, a, b);
                    (d, q, Some(n), None)
                })
                .collect();
            for (si, path) in slits.iter().enumerate() {
                for q in path.windows(2) {
                    let (d, _, p) = g::distance(target, q[0], q[1]);
                    roots.push((d + 3.0, p, None, Some(si)));
                }
            }
            roots.sort_by(|a, b| a.0.total_cmp(&b.0));
            let mut selected = None;
            for (_, root, n, parent) in roots.into_iter().take(if op == "roji" { 12 } else { 1 }) {
                let l = (target.x - root.x).hypot(target.y - root.y);
                let stop = (l - 4.0).min(l - depth * 0.35).min(if op == "roji" {
                    2.0 * depth
                } else {
                    f64::INFINITY
                });
                if stop < 8.0 {
                    continue;
                }
                let dir = Point {
                    x: (target.x - root.x) / l,
                    y: (target.y - root.y) / l,
                };
                let end = Point {
                    x: root.x + dir.x * stop,
                    y: root.y + dir.y * stop,
                };
                let start = n
                    .map(|n| Point {
                        x: root.x - n.x * width * 0.5,
                        y: root.y - n.y * width * 0.5,
                    })
                    .unwrap_or(root);
                let mut alternatives = vec![];
                if orthogonal {
                    let entry = n
                        .map(|n| Point {
                            x: root.x + n.x * (width * 0.5 + 7.5),
                            y: root.y + n.y * (width * 0.5 + 7.5),
                        })
                        .unwrap_or(root);
                    for d in [axis, across] {
                        let amount = (end.x - entry.x) * d.x + (end.y - entry.y) * d.y;
                        let bend = Point {
                            x: entry.x + d.x * amount,
                            y: entry.y + d.y * amount,
                        };
                        alternatives.push(vec![start, root, entry, bend, end]);
                        if op == "roji" && amount.abs() > 8.0 {
                            alternatives.push(vec![start, root, entry, bend]);
                        }
                    }
                } else if stop > 22.0 && rng.chance(0.55) {
                    let off = rng.range(-0.22, 0.22) * stop;
                    alternatives.push(vec![
                        start,
                        Point {
                            x: (root.x + end.x) * 0.5 - dir.y * off,
                            y: (root.y + end.y) * 0.5 + dir.x * off,
                        },
                        end,
                    ]);
                } else {
                    alternatives.push(vec![start, end]);
                }
                for mut path in alternatives {
                    path.dedup_by(|a, b| (a.x - b.x).hypot(a.y - b.y) < 0.05);
                    let valid = path.windows(2).all(|q| {
                        let l = (q[1].x - q[0].x).hypot(q[1].y - q[0].y);
                        let k = (l / 2.0).ceil().max(1.0) as usize;
                        (0..=k).all(|i| {
                            let t = i as f64 / k as f64;
                            let p = Point {
                                x: q[0].x + (q[1].x - q[0].x) * t,
                                y: q[0].y + (q[1].y - q[0].y) * t,
                            };
                            let along = (p.x - start.x).hypot(p.y - start.y);
                            if along
                                < if n.is_some() {
                                    width + 8.0
                                } else {
                                    width + 6.0
                                }
                            {
                                return true;
                            }
                            g::contains(&pc.shape, p)
                                && boundary_distance(p) >= width * 0.5 + 6.5
                                && slits.iter().enumerate().all(|(si, s)| {
                                    if Some(si) == parent && along <= 10.0 {
                                        return true;
                                    }
                                    s.windows(2).all(|q| {
                                        g::distance(p, q[0], q[1]).0
                                            >= if Some(si) == parent {
                                                width + 6.0
                                            } else {
                                                width + 12.0
                                            }
                                    })
                                })
                        })
                    });
                    if valid {
                        selected = Some(path);
                        break;
                    }
                }
                if selected.is_some() {
                    break;
                }
            }
            if let Some(path) = selected {
                for (p, d) in &mut samples {
                    for q in path.windows(2) {
                        *d = d.min(g::distance(*p, q[0], q[1]).0);
                    }
                }
                add(streets, path.clone(), 4, "close", m, rng);
                slits.push(path);
            } else {
                for (p, d) in &mut samples {
                    if (p.x - target.x).hypot(p.y - target.y) < 9.0 {
                        *d = 0.0
                    }
                }
                samples[bi].1 = 0.0;
            }
        }
    }
}

/// Intentional public squares, chosen among whole blocks so no parcel is cut:
/// the market place at each centre (sized by population, on a main street), and
/// the cultural `gatePlaces` / `crossPlaces` chances at gates and at crossings
/// of main streets. Leftover places from the cuts remain a secondary source.
fn squares(
    blocks: &mut [Block],
    streets: &[Street],
    centres: &[(Point, f64)],
    gates: &[Point],
    population: u32,
    m: &Morph,
    rng: &mut Rng,
) {
    if blocks.is_empty() || population < 300 {
        return;
    }
    let mut major = Bins::new(40.0, 1);
    major.sync(streets);
    let fronts_major = |b: &Block| {
        let reach = g::area(&b.shape).sqrt() * 0.75 + 6.0;
        major
            .nearest(g::interior_point(&b.shape), streets, 1, reach)
            .is_some()
    };
    let free = |b: &Block| b.kind == "block";
    // Market area grows with the town, from a village green to a 1.2 ha square.
    let market = (300.0 + 0.2 * population as f64).clamp(500.0, 12_000.0);
    for (k, &(centre, weight)) in centres.iter().enumerate() {
        let target = if k == 0 {
            market
        } else {
            (market * weight.sqrt()).max(400.0)
        };
        let reach = 2.5 * target.sqrt() + 60.0;
        let best = blocks
            .iter()
            .enumerate()
            .filter(|(_, b)| free(b))
            .filter_map(|(i, b)| {
                let area = g::area(&b.shape);
                let c = g::interior_point(&b.shape);
                let d = (c.x - centre.x).hypot(c.y - centre.y);
                (d < reach && (0.35..=2.5).contains(&(area / target)) && fronts_major(b))
                    .then(|| (i, (area / target).ln().abs() + d / reach))
            })
            .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
        if let Some((i, _)) = best {
            blocks[i].kind = "place".into();
        }
    }
    let small = |b: &Block, lo: f64, hi: f64| (lo..=hi).contains(&g::area(&b.shape));
    let nearest_small = |blocks: &[Block], p: Point, reach: f64, hi: f64| {
        blocks
            .iter()
            .enumerate()
            .filter(|(_, b)| free(b) && small(b, 120.0, hi))
            .map(|(i, b)| {
                let c = g::interior_point(&b.shape);
                (i, (c.x - p.x).hypot(c.y - p.y))
            })
            .filter(|(_, d)| *d < reach)
            .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)))
            .map(|v| v.0)
    };
    let gate_chance = m.number("gatePlaces");
    for &gate in gates {
        if rng.chance(gate_chance)
            && let Some(i) = nearest_small(blocks, gate, 45.0, 2_500.0)
        {
            blocks[i].kind = "place".into();
        }
    }
    let cross_chance = m.number("crossPlaces");
    if cross_chance > 0.0 {
        // Junctions where at least three main-street arms meet.
        let mut arms: std::collections::BTreeMap<(i64, i64), (Point, usize)> = Default::default();
        for s in streets.iter().filter(|s| s.rank <= 1) {
            for (j, &p) in s.path.iter().enumerate() {
                let ends = usize::from(j > 0) + usize::from(j + 1 < s.path.len());
                let key = ((p.x * 100.0).round() as i64, (p.y * 100.0).round() as i64);
                arms.entry(key).or_insert((p, 0)).1 += ends;
            }
        }
        let mut done: Vec<Point> = vec![];
        for (_, (p, count)) in arms {
            if count < 3 || done.iter().any(|q| (q.x - p.x).hypot(q.y - p.y) < 150.0) {
                continue;
            }
            if rng.chance(cross_chance)
                && let Some(i) = nearest_small(blocks, p, 35.0, 1_500.0)
            {
                blocks[i].kind = "place".into();
                done.push(p);
            }
        }
    }
}

/// Clip centreline intervals at exact cell/map and urban-boundary crossings.
fn clip_street(st: &Street, surface: Surface<'_>, quarters: Option<&[Quarter]>) -> Vec<Street> {
    let mut out = vec![];
    let mut path: Vec<Point> = vec![];
    let mut widths = vec![];
    let cell = surface.width / surface.n as f64;
    for (i, q) in st.path.windows(2).enumerate() {
        let a = q[0];
        let b = q[1];
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let mut ts = vec![0.0, 1.0];
        for (a, b, delta) in [(a.x, b.x, dx), (a.y, b.y, dy)] {
            if delta.abs() < 1e-9 {
                continue;
            }
            let lo = (a.min(b) / cell).floor().max(0.0) as usize;
            let hi = ((a.max(b) / cell).ceil() as usize).min(surface.n);
            for k in lo..=hi {
                let t = (k as f64 * cell - a) / delta;
                if t > 0.0 && t < 1.0 {
                    ts.push(t)
                }
            }
        }
        if let Some(quarters) = quarters {
            for quarter in quarters {
                let ring = &quarter.shape.outer;
                for (&c, &d) in ring
                    .iter()
                    .zip(ring.iter().cycle().skip(1))
                    .take(ring.len())
                {
                    if let Some((t, _)) = g::segment_hit(a, b, c, d) {
                        ts.push(t)
                    }
                }
            }
        }
        ts.sort_by(f64::total_cmp);
        ts.dedup_by(|a, b| (*a - *b).abs() < 1e-9);
        for pair in ts.windows(2) {
            let mid = (pair[0] + pair[1]) * 0.5;
            let p = Point {
                x: a.x + dx * mid,
                y: a.y + dy * mid,
            };
            let keep = !surface.wet(p)
                && quarters.is_none_or(|qs| qs.iter().any(|q| g::contains(&q.shape, p)));
            if keep {
                let start = Point {
                    x: a.x + dx * pair[0],
                    y: a.y + dy * pair[0],
                };
                let end = Point {
                    x: a.x + dx * pair[1],
                    y: a.y + dy * pair[1],
                };
                let wa = st.widths.get(i).copied().unwrap_or(4.0);
                let wb = st.widths.get(i + 1).copied().unwrap_or(wa);
                if path
                    .last()
                    .is_some_and(|p| (p.x - start.x).hypot(p.y - start.y) > 1e-6)
                {
                    out.push(Street {
                        path: std::mem::take(&mut path),
                        widths: std::mem::take(&mut widths),
                        rank: st.rank,
                        role: st.role.clone(),
                    });
                }
                if path.is_empty() {
                    path.push(start);
                    widths.push(wa + (wb - wa) * pair[0]);
                }
                path.push(end);
                widths.push(wa + (wb - wa) * pair[1]);
            } else if path.len() > 1 {
                out.push(Street {
                    path: std::mem::take(&mut path),
                    widths: std::mem::take(&mut widths),
                    rank: st.rank,
                    role: st.role.clone(),
                });
            }
        }
    }
    if path.len() > 1 {
        out.push(Street {
            path,
            widths,
            rank: st.rank,
            role: st.role.clone(),
        });
    }
    out
}

/// Morphology of an edited quarter, plus the phase its lots read when its
/// culture changes. `None` when the edit leaves the morphology untouched.
fn quarter_edit(
    edit: &super::QuarterOverride,
    q: &Quarter,
    phases: &[super::GrowthPhase],
    culture: &str,
    site: &Site,
    cfg: &LayoutConfig,
) -> Result<Option<(Morph, Option<super::GrowthPhase>)>, String> {
    if edit.culture.is_none() && edit.tissue.is_none() && edit.density.is_none() {
        return Ok(None);
    }
    if edit.tissue.as_deref().is_some_and(|t| {
        ![
            "culture",
            "grid",
            "organic",
            "radial",
            "terraces",
            "dendritic",
            "clusters",
        ]
        .contains(&t)
    }) || edit
        .culture
        .as_deref()
        .is_some_and(|c| !super::catalogue()["cultures"][c].is_object())
    {
        return Err("Retouche de quartier invalide (culture ou tissu inconnu)".into());
    }
    let phase = phases.get(q.phase);
    let base = phase
        .map(|p| p.culture.as_str())
        .filter(|c| !c.is_empty())
        .unwrap_or(culture);
    let target = edit.culture.as_deref().unwrap_or(base);
    let name = phase.map_or("core", |p| p.recipe.trim_start_matches("grown-"));
    let recipe = if target == base {
        phase.map_or_else(|| "core".to_owned(), |p| p.recipe.clone())
    } else {
        composition::recipe(target, site.population, name)
    };
    let morph = composition::phase_morph(
        target,
        &recipe,
        &q.zone,
        &cfg.preset,
        &cfg.recipe,
        edit.density.unwrap_or(cfg.density),
        &cfg.params,
        "quarters",
    )?;
    let own = (target != base).then(|| super::GrowthPhase {
        culture: target.into(),
        kind: phase.map_or_else(|| "edit".into(), |p| p.kind.clone()),
        zone: q.zone.clone(),
        recipe,
        population: 0.0,
        target_area: 0.0,
        shapes: vec![],
    });
    Ok(Some((morph, own)))
}

/// True when a street runs inside the quarter or along its edge (within 1 m).
/// Distance from `p` to the nearest point of a street, and that point.
fn nearest_on(p: Point, st: &Street) -> Option<(f64, Point)> {
    st.path
        .windows(2)
        .map(|w| g::distance(p, w[0], w[1]))
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(d, _, q)| (d, q))
}
/// Bounding box of an open polyline.
fn path_bbox(path: &[Point]) -> (f64, f64, f64, f64) {
    path.iter().fold(
        (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        ),
        |b, p| (b.0.min(p.x), b.1.min(p.y), b.2.max(p.x), b.3.max(p.y)),
    )
}
fn touches(q: &Shape, bb: (f64, f64, f64, f64), st: &Street) -> bool {
    let rings: Vec<&Vec<Point>> = std::iter::once(&q.outer).chain(&q.holes).collect();
    st.path.windows(2).any(|w| {
        let (a, b) = (w[0], w[1]);
        if a.x.max(b.x) < bb.0 - 1.0
            || a.x.min(b.x) > bb.2 + 1.0
            || a.y.max(b.y) < bb.1 - 1.0
            || a.y.min(b.y) > bb.3 + 1.0
        {
            return false;
        }
        g::contains(q, a)
            || g::contains(q, b)
            || rings.iter().any(|r| {
                r.iter().zip(r.iter().cycle().skip(1)).any(|(&c, &d)| {
                    g::segment_hit(a, b, c, d).is_some()
                        || g::distance(a, c, d).0 <= 1.0
                        || g::distance(b, c, d).0 <= 1.0
                        || g::distance(c, a, b).0 <= 1.0
                })
            })
    })
}

/// Street service of the quarter partition, enforced before any subdivision:
/// a sliver smaller than a block joins its neighbour, every quarter touches a
/// street, and a quarter no street can reach at street grade (lane, then
/// stairs only where the culture builds them) is returned to open land and
/// counted as shortfall rather than parcelled into streetless strips.
#[allow(clippy::too_many_arguments)]
fn serve_quarters(
    quarters: &mut Vec<Quarter>,
    streets: &mut Vec<Street>,
    enclosures: &[super::Enclosure],
    phases: &mut [super::GrowthPhase],
    structure: Option<&mut super::UrbanStructure>,
    cfg: &LayoutConfig,
    m: &Morph,
    surface: Surface<'_>,
    rng: &mut Rng,
) -> Option<String> {
    let tick = std::time::Instant::now();
    let lap = |label: &str| {
        if std::env::var("URBAN_PROFILE").is_ok() {
            eprintln!(
                "    serve.{label}: {:.0} ms",
                tick.elapsed().as_secs_f64() * 1000.0
            );
        }
    };
    let sliver = m.number("minBlock").max(150.0);
    let mut i = 0;
    while i < quarters.len() {
        if g::area(&quarters[i].shape) >= sliver || quarters.len() == 1 {
            i += 1;
            continue;
        }
        let q = quarters.remove(i);
        let bb = g::bbox(&q.shape);
        let mut neighbours: Vec<usize> = (0..quarters.len())
            .filter(|&j| {
                let o = g::bbox(&quarters[j].shape);
                o.0 <= bb.2 + 0.5 && bb.0 <= o.2 + 0.5 && o.1 <= bb.3 + 0.5 && bb.1 <= o.3 + 0.5
            })
            .collect();
        neighbours.sort_by_key(|&j| quarters[j].phase != q.phase);
        for j in neighbours {
            let merged = g::union(&[quarters[j].shape.clone(), q.shape.clone()]);
            if merged.len() == 1 {
                quarters[j].shape = merged.into_iter().next().unwrap();
                break;
            }
        }
        // A sliver without a neighbour stays open land.
    }
    let walls: Vec<Shape> = enclosures
        .iter()
        .map(|e| {
            let mut outer = e.path.clone();
            if outer.len() > 3 && outer.first() == outer.last() {
                outer.pop();
            }
            g::normalized(Shape {
                outer,
                holes: vec![],
            })
        })
        .collect();
    let gates: Vec<Point> = enclosures.iter().flat_map(|e| e.gates.clone()).collect();
    let inside = |p: Point| walls.iter().filter(|w| g::contains(w, p)).count();
    let crosses_wall = |path: &[Point]| {
        path.windows(2).any(|w| {
            enclosures.iter().any(|e| {
                e.path.windows(2).any(|s| {
                    g::segment_hit(w[0], w[1], s[0], s[1]).is_some_and(|(_, x)| {
                        !gates.iter().any(|gt| (gt.x - x.x).hypot(gt.y - x.y) < 15.0)
                    })
                })
            })
        })
    };
    let (mut dropped, mut lost) = (vec![], 0.0);
    let mut kept = Vec::with_capacity(quarters.len());
    lap("slivers");
    let first_feeder = streets.len();
    // A street whose whole box misses the quarter's (1 m slack, as in
    // `touches`) has no segment near it: skip it without walking its path.
    let street_boxes: Vec<_> = streets.iter().map(|s| path_bbox(&s.path)).collect();
    let touched = super::par::map(quarters, |_, q| {
        let bb = g::bbox(&q.shape);
        streets.iter().zip(&street_boxes).any(|(st, sb)| {
            sb.0 <= bb.2 + 1.0
                && sb.2 >= bb.0 - 1.0
                && sb.1 <= bb.3 + 1.0
                && sb.3 >= bb.1 - 1.0
                && touches(&q.shape, bb, st)
        })
    });
    lap("touched");
    // Nearest street points of the street network `net` reachable from the
    // quarter's interior without changing enclosure side, nearest first.
    let targets_from = |start: Point, side: usize, net: &[Street]| {
        let mut targets: Vec<(f64, Point)> = net
            .iter()
            .filter_map(|st| nearest_on(start, st))
            .filter(|&(_, p)| inside(p) == side)
            .collect();
        targets.sort_by(|a, b| a.0.total_cmp(&b.0));
        targets
    };
    // Feeder route from `start` to the first reachable of the 4 nearest
    // targets: street grade, then lane, then stairs where allowed.
    let route_feeder = |start: Point, targets: &[(f64, Point)]| {
        for &(d, target) in targets.iter().take(4) {
            let margin = d.max(40.0) * 0.5 + 40.0;
            let mut planner = routing::RoutePlanner::new(
                surface,
                (
                    start.x.min(target.x) - margin,
                    start.y.min(target.y) - margin,
                    start.x.max(target.x) + margin,
                    start.y.max(target.y) + margin,
                ),
            );
            for (grade, role, rank) in [
                (cfg.max_street_grade, "street", 2),
                (cfg.max_lane_grade, "lane", 3),
                (cfg.max_stair_grade, "stairs", 3),
            ] {
                if role == "stairs" && !cfg.allow_stairs {
                    break;
                }
                if let Some(path) = planner
                    .route(target, start, grade)
                    .filter(|p| !crosses_wall(p))
                {
                    return Some((path, role, rank));
                }
            }
        }
        None
    };
    // Routes are planned in parallel against the network before any feeder;
    // the serial pass below keeps a plan only while no earlier feeder enters
    // the quarter's four nearest targets (otherwise it replans exactly as a
    // serial pass would), so the result does not depend on the threads.
    let unserved: Vec<usize> = (0..quarters.len()).filter(|&i| !touched[i]).collect();
    let mut planned: std::collections::HashMap<usize, _> = unserved
        .iter()
        .copied()
        .zip(super::par::map(&unserved, |_, &i| {
            let start = g::interior_point(&quarters[i].shape);
            let side = inside(start);
            let targets = targets_from(start, side, streets);
            let feeder = route_feeder(start, &targets);
            (start, side, targets, feeder)
        }))
        .collect();
    for (qi, (q, touched)) in quarters.drain(..).zip(touched).enumerate() {
        let bb = g::bbox(&q.shape);
        if touched
            || streets[first_feeder..]
                .iter()
                .any(|st| touches(&q.shape, bb, st))
        {
            kept.push(q);
            continue;
        }
        let (start, side, targets, plan) = planned.remove(&qi).expect("planned feeder");
        let cutoff = targets.get(3).map_or(f64::INFINITY, |t| t.0);
        let stale = streets[first_feeder..]
            .iter()
            .any(|st| nearest_on(start, st).is_some_and(|(d, p)| d <= cutoff && inside(p) == side));
        let feeder = if stale {
            route_feeder(start, &targets_from(start, side, streets))
        } else {
            plan
        };
        if let Some((path, role, rank)) = feeder {
            add(streets, path, rank, role, m, rng);
            kept.push(q);
        } else {
            lost += g::area(&q.shape);
            for phase in phases.iter_mut() {
                phase.shapes = phase
                    .shapes
                    .iter()
                    .flat_map(|s| g::difference(s, &q.shape))
                    .filter(|s| g::area(s) > 1.0)
                    .collect();
            }
            dropped.push(q.shape);
        }
    }
    *quarters = kept;
    lap("feeders");
    if dropped.is_empty() {
        return None;
    }
    if let Some(s) = structure {
        for q in &dropped {
            s.allocated = s
                .allocated
                .iter()
                .flat_map(|a| g::difference(a, q))
                .filter(|a| g::area(a) > 1.0)
                .collect();
        }
        s.metrics.allocated_area = (s.metrics.allocated_area - lost).max(0.0);
        s.metrics.shortfall_area += lost;
    }
    Some(format!(
        "{} quartier(s) sans accès carrossable rendu(s) à la campagne ({lost:.0} m², comptés en déficit).",
        dropped.len()
    ))
}

/// Quarters of one site. Closed loop of the adaptive capacity: when the
/// measure of the real blocks falls short of the plan by more than 5 % (the
/// probe over-predicted the tissue), the site is drawn once more with the
/// probed yields scaled by measured / predicted, so the footprint, the
/// densification and any borrowing are sized on the measured yield. The
/// better of the two drawings is kept; the shortfall stays explicit.
pub(super) fn generate(
    seed: &str,
    site: &Site,
    cfg: &LayoutConfig,
    m: &Morph,
    surface: Surface<'_>,
    roads: &[Street],
) -> Result<Layout, String> {
    let first = generate_once(seed, site, cfg, m, surface, roads)?;
    let Some(p) = capacity::of(&first) else {
        return Ok(first);
    };
    if cfg.capacity_yield > 0.0
        || p.forecast <= 0.0
        || p.shortfall <= 0.05 * p.required
        || p.measured_plan <= 0.0
    {
        return Ok(first);
    }
    // Probe and measure at the same densification: the lots as finally
    // densified on the real blocks, against the probed forecast at that level.
    let planned = p.network_densify.clamp(0.0, 1.0);
    let t = p.densify.clamp(planned, 1.0);
    let at = if planned < 1.0 {
        p.forecast + (p.forecast_dense - p.forecast) * (t - planned) / (1.0 - planned)
    } else {
        p.forecast
    };
    let measured = if t > planned {
        p.predicted
    } else {
        p.measured_plan
    };
    let ratio = (measured / at.max(1e-9)).clamp(0.3, 0.99);
    let again = LayoutConfig {
        capacity_yield: ratio,
        capacity_floor: t,
        ..cfg.clone()
    };
    let second = generate_once(seed, site, &again, m, surface, roads)?;
    let short = |l: &Layout| capacity::of(l).map_or(f64::INFINITY, |p| p.shortfall);
    Ok(if short(&second) < short(&first) {
        second
    } else {
        first
    })
}
fn generate_once(
    seed: &str,
    site: &Site,
    cfg: &LayoutConfig,
    m: &Morph,
    surface: Surface<'_>,
    roads: &[Street],
) -> Result<Layout, String> {
    // Stairs are a cultural answer to slopes (hill towns, terraces), not a
    // universal repair: elsewhere every street and quarter keeps street grade.
    let applied = cfg;
    let effective = LayoutConfig {
        allow_stairs: profiles::stairs_allowed(
            cfg,
            if cfg.culture == "site" {
                &site.culture
            } else {
                &cfg.culture
            },
        ),
        ..cfg.clone()
    };
    let cfg = &effective;
    let rng = Rng::new(seed).fork(&format!("urban-layout:{}", site.key));
    let tick = std::time::Instant::now();
    let lap = |label: &str| {
        if std::env::var("URBAN_PROFILE").is_ok() {
            eprintln!("  {label}: {:.0} ms", tick.elapsed().as_secs_f64() * 1000.0);
        }
    };
    let mut prim = rng.fork("primary");
    let center = site.center;
    let radius = if cfg.radius > 0.0 {
        cfg.radius
    } else {
        site.radius * cfg.radius_scale
    };
    let count = cfg.count.clamp(3, 64);
    let rings = cfg.rings.clamp(1, 2);
    let road_angle = nearest(center, roads, 4)
        .map(|(_, a)| a)
        .unwrap_or_else(|| prim.range(0.0, TAU));
    let angle = if m.text("orientation") == "cardinal" {
        0.0
    } else {
        road_angle
    };
    let mut streets = vec![];
    let mut raw = vec![];
    if cfg.placement != "center" {
        let cols = count.div_ceil(2);
        let allcols = cols * rings;
        let x0 = center.x + radius * 0.14;
        let y0 = center.y - radius * 0.7;
        let width = radius * 1.4 * rings as f64;
        let height = radius * 1.4;
        let jitter_x = 8.0_f64.min(0.2 * width / allcols as f64);
        let jitter_y = 10.0_f64.min(0.2 * height / 2.0);
        let nodes: Vec<Vec<_>> = (0..3)
            .map(|r| {
                (0..=allcols)
                    .map(|c| {
                        let mut p = Point {
                            x: x0
                                + width * c as f64 / allcols as f64
                                + if c > 0 && c < allcols {
                                    prim.range(-jitter_x, jitter_x)
                                } else {
                                    0.0
                                },
                            y: y0
                                + height * r as f64 / 2.0
                                + if r == 1 {
                                    prim.range(-jitter_y, jitter_y)
                                } else {
                                    0.0
                                },
                        };
                        if cfg.placement == "skew" {
                            let u = (p.x - x0) / width;
                            let v = (p.y - y0) / height;
                            p.x += radius * (0.55 * v + 0.12 * u * v);
                            p.y += radius * 0.3 * u
                        }
                        p
                    })
                    .collect()
            })
            .collect();
        let horizontal: Vec<Vec<Vec<Point>>> = nodes
            .iter()
            .enumerate()
            .map(|(r, row)| {
                row.windows(2)
                    .enumerate()
                    .map(|(c, q)| {
                        if cfg.placement == "notched" && r == 0 && c % cols == cols / 2 {
                            vec![
                                q[0],
                                Point {
                                    x: (q[0].x + q[1].x) * 0.5,
                                    y: (q[0].y + q[1].y) * 0.5 + height * 0.3,
                                },
                                q[1],
                            ]
                        } else {
                            q.to_vec()
                        }
                    })
                    .collect()
            })
            .collect();
        for row in &horizontal {
            for p in row {
                add(&mut streets, p.clone(), 1, "street", m, &mut prim)
            }
        }
        for r in 0..2 {
            for (c, &p) in nodes[r].iter().enumerate() {
                add(
                    &mut streets,
                    vec![p, nodes[r + 1][c]],
                    if c == 0 { 0 } else { 1 },
                    "street",
                    m,
                    &mut prim,
                )
            }
        }
        for band in 0..rings {
            for local in 0..count {
                let row = local / cols;
                let col = band * cols + local % cols;
                let end = (col
                    + if count % 2 == 1 && local == count - 1 {
                        2
                    } else {
                        1
                    })
                .min(allcols);
                let mut pts = vec![];
                for p in &horizontal[row][col..end] {
                    pts.extend(p.iter().skip(usize::from(!pts.is_empty())).copied())
                }
                let mut bottom = vec![];
                for p in &horizontal[row + 1][col..end] {
                    bottom.extend(p.iter().skip(usize::from(!bottom.is_empty())).copied())
                }
                bottom.reverse();
                pts.extend(bottom);
                raw.push(Quarter {
                    shape: g::normalized(Shape {
                        outer: pts,
                        holes: vec![],
                    }),
                    phase: band,
                    zone: if cfg.zone == "auto" {
                        "core".into()
                    } else {
                        cfg.zone.clone()
                    },
                })
            }
        }
    }
    let fixture_footprint = g::shapes(geo::algorithm::bool_ops::unary_union(
        &raw.iter().map(|q| g::polygon(&q.shape)).collect::<Vec<_>>(),
    ));
    let quarters: Vec<_> = raw
        .into_iter()
        .flat_map(|q| {
            g::dry_clip(&surface, &q.shape)
                .into_iter()
                .filter(|p| g::area(p) > 1.0)
                .map(move |shape| Quarter {
                    shape,
                    phase: q.phase,
                    zone: q.zone.clone(),
                })
        })
        .collect();
    let mut phases = vec![];
    let mut structure = None;
    let mut nucleus_radius = radius;
    let mut archetype = "district".to_owned();
    let (mut quarters, mut streets, enclosures, mut warnings) = if cfg.placement == "center" {
        let plan = if cfg.composition == "settlement" {
            let result = composition::generate(seed, site, cfg, surface, roads, radius)?;
            phases = result.phases;
            archetype = result.archetype;
            nucleus_radius = result.nucleus_radius;
            result.plan
        } else {
            macroplan::generate(seed, site, cfg, m, surface, roads, radius)
        };
        structure = plan.structure;
        (plan.quarters, plan.streets, plan.enclosures, plan.warnings)
    } else {
        streets = streets
            .iter()
            .flat_map(|s| clip_street(s, surface, None))
            .collect();
        for st in roads {
            if matches!(st.role.as_str(), "bridge" | "ford" | "causeway") {
                for shape in &fixture_footprint {
                    streets.extend(macroplan::clip(st, shape));
                }
            } else {
                streets.extend(clip_street(st, surface, Some(&quarters)));
            }
        }
        (quarters, streets, vec![], vec![])
    };
    lap("composition.plan");
    if cfg.placement == "center"
        && let Some(w) = serve_quarters(
            &mut quarters,
            &mut streets,
            &enclosures,
            &mut phases,
            structure.as_mut(),
            cfg,
            m,
            surface,
            &mut rng.fork("quarter-service"),
        )
    {
        warnings.push(w);
    }
    lap("composition");
    // edits hook (urban/edits.rs): user outline of a quarter (variant plan only).
    super::edits::reshape_quarters(
        &mut quarters,
        &mut phases,
        &streets,
        &enclosures,
        cfg,
        surface,
        center,
        radius,
        &mut warnings,
    );
    // A modern enceinte holds the founding epochs only: the younger growth
    // outside keeps the open-fringe treatment (exits, peripheral frontage).
    let walled: Vec<Shape> = enclosures
        .iter()
        .map(|e| {
            let mut outer = e.path.clone();
            if outer.len() > 3 && outer.first() == outer.last() {
                outer.pop();
            }
            g::normalized(Shape {
                outer,
                holes: vec![],
            })
        })
        .collect();
    let land: f64 = quarters.iter().map(|q| g::area(&q.shape)).sum();
    let open_edge = enclosures.is_empty()
        || cfg.footprint.mechanism != "legacy"
            && walled.iter().map(g::area).sum::<f64>() < 0.95 * land;
    super::influences::apply(&mut phases, &mut quarters, site, cfg);
    if !cfg.mix_culture.is_empty()
        && let Some(s) = &mut structure
    {
        for d in &mut s.districts {
            if let Some(q) = d.quarters.first().and_then(|&i| quarters.get(i)) {
                d.phase = q.phase;
            }
        }
    }
    if quarters.is_empty() {
        return Ok(Layout {
            config: Some(applied.clone()),
            programme: None,
            key: site.key.clone(),
            culture: if cfg.culture == "site" {
                site.culture.clone()
            } else {
                cfg.culture.clone()
            },
            center,
            quarters,
            streets: vec![],
            blocks: vec![],
            warnings: vec![
                "Aucun quartier constructible à cet emplacement et avec ce rayon.".into(),
            ],
            enclosures,
            phases,
            archetype,
            structure,
        });
    }
    // Adaptive capacity (`footprint::capacity`): the plan sized with the
    // footprint, and the quarters cut with a borrowed compact tissue.
    let mut plan = structure.as_ref().and_then(|s| s.metrics.capacity.clone());
    if let Some(p) = plan.as_mut()
        && !p.donor.is_empty()
        && p.borrowed_share > 0.0
    {
        p.borrowed_quarters = borrowed_quarters(&quarters, center, p.borrowed_share, cfg);
    }
    let capacity_morph = |morph: Morph, quarter: Option<usize>, recipe: &str, zone: &str| {
        capacity::adapt(
            morph,
            plan.as_ref(),
            quarter,
            recipe,
            zone,
            site.population,
            cfg.density,
            "quarters",
        )
    };
    let adapted = capacity_morph(m.clone(), None, "core", "core");
    let m = &adapted;
    let gradients = |p: Point| {
        let r = 70.0;
        (
            (surface.height_at(Point { x: p.x + r, y: p.y })
                - surface.height_at(Point { x: p.x - r, y: p.y }))
                / (2.0 * r),
            (surface.height_at(Point { x: p.x, y: p.y + r })
                - surface.height_at(Point { x: p.x, y: p.y - r }))
                / (2.0 * r),
        )
    };
    let (gx, gy) = gradients(center);
    let terrain = if gx.hypot(gy) > 1e-6 {
        gy.atan2(gx) + FRAC_PI_2
    } else {
        angle
    };
    let water = (0..32)
        .filter_map(|i| {
            let a = i as f64 * TAU / 32.0;
            let p = Point {
                x: center.x + a.cos() * radius,
                y: center.y + a.sin() * radius,
            };
            surface.wet(p).then_some(a + FRAC_PI_2)
        })
        .next()
        .unwrap_or(angle);
    // Quarters are cut in order, each seeing the network fixed here, the
    // streets of the earlier quarters and its own. They are first cut in
    // parallel without the earlier quarters' streets; a cut is kept when none
    // of its network reads would change with them (`Read`), else redone
    // serially with them, so the result is the serial one on any thread count.
    let base_streets = std::mem::take(&mut streets);
    let mut base_bins = Bins::new(20.0, usize::MAX);
    base_bins.sync(&base_streets);
    let mut major = Bins::new(50.0, 1);
    major.sync(&base_streets);
    let bins = std::sync::Mutex::new(Bins::new(20.0, usize::MAX));
    let regional = RegionalIndex::new(roads, nucleus_radius * 1.5);
    let field = Field {
        regional: &regional,
        align_regional: cfg.axis_alignment == "regional"
            && cfg.params.get("orientation").is_none()
            && cfg.preset == "culture",
        adaptation: cfg.site_adaptation,
        p: m,
        center,
        angle,
        terrain,
        water,
        surface,
        noise: Noise::new(rng.fork("field")),
        radius: nucleus_radius,
        population: site.population,
        radial: cfg.preset == "culture"
            && cfg.params.get("streetOp").is_none()
            && profiles::profile(if cfg.culture == "site" {
                &site.culture
            } else {
                &cfg.culture
            })
            .pattern
                == "radial",
        phases: &[],
        phase_morphs: &[],
        phase_index: &[],
        base: &base_streets,
        base_bins: &base_bins,
        others: &[],
        bins: &bins,
        reads: None,
        major: &major,
        frame: None,
    };
    let culture = if cfg.culture == "site" {
        &site.culture
    } else {
        &cfg.culture
    };
    let raw_phase_morphs = phases
        .iter()
        .map(|p| {
            composition::phase_morph(
                if p.culture.is_empty() {
                    culture
                } else {
                    &p.culture
                },
                &p.recipe,
                &p.zone,
                &cfg.preset,
                &cfg.recipe,
                cfg.density,
                &cfg.params,
                "quarters",
            )
        })
        .map(|r| r.map(|m| super::with_tissue(m, &cfg.tissue)))
        .collect::<Result<Vec<_>, _>>()?;
    let phase_morphs = raw_phase_morphs
        .iter()
        .zip(&phases)
        .map(|(m, p)| capacity_morph(m.clone(), None, &p.recipe, &p.zone))
        .collect::<Vec<_>>();
    let phase_index = phases
        .iter()
        .enumerate()
        .flat_map(|(i, p)| {
            p.shapes
                .iter()
                .map(move |s| (i, g::ContainmentIndex::new(s)))
        })
        .collect::<Vec<_>>();
    let cut = |i: usize,
               q: &Quarter,
               others: &[Layer<'_>],
               reads: Option<&std::sync::Mutex<Vec<Read>>>|
     -> Result<CutQuarter, String> {
        let mut qr = rng.fork(&super::edits::quarter_fork("quarter", i, cfg)); // edits hook (urban/edits.rs): salt
        let mut local_cfg = cfg.clone();
        let interior = g::interior_point(&q.shape);
        let origin = structure.as_ref().and_then(|s| {
            s.centers.iter().min_by(|a, b| {
                let p = interior;
                (p.x - a.point.x)
                    .hypot(p.y - a.point.y)
                    .total_cmp(&(p.x - b.point.x).hypot(p.y - b.point.y))
            })
        });
        let local_center = origin.map_or(field.center, |c| c.point);
        let local_tissue = if cfg.tissue == "culture"
            && structure.as_ref().is_some_and(|s| s.family == "composite")
            && origin.is_some_and(|c| c.id > 0)
            && cfg.mix_culture.is_empty()
        {
            "grid"
        } else {
            &cfg.tissue
        };
        // A user edit of this quarter (culture, tissue, density) replaces its
        // morphology only; the RNG is still forked from the quarter index, so
        // the other quarters keep their own random streams.
        let edit = cfg.overrides.quarters.get(&i.to_string());
        let edited = match edit {
            Some(e) => quarter_edit(e, q, &phases, culture, site, cfg)?,
            None => None,
        };
        let local_tissue = edit
            .and_then(|e| e.tissue.as_deref())
            .unwrap_or(local_tissue);
        // A quarter of the plan's borrowed share is cut with the donor's
        // street spacing and lots (its houses stay the receiving culture's).
        let borrowed = edited.is_none()
            && plan
                .as_ref()
                .is_some_and(|p| p.borrowed_quarters.contains(&i));
        let local_morph = super::with_tissue(
            match &edited {
                Some(e) => e.0.clone(),
                None if borrowed => {
                    let phase = phases.get(q.phase);
                    capacity_morph(
                        raw_phase_morphs.get(q.phase).unwrap_or(m).clone(),
                        Some(i),
                        phase.map_or("core", |p| p.recipe.as_str()),
                        phase.map_or(q.zone.as_str(), |p| p.zone.as_str()),
                    )
                }
                None => phase_morphs.get(q.phase).unwrap_or(m).clone(),
            },
            local_tissue,
        );
        let reshaped = edited.is_some() || borrowed;
        let edited_phase = edited.and_then(|e| e.1);
        // Per-quarter memo and bins: nothing mutable is shared between threads.
        let regional = RegionalIndex::new(roads, nucleus_radius * 1.5);
        let bins = std::sync::Mutex::new(Bins::new(20.0, usize::MAX));
        let local_field = Field {
            regional: &regional,
            bins: &bins,
            others,
            reads,
            p: &local_morph,
            noise: Noise::new(rng.fork("field")),
            radial: (cfg.tissue == "radial" || field.radial)
                && phases.get(q.phase).is_none_or(|p| p.kind != "faubourg"),
            center: local_center,
            phases: &phases,
            phase_morphs: if local_tissue == cfg.tissue && !reshaped {
                &phase_morphs
            } else {
                &[]
            },
            phase_index: &phase_index,
            frame: None,
            ..field
        };
        // A planned grid is one lattice for the whole town: the same frame and
        // origin in every quarter, so its lines run on across the quarter
        // streets and meet them in crossroads rather than staggered tees.
        let lattice = if local_morph.text("streetOp") == "grid" {
            structure
                .as_ref()
                .and_then(|s| {
                    s.centers
                        .iter()
                        .max_by(|a, b| a.weight.total_cmp(&b.weight))
                })
                .map_or(field.center, |c| c.point)
        } else {
            local_center
        };
        let hint = local_field.grid_frame(lattice);
        let frame = if local_morph.text("streetOp") == "grid" {
            armature_frame(&base_streets, lattice, hint).unwrap_or(hint)
        } else {
            hint
        };
        let local_field = Field {
            center: lattice,
            frame: Some(frame),
            ..local_field
        };
        if !phases.is_empty() {
            local_cfg.zone = q.zone.clone();
        }
        let quarter_tick = std::time::Instant::now();
        let mut own = vec![];
        let pcs = split_quarter(q, &local_field, &local_cfg, &mut own, &mut qr);
        if std::env::var("URBAN_PROFILE").is_ok() && quarter_tick.elapsed().as_millis() > 200 {
            eprintln!(
                "    quarter {i}: {:.0} ms, {:.1} ha, {} pieces, {} outer vertices",
                quarter_tick.elapsed().as_secs_f64() * 1000.0,
                g::area(&q.shape) / 10_000.0,
                pcs.len(),
                q.shape.outer.len()
            );
        }
        if !phases.is_empty() && cfg.access_mode != "none" {
            closes(
                &pcs,
                &mut own,
                &local_field,
                &local_cfg,
                &mut rng.fork(&super::edits::quarter_fork("closes", i, cfg)), // edits hook (urban/edits.rs): salt
            );
        }
        Ok((pcs, own, edited_phase))
    };
    let mut pieces = Vec::with_capacity(quarters.len());
    let mut added = vec![];
    let mut edited_phases = vec![];
    let run = |i: usize, others: &[Layer<'_>]| {
        let reads = std::sync::Mutex::new(vec![]);
        let result = cut(i, &quarters[i], others, Some(&reads));
        (result, reads.into_inner().unwrap())
    };
    let streets_of = |c: &(Result<CutQuarter, String>, Vec<Read>)| -> Vec<Street> {
        c.0.as_ref().map_or_else(|_| vec![], |r| r.1.clone())
    };
    let mut results: Vec<Option<_>> = super::par::range(quarters.len(), |i| Some(run(i, &[])));
    let width = super::par::threads();
    let mut added_bins = Bins::new(20.0, usize::MAX);
    let (mut recut, mut rounds) = (0, 0);
    for i in 0..quarters.len() {
        added_bins.sync(&added);
        let finals: Layer<'_> = (&added, &added_bins);
        let current = results[i].as_ref().expect("quarter cut");
        if !current.1.iter().all(|r| r.holds(&[finals])) {
            // Recut this quarter with the true earlier streets, and in the
            // same parallel round the next quarters that also fail, each shown
            // the window's current streets before it as a guess: they are
            // validated again when the serial pass reaches them.
            let mut members = vec![(i, vec![])];
            let mut guess = streets_of(current);
            let mut guess_bins = Bins::new(20.0, usize::MAX);
            for k in i + 1..quarters.len().min(i + 8 * width) {
                if members.len() >= width {
                    break;
                }
                guess_bins.sync(&guess);
                let next = results[k].as_ref().expect("quarter cut");
                if !next
                    .1
                    .iter()
                    .all(|r| r.holds(&[finals, (&guess, &guess_bins)]))
                {
                    members.push((k, guess.clone()));
                }
                guess.extend(streets_of(next));
            }
            recut += members.len();
            rounds += 1;
            let redone = super::par::map(&members, |_, (k, guess)| {
                let mut bins = Bins::new(20.0, usize::MAX);
                bins.sync(guess);
                run(*k, &[finals, (guess, &bins)])
            });
            for ((k, _), c) in members.iter().zip(redone) {
                results[*k] = Some(c);
            }
        }
        // Exact now: kept by its reads, or just cut with the true streets.
        let (result, _) = results[i].take().expect("quarter cut");
        let (pcs, own, edited_phase) = result?;
        pieces.push(pcs);
        added.extend(own);
        if let Some(phase) = edited_phase {
            edited_phases.push((i, phase));
        }
    }
    if std::env::var("URBAN_PROFILE").is_ok() {
        eprintln!(
            "    split: {recut} recuts of {} quarters in {rounds} rounds",
            quarters.len()
        );
    }
    lap("split");
    let mut cr = rng.fork("closes");
    if phases.is_empty() && cfg.access_mode != "none" {
        // The whole split network is this pass's own: the closes see it all.
        let bins = std::sync::Mutex::new(Bins::new(20.0, usize::MAX));
        closes(
            &pieces.iter().flatten().cloned().collect::<Vec<_>>(),
            &mut added,
            &Field {
                bins: &bins,
                noise: Noise::new(rng.fork("field")),
                ..field
            },
            cfg,
            &mut cr,
        );
    }
    streets = base_streets;
    streets.extend(added);
    // Slits and snapped endpoints must obey the same physical rules as arterials.
    streets.retain_mut(|s| {
        if matches!(s.role.as_str(), "bridge" | "ford" | "causeway") {
            return true;
        }
        let limit = if s.rank >= 3 {
            cfg.max_lane_grade
        } else {
            cfg.max_street_grade
        };
        if routing::path_clear(surface, &s.path, limit) {
            return true;
        }
        if s.rank >= 3
            && cfg.allow_stairs
            && routing::path_clear(surface, &s.path, cfg.max_stair_grade)
        {
            s.role = "stairs".into();
            for w in &mut s.widths {
                *w = w.min(2.2);
            }
            return true;
        }
        false
    });
    lap("closes+retain");
    network::join_crossings(
        &mut streets,
        surface,
        cfg.max_street_grade,
        nucleus_radius.clamp(60.0, 200.0),
    );
    network::enclosure_lanes(
        &mut streets,
        &enclosures,
        surface,
        cfg,
        &mut rng.fork("wall-lanes"),
    );
    let centers = structure
        .as_ref()
        .map_or_else(Vec::new, |s| s.centers.iter().map(|c| c.point).collect());
    warnings.extend(if centers.is_empty() {
        network::clean(
            &mut streets,
            center,
            radius,
            !enclosures.is_empty() || cfg.exit_treatment != "legacy",
        )
    } else {
        network::clean_with_centers(
            &mut streets,
            center,
            radius,
            !enclosures.is_empty() || cfg.exit_treatment != "legacy",
            &centers,
        )
    });
    if open_edge && cfg.exit_treatment != "legacy" {
        network::resolve_exits(
            &mut streets,
            &quarters,
            roads,
            &enclosures,
            surface,
            cfg,
            &mut rng.fork("exit-destinations"),
        );
        warnings.extend(network::clean_with_centers(
            &mut streets,
            center,
            radius,
            true,
            &centers,
        ));
    }
    lap("clean+exits");
    {
        // Main centre first; every quarter routes to its nearest centre.
        let mut ordered: Vec<_> = structure.as_ref().map_or_else(Vec::new, |s| {
            s.centers.iter().map(|c| (c.weight, c.point)).collect()
        });
        ordered.sort_by(|a, b| b.0.total_cmp(&a.0));
        let mut hubs: Vec<Point> = ordered.into_iter().map(|c| c.1).collect();
        if hubs.is_empty() {
            hubs.push(center);
        }
        let gates: Vec<Point> = enclosures.iter().flat_map(|e| e.gates.clone()).collect();
        let anchors: Vec<Point> = quarters
            .iter()
            .map(|q| g::interior_point(&q.shape))
            .collect();
        let base: [f64; 5] = std::array::from_fn(|r| {
            m.value["widthByRank"][r].as_f64().unwrap_or(3.0) * m.number_or("widthScale", 1.0)
        });
        let axis = m.value["streets"]
            .as_array()
            .is_some_and(|a| a.iter().any(|v| v.as_str() == Some("axis")));
        network::hierarchy(
            &mut streets,
            &hubs,
            &gates,
            &anchors,
            site.population,
            base,
            axis,
        );
    }
    lap("hierarchy");
    super::widths::harmonize(&mut streets);
    network::cap_gate_passages(&mut streets, &enclosures);
    if open_edge
        && cfg.composition == "settlement"
        && cfg.exit_treatment != "legacy"
        && cfg.footprint.mechanism != "legacy"
    {
        let frontage = super::fringe::frontages(
            &quarters,
            &streets,
            surface,
            m.range("plotDepth", "edge")[0],
            cfg.max_lane_grade,
            &mut rng.fork("peripheral-frontage"),
        );
        let frontage = off_reserve(frontage, &enclosures, &streets);
        let first_outer = quarters.len();
        // Peripheral frontage inherits the density of its epoch, so the dense
        // core keeps its share of the population after the extension.
        let densities: Vec<f64> = phases
            .iter()
            .map(|p| p.population / p.shapes.iter().map(g::area).sum::<f64>().max(1.0))
            .collect();
        let mut extensions = phases.clone();
        for p in &mut extensions {
            p.shapes.clear();
        }
        for (shape, source) in frontage {
            let phase = quarters[source].phase;
            quarters.push(Quarter {
                shape: shape.clone(),
                phase,
                zone: quarters[source].zone.clone(),
            });
            pieces.push(vec![Piece {
                shape: shape.clone(),
                level: 0,
                kind: "block".into(),
            }]);
            if let Some(p) = extensions.get_mut(phase) {
                p.shapes.push(shape);
            }
        }
        if !cfg.mix_culture.is_empty() && first_outer < quarters.len() {
            extensions.retain(|p| !p.shapes.is_empty());
            super::influences::apply(&mut extensions, &mut quarters[first_outer..], site, cfg);
            for q in &mut quarters[first_outer..] {
                q.phase += phases.len();
            }
            phases.extend(extensions);
        } else {
            for (p, extension) in phases.iter_mut().zip(extensions) {
                p.shapes.extend(extension.shapes);
            }
        }
        let area: f64 = phases.iter().flat_map(|p| &p.shapes).map(g::area).sum();
        let density = |i: usize| {
            densities
                .get(i % densities.len().max(1))
                .copied()
                .unwrap_or(1.0)
        };
        let housed: f64 = phases
            .iter()
            .enumerate()
            .map(|(i, p)| p.shapes.iter().map(g::area).sum::<f64>() * density(i))
            .sum();
        if area > 0.0 && housed > 0.0 {
            for (i, p) in phases.iter_mut().enumerate() {
                let share = p.shapes.iter().map(g::area).sum::<f64>() / area;
                p.population = site.population as f64 * share * area * density(i) / housed;
                if let Some(s) = &structure {
                    p.target_area = s.metrics.target_area * share;
                }
            }
        }
    }
    lap("harmonize+fringe");
    // Street and wall ribbons, built per street in parallel (input order).
    let ribbon_sources: Vec<(&[Point], Vec<f64>)> = streets
        .iter()
        .map(|s| (s.path.as_slice(), s.widths.clone()))
        .chain(enclosures.iter().map(|e| {
            (
                e.path.as_slice(),
                vec![if e.kind == "wall" { 3.0 } else { 1.5 }],
            )
        }))
        .collect();
    let ribbons: Vec<_> = super::par::map(&ribbon_sources, |_, (path, widths)| {
        g::ribbon(path, widths)
            .into_iter()
            .map(|p| {
                let bb = g::bbox(&p);
                (g::polygon(&p), bb)
            })
            .collect::<Vec<_>>()
    })
    .into_iter()
    .flatten()
    .collect();
    drop(ribbon_sources);
    let ribbon_bins = RibbonBins::new(&ribbons);
    let mut blocks = vec![];
    let fringe = rng.fork("open-fringe");
    // After the hierarchy, main streets (rank <= 1) play the former role of
    // the quarter arterials: backland vacancy is measured from them.
    let mut final_bins = Bins::new(50.0, 1);
    final_bins.sync(&streets);
    let flat: Vec<(usize, Piece)> = pieces
        .into_iter()
        .enumerate()
        .flat_map(|(qi, pcs)| pcs.into_iter().map(move |pc| (qi, pc)))
        .collect();
    // Pure per piece (parallel): street ribbons cut out in ribbon order, then
    // the frame, phase and backland vacancy of each remaining shape. The
    // vacancy draw stays serial below, in piece order.
    let cut_pieces = super::par::map(&flat, |_, (_, pc)| {
        let bb = g::bbox(&pc.shape);
        let mut polys = vec![pc.shape.clone()];
        for k in ribbon_bins.candidates(bb) {
            let (r, rb) = &ribbons[k];
            if bb.0 > rb.2 || bb.2 < rb.0 || bb.1 > rb.3 || bb.3 < rb.1 {
                continue;
            }
            polys = polys
                .into_iter()
                .flat_map(|p| g::shapes(g::polygon(&p).difference(r)))
                .collect();
            if polys.is_empty() {
                break;
            }
        }
        if !cfg.mix_culture.is_empty() {
            polys = polys
                .into_iter()
                .flat_map(|shape| {
                    phases.iter().flat_map(move |p| {
                        p.shapes.iter().flat_map({
                            let shape = shape.clone();
                            move |s| g::intersection(&shape, s)
                        })
                    })
                })
                .collect();
        }
        polys
            .into_iter()
            .filter(|p| g::area(p) > 1.0)
            .map(|shape| {
                let f = frame(&shape);
                let vacancy = (pc.kind == "block"
                    && cfg.placement == "center"
                    && !walled.iter().any(|w| g::contains(w, f.c)))
                .then(|| {
                    let distance = (f.c.x - center.x).hypot(f.c.y - center.y) / nucleus_radius;
                    let arterial = final_bins
                        .nearest(f.c, &streets, 1, 100.0)
                        .map_or(f64::INFINITY, |v| v.0);
                    // Leave whole backland cells between the populated fingers.
                    // No parcel is clipped by a second decorative city outline.
                    smooth(distance, 0.7, 1.05) * smooth(arterial, 18.0, 90.0) * 0.8
                });
                let phase = if phases.is_empty() {
                    None
                } else {
                    let interior = g::interior_point(&shape);
                    phases
                        .iter()
                        .position(|p| p.shapes.iter().any(|s| g::contains(s, interior)))
                };
                (shape, f, vacancy, phase)
            })
            .collect::<Vec<_>>()
    });
    let mut vacancies = vec![];
    for ((qi, pc), shapes) in flat.into_iter().zip(cut_pieces) {
        for (shape, f, vacancy, phase) in shapes {
            vacancies.push(vacancy);
            blocks.push(Block {
                phase,
                zone: if let Some(i) = phase {
                    phases[i].zone.clone()
                } else if !phases.is_empty() {
                    quarters[qi].zone.clone()
                } else if cfg.zone == "auto" {
                    zone_at(f.c, center, radius, site.population).into()
                } else {
                    cfg.zone.clone()
                },
                shape,
                quarter: qi,
                kind: pc.kind.clone(),
                axis: f.u,
            })
        }
    }
    // Invariant: the parcels hold the households the plan needs. Their real
    // capacity is measured on a sample of these blocks with the parcel stage
    // itself (`capacity::measure`); when short, the lots densify further within
    // the culture's ranges. Fringe fields then take only the measured surplus:
    // the vacancy chances are scaled so the expected land left open stays
    // within it, and each block draws from its own stream keyed by its
    // geometry, so a change elsewhere in the network never reshuffles it.
    let mut measured: Option<Vec<f64>> = None;
    // A tissue predicted to hold `capacity::AMPLE` times its households, as
    // drawn, is not measured: even the largest over-prediction of the sweep
    // leaves it housed, and its fringe stays the culture's own.
    let ample = plan.as_ref().is_some_and(|p| {
        p.densify <= 0.0
            && p.extension <= 1.001
            && p.borrowed_share <= 0.0
            && p.forecast >= capacity::AMPLE * p.required
    });
    if let Some(p) = plan.as_mut().filter(|_| !ample) {
        let mut probe = Layout {
            config: Some(applied.clone()),
            programme: None,
            key: site.key.clone(),
            culture: if cfg.culture == "site" {
                site.culture.clone()
            } else {
                cfg.culture.clone()
            },
            center,
            quarters: quarters.clone(),
            streets: streets.clone(),
            blocks: blocks.clone(),
            warnings: vec![],
            enclosures: vec![],
            phases: phases.clone(),
            archetype: archetype.clone(),
            structure: structure.clone(),
        };

        let required = p.required * capacity::MEASURE_MARGIN / (1.0 - capacity::BLOCK_LOSS);
        let run = |p: &CapacityPlan, probe: &mut Layout| {
            if let Some(s) = probe.structure.as_mut() {
                s.metrics.capacity = Some(p.clone());
            }
            capacity::measure(probe, seed, cfg, site.population, surface)
        };
        let mut found = run(p, &mut probe);
        let total = |m: &Option<capacity::Measure>| {
            m.as_ref().map_or(0.0, |m| m.per_block.iter().sum::<f64>())
        };
        // The plan's own prediction, measured: the tissue as planned, with
        // the culture's own fringe fields (the closed loop compares the two).
        if let Some(m) = &found {
            let open: f64 = m
                .per_block
                .iter()
                .zip(&vacancies)
                .map(|(h, v)| h * v.unwrap_or(0.0))
                .sum();
            p.measured_plan = (total(&found) - open) * (1.0 - capacity::BLOCK_LOSS);
        }
        if total(&found) < required && p.densify < 1.0 {
            let (t0, h0) = (p.densify, total(&found));
            let mut dense = p.clone();
            dense.densify = 1.0;
            let full = run(&dense, &mut probe);
            let h1 = total(&full);
            if h1 > h0 {
                // Lots densify only as far as needed (linear between the two).
                let t = if h1 <= required {
                    1.0
                } else {
                    (t0 + (1.0 - t0) * (required - h0) / (h1 - h0)).clamp(t0, 1.0)
                };
                p.densify = (t * 100.0).ceil() / 100.0;
                found = if p.densify >= 1.0 {
                    full
                } else {
                    run(p, &mut probe)
                };
            }
        }
        if let Some(m) = found {
            let total: f64 = m.per_block.iter().sum();
            let open: f64 = m
                .per_block
                .iter()
                .zip(&vacancies)
                .map(|(h, v)| h * v.unwrap_or(0.0))
                .sum();
            p.vacancy = if open > 0.0 {
                ((total - required) / open).clamp(0.0, 1.0)
            } else {
                1.0
            };
            p.measured_garden = m.garden;
            measured = Some(m.per_block);
        }
    }
    let vacancy_scale = plan.as_ref().map_or(1.0, |p| p.vacancy);
    for (b, vacancy) in blocks.iter_mut().zip(&vacancies) {
        if let Some(vacancy) = vacancy
            && b.kind == "block"
        {
            let c = g::interior_point(&b.shape);
            // The block's interior point on a 2 m grid: its identity, blind
            // to sub-metre jitter of its outline.
            let key = format!("block:{:.0}:{:.0}", c.x / 2.0, c.y / 2.0);
            if fringe.fork(&key).chance(vacancy * vacancy_scale) {
                b.kind = "reserve".into();
            }
        }
    }
    let predicted: f64 = measured.as_ref().map_or_else(
        || {
            plan.as_ref()
                .map_or(0.0, |p| p.forecast / (1.0 - capacity::BLOCK_LOSS))
        },
        |m| {
            m.iter()
                .zip(&blocks)
                .filter(|(_, b)| b.kind == "block")
                .map(|(h, _)| h)
                .sum()
        },
    );
    lap("blocks");
    // A block that fronts no street (a strip between a wall and the town
    // edge) cannot be parcelled; it stays open land rather than lots served
    // by nothing.
    let mut all = Bins::new(20.0, usize::MAX);
    all.sync(&streets);
    let reach = streets
        .iter()
        .flat_map(|s| s.widths.iter())
        .fold(0.0, |a: f64, &w| a.max(w))
        * 0.5
        + 2.0;
    let served = |b: &Block| {
        b.shape.outer.iter().any(|&p| {
            all.around(p, reach).any(|(i, j)| {
                let s = &streets[i];
                g::distance(p, s.path[j], s.path[j + 1]).0
                    <= s.widths[j].max(s.widths[j + 1]) * 0.5 + 2.0
            })
        })
    };
    let mut served_flags = super::par::map(&blocks, |_, b| served(b));
    let unserved: Vec<usize> = (0..blocks.len())
        .filter(|&i| blocks[i].kind == "block" && !served_flags[i])
        .collect();
    // A cut whose street was dropped later (isolated fragment, grade) leaves
    // its two sides touching: the streetless side rejoins its served neighbour.
    let mut closed = 0;
    let mut gone = vec![false; blocks.len()];
    // Block boxes once (kept current on merges), not per unserved block.
    let mut boxes: Vec<_> = blocks.iter().map(|b| g::bbox(&b.shape)).collect();
    for i in unserved {
        let bb = boxes[i];
        let neighbour = (0..blocks.len()).find_map(|j| {
            let b = &blocks[j];
            let o = boxes[j];
            if j == i
                || gone[j]
                || b.quarter != blocks[i].quarter
                || b.kind != "block"
                || o.0 > bb.2 + 0.5
                || bb.0 > o.2 + 0.5
                || o.1 > bb.3 + 0.5
                || bb.1 > o.3 + 0.5
                || !served_flags[j]
            {
                return None;
            }
            let merged = g::union(&[b.shape.clone(), blocks[i].shape.clone()]);
            (merged.len() == 1).then(|| (j, merged.into_iter().next().unwrap()))
        });
        if let Some((j, shape)) = neighbour {
            blocks[j].shape = shape;
            boxes[j] = g::bbox(&blocks[j].shape);
            served_flags[j] = served(&blocks[j]);
            gone[i] = true;
        } else {
            blocks[i].kind = "reserve".into();
            closed += 1;
        }
    }
    let mut index = 0;
    blocks.retain(|_| {
        index += 1;
        !gone[index - 1]
    });
    if closed > 0 {
        warnings.push(format!(
            "{closed} îlot(s) sans façade sur rue laissé(s) en espace ouvert."
        ));
    }
    // An edited quarter culture travels to its lots through a phase of its own
    // (appended, so earlier phase indices never move).
    for (qi, phase) in edited_phases {
        let index = phases.len();
        phases.push(phase);
        for b in blocks.iter_mut().filter(|b| b.quarter == qi) {
            b.phase = Some(index);
        }
    }
    lap("overrides");
    if cfg.placement == "center" {
        let mut hubs: Vec<(Point, f64)> = structure.as_ref().map_or_else(Vec::new, |s| {
            s.centers.iter().map(|c| (c.point, c.weight)).collect()
        });
        hubs.sort_by(|a, b| b.1.total_cmp(&a.1));
        if hubs.is_empty() {
            hubs.push((center, 1.0));
        }
        let gates: Vec<Point> = enclosures.iter().flat_map(|e| e.gates.clone()).collect();
        squares(
            &mut blocks,
            &streets,
            &hubs,
            &gates,
            site.population,
            m,
            &mut rng.fork("squares"),
        );
    }
    if cfg.monument != "none"
        && let Some(b) = blocks
            .iter_mut()
            .filter(|b| b.kind == "block")
            .max_by(|a, b| g::area(&a.shape).total_cmp(&g::area(&b.shape)))
    {
        b.kind = format!("compound:{}", cfg.monument)
    }
    let mut layout = Layout {
        config: Some(applied.clone()),
        programme: None,
        key: site.key.clone(),
        culture: if cfg.culture == "site" {
            site.culture.clone()
        } else {
            cfg.culture.clone()
        },
        center,
        quarters,
        streets,
        blocks,
        warnings,
        enclosures,
        phases,
        archetype,
        structure,
    };
    if let Some(mut p) = plan {
        let culture = layout.culture.clone();
        p.predicted = predicted * (1.0 - capacity::BLOCK_LOSS);
        p.shortfall = (p.required - p.predicted).max(0.0);
        let steps = capacity::describe(&culture, &p);
        let short = p.shortfall > 0.05 * p.required;
        if !steps.is_empty() || short {
            let housed = (p.predicted / p.required.max(1.0)).min(1.0);
            layout.warnings.push(format!(
                "Capacité prévue : {} — {} % des ménages logeables{}.",
                if steps.is_empty() {
                    "tissu tel que dessiné".to_owned()
                } else {
                    steps.join(", ")
                },
                (housed * 100.0).round(),
                if short {
                    " ; le terrain ou les bornes de la culture limitent l’emprise"
                } else {
                    ""
                }
            ));
        }
        if let Some(s) = layout.structure.as_mut() {
            s.metrics.capacity = Some(p);
        }
    }
    Ok(layout)
}

/// Reference blocks of a tissue for the capacity probe (`footprint::capacity`):
/// one square quarter on flat open ground, framed by four main streets, cut by
/// the culture's own recursive streets and closes (`split_quarter`, `closes`),
/// then carved by its street ribbons like any city. `offset` is the quarter's
/// distance to the town centre. Returns the blocks, all streets and the gross
/// land of the quarter.
pub(super) fn probe_quarter(
    morph: &Morph,
    cfg: &LayoutConfig,
    zone: &str,
    population: u32,
    offset: f64,
    seed: &str,
) -> (Vec<Block>, Vec<Street>, f64) {
    let street = |rank: usize| {
        morph.value["widthByRank"][rank].as_f64().unwrap_or(4.5)
            * morph.number_or("widthScale", 1.0).max(0.1)
    };
    let (w, h) = if morph.text("streetOp") == "grid" {
        let lanes = morph.pair("laneSpacing");
        let sp = if lanes[0] > 0.0 && lanes[1] > 0.0 {
            lanes
        } else {
            morph.pair("gridSpacing")
        };
        (3.0 * sp[0].max(20.0), 3.0 * sp[1].max(20.0))
    } else {
        let [lo, hi] = morph.range("blockSize", zone);
        let (lo, hi) = (lo.max(300.0), hi.max(lo.max(300.0)));
        let mean = if hi > lo * 1.001 {
            (hi - lo) / (hi / lo).ln()
        } else {
            lo
        };
        let side = (10.0 * mean).clamp(10_000.0, 250_000.0).sqrt();
        (side, side)
    };
    // Flat open ground; the quarter lies `offset` east of the centre.
    let width = 4.0 * (offset + w + h + 1000.0);
    let heights = [0.0_f32; 4];
    let water = [0_u8; 4];
    let surface = Surface {
        geometry: None,
        width,
        n: 2,
        height: &heights,
        water: &water,
    };
    let center = Point {
        x: width * 0.5,
        y: width * 0.5,
    };
    let (x0, y0) = (center.x + offset, center.y - h * 0.5);
    let corners = [
        Point { x: x0, y: y0 },
        Point { x: x0 + w, y: y0 },
        Point {
            x: x0 + w,
            y: y0 + h,
        },
        Point { x: x0, y: y0 + h },
    ];
    let main = street(1);
    let base: Vec<Street> = (0..4)
        .map(|i| {
            let (a, b) = (corners[i], corners[(i + 1) % 4]);
            let path = (0..=8)
                .map(|k| Point {
                    x: a.x + (b.x - a.x) * k as f64 / 8.0,
                    y: a.y + (b.y - a.y) * k as f64 / 8.0,
                })
                .collect::<Vec<_>>();
            Street {
                widths: vec![main; path.len()],
                path,
                rank: 1,
                role: "street".into(),
            }
        })
        .collect();
    let mut base_bins = Bins::new(20.0, usize::MAX);
    base_bins.sync(&base);
    let mut major = Bins::new(50.0, 1);
    major.sync(&base);
    let bins = std::sync::Mutex::new(Bins::new(20.0, usize::MAX));
    let regional = RegionalIndex::new(&[], 100.0);
    let rng = Rng::new(seed).fork("capacity-probe-quarter");
    let field = Field {
        regional: &regional,
        align_regional: false,
        adaptation: 0.0,
        p: morph,
        center,
        angle: 0.0,
        terrain: 0.0,
        water: 0.0,
        surface,
        noise: Noise::new(rng.fork("field")),
        radius: (offset + w).max(200.0),
        population,
        radial: false,
        phases: &[],
        phase_morphs: &[],
        phase_index: &[],
        base: &base,
        base_bins: &base_bins,
        others: &[],
        bins: &bins,
        reads: None,
        major: &major,
        frame: (morph.text("streetOp") == "grid").then_some(0.0),
    };
    let quarter = Quarter {
        shape: Shape {
            outer: corners.to_vec(),
            holes: vec![],
        },
        phase: 0,
        zone: zone.into(),
    };
    let local = LayoutConfig {
        zone: zone.into(),
        ..cfg.clone()
    };
    let mut own = vec![];
    let mut qr = rng.fork("split");
    let pieces = split_quarter(&quarter, &field, &local, &mut own, &mut qr);
    if cfg.access_mode != "none" {
        closes(&pieces, &mut own, &field, &local, &mut rng.fork("closes"));
    }
    let streets: Vec<Street> = base.iter().cloned().chain(own).collect();
    let ribbons: Vec<_> = streets
        .iter()
        .flat_map(|s| g::ribbon(&s.path, &s.widths))
        .map(|r| g::polygon(&r))
        .collect();
    let mut blocks = vec![];
    for pc in pieces {
        let mut polys = vec![pc.shape.clone()];
        for r in &ribbons {
            polys = polys
                .into_iter()
                .flat_map(|p| g::shapes(g::polygon(&p).difference(r)))
                .collect();
        }
        for shape in polys.into_iter().filter(|p| g::area(p) > 1.0) {
            let f = frame(&shape);
            blocks.push(Block {
                shape,
                quarter: 0,
                kind: pc.kind.clone(),
                axis: f.u,
                zone: zone.into(),
                phase: Some(0),
            });
        }
    }
    (blocks, streets, w * h)
}

/// Quarters cut with the borrowed tissue: the youngest growth first, then the
/// outermost, until their land reaches the plan's share. User-edited quarters
/// keep their own edit.
fn borrowed_quarters(
    quarters: &[Quarter],
    center: Point,
    share: f64,
    cfg: &LayoutConfig,
) -> Vec<usize> {
    let total: f64 = quarters.iter().map(|q| g::area(&q.shape)).sum();
    let mut order: Vec<(usize, usize, f64, f64)> = quarters
        .iter()
        .enumerate()
        .filter(|(i, _)| !super::edits::keeps_own_tissue(cfg, *i)) // edits hook (urban/edits.rs)
        .map(|(i, q)| {
            let c = g::interior_point(&q.shape);
            (
                i,
                q.phase,
                (c.x - center.x).hypot(c.y - center.y),
                g::area(&q.shape),
            )
        })
        .collect();
    order.sort_by(|a, b| b.1.cmp(&a.1).then(b.2.total_cmp(&a.2)).then(a.0.cmp(&b.0)));
    let mut taken = 0.0;
    let mut out = vec![];
    for (i, _, _, a) in order {
        if taken >= share * total {
            break;
        }
        taken += a;
        out.push(i);
    }
    out.sort_unstable();
    out
}

/// Smallest frontage piece kept where the fortification reserve cuts it.
const MIN_FRONTAGE_PIECE: f64 = 100.0;

/// Peripheral frontage never takes the fortification reserve (curtain body,
/// ditch, berm, glacis, works): each piece gives it up before it becomes a
/// quarter, keeping its parts of at least `MIN_FRONTAGE_PIECE` m² that still
/// face a peripheral road (a part cut off behind the glacis has no street).
fn off_reserve(
    frontage: Vec<(Shape, usize)>,
    enclosures: &[super::Enclosure],
    streets: &[Street],
) -> Vec<(Shape, usize)> {
    let reserve: Vec<(Shape, (f64, f64, f64, f64))> = enclosures
        .iter()
        .flat_map(|e| e.reserve.iter())
        .map(|r| (r.clone(), g::bbox(r)))
        .collect();
    if reserve.is_empty() {
        return frontage;
    }
    let overlaps = |a: (f64, f64, f64, f64), b: (f64, f64, f64, f64)| {
        a.0 <= b.2 && b.0 <= a.2 && a.1 <= b.3 && b.1 <= a.3
    };
    let roads: Vec<(Point, Point, f64, (f64, f64, f64, f64))> = streets
        .iter()
        .filter(|s| s.role == "peripheral")
        .flat_map(|s| {
            s.path.windows(2).enumerate().map(move |(i, w)| {
                let half = s.widths.get(i).or(s.widths.first()).copied().unwrap_or(4.0) * 0.5;
                let m = half + 1.5;
                let bb = (
                    w[0].x.min(w[1].x) - m,
                    w[0].y.min(w[1].y) - m,
                    w[0].x.max(w[1].x) + m,
                    w[0].y.max(w[1].y) + m,
                );
                (w[0], w[1], m, bb)
            })
        })
        .collect();
    // The frontage band holds its road corridor: a part faces the road when
    // the road runs through it or passes within its half width + 1.5 m.
    let faces_road = |s: &Shape| {
        let bb = g::bbox(s);
        let ring = &s.outer;
        roads.iter().any(|&(a, b, m, rb)| {
            overlaps(bb, rb)
                && (g::contains(s, a)
                    || g::contains(s, b)
                    || ring.iter().any(|&p| g::distance(p, a, b).0 <= m)
                    || ring
                        .iter()
                        .zip(ring.iter().cycle().skip(1))
                        .any(|(&c, &d)| g::segment_hit(a, b, c, d).is_some()))
        })
    };
    frontage
        .into_iter()
        .flat_map(|(shape, source)| {
            let bb = g::bbox(&shape);
            let mut parts = vec![shape.clone()];
            for (r, rb) in &reserve {
                if !overlaps(bb, *rb) {
                    continue;
                }
                parts = parts
                    .into_iter()
                    .flat_map(|p| {
                        if overlaps(g::bbox(&p), *rb) {
                            g::difference(&p, r)
                        } else {
                            vec![p]
                        }
                    })
                    .collect();
            }
            let cut = (parts.iter().map(g::area).sum::<f64>() - g::area(&shape)).abs() > 0.5;
            if !cut {
                return vec![(shape, source)];
            }
            parts
                .into_iter()
                .filter(|p| g::area(p) >= MIN_FRONTAGE_PIECE && faces_road(p))
                .map(|p| (p, source))
                .collect::<Vec<_>>()
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Peripheral frontage gives up the fortification reserve before it
    /// becomes a quarter; what is left of it still faces its road.
    #[test]
    fn peripheral_frontage_never_enters_the_wall_reserve() {
        let road = Street {
            path: vec![Point { x: 0.0, y: 50.0 }, Point { x: 100.0, y: 50.0 }],
            widths: vec![6.0, 6.0],
            rank: 2,
            role: "peripheral".into(),
        };
        // The band along the road; the reserve takes its west end and a
        // strip across it (60 < y < 64), cutting off a part with no road.
        let band = g::rectangle(0.0, 25.0, 100.0, 75.0);
        let enclosure = super::super::Enclosure {
            reserve: vec![
                g::rectangle(-10.0, 0.0, 30.0, 100.0),
                g::rectangle(30.0, 60.0, 110.0, 64.0),
            ],
            ..Default::default()
        };
        let kept = off_reserve(vec![(band, 3)], std::slice::from_ref(&enclosure), &[road]);
        assert!(!kept.is_empty());
        for (shape, source) in &kept {
            assert_eq!(*source, 3);
            assert!(g::area(shape) >= MIN_FRONTAGE_PIECE);
            for r in &enclosure.reserve {
                let inside: f64 = g::intersection(shape, r).iter().map(g::area).sum();
                assert!(inside < 0.01, "{inside:.2} m² in the reserve");
            }
        }
        let area: f64 = kept.iter().map(|(s, _)| g::area(s)).sum();
        assert!((area - 70.0 * 35.0).abs() < 1.0, "{area:.1}");
        // No reserve: the frontage is returned untouched.
        let free = off_reserve(vec![(g::rectangle(0.0, 25.0, 100.0, 75.0), 1)], &[], &[]);
        assert_eq!(free.len(), 1);
    }
    /// Flat plain crossed by two regional roads; returns the full native quarter stage.
    pub(in super::super) fn flat_city(
        culture: &str,
        population: u32,
        fortification: &str,
    ) -> (Layout, f64) {
        let n = 256;
        let width = (8.0 * (population as f64 * 10_000.0 / 60.0 / PI).sqrt()).max(3000.0);
        let heights = vec![10.0; n * n];
        let water = vec![0; n * n];
        let surface = Surface {
            geometry: None,
            width,
            n,
            height: &heights,
            water: &water,
        };
        let road = |a: Point, b: Point| Street {
            path: (0..=24)
                .map(|i| Point {
                    x: a.x + (b.x - a.x) * i as f64 / 24.0,
                    y: a.y + (b.y - a.y) * i as f64 / 24.0,
                })
                .collect(),
            widths: vec![7.0; 25],
            rank: 0,
            role: "regional".into(),
        };
        let c = width * 0.5;
        let roads = vec![
            road(
                Point {
                    x: 1.0,
                    y: c - 40.0,
                },
                Point {
                    x: width - 1.0,
                    y: c + 60.0,
                },
            ),
            road(
                Point {
                    x: c + 30.0,
                    y: 1.0,
                },
                Point {
                    x: c - 50.0,
                    y: width - 1.0,
                },
            ),
        ];
        let site = Site {
            key: "probe".into(),
            name: "Probe".into(),
            population,
            culture: culture.into(),
            center: Point { x: c, y: c },
            radius: 300.0,
        };
        let cfg = LayoutConfig {
            fortification: fortification.into(),
            ..LayoutConfig::default()
        };
        let started = std::time::Instant::now();
        let layout = super::super::generate_quarters(
            "probe-city",
            std::slice::from_ref(&site),
            &cfg,
            surface,
            &roads,
        )
        .unwrap()
        .remove(0);
        (layout, started.elapsed().as_secs_f64())
    }
    #[test]
    #[ignore]
    fn probe_city_scale() {
        let mut cases = vec![
            ("european-organic".to_string(), 5_000, "culture"),
            ("european-organic".to_string(), 10_000, "culture"),
            ("medina".to_string(), 12_000, "culture"),
            ("european-organic".to_string(), 50_000, "culture"),
            ("european-organic".to_string(), 100_000, "culture"),
        ];
        if let Ok(only) = std::env::var("URBAN_PROBE") {
            let (culture, pop) = only.split_once(':').unwrap();
            cases = vec![(culture.to_string(), pop.parse().unwrap(), "culture")];
        }
        for (culture, pop, fort) in cases {
            let culture = culture.as_str();
            let (layout, seconds) = flat_city(culture, pop, fort);
            let area: f64 = layout.quarters.iter().map(|q| g::area(&q.shape)).sum();
            let mut ranks = [(0usize, 0.0f64); 5];
            for s in &layout.streets {
                ranks[s.rank.min(4)].0 += 1;
                ranks[s.rank.min(4)].1 += len(&s.path) / 1000.0;
            }
            let places = layout.blocks.iter().filter(|b| b.kind == "place").count();
            let towers: usize = layout.enclosures.iter().map(|e| e.towers.len()).sum();
            println!(
                "{culture} {pop}: {seconds:.2}s area {:.0} ha, quarters {}, blocks {}, places {places}, enclosures {} towers {towers}, ranks {:?}, vertices {}",
                area / 10_000.0,
                layout.quarters.len(),
                layout.blocks.len(),
                layout.enclosures.len(),
                ranks.map(|(n, km)| format!("{n}/{km:.1}km")),
                layout.streets.iter().map(|s| s.path.len()).sum::<usize>(),
            );
        }
    }
    /// Replays a City Bench request on its decor raster (fixture exported from
    /// web/), with URBAN_PROFILE stage timings: URBAN_FIXTURE=path.json.
    #[test]
    #[ignore]
    fn probe_fixture() {
        let Ok(path) = std::env::var("URBAN_FIXTURE") else {
            return;
        };
        let v: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        let n = v["n"].as_u64().unwrap() as usize;
        let width = v["width"].as_f64().unwrap();
        let height: Vec<f32> = serde_json::from_value(v["height"].clone()).unwrap();
        let water: Vec<u8> = serde_json::from_value(v["water"].clone()).unwrap();
        let geometry = (!v["geometry"].is_null() && std::env::var("URBAN_NO_GEOMETRY").is_err())
            .then(|| {
                super::super::Geography::new(
                    serde_json::from_value(v["geometry"].clone()).unwrap(),
                    width,
                )
                .unwrap()
            });
        let surface = Surface {
            geometry: geometry.as_ref(),
            width,
            n,
            height: &height,
            water: &water,
        };
        let cfg: LayoutConfig = serde_json::from_value(v["layoutConfig"].clone()).unwrap();
        let sites: Vec<Site> = serde_json::from_value(v["sites"].clone()).unwrap();
        let roads: Vec<Street> = serde_json::from_value(v["roads"].clone()).unwrap();
        let started = std::time::Instant::now();
        let layout = super::super::generate_quarters(
            v["seed"].as_str().unwrap(),
            &sites,
            &cfg,
            surface,
            &roads,
        )
        .unwrap()
        .remove(0);
        println!(
            "fixture: {:.2}s, {} quarters, {} blocks, {} streets",
            started.elapsed().as_secs_f64(),
            layout.quarters.len(),
            layout.blocks.len(),
            layout.streets.len()
        );
    }
    /// Quarter service (feeders), cuts, ribbons, blocks, parcels and the
    /// programme run per quarter / per block on any number of threads: one
    /// thread and many give byte-identical layouts and partitions.
    #[test]
    fn parallel_quarter_stage_matches_serial() {
        let run = |threads| {
            super::super::par::with_threads(threads, || {
                let (layout, _) = flat_city("european-organic", 20_000, "culture");
                let partitions = super::super::generate_parcels(
                    "probe-city",
                    std::slice::from_ref(&layout),
                    &super::super::ParcelConfig::default(),
                )
                .unwrap();
                serde_json::to_string(&layout).unwrap()
                    + &serde_json::to_string(&partitions).unwrap()
            })
        };
        let serial = run(1);
        let parallel = run(8);
        assert!(
            serial.len() > 100_000,
            "town too small: {} bytes",
            serial.len()
        );
        assert!(
            serial == parallel,
            "parallel quarter stage differs from serial"
        );
    }
    /// A 50k walled european city: the armature scales with its land, main
    /// streets are dense and wider than lanes, the old core is denser than the
    /// periphery, the enceinte keeps faubourgs outside with towers on its curtain,
    /// and the market square exists.
    #[test]
    fn city_scale_hierarchy_density_and_walls() {
        let (layout, _) = flat_city("european-organic", 50_000, "culture");
        let land: f64 = layout.quarters.iter().map(|q| g::area(&q.shape)).sum();
        assert!(
            layout.quarters.len() > 30,
            "{} quarters",
            layout.quarters.len()
        );
        let major: f64 = layout
            .streets
            .iter()
            .filter(|s| s.rank <= 1)
            .map(|s| len(&s.path))
            .sum();
        assert!(
            major / 1000.0 / (land / 1e6) >= 3.0,
            "{major} m of main streets"
        );
        let mean = |rank: usize| {
            let v: Vec<f64> = layout
                .streets
                .iter()
                .filter(|s| s.rank == rank && matches!(s.role.as_str(), "street" | "lane"))
                .flat_map(|s| s.widths.iter().copied())
                .collect();
            v.iter().sum::<f64>() / v.len().max(1) as f64
        };
        assert!(
            mean(1) > mean(2) && mean(2) > mean(3),
            "{} {} {}",
            mean(1),
            mean(2),
            mean(3)
        );
        let density = |p: &super::super::GrowthPhase| {
            p.population / p.shapes.iter().map(g::area).sum::<f64>().max(1.0)
        };
        assert!(density(&layout.phases[0]) > 1.5 * density(layout.phases.last().unwrap()));
        assert_eq!(layout.enclosures.len(), 1);
        let wall = &layout.enclosures[0];
        let inside = g::area(&g::normalized(Shape {
            outer: wall.path[..wall.path.len() - 1].to_vec(),
            holes: vec![],
        }));
        assert!(inside < 0.9 * land, "faubourgs stay outside the enceinte");
        // Flanked either by towers or, on a bastioned (Vauban) trace, by bastions.
        assert!(
            !wall.gates.is_empty() && wall.towers.len() + wall.bastions.len() >= 12,
            "{} towers, {} bastions ({})",
            wall.towers.len(),
            wall.bastions.len(),
            wall.style
        );
        for t in &wall.towers {
            let d = wall
                .path
                .windows(2)
                .map(|e| g::distance(*t, e[0], e[1]).0)
                .fold(f64::INFINITY, f64::min);
            assert!(d < 8.0, "tower {t:?} is {d} m from the curtain");
        }
        assert!(layout.blocks.iter().any(|b| b.kind == "place"));
    }
    #[test]
    fn small_settlement_keeps_disjoint_quarters_and_dry_paths() {
        let heights = vec![0.0; 64 * 64];
        let mut water = vec![0; 64 * 64];
        for y in 0..64 {
            water[y * 64 + 32] = 1;
        }
        let surface = Surface {
            geometry: None,
            width: 512.0,
            n: 64,
            height: &heights,
            water: &water,
        };
        let site = Site {
            key: "small".into(),
            name: "Small".into(),
            population: 80,
            culture: "european".into(),
            center: Point { x: 240.0, y: 256.0 },
            radius: 24.0,
        };
        let cfg = LayoutConfig {
            footprint: super::super::legacy_footprint(),
            access_mode: "cultural".into(),
            preset: "morph/european-organic".into(),
            ..LayoutConfig::default()
        };
        let m = super::super::resolve(
            &site.culture,
            &cfg.preset,
            &cfg.recipe,
            if cfg.zone == "auto" {
                "core"
            } else {
                &cfg.zone
            },
            cfg.density,
            &cfg.params,
            "quarters",
        )
        .unwrap();
        let a = generate("small-radius-regression", &site, &cfg, &m, surface, &[]).unwrap();
        let b = generate("small-radius-regression", &site, &cfg, &m, surface, &[]).unwrap();
        assert_eq!(
            serde_json::to_string(&a).unwrap(),
            serde_json::to_string(&b).unwrap()
        );
        assert!(!a.quarters.is_empty());
        for (i, q) in a.quarters.iter().enumerate() {
            for r in a.quarters.iter().skip(i + 1) {
                assert!(g::intersection(&q.shape, &r.shape).is_empty());
            }
        }
        for s in &a.streets {
            for p in s.path.windows(2) {
                assert!(!surface.wet(Point {
                    x: (p[0].x + p[1].x) * 0.5,
                    y: (p[0].y + p[1].y) * 0.5
                }));
            }
        }
        let tiny_cfg = LayoutConfig {
            placement: "rectangle".into(),
            count: 8,
            radius_scale: 0.1,
            ..cfg.clone()
        };
        let tiny_site = Site {
            radius: 80.0,
            ..site.clone()
        };
        let tiny = generate(
            "tiny-rectangle-regression",
            &tiny_site,
            &tiny_cfg,
            &m,
            surface,
            &[],
        )
        .unwrap();
        assert_eq!(tiny.quarters.len(), 8);
        for (i, q) in tiny.quarters.iter().enumerate() {
            for r in tiny.quarters.iter().skip(i + 1) {
                assert!(g::intersection(&q.shape, &r.shape).is_empty());
            }
        }
        let dense_cfg = LayoutConfig {
            count: 64,
            radius: 240.0,
            ..cfg
        };
        let dry_surface = Surface {
            water: &vec![0; 64 * 64],
            ..surface
        };
        let dense = generate(
            "dense-ring-regression",
            &site,
            &dense_cfg,
            &m,
            dry_surface,
            &[],
        )
        .unwrap();
        assert_eq!(dense.quarters.len(), 64);
        for (i, q) in dense.quarters.iter().enumerate() {
            let r = &dense.quarters[(i + 1) % dense.quarters.len()];
            assert!(g::intersection(&q.shape, &r.shape).is_empty());
        }
    }

    /// Mountain bay (TODO bug 2): a 250 m coastal shelf under a 0.35 slope cut
    /// by ravines, sea to the east, one coastal road. Roman tissue, no stairs.
    fn bay_city(cfg: &LayoutConfig) -> Layout {
        let (n, width) = (256, 4000.0);
        let c = width * 0.5;
        let mut heights = vec![0.0f32; n * n];
        let mut water = vec![0u8; n * n];
        for y in 0..n {
            for x in 0..n {
                let (px, py) = (
                    (x as f64 + 0.5) * width / n as f64,
                    (y as f64 + 0.5) * width / n as f64,
                );
                let climb = (c + 150.0 - px).max(0.0);
                let ravines = (py / 180.0).sin().abs() * climb * 0.12;
                heights[y * n + x] = (5.0 + climb * 0.35 + ravines) as f32;
                water[y * n + x] = u8::from(px > c + 330.0);
            }
        }
        let surface = Surface {
            geometry: None,
            width,
            n,
            height: &heights,
            water: &water,
        };
        let road = Street {
            path: (0..=40)
                .map(|i| Point {
                    x: c + 200.0,
                    y: 1.0 + (width - 2.0) * i as f64 / 40.0,
                })
                .collect(),
            widths: vec![7.0; 41],
            rank: 0,
            role: "regional".into(),
        };
        let site = Site {
            key: "bay".into(),
            name: "Bay".into(),
            population: 5000,
            culture: "roman-core".into(),
            center: Point { x: c + 150.0, y: c },
            radius: 300.0,
        };
        super::super::generate_quarters("bay", &[site], cfg, surface, &[road])
            .unwrap()
            .remove(0)
    }
    #[test]
    fn steep_bay_quarters_are_served_and_overrides_stay_local() {
        let cfg = LayoutConfig::default();
        let base = bay_city(&cfg);
        assert!(!base.quarters.is_empty());
        let lattice = |r: &[Point]| {
            r.iter()
                .zip(r.iter().cycle().skip(1))
                .all(|(a, b)| (a.x - b.x).abs() < 1e-6 || (a.y - b.y).abs() < 1e-6)
        };
        for (i, q) in base.quarters.iter().enumerate() {
            let bb = g::bbox(&q.shape);
            assert!(
                base.streets
                    .iter()
                    .any(|st| st.role != "stairs" && touches(&q.shape, bb, st)),
                "quarter {i} has no street"
            );
            assert!(
                !q.shape.holes.iter().any(|h| lattice(h)),
                "lattice hole in {i}"
            );
        }
        // No stairs in a culture that does not build them.
        assert!(base.streets.iter().all(|s| s.role != "stairs"));
        // Every ordinary block fronts a street (within its half-width).
        let unserved = base
            .blocks
            .iter()
            .filter(|b| b.kind == "block")
            .filter(|b| {
                !base.streets.iter().any(|st| {
                    st.path.windows(2).zip(&st.widths).any(|(w, width)| {
                        b.shape
                            .outer
                            .iter()
                            .any(|&p| g::distance(p, w[0], w[1]).0 <= width * 0.5 + 2.0)
                    })
                })
            })
            .count();
        if let Ok(path) = std::env::var("BAY_DUMP") {
            std::fs::write(path, serde_json::to_string(&base).unwrap()).unwrap();
        }
        assert_eq!(unserved, 0, "blocks without street frontage");
        // Editing one quarter changes its blocks only.
        let k = (0..base.quarters.len())
            .max_by(|&a, &b| {
                g::area(&base.quarters[a].shape).total_cmp(&g::area(&base.quarters[b].shape))
            })
            .unwrap();
        let mut edited_cfg = cfg.clone();
        edited_cfg.overrides.quarters.insert(
            k.to_string(),
            super::super::QuarterOverride {
                culture: Some("medina".into()),
                tissue: Some("organic".into()),
                density: Some(1.6),
                ..Default::default()
            },
        );
        let edited = bay_city(&edited_cfg);
        // Composition quarters keep their index and shape; only the peripheral
        // frontage strips appended last follow the edited streets.
        let same = base
            .quarters
            .iter()
            .zip(&edited.quarters)
            .take_while(|(a, b)| (g::area(&a.shape) - g::area(&b.shape)).abs() < 1e-6)
            .count();
        eprintln!(
            "bay: stable prefix {same} of {} / {} quarters, edited {k}",
            base.quarters.len(),
            edited.quarters.len()
        );
        assert!(same > k);
        let blocks = |l: &Layout, q: usize| {
            let mut v: Vec<i64> = l
                .blocks
                .iter()
                .filter(|b| b.quarter == q)
                .map(|b| g::area(&b.shape).round() as i64)
                .collect();
            v.sort();
            v
        };
        assert_ne!(blocks(&base, k), blocks(&edited, k));
        let culture = |l: &Layout, q: usize| {
            l.blocks
                .iter()
                .find(|b| b.quarter == q)
                .and_then(|b| b.phase)
                .and_then(|p| l.phases.get(p))
                .map(|p| p.culture.clone())
        };
        assert_eq!(culture(&edited, k).as_deref(), Some("medina"));
        // Street widths are re-ranked city-wide, so compare each other
        // quarter's block structure (count), not exact areas.
        let count = |l: &Layout, q: usize| l.blocks.iter().filter(|b| b.quarter == q).count();
        let changed = (0..same)
            .filter(|&q| q != k && count(&base, q) != count(&edited, q))
            .count();
        eprintln!(
            "bay: {} quarters, {} blocks, {} other quarters changed by the edit",
            base.quarters.len(),
            base.blocks.len(),
            changed
        );
        assert!(changed * 4 <= same, "edit leaked into {changed} quarters");
    }
    /// Invariant (adaptive capacity): a sparse culture on flat open ground
    /// houses its population by construction, and every threshold the plan
    /// crosses (densify, extend, borrow) is stated in the parcel warnings.
    #[test]
    fn a_sparse_culture_houses_its_population_and_states_its_thresholds() {
        let (layout, _) = flat_city("halfling", 20_000, "culture");
        let parts = super::super::generate_parcels(
            "probe-city",
            std::slice::from_ref(&layout),
            &super::super::ParcelConfig::default(),
        )
        .unwrap();
        let pr = parts[0].programme.as_ref().unwrap();
        let (wanted, housed) = pr
            .demands
            .iter()
            .filter(|d| d.function == "domestic")
            .fold((0.0, 0.0), |(w, h), d| {
                (w + d.requested, h + d.parcel_capacity.min(d.requested))
            });
        let plan = capacity::of(&layout).expect("automatic budget carries a plan");
        let warning = parts[0].warnings.iter().find(|w| w.starts_with("Capacité"));
        eprintln!(
            "halfling 20k: {housed:.0}/{wanted:.0} households, densify {:.2}, extension {:.2}, donor {:?} {:.2}, vacancy {:.2}; {warning:?}",
            plan.densify, plan.extension, plan.donor, plan.borrowed_share, plan.vacancy
        );
        assert!(
            housed >= 0.95 * wanted,
            "{housed:.0} of {wanted:.0} households housed"
        );
        if plan.densify > 0.0 || plan.extension > 1.001 || plan.borrowed_share > 0.0 {
            let warning = warning.expect("a crossed threshold is stated");
            if plan.borrowed_share > 0.0 {
                assert!(warning.contains("découpe empruntée"), "{warning}");
            }
        }
    }
}
