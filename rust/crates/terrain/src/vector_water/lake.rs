use super::weights;
pub struct LakeField {
    pub values: Vec<f32>,
    pub distance: Vec<f32>,
    pub n: usize,
}
pub fn lake_field(mask: &[u8], n: usize) -> LakeField {
    lake_field_with_shore(mask, n, None)
}
/// Water surface and ground of a lake mask: `level` (read on lake cells),
/// `height`, and the depth threshold that defines the mask.
pub struct Shore<'a> {
    pub level: &'a [f32],
    pub height: &'a [f32],
    pub depth: f64,
}
/// Signed distance to the shore, in cells, from both sides of a mask edge.
/// With the water surface, the shore lies where the depth reaches the mask's
/// threshold between the two cell centres, instead of on the cell edge: the
/// spline then follows the terrain contour rather than the cell staircase.
fn shore_offset(mask: &[u8], shore: Option<&Shore>, c: usize, nb: usize) -> f32 {
    let Some(s) = shore else { return 0.5 };
    let (wet, dry) = if mask[c] != 0 { (c, nb) } else { (nb, c) };
    let level = s.level[wet] as f64;
    let inside = level - s.height[wet] as f64 - s.depth;
    let outside = level - s.height[dry] as f64 - s.depth;
    if !(inside > 0.0 && outside < 0.0) {
        return 0.5;
    }
    let t = (inside / (inside - outside)).clamp(0.05, 0.95);
    (if c == wet { t } else { 1.0 - t }) as f32
}
pub fn lake_field_with_shore(mask: &[u8], n: usize, shore: Option<Shore>) -> LakeField {
    // No shore exists in an empty mask: both distance sweeps and both spline
    // recurrences would keep their constant initial values exactly.
    if mask.iter().all(|&v| v == 0) {
        return LakeField {
            values: vec![-4.0; n * n],
            distance: vec![-4.0; n * n],
            n,
        };
    }
    let mut distance = vec![4.0_f32; n * n];
    let wet = |x: isize, y: isize| {
        x >= 0
            && y >= 0
            && x < n as isize
            && y < n as isize
            && mask[y as usize * n + x as usize] != 0
    };
    for y in 0..n {
        for x in 0..n {
            let (x, y) = (x as isize, y as isize);
            let inside = wet(x, y);
            let c = y as usize * n + x as usize;
            for (xx, yy) in [(x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)] {
                let off = xx < 0 || yy < 0 || xx >= n as isize || yy >= n as isize;
                if wet(xx, yy) != inside {
                    let offset = if off {
                        0.5
                    } else {
                        shore_offset(mask, shore.as_ref(), c, yy as usize * n + xx as usize)
                    };
                    distance[c] = distance[c].min(offset)
                }
            }
        }
    }
    for d in [1_isize, -1] {
        for yi in 0..n {
            let y = if d > 0 { yi } else { n - 1 - yi } as isize;
            let yy = y - d;
            let row_ok = yy >= 0 && yy < n as isize;
            for xi in 0..n {
                let x = if d > 0 { xi } else { n - 1 - xi } as isize;
                let i = y as usize * n + x as usize;
                let xb = x - d;
                let xf = x + d;
                let back = xb >= 0 && xb < n as isize;
                // Each min is stored separately in f32, matching the TS sweep.
                if back {
                    distance[i] = (distance[i] as f64)
                        .min(distance[(i as isize - d) as usize] as f64 + 1.0)
                        as f32
                }
                if row_ok {
                    let row = yy as usize * n;
                    distance[i] =
                        (distance[i] as f64).min(distance[row + x as usize] as f64 + 1.0) as f32;
                    if back {
                        distance[i] = (distance[i] as f64)
                            .min(distance[row + xb as usize] as f64 + std::f64::consts::SQRT_2)
                            as f32
                    }
                    if xf >= 0 && xf < n as isize {
                        distance[i] = (distance[i] as f64)
                            .min(distance[row + xf as usize] as f64 + std::f64::consts::SQRT_2)
                            as f32
                    }
                }
            }
        }
    }
    for i in 0..n * n {
        if mask[i] == 0 {
            distance[i] = -distance[i]
        }
    }
    let mut values: Vec<f32> = distance.iter().map(|&v| (v as f64 + 4.0) as f32).collect();
    let mut inverse = vec![0.0; n];
    inverse[0] = 0.25;
    for i in 1..n {
        inverse[i] = 1.0 / (4.0 - inverse[i - 1])
    }
    let filter = |_: usize, line: &mut [f32]| {
        let mut rhs = vec![0.0; n];
        rhs[0] = 6.0 * line[0] as f64 * inverse[0];
        for i in 1..n {
            rhs[i] = (6.0 * line[i] as f64 - rhs[i - 1]) * inverse[i]
        }
        let mut next = rhs[n - 1];
        line[n - 1] = next as f32;
        for i in (0..n - 1).rev() {
            next = rhs[i] - inverse[i] * next;
            line[i] = next as f32
        }
    };
    crate::terrain_par::rows(&mut values, n, filter);
    // Independent columns use contiguous storage, retaining the same f64
    // recurrence and f32 stores as the original strided filter.
    let mut columns = vec![0.0; n * n];
    crate::terrain_par::rows(&mut columns, n, |x, row| {
        for y in 0..n {
            row[y] = values[y * n + x];
        }
    });
    crate::terrain_par::rows(&mut columns, n, filter);
    crate::terrain_par::rows(&mut values, n, |y, row| {
        for x in 0..n {
            row[x] = (columns[x * n + y] as f64 - 4.0) as f32;
        }
    });
    LakeField {
        values,
        distance,
        n,
    }
}
fn hash(x: i32, y: i32) -> f64 {
    let mut h =
        (x as u32).wrapping_mul(374761393) ^ (y as u32).wrapping_mul(668265263) ^ 1597334677;
    h = (h ^ (h >> 13)).wrapping_mul(1274126177);
    (h ^ (h >> 16)) as f64 / 4294967296.0 * 2.0 - 1.0
}
fn noise(x: f64, y: f64) -> f64 {
    let (ix, iy) = (x.floor() as i32, y.floor() as i32);
    let (fx, fy) = (x - x.floor(), y - y.floor());
    let (u, v) = (fx * fx * (3.0 - 2.0 * fx), fy * fy * (3.0 - 2.0 * fy));
    (hash(ix, iy) * (1.0 - u) + hash(ix + 1, iy) * u) * (1.0 - v)
        + (hash(ix, iy + 1) * (1.0 - u) + hash(ix + 1, iy + 1) * u) * v
}
pub(super) fn sample(field: &LakeField, width: f64, x: f64, y: f64) -> f64 {
    let (gx, gy) = (
        x * field.n as f64 / width - 0.5,
        y * field.n as f64 / width - 0.5,
    );
    let (ix, iy) = (gx.floor() as isize, gy.floor() as isize);
    let (wx, wy) = (weights(gx - gx.floor()), weights(gy - gy.floor()));
    let mut value = 0.0;
    for j in 0..4 {
        for i in 0..4 {
            let (xx, yy) = (ix + i as isize - 1, iy + j as isize - 1);
            let v = if xx < 0 || yy < 0 || xx >= field.n as isize || yy >= field.n as isize {
                -4.0
            } else {
                field.values[yy as usize * field.n + xx as usize] as f64
            };
            value += v * wx[i] * wy[j]
        }
    }
    let fade = ((0.8 - value.abs()) / 0.3).clamp(0.0, 1.0);
    if fade != 0.0 {
        value += fade
            * fade
            * (3.0 - 2.0 * fade)
            * (0.18 * noise(gx * 0.7, gy * 0.7)
                + 0.055 * noise(gx * 2.3, gy * 2.3)
                + 0.018 * noise(gx * 6.1, gy * 6.1))
    }
    value
}
