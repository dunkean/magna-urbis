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
    let result = generate_natural_cover(&input(&f)).unwrap();
    assert_eq!(result.areas.len(), num(&f["natural"]["count"]) as usize);
    let total: f64 = result
        .areas
        .iter()
        .map(|a| area(&a.poly).abs() - a.holes.iter().map(|h| area(h).abs()).sum::<f64>())
        .sum();
    assert!((total - num(&f["natural"]["area"])).abs() < 1e-6);
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
    assert_eq!(result.layer.areas.len(), num(&f["rural"]["count"]) as usize);
    assert_eq!(result.stats["strips"], num(&f["rural"]["stats"]["strips"]));
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
    for farm in arr(&f["farms"]) {
        let actual: Value =
            serde_json::from_str(&farm_geometry(&serde_json::to_string(farm).unwrap()).unwrap())
                .unwrap();
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
