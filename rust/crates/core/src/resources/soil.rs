//! R2 terrain and soil fields on the block grid, after `surface_context.py::compile_context`
//! (subset): one priority flood gives receivers, a drainage order, D8 accumulation and
//! HAND; then TWI, alluvial/colluvial potentials, texture, soil depth, stoniness,
//! moisture, organic matter and drainage class, all O(blocks).
use super::geology::{Rock, TEXTURE};
use super::potentials::{self, Potentials};
use super::{RegionPrior, ResourceFields, Surface};
use std::cmp::Reverse;
use std::collections::BinaryHeap;

const NONE: u32 = u32::MAX;
/// Contributing area making a drainage line (HAND reference), m².
const CHANNEL_AREA: f64 = 1.0e6;

/// DEM pooled onto the blocks.
pub(super) struct Blocks {
    pub height: Vec<f32>,
    pub water: Vec<u8>,
    pub level: Vec<f32>,
}

/// Mean ground of the DEM cells centred in each block; a block is sea or lake when at
/// least half of it is, else river when any cell is. Empty edge blocks take the nearest cell.
pub(super) fn pool(s: &Surface<'_>, nx: usize, ny: usize, b: f64, x0: f64, y0: f64) -> Blocks {
    let (n, dem) = (s.n, s.width / s.n as f64);
    let size = nx * ny;
    let mut ground = vec![0.0_f64; size];
    let mut count = vec![[0u32; 4]; size];
    let mut level = vec![[0.0_f64; 4]; size];
    let block = |px: f64, py: f64| {
        let i = (((px - x0) / b) as usize).min(nx - 1);
        let j = (((py - y0) / b) as usize).min(ny - 1);
        j * nx + i
    };
    let class = |c: usize| match s.water[c] {
        2 if s.water_level[c] <= s.height[c] => 0, // cavern rock: ground
        w => w as usize,
    };
    for c in 0..n * n {
        let k = block((c % n) as f64 * dem + 0.5 * dem, (c / n) as f64 * dem + 0.5 * dem);
        let w = class(c);
        ground[k] += s.height[c] as f64;
        count[k][w] += 1;
        level[k][w] += s.water_level[c] as f64;
    }
    let mut out = Blocks { height: vec![0.0; size], water: vec![0; size], level: vec![0.0; size] };
    for k in 0..size {
        let total: u32 = count[k].iter().sum();
        if total == 0 {
            let (px, py) = (x0 + ((k % nx) as f64 + 0.5) * b, y0 + ((k / nx) as f64 + 0.5) * b);
            let c = ((py / dem).clamp(0.0, (n - 1) as f64) as usize) * n + (px / dem).clamp(0.0, (n - 1) as f64) as usize;
            let w = class(c);
            out.height[k] = s.height[c];
            out.water[k] = w as u8;
            out.level[k] = if w == 0 { s.height[c] } else { s.water_level[c] };
            continue;
        }
        let w = if 2 * count[k][1] >= total {
            1
        } else if 2 * count[k][2] >= total {
            2
        } else if count[k][3] > 0 {
            3
        } else {
            0
        };
        out.height[k] = (ground[k] / total as f64) as f32;
        out.water[k] = w as u8;
        out.level[k] = if w == 0 { out.height[k] } else { (level[k][w] / count[k][w] as f64) as f32 };
    }
    out
}

fn ordered(v: f32) -> u32 {
    let b = v.to_bits();
    if b >> 31 == 1 { !b } else { b | 0x8000_0000 }
}

const D8: [(isize, isize); 8] = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)];

/// Priority flood from sea, lakes and the map edge: each block's receiver is the block
/// that flooded it, and the pop order lists receivers before their donors.
pub(super) fn flood(blocks: &Blocks, nx: usize, ny: usize) -> (Vec<u32>, Vec<u32>) {
    let size = nx * ny;
    let mut receiver = vec![NONE; size];
    let mut seen = vec![false; size];
    let mut fill = vec![0.0_f32; size];
    let mut heap = BinaryHeap::with_capacity(size / 4);
    let surface = |k: usize| match blocks.water[k] {
        1 | 2 => blocks.level[k],
        3 => blocks.height[k].min(blocks.level[k]),
        _ => blocks.height[k],
    };
    for k in 0..size {
        let (x, y) = (k % nx, k / nx);
        if matches!(blocks.water[k], 1 | 2) || x == 0 || y == 0 || x + 1 == nx || y + 1 == ny {
            seen[k] = true;
            fill[k] = surface(k);
            heap.push(Reverse((ordered(fill[k]), k as u32)));
        }
    }
    let mut order = Vec::with_capacity(size);
    while let Some(Reverse((_, c))) = heap.pop() {
        let c = c as usize;
        order.push(c as u32);
        let (x, y) = ((c % nx) as isize, (c / nx) as isize);
        for (dx, dy) in D8 {
            let (xx, yy) = (x + dx, y + dy);
            if xx < 0 || yy < 0 || xx >= nx as isize || yy >= ny as isize {
                continue;
            }
            let k = yy as usize * nx + xx as usize;
            if !seen[k] {
                seen[k] = true;
                receiver[k] = c as u32;
                fill[k] = surface(k).max(fill[c]);
                heap.push(Reverse((ordered(fill[k]), k as u32)));
            }
        }
    }
    (receiver, order)
}

/// Approximate Euclidean distance to the nearest seed block (two chamfer passes that
/// propagate the nearest seed), with that seed.
pub(super) fn nearest_seed(seed: &[bool], nx: usize, ny: usize, b: f64) -> (Vec<f32>, Vec<u32>) {
    let mut near = vec![NONE; nx * ny];
    for (k, &s) in seed.iter().enumerate() {
        if s {
            near[k] = k as u32;
        }
    }
    let d2 = |k: usize, s: u32| {
        let (dx, dy) = ((k % nx) as f64 - (s as usize % nx) as f64, (k / nx) as f64 - (s as usize / nx) as f64);
        dx * dx + dy * dy
    };
    let mut relax = |k: usize, offsets: &[(isize, isize)]| {
        let (x, y) = ((k % nx) as isize, (k / nx) as isize);
        for &(dx, dy) in offsets {
            let (xx, yy) = (x + dx, y + dy);
            if xx < 0 || yy < 0 || xx >= nx as isize || yy >= ny as isize {
                continue;
            }
            let s = near[yy as usize * nx + xx as usize];
            if s != NONE && (near[k] == NONE || d2(k, s) < d2(k, near[k])) {
                near[k] = s;
            }
        }
    };
    for k in 0..nx * ny {
        relax(k, &[(-1, 0), (-1, -1), (0, -1), (1, -1)]);
    }
    for k in (0..nx * ny).rev() {
        relax(k, &[(1, 0), (1, 1), (0, 1), (-1, 1)]);
    }
    let dist = (0..nx * ny)
        .map(|k| if near[k] == NONE { 1e9 } else { (d2(k, near[k]).sqrt() * b) as f32 })
        .collect();
    (dist, near)
}

#[allow(clippy::too_many_arguments)]
pub(super) fn fields(
    blocks: Blocks,
    (receiver, order): (Vec<u32>, Vec<u32>),
    rocks: &[Rock],
    prior: RegionPrior,
    nx: usize,
    ny: usize,
    b: f64,
    lod: i32,
    x0: f64,
    y0: f64,
    seed: u64,
    origin: (i64, i64),
) -> ResourceFields {
    let size = nx * ny;
    let h = &blocks.height;
    let land = |k: usize| blocks.water[k] == 0 || blocks.water[k] == 3;
    let at = |x: isize, y: isize| h[(y.clamp(0, ny as isize - 1) as usize) * nx + x.clamp(0, nx as isize - 1) as usize] as f64;
    // Slope (degrees), aspect and a ~3-block TPI from the pooled heights.
    let local = crate::urban::par::range(ny, |y| {
        (0..nx)
            .map(|x| {
                let (x, y) = (x as isize, y as isize);
                let gx = (at(x + 1, y) - at(x - 1, y)) / (2.0 * b);
                let gy = (at(x, y + 1) - at(x, y - 1)) / (2.0 * b);
                let mean = D8.iter().map(|&(dx, dy)| at(x + dx, y + dy)).sum::<f64>() / 8.0;
                let slope = gx.hypot(gy).atan().to_degrees();
                (slope, (-gx).atan2(gy).to_degrees().rem_euclid(360.0), at(x, y) - mean)
            })
            .collect::<Vec<_>>()
    });
    let local: Vec<(f64, f64, f64)> = local.into_iter().flatten().collect();
    let slope: Vec<f64> = local.iter().map(|v| v.0).collect();
    let aspect: Vec<f64> = local.iter().map(|v| v.1).collect();
    let tpi: Vec<f64> = local.iter().map(|v| v.2).collect();
    let rock_w = |k: usize, r: usize| rocks[k].weights[r] as f64;
    // Donor -> receiver accumulation: area, gravity runout, eroded-rock provenance.
    let mut area = vec![b * b; size];
    let mut gravity: Vec<f64> = (0..size)
        .map(|k| ((slope[k] - 24.0) / 22.0).clamp(0.0, 1.0) * rocks[k].hardness as f64)
        .collect();
    let mut provenance: Vec<[f32; 8]> = (0..size)
        .map(|k| {
            let erosion = if land(k) { 0.02 + slope[k].to_radians().tan() * rocks[k].weatherability as f64 } else { 0.0 };
            std::array::from_fn(|r| (erosion * rock_w(k, r)) as f32)
        })
        .collect();
    let mut channel: Vec<bool> = (0..size).map(|k| blocks.water[k] == 3).collect();
    for &c in order.iter().rev() {
        let c = c as usize;
        channel[c] |= area[c] >= CHANNEL_AREA && land(c);
        let r = receiver[c];
        if r == NONE {
            continue;
        }
        let r = r as usize;
        area[r] += area[c];
        let p = provenance[c];
        provenance[r].iter_mut().zip(p).for_each(|(a, v)| *a += v);
        if land(r) {
            let step = if c % nx != r % nx && c / nx != r / nx { b * std::f64::consts::SQRT_2 } else { b };
            gravity[r] = gravity[r].max(gravity[c] * (-step / 350.0).exp());
        }
        if channel[c] && land(r) {
            channel[r] = true;
        }
    }
    // HAND: the reference of the first drainage reached downstream (receivers before donors).
    let mut reference = vec![0.0_f32; size];
    let mut edge = vec![false; size];
    for &c in &order {
        let c = c as usize;
        if !land(c) {
            reference[c] = blocks.level[c];
        } else if channel[c] {
            reference[c] = h[c].min(blocks.level[c]);
        } else if receiver[c] == NONE {
            reference[c] = h[c];
            edge[c] = true;
        } else {
            let r = receiver[c] as usize;
            reference[c] = reference[r];
            edge[c] = edge[r];
        }
    }
    let wet: Vec<bool> = (0..size).map(|k| !land(k) || channel[k]).collect();
    let (distance, nearest) = nearest_seed(&wet, nx, ny, b);
    let sea_level = |k: usize| if blocks.water[k] == 1 { 0.0 } else { blocks.level[k] };
    let temperature = prior.temperature as f64;
    let precipitation = prior.precipitation as f64;
    let mut out = ResourceFields {
        nx,
        ny,
        cell: b,
        lod,
        x0,
        y0,
        prior,
        water: blocks.water.clone(),
        bedrock: rocks.iter().map(|r| r.class).collect(),
        hardness: rocks.iter().map(|r| r.hardness).collect(),
        structure_azimuth: rocks.iter().map(|r| r.azimuth).collect(),
        hand: vec![0.0; size],
        twi: vec![0.0; size],
        alluvial: vec![0.0; size],
        colluvial: vec![0.0; size],
        soil_depth: vec![0.0; size],
        stoniness: vec![0.0; size],
        clay: vec![0.0; size],
        sand: vec![0.0; size],
        moisture: vec![0.0; size],
        organic: vec![0.0; size],
        drainage: vec![0; size],
        potentials: Potentials::empty(),
        deposits: Vec::new(),
        anchors: Vec::new(),
    };
    // Per-block soil column, rows in parallel: twi, hand, alluvial, colluvial, soil depth,
    // stoniness, clay, sand, moisture, organic, drainage.
    let column = |k: usize| -> [f32; 11] {
        let mut o = [0.0_f32; 11];
        let slope_tan = slope[k].to_radians().tan();
        o[0] = ((b.max(area[k] / b)) / slope_tan.max(0.001)).ln() as f32;
        if blocks.water[k] == 1 || blocks.water[k] == 2 {
            o[8] = 1.0;
            return o;
        }
        let height = h[k] as f64;
        let hand = (height - reference[k] as f64).max(0.0);
        o[1] = hand as f32;
        // A map-edge outlet is no drainage: fall back on the height above the nearest water.
        let relative = if edge[k] && nearest[k] != NONE {
            (height - sea_level(nearest[k] as usize) as f64).max(0.0)
        } else {
            hand
        };
        let dist = distance[k] as f64;
        let s = slope[k];
        let rock = &rocks[k];
        let (hardness, weatherability) = (rock.hardness as f64, rock.weatherability as f64);
        let mut alluvial = (-relative / 9.0).exp() * (-dist / 550.0).exp() * (-s / 10.0).exp();
        if channel[k] {
            alluvial = 1.0;
        }
        // Texture: local regolith, mixed with the upstream sediment of the nearby reach.
        let transported = if nearest[k] != NONE { provenance[nearest[k] as usize] } else { provenance[k] };
        let total: f64 = transported.iter().map(|&v| v as f64).sum();
        let mut texture = [0.0_f64; 3];
        for r in 0..8 {
            let t = if total > 0.0 { transported[r] as f64 / total } else { rock_w(k, r) };
            let mix = rock_w(k, r) * (1.0 - alluvial) + t * alluvial;
            for (x, &v) in texture.iter_mut().zip(&TEXTURE[r]) {
                *x += mix * v as f64;
            }
        }
        let power = (s / 18.0 + (area[k] / 1.0e6).ln_1p() / 9.0).clamp(0.0, 1.0);
        let fine = [0.18 + 0.55 * power, 0.53 - 0.36 * power, 0.29 - 0.19 * power];
        let sorting = 0.45 * alluvial;
        for (x, f) in texture.iter_mut().zip(fine) {
            *x = *x * (1.0 - sorting) + f * sorting;
        }
        let sum: f64 = texture.iter().sum();
        let [sand, silt, clay] = texture.map(|v| v / sum);
        // Local climate: -6.5 °C/km; aridity index P / PET with a temperature-only PET.
        let local_t = temperature - 0.0065 * height.max(0.0);
        let aridity = precipitation / (300.0 + 40.0 * local_t).max(250.0);
        let warm = ((local_t + 8.0) / 30.0).clamp(0.0, 1.0);
        let weathering = weatherability * aridity.clamp(0.05, 1.5) * (0.3 + 0.7 * warm);
        let stable = (-s / 22.0).exp();
        let colluvial = gravity[k] * ((25.0 - s) / 18.0).clamp(0.0, 1.0) * (1.0 - alluvial);
        let sand_supply = sand * (0.15 + weathering);
        let lee = 0.3 + 0.7 * (aspect[k] - 70.0).to_radians().cos().max(0.0);
        let traps = 0.25 + 0.75 * (-tpi[k] / 12.0).clamp(0.0, 1.0);
        let aeolian = ((0.65 - aridity) * 2.0).clamp(0.0, 1.0) * sand_supply * stable * lee * traps;
        let frost = ((3.0 - local_t) / 15.0).clamp(0.0, 1.0) * (s / 30.0).min(1.0) * hardness;
        let deposit = (0.03 + 0.8 * weathering * stable + 3.5 * alluvial + 1.8 * colluvial + 0.9 * aeolian).clamp(0.0, 8.0);
        let soil_depth = ((0.08 + 1.1 * weathering * stable + deposit * 0.30) * (-s / 65.0).exp()).clamp(0.02, 3.0);
        let stoniness = (0.07 + hardness * (1.0 - stable) * 0.65 + colluvial * 0.6 + frost * 0.25 - alluvial * 0.2).clamp(0.0, 1.0);
        let storage = soil_depth * (75.0 + 150.0 * clay + 65.0 * silt) * (1.0 - stoniness);
        let permeability = (0.15 + 0.75 * sand - 0.35 * clay - 0.15 * weatherability).clamp(0.0, 1.0);
        let wet_topo = ((o[0] as f64 - 5.0) / 10.0).clamp(0.0, 1.0);
        let riparian = (-relative / 12.0).exp() * (-dist / 400.0).exp();
        let exposure = (0.5 + 0.5 * aspect[k].to_radians().cos()) * (s / 30.0).min(1.0);
        let moisture = (0.12 + 0.35 * aridity.min(1.8) + 0.20 * wet_topo + 0.28 * riparian
            + 0.12 * (1.0 - permeability)
            + 0.10 * (storage / 250.0).min(1.0)
            + 0.05 * exposure
            - 0.22 * permeability
            - 0.12 * warm)
            .clamp(0.0, 1.0);
        let organic = (0.015 + 0.14 * moisture * stable * aridity.clamp(0.0, 1.5) * (1.2 - 0.5 * warm)).clamp(0.0, 0.45);
        o[2] = alluvial as f32;
        o[3] = colluvial as f32;
        o[4] = soil_depth as f32;
        o[5] = stoniness as f32;
        o[6] = clay as f32;
        o[7] = sand as f32;
        o[8] = moisture as f32;
        o[9] = organic as f32;
        o[10] = if moisture > 0.78 {
            1.0
        } else if moisture > 0.6 {
            2.0
        } else if moisture > 0.38 {
            3.0
        } else {
            4.0
        };
        o
    };
    let rows = crate::urban::par::range(ny, |j| (j * nx..(j + 1) * nx).map(column).collect::<Vec<_>>());
    for (k, o) in rows.into_iter().flatten().enumerate() {
        out.twi[k] = o[0];
        out.hand[k] = o[1];
        out.alluvial[k] = o[2];
        out.colluvial[k] = o[3];
        out.soil_depth[k] = o[4];
        out.stoniness[k] = o[5];
        out.clay[k] = o[6];
        out.sand[k] = o[7];
        out.moisture[k] = o[8];
        out.organic[k] = o[9];
        out.drainage[k] = o[10] as u8;
    }
    let inputs = potentials::Inputs {
        height: &blocks.height,
        level: &blocks.level,
        slope: &slope,
        area: &area,
        channel: &channel,
        receiver: &receiver,
        provenance: &provenance,
        dist_wet: &distance,
    };
    out.potentials = potentials::compute(&out, &inputs);
    out.deposits = super::deposits::draw(&out, &inputs, seed, origin);
    out.anchors = super::anchors::place(&out, &inputs, &out.deposits, seed, origin);
    out
}
