use magna_urbis_houses::{
    catalogue::{Support, SupportKind},
    generate_batch,
    geometry::{area, difference, intersection, unite},
    model::{FeatureKind, HistoricalMode, HouseConfig, PortalKind, WallKind},
    workshop::WorkshopRequest,
};

fn source(id: &str) -> HouseConfig {
    HouseConfig {
        pack: id.rsplit_once("-B").unwrap().0.into(),
        recipe: Some(id.into()),
        count: 1,
        variation: 0.0,
        allow_late: true,
        ..Default::default()
    }
}

#[test]
fn collective_terraces_have_public_routes_without_entering_households() {
    use magna_urbis_houses::model::{AccessKind, Overrides};
    use std::collections::{BTreeSet, VecDeque};
    let mut refused = Vec::new();
    for variant in ["d_plan"] {
        for floors in [2, 4] {
            for seed in ["42", "toits é🏠"] {
                let config = HouseConfig {
                    seed: seed.into(),
                    variation: 0.65,
                    overrides: Overrides {
                        variant: Some(variant.into()),
                        floors: Some(floors),
                        ..Default::default()
                    },
                    ..source("AM-PUEB-B03")
                };
                let seed_label = if seed == "42" { "42" } else { "unicode" };
                let case = format!("great-{variant}-floors{floors}-{seed_label}");
                let case_started = std::time::Instant::now();
                eprintln!("GREAT_CASE {case} START generate_batch");
                let batch = match generate_batch(config) {
                    Ok(batch) => batch,
                    Err(error) => {
                        eprintln!(
                            "GREAT_CASE {case} REFUSED seconds={:.6} error={error}",
                            case_started.elapsed().as_secs_f64()
                        );
                        refused.push(format!("{variant}/{floors}/{seed}: {error}"));
                        continue;
                    }
                };
                // Test-only observer of the eight existing Great cases.
                let evidence = std::path::Path::new("access-integration-standard-cases");
                std::fs::create_dir_all(evidence).unwrap();
                std::fs::write(
                    evidence.join(format!("{case}.json")),
                    serde_json::to_vec(&batch).unwrap(),
                )
                .unwrap();
                eprintln!(
                    "GREAT_CASE {case} GENERATED seconds={:.6} faces={}",
                    case_started.elapsed().as_secs_f64(),
                    batch.units[0].roofs.faces.len()
                );
                let unit = &batch.units[0];
                let allowed: BTreeSet<_> = unit
                    .access
                    .nodes
                    .iter()
                    .filter(|n| n.kind != AccessKind::Room && n.household_id.is_none())
                    .map(|n| n.id.as_str())
                    .collect();
                let mut reached = BTreeSet::from([unit.access.root.as_str()]);
                let mut queue = VecDeque::from([unit.access.root.as_str()]);
                while let Some(id) = queue.pop_front() {
                    for p in &unit.access.portals {
                        let next = if p.from == id {
                            Some(p.to.as_str())
                        } else if p.to == id {
                            Some(p.from.as_str())
                        } else {
                            None
                        };
                        if let Some(next) = next
                            && allowed.contains(next)
                            && reached.insert(next)
                        {
                            queue.push_back(next);
                        }
                    }
                }
                for p in unit
                    .access
                    .portals
                    .iter()
                    .filter(|p| p.kind == PortalKind::Hatch)
                {
                    for id in [&p.from, &p.to] {
                        if unit
                            .access
                            .nodes
                            .iter()
                            .any(|n| &n.id == id && n.kind == AccessKind::Terrace)
                        {
                            assert!(
                                reached.contains(id.as_str()),
                                "{variant}/{floors}/{seed}: {id}"
                            );
                        }
                    }
                }
                assert!(unit.access.nodes.iter().all(|n| n.floor.len() == 1));
                assert!(
                    (100..=300).contains(&unit.bodies.iter().map(|b| b.cells.len()).sum::<usize>())
                );
                for f in unit
                    .features
                    .iter()
                    .filter(|f| f.id.contains(":public-roof:") && f.kind == FeatureKind::Ladder)
                {
                    assert!(f.height_m <= 2.801);
                    let v = &f.vertices3d;
                    assert!((libm::hypot(v[2].x - v[1].x, v[2].y - v[1].y) - 1.3).abs() < 0.003);
                }
                if variant == "default" && floors == 2 && seed == "42" {
                    let landing = unit
                        .features
                        .iter()
                        .find(|f| {
                            f.kind == FeatureKind::Landing
                                && f.id.contains(":public-roof:")
                                && f.z_m > 0.0
                        })
                        .unwrap();
                    let mut unsupported = unit.clone();
                    assert_eq!(
                        unsupported
                            .features
                            .iter()
                            .filter(|f| { f.id.starts_with(&format!("{}:post:", landing.id)) })
                            .count(),
                        4,
                    );
                    unsupported
                        .features
                        .retain(|f| !f.id.starts_with(&format!("{}:post:", landing.id)));
                    let coplanar_support = unite(
                        &unsupported
                            .access
                            .nodes
                            .iter()
                            .filter(|n| {
                                n.kind != AccessKind::Room
                                    && n.kind != AccessKind::StairLanding
                                    && (n.z_m - landing.z_m).abs() < 0.001
                            })
                            .map(|n| n.floor.clone())
                            .collect::<Vec<_>>(),
                    );
                    assert!(area(&difference(&landing.surface, &coplanar_support)) > 1e-6);
                    let error =
                        magna_urbis_houses::validation::validate_unit(&unsupported).unwrap_err();
                    assert_eq!(error, "Pont de palier sans quatre appuis.");
                    let flight = unit
                        .features
                        .iter()
                        .find(|f| f.kind == FeatureKind::Ladder && f.id.contains(":public-roof:"))
                        .unwrap();
                    let mut collision = unit.clone();
                    let mut wall = unit.walls[0].clone();
                    wall.id = "regression-retaining-wall-in-public-flight".into();
                    wall.body_id = None;
                    wall.kind = WallKind::Retaining;
                    let v = &flight.vertices3d;
                    let cx = v.iter().map(|v| v.x).sum::<f64>() * 0.25;
                    let cy = v.iter().map(|v| v.y).sum::<f64>() * 0.25;
                    wall.footprint =
                        magna_urbis_houses::geometry::rectangle(cx - 0.05, cy - 0.05, 0.1, 0.1);
                    wall.opening_ids.clear();
                    wall.z_m = flight.z_m;
                    wall.height_m = flight.height_m;
                    collision.walls.push(wall);
                    let error =
                        magna_urbis_houses::validation::validate_unit(&collision).unwrap_err();
                    assert!(error.contains("volée publique dans le mur"), "{error}");
                }
            }
        }
    }
    assert!(refused.is_empty(), "{}", refused.join("\n"));
}

#[test]
fn external_flights_have_real_runs_and_supported_or_excavated_landings() {
    let mut workshop = HouseConfig {
        pack: "atelier".into(),
        mode: HistoricalMode::FantasyMix,
        count: 1,
        workshop: Some(WorkshopRequest {
            preset_id: "WORKSHOP-FP-RECT".into(),
            support: Some(Support {
                kind: SupportKind::Posts,
                height_m: [2.0, 2.0],
                material: Some("MAT-TIMBER-POST".into()),
            }),
            ..Default::default()
        }),
        ..Default::default()
    };
    let raised = generate_batch(workshop.clone()).unwrap();
    assert_eq!(raised, generate_batch(workshop.clone()).unwrap());
    let unit = &raised.units[0];
    let solids = unite(
        &unit
            .bodies
            .iter()
            .map(|b| b.footprint.clone())
            .collect::<Vec<_>>(),
    );
    let flight = unit
        .features
        .iter()
        .find(|f| f.kind == FeatureKind::Stair)
        .unwrap();
    assert!(area(&intersection(&flight.surface, &solids)) < 0.001);
    let v = &flight.vertices3d;
    assert!(libm::hypot(v[2].x - v[1].x, v[2].y - v[1].y) >= 2.597);
    assert!(unit.features.iter().any(|f| f.kind == FeatureKind::Landing));
    assert!(
        unit.features
            .iter()
            .any(|f| f.id.contains(":landing:") && f.kind == FeatureKind::Post)
    );
    assert!(
        unit.access
            .portals
            .iter()
            .any(|p| p.kind == PortalKind::Door && p.from_z_m == 2.0)
    );

    workshop.workshop = Some(WorkshopRequest {
        preset_id: "WORKSHOP-FP-ROCKCUT".into(),
        ..Default::default()
    });
    let excavated = generate_batch(workshop).unwrap();
    assert!(
        excavated.units[0]
            .features
            .iter()
            .any(|f| f.id.contains(":areaway:") && f.kind == FeatureKind::Excavation)
    );
    assert!(
        excavated.units[0]
            .walls
            .iter()
            .any(|w| w.id.contains(":areaway:") && w.kind == WallKind::Retaining)
    );
}

#[test]
fn atlas_raised_sunken_and_gallery_access_is_geometric() {
    for id in [
        "AS-SEA-B01",
        "AM-ARC-B02",
        "AM-PUEB-B06",
        "AS-CHI-B10",
        "ATL-CEL-B08",
        "AM-MESO-B13",
    ] {
        let batch = generate_batch(source(id)).unwrap_or_else(|e| panic!("{id}: {e}"));
        let unit = &batch.units[0];
        for p in unit
            .access
            .portals
            .iter()
            .filter(|p| p.kind == PortalKind::Stair)
        {
            let f = unit
                .features
                .iter()
                .find(|f| p.feature_ids.contains(&f.id))
                .unwrap();
            let v = &f.vertices3d;
            let run = libm::hypot(v[2].x - v[1].x, v[2].y - v[1].y);
            assert!(
                run + 0.003 >= ((p.to_z_m - p.from_z_m).abs() * 0.95).max(2.6),
                "{id}: {run}"
            );
        }
        assert!(unit.access.nodes.iter().all(|n| n.floor.len() == 1));
    }
}
