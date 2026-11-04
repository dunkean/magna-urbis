//! R0: the regional parent of the tile. Synthesised here from the seed, the biome
//! and a few geological presets; a Neural Earth parent (LOD 10 shares interpolated
//! over the tile, plus its LOD 3 deposits) will replace `RegionPrior::synthesize`
//! without changing any consumer.
use super::keys::{key, seed_of, unit};
use serde::{Deserialize, Serialize};

pub const ROCKS: [&str; 8] = [
    "granite",
    "limestone",
    "sandstone",
    "marl",
    "basalt",
    "metamorphic",
    "ultrabasic",
    "evaporite",
];

/// Map-level inputs of the resource model (defaults: temperate, map at the world origin).
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct RegionInput {
    pub seed: String,
    /// Mean annual temperature at sea level, °C, and annual precipitation, mm.
    pub temperature: f32,
    pub precipitation: f32,
    /// V1 biome (`temperate`, `desert`…) or V2 climate zone (`alpine`, `wetland`…).
    pub biome: String,
    /// World position of the map's upper-left corner, m.
    pub x: f64,
    pub y: f64,
}
impl Default for RegionInput {
    fn default() -> Self {
        Self {
            seed: String::new(),
            temperature: 11.0,
            precipitation: 800.0,
            biome: "temperate".into(),
            x: 0.0,
            y: 0.0,
        }
    }
}

#[derive(Clone, Debug, Serialize)]
pub struct RegionPrior {
    /// Expected area shares of the eight rock classes ([`ROCKS`] order), summing to 1.
    pub rock_shares: [f32; 8],
    /// Geological preset (stand-in for the Neural Earth tectonic context).
    pub context: &'static str,
    pub temperature: f32,
    pub precipitation: f32,
    pub biome: String,
}

/// Presets after Neural Earth's `LITHOLOGY` rows (granite, limestone, sandstone, marl,
/// basalt, metamorphic, ultrabasic, evaporite).
const PRESETS: [(&str, [f32; 8]); 8] = [
    ("granite-shield", [0.45, 0.03, 0.10, 0.04, 0.08, 0.30, 0.0, 0.0]),
    ("limestone-basin", [0.03, 0.45, 0.20, 0.26, 0.02, 0.02, 0.0, 0.02]),
    ("basalt-plateau", [0.03, 0.04, 0.06, 0.07, 0.80, 0.0, 0.0, 0.0]),
    ("clay-delta", [0.02, 0.14, 0.30, 0.50, 0.02, 0.01, 0.0, 0.01]),
    ("metamorphic-belt", [0.22, 0.14, 0.13, 0.10, 0.02, 0.38, 0.01, 0.0]),
    ("sandstone-plateau", [0.05, 0.10, 0.50, 0.15, 0.12, 0.03, 0.0, 0.05]),
    ("volcanic-arc", [0.25, 0.05, 0.15, 0.10, 0.40, 0.05, 0.0, 0.0]),
    ("ophiolite", [0.02, 0.06, 0.06, 0.13, 0.38, 0.10, 0.25, 0.0]),
];

/// Preset draw weights (PRESETS order) and per-rock multipliers for a biome.
fn biome_bias(biome: &str) -> ([f32; 8], [f32; 8]) {
    let one = [1.0; 8];
    match biome {
        "desert" => ([0.5, 1.6, 0.6, 0.3, 0.5, 2.2, 0.6, 0.2], [1.0, 1.2, 1.5, 0.7, 1.0, 1.0, 1.0, 3.0]),
        "steppe" => ([1.0, 1.4, 0.8, 0.6, 0.8, 1.6, 0.5, 0.3], [1.0, 1.1, 1.3, 1.1, 1.0, 1.0, 1.0, 2.0]),
        "savanna" => ([1.8, 0.6, 1.4, 0.6, 0.6, 1.2, 0.8, 0.3], [1.2, 1.0, 1.0, 1.0, 1.1, 1.0, 1.0, 1.0]),
        "tropical" => ([1.2, 0.8, 1.6, 1.0, 0.5, 0.8, 1.2, 0.4], [1.1, 1.0, 1.0, 1.0, 1.2, 1.0, 1.0, 0.3]),
        "mediterranean" => ([0.6, 2.2, 0.8, 0.8, 1.2, 0.8, 0.8, 0.6], [1.0, 1.5, 1.0, 1.0, 1.0, 1.0, 1.0, 1.0]),
        "alpine" | "mountains" => ([1.0, 1.0, 0.4, 0.3, 2.4, 0.5, 0.8, 0.8], [1.0, 1.2, 1.0, 0.8, 1.0, 1.6, 1.0, 1.0]),
        "arctic" | "tundra" | "nordic" => ([2.4, 0.5, 0.6, 0.5, 1.4, 0.4, 0.4, 0.5], [1.4, 0.8, 1.0, 0.6, 1.0, 1.4, 1.0, 0.5]),
        "wetland" => ([0.4, 1.4, 0.4, 2.6, 0.6, 0.6, 0.4, 0.2], [1.0, 1.1, 1.0, 1.6, 1.0, 1.0, 1.0, 1.0]),
        "continental" | "forest" => ([1.4, 1.4, 0.6, 0.8, 1.0, 1.0, 0.6, 0.3], [1.0, 1.0, 1.1, 1.0, 1.0, 1.0, 1.0, 1.0]),
        _ => ([1.0, 1.6, 0.6, 1.0, 1.0, 1.0, 0.6, 0.3], one),
    }
}

impl RegionPrior {
    pub fn synthesize(input: &RegionInput) -> Self {
        let seed = seed_of(&input.seed);
        let (weights, multipliers) = biome_bias(&input.biome);
        let total: f32 = weights.iter().sum();
        let mut pick = unit(key(seed, &["resources", "prior", "preset"])) as f32 * total;
        let mut preset = PRESETS.len() - 1;
        for (k, w) in weights.iter().enumerate() {
            if pick < *w {
                preset = k;
                break;
            }
            pick -= w;
        }
        let (context, base) = PRESETS[preset];
        let mut shares = [0.0_f32; 8];
        for k in 0..8 {
            // A regional ±25 % jitter keeps two maps of one preset distinct.
            let jitter = (0.25 * (2.0 * unit(key(seed, &["resources", "prior", ROCKS[k]])) - 1.0)).exp();
            shares[k] = base[k] * multipliers[k] * jitter as f32;
        }
        if input.biome == "desert" {
            shares[7] += 0.04; // arid basins keep evaporites even on crystalline presets
        }
        let sum: f32 = shares.iter().sum();
        shares.iter_mut().for_each(|s| *s /= sum);
        Self {
            rock_shares: shares,
            context,
            temperature: input.temperature,
            precipitation: input.precipitation,
            biome: input.biome.clone(),
        }
    }
}
