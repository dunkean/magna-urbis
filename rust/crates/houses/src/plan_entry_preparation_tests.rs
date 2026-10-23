// Register as a child module of engine.rs so the test can inspect the same
// private structural_unit constructor used by foundation preparation.
use super::*;
use crate::access::plan_entry::prepare_plan_entry;
use crate::compact::CompactArchitecture;
use crate::placement::ArchitectureFunction;

#[test]
fn prepared_strip_entry_survives_archive_and_detailed_subdivision_without_redraws() {
    for coverage in [0.0, 0.93] {
        let mut config = HouseConfig {
            recipe: Some("EUR-MED-B02".into()),
            seed: "native-strip-plan-entry".into(),
            mode: HistoricalMode::HistoricalInspired,
            count: 1,
            ..HouseConfig::default()
        };
        config.overrides.variant = Some("default".into());
        config.overrides.floors = Some(1);
        let resolved = resolve_urban_architecture(
            config,
            ArchitectureFunction::Domestic,
            [40., 40.],
            false,
            Some([8., 20.]),
            Some(coverage),
            true,
        ).unwrap();
        assert_eq!(resolved.plan.bodies.len() > 1, coverage > 0.0);
        let original = serde_json::to_vec(&resolved).unwrap();
        let mut unit = structural_unit(&resolved).unwrap();
        let bodies = serde_json::to_vec(&unit.bodies).unwrap();
        let entry = prepare_plan_entry(
            &mut unit, &resolved.plan.paths, &resolved.parameters,
        ).unwrap();
        assert!(unit.rooms.is_empty());
        assert!(unit.roofs.vertices.is_empty() && unit.roofs.faces.is_empty());
        assert_eq!(bodies, serde_json::to_vec(&unit.bodies).unwrap());
        assert_eq!(original, serde_json::to_vec(&resolved).unwrap());
        assert_eq!(
            serde_json::to_vec(&entry.body_entry).unwrap(),
            serde_json::to_vec(&entry.site_entry).unwrap(),
            "a ground strip has no separate perimeter gate"
        );
        assert!(entry.body_entry.width_m >= 0.8);
        assert!((entry.body_entry.from_z_m - entry.body_entry.to_z_m).abs() < 0.001);
        assert!(area(&intersection(&entry.site_entry.passage, &entry.site_solids)) <= 0.0001);
        assert!(prepare_plan_entry(
            &mut unit, &resolved.plan.paths, &resolved.parameters,
        ).is_err(), "the access graph must not be appended a second time");

        let legacy = match prepare_foundation_domains(&resolved).unwrap() {
            FoundationPreparation::Supported(physical) => physical,
            FoundationPreparation::Unsupported(reason) => panic!("{reason}"),
        };
        assert!(legacy.entry.is_none());
        let native = match prepare_foundation_and_entry(&resolved).unwrap() {
            FoundationPreparation::Supported(physical) => physical,
            FoundationPreparation::Unsupported(reason) => panic!("{reason}"),
        };
        let retained_entry = native.entry.as_ref().unwrap();
        assert_eq!(
            serde_json::to_vec(&retained_entry.body_entry).unwrap(),
            serde_json::to_vec(&entry.body_entry).unwrap(),
        );
        assert_eq!(
            serde_json::to_vec(&retained_entry.site_entry).unwrap(),
            serde_json::to_vec(&entry.site_entry).unwrap(),
        );
        assert_eq!(retained_entry.site_solids, entry.site_solids);
        assert_eq!(native.native_features, crate::placement::native_site_features(&unit));
        let occupation = unite(&native.occupation_parts);
        for passage in [&entry.body_entry.passage, &entry.site_entry.passage] {
            assert!(area(&difference(passage, &occupation)) <= 0.0001);
        }
        assert_eq!(legacy.bearing_parts, native.bearing_parts);

        // Post/PartyWall features are not walls in the structural access graph.
        // Reject a portal obstructed by either without cutting or moving it.
        for kind in [FeatureKind::Post, FeatureKind::PartyWall] {
            let mut blocked = structural_unit(&resolved).unwrap();
            blocked.features.push(feature(
                "entry-obstructing-support", kind, entry.body_entry.passage.clone(),
                entry.body_entry.from_z_m, 2.7, "MAT-TIMBER-POST",
            ));
            let reason = prepare_plan_entry(
                &mut blocked, &resolved.plan.paths, &resolved.parameters,
            ).err().unwrap();
            assert!(reason.contains("intersects a structural support or an uncut wall"), "{reason}");
        }

        let mut retained = resolved.clone();
        retained.entrance = Some(entry.body_entry.clone());
        let packed = CompactArchitecture::pack(&retained).unwrap();
        let unpacked = packed.unpack().unwrap();
        assert_eq!(
            serde_json::to_vec(&retained).unwrap(),
            serde_json::to_vec(&unpacked).unwrap(),
            "archive retains exact source, seed, body geometry and entry"
        );
        let detailed = enrich_architecture(&unpacked).unwrap();
        let detailed = &detailed.units[0];
        assert!(detailed.access.portals.iter().any(|portal| {
            (portal.from == detailed.access.root || portal.to == detailed.access.root)
                && portal.opening == entry.body_entry.opening
                && portal.passage == entry.body_entry.passage
        }), "detailed access must retain the actual portal, not choose a new facade midpoint");
        assert_eq!(original, serde_json::to_vec(&resolved).unwrap());
    }
}
