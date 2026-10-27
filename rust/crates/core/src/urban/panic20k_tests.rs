use super::*;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Fixture {
    seed: String, sites: Vec<Site>, roads: Vec<Street>, layout_config: LayoutConfig,
    width: f64, n: usize, geometry: VectorGeography,
}

// Exact City Bench request/raster, city-01-river-plain-s, bridge auto position.
#[test]
fn organic_20k_quarters_complete_without_panic() {
    replay(None);
}

#[test]
#[ignore = "release performance guard: cargo test --release -p magna-urbis-core --lib urban::panic20k_tests::bridge_20k_release_budget -- --ignored --nocapture"]
fn bridge_20k_release_budget() {
    replay(Some(std::time::Duration::from_secs(2)));
}

fn replay(bridge_limit: Option<std::time::Duration>) {
    let mut fixture: Fixture = serde_json::from_str(include_str!("fixtures/panic20k.json")).unwrap();
    let data = include_bytes!("fixtures/panic20k-ground.bin");
    let count = fixture.n * fixture.n;
    let height: Vec<_> = data[..count * 4].chunks_exact(4)
        .map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect();
    let geometry = Geography::new(fixture.geometry, fixture.width).unwrap();
    let surface = Surface { geometry: Some(&geometry), width: fixture.width, n: fixture.n,
        height: &height, water: &data[count * 4..] };
    for (culture, family) in [("european-organic", "compact"), ("italian-comune", "elongated"), ("flemish-cloth-town", "linear")] {
        if std::env::var("PANIC20K_CULTURE").is_ok_and(|c| c != culture) { continue; }
        fixture.sites[0].culture = culture.into();
        fixture.layout_config.footprint.family = family.into();
        let started = std::time::Instant::now();
        let (layouts, bridge_time, calls) = routing::bridge_timing::measure(||
            generate_quarters(&fixture.seed, &fixture.sites, &fixture.layout_config, surface, &fixture.roads).unwrap());
        eprintln!("{culture}: bridges {bridge_time:?} ({calls} stages), quarters {:?}", started.elapsed());
        assert!(calls >= 3, "bridge stage instrumentation missing for {culture}");
        if let Some(limit) = bridge_limit { assert!(bridge_time < limit, "{culture}: bridge routing/selection took {bridge_time:?}, budget {limit:?}"); }
        assert_eq!(layouts.len(), 1, "{culture}");
        let layout = &layouts[0];
        if let Some(dir) = std::env::var_os("BRIDGE_CAPTURE") {
            std::fs::write(std::path::Path::new(&dir).join(format!("{culture}.json")), serde_json::to_vec(layout).unwrap()).unwrap();
        }
        assert!(!layout.quarters.is_empty() && !layout.blocks.is_empty() && !layout.streets.is_empty(), "{culture}");
        assert!(layout.blocks.iter().all(|b| geometry::area(&b.shape) > 1.0
            && b.shape.outer.iter().all(|p| p.x.is_finite() && p.y.is_finite())), "{culture}");
    }
}

#[test]
#[ignore = "set BRIDGE_STREETS to captured bridge-stage streets"]
fn captured_bridge_stage() {
    let fixture: Fixture = serde_json::from_str(include_str!("fixtures/panic20k.json")).unwrap();
    let data = include_bytes!("fixtures/panic20k-ground.bin");
    let count = fixture.n * fixture.n;
    let height: Vec<_> = data[..count * 4].chunks_exact(4)
        .map(|b| f32::from_le_bytes(b.try_into().unwrap())).collect();
    let geometry = Geography::new(fixture.geometry, fixture.width).unwrap();
    let surface = Surface { geometry: Some(&geometry), width: fixture.width, n: fixture.n,
        height: &height, water: &data[count * 4..] };
    let mut streets: Vec<Street> = serde_json::from_slice(&std::fs::read(std::env::var_os("BRIDGE_STREETS").unwrap()).unwrap()).unwrap();
    let start = std::time::Instant::now();
    network::bridge_water_on_ground(&mut streets, surface, surface, fixture.layout_config.max_street_grade);
    eprintln!("captured bridge stage: {:?}", start.elapsed());
    if let Some(path) = std::env::var_os("BRIDGE_OUTPUT") { std::fs::write(path, serde_json::to_vec(&streets).unwrap()).unwrap(); }
}
