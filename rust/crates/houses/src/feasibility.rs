//! Offline recipe × variant feasibility metadata for urban preselection.
//!
//! This is a source contract plus a reproducible minimum native witness, not a
//! certificate that a parcel, terrain or another random draw admits a building.
use crate::admission::{minimum_native_envelope, minimum_native_seed};
use crate::catalogue::{Layout, SupportKind, Temporal};
use crate::model::Role;
use crate::placement::MAX_LEVEL_FOUNDATION_SLOPE_DEG;
use crate::style_index::{
    Morphology, StyleCapabilities, StyleConstraints, StyleEntry, style_index,
};
use serde::Serialize;

pub const FEASIBILITY_SCHEMA_VERSION: &str = "recipe-feasibility-1";

#[derive(Debug, Serialize)]
pub struct NativeMinimumWitness {
    pub status: &'static str,
    /// Bounds of the complete frozen skeleton, in its local frame; no solver
    /// side clearance. Null means the native skeleton refused construction.
    pub envelope_m: Option<[f64; 2]>,
    pub access_width_m: Option<f64>,
    pub seed: String,
    pub refusal: Option<String>,
    pub basis: &'static str,
}

#[derive(Debug, Serialize)]
pub struct TerrainFeasibility {
    /// Current level-foundation solver bound, not a recipe's historical slope.
    pub max_level_foundation_slope_deg: f64,
    /// Deliberately no numeric default: the site supplies this physical limit.
    pub max_foundation_step_m: Option<f64>,
    pub foundation_step_source: &'static str,
    pub exact_checks_required: &'static [&'static str],
}

#[derive(Debug, Serialize)]
pub struct RecipeFeasibilityProfile {
    pub style_id: &'static str,
    pub recipe_id: &'static str,
    pub variant_id: &'static str,
    pub pack: &'static str,
    pub tradition_id: Option<&'static str>,
    pub inspired_only: bool,
    pub temporal: &'static Temporal,
    pub role: Role,
    pub layout: Layout,
    pub morphology: Morphology,
    pub footprint_family: &'static str,
    pub roof_system: &'static str,
    pub support_kind: SupportKind,
    pub support_height_m: [f64; 2],
    /// Authored nominal main dimensions, not the full compound's frontage/depth.
    pub nominal_width_m: [f64; 2],
    pub nominal_depth_m: [f64; 2],
    /// Intersection with the primary residential component; tower floors do not
    /// raise this bound. Null denotes an empty compatible source intersection.
    pub primary_floors: Option<[u32; 2]>,
    pub requires_access: bool,
    pub party_walls_declared: bool,
    pub party_wall_basis: &'static str,
    /// Uses the same native predicates as the cached style index. No urban
    /// preference ranking is converted into a functional capability.
    pub capabilities: StyleCapabilities,
    pub constrained_components: bool,
    pub source_constraints: &'static StyleConstraints,
    pub minimum_native: NativeMinimumWitness,
    pub terrain: TerrainFeasibility,
    /// No recipe currently declares a certified household occupation contract.
    /// Body, room and cell counts must never be converted to households.
    pub household_range: Option<[u32; 2]>,
    pub placement_certified: bool,
    pub provenance: &'static str,
}

/// Evaluate one exact indexed bundle, including its variant parameters.
pub fn feasibility_for_style(entry: &'static StyleEntry) -> RecipeFeasibilityProfile {
    let parameters = entry.parameters();
    // Preserve the existing admission witness for default bundles. Variants
    // have a distinct deterministic seed and use their own full parameters.
    let seed = minimum_native_seed(entry.recipe(), parameters);
    let (status, envelope_m, access_width_m, refusal) =
        match minimum_native_envelope(entry.recipe(), parameters, &seed) {
            Ok((envelope, access)) => ("supported", Some(envelope), Some(access), None),
            Err(reason) => ("refused", None, None, Some(reason)),
        };
    let floors = crate::programme::primary_floors(parameters);
    RecipeFeasibilityProfile {
        style_id: &entry.id,
        recipe_id: entry.recipe_id,
        variant_id: entry.variant_id,
        pack: entry.pack_id,
        tradition_id: entry.tradition_id,
        inspired_only: entry.inspired_only,
        temporal: entry.temporal,
        role: entry.role,
        layout: entry.layout,
        morphology: entry.morphology,
        footprint_family: entry.footprint_family,
        roof_system: entry.roof_system,
        support_kind: parameters.support.kind,
        support_height_m: parameters.support.height_m,
        nominal_width_m: parameters.width_m,
        nominal_depth_m: parameters.depth_m,
        primary_floors: (floors[0] > 0 && floors[0] <= floors[1]).then_some(floors),
        requires_access: true,
        party_walls_declared: parameters
            .details
            .iter()
            .any(|detail| detail == "party_walls"),
        party_wall_basis: "Explicit variant parameters.details declaration; does not authorize a supplied shared cadastral boundary.",
        capabilities: entry.capabilities,
        constrained_components: crate::morphology::supports_components(parameters),
        source_constraints: &entry.constraints,
        minimum_native: NativeMinimumWitness {
            status,
            envelope_m,
            access_width_m,
            seed,
            refusal,
            basis: "One native layout at frozen range minima, including body levels, courts, circulation, structural features/supports, roof projection and entrance passage; not a universal minimum or an envelope for all seeds and draws; no interiors.",
        },
        terrain: TerrainFeasibility {
            max_level_foundation_slope_deg: MAX_LEVEL_FOUNDATION_SLOPE_DEG,
            max_foundation_step_m: None,
            foundation_step_source: "request.terrain.max_foundation_step_m",
            exact_checks_required: &[
                "physical terrain samples and coverage",
                "foundation level range against the request limit",
                "cadastral/buildable polygons and holes",
                "roof domain and overhangs",
                "access and circulation",
                "neighbours and structural supports",
                "imposed footprint when supplied",
            ],
        },
        household_range: None,
        placement_certified: false,
        provenance: "Catalogue/style-index bundle and shared admission native skeleton; numeric bounds are preselection evidence only. Exact resolved placement remains mandatory.",
    }
}

/// Every authored bundle, including non-residential and non-default variants.
/// A refused witness remains visible with its reason instead of being dropped.
pub fn feasibility_profiles() -> Result<Vec<RecipeFeasibilityProfile>, String> {
    Ok(style_index()?
        .entries
        .iter()
        .map(feasibility_for_style)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feasibility_preserves_variant_bounds_native_witnesses_and_unknown_occupancy() {
        let index = style_index().unwrap();
        let default = index.get("AS-ISL-B14::default").unwrap();
        let variant = index.get("EUR-MED-B07::flat_stone").unwrap();
        let tower = index.get("EUR-MED-B07::default").unwrap();
        let non_domestic = index
            .entries
            .iter()
            .find(|entry| !entry.role.residential())
            .unwrap();
        for entry in [default, variant, tower, non_domestic] {
            let profile = feasibility_for_style(entry);
            assert_eq!(profile.style_id, entry.id);
            assert_eq!(profile.variant_id, entry.variant_id);
            assert_eq!(profile.nominal_width_m, entry.parameters().width_m);
            assert_eq!(profile.nominal_depth_m, entry.parameters().depth_m);
            assert_eq!(
                profile.capabilities.constrained_composition,
                crate::morphology::supports(entry.parameters())
            );
            assert_eq!(
                profile.capabilities.imposed_orthogonal_footprint,
                crate::morphology::supports_imposed(entry.parameters())
            );
            assert_eq!(
                profile.terrain.max_level_foundation_slope_deg,
                MAX_LEVEL_FOUNDATION_SLOPE_DEG
            );
            assert_eq!(
                profile.terrain.foundation_step_source,
                "request.terrain.max_foundation_step_m"
            );
            assert!(profile.terrain.max_foundation_step_m.is_none());
            assert!(profile.household_range.is_none());
            assert!(!profile.placement_certified);
            let json = serde_json::to_value(&profile).unwrap();
            assert!(json["household_range"].is_null());
            assert_eq!(profile.support_kind, entry.parameters().support.kind);
            assert_eq!(
                profile.support_height_m,
                entry.parameters().support.height_m
            );
            if profile.minimum_native.status == "supported" {
                assert!(
                    profile
                        .minimum_native
                        .envelope_m
                        .unwrap()
                        .iter()
                        .all(|v| v.is_finite() && *v > 0.)
                );
                assert!(profile.minimum_native.access_width_m.unwrap() > 0.);
                assert!(profile.minimum_native.refusal.is_none());
            } else {
                assert_eq!(profile.minimum_native.status, "refused");
                assert!(profile.minimum_native.envelope_m.is_none());
                assert!(profile.minimum_native.access_width_m.is_none());
                assert!(
                    !profile
                        .minimum_native
                        .refusal
                        .as_deref()
                        .unwrap()
                        .is_empty()
                );
            }
        }
        let profile = feasibility_for_style(default);
        assert_eq!(profile.tradition_id, Some("javanese"));
        assert!(profile.inspired_only);
        assert_eq!(profile.minimum_native.seed, "urban-admission-v1:AS-ISL-B14");
        assert_ne!(
            feasibility_for_style(variant).minimum_native.seed,
            feasibility_for_style(tower).minimum_native.seed
        );
        assert_eq!(feasibility_for_style(variant).roof_system, "RF-FLAT");
        assert_eq!(feasibility_for_style(tower).roof_system, "RF-GABLE");
        // Independent regression witness: preserve the previously exported
        // residential envelope instead of deriving expectations with the same helper.
        let legacy: serde_json::Value =
            serde_json::from_str(include_str!("../data/urban-admission.json")).unwrap();
        let saved = legacy["profiles"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["recipe_id"] == tower.recipe_id)
            .unwrap();
        let current = feasibility_for_style(tower);
        assert_eq!(saved["status"], current.minimum_native.status);
        for (actual, expected) in current
            .minimum_native
            .envelope_m
            .unwrap()
            .into_iter()
            .zip(saved["min_envelope_m"].as_array().unwrap())
        {
            assert!((actual - expected.as_f64().unwrap()).abs() < 1e-9);
        }
        assert!(
            (current.minimum_native.access_width_m.unwrap()
                - saved["min_access_width_m"].as_f64().unwrap())
            .abs()
                < 1e-9
        );
        assert_eq!(
            feasibility_for_style(tower).primary_floors,
            Some(crate::programme::primary_floors(tower.parameters()))
        );
    }
}
