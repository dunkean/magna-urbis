//! R4: small deposit populations at village-mine scale (Neural Earth RESOURCE_LAYERS
//! §5.2, §20.2–20.3). Per family: prospectivity `w(x)` in [0, 1] per block from host rock
//! and context, then a Poisson process of intensity `density x w(x)`, lognormal ore and
//! top depth, medieval accessibility (40 m + half the local relief) -> recoverable tonnes.
//!
//! The process is addressed on a world-fixed grid of LOD-7 cells (3.84 km): each cell,
//! keyed by seed, family and cell id, draws `N ~ Poisson(density x cell area)` candidates
//! at keyed uniform positions, and a candidate is kept iff its keyed uniform is below `w`
//! at its block (thinning: the kept count is `Poisson(density x integral of w)`, the
//! exponential race's law without needing `w` outside the map). A map takes the cells it
//! overlaps and the candidates inside its blocks, so a world point carries the same
//! deposits whatever the window; nothing is drawn or capped per map.
use super::keys::{cell_id, cell_key, cell_size, key, splitmix, unit, ValueNoise};
use super::potentials::Inputs;
use super::soil::nearest_seed;
use super::ResourceFields;
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct Deposit {
    pub id: u64,
    pub family: &'static str,
    /// Map frame, m.
    pub x: f64,
    pub y: f64,
    pub ore_t: f64,
    pub depth_top_m: f32,
    pub recoverable_t: f64,
    pub outcrop: bool,
    /// Ellipse semi-axes (major, minor), m.
    pub axis_m: [f32; 2],
    /// Major axis, degrees clockwise from north (the structure azimuth).
    pub azimuth: f32,
}

/// (family, density per 10 000 km² at prospectivity 1, median ore t, median top depth m).
/// Neural Earth's 20–100 per 10 000 km² count favourable ground only; the prospectivity
/// integrates to 0.1–15 % of the land, so the densities at `w = 1` are that much higher:
/// a 30 km map then holds a handful of ore, coal, salt and gypsum deposits.
pub const FAMILIES: [(&str, f64, f64, f64); 9] = [
    ("bog_iron", 800.0, 3000.0, 1.0),
    ("local_ironstone", 150.0, 20000.0, 3.0),
    ("small_pb_ag", 1000.0, 8000.0, 3.0),
    ("small_sn", 350.0, 5000.0, 3.0),
    ("small_coal", 150.0, 30000.0, 4.0),
    ("salt_spring", 1200.0, 10000.0, 1.0),
    ("gypsum_quarry", 600.0, 30000.0, 2.0),
    ("placer_au", 500.0, 3000.0, 1.5),
    ("placer_sn", 500.0, 5000.0, 1.5),
];
/// LOD of the world cells that address the deposit draws.
pub const CELL_LOD: i32 = 7;
/// Host rocks per family ([`super::ROCKS`] order); bog iron and placers sit on any rock.
pub const HOST: [[bool; 8]; 9] = {
    const ALL: [bool; 8] = [true; 8];
    const fn of(rocks: &[usize]) -> [bool; 8] {
        let mut h = [false; 8];
        let mut i = 0;
        while i < rocks.len() {
            h[rocks[i]] = true;
            i += 1;
        }
        h
    }
    [ALL, of(&[2, 3]), of(&[0, 1, 5]), of(&[0, 5]), of(&[2, 3]), of(&[3, 7]), of(&[7]), ALL, ALL]
};
const SIGMA: f64 = 0.7;

fn smooth(a: f64, b: f64, x: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
fn normal(u1: f64, u2: f64) -> f64 {
    (-2.0 * (1.0 - u1).ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
}
/// Inverse-CDF Poisson draw from one uniform.
fn poisson(lambda: f64, u: f64) -> usize {
    let (mut p, mut cdf, mut n) = ((-lambda).exp(), 0.0, 0);
    loop {
        cdf += p;
        if u < cdf || n >= 1000 {
            return n;
        }
        n += 1;
        p *= lambda / n as f64;
    }
}

pub(super) fn draw(f: &ResourceFields, g: &Inputs<'_>, seed: u64, origin: (i64, i64)) -> Vec<Deposit> {
    let (nx, ny, b) = (f.nx, f.ny, f.cell);
    let size = nx * ny;
    let land = |k: usize| f.water[k] == 0;
    let rock = |k: usize| f.bedrock[k] as usize;
    let mut dist = crate::urban::par::range(3, |t| {
        let pred = |k: usize| match t {
            0 => rock(k) == 0,
            1 => rock(k) != 0,
            _ => rock(k) == 7,
        };
        nearest_seed(&(0..size).map(pred).collect::<Vec<_>>(), nx, ny, b).0
    });
    let (d_evap, d_other, d_granite) = (dist.pop().unwrap(), dist.pop().unwrap(), dist.pop().unwrap());
    // World centre of a block.
    let world = |k: usize| ((origin.0 + (k % nx) as i64) as f64 * b + 0.5 * b, (origin.1 + (k / nx) as i64) as f64 * b + 0.5 * b);
    let province = |name: &str, lod: i32| {
        let noise = ValueNoise::new(seed, &format!("deposit-{name}"), lod);
        move |k: usize| {
            let (wx, wy) = world(k);
            smooth(-0.3, 0.7, noise.at(wx, wy))
        }
    };
    let (iron_p, coal_p, hydro_p) = (province("ironstone", 6), province("coal", 7), province("hydrothermal", 6));
    let exposed = |k: usize| (1.0 - f.soil_depth[k] as f64 / 1.5).clamp(0.0, 1.0);
    let slope = |k: usize| g.slope[k];
    let precip = f.prior.precipitation as f64;
    let bog = f.potentials.get("bog_iron");
    let upstream = |k: usize, rocks: &[usize]| {
        let p = &g.provenance[k];
        let total: f64 = p.iter().map(|&v| v as f64).sum();
        if total <= 0.0 { 0.0 } else { rocks.iter().map(|&r| p[r] as f64).sum::<f64>() / total }
    };
    let prospect = |fam: usize, k: usize| -> f64 {
        if !land(k) || !HOST[fam][rock(k)] {
            return 0.0;
        }
        let r = rock(k);
        match fam {
            0 => bog[k] as f64,
            1 => (0.4 + 0.6 * exposed(k)) * iron_p(k),
            2 => {
                let contact = if r == 0 { (-(d_other[k] as f64) / 300.0).exp() } else { (-(d_granite[k] as f64) / 600.0).exp() };
                contact * hydro_p(k)
            }
            3 => {
                if r == 0 { (-(d_other[k] as f64) / 250.0).exp() } else { (-(d_granite[k] as f64) / 400.0).exp() }
            }
            4 => smooth(500.0, 1100.0, precip) * coal_p(k),
            5 => {
                let source = if r == 7 { 1.0 } else { (-(d_evap[k] as f64) / 800.0).exp() };
                source * (-(f.hand[k] as f64) / 15.0).exp()
            }
            6 => 0.3 + 0.7 * exposed(k),
            7 | 8 => {
                let share = if fam == 7 { upstream(k, &[0, 5]) } else { upstream(k, &[0]) };
                let bed = if g.channel[k] { 1.0 } else { f.alluvial[k] as f64 };
                smooth(0.15, 0.6, share) * bed * (-slope(k) / 4.0).exp() * smooth(0.5e6, 5.0e6, g.area[k])
            }
            _ => 0.0,
        }
    };
    // World extent of the blocks; the world cells it overlaps.
    let (ox, oy) = (origin.0 as f64 * b, origin.1 as f64 * b);
    let cs = cell_size(CELL_LOD);
    let cells_x = (ox / cs).floor() as i64..=((ox + nx as f64 * b) / cs).ceil() as i64 - 1;
    let cells_y = (oy / cs).floor() as i64..=((oy + ny as f64 * b) / cs).ceil() as i64 - 1;
    let families = crate::urban::par::range(FAMILIES.len(), |fam| {
        let (name, density, median_t, median_top) = FAMILIES[fam];
        let prefix = key(seed, &["resources", "deposits", name]);
        let lambda = density * cs * cs / 1.0e10;
        let mut out = Vec::new();
        for cj in cells_y.clone() {
            for ci in cells_x.clone() {
                let cell = cell_id(CELL_LOD, ci, cj);
                let n = poisson(lambda, unit(cell_key(prefix, cell, 0)));
                for d in 0..n as u64 {
                    let id = cell_key(prefix, cell, d + 1);
                    let u = |m: u64| unit(splitmix(id ^ m));
                    let (wx, wy) = ((ci as f64 + u(1)) * cs, (cj as f64 + u(2)) * cs);
                    let (bi, bj) = (((wx - ox) / b).floor(), ((wy - oy) / b).floor());
                    if bi < 0.0 || bj < 0.0 || bi >= nx as f64 || bj >= ny as f64 {
                        continue;
                    }
                    let k = bj as usize * nx + bi as usize;
                    if u(3) >= prospect(fam, k) {
                        continue;
                    }
                    let ore_t = (median_t * (SIGMA * normal(u(4), u(5))).exp()).round().max(1.0);
                    let top = (median_top * (0.5 * normal(u(6), u(7))).exp()).clamp(0.2, 60.0);
                    // Lens: thickness from the volume, then an ellipse of that area (minor/major 0.35-0.75).
                    let volume = ore_t / 2.5;
                    let thick = (0.1 * volume.cbrt()).clamp(0.5, 15.0);
                    let ratio = 0.35 + 0.4 * u(8);
                    let major = (volume / thick / (std::f64::consts::PI * ratio)).sqrt();
                    // Vertical extent: the lens plus its dip (half the minor axis).
                    let bottom = top + thick + 0.5 * major * ratio;
                    let reach = 40.0 + 0.5 * relief(g.height, nx, ny, k, (500.0 / b).ceil() as isize);
                    let reachable = ((reach - top) / (bottom - top)).clamp(0.0, 1.0);
                    out.push(Deposit {
                        id,
                        family: name,
                        x: wx - ox + f.x0,
                        y: wy - oy + f.y0,
                        ore_t,
                        depth_top_m: top as f32,
                        recoverable_t: (0.8 * reachable * ore_t).round(),
                        outcrop: top < 5.0,
                        axis_m: [major as f32, (major * ratio) as f32],
                        azimuth: f.structure_azimuth[k],
                    });
                }
            }
        }
        out.sort_by_key(|d| d.id);
        out
    });
    families.into_iter().flatten().collect()
}

/// Height range in a square window of `r` blocks around block `k`, m.
fn relief(h: &[f32], nx: usize, ny: usize, k: usize, r: isize) -> f64 {
    let (x, y) = ((k % nx) as isize, (k / nx) as isize);
    let (mut lo, mut hi) = (f32::MAX, f32::MIN);
    for yy in (y - r).max(0)..=(y + r).min(ny as isize - 1) {
        for xx in (x - r).max(0)..=(x + r).min(nx as isize - 1) {
            let v = h[yy as usize * nx + xx as usize];
            lo = lo.min(v);
            hi = hi.max(v);
        }
    }
    (hi - lo) as f64
}
