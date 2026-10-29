use magna_urbis_houses::{catalogue::catalogue, generate_batch, geometry::*, model::*, preflight};
use std::collections::{BTreeSet, VecDeque};

fn config(id: &str) -> HouseConfig {
    HouseConfig {
        pack: catalogue().unwrap().recipes.iter().find(|r|r.id==id).unwrap().pack_id.clone(),
        recipe: Some(id.into()),
        count: 1,
        variation: 0.0,
        allow_late: true,
        ..HouseConfig::default()
    }
}

#[test]
fn every_authored_recipe_and_variant_builds_a_real_valid_scene() {
    let data = catalogue().unwrap();
    for recipe in &data.recipes {
        for variant in
            std::iter::once(None).chain(recipe.variants.iter().map(|v| Some(v.id.clone())))
        {
            let mut c = config(&recipe.id);
            c.overrides.variant = variant.clone();
            let batch =
                generate_batch(c).unwrap_or_else(|e| panic!("{} {variant:?}: {e}", recipe.id));
            assert_eq!(batch.units.len(), 1);
            let unit = &batch.units[0];
            assert!(
                !unit.bodies.is_empty() || unit.features.iter().any(|f| area(&f.surface) > 1.0),
                "{}: no geometry",
                recipe.id
            );
            assert_eq!(unit.variant_id, variant.as_deref().unwrap_or("default"));
            if !unit.bodies.is_empty() {
                assert!(area(&unit.partition.occupied) > 1.0);
            }
            if recipe.role.residential() {
                assert!(!unit.rooms.is_empty(), "{}: no programme", recipe.id);
            }
        }
    }
}

#[test]
fn replay_prefix_unicode_and_graphic_wealth_are_effective() {
    let mut c = config("EUR-MED-B01");
    c.seed = "étoile 🏠".into();
    c.variation = 0.65;
    let first = generate_batch(c.clone()).unwrap();
    assert_eq!(first, generate_batch(c.clone()).unwrap());
    c.count = 10;
    let ten = generate_batch(c.clone()).unwrap();
    assert_eq!(first.units, ten.units[..1]);
    c.count = 1;
    c.wealth = 0.0;
    let low = generate_batch(c.clone()).unwrap();
    c.wealth = 1.0;
    let high = generate_batch(c).unwrap();
    assert_ne!(low.units[0].lot, high.units[0].lot);
}

#[test]
fn portals_preserve_lintels_and_households_have_independent_paths() {
    for id in ["MED-ANT-B04", "AS-CHI-B13", "AM-PUEB-B03"] {
        let unit = generate_batch(config(id)).unwrap().units.remove(0);
        for portal in unit
            .access
            .portals
            .iter()
            .filter(|p| matches!(p.kind, PortalKind::Door | PortalKind::Tunnel))
        {
            for wall in unit
                .walls
                .iter()
                .filter(|w| w.opening_ids.contains(&portal.id))
            {
                assert!(area(&intersection(&wall.footprint, &portal.opening_surface)) < 0.003);
            }
            if portal.wall_id.is_some() {
                assert!(unit.walls.iter().any(|w| w.z_m >= portal.head_z_m - 0.001
                    && w.height_m > 0.01
                    && area(&intersection(&w.footprint, &portal.opening_surface)) > 0.001));
            }
        }
        for owner in unit
            .rooms
            .iter()
            .filter_map(|r| r.household_id.clone())
            .collect::<BTreeSet<_>>()
        {
            let allowed: BTreeSet<_> = unit
                .access
                .nodes
                .iter()
                .filter(|n| n.household_id.as_ref().is_none_or(|id| id == &owner))
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
            assert!(
                unit.rooms
                    .iter()
                    .filter(|r| r.household_id.as_ref() == Some(&owner))
                    .all(|r| reached.contains(r.access_node.as_str()))
            );
        }
    }
}

#[test]
fn impossible_controls_fail_before_any_scene_is_published() {
    let mut c = config("EUR-MED-B01");
    c.count = 0;
    assert!(preflight(c).is_err());
    let mut c = config("EUR-MED-B01");
    c.overrides.roof = Some("RF-SNOW".into());
    assert!(preflight(c).is_err());
    let mut c = config("EUR-MED-B01");
    c.overrides.variant = Some("invented".into());
    assert!(generate_batch(c).is_err());
}
