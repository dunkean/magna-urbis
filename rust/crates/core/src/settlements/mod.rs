//! Regional settlement points (ported from gen/settlements/planner.ts) and the road
//! network between them. Placement and routing are separate calls on one [`Terrain`]:
//! road options never move a settlement, and a moved settlement only reroutes.
//! No buildings or urban geometry are generated.
mod grid;
mod placement;
pub mod roads;

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq)]
pub struct Point {
    pub x: f64,
    pub y: f64,
}
impl Point {
    fn distance(self, b: Self) -> f64 {
        (self.x - b.x).hypot(self.y - b.y)
    }
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SitePrefs {
    pub mountain_face: f64,
    pub woodland: f64,
    pub weights: BTreeMap<String, f64>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct SettlementSpec {
    pub key: String,
    pub name: String,
    pub population: u32,
    pub culture: String,
    pub kind: String,
    pub site_type: String,
    pub position: Option<Point>,
    pub site_prefs: SitePrefs,
}
impl Default for SettlementSpec {
    fn default() -> Self {
        Self {
            key: String::new(),
            name: String::new(),
            population: 300,
            culture: "medieval".into(),
            kind: "settlement".into(),
            site_type: "auto".into(),
            position: None,
            site_prefs: SitePrefs::default(),
        }
    }
}

/// Placement only. Roads have their own [`roads::RoadConfig`], so editing one never reruns the other.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct Config {
    /// auto | counts | list
    pub mode: String,
    /// Automatic composition: `zipf` (rank-size from the main population) or the legacy `classes` bands.
    pub distribution: String,
    pub main: SettlementSpec,
    pub counts: BTreeMap<String, usize>,
    pub list: Vec<SettlementSpec>,
    pub relief: String,
    /// Multiplies the automatic number of places (both distributions).
    pub density: f64,
    /// Rank-size exponent: population of rank r = main / r^q.
    pub zipf_exponent: f64,
    /// Rank-size stops below this population.
    pub min_population: u32,
    /// Log-normal spread around the rank-size curve (0 = exact law).
    pub population_jitter: f64,
    pub spread: f64,
    pub small_top: f64,
    pub main_clear: f64,
    /// Small places drawn towards larger ones (satellites), 0 = independent.
    pub clustering: f64,
    /// Border margin as a share of the map width.
    pub edge_margin: f64,
    pub flatness_weight: f64,
    pub buildable_weight: f64,
    pub fresh_water_weight: f64,
    pub river_weight: f64,
    pub coast_weight: f64,
    pub flood_weight: f64,
    /// Preference for prominent, defensible ground.
    pub defense_weight: f64,
    /// -1 lowlands … +1 high ground.
    pub elevation: f64,
    pub variation_weight: f64,
    /// Global multipliers on site archetypes (harbor, bridge, hilltop…), on top of culture preferences.
    pub site_weights: BTreeMap<String, f64>,
}
impl Default for Config {
    fn default() -> Self {
        Self {
            mode: "auto".into(),
            distribution: "classes".into(),
            main: SettlementSpec {
                key: "main".into(),
                population: 20000,
                ..Default::default()
            },
            counts: BTreeMap::new(),
            list: vec![],
            relief: "hills".into(),
            density: 1.0,
            zipf_exponent: 1.1,
            min_population: 8,
            population_jitter: 0.25,
            spread: 1.3,
            small_top: 0.35,
            main_clear: 2.5,
            clustering: 0.0,
            edge_margin: 0.03,
            flatness_weight: 1.0,
            buildable_weight: 1.0,
            fresh_water_weight: 1.0,
            river_weight: 1.0,
            coast_weight: 1.0,
            flood_weight: 1.0,
            defense_weight: 0.0,
            elevation: 0.0,
            variation_weight: 1.0,
            site_weights: BTreeMap::new(),
        }
    }
}

/// 0 dry, 1 sea, 2 lake/solid cavern rock, 3 river. River IDs are -1 off rivers.
pub struct Raster<'a> {
    pub width: f64,
    pub n: usize,
    pub height: &'a [f32],
    pub water: &'a [u8],
    pub water_level: &'a [f32],
    pub river_width: &'a [f32],
    pub river_ids: &'a [i32],
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Scores {
    pub total: f64,
    /// Legacy candidate ranking uses one reference population per class band.
    pub ranking_score: Option<f64>,
    pub candidate_rank: Option<usize>,
    pub ranking_population: Option<u32>,
    pub flatness: f64,
    pub buildable: f64,
    pub fresh_water: f64,
    pub river: f64,
    pub harbor: f64,
    pub flood: f64,
    pub culture: f64,
    /// Archetype weights (culture × global) for the site type of this cell.
    pub site: f64,
    pub defense: f64,
    pub elevation: f64,
    /// Attraction towards larger, already placed settlements.
    pub cluster: f64,
    pub variation: f64,
    pub buildable_fraction: f64,
    pub water_distance: f64,
    pub slope: f64,
    pub height_above_water: f64,
    pub spacing_relaxation: f64,
    pub manual: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settlement {
    #[serde(flatten)]
    pub spec: SettlementSpec,
    pub center: Point,
    pub cls: String,
    pub archetype: String,
    pub radius: f64,
    pub scores: Scores,
}
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Output {
    pub settlements: Vec<Settlement>,
    pub warnings: Vec<String>,
    pub requested: usize,
    pub usable_km2: f64,
}

/// The adapted terrain with its derived fields, computed once and shared by placement and routing.
pub struct Terrain {
    fields: grid::Fields,
    urban_geometry: Option<crate::urban::Geography>,
}
impl Terrain {
    /// Uses the retained physical ground and wet/rock mask; no terrain regeneration.
    pub fn urban_quarters(
        &self,
        seed: &str,
        sites: &[crate::urban::Site],
        config: &crate::urban::LayoutConfig,
        roads: &[crate::urban::Street],
    ) -> Result<Vec<crate::urban::Layout>, String> {
        let r = &self.fields.r;
        crate::urban::generate_quarters(
            seed,
            sites,
            config,
            crate::urban::Surface {
                geometry: self.urban_geometry.as_ref(),
                width: r.width,
                n: r.n,
                height: &r.height,
                water: &r.water,
            },
            roads,
        )
    }
    /// Physical placement intents from retained parcel/programme outputs.
    pub fn urban_building_sites(
        &self,
        seed: &str,
        layouts: &[crate::urban::Layout],
        partitions: &[crate::urban::Partition],
    ) -> Result<Vec<serde_json::Value>, String> {
        self.urban_building_sites_with_culture(seed, layouts, partitions, None)
    }
    pub fn urban_building_sites_with_culture(
        &self,
        seed: &str,
        layouts: &[crate::urban::Layout],
        partitions: &[crate::urban::Partition],
        architecture_culture: Option<&str>,
    ) -> Result<Vec<serde_json::Value>, String> {
        let r = &self.fields.r;
        crate::urban::building_sites::requests(
            seed,
            layouts,
            partitions,
            crate::urban::Surface {
                geometry: self.urban_geometry.as_ref(),
                width: r.width,
                n: r.n,
                height: &r.height,
                water: &r.water,
            },
            &r.water_level,
            architecture_culture,
        )
    }
    /// A bounded page from immutable retained city inputs. Preparation lives in
    /// `BuildingSiteIndex`; the terrain and its raster are borrowed only here.
    #[allow(clippy::too_many_arguments)]
    pub fn urban_building_sites_page(
        &self,
        index: &mut crate::urban::building_sites::BuildingSiteIndex,
        seed: &str,
        layouts: &[crate::urban::Layout],
        partitions: &[crate::urban::Partition],
        architecture_culture: Option<&str>,
        offset: usize,
        limit: usize,
        max_bytes: usize,
    ) -> Result<crate::urban::building_sites::SitePage, String> {
        let r = &self.fields.r;
        index.page(
            seed,
            layouts,
            partitions,
            crate::urban::Surface {
                geometry: self.urban_geometry.as_ref(),
                width: r.width,
                n: r.n,
                height: &r.height,
                water: &r.water,
            },
            &r.water_level,
            architecture_culture,
            offset,
            limit,
            max_bytes,
        )
    }
    pub fn new(raster: Raster<'_>) -> Result<Self, String> {
        let size = raster.n.checked_mul(raster.n).ok_or("Invalid raster")?;
        if !(16..=1024).contains(&raster.n)
            || !raster.width.is_finite()
            || !(250.0..=100000.0).contains(&raster.width)
            || [
                raster.height.len(),
                raster.water.len(),
                raster.water_level.len(),
                raster.river_width.len(),
                raster.river_ids.len(),
            ]
            .iter()
            .any(|&n| n != size)
            || raster
                .height
                .iter()
                .chain(raster.water_level)
                .chain(raster.river_width)
                .any(|v| !v.is_finite())
            || raster.water.iter().any(|&v| v > 3)
        {
            return Err("Invalid settlement terrain raster".into());
        }
        Ok(Self {
            fields: grid::Fields::new(raster),
            urban_geometry: None,
        })
    }
    pub fn set_urban_geometry(
        &mut self,
        input: crate::urban::VectorGeography,
    ) -> Result<(), String> {
        self.urban_geometry = Some(crate::urban::Geography::new(input, self.fields.r.width)?);
        Ok(())
    }
    pub fn place(&self, seed: &str, cfg: &Config) -> Result<Output, String> {
        validate(cfg, self.fields.r.width)?;
        Ok(placement::place(seed, &self.fields, cfg))
    }
    pub fn roads(
        &self,
        seed: &str,
        sites: &[roads::RoadSite],
        cfg: &roads::RoadConfig,
    ) -> Result<roads::RoadOutput, String> {
        roads::route(seed, &self.fields, sites, cfg)
    }
}

/// Placement in one call (tests and tools); the bench keeps a [`Terrain`] instead.
pub fn generate(seed: &str, raster: Raster<'_>, cfg: &Config) -> Result<Output, String> {
    Terrain::new(raster)?.place(seed, cfg)
}

fn validate(cfg: &Config, width: f64) -> Result<(), String> {
    let weights = [
        cfg.spread,
        cfg.small_top,
        cfg.main_clear,
        cfg.density,
        cfg.population_jitter,
        cfg.clustering,
        cfg.edge_margin,
        cfg.flatness_weight,
        cfg.buildable_weight,
        cfg.fresh_water_weight,
        cfg.river_weight,
        cfg.coast_weight,
        cfg.flood_weight,
        cfg.defense_weight,
        cfg.variation_weight,
    ];
    if weights
        .iter()
        .chain(cfg.site_weights.values())
        .any(|v| !v.is_finite() || *v < 0.0 || *v > 100.0)
        || cfg.spread < 0.1
        || cfg.small_top > 1.0
        || cfg.density > 10.0
        || cfg.population_jitter > 1.0
        || cfg.edge_margin > 0.3
        || !cfg.elevation.is_finite()
        || cfg.elevation.abs() > 1.0
        || !(0.3..=3.0).contains(&cfg.zipf_exponent)
        || !(1..=100_000).contains(&cfg.min_population)
        || cfg.list.len() > 1000
        || cfg.counts.values().any(|&n| n > 1000)
        || cfg.counts.values().copied().sum::<usize>() > 1000
        || !["auto", "counts", "list"].contains(&cfg.mode.as_str())
        || !["classes", "zipf"].contains(&cfg.distribution.as_str())
    {
        return Err("Invalid settlement generation parameters".into());
    }
    for spec in std::iter::once(&cfg.main).chain(&cfg.list) {
        if spec.population == 0
            || spec.population > 5_000_000
            || spec.position.is_some_and(|p| {
                !p.x.is_finite()
                    || !p.y.is_finite()
                    || p.x < 0.0
                    || p.y < 0.0
                    || p.x >= width
                    || p.y >= width
            })
            || spec
                .site_prefs
                .weights
                .values()
                .chain([&spec.site_prefs.mountain_face, &spec.site_prefs.woodland])
                .any(|v| !v.is_finite() || *v < 0.0 || *v > 10.0)
        {
            return Err("Invalid settlement properties or position".into());
        }
    }
    if cfg.mode == "list" {
        let mut keys = std::collections::HashSet::new();
        for s in &cfg.list {
            if s.key.is_empty() || !keys.insert(&s.key) {
                return Err("Settlement keys must be unique and nonempty".into());
            }
        }
    }
    Ok(())
}

pub fn extent_radius(pop: u32) -> f64 {
    let p = pop as f64;
    if p < 15.0 {
        45.0
    } else if p < 1000.0 {
        20.0 + 9.0 * p.sqrt()
    } else {
        20.0 + 9.0 * 1000.0_f64.sqrt() * (p / 1000.0).powf(0.4)
    }
}
pub fn class_spacing(pop: u32) -> f64 {
    const TABLE: [(f64, f64); 8] = [
        (5.0, 450.0),
        (40.0, 1000.0),
        (300.0, 2300.0),
        (1000.0, 3800.0),
        (3000.0, 9000.0),
        (20000.0, 15000.0),
        (100000.0, 24000.0),
        (1e6, 40000.0),
    ];
    let p = pop as f64;
    if p <= TABLE[0].0 {
        return TABLE[0].1;
    }
    for w in TABLE.windows(2) {
        let [(p0, d0), (p1, d1)] = [w[0], w[1]];
        if p <= p1 {
            return d0 * (d1 / d0).powf((p / p0).ln() / (p1 / p0).ln());
        }
    }
    TABLE[7].1
}
pub fn pair_spacing(a: u32, b: u32) -> f64 {
    class_spacing(a.min(b)) * (a.max(b) as f64 / a.min(b).max(1) as f64).powf(0.1)
}
pub fn extent_gap(a: u32, b: u32) -> f64 {
    let (a, b) = (extent_radius(a), extent_radius(b));
    a + b + 60.0 + 0.25 * a.max(b)
}
fn class_of(pop: u32) -> &'static str {
    match pop {
        0..15 => "farmstead",
        15..150 => "hamlet",
        150..1000 => "village",
        1000..20000 => "town",
        20000..100000 => "city",
        100000..1000000 => "metropolis",
        _ => "megacity",
    }
}
fn smooth(v: f64, lo: f64, hi: f64) -> f64 {
    let t = ((v - lo) / (hi - lo)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}
