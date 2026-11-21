//! Regional settlement points (ported from gen/settlements/planner.ts) and the road
//! network between them. Placement and routing are separate calls on one [`Terrain`]:
//! road options never move a settlement, and a moved settlement only reroutes.
//! No buildings or urban geometry are generated.
pub mod activities;
mod countryside;
pub mod demographics;
mod grid;
mod harbour;
pub mod installations;
pub mod nodes;
mod placement;
mod remote;
pub mod roads;

pub use harbour::HarbourReservation;
pub use magna_urbis_geom::Point;
use crate::urban::warnings;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

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
    /// Map's town layout engine (`classic` or `growth`).
    pub engine: String,
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
            engine: "classic".into(),
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub harbour_reservation: Option<HarbourReservation>,
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
        self.urban_quarters_with_sources(seed, sites, config, roads, &[])
    }

    /// Generate urban cuts from bridge streets with optional regional source stations.
    pub fn urban_quarters_with_roads(
        &self,
        seed: &str,
        sites: &[crate::urban::Site],
        config: &crate::urban::LayoutConfig,
        roads: Vec<crate::urban::LayoutRoad>,
    ) -> Result<Vec<crate::urban::Layout>, String> {
        let (streets, sources): (Vec<_>, Vec<_>) = roads
            .into_iter()
            .map(|road| (road.street, road.regional_source))
            .unzip();
        self.urban_quarters_with_sources(seed, sites, config, &streets, &sources)
    }

    fn urban_quarters_with_sources(
        &self,
        seed: &str,
        sites: &[crate::urban::Site],
        config: &crate::urban::LayoutConfig,
        roads: &[crate::urban::Street],
        sources: &[Option<magna_urbis_town::RoadSource>],
    ) -> Result<Vec<crate::urban::Layout>, String> {
        let r = &self.fields.r;
        let mut layouts = crate::urban::generate_quarters_with_sources(
            seed,
            sites,
            config,
            self.urban_surface(),
            roads,
            sources,
        )?;
        crate::urban::display::quay_water_levels(&mut layouts, r.width, r.n, &r.water, &r.water_level);
        // Underdark invariant: nothing stands on cave rock. The clip to the solid rock keeps every
        // block on the floor; a block that still reaches into the rock (a corner deep inside it)
        // is dropped here, whatever stage drew it, and the town says how many.
        if self.fields.cave.is_some() {
            let surface = self.urban_surface();
            let deep = |p: &Point| {
                [(0.0, 0.0), (1.0, 0.0), (-1.0, 0.0), (0.0, 1.0), (0.0, -1.0)]
                    .iter()
                    .all(|(dx, dy)| surface.solid(Point { x: p.x + dx, y: p.y + dy }))
            };
            for layout in &mut layouts {
                let before = layout.blocks.len();
                layout.blocks.retain(|b| !b.shape.outer.iter().any(deep));
                let removed = before - layout.blocks.len();
                if removed > 0 {
                    layout.warnings.push(warnings::cave_blocks_removed(removed));
                }
            }
        }
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
    /// Display blob of the building sites of `urban_building_sites_with_culture`
    /// (`urban::display::site_display_buffers`, same bytes), generated in chunks
    /// without holding every request.
    pub fn urban_building_site_display(
        &self,
        seed: &str,
        layouts: &[crate::urban::Layout],
        partitions: &[crate::urban::Partition],
        architecture_culture: Option<&str>,
        origin: crate::urban::Point,
        version: u32,
    ) -> Result<Vec<u8>, String> {
        let r = &self.fields.r;
        crate::urban::building_sites::display_buffers(
            seed,
            layouts,
            partitions,
            self.urban_surface(),
            &r.water_level,
            architecture_culture,
            origin,
            version,
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
        // Underdark: the cave rock is solid ground for the urban stage (the vector water alone
        // leaves it dry): a town, its blocks and lots stay on the open floor, a chamber smaller
        // than the plan reports its shortfall, and no quay or bridge takes the rock for water.
        let rock: Vec<Vec<crate::urban::Point>> = if self.fields.cave.is_some() {
            self.fields
                .rock_rings()
                .into_iter()
                .map(|ring| ring.into_iter().map(|[x, y]| crate::urban::Point { x, y }).collect())
                .collect()
        } else {
            vec![]
        };
        self.urban_geometry = Some(crate::urban::Geography::with_solid(input, rock, self.fields.r.width)?);
        Ok(())
    }
    pub fn place(&self, seed: &str, cfg: &Config) -> Result<Output, String> {
        validate(cfg, self.fields.r.width)?;
        let harbour_surface = (cfg.engine == "growth" && self.fields.cave.is_none())
            .then(|| self.urban_surface());
        let mut out = placement::place_on_terrain(seed, &self.fields, cfg, harbour_surface);
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
        // Safety net of the road chain, on the full-resolution terrain: no road over the sea or
        // a lake, no road end without a destination; what it removes is said in the warnings.
        roads::enforce(&self.fields, k as f64 * self.fields.cell, &mut out);
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
        || !["classic", "growth"].contains(&cfg.engine.as_str())
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

/// Underdark towns: the caps of every relaxed constraint, in one place. A town in the caves
/// spreads along the galleries and packs where floor is short; it keeps its population while
/// the floor it reaches within these caps can house it, and is lowered (announced) beyond.
/// Spread: a cave town grows along the galleries over at most this multiple of its ordinary
/// growth window, and placement counts the floor within this multiple of its land radius.
pub const CAVE_SPREAD: f64 = 2.0;
/// Densify: land per home down to this share of the culture's (lots, houses, blocks).
pub const CAVE_LAND_PER_HOME: f64 = 0.6;
/// Densify: building height up to this multiple of the culture's storeys.
pub const CAVE_HEIGHT: f64 = 1.5;

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
    fn edge_place_and_long_activity_approach_route_with_warnings() {
        let n = 32;
        let height = vec![10.0f32; n * n];
        let water = vec![0u8; n * n];
        let widths = vec![0.0f32; n * n];
        let ids = vec![-1i32; n * n];
        let width = 3200.0;
        let terrain = Terrain::new(Raster { width, n, height: &height, water: &water,
            water_level: &height, river_width: &widths, river_ids: &ids }).unwrap();
        let list = vec![
            SettlementSpec { key: "west".into(), population: 300, position: Some(Point { x: 600.0, y: 1600.0 }), ..Default::default() },
            SettlementSpec { key: "edge".into(), population: 300, position: Some(Point { x: width - 0.001, y: 1600.0 }), ..Default::default() },
        ];
        let out = terrain.place("edge", &Config { mode: "list".into(), list, ..Default::default() }).unwrap();
        let edge = out.settlements.iter().find(|s| s.spec.key == "edge").unwrap();
        assert!(edge.center.x <= width - 0.5 && edge.center.x > width - 1.0, "edge centre {:?}", edge.center);
        let mut sites: Vec<roads::RoadSite> = out.settlements.iter().map(|s| roads::RoadSite {
            key: s.spec.key.clone(), population: s.spec.population, center: s.center, radius: s.radius, ..Default::default()
        }).collect();
        let approach: Vec<Point> = (0..400).map(|k| Point { x: 1600.0, y: 400.0 + k as f64 * 2.0 }).collect();
        sites.push(roads::RoadSite { key: "mill".into(), population: 1, center: Point { x: 1600.0, y: 1200.0 },
            access: Some("track".into()), approach, ..Default::default() });
        sites.push(roads::RoadSite { key: "lost".into(), population: 1, center: Point { x: width + 5.0, y: 100.0 },
            access: Some("track".into()), ..Default::default() });
        let cfg = roads::RoadConfig { density: 0.0, exits: roads::ExitCounts::default(), activity_access: true, ..Default::default() };
        let routed = terrain.roads("edge", &sites, &cfg).expect("roads, not an error");
        assert!(!routed.segments.is_empty());
        assert!(routed.warnings.iter().any(|w| w.ends_with(" — route simplified")), "{:?}", routed.warnings);
        assert!(routed.warnings.iter().any(|w| w.contains("outside the map")), "{:?}", routed.warnings);
    }

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

    /// A 3000-inhabitant town in a 250 m cave chamber (cave rock: class 2 at ground level): with
    /// the vector geography the urban stage reads, every block stays on the open floor.
    #[test]
    fn underdark_town_in_a_small_chamber_keeps_its_blocks_on_floor() {
        let (n, width) = (64, 1600.0);
        let cell = width / n as f64;
        let mut height = vec![10.5f32; n * n];
        let mut water = vec![2u8; n * n];
        for y in 0..n {
            for x in 0..n {
                if ((x as f64 - 31.5).powi(2) + (y as f64 - 31.5).powi(2)).sqrt() <= 10.0 {
                    height[y * n + x] = 10.0;
                    water[y * n + x] = 0;
                }
            }
        }
        let widths = vec![0.0; n * n];
        let ids = vec![-1; n * n];
        let level: Vec<f32> = height.iter().zip(&water).map(|(&h, &w)| if w == 2 { h - 1000.0 } else { h }).collect();
        let mut terrain = Terrain::new(Raster { width, n, height: &height, water: &water,
            water_level: &level, river_width: &widths, river_ids: &ids }).unwrap();
        assert!(terrain.fields.cave.is_some());
        let square = vec![Point { x: 0.0, y: 0.0 }, Point { x: width, y: 0.0 },
            Point { x: width, y: width }, Point { x: 0.0, y: width }];
        terrain.set_urban_geometry(crate::urban::VectorGeography { land: vec![square], ..Default::default() }).unwrap();
        let site = crate::urban::Site { key: "main".into(), name: String::new(), population: 3000,
            culture: "drow-enclave".into(), center: Point { x: 800.0, y: 800.0 }, radius: extent_radius(3000),
            neighbours: Vec::new() };
        let layouts = terrain.urban_quarters("cave-town", &[site], &crate::urban::LayoutConfig::default(), &[]).unwrap();
        let blocks: Vec<_> = layouts.iter().flat_map(|l| &l.blocks).collect();
        assert!(!blocks.is_empty());
        // The rock is no water: no quay, pier or bridge in a chamber without any.
        let works: Vec<_> = layouts.iter().flat_map(|l| &l.streets)
            .filter(|s| matches!(s.role.as_str(), "quay" | "pier" | "landing" | "mole" | "bridge" | "causeway")).map(|s| &s.role).collect();
        assert!(works.is_empty(), "water works along cave walls: {works:?}");
        // An ordinary map has no cave: no spread, no packing.
        let open = vec![0u8; n * n];
        let plain = Terrain::new(Raster { width, n, height: &height, water: &open,
            water_level: &height, river_width: &widths, river_ids: &ids }).unwrap();
        assert!(plain.fields.cave.is_none());
        // A vertex may sit on the wall line; none lies inside the rock (all four cells around it rock).
        let floor = |x: f64, y: f64| {
            let (cx, cy) = ((x / cell).floor(), (y / cell).floor());
            cx >= 0.0 && cy >= 0.0 && cx < n as f64 && cy < n as f64 && water[cy as usize * n + cx as usize] == 0
        };
        for block in blocks {
            for p in &block.shape.outer {
                assert!([(-0.5, -0.5), (0.5, -0.5), (-0.5, 0.5), (0.5, 0.5)].iter().any(|(dx, dy)| floor(p.x + dx, p.y + dy)),
                    "block vertex {p:?} inside the rock");
            }
        }
    }

    /// A 5000-inhabitant town in a row of five 220 m chambers 750 m apart, joined by 94 m
    /// galleries: no chamber holds its plan, so it spreads along the galleries.
    #[test]
    fn underdark_town_spreads_over_chambers_joined_by_galleries() {
        let (n, width) = (128, 4000.0);
        let cell = width / n as f64;
        let centres = [16.0, 40.0, 64.0, 88.0, 112.0];
        let mut height = vec![10.5f32; n * n];
        let mut water = vec![2u8; n * n];
        for y in 0..n {
            for x in 0..n {
                let chamber = centres.iter().any(|&c| ((x as f64 - c).powi(2) + (y as f64 - 64.0).powi(2)).sqrt() <= 8.0);
                if chamber || ((16..=112).contains(&x) && (62..=66).contains(&y)) {
                    height[y * n + x] = 10.0;
                    water[y * n + x] = 0;
                }
            }
        }
        let widths = vec![0.0; n * n];
        let ids = vec![-1; n * n];
        let level: Vec<f32> = height.iter().zip(&water).map(|(&h, &w)| if w == 2 { h - 1000.0 } else { h }).collect();
        let mut terrain = Terrain::new(Raster { width, n, height: &height, water: &water,
            water_level: &level, river_width: &widths, river_ids: &ids }).unwrap();
        let square = vec![Point { x: 0.0, y: 0.0 }, Point { x: width, y: 0.0 },
            Point { x: width, y: width }, Point { x: 0.0, y: width }];
        terrain.set_urban_geometry(crate::urban::VectorGeography { land: vec![square], ..Default::default() }).unwrap();
        let centre = Point { x: 64.5 * cell, y: 64.5 * cell };
        let site = crate::urban::Site { key: "main".into(), name: String::new(), population: 5000,
            culture: "drow-enclave".into(), center: centre, radius: extent_radius(5000), neighbours: Vec::new() };
        let layouts = terrain.urban_quarters("cave-spread", &[site], &crate::urban::LayoutConfig::default(), &[]).unwrap();
        let blocks: Vec<_> = layouts.iter().flat_map(|l| &l.blocks).collect();
        let mid = |s: &crate::urban::Shape| Point {
            x: s.outer.iter().map(|p| p.x).sum::<f64>() / s.outer.len() as f64,
            y: s.outer.iter().map(|p| p.y).sum::<f64>() / s.outer.len() as f64,
        };
        let chambers: std::collections::BTreeSet<usize> = blocks.iter().filter_map(|b| {
            let m = mid(&b.shape);
            centres.iter().position(|&c| ((m.x / cell - 0.5 - c).powi(2) + (m.y / cell - 64.5).powi(2)).sqrt() <= 8.5)
        }).collect();
        assert!(chambers.len() >= 3, "blocks in chambers {chambers:?}");
        let floor = |x: f64, y: f64| {
            let (cx, cy) = ((x / cell).floor(), (y / cell).floor());
            cx >= 0.0 && cy >= 0.0 && cx < n as f64 && cy < n as f64 && water[cy as usize * n + cx as usize] == 0
        };
        for block in &blocks {
            for p in &block.shape.outer {
                assert!([(-0.5, -0.5), (0.5, -0.5), (-0.5, 0.5), (0.5, 0.5)].iter().any(|(dx, dy)| floor(p.x + dx, p.y + dy)),
                    "block vertex {p:?} inside the rock");
            }
        }
        // Every quarter is served: a street runs within 60 m of each block.
        let streets: Vec<Point> = layouts.iter().flat_map(|l| &l.streets).flat_map(|s| s.path.iter().copied()).collect();
        for block in &blocks {
            assert!(block.shape.outer.iter().any(|p| streets.iter().any(|q| p.distance(*q) <= 60.0)), "unserved block");
        }
        // A city of 20 000 in the same caves: not one block corner touches the rock (the town keeps
        // its one-cell margin from the walls), and the invariant pass had nothing to remove.
        let city = crate::urban::Site { key: "city".into(), name: String::new(), population: 20000,
            culture: "drow-enclave".into(), center: centre, radius: extent_radius(20000), neighbours: Vec::new() };
        let layouts = terrain.urban_quarters("cave-city", &[city], &crate::urban::LayoutConfig::default(), &[]).unwrap();
        let blocks: Vec<_> = layouts.iter().flat_map(|l| &l.blocks).collect();
        assert!(!blocks.is_empty());
        for block in &blocks {
            for p in &block.shape.outer {
                assert!([(-0.5, -0.5), (0.5, -0.5), (-0.5, 0.5), (0.5, 0.5)].iter().all(|(dx, dy)| floor(p.x + dx, p.y + dy)),
                    "city block vertex {p:?} touches the rock");
            }
        }
        assert!(!layouts.iter().flat_map(|l| &l.warnings).any(|w| w.ends_with(" — solid cave rock")));
    }
}
