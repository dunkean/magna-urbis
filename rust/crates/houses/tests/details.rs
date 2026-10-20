pub use magna_urbis_houses::{catalogue, geometry, model};
#[path = "../src/support_intervals.rs"]
mod support_intervals;
mod roofs {
    pub use magna_urbis_houses::roofs::*;
    pub(crate) fn support_line_intervals(
        a: crate::model::Point,
        b: crate::model::Point,
        domain: &crate::model::Surface,
    ) -> Vec<(f64, f64)> {
        super::support_intervals::line_intervals(a, b, domain)
    }
}
#[path = "../src/features.rs"]
mod features;
#[path = "../src/gallery_components.rs"]
mod gallery_components;
#[path = "../src/wall_geometry.rs"]
mod wall_geometry;

use catalogue::{EnclosureFamily, EnclosureSpec, Envelope, Placement, VerticalAccess};
use geometry::{area, difference, intersection, rectangle};
use model::*;

#[test]
fn source_boat_witness_reads_geometry_and_accepts_translation() {
    let outline = geometry::ellipse(0.0, 0.0, 5.0, 25.0, 64);
    assert!(features::boat_plan_present(&outline));
    let mut translated = outline.clone();
    for q in &mut translated[0].outer {
        q.x += 1024.0;
        q.y -= 2048.0;
    }
    assert!(features::boat_plan_present(&translated));
    assert!(!features::boat_plan_present(&geometry::ellipse(
        0.0, 0.0, 5.0, 7.0, 64
    )));
    assert!(!features::boat_plan_present(&geometry::ellipse(
        0.0, 0.0, 5.0, 25.0, 8
    )));
    assert!(!features::boat_plan_present(&rectangle(
        -5.0, -25.0, 10.0, 50.0
    )));
    let mut perturbed = outline.clone();
    perturbed[0].outer[9].x += 0.2;
    assert!(!features::boat_plan_present(&perturbed));
    let mut star = outline.clone();
    star[0].outer = (0..64).map(|i| outline[0].outer[i * 3 % 64]).collect();
    assert!(!features::boat_plan_present(&star));
    let mut holed = outline.clone();
    holed[0]
        .holes
        .push(rectangle(-1.0, -1.0, 2.0, 2.0)[0].outer.clone());
    assert!(!features::boat_plan_present(&holed));
}

#[test]
fn source_lean_to_rejects_missing_cut_low_detached_walls_and_bad_post_caps() {
    let data = catalogue::catalogue().unwrap();
    let recipe = data.recipes.iter().find(|r| r.id == "EUR-MED-B04").unwrap();
    let mut unit = magna_urbis_houses::generate_batch(HouseConfig {
        seed: "42".into(),
        pack: recipe.pack_id.clone(),
        recipe: Some(recipe.id.clone()),
        count: 1,
        variation: 0.0,
        ..Default::default()
    })
    .unwrap()
    .units
    .remove(0);
    let roof_before = unit
        .features
        .iter()
        .find(|f| f.kind == FeatureKind::Gallery)
        .unwrap()
        .roof
        .clone();
    features::refresh_wall_bearing_supports(&mut unit, &recipe.parameters).unwrap();
    assert_eq!(
        roof_before,
        unit.features
            .iter()
            .find(|f| f.kind == FeatureKind::Gallery)
            .unwrap()
            .roof
    );
    let roof = roof_before.unwrap();
    let high_z = roof.support_z_m + roof.arms[0].width_m * roof.pitch_deg.to_radians().tan();
    let a = roof.arms[0].origin;
    let b = geometry::point(a.x + roof.arms[0].length_m, a.y);
    let sections = geometry::unite(
        &roof
            .supports
            .iter()
            .filter_map(|id| unit.walls.iter().find(|w| &w.id == id))
            .map(|w| wall_geometry::wall_section(w, high_z))
            .collect::<Vec<_>>(),
    );
    assert_eq!(
        roofs::support_line_intervals(a, b, &sections),
        vec![(0.0, 1.0)]
    );

    let mut missing = unit.clone();
    missing.walls.clear();
    assert!(
        features::refresh_wall_bearing_supports(&mut missing, &recipe.parameters)
            .unwrap_err()
            .contains("arête haute")
    );
    let mut wrong_level = unit.clone();
    for wall in &mut wrong_level.walls {
        wall.level = 99;
    }
    assert!(
        features::refresh_wall_bearing_supports(&mut wrong_level, &recipe.parameters)
            .unwrap_err()
            .contains("arête haute")
    );
    let mut wrong_owner = unit.clone();
    for wall in &mut wrong_owner.walls {
        wall.body_id = Some("unrelated-body".into());
    }
    assert!(
        features::refresh_wall_bearing_supports(&mut wrong_owner, &recipe.parameters)
            .unwrap_err()
            .contains("arête haute")
    );
    let mut cut = unit.clone();
    for wall in &mut cut.walls {
        wall.footprint = difference(&wall.footprint, &rectangle(3.2, 9.0, 0.2, 1.0));
    }
    assert!(
        features::refresh_wall_bearing_supports(&mut cut, &recipe.parameters)
            .unwrap_err()
            .contains("arête haute")
    );
    let mut low = unit.clone();
    for wall in &mut low.walls {
        wall.height_m = 1.0;
    }
    assert!(
        features::refresh_wall_bearing_supports(&mut low, &recipe.parameters)
            .unwrap_err()
            .contains("arête haute")
    );
    let mut detached = unit.clone();
    for wall in &mut detached.walls {
        for poly in &mut wall.footprint {
            for q in &mut poly.outer {
                q.y += 2.0;
            }
        }
    }
    assert!(
        features::refresh_wall_bearing_supports(&mut detached, &recipe.parameters)
            .unwrap_err()
            .contains("arête haute")
    );
    let mut no_lintel = unit.clone();
    no_lintel.walls.retain(|w| !w.id.starts_with("lintel:"));
    assert!(
        features::refresh_wall_bearing_supports(&mut no_lintel, &recipe.parameters)
            .unwrap_err()
            .contains("arête haute")
    );
    for dy in [1.0, -0.8] {
        let mut moved = unit.clone();
        let post = moved
            .features
            .iter_mut()
            .find(|f| f.id.starts_with("gallery-support:"))
            .unwrap();
        for poly in &mut post.surface {
            for q in &mut poly.outer {
                q.y += dy;
            }
        }
        assert!(
            features::refresh_wall_bearing_supports(&mut moved, &recipe.parameters)
                .unwrap_err()
                .contains("sans contact")
        );
    }
    let mut short_post = unit.clone();
    short_post
        .features
        .iter_mut()
        .find(|f| f.id.starts_with("gallery-support:"))
        .unwrap()
        .height_m -= 0.1;
    assert!(
        features::refresh_wall_bearing_supports(&mut short_post, &recipe.parameters)
            .unwrap_err()
            .contains("sans contact")
    );
    let mut blocked = unit.clone();
    let post_surface = blocked
        .features
        .iter()
        .find(|f| f.id.starts_with("gallery-support:"))
        .unwrap()
        .surface
        .clone();
    blocked.partition.circulation = post_surface;
    assert!(
        features::refresh_wall_bearing_supports(&mut blocked, &recipe.parameters)
            .unwrap_err()
            .contains("passage natif")
    );
    let mut none = recipe.parameters.clone();
    none.gallery_cover.facade_mode = None;
    let before = serde_json::to_vec(&missing).unwrap();
    features::refresh_wall_bearing_supports(&mut missing, &none).unwrap();
    assert_eq!(serde_json::to_vec(&missing).unwrap(), before);
}

#[test]
fn source_lean_to_refreshes_real_window_volumes_after_window_cuts() {
    let data = catalogue::catalogue().unwrap();
    let recipe = data.recipes.iter().find(|r| r.id == "EUR-MED-B04").unwrap();
    let mut unit = magna_urbis_houses::generate_batch(HouseConfig {
        seed: "42".into(),
        pack: recipe.pack_id.clone(),
        recipe: Some(recipe.id.clone()),
        count: 1,
        variation: 0.0,
        ..Default::default()
    })
    .unwrap()
    .units
    .remove(0);
    // A dyadic, ordinary facade isolates a real window opening from the
    // measured sub-nanometre door seams of the source replay.
    let mut facade = unit
        .walls
        .iter()
        .find(|w| w.kind == WallKind::Exterior && w.level == 0)
        .unwrap()
        .clone();
    facade.footprint = rectangle(0.0, 9.25, 7.0, 0.25);
    facade.centerline = vec![geometry::point(0.0, 9.5), geometry::point(7.0, 9.5)];
    facade.opening_ids.clear();
    facade.solid = None;
    unit.walls = vec![facade];
    unit.bodies[0].wall_thickness_m = 0.2;
    unit.access.portals.clear();
    unit.partition.circulation.clear();
    let mut p = recipe.parameters.clone();
    p.details.push("narrow_windows".into());
    p.detail_spec = data
        .recipes
        .iter()
        .find(|r| r.parameters.details.iter().any(|t| t == "narrow_windows"))
        .unwrap()
        .parameters
        .detail_spec
        .clone();
    p.detail_spec.as_mut().unwrap().window_sill_m = 0.8;
    p.detail_spec.as_mut().unwrap().window_height_m = 1.0;
    p.detail_spec.as_mut().unwrap().narrow_window_width_m = 0.5;
    let mut covered = unit.clone();
    features::add_post_access_details(&mut covered, &p).unwrap();
    assert!(
        covered
            .features
            .iter()
            .any(|f| f.kind == FeatureKind::Window)
    );
    let roof = covered
        .features
        .iter()
        .find(|f| f.kind == FeatureKind::Gallery)
        .unwrap()
        .roof
        .as_ref()
        .unwrap();
    assert!(roof.supports.iter().any(|id| id.contains(":volume:")));
    assert!(
        roof.supports
            .iter()
            .filter(|id| !id.starts_with("gallery-support:"))
            .all(|id| covered.walls.iter().any(|w| &w.id == id))
    );
    let mut cut = unit;
    p.detail_spec.as_mut().unwrap().window_sill_m = 1.3;
    p.detail_spec.as_mut().unwrap().window_height_m = 1.2;
    let error = features::add_post_access_details(&mut cut, &p).unwrap_err();
    let window = cut
        .features
        .iter()
        .find(|f| f.kind == FeatureKind::Window)
        .unwrap();
    assert!(error.contains("arête haute"), "{error}");
    let roof = cut
        .features
        .iter()
        .find(|f| f.kind == FeatureKind::Gallery)
        .unwrap()
        .roof
        .as_ref()
        .unwrap();
    let a = roof.arms[0].origin;
    let b = geometry::point(a.x + roof.arms[0].length_m, a.y);
    let high_z = roof.support_z_m + roof.arms[0].width_m * roof.pitch_deg.to_radians().tan();
    assert!(window.z_m < high_z && window.z_m + window.height_m > high_z);
    let sections = geometry::unite(
        &cut.walls
            .iter()
            .map(|w| wall_geometry::wall_section(w, high_z))
            .collect::<Vec<_>>(),
    );
    let intervals = roofs::support_line_intervals(a, b, &sections);
    assert!(!intervals.iter().any(|(lo, hi)| *lo <= 0.5 && *hi >= 0.5));
    assert!(geometry::bounds(&window.surface)[2] - geometry::bounds(&window.surface)[0] >= 0.499);
}

#[test]
fn source_varied_lean_to_replays_all_ten_units_with_actual_cited_sections() {
    let data = catalogue::catalogue().unwrap();
    let recipe = data.recipes.iter().find(|r| r.id == "EUR-MED-B04").unwrap();
    for variant in [None, Some("slate_cladding")] {
        let batch = magna_urbis_houses::generate_batch(HouseConfig {
            seed: "42".into(),
            pack: recipe.pack_id.clone(),
            recipe: Some(recipe.id.clone()),
            count: 10,
            variation: 0.65,
            overrides: Overrides {
                variant: variant.map(str::to_owned),
                ..Default::default()
            },
            ..Default::default()
        })
        .unwrap();
        assert_eq!(batch.units.len(), 10);
        for mut unit in batch.units {
            let before = unit
                .features
                .iter()
                .find(|f| f.kind == FeatureKind::Gallery)
                .unwrap()
                .roof
                .clone();
            let p = variant.map_or(&recipe.parameters, |v| {
                &recipe
                    .variants
                    .iter()
                    .find(|b| b.id == v)
                    .unwrap()
                    .parameters
            });
            features::refresh_wall_bearing_supports(&mut unit, p).unwrap();
            let roof = unit
                .features
                .iter()
                .find(|f| f.kind == FeatureKind::Gallery)
                .unwrap()
                .roof
                .as_ref()
                .unwrap();
            assert_eq!(before.as_ref(), Some(roof));
            let a = roof.arms[0].origin;
            let b = Point {
                x: a.x + roof.arms[0].length_m,
                y: a.y,
            };
            let z = roof.support_z_m + roof.arms[0].width_m * roof.pitch_deg.to_radians().tan();
            let raw: Surface = roof
                .supports
                .iter()
                .filter_map(|id| unit.walls.iter().find(|w| &w.id == id))
                .flat_map(|w| wall_geometry::wall_section(w, z))
                .collect();
            let intervals = roofs::support_line_intervals(a, b, &raw);
            assert_eq!(intervals.first().unwrap().0, 0.0);
            assert_eq!(intervals.last().unwrap().1, 1.0);
            assert!(intervals.windows(2).all(|v| v[0].1 == v[1].0));
            if unit.id == "unit-6" {
                assert!(
                    roof.supports
                        .iter()
                        .any(|id| id == "wall:unit-6:body:0:0:0")
                );
                assert!(
                    roof.supports
                        .iter()
                        .any(|id| id == "lintel:wall:unit-6:body:0:0:0:unit-6:portal:0")
                );
                assert!(
                    !roof
                        .supports
                        .iter()
                        .any(|id| id.ends_with("portal:1") || id.ends_with("portal:2"))
                );
            }
        }
    }
}

#[test]
fn source_lean_to_rejects_lateral_nonrectangular_clipped_and_overwide_bearings() {
    let data = catalogue::catalogue().unwrap();
    let recipe = data.recipes.iter().find(|r| r.id == "EUR-MED-B04").unwrap();
    let source = magna_urbis_houses::generate_batch(HouseConfig {
        pack: recipe.pack_id.clone(),
        recipe: Some(recipe.id.clone()),
        count: 1,
        variation: 0.0,
        ..Default::default()
    })
    .unwrap()
    .units
    .remove(0);
    for trait_ in ["continuous_veranda", "side_corridor"] {
        let mut p = recipe.parameters.clone();
        p.details.push(trait_.into());
        let mut unit = source.clone();
        assert!(
            features::add_details(&mut unit, recipe, &p, &HouseConfig::default())
                .unwrap_err()
                .contains("latéral")
        );
    }
    let clear = |unit: &mut HouseUnit| {
        unit.features
            .retain(|f| f.kind != FeatureKind::Gallery && !f.id.starts_with("gallery-support:"));
        unit.roofs = RoofMesh::default();
    };
    let mut nonrect = source.clone();
    clear(&mut nonrect);
    nonrect.bodies[0].levels[0].footprint[0].outer[0].x += 0.1;
    assert!(
        features::add_details(
            &mut nonrect,
            recipe,
            &recipe.parameters,
            &HouseConfig::default()
        )
        .unwrap_err()
        .contains("rectangulaire")
    );
    let mut clipped = source.clone();
    clear(&mut clipped);
    clipped.lot = rectangle(0.0, 0.0, 7.0, 9.6);
    assert!(
        features::add_details(
            &mut clipped,
            recipe,
            &recipe.parameters,
            &HouseConfig::default()
        )
        .unwrap_err()
        .contains("bande de façade")
    );
    let mut wide = source;
    clear(&mut wide);
    wide.access.portals.clear();
    wide.bodies[0].wall_thickness_m = 0.6;
    for wall in &mut wide.walls {
        if wall.kind == WallKind::Exterior && !wall.id.starts_with("lintel:") {
            wall.footprint = difference(
                &rectangle(0.0, 0.0, 7.0, 9.5),
                &rectangle(0.6, 0.6, 5.8, 8.3),
            );
        }
    }
    wide.walls.retain(|w| !w.id.starts_with("lintel:"));
    features::add_details(
        &mut wide,
        recipe,
        &recipe.parameters,
        &HouseConfig::default(),
    )
    .unwrap();
    features::refresh_wall_bearing_supports(&mut wide, &recipe.parameters).unwrap();
    let error = roofs::build_roofs(&mut wide).unwrap_err();
    assert!(error.contains("Extrémité de rive sans appui"), "{error}");
}

#[test]
fn four_horns_trait_requires_real_peaks_steps_and_frames() {
    let data = catalogue::catalogue().unwrap();
    let recipe = data.recipes.iter().find(|r| r.id == "AS-ISL-B10").unwrap();
    let mut batch = magna_urbis_houses::generate_batch(HouseConfig {
        pack: recipe.pack_id.clone(),
        recipe: Some(recipe.id.clone()),
        count: 1,
        variation: 0.0,
        allow_late: true,
        ..Default::default()
    })
    .unwrap();
    features::add_post_roof_details(&mut batch.units[0], &recipe.parameters).unwrap();
    let mut missing = batch.units[0].clone();
    missing
        .roofs
        .faces
        .retain(|f| f.kind != RoofFaceKind::StepWall);
    assert!(features::add_post_roof_details(&mut missing, &recipe.parameters).is_err());
}

#[test]
fn four_horns_witness_uses_quantized_positions_and_preserves_the_mesh() {
    let data = catalogue::catalogue().unwrap();
    let recipe = data.recipes.iter().find(|r| r.id == "AS-ISL-B10").unwrap();
    let mut batch = magna_urbis_houses::generate_batch(HouseConfig {
        seed: "42".into(),
        pack: recipe.pack_id.clone(),
        recipe: Some(recipe.id.clone()),
        count: 10,
        variation: 0.65,
        allow_late: true,
        ..Default::default()
    })
    .unwrap();
    assert_eq!(batch.units.len(), 10);
    for unit in &mut batch.units {
        let before = serde_json::to_vec(&unit.roofs).unwrap();
        features::add_post_roof_details(unit, &recipe.parameters).unwrap();
        assert_eq!(
            before,
            serde_json::to_vec(&unit.roofs).unwrap(),
            "witness must preserve every mesh byte"
        );
        let mut missing = unit.clone();
        missing
            .roofs
            .faces
            .retain(|f| f.kind != RoofFaceKind::StepWall);
        assert!(features::add_post_roof_details(&mut missing, &recipe.parameters).is_err());
        let mut empty_frames = unit.clone();
        for frame in empty_frames
            .features
            .iter_mut()
            .filter(|f| f.id.contains(":horns:frame:"))
        {
            frame.vertices3d.clear();
        }
        assert!(features::add_post_roof_details(&mut empty_frames, &recipe.parameters).is_err());
    }
}

#[test]
fn source_lattice_and_six_log_joints_are_native_members_after_actual_doors() {
    let data = catalogue::catalogue().unwrap();
    let ids: [&str; 7] = [
        "AS-STEP-B01",
        "EUR-MED-B10",
        "EUR-NOR-B02",
        "EUR-NOR-B05",
        "EUR-EAST-B01",
        "AS-HIM-B04",
        "AS-SIB-B03",
    ];
    for id in ids {
        let recipe = data.recipes.iter().find(|r| r.id == id).unwrap();
        let batch = magna_urbis_houses::generate_batch(HouseConfig {
            pack: recipe.pack_id.clone(),
            recipe: Some(id.into()),
            count: 1,
            variation: 0.0,
            ..Default::default()
        })
        .unwrap_or_else(|e| panic!("{id}: {e}"));
        let unit = &batch.units[0];
        let prefix = if id == "AS-STEP-B01" {
            "source-lattice:"
        } else {
            "source-log-joint:"
        };
        let members: Vec<_> = unit
            .features
            .iter()
            .filter(|f| f.id.starts_with(prefix))
            .collect();
        assert!(!members.is_empty(), "{id}");
        assert!(
            !unit
                .features
                .iter()
                .any(|f| f.id.starts_with("detail-log_corners")
                    || f.id.starts_with("detail-lattice"))
        );
        for f in &members {
            assert_eq!(f.kind, FeatureKind::Frame);
            assert_eq!(f.vertices3d.len(), if id == "AS-STEP-B01" { 8 } else { 24 });
            assert!(area(&f.surface) > 0.000_1);
            assert!(area(&difference(&f.surface, &unit.lot)) < 0.000_001);
            for d in &unit.access.portals {
                if d.from_z_m + 0.001 < f.z_m + f.height_m && d.head_z_m > f.z_m {
                    assert!(
                        area(&intersection(&f.surface, &d.passage)) < 0.000_001,
                        "{id}: member through door {}",
                        d.id
                    );
                }
            }
        }
        if id == "AS-STEP-B01" {
            assert_eq!(unit.bodies[0].roof_system, "RF-DOME");
            assert!(members.len() <= 256);
            let mut displaced = unit.clone();
            displaced
                .roofs
                .edges
                .retain(|e| e.kind != RoofEdgeKind::Eave);
            assert!(features::add_post_roof_details(&mut displaced, &recipe.parameters).is_err());
            assert!(
                unit.diagnostics
                    .iter()
                    .any(|s| s.contains("égout natif jointif"))
            );
            assert!(
                members
                    .iter()
                    .any(|f| (f.vertices3d[0].z - f.vertices3d[4].z).abs() > 0.1)
            );
            let mut missing = unit.clone();
            missing.walls.clear();
            assert!(features::add_post_access_details(&mut missing, &recipe.parameters).is_err());
        } else {
            let groups: std::collections::BTreeSet<_> = members
                .iter()
                .map(|f| f.id.rsplit_once(':').unwrap().0)
                .collect();
            assert!(groups.len() >= 4);
            assert!(members.iter().all(|f| f.material == "MAT-LOG"));
        }
    }
}

#[test]
fn high_hall_witness_uses_real_roof_pans_and_residual_wall_sections() {
    let recipe = catalogue::catalogue()
        .unwrap()
        .recipes
        .iter()
        .find(|r| r.id == "AF-NILE-B08")
        .unwrap()
        .clone();
    let mut batch = magna_urbis_houses::generate_batch(HouseConfig {
        pack: recipe.pack_id.clone(),
        recipe: Some(recipe.id.clone()),
        count: 1,
        variation: 0.0,
        ..Default::default()
    })
    .unwrap();
    features::add_post_roof_details(&mut batch.units[0], &recipe.parameters).unwrap();
    let mut missing = batch.units[0].clone();
    missing.roofs.faces.clear();
    assert!(features::add_post_roof_details(&mut missing, &recipe.parameters).is_err());
}

#[test]
fn sourced_wall_qualities_socles_and_retaining_terraces_are_physical() {
    let data = catalogue::catalogue().unwrap();
    let mut failures = vec![];
    for id in [
        "EUR-EAST-B03",
        "AF-MAG-B05",
        "AF-NILE-B06",
        "AS-MIDE-B06",
        "AF-WEST-B10",
        "AM-AND-B07",
        "EUR-MED-B10",
        "AS-HIM-B04",
        "AS-KOR-B03",
        "OC-PAC-B10",
        "AM-MESO-B10",
        "AF-SAHEL-B08",
        "AS-HIM-B02",
        "AM-MESO-B13",
    ] {
        let recipe = data.recipes.iter().find(|r| r.id == id).unwrap();
        let batch = match magna_urbis_houses::generate_batch(HouseConfig {
            pack: recipe.pack_id.clone(),
            recipe: Some(id.into()),
            count: 1,
            variation: 0.0,
            allow_late: true,
            ..Default::default()
        }) {
            Ok(batch) => batch,
            Err(e) => {
                failures.push(format!("{id}: {e}"));
                continue;
            }
        };
        let unit = &batch.units[0];
        let s = recipe.parameters.structural_spec.as_ref().unwrap();
        if s.walls
            .iter()
            .any(|w| w.role == catalogue::StructureWallRole::Base)
        {
            assert!(
                unit.walls
                    .iter()
                    .any(|w| w.id.starts_with("wall:source-base:") && w.height_m > 0.0)
            );
        }
        if s.retaining.is_some() {
            let massifs: Vec<_> = unit
                .walls
                .iter()
                .filter(|w| {
                    w.id.starts_with("wall:source-retaining-")
                        || w.id.starts_with("wall:source-site-bench")
                })
                .collect();
            assert!(!massifs.is_empty());
            for w in massifs {
                wall_geometry::validate_wall(w).unwrap();
                assert!(wall_geometry::signed_volume(w.solid.as_ref().unwrap()) > 0.0);
            }
            assert!(unit.bodies.iter().any(|b| b.levels[0].z_m > 0.0) || unit.bodies.len() == 1);
        }
        if let Some(i) = &s.island {
            assert!(
                unit.bodies
                    .iter()
                    .all(|b| (b.levels[0].z_m - i.height_m).abs() < 0.000_001)
            );
            let garden = unit
                .features
                .iter()
                .find(|f| f.kind == FeatureKind::Garden)
                .unwrap();
            assert!(
                !unit
                    .features
                    .iter()
                    .any(|f| f.id.starts_with("detail-garden"))
            );
            assert!(
                area(&intersection(
                    &garden.surface,
                    &geometry::unite(
                        &unit
                            .bodies
                            .iter()
                            .map(|b| b.footprint.clone())
                            .collect::<Vec<_>>()
                    )
                )) < 0.000_001
            );
            assert!(
                unit.features
                    .iter()
                    .any(|f| f.id.starts_with("island-pile-") && f.z_m < 0.0)
            );
            assert!(
                unit.walls
                    .iter()
                    .any(|w| w.id == "wall:island-fill-main" && w.solid.is_some())
            );
            let fill = geometry::unite(
                &unit
                    .walls
                    .iter()
                    .filter(|w| w.id.starts_with("wall:island-fill-"))
                    .map(|w| w.footprint.clone())
                    .collect::<Vec<_>>(),
            );
            let water = &unit
                .site_context
                .iter()
                .find(|f| f.id == "island-canals")
                .unwrap()
                .surface;
            assert!(area(&intersection(water, &fill)) < 0.000_001);
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn sourced_moorings_inner_membrane_and_banks_have_physical_geometry() {
    let data = catalogue::catalogue().unwrap();
    for id in [
        "AS-SEA-B12",
        "EUR-NOR-B07",
        "AM-PUEB-B06",
        "AS-SIB-B02",
        "AM-ARC-B02",
        "AM-ARC-B03",
        "AS-SIB-B04",
    ] {
        let recipe = data.recipes.iter().find(|r| r.id == id).unwrap();
        let batch = magna_urbis_houses::generate_batch(HouseConfig {
            pack: recipe.pack_id.clone(),
            recipe: Some(id.into()),
            count: 1,
            variation: 0.0,
            ..Default::default()
        })
        .unwrap_or_else(|e| panic!("{id}: {e}"));
        let unit = &batch.units[0];
        if id == "AS-SEA-B12" {
            let ropes: Vec<_> = unit
                .features
                .iter()
                .filter(|f| f.kind == FeatureKind::Mooring)
                .collect();
            assert_eq!(ropes.len(), 3);
            assert_eq!(
                unit.features
                    .iter()
                    .filter(|f| f.id.starts_with("mooring-anchor:"))
                    .count(),
                3
            );
            assert!(ropes.iter().all(|f| f.material == "MAT-CORDAGE"
                && f.vertices3d.len() == 2
                && f.vertices3d[0].z > f.vertices3d[1].z));
        } else if id == "AS-SIB-B02" {
            assert_eq!(unit.bodies.len(), 1);
            let tent = unit
                .features
                .iter()
                .find(|f| f.id == "inner-tent-membrane")
                .unwrap();
            assert_eq!(tent.kind, FeatureKind::InnerMembrane);
            let roof = tent.roof.as_ref().unwrap();
            assert!(roof.nested);
            assert_eq!(
                roof.owner_body_id.as_deref(),
                Some(unit.bodies[0].id.as_str())
            );
            assert!(area(&difference(&roof.domain, &unit.bodies[0].footprint)) < 0.000_001);
            assert!(
                unit.roofs
                    .groups
                    .iter()
                    .any(|g| g.feature_id.as_deref() == Some("inner-tent-membrane"))
            );
        } else {
            let walls: Vec<_> = unit
                .walls
                .iter()
                .filter(|w| w.id.starts_with("wall:earth-bank-"))
                .collect();
            assert!(!walls.is_empty());
            for wall in walls {
                wall_geometry::validate_wall(wall).unwrap();
                assert!(wall_geometry::signed_volume(wall.solid.as_ref().unwrap()) > 0.0);
                let zs: std::collections::BTreeSet<_> = wall
                    .solid
                    .as_ref()
                    .unwrap()
                    .vertices
                    .iter()
                    .map(|v| geometry::snap(v.z) * 1000.0)
                    .map(|v| v as i64)
                    .collect();
                assert!(zs.len() >= 2);
                for body in &unit.bodies {
                    assert!(
                        area(&intersection(&wall.footprint, &body.footprint)) < 0.000_001,
                        "{id}: annex bank {} enters {}",
                        wall.id,
                        body.id
                    );
                }
                for room in &unit.rooms {
                    assert!(
                        area(&intersection(
                            &wall_geometry::wall_section(wall, room.z_m + 0.01),
                            &room.floor
                        )) < 0.000_001,
                        "{id}: physical bank {} enters {}",
                        wall.id,
                        room.id
                    );
                }
            }
        }
    }
}

#[test]
fn siberian_connected_cells_keep_whole_bodies_and_convex_bank_volumes() {
    let data = catalogue::catalogue().unwrap();
    let recipe = data.recipes.iter().find(|r| r.id == "AS-SIB-B08").unwrap();
    for (bodies, variation) in [(None, 0.0), (Some(3), 0.0), (Some(6), 0.0), (None, 0.65)] {
        let batch = magna_urbis_houses::generate_batch(HouseConfig {
            schema_version: "2".into(),
            seed: "42".into(),
            pack: recipe.pack_id.clone(),
            recipe: Some(recipe.id.clone()),
            count: 1,
            variation,
            overrides: Overrides {
                bodies,
                ..Default::default()
            },
            ..Default::default()
        })
        .unwrap_or_else(|e| panic!("AS-SIB-B08 bodies={bodies:?}, variation={variation}: {e}"));
        let unit = &batch.units[0];
        if let Some(count) = bodies {
            assert_eq!(unit.bodies.len(), count as usize);
        }
        let banks: Vec<_> = unit
            .walls
            .iter()
            .filter(|w| w.id.starts_with("wall:earth-bank-"))
            .collect();
        assert!(!banks.is_empty());
        for bank in banks {
            wall_geometry::validate_wall(bank).unwrap();
            assert!(wall_geometry::signed_volume(bank.solid.as_ref().unwrap()) > 0.0);
            for body in &unit.bodies {
                assert!(
                    area(&intersection(&bank.footprint, &body.footprint)) < 0.000_001,
                    "bank {} enters {}",
                    bank.id,
                    body.id
                );
            }
            for room in &unit.rooms {
                assert!(
                    area(&intersection(
                        &wall_geometry::wall_section(bank, room.z_m + 0.01),
                        &room.floor
                    )) < 0.000_001,
                    "bank {} enters {}",
                    bank.id,
                    room.id
                );
            }
        }
    }
}

#[test]
fn source_variant_bundles_keep_native_material_storeys_and_clear_annex_banks() {
    let data = catalogue::catalogue().unwrap();
    for (id, variant) in [
        ("EUR-MED-B10", "eaves_slate"),
        ("AS-HIM-B04", "eaves_slate"),
        ("AF-MAG-B05", "rammed_walls"),
        ("AS-MIDE-B06", "vault_brick"),
        ("AS-MIDE-B06", "dome_brick"),
        ("AM-ARC-B02", "flat_earth"),
        ("AM-ARC-B03", "flat_earth"),
        ("AS-SIB-B04", "flat_earth"),
    ] {
        let recipe = data.recipes.iter().find(|r| r.id == id).unwrap();
        let batch = magna_urbis_houses::generate_batch(HouseConfig {
            pack: recipe.pack_id.clone(),
            recipe: Some(id.into()),
            count: 1,
            variation: 0.0,
            overrides: Overrides {
                variant: Some(variant.into()),
                ..Default::default()
            },
            ..Default::default()
        })
        .unwrap_or_else(|e| panic!("{id}/{variant}: {e}"));
        let unit = &batch.units[0];
        if ["EUR-MED-B10", "AS-HIM-B04"].contains(&id) {
            assert!(
                unit.walls
                    .iter()
                    .filter(|w| w.kind == WallKind::Exterior && w.level == 0)
                    .all(|w| w.material == "MAT-STONE-MORTAR"),
                "{id}/{variant}"
            );
        }
        for bank in unit
            .walls
            .iter()
            .filter(|w| w.id.starts_with("wall:earth-bank-"))
        {
            for body in &unit.bodies {
                assert!(
                    area(&intersection(&bank.footprint, &body.footprint)) < 0.000_001,
                    "{id}/{variant}: {} enters {}",
                    bank.id,
                    body.id
                );
            }
        }
    }
}

#[test]
fn native_wind_house_emits_its_shaft_and_native_silos_do_not_duplicate_storage() {
    for id in ["AS-MIDE-B09", "AF-NILE-B04", "AF-SAHEL-B08"] {
        let data = catalogue::catalogue().unwrap();
        let recipe = data.recipes.iter().find(|r| r.id == id).unwrap();
        let config = HouseConfig {
            pack: recipe.pack_id.clone(),
            recipe: Some(id.into()),
            count: 1,
            variation: 0.0,
            ..HouseConfig::default()
        };
        let batch = magna_urbis_houses::generate_batch(config).unwrap();
        let unit = &batch.units[0];
        if id == "AS-MIDE-B09" {
            let flue = unit
                .features
                .iter()
                .find(|f| f.kind == FeatureKind::Flue)
                .unwrap();
            let tower = unit
                .features
                .iter()
                .find(|f| f.kind == FeatureKind::Windcatcher)
                .unwrap();
            assert_eq!(flue.z_m, 0.0);
            assert!((flue.z_m + flue.height_m - tower.z_m).abs() < 0.001);
            let shaft = vec![Polygon {
                outer: flue.surface[0].holes[0].clone(),
                holes: vec![],
            }];
            assert!(unit.bodies.iter().flat_map(|b| &b.levels).all(|l| {
                l.roof_slab
                    .as_ref()
                    .is_none_or(|s| area(&intersection(&s.surface, &shaft)) < 0.001)
            }));
            assert!(
                !unit
                    .diagnostics
                    .iter()
                    .any(|d| d.contains("Trait windcatcher inapplicable"))
            );
        } else {
            assert!(
                !unit
                    .features
                    .iter()
                    .any(|f| f.kind == FeatureKind::StorageBin)
            );
            assert!(
                unit.diagnostics
                    .iter()
                    .any(|d| d.contains("volume de stockage natif"))
            );
            for body in unit.bodies.iter().filter(|b| b.role == Role::DomesticAnnex) {
                assert!(
                    unit.rooms
                        .iter()
                        .filter(|r| r.body_id == body.id)
                        .all(|r| r.usage == RoomUsage::Storage)
                );
            }
        }
    }
}

fn fixture() -> (HouseUnit, catalogue::Recipe, catalogue::Parameters) {
    let data = catalogue::catalogue().unwrap();
    let recipe = data
        .recipes
        .iter()
        .find(|r| r.id == "EUR-MED-B01")
        .unwrap()
        .clone();
    let mut p = recipe.parameters.clone();
    p.enclosures.clear();
    p.details.clear();
    let footprint = rectangle(3.0, 3.0, 8.0, 6.0);
    let floor = rectangle(3.4, 3.4, 7.2, 5.2);
    let level = Level {
        index: 0,
        z_m: 0.0,
        height_m: 2.8,
        footprint: footprint.clone(),
        floor: floor.clone(),
        intermediate_cover: IntermediateCover::None,
        roof_slab: None,
        materials: p.materials.clone(),
    };
    let body = Body {
        id: "body".into(),
        footprint: footprint.clone(),
        voids: vec![],
        levels: vec![level],
        roof_system: "RF-GABLE".into(),
        roof_pitch_deg: 35.0,
        overhang_m: 0.5,
        details: vec![],
        role: Role::Dwelling,
        envelope: Envelope::Walled,
        vertical_access: VerticalAccess::None,
        vertical_routes: vec![],
        wall_thickness_m: 0.4,
        component_id: None,
        roof_spec: p.roof_spec.clone(),
        roof_arms: vec![],
        cells: vec![],
    };
    let room = Room {
        id: "room".into(),
        body_id: "body".into(),
        level: 0,
        z_m: 0.0,
        floor,
        usage: RoomUsage::Living,
        access_node: "".into(),
        household_id: None,
    };
    let unit = HouseUnit {
        id: "test".into(),
        recipe_id: recipe.id.clone(),
        variant_id: "default".into(),
        label: "test".into(),
        role: Role::Dwelling,
        transform: Transform {
            origin: Point { x: 0.0, y: 0.0 },
            orientation_deg: 0.0,
        },
        lot: rectangle(0.0, 0.0, 20.0, 20.0),
        partition: Partition {
            occupied: footprint,
            courtyards: rectangle(12.0, 3.0, 6.0, 7.0),
            circulation: rectangle(6.5, 0.0, 1.4, 20.0),
            service: vec![],
            residual: vec![],
        },
        level_partitions: vec![],
        levels: vec![],
        bodies: vec![body],
        rooms: vec![room],
        features: vec![],
        walls: vec![],
        site_context: vec![],
        access: AccessGraph {
            root: "".into(),
            nodes: vec![],
            portals: vec![],
        },
        roofs: RoofMesh::default(),
        diagnostics: vec![],
    };
    (unit, recipe, p)
}

#[test]
fn gallery_slab_attribution_uses_final_holes_and_real_access_voids() {
    let (mut unit, _, mut p) = fixture();
    p.gallery_cover.enabled = true;
    let gallery = rectangle(4.0, 4.0, 3.0, 2.0);
    unit.features.push(Feature {
        id: "slab-gallery".into(),
        kind: FeatureKind::Gallery,
        surface: gallery.clone(),
        z_m: 0.0,
        height_m: 0.15,
        material: p.materials.frame.clone(),
        vertices3d: vec![],
        roof: None,
    });
    unit.bodies[0].levels[0].roof_slab = Some(RoofSlab {
        surface: gallery.clone(),
        z_m: 2.8,
        walkable: true,
        access_node: None,
    });
    features::add_post_access_details(&mut unit, &p).unwrap();
    assert!(
        unit.diagnostics
            .iter()
            .any(|d| d.contains("couverture physique vérifiée après accès"))
    );
    assert!(unit.features[0].roof.is_none());

    let opening = rectangle(5.0, 4.5, 0.5, 0.5);
    unit.bodies[0].levels[0].roof_slab.as_mut().unwrap().surface = difference(&gallery, &opening);
    unit.diagnostics.clear();
    features::add_post_access_details(&mut unit, &p).unwrap();
    assert!(
        unit.diagnostics
            .iter()
            .any(|d| d.contains("0.250000 m² sans dalle ou auvent"))
    );
    assert!(
        !unit
            .diagnostics
            .iter()
            .any(|d| d.contains("couverture physique vérifiée"))
    );

    unit.features.push(Feature {
        id: "stair-void".into(),
        kind: FeatureKind::Stair,
        surface: opening,
        z_m: 0.0,
        height_m: 2.8,
        material: p.materials.frame.clone(),
        vertices3d: vec![],
        roof: None,
    });
    unit.diagnostics.clear();
    features::add_post_access_details(&mut unit, &p).unwrap();
    assert!(
        unit.diagnostics
            .iter()
            .any(|d| d.contains("0.250 m² d'ouvertures d'accès"))
    );
    assert!(unit.features.iter().all(|f| f.roof.is_none()));
}

#[test]
fn the_closed_trait_registry_has_explicit_operators() {
    let data = catalogue::catalogue().unwrap();
    for entry in &data.geometry_traits {
        let (mut unit, recipe, mut p) = fixture();
        p.details = vec![entry.id.clone()];
        if ["earth_bank", "turf_bank", "lattice", "log_corners"].contains(&entry.id.as_str()) {
            p.structural_spec = data
                .recipes
                .iter()
                .find(|r| r.parameters.details.contains(&entry.id))
                .unwrap()
                .parameters
                .structural_spec
                .clone();
            // This fixture checks registry dispatch. Source-specific mineral
            // storeys are verified by their own native recipe tests above.
            p.structural_spec.as_mut().unwrap().walls.clear();
        }
        features::add_details(&mut unit, &recipe, &p, &HouseConfig::default())
            .unwrap_or_else(|error| panic!("{}: {error}", entry.id));
    }
    let (mut unit, recipe, mut p) = fixture();
    p.details = vec!["an_unknown_style".into()];
    assert!(features::add_details(&mut unit, &recipe, &p, &HouseConfig::default()).is_err());
}

#[test]
fn hearths_fit_living_space_and_avoid_reserved_passages() {
    let (mut unit, recipe, mut p) = fixture();
    p.details = vec!["hearth".into()];
    features::add_details(&mut unit, &recipe, &p, &HouseConfig::default()).unwrap();
    let hearth = unit
        .features
        .iter()
        .find(|f| f.kind == FeatureKind::Hearth)
        .unwrap();
    assert!(area(&difference(&hearth.surface, &unit.rooms[0].floor)) < 0.000_01);
    assert!(area(&intersection(&hearth.surface, &unit.partition.circulation)) < 0.000_01);
    unit.role = Role::DomesticAnnex;
    unit.rooms[0].usage = RoomUsage::Storage;
    unit.features.clear();
    features::add_details(&mut unit, &recipe, &p, &HouseConfig::default()).unwrap();
    assert!(!unit.features.iter().any(|f| f.kind == FeatureKind::Hearth));
    assert!(
        unit.diagnostics
            .iter()
            .any(|d| d.contains("hearth") && d.contains("inapplicable"))
    );
}

#[test]
fn declared_enclosures_have_a_physical_gate() {
    let (mut unit, recipe, mut p) = fixture();
    p.enclosures = vec![EnclosureSpec {
        family: EnclosureFamily::EarthWall,
        placement: Placement::Peripheral,
        gate_width_m: 1.5,
    }];
    features::add_details(&mut unit, &recipe, &p, &HouseConfig::default()).unwrap();
    let enclosure = unit
        .features
        .iter()
        .find(|f| f.kind == FeatureKind::Enclosure)
        .unwrap();
    let gate = rectangle(9.25, 19.3, 1.5, 0.7);
    assert!(area(&enclosure.surface) > 10.0);
    assert!(area(&intersection(&enclosure.surface, &gate)) < 0.000_01);
    assert_eq!(enclosure.material, "MAT-ADOBE");
}

#[test]
fn arcs_and_sloped_terrain_export_real_heights() {
    let (mut unit, recipe, mut p) = fixture();
    p.details = vec!["arcs".into()];
    let mut config = HouseConfig::default();
    config.overrides.site_slope_deg = Some(15.0);
    features::add_details(&mut unit, &recipe, &p, &config).unwrap();
    let arc = unit
        .features
        .iter()
        .find(|f| f.kind == FeatureKind::RoofArc)
        .unwrap();
    assert!(arc.vertices3d.iter().any(|v| v.z > arc.z_m + 0.5));
    let terrain = unit
        .site_context
        .iter()
        .find(|f| f.kind == FeatureKind::SiteSlope)
        .unwrap();
    assert!(terrain.vertices3d.iter().any(|v| v.z < -1.0));
    assert!(terrain.vertices3d.iter().any(|v| v.z == 0.0));
    let base = unit
        .features
        .iter()
        .find(|f| f.kind == FeatureKind::WallFooting)
        .unwrap();
    assert!(base.height_m > 0.0);
    assert!(base.vertices3d.iter().any(|v| v.z == 0.0));
}

#[test]
fn the_pre_access_stage_does_not_report_pending_operators_as_absent() {
    let (mut unit, recipe, mut p) = fixture();
    unit.bodies[0].roof_system = "RF-FLAT".into();
    unit.bodies[0].vertical_access = VerticalAccess::ExteriorStair;
    p.details = vec![
        "parapet".into(),
        "scupper".into(),
        "exterior_stair".into(),
        "single_door".into(),
    ];
    features::add_details(&mut unit, &recipe, &p, &HouseConfig::default()).unwrap();
    assert!(unit.diagnostics.is_empty(), "{:?}", unit.diagnostics);
}

#[test]
fn windows_cut_real_walls_and_keep_sills_heads_and_doors() {
    let (mut unit, recipe, mut p) = fixture();
    p.detail_spec = catalogue::catalogue()
        .unwrap()
        .recipes
        .iter()
        .find(|r| r.id == "AS-HIM-B03")
        .unwrap()
        .parameters
        .detail_spec
        .clone();
    p.details = vec!["carved_windows".into()];
    let footprint = unit.bodies[0].footprint.clone();
    let wall = difference(&footprint, &unit.rooms[0].floor);
    unit.walls.push(Wall {
        solid: None,
        plan_section: None,
        shell_reference: false,
        id: "outer".into(),
        kind: WallKind::Exterior,
        body_id: Some("body".into()),
        level: 0,
        z_m: 0.0,
        height_m: 2.8,
        footprint: wall,
        centerline: footprint[0].outer.clone(),
        material: p.materials.infill.clone(),
        party: false,
        opening_ids: vec![],
    });
    let doorway = rectangle(6.6, 8.3, 1.0, 0.8);
    unit.access.portals.push(Portal {
        shape: magna_urbis_houses::catalogue::PortalShape::Rect,
        top_width_m: None,
        sill_z_m: None,
        profile_id: None,
        id: "door".into(),
        kind: PortalKind::Door,
        from: "outside".into(),
        to: "room".into(),
        opening: [Point { x: 6.6, y: 9.0 }, Point { x: 7.6, y: 9.0 }],
        wall_id: Some("outer".into()),
        feature_ids: vec![],
        opening_surface: doorway.clone(),
        passage: doorway.clone(),
        width_m: 1.0,
        from_z_m: 0.0,
        to_z_m: 0.0,
        head_z_m: 2.05,
    });
    features::add_details(&mut unit, &recipe, &p, &HouseConfig::default()).unwrap();
    assert!(!unit.features.iter().any(|f| f.kind == FeatureKind::Window));
    features::add_post_access_details(&mut unit, &p).unwrap();
    let windows: Vec<_> = unit
        .features
        .iter()
        .filter(|f| f.kind == FeatureKind::Window)
        .collect();
    assert!(!windows.is_empty());
    for window in windows {
        assert!(area(&intersection(&window.surface, &doorway)) < 0.000_01);
        assert!(
            area(&intersection(
                &window.surface,
                &unit
                    .walls
                    .iter()
                    .find(|w| w.id == "outer")
                    .unwrap()
                    .footprint
            )) < 0.000_01
        );
        let section = |z| {
            geometry::unite(
                &unit
                    .walls
                    .iter()
                    .map(|w| wall_geometry::wall_section(w, z))
                    .collect::<Vec<_>>(),
            )
        };
        assert!(area(&difference(&window.surface, &section(window.z_m - 0.01))) < 0.000_01);
        assert!(
            area(&intersection(
                &window.surface,
                &section(window.z_m + window.height_m * 0.5)
            )) < 0.000_01
        );
        assert!(
            area(&difference(
                &window.surface,
                &section(window.z_m + window.height_m + 0.01)
            )) < 0.000_01
        );
    }
}

#[test]
fn oblique_posts_preserve_both_rings_on_sloping_ground() {
    let (mut unit, recipe, mut p) = fixture();
    p.detail_spec = catalogue::catalogue()
        .unwrap()
        .recipes
        .iter()
        .find(|r| r.id == "AS-ISL-B09")
        .unwrap()
        .parameters
        .detail_spec
        .clone();
    p.details = vec!["oblique_large_posts".into()];
    unit.features.push(Feature {
        id: "support:body:0:0".into(),
        kind: FeatureKind::Post,
        surface: rectangle(3.7, 3.7, 0.2, 0.2),
        z_m: 0.0,
        height_m: 1.8,
        material: "MAT-RAISED-POST".into(),
        vertices3d: vec![],
        roof: None,
    });
    let mut config = HouseConfig::default();
    config.overrides.site_slope_deg = Some(10.0);
    features::add_details(&mut unit, &recipe, &p, &config).unwrap();
    let diagonal = unit
        .features
        .iter()
        .find(|f| f.id.starts_with("detail-oblique_large_posts:"))
        .unwrap();
    assert_eq!(diagonal.vertices3d.len(), 32);
    assert!(diagonal.vertices3d[..16].iter().all(|v| v.z < 0.0));
    assert!(
        diagonal.vertices3d[16..]
            .iter()
            .all(|v| (v.z - 1.8).abs() < 0.000_01)
    );
    let center = |r: &[Vertex3]| r.iter().map(|v| v.x).sum::<f64>() / r.len() as f64;
    assert!((center(&diagonal.vertices3d[..16]) - center(&diagonal.vertices3d[16..])).abs() > 0.1);
    assert!(unit.features.iter().any(|f| f.id == "support:body:0:0"));
}

#[test]
fn guy_lines_start_on_real_round_membranes_and_remain_continuous() {
    let (mut unit, recipe, mut p) = fixture();
    p.detail_spec = catalogue::catalogue()
        .unwrap()
        .recipes
        .iter()
        .find(|r| r.id == "AF-MAG-B10")
        .unwrap()
        .parameters
        .detail_spec
        .clone();
    p.details = vec!["guy_ropes".into()];
    unit.bodies[0].footprint = geometry::ellipse(7.0, 7.0, 3.0, 2.5, 32);
    unit.bodies[0].envelope = Envelope::Membrane;
    features::add_details(&mut unit, &recipe, &p, &HouseConfig::default()).unwrap();
    features::add_post_access_details(&mut unit, &p).unwrap();
    let ropes: Vec<_> = unit
        .features
        .iter()
        .filter(|f| f.id.starts_with("detail-guy_ropes:"))
        .collect();
    assert!(ropes.len() >= 2);
    for rope in ropes {
        assert_eq!(rope.material, "MAT-CORDAGE");
        assert_eq!(rope.vertices3d.len(), 2);
        let start = &rope.vertices3d[0];
        assert!(
            unit.bodies[0].footprint[0]
                .outer
                .iter()
                .any(|q| q.x == start.x && q.y == start.y)
        );
        assert!(start.z > rope.vertices3d[1].z);
        assert!(area(&intersection(&rope.surface, &unit.partition.circulation)) < 0.000_01);
        assert_eq!(rope.surface.len(), 1);
    }
}

#[test]
fn ondol_is_under_one_living_floor_with_firebox_in_the_kitchen() {
    let (mut unit, recipe, mut p) = fixture();
    p.detail_spec = catalogue::catalogue()
        .unwrap()
        .recipes
        .iter()
        .find(|r| r.id == "AS-KOR-B05")
        .unwrap()
        .parameters
        .detail_spec
        .clone();
    p.details = vec!["ondol".into()];
    unit.rooms[0].floor = rectangle(3.4, 3.4, 3.1, 5.2);
    let mut secondary = unit.rooms[0].clone();
    secondary.id = "kitchen".into();
    secondary.floor = rectangle(6.9, 3.4, 3.7, 5.2);
    unit.rooms.push(secondary);
    features::add_details(&mut unit, &recipe, &p, &HouseConfig::default()).unwrap();
    assert_eq!(unit.rooms[1].usage, RoomUsage::Kitchen);
    features::add_post_access_details(&mut unit, &p).unwrap();
    let fire = unit
        .features
        .iter()
        .find(|f| f.kind == FeatureKind::Hearth)
        .unwrap();
    assert!(fire.z_m + fire.height_m < 0.0);
    assert!(area(&difference(&fire.surface, &unit.rooms[1].floor)) < 0.000_01);
    assert!(area(&intersection(&fire.surface, &unit.rooms[0].floor)) < 0.000_01);
    assert!(unit.features.iter().any(|f| f.kind == FeatureKind::Flue
        && f.id.contains("channels")
        && f.z_m + f.height_m < 0.0));
    assert!(unit.features.iter().any(|f| f.kind == FeatureKind::Flue
        && f.id.contains("chimney")
        && f.z_m + f.height_m > 2.8));
    let floor = unit
        .features
        .iter()
        .find(|f| f.id.contains("heated-floor:room"))
        .unwrap();
    assert_eq!(floor.material, "MAT-STONE-MORTAR");
    assert!((area(&floor.surface) - area(&unit.rooms[0].floor)).abs() < 0.000_01);
}

#[test]
fn windcatcher_has_a_continuous_air_shaft_and_a_real_terrace_hole() {
    let (mut unit, recipe, mut p) = fixture();
    p.detail_spec = catalogue::catalogue()
        .unwrap()
        .recipes
        .iter()
        .find(|r| r.id == "AS-MIDE-B09")
        .unwrap()
        .parameters
        .detail_spec
        .clone();
    p.details = vec!["windcatcher".into(), "ventilation_channels".into()];
    let domain = unit.bodies[0].footprint.clone();
    unit.bodies[0].roof_system = "RF-FLAT".into();
    unit.bodies[0].levels[0].roof_slab = Some(RoofSlab {
        surface: domain.clone(),
        z_m: 2.8,
        walkable: true,
        access_node: None,
    });
    unit.features.push(Feature {
        id: "terrace:body:0".into(),
        kind: FeatureKind::Terrace,
        surface: domain,
        z_m: 2.8,
        height_m: 0.15,
        material: "MAT-MUD-PLASTER".into(),
        vertices3d: vec![],
        roof: None,
    });
    features::add_details(&mut unit, &recipe, &p, &HouseConfig::default()).unwrap();
    let shaft = unit
        .features
        .iter()
        .find(|f| f.kind == FeatureKind::Flue)
        .unwrap();
    assert_eq!(shaft.surface[0].holes.len(), 1);
    assert_eq!(shaft.z_m + shaft.height_m, 2.8);
    let hole = vec![Polygon {
        outer: shaft.surface[0].holes[0].iter().rev().copied().collect(),
        holes: vec![],
    }];
    assert!(area(&hole) > 0.2);
    assert!(
        area(&intersection(
            &hole,
            &unit.bodies[0].levels[0].roof_slab.as_ref().unwrap().surface
        )) < 0.000_01
    );
    assert!(
        area(&intersection(
            &hole,
            &unit
                .features
                .iter()
                .find(|f| f.id == "terrace:body:0")
                .unwrap()
                .surface
        )) < 0.000_01
    );
}
