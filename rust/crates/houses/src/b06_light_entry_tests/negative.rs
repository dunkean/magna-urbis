//! Child of engine in the isolated B06-light workspace only.
//! Every negative starts from the same real resolved B06; no source is rebuilt.
use super::*;

fn fixture() -> ResolvedArchitecture {
    #[derive(serde::Deserialize)]
    struct Fixture { after: crate::plans::PlanBuilding }
    let value: Fixture = serde_json::from_str(include_str!("fixtures/moderate-deficit.json")).unwrap();
    let resolved = value.after.resolved.unpack().unwrap();
    assert_eq!(resolved.recipe_id, "AS-ISL-B06");
    assert_eq!(resolved.plan.bodies.len(), 1);
    assert_eq!(resolved.plan.bodies[0].levels.len(), 1);
    resolved
}

fn require_supported_positive(resolved: &ResolvedArchitecture) {
    match prepare_foundation_and_entry(resolved) {
        Ok(FoundationPreparation::Supported(value)) => assert!(value.entry.is_some()),
        Ok(FoundationPreparation::Unsupported(reason)) => panic!("positive control unsupported: {reason}"),
        Err(reason) => panic!("positive control could not prepare a true native entrance: {reason}"),
    }
    assert!(matches!(prepare_foundation_domains(resolved),
        Ok(FoundationPreparation::Unsupported(_))),
        "the old intermediate/without-entry route must not silently acquire B06 support");
}

fn require_not_supported(label: &str, resolved: &ResolvedArchitecture) {
    let source = serde_json::to_vec(resolved).unwrap();
    assert!(!matches!(prepare_foundation_and_entry(resolved),
        Ok(FoundationPreparation::Supported(_))), "unsupported programme accepted: {label}");
    assert_eq!(source, serde_json::to_vec(resolved).unwrap(),
        "negative preparation mutated retained source: {label}");
}

#[test]
fn frame_entry_rejects_unsupported_effective_programmes_before_certifying_geometry() {
    let original = fixture();
    require_supported_positive(&original);
    let mutations: &[(&str, fn(&mut ResolvedArchitecture))] = &[
        ("source raised posts", |r| {
            r.parameters.support.kind = SupportKind::Posts;
            r.parameters.support.height_m = [1., 1.];
        }),
        ("body raised posts despite Ground source", |r| {
            r.plan.bodies[0].parameters.support.kind = SupportKind::Posts;
            r.plan.bodies[0].parameters.support.height_m = [1., 1.];
        }),
        ("source two floors", |r| r.parameters.floors = [2, 2]),
        ("effective body two floors", |r| r.plan.bodies[0].parameters.floors = [2, 2]),
        ("unknown source operator", |r| r.parameters.details.push("unsupported_future_operator".into())),
        ("unknown body operator", |r| r.plan.bodies[0].parameters.details.push("unsupported_future_operator".into())),
        ("open envelope has a different support/slab programme", |r| r.parameters.envelope = Envelope::Open),
        ("source enclosure", |r| r.parameters.enclosure_family = crate::catalogue::EnclosureFamily::StoneWall),
        ("body enclosure", |r| r.plan.bodies[0].parameters.enclosure_family = crate::catalogue::EnclosureFamily::StoneWall),
        ("covered gallery", |r| r.parameters.gallery_cover.enabled = true),
        ("effective no-room hall", |r| r.plan.bodies[0].parameters.rooms_per_body = [0, 0]),
        ("different roof constructor", |r| r.plan.bodies[0].parameters.roof_system = "RF-TIERED".into()),
        ("synthetic slope override", |r| r.config.overrides.site_slope_deg = Some(5.)),
    ];
    for &(label, mutate) in mutations {
        let mut candidate = original.clone(); mutate(&mut candidate);
        require_not_supported(label, &candidate);
    }
}

#[test]
fn frame_entry_rejects_extra_levels_domains_and_context_without_omitting_them() {
    let original = fixture();
    require_supported_positive(&original);
    let mutations: &[(&str, fn(&mut ResolvedArchitecture))] = &[
        ("raised actual body", |r| r.plan.bodies[0].z = 0.1),
        ("second actual level", |r| {
            let floor = r.plan.bodies[0].footprint.clone();
            r.plan.bodies[0].levels.push(floor);
        }),
        ("different ground-level footprint", |r| {
            r.plan.bodies[0].levels[0][0].outer[0].x += 0.2;
        }),
        ("oblique quadrilateral is not its bounding rectangle", |r| {
            r.plan.bodies[0].footprint[0].outer[0].x += 0.2;
            r.plan.bodies[0].levels[0] = r.plan.bodies[0].footprint.clone();
        }),
        ("body hole", |r| {
            let b = bounds(&r.plan.bodies[0].footprint);
            r.plan.bodies[0].footprint[0].holes.push(rectangle(b[0]+1.,b[1]+1.,0.5,0.5)[0].outer.clone());
            r.plan.bodies[0].levels[0] = r.plan.bodies[0].footprint.clone();
        }),
        ("declared void", |r| r.plan.bodies[0].voids.push(rectangle(1.,1.,0.5,0.5))),
        ("retained courtyard", |r| r.plan.courts = rectangle(1.,1.,1.,1.)),
        ("retained circulation", |r| r.plan.paths = rectangle(1.,1.,1.,1.)),
        ("unknown initial support", |r| r.plan.features.push(crate::layouts::feature(
            "negative-support", FeatureKind::Post, rectangle(1.,1.,0.3,0.3),0.,2.8,"MAT-TIMBER-POST"))),
        ("retained obstacle context", |r| r.plan.context.push(crate::layouts::feature(
            "negative-neighbor", FeatureKind::Neighbor, rectangle(1.,1.,1.,1.),0.,2.8,"MAT-BAMBOO"))),
    ];
    for &(label, mutate) in mutations {
        let mut candidate = original.clone(); mutate(&mut candidate);
        require_not_supported(label, &candidate);
    }
}
