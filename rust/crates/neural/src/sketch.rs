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
}

#[derive(Clone, Debug)]
pub enum Sketch {
    Validation(Validation),
    Regional(Box<Regional>),
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
        let mut distance = f64::INFINITY;
        for k in 0..8 {
            if self.coast_mask & (1 << k) == 0 {
                continue;
            }
            // N, NE, E, SE, S, SW, W, NW with y pointing south.
            let a = (k as f64) * std::f64::consts::FRAC_PI_4 - std::f64::consts::FRAC_PI_2;
            let (nx, ny) = (a.cos(), a.sin());
            let reach = if k % 2 == 0 { 0.2 } else { 0.32 } * self.extent;
            let wobble = 2500.0 * ((-dx * ny + dy * nx) / 13000.0 + self.shore[k]).sin();
            distance = distance.min(reach + wobble - (dx * nx + dy * ny));
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
            Sketch::Validation(case) => validation(*case, x, y),
            Sketch::Regional(sketch) => sketch.elevation(x, y),
        }
    }

    fn climate(&self) -> Climate {
        match self {
            Sketch::Validation(_) => Climate::REFERENCE,
            Sketch::Regional(sketch) => sketch.climate,
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
