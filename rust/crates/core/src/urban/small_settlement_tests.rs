//! A 500-inhabitant settlement is built, and a walled one is built tight.
use super::geometry as g;
use super::*;

/// (parcels, building requests, enclosed area m2, walled) of one 500-hab. village on flat land.
fn village(culture: &str, population: u32) -> (usize, usize, f64, bool) {
    let n = 64;
    let h = vec![10.0_f32; n * n];
    let w = vec![0_u8; n * n];
    let level = vec![0.0_f32; n * n];
    let s = Surface { geometry: None, width: 4000.0, n, height: &h, water: &w };
    let site = Site {
        key: "probe".into(),
        name: String::new(),
        population,
        culture: culture.into(),
        center: Point { x: 2000.0, y: 2000.0 },
        radius: 150.0,
    };
    let layout_config: LayoutConfig = serde_json::from_str(include_str!("fixtures/small-layout-config.json")).unwrap();
    let parcel_config: ParcelConfig = serde_json::from_str(include_str!("fixtures/small-parcel-config.json")).unwrap();
    let layouts = generate_quarters("small-settlement", &[site], &layout_config, s, &[]).unwrap();
    if std::env::var("SURVEY_WARN").is_ok() { for w in &layouts[0].warnings { println!("WARN {culture}: {w}"); } }
    let parts = generate_parcels("small-settlement", &layouts, &parcel_config).unwrap();
    let ids = (0..layouts.len()).collect::<Vec<_>>();
    let mut index = building_sites::BuildingSiteIndex::prepare(&layouts, &parts, &ids).unwrap();
    let mut sites = 0;
    loop {
        let page = index.page("small-settlement", &layouts, &parts, s, &level, None, sites, 64, 24 * 1024 * 1024).unwrap();
        sites += page.requests.len();
        if sites == page.total || page.requests.is_empty() {
            break;
        }
    }
    let enclosure = layouts[0].enclosures.first().map_or(0.0, |e| {
        g::area(&Shape { outer: e.path.clone(), holes: vec![] })
    });
    (parts.iter().map(|p| p.parcels.len()).sum(), sites, enclosure, !layouts[0].enclosures.is_empty())
}

#[test]
fn a_walled_medina_of_500_is_packed_inside_its_wall() {
    let (parcels, sites, enclosed, walled) = village("medina", 500);
    eprintln!("medina parcels={parcels} sites={sites} enclosed_ha={:.2}", enclosed / 1e4);
    assert!(walled);
    // 500 inhabitants at an intra-muros gross density of at least 150 hab./ha.
    assert!(enclosed <= 500.0 / 150.0 * 1e4, "enclosure {:.1} ha", enclosed / 1e4);
    assert!(sites >= 30, "sites {sites}");
}

#[test]
#[ignore]
fn survey_every_culture_at_500() {
    let cat = catalogue();
    for id in cat["cultures"].as_object().unwrap().keys() {
        let (p, s, e, w) = village(id, 500);
        println!("SURVEY {id:24} parcels={p:4} sites={s:4} enclosed_ha={:6.2} walled={w}", e / 1e4);
    }
}
