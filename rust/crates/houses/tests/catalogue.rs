use magna_urbis_houses::{
    catalogue::{catalogue, source_inventory},
    model::{HistoricalMode, HouseConfig},
};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;

fn building_id(id: &str) -> bool {
    id.rsplit_once("-B")
        .is_some_and(|(_, suffix)| suffix.len() == 2 && suffix.bytes().all(|b| b.is_ascii_digit()))
}

#[test]
fn coverage_matches_both_current_sources_and_all_atlas_ids() {
    let source = source_inventory().unwrap();
    let catalogue = catalogue().unwrap();
    for reference in &source.sources {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../..")
            .join(&reference.path);
        let text = std::fs::read_to_string(path).unwrap();
        let normalized = text.trim_start_matches('\u{feff}').replace("\r\n", "\n");
        assert_eq!(
            format!("{:x}", Sha256::digest(normalized.as_bytes())),
            reference.sha256,
            "{} changed; regenerate inventory",
            reference.path
        );
        assert_eq!(
            catalogue
                .sources
                .iter()
                .find(|s| s.path == reference.path)
                .unwrap()
                .sha256,
            reference.sha256
        );
    }
    assert_eq!(catalogue.packs.len(), 32);
    for (prefix, count) in [("FP-", 20), ("RF-", 22), ("MAT-", 35)] {
        assert_eq!(
            source
                .entries
                .iter()
                .filter(|entry| entry.id.starts_with(prefix))
                .count(),
            count
        );
    }
    let source_ids: BTreeSet<_> = source
        .entries
        .iter()
        .filter(|entry| building_id(&entry.id))
        .map(|entry| &entry.id)
        .collect();
    let coverage_ids: BTreeSet<_> = catalogue.coverage.iter().map(|entry| &entry.id).collect();
    assert_eq!(source_ids.len(), 345);
    assert_eq!(source_ids, coverage_ids);
    assert_eq!(
        coverage_ids.len(),
        catalogue.coverage.len(),
        "duplicate coverage ID"
    );
    let recipes: BTreeSet<_> = catalogue.recipes.iter().map(|recipe| &recipe.id).collect();
    assert_eq!(recipes.len(), catalogue.recipes.len());
    for entry in &catalogue.coverage {
        assert!(!entry.reason.is_empty());
        assert_ne!(entry.status, "deferred");
        assert_eq!(entry.profile.is_some(), recipes.contains(&entry.id));
    }
    for pack in &catalogue.packs {
        assert!(
            catalogue
                .recipes
                .iter()
                .any(|recipe| recipe.pack_id == pack.id
                    && recipe.role.residential()
                    && recipe.weight > 0
                    && !recipe.temporal.late_only),
            "pack {} has no ordinary dwelling",
            pack.id
        );
    }
    for id in [
        "AM-PUEB-B03",
        "AM-PUEB-B05",
        "MED-ANT-B11",
        "AS-IND-B13",
        "AM-MESO-B07",
        "AM-MESO-B12",
        "AS-CHI-B13",
    ] {
        assert!(
            catalogue
                .recipes
                .iter()
                .find(|r| r.id == id)
                .unwrap()
                .role
                .residential(),
            "residential ensemble {id} was excluded"
        );
    }
}

#[test]
fn all_authored_defaults_are_technically_coherent() {
    let data = catalogue().unwrap();
    let errors: Vec<_> = data
        .recipes
        .iter()
        .flat_map(|recipe| {
            std::iter::once((&recipe.parameters, "default"))
                .chain(
                    recipe
                        .variants
                        .iter()
                        .map(|variant| (&variant.parameters, variant.id.as_str())),
                )
                .filter_map(|(parameters, variant)| {
                    data.validate_parameters(parameters)
                        .err()
                        .map(|error| format!("{} {variant}: {error}", recipe.id))
                })
        })
        .collect();
    assert!(errors.is_empty(), "{}", errors.join("\n"));
}

#[test]
fn explicit_variant_selection_resolves_and_rejects_other_bundles() {
    let data = catalogue().unwrap();
    let recipe = data
        .recipes
        .iter()
        .find(|r| !r.variants.is_empty() && !r.temporal.late_only)
        .unwrap();
    let id = recipe.variants[0].id.clone();
    let mut config = HouseConfig {
        pack: recipe.pack_id.clone(),
        recipe: Some(recipe.id.clone()),
        ..HouseConfig::default()
    };
    config.overrides.variant = Some(id.clone());
    assert_eq!(
        data.resolve_parameters(recipe, &config).unwrap().variant_id,
        id
    );
    assert!(
        data.resolve_variant_parameters(recipe, &config, "default")
            .is_err()
    );
    config.overrides.variant = Some("unknown".into());
    assert!(data.resolve_parameters(recipe, &config).is_err());
    config.recipe = None;
    assert!(data.validate_config(&config).is_err());
}

#[test]
fn source_context_roles_and_functional_forms_are_preserved() {
    let data = catalogue().unwrap();
    let source = source_inventory().unwrap();
    assert_eq!(data.schema_version, "2");
    assert_eq!(
        data.functional_mappings.len(),
        source.functional_forms.len()
    );
    let traits: BTreeSet<_> = data
        .geometry_traits
        .iter()
        .map(|trait_| &trait_.id)
        .collect();
    assert_eq!(traits.len(), data.geometry_traits.len());
    for (mapping, form) in data
        .functional_mappings
        .iter()
        .zip(&source.functional_forms)
    {
        assert_eq!(
            (&mapping.label, mapping.source_line),
            (&form.label, form.source_line)
        );
        assert!(!mapping.recipe_ids.is_empty());
        for id in &mapping.recipe_ids {
            assert!(data.recipes.iter().any(|recipe| recipe.id == *id));
        }
        for trait_ in &mapping.traits {
            assert!(traits.contains(trait_));
        }
        assert_eq!(mapping.status, "planned");
    }
    for recipe in &data.recipes {
        for id in [
            &recipe.settlement_pattern,
            &recipe.settlement_archetype,
            &recipe.compound_pattern,
        ] {
            assert!(
                source.entries.iter().any(|entry| entry.id == *id),
                "{} invalid context {id}",
                recipe.id
            );
        }
        assert!(!recipe.subtradition.is_empty());
        assert!(!recipe.chronology_note.is_empty());
        assert_eq!(
            recipe.settlement_archetype.rsplit_once("-S").unwrap().0,
            recipe.pack_id
        );
        if recipe.role == magna_urbis_houses::model::Role::SpatialComponent {
            assert_eq!(
                recipe.parameters.rooms_per_body,
                [0, 0],
                "{} invented living rooms",
                recipe.id
            );
            assert!(recipe.component_kind.is_some());
        }
        if recipe.role == magna_urbis_houses::model::Role::DomesticAnnex {
            assert!(!recipe.parameters.details.iter().any(|detail| {
                ["hearth", "central_hearth", "multiple_hearths"].contains(&detail.as_str())
            }));
        }
    }
    assert!(
        data.recipes
            .iter()
            .any(|recipe| recipe.id == "AF-EAST-B10" && recipe.role.residential())
    );
    assert!(!data.recipes.iter().any(|recipe| recipe.id == "AF-EAST-B11"));
    assert!(
        data.recipes
            .iter()
            .any(|recipe| recipe.id == "AM-MESO-B13" && recipe.role.residential())
    );
    for material in &data.materials {
        assert!(
            [
                "tile", "thatch", "wood", "stone", "earth", "fabric", "snow", "metal", "none"
            ]
            .contains(&material.pattern.as_str())
        );
    }
}

#[test]
fn source_bundles_resolve_roofs_and_materials_together() {
    let data = catalogue().unwrap();
    let mut config = HouseConfig {
        pack: "AS-IND".into(),
        recipe: Some("AS-IND-B01".into()),
        ..HouseConfig::default()
    };
    config.overrides.roof = Some("RF-FLAT".into());
    let recipe = data
        .recipes
        .iter()
        .find(|recipe| recipe.id == "AS-IND-B01")
        .unwrap();
    let parameters = data.resolve_parameters(recipe, &config).unwrap();
    assert_eq!(parameters.materials.cladding, "MAT-MUD-PLASTER");
    assert_eq!(parameters.roof_pitch_deg, [0.0, 0.0]);
    assert_eq!(parameters.variant_id, "flat_earth");
    config.overrides.cladding = Some("MAT-THATCH".into());
    assert!(data.resolve_parameters(recipe, &config).is_err());
    config = HouseConfig {
        pack: "ATL-CEL".into(),
        recipe: Some("ATL-CEL-B04".into()),
        ..HouseConfig::default()
    };
    config.overrides.footprint = Some("FP-RECT".into());
    let recipe = data
        .recipes
        .iter()
        .find(|recipe| recipe.id == "ATL-CEL-B04")
        .unwrap();
    assert_eq!(
        data.resolve_parameters(recipe, &config)
            .unwrap()
            .roof_system,
        "RF-GABLE"
    );
    let mut config = HouseConfig {
        pack: "EUR-MED".into(),
        ..HouseConfig::default()
    };
    config.overrides.cladding = Some("MAT-SLATE".into());
    let selected = data.admissible(&config).unwrap();
    assert!(selected.iter().any(|recipe| recipe.id == "EUR-MED-B04"));
    assert!(
        selected
            .iter()
            .all(|recipe| data.resolve_parameters(recipe, &config).is_ok())
    );
}

#[test]
fn strict_late_and_invalid_structures_are_rejected() {
    let data = catalogue().unwrap();
    let config = HouseConfig {
        pack: "AS-CHI".into(),
        recipe: Some("AS-CHI-B13".into()),
        mode: HistoricalMode::HistoricalStrict,
        ..HouseConfig::default()
    };
    assert!(data.validate_config(&config).is_err());
    let config = HouseConfig {
        allow_late: true,
        ..config
    };
    assert!(data.validate_config(&config).is_err());
    let config = HouseConfig {
        mode: HistoricalMode::HistoricalInspired,
        ..config
    };
    assert!(data.validate_config(&config).is_ok());
    for mode in [
        HistoricalMode::HistoricalStrict,
        HistoricalMode::HistoricalInspired,
        HistoricalMode::FantasyMix,
    ] {
        let mut config = HouseConfig {
            mode,
            recipe: Some("EUR-MED-B01".into()),
            ..HouseConfig::default()
        };
        config.overrides.frame = Some("MAT-THATCH".into());
        assert!(
            data.validate_config(&config).is_err(),
            "thatch became load-bearing in {mode:?}"
        );
    }
    let config = HouseConfig {
        size: f64::NAN,
        ..HouseConfig::default()
    };
    assert!(data.validate_config(&config).is_err());
    assert!(serde_json::from_str::<HouseConfig>(r#"{"unknown_rule":true}"#).is_err());
}

#[test]
fn controls_must_be_consumed_by_the_resolved_layout() {
    let data = catalogue().unwrap();
    let mut config = HouseConfig {
        mode: HistoricalMode::FantasyMix,
        ..HouseConfig::default()
    };
    let get = |id: &str| data.recipes.iter().find(|r| r.id == id).unwrap();
    for id in ["AS-CHI-B02", "AS-JAP-B03", "EUR-MED-B03", "AF-SAHEL-B09"] {
        let recipe = get(id);
        config.overrides.footprint = Some("FP-OVAL".into());
        assert!(
            data.resolve_variant_parameters(recipe, &config, "default")
                .is_err(),
            "{id}"
        );
        config.overrides.footprint = Some(recipe.parameters.footprint_family.clone());
        assert!(
            data.resolve_variant_parameters(recipe, &config, "default")
                .is_ok(),
            "idempotent {id}"
        );
    }
    config.overrides.footprint = None;
    config.overrides.courtyard_ratio = Some(0.4);
    assert!(
        data.resolve_variant_parameters(get("EUR-MED-B03"), &config, "default")
            .is_err()
    );
    assert!(
        data.resolve_variant_parameters(get("AF-SAHEL-B09"), &config, "default")
            .is_ok()
    );
    assert!(
        data.resolve_variant_parameters(get("AS-CHI-B02"), &config, "default")
            .is_ok()
    );
    config.overrides.courtyard_ratio = None;
    config.overrides.footprint = Some("FP-L".into());
    assert!(
        data.resolve_variant_parameters(get("MED-ANT-B05"), &config, "default")
            .is_ok()
    );
    config.overrides.footprint = Some("FP-OVAL".into());
    assert!(
        data.resolve_variant_parameters(get("MED-ANT-B05"), &config, "default")
            .is_err()
    );
    assert!(
        data.resolve_variant_parameters(get("EUR-MED-B01"), &config, "default")
            .is_ok()
    );
}

#[test]
fn authored_portal_profiles_reject_unusable_or_ambiguous_dimensions() {
    use magna_urbis_houses::catalogue::{PortalPlacement, PortalProfile, PortalShape, PortalSpec};
    let data = catalogue().unwrap();
    let mut p = data
        .recipes
        .iter()
        .find(|r| r.id == "EUR-MED-B01")
        .unwrap()
        .parameters
        .clone();
    let entry = PortalSpec {
        id: "entry".into(),
        shape: PortalShape::Rect,
        width_m: 1.1,
        top_width_m: 1.1,
        head_m: 2.05,
        sill_m: 0.2,
        min_clear_height_m: 1.8,
    };
    let good = PortalProfile {
        entries: vec![entry.clone()],
        count: [1, 1],
        placement: PortalPlacement::Distributed,
        confidence: "stylized".into(),
    };
    p.portal_profile = Some(good.clone());
    data.validate_parameters(&p).unwrap();
    let mut cases = vec![];
    let mut invalid = good.clone();
    invalid.entries.clear();
    cases.push(invalid);
    let mut invalid = good.clone();
    invalid.entries.push(entry.clone());
    cases.push(invalid);
    let mut invalid = good.clone();
    invalid.entries[0].width_m = f64::NAN;
    cases.push(invalid);
    let mut invalid = good.clone();
    invalid.entries[0].sill_m = 0.46;
    cases.push(invalid);
    let mut invalid = good.clone();
    invalid.entries[0].head_m = p.level_height_m;
    cases.push(invalid);
    let mut invalid = good.clone();
    invalid.count = [2, 1];
    cases.push(invalid);
    let mut invalid = good.clone();
    invalid.placement = PortalPlacement::Differentiated;
    cases.push(invalid);
    for invalid in cases {
        p.portal_profile = Some(invalid);
        assert!(data.validate_parameters(&p).is_err());
    }
    let mut differentiated = good;
    let mut large = entry;
    large.id = "large".into();
    large.width_m = 1.4;
    large.top_width_m = 1.4;
    differentiated.entries.push(large);
    differentiated.placement = PortalPlacement::Differentiated;
    differentiated.count = [2, 2];
    p.portal_profile = Some(differentiated);
    data.validate_parameters(&p).unwrap();
}

#[test]
fn companion_materials_have_source_provenance_without_changing_the_atlas() {
    let data = catalogue().unwrap();
    let source = source_inventory().unwrap();
    let atlas: BTreeSet<_> = source
        .entries
        .iter()
        .filter(|e| e.id.starts_with("MAT-"))
        .map(|e| e.id.as_str())
        .collect();
    let actual: BTreeSet<_> = data
        .materials
        .iter()
        .filter(|m| m.origin == "atlas")
        .map(|m| m.id.as_str())
        .collect();
    assert_eq!(atlas, actual);
    for material in data.materials.iter().filter(|m| m.origin != "atlas") {
        assert_eq!(material.origin, "source_building");
        let reference = material.source_ref.as_ref().unwrap();
        assert!(!reference.is_empty());
        assert!(data.recipes.iter().any(|r| reference.contains(&r.id)));
    }
    let textile = data
        .materials
        .iter()
        .find(|m| m.id == "MAT-WOVEN-TEXTILE")
        .unwrap();
    assert!(
        !textile
            .roles
            .iter()
            .any(|r| r == "load_bearing" || r == "frame")
    );
    let tent = data.recipes.iter().find(|r| r.id == "AF-MAG-B10").unwrap();
    assert_eq!(tent.parameters.materials.cladding, textile.id);
}
