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
        let context = ProgrammeContext { role: "capital".into(),
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
            assert!(programme.warnings.iter().any(|m| m.contains("sans accès navigable déclaré")));
        }
    }
}

#[test]
fn programme_functions_explicit_empty_does_not_resurrect_legacy_role_or_navigation_as_an_activity() {
    let legacy = ProgrammeContext { role: "port".into(), navigable_access: true, ..Default::default() };
    let old = prepared(&legacy, 600);
    assert!(generic(&old, "warehouse").is_some());
    let explicit = prepared(&ProgrammeContext { functions: Some(ProgrammeFunctions::default()), ..legacy.clone() }, 600);
    assert!(generic(&explicit, "warehouse").is_none());
    assert_eq!(generic(&explicit, "mixed").unwrap().requested,
        600.0 / roles::occupancy("european-organic").household_size * 0.08);
    let json = serde_json::to_value(&legacy).unwrap();
    assert!(json.get("functions").is_none());
    let restored: ProgrammeContext = serde_json::from_value(json).unwrap();
    assert_eq!(serde_json::to_value(prepared(&restored, 600)).unwrap(), serde_json::to_value(old).unwrap());
}

#[test]
fn programme_functions_isolated_intent_wins_and_port_declaration_does_not_certify_a_dry_site() {
    let weights = ProgrammeFunctions { capital: 1.0, artisan: 1.0, port: 1.0, ..Default::default() };
    let isolated = prepared(&ProgrammeContext { role: "isolated-mill".into(), functions: Some(weights), ..Default::default() }, 600);
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
    let old = roles::services(culture, 5000, "auto");
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
    assert_eq!(ProgrammeFunctions::from_legacy_role("crossroads").values(), [0.0,1.0,0.0,0.0,0.0,0.0]);
    assert_eq!(ProgrammeFunctions::from_legacy_role("capital").values(), [0.0,0.0,0.0,0.0,0.0,1.0]);
}
