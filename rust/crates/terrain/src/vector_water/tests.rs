use super::*;
use serde_json::Value;
#[test]
fn wire_rejects_cycles_duplicates_and_invalid_diagnostic_settings() {
    let fixture = expected("humid");
    let mut settings: Settings = serde_json::from_value(fixture["settings"].clone()).unwrap();
    settings.flat_slope = 0.0;
    let make = |operation: &str, settings: &Settings, receiver: [i32; 4], order: [i32; 4]| {
        let meta = serde_json::json!({"operation":operation,"n":2,"width":20,"settings":settings,"drainageOutlets":4,"climate":{"temperature":11,"precipitation":800}});
        let header = serde_json::to_vec(&meta).unwrap();
        let mut body = (header.len() as u32).to_le_bytes().to_vec();
        body.extend(header);
        for plane in [[10.0_f32;4], [10.0;4]] { for value in plane { body.extend(value.to_le_bytes()); } }
        for value in receiver { body.extend(value.to_le_bytes()); }
        for value in [1.0_f32;4] { body.extend(value.to_le_bytes()); }
        for value in order { body.extend(value.to_le_bytes()); }
        for value in [0_i32;4] { body.extend(value.to_le_bytes()); }
        body.extend([0_u8;8]); // sea and diagnostic lake
        body
    };
    for operation in ["water", "rivers", "bodies", "balance"] {
        assert!(request(&make(operation,&settings,[-1;4],[0,1,2,3])).is_ok(), "zero slope: {operation}");
        assert!(request(&make(operation,&settings,[1,0,-1,-1],[0,1,2,3])).is_err());
        assert!(request(&make(operation,&settings,[-1;4],[0,0,2,3])).is_err());
        let mut invalid = settings.clone(); invalid.river_area = 0.0;
        assert!(request(&make(operation,&invalid,[-1;4],[0,1,2,3])).is_err());
    }
}

#[test]
fn chain_without_census_reuses_the_exact_settled_drainage() {
    let input = floats(include_bytes!("../../tests/fixtures/vector-water/height.f32"));
    let fixture = expected("humid");
    let mut settings: Conditioning = serde_json::from_value(fixture["conditioning"].clone()).unwrap();
    settings.mode = "both".into();
    let old = condition_relief(&input,64,6400.0,&settings,true);
    let fast = conditioning::condition_options(&input,64,6400.0,&settings,false,true,false);
    assert_eq!(old.height,fast.height);
    assert_eq!(old.delta,fast.delta);
    let (a,b) = (old.hydrology.unwrap(),fast.hydrology.unwrap());
    assert_eq!(a.grids.filled,b.grids.filled);
    assert_eq!(a.grids.receiver,b.grids.receiver);
    assert_eq!(a.grids.order,b.grids.order);
    assert_eq!(a.grids.sea,b.grids.sea);
    assert!(b.grids.accumulation.is_empty());
    assert!(b.grids.basin.is_empty());
}
fn floats(bytes: &[u8]) -> Vec<f32> {
    bytes
        .chunks_exact(4)
        .map(|b| f32::from_le_bytes(b.try_into().unwrap()))
        .collect()
}
fn expected(name: &str) -> Value {
    serde_json::from_str(match name {
        "humid" => include_str!("../../tests/fixtures/vector-water/humid.json"),
        "dry" => include_str!("../../tests/fixtures/vector-water/dry.json"),
        _ => include_str!("../../tests/fixtures/vector-water/unbalanced.json"),
    })
    .unwrap()
}
fn close(actual: f64, expected: f64, tolerance: f64) {
    assert!(
        (actual - expected).abs() <= tolerance,
        "{actual} != {expected} (tolerance {tolerance})"
    )
}
#[test]
fn conditioning_matches_ts_fixture_and_stats_false() {
    let input = floats(include_bytes!(
        "../../tests/fixtures/vector-water/height.f32"
    ));
    let want = floats(include_bytes!(
        "../../tests/fixtures/vector-water/conditioned.f32"
    ));
    let fixture = expected("humid");
    let settings: Conditioning = serde_json::from_value(fixture["conditioning"].clone()).unwrap();
    let output = condition_relief(&input, 64, 6400.0, &settings, true);
    let fast = condition_relief(&input, 64, 6400.0, &settings, false);
    assert!(fast.hydrology.is_none());
    assert_eq!(output.height, fast.height);
    assert_eq!(
        output.breaches,
        fixture["breaches"].as_u64().unwrap() as usize
    );
    assert_eq!(output.steps, fixture["steps"].as_u64().unwrap() as u32);
    for (c, (&a, &b)) in output.height.iter().zip(&want).enumerate() {
        assert!((a - b).abs() < 2e-4, "height[{c}]: {a} != {b}");
        close(output.delta[c] as f64, a as f64 - input[c] as f64, 1e-5)
    }
    close(
        output.before.volume,
        fixture["before"]["volume"].as_f64().unwrap(),
        0.1,
    );
    close(
        output.after.volume,
        fixture["after"]["volume"].as_f64().unwrap(),
        0.1,
    );
}
#[test]
fn lakes_network_metrics_and_vertices_match_ts() {
    let height = floats(include_bytes!(
        "../../tests/fixtures/vector-water/conditioned.f32"
    ));
    for name in ["humid", "dry", "unbalanced"] {
        let fixture = expected(name);
        let settings: Settings = serde_json::from_value(fixture["settings"].clone()).unwrap();
        let climate: Climate = serde_json::from_value(fixture["climate"].clone()).unwrap();
        let water = compute_water(
            &height,
            64,
            6400.0,
            &settings,
            climate,
            fixture["seed"].as_str().unwrap(),
            None,
        );
        // Balanced lakes now cover their whole flooded extent (depth above
        // `SHORE_DEPTH`), so they only grow past the TS mask.
        let lake_cells = water.lake.iter().map(|&v| v as u64).sum::<u64>();
        let want_lake = fixture["lakeCells"].as_u64().unwrap();
        assert!(lake_cells >= want_lake, "{name}");
        let ts_lakes = lake_cells == want_lake;
        assert_eq!(water.lakes as u64, fixture["lakes"].as_u64().unwrap());
        assert_eq!(
            water.closed_lakes as u64,
            fixture["closedLakes"].as_u64().unwrap()
        );
        // Lake shore capture (`capture_lake_shores`) postdates the TS chain:
        // where it reroutes a river into a lake, the river cells only shrink
        // and the TS network and metrics no longer apply.
        let want_cells = fixture["riverCells"].as_u64().unwrap();
        assert!(water.river_cells as u64 <= want_cells, "{name}");
        let ts_routing = ts_lakes && water.river_cells as u64 == want_cells;
        let network = water.rivers.as_ref().unwrap();
        if ts_routing {
        let want = &fixture["rivers"];
        assert_eq!(
            network.rivers.len() as u64,
            want["count"].as_u64().unwrap(),
            "{name}"
        );
        // River lines are now clipped on the depth-placed shore field, so
        // their length and vertices deviate slightly from the mask-only TS chain.
        let want_km = want["lengthKm"].as_f64().unwrap();
        assert!((network.length_km - want_km).abs() <= want_km * 0.02, "{name}");
        for sample in want["samples"].as_array().unwrap() {
            let id = sample["id"].as_u64().unwrap() as usize;
            let line = network.rivers.iter().find(|l| l.id == Some(id)).unwrap();
            assert_eq!(
                line.joins.unwrap() as i64,
                sample["joins"].as_i64().unwrap()
            );
        }
        }
        // The TS field is the mask-only one; the water field now places its
        // shore between cell centres from the water depth.
        let mask_field = super::lake_field(&water.lake, 64);
        for sample in fixture["field"].as_array().unwrap().iter().filter(|_| ts_lakes) {
            let i = sample[0].as_u64().unwrap() as usize;
            close(
                mask_field.values[i] as f64,
                sample[1].as_f64().unwrap(),
                1e-5,
            );
            close(
                mask_field.distance[i] as f64,
                sample[2].as_f64().unwrap(),
                1e-5,
            )
        }
        let metrics = serde_json::to_value(&water.metrics).unwrap();
        // Metrics derived from the clipped river lines move with the depth-placed shore.
        for (key, value) in fixture["metrics"].as_object().unwrap().iter().filter(|_| ts_routing) {
            let want = value.as_f64().unwrap();
            close(metrics[key].as_f64().unwrap(), want, 1e-4 + want.abs() * 0.03)
        }
    }
}

#[test]
fn surface_only_flood_keeps_conditioning_products() {
    let height = floats(include_bytes!(
        "../../tests/fixtures/vector-water/height.f32"
    ));
    let full = crate::priority_flood::flood_grids(&height, 64, 10000.0, None, None, None);
    for routing in [false, true] {
        let light = crate::priority_flood::flood_surface(&height, 64, routing);
        assert_eq!(light.filled, full.filled);
        if routing {
            assert_eq!(light.receiver, full.receiver);
        }
        assert!(light.accumulation.is_empty());
        assert!(light.basin.is_empty());
    }
}

#[test]
fn compact_conditioning_drainage_keeps_unbalanced_water_reply() {
    let height = floats(include_bytes!(
        "../../tests/fixtures/vector-water/conditioned.f32"
    ));
    let h = hydrology(&height, 64, 6400.0);
    let fixture = expected("unbalanced");
    let encode = |basin: bool| {
        let mut header = serde_json::to_vec(&serde_json::json!({
            "operation":"water", "n":64, "width":6400.0,
            "settings":fixture["settings"], "climate":fixture["climate"], "seed":fixture["seed"],
            "drainageOutlets":h.grids.outlets, "drainageBasin":basin,
        }))
        .unwrap();
        while header.len() % 4 != 0 {
            header.push(b' ');
        }
        let mut body = (header.len() as u32).to_le_bytes().to_vec();
        body.extend(header);
        for plane in [&height, &h.grids.filled] {
            for v in plane {
                body.extend(v.to_le_bytes());
            }
        }
        for v in &h.grids.receiver {
            body.extend(v.to_le_bytes());
        }
        for v in &h.grids.accumulation {
            body.extend(v.to_le_bytes());
        }
        for v in &h.grids.order {
            body.extend(v.to_le_bytes());
        }
        if basin {
            for v in &h.grids.basin {
                body.extend(v.to_le_bytes());
            }
        }
        body.extend_from_slice(&h.grids.sea);
        body
    };
    assert_eq!(
        request(&encode(true)).unwrap(),
        request(&encode(false)).unwrap()
    );
}

#[test]
fn shore_lies_on_the_depth_contour_between_cell_centres() {
    // Water 10 m, ground rising 1 m per cell along x and 0.37 m along y,
    // mask threshold 1 m: the true shore is x = 9 - 0.37 y.
    let n = 32;
    let height: Vec<f32> = (0..n * n)
        .map(|c| ((c % n) as f64 + 0.37 * (c / n) as f64) as f32)
        .collect();
    let level = vec![10.0_f32; n * n];
    let mask: Vec<u8> = height.iter().map(|&h| u8::from(10.0 - h as f64 >= 1.0)).collect();
    let field = super::lake::lake_field_with_shore(
        &mask,
        n,
        Some(super::lake::Shore { level: &level, height: &height, depth: 1.0 }),
    );
    let plain = super::lake_field(&mask, n);
    for y in 2..20 {
        let x0 = (0..n).filter(|&x| mask[y * n + x] != 0).max().unwrap();
        let want = (9.0 - x0 as f64 - 0.37 * y as f64).clamp(0.05, 0.95);
        let got = field.distance[y * n + x0] as f64;
        assert!((got - want).abs() < 1e-4, "row {y}: {got} vs {want}");
        let outside = -field.distance[y * n + x0 + 1] as f64;
        assert!((outside - (1.0 - want)).abs() < 1e-4, "row {y}: {outside}");
        assert_eq!(plain.distance[y * n + x0], 0.5);
    }
}

#[test]
fn rivers_beside_a_lake_drain_into_it() {
    use crate::priority_flood::FloodGrids;
    // Column x = 0 is a lake (surface 5) draining to its outlet (1, 4), the
    // lowest cell. Column x = 1 above it is a river skirting the lake.
    let n = 5;
    let at = |x: usize, y: usize| y * n + x;
    let total = n * n;
    let mut filled = vec![20.0_f32; total];
    let mut receiver = vec![-1_i32; total];
    let mut order = vec![at(1, 4) as i32];
    filled[at(1, 4)] = 4.0;
    for y in 0..n {
        filled[at(0, y)] = 5.0;
        receiver[at(0, y)] = if y + 1 < n { at(0, y + 1) } else { at(1, 4) } as i32;
    }
    order.extend((0..n).rev().map(|y| at(0, y) as i32));
    for y in (0..4).rev() {
        filled[at(1, y)] = 10.0 - y as f32;
        receiver[at(1, y)] = at(1, y + 1) as i32;
        order.push(at(1, y) as i32);
    }
    for c in 0..total {
        if !order.contains(&(c as i32)) {
            order.push(c as i32);
        }
    }
    let mut lake = vec![0_u8; total];
    for y in 0..n {
        lake[at(0, y)] = 1;
    }
    let mut h = super::Hydrology {
        n,
        width: n as f64,
        height: filled.clone(),
        grids: FloodGrids {
            filled,
            receiver,
            order,
            accumulation: vec![1.0; total],
            basin: Vec::new(),
            sea: vec![0; total],
            outlets: 1,
        },
    };
    let captured = super::capture_lake_shores(&mut h, &lake, None, None, 0.5);
    assert_eq!(captured, 4);
    for y in 0..4 {
        let r = h.grids.receiver[at(1, y)];
        assert!(r >= 0 && lake[r as usize] != 0, "river cell {y} skirts the lake");
    }
    // The outlet keeps the lake, which now carries the river.
    assert_eq!(h.grids.receiver[at(1, 4)], -1);
    assert_eq!(h.grids.accumulation[at(1, 4)], 10.0);
    for c in 0..total {
        let (mut at_cell, mut steps) = (c as i32, 0);
        while at_cell >= 0 {
            at_cell = h.grids.receiver[at_cell as usize];
            steps += 1;
            assert!(steps <= total, "cycle from {c}");
        }
    }
}
