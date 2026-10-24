use super::*;
use crate::geometry::{rectangle, unite};
use crate::plans::{PlanBatchRequest, plan_batch};

#[derive(Deserialize)]
struct Fixture { request: PlacementRequest, retained_building: PlanBuilding }
fn fixture() -> Fixture {
    serde_json::from_str(include_str!("../tests/fixtures/programme-outcome-c1358.json")).unwrap()
}

#[test]
fn programme_outcome_tiny_c1358_records_shortfall_without_household_credit() {
    let f=fixture();
    let before=serde_json::to_value(&f.retained_building).unwrap();
    let report=PlanProgrammeOutcome::from_final_plan(&f.request,&f.retained_building);
    assert_eq!(report.version,VERSION);
    assert_eq!(report.body_footprint.requested_m2,Some(617.9));
    assert!((report.body_footprint.actual_m2-4.060225002401684).abs()<1e-8);
    assert_eq!(report.body_footprint.attainment,BodyFootprintAttainment::Deficit);
    assert!((report.body_footprint.deficit_m2.unwrap()-613.8397749975983).abs()<1e-8);
    assert_eq!(report.body_footprint.excess_m2,Some(0.));
    assert_eq!(report.households.requested,Some(3.));
    assert_eq!(report.households.housed,None);
    assert_eq!(report.households.capacity_status,HouseholdCapacityStatus::Unknown);
    assert_eq!(serde_json::to_value(&f.retained_building).unwrap(),before);
    // No whole-programme/role/composition/historical certificate is emitted.
    let value=serde_json::to_value(report).unwrap();
    assert!(value.get("composition_rank").is_none());
    assert!(value.get("programme_met").is_none());
    assert!(value["households"]["housed"].is_null());
}

#[test]
fn programme_outcome_missing_target_is_unrequested_and_old_saved_plan_stays_unreported() {
    let mut f=fixture();
    assert!(f.retained_building.programme_outcome.is_none());
    let saved=serde_json::to_value(&f.retained_building).unwrap();
    assert!(saved.get("programme_outcome").is_none());
    let old:PlanBuilding=serde_json::from_value(saved.clone()).unwrap();
    assert!(old.programme_outcome.is_none());
    assert_eq!(serde_json::to_value(&old).unwrap(),saved);
    f.request.programme.as_mut().unwrap().built_area_m2=None;
    let outcome=PlanProgrammeOutcome::from_final_plan(&f.request,&old);
    assert_eq!(outcome.body_footprint.attainment,BodyFootprintAttainment::NotRequested);
    assert_eq!(outcome.body_footprint.requested_m2,None);
    assert_eq!(outcome.body_footprint.deficit_m2,None);
    assert_eq!(outcome.body_footprint.excess_m2,None);
    assert_eq!(outcome.households.requested,Some(3.));
    assert_eq!(outcome.households.housed,None);
    f.request.programme=None;
    let absent=PlanProgrammeOutcome::from_final_plan(&f.request,&old);
    assert_eq!(absent.households.requested,None);
    assert_eq!(absent.body_footprint.attainment,BodyFootprintAttainment::NotRequested);
    assert!(absent.body_footprint.actual_m2>0.);
}

#[test]
fn programme_outcome_tolerance_is_inclusive_and_numeric_gaps_are_not_capacity() {
    let mut f=fixture();f.request.programme.as_mut().unwrap().built_area_m2=Some(100.);
    for (width,status) in [(9.,BodyFootprintAttainment::WithinTolerance),
        (11.,BodyFootprintAttainment::WithinTolerance),(8.9,BodyFootprintAttainment::Deficit),
        (11.1,BodyFootprintAttainment::Excess)] {
        f.retained_building.footprint=rectangle(0.,0.,width,10.);
        let report=PlanProgrammeOutcome::from_final_plan(&f.request,&f.retained_building);
        assert_eq!(report.body_footprint.attainment,status);
        assert!((report.body_footprint.deficit_m2.unwrap()-(100.-width*10.).max(0.)).abs()<1e-7);
        assert!((report.body_footprint.excess_m2.unwrap()-(width*10.-100.).max(0.)).abs()<1e-7);
        assert_eq!(report.households.housed,None);
    }
}

#[test]
fn programme_outcome_uses_final_projected_union_not_nominal_or_summed_floor_area() {
    let mut f=fixture();f.request.programme.as_mut().unwrap().built_area_m2=Some(150.);
    // Overlapping projected bodies and upper levels must not be summed as GFA.
    f.retained_building.footprint=unite(&[rectangle(0.,0.,10.,10.),rectangle(5.,0.,10.,10.)]);
    f.retained_building.useful_area_m2=900.;
    f.retained_building.domestic_units=42; // even a stale scalar is not evidence
    let mut stale=PlanProgrammeOutcome::from_final_plan(&f.request,&f.retained_building);
    stale.body_footprint.actual_m2=484.;
    f.retained_building.programme_outcome=Some(stale);
    let report=PlanProgrammeOutcome::from_final_plan(&f.request,&f.retained_building);
    assert!((report.body_footprint.actual_m2-150.).abs()<1e-7);
    assert_eq!(report.body_footprint.attainment,BodyFootprintAttainment::WithinTolerance);
    assert_eq!(report.households.housed,None);
}

#[test]
fn programme_outcome_batch_boundary_reports_after_all_finalization_paths() {
    let f=fixture();
    let output=plan_batch(PlanBatchRequest { schema_version:"1".into(),requests:vec![f.request.clone()],
        settings:None,footprints:Default::default() }).unwrap();
    // Native root runs this test; this author never invokes Cargo or native.
    let building=output.buildings.first().expect("frozen admitted C1358 remains admitted");
    let report=building.programme_outcome.as_ref().expect("all successful plan_one paths are reported at final batch boundary");
    assert_eq!(*report,PlanProgrammeOutcome::from_final_plan(&f.request,building));
    assert_eq!(report.body_footprint.actual_m2,area(&building.footprint));
    assert_eq!(report.households.requested,Some(3.));
    assert_eq!(report.households.housed,None);
    let saved=serde_json::to_value(building).unwrap();
    let restored:PlanBuilding=serde_json::from_value(saved.clone()).unwrap();
    assert_eq!(serde_json::to_value(restored).unwrap(),saved);
}
