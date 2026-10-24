use super::*;

#[test]
fn programme_functions_capability_announces_consumed_native_weights() {
    let sessions = Mutex::new(Sessions::default());
    let status: Value = decode(&dispatch("/status", b"", &sessions).unwrap().body).unwrap();
    assert!(status["capabilities"].as_array().unwrap().contains(&json!("urban.programme-functions-v1")));
    let context: urban::programme::ProgrammeContext = serde_json::from_value(json!({"functions":{"capital":1.0,"port":0.5,"artisan":1.0}})).unwrap();
    assert_eq!(context.functions.unwrap().port, 0.5);
    assert_eq!(urban::programme::PROGRAMME_FUNCTIONS_VERSION, 1);
    let misplaced = serde_json::to_vec(&json!({"kind":"parcels","layoutConfig":{"programme":{"functions":{}}}})).unwrap();
    assert!(dispatch("/urban", &misplaced, &sessions).err().unwrap().contains("régénérant les quartiers"));
}

fn same_json(left: &Value, right: &Value, path: &str) {
    match (left, right) {
        (Value::Object(a), Value::Object(b)) => {
            assert_eq!(a.len(), b.len(), "{path}");
            for (key, value) in a {
                same_json(
                    value,
                    b.get(key).expect("missing object key"),
                    &format!("{path}.{key}"),
                );
            }
        }
        (Value::Array(a), Value::Array(b)) => {
            assert_eq!(a.len(), b.len(), "{path}");
            for (index, (a, b)) in a.iter().zip(b).enumerate() {
                same_json(a, b, &format!("{path}[{index}]"));
            }
        }
        _ => assert_eq!(left, right, "{path}"),
    }
}

fn raster_bytes(session: &str) -> Vec<u8> {
    let header = serde_json::to_vec(&json!({ "session": session, "width": 512, "n": 16 })).unwrap();
    let mut body = (header.len() as u32).to_le_bytes().to_vec();
    body.extend(header);
    for value in [1.0_f32, 0.0, 0.0] {
        for _ in 0..256 {
            body.extend(value.to_le_bytes());
        }
    }
    for _ in 0..256 {
        body.extend((-1_i32).to_le_bytes());
    }
    body.extend([0_u8; 256]);
    body
}

#[test]
fn retained_source_routes_share_geometry_validate_keys_and_expire_before_replacement() {
    let sessions = Mutex::new(Sessions::default());
    dispatch("/raster", &raster_bytes("urban-owner"), &sessions).unwrap();
    let status: Value = decode(&dispatch("/status", b"", &sessions).unwrap().body).unwrap();
    assert!(
        status["capabilities"]
            .as_array()
            .unwrap()
            .contains(&json!("urban.retained-source"))
    );
    // Two translated versions of the native cadastral test's street-fronting
    // 100x40 m block, with fractional coordinates exercising the wire boundary.
    let raw_layouts = ["a", "b"]
        .iter()
        .enumerate()
        .map(|(index, key)| {
            let x = 40.123456789012344 + index as f64 * 180.0;
            let y = 60.09876543210987;
            json!({
                "key": key, "culture": "european-organic", "center": {"x":x+50.0,"y":y+20.0},
                "quarters": [], "warnings": [],
                "blocks": [{"shape":{"outer":[{"x":x,"y":y},{"x":x+100.0,"y":y},
                    {"x":x+100.0,"y":y+40.0},{"x":x,"y":y+40.0}],"holes":[]},
                    "quarter":0,"kind":"block","axis":{"x":1.0,"y":0.0},"zone":"core"}],
                "streets":[{"path":[{"x":x-3.0,"y":y-3.0},{"x":x+103.0,"y":y-3.0}],
                    "widths":[6.0,6.0],"rank":1,"role":"street"}]
            })
        })
        .collect::<Vec<_>>();
    let mut prepared: Vec<urban::Layout> = value(&json!(raw_layouts)).unwrap();
    for layout in &mut prepared {
        urban::programme::prepare(
            layout,
            120,
            &urban::ProgrammeContext::default(),
            urban::Surface {
                geometry: None,
                width: 512.0,
                n: 16,
                height: &[1.0; 256],
                water: &[0; 256],
            },
        )
        .unwrap();
    }
    let raw_layouts = serde_json::to_value(prepared).unwrap();
    // Match quarters' existing decimal-normalized layoutsId cache.
    let layouts: Arc<Vec<urban::Layout>> =
        Arc::new(decode(&serde_json::to_vec(&raw_layouts).unwrap()).unwrap());
    let owner = sessions.lock().unwrap().existing("urban-owner").unwrap();
    {
        let mut state = owner.lock().unwrap();
        state.layouts = Some((7, Arc::clone(&layouts)));
        state.urban.retain_layouts(Arc::clone(&layouts)).unwrap();
    }
    let call = |input: Value| -> ApiResult<Value> {
        decode(&dispatch("/urban", &serde_json::to_vec(&input).unwrap(), &sessions)?.body)
    };
    let reply = call(
        json!({"session":"urban-owner","id":8,"kind":"parcels","seed":"retained-test",
        "layoutsId":7,"parcelConfig":{}}),
    )
    .unwrap();
    let source: UrbanSourceHandle = value(&reply["urbanSource"]).unwrap();
    {
        let state = owner.lock().unwrap();
        let snapshot = state.urban.validate_source("urban-owner", &source).unwrap();
        assert!(Arc::ptr_eq(snapshot.layouts, &layouts));
        assert_eq!(
            selected_partition_indices(
                snapshot.layouts,
                snapshot.partitions,
                &["b".into(), "a".into()]
            )
            .unwrap(),
            vec![0, 1]
        );
        same_json(
            &serde_json::to_value(snapshot.partitions.as_ref()).unwrap(),
            &reply["partitions"],
            "retained partitions",
        );
    }
    let binary_read = json!({"kind":"displayBuffers","source":source,"ids":true});
    let binary = dispatch(
        "/urban",
        &serde_json::to_vec(&binary_read).unwrap(),
        &sessions,
    )
    .unwrap();
    assert_eq!(binary.kind, "application/octet-stream");
    {
        let state = owner.lock().unwrap();
        let snapshot = state.urban.validate_source("urban-owner", &source).unwrap();
        assert_eq!(
            binary.body,
            urban::display::display_buffers(snapshot.layouts, snapshot.partitions, true)
        );
        let mut subset = binary_read.clone();
        subset["keys"] = json!(["b"]);
        // Release the session lock before routing the subset read.
        drop(state);
        let selected_binary =
            dispatch("/urban", &serde_json::to_vec(&subset).unwrap(), &sessions).unwrap();
        let state = owner.lock().unwrap();
        let snapshot = state.urban.validate_source("urban-owner", &source).unwrap();
        assert_eq!(
            selected_binary.body,
            urban::display::display_buffers(
                &snapshot.layouts[1..2],
                &snapshot.partitions[1..2],
                true
            )
        );
    }
    let read = json!({"id":9,"kind":"buildingSites","seed":"retained-test","source":source});
    let referenced = call(read.clone()).unwrap(); // no top-level session or raster
    assert!(
        !referenced["placementRequests"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    eprintln!(
        "retained source fixture: {} native sites",
        referenced["placementRequests"].as_array().unwrap().len()
    );
    assert!(
        !referenced["placementRequests"][0]["cadastral"]
            .as_array()
            .unwrap()
            .is_empty()
    );
    let explicit = call(
        json!({"session":"urban-owner","id":9,"kind":"buildingSites","seed":"retained-test",
        "layouts":raw_layouts,"partitions":reply["partitions"]}),
    )
    .unwrap();
    same_json(
        &referenced["placementRequests"],
        &explicit["placementRequests"],
        "placementRequests",
    );
    let begin_input = json!({"kind":"buildingSitesBegin","source":source,"seed":"retained-test"});
    let begin = call(begin_input.clone()).unwrap();
    let total = referenced["placementRequests"].as_array().unwrap().len();
    assert_eq!(begin["total"], total);
    let page_input = json!({"kind":"buildingSitesPage","source":source,"sourceId":begin["sourceId"],
        "offset":0,"limit":7,"maxBytes":24*1024*1024});
    let first = call(page_input.clone()).unwrap();
    assert_eq!(
        first["placementRequests"].as_array().unwrap().len(),
        7.min(total)
    );
    for limit in [1, 7, 64] {
        let mut all = Vec::new();
        while all.len() < total {
            let mut request = page_input.clone();
            request["offset"] = json!(all.len());
            request["limit"] = json!(limit);
            let page = call(request).unwrap();
            assert_eq!(page["offset"], all.len());
            assert_eq!(page["total"], total);
            all.extend(
                page["placementRequests"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .cloned(),
            );
            assert_eq!(page["next"], all.len());
        }
        same_json(&json!(all), &referenced["placementRequests"], "paged sites");
    }
    let mut short = page_input.clone();
    short["maxBytes"] = json!(2);
    let empty = call(short.clone()).unwrap();
    assert_eq!(empty["placementRequests"], json!([]));
    assert_eq!(empty["next"], 0);
    assert!(empty["requiredBytes"].as_u64().unwrap() > 2);
    short["maxBytes"] = empty["requiredBytes"].clone();
    let one = call(short).unwrap();
    assert_eq!(
        one["placementRequests"],
        json!([referenced["placementRequests"][0]])
    );
    same_json(
        &call(page_input.clone()).unwrap()["placementRequests"],
        &first["placementRequests"],
        "replayed page",
    );
    let single_input = json!({"kind":"buildingSite","source":source,"seed":"retained-test",
        "offset":0,"expectedId":referenced["placementRequests"][0]["id"],"maxBytes":24*1024*1024});
    let single = call(single_input.clone()).unwrap();
    same_json(
        &single["placementRequest"],
        &referenced["placementRequests"][0],
        "single site",
    );
    assert_eq!(single["offset"], 0);
    assert_eq!(single["total"], total);
    for (field, bad_value) in [
        ("expectedId", json!("different-building")),
        ("expectedId", json!("")),
        ("offset", json!(total)),
        ("offset", json!(-1)),
        ("maxBytes", json!(2)),
        ("maxBytes", json!(24 * 1024 * 1024 + 1)),
        ("keys", json!(["absent"])),
        ("layouts", json!([])),
    ] {
        let mut invalid = single_input.clone();
        invalid[field] = bad_value;
        assert!(
            call(invalid).is_err(),
            "single site accepted invalid {field}"
        );
    }
    for (field, bad_value) in [
        ("limit", json!(65)),
        ("maxBytes", json!(24 * 1024 * 1024 + 1)),
        ("offset", json!(total + 1)),
        ("offset", json!(-1)),
        ("seed", json!("different")),
    ] {
        let mut invalid = page_input.clone();
        invalid[field] = bad_value;
        assert!(call(invalid).is_err(), "page accepted invalid {field}");
    }
    let mut subset_begin = begin_input.clone();
    subset_begin["keys"] = json!(["b"]);
    let replacement = call(subset_begin).unwrap();
    assert!(
        call(page_input.clone())
            .err()
            .unwrap()
            .contains("[urban_sites_stale]")
    );
    let mut subset_page = page_input.clone();
    subset_page["sourceId"] = replacement["sourceId"].clone();
    subset_page["limit"] = json!(64);
    let mut subset_legacy = read.clone();
    subset_legacy["keys"] = json!(["b"]);
    same_json(
        &call(subset_page.clone()).unwrap()["placementRequests"],
        &call(subset_legacy).unwrap()["placementRequests"],
        "selected page",
    );
    // Replacing the streaming query must not destroy the original scene's
    // site locator. Nor may reading that original site replace the new stream.
    same_json(
        &call(single_input.clone()).unwrap()["placementRequest"],
        &referenced["placementRequests"][0],
        "single site after new begin",
    );
    let subset_before = call(subset_page.clone()).unwrap();
    let mut changed_seed = single_input.clone();
    changed_seed["seed"] = json!("other-scene");
    let mut changed_legacy = read.clone();
    changed_legacy["seed"] = changed_seed["seed"].clone();
    same_json(
        &call(changed_seed).unwrap()["placementRequest"],
        &call(changed_legacy).unwrap()["placementRequests"][0],
        "single site alternate seed",
    );
    same_json(
        &call(subset_page).unwrap()["placementRequests"],
        &subset_before["placementRequests"],
        "single read preserves active stream",
    );
    let mut stale_single = single_input.clone();
    stale_single["source"]["partitionsRevision"] = json!("old-source");
    assert!(
        call(stale_single)
            .unwrap_err()
            .contains("[urban_source_stale]")
    );
    for kind in ["buildingSitesBegin", "buildingSitesPage", "buildingSite"] {
        assert!(
            call(json!({"session":"never-created","kind":kind}))
                .err()
                .unwrap()
                .contains("[urban_source_invalid]")
        );
    }
    assert_eq!(sessions.lock().unwrap().entries.len(), 1);
    let mut selected = read.clone();
    selected["keys"] = json!(["b", "a"]);
    assert_eq!(
        call(selected).unwrap()["placementRequests"],
        referenced["placementRequests"]
    );
    for keys in [json!(["absent"]), json!(["a", "a"])] {
        let mut invalid = read.clone();
        invalid["keys"] = keys;
        assert!(call(invalid).err().unwrap().contains("[urban_source_keys]"));
    }
    let mut missing = read.clone();
    missing["source"]["session"] = json!("never-created");
    assert!(
        call(missing)
            .err()
            .unwrap()
            .contains("[urban_source_missing]")
    );
    assert_eq!(sessions.lock().unwrap().entries.len(), 1);
    let mut mismatch = read.clone();
    mismatch["session"] = json!("another-worker");
    assert!(
        call(mismatch)
            .err()
            .unwrap()
            .contains("[urban_source_invalid]")
    );
    let mut ambiguous = read.clone();
    ambiguous["layouts"] = json!([]);
    assert!(
        call(ambiguous)
            .err()
            .unwrap()
            .contains("[urban_source_invalid]")
    );
    assert!(call(read.clone()).is_ok()); // rejected reads did not mutate the source

    for kind in ["parcels", "programme", "builtCapacity", "quarters"] {
        let fresh = call(
            json!({"session":"urban-owner","id":8,"kind":"parcels","seed":"retained-test",
            "layouts":raw_layouts,"parcelConfig":{}}),
        )
        .unwrap();
        let mut old = read.clone();
        old["source"] = fresh["urbanSource"].clone();
        let mut begin_fresh = begin_input.clone();
        begin_fresh["source"] = fresh["urbanSource"].clone();
        let fresh_query = call(begin_fresh).unwrap();
        let mut old_page = page_input.clone();
        old_page["source"] = fresh["urbanSource"].clone();
        old_page["sourceId"] = fresh_query["sourceId"].clone();
        assert!(call(json!({"session":"urban-owner","kind":kind})).is_err()); // missing seed
        assert!(
            call(old_page)
                .err()
                .unwrap()
                .contains("[urban_source_stale]")
        );
        assert!(
            call(old.clone())
                .err()
                .unwrap()
                .contains("[urban_source_stale]")
        );
        old["kind"] = json!("displayBuffers");
        assert!(call(old).err().unwrap().contains("[urban_source_stale]"));
    }
    let fresh = call(
        json!({"session":"urban-owner","id":8,"kind":"parcels","seed":"retained-test",
        "layouts":raw_layouts,"parcelConfig":{}}),
    )
    .unwrap();
    let mut old = read;
    old["source"] = fresh["urbanSource"].clone();
    let mut invalid_raster = raster_bytes("urban-owner");
    invalid_raster.pop();
    assert!(dispatch("/raster", &invalid_raster, &sessions).is_err());
    assert!(call(old).is_err());
}
