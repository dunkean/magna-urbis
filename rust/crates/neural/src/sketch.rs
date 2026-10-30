//! Cheap analytic sketches conditioning the coarse network.
//!
//! The coarse grid is 7.68 km: a sketch only places regional masses (plains,
//! hills, massifs, valleys, plateaus, shorelines), never local landforms.
//! Fields are continuous beyond the map because coarse windows see ~490 km.
use crate::plan::Plan;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Climate {
    /// Mean annual temperature at sea level, °C; 6 °C/km lapse rate above.
    pub temperature: f32,
    /// Temperature seasonality, °C × 100.
    pub temperature_std: f32,
    /// Annual precipitation, mm.
    pub precipitation: f32,
    /// Precipitation coefficient of variation, %.
    pub precipitation_cv: f32,
}

impl Climate {
    /// Fixed temperate climate of the validation study.
    pub const REFERENCE: Climate = Climate {
        temperature: 18.0,
        temperature_std: 600.0,
        precipitation: 1000.0,
        precipitation_cv: 35.0,
    };

    pub fn parse(name: &str) -> Result<Self, String> {
        Ok(match name {
            "temperate" => Self::REFERENCE,
            "oceanic" => Climate {
                temperature: 11.0,
                temperature_std: 450.0,
                precipitation: 1300.0,
                precipitation_cv: 25.0,
            },
            "mediterranean" => Climate {
                temperature: 16.0,
                temperature_std: 550.0,
                precipitation: 600.0,
                precipitation_cv: 60.0,
            },
            "arid" => Climate {
                temperature: 23.0,
                temperature_std: 800.0,
                precipitation: 150.0,
                precipitation_cv: 85.0,
            },
            "cold" => Climate {
                temperature: 1.0,
                temperature_std: 1100.0,
                precipitation: 550.0,
                precipitation_cv: 35.0,
            },
            "tropical" => Climate {
                temperature: 26.0,
                temperature_std: 150.0,
                precipitation: 2300.0,
                precipitation_cv: 50.0,
            },
            _ => return Err(format!("Climat inconnu : {name}")),
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Validation {
    Plain,
    WestCoast,
    NortheastMountains,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Family {
    Flat,
    Hills,
    Valley,
    Mountains,
    Mixed,
    Plateau,
    HighMountains,
}

impl Family {
    pub fn parse(name: &str) -> Result<Self, String> {
        Ok(match name {
            "flat" => Self::Flat,
            "hills" => Self::Hills,
            "valley" => Self::Valley,
            "mountains" => Self::Mountains,
            "mixed" => Self::Mixed,
            "plateau" => Self::Plateau,
            "high-mountains" => Self::HighMountains,
            _ => return Err(format!("Relief {name} non disponible en mode neuronal.")),
        })
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Islands {
    Island,
    Archipelago,
    /// One landmass tied to a single map edge by a narrow isthmus.
    Peninsula,
}

/// Seeded regional sketch of a square map of `extent` metres.
#[derive(Clone, Debug)]
pub struct Regional {
    pub family: Family,
    pub mix: f64,
    pub coast_mask: u8,
    pub islands: Islands,
    pub climate: Climate,
    pub extent: f64,
    /// Multiplies land elevations of the sketch (not sea depths).
    pub land_scale: f64,
    waves: [(f64, f64, f64); 3],
    axis: (f64, f64),
    offset: f64,
    shore: [f64; 8],
    isles: Vec<(f64, f64, f64)>,
    /// Seeded shoreline offset factor and turn (radians) per sea direction.
    reach: [(f64, f64); 8],
    /// Bays (negative) and capes (positive): centre, radius, amplitude in metres.
    gulfs: Vec<(f64, f64, f64, f64)>,
    /// Peninsula body (centre, radius) and isthmus (end on the edge, half-width).
    body: (f64, f64, f64),
    neck: (f64, f64, f64),
}

#[derive(Clone, Debug)]
pub enum Sketch {
    /// Local relief constraints generated from operation masks, before base inference.
    ReliefMap {
        resolution: usize,
        relief: Vec<f32>,
        strength: Vec<f32>,
        extent: f64,
        origin: (f64, f64),
        context: Box<Sketch>,
    },
    Validation(Validation),
    Regional(Box<Regional>),
    /// Edited cell-centred elevations over the map; regional context outside it.
    Grid {
        resolution: usize,
        heights: Vec<f64>,
        extent: f64,
        origin: (f64, f64),
        context: Box<Sketch>,
    },
}

/// SplitMix64: independent uniform parameters from the world seed.
struct Params(u64);
impl Params {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        ((z ^ (z >> 31)) >> 11) as f64 / (1u64 << 53) as f64
    }
    fn range(&mut self, a: f64, b: f64) -> f64 {
        a + (b - a) * self.next()
    }
}

fn smoothstep(a: f64, b: f64, x: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

impl Regional {
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        seed: u64,
        family: Family,
        mix: f64,
        coast_mask: u8,
        islands: &str,
        climate: Climate,
        extent: f64,
    ) -> Result<Self, String> {
        let mut p = Params(seed ^ 0x6D61_676E_6175_7262);
        let waves = std::array::from_fn(|_| {
            let angle = p.range(0.0, std::f64::consts::TAU);
            (
                angle,
                p.range(22000.0, 48000.0),
                p.range(0.0, std::f64::consts::TAU),
            )
        });
        let angle = p.range(0.0, std::f64::consts::TAU);
        let shore = std::array::from_fn(|_| p.range(0.0, std::f64::consts::TAU));
        let offset = p.range(-0.15, 0.15) * extent;
        let islands = match islands {
            "island" => Islands::Island,
            "archipelago" => Islands::Archipelago,
            "peninsula" => Islands::Peninsula,
            "random" => {
                if p.next() < 0.5 {
                    Islands::Island
                } else {
                    Islands::Archipelago
                }
            }
            _ => return Err(format!("Mode d’îles inconnu : {islands}")),
        };
        let isles = (0..5)
            .map(|k| {
                let a = k as f64 / 5.0 * std::f64::consts::TAU + p.range(-0.5, 0.5);
                let r = if k == 0 {
                    p.range(0.0, 0.12)
                } else {
                    p.range(0.22, 0.34)
                } * extent;
                (
                    extent * 0.5 + r * a.cos(),
                    extent * 0.5 + r * a.sin(),
                    p.range(0.09, 0.15) * extent,
                )
            })
            .collect();
        // A separate stream keeps the former draws (waves, axis, isles) per seed.
        let mut q = Params(seed ^ 0x636F_6173_7473_7632);
        let reach = std::array::from_fn(|_| (q.range(0.7, 1.5), q.range(-0.3, 0.3)));
        let gulfs = (0..2 + (q.next() * 4.0) as usize)
            .map(|k| {
                let a = q.range(0.0, std::f64::consts::TAU);
                let r = q.range(0.25, 0.5) * extent;
                let radius = if k == 0 {
                    q.range(7000.0, 14000.0)
                } else {
                    q.range(2500.0, 6000.0)
                };
                let sign = if q.next() < 0.55 { -1.0 } else { 1.0 };
                (
                    extent * 0.5 + r * a.cos(),
                    extent * 0.5 + r * a.sin(),
                    radius,
                    sign * radius * q.range(0.3, 0.6),
                )
            })
            .collect();
        let side = (q.next() * 4.0) as usize % 4;
        let (nx, ny) = [(0.0, -1.0), (1.0, 0.0), (0.0, 1.0), (-1.0, 0.0)][side];
        let along = q.range(-0.2, 0.2) * extent;
        let body_r = q.range(0.26, 0.33) * extent;
        let push = q.range(0.04, 0.1) * extent;
        let body = (
            extent * 0.5 - nx * push - ny * along * 0.4,
            extent * 0.5 - ny * push + nx * along * 0.4,
            body_r,
        );
        let neck = (
            extent * 0.5 + nx * extent * 0.6 - ny * along,
            extent * 0.5 + ny * extent * 0.6 + nx * along,
            q.range(3000.0, 4200.0),
        );
        Ok(Self {
            family,
            mix: mix.clamp(0.0, 1.0),
            coast_mask,
            islands,
            climate,
            extent,
            land_scale: 1.0,
            waves,
            axis: (angle.cos(), angle.sin()),
            offset,
            shore,
            isles,
            reach,
            gulfs,
            body,
            neck,
        })
    }

    /// Smooth seeded undulation in [-1, 1], continuous everywhere.
    fn undulation(&self, x: f64, y: f64) -> f64 {
        self.waves
            .iter()
            .map(|&(angle, wavelength, phase)| {
                ((x * angle.cos() + y * angle.sin()) / wavelength * std::f64::consts::TAU + phase)
                    .sin()
            })
            .sum::<f64>()
            / 3.0
    }

    fn land(&self, x: f64, y: f64) -> f64 {
        let u = self.undulation(x, y);
        let c = self.extent * 0.5;
        let (dx, dy) = (x - c, y - c);
        let along = dx * self.axis.0 + dy * self.axis.1;
        let across = -dx * self.axis.1 + dy * self.axis.0;
        match self.family {
            Family::Flat => 110.0 + 25.0 * u,
            Family::Hills => 380.0 + 170.0 * u,
            Family::Mountains => 1700.0 + 550.0 * u,
            Family::HighMountains => 2900.0 + 800.0 * u,
            Family::Mixed => {
                // Mountains cover about `mix` of the map, on a seeded side.
                let threshold = (1.0 - 2.0 * self.mix) * c;
                let w = smoothstep(threshold - 0.35 * c, threshold + 0.35 * c, along);
                (380.0 + 150.0 * u) * (1.0 - w) + (2000.0 + 500.0 * u) * w
            }
            Family::Valley => {
                let meander = across - self.offset - 3500.0 * (along / 21000.0).sin();
                let trough = (-(meander / 7000.0).powi(2)).exp();
                (1600.0 + 450.0 * u) * (1.0 - 0.82 * trough)
            }
            Family::Plateau => {
                // A broad table whose escarpment crosses the map on a seeded side.
                let (px, py) = (
                    dx - self.axis.0 * 0.3 * self.extent,
                    dy - self.axis.1 * 0.3 * self.extent,
                );
                let r = (px * px + py * py).sqrt() + 2500.0 * u;
                let table = 1.0 - smoothstep(0.38 * self.extent, 0.55 * self.extent, r);
                250.0 + 900.0 * table + 60.0 * u
            }
        }
    }

    /// Signed distance to the sea in metres, positive on land; `None` without coasts.
    fn shore_distance(&self, x: f64, y: f64) -> Option<f64> {
        if self.coast_mask == 0 {
            return None;
        }
        let c = self.extent * 0.5;
        let (dx, dy) = (x - c, y - c);
        if self.coast_mask == 255 && self.islands == Islands::Archipelago {
            return Some(
                self.isles
                    .iter()
                    .map(|&(ix, iy, r)| {
                        r + 1800.0 * self.undulation(x * 2.3, y * 2.3)
                            - ((x - ix).powi(2) + (y - iy).powi(2)).sqrt()
                    })
                    .fold(f64::NEG_INFINITY, f64::max),
            );
        }
        if self.coast_mask == 255 && self.islands == Islands::Peninsula {
            let (bx, by, br) = self.body;
            let (ex, ey, half) = self.neck;
            let (sx, sy) = (ex - bx, ey - by);
            let t = (((x - bx) * sx + (y - by) * sy) / (sx * sx + sy * sy)).clamp(0.0, 1.0);
            let bend = 1500.0 * self.undulation(x * 3.1, y * 3.1);
            let isthmus =
                half + bend * 0.5 - ((x - bx - t * sx).powi(2) + (y - by - t * sy).powi(2)).sqrt();
            let land = br + 2200.0 * self.undulation(x * 2.3, y * 2.3)
                - ((x - bx).powi(2) + (y - by).powi(2)).sqrt();
            return Some(land.max(isthmus));
        }
        let mut distance = f64::INFINITY;
        for k in 0..8 {
            if self.coast_mask & (1 << k) == 0 {
                continue;
            }
            // N, NE, E, SE, S, SW, W, NW with y pointing south; seeded offset and turn.
            let (scale, turn) = self.reach[k];
            let a = (k as f64) * std::f64::consts::FRAC_PI_4 - std::f64::consts::FRAC_PI_2 + turn;
            let (nx, ny) = (a.cos(), a.sin());
            let reach = if k % 2 == 0 { 0.2 } else { 0.32 } * self.extent * scale;
            let wobble = 2500.0 * ((-dx * ny + dy * nx) / 13000.0 + self.shore[k]).sin()
                + 2000.0 * self.undulation(x * 1.7 + 913.0, y * 1.7 - 377.0);
            let d = reach + wobble - (dx * nx + dy * ny);
            // Smooth union of the seas: rounded corners between two coasts.
            let h = (6000.0 - (distance - d).abs()).max(0.0) / 6000.0;
            distance = distance.min(d) - h * h * 1500.0;
        }
        for &(gx, gy, radius, amplitude) in &self.gulfs {
            let d2 = ((x - gx).powi(2) + (y - gy).powi(2)) / (radius * radius);
            if d2 < 1.0 {
                distance += amplitude * (1.0 - d2) * (1.0 - d2);
            }
        }
        Some(distance)
    }

    pub fn elevation(&self, x: f64, y: f64) -> f64 {
        let land = self.land(x, y) * self.land_scale;
        match self.shore_distance(x, y) {
            None => land,
            Some(d) if d >= 0.0 => land * (d / 8000.0).tanh(),
            Some(d) => -450.0 * (-d / 10000.0).tanh(),
        }
    }
}

fn validation(case: Validation, x: f64, y: f64) -> f64 {
    match case {
        Validation::Plain => 100.0 + 15.0 * (x / 18000.0).sin() * (y / 24000.0).cos(),
        Validation::WestCoast => {
            let shoreline = 11500.0 + 1400.0 * (y / 17000.0).sin();
            500.0 * ((x - shoreline) / 14000.0).tanh()
        }
        Validation::NortheastMountains => {
            120.0
                + 2500.0
                    * (-((x - 31000.0) / 15500.0).powi(2) - ((y - 9000.0) / 15500.0).powi(2)).exp()
        }
    }
}

impl Sketch {
    pub fn elevation(&self, x: f64, y: f64) -> f64 {
        match self {
            Sketch::ReliefMap { context, .. } => context.elevation(x, y),
            Sketch::Validation(case) => validation(*case, x, y),
            Sketch::Regional(sketch) => sketch.elevation(x, y),
            Sketch::Grid {
                resolution,
                heights,
                extent,
                origin,
                context,
            } => {
                let (x, y) = (x - origin.0, y - origin.1);
                let n = *resolution;
                let gx = (x / extent * n as f64 - 0.5).clamp(0.0, (n - 1) as f64);
                let gy = (y / extent * n as f64 - 0.5).clamp(0.0, (n - 1) as f64);
                let (x0, y0) = (gx.floor() as usize, gy.floor() as usize);
                let (x1, y1) = ((x0 + 1).min(n - 1), (y0 + 1).min(n - 1));
                let (tx, ty) = (gx - x0 as f64, gy - y0 as f64);
                let a = heights[y0 * n + x0] * (1.0 - tx) + heights[y0 * n + x1] * tx;
                let b = heights[y1 * n + x0] * (1.0 - tx) + heights[y1 * n + x1] * tx;
                let outside = (-x).max(x - extent).max(-y).max(y - extent).max(0.0);
                let t = (outside / 15360.0).clamp(0.0, 1.0);
                let blend = t * t * (3.0 - 2.0 * t);
                let height = a * (1.0 - ty) + b * ty;
                if outside == 0.0 {
                    return height;
                }
                if blend == 1.0 {
                    return context.elevation(x + origin.0, y + origin.1);
                }
                height * (1.0 - blend) + context.elevation(x + origin.0, y + origin.1) * blend
            }
        }
    }

    fn climate(&self) -> Climate {
        match self {
            Sketch::ReliefMap { context, .. } => context.climate(),
            Sketch::Validation(_) => Climate::REFERENCE,
            Sketch::Regional(sketch) => sketch.climate,
            Sketch::Grid { context, .. } => context.climate(),
        }
    }

    /// Five physical conditioning fields of a coarse window at cells `(y0, x0)`:
    /// signed √height, temperature, its seasonality, precipitation and its variability.
    pub fn fields(&self, plan: &Plan, y0: i64, x0: i64, size: usize) -> Vec<f32> {
        let plane = size * size;
        let climate = self.climate();
        let mut out = vec![0.0f32; 5 * plane];
        for i in 0..size {
            let y = plan.coarse_center_m(y0 + i as i64);
            for j in 0..size {
                let x = plan.coarse_center_m(x0 + j as i64);
                let z = self.elevation(x, y) as f32;
                let p = i * size + j;
                out[p] = z.signum() * z.abs().sqrt();
                out[plane + p] = climate.temperature - 0.006 * z.max(0.0);
                out[2 * plane + p] = climate.temperature_std;
                out[3 * plane + p] = climate.precipitation;
                out[4 * plane + p] = climate.precipitation_cv;
            }
        }
        out
    }
}
