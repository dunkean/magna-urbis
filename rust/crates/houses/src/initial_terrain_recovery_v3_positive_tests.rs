//! Positive C342 test with all prior occupations from its experimental batch.
//! The ordinary sequence and recovery are compared at this same context.
use super::*;
use super::initial_terrain_recovery::{Recovery, declared_lower_access};

#[derive(Deserialize)]
struct PriorOccupation { id: String, parts: Vec<Surface> }

#[derive(Deserialize)]
struct Case {
    label: String,
    index: usize,
    request: PlacementRequest,
    prior_occupation: Vec<PriorOccupation>,
    archived_plan: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct Fixture { cases: Vec<Case> }

fn fixture(label: &str) -> (Case, Surface) {
    let data: Fixture = serde_json::from_slice(include_bytes!(
        "../tests/fixtures/c-native-terrain-positive342.json"
    )).unwrap();
    let case = data.cases.into_iter().find(|c| c.label == label).unwrap();
    // No house settings were supplied by this producer. Do not invent a
    // parcel_fit override when replaying its actual request.
    assert_eq!(case.request.parcel_fit, None);
    let mut index = OccupationIndex::default();
    for previous in &case.prior_occupation {
        assert_ne!(previous.id, case.request.id);
        index.insert(unite(&previous.parts));
    }
    let occupied = index.local(&case.request.cadastral);
    (case, occupied)
}

fn exact_json<T: Serialize>(value: &T) -> Vec<u8> {
    serde_json::to_vec(value).unwrap()
}

#[test]
fn real_c342_compound_existing_native_pose_recovers_with_experimental_occupation() {
    let (case, occupied) = fixture("positive");
    let r = &case.request;
    assert_eq!(r.programme.as_ref().unwrap().composition,
        Some(crate::programme::ProgrammeComposition::Compound));
    assert_eq!(r.programme.as_ref().unwrap().frontage_continuity, Some(0.5));
    assert_eq!(case.index, 342);
    assert_eq!(case.prior_occupation.len(), 22);
    assert!(case.archived_plan.is_some());
    let original_request = exact_json(r);
    let mut disabled = Recovery::new(r, None, false);
    disabled.disable_for_test();
    let original_disabled = plan_one_initial_sequence(r, &occupied, None, false, &mut disabled)
        .err().expect("the ordinary sequence must refuse in the experimental occupation context");
    let mut recovery = Recovery::new(r, None, false);
    assert!(recovery.enabled());
    let original = plan_one_initial_sequence(r, &occupied, None, false, &mut recovery);
    let refusal = original.err().expect("the original C sequence still refuses");
    assert_eq!(refusal, original_disabled, "collecting witnesses does not change ordinary admission/refusal");
    assert_eq!((recovery.evaluations, recovery.constructions, recovery.admissions), (0,0,0));
    assert!(!recovery.witnesses.is_empty(),
        "C index {}: no eligible already-tried native lower-front witness; no recovery demonstrated", case.index);
    assert!(recovery.witnesses.len() <= 4);

    let neighbors = unite(&r.neighbors.iter().map(|n| n.footprint.clone())
        .chain(std::iter::once(occupied.clone())).collect::<Vec<_>>());
    let domain = difference(&difference(&r.buildable, &r.reserves), &neighbors);
    let base = frame(r, &domain);
    let local = map_surface(&domain, &inverse(&base));
    let size = bounds(&local);
    let spans = [size[2]-size[0]-0.8, size[3]-size[1]-0.8];
    for witness in &recovery.witnesses {
        let prepared = PreparedPlan::new(&witness.resolved);
        let b = bounds(&prepared.plan_local);
        let existing: Vec<_> = [0.5,0.1,0.9].into_iter().map(|align| Transform {
            origin: transform_point(Point {
                x: size[0]+(spans[0]+0.8-(b[2]-b[0]))*0.5-b[0],
                y: size[1]+(spans[1]+0.8-(b[3]-b[1]))*align-b[1],
            }, &base),
            orientation_deg: base.orientation_deg,
        }).collect();
        assert!(existing.contains(&witness.full_pose), "no generated frontage pose may enter this compound fixture");
        assert_eq!(witness.resolved.config.seed, r.seed);
        let full = map_surface(&prepared.plan_local, &witness.full_pose);
        let (low, high, slope) = r.terrain.foundation_bounds(&full).unwrap();
        assert_eq!([low,high,slope], [witness.terrain.low,witness.terrain.high,witness.terrain.slope]);
        assert!(high-low > r.terrain.max_foundation_step_m+1e-8 || slope > MAX_LEVEL_FOUNDATION_SLOPE_DEG);
        let access = declared_lower_access(r,witness.full_dimensions,&witness.full_pose).unwrap();
        assert_eq!(access.id,witness.access.id);
        assert_eq!(access.segment,witness.access.segment);
        eprintln!("C V3 witness {} {}::{} {:?} pose={} step={:.12} slope={:.12} declared-access={} (unvalidated)",
            case.index,witness.resolved.recipe_id,witness.resolved.parameters.variant_id,
            witness.full_dimensions,serde_json::to_string(&witness.full_pose).unwrap(),high-low,slope,access.id);
    }
    let result = recovery.finish(r,&occupied);
    eprintln!("C V3 result index={} guide={}/8 constructions={}/1 admissions={}/1 result={}",
        case.index,recovery.evaluations,recovery.constructions,recovery.admissions,
        match &result { None=>"no bounded proposal".into(),Some(Err(e))=>format!("native refusal: {e}"),
            Some(Ok(b))=>format!("admitted {} area={:.9}",b.recipe_id,area(&b.footprint)) });
    assert!(recovery.evaluations<=8 && recovery.constructions<=1 && recovery.admissions<=1);
    assert!(recovery.finish(r,&occupied).is_none());
    assert_eq!(exact_json(r),original_request);
    let building = result.expect("C342 must produce a bounded reduction")
        .expect("C342 must pass the complete native admission, not only the terrain guide");
    assert_eq!((recovery.constructions, recovery.admissions), (1,1));
    let selected = &recovery.witnesses[recovery.selected.unwrap()];
    let retained = building.resolved.unpack().unwrap();
    assert_eq!(building.recipe_id, case.archived_plan.as_ref().unwrap()["recipe_id"].as_str().unwrap());
    assert_eq!(retained.plan.bodies[0].levels.len(), selected.resolved.plan.bodies[0].levels.len());
    assert_eq!(retained.plan.bodies[0].parameters.materials, selected.resolved.plan.bodies[0].parameters.materials);
    assert_eq!(retained.plan.bodies[0].parameters.roof_system, selected.resolved.plan.bodies[0].parameters.roof_system);
    assert_eq!(retained.recipe_id, selected.resolved.recipe_id);
    assert_eq!(retained.parameters.variant_id, selected.resolved.parameters.variant_id);
    assert_eq!(exact_json(&retained.config),exact_json(&selected.resolved.config));
    assert_eq!(building.transform.orientation_deg,selected.full_pose.orientation_deg);
    let old_front = transform_point(Point{x:selected.full_dimensions[0]*0.5,y:0.},&selected.full_pose);
    let new_bounds = bounds(&retained.plan.bodies[0].footprint);
    let new_front = transform_point(Point{x:(new_bounds[0]+new_bounds[2])*0.5,y:new_bounds[1]},&building.transform);
    assert!(libm::hypot(old_front.x-new_front.x,old_front.y-new_front.y)<1e-8);
    let full_body = map_surface(&body_domain(&selected.resolved),&selected.full_pose);
    assert!(area(&difference(&building.footprint,&full_body))<0.0001);
    assert!(contains(&difference(&r.buildable,&r.reserves),&building.footprint));
    assert!(contains(&difference(r.roof_domain.as_ref().unwrap_or(&r.cadastral),&r.reserves),&building.roof_footprint));
    let mut parts=vec![building.footprint.clone(),building.courtyards.clone(),building.circulation.clone()];
    parts.extend(building.structural_features.iter().map(|f|f.surface.clone()));
    assert!(area(&intersection(&unite(&parts),&neighbors))<=0.0001);
    let finalized = retain_final_native_entry(r,&occupied,building);
    let exterior = realize_plan(RealizePlanRequest{building:finalized.clone(),interiors:false});
    assert!(exterior.is_ok(),"{:?}",exterior.err());
    let interior = realize_plan(RealizePlanRequest{building:finalized,interiors:true});
    eprintln!("C V3 detail: exterior admitted; interior={}",interior.err().unwrap_or_else(||"admitted".into()));
}
