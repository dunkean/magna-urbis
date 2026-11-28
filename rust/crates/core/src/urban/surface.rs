//! The terrain a town is laid on: heights (bilinear or B-spline), the
//! planning water grid and the vector geography, as `Surface`.
use super::{Geography, Point, Shape, geometry};
// The fractal shore detail of the drawn coast (terrain crate, mirrored by web/src/render/shoreDetail.ts).
use crate::shore_detail;

#[derive(Clone, Copy, Default)]
pub enum HeightInterpolation {
    #[default]
    Bilinear,
    /// Explicit physical source using bilinear samples; coastal wet checks apply even at planning n.
    PhysicalBilinear,
    /// `shore`: the field has a sea (and no cave), so its height carries the fractal shore detail of the drawn coast.
    BSpline { floor: f32, shore: bool },
}

#[derive(Clone, Copy)]
pub struct Surface<'a> {
    pub geometry: Option<&'a Geography>,
    pub width: f64,
    pub n: usize,
    /// Cell-centred metres. This may be finer than `n`/`water`; wet routing stays on the planning grid.
    pub height: &'a [f32],
    pub water: &'a [u8],
    pub interpolation: HeightInterpolation,
}
impl Surface<'_> {
    /// Side of the height grid: the integer square root of its length. Read on
    /// every height sample, so it goes through the hardware square root (exact
    /// for these sizes) and is then corrected to the integer root.
    #[inline]
    pub fn height_resolution(&self) -> usize {
        let len = self.height.len();
        if len == self.n * self.n {
            return self.n;
        }
        let mut side = (len as f64).sqrt() as usize;
        while side * side > len {
            side -= 1;
        }
        while (side + 1) * (side + 1) <= len {
            side += 1;
        }
        side
    }
    pub fn height_at(&self, p: Point) -> f64 {
        let height = self.raw_height_at(p);
        match self.interpolation {
            HeightInterpolation::Bilinear | HeightInterpolation::PhysicalBilinear => height,
            HeightInterpolation::BSpline { floor, .. } => height.max(floor as f64),
        }
    }
    /// The ground as drawn: the B-spline with, on a coastal field, the fractal shore detail near its zero line, so the
    /// town's ground meets the traced sea polygon (`wet`) and the 2D and 3D coast.
    pub fn raw_height_at(&self, p: Point) -> f64 {
        let n = self.height_resolution();
        let x = p.x / self.width * n as f64 - 0.5;
        let y = p.y / self.width * n as f64 - 0.5;
        if let HeightInterpolation::BSpline { shore, .. } = self.interpolation {
            let x = x.clamp(-0.5, n as f64 - 0.5);
            let y = y.clamp(-0.5, n as f64 - 0.5);
            let (ix, iy) = (x.floor() as isize, y.floor() as isize);
            let weights = |t: f64| [
                (1.0 - t).powi(3) / 6.0,
                (3.0 * t.powi(3) - 6.0 * t * t + 4.0) / 6.0,
                (-3.0 * t.powi(3) + 3.0 * t * t + 3.0 * t + 1.0) / 6.0,
                t.powi(3) / 6.0,
            ];
            let wx = weights(x - ix as f64);
            let wy = weights(y - iy as f64);
            // The height and its two derivatives use the same stencil.
            // Keep the row-major sums and the order of their multiplications.
            let clamped = |origin: isize, offset: isize| (origin + offset - 1).clamp(0, n as isize - 1) as usize;
            let cols = std::array::from_fn::<_, 4, _>(|i| clamped(ix, i as isize));
            let controls = std::array::from_fn::<_, 4, _>(|j| {
                let row = clamped(iy, j as isize) * n;
                cols.map(|col| f64::from(self.height[row + col]))
            });
            let mut value = 0.0;
            for (j, weight_y) in wy.into_iter().enumerate() {
                for (i, weight_x) in wx.into_iter().enumerate() {
                    value += controls[j][i] * weight_x * weight_y;
                }
            }
            if !shore {
                return value;
            }
            // The gradient from the same sixteen controls; the offset is zero beyond 1.5 cells of the zero line.
            let slopes = |t: f64| [-0.5 * (1.0 - t).powi(2), 1.5 * t * t - 2.0 * t, -1.5 * t * t + t + 0.5, 0.5 * t * t];
            let (dx, dy) = (slopes(x - ix as f64), slopes(y - iy as f64));
            let (mut sx, mut sy) = (0.0, 0.0);
            for j in 0..4 {
                for i in 0..4 {
                    let h = controls[j][i];
                    sx += h * dx[i] * wy[j];
                    sy += h * wx[i] * dy[j];
                }
            }
            let cell = self.width / n as f64;
            return value + shore_detail::offset(p.x, p.y, value, sx.hypot(sy) / cell, cell);
        }
        let x = x.clamp(0.0, (n - 1) as f64);
        let y = y.clamp(0.0, (n - 1) as f64);
        let (ix, iy) = (x.floor() as usize, y.floor() as usize);
        let h = |dx: usize, dy: usize| {
            self.height[(iy + dy).min(n - 1) * n + (ix + dx).min(n - 1)] as f64
        };
        let (tx, ty) = (x.fract(), y.fract());
        (h(0, 0) * (1.0 - tx) + h(1, 0) * tx) * (1.0 - ty)
            + (h(0, 1) * (1.0 - tx) + h(1, 1) * tx) * ty
    }
    /// Underdark cave rock (vector geography only): `wet` for building, but never a shore, a
    /// navigable channel or a bridge span.
    pub fn solid(&self, p: Point) -> bool {
        self.geometry.is_some_and(|geometry| geometry.solid(p))
    }
    pub fn wet(&self, p: Point) -> bool {
        if p.x < 0.0 || p.y < 0.0 || p.x >= self.width || p.y >= self.width {
            return true;
        }
        // The vector water is the drawn shoreline itself, finer than the height cells.
        if let Some(geometry) = self.geometry { return geometry.wet(p); }
        let x = (p.x / self.width * self.n as f64) as usize;
        let y = (p.y / self.width * self.n as f64) as usize;
        let x = x.min(self.n - 1);
        let y = y.min(self.n - 1);
        if matches!(self.interpolation, HeightInterpolation::Bilinear)
            && self.height.len() == self.n * self.n {
            return self.water[y * self.n + x] != 0;
        }
        // A coastline can cross a dry planning cell on a large map. Only use
        // negative physical elevation where a neighbouring cell is already sea;
        // an isolated inland depression remains dry.
        let sea_nearby = (y.saturating_sub(1)..=(y + 1).min(self.n - 1)).any(|j|
            (x.saturating_sub(1)..=(x + 1).min(self.n - 1)).any(|i| self.water[j * self.n + i] == 1));
        if sea_nearby && self.raw_height_at(p) <= 0.0 { return true; }
        self.water[y * self.n + x] != 0
    }

    pub(super) fn classify_water(&self, p: Point) -> u8 {
        // Cave rock shares the lake code on the planning grid.
        if p.x < 0.0 || p.y < 0.0 || p.x >= self.width || p.y >= self.width || self.solid(p) {
            return 0;
        }
        let x = (p.x / self.width * self.n as f64) as usize;
        let y = (p.y / self.width * self.n as f64) as usize;
        let code = self.water[y.min(self.n - 1) * self.n + x.min(self.n - 1)];
        if code != 0 || !self.wet(p) {
            return code;
        }
        // Wet shoreline margins can lie inside dry planning cells. Use the
        // nearest water class, falling back to sea if the grid has none nearby.
        let mut nearest = (f64::INFINITY, 1);
        let cell = self.width / self.n as f64;
        for j in y.saturating_sub(2)..=(y + 2).min(self.n - 1) {
            for i in x.saturating_sub(2)..=(x + 2).min(self.n - 1) {
                let kind = self.water[j * self.n + i];
                let distance = p.distance(Point {
                    x: (i as f64 + 0.5) * cell,
                    y: (j as f64 + 0.5) * cell,
                });
                if kind != 0 && distance < nearest.0 {
                    nearest = (distance, kind);
                }
            }
        }
        nearest.1
    }
}

impl magna_urbis_geom::surface::TerrainView for Surface<'_> {
    fn width(&self) -> f64 {
        self.width
    }

    fn height_resolution(&self) -> usize {
        Surface::height_resolution(self)
    }

    fn water_resolution(&self) -> usize {
        self.n
    }

    fn height_at(&self, p: Point) -> f64 {
        Surface::height_at(self, p)
    }

    fn wet(&self, p: Point) -> bool {
        Surface::wet(self, p)
    }

    fn water_code(&self, p: Point) -> u8 {
        self.classify_water(p)
    }

    fn dry_clip(&self, shape: &Shape) -> Vec<Shape> {
        geometry::dry_clip(self, shape)
    }
}

#[cfg(test)]
mod physical_surface_tests {
    use super::*;
    use crate::urban::routing;

    #[test]
    fn local_heights_and_grades_use_physical_cells_with_capped_water() {
        let height: Vec<f32> = (0..64 * 64).map(|i| (i % 64) as f32 + 0.5 + 2.0 * ((i / 64) as f32 + 0.5)).collect();
        let mut water = vec![0; 16 * 16];
        water[7 * 16 + 5] = 1;
        let surface = Surface { geometry: None, width: 64.0, n: 16, height: &height, water: &water, interpolation: Default::default(),};
        assert_eq!(surface.height_resolution(), 64);
        assert!((surface.height_at(Point { x: 20.5, y: 30.5 }) - 81.5).abs() < 1e-6);
        assert!(surface.wet(Point { x: 20.5, y: 30.5 }));
        assert!((routing::segment_grade(surface, Point { x: 10.5, y: 10.5 }, Point { x: 30.5, y: 10.5 }) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn physical_sea_inside_a_dry_large_map_cell_is_wet_but_inland_depression_is_dry() {
        let width = 200_000.0;
        let mut water = vec![0; 16 * 16];
        for y in 0..16 { for x in 0..7 { water[y * 16 + x] = 1; } }
        let mut height = vec![20.0; 64 * 64];
        for y in 0..64 { for x in 0..29 { height[y * 64 + x] = -5.0; } }
        for y in 30..34 { for x in 36..40 { height[y * 64 + x] = -5.0; } }
        let surface = Surface { geometry: None, width, n: 16, height: &height, water: &water,
            interpolation: HeightInterpolation::BSpline { floor: 0.3, shore: false } };
        assert!(surface.wet(Point { x: 89_000.0, y: 100_000.0 }));
        assert!(!surface.wet(Point { x: 118_750.0, y: 100_000.0 }));
    }

    #[test]
    fn planning_deck_remains_dry_but_same_resolution_physical_coast_is_wet() {
        let mut water = vec![0; 16 * 16];
        for row in 0..16 { for x in 0..7 { water[row * 16 + x] = 1; } }
        let mut height = vec![10.0; 16 * 16];
        height[8 * 16 + 7] = -3.0;
        let point = Point { x: 7.5 * 12_500.0, y: 8.5 * 12_500.0 };
        let planning = Surface { geometry: None, width: 200_000.0, n: 16, height: &height, water: &water,
            interpolation: HeightInterpolation::Bilinear };
        assert!(!planning.wet(point));
        let physical = Surface { interpolation: HeightInterpolation::PhysicalBilinear, ..planning };
        assert!(physical.wet(point));
    }

    #[test]
    fn spline_matches_cell_centred_planar_metres_at_n1334() {
        let n = 1334;
        let width = 40_020.0;
        let height: Vec<f32> = (0..n * n).map(|i| 3.0 + (i % n) as f32 * 0.07 + (i / n) as f32 * 0.11).collect();
        let water = vec![0; 16 * 16];
        let surface = Surface { geometry: None, width, n: 16, height: &height, water: &water,
            interpolation: HeightInterpolation::BSpline { floor: 0.3, shore: false } };
        for k in 0..100 {
            let gx = 3.5 + ((k * 811) % (n - 8)) as f64 + (k % 7) as f64 / 7.0;
            let gy = 3.5 + ((k * 613) % (n - 8)) as f64 + (k % 11) as f64 / 11.0;
            let p = Point { x: (gx + 0.5) * width / n as f64, y: (gy + 0.5) * width / n as f64 };
            let expected = 3.0 + gx * 0.07 + gy * 0.11;
            assert!((surface.height_at(p) - expected).abs() < 1e-3, "{k}: {} vs {expected}", surface.height_at(p));
        }
        let below = vec![-5.0; 16 * 16];
        let floor = Surface { geometry: None, width: 160.0, n: 16, height: &below, water: &water,
            interpolation: HeightInterpolation::BSpline { floor: 0.3, shore: false } };
        assert_eq!(floor.height_at(Point { x: 80.0, y: 80.0 }), 0.3_f32 as f64);
        assert!(floor.raw_height_at(Point { x: 80.0, y: 80.0 }) < 0.0);
    }

    /// The town's coastal ground is the drawn one: the values of `shoreOffset` (web/src/render/shoreDetail.ts) on a
    /// plane of slope 0.1 crossing sea level, and the plain spline a few cells inland or without a sea.
    #[test]
    fn coastal_spline_carries_the_shore_detail_of_the_drawn_coast() {
        let (n, width) = (64, 1920.0);
        let height: Vec<f32> = (0..n * n).map(|i| (0.1 * (((i % n) as f64 + 0.5) * 30.0 - 960.0)) as f32).collect();
        let water = vec![0; 16 * 16];
        let coast = Surface { geometry: None, width, n: 16, height: &height, water: &water,
            interpolation: HeightInterpolation::BSpline { floor: 0.0, shore: true } };
        for (x, y, drawn) in [(955.0, 700.0, -0.6588865110248115), (962.5, 1010.0, 0.1465371810229688), (940.0, 333.3, -1.9631985271900376), (1200.0, 900.0, 24.0)] {
            let at = coast.raw_height_at(Point { x, y });
            assert!((at - drawn).abs() < 1e-4, "({x}, {y}): {at} vs {drawn}");
        }
        let plain = Surface { interpolation: HeightInterpolation::BSpline { floor: 0.0, shore: false }, ..coast };
        assert!((plain.raw_height_at(Point { x: 955.0, y: 700.0 }) + 0.5).abs() < 1e-4);
    }

    #[test]
    fn curved_spline_matches_terrain_engine_at_edges_and_interior() {
        let n = 1334;
        let width = 40_020.0;
        let controls: Vec<f32> = (0..n * n).map(|i| {
            let x = (i % n) as f64;
            let y = (i / n) as f64;
            (20.0 + 7.0 * (x * 0.017).sin() + 5.0 * (y * 0.013).cos()
                + 3.0 * ((x + y) * 0.011).sin()) as f32
        }).collect();
        let generator = crate::TerrainGenerator::with_surface("spline-parity", width, &controls).unwrap();
        let water = vec![0; 16 * 16];
        let surface = Surface { geometry: None, width, n: 16, height: &controls, water: &water,
            interpolation: HeightInterpolation::BSpline { floor: 0.0, shore: false } };
        for (ox, oy) in [(0.0, 0.0), (20_000.0, 18_000.0), (width - 64.0, width - 64.0)] {
            let sampled = generator.sample_region(ox, oy, 64.0, 64).unwrap();
            for row in [0, 5, 17, 31, 63] { for col in [0, 7, 23, 44, 63] {
                let point = Point { x: ox + col as f64 + 0.5, y: oy + row as f64 + 0.5 };
                let expected = sampled.height[row * 64 + col] as f64;
                assert!((surface.raw_height_at(point) - expected).abs() < 1e-3,
                    "sample ({}, {}) differs at ({}, {})", ox, oy, row, col);
            }}
        }
    }
}
