pub use magna_urbis_houses::{catalogue, geometry, model};
#[path = "../src/layouts.rs"]
mod layouts;
#[path = "../src/vertical_footprint.rs"]
mod vertical_footprint;

use catalogue::{Layout, catalogue};
use geometry::{area, bounds, difference, intersection, offset};
use model::FeatureKind;

#[test]
fn declared_dimensions_and_component_origins_keep_varied_batches_whole() {
    let data = catalogue().unwrap();
    for (id, index, bodies, floors, rooms) in [
        ("AF-NILE-B08", 7, 5, 2, 20),
        ("AF-EAST-B08", 2, 5, 3, 45),
        ("AS-CHI-B14", 2, 5, 3, 45),
        ("AF-WEST-B05", 5, 9, 2, 72),
        ("AF-WEST-B10", 5, 9, 2, 72),
        ("AM-AND-B07", 2, 12, 2, 96),
        ("AS-SEA-B04", 0, 5, 2, 8),
        ("AM-PUEB-B10", 0, 15, 2, 29),
        ("AS-MIDE-B03", 1, 4, 1, 8),
    ] {
        let recipe = data.recipes.iter().find(|r| r.id == id).unwrap();
        let batch = magna_urbis_houses::generate_batch(model::HouseConfig {
            seed: "42".into(),
            pack: recipe.pack_id.clone(),
            recipe: Some(id.into()),
            count: 10,
            variation: 0.65,
            allow_late: recipe.temporal.late_only,
            ..Default::default()
        })
        .unwrap_or_else(|e| panic!("{id}: {e}"));
        assert_eq!(batch.units.len(), 10);
        let unit = &batch.units[index];
        assert_eq!(unit.bodies.len(), bodies, "{id}: no body omitted");
        assert_eq!(
            unit.bodies[0].levels.len(),
            floors,
            "{id}: no storey omitted"
        );
        assert_eq!(unit.rooms.len(), rooms, "{id}: no room omitted");
        for u in &batch.units {
            if id == "AS-SEA-B04" {
                let mut row: Vec<_> = u
                    .bodies
                    .iter()
                    .filter(|b| b.component_id.as_deref() == Some("farm_annexes"))
                    .map(|b| bounds(&b.footprint))
                    .collect();
                row.sort_by(|a, b| a[0].total_cmp(&b[0]));
                for pair in row.windows(2) {
                    assert!(pair[1][0] - pair[0][2] >= 1.4 - 0.000_000_1);
                }
            }
            if id == "AM-PUEB-B10" {
                let kiva = u
                    .bodies
                    .iter()
                    .find(|b| b.component_id.as_deref() == Some("kiva"))
                    .unwrap();
                let min_x = bounds(&kiva.footprint)[0];
                for b in u
                    .bodies
                    .iter()
                    .filter(|b| b.component_id.as_deref() == Some("dwellings"))
                {
                    assert!(min_x - bounds(&b.footprint)[2] >= 1.4 - 0.000_000_1);
                }
            }
            if id == "AS-MIDE-B03" {
                for b in &u.bodies {
                    let ratio = b.roof_spec.vault.as_ref().unwrap().bearing_ratio;
                    for level in &b.levels {
                        for arm in &b.roof_arms {
                            assert!(level.height_m - ratio * arm.width_m >= 2.25);
                        }
                    }
                }
            }
        }
    }
}

#[test]
fn hausa_court_has_two_real_pockets_portals_and_covered_porticoes() {
    let data = catalogue().unwrap();
    let recipe = data
        .recipes
        .iter()
        .find(|r| r.id == "AF-SAHEL-B05")
        .unwrap();
    for variant in ["default", "vault_adobe"] {
        for floors in [1, 2] {
            let batch = magna_urbis_houses::generate_batch(model::HouseConfig {
                pack: recipe.pack_id.clone(),
                recipe: Some(recipe.id.clone()),
                count: 1,
                variation: 0.0,
                overrides: model::Overrides {
                    variant: Some(variant.into()),
                    floors: Some(floors),
                    ..Default::default()
                },
                ..Default::default()
            })
            .unwrap_or_else(|e| panic!("{variant} F{floors}: {e}"));
            let unit = &batch.units[0];
            assert_eq!(unit.bodies.len(), 4);
            for i in 0..2 {
                let pocket = unit
                    .features
                    .iter()
                    .find(|f| f.id == format!("court-pocket-{i}"))
                    .unwrap();
                assert_eq!(pocket.kind, FeatureKind::Courtyard);
                assert!(
                    unit.walls
                        .iter()
                        .any(|w| w.id.starts_with(&format!("wall:court-pocket-{i}-walls")))
                );
                let gallery = unit
                    .features
                    .iter()
                    .find(|f| f.id == format!("court-pocket-{i}-portico"))
                    .unwrap();
                assert!(gallery.roof.is_some());
                assert!(
                    unit.roofs
                        .faces
                        .iter()
                        .any(|f| f.feature_id.as_deref() == Some(gallery.id.as_str()))
                );
                assert!(
                    area(&intersection(
                        &pocket.surface,
                        &geometry::unite(
                            &unit
                                .bodies
                                .iter()
                                .map(|b| b.footprint.clone())
                                .collect::<Vec<_>>()
                        )
                    )) < 0.000_001
                );
            }
            assert!(
                unit.diagnostics
                    .iter()
                    .any(|s| s.contains("chaque") && s.contains("portail natif"))
                    || unit
                        .diagnostics
                        .iter()
                        .any(|s| s.contains("chacune jointe"))
            );
        }
    }
}

#[test]
fn nilotic_high_hall_preserves_joint_bodies_levels_and_real_inside_access() {
    let data = catalogue().unwrap();
    let recipe = data.recipes.iter().find(|r| r.id == "AF-NILE-B08").unwrap();
    for bodies in 3..=5 {
        for floors in 2..=3 {
            for rooms in [1, 3] {
                let mut p = recipe.parameters.clone();
                p.bodies = [bodies; 2];
                p.floors = [floors; 2];
                p.rooms_per_body = [rooms; 2];
                p.wall_thickness_m = [if rooms == 1 { 0.45 } else { 0.8 }; 2];
                let plan = layouts::build_layout(recipe, &p, "nile-hall 🏠").unwrap();
                assert_eq!(plan.bodies.len(), bodies as usize);
                assert!(plan.courts.is_empty());
                assert!(
                    plan.bodies
                        .iter()
                        .all(|b| b.levels.len() == floors as usize)
                );
                let core = &plan.bodies[0];
                assert_eq!(core.component.as_deref(), Some("nile_core"));
                assert_eq!(core.parameters.level_height_m, 4.2);
                for (i, body) in plan.bodies.iter().enumerate() {
                    assert_eq!(body.role, model::Role::Dwelling);
                    assert_eq!(body.parameters.rooms_per_body, [rooms; 2]);
                    for other in plan.bodies.iter().skip(i + 1) {
                        assert!(area(&intersection(&body.footprint, &other.footprint)) < 0.000_001);
                    }
                }
            }
            for seed in ["42", "noyau 🏠"] {
                let unit = magna_urbis_houses::generate_batch(model::HouseConfig {
                    pack: "AF-NILE".into(),
                    recipe: Some(recipe.id.clone()),
                    count: 1,
                    seed: seed.into(),
                    variation: 0.0,
                    overrides: model::Overrides {
                        bodies: Some(bodies),
                        floors: Some(floors),
                        ..Default::default()
                    },
                    ..Default::default()
                })
                .unwrap_or_else(|e| panic!("{bodies}corps F{floors} {seed}: {e}"));
                let unit = &unit.units[0];
                assert_eq!(unit.bodies.len(), bodies as usize);
                let rooms = unit
                    .rooms
                    .iter()
                    .filter(|r| r.body_id == unit.bodies[0].id && r.level == 0)
                    .count();
                assert!((1..=3).contains(&rooms));
                assert_eq!(unit.rooms.len(), bodies as usize * floors as usize * rooms);
                let households: std::collections::BTreeSet<_> =
                    unit.rooms.iter().map(|r| r.household_id.clone()).collect();
                assert_eq!(households.len(), 1);
                assert!(
                    unit.diagnostics
                        .iter()
                        .any(|d| d.contains("pans RF-FLAT natifs à deux cotes"))
                );
                let core = &unit.bodies[0];
                assert!(
                    (core.levels.last().unwrap().z_m + core.levels.last().unwrap().height_m
                        - floors as f64 * 4.2)
                        .abs()
                        < 0.000_001
                );
                for wing in unit.bodies.iter().skip(1) {
                    assert!(
                        (wing.levels.last().unwrap().z_m + wing.levels.last().unwrap().height_m
                            - floors as f64 * 2.8)
                            .abs()
                            < 0.000_001
                    );
                    assert!(unit.access.portals.iter().any(|door| {
                        let owners: std::collections::BTreeSet<_> = unit
                            .walls
                            .iter()
                            .filter(|w| w.opening_ids.contains(&door.id))
                            .filter_map(|w| w.body_id.as_ref())
                            .collect();
                        owners.contains(&core.id) && owners.contains(&wing.id)
                    }));
                }
            }
        }
    }
}

#[test]
fn workshop_presets_keep_exact_envelopes_whole_bodies_and_native_tiers() {
    let data = catalogue().unwrap();
    for preset in &data.workshop_presets {
        let p = &preset.parameters;
        let plan = layouts::build_workshop_layout(model::Role::Dwelling, p, "workshop-test")
            .unwrap_or_else(|e| panic!("{}: {e}", preset.id));
        let footprint = geometry::unite(
            &plan
                .bodies
                .iter()
                .map(|b| b.footprint.clone())
                .collect::<Vec<_>>(),
        );
        let b = bounds(&footprint);
        assert!(
            (b[0]).abs() < 0.001
                && (b[1]).abs() < 0.001
                && (b[2] - p.width_m[0]).abs() < 0.001
                && (b[3] - p.depth_m[0]).abs() < 0.001,
            "{} {b:?}",
            preset.id
        );
        for (i, body) in plan.bodies.iter().enumerate() {
            assert_eq!(body.footprint.len(), 1, "{}", preset.id);
            for other in plan.bodies.iter().skip(i + 1) {
                assert!(
                    area(&intersection(&body.footprint, &other.footprint)) < 0.001,
                    "{} overlap",
                    preset.id
                );
            }
        }
        if p.footprint_family == "FP-TERRACE" {
            assert_eq!(plan.bodies[0].levels.len(), p.floors[0] as usize);
            for levels in plan.bodies[0].levels.windows(2) {
                assert!(area(&levels[0]) > area(&levels[1]));
            }
        }
        if p.footprint_family == "FP-MULTICELL" {
            assert_eq!(
                plan.bodies.iter().map(|b| b.cells.len()).sum::<usize>(),
                p.bodies[0] as usize
            );
            assert!(
                plan.bodies
                    .iter()
                    .flat_map(|b| &b.cells)
                    .all(|c| c.footprint.len() == 1 && c.footprint[0].holes.is_empty())
            );
        }
    }
    let mut p = data
        .workshop_presets
        .iter()
        .find(|p| p.id == "WORKSHOP-FP-TOWER")
        .unwrap()
        .parameters
        .clone();
    p.width_m = [4.0; 2];
    p.depth_m = [4.0; 2];
    assert!(layouts::build_workshop_layout(model::Role::Dwelling, &p, "small").is_err());
    p.width_m = [6.0; 2];
    p.depth_m = [8.0; 2];
    assert!(layouts::build_workshop_layout(model::Role::Dwelling, &p, "rectangle").is_err());
}

#[test]
fn native_ring_and_d_plan_keep_whole_exact_cells() {
    let data = catalogue().unwrap();
    for id in ["AS-CHI-B13", "AM-PUEB-B03"] {
        let recipe = data.recipes.iter().find(|r| r.id == id).unwrap();
        let mut base = recipe.parameters.clone();
        base.cells = [if id == "AM-PUEB-B03" { 300 } else { 48 }; 2];
        let mut variant = recipe.variants[0].parameters.clone();
        variant.cells = base.cells;
        let original = layouts::build_layout(recipe, &base, "cells").unwrap();
        let alternate = layouts::build_layout(recipe, &variant, "cells").unwrap();
        assert!(
            area(&difference(&original.courts, &alternate.courts))
                + area(&difference(&alternate.courts, &original.courts))
                > 1.0
        );
        for plan in [original, alternate] {
            assert_eq!(
                plan.bodies.iter().map(|b| b.cells.len()).sum::<usize>(),
                base.cells[0] as usize
            );
            for body in plan.bodies {
                for cell in body.cells {
                    assert_eq!(cell.footprint.len(), 1);
                    assert!(cell.footprint[0].holes.is_empty());
                    assert!(area(&intersection(&cell.footprint, &plan.paths)) < 0.001);
                }
                for arm in body.arms {
                    assert!((arm.axis[0].powi(2) + arm.axis[1].powi(2) - 1.0).abs() < 0.000_01);
                    assert!(arm.length_m >= 2.4 && arm.width_m >= 2.4);
                }
            }
        }
    }
}

#[test]
fn square_ring_every_cell_has_one_inner_front_and_independent_gallery_access() {
    let data = catalogue().unwrap();
    let recipe = data.recipes.iter().find(|r| r.id == "AS-CHI-B13").unwrap();
    let mut p = recipe.variants[0].parameters.clone();
    p.cells = [48; 2];
    p.floors = [5; 2];
    p.width_m = [36.0; 2];
    p.depth_m = [36.0; 2];
    let plan = layouts::build_layout(recipe, &p, "square-ring-front").unwrap();
    assert_eq!(plan.bodies[0].cells.len(), 48);
    assert_eq!(plan.bodies[0].arms.len(), 5);
    let gallery = &plan
        .features
        .iter()
        .find(|f| f.id == "inner-gallery-0")
        .unwrap()
        .surface;
    for cell in &plan.bodies[0].cells {
        assert_eq!(cell.footprint.len(), 1);
        assert_eq!(cell.footprint[0].outer.len(), 4);
        assert!(area(&intersection(&offset(&cell.footprint, 0.05), gallery)) > 0.07);
    }
    let batch = magna_urbis_houses::generate_batch(model::HouseConfig {
        pack: recipe.pack_id.clone(),
        recipe: Some(recipe.id.clone()),
        allow_late: true,
        count: 1,
        variation: 0.0,
        overrides: model::Overrides {
            variant: Some("square_ring".into()),
            floors: Some(5),
            ..Default::default()
        },
        ..Default::default()
    })
    .unwrap();
    let unit = &batch.units[0];
    for room in &unit.rooms {
        assert!(
            unit.access.portals.iter().any(|portal| {
                let other = if portal.from == room.access_node {
                    &portal.to
                } else if portal.to == room.access_node {
                    &portal.from
                } else {
                    return false;
                };
                unit.access.nodes.iter().any(|node| {
                    node.id == *other
                        && node.kind != model::AccessKind::Room
                        && (node.z_m - room.z_m).abs() < 0.001
                })
            }),
            "{} sans façade publique",
            room.id
        );
    }
}

#[test]
fn longitudinal_roofs_follow_the_long_side_and_jetty_only_the_street() {
    let data = catalogue().unwrap();
    let long = data.recipes.iter().find(|r| r.id == "EUR-NOR-B01").unwrap();
    let plan = layouts::build_layout(long, &long.parameters, "axis").unwrap();
    let arm = &plan.bodies[0].arms[0];
    assert!(arm.length_m >= arm.width_m);
    assert!(arm.axis[1].abs() > 0.99);
    let jettied = data.recipes.iter().find(|r| r.id == "EUR-MED-B03").unwrap();
    let plan = layouts::build_layout(jettied, &jettied.parameters, "jetty").unwrap();
    let body = &plan.bodies[0];
    let a = bounds(&body.levels[0]);
    let b = bounds(&body.levels[1]);
    assert_eq!(body.levels[1].len(), 1);
    for i in 0..3 {
        assert!((a[i] - b[i]).abs() < 0.001);
    }
    assert!((b[3] - a[3] - 0.35).abs() < 0.001);
    assert!(
        plan.features
            .iter()
            .any(|f| f.id.starts_with("jetty-console") && f.z_m >= 2.5)
    );
}

#[test]
fn varied_street_jetty_keeps_three_supported_rooms_in_its_upper_floor() {
    let batch = magna_urbis_houses::generate_batch(model::HouseConfig {
        seed: "42".into(),
        pack: "EUR-MED".into(),
        recipe: Some("EUR-MED-B03".into()),
        count: 10,
        variation: 0.65,
        ..Default::default()
    })
    .unwrap();
    let unit = &batch.units[9];
    let body = &unit.bodies[0];
    assert_eq!(body.levels[1].footprint.len(), 1);
    let rooms: Vec<_> = unit
        .rooms
        .iter()
        .filter(|r| r.body_id == body.id && r.level == 1)
        .collect();
    assert_eq!(rooms.len(), 3);
    for room in rooms {
        assert_eq!(room.floor.len(), 1);
        assert!(area(&room.floor) > 9.0);
    }
    let ground = bounds(&body.levels[0].footprint);
    let upper = bounds(&body.levels[1].footprint);
    assert!((upper[3] - ground[3] - 0.35).abs() < 0.001);
}

#[test]
fn components_keep_every_instance_with_clearance_and_connected_shinden_paths() {
    let data = catalogue().unwrap();
    for id in ["AF-SAHEL-B03", "AS-CHI-B02", "AS-JAP-B03", "AS-SEA-B04"] {
        let recipe = data.recipes.iter().find(|r| r.id == id).unwrap();
        let mut p = recipe.parameters.clone();
        for c in &mut p.components {
            c.count = [c.count[1]; 2];
        }
        let plan = layouts::build_layout(recipe, &p, "components-max").unwrap();
        assert_eq!(
            plan.bodies.len(),
            p.components
                .iter()
                .map(|c| c.count[0] as usize)
                .sum::<usize>()
        );
        for (i, body) in plan.bodies.iter().enumerate() {
            for other in plan.bodies.iter().skip(i + 1) {
                assert!(
                    area(&intersection(
                        &offset(&body.footprint, 0.7),
                        &offset(&other.footprint, 0.7)
                    )) <= 0.002
                );
            }
        }
        if p.layout == Layout::Shinden {
            assert_eq!(
                plan.features
                    .iter()
                    .filter(|f| f.id.starts_with("shinden-gallery-"))
                    .count(),
                p.components[1].count[0] as usize
            );
        }
    }
}

#[test]
fn broch_gate_retains_masonry_above_the_opening() {
    let data = catalogue().unwrap();
    let recipe = data
        .recipes
        .iter()
        .find(|r| r.parameters.layout == Layout::Broch)
        .unwrap();
    let plan = layouts::build_layout(recipe, &recipe.parameters, "broch").unwrap();
    assert_eq!(
        plan.features
            .iter()
            .filter(|f| f.id.contains("lintel")
                && f.kind == FeatureKind::Enclosure
                && f.z_m == 2.05)
            .count(),
        2
    );
    assert_eq!(recipe.parameters.shell.as_ref().unwrap().gallery_m, 1.5);
}

#[test]
fn square_tower_components_keep_the_depth_reserved_for_internal_stairs() {
    let data = catalogue().unwrap();
    let recipe = data.recipes.iter().find(|r| r.id == "EUR-MED-B07").unwrap();
    let mut p = recipe.parameters.clone();
    p.width_m = [7.433; 2];
    p.depth_m = [8.584; 2];
    for c in &mut p.components {
        c.rooms_per_body = [3; 2];
        c.floors = [c.floors[1]; 2];
        c.wall_thickness_m = [0.376; 2];
    }
    let plan = layouts::build_layout(recipe, &p, "houses:v2:42:unit:4").unwrap();
    let tower = plan
        .bodies
        .iter()
        .find(|b| b.component.as_deref() == Some("tower"))
        .unwrap();
    let b = bounds(&tower.footprint);
    assert!((b[2] - b[0] - (b[3] - b[1])).abs() < 0.001);
    assert!(b[3] - b[1] >= 2.0 * 0.376 + 2.8 * 0.95 + 1.4 - 0.001);
    assert!(
        plan.diagnostics
            .iter()
            .any(|d| d.contains("Composant tower"))
    );
    magna_urbis_houses::generate_batch(model::HouseConfig::default()).unwrap();
}

#[test]
fn open_elliptical_enclosures_have_a_real_ring_gate_and_no_dwelling() {
    let data = catalogue().unwrap();
    for id in ["AF-SOUTH-B02", "AF-EAST-B07", "AM-WOODS-B09", "AM-MISS-B05"] {
        let recipe = data.recipes.iter().find(|r| r.id == id).unwrap();
        let plan = layouts::build_layout(recipe, &recipe.parameters, "open-enclosure").unwrap();
        assert!(plan.bodies.is_empty());
        let fence = &plan.features[0].surface;
        assert!(fence.iter().any(|p| p.outer.len() > 8));
        let b = bounds(fence);
        let gate = geometry::rectangle((b[0] + b[2]) * 0.5 - 0.7, b[3] - 0.5, 1.4, 1.0);
        assert!(area(&intersection(fence, &gate)) < 0.001);
        assert!(!plan.courts.is_empty());
        assert!(recipe.parameters.enclosures.is_empty());
    }
}

#[test]
fn maya_corbel_program_keeps_all_rectangular_rooms_with_explicit_bearing_spans() {
    let data = catalogue().unwrap();
    let recipe = data.recipes.iter().find(|r| r.id == "AM-MESO-B07").unwrap();
    let mut p = recipe.parameters.clone();
    p.bodies = [12; 2];
    p.rooms_per_body = [4; 2];
    p.wall_thickness_m = [1.6; 2];
    let plan = layouts::build_layout(recipe, &p, "corbel-max").unwrap();
    assert_eq!(plan.bodies.len(), 12);
    assert_eq!(plan.bodies.iter().map(|b| b.cells.len()).sum::<usize>(), 48);
    for body in plan.bodies {
        for cell in body.cells {
            assert_eq!(cell.footprint.len(), 1);
            assert_eq!(cell.footprint[0].outer.len(), 4);
            assert!(cell.footprint[0].holes.is_empty());
            assert!(cell.household_id.is_none());
            let b = bounds(&cell.footprint);
            let clear_span = b[2] - b[0] - 2.0 * p.wall_thickness_m[0];
            assert!((1.4..=2.1).contains(&clear_span));
            assert!(b[3] - b[1] - 1.5 * p.wall_thickness_m[0] >= 2.6 - 0.001);
        }
    }
    assert!(
        plan.diagnostics
            .iter()
            .any(|d| d.contains("Programme de voûtes stylisé"))
    );
}

#[test]
fn thai_lao_compound_has_a_real_shared_raised_deck_with_supports() {
    let data = catalogue().unwrap();
    let recipe = data.recipes.iter().find(|r| r.id == "AS-SEA-B03").unwrap();
    let plan = layouts::build_layout(recipe, &recipe.parameters, "shared-deck").unwrap();
    let deck = plan
        .features
        .iter()
        .find(|f| f.id == "shared-raised-platform")
        .unwrap();
    assert_eq!(deck.kind, FeatureKind::Deck);
    assert_eq!(deck.surface.len(), 1);
    assert_eq!(deck.z_m, plan.bodies[0].z);
    assert!(
        plan.bodies
            .iter()
            .all(|body| area(&intersection(&offset(&body.footprint, 0.1), &deck.surface)) > 0.01)
    );
    let posts: Vec<_> = plan
        .features
        .iter()
        .filter(|f| f.id.starts_with("shared-platform-post-"))
        .collect();
    assert!(!posts.is_empty());
    assert!(posts.iter().all(|f| f.kind == FeatureKind::Post
        && (f.z_m + f.height_m - deck.z_m).abs() < 0.001
        && area(&difference(&f.surface, &deck.surface)) < 0.001));
    let batch = magna_urbis_houses::generate_batch(model::HouseConfig {
        pack: recipe.pack_id.clone(),
        recipe: Some(recipe.id.clone()),
        count: 1,
        variation: 0.0,
        ..Default::default()
    })
    .unwrap();
    assert!(
        !batch.units[0]
            .diagnostics
            .iter()
            .any(|d| d.contains("Trait shared_raised_platform inapplicable"))
    );
}

#[test]
fn varied_component_palettes_keep_real_millimetre_clearance() {
    for pack in ["AF-SAHEL", "AS-SEA", "AS-JAP"] {
        magna_urbis_houses::generate_batch(model::HouseConfig {
            pack: pack.into(),
            ..Default::default()
        })
        .unwrap_or_else(|e| panic!("{pack}: {e}"));
    }
}

#[test]
fn kancha_maximum_bodies_keep_clearance_rooms_and_real_stairs() {
    let data = catalogue().unwrap();
    let recipe = data.recipes.iter().find(|r| r.id == "AM-AND-B02").unwrap();
    let mut p = recipe.parameters.clone();
    p.width_m = [22.0; 2];
    p.depth_m = [22.0; 2];
    p.bodies = [8; 2];
    p.floors = [2; 2];
    p.rooms_per_body = [2; 2];
    p.wall_thickness_m = [0.45; 2];
    let plan = layouts::build_layout(recipe, &p, "kancha-max").unwrap();
    assert_eq!(plan.bodies.len(), 8);
    assert!(plan.bodies.iter().all(|body| body.levels.len() == 2));
    for (i, body) in plan.bodies.iter().enumerate() {
        for other in plan.bodies.iter().skip(i + 1) {
            assert!(
                area(&intersection(
                    &offset(&body.footprint, 0.7),
                    &offset(&other.footprint, 0.7)
                )) < 0.000_001
            );
        }
    }
    assert!(
        plan.diagnostics
            .iter()
            .any(|d| d.contains("Dimensions graphiques ajustées"))
    );
    for variant in ["default", "adobe_walls"] {
        let batch = magna_urbis_houses::generate_batch(model::HouseConfig {
            pack: recipe.pack_id.clone(),
            recipe: Some(recipe.id.clone()),
            count: 1,
            variation: 0.0,
            overrides: model::Overrides {
                variant: Some(variant.into()),
                bodies: Some(8),
                floors: Some(2),
                ..Default::default()
            },
            ..Default::default()
        })
        .unwrap();
        let unit = &batch.units[0];
        assert_eq!(unit.bodies.len(), 8);
        assert!((16..=32).contains(&unit.rooms.len()));
        assert!(unit.bodies.iter().all(|body| body.levels.len() == 2));
        assert!(
            unit.bodies
                .iter()
                .all(|body| body.levels.iter().all(|level| unit
                    .rooms
                    .iter()
                    .any(|room| room.body_id == body.id && room.level == level.index)))
        );
        assert!(
            unit.features
                .iter()
                .filter(|f| f.kind == FeatureKind::Stair)
                .count()
                >= 8
        );
    }
    magna_urbis_houses::generate_batch(model::HouseConfig {
        pack: "AM-AND".into(),
        ..Default::default()
    })
    .unwrap();
}

#[test]
fn ranked_source_courts_keep_whole_bodies_thresholds_and_public_access() {
    let data = catalogue().unwrap();
    let mut failures = vec![];
    for id in [
        "AF-SAHEL-B09",
        "AF-WEST-B05",
        "AF-WEST-B10",
        "AS-IND-B13",
        "AS-CHI-B11",
        "AS-KOR-B08",
        "AM-MESO-B03",
        "AM-AND-B07",
    ] {
        let recipe = data.recipes.iter().find(|r| r.id == id).unwrap();
        let p = &recipe.parameters;
        let program = p.court_program.as_ref().unwrap();
        let plan = layouts::build_layout(recipe, p, "ranked-courts").unwrap();
        assert_eq!(
            plan.bodies.iter().filter(|b| b.role.residential()).count(),
            p.bodies[0] as usize,
            "{id}"
        );
        assert!(plan.bodies.iter().all(|b| b.footprint.len() == 1), "{id}");
        assert!(plan.courts.len() >= program.courts.len(), "{id}");
        let thresholds: Vec<_> = plan
            .features
            .iter()
            .filter(|f| f.id.starts_with("court-threshold-") && !f.id.ends_with("lintel"))
            .collect();
        assert_eq!(thresholds.len(), program.courts.len() - 1, "{id}");
        for threshold in thresholds {
            if p.site_gate_profile.is_some() {
                assert!(
                    area(&intersection(&threshold.surface, &plan.paths)) > 0.001,
                    "{id}"
                );
            } else {
                assert!(
                    area(&intersection(&threshold.surface, &plan.paths)) < 0.000_001,
                    "{id}"
                );
            }
            assert!(threshold.height_m >= 2.8, "{id}");
        }
        for pair in program.courts.windows(2) {
            let a = plan
                .features
                .iter()
                .find(|f| f.id == format!("court-rank-{}", pair[0].rank))
                .unwrap();
            let b = plan
                .features
                .iter()
                .find(|f| f.id == format!("court-rank-{}", pair[1].rank))
                .unwrap();
            assert!(
                geometry::center(&a.surface).y > geometry::center(&b.surface).y,
                "{id}: ranks from the south entrance"
            );
        }
        if id == "AS-IND-B13" {
            assert!(plan.bodies.iter().all(|b| b.footprint[0].outer.len() >= 8));
        }
        if id == "AS-CHI-B11" {
            let hall = plan
                .bodies
                .iter()
                .find(|b| b.component.as_deref() == Some("north_hall"))
                .unwrap();
            assert_eq!(hall.parameters.level_height_m, 4.2);
        }
        if let Err(e) = magna_urbis_houses::generate_batch(model::HouseConfig {
            pack: recipe.pack_id.clone(),
            recipe: Some(recipe.id.clone()),
            count: 1,
            variation: 0.0,
            allow_late: true,
            ..Default::default()
        }) {
            failures.push(format!("{id}: {e}"));
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn source_lightwells_are_authored_holes_in_every_level_and_slab() {
    let data = catalogue().unwrap();
    let recipe = data.recipes.iter().find(|r| r.id == "AF-NILE-B03").unwrap();
    let mut p = recipe.parameters.clone();
    p.floors = [3; 2];
    p.vertical_access = catalogue::VerticalAccess::InternalStair;
    let plan = layouts::build_layout(recipe, &p, "lightwell").unwrap();
    assert_eq!(
        plan.bodies.iter().filter(|b| !b.voids.is_empty()).count(),
        2
    );
    for body in plan.bodies.iter().filter(|b| !b.voids.is_empty()) {
        assert_eq!(body.footprint.len(), 1);
        assert_eq!(body.voids.len(), 1);
        assert!(
            body.levels
                .iter()
                .all(|level| area(&intersection(level, &body.voids[0])) < 0.000_001)
        );
    }
    let batch = magna_urbis_houses::generate_batch(model::HouseConfig {
        pack: recipe.pack_id.clone(),
        recipe: Some(recipe.id.clone()),
        count: 1,
        variation: 0.0,
        overrides: model::Overrides {
            floors: Some(3),
            ..Default::default()
        },
        ..Default::default()
    })
    .unwrap();
    for body in batch.units[0].bodies.iter().filter(|b| !b.voids.is_empty()) {
        for level in &body.levels {
            assert!(area(&intersection(&level.floor, &body.voids[0])) < 0.000_001);
            if let Some(slab) = &level.roof_slab {
                assert!(area(&intersection(&slab.surface, &body.voids[0])) < 0.000_001);
            }
        }
        let mesh = &batch.units[0].roofs;
        let faces: Vec<_> = mesh.faces.iter().filter(|f| f.body_id == body.id).collect();
        assert!(!faces.is_empty());
        for face in faces {
            let projection = vec![model::Polygon {
                outer: face
                    .vertices
                    .iter()
                    .map(|i| {
                        let v = &mesh.vertices[*i as usize];
                        geometry::point(v.x, v.y)
                    })
                    .collect(),
                holes: vec![],
            }];
            if area(&projection) > 0.000_001 {
                assert!(
                    area(&intersection(&projection, &body.voids[0])) < 0.000_001,
                    "lightwell interrupted by actual face {}",
                    face.roof_group
                );
            }
        }
    }
}

#[test]
fn source_musgum_ogive_has_an_actual_circular_envelope() {
    let data = catalogue().unwrap();
    let recipe = data
        .recipes
        .iter()
        .find(|r| r.id == "AF-SAHEL-B11")
        .unwrap();
    let mut p = recipe.parameters.clone();
    p.width_m = [6.0; 2];
    p.depth_m = [9.0; 2];
    let plan = layouts::build_layout(recipe, &p, "ogival-circle").unwrap();
    let b = bounds(&plan.bodies[0].footprint);
    assert!(((b[2] - b[0]) - (b[3] - b[1])).abs() < 0.000_001);
}

#[test]
fn source_iwans_have_real_open_fronts_and_vaults_perpendicular_to_the_court() {
    let data = catalogue().unwrap();
    let recipe = data.recipes.iter().find(|r| r.id == "AS-MIDE-B03").unwrap();
    for variant in ["default", "vault_brick"] {
        let batch = magna_urbis_houses::generate_batch(model::HouseConfig {
            pack: recipe.pack_id.clone(),
            recipe: Some(recipe.id.clone()),
            count: 1,
            variation: 0.0,
            overrides: model::Overrides {
                variant: Some(variant.into()),
                ..Default::default()
            },
            ..Default::default()
        })
        .unwrap();
        let unit = &batch.units[0];
        assert_eq!(unit.bodies.len(), 4);
        assert!((8..=32).contains(&unit.rooms.len()));
        assert!(unit.rooms.iter().all(|r| r.usage == model::RoomUsage::Hall));
        for body in &unit.bodies {
            assert_eq!(body.roof_system, "RF-VAULT");
            assert_eq!(body.roof_spec.vault.as_ref().unwrap().open_ends.len(), 1);
            assert_eq!(body.roof_arms.len(), 1);
            let b = bounds(&body.footprint);
            let t = body.wall_thickness_m;
            let opening = match body.component_id.as_deref().unwrap() {
                "iwan-north" => geometry::rectangle(
                    b[0] + (b[2] - b[0]) * 0.1,
                    b[3] - t,
                    (b[2] - b[0]) * 0.8,
                    t + 0.001,
                ),
                "iwan-south" => geometry::rectangle(
                    b[0] + (b[2] - b[0]) * 0.1,
                    b[1] - 0.001,
                    (b[2] - b[0]) * 0.8,
                    t + 0.001,
                ),
                "iwan-east" => geometry::rectangle(
                    b[0] - 0.001,
                    b[1] + (b[3] - b[1]) * 0.1,
                    t + 0.001,
                    (b[3] - b[1]) * 0.8,
                ),
                "iwan-west" => geometry::rectangle(
                    b[2] - t,
                    b[1] + (b[3] - b[1]) * 0.1,
                    t + 0.001,
                    (b[3] - b[1]) * 0.8,
                ),
                _ => panic!("iwan missing"),
            };
            assert!(
                unit.walls
                    .iter()
                    .filter(|w| w.body_id.as_deref() == Some(&body.id))
                    .all(|w| area(&intersection(&w.footprint, &opening)) < 0.000_001)
            );
        }
    }
}
