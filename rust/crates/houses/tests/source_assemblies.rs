use magna_urbis_houses::{catalogue::catalogue, generate_batch, geometry as g, model::*};
use std::collections::BTreeSet;

fn source_unit(id: &str, variant: Option<&str>) -> HouseUnit {
    let data = catalogue().unwrap();
    let recipe = data.recipes.iter().find(|r| r.id == id).unwrap();
    generate_batch(HouseConfig {
        seed: "42".into(),
        pack: recipe.pack_id.clone(),
        recipe: Some(id.into()),
        count: 1,
        variation: 0.0,
        allow_late: recipe.temporal.late_only,
        overrides: Overrides {
            variant: variant.map(str::to_owned),
            ..Default::default()
        },
        ..Default::default()
    })
    .unwrap()
    .units
    .remove(0)
}

fn projected_faces(unit: &HouseUnit, feature_id: Option<&str>, body_id: Option<&str>) -> Surface {
    g::unite(
        &unit
            .roofs
            .faces
            .iter()
            .filter(|f| {
                f.feature_id.as_deref() == feature_id
                    && body_id.is_none_or(|id| f.body_id == id)
                    && f.normal[2] > 0.0
            })
            .map(|f| {
                vec![Polygon {
                    outer: f
                        .vertices
                        .iter()
                        .map(|i| {
                            let v = &unit.roofs.vertices[*i as usize];
                            g::point(v.x, v.y)
                        })
                        .collect(),
                    holes: vec![],
                }]
            })
            .collect::<Vec<_>>(),
    )
}

#[test]
fn source_storage_groups_keep_all_reserves_and_one_existing_owner() {
    for id in ["AF-NILE-B04", "AF-MAG-B08"] {
        let unit = source_unit(id, None);
        assert!((3..=5).contains(&unit.bodies.len()));
        assert_eq!(unit.rooms.len(), unit.bodies.len());
        assert!(unit.rooms.iter().all(|r| r.usage == RoomUsage::Storage));
        let owners: BTreeSet<_> = unit
            .rooms
            .iter()
            .map(|r| r.household_id.as_deref())
            .collect();
        assert_eq!(owners, BTreeSet::from([Some("unit-0:household")]));
        assert!(unit.bodies.iter().all(|b| b.role == Role::DomesticAnnex
            && b.roof_system == "RF-DOME"
            && b.levels.len() == 1
            && b.footprint[0].outer.len() == 48));
        assert!(unit.features.iter().all(|f| !matches!(
            f.kind,
            FeatureKind::Hearth | FeatureKind::Fence | FeatureKind::LivestockPen
        )));
        assert!(g::area(&unit.partition.courtyards) > 1.0);
        assert_eq!(
            g::area(&g::intersection(
                &unit.partition.courtyards,
                &unit.partition.occupied
            )),
            0.0
        );
        for (i, body) in unit.bodies.iter().enumerate() {
            assert!(
                unit.access
                    .nodes
                    .iter()
                    .any(|n| n.id == unit.rooms[i].access_node)
            );
            let roof: Surface = unit
                .roofs
                .faces
                .iter()
                .filter(|f| f.feature_id.is_none() && f.body_id == body.id && f.normal[2] > 0.0)
                .map(|f| Polygon {
                    outer: f
                        .vertices
                        .iter()
                        .map(|i| {
                            let v = &unit.roofs.vertices[*i as usize];
                            g::point(v.x, v.y)
                        })
                        .collect(),
                    holes: vec![],
                })
                .collect();
            assert!(g::area(&roof) > 1.0);
            for other in unit.bodies.iter().skip(i + 1) {
                assert_eq!(
                    g::area(&g::intersection(&body.footprint, &other.footprint)),
                    0.0
                );
                let other_roof: Surface = unit
                    .roofs
                    .faces
                    .iter()
                    .filter(|f| {
                        f.feature_id.is_none() && f.body_id == other.id && f.normal[2] > 0.0
                    })
                    .map(|f| Polygon {
                        outer: f
                            .vertices
                            .iter()
                            .map(|i| {
                                let v = &unit.roofs.vertices[*i as usize];
                                g::point(v.x, v.y)
                            })
                            .collect(),
                        holes: vec![],
                    })
                    .collect();
                let a = g::bounds(&roof);
                let b = g::bounds(&other_roof);
                assert!(a[2] < b[0] || b[2] < a[0] || a[3] < b[1] || b[3] < a[1]);
            }
        }
    }
}

#[test]
fn source_japanese_annexes_are_real_storage_with_independent_hip_roofs() {
    for variant in [None, Some("gable_thatch")] {
        let unit = source_unit("AS-JAP-B01", variant);
        let main = unit
            .bodies
            .iter()
            .find(|b| b.component_id.as_deref() == Some("main_house"))
            .unwrap();
        let annexes: Vec<_> = unit
            .bodies
            .iter()
            .filter(|b| b.component_id.as_deref() == Some("rear_annexes"))
            .collect();
        assert!((1..=2).contains(&annexes.len()));
        assert_eq!(unit.bodies.len(), 1 + annexes.len());
        assert_eq!(
            main.roof_system,
            if variant.is_some() {
                "RF-GABLE"
            } else {
                "RF-REED-HIP"
            }
        );
        let main_roof = projected_faces(&unit, None, Some(&main.id));
        let galleries: Vec<_> = unit
            .features
            .iter()
            .filter(|f| f.kind == FeatureKind::Gallery)
            .collect();
        assert_eq!(galleries.len(), 1);
        assert_eq!(
            galleries[0].roof.as_ref().unwrap().owner_body_id.as_deref(),
            Some(main.id.as_str())
        );
        for annex in annexes {
            assert_eq!(annex.role, Role::DomesticAnnex);
            assert_eq!(annex.roof_system, "RF-REED-HIP");
            assert_eq!(annex.levels.len(), 1);
            assert_eq!(annex.levels[0].height_m, 2.8);
            assert!(annex.overhang_m <= 0.15);
            assert!(
                unit.rooms
                    .iter()
                    .filter(|r| r.body_id == annex.id)
                    .all(|r| r.usage == RoomUsage::Storage)
            );
            assert_eq!(
                unit.rooms.iter().filter(|r| r.body_id == annex.id).count(),
                1
            );
            let roof = projected_faces(&unit, None, Some(&annex.id));
            assert!(g::area(&roof) > 1.0);
            assert_eq!(g::area(&g::intersection(&main_roof, &roof)), 0.0);
            assert!(
                g::bounds(&main_roof)[1] > g::bounds(&roof)[3]
                    || g::bounds(&roof)[1] > g::bounds(&main_roof)[3]
            );
        }
    }
}

#[test]
fn source_medieval_lean_to_has_full_faces_wall_contact_and_outer_post_caps() {
    for (variant, material) in [
        (None, "MAT-TILE-CLAY"),
        (Some("slate_cladding"), "MAT-SLATE"),
    ] {
        let unit = source_unit("EUR-MED-B04", variant);
        let gallery = unit
            .features
            .iter()
            .find(|f| f.kind == FeatureKind::Gallery)
            .unwrap();
        let roof = gallery.roof.as_ref().unwrap();
        assert_eq!(unit.bodies.len(), 1);
        assert_eq!(unit.bodies[0].roof_system, "RF-GABLE");
        assert_eq!(unit.bodies[0].overhang_m, 0.0);
        assert_eq!(roof.material, material);
        assert_eq!(roof.arms[0].axis, [1.0, 0.0]);
        let projected = projected_faces(&unit, Some(&gallery.id), None);
        assert!(
            g::area(&projected) > g::area(&gallery.surface) - g::area_tolerance(&gallery.surface)
        );
        assert!(
            g::area(&g::difference(&gallery.surface, &projected))
                < g::area_tolerance(&gallery.surface)
        );
        let faces: Vec<_> = unit
            .roofs
            .faces
            .iter()
            .filter(|f| f.feature_id.as_deref() == Some(&gallery.id))
            .collect();
        assert!(faces.iter().all(|f| f.rf == "RF-SHED"
            && f.material == material
            && f.normal[1] > 0.0
            && f.normal[2] > 0.0));
        let vertices: Vec<_> = faces
            .iter()
            .flat_map(|f| f.vertices.iter().map(|i| &unit.roofs.vertices[*i as usize]))
            .collect();
        let low_y = vertices
            .iter()
            .map(|v| v.y)
            .fold(f64::NEG_INFINITY, f64::max);
        let low_z = vertices
            .iter()
            .filter(|v| v.y == low_y)
            .map(|v| v.z)
            .fold(f64::INFINITY, f64::min);
        let high_y = vertices.iter().map(|v| v.y).fold(f64::INFINITY, f64::min);
        let high_z = vertices
            .iter()
            .filter(|v| v.y == high_y)
            .map(|v| v.z)
            .fold(f64::NEG_INFINITY, f64::max);
        assert!(high_z > low_z);
        assert!(
            (high_z - low_z - (low_y - high_y) * 10.0_f64.to_radians().tan()).abs() <= g::GRID_M
        );
        let supporting_walls: Vec<_> = roof
            .supports
            .iter()
            .filter_map(|id| unit.walls.iter().find(|w| &w.id == id))
            .collect();
        assert!(supporting_walls.iter().any(|w| w.id.starts_with("lintel:")));
        let section = g::unite(
            &supporting_walls
                .iter()
                .map(|w| {
                    assert!(w.z_m <= low_z && w.z_m + w.height_m >= high_z);
                    assert!(w.solid.is_none()); // these source walls and lintels are ordinary prisms
                    w.footprint.clone()
                })
                .collect::<Vec<_>>(),
        );
        let contact = g::rectangle(
            g::bounds(&projected)[0],
            high_y - 0.001,
            g::bounds(&projected)[2] - g::bounds(&projected)[0],
            0.001,
        );
        assert!(g::area(&g::difference(&contact, &section)) < g::area_tolerance(&contact));
        let posts: Vec<_> = roof
            .supports
            .iter()
            .filter_map(|id| {
                unit.features
                    .iter()
                    .find(|f| &f.id == id && f.kind == FeatureKind::Post)
            })
            .collect();
        assert_eq!(posts.len(), 6);
        let passages = g::unite(
            &unit
                .access
                .portals
                .iter()
                .map(|p| p.passage.clone())
                .chain(std::iter::once(unit.partition.circulation.clone()))
                .collect::<Vec<_>>(),
        );
        for post in posts {
            use geo::Intersects;
            assert_eq!(post.z_m + post.height_m, low_z);
            let b = g::bounds(&post.surface);
            assert!(b[1] < low_y && b[3] > low_y); // finite cap crosses the actual mesh eave
            assert_eq!(g::area(&g::intersection(&post.surface, &passages)), 0.0);
            assert!(g::area(&g::intersection(&post.surface, &projected)) > 0.0);
            let eave = geo::Line::new(
                geo::Coord {
                    x: g::bounds(&projected)[0],
                    y: low_y,
                },
                geo::Coord {
                    x: g::bounds(&projected)[2],
                    y: low_y,
                },
            );
            assert!(g::to_geo(&post.surface).intersects(&eave));
        }
    }
}

#[test]
fn source_boat_scene_orientation_preserves_native_geometry() {
    let unit = source_unit("OC-PAC-B10", None);
    assert!(
        !unit
            .diagnostics
            .iter()
            .any(|d| d.contains("Trait boat_plan inapplicable"))
    );
    let data = catalogue().unwrap();
    let recipe = data.recipes.iter().find(|r| r.id == "OC-PAC-B10").unwrap();
    let rotated = generate_batch(HouseConfig {
        seed: "42".into(),
        pack: recipe.pack_id.clone(),
        recipe: Some(recipe.id.clone()),
        count: 1,
        variation: 0.0,
        orientation_deg: 37.0,
        ..Default::default()
    })
    .unwrap()
    .units
    .remove(0);
    assert_eq!(rotated.bodies, unit.bodies);
    assert_eq!(rotated.roofs, unit.roofs);
    assert_eq!(rotated.transform.orientation_deg, 37.0);
}
