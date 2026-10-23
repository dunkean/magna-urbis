//! Reusable, local native admission witnesses, cached only by declared style.
//!
//! A witness is one frozen source minimum at size 1, not a resolved user request
//! and not a placement certificate. Consumers must check every explicit pin,
//! override, floor requirement and historical constraint before accepting it.
//! No site, request seed or user parameter can create a cache entry. Interiors
//! are never generated here; exact parcel/terrain/neighbour checks remain due.
use crate::admission::{minimum_native_seed, minimum_native_skeleton};
use crate::catalogue::{Parameters, Placement};
use crate::compact::CompactArchitecture;
use crate::engine::ResolvedArchitecture;
use crate::model::{Feature, FeatureKind, HouseUnit, Point, Role, Surface};
use crate::style_index::{STYLE_INDEX_VERSION, StyleEntry, style_index};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, VecDeque};
use std::sync::{Arc, Mutex, OnceLock};

pub const ADMISSION_WITNESS_VERSION: &str = "native-admission-witness-1";
pub const MAX_CACHED_WITNESSES: usize = 16;
/// Exact complete JSON transport bytes, not a claimed Rust heap measurement.
pub const MAX_CACHED_WITNESS_TRANSPORT_BYTES: usize = 32 * 1024 * 1024;

/// Identity of the exact compiled source and deterministic native construction.
/// A future pose must retain and validate this identity, not just a recipe ID.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct AdmissionWitnessIdentity {
    pub version: String,
    pub catalogue_version: String,
    pub generator_version: String,
    pub style_index_version: String,
    pub source_sha256: String,
    pub style_id: String,
    pub recipe_id: String,
    pub variant_id: String,
    pub seed: String,
}

#[derive(Clone, Debug, Serialize)]
pub struct WitnessLevelGeometry {
    pub level: u32,
    pub z_m: f64,
    pub height_m: f64,
    pub footprint: Surface,
}

#[derive(Clone, Debug, Serialize)]
pub struct WitnessBodyGeometry {
    pub body_id: String,
    pub component_id: Option<String>,
    pub role: Role,
    pub footprint: Surface,
    pub levels: Vec<WitnessLevelGeometry>,
}

/// Includes every native feature, with its actual kind, instead of guessing
/// support domains from a bounding rectangle or silently dropping other solids.
#[derive(Clone, Debug, Serialize)]
pub struct WitnessFeatureGeometry {
    pub feature_id: String,
    pub kind: FeatureKind,
    pub surface: Surface,
    pub z_m: f64,
    pub height_m: f64,
}

#[derive(Clone, Debug, Serialize)]
pub struct AdmissionWitnessGeometry {
    pub bodies: Vec<WitnessBodyGeometry>,
    /// Non-zero projected native roof faces, retaining their exact polygons.
    pub roof_projection: Vec<Surface>,
    /// All structural features, including posts, piers, rafts and footings.
    pub supports_and_features: Vec<WitnessFeatureGeometry>,
    pub courts: Surface,
    pub circulation: Surface,
    /// Concatenated native level, court, path, entry, feature and roof polygons.
    /// These may overlap: this is an exact containment domain, not an area sum.
    pub domains: Surface,
}

/// The native body entrance, not a guessed frontage or a certified street link.
#[derive(Clone, Debug, Serialize)]
pub struct AdmissionWitnessEntrance {
    pub opening: [Point; 2],
    pub passage: Surface,
    pub width_m: f64,
    pub from_z_m: f64,
    pub to_z_m: f64,
}

#[derive(Clone, Serialize)]
pub struct AdmissionWitness {
    pub identity: AdmissionWitnessIdentity,
    pub resolved: ResolvedArchitecture,
    /// Packed once per witness. A successful pose clones this retained record
    /// instead of repeating parameter serialization, deltas and interning.
    pub packed: CompactArchitecture,
    /// Reuse this structure for candidate poses; do not call volume_unit again.
    /// Contains structural access/roofs, but no interior room subdivision.
    pub structural_unit: HouseUnit,
    /// Exact structures after native gate cuts, shared with ordinary placement.
    pub site_features: Vec<Feature>,
    /// Native unions, prepared once in local coordinates, never per candidate.
    pub body_footprint: Surface,
    pub roof_footprint: Surface,
    pub bearing_domain: Surface,
    /// Wall solids at the native site-entry walking height (after gate cuts).
    pub entry_wall_solids: Surface,
    pub geometry: AdmissionWitnessGeometry,
    pub entrance: AdmissionWitnessEntrance,
    /// Native perimeter gate where present, otherwise the body entrance.
    /// Its passage remains a separate exact access domain to check on site.
    pub site_entry: AdmissionWitnessEntrance,
    /// [min_x, min_y, max_x, max_y] in the unshifted native local frame.
    /// These preserve the previously exported admission witness bounds.
    pub local_bounds_m: [f64; 4],
    /// Bounds additionally including the separately retained site-entry passage.
    pub site_bounds_m: [f64; 4],
    pub envelope_m: [f64; 2],
    pub access_width_m: f64,
    /// Frozen source width/depth, distinct from the complete compound envelope.
    pub nominal_dimensions_m: [f64; 2],
    /// Actual native principal-body storeys, never the compatible source range
    /// or tower maximum. Null if a primary body/count cannot be identified.
    /// This is structural storeys, not household or person capacity.
    pub primary_floors: Option<u32>,
}

impl AdmissionWitness {
    /// Exact frozen parameters, including all component ranges and materials.
    pub fn parameters(&self) -> &Parameters {
        &self.resolved.parameters
    }
}

impl From<&crate::access::StructuralEntrance> for AdmissionWitnessEntrance {
    fn from(entrance: &crate::access::StructuralEntrance) -> Self {
        Self {
            opening: entrance.opening,
            passage: entrance.passage.clone(),
            width_m: entrance.width_m,
            from_z_m: entrance.from_z_m,
            to_z_m: entrance.to_z_m,
        }
    }
}

struct CachedWitness {
    style_id: &'static str,
    witness: Arc<AdmissionWitness>,
    transport_bytes: usize,
}

struct WitnessCache {
    /// Least recently used first. Only cached successful witnesses count here.
    successes: VecDeque<CachedWitness>,
    /// Keys must come from the fixed declared index, never from arbitrary input.
    refusals: BTreeMap<&'static str, String>,
    transport_bytes: usize,
    max_successes: usize,
    max_transport_bytes: usize,
}

impl WitnessCache {
    fn new(max_successes: usize, max_transport_bytes: usize) -> Self {
        Self {
            successes: VecDeque::new(),
            refusals: BTreeMap::new(),
            transport_bytes: 0,
            max_successes,
            max_transport_bytes,
        }
    }

    fn get_or_build(
        &mut self,
        entry: &'static StyleEntry,
        build: impl FnOnce(&'static StyleEntry) -> Result<Arc<AdmissionWitness>, String>,
    ) -> Result<Arc<AdmissionWitness>, String> {
        if let Some(position) = self
            .successes
            .iter()
            .position(|item| item.style_id == entry.id)
        {
            let item = self.successes.remove(position).unwrap();
            let witness = Arc::clone(&item.witness);
            self.successes.push_back(item);
            return Ok(witness);
        }
        if let Some(reason) = self.refusals.get(entry.id.as_str()) {
            return Err(reason.clone());
        }
        let result = (|| {
            let witness = build(entry)?;
            // Count every serialized witness field, including resolved, unit,
            // geometry, all unions and packed. No heavy field may be skipped.
            let bytes = serialized_transport_bytes(witness.as_ref())?;
            if self.max_successes == 0 || bytes > self.max_transport_bytes {
                return Err(format!(
                    "Native minimum witness {} requires {bytes} complete serialized transport bytes; optional witness-cache limit is {} bytes / {} entries. Other placement paths remain available.",
                    entry.id, self.max_transport_bytes, self.max_successes,
                ));
            }
            while self.successes.len() >= self.max_successes
                || self.transport_bytes > self.max_transport_bytes - bytes
            {
                let evicted = self.successes.pop_front().unwrap();
                self.transport_bytes -= evicted.transport_bytes;
            }
            self.transport_bytes += bytes;
            self.successes.push_back(CachedWitness {
                style_id: entry.id.as_str(),
                witness: Arc::clone(&witness),
                transport_bytes: bytes,
            });
            Ok(witness)
        })();
        if let Err(reason) = &result {
            self.refusals.insert(entry.id.as_str(), reason.clone());
        }
        result
    }
}

/// Counting writer avoids allocating a second complete serialized payload.
fn serialized_transport_bytes(witness: &AdmissionWitness) -> Result<usize, String> {
    struct Counter(usize);
    impl std::io::Write for Counter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            self.0 = self
                .0
                .checked_add(bytes.len())
                .ok_or_else(|| std::io::Error::other("Witness transport byte count overflow."))?;
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut counter = Counter(0);
    serde_json::to_writer(&mut counter, witness)
        .map_err(|e| format!("Native witness transport serialization: {e}"))?;
    Ok(counter.0)
}

// Construction under this lock prevents duplicate expensive skeletons. The
// cache owns <=16 successes and <=32MiB of measured complete transport content.
// Rust heap, construction temporaries and external Arc holders are distinct:
// an evicted witness is freed when its last caller releases it.
static CACHE: OnceLock<Mutex<WitnessCache>> = OnceLock::new();
static SOURCE_SHA256: OnceLock<String> = OnceLock::new();

pub fn admission_witness_source_sha256() -> &'static str {
    SOURCE_SHA256.get_or_init(|| {
        format!(
            "{:x}",
            Sha256::digest(include_bytes!("../data/recipes.json"))
        )
    })
}

fn declared_style(style_id: &str) -> Result<&'static StyleEntry, String> {
    style_index()?
        .get(style_id)
        .ok_or_else(|| format!("Unknown declared admission style: {style_id}"))
}

fn identity_for_style(entry: &'static StyleEntry) -> Result<AdmissionWitnessIdentity, String> {
    Ok(AdmissionWitnessIdentity {
        version: ADMISSION_WITNESS_VERSION.into(),
        catalogue_version: style_index()?.catalogue_version.into(),
        generator_version: crate::GENERATOR_VERSION.into(),
        style_index_version: STYLE_INDEX_VERSION.into(),
        source_sha256: admission_witness_source_sha256().into(),
        style_id: entry.id.clone(),
        recipe_id: entry.recipe_id.into(),
        variant_id: entry.variant_id.into(),
        seed: minimum_native_seed(entry.recipe(), entry.parameters()),
    })
}

/// Cheap source identity check: no native skeleton or witness-cache allocation.
pub fn witness_identity(style_id: &str) -> Result<AdmissionWitnessIdentity, String> {
    identity_for_style(declared_style(style_id)?)
}

/// Return a shared immutable witness, reusing it while retained by the LRU.
/// Native/size refusals are cached only for declared styles. Unknown inputs
/// never insert keys. Oversized witnesses are refused, never leaked uncached.
/// This function neither validates nor alters a caller's request constraints.
pub fn cached_admission_witness(style_id: &str) -> Result<Arc<AdmissionWitness>, String> {
    let entry = declared_style(style_id)?;
    CACHE
        .get_or_init(|| {
            Mutex::new(WitnessCache::new(
                MAX_CACHED_WITNESSES,
                MAX_CACHED_WITNESS_TRANSPORT_BYTES,
            ))
        })
        .lock()
        .map_err(|_| "Native witness cache lock poisoned.".to_string())?
        .get_or_build(entry, |entry| build_witness(entry).map(Arc::new))
}

fn build_witness(entry: &'static StyleEntry) -> Result<AdmissionWitness, String> {
    let identity = identity_for_style(entry)?;
    let skeleton = minimum_native_skeleton(entry.recipe(), entry.parameters(), &identity.seed)?;
    let parameters = &skeleton.resolved.parameters;
    let site_entry =
        crate::access::structural_site_entry(&skeleton.unit, parameters, &skeleton.entrance)?;
    let primary_floors = native_primary_floors(parameters, &skeleton.unit);
    let site_features = crate::placement::native_site_features(&skeleton.unit);
    let body_parts: Vec<_> = skeleton
        .unit
        .bodies
        .iter()
        .flat_map(|body| body.levels.iter().map(|level| level.footprint.clone()))
        .collect();
    let body_footprint = crate::geometry::unite(&body_parts);
    let roof_footprint = crate::placement::projected_roof_union(&skeleton.roof_projection);
    let mut bearing_parts = vec![body_footprint.clone()];
    bearing_parts.extend(site_features.iter().map(|feature| feature.surface.clone()));
    let bearing_domain = crate::geometry::unite(&bearing_parts);
    let entry_wall_solids = crate::geometry::unite(
        &skeleton
            .unit
            .walls
            .iter()
            .map(|wall| crate::wall_geometry::wall_section(wall, site_entry.from_z_m + 0.01))
            .collect::<Vec<_>>(),
    );
    let mut domains: Surface = body_parts.into_iter().flatten().collect();
    domains.extend(skeleton.resolved.plan.courts.clone());
    domains.extend(skeleton.resolved.plan.paths.clone());
    domains.extend(skeleton.entrance.passage.clone());
    domains.extend(
        site_features
            .iter()
            .flat_map(|feature| feature.surface.clone()),
    );
    domains.extend(skeleton.roof_projection.iter().flatten().cloned());
    let gate_bounds = crate::geometry::bounds(&site_entry.passage);
    let site_bounds_m = [
        skeleton.bounds_m[0].min(gate_bounds[0]),
        skeleton.bounds_m[1].min(gate_bounds[1]),
        skeleton.bounds_m[2].max(gate_bounds[2]),
        skeleton.bounds_m[3].max(gate_bounds[3]),
    ];
    let nominal_dimensions_m = [parameters.width_m[0], parameters.depth_m[0]];
    let packed = CompactArchitecture::pack(&skeleton.resolved)?;
    let geometry = AdmissionWitnessGeometry {
        bodies: skeleton
            .unit
            .bodies
            .iter()
            .map(|body| WitnessBodyGeometry {
                body_id: body.id.clone(),
                component_id: body.component_id.clone(),
                role: body.role,
                footprint: body.footprint.clone(),
                levels: body
                    .levels
                    .iter()
                    .map(|level| WitnessLevelGeometry {
                        level: level.index,
                        z_m: level.z_m,
                        height_m: level.height_m,
                        footprint: level.footprint.clone(),
                    })
                    .collect(),
            })
            .collect(),
        roof_projection: skeleton.roof_projection,
        supports_and_features: site_features
            .iter()
            .map(|feature| WitnessFeatureGeometry {
                feature_id: feature.id.clone(),
                kind: feature.kind,
                surface: feature.surface.clone(),
                z_m: feature.z_m,
                height_m: feature.height_m,
            })
            .collect(),
        courts: skeleton.resolved.plan.courts.clone(),
        circulation: skeleton.resolved.plan.paths.clone(),
        domains,
    };
    Ok(AdmissionWitness {
        identity,
        resolved: skeleton.resolved,
        packed,
        structural_unit: skeleton.unit,
        site_features,
        body_footprint,
        roof_footprint,
        bearing_domain,
        entry_wall_solids,
        geometry,
        entrance: (&skeleton.entrance).into(),
        site_entry: (&site_entry).into(),
        local_bounds_m: skeleton.bounds_m,
        site_bounds_m,
        envelope_m: skeleton.envelope_m,
        access_width_m: skeleton.access_width_m,
        nominal_dimensions_m,
        primary_floors,
    })
}

fn native_primary_floors(parameters: &Parameters, unit: &HouseUnit) -> Option<u32> {
    if unit.bodies.len() == 1 {
        return Some(unit.bodies[0].levels.len() as u32).filter(|n| *n > 0);
    }
    // Same source meaning of "primary" as programme::primary_floors, but count
    // retained native levels: freezing independent component minima need not
    // produce the lower end of the parent/component compatible intersection.
    let primary = parameters
        .components
        .iter()
        .filter(|c| c.role.residential() && c.placement != Placement::FacingMain)
        .find(|c| c.placement == Placement::Main)
        .or_else(|| {
            parameters
                .components
                .iter()
                .find(|c| c.role.residential() && c.placement != Placement::FacingMain)
        });
    let mut bodies = unit.bodies.iter().filter(|body| {
        primary.is_none_or(|component| body.component_id.as_deref() == Some(component.id.as_str()))
    });
    let count = bodies.next()?.levels.len() as u32;
    (count > 0 && bodies.all(|body| body.levels.len() as u32 == count)).then_some(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn check_exported_witness(
        style_id: &str,
        minimum_body_count: usize,
        actual_primary_floors: u32,
    ) {
        let saved: serde_json::Value =
            serde_json::from_str(include_str!("../data/urban-admission.json")).unwrap();
        let profile = saved["feasibility"]["profiles"]
            .as_array()
            .unwrap()
            .iter()
            .find(|profile| profile["style_id"] == style_id)
            .unwrap();
        let witness = cached_admission_witness(style_id).unwrap();
        assert!(Arc::ptr_eq(
            &witness,
            &cached_admission_witness(style_id).unwrap()
        ));
        assert!(cached_admission_witness("undeclared-style::default").is_err());
        assert_eq!(witness_identity(style_id).unwrap(), witness.identity);
        assert_eq!(profile["minimum_native"]["status"], "supported");
        assert_eq!(profile["minimum_native"]["seed"], witness.identity.seed);
        assert_eq!(saved["source_sha256"], witness.identity.source_sha256);
        assert_eq!(
            saved["generator_version"],
            witness.identity.generator_version
        );
        assert_eq!(witness.identity.version, ADMISSION_WITNESS_VERSION);
        assert_eq!(witness.identity.style_id, style_id);
        assert_eq!(
            witness.resolved.parameters.variant_id,
            witness.identity.variant_id
        );
        assert_eq!(
            witness.resolved.config.overrides.variant.as_deref(),
            Some(witness.identity.variant_id.as_str())
        );
        assert_eq!(witness.resolved.config.seed, witness.identity.seed);
        assert_eq!(witness.resolved.config.size, 1.);
        let replay = witness.packed.unpack().unwrap();
        assert_eq!(replay.config, witness.resolved.config);
        assert_eq!(
            replay.parameters.width_m,
            witness.resolved.parameters.width_m
        );
        assert_eq!(
            replay.parameters.depth_m,
            witness.resolved.parameters.depth_m
        );
        assert_eq!(
            replay
                .plan
                .bodies
                .iter()
                .map(|body| &body.levels)
                .collect::<Vec<_>>(),
            witness
                .resolved
                .plan
                .bodies
                .iter()
                .map(|body| &body.levels)
                .collect::<Vec<_>>()
        );
        assert_eq!(replay.entrance.unwrap().passage, witness.entrance.passage);
        assert!(witness.structural_unit.rooms.is_empty());
        assert!(witness.geometry.bodies.len() >= minimum_body_count);
        assert!(!witness.geometry.roof_projection.is_empty());
        assert_eq!(
            witness.geometry.bodies.len(),
            witness.structural_unit.bodies.len()
        );
        assert_eq!(
            witness.geometry.supports_and_features.len(),
            witness.site_features.len()
        );
        assert_eq!(
            witness.site_features,
            crate::placement::native_site_features(&witness.structural_unit)
        );
        assert!(crate::geometry::area(&witness.body_footprint) > 0.);
        assert!(crate::geometry::area(&witness.roof_footprint) > 0.);
        assert!(
            crate::geometry::area(&crate::geometry::difference(
                &witness.body_footprint,
                &witness.bearing_domain
            )) < 1e-8
        );
        assert_eq!(witness.geometry.circulation, witness.resolved.plan.paths);
        assert_eq!(
            witness.entrance.passage,
            witness.resolved.entrance.as_ref().unwrap().passage
        );
        assert!(witness.site_entry.width_m >= 0.8);
        assert!(!witness.site_entry.passage.is_empty());
        let mut site_domains = witness.geometry.domains.clone();
        site_domains.extend(witness.site_entry.passage.clone());
        assert_eq!(
            crate::geometry::bounds(&site_domains),
            witness.site_bounds_m
        );
        assert_eq!(
            crate::geometry::bounds(&witness.geometry.domains),
            witness.local_bounds_m
        );
        for (actual, expected) in witness
            .envelope_m
            .into_iter()
            .zip(profile["minimum_native"]["envelope_m"].as_array().unwrap())
        {
            assert!((actual - expected.as_f64().unwrap()).abs() < 1e-9);
        }
        assert!(
            (witness.access_width_m
                - profile["minimum_native"]["access_width_m"]
                    .as_f64()
                    .unwrap())
            .abs()
                < 1e-9
        );
        assert_eq!(witness.primary_floors, Some(actual_primary_floors));
        assert!(profile["household_range"].is_null());
    }

    #[test]
    fn cached_java_witness_matches_exported_minimum() {
        check_exported_witness("AS-ISL-B14::default", 1, 1);
    }

    #[test]
    fn cached_complex_variant_witness_matches_exported_minimum() {
        check_exported_witness("EUR-MED-B07::flat_stone", 2, 1);
        let witness = cached_admission_witness("EUR-MED-B07::flat_stone").unwrap();
        let entry = style_index()
            .unwrap()
            .get("EUR-MED-B07::flat_stone")
            .unwrap();
        assert_eq!(crate::programme::primary_floors(entry.parameters()), [2, 2]);
        assert_eq!(
            witness
                .structural_unit
                .bodies
                .iter()
                .map(|body| body.levels.len())
                .collect::<Vec<_>>(),
            [1, 3]
        );
    }

    #[test]
    fn local_cache_enforces_transport_budget_count_limit_and_lru_without_new_generation() {
        let first_entry = declared_style("AS-ISL-B14::default").unwrap();
        let second_entry = declared_style("EUR-MED-B07::flat_stone").unwrap();
        let first = cached_admission_witness(&first_entry.id).unwrap();
        let second = cached_admission_witness(&second_entry.id).unwrap();
        let first_bytes = serialized_transport_bytes(first.as_ref()).unwrap();
        let second_bytes = serialized_transport_bytes(second.as_ref()).unwrap();
        assert_eq!(
            first_bytes,
            serde_json::to_vec(first.as_ref()).unwrap().len()
        );
        let value = serde_json::to_value(first.as_ref()).unwrap();
        for field in [
            "resolved",
            "packed",
            "structural_unit",
            "site_features",
            "geometry",
            "body_footprint",
            "roof_footprint",
            "bearing_domain",
            "entry_wall_solids",
        ] {
            assert!(
                value.get(field).is_some(),
                "Transport metric omitted heavy field {field}"
            );
        }
        println!(
            "Complete witness transport bytes: Java={first_bytes}, complex={second_bytes}; no heap claim."
        );

        let mut cache = WitnessCache::new(2, first_bytes + second_bytes);
        cache
            .get_or_build(first_entry, |_| Ok(Arc::clone(&first)))
            .unwrap();
        cache
            .get_or_build(second_entry, |_| Ok(Arc::clone(&second)))
            .unwrap();
        let hit = cache
            .get_or_build(first_entry, |_| panic!("Warm cache rebuilt a skeleton"))
            .unwrap();
        assert!(Arc::ptr_eq(&hit, &first));
        assert_eq!(cache.successes.front().unwrap().style_id, second_entry.id);
        assert_eq!(cache.successes.back().unwrap().style_id, first_entry.id);
        assert_eq!(cache.transport_bytes, first_bytes + second_bytes);

        let mut byte_limited = WitnessCache::new(2, first_bytes.max(second_bytes));
        byte_limited
            .get_or_build(first_entry, |_| Ok(Arc::clone(&first)))
            .unwrap();
        byte_limited
            .get_or_build(second_entry, |_| Ok(Arc::clone(&second)))
            .unwrap();
        assert_eq!(byte_limited.successes.len(), 1);
        assert_eq!(
            byte_limited.successes.front().unwrap().style_id,
            second_entry.id
        );
        assert_eq!(byte_limited.transport_bytes, second_bytes);
        // The external holder remains usable after its cache reference is evicted.
        assert_eq!(first.identity.style_id, first_entry.id);

        let mut count_limited = WitnessCache::new(1, first_bytes + second_bytes);
        count_limited
            .get_or_build(first_entry, |_| Ok(Arc::clone(&first)))
            .unwrap();
        count_limited
            .get_or_build(second_entry, |_| Ok(Arc::clone(&second)))
            .unwrap();
        assert_eq!(count_limited.successes.len(), 1);
        assert_eq!(
            count_limited.successes.front().unwrap().style_id,
            second_entry.id
        );

        let mut too_small = WitnessCache::new(2, first_bytes - 1);
        let reason = too_small
            .get_or_build(first_entry, |_| Ok(Arc::clone(&first)))
            .err()
            .expect("Oversized witness was retained");
        assert!(reason.contains("serialized transport bytes"));
        assert!(too_small.successes.is_empty());
        assert_eq!(too_small.transport_bytes, 0);
        assert_eq!(too_small.refusals.len(), 1);
        assert!(
            too_small
                .get_or_build(first_entry, |_| panic!("Cached refusal rebuilt a skeleton"))
                .is_err()
        );
        assert!(
            too_small
                .refusals
                .keys()
                .all(|id| declared_style(id).is_ok())
        );
    }
}
