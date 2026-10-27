use magna_urbis_houses::{
    catalogue::{Layout, catalogue},
    generate_batch,
    model::{HistoricalMode, HouseConfig},
    style_index::{StyleQuery, style_index},
};
use std::collections::BTreeSet;

#[test]
fn javanese_tradition_indexes_three_distinct_types_without_balinese_borrowing() {
    let index = style_index().unwrap();
    let query = StyleQuery {
        pack_id: Some("AS-ISL".into()),
        tradition_id: Some("javanese".into()),
        ..Default::default()
    };
    let entries = index.find(&query);
    assert_eq!(
        entries.iter().map(|e| e.recipe_id).collect::<BTreeSet<_>>(),
        BTreeSet::from(["AS-ISL-B06", "AS-ISL-B14", "AS-ISL-B15"])
    );
    assert_eq!(entries.len(), 3);
    assert!(
        entries
            .iter()
            .all(|e| e.settlement_archetype == "AS-ISL-S05")
    );
    assert_eq!(
        entries
            .iter()
            .map(|e| e.profile)
            .collect::<BTreeSet<_>>()
            .len(),
        3
    );
    let strict = StyleQuery {
        mode: HistoricalMode::HistoricalStrict,
        ..query.clone()
    };
    assert_eq!(
        index
            .find(&strict)
            .iter()
            .map(|e| e.recipe_id)
            .collect::<Vec<_>>(),
        vec!["AS-ISL-B06"]
    );
    let dated = StyleQuery {
        era: "M".into(),
        ..query
    };
    assert_eq!(
        index
            .find(&dated)
            .iter()
            .map(|e| e.recipe_id)
            .collect::<Vec<_>>(),
        vec!["AS-ISL-B06"]
    );
    assert_eq!(index.get("AS-ISL-B05::default").unwrap().tradition_id, None);
}

#[test]
fn inspired_only_is_independent_of_late_and_explicit_pins_cannot_bypass_strict() {
    let data = catalogue().unwrap();
    for id in ["AS-ISL-B14", "AS-ISL-B15"] {
        let recipe = data.recipes.iter().find(|r| r.id == id).unwrap();
        assert!(recipe.inspired_only);
        assert!(!recipe.temporal.late_only);
        assert!(recipe.temporal.eras.is_empty());
        assert_eq!(recipe.chronology_confidence, "undated_tradition");
        assert!(
            recipe
                .sources
                .iter()
                .any(|s| s.path == "docs/sources/javanese-domestic-architecture_FR.md")
        );
        assert!(
            recipe
                .parameters
                .notes
                .iter()
                .any(|s| s.contains("artistic defaults"))
        );
        let mut config = HouseConfig {
            pack: "AS-ISL".into(),
            recipe: Some(id.into()),
            count: 1,
            allow_late: false,
            ..Default::default()
        };
        assert!(data.validate_config(&config).is_ok());
        config.mode = HistoricalMode::FantasyMix;
        assert!(data.validate_config(&config).is_ok());
        config.mode = HistoricalMode::HistoricalStrict;
        assert!(data.validate_config(&config).is_err());
        assert!(data.admissible(&config).is_err());
        let q = StyleQuery {
            pack_id: Some("AS-ISL".into()),
            recipe_id: Some(id.into()),
            mode: HistoricalMode::HistoricalStrict,
            automatic: false,
            ..Default::default()
        };
        assert!(style_index().unwrap().find(&q).is_empty());
        assert!(
            style_index()
                .unwrap()
                .candidate_styles_for_config(&q, &config, "java-guard", 4)
                .is_err()
        );
    }
}

#[test]
fn simple_javanese_defaults_produce_distinct_native_roofs_and_one_dwelling() {
    for (id, roof) in [("AS-ISL-B14", "RF-GABLE"), ("AS-ISL-B15", "RF-HIP")] {
        let entry = style_index()
            .unwrap()
            .get(&format!("{id}::default"))
            .unwrap();
        let p = entry.parameters();
        assert_eq!(p.layout, Layout::Single);
        assert_eq!(p.bodies, [1, 1]);
        assert_eq!(p.floors, [1, 1]);
        assert!(!p.gallery_cover.enabled);
        assert!(p.enclosures.is_empty());
        assert_eq!(p.components.len(), 1);
        assert_eq!(p.roof_system, roof);
        if id.ends_with("15") {
            assert!(p.depth_m[0] > p.width_m[1]);
        }
        let config = HouseConfig {
            pack: "AS-ISL".into(),
            recipe: Some(id.into()),
            seed: "java-data-sheet".into(),
            count: 1,
            variation: 0.,
            ..Default::default()
        };
        let batch = generate_batch(config.clone()).unwrap();
        assert_eq!(batch.units.len(), 1);
        let unit = &batch.units[0];
        assert_eq!(unit.bodies.len(), 1);
        assert_eq!(unit.recipe_id, id);
        assert_eq!(unit.variant_id, "default");
        assert!(!unit.roofs.faces.is_empty());
        assert!(!unit.rooms.is_empty());
        assert_eq!(batch, generate_batch(config).unwrap());
    }
}
