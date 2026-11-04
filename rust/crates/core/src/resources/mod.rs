//! Natural resources of the map on a coarse block grid, at the contract of Neural
//! Earth (docs/ressources_transfert_neural_earth.md): R0 regional prior, R1 addressed
//! randomness, R2 realised geology and soil/terrain fields. Blocks are cells of the
//! Neural Earth lattice (60, 120 or 240 m, world-aligned), not DEM cells.
pub mod anchors;
pub mod deposits;
pub mod export;
mod geology;
pub mod keys;
pub mod potentials;
mod prior;
mod soil;

pub use anchors::ActivityAnchor;
pub use deposits::Deposit;
pub use geology::{HARDNESS, TEXTURE, WEATHERABILITY};
pub use potentials::Potentials;
pub use prior::{RegionInput, RegionPrior, ROCKS};

/// The DEM the resource grid is derived from (map frame, origin upper left).
pub struct Surface<'a> {
    pub width: f64,
    pub n: usize,
    pub height: &'a [f32],
    /// 0 dry, 1 sea, 2 lake (above ground) or cavern rock, 3 river.
    pub water: &'a [u8],
    pub water_level: &'a [f32],
}

pub struct ResourceFields {
    pub nx: usize,
    pub ny: usize,
    /// Block side (m) and its Neural Earth LOD.
    pub cell: f64,
    pub lod: i32,
    /// Map-frame position of the grid's upper-left corner (<= 0: blocks are world-aligned).
    pub x0: f64,
    pub y0: f64,
    pub prior: RegionPrior,
    /// 0 land, 1 sea, 2 lake, 3 river.
    pub water: Vec<u8>,
    /// Realised rock class, [`ROCKS`] order.
    pub bedrock: Vec<u8>,
    pub hardness: Vec<f32>,
    /// Degrees clockwise from north, [0, 180).
    pub structure_azimuth: Vec<f32>,
    /// Height above the drainage reached along the flow graph, m.
    pub hand: Vec<f32>,
    pub twi: Vec<f32>,
    pub alluvial: Vec<f32>,
    pub colluvial: Vec<f32>,
    /// m.
    pub soil_depth: Vec<f32>,
    pub stoniness: Vec<f32>,
    pub clay: Vec<f32>,
    pub sand: Vec<f32>,
    pub moisture: Vec<f32>,
    pub organic: Vec<f32>,
    /// 1 very poorly … 4 well drained; 0 on water.
    pub drainage: Vec<u8>,
    /// R3 potentials (0-1 per block), see [`potentials::IDS`].
    pub potentials: Potentials,
    /// R4 small deposits and R5 activity anchors.
    pub deposits: Vec<Deposit>,
    pub anchors: Vec<ActivityAnchor>,
}

/// Every field of one block.
#[derive(Clone, Copy, Debug)]
pub struct ResourceSample {
    pub water: u8,
    pub bedrock: u8,
    pub hardness: f32,
    pub structure_azimuth: f32,
    pub hand: f32,
    pub twi: f32,
    pub alluvial: f32,
    pub colluvial: f32,
    pub soil_depth: f32,
    pub stoniness: f32,
    pub clay: f32,
    pub sand: f32,
    pub moisture: f32,
    pub organic: f32,
    pub drainage: u8,
}

impl ResourceFields {
    /// Block containing a map-frame point (clamped to the grid).
    pub fn index(&self, x: f64, y: f64) -> usize {
        let i = ((x - self.x0) / self.cell).floor().clamp(0.0, (self.nx - 1) as f64) as usize;
        let j = ((y - self.y0) / self.cell).floor().clamp(0.0, (self.ny - 1) as f64) as usize;
        j * self.nx + i
    }
    pub fn sample(&self, x: f64, y: f64) -> ResourceSample {
        let i = self.index(x, y);
        ResourceSample {
            water: self.water[i],
            bedrock: self.bedrock[i],
            hardness: self.hardness[i],
            structure_azimuth: self.structure_azimuth[i],
            hand: self.hand[i],
            twi: self.twi[i],
            alluvial: self.alluvial[i],
            colluvial: self.colluvial[i],
            soil_depth: self.soil_depth[i],
            stoniness: self.stoniness[i],
            clay: self.clay[i],
            sand: self.sand[i],
            moisture: self.moisture[i],
            organic: self.organic[i],
            drainage: self.drainage[i],
        }
    }
    /// Bilinear value of a continuous field between block centres.
    pub fn bilinear(&self, field: &[f32], x: f64, y: f64) -> f32 {
        let gx = ((x - self.x0) / self.cell - 0.5).clamp(0.0, (self.nx - 1) as f64);
        let gy = ((y - self.y0) / self.cell - 0.5).clamp(0.0, (self.ny - 1) as f64);
        let (i, j) = (gx.floor() as usize, gy.floor() as usize);
        let (i1, j1) = ((i + 1).min(self.nx - 1), (j + 1).min(self.ny - 1));
        let (tx, ty) = ((gx - i as f64) as f32, (gy - j as f64) as f32);
        let v = |i: usize, j: usize| field[j * self.nx + i];
        (v(i, j) * (1.0 - tx) + v(i1, j) * tx) * (1.0 - ty) + (v(i, j1) * (1.0 - tx) + v(i1, j1) * tx) * ty
    }
    /// Realised rock area shares over land blocks.
    pub fn rock_shares(&self) -> [f32; 8] {
        let mut count = [0usize; 8];
        let mut land = 0;
        for (i, &w) in self.water.iter().enumerate() {
            if w == 0 {
                count[self.bedrock[i] as usize] += 1;
                land += 1;
            }
        }
        count.map(|c| c as f32 / land.max(1) as f32)
    }
}

/// Block LOD for a DEM cell size: the finest of 60/120/240 m not finer than the DEM.
fn block_lod(cell: f64) -> i32 {
    if cell <= 60.0 {
        1
    } else if cell <= 120.0 {
        2
    } else {
        3
    }
}

pub fn compute(region: &RegionInput, s: Surface<'_>) -> ResourceFields {
    let seed = keys::seed_of(&region.seed);
    let prior = RegionPrior::synthesize(region);
    let dem = s.width / s.n as f64;
    let lod = block_lod(dem);
    let b = keys::cell_size(lod);
    let (bi0, bj0) = ((region.x / b).floor(), (region.y / b).floor());
    let nx = ((region.x + s.width) / b).ceil() as usize - bi0 as usize;
    let ny = ((region.y + s.width) / b).ceil() as usize - bj0 as usize;
    let (x0, y0) = (bi0 * b - region.x, bj0 * b - region.y);
    // Geology (world noise) and the DEM side (pooling, priority flood) are independent.
    enum Part {
        Rocks(Vec<geology::Rock>),
        Ground(soil::Blocks, (Vec<u32>, Vec<u32>)),
    }
    let mut parts = crate::urban::par::range(2, |k| {
        if k == 1 {
            let blocks = soil::pool(&s, nx, ny, b, x0, y0);
            let flow = soil::flood(&blocks, nx, ny);
            return Part::Ground(blocks, flow);
        }
        let window = [bi0 * b, bj0 * b, (bi0 + nx as f64) * b, (bj0 + ny as f64) * b];
        let geology = geology::Geology::new(seed, &prior, window);
        let rows = crate::urban::par::range(ny, |j| {
            (0..nx)
                .map(|i| geology.rock((bi0 + i as f64 + 0.5) * b, (bj0 + j as f64 + 0.5) * b))
                .collect::<Vec<_>>()
        });
        Part::Rocks(rows.into_iter().flatten().collect())
    });
    let (Some(Part::Ground(blocks, flow)), Some(Part::Rocks(rocks))) = (parts.pop(), parts.pop()) else {
        unreachable!()
    };
    soil::fields(blocks, flow, &rocks, prior, nx, ny, b, lod, x0, y0, seed, (bi0 as i64, bj0 as i64))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn surface_case(n: usize, width: f64) -> (Vec<f32>, Vec<u8>, Vec<f32>) {
        let cell = width / n as f64;
        let mut h = vec![0f32; n * n];
        let mut w = vec![0u8; n * n];
        for y in 0..n {
            for x in 0..n {
                let (px, py) = ((x as f64 + 0.5) * cell, (y as f64 + 0.5) * cell);
                h[y * n + x] = (40.0 + 30.0 * (px / 1900.0).sin() * (py / 2700.0).cos() + px / 200.0) as f32;
                if px < 400.0 {
                    w[y * n + x] = 1;
                    h[y * n + x] = -5.0;
                }
            }
        }
        let level = h.iter().map(|&v| v.max(0.0)).collect();
        (h, w, level)
    }

    /// Two overlapping windows of one world (shifted origins) realise identical geology
    /// on their common blocks, and the shares stay near the prior.
    #[test]
    fn windows_agree_on_overlap() {
        let (n, width) = (128, 12000.0);
        let (h, w, l) = surface_case(n, width);
        let surface = || Surface { width, n, height: &h, water: &w, water_level: &l };
        let region = |x: f64, y: f64| RegionInput { seed: "window".into(), x, y, ..Default::default() };
        let a = compute(&region(1000.0, -2000.0), surface());
        let b = compute(&region(4840.0, 1840.0), surface());
        assert_eq!(a.cell, b.cell);
        let mut compared = 0;
        for j in 0..a.ny {
            for i in 0..a.nx {
                // World block of `a`, looked up in `b`.
                let (wx, wy) = (1000.0 + a.x0 + (i as f64 + 0.5) * a.cell, -2000.0 + a.y0 + (j as f64 + 0.5) * a.cell);
                let (bx, by) = (wx - 4840.0, wy - 1840.0);
                if bx < 0.0 || by < 0.0 || bx >= width || by >= width {
                    continue;
                }
                let (ia, ib) = (j * a.nx + i, b.index(bx, by));
                assert_eq!(a.bedrock[ia], b.bedrock[ib]);
                assert_eq!(a.hardness[ia], b.hardness[ib]);
                assert_eq!(a.structure_azimuth[ia], b.structure_azimuth[ib]);
                compared += 1;
            }
        }
        assert!(compared > 1000, "{compared}");
        let noise = keys::ValueNoise::new(3, "probe", 4);
        assert_eq!(noise.at(12345.6, -789.0), keys::ValueNoise::new(3, "probe", 4).at(12345.6, -789.0));
    }

    /// R4/R5 are deterministic, deposits sit on their host rocks, anchors on dry land.
    #[test]
    fn deposits_and_anchors() {
        let (n, width) = (128, 12000.0);
        let (h, mut w, l) = surface_case(n, width);
        for y in 0..n {
            for x in 60..62 {
                w[y * n + x] = 3;
            }
        }
        let run = || {
            let surface = Surface { width, n, height: &h, water: &w, water_level: &l };
            compute(&RegionInput { seed: "sites".into(), biome: "desert".into(), ..Default::default() }, surface)
        };
        let (a, b) = (run(), run());
        assert!(!a.anchors.is_empty());
        let key = |r: &ResourceFields| {
            let d: Vec<_> = r.deposits.iter().map(|d| (d.id, d.x.to_bits(), d.ore_t.to_bits(), d.recoverable_t.to_bits())).collect();
            let s: Vec<_> = r.anchors.iter().map(|s| (s.id, s.kind, s.x.to_bits(), s.annual_t.to_bits(), s.season_mask)).collect();
            (d, s)
        };
        assert_eq!(key(&a), key(&b));
        for d in &a.deposits {
            let fam = deposits::FAMILIES.iter().position(|f| f.0 == d.family).unwrap();
            let k = a.index(d.x, d.y);
            assert!(deposits::HOST[fam][a.bedrock[k] as usize], "{} on {}", d.family, ROCKS[a.bedrock[k] as usize]);
            assert_eq!(a.water[k], 0);
        }
        for s in &a.anchors {
            assert_eq!(a.water[a.index(s.x, s.y)], 0, "{} on water", s.kind);
            assert_eq!(a.water[a.index(s.access.0, s.access.1)], 0);
            assert!(s.season_mask != 0 && s.season_mask < 1 << 12 && s.annual_t >= 1.0);
        }
    }

    /// Deposits are addressed by world cells: two windows of one world terrain hold the
    /// same deposits (id, family, world position, tonnage) away from their edges. Bog iron,
    /// salt springs and placers are left out: their prospectivity reads the drainage (HAND,
    /// moisture, upstream area), which each window routes to its own edges.
    #[test]
    fn deposits_do_not_depend_on_the_window() {
        let (n, width) = (256, 40000.0);
        let world = |ox: f64, oy: f64| {
            let cell = width / n as f64;
            let h: Vec<f32> = (0..n * n)
                .map(|i| {
                    let (x, y) = (ox + ((i % n) as f64 + 0.5) * cell, oy + ((i / n) as f64 + 0.5) * cell);
                    (60.0 + 40.0 * (x / 2300.0).sin() * (y / 3100.0).cos() + 15.0 * (x / 700.0 + y / 900.0).sin()) as f32
                })
                .collect();
            (h, vec![0u8; n * n])
        };
        let run = |ox: f64, oy: f64| {
            let (h, w) = world(ox, oy);
            let region = RegionInput { seed: "deposits".into(), biome: "desert".into(), x: ox, y: oy, ..Default::default() };
            let r = compute(&region, Surface { width, n, height: &h, water: &w, water_level: &h });
            let margin = 3000.0;
            let inside = |x: f64, y: f64| x >= 9600.0 + margin && y >= 7200.0 + margin && x < width - margin && y < width - margin;
            let mut v: Vec<_> = r
                .deposits
                .iter()
                .map(|d| (d.id, d.family, (d.x + ox).round() as i64, (d.y + oy).round() as i64, d.ore_t.to_bits()))
                .filter(|d| inside(d.2 as f64, d.3 as f64))
                .filter(|d| !matches!(d.1, "bog_iron" | "salt_spring" | "placer_au" | "placer_sn"))
                .collect();
            v.sort();
            (v, r.deposits.len())
        };
        let ((a, total), (b, _)) = (run(0.0, 0.0), run(9600.0, 7200.0));
        assert!(a.len() >= 3, "{} of {total}", a.len());
        assert_eq!(a, b);
    }

    /// Potentials stay in [0, 1], arable never sits on water, water power only on streams.
    #[test]
    fn potentials_in_range() {
        let (n, width) = (128, 12000.0);
        let (h, mut w, l) = surface_case(n, width);
        // A river along the valley floor and a lake.
        for y in 0..n {
            for x in 60..62 {
                w[y * n + x] = 3;
            }
        }
        for y in 20..30 {
            for x in 100..110 {
                w[y * n + x] = 2;
            }
        }
        let surface = Surface { width, n, height: &h, water: &w, water_level: &l };
        let r = compute(&RegionInput { seed: "potentials".into(), ..Default::default() }, surface);
        let p = &r.potentials;
        for id in potentials::IDS {
            let d = p.get(id);
            assert_eq!(d.len(), r.nx * r.ny, "{id}");
            assert!(d.iter().all(|v| (0.0..=1.0).contains(v)), "{id} out of range");
        }
        assert!(p.get("nope").is_empty() && p.sample("nope", 0.0, 0.0) == 0.0);
        let (arable, power) = (p.get("arable"), p.get("water_power"));
        assert!(arable.iter().any(|&v| v > 0.2), "no arable land");
        let mut powered = 0;
        for k in 0..r.nx * r.ny {
            if r.water[k] != 0 {
                assert_eq!(arable[k], 0.0, "arable on water");
            }
            if power[k] > 0.0 {
                powered += 1;
                assert!(r.water[k] == 3 || r.hand[k] == 0.0, "water power off a stream");
            }
        }
        assert!(powered > 0, "no water power on the river");
    }

    /// The wire payload carries one byte per block per raster and decodes consistently.
    #[test]
    fn payload_shape() {
        let (n, width) = (64, 8000.0);
        let (h, w, l) = surface_case(n, width);
        let r = compute(&RegionInput { seed: "payload".into(), ..Default::default() }, Surface { width, n, height: &h, water: &w, water_level: &l });
        let p = r.payload();
        let blocks = r.nx * r.ny;
        assert_eq!(p.fields.len(), 5 + potentials::IDS.len());
        let bytes = |s: &str| s.len() / 4 * 3 - s.bytes().rev().take_while(|&c| c == b'=').count();
        assert_eq!(bytes(&p.bedrock), blocks);
        assert_eq!(bytes(&p.water), blocks);
        assert!(p.fields.iter().all(|f| bytes(&f.data) == blocks));
        assert_eq!(p.deposits.len(), r.deposits.len());
        assert_eq!(p.anchors.len(), r.anchors.len());
        // 27 rasters x 4/3 bytes per block, plus the small lists.
        assert!(serde_json::to_string(&p).unwrap().len() < blocks * 37 + 2000 + (r.deposits.len() + r.anchors.len()) * 250);
    }
}
