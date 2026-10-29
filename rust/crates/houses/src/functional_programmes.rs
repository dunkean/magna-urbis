//! Opt-in native functional programmes backed by named source bundles.
//! Halls and inspired storage rows retain their own grammar and bearing.
//! This resolver is not site admission or historical capacity certification.
use crate::catalogue::{Envelope, Layout, SourceReference, SupportKind, catalogue};
use crate::engine::ResolvedArchitecture;
use crate::geometry::{area, unite};
use crate::model::{HistoricalMode, HouseConfig, Role};
use crate::placement::ArchitectureFunction;
use crate::programme::{ArchitectureProgramme, ProgrammeComposition};
use serde::Serialize;
use std::sync::OnceLock;

pub const FUNCTIONAL_PROGRAMME_VERSION: &str = "functional-programmes-1";
/// Millimetre geometry rounding is tolerated, not an arbitrary undersized hall.
pub const TARGET_AREA_RELATIVE_TOLERANCE: f64 = 0.01;

#[derive(Serialize)]
pub struct FunctionalProgramme {
    pub id: &'static str,
    pub composition: ProgrammeComposition,
    pub function: ArchitectureFunction,
    pub recipe_id: &'static str,
    pub pack_id: &'static str,
    /// Exact city roles eligible for automatic selection. Empty stays explicit.
    pub urban_roles: &'static [&'static str],
    pub eras: &'static [String],
    pub late_only: bool,
    pub modes: &'static [HistoricalMode],
    pub floors: [u32; 2],
    pub component_kind: &'static str,
    pub source_confidence: &'static str,
    pub sources: &'static [SourceReference],
    pub nominal_width_m: [f64; 2],
    pub nominal_depth_m: [f64; 2],
    pub detailed_interior: bool,
}

#[derive(Serialize)]
pub struct FunctionalRegistry {
    pub version: &'static str,
    pub catalogue_version: &'static str,
    pub programmes: Vec<FunctionalProgramme>,
}

/// Available dimensions in the selected local axes. These are only broad-phase
/// body bounds: the caller MUST still check polygons, reserves, roof rights,
/// neighboring buildings, terrain and actual frontage/access after placement.
#[derive(Clone, Copy, Debug)]
pub struct FunctionalSite {
    pub body_span_m: [f64; 2],
}

#[derive(Serialize)]
pub struct ResolvedFunctionalArchitecture {
    pub architecture: ResolvedArchitecture,
    pub programme_id: &'static str,
    pub programme_version: &'static str,
    pub requested_area_m2: Option<f64>,
    pub actual_area_m2: f64,
    /// None means no target was requested, rather than an implicit success.
    pub target_met: Option<bool>,
}

pub fn registry() -> Result<&'static FunctionalRegistry, String> {
    static REGISTRY: OnceLock<Result<FunctionalRegistry, String>> = OnceLock::new();
    REGISTRY.get_or_init(|| {
        let data = catalogue()?;
        let mut programmes = Vec::new();
        for (id, recipe_id, kind, urban_roles) in [
            ("hall-af-west-b03-v1", "AF-WEST-B03", "open_community_hall", &[][..]),
            ("hall-am-and-b04-v1", "AM-AND-B04", "assembly_hall", &["civic.kallanka"][..]),
            ("storage-med-ant-h01-v1", "MED-ANT-H01", "storage_rows", &["storage.horreum"][..]),
        ] {
            let recipe = data.recipes.iter().find(|r| r.id == recipe_id)
                .ok_or_else(|| format!("Missing declared functional source {recipe_id}."))?;
            let p = &recipe.parameters;
            let storage = kind == "storage_rows";
            let envelope = if storage {
                p.layout == Layout::Parallel && p.footprint_family == "FP-RECT"
                    && p.envelope == Envelope::Walled && p.bodies == [3,3]
                    && p.components.is_empty() && p.wall_thickness_m[0] >= 0.6
            } else {
                p.layout == Layout::Single && p.footprint_family == "FP-LONG"
                    && p.envelope == Envelope::Open && p.bodies == [1,1]
                    && p.components.len() == 1 && p.components[0].id == "main"
            };
            if recipe.role != Role::SpatialComponent || recipe.component_kind.as_deref() != Some(kind)
                || !envelope || p.roof_system != "RF-GABLE"
                || p.support.kind != SupportKind::Ground || p.floors != [1,1]
                || recipe.sources.is_empty()
            {
                return Err(format!("Functional source {recipe_id} changed; its declared adapter must be reviewed."));
            }
            programmes.push(FunctionalProgramme {
                id, composition: ProgrammeComposition::Hall,
                function: if storage { ArchitectureFunction::Warehouse } else { ArchitectureFunction::Collective },
                recipe_id: &recipe.id, pack_id: &recipe.pack_id, component_kind: kind,
                urban_roles, eras: &recipe.temporal.eras, late_only: recipe.temporal.late_only,
                modes: if recipe.inspired_only { &[HistoricalMode::HistoricalInspired, HistoricalMode::FantasyMix] }
                    else { &[HistoricalMode::HistoricalStrict, HistoricalMode::HistoricalInspired, HistoricalMode::FantasyMix] },
                floors: p.floors,
                source_confidence: &recipe.confidence, sources: &recipe.sources,
                nominal_width_m: p.width_m, nominal_depth_m: p.depth_m, detailed_interior: false,
            });
        }
        Ok(FunctionalRegistry { version: FUNCTIONAL_PROGRAMME_VERSION,
            catalogue_version: &data.catalogue_version, programmes })
    }).as_ref().map_err(Clone::clone)
}

/// Resolve a registered functional source without domestic simplification.
/// A supplied recipe/variant/override is never replaced. An omitted recipe may
/// select only the registered hall of this exact pack; no cultural substitution.
/// `built_area_m2` guides dimensions inside source ranges scaled by config.size.
/// No arbitrary parcel enlargement, functional interior or capacity is implied.
pub fn resolve_functional_architecture(
    mut config: HouseConfig,
    programme: &ArchitectureProgramme,
    function: ArchitectureFunction,
    site: FunctionalSite,
) -> Result<ResolvedFunctionalArchitecture, String> {
    programme.validate()?;
    if programme.composition != Some(ProgrammeComposition::Hall)
        || !matches!(function, ArchitectureFunction::Collective | ArchitectureFunction::Warehouse)
        || config.workshop.is_some()
    {
        return Err(
            "Only registered hall compositions for collective or storage sources are supported."
                .into(),
        );
    }
    if site.body_span_m.iter().any(|v| !v.is_finite() || *v <= 0.) {
        return Err("Invalid functional body bounds.".into());
    }
    let registry = registry()?;
    let declared = registry.programmes.iter().find(|p|
        p.pack_id == config.pack && p.function == function
            && p.modes.contains(&config.mode)
            && config.recipe.as_deref().is_none_or(|id| id == p.recipe_id)
    ).ok_or("No declared functional hall matches this pack and explicit recipe; no pin was replaced.")?;
    config.recipe = Some(declared.recipe_id.into());
    let mut architecture =
        crate::engine::resolve_registered_hall(config, site.body_span_m, programme.built_area_m2)?;
    let actual_area_m2 = area(&unite(
        &architecture
            .plan
            .bodies
            .iter()
            .flat_map(|body| body.levels.clone())
            .collect::<Vec<_>>(),
    ));
    let target_met = programme.built_area_m2.map(|target| {
        (actual_area_m2 - target).abs() <= (target * TARGET_AREA_RELATIVE_TOLERANCE).max(0.001)
    });
    let source = declared
        .sources
        .iter()
        .map(|s| format!("{}:{}", s.path, s.line))
        .collect::<Vec<_>>()
        .join(", ");
    architecture.plan.diagnostics.push(format!(
        "Functional programme {} / {}: retained {} from {}; source confidence={} ({}). No detailed interior or certified functional capacity.",
        registry.version, declared.id, declared.component_kind, declared.recipe_id, declared.source_confidence, source,
    ));
    if let Some(target) = programme.built_area_m2 {
        architecture.plan.diagnostics.push(format!(
            "Functional body footprint target={target:.3}m2 actual={actual_area_m2:.3}m2 target_met={}; dimensions stay within declared ranges and supplied body bounds. Full site/access/roof admission remains required.",
            target_met.unwrap(),
        ));
    }
    if programme.floors.is_some()
        || programme.frontage_continuity.is_some()
        || programme.party_walls.is_some()
    {
        architecture.plan.diagnostics.push("Functional hall keeps its declared storeys; soft height/frontage/party-wall wishes do not alter this source programme.".into());
    }
    Ok(ResolvedFunctionalArchitecture {
        architecture,
        programme_id: declared.id,
        programme_version: registry.version,
        requested_area_m2: programme.built_area_m2,
        actual_area_m2,
        target_met,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::compact::CompactArchitecture;
    use crate::engine::{enrich_architecture, volume_unit};
    use crate::geometry::{bounds, difference};
    use crate::model::HistoricalMode;

    fn config(pack: &str, recipe: &str, mode: HistoricalMode) -> HouseConfig {
        HouseConfig {
            pack: pack.into(),
            recipe: Some(recipe.into()),
            seed: "functional-hall-C1".into(),
            mode,
            era: "M".into(),
            ..Default::default()
        }
    }
    fn programme(area: f64) -> ArchitectureProgramme {
        ArchitectureProgramme {
            composition: Some(ProgrammeComposition::Hall),
            built_area_m2: Some(area),
            ..Default::default()
        }
    }
    fn resolve(
        config: HouseConfig,
        target: f64,
        span: [f64; 2],
    ) -> Result<ResolvedFunctionalArchitecture, String> {
        resolve_functional_architecture(
            config,
            &programme(target),
            ArchitectureFunction::Collective,
            FunctionalSite { body_span_m: span },
        )
    }

    #[test]
    fn storage_rows_have_native_access_to_every_ground_bearing_hall() {
        let mut cfg=config("MED-ANT","MED-ANT-H01",HistoricalMode::HistoricalInspired);
        cfg.era="A".into();
        let source=resolve_functional_architecture(cfg,&programme(352.1),ArchitectureFunction::Warehouse,
            FunctionalSite{body_span_m:[50.,50.]}).unwrap().architecture;
        let mut unit=crate::engine::structural_unit_for_entry_probe(&source).unwrap();
        crate::access::structural_access(&mut unit,&source.plan.paths,&source.parameters).unwrap();
        let mut reached=std::collections::BTreeSet::from([unit.access.root.clone()]);
        loop {
            let old=reached.len();
            for p in &unit.access.portals {
                if reached.contains(&p.from) {reached.insert(p.to.clone());}
                if reached.contains(&p.to) {reached.insert(p.from.clone());}
            }
            if old==reached.len() {break;}
        }
        assert_eq!(unit.bodies.len(),3);
        for body in &unit.bodies {
            assert!(unit.access.nodes.iter().any(|n|reached.contains(&n.id)
                && area(&crate::geometry::intersection(&n.floor,&body.levels[0].footprint))>0.1),"{}",body.id);
        }
    }
    #[test]
    fn functional_hall_600m2_ignores_extra_land_and_replays_the_exact_exterior() {
        let config = config("AM-AND", "AM-AND-B04", HistoricalMode::HistoricalInspired);
        let first = resolve(config.clone(), 600., [30., 80.]).unwrap();
        let larger = resolve(config.clone(), 600., [100., 180.]).unwrap();
        assert_eq!(first.target_met, Some(true));
        assert!((first.actual_area_m2 - 600.).abs() < 0.1);
        assert_eq!(first.programme_id, "hall-am-and-b04-v1");
        assert_eq!(
            serde_json::to_value(&first).unwrap(),
            serde_json::to_value(&larger).unwrap()
        );
        // Budget fitting changes dimensions only, not the source programme,
        // material/roof choices, components, details or their seeded draws.
        let mut expected = crate::resolve_architecture(config).unwrap().parameters;
        expected.width_m = first.architecture.parameters.width_m;
        expected.depth_m = first.architecture.parameters.depth_m;
        assert_eq!(
            serde_json::to_value(expected).unwrap(),
            serde_json::to_value(&first.architecture.parameters).unwrap()
        );
        assert_eq!(first.architecture.parameters.components.len(), 1);
        assert_eq!(first.architecture.plan.bodies.len(), 1);
        let b = bounds(&first.architecture.plan.bodies[0].footprint);
        assert!((10.0..=16.0).contains(&(b[2] - b[0])));
        assert!((36.0..=60.0).contains(&(b[3] - b[1])));
        let packed = CompactArchitecture::pack(&first.architecture).unwrap();
        let wire = serde_json::to_vec(&packed).unwrap();
        let restored = serde_json::from_slice::<CompactArchitecture>(&wire)
            .unwrap()
            .unpack()
            .unwrap();
        let exterior = volume_unit(&first.architecture).unwrap();
        let replay = volume_unit(&restored).unwrap();
        assert_eq!(exterior.role, Role::NonDomestic);
        assert!(!exterior.roofs.faces.is_empty());
        assert!(exterior.rooms.is_empty());
        assert_eq!(
            serde_json::to_value(&exterior).unwrap(),
            serde_json::to_value(&replay).unwrap()
        );
        assert!(
            area(&difference(
                &exterior.bodies[0].footprint,
                &first.architecture.plan.bodies[0].footprint
            )) < 1e-9
        );
        assert!(
            enrich_architecture(&restored)
                .err()
                .unwrap()
                .contains("no compatible detailed interior")
        );
        assert!(
            restored
                .plan
                .diagnostics
                .iter()
                .any(|d| d.contains(FUNCTIONAL_PROGRAMME_VERSION) && d.contains("stylized"))
        );
    }

    #[test]
    fn functional_halls_keep_strict_sources_explicit_overrides_and_minimum_spans() {
        let config = config("AF-WEST", "AF-WEST-B03", HistoricalMode::HistoricalStrict);
        let resolved = resolve(config.clone(), 600., [50., 90.]).unwrap();
        assert_eq!(resolved.target_met, Some(false));
        assert!((resolved.actual_area_m2 - 360.).abs() < 1e-6);
        assert!(
            resolved
                .architecture
                .plan
                .diagnostics
                .iter()
                .any(|d| d.contains("target_met=false"))
        );
        assert_eq!(
            resolved.architecture.parameters.details,
            catalogue()
                .unwrap()
                .recipes
                .iter()
                .find(|r| r.id == "AF-WEST-B03")
                .unwrap()
                .parameters
                .details
        );
        assert!(
            resolve(config.clone(), 200., [5., 40.])
                .err()
                .unwrap()
                .contains("minimum")
        );
        let mut conflict = config.clone();
        conflict.overrides.floors = Some(2);
        assert!(resolve(conflict, 200., [50., 90.]).is_err());
        let mut wrong_recipe = config.clone();
        wrong_recipe.recipe = Some("AF-WEST-B01".into());
        assert!(
            resolve(wrong_recipe, 200., [50., 90.])
                .err()
                .unwrap()
                .contains("no pin was replaced")
        );
        let mut wrong_pack = config.clone();
        wrong_pack.pack = "EUR-MED".into();
        assert!(resolve(wrong_pack, 200., [50., 90.]).is_err());
        let mut unsupported = programme(200.);
        unsupported.composition = Some(ProgrammeComposition::Civic);
        assert!(
            resolve_functional_architecture(
                config.clone(),
                &unsupported,
                ArchitectureFunction::Collective,
                FunctionalSite {
                    body_span_m: [50., 90.]
                }
            )
            .is_err()
        );
        assert!(resolve(config, -1., [50., 90.]).is_err());
        let registry = registry().unwrap();
        assert_eq!(registry.programmes.len(), 3);
        assert!(
            registry
                .programmes
                .iter()
                .all(|p| p.source_confidence == "stylized"
                    && !p.detailed_interior
                    && !p.sources.is_empty())
        );
    }
}
