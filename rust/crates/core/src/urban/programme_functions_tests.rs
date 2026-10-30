//! Real programme preparation on a tiny dry layout. These tests measure demand
//! and prerequisites, never pretend that a house or navigable route was built.
use super::*;

fn prepared(context: &ProgrammeContext, population: u32) -> UrbanProgramme {
    let mut layout: Layout = serde_json::from_value(serde_json::json!({
        "key":"functions", "culture":"european-organic", "center":{"x":150.0,"y":130.0},
        "quarters":[], "blocks":[], "streets":[], "warnings":[]
    })).unwrap();
    prepare(&mut layout, population, context, Surface { geometry: None, width: 1000.0,
        n: 1, height: &[0.0], water: &[0] }).unwrap();
    layout.programme.unwrap()
}
fn generic<'a>(p: &'a UrbanProgramme, function: &str) -> Option<&'a Demand> {
    let id = format!("functions/demand/{function}");
    p.demands.iter().find(|d| d.id == id)
}

#[test]
fn programme_functions_prepare_combines_capital_port_artisan_at_zero_half_and_full() {
    let population = 600;
    let household_target = f64::from(population) / roles::occupancy("european-organic").household_size;
    for weight in [0.0, 0.5, 1.0] {
        let context = ProgrammeContext {
            functions: Some(ProgrammeFunctions { capital: weight, port: weight, artisan: weight, ..Default::default() }),
            ..Default::default() };
        let programme = prepared(&context, population);
        assert_eq!(generic(&programme, "mixed").unwrap().requested, household_target * (0.08 + 0.17 * weight));
        let homes = generic(&programme, "mixed").unwrap().requested + generic(&programme, "domestic").unwrap().requested;
        assert!((homes - household_target).abs() < 1e-10);
        assert_eq!(generic(&programme, "workshop").map(|d| d.requested), if weight > 0.0 { Some((600.0 * 3.5 * weight).max(80.0)) } else { None });
        assert_eq!(generic(&programme, "warehouse").map(|d| d.requested), if weight > 0.0 { Some((600.0 * 2.0 * weight).max(180.0)) } else { None });
        assert_eq!(programme.demands.iter().map(|d| &d.id).collect::<BTreeSet<_>>().len(), programme.demands.len());
        if weight > 0.0 {
            let port = generic(&programme, "warehouse").unwrap();
            assert!(port.requires.iter().any(|r| r == "navigableAccess"));
            assert_eq!(port.deficit, port.requested);
            assert!(programme.warnings.iter().any(|m| m.contains("sans rive navigable mesurée")));
        }
    }
}

#[test]
fn programme_intent_and_specialisation_are_separate_fields_without_role() {
    // A declared port resolves an automatic port specialisation; explicit empty weights mean none.
    let declared = ProgrammeContext { navigable_access: true, ..Default::default() };
    assert!(generic(&prepared(&declared, 600), "warehouse").is_some());
    let explicit = prepared(&ProgrammeContext { functions: Some(ProgrammeFunctions::default()), ..declared.clone() }, 600);
    assert!(generic(&explicit, "warehouse").is_none());
    assert_eq!(generic(&explicit, "mixed").unwrap().requested,
        600.0 / roles::occupancy("european-organic").household_size * 0.08);
    let json = serde_json::to_value(&declared).unwrap();
    assert_eq!(json["intent"], "settlement");
    assert!(json.get("role").is_none() && json.get("functions").is_none());
    assert!(serde_json::from_str::<ProgrammeContext>(r#"{"role":"port"}"#).is_err(), "role is gone, not aliased");
    // The intent alone selects an isolated establishment; weights never change it.
    let mill = prepared(&ProgrammeContext { intent: "isolated-mill".into(), ..Default::default() }, 600);
    assert_eq!(mill.demands.len(), 1);
    assert_eq!(mill.demands[0].role, "craft.mill");
}

#[test]
fn programme_functions_isolated_intent_wins_and_port_declaration_does_not_certify_a_dry_site() {
    let weights = ProgrammeFunctions { capital: 1.0, artisan: 1.0, port: 1.0, ..Default::default() };
    let isolated = prepared(&ProgrammeContext { intent: "isolated-mill".into(), functions: Some(weights), ..Default::default() }, 600);
    assert_eq!(isolated.demands.len(), 1);
    assert_eq!(isolated.demands[0].role, "craft.mill");
    assert!(isolated.warnings.iter().any(|w| w.contains("non applicables")));
    assert!(!isolated.demands.iter().any(|d| d.role == "commerce.warehouse"));
    let dry_port = prepared(&ProgrammeContext { functions: Some(weights), navigable_access: true, ..Default::default() }, 600);
    let warehouse = generic(&dry_port, "warehouse").unwrap();
    assert_eq!(warehouse.deficit, warehouse.requested);
    assert!(dry_port.reservations.is_empty());
    assert!(dry_port.environment.is_empty());
}

#[test]
fn programme_functions_service_rounding_is_bounded_and_mill_effect_is_not_duplicated() {
    let culture = "european-organic";
    let counts = |w| roles::services_with_functions(culture, 5000, ProgrammeFunctions { artisan: w, riverine: w, ..Default::default() });
    let old = roles::services(culture, 5000);
    for weight in [0.0, 0.01, 0.5, 1.0] {
        let current = counts(weight);
        for before in &old {
            let after = current.iter().find(|n| n.entry.role == before.entry.role).unwrap();
            let multiplier = if before.entry.role.starts_with("craft.") { 1.0 + weight } else { 1.0 };
            assert_eq!(after.sites, ((before.sites as f64 * multiplier).floor() as usize).min((before.entry.max.max(1) as f64 * multiplier).floor() as usize));
            assert!(after.sites >= before.sites);
            if before.entry.role == "craft.mill" { assert!(after.sites <= before.sites * 2); }
        }
    }
    assert_eq!(ProgrammeFunctions::automatic(600, false, false).values(), [0.0; 6]);
    assert_eq!(ProgrammeFunctions::automatic(200, false, true).values(), [1.0,0.0,0.0,0.0,1.0,0.0]);
}
