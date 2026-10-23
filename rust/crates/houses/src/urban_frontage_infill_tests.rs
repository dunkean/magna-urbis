use super::*;

#[test]
fn absent_infill_permission_keeps_legacy_default_and_parameter_bytes() {
    let data = crate::catalogue::catalogue().unwrap();
    let source = &data.recipes.iter().find(|r| r.id == "EUR-MED-B02").unwrap().parameters;
    let legacy = serde_json::to_string(source).unwrap();
    assert!(!legacy.contains("urban_frontage_infill"));
    let mut restored: Parameters = serde_json::from_str(&legacy).unwrap();
    assert!(restored.urban_frontage_infill);
    assert_eq!(serde_json::to_string(&restored).unwrap(), legacy);

    restored.urban_frontage_infill = false;
    let disabled = serde_json::to_string(&restored).unwrap();
    assert_eq!(
        disabled.replace("\"urban_frontage_infill\":false,", ""),
        legacy,
        "the declared false flag is the only new serialized parameter field"
    );
    assert!(!serde_json::from_str::<Parameters>(&disabled).unwrap().urban_frontage_infill);
    let explicit_true: Parameters = serde_json::from_str(
        &disabled.replace("\"urban_frontage_infill\":false", "\"urban_frontage_infill\":true")
    ).unwrap();
    assert!(explicit_true.urban_frontage_infill);
    assert_eq!(serde_json::to_string(&explicit_true).unwrap(), legacy);
}

#[test]
fn disabled_infill_preserves_native_strip_court_passage_and_scalar_area() {
    let data = crate::catalogue::catalogue().unwrap();
    let recipe = data.recipes.iter().find(|r| r.id == "EUR-MED-B02").unwrap();
    let mut p = recipe.parameters.clone();
    p.width_m = [8.5; 2];
    p.depth_m = [20.0; 2];
    p.floors = [1; 2];
    p.rooms_per_body = [1; 2];
    p.urban_frontage_infill = false;
    let mut plan = build_layout(recipe, &p, "native-infill").unwrap();
    assert_eq!(plan.bodies.len(), 1);
    assert!(area(&plan.courts) > 0.0 && area(&plan.paths) > 0.0);
    let native = serde_json::to_vec(&plan).unwrap();
    assert!(!urban_frontage_infill_enabled(&p, 0.93));
    urban_frontage_infill(&mut plan, &p, 0.93, "native-infill");
    assert_eq!(serde_json::to_vec(&plan).unwrap(), native);

    // At these dimensions the legacy permission really does add at least
    // one side wing, so the false branch is not merely a threshold no-op.
    p.urban_frontage_infill = true;
    let mut enabled = build_layout(recipe, &p, "native-infill").unwrap();
    assert!(urban_frontage_infill_enabled(&p, 0.93));
    urban_frontage_infill(&mut enabled, &p, 0.93, "native-infill");
    assert!(enabled.bodies.len() > 1);
    assert_eq!(enabled.bodies[0].footprint, plan.bodies[0].footprint);
    assert!(area(&enabled.courts) < area(&plan.courts));
}

// Frozen decisions from the former inline operator: this checks RNG draw
// ordering, branch thresholds and exact boolean/snapped surfaces together.
fn previous_parts(width_m: f64, depth_m: f64, coverage: f64, seed: &str) -> Vec<Surface> {
    if coverage < 0.66 {
        return vec![];
    }
    let w = width_m - 1.25;
    let rear = depth_m * 0.25;
    let mut rng = Rng::new(seed).fork("urban-burgage-infill");
    let mut additions = vec![];
    if w >= 4.0 && rear >= 2.2 {
        let wing = snap((w * rng.range(0.44, 0.56)).clamp(2.2, w - 1.8));
        additions.push(rectangle(0., 0., wing, rear));
    }
    if coverage >= 0.84 && rear >= 4.0 && rng.chance(0.7) {
        let depth = snap((rear * rng.range(0.4, 0.55)).clamp(2.2, rear - 1.8));
        let used = unite(&additions);
        let back = difference(&rectangle(0., 0., w, depth), &used);
        if area(&back) >= 4.0 {
            additions.push(back);
        }
    }
    additions
}

#[test]
fn shared_infill_parts_preserve_native_thresholds_draws_and_area() {
    let data = crate::catalogue::catalogue().unwrap();
    let source = &data
        .recipes
        .iter()
        .find(|r| r.id == "EUR-MED-B02")
        .unwrap()
        .parameters;
    let mut saw_empty = false;
    let mut saw_one = false;
    let mut saw_two = false;
    let mut largest_union_error = (0.0_f64, String::new());
    let mut largest_scalar_error = (0.0_f64, String::new());
    for (width, depth, coverage) in [
        (5.249, 8.8, 0.66),
        (5.25, 8.799, 0.66),
        (5.25, 8.8, 0.659999),
        (5.25, 8.8, 0.66),
        (8.5, 15.999, 0.84),
        (8.5, 16., 0.839999),
        (8.5, 16., 0.84),
        (8.5, 20., 0.93),
        (5.25, 16.088, 0.93),
        (5.25, 16.092, 0.93),
        // No side wing: the rear chance must remain the first RNG draw.
        (4.5, 20., 0.93),
    ] {
        for seed in ["0", "1", "2", "native-infill"] {
            let expected = previous_parts(width, depth, coverage, seed);
            let actual = urban_frontage_infill_parts(width, depth, coverage, seed);
            assert_eq!(actual, expected, "{width}/{depth}/{coverage}/{seed}");
            saw_empty |= actual.is_empty();
            saw_one |= actual.len() == 1;
            saw_two |= actual.len() == 2;
            let sum: f64 = actual.iter().map(area).sum();
            let union_area = area(&unite(&actual));
            let scalar = UrbanFrontageInfillDraws::new(seed).added_area_m2(width, depth, coverage);
            for (delta, largest) in [
                ((sum - union_area).abs(), &mut largest_union_error),
                ((sum - scalar).abs(), &mut largest_scalar_error),
            ] {
                if delta > largest.0 {
                    *largest = (delta, format!(
                        "{width}/{depth}/{coverage}/{seed}: sum={sum:.15}, union={union_area:.15}, scalar={scalar:.15}, parts={actual:?}"
                    ));
                }
            }

            let mut p = source.clone();
            p.width_m.fill(width);
            p.depth_m.fill(depth);
            let w = width - 1.25;
            let rear = depth * 0.25;
            let initial_body = rectangle(0., rear, w, depth - rear);
            let mut plan = LayoutPlan {
                lot: rectangle(-1., -1., width + 2., depth + 2.),
                courts: rectangle(0., 0., width, rear),
                paths: rectangle(w, 0., 1.25, depth),
                bodies: vec![spec(initial_body.clone(), &p, Role::Dwelling)],
                features: vec![],
                context: vec![],
                diagnostics: vec![],
            };
            let mut expected_court = plan.courts.clone();
            let mut expected_paths = plan.paths.clone();
            for part in &expected {
                expected_court = difference(&expected_court, part);
                expected_paths = difference(&expected_paths, part);
            }
            urban_frontage_infill(&mut plan, &p, coverage, seed);
            assert_eq!(plan.bodies.len(), 1 + expected.len());
            assert_eq!(plan.bodies[0].footprint, initial_body);
            assert_eq!(plan.courts, expected_court);
            assert_eq!(plan.paths, expected_paths);
            for (body, part) in plan.bodies.iter().skip(1).zip(expected) {
                assert_eq!(body.footprint, part);
            }
        }
    }
    // geo/i_overlay requantizes coordinates through its integer adapter even
    // for union(empty, rectangle). The 44 native cases measured <=1.76e-8 m2
    // area drift; allow one square millimetre, the native grid's area unit.
    // Geometry/RNG equivalence with the frozen operator stays exact above.
    let area_tolerance = GRID_M * GRID_M;
    assert!(
        largest_union_error.0 < area_tolerance && largest_scalar_error.0 < area_tolerance,
        "max union error {:.15}: {}; max scalar error {:.15}: {}",
        largest_union_error.0, largest_union_error.1,
        largest_scalar_error.0, largest_scalar_error.1,
    );
    assert!(saw_empty && saw_one && saw_two);
    let mut arcade = source.clone();
    arcade.details.push("arcade".into());
    assert!(!urban_frontage_infill_enabled(&arcade, 0.93));
    arcade.details.clear();
    arcade.layout = Layout::Single;
    assert!(!urban_frontage_infill_enabled(&arcade, 0.93));
}
