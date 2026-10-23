//! Diagnostic test for the isolated Houses copy, never a claim of recovery
//! until its output contains a successful ordinary native admission.
use super::*;
use super::initial_terrain_recovery::Recovery;

#[derive(Deserialize)]
struct PriorOccupation {
    id: String,
    parts: Vec<Surface>,
}

#[derive(Deserialize)]
struct FrozenContext {
    prior_occupation: Vec<PriorOccupation>,
    archived_refusal: serde_json::Value,
}

fn frozen_site() -> (PlacementRequest, Surface, FrozenContext) {
    let bytes = include_bytes!("../tests/fixtures/initial-terrain-1050.json");
    let mut batch: PlanBatchRequest = serde_json::from_slice(bytes).unwrap();
    let context: FrozenContext = serde_json::from_slice(bytes).unwrap();
    assert_eq!(batch.requests.len(), 1);
    let mut r = batch.requests.remove(0);
    r.parcel_fit = batch.settings.as_ref().unwrap().parcel_fit;
    assert_eq!(r.parcel_fit, Some(true));
    let mut occupation = OccupationIndex::default();
    for prior in &context.prior_occupation {
        assert_ne!(prior.id, r.id);
        occupation.insert(unite(&prior.parts));
    }
    let occupied = occupation.local(&r.cadastral);
    (r, occupied, context)
}

#[test]
fn initial_terrain_1050_observes_real_refusal_then_one_global_recovery() {
    let (r, occupied, context) = frozen_site();
    let mut recovery = Recovery::new(&r, None, false);
    let original = plan_one_initial_sequence(&r, &occupied, None, false, &mut recovery);
    let original_error = original.err().expect("the frozen ordinary sequence must still refuse");
    assert_eq!(original_error, context.archived_refusal["message"].as_str().unwrap());
    assert_eq!(recovery.evaluations, 0, "ordinary paths perform no extra terrain evaluation");
    assert_eq!(recovery.constructions, 0);
    assert_eq!(recovery.admissions, 0);
    if recovery.witnesses.is_empty() {
        eprintln!("initial-terrain-1050: no compatible observed lower-front Single candidate; baseline refusal preserved: {original_error}");
        assert!(recovery.finish(&r, &occupied).is_none());
        return;
    }
    assert!(recovery.witnesses.len() <= 4);
    for witness in &recovery.witnesses {
    let original = &witness.resolved;
    let full_dimensions = witness.full_dimensions;
    let full_body = map_surface(&plan_domain(&original), &witness.full_pose);
    let (low, high, slope) = r.terrain.foundation_bounds(&full_body).unwrap();
    // The observed typed values came from this exact native physical guard.
    assert_eq!([low, high, slope], [witness.terrain.low, witness.terrain.high, witness.terrain.slope]);
    assert!(slope > MAX_LEVEL_FOUNDATION_SLOPE_DEG
        || high - low > r.terrain.max_foundation_step_m + 1e-8);
    assert!(contains(&difference(&r.buildable, &r.reserves), &full_body));
    eprintln!("initial-terrain-1050 native witness: order={} priority={:.9} {}::{} dimensions={full_dimensions:?} floors={} footprint={:?} pose={} terrain=[{low:.12},{high:.12},{slope:.12}] previous_occupation_area={:.9}",
        witness.order, witness.priority,
        original.recipe_id, original.parameters.variant_id, original.plan.bodies[0].levels.len(),
        bounds(&full_body), serde_json::to_string(&witness.full_pose).unwrap(), area(&occupied));
    }
    let result = recovery.finish(&r, &occupied);
    eprintln!("initial-terrain-1050 recovery: guide_evaluations={} constructions={} admissions={} reduced={:?} result={}",
        recovery.evaluations, recovery.constructions, recovery.admissions, recovery.reduced_dimensions,
        match &result { None => "no valid bounded reduction".into(), Some(Err(e)) => format!("native refusal: {e}"),
            Some(Ok(b)) => format!("native admitted area={:.9}", area(&b.footprint)) });
    assert!(recovery.evaluations <= 8 && recovery.constructions <= 1 && recovery.admissions <= 1);
    assert!(recovery.finish(&r, &occupied).is_none(), "the global fallback is not resettable");
    let Some(Ok(building)) = result else { return; };
    let witness = &recovery.witnesses[recovery.selected.unwrap()];
    let original = &witness.resolved;
    let full_body = map_surface(&plan_domain(original), &witness.full_pose);
    assert_eq!(recovery.constructions, 1);
    assert_eq!(recovery.admissions, 1);
    let retained = building.resolved.unpack().unwrap();
    assert_eq!(retained.recipe_id, original.recipe_id);
    assert_eq!(retained.parameters.variant_id, original.parameters.variant_id);
    assert_eq!(serde_json::to_vec(&retained.config).unwrap(), serde_json::to_vec(&original.config).unwrap());
    assert_eq!(retained.plan.bodies[0].levels.len(), original.plan.bodies[0].levels.len());
    assert_eq!(retained.plan.bodies[0].parameters.materials, original.plan.bodies[0].parameters.materials);
    assert_eq!(retained.plan.bodies[0].parameters.roof_system, original.plan.bodies[0].parameters.roof_system);
    assert!(area(&difference(&building.footprint, &full_body)) < 0.0001);
    let (low, high, slope) = r.terrain.foundation_bounds(&building.footprint).unwrap();
    assert!(high-low <= r.terrain.max_foundation_step_m+1e-8 && slope <= MAX_LEVEL_FOUNDATION_SLOPE_DEG);
    assert!(contains(&difference(&r.buildable, &r.reserves), &building.footprint));
    assert!(contains(&difference(r.roof_domain.as_ref().unwrap_or(&r.cadastral), &r.reserves), &building.roof_footprint));
    assert!(area(&intersection(&building.footprint, &occupied)) <= 0.0001);
    // Successful initial recovery skips post-admission growth. The usual final
    // native entrance preparation is still allowed to certify the same body.
    let finalized = retain_final_native_entry(&r, &occupied, building.clone());
    assert_eq!(finalized.footprint, building.footprint);
    let exterior = realize_plan(RealizePlanRequest { building: finalized.clone(), interiors: false });
    assert!(exterior.is_ok(), "{:?}", exterior.err());
    let interior = realize_plan(RealizePlanRequest { building: finalized, interiors: true });
    eprintln!("initial-terrain-1050 details: exterior=admitted interior={}",
        interior.err().unwrap_or_else(|| "admitted".into()));
}

#[test]
fn first_native_witness_minimum_refuses_then_later_native_witness_is_recovered() {
    use std::sync::Arc;
    let (mut r, _, _) = frozen_site();
    let mut config = r.config.clone().unwrap();
    config.recipe = Some("AS-ISL-B15".into());
    config.overrides.variant = Some("default".into());
    config.overrides.floors = Some(1);
    let resolved = resolve_urban_architecture(
        config, ArchitectureFunction::Domestic, [100., 100.], false,
        Some([8., 13.]), None, true,
    ).unwrap();
    assert_eq!(bounds(&resolved.plan.bodies[0].footprint), [0.,0.,8.,13.]);
    // A controlled raster, not a fabricated architecture: the left patch
    // concentrates its rise in the near 10m, the right patch is affine.
    // Full bodies fail (.9m and .949m); left minimum still fails (.82m),
    // whereas right minimum passes (.657m). The heuristic ranks left first.
    r.cadastral = rectangle(0.,0.,150.,20.);
    r.buildable = r.cadastral.clone(); r.roof_domain = Some(r.cadastral.clone());
    r.reserves.clear(); r.neighbors.clear(); r.terrain.water_z_m = None;
    r.terrain.max_foundation_step_m = 0.75;
    let mut elevations = Vec::new();
    for y in [0.,10.,20.] {
        for x in (0..=15).map(|v| v as f64 * 10.) {
            let blend = ((x-50.)/50.).clamp(0.,1.);
            let left = if y <= 10. { y*0.1 } else { 1.+(y-10.)*0.02 };
            let right = y*0.073;
            elevations.push(left*(1.-blend)+right*blend);
        }
    }
    r.terrain.grid = Some(GroundGrid { origin: point(0.,0.), step_m:10., width:16, height:3, elevations_m:elevations });
    let access = ArchitectureAccess { id:"controlled-street".into(), segment:[point(0.,0.),point(150.,0.)],kind:"public".into(),width_m:2. };
    r.accesses = vec![access.clone()];
    let prepared = PreparedPlan::new(&resolved);
    let mut recovery = Recovery::new(&r,None,false);
    let ticket = recovery.ticket(&r,&prepared).expect("plain actual B15 must be eligible");
    for x in [10.,110.,10.] {
        let pose = Transform { origin:point(x,2.), orientation_deg:0. };
        let mut typed = None;
        assert!(visual_with_front_access_prepared_reported(
            &r,&prepared,pose.clone(),&vec![],true,false,Some(&access),false,Some(&mut typed),
        ).is_err());
        recovery.observe(&r,&ticket,&pose,&access,typed.expect("real native physical refusal"));
    }
    assert_eq!(recovery.witnesses.len(),2,"duplicate pose must not consume a retained slot");
    assert_eq!(recovery.witnesses[0].order,0);
    assert!(Arc::ptr_eq(&recovery.witnesses[0].resolved,&recovery.witnesses[1].resolved));
    assert_eq!(recovery.evaluations,0);
    let building = recovery.finish(&r,&vec![]).expect("a reduced proposal must exist")
        .expect("later actual native witness must pass full admission");
    let selected = &recovery.witnesses[recovery.selected.unwrap()];
    assert_eq!(selected.order,1,"hostile first minimum must not end global recovery");
    assert_eq!(recovery.evaluations,8,"two refused endpoints then six evaluations on the later witness");
    assert_eq!((recovery.constructions,recovery.admissions),(1,1));
    assert_eq!(building.recipe_id,resolved.recipe_id);
    let full_world=map_surface(&body_domain(&resolved),&selected.full_pose);
    assert!(area(&difference(&building.footprint,&full_world))<0.0001);
    let (low,high,slope)=r.terrain.foundation_bounds(&building.footprint).unwrap();
    assert!(high-low<=0.75+1e-8 && slope<=MAX_LEVEL_FOUNDATION_SLOPE_DEG);
    assert!(contains(&r.buildable,&building.footprint));
    assert!(contains(r.roof_domain.as_ref().unwrap(),&building.roof_footprint));
    assert!(realize_plan(RealizePlanRequest { building, interiors:false }).is_ok());
    assert!(recovery.finish(&r,&vec![]).is_none());
}

#[test]
fn initial_terrain_recovery_excludes_explicit_and_protected_modes() {
    let (r, occupied, _) = frozen_site();
    let mut cases = vec![];
    let mut pinned = r.clone(); pinned.config.as_mut().unwrap().recipe = Some("AS-ISL-B14".into()); cases.push(pinned);
    let mut overridden = r.clone(); overridden.config.as_mut().unwrap().overrides.floors = Some(1); cases.push(overridden);
    let mut strict = r.clone(); strict.culture.mode = HistoricalMode::HistoricalStrict; cases.push(strict);
    let mut original_strict = r.clone(); original_strict.config.as_mut().unwrap().mode = HistoricalMode::HistoricalStrict; cases.push(original_strict);
    let mut other_pack = r.clone(); other_pack.config.as_mut().unwrap().pack = "EUR-MED".into(); cases.push(other_pack);
    let mut disabled = r.clone(); disabled.parcel_fit = Some(false); cases.push(disabled);
    for r in cases {
        let mut state = Recovery::new(&r, None, false);
        assert!(!state.enabled());
        assert!(state.finish(&r, &occupied).is_none());
        assert_eq!((state.evaluations, state.constructions, state.admissions), (0,0,0));
    }
    for (exact, target) in [(true, None), (false, Some(&r.buildable))] {
        let mut state = Recovery::new(&r, target, exact);
        assert!(!state.enabled());
        assert!(state.finish(&r, &occupied).is_none());
        assert_eq!((state.evaluations, state.constructions, state.admissions), (0,0,0));
    }
}
