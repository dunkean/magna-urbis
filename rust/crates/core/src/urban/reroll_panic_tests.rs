//! Captured V2 composition reroll, followed by the retained composition's street variation.
use super::*;
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    seed: String,
    sites: Vec<Site>,
    roads: Vec<Street>,
    layout_config: LayoutConfig,
    width: f64,
    n: usize,
    floor: f32,
    geometry: VectorGeography,
}

#[test]
fn composition_reroll_with_street_salts_completes() {
    let f: Fixture = serde_json::from_str(include_str!("fixtures/reroll-town-panic.json")).unwrap();
    let bytes = include_bytes!("fixtures/reroll-town-panic-ground.bin");
    let split = bytes.len() - f.n * f.n;
    let height: Vec<f32> = bytes[..split].chunks_exact(4)
        .map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect();
    let geography = Geography::new(f.geometry, f.width).unwrap();
    let surface = Surface { geometry: Some(&geography), width: f.width, n: f.n,
        height: &height, water: &bytes[split..], interpolation: HeightInterpolation::BSpline { floor: f.floor, shore: false } };
    let layouts = generate_quarters(&f.seed, &f.sites, &f.layout_config, surface, &f.roads).unwrap();
    assert_eq!(layouts.len(), 1);
    let layout = &layouts[0];
    assert!(!layout.blocks.is_empty());
    assert!(layout.blocks.iter().all(|b| b.quarter < layout.quarters.len()));
    if let Some(p) = &layout.programme {
        assert!(p.environment.iter().all(|e| e.block < layout.blocks.len()));
        assert!(p.reservations.iter().all(|r| r.block < layout.blocks.len() && r.street < layout.streets.len()));
    }
}
