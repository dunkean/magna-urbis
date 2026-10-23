//! Exact requests and preceding native occupation; no alternative algorithm.
use super::*;

#[derive(Deserialize)]
struct Witness {
    label: String,
    request: PlacementRequest,
    before: PlanBuilding,
    regressed: PlanBuilding,
    prior: Vec<PlanBuilding>,
}

fn occupied(request: &PlacementRequest, prior: &[PlanBuilding]) -> Surface {
    let mut index = OccupationIndex::default();
    for b in prior {
        let mut parts = vec![b.footprint.clone(), b.courtyards.clone(), b.circulation.clone()];
        parts.extend(b.structural_features.iter().map(|f| f.surface.clone()));
        index.insert(unite(&parts));
    }
    index.local(&request.cadastral)
}

#[test]
fn shared_final_structures_keep_real_winning_dimensions_when_their_entry_fails() {
    for input in [include_str!("fixtures/java-86-regression.json"),
                  include_str!("fixtures/c-3571-regression.json")] {
        let Witness { label, request: r, before, regressed, prior } =
            serde_json::from_str(input).unwrap();
        let occupied = occupied(&r, &prior);
        let target = r.programme.as_ref().unwrap().built_area_m2.unwrap();
        let initial = plan_one_initial(&r, &occupied, None, false).unwrap();
        let selection = improve_domestic_budget_selection(&r, &occupied, initial, target, true);
        assert!(selection.nominal.is_some(), "{label}: exercise the actual nominal fallback branch");
        assert!(!selection.building.resolved.has_retained_entrance());
        let winner = selection.building.clone();
        assert!((area(&winner.footprint) - area(&before.footprint)).abs() < 1e-5,
                "{label}: the budget winner must match the independently archived pre-wrapper area");
        assert!(area(&difference(&winner.footprint, &before.footprint)) < 1e-5);
        assert!(area(&winner.footprint) > area(&regressed.footprint) * 2.);

        let selected = selection.finalize(&r, &occupied);
        // Failure is explicit and exact. Only diagnostics may be appended;
        // there is no new dimension, pose, door, structure or fabricated entry.
        let mut unchanged = winner.clone();
        unchanged.diagnostics = selected.diagnostics.clone();
        assert_eq!(serde_json::to_value(&selected).unwrap(), serde_json::to_value(&unchanged).unwrap());
        assert!(!selected.resolved.has_retained_entrance());
        assert!(selected.diagnostics.iter().any(|s| s.starts_with("Native planning entrance deferred: final Single ")));
        assert!(selected.diagnostics.iter().any(|s| s.contains("No nominal dimension fallback, extra final preparation")));
        let mut report = serde_json::json!({"label":label,"id":r.id,"target_m2":target,
            "baseline_area_m2":area(&before.footprint),"v1_regressed_area_m2":area(&regressed.footprint),
            "winning_area_m2":area(&winner.footprint),"selected_area_m2":area(&selected.footprint),
            "exact_winner_retained_except_diagnostics":true,"retained_entrance":false,
            "diagnostics":selected.diagnostics});
        realize_plan(RealizePlanRequest { building: selected.clone(), interiors: false }).unwrap();
        report["exterior"] = "accepted".into();
        let reason = match realize_plan(RealizePlanRequest { building: selected.clone(), interiors: true }) {
            Ok(_) => panic!("{label}: an unresolved proxy unexpectedly certified its interior"),
            Err(reason) => reason,
        };
        report["interior"] = serde_json::json!({"refused":reason});
        eprintln!("b06-light-final-policy {}", serde_json::to_string(&report).unwrap());
        if let Some(dir) = std::env::var_os("MAGNA_B06_LIGHT_V2_PROOF_DIR") {
            let dir = std::path::PathBuf::from(dir);
            std::fs::create_dir_all(&dir).unwrap();
            let file = std::fs::OpenOptions::new().write(true).create_new(true)
                .open(dir.join(format!("{label}.json"))).unwrap();
            serde_json::to_writer_pretty(file, &serde_json::json!({
                "request":r,"occupied":occupied,"before":before,"winner":winner,
                "v1_regressed":regressed,"after":selected,"report":report})).unwrap();
        }
    }
}

