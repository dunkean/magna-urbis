//! R3 potentials: 0-1 intensities per block for every field-computable id of the
//! `potentials` vocabulary of `urban/activities.json`. Simplified Neural Earth formulas
//! (Ecocrop trapezoids, Miami NPP, NE lithology table) on the R2 soil fields; all O(blocks).
//! Objects (ore, salt_deposit, coal, settlement, road, crossing) are not fields.
use super::soil::nearest_seed;
use super::ResourceFields;

/// What the soil pass keeps for the potentials (block-aligned, same indexing as the fields).
pub(super) struct Inputs<'a> {
    pub height: &'a [f32],
    pub level: &'a [f32],
    /// Slope, degrees.
    pub slope: &'a [f64],
    /// Contributing area, m².
    pub area: &'a [f64],
    pub channel: &'a [bool],
    pub receiver: &'a [u32],
    /// Upstream eroded rock per block, [`super::ROCKS`] order.
    pub provenance: &'a [[f32; 8]],
    /// Distance to the nearest sea, lake or channel, m.
    pub dist_wet: &'a [f32],
}

macro_rules! potentials {
    ($($id:ident),*) => {
        /// Ids of the field potentials, in storage order.
        pub const IDS: [&str; [$(stringify!($id)),*].len()] = [$(stringify!($id)),*];
        #[derive(Default)]
        struct Block { $($id: f32),* }
        impl Block {
            fn scatter(&self, out: &mut [Vec<f32>], k: usize) {
                let mut i = 0;
                $( out[i][k] = self.$id; i += 1; )*
                let _ = i;
            }
        }
    };
}
potentials!(
    arable, pasture, upland_pasture, wood, timber, water_power, wind_exposure, stone_ashlar, lime, slate, clay,
    sand, fish_river, fish_coast, coast_shelter, navigable, peat, bog_iron, salt_coast, game
);

/// Potentials of every block, 0-1.
pub struct Potentials {
    pub nx: usize,
    pub ny: usize,
    pub cell: f64,
    pub x0: f64,
    pub y0: f64,
    data: Vec<Vec<f32>>,
}

impl Potentials {
    pub(super) fn empty() -> Self {
        Self { nx: 0, ny: 0, cell: 0.0, x0: 0.0, y0: 0.0, data: Vec::new() }
    }
    /// One value per block (row-major, as the other fields); empty for an unknown id.
    pub fn get(&self, id: &str) -> &[f32] {
        IDS.iter().position(|&i| i == id).map_or(&[], |p| &self.data[p])
    }
    /// Value of the block containing a map-frame point (clamped to the grid); 0 for an unknown id.
    pub fn sample(&self, id: &str, x: f64, y: f64) -> f32 {
        let i = ((x - self.x0) / self.cell).floor().clamp(0.0, (self.nx - 1) as f64) as usize;
        let j = ((y - self.y0) / self.cell).floor().clamp(0.0, (self.ny - 1) as f64) as usize;
        self.get(id).get(j * self.nx + i).copied().unwrap_or(0.0)
    }
    /// (id, mean over all blocks, max, share of blocks above 0.1).
    pub fn stats(&self) -> Vec<(&'static str, f32, f32, f32)> {
        IDS.iter()
            .zip(&self.data)
            .map(|(&id, d)| {
                let n = d.len().max(1) as f32;
                (id, d.iter().sum::<f32>() / n, d.iter().fold(0.0_f32, |a, &v| a.max(v)), d.iter().filter(|&&v| v > 0.1).count() as f32 / n)
            })
            .collect()
    }
}

fn smooth(a: f64, b: f64, x: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
/// Ecocrop trapezoid: 0 below `a` and above `d`, 1 on [b, c].
fn trapezoid(x: f64, a: f64, b: f64, c: f64, d: f64) -> f64 {
    if x <= a || x >= d {
        0.0
    } else if x < b {
        (x - a) / (b - a)
    } else if x <= c {
        1.0
    } else {
        (d - x) / (d - c)
    }
}
/// Miami NPP (g/m²/yr) of annual T (°C) and P (mm), scaled to ~1 for a temperate forest.
fn npp(t: f64, p: f64) -> f64 {
    let by_t = 3000.0 / (1.0 + (1.315 - 0.119 * t).exp());
    let by_p = 3000.0 * (1.0 - (-0.000664 * p).exp());
    (by_t.min(by_p) / 1500.0).clamp(0.0, 1.0)
}
/// Woody cover of the biome on a moist, deep, temperate-climate site.
fn woody_base(biome: &str) -> f64 {
    match biome {
        "forest" | "tropical" => 0.9,
        "continental" => 0.75,
        "temperate" => 0.65,
        "alpine" | "mountains" => 0.5,
        "mediterranean" | "wetland" => 0.45,
        "savanna" => 0.3,
        "arctic" | "tundra" | "nordic" => 0.2,
        "steppe" => 0.12,
        "desert" => 0.04,
        _ => 0.6,
    }
}
/// NE ashlar suitability per rock class (ROCKS order); marl and evaporite are no building stone.
const ASHLAR: [f64; 8] = [0.7, 0.9, 0.8, 0.0, 0.4, 0.5, 0.3, 0.1];
const LIME: [f64; 8] = [0.0, 1.0, 0.0, 0.2, 0.0, 0.0, 0.0, 0.0];
const SLATE: [f64; 8] = [0.0, 0.0, 0.0, 0.0, 0.0, 0.6, 0.0, 0.0];
/// Iron-bearing weight of the upstream rocks (granite, basalt, ultrabasic).
const IRON: [f64; 8] = [0.7, 0.0, 0.0, 0.0, 1.0, 0.0, 1.0, 0.0];
/// Drainage class 1 (very poor) .. 4 (well) for crops.
const DRAIN_ARABLE: [f64; 5] = [0.0, 0.15, 0.6, 1.0, 0.85];

pub(super) fn compute(f: &ResourceFields, g: &Inputs<'_>) -> Potentials {
    let (nx, ny, b) = (f.nx, f.ny, f.cell);
    let size = nx * ny;
    let p = &f.prior;
    let (t_sea, precip) = (p.temperature as f64, p.precipitation as f64);
    let woody0 = woody_base(&p.biome);
    let km2 = |k: usize| g.area[k] / 1.0e6;
    let is_sea = |k: usize| f.water[k] == 1;
    let is_lake = |k: usize| f.water[k] == 2;
    let fresh = |k: usize| is_lake(k) || (g.channel[k] && !is_sea(k));
    // River discharge proxies from the contributing area.
    let flow = |k: usize, full: f64| (km2(k).max(1.0).ln() / full.ln()).clamp(0.1, 1.0);
    let navigable_q = |k: usize| (0.3 + 0.7 * (km2(k) / 50.0).max(1.0).ln() / 10f64.ln()).clamp(0.3, 1.0);
    let navigable_seed = |k: usize| is_sea(k) || is_lake(k) || (g.channel[k] && km2(k) >= 50.0);
    let sea: Vec<bool> = (0..size).map(is_sea).collect();
    let fresh_seed: Vec<bool> = (0..size).map(fresh).collect();
    let nav_seed: Vec<bool> = (0..size).map(navigable_seed).collect();
    let (d_sea, _) = nearest_seed(&sea, nx, ny, b);
    let (d_fresh, n_fresh) = nearest_seed(&fresh_seed, nx, ny, b);
    let (d_nav, n_nav) = nearest_seed(&nav_seed, nx, ny, b);
    // Sea share in a ~1.5 km window (integral image): a straight shore reads ~0.5, a bay less.
    let radius = ((1500.0 / b).ceil() as isize).max(2);
    let mut integral = vec![0u32; (nx + 1) * (ny + 1)];
    for y in 0..ny {
        let mut row = 0;
        for x in 0..nx {
            row += u32::from(sea[y * nx + x]);
            integral[(y + 1) * (nx + 1) + x + 1] = integral[y * (nx + 1) + x + 1] + row;
        }
    }
    let sea_share = |k: usize| {
        let (x, y) = ((k % nx) as isize, (k / nx) as isize);
        let (x0, x1) = ((x - radius).max(0) as usize, (x + radius + 1).min(nx as isize) as usize);
        let (y0, y1) = ((y - radius).max(0) as usize, (y + radius + 1).min(ny as isize) as usize);
        let at = |x: usize, y: usize| integral[y * (nx + 1) + x] as f64;
        (at(x1, y1) - at(x0, y1) - at(x1, y0) + at(x0, y0)) / ((x1 - x0) * (y1 - y0)) as f64
    };
    // Positive TPI over ~300 m (mean of 8 samples on that ring).
    let ring = ((300.0 / b).round() as isize).max(1);
    let hat = |x: isize, y: isize| g.height[y.clamp(0, ny as isize - 1) as usize * nx + x.clamp(0, nx as isize - 1) as usize] as f64;
    let tpi = |k: usize| {
        let (x, y) = ((k % nx) as isize, (k / nx) as isize);
        let ring_mean = [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)]
            .iter()
            .map(|&(dx, dy)| hat(x + dx * ring, y + dy * ring))
            .sum::<f64>()
            / 8.0;
        hat(x, y) - ring_mean
    };
    let surface = |k: usize| if f.water[k] == 3 { g.height[k].min(g.level[k]) } else { g.height[k] } as f64;
    // Fall of a river reach: 1-2 blocks downstream, per metre of run (None into a lake/sea).
    let gradient = |k: usize| -> f64 {
        let step = |c: usize| g.receiver[c] != u32::MAX && !matches!(f.water[g.receiver[c] as usize], 1 | 2);
        if !step(k) {
            return 0.0;
        }
        let r1 = g.receiver[k] as usize;
        let r = if step(r1) { g.receiver[r1] as usize } else { r1 };
        let (dx, dy) = ((k % nx) as f64 - (r % nx) as f64, (k / nx) as f64 - (r / nx) as f64);
        ((surface(k) - surface(r)) / (dx.hypot(dy) * b)).max(0.0)
    };

    let block = |k: usize| -> Block {
        let mut o = Block::default();
        let w = f.water[k];
        let (sea_k, lake_k) = (w == 1, w == 2);
        if sea_k {
            o.navigable = 1.0;
            return o;
        }
        let height = g.height[k] as f64;
        let hand = f.hand[k] as f64;
        let slope = g.slope[k];
        // Fresh fishing: low HAND near a lake or stream, scaled by the nearest discharge.
        let nf = n_fresh[k];
        if nf != u32::MAX {
            let q = if is_lake(nf as usize) { 0.8 } else { flow(nf as usize, 200.0) };
            o.fish_river = ((-hand / 3.0).exp() * (-(d_fresh[k] as f64) / 300.0).exp() * q) as f32;
        }
        // Navigation: the water itself, or access to it from the bank.
        o.navigable = if lake_k {
            1.0
        } else if w == 3 {
            if navigable_seed(k) { navigable_q(k) as f32 } else { 0.0 }
        } else if n_nav[k] != u32::MAX {
            let s = n_nav[k] as usize;
            let q = if is_sea(s) || is_lake(s) { 1.0 } else { navigable_q(s) };
            (q * (-(d_nav[k] as f64) / 500.0).exp()) as f32
        } else {
            0.0
        };
        // Water power: head of the river reach x discharge, only along streams.
        if g.channel[k] && !lake_k {
            let head = (gradient(k) * 300.0 / 4.0).clamp(0.0, 1.0);
            o.water_power = (head * flow(k, 100.0) * (precip / 700.0).clamp(0.3, 1.0)) as f32;
        }
        if w != 0 {
            return o;
        }
        let local_t = t_sea - 0.0065 * height.max(0.0);
        let (depth, stones, moisture) = (f.soil_depth[k] as f64, f.stoniness[k] as f64, f.moisture[k] as f64);
        let eff_p = (precip * (0.6 + 0.8 * moisture)).min(4000.0);
        let npp = npp(local_t, eff_p);
        // Woody cover: biome x rain x moisture, none above the snow line or on bare rock.
        let woody = woody0
            * smooth(150.0, 700.0, precip)
            * (0.5 + 0.9 * moisture).min(1.0)
            * smooth(-2.0, 3.0, local_t)
            * smooth(0.05, 0.4, depth);
        o.wood = woody as f32;
        let mature = (0.3 + 0.35 * moisture + 0.2 * smooth(8.0, 25.0, slope) + 0.15 * smooth(500.0, 3000.0, g.dist_wet[k] as f64)).min(1.0);
        o.timber = (woody * mature) as f32;
        // Arable: most limiting of T and P trapezoids x slope x soil x stones x drainage.
        let climate = trapezoid(local_t, 1.0, 6.0, 18.0, 26.0).min(trapezoid(precip, 200.0, 450.0, 1400.0, 2400.0));
        o.arable = (climate
            * (-slope / 10.0).exp()
            * (depth / 0.5).min(1.0)
            * (1.0 - stones)
            * DRAIN_ARABLE[f.drainage[k].min(4) as usize]) as f32;
        let herb = 1.0 - woody;
        let pasture = npp * herb * (-slope / 40.0).exp() * smooth(0.03, 0.2, depth) * (1.0 - 0.5 * stones);
        o.pasture = pasture as f32;
        // Summer range: altitude x the lowlands' cold or dry season shortfall.
        let deficit = 0.35 + 0.65 * ((7.0 - t_sea) / 8.0).clamp(0.0, 1.0).max(((800.0 - precip) / 500.0).clamp(0.0, 1.0));
        o.upland_pasture = (pasture * smooth(400.0, 1000.0, height) * deficit) as f32;
        o.wind_exposure = (smooth(3.0, 40.0, tpi(k)) * (1.0 - 0.85 * woody)) as f32;
        // Stone: lithology x exposed rock x hardness.
        let rock = f.bedrock[k] as usize;
        let hard = f.hardness[k] as f64;
        let exposed = (1.0 - depth / 1.5).clamp(0.0, 1.0);
        o.stone_ashlar = (ASHLAR[rock] * exposed * hard) as f32;
        o.lime = (LIME[rock] * exposed) as f32;
        o.slate = (SLATE[rock] * exposed * hard) as f32;
        // Clay: marl or alluvial fines on flat ground; sand: sandstone, alluvium or dunes.
        let alluvial = f.alluvial[k] as f64;
        let clay_src = (if rock == 3 { 0.8_f64 } else { 0.0 }).max(alluvial);
        o.clay = ((f.clay[k] as f64 / 0.45).min(1.0) * clay_src * (-slope / 8.0).exp() * (depth / 0.5).min(1.0)) as f32;
        let dune = (-(d_sea[k] as f64) / 500.0).exp() * smooth(25.0, 3.0, height);
        let sand_src = (if rock == 2 { 0.7_f64 } else { 0.0 }).max(0.6 * alluvial).max(0.9 * dune);
        o.sand = (smooth(0.3, 0.8, f.sand[k] as f64) * sand_src * (-slope / 15.0).exp()) as f32;
        // Coast: concave shoreline (low sea share in the window) close to the sea.
        let near_sea = (-(d_sea[k] as f64) / 600.0).exp();
        let concave = ((0.5 - sea_share(k)) / 0.3).clamp(0.0, 1.0);
        o.coast_shelter = (near_sea * concave * (-slope / 12.0).exp()) as f32;
        o.fish_coast = ((-(d_sea[k] as f64) / 700.0).exp() * (0.35 + 0.65 * concave) * (-slope / 15.0).exp()) as f32;
        // Wetland resources.
        let hand_f = (-hand / 3.0).exp();
        let poor = match f.drainage[k] {
            1 => 1.0,
            2 => 0.4,
            _ => 0.0,
        };
        let cool = ((14.0 - local_t) / 8.0).clamp(0.0, 1.0);
        o.peat = (poor * (f.organic[k] as f64 / 0.3).min(1.0) * hand_f * cool * (-slope / 6.0).exp()) as f32;
        let prov = &g.provenance[k];
        let total: f64 = prov.iter().map(|&v| v as f64).sum();
        let iron = if total > 0.0 { prov.iter().zip(IRON).map(|(&v, w)| v as f64 * w).sum::<f64>() / total } else { 0.0 };
        let wetland = ((moisture - 0.55) / 0.35).clamp(0.0, 1.0) * (-hand / 4.0).exp() * (-slope / 8.0).exp();
        o.bog_iron = (wetland * iron.min(1.0)) as f32;
        // Salt: low, flat shore x warm and dry (evaporation proxy).
        let evaporation = ((local_t - 8.0) / 12.0).clamp(0.0, 1.0) * ((1300.0 - precip) / 900.0).clamp(0.0, 1.0);
        o.salt_coast = ((-(d_sea[k] as f64) / 400.0).exp() * (-height.max(0.0) / 6.0).exp() * (-slope / 3.0).exp() * evaporation) as f32;
        // Game: NPP weighted by habitat edge (open/forest mosaic).
        let edge = (4.0 * woody * (1.0 - woody)).max(woody);
        o.game = (npp * (0.3 + 0.7 * edge) * (-slope / 40.0).exp() * (1.0 - 0.5 * stones)) as f32;
        o
    };
    let rows = crate::urban::par::range(ny, |j| (j * nx..(j + 1) * nx).map(block).collect::<Vec<_>>());
    let mut data = vec![vec![0.0_f32; size]; IDS.len()];
    for (k, o) in rows.into_iter().flatten().enumerate() {
        o.scatter(&mut data, k);
    }
    Potentials { nx, ny, cell: b, x0: f.x0, y0: f.y0, data }
}
