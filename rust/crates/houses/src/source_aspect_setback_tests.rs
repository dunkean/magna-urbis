//! Native budget checks for the bounded source-aspect setback.
//! No archived plan, old pose, or parcel-specific branch in the operator.
use super::*;

fn request() -> PlacementRequest {
    let mut batch: PlanBatchRequest = serde_json::from_str(include_str!(
        "../tests/fixtures/source-aspect-setback-cbfa.json"
    ))
    .unwrap();
    batch.requests.remove(0)
}

fn budget_counts(trace: &str) -> (usize, usize) {
    let pairs = trace
        .split("/8 dimension pairs")
        .next()
        .unwrap()
        .rsplit("; ")
        .next()
        .unwrap()
        .parse()
        .unwrap();
    let poses = trace
        .split("/24 rigid poses")
        .next()
        .unwrap()
        .rsplit(", ")
        .next()
        .unwrap()
        .parse()
        .unwrap();
    (pairs, poses)
}

#[test]
fn current_cbfa_source_aspect_slot_proposes_one_setback_and_replays_exterior() {
    let r = request();
    let initial = plan_one_initial(&r, &vec![], None, false).unwrap();
    let original = initial.resolved.unpack().unwrap();
    let before = area(&initial.footprint);
    let target = r.programme.as_ref().unwrap().built_area_m2.unwrap();
    let result = improve_domestic_budget(&r, &vec![], initial, target);
    let retained = result.resolved.unpack().unwrap();
    let actual = area(&result.footprint);
    let trace = result
        .diagnostics
        .iter()
        .find(|d| d.starts_with("Domestic footprint budget:"))
        .unwrap();
    let setback = result
        .diagnostics
        .iter()
        .find(|d| d.starts_with("Source aspect setback:"))
        .unwrap();
    let (pairs, poses) = budget_counts(trace);
    eprintln!(
        "current cbfa setback: before={before:.9} actual={actual:.9} target={target}; {trace}; {setback}; pose={}",
        serde_json::to_string(&result.transform).unwrap()
    );
    // Preserve the measured causal improvement from the actual pipeline.
    // Native site/roof/access refusals must remain visible.
    assert!(
        actual > before + 20.,
        "the native pipeline must recover area, not just the offline LP"
    );
    assert!(setback.contains("1/1 proposal admitted"));
    assert!(pairs <= 8 && poses <= 24);
    assert_eq!(retained.recipe_id, original.recipe_id);
    assert_eq!(
        retained.parameters.variant_id,
        original.parameters.variant_id
    );
    assert_eq!(
        serde_json::to_vec(&retained.config).unwrap(),
        serde_json::to_vec(&original.config).unwrap()
    );
    assert_eq!(
        retained.plan.bodies[0].levels.len(),
        original.plan.bodies[0].levels.len()
    );
    assert_eq!(
        retained.plan.bodies[0].parameters.materials,
        original.plan.bodies[0].parameters.materials
    );
    assert_eq!(
        retained.plan.bodies[0].parameters.roof_system,
        original.plan.bodies[0].parameters.roof_system
    );
    let b = bounds(&retained.plan.bodies[0].footprint);
    let dims = [snap(b[2] - b[0]), snap(b[3] - b[1])];
    let source = &catalogue()
        .unwrap()
        .recipes
        .iter()
        .find(|c| c.id == original.recipe_id)
        .unwrap()
        .parameters;
    let aspect =
        source_aspect_budget::SourceAspectBudget::new(source.width_m, source.depth_m).unwrap();
    assert!(aspect.contains(
        dims,
        [
            [source.width_m[0], source.width_m[1] * 2.],
            [source.depth_m[0], source.depth_m[1] * 2.]
        ]
    ));
    assert!(contains(&r.buildable, &result.footprint));
    assert!(contains(
        r.roof_domain.as_ref().unwrap_or(&r.cadastral),
        &result.roof_footprint
    ));
    assert!(contains(&r.cadastral, &result.circulation));
    let (lo, hi, slope) = r.terrain.foundation_bounds(&result.footprint).unwrap();
    assert!(
        hi - lo <= r.terrain.max_foundation_step_m + 1e-8
            && slope <= MAX_LEVEL_FOUNDATION_SLOPE_DEG
    );
    realize_plan(RealizePlanRequest {
        building: result.clone(),
        interiors: false,
    })
    .expect("the actual native RF-STEEP-STEP exterior must still replay");
    // The geometry proposal does not certify a structural doorway. Record the
    // independent interior result; a failure is an open requirement, not an
    // invitation to remove the retained-entrance guard or invent a portal.
    let interior = realize_plan(RealizePlanRequest {
        building: result,
        interiors: true,
    });
    eprintln!(
        "cbfa setback interior (separate pending certificate): {}",
        match interior {
            Ok(_) => "accepted".to_owned(),
            Err(reason) => format!("refused: {reason}"),
        }
    );
}

#[test]
fn setback_has_no_private_or_disconnected_rights_fallback() {
    let mut r = request();
    let initial = plan_one_initial(&r, &vec![], None, false).unwrap();
    let resolved = initial.resolved.unpack().unwrap();
    let prepared = PreparedPlan::new(&resolved);
    let mut access = r.accesses[0].clone();
    access.kind = "private".into();
    assert!(source_aspect_setback::propose(&r, &prepared, &access, &vec![], 0.).is_err());
    access.kind = "public".into();
    let original_rights = r.buildable.clone();
    let b = bounds(&original_rights);
    let separated = map_surface(
        &original_rights,
        &Transform {
            origin: Point {
                x: 2. * (b[2] - b[0]),
                y: 0.,
            },
            orientation_deg: 0.,
        },
    );
    assert!(bounds(&separated)[0] > b[2]);
    assert_eq!(area(&intersection(&original_rights, &separated)), 0.);
    r.buildable.extend(separated);
    assert_eq!(difference(&r.buildable, &vec![]).len(), 2);
    assert!(source_aspect_setback::propose(&r, &prepared, &access, &vec![], 0.).is_err());
    // The public helper cannot bypass explicit choices: routing is additionally
    // conditional on SourceAspectBudget, whose protected modes remain excluded.
    let mut pinned = request();
    let mut config = resolved.config.clone();
    config.recipe = Some(resolved.recipe_id.clone());
    pinned.config = Some(config);
    let source = &catalogue()
        .unwrap()
        .recipes
        .iter()
        .find(|c| c.id == resolved.recipe_id)
        .unwrap()
        .parameters;
    assert!(
        source_aspect_budget::SourceAspectBudget::for_candidate(&pinned, &resolved, source)
            .is_none()
    );
}
