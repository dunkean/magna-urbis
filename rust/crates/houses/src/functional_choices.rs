//! Explicit inspired uses of existing native envelopes, not historical buildings.
//! Exact city roles opt in; unknown/religious programmes never fall back to a house.
use crate::catalogue::{Envelope, Layout, SourceReference, SupportKind, Temporal, catalogue};
use crate::engine::{ResolvedArchitecture, resolve_urban_architecture};
use crate::geometry::{area, unite};
use crate::model::{HistoricalMode, HouseConfig};
use crate::placement::{ArchitectureFunction, PlacementRequest};
use crate::programme::ProgrammeComposition;
use crate::style_index::{StyleEntry, style_index};
use magna_urbis_random::Rng;
use serde::Serialize;
use std::sync::OnceLock;

pub const FUNCTIONAL_CHOICES_VERSION: &str = "functional-choices-2";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FunctionalEnvelopeUse {
    SharedLodgingEnvelope,
    StorageEnvelope,
}

#[derive(Serialize)]
pub struct FunctionalSource {
    pub style_id: &'static str,
    pub recipe_id: &'static str,
    pub variant_id: &'static str,
    pub tradition_id: &'static str,
    pub source_role: crate::model::Role,
    pub source_confidence: &'static str,
    pub sources: &'static [SourceReference],
    pub temporal: &'static Temporal,
    pub inspired_only: bool,
    pub nominal_width_m: [f64; 2],
    pub nominal_depth_m: [f64; 2],
    pub floors: [u32; 2],
    pub roof_system: &'static str,
}

#[derive(Serialize)]
pub struct FunctionalChoiceRule {
    pub id: &'static str,
    pub culture_id: &'static str,
    pub pack_id: &'static str,
    pub urban_role: &'static str,
    pub function: ArchitectureFunction,
    pub composition: ProgrammeComposition,
    /// Exact compatibility rule for already saved requests; not a current
    /// cultural attribution or permission to emit the old role in new cities.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub legacy_alias_for: Option<&'static str>,
    pub adapter: FunctionalEnvelopeUse,
    pub modes: &'static [HistoricalMode],
    pub sources: Vec<FunctionalSource>,
    pub functional_claim: &'static str,
    pub detailed_interior: bool,
    pub certified_capacity: bool,
}

#[derive(Serialize)]
pub struct FunctionalChoiceRegistry {
    pub version: &'static str,
    pub catalogue_version: &'static str,
    pub rules: Vec<FunctionalChoiceRule>,
}

fn source(entry: &'static StyleEntry) -> Result<FunctionalSource, String> {
    let p = entry.parameters();
    if entry.pack_id != "AS-ISL"
        || entry.tradition_id != Some("javanese")
        || p.layout != Layout::Single
        || p.footprint_family != "FP-RECT"
        || p.envelope != Envelope::Walled
        || p.support.kind != SupportKind::Ground
        || p.bodies != [1, 1]
        || p.floors != [1, 1]
        || p.cells[1] != 0
        || p.components.len() != 1
        || p.components[0].id != "main"
        || p.gallery_cover.enabled
        || !p.enclosures.is_empty()
        || !p.details.is_empty()
        || p.court_program.is_some()
        || p.structural_spec.is_some()
        || p.shell.is_some()
        || !matches!(p.roof_system.as_str(), "RF-GABLE" | "RF-HIP")
    {
        return Err(format!(
            "Functional envelope source {} changed; review its explicit adapter.",
            entry.id
        ));
    }
    Ok(FunctionalSource {
        style_id: &entry.id,
        recipe_id: entry.recipe_id,
        variant_id: entry.variant_id,
        tradition_id: "javanese",
        source_role: entry.role,
        source_confidence: entry.recipe().confidence.as_str(),
        sources: &entry.recipe().sources,
        temporal: entry.temporal,
        inspired_only: entry.inspired_only,
        nominal_width_m: p.width_m,
        nominal_depth_m: p.depth_m,
        floors: p.floors,
        roof_system: entry.roof_system,
    })
}

pub fn registry() -> Result<&'static FunctionalChoiceRegistry, String> {
    static REGISTRY: OnceLock<Result<FunctionalChoiceRegistry, String>> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        let index = style_index()?;
        let mut rules = Vec::new();
        for (id, role, function, composition, legacy_alias_for, adapter, claim) in [
            ("java-inn-envelope-v1", "commerce.inn", ArchitectureFunction::Collective,
             ProgrammeComposition::Inn, None,
             FunctionalEnvelopeUse::SharedLodgingEnvelope,
             "Inspired simple shared-lodging envelope only; not a complete or historically attributed pesanggrahan or inn."),
            ("java-shared-lodging-envelope-v1", "commerce.dharamshala", ArchitectureFunction::Collective,
             ProgrammeComposition::Hall, Some("java-inn-envelope-v1"),
             FunctionalEnvelopeUse::SharedLodgingEnvelope,
             "Legacy saved-request alias only, not a Javanese dharamshala attribution. Inspired simple shared-lodging envelope; no complete inn or hall is certified."),
            ("java-storage-envelope-v1", "storage.granary", ArchitectureFunction::Warehouse,
             ProgrammeComposition::Hall, None,
             FunctionalEnvelopeUse::StorageEnvelope,
             "Inspired simple storage envelope only; no granary-specific floor, ventilation, pest control or storage capacity is certified."),
        ] {
            let sources = ["AS-ISL-B14::default", "AS-ISL-B15::default"].into_iter().map(|id| {
                source(index.get(id).ok_or_else(|| format!("Missing functional source {id}."))?)
            }).collect::<Result<Vec<_>, String>>()?;
            rules.push(FunctionalChoiceRule {
                id, culture_id: "javanese-courts", pack_id: "AS-ISL", urban_role: role,
                function, composition, legacy_alias_for, adapter,
                modes: &[HistoricalMode::HistoricalInspired, HistoricalMode::FantasyMix],
                sources, functional_claim: claim, detailed_interior: false, certified_capacity: false,
            });
        }
        Ok(FunctionalChoiceRegistry { version: FUNCTIONAL_CHOICES_VERSION,
            catalogue_version: &catalogue()?.catalogue_version, rules })
    }).as_ref().map_err(Clone::clone)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FunctionalSelectionStatus {
    Explicit,
    Unregistered,
    Incompatible,
    Available,
}

#[derive(Clone, Debug, Serialize)]
pub struct FunctionalCandidate {
    pub rule_id: &'static str,
    pub style_id: &'static str,
    pub adapter: FunctionalEnvelopeUse,
    pub config: HouseConfig,
    /// Source-bounded request, still subject to real construction/site checks.
    pub body_dimensions_m: [f64; 2],
    pub requested_area_m2: Option<f64>,
    pub nominal_area_range_m2: [f64; 2],
    pub diagnostic: String,
}

#[derive(Serialize)]
pub struct FunctionalSelection {
    pub status: FunctionalSelectionStatus,
    pub candidates: Vec<FunctionalCandidate>,
    pub diagnostics: Vec<String>,
}

/// City must remove only its own admission pin BEFORE this call. A received pin
/// has no trustworthy origin marker and is always preserved, including old saves.
/// No geometry or random house is generated by this bounded selection.
pub fn choices_for_request(
    r: &PlacementRequest,
    exact: bool,
    limit: usize,
) -> Result<FunctionalSelection, String> {
    let mut result = FunctionalSelection {
        status: FunctionalSelectionStatus::Unregistered,
        candidates: vec![],
        diagnostics: vec![],
    };
    if exact
        || r.parcel_fit == Some(false)
        || r.config.as_ref().is_some_and(|c| {
            c.recipe.is_some() || c.workshop.is_some() || c.overrides.variant.is_some()
        })
    {
        result.status = FunctionalSelectionStatus::Explicit;
        result.diagnostics.push("Received exact/recipe/variant/workshop selection or disabled parcel fitting preserved; its origin cannot be inferred. City admission pins must be removed by the producer before applying user overrides.".into());
        return Ok(result);
    }
    let Some(programme) = &r.programme else {
        return Ok(result);
    };
    programme.validate()?;
    let Some(rule) = registry()?.rules.iter().find(|rule| {
        rule.culture_id == r.culture.culture
            && rule.pack_id == r.culture.pack
            && Some(rule.urban_role) == programme.role.as_deref()
            && rule.function == r.function
            && Some(rule.composition) == programme.composition
    }) else {
        result.diagnostics.push("No exact registered culture/role/function/composition. No religious, civic or domestic substitute is implied.".into());
        return Ok(result);
    };
    result.status = FunctionalSelectionStatus::Incompatible;
    if r.config
        .as_ref()
        .is_some_and(|c| c.pack != r.culture.pack || c.mode != r.culture.mode)
    {
        result.diagnostics.push("Explicit config pack/mode differs from the city context; the inspired functional adapter does not overwrite that selection.".into());
        return Ok(result);
    }
    if !rule.modes.contains(&r.culture.mode)
        || r.culture
            .borrowing
            .as_deref()
            .is_some_and(|v| !v.trim().is_empty())
    {
        result.diagnostics.push("Inspired functional envelope unavailable in this mode or explicit cultural borrowing context.".into());
        return Ok(result);
    }
    let data = catalogue()?;
    let mut available = vec![];
    let mut weights = vec![];
    for source in &rule.sources {
        let mut config = r.config.clone().unwrap_or_default();
        config.pack = r.culture.pack.clone();
        config.mode = r.culture.mode;
        config.recipe = Some(source.recipe_id.into());
        config.overrides.variant = Some(source.variant_id.into());
        config.seed = r.seed.clone();
        config.count = 1;
        config.orientation_deg = 0.;
        let checked = (|| {
            data.validate_config(&config)?;
            let recipe = style_index()?
                .get(source.style_id)
                .ok_or("Missing declared style")?
                .recipe();
            let p = data.resolve_variant_parameters(recipe, &config, source.variant_id)?;
            // Explicit footprint/roof/body controls are admitted only if this
            // same simple source still supports the registered envelope.
            if p.footprint_family != "FP-RECT" || p.bodies != [1, 1] || p.floors != [1, 1] {
                return Err("Explicit controls require a different functional adapter.".into());
            }
            if r.typology.is_some_and(|t| {
                t != crate::placement::ArchitectureTypology::Common
                    && t != crate::placement::typology(p.layout)
            }) {
                return Err("Explicit typology requires a different functional adapter.".into());
            }
            let w = p.width_m.map(|v| v * config.size);
            let d = p.depth_m.map(|v| v * config.size);
            let range = [w[0] * d[0], w[1] * d[1]];
            let target = programme
                .built_area_m2
                .unwrap_or((w[0] + w[1]) * (d[0] + d[1]) * 0.25);
            if target > range[1] * 1.01 || target < range[0] * 0.99 {
                return Err(format!(
                    "Requested footprint {target:.3}m2 is outside this simple source range {:.3}..{:.3}m2; no complete functional programme or larger compound was invented.",
                    range[0], range[1]
                ));
            }
            let target = target.clamp(range[0], range[1]);
            let aspect = (w[0] + w[1]) / (d[0] + d[1]);
            let width = libm::sqrt(target * aspect).clamp(w[0], w[1]);
            let depth = (target / width).clamp(d[0], d[1]);
            Ok((
                recipe.weight.max(1),
                FunctionalCandidate {
                    rule_id: rule.id,
                    style_id: source.style_id,
                    adapter: rule.adapter,
                    config,
                    body_dimensions_m: [(target / depth).clamp(w[0], w[1]), depth],
                    requested_area_m2: programme.built_area_m2,
                    nominal_area_range_m2: range,
                    diagnostic: format!(
                        "{} / {}: {} Native source {} confidence={}; one source-bounded body, no detailed interior or certified capacity; full terrain/access/roof/site admission required.",
                        FUNCTIONAL_CHOICES_VERSION,
                        rule.id,
                        rule.functional_claim,
                        source.style_id,
                        source.source_confidence
                    ),
                },
            ))
        })();
        match checked {
            Ok((weight, candidate)) => {
                weights.push(weight);
                available.push(candidate);
            }
            Err(reason) => result
                .diagnostics
                .push(format!("{}: {reason}", source.style_id)),
        }
    }
    let mut rng = Rng::new(&r.seed).fork("functional-choice-v1");
    for _ in 0..limit.min(4).min(available.len()) {
        let i = rng.weighted_index(&weights)?;
        result.candidates.push(available.remove(i));
        weights.remove(i);
    }
    if !result.candidates.is_empty() {
        result.status = FunctionalSelectionStatus::Available;
    }
    Ok(result)
}

/// Resolve an already selected envelope with the existing native non-domestic
/// constructor, without a new style draw. This is NOT placement certification.
pub fn resolve_candidate(
    r: &PlacementRequest,
    candidate: &FunctionalCandidate,
    body_span_m: [f64; 2],
) -> Result<ResolvedArchitecture, String> {
    if body_span_m.iter().any(|v| !v.is_finite() || *v <= 0.) {
        return Err("Invalid functional body bounds.".into());
    }
    let authorized = choices_for_request(r, false, 4)?.candidates.into_iter().find(|c|
        c.style_id == candidate.style_id && c.rule_id == candidate.rule_id
    ).ok_or("Candidate is no longer authorized by this request; explicit controls or programme changed.")?;
    // Recompute instead of trusting caller-mutated config/dimension fields.
    let mut architecture = resolve_urban_architecture(
        authorized.config,
        r.function,
        body_span_m,
        false,
        Some(authorized.body_dimensions_m),
        None,
        false,
    )?;
    let footprint = unite(
        &architecture
            .plan
            .bodies
            .iter()
            .map(|b| b.footprint.clone())
            .collect::<Vec<_>>(),
    );
    let actual = area(&footprint);
    if architecture.plan.bodies.len() != 1 || !architecture.plan.courts.is_empty() {
        return Err("Simple functional envelope produced an unexpected body programme.".into());
    }
    if let Some(target) = authorized.requested_area_m2
        && (actual - target).abs() > (target * 0.01).max(0.001)
    {
        return Err(format!(
            "Simple functional envelope target={target:.3}m2 actual={actual:.3}m2; source/site bounds prevent requested footprint, no undersized complete programme certified."
        ));
    }
    architecture.plan.diagnostics.push(authorized.diagnostic);
    architecture.plan.diagnostics.push(format!("Functional envelope actual body area={actual:.3}m2; target_met={}; source/variant/seed retained. Placement remains uncertified.", if authorized.requested_area_m2.is_some() { "true" } else { "not_requested" }));
    Ok(architecture)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn requests() -> Vec<PlacementRequest> {
        serde_json::from_str(include_str!("../tests/fixtures/java-functional-pins.json")).unwrap()
    }
    fn producer_unpins(r: &mut PlacementRequest) {
        let config = r.config.as_mut().unwrap();
        config.recipe = None;
        config.overrides.floors = None;
    }
    fn current_inn(r: &mut PlacementRequest) {
        let programme = r.programme.as_mut().unwrap();
        programme.role = Some("commerce.inn".into());
        programme.composition = Some(ProgrammeComposition::Inn);
    }

    #[test]
    fn current_java_inn_contract_is_exact_and_old_saved_role_is_only_a_compatibility_alias() {
        let services: serde_json::Value =
            serde_json::from_str(include_str!("../../core/src/urban/services.json")).unwrap();
        let insular = services["families"]["insular"].as_array().unwrap();
        let inn = insular
            .iter()
            .find(|s| s["role"] == "commerce.inn")
            .unwrap();
        assert_eq!(inn["function"], "collective");
        assert!(!insular.iter().any(|s| s["role"] == "commerce.dharamshala"));
        let mut old = requests().remove(0);
        producer_unpins(&mut old);
        // The original 369.4m² request is incompatible. This 60m² case is an
        // explicit counterfactual, not acceptance of the archived city site.
        old.programme.as_mut().unwrap().built_area_m2 = Some(60.);
        let legacy = choices_for_request(&old, false, 4).unwrap();
        let mut current = old.clone();
        current_inn(&mut current);
        let selection = choices_for_request(&current, false, 4).unwrap();
        assert_eq!(selection.status, FunctionalSelectionStatus::Available);
        assert_eq!(selection.candidates.len(), 2);
        for (now, before) in selection.candidates.iter().zip(&legacy.candidates) {
            assert_eq!(now.rule_id, "java-inn-envelope-v1");
            assert_eq!(now.style_id, before.style_id);
            assert_eq!(now.body_dimensions_m, before.body_dimensions_m);
            assert_eq!(
                serde_json::to_value(&now.config).unwrap(),
                serde_json::to_value(&before.config).unwrap()
            );
            assert!(
                before
                    .diagnostic
                    .contains("Legacy saved-request alias only")
            );
        }
        let rules = &registry().unwrap().rules;
        assert_eq!(rules.len(), 3);
        assert_eq!(
            rules
                .iter()
                .find(|r| r.urban_role == "commerce.dharamshala")
                .unwrap()
                .legacy_alias_for,
            Some("java-inn-envelope-v1")
        );
        current.programme.as_mut().unwrap().composition = Some(ProgrammeComposition::Hall);
        assert_eq!(
            choices_for_request(&current, false, 4).unwrap().status,
            FunctionalSelectionStatus::Unregistered
        );
        current_inn(&mut current);
        current.function = ArchitectureFunction::Warehouse;
        assert_eq!(
            choices_for_request(&current, false, 4).unwrap().status,
            FunctionalSelectionStatus::Unregistered
        );
    }

    #[test]
    fn real_java_pins_are_preserved_and_unpinning_does_not_invent_large_or_religious_buildings() {
        let original = requests();
        let before = serde_json::to_value(&original).unwrap();
        for r in &original {
            assert_eq!(
                choices_for_request(r, false, 4).unwrap().status,
                FunctionalSelectionStatus::Explicit
            );
        }
        assert_eq!(before, serde_json::to_value(&original).unwrap());
        for (i, mut r) in original.into_iter().enumerate() {
            producer_unpins(&mut r);
            let result = choices_for_request(&r, false, 4).unwrap();
            assert!(result.candidates.is_empty());
            if i == 1 {
                assert_eq!(result.status, FunctionalSelectionStatus::Unregistered);
            } else {
                assert_eq!(result.status, FunctionalSelectionStatus::Incompatible);
                assert!(
                    result
                        .diagnostics
                        .iter()
                        .all(|s| s.contains("outside this simple source range"))
                );
            }
        }
    }

    #[test]
    fn declared_small_envelopes_preserve_source_seed_controls_and_replay_native_exterior() {
        for i in [0, 2] {
            let mut r = requests().remove(i);
            producer_unpins(&mut r);
            if i == 0 {
                current_inn(&mut r);
            }
            r.programme.as_mut().unwrap().built_area_m2 = Some(60.);
            let selection = choices_for_request(&r, false, 4).unwrap();
            assert_eq!(selection.status, FunctionalSelectionStatus::Available);
            assert_eq!(selection.candidates.len(), 2);
            assert_eq!(
                serde_json::to_value(&selection).unwrap(),
                serde_json::to_value(choices_for_request(&r, false, 4).unwrap()).unwrap()
            );
            for candidate in selection.candidates {
                assert!(matches!(
                    candidate.style_id,
                    "AS-ISL-B14::default" | "AS-ISL-B15::default"
                ));
                assert_eq!(candidate.config.seed, r.seed);
                let architecture = resolve_candidate(&r, &candidate, [30., 30.]).unwrap();
                assert_eq!(architecture.config.seed, r.seed);
                assert_eq!(architecture.plan.bodies.len(), 1);
                let compact = crate::compact::CompactArchitecture::pack(&architecture).unwrap();
                let restored = compact.unpack().unwrap();
                let unit = crate::engine::volume_unit(&architecture).unwrap();
                assert_eq!(unit.role, crate::model::Role::NonDomestic);
                assert!(unit.rooms.is_empty());
                assert!(!unit.roofs.faces.is_empty());
                assert_eq!(
                    serde_json::to_value(&unit).unwrap(),
                    serde_json::to_value(crate::engine::volume_unit(&restored).unwrap()).unwrap()
                );
                assert!(resolve_candidate(&r, &candidate, [2., 2.]).is_err());
            }
            assert_eq!(
                choices_for_request(&r, true, 4).unwrap().status,
                FunctionalSelectionStatus::Explicit
            );
            r.parcel_fit = Some(false);
            assert_eq!(
                choices_for_request(&r, false, 4).unwrap().status,
                FunctionalSelectionStatus::Explicit
            );
            r.parcel_fit = None;
            r.typology = Some(crate::placement::ArchitectureTypology::Courtyard);
            assert_eq!(
                choices_for_request(&r, false, 4).unwrap().status,
                FunctionalSelectionStatus::Incompatible
            );
            r.typology = None;
            r.culture.mode = HistoricalMode::HistoricalStrict;
            assert_eq!(
                choices_for_request(&r, false, 4).unwrap().status,
                FunctionalSelectionStatus::Incompatible
            );
            r.culture.mode = HistoricalMode::HistoricalInspired;
            r.config.as_mut().unwrap().overrides.floors = Some(2);
            assert_eq!(
                choices_for_request(&r, false, 4).unwrap().status,
                FunctionalSelectionStatus::Incompatible
            );
            r.config.as_mut().unwrap().overrides.floors = None;
            r.config.as_mut().unwrap().era = "M".into();
            assert_eq!(
                choices_for_request(&r, false, 4).unwrap().status,
                FunctionalSelectionStatus::Incompatible
            );
        }
    }

    #[test]
    fn plans_route_uses_registered_envelopes_and_preserves_budget_site_and_explicit_controls() {
        use crate::plans::{PlanBatchRequest, RealizePlanRequest, plan_batch, realize_plan};
        let run = |request: PlacementRequest| {
            plan_batch(PlanBatchRequest {
                schema_version: "1".into(),
                requests: vec![request],
                settings: None,
                footprints: Default::default(),
            })
            .unwrap()
        };
        for i in [0, 2] {
            let mut r = requests().remove(i);
            producer_unpins(&mut r);
            let original_target = r.programme.as_ref().unwrap().built_area_m2;
            let incompatible = run(r.clone());
            assert!(incompatible.buildings.is_empty());
            assert!(
                incompatible.refusals[0]
                    .message
                    .contains("outside this simple source range")
            );
            // Explicit counterfactual: retained real parcel/access, flat terrain
            // and a 60m² programme. This is not acceptance of the original site.
            if i == 0 {
                current_inn(&mut r);
            }
            r.programme.as_mut().unwrap().built_area_m2 = Some(60.);
            r.terrain.grid = None;
            r.terrain.gradient = [0., 0.];
            r.terrain.water_z_m = None;
            let accepted = run(r.clone());
            assert_eq!(
                accepted.buildings.len(),
                1,
                "{:?}",
                serde_json::to_value(&accepted.refusals).unwrap()
            );
            let building = &accepted.buildings[0];
            assert!(matches!(
                building.recipe_id.as_str(),
                "AS-ISL-B14" | "AS-ISL-B15"
            ));
            assert!((area(&building.footprint) - 60.).abs() < 0.01);
            assert!(
                building
                    .diagnostics
                    .iter()
                    .any(|d| d.contains(FUNCTIONAL_CHOICES_VERSION))
            );
            assert!(
                building
                    .diagnostics
                    .iter()
                    .any(|d| d.contains("target_met=true"))
            );
            assert!(
                !building
                    .diagnostics
                    .iter()
                    .any(|d| d.contains("unsupported functional composition"))
            );
            let detail = realize_plan(RealizePlanRequest {
                building: building.clone(),
                interiors: false,
            })
            .unwrap();
            assert!(!detail.units[0].roofs.faces.is_empty());
            let mut blocked = r.clone();
            blocked.reserves = blocked.buildable.clone();
            assert!(run(blocked).buildings.is_empty());
            let mut explicit_mode = r.clone();
            explicit_mode.config.as_mut().unwrap().mode = HistoricalMode::HistoricalStrict;
            assert!(
                run(explicit_mode).refusals[0]
                    .message
                    .contains("config pack/mode")
            );
            let mut explicit_pack = r.clone();
            explicit_pack.config.as_mut().unwrap().pack = "EUR-MED".into();
            assert!(
                run(explicit_pack).refusals[0]
                    .message
                    .contains("config pack/mode")
            );
            let mut pinned = r.clone();
            pinned.config.as_mut().unwrap().recipe = Some("AS-ISL-B06".into());
            let pinned_result = run(pinned);
            assert!(
                pinned_result
                    .buildings
                    .iter()
                    .all(|b| b.recipe_id == "AS-ISL-B06")
            );
            assert!(!pinned_result.refusals.iter().any(|r| {
                r.message
                    .contains("Registered inspired functional envelope")
            }));
            assert!(original_target.unwrap() > 300.);
        }
    }
}
