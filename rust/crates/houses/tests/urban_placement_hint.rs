use magna_urbis_houses::geometry::{difference, rectangle};
use magna_urbis_houses::placement::{admissibility_profiles, place_batch};

#[test]
fn real_courtyard_parcels_reproduce_the_native_minimum_witness() {
    let mut request: magna_urbis_houses::placement::PlacementBatchRequest = serde_json::from_str(
        include_str!("../fixtures/urban-placement-courtyard-witness.json"),
    )
    .unwrap();
    let two_storey = request.clone();
    for r in &mut request.requests {
        r.config.as_mut().unwrap().overrides.floors = Some(1);
    }
    let result = place_batch(request).unwrap();
    assert_eq!(
        result.buildings.len(),
        2,
        "One-storey witnesses: {:?}",
        result.refusals
    );
    for b in result.buildings {
        assert!(b.resolved.config.overrides.variant.as_deref() == Some("default"));
    }
    let result = place_batch(two_storey).unwrap();
    // The table certifies one storey, not the longer two-storey circulation.
    // Among the eight minimum candidates that retain bodies, courts and roofs,
    // lot 1 has one connector crossing a real native wall and seven circulation
    // surfaces leaving cadastral land; lot 2 has three and five respectively.
    // The former 1/2 expectation predates checks against the actual site gate.
    assert!(
        result.buildings.is_empty(),
        "{} unexpected accepted buildings",
        result.buildings.len()
    );
    assert_eq!(result.refusals.len(), 2);
    for refusal in result.refusals {
        assert_eq!(refusal.code, "entrance_blocked", "{refusal:?}");
    }
}

#[test]
fn minimum_courtyard_witness_is_used_without_clipping_or_accepting_a_stale_hint() {
    let profile = admissibility_profiles()
        .unwrap()
        .into_iter()
        .find(|p| p.recipe_id == "AF-MAG-B02")
        .unwrap();
    let [width, depth] = profile.minimum_domain_m;
    let cadastral = rectangle(0., 0., width + 0.6, depth + 0.6);
    let hint = rectangle(0.3, 0.3, width, depth);
    let mut request = serde_json::json!({
    "schema_version":"1", "requests":[{
        "id":"witness-house", "parcel_id":"witness-land",
        "cadastral":cadastral, "buildable":cadastral, "reserves":[],
        "placement_hint":hint,
        "accesses":[{"id":"street", "segment":[{"x":0.,"y":depth+0.6},{"x":width+0.6,"y":depth+0.6}],"kind":"public","width_m":2.}],
        "party_boundaries":[],"neighbors":[],
            "culture":{"culture":"medina","pack":"AF-MAG","mode":"historical_inspired","borrowing":null},
        "function":"domestic","seed":"native-minimum-witness-v1",
        "terrain":{"origin":{"x":0.,"y":0.},"ground_z_m":143.,"gradient":[0.,0.],"water_z_m":null,"max_foundation_step_m":0.8},
        "config":{"pack":"AF-MAG","recipe":"AF-MAG-B02"}
    }]});
    let result = place_batch(serde_json::from_value(request.clone()).unwrap()).unwrap();
    assert_eq!(result.buildings.len(), 1, "{:?}", result.refusals);
    assert!(result.refusals.is_empty());
    let hole = rectangle(width * 0.5 - 3., depth * 0.5 - 3., 6., 6.);
    let invalid = difference(&cadastral, &hole);
    request["requests"][0]["cadastral"] = serde_json::to_value(&invalid).unwrap();
    request["requests"][0]["buildable"] = serde_json::to_value(&invalid).unwrap();
    let result = place_batch(serde_json::from_value(request).unwrap()).unwrap();
    assert!(
        result.buildings.is_empty(),
        "An old witness cannot erase a new cadastral hole."
    );
    assert_eq!(result.refusals.len(), 1);
    assert!(result.refusals[0].attempts <= 108);
}
