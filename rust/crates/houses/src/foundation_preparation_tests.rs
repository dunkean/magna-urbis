use super::*;
use crate::catalogue::{EnclosureFamily, EnclosureSpec};
use crate::placement::{ArchitectureFunction, ArchitectureTerrain, MAX_LEVEL_FOUNDATION_SLOPE_DEG};

fn native_strip() -> ResolvedArchitecture {
    let mut config = HouseConfig {
        recipe: Some("EUR-MED-B02".into()),
        seed: "native-strip-foundation-domains".into(),
        mode: HistoricalMode::HistoricalInspired,
        count: 1,
        ..HouseConfig::default()
    };
    config.overrides.variant = Some("default".into());
    config.overrides.floors = Some(1);
    resolve_urban_architecture(
        config,
        ArchitectureFunction::Domestic,
        [40., 40.],
        false,
        Some([8., 16.]),
        Some(0.),
        true,
    )
    .unwrap()
}

fn prepared(resolved: &ResolvedArchitecture) -> PreparedFoundationDomains {
    match prepare_foundation_domains(resolved).unwrap() {
        FoundationPreparation::Supported(value) => value,
        FoundationPreparation::Unsupported(reason) => {
            panic!("Expected declared native strip: {reason}")
        }
    }
}

fn terrain(gradient: [f64; 2]) -> ArchitectureTerrain {
    ArchitectureTerrain {
        origin: point(0., 0.),
        ground_z_m: 10.,
        gradient,
        water_z_m: None,
        max_foundation_step_m: 0.75,
        grid: None,
    }
}

fn step(terrain: &ArchitectureTerrain, surface: &Surface) -> f64 {
    let (lo, hi, slope) = terrain.foundation_bounds(surface).unwrap();
    assert!(slope < MAX_LEVEL_FOUNDATION_SLOPE_DEG);
    hi - lo
}

#[test]
fn native_strip_court_and_lateral_gallery_have_distinct_physical_domains() {
    let resolved = native_strip();
    let original = serde_json::to_vec(&resolved).unwrap();
    let physical = prepared(&resolved);
    assert_eq!(resolved.plan.bodies.len(), 1);
    assert_eq!(
        physical
            .native_features
            .iter()
            .filter(|f| f.kind == FeatureKind::Gallery)
            .count(),
        1
    );
    assert_eq!(
        physical
            .native_features
            .iter()
            .filter(|f| f.kind == FeatureKind::Post)
            .count(),
        2
    );
    let native = structural_unit(&resolved).unwrap();
    assert!(native.rooms.is_empty() && native.roofs.faces.is_empty());
    assert_eq!(
        physical.native_features,
        crate::placement::native_site_features(&native)
    );
    assert_eq!(physical.bearing_domain, unite(&physical.bearing_parts));
    assert_eq!(
        physical.occupation_domain,
        unite(&physical.occupation_parts)
    );

    // Native W=8,D=16: the body and its side gallery extend from y=4 to16,
    // whereas the unbuilt rear court/path start at y=0. The same0.75m limit
    // accepts the actual structure and rejects the entire reserved courtyard.
    let depth_slope = terrain([0., 0.05]);
    assert!((step(&depth_slope, &physical.bearing_domain) - 0.6).abs() < 1e-8);
    assert!((step(&depth_slope, &physical.occupation_domain) - 0.8).abs() < 1e-8);
    assert!(step(&depth_slope, &physical.bearing_domain) < depth_slope.max_foundation_step_m);
    assert!(step(&depth_slope, &physical.occupation_domain) > depth_slope.max_foundation_step_m);

    // A different real slope makes the required side gallery decisive. A
    // body-only shortcut would accept0.675m and silently omit its0.85m band.
    let width_slope = terrain([0.1, 0.]);
    let body_step = step(&width_slope, &physical.body_domain);
    let bearing_step = step(&width_slope, &physical.bearing_domain);
    let feature_bounds: Vec<_> = physical
        .native_features
        .iter()
        .map(|f| (&f.id, f.kind, bounds(&f.surface)))
        .collect();
    let measured = format!(
        "native width slope: body step={body_step:.12}m, bearing step={bearing_step:.12}m, allowed={:.12}m; body bounds={:?}; bearing bounds={:?}; actual features={feature_bounds:?}",
        width_slope.max_foundation_step_m,
        bounds(&physical.body_domain),
        bounds(&physical.bearing_domain),
    );
    eprintln!("{measured}");
    assert!((body_step - 0.675).abs() < 1e-8, "{measured}");
    assert!(body_step < width_slope.max_foundation_step_m, "{measured}");
    // Use the complete native gallery/post union after geometric operations,
    // not an assumed nominal rectangle whose exact extent is not the output.
    assert!(
        bearing_step > width_slope.max_foundation_step_m,
        "{measured}"
    );
    assert_eq!(original, serde_json::to_vec(&resolved).unwrap());
}

#[test]
fn native_strip_retains_an_outer_post_and_refuses_unknown_enclosures() {
    let mut resolved = native_strip();
    resolved.plan.features.push(feature(
        "retained-outer-post",
        FeatureKind::Post,
        rectangle(1., 20., 0.2, 0.2),
        0.,
        2.7,
        "MAT-TIMBER-POST",
    ));
    let physical = prepared(&resolved);
    let ground = terrain([0., 0.05]);
    assert!(
        physical
            .native_features
            .iter()
            .any(|f| f.id == "retained-outer-post")
    );
    assert!((step(&ground, &physical.bearing_domain) - 0.81).abs() < 1e-8);
    assert!(step(&ground, &physical.bearing_domain) > ground.max_foundation_step_m);
    assert!(
        area(&difference(
            &physical.occupation_domain,
            &rectangle(0., 0., 8., 16.)
        )) > 0.001
    );

    let mut enclosure = native_strip();
    enclosure.parameters.enclosures.push(EnclosureSpec {
        family: EnclosureFamily::StoneWall,
        placement: Placement::Peripheral,
        gate_width_m: 1.2,
    });
    assert!(matches!(
        prepare_foundation_domains(&enclosure).unwrap(),
        FoundationPreparation::Unsupported(_)
    ));
    let mut unknown = native_strip();
    unknown.plan.features.push(feature(
        "retained-unknown-foundation",
        FeatureKind::Retaining,
        rectangle(0., 18., 4., 0.3),
        0.,
        2.,
        "MAT-STONE-DRY",
    ));
    assert!(matches!(
        prepare_foundation_domains(&unknown).unwrap(),
        FoundationPreparation::Unsupported(_)
    ));
}
