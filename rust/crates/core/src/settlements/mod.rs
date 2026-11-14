//! Regional settlement points (ported from gen/settlements/planner.ts) and the road
//! network between them. Placement and routing are separate calls on one [`Terrain`]:
//! road options never move a settlement, and a moved settlement only reroutes.
//! No buildings or urban geometry are generated.
pub mod activities;
mod countryside;
pub mod demographics;
mod grid;
pub mod installations;
pub mod nodes;
mod placement;
mod remote;
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
    /// Retained for old saved configurations; sampling now considers all available land.
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
    /// Multiplies the dispersed farms of the countryside (1 ≈ 0.45 farms per km² of land, 0 = none).
    pub farm_density: f64,
    /// Frequency of the remote places (summit temples, cliff monasteries, lost ruins…): multiplies
    /// their number (1 ≈ one on 100 km² of land with dramatic ground, 0 = none).
    pub remote_places: f64,
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
            farm_density: 1.0,
            remote_places: 1.0,
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
    /// Diagnostic quality ranking uses one reference population per class band;
    /// selection samples all feasible candidates using the actual population.
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
    /// Territorial activity sites (mills, quarries…) tied to a parent settlement.
    #[serde(default)]
    pub activities: Vec<activities::ActivitySite>,
}
impl Output {
    /// Road endpoints: the settlements, then the access points of the activity sites
    /// (routed only with `RoadConfig::activity_access`).
    pub fn road_sites(&self) -> Vec<roads::RoadSite> {
        let places = self.settlements.iter().map(|s| roads::RoadSite {
            key: s.spec.key.clone(),
            population: s.spec.population,
            culture: s.spec.culture.clone(),
            center: s.center,
            radius: s.radius,
            ..Default::default()
        });
        // A remote place no path leads to (`none`) is not an endpoint: nothing is routed to it.
        let sites = self.activities.iter().filter(|a| a.access_class != "none").map(|a| roads::RoadSite {
            key: a.id.clone(),
            culture: a.culture.clone(),
            center: a.access,
            access: Some(a.access_class.clone()),
            parent: Some(a.parent.clone()),
            approach: remote::access_line(a).to_vec(),
            ..Default::default()
        });
        places.chain(sites).collect()
    }
}

/// The adapted terrain with its derived fields, computed once and shared by placement and routing.
pub struct Terrain {
    fields: grid::Fields,
    /// Authoritative physical metres; planning fields and wet routing retain their capped grid.
    physical_height: Option<Vec<f32>>,
    physical_interpolation: crate::urban::HeightInterpolation,
    urban_geometry: Option<crate::urban::Geography>,
    /// Pooled fields of the last coarser routing grid (block size, fields).
    route_fields: std::sync::Mutex<Option<(usize, std::sync::Arc<grid::Fields>)>>,
    region: crate::resources::RegionInput,
    resources: std::sync::OnceLock<crate::resources::ResourceFields>,
}
impl Terrain {
    fn urban_surface(&self) -> crate::urban::Surface<'_> {
        let r = &self.fields.r;
        crate::urban::Surface {
            geometry: self.urban_geometry.as_ref(),
            width: r.width,
            n: r.n,
            height: self.physical_height.as_deref().unwrap_or(&r.height),
            water: &r.water,
            interpolation: self.physical_interpolation,
        }
    }

    /// Install the full-extent, cell-centred physical height field. Water and
    /// routing masks remain on the planning grid to bound their memory use.
    pub fn set_physical_height(&mut self, n: usize, height: Vec<f32>) -> Result<(), String> {
        let size = n.checked_mul(n).ok_or("Invalid physical terrain resolution")?;
        if !(2..=8192).contains(&n)
            || size.checked_mul(std::mem::size_of::<f32>()).is_none_or(|bytes| bytes > 256 * 1024 * 1024)
            || height.len() != size
            || height.iter().any(|v| !v.is_finite())
        {
            return Err("Invalid physical terrain height field".into());
        }
        self.physical_height = Some(height);
        self.physical_interpolation = crate::urban::HeightInterpolation::PhysicalBilinear;
        Ok(())
    }

    pub fn set_physical_spline(&mut self, n: usize, height: Vec<f32>, floor: f32) -> Result<(), String> {
        if !floor.is_finite() { return Err("Invalid physical terrain floor".into()); }
        self.set_physical_height(n, height)?;
        self.physical_interpolation = crate::urban::HeightInterpolation::BSpline { floor };
        Ok(())
    }

    /// Uses the retained physical ground and wet/rock mask; no terrain regeneration.
    pub fn urban_quarters(
        &self,
        seed: &str,
        sites: &[crate::urban::Site],
        config: &crate::urban::LayoutConfig,
        roads: &[crate::urban::Street],
    ) -> Result<Vec<crate::urban::Layout>, String> {
        let r = &self.fields.r;
        let mut layouts = crate::urban::generate_quarters(
            seed,
            sites,
            config,
            self.urban_surface(),
            roads,
        )?;
        crate::urban::display::quay_water_levels(&mut layouts, r.width, r.n, &r.water, &r.water_level);
        Ok(layouts)
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
            self.urban_surface(),
            &r.water_level,
            architecture_culture,
        )
    }
    /// Sites `start..end` of `urban_building_sites_with_culture` (same order and
    /// bytes): independent ranges can run on separate engines and be concatenated.
    #[allow(clippy::too_many_arguments)]
    pub fn urban_building_sites_range(
        &self,
        seed: &str,
        layouts: &[crate::urban::Layout],
        partitions: &[crate::urban::Partition],
        architecture_culture: Option<&str>,
        start: usize,
        end: usize,
    ) -> Result<Vec<serde_json::Value>, String> {
        let r = &self.fields.r;
        crate::urban::building_sites::requests_range(
            seed,
            layouts,
            partitions,
            self.urban_surface(),
            &r.water_level,
            architecture_culture,
            start,
            end,
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
            self.urban_surface(),
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
            || !(250.0..=200000.0).contains(&raster.width)
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
            physical_height: None,
            physical_interpolation: crate::urban::HeightInterpolation::Bilinear,
            urban_geometry: None,
            route_fields: Default::default(),
            region: Default::default(),
            resources: Default::default(),
        })
    }
    /// Seed, climate, biome and world position of the map for the resource model.
    pub fn set_region(&mut self, region: crate::resources::RegionInput) {
        self.region = region;
        self.resources = Default::default();
    }
    /// Resource fields (prior, geology, soil), computed on first use and kept with the terrain.
    pub fn resources(&self) -> &crate::resources::ResourceFields {
        self.resources.get_or_init(|| {
            let r = &self.fields.r;
            crate::resources::compute(
                &self.region,
                crate::resources::Surface {
                    width: r.width,
                    n: r.n,
                    height: &r.height,
                    water: &r.water,
                    water_level: &r.water_level,
                },
            )
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
        let mut out = placement::place(seed, &self.fields, cfg);
        out.activities = activities::place(&out.settlements, self.resources(), &self.fields);
        // Rural places of worship, then the dispersed farms round every site already standing.
        let worship = countryside::worship(&out.settlements, &self.fields, &out.activities);
        out.activities.extend(worship);
        // Remote places on the dramatic ground of the region, before the farms fill the rest.
        if cfg.remote_places > 0.0 {
            let potentials = &self.resources().potentials;
            let potential = |id: &str, p: Point| if potentials.nx == 0 { 0.0 } else { potentials.sample(id, p.x, p.y) as f64 };
            let remote = remote::places(seed, &out.settlements, &self.fields, &potential, &out.activities, cfg.remote_places);
            out.activities.extend(remote);
        }
        let farms = countryside::farms(&out.settlements, self.resources(), &self.fields, &out.activities, cfg.farm_density);
        out.activities.extend(farms);
        Ok(out)
    }
    pub fn roads(
        &self,
        seed: &str,
        sites: &[roads::RoadSite],
        cfg: &roads::RoadConfig,
    ) -> Result<roads::RoadOutput, String> {
        let n = self.fields.r.n;
        // Smallest whole block bringing the grid within `cfg.grid` cells per side.
        let k = match cfg.grid {
            0 => 1,
            grid => (n.div_ceil(grid)..=n).find(|k| n % k == 0).unwrap_or(1),
        };
        let mut out = if k == 1 { roads::route(seed, &self.fields, sites, cfg)? } else { self.pooled_roads(k, seed, sites, cfg)? };
        // Network nodes read the finished network on the full-resolution terrain.
        if cfg.network_nodes {
            out.nodes = nodes::place(seed, &self.fields, sites, &out);
            let shrines = countryside::junctions(seed, &self.fields, sites, &out, &out.nodes);
            out.nodes.extend(shrines);
        }
        Ok(out)
    }
    fn pooled_roads(
        &self,
        k: usize,
        seed: &str,
        sites: &[roads::RoadSite],
        cfg: &roads::RoadConfig,
    ) -> Result<roads::RoadOutput, String> {
        let fields = {
            let mut cached = self
                .route_fields
                .lock()
                .map_err(|_| "Road grid unavailable")?;
            match cached.as_ref() {
                Some((size, fields)) if *size == k => fields.clone(),
                _ => {
                    let land = self.fields.r.pooled(k);
                    let fields = std::sync::Arc::new(grid::Fields::new(Raster {
                        width: land.width,
                        n: land.n,
                        height: &land.height,
                        water: &land.water,
                        water_level: &land.water_level,
                        river_width: &land.river_width,
                        river_ids: &land.river_ids,
                    }));
                    *cached = Some((k, fields.clone()));
                    fields
                }
            }
        };
        roads::route(seed, &fields, sites, cfg)
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
        cfg.farm_density,
        cfg.remote_places,
    ];
    if weights
        .iter()
        .chain(cfg.site_weights.values())
        .any(|v| !v.is_finite() || *v < 0.0 || *v > 100.0)
        || cfg.spread < 0.1
        || cfg.small_top > 1.0
        || cfg.density > 10.0
        || cfg.farm_density > 10.0
        || cfg.remote_places > 10.0
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
    demographics::class_of(pop)
}
fn smooth(v: f64, lo: f64, hi: f64) -> f64 {
    let t = ((v - lo) / (hi - lo)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[cfg(test)]
mod physical_tests {
    use super::*;

    #[test]
    fn retained_physical_ground_does_not_expand_planning_water() {
        let height = vec![12.0; 16 * 16];
        let water = vec![0; 16 * 16];
        let widths = vec![0.0; 16 * 16];
        let ids = vec![-1; 16 * 16];
        let mut terrain = Terrain::new(Raster { width: 250.0, n: 16,
            height: &height, water: &water, water_level: &height, river_width: &widths, river_ids: &ids }).unwrap();
        let mut physical = vec![30.0; 32 * 32];
        physical[10 * 32 + 10] = 80.0;
        terrain.set_physical_height(32, physical).unwrap();
        let surface = terrain.urban_surface();
        assert_eq!(surface.n, 16);
        assert_eq!(surface.water.len(), 16 * 16);
        assert_eq!(surface.height_resolution(), 32);
        assert_eq!(surface.height_at(Point { x: 10.5 * 250.0 / 32.0, y: 10.5 * 250.0 / 32.0 }), 80.0);
        assert!(terrain.set_physical_height(32, vec![f32::NAN; 32 * 32]).is_err());
    }
}
