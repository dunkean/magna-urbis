//! Exact C7921 requests, with their preceding native batch occupation.
use super::*;

#[derive(Deserialize)]
struct Prior { parts: Vec<Surface> }

#[derive(Deserialize)]
struct Witness {
    request: PlacementRequest,
    prior: Vec<Prior>,
    before: PlanBuilding,
    regressed: PlanBuilding,
}

fn fixture(label: &str) -> (PlacementRequest, Surface, PlanBuilding, PlanBuilding) {
    let mut all: BTreeMap<String, Witness> = serde_json::from_str(include_str!(
        "../tests/fixtures/nominal-first-budget-regressions.json"
    )).unwrap();
    let w = all.remove(label).unwrap();
    let mut index = OccupationIndex::default();
    for prior in w.prior { index.insert(unite(&prior.parts)); }
    let occupied = index.local(&w.request.cadastral);
    (w.request, occupied, w.before, w.regressed)
}

fn counts(b: &PlanBuilding) -> (usize, usize) {
    let d = b.diagnostics.iter().rev().find(|s| s.starts_with("Domestic footprint budget:")).unwrap();
    let dimensions = d.split("/8 dimension pairs").next().unwrap().rsplit("; ").next().unwrap().parse().unwrap();
    let poses = d.split("/24 rigid poses").next().unwrap().rsplit(", ").next().unwrap().parse().unwrap();
    (dimensions, poses)
}

fn same_geometry(a: &PlanBuilding, b: &PlanBuilding) {
    assert_eq!(a.recipe_id, b.recipe_id);
    assert_eq!(a.variant_id, b.variant_id);
    assert!((area(&a.footprint) - area(&b.footprint)).abs() < 0.00001);
    assert!(area(&difference(&a.footprint, &b.footprint)) < 0.00001);
    assert!(area(&difference(&a.roof_footprint, &b.roof_footprint)) < 0.00001);
}

#[test]
fn real_nominal_winners_precede_adapted_search_and_keep_entry() {
    for label in ["6495-budget", "6577-b14-entry", "1409-b15-entry"] {
        let (r, occupied, before, regressed) = fixture(label);
        let target = r.programme.as_ref().unwrap().built_area_m2.unwrap();
        let initial = plan_one_initial(&r, &occupied, None, false).unwrap();
        // Same loop with phase 1 disabled: no copied alternative algorithm.
        // The independent archived output checks preservation of phase 0.
        let nominal = improve_domestic_budget_selection(&r, &occupied, initial.clone(), target, false);
        assert!(nominal.nominal.is_none());
        let nominal = nominal.finalize(&r, &occupied);
        same_geometry(&nominal, &before);
        let selection = improve_domestic_budget_selection(&r, &occupied, initial, target, true);
        if label == "6495-budget" {
            assert!(selection.nominal.is_none(), "nominal target success must stop before phase 1");
            assert_eq!(counts(&selection.building), counts(&nominal));
        }
        let selected = selection.finalize(&r, &occupied);
        let error = |b: &PlanBuilding| (area(&b.footprint) / target).ln().abs();
        assert!(error(&selected) <= error(&nominal) + 1e-6);
        let (dimensions, poses) = counts(&selected);
        assert!(dimensions <= 8 && poses <= 24);
        for d in selected.diagnostics.iter().filter(|d| d.starts_with("Source aspect terrain guide:")) {
            let n: usize = d.split("/8").next().unwrap().rsplit(' ').next().unwrap().parse().unwrap();
            assert!(n <= 8);
        }
        assert_eq!(selected.recipe_id, before.recipe_id);
        assert_eq!(selected.variant_id, before.variant_id);
        assert_eq!(selected.volumes.len(), 1);
        let had_entry = nominal.resolved.unpack().unwrap().entrance.is_some();
        assert!(!had_entry || selected.resolved.unpack().unwrap().entrance.is_some());
        realize_plan(RealizePlanRequest { building: selected.clone(), interiors: false }).unwrap();
        if had_entry {
            realize_plan(RealizePlanRequest { building: selected.clone(), interiors: true }).unwrap();
        }
        eprintln!("Nominal-first exact witness: label={label} before={:.9} regressed={:.9} nominal={:.9} selected={:.9} target={target} dimensions={dimensions}/8 poses={poses}/24 native_entry={}", area(&before.footprint), area(&regressed.footprint), area(&nominal.footprint), area(&selected.footprint), selected.resolved.unpack().unwrap().entrance.is_some());
    }
}

#[test]
fn real_regressed_single_portals_use_the_nominal_existing_pose_fallback() {
    for label in ["6577-b14-entry", "1409-b15-entry"] {
        let (r, occupied, before, regressed) = fixture(label);
        assert!(before.resolved.unpack().unwrap().entrance.is_some());
        assert!(regressed.resolved.unpack().unwrap().entrance.is_none());
        let initial = plan_one_initial(&r, &occupied, None, false).unwrap();
        let target = r.programme.as_ref().unwrap().built_area_m2.unwrap();
        let nominal = improve_domestic_budget_selection(&r, &occupied, initial, target, false).building;
        assert!(nominal.resolved.unpack().unwrap().entrance.is_none(), "exercise the actual extra nominal preparation, not an already certified archive");
        let pose = nominal.transform.clone();
        // These are two genuinely admitted native plans from the same request.
        // Injecting the archived rejected choice exercises only final selection,
        // independently of whether the new phase order ever chooses it again.
        let result = budget_selection::Selection { building: regressed, nominal: Some(nominal) }.finalize(&r, &occupied);
        assert!(result.resolved.unpack().unwrap().entrance.is_some());
        same_geometry(&result, &before);
        assert_eq!(result.transform.origin, pose.origin);
        assert_eq!(result.transform.orientation_deg, pose.orientation_deg);
        assert!(result.diagnostics.iter().any(|d| d.contains("best nominal plan and its certified existing-pose entrance")));
        realize_plan(RealizePlanRequest { building: result.clone(), interiors: false }).unwrap();
        realize_plan(RealizePlanRequest { building: result, interiors: true }).unwrap();
    }
}
