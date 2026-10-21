//! External cadastral implantation. Metres, world x/y, physical z; no renderer
//! heights, clipping of buildings, cadastral mutation or new random placement.
use crate::catalogue::{Layout, catalogue};
use crate::engine::{
    ResolvedArchitecture, enrich_architecture, resolve_architecture, resolve_urban_architecture,
    volume_unit,
};
use crate::geometry::*;
use crate::model::*;
use magna_urbis_random::Rng;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ArchitectureCulture {
    pub culture: String,
    pub pack: String,
    pub mode: HistoricalMode,
    pub borrowing: Option<String>,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArchitectureFunction {
    Domestic,
    Mixed,
    Workshop,
    Warehouse,
    Collective,
    OpenSpace,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ArchitectureTypology {
    Common,
    Row,
    Courtyard,
    Compound,
    Detached,
}
fn typology(layout: Layout) -> ArchitectureTypology {
    match layout {
        Layout::Strip => ArchitectureTypology::Row,
        Layout::Courtyard
        | Layout::Peristyle
        | Layout::Atrium
        | Layout::IwanCourt
        | Layout::Siheyuan
        | Layout::Kancha
        | Layout::Ring => ArchitectureTypology::Courtyard,
        Layout::Single | Layout::Platform | Layout::Parallel | Layout::Bridge => {
            ArchitectureTypology::Detached
        }
        _ => ArchitectureTypology::Compound,
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ArchitectureAccess {
    pub id: String,
    pub segment: [Point; 2],
    pub kind: String,
    pub width_m: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ArchitectureNeighbor {
    pub id: String,
    pub footprint: Surface,
    pub height_m: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ArchitectureTerrain {
    pub origin: Point,
    pub ground_z_m: f64,
    pub gradient: [f64; 2],
    pub water_z_m: Option<f64>,
    pub max_foundation_step_m: f64,
    #[serde(default)]
    pub grid: Option<GroundGrid>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct GroundGrid {
    pub origin: Point,
    pub step_m: f64,
    pub width: usize,
    pub height: usize,
    pub elevations_m: Vec<f64>,
}
impl ArchitectureTerrain {
    fn ground(&self, p: Point) -> f64 {
        self.ground_z_m
            + (p.x - self.origin.x) * self.gradient[0]
            + (p.y - self.origin.y) * self.gradient[1]
    }
    fn foundation_bounds(&self, surface: &Surface) -> Result<(f64, f64, f64), String> {
        let Some(grid) = &self.grid else {
            let heights: Vec<_> = surface
                .iter()
                .flat_map(|p| p.outer.iter().map(|p| self.ground(*p)))
                .collect();
            return Ok((
                heights.iter().copied().fold(f64::INFINITY, f64::min),
                heights.iter().copied().fold(f64::NEG_INFINITY, f64::max),
                libm::atan(libm::hypot(self.gradient[0], self.gradient[1])).to_degrees(),
            ));
        };
        let b = bounds(surface);
        let max_x = grid.origin.x + (grid.width - 1) as f64 * grid.step_m;
        let max_y = grid.origin.y + (grid.height - 1) as f64 * grid.step_m;
        if b[0] < grid.origin.x - 1e-7
            || b[1] < grid.origin.y - 1e-7
            || b[2] > max_x + 1e-7
            || b[3] > max_y + 1e-7
        {
            return Err(
                "A structural footprint leaves the supplied physical terrain patch.".into(),
            );
        }
        let index = |coordinate: f64, origin: f64, limit: usize| {
            (((coordinate - origin) / grid.step_m).floor().max(0.) as usize).min(limit - 2)
        };
        let ix0 = index(b[0], grid.origin.x, grid.width);
        let ix1 = index(b[2], grid.origin.x, grid.width);
        let iy0 = index(b[1], grid.origin.y, grid.height);
        let iy1 = index(b[3], grid.origin.y, grid.height);
        let mut low = f64::INFINITY;
        let mut high = f64::NEG_INFINITY;
        let mut max_gradient = 0_f64;
        for y in iy0..=iy1 {
            for x in ix0..=ix1 {
                let ox = grid.origin.x + x as f64 * grid.step_m;
                let oy = grid.origin.y + y as f64 * grid.step_m;
                let cell = vec![Polygon {
                    outer: vec![
                        Point { x: ox, y: oy },
                        Point {
                            x: ox + grid.step_m,
                            y: oy,
                        },
                        Point {
                            x: ox + grid.step_m,
                            y: oy + grid.step_m,
                        },
                        Point {
                            x: ox,
                            y: oy + grid.step_m,
                        },
                    ],
                    holes: vec![],
                }];
                let clipped = intersection(surface, &cell);
                if area(&clipped) < 1e-9 {
                    continue;
                }
                let z00 = grid.elevations_m[y * grid.width + x];
                let z10 = grid.elevations_m[y * grid.width + x + 1];
                let z01 = grid.elevations_m[(y + 1) * grid.width + x];
                let z11 = grid.elevations_m[(y + 1) * grid.width + x + 1];
                let bu = z10 - z00;
                let bv = z01 - z00;
                let cross = z11 - z10 - z01 + z00;
                let uv = |p: Point| ((p.x - ox) / grid.step_m, (p.y - oy) / grid.step_m);
                let sample = |u: f64, v: f64| z00 + bu * u + bv * v + cross * u * v;
                for ring in clipped
                    .iter()
                    .flat_map(|p| std::iter::once(&p.outer).chain(p.holes.iter()))
                {
                    for (&a, &b) in ring
                        .iter()
                        .zip(ring.iter().cycle().skip(1))
                        .take(ring.len())
                    {
                        let (u, v) = uv(a);
                        let (u1, v1) = uv(b);
                        let du = u1 - u;
                        let dv = v1 - v;
                        let z = sample(u, v);
                        low = low.min(z);
                        high = high.max(z);
                        max_gradient = max_gradient.max(libm::hypot(
                            (bu + cross * v) / grid.step_m,
                            (bv + cross * u) / grid.step_m,
                        ));
                        // Bilinear interpolation restricted to a clipped polygon edge
                        // is quadratic. Include its exact internal extremum as well.
                        let qa = cross * du * dv;
                        let qb = bu * du + bv * dv + cross * (u * dv + v * du);
                        if qa.abs() > 1e-14 {
                            let t = -qb / (2. * qa);
                            if (0.0..1.0).contains(&t) {
                                let z = sample(u + du * t, v + dv * t);
                                low = low.min(z);
                                high = high.max(z);
                            }
                        }
                    }
                }
            }
        }
        if !low.is_finite() || !high.is_finite() {
            return Err("Physical terrain patch has no coverage under the footprint.".into());
        }
        Ok((low, high, libm::atan(max_gradient).to_degrees()))
    }
}
#[derive(Clone, Serialize, Deserialize)]
pub struct PlacementRequest {
    pub id: String,
    pub parcel_id: String,
    pub cadastral: Surface,
    pub buildable: Surface,
    pub reserves: Surface,
    #[serde(default)]
    pub roof_domain: Option<Surface>,
    #[serde(default)]
    pub placement_hint: Option<Surface>,
    pub accesses: Vec<ArchitectureAccess>,
    pub party_boundaries: Vec<[Point; 2]>,
    pub neighbors: Vec<ArchitectureNeighbor>,
    pub culture: ArchitectureCulture,
    pub function: ArchitectureFunction,
    #[serde(default)]
    pub typology: Option<ArchitectureTypology>,
    pub seed: String,
    pub terrain: ArchitectureTerrain,
    #[serde(default)]
    pub config: Option<HouseConfig>,
    #[serde(default)]
    pub occupation: Option<ArchitectureOccupation>,
    #[serde(default)]
    pub parcel_fit: Option<bool>,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct ArchitectureOccupation {
    pub coverage: f64,
    pub depth_m: f64,
    pub frontage_m: f64,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct PlacementBatchRequest {
    pub schema_version: String,
    pub requests: Vec<PlacementRequest>,
    #[serde(default)]
    pub settings: Option<PlacementBatchSettings>,
}
#[derive(Clone, Default, Serialize, Deserialize)]
pub struct PlacementBatchSettings {
    pub parcel_fit: Option<bool>,
    pub floors: Option<u32>,
    pub typology: Option<ArchitectureTypology>,
    pub house_config: Option<HouseConfig>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VolumeLevel {
    pub index: u32,
    pub footprint: Surface,
    pub z_m: f64,
    pub height_m: f64,
    #[serde(default)]
    pub materials: Option<MaterialSlots>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VolumeRoofMesh {
    pub vertices: Vec<Vertex3>,
    pub faces: Vec<VolumeRoofFace>,
    #[serde(default)]
    pub edges: Vec<RoofEdge>,
    #[serde(default)]
    pub groups: Vec<RoofGroup>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VolumeRoofFace {
    pub vertices: Vec<u32>,
    pub normal: [f64; 3],
    pub material: String,
    pub kind: RoofFaceKind,
    #[serde(default)]
    pub roof_group: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct VolumeFoundation {
    pub footprint: Surface,
    pub z_min_m: f64,
    pub z_max_m: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ArchitectureVolume {
    pub id: String,
    pub footprint: Surface,
    pub levels: Vec<VolumeLevel>,
    pub z_m: f64,
    pub wall_height_m: f64,
    pub roof_height_m: f64,
    pub roof_system: String,
    pub roof_pitch_deg: f64,
    pub overhang_m: f64,
    pub roof_spec: RoofSpec,
    pub materials: MaterialSlots,
    pub role: Role,
    pub envelope: crate::catalogue::Envelope,
    pub roof_mesh: VolumeRoofMesh,
    pub foundation: VolumeFoundation,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct PlacedBuilding {
    pub id: String,
    pub parcel_id: String,
    pub function: ArchitectureFunction,
    pub culture: ArchitectureCulture,
    pub recipe_id: String,
    pub variant_id: String,
    pub transform: Transform,
    pub ground_z_m: f64,
    pub footprint: Surface,
    pub roof_footprint: Surface,
    pub courtyards: Surface,
    pub circulation: Surface,
    pub entrance: Point,
    pub access_id: String,
    pub volumes: Vec<ArchitectureVolume>,
    pub structural_features: Vec<Feature>,
    #[serde(default)]
    pub structural_foundations: Vec<VolumeFoundation>,
    pub useful_area_m2: f64,
    pub domestic_units: u32,
    pub simplification: String,
    pub diagnostics: Vec<String>,
    pub resolved: ResolvedArchitecture,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct PlacementRefusal {
    pub id: String,
    pub parcel_id: String,
    pub code: String,
    pub message: String,
    pub attempts: usize,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct OpenSpace {
    pub id: String,
    pub parcel_id: String,
    pub surface: Surface,
}
#[derive(Clone, Serialize, Deserialize)]
pub struct PlacementBatch {
    pub schema_version: String,
    pub generator_version: String,
    pub buildings: Vec<PlacedBuilding>,
    pub refusals: Vec<PlacementRefusal>,
    pub open_spaces: Vec<OpenSpace>,
    #[serde(default)]
    pub materials: Vec<crate::catalogue::Material>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AdmissibilityProfile {
    pub recipe_id: String,
    pub pack: String,
    pub layout: Layout,
    pub role: Role,
    pub width_m: [f64; 2],
    pub depth_m: [f64; 2],
    pub floors: [u32; 2],
    pub eras: Vec<String>,
    pub minimum_domain_m: [f64; 2],
    pub minimum_access_width_m: f64,
    pub minimum_status: String,
    pub minimum_refusal: Option<String>,
    pub max_slope_deg: f64,
    pub requires_access: bool,
    pub party_walls: bool,
    pub provenance: String,
    pub confidence: String,
    pub slope_basis: String,
    pub party_wall_basis: String,
}
pub fn admissibility_profiles() -> Result<Vec<AdmissibilityProfile>, String> {
    #[derive(Deserialize)]
    struct Table {
        profiles: Vec<crate::admission::MinimumAdmissionProfile>,
    }
    let table: Table = serde_json::from_str(include_str!("../data/urban-admission.json"))
        .map_err(|e| format!("Invalid native urban admission table: {e}"))?;
    catalogue()?.recipes.iter().filter(|r| r.role.residential()).map(|r| {
        let p=&r.parameters;
        let minimum = table.profiles.iter().find(|m| m.recipe_id == r.id)
            .ok_or_else(|| format!("Missing native admission profile: {}", r.id))?;
        Ok(AdmissibilityProfile {
            recipe_id:r.id.clone(), pack:r.pack_id.clone(), layout:p.layout, role:r.role,
            width_m:p.width_m, depth_m:p.depth_m, floors:p.floors,
            eras:r.temporal.eras.clone(),
            minimum_domain_m:minimum.min_envelope_m,
            minimum_access_width_m:minimum.min_access_width_m,
            minimum_status:minimum.status.clone(), minimum_refusal:minimum.refusal.clone(),
            max_slope_deg:12., requires_access:true,
            party_walls:p.details.iter().any(|d| d=="party_walls"),
            provenance:"Catalogue ranges and native minimum default-bundle domain (roof, enclosure, supports and access), excluding solver clearance; placement still validates the resolved plan.".into(),
            confidence:r.confidence.clone(),
            slope_basis:"Current level-foundation solver limit, not a historical recipe claim; physical raster and foundation-step checks remain mandatory.".into(),
            party_wall_basis:"Recipe explicitly declares party_walls; does not certify a shared boundary in a supplied cadastre.".into(),
        })
    }).collect()
}

fn world_point(p: Point, t: &Transform) -> Point {
    let a = t.orientation_deg.to_radians();
    let c = libm::cos(a);
    let s = libm::sin(a);
    Point {
        x: t.origin.x + p.x * c - p.y * s,
        y: t.origin.y + p.x * s + p.y * c,
    }
}
fn world_surface(s: &Surface, t: &Transform) -> Surface {
    s.iter()
        .map(|p| Polygon {
            outer: p.outer.iter().map(|p| world_point(*p, t)).collect(),
            holes: p
                .holes
                .iter()
                .map(|r| r.iter().map(|p| world_point(*p, t)).collect())
                .collect(),
        })
        .collect()
}
fn contains(domain: &Surface, s: &Surface) -> bool {
    area(&difference(s, domain)) <= 0.0001_f64.max(area(s) * 1e-8)
}
/// Expand a real admitted rectangle, retaining its front edge and orientation.
/// A bounding box around a concave lot can be much wider than its usable body.
fn expanded_site_hint(hint: &Surface, domain: &Surface) -> Option<Surface> {
    let rect = hint.first().filter(|p| {
        p.outer.len() == 4
            && p.holes.is_empty()
            && p.outer.iter().all(|p| p.x.is_finite() && p.y.is_finite())
    })?;
    if hint.len() != 1 || !contains(domain, hint) {
        return None;
    }
    let a = rect.outer[0];
    let width = libm::hypot(rect.outer[1].x - a.x, rect.outer[1].y - a.y);
    let depth = libm::hypot(rect.outer[3].x - a.x, rect.outer[3].y - a.y);
    if width < 0.01 || depth < 0.01 {
        return None;
    }
    // Cadastral world edges are not on the architectural millimetre grid.
    // Re-snapping their origin/direction can put every trial outside its front.
    let u = Point {
        x: (rect.outer[1].x - a.x) / width,
        y: (rect.outer[1].y - a.y) / width,
    };
    let v = Point {
        x: (rect.outer[3].x - a.x) / depth,
        y: (rect.outer[3].y - a.y) / depth,
    };
    if (u.x * v.x + u.y * v.y).abs() > 1e-6 {
        return None;
    }
    if libm::hypot(
        rect.outer[2].x - rect.outer[1].x - rect.outer[3].x + a.x,
        rect.outer[2].y - rect.outer[1].y - rect.outer[3].y + a.y,
    ) > 0.001
    {
        return None;
    }
    let make = |e: [f64; 3]| {
        let at = |x: f64, y: f64| Point {
            x: a.x + u.x * x + v.x * y,
            y: a.y + u.y * x + v.y * y,
        };
        vec![Polygon {
            outer: vec![at(-e[0], 0.), at(e[1], 0.), at(e[1], e[2]), at(-e[0], e[2])],
            holes: vec![],
        }]
    };
    let mut extents = [0., width, depth];
    let mut limits = extents;
    for p in domain.iter().flat_map(|p| &p.outer) {
        let x = (p.x - a.x) * u.x + (p.y - a.y) * u.y;
        let y = (p.x - a.x) * v.x + (p.y - a.y) * v.y;
        limits[0] = limits[0].max(-x);
        limits[1] = limits[1].max(x);
        limits[2] = limits[2].max(y);
    }
    for axis in [2, 0, 1] {
        let (mut lo, mut hi) = (extents[axis], limits[axis]);
        for _ in 0..12 {
            let mut trial = extents;
            trial[axis] = (lo + hi) * 0.5;
            if contains(domain, &make(trial)) {
                lo = trial[axis];
            } else {
                hi = trial[axis];
            }
        }
        extents[axis] = lo;
    }
    Some(make(extents))
}
fn non_domestic(f: ArchitectureFunction) -> bool {
    matches!(
        f,
        ArchitectureFunction::Workshop
            | ArchitectureFunction::Warehouse
            | ArchitectureFunction::Collective
    )
}
/// A single nonzero overlay of native projected faces. Canonical winding avoids
/// interpreting underside faces as negative masks, and avoids accumulating tiny
/// shared-edge artifacts through sequential pairwise OGC overlays.
fn projected_roof_union(parts: &[Surface]) -> Surface {
    use geo::BooleanOps;
    use geo::algorithm::bool_ops::FillRule;
    let mut polygons: Surface = parts.iter().flatten().cloned().collect();
    for p in &mut polygons {
        if signed_area(&p.outer) < 0. {
            p.outer.reverse();
        }
        for hole in &mut p.holes {
            if signed_area(hole) > 0. {
                hole.reverse();
            }
        }
    }
    from_geo(&to_geo(&polygons).union_with_fill_rule(&geo::MultiPolygon(vec![]), FillRule::NonZero))
}
fn refusal(
    r: &PlacementRequest,
    code: &str,
    message: impl Into<String>,
    attempts: usize,
) -> PlacementRefusal {
    PlacementRefusal {
        id: r.id.clone(),
        parcel_id: r.parcel_id.clone(),
        code: code.into(),
        message: message.into(),
        attempts,
    }
}
fn valid_surface(surface: &Surface) -> bool {
    !surface.is_empty()
        && surface.iter().all(|p| {
            p.outer.len() >= 3
                && p.holes.iter().all(|ring| ring.len() >= 3)
                && p.outer
                    .iter()
                    .chain(p.holes.iter().flatten())
                    .all(|p| p.x.is_finite() && p.y.is_finite())
        })
        && area(surface) > 0.001
}

/// Broad phase only: exact surfaces remain authoritative. Large envelopes use
/// an overflow list rather than allocating an unbounded number of grid cells.
#[derive(Default)]
struct OccupationIndex {
    surfaces: Vec<Surface>,
    boxes: Vec<[f64; 4]>,
    cells: std::collections::BTreeMap<(i64, i64), Vec<usize>>,
    overflow: Vec<usize>,
}
impl OccupationIndex {
    fn keys(b: [f64; 4]) -> Option<Vec<(i64, i64)>> {
        if !b.iter().all(|v| v.is_finite()) {
            return None;
        }
        let [x0, y0, x1, y1] = b.map(|v| (v / 64.).floor() as i64);
        let width = x1 as i128 - x0 as i128 + 1;
        let height = y1 as i128 - y0 as i128 + 1;
        if width <= 0 || height <= 0 || width > 4096 || height > 4096 || width * height > 4096 {
            return None;
        }
        Some(
            (y0..=y1)
                .flat_map(|y| (x0..=x1).map(move |x| (x, y)))
                .collect(),
        )
    }
    fn insert(&mut self, surface: Surface) {
        if surface.is_empty() {
            return;
        }
        let b = bounds(&surface);
        let id = self.surfaces.len();
        if let Some(keys) = Self::keys(b) {
            for key in keys {
                self.cells.entry(key).or_default().push(id);
            }
        } else {
            self.overflow.push(id);
        }
        self.boxes.push(b);
        self.surfaces.push(surface);
    }
    fn local(&self, domain: &Surface) -> Surface {
        if !valid_surface(domain) {
            return vec![];
        }
        let b = bounds(domain);
        let mut ids: std::collections::BTreeSet<usize> = self.overflow.iter().copied().collect();
        if let Some(keys) = Self::keys(b) {
            for key in keys {
                if let Some(entries) = self.cells.get(&key) {
                    ids.extend(entries);
                }
            }
        } else {
            ids.extend(0..self.surfaces.len());
        }
        let surfaces = ids
            .into_iter()
            .filter(|&id| {
                let a = self.boxes[id];
                a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1]
            })
            .map(|id| self.surfaces[id].clone())
            .collect::<Vec<_>>();
        unite(&surfaces)
    }
}

pub fn place_batch(input: PlacementBatchRequest) -> Result<PlacementBatch, String> {
    if input.schema_version != "1" {
        return Err("Unsupported placement schema.".into());
    }
    let mut result = PlacementBatch {
        schema_version: "1".into(),
        generator_version: crate::GENERATOR_VERSION.into(),
        buildings: vec![],
        refusals: vec![],
        open_spaces: vec![],
        materials: catalogue()?.materials.clone(),
    };
    let mut occupied = OccupationIndex::default();
    let mut ids = std::collections::BTreeSet::new();
    for mut r in input.requests {
        if !ids.insert(r.id.clone()) {
            return Err("Duplicate placement identity.".into());
        }
        let mut explicit_house_config = false;
        let mut config_notice = None;
        if let Some(settings) = &input.settings {
            if let Some(fit) = settings.parcel_fit {
                r.parcel_fit = Some(fit);
            }
            if let Some(config) = &settings.house_config {
                if matches!(
                    r.function,
                    ArchitectureFunction::Domestic | ArchitectureFunction::Mixed
                ) {
                    if config.workshop.is_some()
                        && (config.mode != HistoricalMode::FantasyMix
                            || r.culture.mode != HistoricalMode::FantasyMix)
                    {
                        result.refusals.push(refusal(&r, "house_config_workshop_mode", "A free Houses workshop preset requires Fantasy mode both in its configuration and in the urban site; no mode or culture was changed.", 0));
                        continue;
                    }
                    if config.workshop.is_none() && config.pack != r.culture.pack {
                        result.refusals.push(refusal(&r, "house_config_pack_mismatch", "The Houses configuration belongs to another architectural pack; no cultural substitution was made.", 0));
                        continue;
                    }
                    if let (Some(control), Some(model)) = (settings.floors, config.overrides.floors)
                        && control != model
                    {
                        result.refusals.push(refusal(&r, "house_config_floor_conflict", "The urban floor control conflicts with the explicit Houses configuration; neither value was overwritten.", 0));
                        continue;
                    }
                    r.config = Some(config.clone());
                    explicit_house_config = true;
                } else {
                    config_notice = Some("The Houses configuration is scoped to domestic/mixed uses; this function retains its own programme configuration.".to_string());
                }
            }
            if let Some(floors) = settings.floors {
                r.config
                    .get_or_insert_with(HouseConfig::default)
                    .overrides
                    .floors = Some(floors);
            }
            if let Some(family) = settings.typology {
                r.typology = Some(family);
            }
        }
        if r.function == ArchitectureFunction::OpenSpace {
            result.open_spaces.push(OpenSpace {
                id: r.id,
                parcel_id: r.parcel_id,
                surface: r.cadastral,
            });
            continue;
        }
        let local = occupied.local(&r.cadastral);
        match place(&r, &local, explicit_house_config) {
            Ok(mut building) => {
                if let Some(notice) = config_notice {
                    building.diagnostics.push(notice);
                }
                if explicit_house_config {
                    building.diagnostics.push("Explicit Houses configuration reused; placement owns identity, count, parcel seed and rigid transform. Cultural/site admission remains authoritative.".into());
                }
                let mut parts = vec![
                    building.footprint.clone(),
                    building.courtyards.clone(),
                    building.circulation.clone(),
                ];
                parts.extend(
                    building
                        .structural_features
                        .iter()
                        .map(|f| f.surface.clone()),
                );
                occupied.insert(unite(&parts));
                result.buildings.push(building);
            }
            Err(reason) => result.refusals.push(reason),
        }
    }
    Ok(result)
}

fn local_occupation(
    occupied: &Surface,
    neighbors: &[ArchitectureNeighbor],
) -> Result<Surface, String> {
    if neighbors.iter().any(|n| {
        !area(&n.footprint).is_finite()
            || n.footprint.iter().any(|p| {
                p.outer.len() < 3
                    || p.holes.iter().any(|r| r.len() < 3)
                    || p.outer
                        .iter()
                        .chain(p.holes.iter().flatten())
                        .any(|p| !p.x.is_finite() || !p.y.is_finite())
            })
    }) {
        return Err("Supplied neighbor footprints must be finite polygon surfaces with their holes retained.".into());
    }
    let mut parts = vec![occupied.clone()];
    parts.extend(neighbors.iter().map(|n| n.footprint.clone()));
    Ok(unite(&parts))
}

fn place(
    r: &PlacementRequest,
    occupied: &Surface,
    explicit_house_config: bool,
) -> Result<PlacedBuilding, PlacementRefusal> {
    if r.occupation.as_ref().is_some_and(|o| {
        !o.coverage.is_finite()
            || o.coverage <= 0.
            || o.coverage > 1.
            || !o.depth_m.is_finite()
            || o.depth_m <= 0.
            || !o.frontage_m.is_finite()
            || o.frontage_m <= 0.
    }) {
        return Err(refusal(
            r,
            "invalid_occupation",
            "Occupation wishes require coverage in (0,1] and positive metric frontage/depth.",
            0,
        ));
    }
    if !valid_surface(&r.cadastral)
        || !valid_surface(&r.buildable)
        || !contains(&r.cadastral, &r.buildable)
    {
        return Err(refusal(
            r,
            "invalid_domain",
            "Buildable domain must be a finite part of the cadastral surface, with all holes retained.",
            0,
        ));
    }
    // Supplied previous-batch surfaces and same-batch occupation must have
    // identical union-area tolerance, including many individually tiny overlaps.
    let combined = if r.neighbors.is_empty() {
        None
    } else {
        match local_occupation(occupied, &r.neighbors) {
            Ok(surface) => Some(surface),
            Err(error) => return Err(refusal(r, "invalid_neighbor", error, 0)),
        }
    };
    let occupied = combined.as_ref().unwrap_or(occupied);
    let walk_domain = difference(&difference(&r.cadastral, &r.reserves), occupied);
    let terrain = &r.terrain;
    if !terrain.ground_z_m.is_finite()
        || !terrain.origin.x.is_finite()
        || !terrain.origin.y.is_finite()
        || terrain.water_z_m.is_some_and(|z| !z.is_finite())
        || !terrain.gradient.iter().all(|v| v.is_finite())
        || !terrain.max_foundation_step_m.is_finite()
        || terrain.max_foundation_step_m < 0.
    {
        return Err(refusal(
            r,
            "invalid_terrain",
            "Physical ground and foundation limits must be finite.",
            0,
        ));
    }
    if let Some(grid) = &terrain.grid
        && (grid.width < 2
            || grid.height < 2
            || grid.width > 4096
            || grid.height > 4096
            || grid.width.checked_mul(grid.height) != Some(grid.elevations_m.len())
            || !grid.step_m.is_finite()
            || grid.step_m <= 0.
            || !grid.origin.x.is_finite()
            || !grid.origin.y.is_finite()
            || !grid.elevations_m.iter().all(|z| z.is_finite()))
    {
        return Err(refusal(
            r,
            "invalid_ground_grid",
            "Physical terrain raster shape, samples or spacing are invalid.",
            0,
        ));
    }
    let slope = libm::atan(libm::hypot(terrain.gradient[0], terrain.gradient[1])).to_degrees();
    if terrain.grid.is_none() && slope > 12. {
        return Err(refusal(
            r,
            "slope_exceeded",
            format!(
                "Physical slope {slope:.2}° exceeds the current level-foundation limit of 12°."
            ),
            0,
        ));
    }
    if r.culture.mode == HistoricalMode::HistoricalStrict && r.culture.borrowing.is_some() {
        return Err(refusal(
            r,
            "cultural_borrowing",
            "Strict history does not permit an explicitly borrowed architectural family.",
            0,
        ));
    }
    let accesses: Vec<_> = r
        .accesses
        .iter()
        .filter(|a| {
            a.width_m >= 0.8
                && a.width_m.is_finite()
                && a.segment.iter().all(|p| p.x.is_finite() && p.y.is_finite())
                && libm::hypot(
                    a.segment[1].x - a.segment[0].x,
                    a.segment[1].y - a.segment[0].y,
                ) > 0.8
        })
        .collect();
    if accesses.is_empty() {
        return Err(refusal(
            r,
            "no_access",
            "No authorized entrance frontage of at least 0.8 m.",
            0,
        ));
    }
    let domain = difference(&r.buildable, &r.reserves);
    if !valid_surface(&domain) {
        return Err(refusal(
            r,
            "reserved_domain",
            "The buildable domain is entirely reserved.",
            0,
        ));
    }
    let data = catalogue().map_err(|e| refusal(r, "catalogue", e, 0))?;
    if !data.packs.iter().any(|p| p.id == r.culture.pack) {
        return Err(refusal(
            r,
            "unknown_culture_pack",
            "No explicit architecture pack mapping.",
            0,
        ));
    }
    let mut base = r.config.clone().unwrap_or_else(|| HouseConfig {
        size: 1.0,
        ..HouseConfig::default()
    });
    let workshop_source = explicit_house_config && base.workshop.is_some();
    if workshop_source {
        if base.mode != HistoricalMode::FantasyMix || r.culture.mode != HistoricalMode::FantasyMix {
            return Err(refusal(
                r,
                "house_config_workshop_mode",
                "A free Houses workshop preset and its urban site must explicitly use Fantasy mode.",
                0,
            ));
        }
    } else {
        base.pack = r.culture.pack.clone();
        base.mode = r.culture.mode;
    }
    base.seed = r.seed.clone();
    base.count = 1;
    base.orientation_deg = 0.;
    if base.workshop.is_some() && !workshop_source {
        return Err(refusal(
            r,
            "workshop_not_cultural",
            "Free workshop presets cannot silently replace a cultural recipe.",
            0,
        ));
    }
    // A user-supplied Houses model uses the autonomous resolver exactly once.
    // Site fitting, occupation wishes and canonical minima apply only to the
    // automatic cultural route, never to this retained native draw.
    let explicit_resolved = if explicit_house_config {
        Some(
            resolve_architecture(base.clone())
                .map_err(|e| refusal(r, "house_config_invalid", e, 0))?,
        )
    } else {
        None
    };
    if explicit_resolved.as_ref().is_some_and(|resolved| {
        r.typology.is_some_and(|family| {
            family != ArchitectureTypology::Common && typology(resolved.parameters.layout) != family
        })
    }) {
        return Err(refusal(
            r,
            "house_config_typology_mismatch",
            "The explicit native Houses model is incompatible with the requested typology; its layout was preserved.",
            0,
        ));
    }
    let anchor = base
        .recipe
        .as_ref()
        .and_then(|id| data.recipes.iter().find(|p| p.id == *id));
    let palette = !explicit_house_config
        && base.overrides.variant.is_none()
        && r.occupation.is_some()
        && anchor.is_some_and(|p| {
            (base.era == "any" || p.temporal.eras.contains(&base.era))
                && (!p.temporal.late_only || base.allow_late)
        });
    let palette_rng = Rng::new(&r.seed).fork("urban-recipe-palette");
    let parcel_fit = !explicit_house_config
        && r.parcel_fit.unwrap_or(
            r.occupation.is_some()
                && r.placement_hint.is_some()
                && base.overrides.variant.is_none(),
        );
    let fitted_hint = if parcel_fit {
        r.placement_hint
            .as_ref()
            .and_then(|hint| expanded_site_hint(hint, &domain))
    } else {
        None
    };
    let mut recipes: Vec<_> = data
        .recipes
        .iter()
        .filter(|p| {
            p.pack_id == r.culture.pack
                && p.role.residential()
                && r.typology.is_none_or(|family| {
                    family == ArchitectureTypology::Common
                        || typology(p.parameters.layout) == family
                })
                && (base.recipe.as_ref().is_none_or(|id| p.id == *id)
                    || palette
                        && anchor.is_some_and(|a| {
                            // Keep the selected cultural land family; a forced typology
                            // explicitly opens the matching family in the same pack.
                            (r.typology
                                .is_some_and(|t| t != ArchitectureTypology::Common)
                                || p.parameters.layout == a.parameters.layout)
                                && (base.era == "any" || p.temporal.eras.contains(&base.era))
                                && (!p.temporal.late_only || base.allow_late)
                        }))
                && explicit_resolved
                    .as_ref()
                    .is_none_or(|resolved| p.id == resolved.recipe_id)
        })
        .collect();
    recipes.sort_by(|a, b| {
        if palette {
            return palette_rng
                .fork(&a.id)
                .next_u32()
                .cmp(&palette_rng.fork(&b.id).next_u32())
                .then(a.id.cmp(&b.id));
        }
        // Prefer the pack's own common domestic plan. No text-name inference.
        let rank = |layout: Layout| match layout {
            Layout::Single | Layout::Strip => 0,
            Layout::Courtyard | Layout::Siheyuan | Layout::Kancha => 1,
            _ => 2,
        };
        rank(a.parameters.layout)
            .cmp(&rank(b.parameters.layout))
            .then(
                (a.parameters.width_m[0] * a.parameters.depth_m[0])
                    .total_cmp(&(b.parameters.width_m[0] * b.parameters.depth_m[0])),
            )
            .then(a.id.cmp(&b.id))
    });
    let mut attempts = 0;
    let mut hint_progress = [0u32; 6];
    let mut hint_access_failures = [0u32; 7];
    let mut minimum_envelope = [0.; 2];
    let mut hint_outside = f64::INFINITY;
    let mut last_code = "no_admissible_recipe";
    let mut reason = "No admissible recipe for this explicit cultural family.".to_string();
    // Exact models (cultural or free workshop) do not need an atlas recipe
    // stand-in. Automatic sources alone iterate the cultural recipe palette.
    let sources = if explicit_resolved.is_some() {
        vec![None]
    } else {
        let anchor_recipe = anchor.filter(|a| recipes.iter().any(|r| r.id == a.id));
        let mut selected: Vec<_> = recipes
            .into_iter()
            .take(if palette { 2 } else { 3 })
            .map(Some)
            .collect();
        if let Some(anchor) =
            anchor_recipe.filter(|a| !selected.iter().flatten().any(|r| r.id == a.id))
        {
            selected.push(Some(anchor));
        }
        selected
    };
    for recipe in sources {
        let recipe_start = attempts;
        let mut target_dimensions: Option<([f64; 2], [f64; 2])> = None;
        for adaptation in 0..3 {
            let minimum = adaptation == 2;
            if adaptation > 0 && explicit_house_config {
                continue;
            }
            let mut config = base.clone();
            if !explicit_house_config {
                config.recipe = recipe.map(|r| r.id.clone());
            }
            if !explicit_house_config
                && config.overrides.variant.is_none()
                && minimum
                && r.placement_hint.is_some()
            {
                config.overrides.variant = Some("default".into());
            }
            let envelope = fitted_hint
                .as_ref()
                .filter(|_| !minimum)
                .map(|hint| {
                    let points = &hint[0].outer;
                    let w = libm::hypot(points[1].x - points[0].x, points[1].y - points[0].y);
                    let d = libm::hypot(points[3].x - points[0].x, points[3].y - points[0].y);
                    // A corner lot's certificate can face its long side. Both
                    // native orientations are already tried below; size the plan
                    // for the orientation offering most recipe-compatible land.
                    [[w - 0.6, d - 0.9], [d - 0.6, w - 0.9]]
                        .into_iter()
                        .max_by(|a, b| {
                            let score = |s: &[f64; 2]| {
                                recipe.map_or(s[0] * s[1], |recipe| {
                                    let p = &recipe.parameters;
                                    if s[0] < p.width_m[0] * base.size
                                        || s[1] < p.depth_m[0] * base.size
                                    {
                                        return 0.;
                                    }
                                    let factor = if base.mode != HistoricalMode::HistoricalStrict
                                        && matches!(
                                            p.layout,
                                            Layout::Single
                                                | Layout::Strip
                                                | Layout::Courtyard
                                                | Layout::Siheyuan
                                        ) {
                                        2.
                                    } else {
                                        1.
                                    };
                                    s[0].min(p.width_m[1] * base.size * factor)
                                        * s[1].min(p.depth_m[1] * base.size * factor)
                                })
                            };
                            score(a).total_cmp(&score(b))
                        })
                        .unwrap()
                })
                .unwrap_or_else(|| {
                    accesses
                        .iter()
                        .map(|access| {
                            let a = access.segment[0];
                            let b = access.segment[1];
                            let len = libm::hypot(b.x - a.x, b.y - a.y);
                            let tx = (b.x - a.x) / len;
                            let ty = (b.y - a.y) / len;
                            let mut spans = [
                                f64::INFINITY,
                                f64::INFINITY,
                                f64::NEG_INFINITY,
                                f64::NEG_INFINITY,
                            ];
                            for p in domain.iter().flat_map(|p| p.outer.iter()) {
                                let x = p.x * tx + p.y * ty;
                                let y = -p.x * ty + p.y * tx;
                                spans[0] = spans[0].min(x);
                                spans[1] = spans[1].min(y);
                                spans[2] = spans[2].max(x);
                                spans[3] = spans[3].max(y);
                            }
                            let margin = if parcel_fit { 0.9 } else { 0.6 };
                            [spans[2] - spans[0] - margin, spans[3] - spans[1] - margin]
                        })
                        .max_by(|a, b| {
                            let fits = |v: &[f64; 2]| {
                                recipe.is_none_or(|recipe| {
                                    v[0] >= recipe.parameters.width_m[0] * base.size
                                        && v[1] >= recipe.parameters.depth_m[0] * base.size
                                })
                            };
                            fits(a)
                                .cmp(&fits(b))
                                .then((a[0] * a[1]).total_cmp(&(b[0] * b[1])))
                        })
                        .unwrap_or([0., 0.])
                });
            let mut desired = r.occupation.as_ref().map(|o| {
                let desired_area = area(&domain) * o.coverage;
                let aspect = o.frontage_m / o.depth_m;
                let mut dimensions = [
                    libm::sqrt(desired_area * aspect),
                    libm::sqrt(desired_area / aspect),
                ];
                // Frontage and depth are cultural preferences, not an obligation
                // to leave most of a long, narrow urban lot empty. Redistribute
                // the requested area when one site span limits that preference.
                if parcel_fit && envelope[0] > 0. && envelope[1] > 0. {
                    dimensions[0] = dimensions[0].min(envelope[0]);
                    dimensions[1] = (desired_area / dimensions[0]).min(envelope[1]);
                    dimensions[0] = (desired_area / dimensions[1]).min(envelope[0]);
                }
                dimensions
            });
            if adaptation == 1 {
                let Some((target, min)) = target_dimensions else {
                    continue;
                };
                let intermediate = [(target[0] + min[0]) * 0.5, (target[1] + min[1]) * 0.5];
                if (intermediate[0] - target[0]).abs() < 0.001
                    && (intermediate[1] - target[1]).abs() < 0.001
                {
                    continue;
                }
                desired = Some(intermediate);
            }
            let mut resolved = if let Some(resolved) = &explicit_resolved {
                resolved.clone()
            } else {
                match resolve_urban_architecture(
                    config,
                    r.function,
                    envelope,
                    minimum,
                    desired,
                    r.occupation.as_ref().map(|o| o.coverage),
                    parcel_fit,
                ) {
                    Ok(p) => p,
                    Err(e) => {
                        reason = e;
                        continue;
                    }
                }
            };
            if adaptation == 0 && !explicit_house_config {
                let recipe = recipe.expect("Automatic source owns a real atlas recipe");
                let source = recipe
                    .variants
                    .iter()
                    .find(|v| v.parameters.variant_id == resolved.parameters.variant_id)
                    .map(|v| &v.parameters)
                    .unwrap_or(&recipe.parameters);
                target_dimensions = Some((
                    [
                        resolved.parameters.width_m[0],
                        resolved.parameters.depth_m[0],
                    ],
                    [source.width_m[0] * base.size, source.depth_m[0] * base.size],
                ));
            }
            if adaptation == 1 {
                resolved.plan.diagnostics.push("Native intermediate dimensions between the occupation target and source minimum; same recipe draw and layout rules, no footprint scaling.".into());
            }
            let mut unit = match volume_unit(&resolved) {
                Ok(u) => u,
                Err(e) => {
                    last_code = "roof_geometry";
                    reason = e;
                    continue;
                }
            };
            if unit.bodies.is_empty() {
                continue;
            }
            let native_entry = match crate::access::structural_access(
                &mut unit,
                &resolved.plan.paths,
                &resolved.parameters,
            ) {
                Ok(entry) => entry,
                Err(e) => {
                    last_code = "structural_access";
                    reason = e;
                    continue;
                }
            };
            let site_entry = match crate::access::structural_site_entry(
                &unit,
                &resolved.parameters,
                &native_entry,
            ) {
                Ok(entry) => entry,
                Err(e) => {
                    last_code = "structural_access";
                    reason = e;
                    continue;
                }
            };
            let local_entry = Point {
                x: (site_entry.opening[0].x + site_entry.opening[1].x) * 0.5,
                y: (site_entry.opening[0].y + site_entry.opening[1].y) * 0.5,
            };
            let useful_entry_width = site_entry.width_m + 0.6;
            let entry_wall_solids = unite(
                &unit
                    .walls
                    .iter()
                    .map(|w| crate::wall_geometry::wall_section(w, site_entry.from_z_m + 0.01))
                    .collect::<Vec<_>>(),
            );
            resolved.entrance = Some(native_entry);
            // Enclosure features are authored before access. Render their native
            // cut walls (including lintels), not the original closed ring.
            let mut structural_features: Vec<_> = unit
                .features
                .iter()
                .filter(|f| !unit.walls.iter().any(|w| w.id == format!("wall:{}", f.id)))
                .cloned()
                .collect();
            structural_features.extend(unit.walls.iter().map(|w| Feature {
                id: format!("structure:{}", w.id),
                kind: if w.kind == WallKind::Retaining {
                    FeatureKind::Retaining
                } else {
                    FeatureKind::Enclosure
                },
                surface: w.footprint.clone(),
                z_m: w.z_m,
                height_m: w.height_m,
                material: w.material.clone(),
                vertices3d: vec![],
                roof: None,
            }));
            let footprint = unite(
                &unit
                    .bodies
                    .iter()
                    .flat_map(|b| b.levels.iter().map(|l| l.footprint.clone()))
                    .collect::<Vec<_>>(),
            );
            // Unite native roof projections before rotation/translation. This keeps
            // coincident native edges in their construction coordinate frame and
            // avoids OGC overlay failures on nearly collinear projected world edges.
            let roof_parts = unit
                .roofs
                .faces
                .iter()
                .filter(|f| f.vertices.len() >= 3)
                .map(|f| {
                    vec![Polygon {
                        outer: f
                            .vertices
                            .iter()
                            .map(|i| {
                                let v = &unit.roofs.vertices[*i as usize];
                                Point { x: v.x, y: v.y }
                            })
                            .collect(),
                        holes: vec![],
                    }]
                })
                .filter(|s| area(s) > 1e-8)
                .collect::<Vec<_>>();
            let local_roof_surface = projected_roof_union(&roof_parts);
            let parcel_bounds = bounds(&domain);
            let parcel_center = point(
                (parcel_bounds[0] + parcel_bounds[2]) * 0.5,
                (parcel_bounds[1] + parcel_bounds[3]) * 0.5,
            );
            let body_bounds = bounds(&footprint);
            let entry_to_center = point(
                (body_bounds[0] + body_bounds[2]) * 0.5 - local_entry.x,
                (body_bounds[1] + body_bounds[3]) * 0.5 - local_entry.y,
            );
            // Fragmented curved frontages must not spend the bounded search only
            // at one end of a legal continuous frontage. Once a segment is wide
            // enough for the actual native portal, prefer central legal contacts.
            let mut ranked_accesses = accesses.clone();
            ranked_accesses.sort_by(|a, b| {
                let useful_width = |access: &&ArchitectureAccess| {
                    libm::hypot(
                        access.segment[1].x - access.segment[0].x,
                        access.segment[1].y - access.segment[0].y,
                    )
                    .min(useful_entry_width)
                };
                let distance = |access: &&ArchitectureAccess| {
                    let m = point(
                        (access.segment[0].x + access.segment[1].x) * 0.5,
                        (access.segment[0].y + access.segment[1].y) * 0.5,
                    );
                    let mut tx = access.segment[1].x - access.segment[0].x;
                    let mut ty = access.segment[1].y - access.segment[0].y;
                    let length = libm::hypot(tx, ty);
                    tx /= length;
                    ty /= length;
                    if (parcel_center.x - m.x) * (-ty) + (parcel_center.y - m.y) * tx > 0. {
                        tx = -tx;
                        ty = -ty;
                    }
                    let ideal_entry = point(
                        parcel_center.x - tx * entry_to_center.x + ty * entry_to_center.y,
                        parcel_center.y - ty * entry_to_center.x - tx * entry_to_center.y,
                    );
                    libm::hypot(m.x - ideal_entry.x, m.y - ideal_entry.y)
                };
                useful_width(b)
                    .total_cmp(&useful_width(a))
                    .then(distance(a).total_cmp(&distance(b)))
                    .then(a.id.cmp(&b.id))
            });
            let mut candidates = vec![];
            let mut fitted_candidates = vec![];
            let physical_bounds = bounds(&unite(&[
                footprint.clone(),
                resolved.plan.courts.clone(),
                resolved.plan.paths.clone(),
                local_roof_surface.clone(),
                site_entry.passage.clone(),
                unite(
                    &structural_features
                        .iter()
                        .map(|f| f.surface.clone())
                        .collect::<Vec<_>>(),
                ),
            ]));
            for access in ranked_accesses.iter().copied().take(4) {
                let a = access.segment[0];
                let z = access.segment[1];
                let dx = z.x - a.x;
                let dy = z.y - a.y;
                let length = libm::hypot(dx, dy);
                let mut tx = dx / length;
                let mut ty = dy / length;
                let midpoint = point((a.x + z.x) * 0.5, (a.y + z.y) * 0.5);
                if (parcel_center.x - midpoint.x) * (-ty) + (parcel_center.y - midpoint.y) * tx > 0.
                {
                    tx = -tx;
                    ty = -ty;
                }
                let angle = libm::atan2(ty, tx).to_degrees();
                if parcel_fit && !minimum {
                    // Fit the whole native envelope to the street plane and
                    // centre it across the lot. A door need not be at the
                    // building's midpoint: centring the door instead can reject
                    // an otherwise exact narrow-row fit at every sampled point.
                    let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
                    for p in domain.iter().flat_map(|p| &p.outer) {
                        let u = p.x * tx + p.y * ty;
                        lo = lo.min(u);
                        hi = hi.max(u);
                    }
                    let u = (lo + hi - physical_bounds[0] - physical_bounds[2]) * 0.5;
                    let v = -midpoint.x * ty + midpoint.y * tx - physical_bounds[3] - 0.01;
                    let transform = Transform {
                        origin: point(tx * u - ty * v, ty * u + tx * v),
                        orientation_deg: angle,
                    };
                    let entry = world_point(local_entry, &transform);
                    let along = (((entry.x - a.x) * dx + (entry.y - a.y) * dy) / (length * length))
                        .clamp(0.4 / length, 1. - 0.4 / length);
                    let anchor = point(a.x + dx * along, a.y + dy * along);
                    fitted_candidates.push((access, anchor, transform));
                }
                for fraction in [0.5, 0.25, 0.75] {
                    for setback in [0.25, 1.25, 3.0] {
                        let along = (length * fraction).clamp(0.4, length - 0.4) / length;
                        let anchor = Point {
                            x: a.x + dx * along,
                            y: a.y + dy * along,
                        };
                        let target = Point {
                            x: anchor.x + ty * setback,
                            y: anchor.y - tx * setback,
                        };
                        let mut transform = Transform {
                            origin: point(0., 0.),
                            orientation_deg: angle,
                        };
                        let entry = world_point(local_entry, &transform);
                        transform.origin = Point {
                            x: target.x - entry.x,
                            y: target.y - entry.y,
                        };
                        candidates.push((access, anchor, transform));
                    }
                }
            }
            let mut hinted = vec![];
            if let Some(hint) = if minimum {
                r.placement_hint.as_ref()
            } else {
                fitted_hint.as_ref().or(r.placement_hint.as_ref())
            } && let Some(rect) = hint.first().filter(|p| {
                p.outer.len() == 4
                    && p.holes.is_empty()
                    && p.outer.iter().all(|p| p.x.is_finite() && p.y.is_finite())
                    && area(hint) > 0.0001
                    && contains(&r.cadastral, hint)
            }) {
                let h = bounds(hint);
                let center = point((h[0] + h[2]) * 0.5, (h[1] + h[3]) * 0.5);
                let edge = point(
                    rect.outer[1].x - rect.outer[0].x,
                    rect.outer[1].y - rect.outer[0].y,
                );
                let base_angle = libm::atan2(edge.y, edge.x).to_degrees();
                let mut all = vec![
                    footprint.clone(),
                    resolved.plan.courts.clone(),
                    resolved.plan.paths.clone(),
                    local_roof_surface.clone(),
                    resolved.entrance.as_ref().unwrap().passage.clone(),
                ];
                all.extend(structural_features.iter().map(|f| f.surface.clone()));
                let local_bounds = bounds(&all.into_iter().flatten().collect());
                if minimum {
                    minimum_envelope = [
                        local_bounds[2] - local_bounds[0],
                        local_bounds[3] - local_bounds[1],
                    ];
                }
                let local_center = point(
                    (local_bounds[0] + local_bounds[2]) * 0.5,
                    (local_bounds[1] + local_bounds[3]) * 0.5,
                );
                for rotation in 0..4 {
                    let mut transform = Transform {
                        origin: point(0., 0.),
                        orientation_deg: base_angle + 90. * rotation as f64,
                    };
                    let c = world_point(local_center, &transform);
                    transform.origin = point(center.x - c.x, center.y - c.y);
                    let entry = world_point(local_entry, &transform);
                    let mut legal: Vec<_> = accesses
                        .iter()
                        .copied()
                        .map(|access| {
                            let a = access.segment[0];
                            let b = access.segment[1];
                            let dx = b.x - a.x;
                            let dy = b.y - a.y;
                            let length = libm::hypot(dx, dy);
                            let t = (((entry.x - a.x) * dx + (entry.y - a.y) * dy)
                                / (length * length))
                                .clamp(0.4 / length, 1. - 0.4 / length);
                            let anchor = point(a.x + t * dx, a.y + t * dy);
                            (
                                access,
                                anchor,
                                libm::hypot(anchor.x - entry.x, anchor.y - entry.y),
                            )
                        })
                        .collect();
                    legal.sort_by(|a, b| a.2.total_cmp(&b.2));
                    hinted.extend(
                        legal
                            .into_iter()
                            .take(4)
                            .map(|(access, anchor, _)| (access, anchor, transform.clone())),
                    );
                }
            }
            let hinted_count = hinted.len();
            let mut party_candidates = vec![];
            if resolved
                .parameters
                .details
                .iter()
                .any(|d| d == "party_walls")
            {
                for (access, _, initial) in candidates.iter().step_by(9) {
                    let front = point(
                        access.segment[1].x - access.segment[0].x,
                        access.segment[1].y - access.segment[0].y,
                    );
                    for boundary in r.party_boundaries.iter().take(4) {
                        let dx = boundary[1].x - boundary[0].x;
                        let dy = boundary[1].y - boundary[0].y;
                        let length = libm::hypot(dx, dy);
                        if length < 0.001
                            || (dx * front.x + dy * front.y).abs()
                                > 0.25 * length * libm::hypot(front.x, front.y)
                        {
                            continue;
                        }
                        let normal = [-dy / length, dx / length];
                        let plane = boundary[0].x * normal[0] + boundary[0].y * normal[1];
                        let positive =
                            parcel_center.x * normal[0] + parcel_center.y * normal[1] >= plane;
                        let world = world_surface(&footprint, initial);
                        let projections = world
                            .iter()
                            .flat_map(|s| s.outer.iter())
                            .map(|p| p.x * normal[0] + p.y * normal[1]);
                        let edge = if positive {
                            projections.fold(f64::INFINITY, f64::min)
                        } else {
                            projections.fold(f64::NEG_INFINITY, f64::max)
                        };
                        let shift = plane + if positive { 0.01 } else { -0.01 } - edge;
                        let mut transform = initial.clone();
                        transform.origin.x += normal[0] * shift;
                        transform.origin.y += normal[1] * shift;
                        let entry = world_point(local_entry, &transform);
                        let a = access.segment[0];
                        let b = access.segment[1];
                        let length2 = (b.x - a.x).powi(2) + (b.y - a.y).powi(2);
                        let margin = 0.4 / libm::sqrt(length2);
                        let t = (((entry.x - a.x) * (b.x - a.x) + (entry.y - a.y) * (b.y - a.y))
                            / length2)
                            .clamp(margin, 1. - margin);
                        let anchor = point(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
                        party_candidates.push((*access, anchor, transform));
                    }
                }
                party_candidates.truncate(8);
            }
            // Keep canonical minimum witnesses unchanged; the fitted transforms
            // only precede sampled candidates for automatic urban adaptation.
            fitted_candidates.extend(party_candidates);
            let mut party_candidates = fitted_candidates;
            let party_count = party_candidates.len();
            party_candidates.extend(hinted);
            party_candidates.extend(candidates);
            for (index, (access, anchor, transform)) in
                party_candidates.into_iter().take(36).enumerate()
            {
                if attempts - recipe_start >= 108 {
                    break;
                }
                attempts += 1;
                let minimum_hint =
                    minimum && index >= party_count && index < party_count + hinted_count;
                if minimum_hint {
                    hint_progress[0] += 1;
                }
                let occupied_world = world_surface(&footprint, &transform);
                if minimum_hint {
                    hint_outside = hint_outside.min(area(&difference(&occupied_world, &domain)));
                }
                if !contains(&domain, &occupied_world) {
                    last_code = "outside_buildable";
                    reason="Whole bodies and upper levels do not fit the buildable domain, holes and reserves.".into();
                    continue;
                }
                if minimum_hint {
                    hint_progress[1] += 1;
                }
                let court = world_surface(&resolved.plan.courts, &transform);
                if !contains(&r.cadastral, &court)
                    || area(&intersection(&court, &r.reserves)) > 0.0001
                {
                    last_code = "court_reserved";
                    reason =
                        "The retained court conflicts with a cadastral hole or reserved space."
                            .into();
                    continue;
                }
                if minimum_hint {
                    hint_progress[2] += 1;
                }
                if area(&intersection(occupied, &occupied_world)) > 0.0001 {
                    last_code = "neighbor_overlap";
                    reason =
                        "A body overlaps another accepted building or supplied neighbor.".into();
                    continue;
                }
                if structural_features.iter().any(|f| {
                    let surface = world_surface(&f.surface, &transform);
                    !contains(&r.cadastral, &surface)
                        || area(&intersection(&surface, &r.reserves)) > 0.0001
                        || area(&intersection(&surface, occupied)) > 0.0001
                }) {
                    last_code = "site_structure_outside";
                    reason="Native enclosure, support or circulation structure conflicts with the cadastral domain, reserve or neighbor.".into();
                    continue;
                }
                let roof_domain = r.roof_domain.as_ref().unwrap_or(&r.cadastral);
                if minimum_hint {
                    hint_progress[3] += 1;
                }
                let roof_surface = world_surface(&local_roof_surface, &transform);
                if !contains(roof_domain, &roof_surface)
                    || area(&intersection(&roof_surface, &r.reserves)) > 0.0001
                {
                    last_code = "roof_rights";
                    reason =
                        "Native roof overhang exceeds its own rights envelope or a reserved space."
                            .into();
                    continue;
                }
                if minimum_hint {
                    hint_progress[4] += 1;
                }
                let entrance = world_point(local_entry, &transform);
                let corridor = segment_corridor(anchor, entrance, 0.8);
                if area(&intersection(
                    &corridor,
                    &world_surface(&entry_wall_solids, &transform),
                )) > 0.0001
                {
                    if minimum_hint {
                        hint_access_failures[0] += 1;
                    }
                    last_code = "entrance_blocked";
                    reason = "The public connector crosses a native site wall outside its actual gate opening.".into();
                    continue;
                }
                let native_passage =
                    world_surface(&resolved.entrance.as_ref().unwrap().passage, &transform);
                if area(&difference(
                    &intersection(&corridor, &occupied_world),
                    &native_passage,
                )) > 0.0001
                {
                    if minimum_hint {
                        hint_access_failures[1] += 1;
                    }
                    last_code = "entrance_blocked";
                    reason="The external entrance connector crosses its own body away from the retained native portal.".into();
                    continue;
                }
                let circulation =
                    union(&world_surface(&resolved.plan.paths, &transform), &corridor);
                if !contains(&r.cadastral, &circulation)
                    || area(&intersection(&circulation, &r.reserves)) > 0.0001
                    || area(&intersection(&circulation, occupied)) > 0.0001
                {
                    if minimum_hint {
                        hint_access_failures[2] += 1;
                    }
                    last_code = "entrance_blocked";
                    reason="The entrance cannot reach its authorized access without crossing a reserve, cadastral hole or existing building.".into();
                    continue;
                }
                let inverse_rotation = Transform {
                    origin: point(0., 0.),
                    orientation_deg: -transform.orientation_deg,
                };
                let inverse = Transform {
                    origin: world_point(
                        point(-transform.origin.x, -transform.origin.y),
                        &inverse_rotation,
                    ),
                    orientation_deg: inverse_rotation.orientation_deg,
                };
                let local_allowed = world_surface(&walk_domain, &inverse);
                let local_connector = world_surface(&corridor, &inverse);
                // A profiled native opening may lie exactly on the lot edge.
                // Its actual native passage, not a synthesized path, joins the
                // public connector to the existing exterior walk component.
                let native_interface = union(&local_connector, &site_entry.passage);
                let interface_checks = [
                    contains(&local_allowed, &site_entry.passage),
                    area(&intersection(&local_connector, &site_entry.passage)) > 0.005,
                    native_interface.len() == 1,
                ];
                let access_checks = [
                    interface_checks[0],
                    interface_checks[1],
                    interface_checks[2],
                    interface_checks.contains(&false)
                        || crate::access::retained_connection_within(
                            &unit,
                            &local_allowed,
                            &native_interface,
                        ),
                ];
                if access_checks.contains(&false) {
                    if minimum_hint {
                        for (index, valid) in access_checks.iter().enumerate() {
                            if !valid {
                                hint_access_failures[index + 3] += 1;
                            }
                        }
                    }
                    last_code = "entrance_blocked";
                    reason = "The real cadastral holes, reserves or occupation disconnect the native gate-to-body access graph.".into();
                    continue;
                }
                if minimum_hint {
                    hint_progress[5] += 1;
                }
                let world_structures: Vec<_> = structural_features
                    .iter()
                    .map(|f| world_surface(&f.surface, &transform))
                    .collect();
                let mut bearing_parts = vec![occupied_world.clone()];
                bearing_parts.extend(world_structures.iter().cloned());
                let bearing_domain = unite(&bearing_parts);
                let (low, high, physical_slope) = match terrain.foundation_bounds(&bearing_domain) {
                    Ok(bounds) => bounds,
                    Err(e) => {
                        last_code = "terrain_coverage";
                        reason = e;
                        continue;
                    }
                };
                if physical_slope > 12. {
                    last_code = "slope_exceeded";
                    reason = format!(
                        "Physical raster slope {physical_slope:.2}° exceeds current level-foundation support limit of 12°."
                    );
                    continue;
                }
                if high - low > terrain.max_foundation_step_m {
                    last_code = "foundation_step";
                    reason = format!(
                        "Required foundation step {:.2} m exceeds {:.2} m.",
                        high - low,
                        terrain.max_foundation_step_m
                    );
                    continue;
                }
                let min_support = unit
                    .bodies
                    .iter()
                    .flat_map(|b| b.levels.iter().map(|l| l.z_m))
                    .fold(f64::INFINITY, f64::min);
                if terrain
                    .water_z_m
                    .is_some_and(|water| water > low + min_support + 0.05)
                {
                    last_code = "water_conflict";
                    reason="Physical foundation or support is submerged; no water-surface grounding was substituted.".into();
                    continue;
                }
                let mut volumes = vec![];
                for (i, body) in unit.bodies.iter().enumerate() {
                    let levels: Vec<_> = body
                        .levels
                        .iter()
                        .map(|l| VolumeLevel {
                            index: l.index,
                            footprint: world_surface(&l.footprint, &transform),
                            z_m: high + l.z_m,
                            height_m: l.height_m,
                            materials: Some(l.materials.clone()),
                        })
                        .collect();
                    let z_m = levels.first().map_or(high, |l| l.z_m);
                    let top = levels
                        .iter()
                        .map(|l| l.z_m + l.height_m)
                        .fold(z_m, f64::max);
                    let source_faces: Vec<_> = unit
                        .roofs
                        .faces
                        .iter()
                        .enumerate()
                        .filter(|(_, f)| {
                            f.body_id == body.id
                                || (i == 0 && f.body_id.is_empty() && f.feature_id.is_some())
                        })
                        .collect();
                    let angle = transform.orientation_deg.to_radians();
                    let mut remap = std::collections::BTreeMap::new();
                    let mut vertices = vec![];
                    let mut faces = vec![];
                    let mut face_remap = std::collections::BTreeMap::new();
                    for (source_index, face) in source_faces {
                        face_remap.insert(source_index as u32, faces.len() as u32);
                        let [nx, ny, nz] = face.normal;
                        let normal = [
                            nx * libm::cos(angle) - ny * libm::sin(angle),
                            nx * libm::sin(angle) + ny * libm::cos(angle),
                            nz,
                        ];
                        let indices = face
                            .vertices
                            .iter()
                            .map(|index| {
                                *remap.entry(*index).or_insert_with(|| {
                                    let v = &unit.roofs.vertices[*index as usize];
                                    let p = world_point(point(v.x, v.y), &transform);
                                    let next = vertices.len() as u32;
                                    vertices.push(Vertex3 {
                                        x: p.x,
                                        y: p.y,
                                        z: high + v.z,
                                    });
                                    next
                                })
                            })
                            .collect();
                        faces.push(VolumeRoofFace {
                            vertices: indices,
                            normal,
                            material: face.material.clone(),
                            kind: face.kind,
                            roof_group: face.roof_group.clone(),
                        });
                    }
                    let edges = unit
                        .roofs
                        .edges
                        .iter()
                        .filter_map(|edge| {
                            let a = remap.get(&edge.vertices[0])?;
                            let b = remap.get(&edge.vertices[1])?;
                            let related = edge
                                .faces
                                .map(|f| f.and_then(|id| face_remap.get(&id).copied()));
                            if related.iter().all(Option::is_none) {
                                return None;
                            }
                            Some(RoofEdge {
                                kind: edge.kind,
                                vertices: [*a, *b],
                                faces: related,
                            })
                        })
                        .collect();
                    let groups = unit
                        .roofs
                        .groups
                        .iter()
                        .filter(|g| faces.iter().any(|f| f.roof_group == g.id))
                        .map(|g| {
                            let mut group = g.clone();
                            group.domain = world_surface(&group.domain, &transform);
                            group
                        })
                        .collect();
                    let roof_top = faces
                        .iter()
                        .flat_map(|f| f.vertices.iter().map(|i| vertices[*i as usize].z))
                        .fold(top, f64::max);
                    volumes.push(ArchitectureVolume {
                        foundation: VolumeFoundation {
                            footprint: world_surface(&body.footprint, &transform),
                            z_min_m: low - 0.15,
                            z_max_m: high,
                        },
                        id: format!("{}:body:{i}", r.id),
                        footprint: world_surface(&body.footprint, &transform),
                        levels,
                        z_m,
                        wall_height_m: top - z_m,
                        roof_height_m: roof_top - top,
                        roof_system: body.roof_system.clone(),
                        roof_pitch_deg: body.roof_pitch_deg,
                        overhang_m: body.overhang_m,
                        roof_spec: body.roof_spec.clone(),
                        materials: body.levels[0].materials.clone(),
                        role: if non_domestic(r.function) {
                            Role::NonDomestic
                        } else {
                            body.role
                        },
                        envelope: body.envelope,
                        roof_mesh: VolumeRoofMesh {
                            vertices,
                            faces,
                            edges,
                            groups,
                        },
                    });
                }
                let useful_area_m2 = unit
                    .bodies
                    .iter()
                    .flat_map(|b| {
                        b.levels
                            .iter()
                            .map(|l| area(&offset(&l.footprint, -b.wall_thickness_m)))
                    })
                    .sum();
                let mut diagnostics=vec!["Recipe plan and native roof geometry retained; no interiors or detailed wall meshes.".into(),format!("Physical ground {:.3}..{:.3} m; level foundation {:.3} m; {attempts} bounded placement candidates.",low,high,high)];
                diagnostics.extend(resolved.plan.diagnostics.iter().cloned());
                if workshop_source {
                    diagnostics.push("Explicit native free Houses workshop preset; retained culture describes the urban site, not cultural provenance of this model.".into());
                }
                if local_entry
                    != point(
                        (resolved.entrance.as_ref().unwrap().opening[0].x
                            + resolved.entrance.as_ref().unwrap().opening[1].x)
                            * 0.5,
                        (resolved.entrance.as_ref().unwrap().opening[0].y
                            + resolved.entrance.as_ref().unwrap().opening[1].y)
                            * 0.5,
                    )
                {
                    diagnostics.push("Public connector terminates at the native enclosure gate; the retained body portal is reachable through the existing native exterior walk component.".into());
                }
                if non_domestic(r.function) {
                    diagnostics.push("Explicit non-domestic programme volume adapting this culture's architectural envelope; detailed domestic interiors are unavailable.".into());
                }
                if !r.party_boundaries.is_empty() {
                    diagnostics.push("Supplied party boundaries retained; exact common-wall fusion is not performed.".into());
                }
                return Ok(PlacedBuilding {
                    id: r.id.clone(),
                    parcel_id: r.parcel_id.clone(),
                    function: r.function,
                    culture: r.culture.clone(),
                    recipe_id: resolved.recipe_id.clone(),
                    variant_id: resolved.parameters.variant_id.clone(),
                    transform: transform.clone(),
                    ground_z_m: high,
                    footprint: occupied_world,
                    roof_footprint: roof_surface,
                    courtyards: court,
                    circulation,
                    entrance,
                    access_id: access.id.clone(),
                    volumes,
                    structural_features: structural_features
                        .iter()
                        .map(|f| {
                            let mut feature = f.clone();
                            feature.id = format!("{}:{}", r.id, f.id);
                            feature.surface = world_surface(&f.surface, &transform);
                            feature.z_m = high + f.z_m;
                            feature.vertices3d = f
                                .vertices3d
                                .iter()
                                .map(|v| {
                                    let p = world_point(Point { x: v.x, y: v.y }, &transform);
                                    Vertex3 {
                                        x: p.x,
                                        y: p.y,
                                        z: high + v.z,
                                    }
                                })
                                .collect();
                            if let Some(roof) = &mut feature.roof {
                                roof.domain = world_surface(&roof.domain, &transform);
                                roof.support_z_m += high;
                                if let Some(id) = &mut roof.owner_body_id {
                                    *id = id.replacen("unit-0", &r.id, 1);
                                }
                                for id in &mut roof.supports {
                                    *id = format!("{}:{}", r.id, id);
                                }
                                for arm in &mut roof.arms {
                                    arm.origin = world_point(arm.origin, &transform);
                                    arm.domain = world_surface(&arm.domain, &transform);
                                    let angle = transform.orientation_deg.to_radians();
                                    let [x, y] = arm.axis;
                                    arm.axis = [
                                        x * libm::cos(angle) - y * libm::sin(angle),
                                        x * libm::sin(angle) + y * libm::cos(angle),
                                    ];
                                }
                            }
                            feature
                        })
                        .collect(),
                    structural_foundations: structural_features
                        .iter()
                        .zip(world_structures)
                        .filter_map(|(f, surface)| {
                            let top = high;
                            (f.height_m > 0. && top > low - 0.15 && !surface.is_empty()).then_some(
                                VolumeFoundation {
                                    footprint: surface,
                                    z_min_m: low - 0.15,
                                    z_max_m: top,
                                },
                            )
                        })
                        .collect(),
                    useful_area_m2,
                    domestic_units: if non_domestic(r.function) {
                        0
                    } else {
                        let households: std::collections::BTreeSet<_> = unit
                            .bodies
                            .iter()
                            .flat_map(|b| b.cells.iter().filter_map(|c| c.household_id.as_ref()))
                            .collect();
                        (households.len() as u32).max(1)
                    },
                    simplification: "recipe_volumes".into(),
                    diagnostics,
                    resolved,
                });
            }
        }
    }
    if hint_progress[0] > 0 {
        if hint_progress[4] > 0 && hint_progress[5] == 0 {
            last_code = "entrance_blocked";
            reason="The native bodies, courts and roofs fit the witness, but its resolved entrance cannot reach an authorized contact without crossing a body or leaving cadastral land. Extra requested levels may require a larger access skeleton than the minimum profile.".into();
        }
        reason.push_str(&format!(" Minimum-witness checks [candidates, bodies, courts, structures, roofs, access]={hint_progress:?}; physical envelope {:.3}×{:.3}m; minimum body leak {:.9}m².",minimum_envelope[0],minimum_envelope[1],hint_outside));
        if hint_access_failures.iter().any(|&n| n > 0) {
            reason.push_str(&format!(" Witness access failures [wall, body, circulation, native passage outside, interface overlap, interface components, native graph]={hint_access_failures:?}."));
        }
    }
    Err(refusal(r, last_code, reason, attempts))
}

fn segment_corridor(a: Point, b: Point, width: f64) -> Surface {
    let length = libm::hypot(b.x - a.x, b.y - a.y);
    if length < 0.001 {
        return rectangle(a.x - width * 0.5, a.y - width * 0.5, width, width);
    }
    let nx = -(b.y - a.y) / length * width * 0.5;
    let ny = (b.x - a.x) / length * width * 0.5;
    vec![Polygon {
        outer: vec![
            Point {
                x: a.x + nx,
                y: a.y + ny,
            },
            Point {
                x: b.x + nx,
                y: b.y + ny,
            },
            Point {
                x: b.x - nx,
                y: b.y - ny,
            },
            Point {
                x: a.x - nx,
                y: a.y - ny,
            },
        ],
        holes: vec![],
    }]
}

/// Validate what the city actually retained, not merely a fresh reconstruction
/// of its opaque plan. This also rejects older imported meshes whose native
/// exterior construction differs from the current retained plan.
fn retained_roof_matches(building: &PlacedBuilding) -> Result<bool, String> {
    let native = volume_unit(&building.resolved)?;
    if native.bodies.len() != building.volumes.len() {
        return Ok(false);
    }
    let quantized = |v: &Vertex3| -> Result<[i64; 3], String> {
        if ![v.x, v.y, v.z].iter().all(|v| v.is_finite()) {
            return Err("Non-finite retained roof vertex.".into());
        }
        // Same micrometre representation as the existing native roof identity
        // check; JSON roundtrip noise is not a changed physical roof surface.
        Ok([
            libm::round(v.x * 1e6) as i64,
            libm::round(v.y * 1e6) as i64,
            libm::round(v.z * 1e6) as i64,
        ])
    };
    let mut expected = vec![];
    let mut stored = vec![];
    for (index, (body, volume)) in native.bodies.iter().zip(&building.volumes).enumerate() {
        for face in native.roofs.faces.iter().filter(|f| {
            f.body_id == body.id || (index == 0 && f.body_id.is_empty() && f.feature_id.is_some())
        }) {
            let mut points = face
                .vertices
                .iter()
                .map(|i| {
                    let v = &native.roofs.vertices[*i as usize];
                    let p = world_point(point(v.x, v.y), &building.transform);
                    quantized(&Vertex3 {
                        x: p.x,
                        y: p.y,
                        z: building.ground_z_m + v.z,
                    })
                })
                .collect::<Result<Vec<_>, _>>()?;
            points.sort();
            expected.push((
                index,
                format!("{:?}", face.kind),
                face.material.clone(),
                points,
            ));
        }
        for face in &volume.roof_mesh.faces {
            let mut points = face
                .vertices
                .iter()
                .map(|i| {
                    let v = volume
                        .roof_mesh
                        .vertices
                        .get(*i as usize)
                        .ok_or("Retained roof face references an absent vertex.")?;
                    quantized(v)
                })
                .collect::<Result<Vec<_>, String>>()?;
            points.sort();
            stored.push((
                index,
                format!("{:?}", face.kind),
                face.material.clone(),
                points,
            ));
        }
    }
    expected.sort();
    stored.sort();
    Ok(expected == stored)
}

pub fn enrich_placement(building: PlacedBuilding) -> Result<HouseBatch, String> {
    if non_domestic(building.function) {
        return Err("Non-domestic volumes have no detailed functional interior recipe; the retained programme volume is preserved.".into());
    }
    if !retained_roof_matches(&building)? {
        return Err("Stored city roof geometry differs from the retained native plan; original placement preserved.".into());
    }
    let mut batch = enrich_architecture(&building.resolved)?;
    let unit = batch.units.first_mut().ok_or("No enriched unit.")?;
    // Detailed access must actually emerge at the retained entrance; otherwise
    // refuse rather than pretending a different floor plan is the same case.
    let retained = building
        .resolved
        .entrance
        .as_ref()
        .ok_or("Missing retained native entrance; original placement preserved.")?;
    let local_entrance = point(
        (retained.opening[0].x + retained.opening[1].x) * 0.5,
        (retained.opening[0].y + retained.opening[1].y) * 0.5,
    );
    let accessible = unit
        .access
        .portals
        .iter()
        .filter(|p| p.from == unit.access.root || p.to == unit.access.root)
        .any(|p| {
            let mid = Point {
                x: (p.opening[0].x + p.opening[1].x) * 0.5,
                y: (p.opening[0].y + p.opening[1].y) * 0.5,
            };
            libm::hypot(mid.x - local_entrance.x, mid.y - local_entrance.y) <= 0.001
        });
    if !accessible {
        return Err("Detailed entrance does not match the retained accessible volume plan; original placement preserved.".into());
    }
    // A perimeter gate and the body door are different interfaces. Revalidate
    // the native outdoor connection after interior detail, rather than asking
    // for a fictitious body door at the perimeter gate's position.
    let site_entry =
        crate::access::structural_site_entry(unit, &building.resolved.parameters, retained)?;
    let site_middle = world_point(
        point(
            (site_entry.opening[0].x + site_entry.opening[1].x) * 0.5,
            (site_entry.opening[0].y + site_entry.opening[1].y) * 0.5,
        ),
        &building.transform,
    );
    if libm::hypot(
        site_middle.x - building.entrance.x,
        site_middle.y - building.entrance.y,
    ) > 0.001
    {
        return Err("Detailed site gate does not match the retained public connection; original placement preserved.".into());
    }
    unit.transform = building.transform;
    batch.diagnostics.push(format!("Retained urban physical foundation: {:.3} m; local architectural z is relative to that foundation.",building.ground_z_m));
    Ok(batch)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request() -> PlacementRequest {
        PlacementRequest {
            id: "building-1".into(),
            parcel_id: "parcel-1".into(),
            cadastral: rectangle(0., 0., 80., 60.),
            buildable: rectangle(0., 0., 80., 60.),
            reserves: vec![],
            roof_domain: None,
            placement_hint: None,
            accesses: vec![ArchitectureAccess {
                id: "street".into(),
                segment: [point(0., 60.), point(80., 60.)],
                kind: "public".into(),
                width_m: 2.,
            }],
            party_boundaries: vec![],
            neighbors: vec![],
            culture: ArchitectureCulture {
                culture: "european_medieval".into(),
                pack: "EUR-MED".into(),
                mode: HistoricalMode::HistoricalInspired,
                borrowing: None,
            },
            function: ArchitectureFunction::Domestic,
            typology: None,
            seed: "urban-placement-regression".into(),
            terrain: ArchitectureTerrain {
                origin: point(0., 0.),
                ground_z_m: 143.,
                gradient: [0., 0.],
                water_z_m: None,
                max_foundation_step_m: 0.8,
                grid: None,
            },
            config: None,
            occupation: None,
            parcel_fit: None,
        }
    }
    fn run(r: PlacementRequest) -> PlacementBatch {
        place_batch(PlacementBatchRequest {
            schema_version: "1".into(),
            requests: vec![r],
            settings: None,
        })
        .unwrap()
    }
    #[test]
    fn spatial_occupation_matches_exact_union_and_retains_holes() {
        let mut index = OccupationIndex::default();
        let mut surfaces = vec![];
        for i in 0..100 {
            let surface = difference(
                &rectangle(i as f64 * 128., 0., 24., 24.),
                &rectangle(i as f64 * 128. + 8., 8., 8., 8.),
            );
            index.insert(surface.clone());
            surfaces.push(surface);
        }
        let global = unite(&surfaces);
        for query in [
            rectangle(2., 2., 4., 4.),
            rectangle(9., 9., 2., 2.),
            rectangle(120., 0., 30., 30.),
            rectangle(-10., -10., 200., 40.),
        ] {
            let local = index.local(&query);
            assert!(
                (area(&intersection(&local, &query)) - area(&intersection(&global, &query))).abs()
                    < 1e-9
            );
            assert!(local.len() < global.len());
        }
    }
    #[test]
    fn split_neighbor_occupation_keeps_the_cumulative_native_tolerance() {
        let fragments = [
            rectangle(0., 0., 0.006, 0.01),
            rectangle(1., 1., 0.006, 0.01),
        ];
        let candidate = rectangle(-1., -1., 3., 3.);
        assert!(
            fragments
                .iter()
                .all(|s| area(&intersection(s, &candidate)) < 0.0001)
        );
        let neighbors = fragments
            .iter()
            .enumerate()
            .map(|(i, s)| ArchitectureNeighbor {
                id: i.to_string(),
                footprint: s.clone(),
                height_m: 3.,
            })
            .collect::<Vec<_>>();
        let split = local_occupation(&vec![], &neighbors).unwrap();
        let same_batch = local_occupation(&unite(&fragments), &[]).unwrap();
        let split_area = area(&intersection(&split, &candidate));
        assert!(split_area > 0.0001);
        assert!((split_area - area(&intersection(&same_batch, &candidate))).abs() < 1e-10);
    }
    fn enclosed_request() -> PlacementRequest {
        let mut r = request();
        r.culture.pack = "AF-WEST".into();
        let profile = admissibility_profiles()
            .unwrap()
            .into_iter()
            .find(|p| p.recipe_id == "AF-WEST-B07")
            .unwrap();
        let [width, depth] = profile.minimum_domain_m;
        r.cadastral = rectangle(0., 0., width + 0.6, depth + 0.6);
        r.buildable = r.cadastral.clone();
        r.placement_hint = Some(rectangle(0.3, 0.3, width, depth));
        r.accesses[0].segment = [point(0., depth + 0.6), point(width + 0.6, depth + 0.6)];
        r.config = Some(HouseConfig {
            recipe: Some("AF-WEST-B07".into()),
            ..HouseConfig::default()
        });
        r.config.as_mut().unwrap().overrides.floors = Some(1);
        r.config.as_mut().unwrap().overrides.variant = Some("default".into());
        r
    }
    #[test]
    fn enclosure_connector_uses_the_actual_gate_without_crossing_walls() {
        let result = run(enclosed_request());
        assert_eq!(result.buildings.len(), 1, "{:?}", result.refusals);
        let b = &result.buildings[0];
        let mut unit = volume_unit(&b.resolved).unwrap();
        let body_entry = crate::access::structural_access(
            &mut unit,
            &b.resolved.plan.paths,
            &b.resolved.parameters,
        )
        .unwrap();
        let gate = crate::access::structural_site_entry(&unit, &b.resolved.parameters, &body_entry)
            .unwrap();
        let gate_center = point(
            (gate.opening[0].x + gate.opening[1].x) * 0.5,
            (gate.opening[0].y + gate.opening[1].y) * 0.5,
        );
        assert_eq!(b.entrance, world_point(gate_center, &b.transform));
        assert_ne!(body_entry.opening, gate.opening);
        let walls = unite(
            &unit
                .walls
                .iter()
                .map(|w| crate::wall_geometry::wall_section(w, gate.from_z_m + 0.01))
                .collect::<Vec<_>>(),
        );
        let body_door = world_point(
            point(
                (body_entry.opening[0].x + body_entry.opening[1].x) * 0.5,
                (body_entry.opening[0].y + body_entry.opening[1].y) * 0.5,
            ),
            &b.transform,
        );
        let front_y = enclosed_request().accesses[0].segment[0].y;
        let former_connector = segment_corridor(point(body_door.x, front_y), body_door, 0.8);
        assert!(
            area(&intersection(
                &former_connector,
                &world_surface(&walls, &b.transform),
            )) > 0.0001,
            "The regression fixture must expose the former solid-wall crossing."
        );
        assert!(
            area(&intersection(
                &b.circulation,
                &world_surface(&walls, &b.transform),
            )) < 0.0001
        );
        assert!(
            b.diagnostics
                .iter()
                .any(|d| d.contains("native enclosure gate"))
        );
        let bounds = bounds(&unit.lot);
        let root_floor = &unit
            .access
            .nodes
            .iter()
            .find(|n| n.id == unit.access.root)
            .unwrap()
            .floor;
        let barrier = intersection(
            root_floor,
            &rectangle(bounds[0], gate_center.y - 0.8, bounds[2] - bounds[0], 0.1),
        );
        let public_local = segment_corridor(point(gate_center.x, bounds[3]), gate_center, 0.8);
        assert!(crate::access::retained_connection_within(
            &unit,
            &unit.lot,
            &public_local,
        ));
        assert!(area(&intersection(&barrier, &walls)) < 0.0001);
        assert!(area(&intersection(&barrier, &b.resolved.plan.paths)) < 0.0001);
        assert!(
            !crate::access::retained_connection_within(
                &unit,
                &difference(&unit.lot, &barrier),
                &public_local,
            ),
            "A hole in the unpaved native exterior must disconnect gate and body even without touching walls or drawn paths."
        );
        let mut reserved = enclosed_request();
        reserved.reserves = world_surface(&barrier, &b.transform);
        let refusal = run(reserved);
        assert!(refusal.buildings.is_empty(), "{:?}", refusal.refusals);
        // An obstacle in the authored gate is never cut away to force access.
        let root = unit
            .access
            .nodes
            .iter_mut()
            .find(|n| n.id == unit.access.root)
            .unwrap();
        root.floor = difference(&root.floor, &gate.passage);
        assert!(
            crate::access::structural_site_entry(&unit, &b.resolved.parameters, &body_entry,)
                .is_err()
        );
        enrich_placement(b.clone()).expect(
            "The distinct native enclosure/body interfaces must enrich without changing geometry",
        );
        // Ranked internal court thresholds cannot replace the authored outer
        // gap when there is no native site_gate_profile.
        let mut ranked = HouseConfig {
            pack: "AF-SAHEL".into(),
            recipe: Some("AF-SAHEL-B09".into()),
            ..HouseConfig::default()
        };
        ranked.overrides.variant = Some("default".into());
        ranked.overrides.floors = Some(1);
        let ranked = resolve_urban_architecture(
            ranked,
            ArchitectureFunction::Domestic,
            [100., 100.],
            true,
            None,
            None,
            false,
        )
        .unwrap();
        let mut ranked_unit = volume_unit(&ranked).unwrap();
        let body_portal = crate::access::structural_access(
            &mut ranked_unit,
            &ranked.plan.paths,
            &ranked.parameters,
        )
        .unwrap();
        let outer_gate =
            crate::access::structural_site_entry(&ranked_unit, &ranked.parameters, &body_portal)
                .unwrap();
        let peripheral = ranked
            .parameters
            .enclosures
            .iter()
            .find(|spec| spec.placement != crate::catalogue::Placement::Central)
            .unwrap();
        let (_, _, declared_gap) =
            crate::features::enclosure_geometry(&ranked_unit, &ranked.parameters, peripheral);
        assert_eq!(
            outer_gate.passage, declared_gap,
            "An inner ranked-court portal cannot replace the declared perimeter gap"
        );
    }
    #[test]
    fn exterior_structures_use_the_same_checked_physical_foundation() {
        let mut r = enclosed_request();
        r.terrain.gradient = [0.01, 0.005];
        r.terrain.max_foundation_step_m = 0.8;
        let result = run(r.clone());
        assert!(!result.buildings.is_empty(), "{:?}", result.refusals);
        let b = &result.buildings[0];
        assert!(!b.structural_foundations.is_empty());
        for foundation in &b.structural_foundations {
            for p in foundation.footprint.iter().flat_map(|s| s.outer.iter()) {
                let ground = r.terrain.ground(*p);
                assert!(ground >= foundation.z_min_m - 1e-8 && ground <= foundation.z_max_m + 1e-8);
            }
        }
        let mut bearing = vec![b.footprint.clone()];
        bearing.extend(b.structural_features.iter().map(|f| f.surface.clone()));
        let (low, high, _) = r.terrain.foundation_bounds(&unite(&bearing)).unwrap();
        assert!(high - low <= r.terrain.max_foundation_step_m);
        assert!((high - b.ground_z_m).abs() < 1e-8);
        r.terrain.max_foundation_step_m = 0.001;
        assert!(run(r).buildings.is_empty());
    }
    #[test]
    fn occupation_wishes_stay_in_source_ranges_and_enrich_the_retained_plan() {
        let mut r = request();
        r.config = Some(HouseConfig {
            recipe: Some("EUR-MED-B01".into()),
            ..HouseConfig::default()
        });
        r.occupation = Some(ArchitectureOccupation {
            coverage: 0.9,
            frontage_m: 100.,
            depth_m: 100.,
        });
        let result = run(r);
        assert_eq!(result.buildings.len(), 1, "{:?}", result.refusals);
        let b = &result.buildings[0];
        let recipe = catalogue()
            .unwrap()
            .recipes
            .iter()
            .find(|r| r.id == b.recipe_id)
            .unwrap();
        for (draw, source) in [
            (b.resolved.parameters.width_m, recipe.parameters.width_m),
            (b.resolved.parameters.depth_m, recipe.parameters.depth_m),
        ] {
            assert!(draw[0] >= source[0] && draw[1] <= source[1]);
        }
        assert!(
            b.volumes
                .iter()
                .all(|v| v.levels.iter().all(|l| l.materials.is_some()))
        );
        assert!(
            b.volumes
                .iter()
                .any(|v| !v.roof_mesh.edges.is_empty() && !v.roof_mesh.groups.is_empty())
        );
        assert!(enrich_placement(b.clone()).is_ok());
    }
    #[test]
    fn dense_native_rows_keep_side_ranges_courts_and_exact_replay() {
        let mut r = request();
        let mut config = HouseConfig {
            recipe: Some("EUR-MED-B02".into()),
            ..HouseConfig::default()
        };
        config.overrides.variant = Some("default".into());
        config.overrides.floors = Some(2);
        r.config = Some(config);
        r.occupation = Some(ArchitectureOccupation {
            coverage: 0.94,
            frontage_m: 6.,
            depth_m: 18.,
        });
        let result = run(r.clone());
        assert_eq!(result.buildings.len(), 1, "{:?}", result.refusals);
        let building = &result.buildings[0];
        assert!(
            building.volumes.len() > 1,
            "dense rows must retain native side/rear bodies"
        );
        assert!(!building.courtyards.is_empty());
        enrich_placement(building.clone()).unwrap();
        let replay = run(r);
        assert_eq!(
            serde_json::to_value(&result).unwrap(),
            serde_json::to_value(&replay).unwrap()
        );
    }
    #[test]
    fn parcel_fitting_is_explicit_bounded_and_retained_during_enrichment() {
        let mut r = request();
        let mut config = HouseConfig {
            recipe: Some("EUR-MED-B02".into()),
            ..HouseConfig::default()
        };
        config.overrides.variant = Some("default".into());
        config.overrides.floors = Some(2);
        r.config = Some(config);
        r.occupation = Some(ArchitectureOccupation {
            coverage: 0.94,
            frontage_m: 12.,
            depth_m: 36.,
        });
        r.parcel_fit = Some(true);
        let result = run(r.clone());
        assert_eq!(result.buildings.len(), 1, "{:?}", result.refusals);
        let b = &result.buildings[0];
        assert!(b.resolved.parameters.width_m[0] > 6.);
        assert!(b.resolved.parameters.width_m[0] <= 12. && b.resolved.parameters.depth_m[0] <= 36.);
        enrich_placement(b.clone()).unwrap();
        r.parcel_fit = Some(false);
        let source = run(r);
        assert_eq!(source.buildings.len(), 1, "{:?}", source.refusals);
        assert!(source.buildings[0].resolved.parameters.width_m[0] <= 6.);
        assert!(area(&b.footprint) > area(&source.buildings[0].footprint));
    }
    #[test]
    fn narrow_dense_frontage_uses_the_lot_instead_of_a_minimum_house() {
        // Real cadastral fronts retain submillimetre world coordinates.
        let shift = Transform {
            origin: Point {
                x: 2145.40976505,
                y: 2075.16770740,
            },
            orientation_deg: 0.,
        };
        let world_lot = world_surface(&rectangle(0., 0., 6.18516296, 19.23622227), &shift);
        let world_hint = world_surface(
            &vec![Polygon {
                outer: vec![
                    point(5.575, 19.236),
                    point(0.725, 19.236),
                    point(0.725, 8.186),
                    point(5.575, 8.186),
                ],
                holes: vec![],
            }],
            &shift,
        );
        let expanded = expanded_site_hint(&world_hint, &world_lot).unwrap();
        assert!(
            area(&expanded) > area(&world_lot) * 0.99,
            "World admission edges must not be resnapped"
        );
        let mut r = request();
        r.culture.pack = "AS-CHI".into();
        r.culture.culture = "chinese".into();
        r.cadastral = union(&rectangle(0., 0., 7., 32.), &rectangle(7., 0., 5., 2.));
        r.buildable = r.cadastral.clone();
        r.accesses[0].segment = [point(0., 32.), point(7., 32.)];
        r.placement_hint = Some(vec![Polygon {
            outer: vec![
                point(5.925, 32.),
                point(1.075, 32.),
                point(1.075, 20.95),
                point(5.925, 20.95),
            ],
            holes: vec![],
        }]);
        let mut config = HouseConfig {
            pack: "AS-CHI".into(),
            recipe: Some("AS-CHI-B04".into()),
            ..HouseConfig::default()
        };
        config.overrides.variant = Some("default".into());
        config.overrides.floors = Some(1);
        r.config = Some(config);
        r.occupation = Some(ArchitectureOccupation {
            coverage: 0.94,
            frontage_m: 6.,
            depth_m: 18.,
        });
        r.parcel_fit = Some(true);
        let result = run(r.clone());
        assert_eq!(result.buildings.len(), 1, "{:?}", result.refusals);
        let b = &result.buildings[0];
        assert!(
            area(&b.footprint) / area(&r.cadastral) > 0.5,
            "Dense frontage must occupy its lot, not just admit a small house: {:?}",
            b.diagnostics
        );
        assert!(contains(&r.cadastral, &b.roof_footprint));
        assert!(b.volumes.len() > 1);
        enrich_placement(b.clone()).unwrap();
        // A side-street admission certificate must not permanently turn the
        // long dimension into recipe width and truncate the occupied area.
        r.cadastral = rectangle(0., 0., 12., 35.);
        r.buildable = r.cadastral.clone();
        r.accesses[0].segment = [point(0., 0.), point(0., 35.)];
        let mut front = r.accesses[0].clone();
        front.id = "short-front".into();
        front.segment = [point(0., 35.), point(12., 35.)];
        r.accesses.push(front);
        r.placement_hint = Some(vec![Polygon {
            outer: vec![
                point(0., 15.),
                point(0., 19.85),
                point(11.05, 19.85),
                point(11.05, 15.),
            ],
            holes: vec![],
        }]);
        let rotated = run(r.clone());
        assert_eq!(rotated.buildings.len(), 1, "{:?}", rotated.refusals);
        let b = &rotated.buildings[0];
        assert!(
            area(&b.footprint) / area(&r.cadastral) > 0.5,
            "{:?}",
            b.diagnostics
        );
        enrich_placement(b.clone()).unwrap();
    }
    #[test]
    fn automatic_occupation_tries_native_intermediate_before_canonical_minimum() {
        let mut r = request();
        r.culture.pack = "AF-MAG".into();
        r.cadastral = rectangle(0., 0., 12., 16.);
        r.buildable = union(&rectangle(0., 0., 12., 4.), &rectangle(2., 4., 8., 12.));
        r.placement_hint = Some(rectangle(2., 4., 8., 12.));
        r.accesses[0].segment = [point(0., 16.), point(12., 16.)];
        let mut config = HouseConfig {
            recipe: Some("AF-MAG-B01".into()),
            ..HouseConfig::default()
        };
        config.overrides.variant = Some("default".into());
        config.overrides.floors = Some(1);
        r.config = Some(config);
        r.occupation = Some(ArchitectureOccupation {
            coverage: 0.95,
            frontage_m: 100.,
            depth_m: 100.,
        });
        let result = run(r.clone());
        assert_eq!(result.buildings.len(), 1, "{:?}", result.refusals);
        let b = &result.buildings[0];
        assert!(
            b.diagnostics
                .iter()
                .any(|d| d.contains("Native intermediate dimensions")),
            "{:?}",
            b.diagnostics
        );
        assert!(contains(&r.buildable, &b.footprint));
        assert!(b.resolved.parameters.width_m[0] > 5. && b.resolved.parameters.width_m[0] < 9.);
        assert!(b.resolved.parameters.depth_m[0] > 7. && b.resolved.parameters.depth_m[0] < 12.);
        enrich_placement(b.clone()).expect("The intermediate native plan must enrich exactly");
    }
    #[test]
    fn houses_configuration_is_explicit_scoped_and_preserved() {
        let mut model = HouseConfig {
            pack: "EUR-MED".into(),
            recipe: Some("EUR-MED-B01".into()),
            seed: "bench-model".into(),
            count: 10,
            ..HouseConfig::default()
        };
        model.overrides.floors = Some(1);
        model.variation = 0.;
        model.wealth = 1.;
        model.size = 1.2;
        let mut r = request();
        r.placement_hint = Some(rectangle(0.3, 0.3, 40., 40.));
        r.occupation = Some(ArchitectureOccupation {
            coverage: 0.01,
            frontage_m: 1.,
            depth_m: 1.,
        });
        let run_model = |r: PlacementRequest, config: HouseConfig, floors: Option<u32>| {
            place_batch(PlacementBatchRequest {
                schema_version: "1".into(),
                requests: vec![r],
                settings: Some(PlacementBatchSettings {
                    parcel_fit: None,
                    house_config: Some(config),
                    floors,
                    typology: None,
                }),
            })
            .unwrap()
        };
        let result = run_model(r.clone(), model.clone(), None);
        assert_eq!(result.buildings.len(), 1, "{:?}", result.refusals);
        let b = &result.buildings[0];
        assert_eq!(b.recipe_id, "EUR-MED-B01");
        assert_eq!(
            serde_json::to_value(&b.resolved.config.overrides).unwrap(),
            serde_json::to_value(&model.overrides).unwrap()
        );
        assert_eq!(b.resolved.config.seed, r.seed);
        assert_eq!(b.resolved.config.count, 1);
        let mut native_config = model.clone();
        native_config.seed = r.seed.clone();
        native_config.count = 1;
        native_config.orientation_deg = 0.;
        native_config.mode = r.culture.mode;
        let native = resolve_architecture(native_config).unwrap();
        assert_eq!(
            serde_json::to_value(&b.resolved.parameters).unwrap(),
            serde_json::to_value(&native.parameters).unwrap()
        );
        assert_eq!(
            serde_json::to_value(&b.resolved.plan).unwrap(),
            serde_json::to_value(&native.plan).unwrap()
        );
        assert!(
            b.resolved.config.overrides.variant.is_none(),
            "A site witness must not silently pin the explicit model to default."
        );
        enrich_placement(b.clone()).expect("Explicit native Houses geometry must enrich exactly");
        let unit = volume_unit(&native).unwrap();
        let footprint = unite(
            &unit
                .bodies
                .iter()
                .flat_map(|body| body.levels.iter().map(|level| level.footprint.clone()))
                .collect::<Vec<_>>(),
        );
        let span = bounds(&footprint);
        let narrow = (span[2] - span[0]).min(span[3] - span[1]) * 0.5;
        let mut too_small = r.clone();
        too_small.cadastral = rectangle(0., 0., narrow, narrow);
        too_small.buildable = too_small.cadastral.clone();
        too_small.placement_hint = None;
        too_small.accesses[0].segment = [point(0., narrow), point(narrow, narrow)];
        assert!(
            run_model(too_small, model.clone(), None)
                .buildings
                .is_empty(),
            "An explicit model cannot be fitted or canonicalized to a smaller domain"
        );
        let conflict = run_model(r.clone(), model.clone(), Some(2));
        assert_eq!(conflict.refusals[0].code, "house_config_floor_conflict");
        model.pack = "AF-MAG".into();
        let mismatch = run_model(r.clone(), model.clone(), None);
        assert_eq!(mismatch.refusals[0].code, "house_config_pack_mismatch");
        r.function = ArchitectureFunction::Workshop;
        r.placement_hint = None;
        let independent = run_model(r, model, None);
        assert_eq!(independent.buildings.len(), 1, "{:?}", independent.refusals);
        assert!(
            independent.buildings[0]
                .diagnostics
                .iter()
                .any(|s| s.contains("scoped to domestic/mixed"))
        );
    }
    #[test]
    fn free_workshop_model_is_exact_explicit_fantasy_and_site_bounded() {
        let model = HouseConfig {
            pack: "atelier".into(),
            mode: HistoricalMode::FantasyMix,
            workshop: Some(crate::workshop::WorkshopRequest {
                preset_id: "WORKSHOP-FP-RECT".into(),
                width_m: Some(18.),
                depth_m: Some(24.),
                ..crate::workshop::WorkshopRequest::default()
            }),
            ..HouseConfig::default()
        };
        let mut r = request();
        r.culture.mode = HistoricalMode::FantasyMix;
        r.occupation = Some(ArchitectureOccupation {
            coverage: 0.01,
            frontage_m: 1.,
            depth_m: 1.,
        });
        let run_model = |r: PlacementRequest, config: HouseConfig| {
            place_batch(PlacementBatchRequest {
                schema_version: "1".into(),
                requests: vec![r],
                settings: Some(PlacementBatchSettings {
                    parcel_fit: None,
                    house_config: Some(config),
                    ..PlacementBatchSettings::default()
                }),
            })
            .unwrap()
        };
        let result = run_model(r.clone(), model.clone());
        assert_eq!(result.buildings.len(), 1, "{:?}", result.refusals);
        let b = &result.buildings[0];
        assert_eq!(b.recipe_id, "WORKSHOP-FP-RECT");
        assert_eq!(b.resolved.config.pack, "atelier");
        assert_eq!(
            b.culture.pack, "EUR-MED",
            "Site culture must not be fabricated from a free preset"
        );
        let mut native_config = model.clone();
        native_config.seed = r.seed.clone();
        native_config.count = 1;
        let native = resolve_architecture(native_config).unwrap();
        assert_eq!(native.parameters.width_m, [18.; 2]);
        assert_eq!(native.parameters.depth_m, [24.; 2]);
        assert_eq!(
            serde_json::to_value(&b.resolved.parameters).unwrap(),
            serde_json::to_value(&native.parameters).unwrap()
        );
        assert_eq!(
            serde_json::to_value(&b.resolved.plan).unwrap(),
            serde_json::to_value(&native.plan).unwrap()
        );
        enrich_placement(b.clone())
            .expect("The real native free workshop model must enrich exactly");
        let mut historical_site = r.clone();
        historical_site.culture.mode = HistoricalMode::HistoricalInspired;
        assert_eq!(
            run_model(historical_site, model.clone()).refusals[0].code,
            "house_config_workshop_mode"
        );
        let mut historical_model = model.clone();
        historical_model.mode = HistoricalMode::HistoricalInspired;
        assert_eq!(
            run_model(r.clone(), historical_model).refusals[0].code,
            "house_config_workshop_mode"
        );
        r.cadastral = rectangle(0., 0., 10., 10.);
        r.buildable = r.cadastral.clone();
        r.accesses[0].segment = [point(0., 10.), point(10., 10.)];
        assert!(
            run_model(r, model).buildings.is_empty(),
            "Free workshop dimensions must not be fitted to the parcel"
        );
    }
    #[test]
    fn enrichment_rejects_changed_stored_roof_even_with_unchanged_resolved_plan() {
        let result = run(request());
        assert_eq!(result.buildings.len(), 1, "{:?}", result.refusals);
        let mut building = result.buildings[0].clone();
        enrich_placement(building.clone())
            .expect("The current stored native roof must enrich exactly");
        let resolved = serde_json::to_value(&building.resolved).unwrap();
        // Simulate an old stored overhang while retaining the original source
        // plan, parameters and transform. This must never silently rebuild it.
        building.volumes[0].roof_mesh.vertices[0].x += 0.25;
        assert_eq!(serde_json::to_value(&building.resolved).unwrap(), resolved);
        assert!(
            enrich_placement(building)
                .unwrap_err()
                .contains("Stored city roof geometry")
        );
    }
    #[test]
    fn placement_retains_native_levels_and_physical_ground() {
        let first = run(request());
        assert!(first.refusals.is_empty(), "{:?}", first.refusals);
        let building = &first.buildings[0];
        assert_eq!(building.ground_z_m, 143.);
        assert!(contains(&request().buildable, &building.footprint));
        assert!(
            building
                .volumes
                .iter()
                .all(|v| v.z_m >= 143. && v.levels.iter().all(|l| l.z_m >= 143.))
        );
        assert!(
            building
                .volumes
                .iter()
                .any(|v| !v.roof_mesh.faces.is_empty())
        );
        assert_eq!(
            serde_json::to_string(&first).unwrap(),
            serde_json::to_string(&run(request())).unwrap()
        );
        let detailed = enrich_placement(building.clone()).unwrap();
        let retained = building.resolved.entrance.as_ref().unwrap();
        assert_eq!(
            building.entrance,
            world_point(
                point(
                    (retained.opening[0].x + retained.opening[1].x) * 0.5,
                    (retained.opening[0].y + retained.opening[1].y) * 0.5,
                ),
                &building.transform
            ),
            "An unenclosed house retains the same body/public entrance identity."
        );
        for (body, volume) in detailed.units[0].bodies.iter().zip(&building.volumes) {
            assert_eq!(
                world_surface(&body.footprint, &building.transform),
                volume.footprint
            );
            for (level, placed) in body.levels.iter().zip(&volume.levels) {
                assert_eq!(
                    world_surface(&level.footprint, &building.transform),
                    placed.footprint
                );
                assert_eq!(143. + level.z_m, placed.z_m);
                assert_eq!(level.height_m, placed.height_m);
            }
        }
    }
    #[test]
    fn concave_holes_reserves_and_access_are_never_clipped() {
        let mut r = request();
        r.cadastral = difference(&r.cadastral, &rectangle(0., 0., 45., 30.));
        r.cadastral = difference(&r.cadastral, &rectangle(50., 10., 10., 10.));
        r.buildable = r.cadastral.clone();
        r.reserves = rectangle(0., 0., 20., 60.);
        let result = run(r.clone());
        assert!(result.refusals.is_empty(), "{:?}", result.refusals);
        let b = &result.buildings[0];
        assert!(contains(&r.cadastral, &b.footprint));
        assert!(contains(&r.cadastral, &b.circulation));
        assert!(area(&intersection(&b.footprint, &r.reserves)) < 0.0001);
        let mut impossible = request();
        impossible.buildable = rectangle(0., 0., 0.5, 0.5);
        let result = run(impossible);
        assert!(result.buildings.is_empty());
        assert!(result.refusals[0].attempts <= 108);
        let mut inaccessible = request();
        inaccessible.accesses.clear();
        assert_eq!(run(inaccessible).refusals[0].code, "no_access");
    }
    #[test]
    fn slope_and_water_are_explicit_physical_refusals() {
        let mut slope = request();
        slope.terrain.gradient = [0.3, 0.];
        assert_eq!(run(slope).refusals[0].code, "slope_exceeded");
        let mut water = request();
        water.terrain.water_z_m = Some(150.);
        assert_eq!(run(water).refusals[0].code, "water_conflict");
        let mut gentle = request();
        gentle.terrain.gradient = [0.005, 0.];
        let result = run(gentle);
        assert!(result.refusals.is_empty(), "{:?}", result.refusals);
        assert!(
            result.buildings[0]
                .volumes
                .iter()
                .all(|v| v.foundation.z_max_m > v.foundation.z_min_m)
        );
    }
    #[test]
    fn physical_grid_finds_an_interior_peak_not_visible_at_footprint_corners() {
        let mut terrain = request().terrain;
        terrain.grid = Some(GroundGrid {
            origin: point(0., 0.),
            step_m: 10.,
            width: 3,
            height: 3,
            elevations_m: vec![143., 143., 143., 143., 144., 143., 143., 143., 143.],
        });
        let (low, high, slope) = terrain
            .foundation_bounds(&rectangle(5., 5., 10., 10.))
            .unwrap();
        assert_eq!(high, 144.);
        assert!((low - 143.25).abs() < 1e-6);
        assert!(slope < 12.);
        assert!(
            terrain
                .foundation_bounds(&rectangle(-1., 0., 2., 2.))
                .is_err()
        );
    }
    #[test]
    fn native_roof_projection_is_united_before_world_rotation() {
        let input: PlacementBatchRequest =
            serde_json::from_str(include_str!("../fixtures/urban-placement-elven.json")).unwrap();
        let result = place_batch(input).unwrap();
        assert_eq!(result.buildings.len(), 2, "{:?}", result.refusals);
        assert!(!result.buildings[0].roof_footprint.is_empty());
    }
    #[test]
    fn real_three_level_house_enriches_after_json_transfer() {
        let resolved: ResolvedArchitecture = serde_json::from_str(include_str!(
            "../fixtures/urban-enrichment-eur-med-b02.json"
        ))
        .unwrap();
        let batch = crate::engine::enrich_architecture(&resolved).unwrap();
        assert_eq!(batch.units[0].bodies[0].levels.len(), 3);
        for (body, spec) in batch.units[0].bodies.iter().zip(&resolved.plan.bodies) {
            assert_eq!(body.footprint, spec.footprint);
            for (level, footprint) in body.levels.iter().zip(&spec.levels) {
                assert_eq!(&level.footprint, footprint);
            }
        }
    }
    #[test]
    fn fragmented_frontage_search_uses_central_legal_contacts() {
        let mut r = request();
        r.cadastral = rectangle(0., 0., 12., 20.);
        r.buildable = rectangle(1., 0., 10., 20.);
        r.accesses = (0..12)
            .map(|i| ArchitectureAccess {
                id: format!("street-fragment-{i}"),
                segment: [point(i as f64, 20.), point(i as f64 + 1., 20.)],
                kind: "public".into(),
                width_m: 2.,
            })
            .collect();
        r.config = Some(HouseConfig {
            recipe: Some("EUR-MED-B01".into()),
            ..HouseConfig::default()
        });
        for seed in 0..12 {
            r.seed = format!("fragmented-frontage-{seed}");
            let result = run(r.clone());
            assert_eq!(
                result.buildings.len(),
                1,
                "seed {seed}: {:?}",
                result.refusals
            );
            assert!(contains(&r.buildable, &result.buildings[0].footprint));
        }
    }
    #[test]
    fn profile_and_function_are_explicit() {
        let profiles = admissibility_profiles().unwrap();
        for pack in &catalogue().unwrap().packs {
            assert!(
                profiles.iter().any(|p| p.pack == pack.id
                    && p.minimum_status == "supported"
                    && p.minimum_domain_m.iter().all(|v| *v > 0.)),
                "{}",
                pack.id
            );
            let mut cultural = request();
            cultural.culture.pack = pack.id.clone();
            let result = run(cultural);
            assert_eq!(
                result.buildings.len(),
                1,
                "{}: {:?}",
                pack.id,
                result.refusals
            );
        }
        let mut warehouse = request();
        warehouse.function = ArchitectureFunction::Warehouse;
        let result = run(warehouse);
        assert!(result.refusals.is_empty(), "{:?}", result.refusals);
        assert_eq!(result.buildings[0].domestic_units, 0);
        assert!(
            result.buildings[0]
                .volumes
                .iter()
                .all(|v| v.role == Role::NonDomestic)
        );
        assert!(enrich_placement(result.buildings[0].clone()).is_err());
        let mut open = request();
        open.function = ArchitectureFunction::OpenSpace;
        open.accesses.clear();
        let result = run(open);
        assert!(result.buildings.is_empty());
        assert_eq!(result.open_spaces.len(), 1);
    }
}
