//! The street direction field: at every point, the direction (modulo a right
//! angle) a street of the tissue takes there, from the culture's base
//! orientation, noise, slope, banks and nearby armature roads.

use super::noise::Noise;
use super::params::{FieldOrientation, OrganicParams, OrganicSite};
use magna_urbis_geom::surface::TerrainView;
use magna_urbis_geom::{Point, distance};
use std::cell::RefCell;
use std::collections::HashMap;
use std::f64::consts::{FRAC_PI_2, PI, TAU};
use std::sync::OnceLock;

/// Smoothstep of `x` from `a` to `b`.
pub(super) fn smooth(x: f64, a: f64, b: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Signed angle from `b` to `a` in `[-PI, PI)`.
pub(super) fn delta(a: f64, b: f64) -> f64 {
    (a - b + PI).rem_euclid(TAU) - PI
}

/// Armature segments in a uniform grid of `cell` metres.
struct SegmentGrid {
    cell: f64,
    map: HashMap<(i64, i64), Vec<(u32, u32)>>,
}

impl SegmentGrid {
    fn new(roads: &[Vec<Point>], cell: f64) -> Self {
        let mut map: HashMap<(i64, i64), Vec<(u32, u32)>> = HashMap::new();
        for (i, road) in roads.iter().enumerate() {
            for (j, w) in road.windows(2).enumerate() {
                let (x0, x1) = (
                    (w[0].x.min(w[1].x) / cell).floor() as i64,
                    (w[0].x.max(w[1].x) / cell).floor() as i64,
                );
                let (y0, y1) = (
                    (w[0].y.min(w[1].y) / cell).floor() as i64,
                    (w[0].y.max(w[1].y) / cell).floor() as i64,
                );
                for y in y0..=y1 {
                    for x in x0..=x1 {
                        map.entry((x, y)).or_default().push((i as u32, j as u32));
                    }
                }
            }
        }
        Self { cell, map }
    }

    /// Segments of every cell meeting the square of half side `reach` around
    /// `p`, sorted by road then segment, without repeats.
    fn around(&self, p: Point, reach: f64) -> Vec<(u32, u32)> {
        let c = self.cell;
        let (x0, x1) = (
            ((p.x - reach) / c).floor() as i64,
            ((p.x + reach) / c).floor() as i64,
        );
        let (y0, y1) = (
            ((p.y - reach) / c).floor() as i64,
            ((p.y + reach) / c).floor() as i64,
        );
        let mut out = vec![];
        for y in y0..=y1 {
            for x in x0..=x1 {
                if let Some(v) = self.map.get(&(x, y)) {
                    out.extend_from_slice(v);
                }
            }
        }
        out.sort_unstable();
        out.dedup();
        out
    }
}

/// The armature as classic's regional roads and main streets: the road that
/// dominates within `reach` gives the base orientation, and the nearest one
/// within 150 m pulls the streets beside it into line.
struct RoadIndex<'a> {
    roads: &'a [Vec<Point>],
    reach: f64,
    axes: SegmentGrid,
    near: SegmentGrid,
    /// The dominant road's tangent is piecewise constant; it is memoised per
    /// small cell (`reach` / 50, 10 to 40 m) during tracing.
    memo: RefCell<HashMap<(i64, i64), Option<f64>>>,
}

/// Width classic assumes for a road whose widths are unknown.
const ROAD_WIDTH: f64 = 4.0;
/// Distance beyond which a road no longer pulls streets into line (its pull,
/// 0.85 exp(-d / 35), is below 1 % there).
const PULL_REACH: f64 = 150.0;

impl<'a> RoadIndex<'a> {
    fn new(roads: &'a [Vec<Point>], reach: f64) -> Self {
        let reach = reach.max(1.0);
        Self {
            roads,
            reach,
            axes: SegmentGrid::new(roads, reach),
            near: SegmentGrid::new(roads, 50.0),
            memo: RefCell::default(),
        }
    }

    fn axis(&self, p: Point) -> Option<f64> {
        let step = (self.reach / 50.0).clamp(10.0, 40.0);
        let key = ((p.x / step).floor() as i64, (p.y / step).floor() as i64);
        if let Some(&v) = self.memo.borrow().get(&key) {
            return v;
        }
        let centre = Point {
            x: (key.0 as f64 + 0.5) * step,
            y: (key.1 as f64 + 0.5) * step,
        };
        let v = self.dominant(centre);
        self.memo.borrow_mut().insert(key, v);
        v
    }

    /// Tangent, at its nearest segment, of the road that weighs most within
    /// `reach` of `p` (length times width, fading with distance); the first
    /// road wins a tie.
    fn dominant(&self, p: Point) -> Option<f64> {
        let reach = self.reach;
        // Best road so far: (road, score, angle); the road being summed:
        // (road, score, nearest distance, angle at its nearest segment).
        let mut best: Option<(usize, f64, f64)> = None;
        let mut current: Option<(usize, f64, f64, f64)> = None;
        let finish = |c: Option<(usize, f64, f64, f64)>, best: &mut Option<(usize, f64, f64)>| {
            if let Some((i, score, _, angle)) = c
                && best.is_none_or(|(b, s, _)| score > s || score == s && i < b)
            {
                *best = Some((i, score, angle));
            }
        };
        for (i, j) in self.axes.around(p, reach) {
            let (i, j) = (i as usize, j as usize);
            let pair = [self.roads[i][j], self.roads[i][j + 1]];
            let length = pair[0].distance(pair[1]);
            let (d, _, _) = distance(p, pair[0], pair[1]);
            if length <= 1e-6 || d > reach {
                continue;
            }
            if current.is_some_and(|c| c.0 != i) {
                finish(current.take(), &mut best);
            }
            let gain =
                length.min(reach * 2.0) * ROAD_WIDTH / (1.0 + d / (reach * 0.3).max(1.0)).powi(2);
            let angle = (pair[1].y - pair[0].y).atan2(pair[1].x - pair[0].x);
            let c = current.get_or_insert((i, 0.0, f64::INFINITY, angle));
            c.1 += gain;
            if d < c.2 {
                c.2 = d;
                c.3 = angle;
            }
        }
        finish(current.take(), &mut best);
        best.map(|b| b.2)
    }

    /// Distance and heading of the nearest road segment within `reach`.
    fn nearest(&self, p: Point, reach: f64) -> Option<(f64, f64)> {
        let mut best: (f64, Option<f64>) = (reach, None);
        for (i, j) in self.near.around(p, reach) {
            let (a, b) = (
                self.roads[i as usize][j as usize],
                self.roads[i as usize][j as usize + 1],
            );
            let d = distance(p, a, b).0;
            if d < best.0 || best.1.is_none() && d <= reach {
                best = (d, Some((b.y - a.y).atan2(b.x - a.x)));
            }
        }
        best.1.map(|angle| (best.0, angle))
    }
}

/// Heading of the road segment nearest `p`, at any distance.
fn nearest_road(roads: &[Vec<Point>], p: Point) -> Option<f64> {
    roads
        .iter()
        .flat_map(|road| road.windows(2))
        .map(|w| {
            (
                distance(p, w[0], w[1]).0,
                (w[1].y - w[0].y).atan2(w[1].x - w[0].x),
            )
        })
        .min_by(|a, b| a.0.total_cmp(&b.0))
        .map(|(_, angle)| angle)
}

/// The street field of one quarter.
pub(super) struct Field<'a> {
    pub(super) terrain: &'a dyn TerrainView,
    pub(super) params: &'a OrganicParams,
    pub(super) centre: Point,
    /// How fully the quarter answers its slope, 0 to 1 (`slope::steepness`): the field turns
    /// along the contours and the split prefers cuts along them.
    pub(super) steep: f64,
    roads: RoadIndex<'a>,
    /// Orientation of the road nearest the town centre (0 for a cardinal culture).
    angle: f64,
    /// Contour direction at the town centre.
    terrain_angle: f64,
    /// Shore direction seen from the town centre.
    water_angle: f64,
    noise: Noise,
    /// Water of the planning grid by cell, read lazily: the 15 to 70 m bank
    /// stencil only orients the field, a raster read suffices.
    water_cells: RefCell<HashMap<(usize, usize), bool>>,
}

impl<'a> Field<'a> {
    pub(super) fn new(
        terrain: &'a dyn TerrainView,
        armature: &'a [Vec<Point>],
        site: &OrganicSite,
        params: &'a OrganicParams,
        steep: f64,
    ) -> Self {
        let centre = site.centre;
        let roads = RoadIndex::new(armature, site.radius * 1.5);
        let road_angle = nearest_road(armature, centre)
            .unwrap_or_else(|| site.field.fork("road-angle").range(0.0, TAU));
        let angle = if params.orientation == FieldOrientation::Cardinal {
            0.0
        } else {
            road_angle
        };
        let r = 70.0;
        let gx = (terrain.height_at(Point {
            x: centre.x + r,
            y: centre.y,
        }) - terrain.height_at(Point {
            x: centre.x - r,
            y: centre.y,
        })) / (2.0 * r);
        let gy = (terrain.height_at(Point {
            x: centre.x,
            y: centre.y + r,
        }) - terrain.height_at(Point {
            x: centre.x,
            y: centre.y - r,
        })) / (2.0 * r);
        let terrain_angle = if gx.hypot(gy) > 1e-6 {
            gy.atan2(gx) + FRAC_PI_2
        } else {
            angle
        };
        let water_angle = (0..32)
            .filter_map(|i| {
                let a = i as f64 * TAU / 32.0;
                let p = Point {
                    x: centre.x + a.cos() * site.radius,
                    y: centre.y + a.sin() * site.radius,
                };
                terrain.wet(p).then_some(a + FRAC_PI_2)
            })
            .next()
            .unwrap_or(angle);
        Self {
            terrain,
            params,
            centre,
            steep,
            roads,
            angle,
            terrain_angle,
            water_angle,
            noise: Noise::new(site.field.fork("field")),
            water_cells: RefCell::default(),
        }
    }

    /// Whether the planning-grid cell holding `q` is water; false off the map.
    fn water_cell(&self, q: Point) -> bool {
        let width = self.terrain.width();
        let n = self.terrain.water_resolution().max(1);
        if !(q.x >= 0.0 && q.y >= 0.0 && q.x < width && q.y < width) {
            return false;
        }
        let key = (
            ((q.x / width * n as f64) as usize).min(n - 1),
            ((q.y / width * n as f64) as usize).min(n - 1),
        );
        if let Some(&wet) = self.water_cells.borrow().get(&key) {
            return wet;
        }
        let cell = width / n as f64;
        let wet = self.terrain.water_code(Point {
            x: (key.0 as f64 + 0.5) * cell,
            y: (key.1 as f64 + 0.5) * cell,
        }) != 0;
        self.water_cells.borrow_mut().insert(key, wet);
        wet
    }

    /// Turn `angle` toward the contour on slopes and along banks within 70 m,
    /// in proportion to the site adaptation.
    fn adapt_angle(&self, p: Point, angle: f64) -> f64 {
        let adaptation = self.params.site_adaptation;
        if adaptation == 0.0 {
            return angle;
        }
        let n = self.terrain.water_resolution().max(1);
        let (gx, gy) = self
            .terrain
            .slope_at(p, (self.terrain.width() / n as f64).clamp(10.0, 35.0));
        let slope = gx.hypot(gy);
        let w = (adaptation * 0.85 * smooth(slope, 0.015, 0.10)).min(0.92);
        let contour = gy.atan2(gx) + FRAC_PI_2;
        let mut cx = (1.0 - w) * (4.0 * angle).cos() + w * (4.0 * contour).cos();
        let mut cy = (1.0 - w) * (4.0 * angle).sin() + w * (4.0 * contour).sin();
        let (mut wx, mut wy, mut weight) = (0.0, 0.0, 0.0);
        // Three rings of 16 probes at 15, 35 and 70 m, weighted exp(-r / 35).
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
            if self.water_cell(Point {
                x: p.x + offset.x,
                y: p.y + offset.y,
            }) {
                wx += contribution.x;
                wy += contribution.y;
                weight += v;
            }
        }
        if weight > 0.0 && wx.hypot(wy) > 0.1 {
            let tangent = wy.atan2(wx) + FRAC_PI_2;
            let w = (adaptation * wx.hypot(wy) / (weight + 1.0)).min(0.90);
            cx = (1.0 - w) * cx + w * (4.0 * tangent).cos();
            cy = (1.0 - w) * cy + w * (4.0 * tangent).sin();
        }
        cy.atan2(cx) / 4.0
    }

    /// Orientation noise and base orientation at `p`.
    fn base(&self, p: Point) -> (f64, f64) {
        let params = self.params;
        let wl = params.field_wavelength.max(1.0);
        let nz = params.field_noise.to_radians() * self.noise.fbm(p.x / wl, p.y / wl, 2);
        let cultural = match params.orientation {
            FieldOrientation::Cardinal => 0.0,
            FieldOrientation::Terrain => self.terrain_angle,
            FieldOrientation::Water => self.water_angle,
            FieldOrientation::Road => self.angle,
        };
        let base = if params.align_to_roads {
            self.roads.axis(p).unwrap_or(cultural)
        } else {
            cultural
        };
        (nz, base)
    }

    /// Street direction at `p`, modulo a right angle.
    pub(super) fn angle(&self, p: Point) -> f64 {
        let params = self.params;
        let (nz, base) = self.base(p);
        let (gx, gy) = self.terrain.slope_at(p, 70.0);
        let slope = gx.hypot(gy);
        let contour = gy.atan2(gx) + FRAC_PI_2;
        let cf = params.contour_follow;
        let th = if params.radial {
            (p.y - self.centre.y).atan2(p.x - self.centre.x)
        } else {
            base
        } + params.field_twist;
        let mut cx = (4.0 * th).cos();
        let mut cy = (4.0 * th).sin();
        // A steep quarter takes the contour as a floor on every contour weight, wherever the
        // local slope gives the contour a direction.
        let steep = self.steep * params.slope.contour_weight * smooth(slope, 0.01, 0.04);
        // Terraces: the contour on any real slope, the town's contour elsewhere.
        if cf > 0.0 {
            let w = (cf * smooth(slope, 0.02, 0.06)).max(steep);
            cx = (1.0 - w) * (4.0 * self.terrain_angle).cos() + w * (4.0 * contour).cos();
            cy = (1.0 - w) * (4.0 * self.terrain_angle).sin() + w * (4.0 * contour).sin();
            return self.adapt_angle(p, cy.atan2(cx) / 4.0);
        }
        let wr = params.field_random;
        let psi = PI * self.noise.fbm(p.x / 260.0 + 31.7, p.y / 260.0 - 12.3, 2);
        cx = (1.0 - wr) * cx + wr * (4.0 * psi).cos();
        cy = (1.0 - wr) * cy + wr * (4.0 * psi).sin();
        if let Some((d, a)) = self.roads.nearest(p, PULL_REACH) {
            let w = 0.85 * (-d / 35.0).exp();
            cx = (1.0 - w) * cx + w * (4.0 * a).cos();
            cy = (1.0 - w) * cy + w * (4.0 * a).sin();
        }
        let cb = params.contour_blend;
        let w = (0.75 * smooth(slope, 0.06, 0.14))
            .max(cb * smooth(slope, 0.025, 0.08))
            .max(steep);
        cx = (1.0 - w) * cx + w * (4.0 * contour).cos();
        cy = (1.0 - w) * cy + w * (4.0 * contour).sin();
        // The noise is halved at the very centre and full beyond 120 m.
        self.adapt_angle(p, cy.atan2(cx) / 4.0)
            + nz * (0.5 + 0.5 * smooth(p.distance(self.centre), 20.0, 120.0))
    }
}
