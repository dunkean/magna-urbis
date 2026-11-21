//! Local street guidance and indexed streamline tracing within a piece.

use super::speculative::{Layer, Read};
use super::street_index::{Bins, RegionalIndex};
use super::tissue::smooth;
use crate::noise::Noise;
use crate::urban::{GrowthPhase, Morph, Point, Shape, Street, Surface, geometry as g, routing, zone_blend};
use magna_urbis_geom::surface::TerrainView;
use std::f64::consts::{FRAC_PI_2, PI, TAU};
use std::sync::OnceLock;

fn delta(a: f64, b: f64) -> f64 {
    (a - b + PI).rem_euclid(TAU) - PI
}

#[derive(Debug, PartialEq, Eq)]
enum FieldOrientation {
    Cardinal,
    Terrain,
    Water,
    Road,
}

struct FieldParams {
    orientation: FieldOrientation,
    grid: bool,
    wavelength: f64,
    noise: f64,
    grid_skew: f64,
    contour_follow: f64,
    twist: f64,
    random: f64,
    contour_blend: f64,
    curvature: f64,
}

impl FieldParams {
    fn new(m: &Morph) -> Self {
        Self {
            orientation: match m.text("orientation") {
                "cardinal" => FieldOrientation::Cardinal,
                "terrain" => FieldOrientation::Terrain,
                "water" => FieldOrientation::Water,
                _ => FieldOrientation::Road,
            },
            grid: m.text("streetOp") == "grid",
            wavelength: m.number("fieldWavelength"),
            noise: m.number("fieldNoise"),
            grid_skew: m.number("gridSkew"),
            contour_follow: m.number_or("contourFollow", 0.0),
            twist: m.number("fieldTwist"),
            random: m.number("fieldRandom"),
            contour_blend: m.number_or("contourBlend", 0.0),
            curvature: m.number("curvature"),
        }
    }
}

pub(super) struct TraceParams {
    default: FieldParams,
    phases: Vec<FieldParams>,
}

impl TraceParams {
    pub(super) fn new(field: &Field<'_>) -> Self {
        Self {
            default: FieldParams::new(field.p),
            phases: field.phase_morphs.iter().map(FieldParams::new).collect(),
        }
    }
}

pub(super) struct Field<'a> {
    pub(super) regional: &'a RegionalIndex<'a>,
    pub(super) align_regional: bool,
    pub(super) adaptation: f64,
    pub(super) p: &'a Morph,
    pub(super) center: Point,
    pub(super) angle: f64,
    pub(super) terrain: f64,
    pub(super) water: f64,
    pub(super) surface: Surface<'a>,
    pub(super) noise: Noise,
    pub(super) radius: f64,
    pub(super) population: u32,
    pub(super) radial: bool,
    pub(super) phases: &'a [GrowthPhase],
    pub(super) phase_morphs: &'a [Morph],
    pub(super) phase_index: &'a [(usize, g::ContainmentIndex)],
    /// The network before this pass (shared by every quarter cut in
    /// parallel) and its bins, for junction and crossing tests.
    pub(super) base: &'a [Street],
    pub(super) base_bins: &'a Bins,
    /// Streets of the earlier quarters of this pass shown to this cut (empty
    /// in the first, speculative parallel cut; see `Read`).
    pub(super) others: &'a [Layer<'a>],
    /// Streets this cut added itself, indexed incrementally.
    pub(super) bins: &'a std::sync::Mutex<Bins>,
    /// Log of the network reads of a speculative cut (see `Read`).
    pub(super) reads: Option<&'a std::sync::Mutex<Vec<Read>>>,
    /// Rank <= 1 streets of `base`, which steer the local street field (no
    /// pass adds a street of rank <= 1).
    pub(super) major: &'a Bins,
    /// Planned grid frame: the orientation of the grid at the quarter's centre,
    /// shared by every grid piece around that centre on gentle ground, so a
    /// castrum, a ward city or a bastide keeps continuous streets and 4-way
    /// crossings across its quarters instead of re-aiming each block.
    pub(super) frame: Option<f64>,
    /// `zoneDensity: gradient`: block sizes lean toward a neighbouring phase.
    pub(super) blend: Option<&'a zone_blend::Field>,
}

impl Field<'_> {
    /// Distance to the nearest street of rank <= `max_rank` within `reach`,
    /// over the shared network and the streets `local` of this pass.
    pub(super) fn street_distance(
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
    pub(super) fn crosses_street(&self, path: &[Point], local: &[Street]) -> bool {
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
    pub(super) fn phase_at(&self, p: Point) -> Option<usize> {
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
    pub(super) fn morph_at(&self, p: Point) -> &Morph {
        self.phase_at(p)
            .and_then(|i| self.phase_morphs.get(i))
            .unwrap_or(self.p)
    }
    fn adapt_angle(&self, p: Point, angle: f64) -> f64 {
        if self.adaptation == 0.0 {
            return angle;
        }
        let (gx, gy) = self.surface.slope_at(
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
    fn base(&self, p: Point, params: &FieldParams) -> (f64, f64) {
        let wl = params.wavelength.max(1.0);
        let nz = params.noise.to_radians() * self.noise.fbm(p.x / wl, p.y / wl, 2);
        let cultural_base = match params.orientation {
            FieldOrientation::Cardinal => 0.0,
            FieldOrientation::Terrain => self.terrain,
            FieldOrientation::Water => self.water,
            FieldOrientation::Road => self.angle,
        };
        // A planned cardinal grid (Chinese, Hindu temple town) is laid out to
        // the compass like its walls and gates: regional roads join its gates,
        // they do not turn its lattice.
        let compass = params.orientation == FieldOrientation::Cardinal && params.grid;
        let base = if self.align_regional && !compass {
            self.regional.axis(p).unwrap_or(cultural_base)
        } else {
            cultural_base
        };
        (nz, base)
    }
    fn grid_angle(&self, p: Point, params: &FieldParams) -> f64 {
        let (nz, base) = self.base(p, params);
        self.adapt_angle(
            p,
            base + nz
                + params.grid_skew * self.noise.fbm(p.x / 600.0 + 9.0, p.y / 600.0 - 3.0, 2),
        )
    }
    /// Grid orientation at a quarter centre, whatever the tissue found there.
    pub(super) fn grid_frame(&self, p: Point) -> f64 {
        self.grid_angle(p, &FieldParams::new(self.morph_at(p)))
    }
    pub(super) fn angle(&self, p: Point, trace: &TraceParams) -> f64 {
        let params = self
            .phase_at(p)
            .and_then(|i| trace.phases.get(i))
            .unwrap_or(&trace.default);
        let (nz, base) = self.base(p, params);
        let (gx, gy) = self.surface.slope_at(p, 70.0);
        let slope = gx.hypot(gy);
        if params.grid {
            if let Some(frame) = self.frame.filter(|_| slope < 0.08) {
                return frame;
            }
            return self.grid_angle(p, params);
        }
        let contour = gy.atan2(gx) + FRAC_PI_2;
        let cf = params.contour_follow;
        let th = if self.radial {
            (p.y - self.center.y).atan2(p.x - self.center.x)
        } else {
            base
        } + params.twist;
        let mut cx = (4.0 * th).cos();
        let mut cy = (4.0 * th).sin();
        if cf > 0.0 {
            let w = cf * smooth(slope, 0.02, 0.06);
            cx = (1.0 - w) * (4.0 * self.terrain).cos() + w * (4.0 * contour).cos();
            cy = (1.0 - w) * (4.0 * self.terrain).sin() + w * (4.0 * contour).sin();
            return self.adapt_angle(p, cy.atan2(cx) / 4.0);
        }
        let wr = params.random;
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
        let cb = params.contour_blend;
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
    pub(super) fn trace(
        &self,
        s: &Shape,
        index: &TraceIndex,
        params: &TraceParams,
        seed: Point,
        heading: f64,
        max_grade: f64,
    ) -> Option<Vec<Point>> {
        let mut out = vec![seed];
        let mut cur = seed;
        let mut head = heading;
        let turn = (params.default.curvature + self.adaptation * 1.5) * 5.0 * PI / 180.0;
        let mut own = PathGrid::new();
        let mut scratch = vec![];
        for _ in 0..800 {
            let a = self.angle(cur, params);
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
                    let hit = index.first_hit(cur, next, &mut scratch);
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
            if !index.contains(s, nx) {
                return None;
            }
            if out.len() > 8 && own.hits(&out, out.len() - 7, cur, nx) {
                return None;
            }
            own.insert(out.len() - 1, cur, nx);
            out.push(nx);
            cur = nx;
        }
        None
    }
}

/// Outer-ring edges of a piece in a uniform grid, shared by its cut candidates:
/// the first-hit and containment tests of a trace step only visit nearby edges.
pub(super) struct TraceIndex {
    edges: Vec<(Point, Point)>,
    x0: f64,
    y0: f64,
    cell: f64,
    nx: usize,
    ny: usize,
    cells: Vec<Vec<u32>>,
    inside: Option<g::ContainmentIndex>,
}
impl TraceIndex {
    const PAD: f64 = 1e-3;
    pub(super) fn new(s: &Shape) -> Self {
        let edges: Vec<(Point, Point)> = s
            .outer
            .iter()
            .zip(s.outer.iter().cycle().skip(1))
            .take(s.outer.len())
            .map(|(&a, &b)| (a, b))
            .collect();
        let (x0, y0, x1, y1) = g::bbox(s);
        let (x0, y0) = (x0 - Self::PAD, y0 - Self::PAD);
        let (w, h) = (x1 + Self::PAD - x0, y1 + Self::PAD - y0);
        let cell = 10.0_f64.max(w.max(h) / 64.0);
        let nx = ((w / cell).floor() as usize + 1).min(65);
        let ny = ((h / cell).floor() as usize + 1).min(65);
        let mut me = Self {
            edges,
            x0,
            y0,
            cell,
            nx,
            ny,
            cells: vec![vec![]; nx * ny],
            inside: s.holes.is_empty().then(|| g::ContainmentIndex::new(s)),
        };
        for i in 0..me.edges.len() {
            let (a, b) = me.edges[i];
            let (cx0, cx1, cy0, cy1) = me.range(a, b);
            for cy in cy0..=cy1 {
                for cx in cx0..=cx1 {
                    me.cells[cy * nx + cx].push(i as u32);
                }
            }
        }
        me
    }
    fn range(&self, a: Point, b: Point) -> (usize, usize, usize, usize) {
        let c = |v: f64, o: f64, n: usize| {
            (((v - o) / self.cell).floor().max(0.0) as usize).min(n - 1)
        };
        (
            c(a.x.min(b.x) - Self::PAD, self.x0, self.nx),
            c(a.x.max(b.x) + Self::PAD, self.x0, self.nx),
            c(a.y.min(b.y) - Self::PAD, self.y0, self.ny),
            c(a.y.max(b.y) + Self::PAD, self.y0, self.ny),
        )
    }
    /// First (smallest `t`, earliest edge on ties) hit of the segment on the ring.
    fn first_hit(&self, cur: Point, next: Point, scratch: &mut Vec<u32>) -> Option<(f64, Point)> {
        scratch.clear();
        let (cx0, cx1, cy0, cy1) = self.range(cur, next);
        for cy in cy0..=cy1 {
            for cx in cx0..=cx1 {
                scratch.extend_from_slice(&self.cells[cy * self.nx + cx]);
            }
        }
        scratch.sort_unstable();
        scratch.dedup();
        scratch
            .iter()
            .filter_map(|&i| {
                let (a, b) = self.edges[i as usize];
                g::segment_hit(cur, next, a, b)
            })
            .min_by(|a, b| a.0.total_cmp(&b.0))
    }
    fn contains(&self, s: &Shape, p: Point) -> bool {
        match &self.inside {
            Some(index) => index.contains(p),
            None => g::contains(s, p),
        }
    }
}

/// Segments of the path being traced, for the incremental self-intersection test.
struct PathGrid(std::collections::HashMap<(i32, i32), Vec<u32>>);
impl PathGrid {
    const CELL: f64 = 8.0;
    const PAD: f64 = 1e-3;
    fn new() -> Self {
        Self(Default::default())
    }
    fn cells(a: Point, b: Point) -> impl Iterator<Item = (i32, i32)> {
        let c = |v: f64| (v / Self::CELL).floor() as i32;
        let (x0, x1) = (c(a.x.min(b.x) - Self::PAD), c(a.x.max(b.x) + Self::PAD));
        let (y0, y1) = (c(a.y.min(b.y) - Self::PAD), c(a.y.max(b.y) + Self::PAD));
        (y0..=y1).flat_map(move |y| (x0..=x1).map(move |x| (x, y)))
    }
    fn insert(&mut self, i: usize, a: Point, b: Point) {
        for k in Self::cells(a, b) {
            self.0.entry(k).or_default().push(i as u32);
        }
    }
    /// Whether the segment hits any traced segment of index < `below`.
    fn hits(&self, out: &[Point], below: usize, a: Point, b: Point) -> bool {
        Self::cells(a, b).any(|k| {
            self.0.get(&k).is_some_and(|v| {
                v.iter().any(|&i| {
                    let i = i as usize;
                    i < below && g::segment_hit(a, b, out[i], out[i + 1]).is_some()
                })
            })
        })
    }
}

#[cfg(test)]
#[path = "field_tests.rs"]
mod field_tests;
