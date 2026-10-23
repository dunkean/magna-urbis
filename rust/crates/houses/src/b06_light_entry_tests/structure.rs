//! Child engine; compare the actual pre-access primitives, without choosing a door.
use super::*;

fn witnesses() -> Vec<ResolvedArchitecture> {
    #[derive(serde::Deserialize)]
    struct Fixture { after: crate::plans::PlanBuilding }
    [include_str!("fixtures/moderate-deficit.json"),
     include_str!("fixtures/large-deficit.json"),
     include_str!("fixtures/target-met.json")].into_iter().map(|input| {
        serde_json::from_str::<Fixture>(input).unwrap().after.resolved.unpack().unwrap()
    }).collect()
}

#[test]
fn shared_single_entry_structure_matches_native_pre_access_details_without_rooms() {
    for resolved in witnesses() {
        let source=serde_json::to_vec(&resolved).unwrap();
        let light=structural_unit_with_single_entry_details(&resolved).unwrap();
        assert!(light.rooms.is_empty() && light.roofs.vertices.is_empty() && light.roofs.faces.is_empty());
        assert!(light.access.nodes.is_empty() && light.access.portals.is_empty());
        assert_eq!(light.bodies.len(),1);
        assert_eq!(light.bodies[0].levels.len(),1);
        assert_eq!(light.features.iter().filter(|f|f.kind==FeatureKind::Post).count(),4);
        assert_eq!(light.features.iter().filter(|f|f.kind==FeatureKind::Frame).count(),1);

        // Test oracle only: the exact detailed build_body + add_details stage,
        // before access mutates walls. No formulas copied into this comparison.
        let mut detailed=structural_unit(&resolved).unwrap();
        detailed.bodies.clear();
        detailed.features.clear();
        detailed.site_context=resolved.plan.context.clone();
        let mut circulations=vec![(0.,resolved.plan.paths.clone())];
        for (i,spec) in resolved.plan.bodies.iter().cloned().enumerate() {
            build_body(&mut detailed,spec,i,&mut circulations).unwrap();
        }
        crate::features::add_details_for_role(&mut detailed,Role::Dwelling,
            &resolved.parameters,&resolved.config).unwrap();
        assert!(!detailed.rooms.is_empty());
        assert!(detailed.roofs.faces.is_empty());
        assert_eq!(serde_json::to_value(&light.bodies).unwrap(),serde_json::to_value(&detailed.bodies).unwrap());
        assert_eq!(serde_json::to_value(&light.features).unwrap(),serde_json::to_value(&detailed.features).unwrap(),
            "same native posts/header, IDs/order/materials/heights");
        let exterior:Vec<_>=detailed.walls.iter().filter(|w|w.kind==WallKind::Exterior).collect();
        assert_eq!(serde_json::to_value(&light.walls).unwrap(),serde_json::to_value(&exterior).unwrap(),
            "same actual exterior wall before the portal; no room-wall proxy");
        assert_eq!(source,serde_json::to_vec(&resolved).unwrap());
    }
}
