//! Same-source proof: masonry_joints is retained decoration, not a support.
//! The caller's automatic/inspired/no-pin policy is deliberately unchanged.
use super::*;
use crate::access::plan_entry::prepare_plan_entry;
use crate::compact::CompactArchitecture;
use crate::placement::ArchitectureFunction;

fn roman_source(recipe: &str, variant: &str, floors: u32) -> ResolvedArchitecture {
    let mut config = HouseConfig {
        pack: "MED-ANT".into(),
        recipe: Some(recipe.into()),
        seed: format!("masonry-foundation:{recipe}:{variant}"),
        mode: HistoricalMode::HistoricalInspired,
        era: "A".into(),
        count: 1,
        size: 1.,
        variation: 0.,
        ..HouseConfig::default()
    };
    config.overrides.variant = Some(variant.into());
    config.overrides.floors = Some(floors);
    resolve_urban_architecture(
        config,
        ArchitectureFunction::Domestic,
        [40., 40.],
        false,
        Some(if recipe == "MED-ANT-B13" {
            [6.5, 10.]
        } else {
            [4.5, 7.]
        }),
        Some(0.),
        false,
    )
    .unwrap()
}

fn supported(result: Result<FoundationPreparation, String>) -> PreparedFoundationDomains {
    match result.unwrap() {
        FoundationPreparation::Supported(prepared) => prepared,
        FoundationPreparation::Unsupported(reason) => panic!("{reason}"),
    }
}

#[test]
fn native_b13_masonry_keeps_foundation_entry_and_enriched_decoration() {
    for (variant, floors) in [("default", 2), ("three_storeys", 3), ("four_storeys", 4)] {
        // Pin only to select the controlled source witness. This engine helper
        // does not decide whether a pinned request may use the urban upgrade.
        let resolved = roman_source("MED-ANT-B13", variant, floors);
        let frozen = serde_json::to_vec(&resolved).unwrap();
        assert_eq!(resolved.parameters.layout, Layout::Strip);
        assert_eq!(resolved.parameters.details, ["masonry_joints", "rear_yard"]);
        assert!(!resolved.parameters.urban_frontage_infill);
        assert_eq!(resolved.plan.bodies.len(), 1);
        assert_eq!(resolved.plan.bodies[0].levels.len(), floors as usize);

        let mut canonical = structural_unit(&resolved).unwrap();
        assert!(canonical.rooms.is_empty() && canonical.roofs.faces.is_empty());
        assert!(
            !canonical
                .features
                .iter()
                .any(|f| f.kind == FeatureKind::DecorativePanel)
        );
        let expected_body = unite(
            &canonical
                .bodies
                .iter()
                .flat_map(|body| body.levels.iter().map(|level| level.footprint.clone()))
                .collect::<Vec<_>>(),
        );
        let canonical_features = crate::placement::native_site_features(&canonical);
        let mut expected_bearing = vec![expected_body.clone()];
        expected_bearing.extend(canonical_features.iter().map(|f| f.surface.clone()));

        let physical = supported(prepare_foundation_domains(&resolved));
        assert!(physical.entry.is_none());
        assert_eq!(physical.body_domain, expected_body);
        assert_eq!(physical.bearing_parts, expected_bearing);
        assert_eq!(physical.native_features, canonical_features);
        assert!(
            area(&difference(
                &resolved.plan.courts,
                &physical.occupation_domain
            )) <= 1e-4
        );
        assert!(
            area(&difference(
                &resolved.plan.paths,
                &physical.occupation_domain
            )) <= 1e-4
        );

        let exact_entry =
            prepare_plan_entry(&mut canonical, &resolved.plan.paths, &resolved.parameters).unwrap();
        let native = supported(prepare_foundation_and_entry(&resolved));
        let entry = native.entry.as_ref().unwrap();
        assert_eq!(native.bearing_parts, physical.bearing_parts);
        assert_eq!(
            native.native_features,
            crate::placement::native_site_features(&canonical)
        );
        assert_eq!(
            serde_json::to_vec(&entry.body_entry).unwrap(),
            serde_json::to_vec(&exact_entry.body_entry).unwrap()
        );
        assert_eq!(
            serde_json::to_vec(&entry.site_entry).unwrap(),
            serde_json::to_vec(&exact_entry.site_entry).unwrap()
        );
        assert_eq!(entry.site_solids, exact_entry.site_solids);
        for passage in [&entry.body_entry.passage, &entry.site_entry.passage] {
            assert!(area(&difference(passage, &native.occupation_domain)) <= 1e-4);
        }

        let mut retained = resolved.clone();
        retained.entrance = Some(entry.body_entry.clone());
        let unpacked = CompactArchitecture::pack(&retained)
            .unwrap()
            .unpack()
            .unwrap();
        assert_eq!(
            serde_json::to_vec(&retained).unwrap(),
            serde_json::to_vec(&unpacked).unwrap()
        );
        let detail = enrich_architecture(&unpacked).unwrap();
        let unit = &detail.units[0];
        assert_eq!(unit.bodies.len(), 1);
        assert_eq!(unit.bodies[0].footprint, resolved.plan.bodies[0].footprint);
        assert_eq!(unit.bodies[0].levels.len(), floors as usize);
        assert!(!unit.roofs.faces.is_empty());
        assert!(
            unit.features
                .iter()
                .filter(|f| f.kind == FeatureKind::Stair)
                .count()
                >= floors as usize - 1
        );
        let marks: Vec<_> = unit
            .features
            .iter()
            .filter(|f| f.id.starts_with("detail-masonry_joints-"))
            .collect();
        assert!(
            !marks.is_empty(),
            "{variant}: the native detail must still be emitted"
        );
        assert!(marks.iter().all(|f| f.kind == FeatureKind::DecorativePanel
            && f.roof.is_none()
            && f.z_m >= 1.05
            && (f.height_m - 0.35).abs() < 1e-12));
        assert!(
            unit.access.portals.iter().any(|portal| {
                (portal.from == unit.access.root || portal.to == unit.access.root)
                    && portal.opening == entry.body_entry.opening
                    && portal.passage == entry.body_entry.passage
            }),
            "{variant}: detailed subdivision must retain the actual native portal"
        );
        assert_eq!(frozen, serde_json::to_vec(&resolved).unwrap());
    }
}

#[test]
fn masonry_whitelist_does_not_admit_single_unknown_details_or_panel_structures() {
    let single = roman_source("MED-ANT-B12", "default", 2);
    assert_eq!(single.parameters.layout, Layout::Single);
    assert!(matches!(
        prepare_foundation_domains(&single).unwrap(),
        FoundationPreparation::Unsupported(_)
    ));

    let source = roman_source("MED-ANT-B13", "default", 2);
    let mut unknown_detail = source.clone();
    unknown_detail
        .parameters
        .details
        .push("brick_joints".into());
    assert!(
        matches!(
            prepare_foundation_domains(&unknown_detail).unwrap(),
            FoundationPreparation::Unsupported(_)
        ),
        "The extension is one audited literal, not every wall mark."
    );

    let mut structural_panel = source;
    structural_panel.plan.features.push(feature(
        "retained-unknown-panel",
        FeatureKind::DecorativePanel,
        rectangle(0., 0., 2., 0.2),
        0.,
        2.,
        "MAT-STONE-DRY",
    ));
    assert!(
        matches!(
            prepare_foundation_domains(&structural_panel).unwrap(),
            FoundationPreparation::Unsupported(_)
        ),
        "The detail literal does not whitelist arbitrary panel structures."
    );
}
