//! Forest field against a small fixture dumped from the original TypeScript `buildForestField`
//! (web/out/perf-2026-11-07/port/forest-names/dump_forest_fixture.ts): same hashes and algorithm,
//! so bytes match up to libm rounding at quantisation edges.

use magna_urbis_terrain::{ForestParams, build_forest_field, forest_request};
use serde_json::Value;

fn b64(s: &str) -> Vec<u8> {
    let val = |c: u8| match c {
        b'A'..=b'Z' => c - b'A',
        b'a'..=b'z' => c - b'a' + 26,
        b'0'..=b'9' => c - b'0' + 52,
        b'+' => 62,
        _ => 63,
    };
    let mut out = Vec::new();
    let (mut acc, mut bits) = (0u32, 0);
    for c in s.bytes().filter(|&c| c != b'=') {
        acc = (acc << 6) | val(c) as u32;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
            acc &= (1 << bits) - 1;
        }
    }
    out
}
fn floats(bytes: &[u8]) -> Vec<f32> {
    bytes.chunks_exact(4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).collect()
}
fn close(name: &str, got: &[u8], want: &[u8]) {
    assert_eq!(got.len(), want.len(), "{name}: length");
    let (mut off_by_one, mut worse) = (0, 0);
    for (g, w) in got.iter().zip(want) {
        match (*g as i32 - *w as i32).abs() {
            0 => {}
            1 => off_by_one += 1,
            _ => worse += 1,
        }
    }
    assert!(worse * 200 <= got.len() && (worse + off_by_one) * 25 <= got.len(), "{name}: {worse} bytes off by more than 1, {off_by_one} off by one of {}", got.len());
}

#[test]
fn matches_the_typescript_field() {
    let fixture: Value = serde_json::from_str(include_str!("fixtures/forest_small.json")).unwrap();
    let text = |v: &Value| b64(v.as_str().unwrap());
    let (n, width) = (fixture["n"].as_u64().unwrap() as usize, fixture["width"].as_f64().unwrap());
    let height = floats(&text(&fixture["height"]));
    let water = text(&fixture["water"]);
    let segments = floats(&text(&fixture["riverSegments"]));
    let climate = [fixture["climate"][0].as_f64().unwrap(), fixture["climate"][1].as_f64().unwrap()];
    for case in fixture["cases"].as_array().unwrap() {
        let name = case["name"].as_str().unwrap();
        let params = ForestParams {
            seed: fixture["seed"].as_u64().unwrap() as u32,
            climate,
            x: 0.0,
            y: 0.0,
            width,
            n,
            height: &height,
            water: case["withWater"].as_bool().unwrap().then_some(&water[..]),
            river_segments: (case["segments"].as_u64().unwrap() > 0).then_some(&segments[..]),
            enabled: case["enabled"].as_bool().unwrap(),
            density: case["density"].as_f64().unwrap(),
            clearings: case["clearings"].as_f64().unwrap(),
            progressive: case["progressive"].as_bool().unwrap(),
        };
        let planes = build_forest_field(&params).unwrap();
        assert_eq!(planes.n, case["n"].as_u64().unwrap() as usize);
        close(&format!("{name} rgba"), &planes.rgba, &text(&case["rgba"]));
        close(&format!("{name} bank"), planes.bank.as_ref().expect("bank"), &text(&case["bank"]));
        if params.progressive {
            assert_eq!(planes.beach_n, case["beachN"].as_u64().unwrap() as usize);
            for pair in case["beachSamples"].as_array().unwrap() {
                let (k, want) = (pair[0].as_u64().unwrap() as usize, pair[1].as_i64().unwrap());
                assert!((planes.beach[k] as i64 - want).abs() <= 3, "{name} beach[{k}] = {} want {want}", planes.beach[k]);
            }
        }
    }
}

#[test]
fn request_framing_round_trips() {
    let n = 16usize;
    let header = format!("{{\"seed\":7,\"climate\":[10,800],\"x\":0,\"y\":0,\"width\":300,\"n\":{n},\"water\":false,\"segments\":0,\"enabled\":true,\"density\":1,\"clearings\":0.45,\"progressive\":false}}");
    let mut head = header.into_bytes();
    while head.len() % 4 != 0 {
        head.push(b' ');
    }
    let mut body = (head.len() as u32).to_le_bytes().to_vec();
    body.extend_from_slice(&head);
    for i in 0..n * n {
        body.extend_from_slice(&(40.0 + (i % n) as f32).to_le_bytes());
    }
    let reply = forest_request(&body).unwrap();
    let head_len = u32::from_le_bytes(reply[..4].try_into().unwrap()) as usize;
    let info: Value = serde_json::from_slice(&reply[4..4 + head_len]).unwrap();
    assert_eq!(info["n"], 32);
    assert_eq!(reply.len(), 4 + head_len + 32 * 32 * 4);
}
