//! Tests for the isolated V3 proposal. Original C requests and previous
//! occupations remain fixed; a passing observation test is not a recovery claim.
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
    archived_refusal: Option<serde_json::Value>,
    archived_plan: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct Fixture { cases: Vec<Case> }

fn fixture(label: &str) -> (Case, Surface) {
    let data: Fixture = serde_json::from_slice(include_bytes!(
        "../tests/fixtures/c-native-terrain-witness.json"
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
fn real_c6_native_roundoff_no_longer_prevents_existing_pose_observation() {
    let (case, occupied) = fixture("refusal");
    assert_eq!(case.index, 6);
    let r = &case.request;
    assert_eq!(r.programme.as_ref().unwrap().composition,
        Some(crate::programme::ProgrammeComposition::Compound));
    assert_eq!(r.programme.as_ref().unwrap().frontage_continuity, Some(0.5));
    let original_request = exact_json(r);
    let mut recovery = Recovery::new(r, None, false);
    assert!(recovery.enabled());
    let original = plan_one_initial_sequence(r, &occupied, None, false, &mut recovery);
    let refusal = original.err().expect("the original C sequence still refuses");
    assert_eq!(refusal, case.archived_refusal.as_ref().unwrap()["message"].as_str().unwrap());
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
        assert!(source_terrain_budget::supported(&witness.resolved, witness.full_dimensions));
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
    let Some(Ok(building)) = result else { return; };
    let selected = &recovery.witnesses[recovery.selected.unwrap()];
    let retained = building.resolved.unpack().unwrap();
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

#[test]
fn native_rectangle_roundoff_is_recognized_without_normalizing_real_geometry() {
    let (case, _) = fixture("refusal");
    let mut config = case.request.config.clone().unwrap();
    config.recipe = Some("AS-ISL-B14".into());
    config.overrides.variant = Some("default".into());
    let original = resolve_urban_architecture(
        config, ArchitectureFunction::Domestic, [50., 50.], false,
        Some([7.487990384609209, 10.697129120870303]), Some(0.25), true,
    ).unwrap();
    let body = &original.plan.bodies[0];
    let b = bounds(&body.footprint);
    let dimensions = [b[2]-b[0], b[3]-b[1]];
    assert_ne!([b[0],b[1]], [0.,0.], "exercise the actual native union roundoff");
    assert!(b[0].abs() < 1e-8 && b[1].abs() < 1e-8);
    let rectangle = crate::geometry::rectangle(0.,0.,dimensions[0],dimensions[1]);
    assert_eq!(area(&difference(&body.footprint,&rectangle)),0.);
    assert_eq!(area(&difference(&rectangle,&body.footprint)),0.);
    let before = exact_json(&original);
    assert!(source_terrain_budget::supported(&original,dimensions));
    assert_eq!(exact_json(&original),before,"classification never snaps or changes the retained architecture");
    eprintln!("C6 source rectangle actual union bounds={b:?}, two-sided boolean equality=0, retained bytes unchanged");

    let set_body = |c:&mut ResolvedArchitecture, surface:Surface| {
        let levels=c.plan.bodies[0].levels.len();
        c.plan.bodies[0].footprint=surface.clone();
        c.plan.bodies[0].levels=vec![surface;levels];
    };
    let mut moved=original.clone();
    let mut shifted=body.footprint.clone();
    for p in &mut shifted[0].outer { p.x+=GRID_M; }
    set_body(&mut moved,shifted);
    assert!(!source_terrain_budget::supported(&moved,dimensions),"one-millimetre real translation remains outside native-origin scope");
    let mut oblique=original.clone();
    let mut cut=body.footprint.clone();
    let corner=cut[0].outer.iter_mut().find(|p|p.x==b[0] && p.y==b[3]).unwrap();
    corner.x+=0.01;
    assert_eq!(bounds(&cut),b);
    assert_eq!(area(&difference(&cut,&rectangle)),0.);
    assert!(area(&difference(&rectangle,&cut))>0.001,"reverse check must reject a missing corner");
    set_body(&mut oblique,cut);
    assert!(!source_terrain_budget::supported(&oblique,dimensions));
    let mut holed=original.clone();
    let mut hole=body.footprint.clone();
    hole[0].holes.push(crate::geometry::rectangle(1.,1.,0.5,0.5)[0].outer.clone());
    set_body(&mut holed,hole);
    assert!(!source_terrain_budget::supported(&holed,dimensions));
    for dims in [[0.,dimensions[1]],[f64::NAN,dimensions[1]],[f64::INFINITY,dimensions[1]],
        [dimensions[0]+GRID_M,dimensions[1]]] {
        assert!(!source_terrain_budget::supported(&original,dims));
    }
    let mut nonfinite=original.clone();
    nonfinite.plan.bodies[0].footprint[0].outer[0].x=f64::NAN;
    assert!(!source_terrain_budget::supported(&nonfinite,dimensions));
}

#[test]
fn old_success_same_context_and_protected_modes_are_unchanged() {
    let (case,occupied)=fixture("success");
    let r=&case.request;
    assert!(case.archived_plan.is_some(),"an actual prior admitted C site is required");
    let mut disabled=Recovery::new(r,None,false); disabled.disable_for_test();
    let before=plan_one_initial_sequence(r,&occupied,None,false,&mut disabled).unwrap();
    let mut enabled=Recovery::new(r,None,false);
    let after=plan_one_initial_sequence(r,&occupied,None,false,&mut enabled).unwrap();
    assert_eq!(exact_json(&before),exact_json(&after),"same-reader native success, all fields and diagnostics");
    assert_eq!((enabled.evaluations,enabled.constructions,enabled.admissions),(0,0,0));
    let (normal,recovered)=plan_one_initial_with_terrain_recovery(r,&occupied,None,false).unwrap();
    assert!(!recovered);
    assert_eq!(exact_json(&normal),exact_json(&before));

    let mut protected=vec![];
    let mut pin=r.clone(); pin.config.as_mut().unwrap().recipe=Some("AS-ISL-B15".into()); protected.push(pin);
    let mut mode=r.clone(); mode.culture.mode=HistoricalMode::HistoricalStrict; protected.push(mode);
    let mut config_mode=r.clone(); config_mode.config.as_mut().unwrap().mode=HistoricalMode::HistoricalStrict; protected.push(config_mode);
    let mut floors=r.clone(); floors.config.as_mut().unwrap().overrides.floors=Some(1); protected.push(floors);
    let mut parcel=r.clone(); parcel.parcel_fit=Some(false); protected.push(parcel);
    for p in protected {
        let mut state=Recovery::new(&p,None,false);
        assert!(!state.enabled());
        assert!(state.finish(&p,&occupied).is_none());
        assert_eq!((state.evaluations,state.constructions,state.admissions),(0,0,0));
    }
    assert!(!Recovery::new(r,None,true).enabled());
    assert!(!Recovery::new(r,Some(&r.buildable),false).enabled());
}

#[test]
fn declared_access_is_bounded_deterministic_and_not_a_certificate() {
    let (case,_)=fixture("refusal");
    let mut r=case.request;
    let pose=Transform{origin:point(0.,0.),orientation_deg:0.};
    let dims=[8.,13.];
    let access=|id:&str,y:f64,kind:&str| ArchitectureAccess {
        id:id.into(),segment:[point(0.,y),point(8.,y)],kind:kind.into(),width_m:0.8,
    };
    r.accesses=vec![access("duplicate",-6.,"public"),access("duplicate",-2.,"private"),
        access("closest-but-unserved",-1.,"unserved"),access("wrong-side",1.,"public")];
    let chosen=declared_lower_access(&r,dims,&pose).unwrap();
    assert_eq!(chosen.segment,r.accesses[1].segment,"duplicate ID never substitutes for exact segment");
    r.accesses[1].segment.reverse();
    let chosen=declared_lower_access(&r,dims,&pose).unwrap();
    assert_eq!(chosen.segment,r.accesses[1].segment,"endpoint order does not change chosen front");
    r.accesses=vec![access("wrong-side",1.,"public"),access("unserved",-1.,"unserved")];
    assert!(declared_lower_access(&r,dims,&pose).is_none());
    r.accesses=vec![access("invalid",-1.,"unserved");64];
    r.accesses.push(access("beyond-bound",-1.,"public"));
    assert!(declared_lower_access(&r,dims,&pose).is_none(),"first64 declared records bound work");
    r.accesses=vec![access("b",-2.,"public"),access("a",-2.,"public")];
    assert_eq!(declared_lower_access(&r,dims,&pose).unwrap().id,"a");
    // Selecting a declared lower front performs no connection admission.
    // A reserved site still refuses in the ordinary native guard.
    r.reserves=r.cadastral.clone();
    assert!(plan_one(&r,&vec![],None,false).is_err());
}
