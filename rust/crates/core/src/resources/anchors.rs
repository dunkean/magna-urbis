//! R5: activity anchors, the extraction/production points lot F turns into sites. Each
//! kind takes the local maxima of one potential above a threshold, keeps them by keyed
//! priority with an exclusion spacing (coastal salt: one per 12 km world box, 6 km apart,
//! Neural Earth §24.1), and gives them `annual_t = min(resource, labour, fuel)` and a
//! 12-month season mask from a monthly climate proxy at the anchor's altitude.
use super::deposits::{Deposit, FAMILIES};
use super::keys::{cell_id, cell_key, key, unit};
use super::potentials::Inputs;
use super::soil::nearest_seed;
use super::ResourceFields;
use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
pub struct ActivityAnchor {
    pub id: u64,
    pub kind: &'static str,
    /// Potential id (or deposit family for a mine) the anchor exploits.
    pub resource: &'static str,
    /// Map frame, m; always on dry land.
    pub x: f64,
    pub y: f64,
    pub potential: f32,
    pub annual_t: f32,
    /// Bit m = month m productive (bit 0 = January).
    pub season_mask: u16,
    /// Nearest dry, gentler point to connect to the road network.
    pub access: (f64, f64),
}

/// Monthly temperature (°C) and precipitation (mm) at `height` from the annual means:
/// a cosine around a July peak with a biome amplitude, rain shifted to winter or summer.
pub fn monthly(prior: &super::RegionPrior, height: f64) -> ([f64; 12], [f64; 12]) {
    let (amp, rain): (f64, f64) = match prior.biome.as_str() {
        "continental" | "steppe" => (13.0, 0.3),
        "desert" => (11.0, 0.0),
        "arctic" | "tundra" | "nordic" => (12.0, 0.3),
        "alpine" | "mountains" | "forest" => (9.0, 0.15),
        "mediterranean" => (8.0, -0.7),
        "tropical" => (2.0, 0.3),
        "savanna" => (3.0, 0.8),
        _ => (8.0, 0.0),
    };
    let t0 = prior.temperature as f64 - 0.0065 * height.max(0.0);
    let p0 = prior.precipitation as f64 / 12.0;
    let season = |m: usize| (std::f64::consts::TAU * (m as f64 - 6.0) / 12.0).cos();
    (std::array::from_fn(|m| t0 + amp * season(m)), std::array::from_fn(|m| p0 * (1.0 + rain * season(m))))
}
fn mask(f: impl Fn(usize) -> bool) -> u16 {
    (0..12).filter(|&m| f(m)).fold(0, |a, m| a | 1 << m)
}
/// Rough monthly PET (mm), warm months only.
fn pet(t: f64) -> f64 {
    (5.5 * t).max(0.0)
}

struct Kind {
    kind: &'static str,
    resource: &'static str,
    threshold: f32,
    spacing_m: f64,
    /// Resource cap per unit potential and labour cap, t/yr over a full year.
    resource_t: f32,
    labour_t: f32,
}
const fn k(kind: &'static str, resource: &'static str, threshold: f32, spacing_m: f64, resource_t: f32, labour_t: f32) -> Kind {
    Kind { kind, resource, threshold, spacing_m, resource_t, labour_t }
}
const KINDS: [Kind; 15] = [
    k("quarry", "stone_ashlar", 0.35, 2500.0, 1500.0, 600.0),
    k("quarry", "lime", 0.4, 2500.0, 1500.0, 600.0),
    k("quarry", "slate", 0.3, 2500.0, 800.0, 400.0),
    k("clay_pit", "clay", 0.35, 2000.0, 800.0, 300.0),
    k("peat_cut", "peat", 0.3, 2000.0, 600.0, 200.0),
    k("mill_seat", "water_power", 0.15, 1500.0, 400.0, 300.0),
    k("wind_knoll", "wind_exposure", 0.4, 2000.0, 200.0, 300.0),
    k("fishing_landing", "fish_coast", 0.4, 3000.0, 40.0, 25.0),
    k("fishing_landing", "fish_river", 0.45, 3000.0, 10.0, 8.0),
    k("logging", "timber", 0.45, 3000.0, 800.0, 400.0),
    k("charcoal", "wood", 0.55, 4000.0, 150.0, 100.0),
    k("pasture", "pasture", 0.2, 3000.0, 300.0, 1000.0),
    k("upland_pasture", "upland_pasture", 0.12, 3000.0, 200.0, 1000.0),
    k("hunting", "game", 0.5, 5000.0, 3.0, 5.0),
    k("salt", "salt_coast", 0.0, 6000.0, 0.0, 0.0),
];
const MAX_PER_KIND: usize = 40;

/// Strict 3x3 maximum (ties to the lowest index).
fn local_max(s: &[f32], nx: usize, ny: usize, k: usize) -> bool {
    let (x, y) = (k % nx, k / nx);
    for yy in y.saturating_sub(1)..=(y + 1).min(ny - 1) {
        for xx in x.saturating_sub(1)..=(x + 1).min(nx - 1) {
            let c = yy * nx + xx;
            if s[c] > s[k] || (s[c] == s[k] && c < k) {
                return false;
            }
        }
    }
    true
}

pub(super) fn place(f: &ResourceFields, g: &Inputs<'_>, deposits: &[Deposit], seed: u64, origin: (i64, i64)) -> Vec<ActivityAnchor> {
    let (nx, ny, b) = (f.nx, f.ny, f.cell);
    let size = nx * ny;
    let land = |k: usize| f.water[k] == 0;
    let centre = |k: usize| (f.x0 + ((k % nx) as f64 + 0.5) * b, f.y0 + ((k / nx) as f64 + 0.5) * b);
    let block_id = |k: usize| cell_id(f.lod, origin.0 + (k % nx) as i64, origin.1 + (k / nx) as i64);
    let (d_sea, _) = nearest_seed(&(0..size).map(|k| f.water[k] == 1).collect::<Vec<_>>(), nx, ny, b);
    let month_t = |k: usize| monthly(&f.prior, g.height[k] as f64);
    // Nearest dry block within 3 blocks (itself first), and its gentlest dry neighbour.
    let ring = |k: usize, r: isize| {
        let (x, y) = ((k % nx) as isize, (k / nx) as isize);
        let mut v = Vec::new();
        for yy in (y - r).max(0)..=(y + r).min(ny as isize - 1) {
            for xx in (x - r).max(0)..=(x + r).min(nx as isize - 1) {
                v.push(((xx - x).pow(2) + (yy - y).pow(2), yy as usize * nx + xx as usize));
            }
        }
        v
    };
    let dry = |k: usize| ring(k, 3).into_iter().filter(|&(_, c)| land(c)).min().map(|(_, c)| c);
    // A coastal anchor needs a real coast: >= 1.5 km of shoreline within 2 km and >= 2 km²
    // of sea within 3 km (a sea pocket or a sliver at the map edge holds no landing).
    let shore: Vec<bool> = (0..size)
        .map(|k| {
            let (x, y) = (k % nx, k / nx);
            land(k)
                && [(x > 0).then(|| k - 1), (x + 1 < nx).then(|| k + 1), (y > 0).then(|| k - nx), (y + 1 < ny).then(|| k + nx)]
                    .into_iter()
                    .flatten()
                    .any(|c| f.water[c] == 1)
        })
        .collect();
    let coast = |k: usize| {
        let (r2, r3) = ((2000.0 / b).ceil() as isize, (3000.0 / b).ceil() as isize);
        let shoreline = ring(k, r2).iter().filter(|&&(d2, c)| d2 <= r2 * r2 && shore[c]).count() as f64 * b;
        let sea = ring(k, r3).iter().filter(|&&(d2, c)| d2 <= r3 * r3 && f.water[c] == 1).count() as f64 * b * b;
        shoreline >= 1500.0 && sea >= 2.0e6
    };
    let access = |k: usize| {
        let best = ring(k, 2)
            .into_iter()
            .filter(|&(_, c)| land(c))
            .min_by(|a, c| (g.slope[a.1] + 2.0 * a.0 as f64).total_cmp(&(g.slope[c.1] + 2.0 * c.0 as f64)))
            .map_or(k, |(_, c)| c);
        centre(best)
    };
    let kinds = crate::urban::par::range(KINDS.len(), |s| {
        let spec = &KINDS[s];
        let mut out = Vec::new();
        let salt = spec.kind == "salt";
        let pot = f.potentials.get(spec.resource);
        // Score: the potential; coastal salt takes any low flat shore (boiled salt needs no sun).
        let score: std::borrow::Cow<[f32]> = if salt {
            (0..size)
                .map(|k| {
                    if !land(k) || d_sea[k] as f64 > 1.5 * b {
                        return 0.0;
                    }
                    ((-(g.height[k].max(0.0) as f64) / 6.0).exp() * (-g.slope[k] / 3.0).exp()) as f32
                })
                .collect::<Vec<_>>()
                .into()
        } else {
            pot.into()
        };
        let threshold = if salt { 0.25 } else { spec.threshold };
        let prefix = key(seed, &["resources", "anchors", spec.kind, spec.resource]);
        let mut cand: Vec<(f64, usize)> = (0..size)
            .filter(|&k| score[k] >= threshold)
            .filter(|&k| local_max(&score, nx, ny, k))
            .map(|k| (score[k] as f64 * (0.75 + 0.25 * unit(cell_key(prefix, block_id(k), 0))), k))
            .collect();
        cand.sort_by(|a, c| c.0.total_cmp(&a.0).then(a.1.cmp(&c.1)));
        let mut kept: Vec<(f64, f64)> = Vec::new();
        let mut boxes: Vec<(i64, i64)> = Vec::new();
        for &(_, k) in &cand {
            if kept.len() >= MAX_PER_KIND {
                break;
            }
            let Some(site) = dry(k) else { continue };
            let (x, y) = centre(site);
            if kept.iter().any(|&(px, py)| (px - x).hypot(py - y) < spec.spacing_m) {
                continue;
            }
            if (salt || spec.resource == "fish_coast") && !coast(site) {
                continue;
            }
            if salt {
                // One per 12 km world box.
                let wbox = (((x - f.x0) / b + origin.0 as f64) * b / 12000.0, ((y - f.y0) / b + origin.1 as f64) * b / 12000.0);
                let wbox = (wbox.0.floor() as i64, wbox.1.floor() as i64);
                if boxes.contains(&wbox) {
                    continue;
                }
                boxes.push(wbox);
            }
            let (t, p) = month_t(site);
            let u = unit(cell_key(prefix, block_id(site), 1));
            let (kind, potential, months, annual) = if salt {
                let warm_dry = mask(|m| t[m] >= 15.0 && p[m] < pet(t[m]));
                let basin = (-g.slope[site] / 1.5).exp() * (0.5 + 0.5 * f.clay[site].max(f.sand[site]) as f64);
                if warm_dry.count_ones() >= 2 && basin >= 0.25 {
                    // Solar: pans of ~20 ha x basin, 2.5 t/ha per warm dry month.
                    let annual = 2.5 * 20.0 * basin * warm_dry.count_ones() as f64;
                    ("salt_pan", basin as f32, warm_dry, annual as f32)
                } else {
                    let months = mask(|m| t[m] > 0.0 && m != 6 && m != 7);
                    let labour = (1.5 + 3.0 * u) * months.count_ones() as f64;
                    // Fuel: mobilisable wood (0.2 % of ~150 m³/ha) and peat (0.02 % of ~5000 m³/ha)
                    // within 3 km, 12 m³ wood or 20 m³ peat per tonne.
                    let r = (3000.0 / b).ceil() as isize;
                    let (wood, peat) = (f.potentials.get("wood"), f.potentials.get("peat"));
                    let ha = b * b / 1.0e4;
                    let (sw, sp) = ring(site, r).iter().filter(|&&(d2, c)| (d2 as f64) <= (r * r) as f64 && land(c)).fold((0.0, 0.0), |a, &(_, c)| {
                        (a.0 + wood[c] as f64 * ha * 150.0, a.1 + peat[c] as f64 * ha * 5000.0)
                    });
                    let fuel = 0.002 * sw / 12.0 + 0.0002 * sp / 20.0;
                    ("salt_boiling", score[k], months, labour.min(fuel) as f32)
                }
            } else {
                let months = match spec.kind {
                    "quarry" => mask(|m| t[m] > 2.0),
                    "clay_pit" => mask(|m| t[m] > 3.0),
                    "peat_cut" => mask(|m| t[m] >= 8.0),
                    "mill_seat" => mask(|m| t[m] > -2.0),
                    "wind_knoll" => 0xfff,
                    "fishing_landing" if spec.resource == "fish_coast" => mask(|m| t[m] > -2.0),
                    "fishing_landing" => mask(|m| t[m] > 0.0),
                    "logging" => {
                        // Felling in the cold months, else the four coldest.
                        let cold = mask(|m| t[m] < 5.0);
                        if cold != 0 {
                            cold
                        } else {
                            let mut o: Vec<usize> = (0..12).collect();
                            o.sort_by(|&a, &c| t[a].total_cmp(&t[c]));
                            o[..4].iter().fold(0, |a, &m| a | 1 << m)
                        }
                    }
                    "charcoal" => mask(|m| t[m] > 5.0),
                    "pasture" => mask(|m| t[m] > 5.0),
                    "upland_pasture" => mask(|m| t[m] >= 8.0),
                    "hunting" => mask(|m| !(2..8).contains(&m)),
                    _ => 0xfff,
                };
                let share = months.count_ones() as f32 / 12.0;
                let pk = pot[k];
                (spec.kind, pk, months, share * (pk * spec.resource_t).min(spec.labour_t))
            };
            if months == 0 || annual < 1.0 {
                continue;
            }
            kept.push((x, y));
            out.push(ActivityAnchor {
                id: cell_key(prefix, block_id(site), 0),
                kind,
                resource: spec.resource,
                x,
                y,
                potential,
                annual_t: annual,
                season_mask: months,
                access: access(site),
            });
        }
        out
    });
    let mut out: Vec<ActivityAnchor> = kinds.into_iter().flatten().collect();
    // One mine per accessible deposit: ~30-year life, a small crew's labour cap.
    for d in deposits.iter().filter(|d| d.recoverable_t > 0.0) {
        let k = f.index(d.x, d.y);
        let Some(site) = dry(k) else { continue };
        let fam = FAMILIES.iter().position(|e| e.0 == d.family).unwrap_or(0);
        let surface = matches!(fam, 0 | 7 | 8) || d.outcrop;
        let (t, _) = month_t(site);
        let months = if surface { mask(|m| t[m] > 2.0) } else { 0xfff };
        if months == 0 {
            continue;
        }
        let share = months.count_ones() as f64 / 12.0;
        let labour = if surface { 150.0 } else { 300.0 };
        out.push(ActivityAnchor {
            id: d.id,
            kind: "mine",
            resource: d.family,
            x: d.x,
            y: d.y,
            potential: (d.recoverable_t / d.ore_t) as f32,
            annual_t: (share * (d.recoverable_t / 30.0).min(labour)) as f32,
            season_mask: months,
            access: access(site),
        });
    }
    out
}
