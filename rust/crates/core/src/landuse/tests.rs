use super::geom::{area, region_area};
use super::*;
fn fixture() -> Value {
    serde_json::from_str(include_str!("../../tests/fixtures/landuse-ts.json")).unwrap()
}
fn floats(v: &Value) -> Vec<f32> {
    arr(v).iter().map(|v| num(v) as f32).collect()
}
fn input(v: &Value) -> Input {
    let n = num(&v["n"]) as usize;
    let total = n * n;
    serde_json::from_value(serde_json::json!({"seed":v["seed"],"w":n,"h":n,"cell":v["cell"],"mapSize":n as f64*num(&v["cell"]),"biome":"temperate","seaLevel":0,"seaFraction":0,"height":v["height"],"slope":v["slope"],"water":vec![0;total],"cost":v["cost"],"hab":vec![12;total],"dWater":vec![300;total],"dSea":vec![1e6;total],"options":{"mapSize":n as f64*num(&v["cell"]),"culture":"frankish","size":"village","relief":"flat"},"geometry":{"roads":[],"settlements":[],"terrain":{"coastline":[],"islands":[],"lakes":[],"rivers":[]},"site":{"center":{"x":320,"y":320},"reserveRadius":50}},"plan":v["plan"]})).unwrap()
}
#[test]
fn ts_vectorizer_and_natural_cover_fixture() {
    let f = fixture();
    let v = &f["vector"];
    let r = vectorize(
        &floats(&v["mask"]),
        num(&v["w"]) as usize,
        num(&v["h"]) as usize,
        num(&v["cell"]),
        num(&v["minArea"]),
        serde_json::from_value(v["win"].clone()).unwrap(),
    );
    let expected = regions(&v["regions"]);
    assert_eq!(r.len(), expected.len());
    for (a, b) in r.iter().zip(&expected) {
        assert_eq!(a.holes.len(), b.holes.len());
        assert_eq!(a.outer.len(), b.outer.len());
        for (a, b) in a.outer.iter().zip(&b.outer) {
            assert!((a.x - b.x).abs() < 1e-10 && (a.y - b.y).abs() < 1e-10);
        }
        assert!((region_area(a) - region_area(b)).abs() < 1e-8);
    }
    // Without settlements the land is wild: only woods, marsh and the floodplain meadow of real rivers are classed
    // (the TS fixture's pasture is now unclassified ground); this fixture has no river geometry, so no meadow.
    let result = generate_natural_cover(&input(&f)).unwrap();
    assert!(result.areas.iter().all(|a| ["forest", "marsh"].contains(&a.kind.as_str())));
    let total: f64 = result
        .areas
        .iter()
        .map(|a| area(&a.poly).abs() - a.holes.iter().map(|h| area(h).abs()).sum::<f64>())
        .sum();
    assert!(total <= num(&f["natural"]["area"]) + 1e-6);
}
#[test]
fn floodplain_meadow_follows_river_size_and_relief() {
    // A plain rising 4 cm per metre away from a straight north-south river in the middle of the map.
    let f = fixture();
    let mut i = input(&f);
    let (w, h, cell) = (i.w, i.h, i.cell);
    let xr = 0.5 * w as f64 * cell;
    for k in 0..w * h {
        let x = ((k % w) as f64 + 0.5) * cell;
        i.height[k] = (8.0 + 0.04 * (x - xr).abs()) as f32;
        i.slope[k] = 0.02;
    }
    let river = |width: f64| {
        serde_json::json!([{ "path": [{ "x": xr, "y": 0.0 }, { "x": xr, "y": h as f64 * cell }], "width": [width, width] }])
    };
    let side = |fl: &[bool], near: bool| {
        (0..w * h).filter(|&k| fl[k] && {
            let d = (((k % w) as f64 + 0.5) * cell - xr).abs();
            if near { d <= 40.0 } else { d > 200.0 }
        }).count()
    };
    // A large desert river keeps a meadow on its valley floor, bounded by its flood stage, not a fixed buffer.
    i.biome = "desert".into();
    i.geometry["terrain"]["rivers"] = river(60.0);
    let fl = floodplain_meadow(&i, w, h, cell);
    assert!(side(&fl, true) > 0);
    assert_eq!(side(&fl, false), 0);
    // A desert wadi keeps none; the same small stream in a temperate climate does.
    i.geometry["terrain"]["rivers"] = river(5.0);
    assert!(floodplain_meadow(&i, w, h, cell).iter().all(|&m| !m));
    i.biome = "temperate".into();
    assert!(side(&floodplain_meadow(&i, w, h, cell), true) > 0);
}
#[test]
fn retained_lakes_exclude_smoothed_landuse() {
    use super::{boolean as bo, geom::*};
    let mut i = input(&fixture());
    let before = generate_rural(&i).unwrap();
    // A sub-cell lake is smaller than the generic vectorizer's hole threshold.
    // Put it in a real field so an empty result cannot make this guard pass.
    let point = (0..i.w * i.h)
        .map(|c| {
            p(
                (c % i.w) as f64 * i.cell + 0.5 * i.cell,
                (c / i.w) as f64 * i.cell + 0.5 * i.cell,
            )
        })
        .find(|&q| {
            before.layer.areas.iter().any(|a| a.kind == "field" && inside(&a.region(), q))
        })
        .expect("fixture must contain a field cell");
    let lake = rect(point.x, point.y, 12.0, 12.0, 0.0);
    i.geometry["terrain"]["lakes"] = serde_json::json!([lake]);
    let c = raster::idx(point, i.w, i.h, i.cell);
    i.water[c] = 2;
    i.d_water[c] = 0.0;
    let lakes = ground::lake_regions(&i);
    assert_eq!(lakes.len(), 1);
    let rural = generate_rural(&i).unwrap().layer;
    let natural = generate_natural_cover(&i).unwrap();
    for layer in [&rural, &natural] {
        assert!(!layer.areas.is_empty());
        for a in &layer.areas {
            let wet = bo::safe(&[a.region()], &lakes, bo::Op::Intersection);
            assert!(
                wet.iter().map(region_area).sum::<f64>() < 0.01,
                "{} overlaps lake", a.kind
            );
            for strip in &a.strips {
                let wet = bo::safe(&[piece(strip.clone())], &lakes, bo::Op::Intersection);
                assert!(
                    wet.iter().map(region_area).sum::<f64>() < 0.01,
                    "field strip overlaps lake"
                );
            }
        }
    }
    // Dry islands remain holes in water for ground clipping and urban placement.
    let island = rect(point.x, point.y, 4.0, 4.0, 0.0);
    i.geometry["terrain"]["lakes"] = serde_json::json!([lake, island]);
    let lakes = ground::lake_regions(&i);
    assert_eq!(lakes.len(), 1);
    assert_eq!(lakes[0].holes.len(), 1);
    assert!(!inside(&lakes[0], point));
}

#[test]
fn drawn_coast_keeps_islands_dry_without_closed_water_domains() {
    use super::geom::*;
    let mut i = input(&fixture());
    let sea = rect(100.0, 100.0, 100.0, 100.0, 0.0);
    let island = rect(110.0, 110.0, 10.0, 10.0, 0.0);
    let outside = rect(200.0, 200.0, 10.0, 10.0, 0.0);
    i.geometry["terrain"]["coastline"] = serde_json::json!([sea]);
    i.geometry["terrain"]["islands"] = serde_json::json!([island, outside]);

    let sea_regions = ground::water_regions(&i);
    assert_eq!(sea_regions.len(), 1);
    assert_eq!(sea_regions[0].holes.len(), 1);
    assert!(inside(&sea_regions[0], p(100.0, 100.0)));
    assert!(!inside(&sea_regions[0], p(110.0, 110.0)));
    assert!(!inside(&sea_regions[0], p(200.0, 200.0)));

    // An explicit closed-domain payload stays authoritative even when empty.
    i.geometry["terrain"]["water"] = serde_json::json!([]);
    assert!(ground::water_regions(&i).is_empty());
}

#[test]
fn drawn_rivers_cut_every_class() {
    use super::{boolean as bo, geom::*};
    // A drawn river through a field, as the V2 sends it: a closed water domain (`terrain.water`), with no river cell in
    // the water raster (the coarse raster and the drawn river disagree). No class may lie on it, and the land use
    // reaches its banks on both sides.
    let mut i = input(&fixture());
    let before = generate_rural(&i).unwrap();
    let field = before.layer.areas.iter().find(|a| a.kind == "field").expect("fixture must contain a field");
    let c = centroid(&field.poly);
    let bank = ribbon(&[p(c.x - 400.0, c.y - 90.0), p(c.x + 400.0, c.y + 90.0)], 14.0);
    i.geometry["terrain"]["water"] = serde_json::json!([[bank]]);
    let river = ground::water_regions(&i);
    assert_eq!(river.len(), 1);
    let out = generate_rural(&i).unwrap().layer;
    assert!(out.areas.iter().any(|a| a.kind == "field"));
    for a in &out.areas {
        let wet = bo::safe(&[a.region()], &river, bo::Op::Intersection);
        assert!(wet.iter().map(region_area).sum::<f64>() < 0.5, "{} on the river", a.kind);
        for strip in &a.strips {
            let wet = bo::safe(&[piece(strip.clone())], &river, bo::Op::Intersection);
            assert!(wet.iter().map(region_area).sum::<f64>() < 0.5, "field strip on the river");
        }
    }
    // The same river as a centre line with its drawn width (`terrain.rivers`) is the same authority.
    i.geometry["terrain"]["water"] = serde_json::json!([]);
    i.geometry["terrain"]["rivers"] = serde_json::json!([{ "path": [p(c.x - 400.0, c.y - 90.0), p(c.x + 400.0, c.y + 90.0)], "width": [14.0, 14.0] }]);
    let river = ground::water_regions(&i);
    let out = generate_rural(&i).unwrap().layer;
    for a in &out.areas {
        let wet = bo::safe(&[a.region()], &river, bo::Op::Intersection);
        assert!(wet.iter().map(region_area).sum::<f64>() < 0.5, "{} on the river ribbon", a.kind);
    }
}

#[test]
fn dense_wood_claims_cultivated_land() {
    use super::rural::{dense_wood, wood_claims, DENSE_WOOD};
    // A lone dense cell never converts (no salt-and-pepper); a dense block converts its inside only.
    let n = 9;
    let mut stands = vec![0.3_f32; n * n];
    stands[2 * n + 2] = 0.9;
    for y in 4..9 {
        for x in 4..9 {
            stands[y * n + x] = 0.8;
        }
    }
    let dense = dense_wood(&stands, n);
    assert!(!dense[2 * n + 2]);
    assert!(dense[6 * n + 6] && !dense[4 * n + 4]);
    assert!(DENSE_WOOD > 0.22);
    // Holdings are given up whole or kept whole: a field mostly in dense wood goes, one mostly outside stays entire.
    let mut cls = vec![0_u8; n * n];
    for y in 0..9 {
        for x in 0..3 {
            cls[y * n + x] = 1; // a field outside the wood
        }
    }
    for y in 4..9 {
        for x in 5..9 {
            cls[y * n + x] = 5; // an orchard mostly in the wood
        }
    }
    let claimed = wood_claims(&cls, &dense, n);
    assert!((0..n * n).filter(|&i| cls[i] == 1).all(|i| !claimed[i]));
    assert!((0..n * n).filter(|&i| cls[i] == 5).all(|i| claimed[i]));
    // On the fixture: a dense wood over the whole map leaves no field, orchard or garden; light woods keep them.
    let f = fixture();
    let crops = |forest: f32| {
        let mut i = input(&f);
        i.natural_forest = vec![forest; i.w * i.h];
        let out = generate_rural(&i).unwrap();
        out.layer
            .areas
            .iter()
            .filter(|a| ["field", "orchard", "garden"].contains(&a.kind.as_str()))
            .map(|a| area(&a.poly).abs() - a.holes.iter().map(|h| area(h).abs()).sum::<f64>())
            .sum::<f64>()
    };
    let (light, dense) = (crops(0.3), crops(0.9));
    assert!(light > 0.0 && dense < 0.5 * light, "crop area {light} -> {dense}");
}

#[test]
fn underdark_rural_land_is_fungus_beds_and_cave_floor() {
    // No surface fields, orchards, meadows, pastures or woods underground: cultivated land is fungus beds
    // (garden, cultivation 'fungal'), the rest the wild cave floor (commons) or cave pools (marsh).
    let f = fixture();
    let mut i = input(&f);
    i.biome = "underdark".into();
    let out = generate_rural(&i).unwrap();
    assert!(!out.layer.areas.is_empty());
    for a in &out.layer.areas {
        assert!(["garden", "commons", "marsh"].contains(&a.kind.as_str()), "{} underground", a.kind);
        if a.kind == "garden" {
            assert_eq!(a.cultivation.as_deref(), Some("fungal"));
        }
    }
    // Farms stand by the cave towns: no roadside farms or farm hamlets, and the farms on unreached floor stay few.
    let (farms, people) = (out.layer.farmsteads.len(), out.stats["field.people"]);
    assert!(farms <= rural::cave_farm_cap(people), "{farms} farms for {people} people");
    let hamlet = |f: &Value| arr(&f["tags"]).iter().any(|t| s(t) == "hamlet");
    assert!(!out.layer.farmsteads.iter().any(hamlet));
    let caps = [0.0, 2600.0, 15000.0, 1e6].map(rural::cave_farm_cap);
    assert_eq!(caps, [0, 6, 30, 40]);
}
#[test]
fn ts_rural_and_farm_fixture() {
    let f = fixture();
    let result = generate_rural(&input(&f)).unwrap();
    let total: f64 = result
        .layer
        .areas
        .iter()
        .map(|a| area(&a.poly).abs() - a.holes.iter().map(|h| area(h).abs()).sum::<f64>())
        .sum();
    assert!(
        (total - num(&f["rural"]["area"])).abs() < 5.0,
        "rural area {total}"
    );
    // Round 22 (2026-11-12): field parcels are cut more irregularly than the TS
    // fixture (contour strips, merged slivers), so the same rural area now holds
    // at least as many parcels; the area total above stays exact.
    assert!(result.layer.areas.len() >= num(&f["rural"]["count"]) as usize);
    assert!(result.stats["strips"] > 0.0);
    fn near(actual: &Value, expected: &Value) {
        match (expected, actual) {
            (Value::Number(a), Value::Number(b)) => {
                assert!((a.as_f64().unwrap() - b.as_f64().unwrap()).abs() < 1e-9)
            }
            (Value::Array(a), Value::Array(b)) => {
                assert_eq!(a.len(), b.len());
                for (a, b) in a.iter().zip(b) {
                    near(b, a);
                }
            }
            (Value::Object(a), Value::Object(b)) => {
                assert_eq!(a.len(), b.len());
                for (k, v) in a {
                    near(&b[k], v);
                }
            }
            _ => assert_eq!(actual, expected),
        }
    }
    // Fields the farm gained after the TS reference was frozen are not in the fixture.
    fn without_later_fields(v: &mut Value) {
        match v {
            Value::Object(m) => {
                m.remove("enclosure");
                m.remove("heightM");
                m.values_mut().for_each(without_later_fields);
            }
            Value::Array(a) => a.iter_mut().for_each(without_later_fields),
            _ => {}
        }
    }
    for farm in arr(&f["farms"]) {
        let mut actual: Value =
            serde_json::from_str(&farm_geometry(&serde_json::to_string(farm).unwrap()).unwrap())
                .unwrap();
        without_later_fields(&mut actual);
        near(&actual, &farm["expected"]);
    }
}

#[test]
fn binary_geometry_preserves_regions_and_tool_coordinate_shapes() {
    let expected = vec![Region {
        outer: vec![
            Point {
                x: -0.0,
                y: 1.0 / 3.0,
            },
            Point { x: 12.5, y: -2.0 },
            Point { x: 0.0, y: 9.0 },
        ],
        holes: vec![vec![Point { x: 1.0, y: 2.0 }; 3]],
    }];
    let bytes = wire::encode(&expected).unwrap();
    let actual: Vec<Region> = serde_json::from_value(wire::decode_reply(&bytes).unwrap()).unwrap();
    assert_eq!(actual[0].outer, expected[0].outer);
    assert_eq!(
        actual[0].outer[0].x.to_bits(),
        expected[0].outer[0].x.to_bits()
    );
    assert_eq!(actual[0].holes, expected[0].holes);
    // Both point objects and local-farm coordinate tuples retain their JS shape.
    let value = serde_json::json!({"world":expected,"local":[[1.25,2.5],[3.5,4.5]]});
    assert_eq!(
        wire::decode_reply(&wire::encode_value(&value).unwrap()).unwrap(),
        value
    );
    let v = wire::decode_header(
        "{\"path\":{\"$xy\":[0,3]}}",
        &bytes[4 + u32::from_le_bytes(bytes[..4].try_into().unwrap()) as usize..],
    )
    .unwrap();
    assert_eq!(poly(&v["path"]), expected[0].outer);
    assert!(wire::decode_header("{\"$xy\":[0,100]}", &[0; 16]).is_err());
}

#[test]
fn overlay_sanitizes_degenerate_rings_and_keeps_horticulture_seed() {
    use super::{boolean as bo, geom::*};
    let f: Value = serde_json::from_str(include_str!("horticulture-ts.json")).unwrap();
    let mut source = regions(&f["source"]);
    source[0].holes = vec![
        vec![p(1.0, 2.0)],
        vec![p(0.0, 0.0); 3],
        vec![p(f64::NAN, 0.0); 3],
    ];
    source.push(piece(vec![p(f64::INFINITY, 0.0); 3]));
    source.push(piece(vec![p(0.0, 0.0), p(1.0, 1.0), p(2.0, 2.0)]));
    let actual = bo::safe(&source, &regions(&f["cuts"]), bo::Op::Difference);
    let expected = regions(&f["regions"]);
    assert_eq!(actual.len(), expected.len());
    assert_eq!(actual[0].outer, expected[0].outer);
    let rr = Rng::new("horticulture-fixture").fork("rural");
    let noise = Noise::new(rr.fork("angle"));
    let noise_fn = |x, y| noise.noise(x, y);
    let ctx = fields::Context {
        dir: &|_, _| 0.2,
        slope: &|_, _| 0.01,
        closed: true,
        noise: &noise_fn,
        regular: true,
        access: true,
        min_area: Some(100.0),
        strips_at: None,
    };
    let mut net = fields::Net::default();
    for r in actual {
        let mut rng = rr.fork(&format!("horticulture:{}:{}", r.outer[0].x, r.outer[0].y));
        fields::partition(&r, &ctx, &mut rng, &mut net);
    }
    let expected = arr(&f["net"]["furlongs"]);
    assert_eq!(net.furlongs.len(), expected.len());
    for (a, b) in net.furlongs.iter().zip(expected) {
        assert!((a.angle - num(&b["angle"])).abs() < 1e-8);
        let ring = poly(&b["outer"]);
        assert_eq!(a.region.outer.len(), ring.len());
        for (a, b) in a.region.outer.iter().zip(ring) {
            assert!(dist(*a, b) < 0.002);
        }
    }
}

#[test]
fn dry_ground_wire_clips_water_polygons_and_protected_land() {
    let strip = |left: i32, right: i32| serde_json::json!({
        "outer": [{"x":left,"y":0},{"x":right,"y":0},{"x":right,"y":10},{"x":left,"y":10}],
        "holes": []
    });
    let header = serde_json::json!({
        "operation": "dry-ground", "seed":"", "w":2, "h":2, "cell":8,
        "source":[strip(0,10)], "protection":[strip(0,1)], "water":[strip(6,12)]
    });
    let reply = wire::execute(&header.to_string(), &[]).unwrap();
    let clipped = regions(&wire::decode_reply(&reply).unwrap());
    assert_eq!(clipped.len(), 1);
    assert!((region_area(&clipped[0]) - 50.0).abs() < 1e-6);
    assert!(clipped[0].outer.iter().all(|p| (1.0..=6.0).contains(&p.x)));
}

#[test]
fn numeric_planes_and_bad_river_widths_return_errors() {
    let bytes: Vec<_> = [1.0_f64 / 3.0, 2.5]
        .iter()
        .flat_map(|n| n.to_le_bytes())
        .collect();
    let decoded = wire::decode_header(r#"{"width":{"$f64":[0,2]}}"#, &bytes).unwrap();
    assert_eq!(
        num(&decoded["width"][0]).to_bits(),
        (1.0_f64 / 3.0).to_bits()
    );
    assert!(wire::decode_header(r#"{"$f64":[18446744073709551615,2]}"#, &bytes).is_err());
    let mut i = input(&fixture());
    i.geometry["terrain"]["rivers"] =
        serde_json::json!([{ "path": [{"x":0,"y":0},{"x":10,"y":10}], "width": [2] }]);
    assert!(ground::water_ground(&i).is_err());
    let v = serde_json::json!({"operation":"water-ground"});
    assert!(ground::operation(&i, &v).is_err());
    // An invalid layer cannot discard an independent, valid layer.
    i.geometry["terrain"]["rivers"] = serde_json::json!([]);
    i.geometry["urban"] = serde_json::json!({"blocks":[[{"x":0,"y":0},{"x":10,"y":0},{"x":10,"y":10},{"x":0,"y":10}]],"blockInfo":[{"kind":"block"}]});
    i.geometry["settlements"] =
        serde_json::json!([{ "main":false,"urban":{"blocks":[[{"x":null,"y":0}]]} }]);
    assert!(!urban_landscape_ground(&i, false).is_empty());
}
