use magna_urbis_houses::{
    catalogue::{catalogue, source_inventory},
    generate_batch,
    geometry::{area, bounds, unite},
    model::{HistoricalMode, HouseConfig},
    preflight,
    workshop::WorkshopRequest,
};
use std::collections::{BTreeSet, VecDeque};

fn config(id: &str) -> HouseConfig {
    HouseConfig {
        pack: "atelier".into(),
        mode: HistoricalMode::FantasyMix,
        count: 1,
        workshop: Some(WorkshopRequest {
            preset_id: id.into(),
            ..Default::default()
        }),
        ..Default::default()
    }
}

#[test]
fn every_footprint_and_roof_has_a_native_workshop_scene() {
    let data = catalogue().unwrap();
    assert_eq!(data.packs.len(), 32);
    assert_eq!(data.workshop_presets.len(), 42);
    let mut covered = BTreeSet::new();
    for preset in &data.workshop_presets {
        assert_eq!(preset.confidence, "stylized");
        assert!(!data.recipes.iter().any(|r| r.id == preset.id));
        covered.insert(preset.id.strip_prefix("WORKSHOP-").unwrap());
        let batch =
            generate_batch(config(&preset.id)).unwrap_or_else(|e| panic!("{}: {e}", preset.id));
        let unit = &batch.units[0];
        assert_eq!(unit.recipe_id, preset.id);
        assert_eq!(unit.variant_id, "workshop");
        assert!(!unit.rooms.is_empty());
        let envelope = unite(
            &unit
                .bodies
                .iter()
                .map(|b| b.footprint.clone())
                .collect::<Vec<_>>(),
        );
        let b = bounds(&envelope);
        assert!(
            (b[2] - b[0] - preset.parameters.width_m[0]).abs() < 0.003,
            "{} width {:?}",
            preset.id,
            b
        );
        assert!(
            (b[3] - b[1] - preset.parameters.depth_m[0]).abs() < 0.003,
            "{} depth {:?}",
            preset.id,
            b
        );
    }
    let expected: BTreeSet<_> = source_inventory()
        .unwrap()
        .entries
        .iter()
        .filter(|e| e.id.starts_with("FP-") || e.id.starts_with("RF-"))
        .map(|e| e.id.as_str())
        .collect();
    assert_eq!(covered, expected);
}

#[test]
fn terrace_tiers_have_real_slabs_and_every_terrace_is_reachable() {
    let unit = generate_batch(config("WORKSHOP-FP-TERRACE"))
        .unwrap()
        .units
        .remove(0);
    let body = &unit.bodies[0];
    assert_eq!(body.levels.len(), 3);
    for pair in body.levels.windows(2) {
        assert!(area(&pair[1].footprint) < area(&pair[0].footprint));
    }
    assert!(body.levels.iter().all(|l| {
        l.roof_slab
            .as_ref()
            .is_some_and(|s| s.walkable && area(&s.surface) > 0.1)
    }));
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
                && reached.insert(next)
            {
                queue.push_back(next);
            }
        }
    }
    assert!(
        unit.access
            .nodes
            .iter()
            .filter(|n| n.kind == magna_urbis_houses::model::AccessKind::Terrace)
            .all(|n| reached.contains(n.id.as_str()))
    );
}

#[test]
fn workshop_rejects_conflicting_or_impossible_controls_and_keeps_legacy_settings() {
    let mut c = config("WORKSHOP-FP-SQUARE");
    c.workshop.as_mut().unwrap().width_m = Some(6.0);
    c.workshop.as_mut().unwrap().depth_m = Some(8.0);
    assert!(preflight(c).is_err());
    let mut c = config("WORKSHOP-FP-TERRACE");
    c.overrides.floors = Some(1);
    assert!(preflight(c).is_err());
    let mut c = config("WORKSHOP-RF-VAULT");
    c.workshop.as_mut().unwrap().roof_frame = Some("MAT-TIMBER-POST".into());
    assert!(preflight(c).is_err());
    let mut c = config("WORKSHOP-FP-RECT");
    c.overrides.footprint = Some("FP-CROSS".into());
    assert!(preflight(c).is_err());
    let mut c = config("WORKSHOP-FP-TOWER");
    c.workshop.as_mut().unwrap().width_m = Some(4.0);
    c.workshop.as_mut().unwrap().depth_m = Some(4.0);
    assert!(generate_batch(c).is_err());
    let legacy = serde_json::to_string(&HouseConfig::default()).unwrap();
    assert!(!legacy.contains("workshop"));
    assert!(
        serde_json::from_str::<HouseConfig>(&legacy)
            .unwrap()
            .workshop
            .is_none()
    );
    let mut c = config("WORKSHOP-FP-IRREGULAR");
    c.seed = "étoile 🏠".into();
    let first = generate_batch(c.clone()).unwrap();
    assert_eq!(first, generate_batch(c.clone()).unwrap());
    c.count = 10;
    let ten = generate_batch(c).unwrap();
    assert_eq!(first.units, ten.units[..1]);
}
