use super::*;
#[test]
fn souk_cuts_use_a_real_small_house_and_explicit_courts_keep_their_profile() {
    let souk = contextual_mapping("medina", "M", "core", "burgage", "mixed").unwrap();
    assert_eq!(souk.family, "frontage");
    assert_eq!(souk.admissibility.recipe_id, "AF-MAG-B01");
    assert!(souk.admissibility.min_area < 60.0);
    // The lot minimum is the exported native envelope (houses owns its
    // numbers) plus the shared 0.6 m clearance.
    let native = supported_recipe("AF-MAG-B01", "M").expect("exported souk house");
    assert!((souk.admissibility.min_frontage - (native.min_envelope_m[0] + 0.6)).abs() < 1e-6);
    assert!((souk.admissibility.min_depth - (native.min_envelope_m[1] + 0.6)).abs() < 1e-6);
    let court = contextual_mapping("medina", "M", "core", "courtyard", "domestic").unwrap();
    assert_eq!(court.admissibility.recipe_id, "AF-MAG-B02");
    assert!(court.admissibility.min_area > 900.0);
    let row = contextual_mapping("bastide", "M", "core", "burgage", "domestic").unwrap();
    assert_eq!(row.admissibility.recipe_id, "EUR-MED-B02");
    assert!(
        contextual_mapping("medina", "unsupported", "core", "burgage", "domestic").is_none()
    );
}
#[test]
fn shared_land_does_not_nest_another_whole_compound() {
    let sahel = mapping("sahel").unwrap();
    assert_eq!(sahel.family, "compound");
    assert_eq!(sahel.architecture_family, "common");
    assert!(sahel.admissibility.min_frontage < 7.0);
    let stilt = mapping("stilt-town").unwrap();
    assert_eq!(stilt.architecture_family, "platform");
    let profile = recipe_profile(&stilt.architecture_pack, "platform", "any").unwrap();
    assert_eq!(profile.layout, "platform");
    assert!(stilt.admissibility.min_depth < 13.0);
}
#[test]
fn registered_functional_choices_are_matched_exactly() {
    assert!(functional_choice_registered(
        "javanese-courts", "AS-ISL", "storage.granary", "warehouse", "hall", "historical_inspired"
    ));
    assert!(!functional_choice_registered(
        "javanese-courts", "AS-ISL", "storage.granary", "warehouse", "hall", "historical_strict"
    ));
    assert!(!functional_choice_registered(
        "javanese-courts", "AS-ISL", "worship.shrine", "collective", "religious", "historical_inspired"
    ));
}
#[test]
fn functional_source_requirements_are_exact_and_registry_driven() {
    assert!(requires_functional_source("storage.horreum","warehouse"));
    assert!(functional_source_gap("roman-core","MED-ANT","storage.horreum","warehouse","","historical_inspired").is_none());
    assert!(functional_source_gap("roman-core","MED-ANT","storage.horreum","warehouse","A","historical_strict").is_some());
    for (culture,pack,role,function) in [
        ("roman-core","MED-ANT","dwelling.house","domestic"),
        ("roman-core","MED-ANT","commerce.emporium","market"),
        ("javanese-courts","AS-ISL","storage.granary","warehouse"),
        ("roman-core","AS-ISL","storage.horreum","warehouse"),
    ] {
        assert!(functional_source_gap(culture,pack,role,function,"","historical_inspired").is_none());
    }
    // Existence of the source is read from the existing registry; this
    // versioned row declares a requirement, not a permanent missing flag.
    assert!(!functional_choice_registered("roman-core","MED-ANT","storage.horreum","warehouse","hall","historical_inspired"));
}
fn injected_coverage_registry() -> serde_json::Value {
    // Decision-only fixture: this ID has no geometry, source attribution,
    // native realization or claimed historical/storage capacity.
    serde_json::json!({
        "profiles":[{"recipe_id":"test-only-functional-source","pack":"MED-ANT",
            "layout":"single","min_envelope_m":[6.0,10.0],"min_access_width_m":1.0,
            "status":"supported","floors":[1,1],"eras":["A"],"inspired_only":false}],
        "functional_programmes":{"version":"functional-programmes-1","programmes":[]},
        "functional_choices":{"rules":[{
            "culture_id":"roman-core","pack_id":"MED-ANT","urban_role":"storage.horreum",
            "function":"warehouse","composition":"hall","modes":["historical_inspired"],
            "sources":[{"style_id":"test-only-functional-source::default",
                "recipe_id":"test-only-functional-source","nominal_width_m":[6.0,10.0],
                "nominal_depth_m":[10.0,14.0],"temporal":{"eras":["A"],"late_only":false}}]
        }]}
    })
}
fn injected_gap(value:serde_json::Value,period:&str,mode:&str)->bool {
    let catalogue:AdmissionCatalogue=serde_json::from_value(value).unwrap();
    functional_source_gap_in(functional_source_coverage(),&catalogue,
        "roman-core","MED-ANT","storage.horreum","warehouse",period,mode).is_some()
}
#[test]
fn an_admissible_injected_functional_choice_lifts_the_same_source_gap() {
    let mut empty=injected_coverage_registry();
    empty["functional_choices"]["rules"]=serde_json::json!([]);
    assert!(injected_gap(empty,"A","historical_inspired"));
    // Only the registry changes: role, culture, pack, composition, mode and
    // requested era are the same. No production registry is mutated.
    assert!(!injected_gap(injected_coverage_registry(),"A","historical_inspired"));
    let mut non_residential=injected_coverage_registry();
    non_residential["profiles"]=serde_json::json!([]);
    assert!(!injected_gap(non_residential,"A","historical_inspired"),"A functional source needs no residential admission profile");
    assert!(injected_gap(injected_coverage_registry(),"A","historical_strict"));
    assert!(injected_gap(injected_coverage_registry(),"M","historical_inspired"));
    for (field,value) in [
        ("culture_id",serde_json::json!("different-culture")),
        ("pack_id",serde_json::json!("different-pack")),
        ("urban_role",serde_json::json!("storage.other")),
        ("function",serde_json::json!("collective")),
        ("composition",serde_json::json!("courtyard")),
        ("modes",serde_json::json!(["historical_strict"])),
        ("sources",serde_json::json!([])),
    ] {
        let mut v=injected_coverage_registry();v["functional_choices"]["rules"][0][field]=value;
        assert!(injected_gap(v,"A","historical_inspired"),"wrong {field} cleared a source gap");
    }
    for (field,value) in [
        ("recipe_id",serde_json::json!("no-admitted-source")),
        ("nominal_width_m",serde_json::json!([0.0,10.0])),
        ("nominal_depth_m",serde_json::json!([14.0,10.0])),
        ("temporal",serde_json::json!({"eras":["M"],"late_only":false})),
        ("temporal",serde_json::json!({"eras":["A"],"late_only":true})),
        ("temporal",serde_json::Value::Null),
    ] {
        let mut v=injected_coverage_registry();v["functional_choices"]["rules"][0]["sources"][0][field]=value;
        assert!(injected_gap(v,"A","historical_inspired"),"unusable source {field} cleared a gap");
    }
    let mut inspired=injected_coverage_registry();
    inspired["functional_choices"]["rules"][0]["modes"]=serde_json::json!(["historical_strict","historical_inspired"]);
    inspired["functional_choices"]["rules"][0]["sources"][0]["inspired_only"]=serde_json::json!(true);
    assert!(injected_gap(inspired.clone(),"A","historical_strict"));
    inspired["functional_choices"]["rules"][0]["sources"][0]["temporal"]["eras"]=serde_json::json!([]);
    inspired["profiles"][0]["inspired_only"]=serde_json::json!(true);
    inspired["profiles"][0]["eras"]=serde_json::json!([]);
    assert!(!injected_gap(inspired,"A","historical_inspired"),"An explicitly inspired undated envelope does not pretend a historical era");
    let mut irrelevant_residential=injected_coverage_registry();
    irrelevant_residential["profiles"][0]["pack"]=serde_json::json!("different-pack");
    irrelevant_residential["profiles"][0]["status"]=serde_json::json!("refused");
    irrelevant_residential["profiles"][0]["eras"]=serde_json::json!(["M"]);
    assert!(!injected_gap(irrelevant_residential,"A","historical_inspired"),
        "A residential default is not the declared functional source's compatibility decision");
}
#[test]
fn an_admissible_injected_functional_programme_lifts_the_same_source_gap() {
    let mut registry=injected_coverage_registry();
    registry["functional_choices"]["rules"]=serde_json::json!([]);
    registry["functional_programmes"]["programmes"]=serde_json::json!([{
        "recipe_id":"test-only-functional-source","pack_id":"MED-ANT","function":"warehouse",
        "composition":"hall","urban_roles":["storage.horreum"],"eras":["A"],
        "late_only":false,"modes":["historical_inspired"]}]);
    assert!(!injected_gap(registry.clone(),"A","historical_inspired"));
    let mut non_residential=registry.clone();non_residential["profiles"]=serde_json::json!([]);
    assert!(!injected_gap(non_residential,"A","historical_inspired"),"A true functional programme is not a residential recipe");
    let mut irrelevant_residential=registry.clone();
    irrelevant_residential["profiles"][0]["status"]=serde_json::json!("refused");
    irrelevant_residential["profiles"][0]["eras"]=serde_json::json!(["M"]);
    assert!(!injected_gap(irrelevant_residential,"A","historical_inspired"));
    assert!(injected_gap(registry.clone(),"M","historical_inspired"));
    assert!(injected_gap(registry.clone(),"A","historical_strict"));
    for (field,value) in [
        ("pack_id",serde_json::json!("different-pack")),
        ("function",serde_json::json!("collective")),
        ("composition",serde_json::json!("courtyard")),
        ("urban_roles",serde_json::json!(["storage.other"])),
        ("eras",serde_json::json!(["M"])),
        ("modes",serde_json::json!(["historical_strict"])),
        ("recipe_id",serde_json::json!("")),
        ("late_only",serde_json::json!(true)),
    ] {
        let mut v=registry.clone();v["functional_programmes"]["programmes"][0][field]=value;
        assert!(injected_gap(v,"A","historical_inspired"),"unusable programme {field} cleared a gap");
    }
    registry["functional_programmes"]["version"]=serde_json::json!("unsupported-version");
    assert!(injected_gap(registry,"A","historical_inspired"));
}
#[test]
fn a_palette_mapped_culture_admits_only_its_tradition() {
    let java = mapping("javanese-courts").unwrap();
    assert_eq!(java.architecture_pack, "AS-ISL");
    assert_eq!(palette_tradition("javanese-courts", "AS-ISL"), Some("javanese"));
    assert_eq!(recipe_tradition(&java.admissibility.recipe_id), Some("javanese"));
    // Same for the compact fallback and in a dated period.
    if let Some(small) = super::super::parcels::compact_fallback("AS-ISL", "M", &java.admissibility) {
        assert_eq!(recipe_tradition(&small.recipe_id), Some("javanese"));
    }
    let medieval = mapping_for("javanese-courts", "M").unwrap();
    assert_eq!(recipe_tradition(&medieval.admissibility.recipe_id), Some("javanese"));
}
#[test]
fn period_selects_a_supported_source_before_cutting() {
    let ancient = mapping_for("persian", "A").unwrap();
    assert!(ancient.admissibility.eras.iter().any(|era| era == "A"));
    assert!(mapping_for("european-organic", "A").is_none());
    let medieval = mapping_for("persian", "M").unwrap();
    assert!(mapping_for("roman-core", "A").is_some());
    assert!(mapping_for("roman-core", "M").is_none());
    assert!(medieval.admissibility.eras.iter().any(|era| era == "M"));
    assert!(mapping_for("european-organic", "unsupported-era").is_none());
}
#[test]
fn all_ui_cultures_have_an_explicit_mapping() {
    let cat = super::super::catalogue();
    assert_eq!(mappings().len(), cat["cultures"].as_object().unwrap().len());
    for id in cat["cultures"].as_object().unwrap().keys() {
        let route = mapping(id).expect("explicit UI route");
        let preferred = PREFERRED.iter().find(|p| p.0 == id.as_str());
        let profile = match preferred {
            Some(&(_, recipe)) => supported_recipe(recipe, "any").expect("preferred recipe"),
            None => recipe_profile_in(
                &route.architecture_pack,
                &route.architecture_family,
                "any",
                palette_tradition(id, &route.architecture_pack),
            )
            .expect("supported native source"),
        };
        assert_eq!(profile.pack_id, route.architecture_pack, "{id}");
        assert_eq!(profile.status, "supported", "{id}");
        assert_eq!(route.admissibility.recipe_id, profile.id, "{id}");
        assert_eq!(route.admissibility.native_layout, profile.layout, "{id}");
        assert!(
            route.admissibility.min_area.is_finite() && route.admissibility.min_area > 0.0,
            "{id}"
        );
    }
}
/// Every catalogue culture, real or fantasy, plans a small town end to end on
/// the same flat crossroads: quarters, lots, then building-site requests.
#[test]
fn every_catalogue_culture_generates_a_small_town() {
    use super::super::{LayoutConfig, ParcelConfig, Point, Site, Street, Surface};
    let n = 64;
    let height = vec![20.0; n * n];
    let water = vec![0; n * n];
    let level = vec![0.0; n * n];
    let surface = Surface {
        geometry: None,
        width: 1600.0,
        n,
        height: &height,
        water: &water,
        interpolation: Default::default(),
    };
    let road = |a: (f64, f64), b: (f64, f64)| Street {
        path: vec![Point { x: a.0, y: a.1 }, Point { x: b.0, y: b.1 }],
        widths: vec![6.0, 6.0],
        rank: 1,
        role: "regional".into(),
    };
    let roads = [
        road((100.0, 800.0), (1500.0, 800.0)),
        road((800.0, 100.0), (800.0, 1500.0)),
    ];
    let cfg = LayoutConfig {
        footprint: super::super::config::legacy_footprint(),
        ..LayoutConfig::default()
    };
    let cat = super::super::catalogue();
    let mut failures = vec![];
    for (culture, data) in cat["cultures"].as_object().unwrap() {
        for r in data["recipes"].as_array().unwrap() {
            for stage in ["quarters", "parcels"] {
                if let Err(error) = super::super::resolve(
                    culture,
                    "culture",
                    r["id"].as_str().unwrap(),
                    r["zone"].as_str().unwrap(),
                    1.0,
                    &serde_json::json!({}),
                    stage,
                ) {
                    failures.push(format!("{culture}/{}: {error}", r["id"]));
                }
            }
        }
        let site = Site {
            key: "town".into(),
            name: "Town".into(),
            population: 1500,
            culture: culture.clone(),
            center: Point { x: 800.0, y: 800.0 },
            radius: 320.0,
            neighbours: Vec::new(),
        };
        let seed = format!("culture-town-{culture}");
        let result = super::super::generate_quarters(&seed, &[site], &cfg, surface, &roads)
            .and_then(|layouts| {
                let partitions =
                    super::super::generate_parcels(&seed, &layouts, &ParcelConfig::default())?;
                let sites = super::super::building_sites::requests(
                    &seed,
                    &layouts,
                    &partitions,
                    surface,
                    &level,
                    None,
                )?;
                Ok((layouts, partitions, sites))
            });
        match result {
            Ok((layouts, partitions, sites)) => {
                let blocks = layouts[0].blocks.len();
                let lots = partitions[0].parcels.len();
                if blocks == 0 || lots == 0 || sites.is_empty() {
                    // Why the town is empty: what its lots are and what its programme asked and placed.
                    let mut reasons = std::collections::BTreeMap::new();
                    for p in &partitions[0].parcels {
                        *reasons.entry(p.reason.as_str()).or_insert(0usize) += 1;
                    }
                    let programme = partitions[0].programme.as_ref().map(|pr| {
                        format!(
                            "{} demands, {} allocations, warnings {:?}",
                            pr.demands.len(),
                            pr.allocations.len(),
                            pr.warnings.iter().take(3).collect::<Vec<_>>()
                        )
                    });
                    failures.push(format!(
                        "{culture}: {blocks} blocks, {lots} lots, {} sites; lots {reasons:?}; programme {programme:?}",
                        sites.len()
                    ));
                }
            }
            Err(error) => failures.push(format!("{culture}: {error}")),
        }
    }
    assert!(failures.is_empty(), "{failures:#?}");
}
