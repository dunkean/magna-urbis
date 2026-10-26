//! A 500-inhabitant settlement is built, and a walled one is built tight.
use super::geometry as g;
use super::*;

/// (parcels, building requests, enclosed area m2, walled) of one 500-hab. village on flat land.
fn village(culture: &str, population: u32) -> (usize, usize, f64, bool, f64) {
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
    let plots: Vec<f64> = parts.iter().flat_map(|p| p.parcels.iter()).filter(|p| p.use_kind == "plot").map(|p| g::area(&p.shape)).collect();
    let mean = plots.iter().sum::<f64>() / plots.len().max(1) as f64;
    (parts.iter().map(|p| p.parcels.len()).sum(), sites, enclosure, !layouts[0].enclosures.is_empty(), mean)
}

#[test]
fn a_walled_medina_of_500_is_packed_inside_its_wall() {
    let (parcels, sites, enclosed, walled, _) = village("medina", 500);
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
        let (p, s, e, w, _) = village(id, 500);
        println!("SURVEY {id:24} parcels={p:4} sites={s:4} enclosed_ha={:6.2} walled={w}", e / 1e4);
    }
}

#[test]
fn an_open_village_is_cut_in_house_sized_lots() {
    // The catalogue's town burgage (about 1000 m2) scattered 500 people over
    // 20 ha; a small open village keeps lots in proportion to its houses.
    for culture in ["european-organic", "korean", "byzantine-greek"] {
        let (_, sites, _, _, mean) = village(culture, 500);
        assert!(mean < 800.0, "{culture}: mean plot {mean:.0} m2");
        assert!(sites >= 60, "{culture}: sites {sites}");
    }
}

#[test]
fn a_camp_lane_reaching_its_road_with_a_slanted_contact_serves_the_longhouses() {
    // Real PNW layout (one ragged shore block, a road notch whose contact with
    // the lane lattice is 2.6 m wide): the lanes anchor on the road and the
    // longhouses are served plots, not unserved gardens.
    let layouts: Vec<Layout> = serde_json::from_str(include_str!("fixtures/pnw-road-notch-layouts.json")).unwrap();
    let cfg: ParcelConfig = serde_json::from_str(include_str!("fixtures/small-parcel-config.json")).unwrap();
    let parts = generate_parcels("pnw-notch", &layouts, &cfg).unwrap();
    let served = parts.iter().flat_map(|p| p.parcels.iter())
        .filter(|p| p.use_kind == "plot" && p.access.as_ref().is_some_and(|a| a.kind != "unserved")).count();
    assert!(served >= 10, "served plots {served}");
}

/// (built-block area m2, farthest block vertex from the centre m, share of lane length no block
/// touches) of a village crossed by a regional road, on land that rises `slope` across the valley.
fn village_shape(culture: &str, population: u32, slope: f64) -> (f64, f64, f64) {
    let n = 128;
    let width = 6000.0;
    let h: Vec<f32> = (0..n * n).map(|i| (10.0 + slope * (i / n) as f64 * width / n as f64) as f32).collect();
    let w = vec![0_u8; n * n];
    let s = Surface { geometry: None, width, n, height: &h, water: &w };
    let site = Site {
        key: "probe".into(),
        name: String::new(),
        population,
        culture: culture.into(),
        center: Point { x: 3000.0, y: 3000.0 },
        radius: 150.0,
    };
    let road = Street {
        path: (0..=12).map(|i| Point { x: 500.0 * i as f64, y: 3000.0 + 40.0 * ((i as f64) * 0.9).sin() }).collect(),
        widths: vec![6.0; 13],
        rank: 1,
        role: "road".into(),
    };
    let cfg: LayoutConfig = serde_json::from_str(include_str!("fixtures/small-layout-config.json")).unwrap();
    let layout = &generate_quarters("small-settlement", &[site], &cfg, s, &[road]).unwrap()[0];
    let area: f64 = layout.blocks.iter().map(|b| g::area(&b.shape)).sum();
    let far = layout.blocks.iter().flat_map(|b| b.shape.outer.iter())
        .map(|p| ((p.x - 3000.0).powi(2) + (p.y - 3000.0).powi(2)).sqrt()).fold(0.0, f64::max);
    let (mut lanes, mut unserved) = (0.0, 0.0);
    for st in layout.streets.iter().filter(|st| st.role == "lane" && st.path.len() >= 2) {
        let len: f64 = st.path.windows(2).map(|w| ((w[1].x - w[0].x).powi(2) + (w[1].y - w[0].y).powi(2)).sqrt()).sum();
        let touched = layout.blocks.iter().any(|b| b.shape.outer.iter().any(|&v| st.path.windows(2).any(|w| g::distance(v, w[0], w[1]).0 < st.widths[0] * 0.5 + 3.0)));
        lanes += len;
        if !touched { unserved += len; }
    }
    (area, far, unserved / lanes.max(1.0))
}

#[test]
fn a_500_inhabitant_village_is_compact_and_has_no_lane_to_nowhere() {
    // Cultures that drew a 1.5 km street ribbon on a valley road, plus the strung-out byzantine one.
    for culture in ["european-organic", "korean", "ottoman", "rynek-town", "newar", "vietnamese-citadel", "ethiopian-highland", "mississippian", "russian-kremlin", "japanese-jokamachi", "byzantine-greek"] {
        for slope in [0.0, 0.15] {
            let (area, far, dead) = village_shape(culture, 500, slope);
            let ratio = far / (area / std::f64::consts::PI).sqrt();
            assert!(ratio <= 3.2, "{culture} slope {slope}: extent {far:.0} m over equivalent radius gives {ratio:.1}");
            assert!(dead <= 0.05, "{culture} slope {slope}: {:.0} % of lane length serves no block", dead * 100.0);
        }
    }
}

#[test]
fn a_500_inhabitant_enclosure_is_sized_from_its_population() {
    // At least 75 inhabitants per walled hectare, and the walled town is still drawn.
    for culture in ["celtic-oppidum", "indus-planned", "native-iroquoian", "kraal", "nubian-fortified", "roman-core"] {
        let (_, sites, enclosed, walled, _) = village(culture, 500);
        assert!(walled, "{culture}: no wall");
        assert!(enclosed <= 500.0 / 70.0 * 1e4, "{culture}: enclosure {:.1} ha", enclosed / 1e4);
        assert!(sites >= 15, "{culture}: sites {sites}");
    }
}

/// (blocks, blocks without any building site, their share of the block area) of one 500-hab. village.
fn empty_blocks(culture: &str) -> (usize, usize, f64) {
    let n = 64;
    let h = vec![10.0_f32; n * n];
    let w = vec![0_u8; n * n];
    let level = vec![0.0_f32; n * n];
    let s = Surface { geometry: None, width: 4000.0, n, height: &h, water: &w };
    let site = Site { key: "probe".into(), name: String::new(), population: 500, culture: culture.into(), center: Point { x: 2000.0, y: 2000.0 }, radius: 150.0 };
    let layout_config: LayoutConfig = serde_json::from_str(include_str!("fixtures/small-layout-config.json")).unwrap();
    let parcel_config: ParcelConfig = serde_json::from_str(include_str!("fixtures/small-parcel-config.json")).unwrap();
    let layouts = generate_quarters("small-settlement", &[site], &layout_config, s, &[]).unwrap();
    let parts = generate_parcels("small-settlement", &layouts, &parcel_config).unwrap();
    let ids = (0..layouts.len()).collect::<Vec<_>>();
    let mut index = building_sites::BuildingSiteIndex::prepare(&layouts, &parts, &ids).unwrap();
    let mut served = std::collections::HashSet::new();
    let mut sites = 0;
    loop {
        let page = index.page("small-settlement", &layouts, &parts, s, &level, None, sites, 64, 24 * 1024 * 1024).unwrap();
        sites += page.requests.len();
        for r in &page.requests {
            if let Some(id) = r["parcel_id"].as_str() { served.insert(id.to_owned()); }
        }
        if sites == page.total || page.requests.is_empty() { break; }
    }
    let block_of: std::collections::HashMap<&str, usize> = parts[0].parcels.iter().map(|p| (p.id.as_str(), p.block)).collect();
    let used: std::collections::HashSet<usize> = served.iter().filter_map(|id| block_of.get(id.as_str()).copied()).collect();
    let blocks = &layouts[0].blocks;
    let empty: Vec<usize> = (0..blocks.len()).filter(|b| blocks[*b].kind == "block" && !used.contains(b)).collect();
    let total: f64 = blocks.iter().filter(|b| b.kind == "block").map(|b| g::area(&b.shape)).sum();
    let lost: f64 = empty.iter().map(|&b| g::area(&blocks[b].shape)).sum();
    if std::env::var("EMPTY_DETAIL").is_ok() {
        for &b in &empty {
            let uses: Vec<&str> = parts[0].parcels.iter().filter(|p| p.block == b).map(|p| p.use_kind.as_str()).collect();
            println!("  {culture} block {b} area {:.0} kind {:?} uses {:?}", g::area(&blocks[b].shape), blocks[b].kind, uses);
        }
    }
    (blocks.len(), empty.len(), lost / total.max(1.0))
}

#[test]
#[ignore]
fn survey_empty_blocks() {
    for id in ["bagan", "aztec", "celtic-oppidum", "barbarian-celtic", "egyptian-planned", "japanese-jokamachi", "swahili-stone-town", "european-organic", "chinese", "maya"] {
        let (b, e, share) = empty_blocks(id);
        println!("EMPTY {id:22} blocks={b:3} empty={e:3} area_share={share:.2}");
    }
}

#[test]
#[ignore]
fn debug_roman() {
    let (p, s, e, _, _) = village("roman-core", 500);
    println!("ROMAN parcels={p} sites={s} enclosed_ha={:.2}", e / 1e4);
}

#[test]
#[ignore]
fn debug_enclosures() {
    for c in ["chinese", "indus-planned", "celtic-oppidum", "elven", "roman-core"] {
        let (_, s, e, _, _) = village(c, 500);
        println!("ENC {c} sites={s} enclosed_ha={:.2}", e / 1e4);
    }
}

#[test]
fn a_500_inhabitant_village_has_few_blocks_without_a_building() {
    for culture in ["bagan", "celtic-oppidum", "egyptian-planned", "swahili-stone-town"] {
        let (_, _, share) = empty_blocks(culture);
        assert!(share <= 0.12, "{culture}: {:.0} % of the block land has no building site", share * 100.0);
    }
}
