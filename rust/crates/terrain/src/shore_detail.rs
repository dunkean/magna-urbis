//! Fractal shoreline below the cells of the physical field: the one Rust definition of it, read by the town's ground
//! (core `urban::surface`, `Surface::raw_height_at`) and by the river mouths (`hydrology`, sea-mouth clip).
//!
//! It mirrors `shoreOffset` of web/src/render/shoreDetail.ts, which the 2D ground shader, the traced sea polygon, the 3D
//! mesh and the sea distance read: the two must stay in step (same octaves, rotations, seeds and noise). The values are
//! pinned on both sides by the same test points (`tests` below, web/tests/v2/shoreline.test.ts).
//!
//! The coast plan cuts the shore down to the cells of the field; the spline of those cells draws smooth round coves.
//! Near the zero line the height gets an offset worth a displacement of that line: a few octaves from four cells down to
//! half a cell, deep on steep or resistant stretches, almost nothing on gentle sandy ones. It is a function of the
//! position and of the spline's value and slope alone, and zero a cell and a half away from the shore.

/// Distance from the spline's zero line (value over gradient, in cells) at which the offset has vanished.
pub const REACH: f64 = 1.5;
/// Octaves: wavelength and displacement, in cells.
const OCTAVES: [(f64, f64); 4] = [(4.0, 0.34), (2.0, 0.2), (1.0, 0.12), (0.5, 0.07)];
/// The first four `FRACTAL_ROTATIONS` (rust/bridge/terrainAdjust.ts).
const ROTATIONS: [f64; 4] = [0.3, 1.1, 2.2, 0.7];
/// Length of the alternating resistant and sandy stretches, in cells.
const STRETCH: f64 = 40.0;
const STRETCH_SEED: u32 = 104_729;
const OCTAVE_SEED: u32 = 7919;

fn hash(x: i32, y: i32, seed: u32) -> u32 {
    let h = (x as u32).wrapping_mul(374_761_393) ^ (y as u32).wrapping_mul(668_265_263) ^ seed;
    let h = (h ^ (h >> 13)).wrapping_mul(1_274_126_177);
    h ^ (h >> 16)
}
/// The ground shader's `gnoise` value.
fn gnoise(x: f64, y: f64, seed: u32) -> f64 {
    let (bx, by) = (x.floor(), y.floor());
    let (fx, fy, ix, iy) = (x - bx, y - by, bx as i32, by as i32);
    let corner = |dx: i32, dy: i32| {
        let angle = hash(ix.wrapping_add(dx), iy.wrapping_add(dy), seed) as f64 / 4_294_967_296.0 * std::f64::consts::TAU;
        let (s, c) = angle.sin_cos();
        c * (fx - dx as f64) + s * (fy - dy as f64)
    };
    let u = fx * fx * fx * (fx * (fx * 6.0 - 15.0) + 10.0);
    let v = fy * fy * fy * (fy * (fy * 6.0 - 15.0) + 10.0);
    let north = corner(0, 0) * (1.0 - u) + corner(1, 0) * u;
    let south = corner(0, 1) * (1.0 - u) + corner(1, 1) * u;
    (north * (1.0 - v) + south * v) * 1.4
}
fn smoothstep(a: f64, b: f64, v: f64) -> f64 {
    let t = ((v - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

/// Height offset (m) at a world point where the spline has this value and slope (m, m/m), on cells of `cell` metres.
pub fn offset(x: f64, y: f64, height: f64, slope: f64, cell: f64) -> f64 {
    let reach = slope * cell * REACH;
    if height.abs() >= reach {
        return 0.0;
    }
    let rough = (0.15 + 0.6 * smoothstep(0.03, 0.22, slope) + 0.45 * gnoise(x / (cell * STRETCH), y / (cell * STRETCH), STRETCH_SEED)).clamp(0.08, 1.0);
    let mut sum = 0.0;
    for (k, &(wavelength, amplitude)) in OCTAVES.iter().enumerate() {
        let (sn, cs) = ROTATIONS[k].sin_cos();
        let (c, s) = (cs / (wavelength * cell), sn / (wavelength * cell));
        sum += amplitude * gnoise(x * c - y * s, x * s + y * c, OCTAVE_SEED * (k as u32 + 1));
    }
    slope * cell * rough * sum * smoothstep(0.0, 1.0, 1.0 - height.abs() / reach)
}

/// The ground as drawn at a world point of a grid of cell-centred controls (`n` per side, `grid_cell` metres): its cubic
/// B-spline plus the offset, on the display field's cell `shore_cell` (0: no shore detail, the spline alone).
pub fn drawn_height(h: &[f32], n: usize, grid_cell: f64, x: f64, y: f64, shore_cell: f64) -> f64 {
    let weights = |t: f64| [(1.0 - t).powi(3) / 6.0, (3.0 * t.powi(3) - 6.0 * t * t + 4.0) / 6.0, (-3.0 * t.powi(3) + 3.0 * t * t + 3.0 * t + 1.0) / 6.0, t.powi(3) / 6.0];
    let slopes = |t: f64| [-0.5 * (1.0 - t).powi(2), 1.5 * t * t - 2.0 * t, -1.5 * t * t + t + 0.5, 0.5 * t * t];
    let (gx, gy) = (x / grid_cell - 0.5, y / grid_cell - 0.5);
    let (fx, fy) = (gx.floor(), gy.floor());
    let (wx, wy, dx, dy) = (weights(gx - fx), weights(gy - fy), slopes(gx - fx), slopes(gy - fy));
    let last = n as isize - 1;
    let (mut value, mut sx, mut sy) = (0.0, 0.0, 0.0);
    for j in 0..4 {
        let row = (fy as isize + j as isize - 1).clamp(0, last) as usize * n;
        for i in 0..4 {
            let control = f64::from(h[row + (fx as isize + i as isize - 1).clamp(0, last) as usize]);
            value += control * wx[i] * wy[j];
            sx += control * dx[i] * wy[j];
            sy += control * wx[i] * dy[j];
        }
    }
    if shore_cell <= 0.0 {
        return value;
    }
    value + offset(x, y, value, sx.hypot(sy) / grid_cell, shore_cell)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The values of `shoreOffset` (web/src/render/shoreDetail.ts) on a plane of slope 0.1 crossing sea level, on cells
    /// of 30 m; web/tests/v2/shoreline.test.ts pins the TS side on the same points.
    const PINNED: [(f64, f64, f64, f64); 4] = [
        (955.0, 700.0, -0.5, -0.15888651102481158),
        (962.5, 1010.0, 0.25, -0.10346281897703119),
        (940.0, 333.3, -2.0, 0.03680147280996239),
        (1200.0, 900.0, 24.0, 0.0),
    ];

    #[test]
    fn offset_matches_the_page_shore_detail() {
        for (x, y, h, expected) in PINNED {
            let at = offset(x, y, h, 0.1, 30.0);
            assert!((at - expected).abs() < 1e-9, "({x}, {y}): {at} vs {expected}");
        }
    }

    #[test]
    fn drawn_height_is_the_spline_plus_the_offset_and_the_spline_alone_without_a_shore() {
        let (n, cell) = (64, 30.0);
        let h: Vec<f32> = (0..n * n).map(|i| (0.1 * (((i % n) as f64 + 0.5) * cell - 960.0)) as f32).collect();
        for (x, y, plane, expected) in PINNED {
            assert!((drawn_height(&h, n, cell, x, y, cell) - (plane + expected)).abs() < 1e-4);
            assert!((drawn_height(&h, n, cell, x, y, 0.0) - plane).abs() < 1e-4);
        }
    }
}
