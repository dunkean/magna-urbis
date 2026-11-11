//! A 500-inhabitant settlement is built, and a walled one is built tight.
use super::geometry as g;
use super::*;

/// (parcels, building requests, enclosed area m2, walled) of one 500-hab. village on flat land.
fn village(culture: &str, population: u32) -> (usize, usize, f64, bool, f64) {
    village_with(culture, population, None)
}
/// Same village with the culture's own enclosure requested: most villages are drawn open (a rare walled one is
/// a per-site draw), so the tests of a walled village ask for its wall.
fn walled_village(culture: &str, population: u32) -> (usize, usize, f64, bool, f64) {
    village_with(culture, population, Some(profiles::profile(culture).fortification))
}
fn village_with(culture: &str, population: u32, fortification: Option<&str>) -> (usize, usize, f64, bool, f64) {
    let n = 64;
    let h = vec![10.0_f32; n * n];
    let w = vec![0_u8; n * n];
    let level = vec![0.0_f32; n * n];
    let s = Surface { geometry: None, width: 4000.0, n, height: &h, water: &w, interpolation: Default::default(),};
    let site = Site {
        key: "probe".into(),
        name: String::new(),
        population,
        culture: culture.into(),
        center: Point { x: 2000.0, y: 2000.0 },
        radius: 150.0,
    };
    let mut layout_config: LayoutConfig = serde_json::from_str(include_str!("fixtures/small-layout-config.json")).unwrap();
    if let Some(kind) = fortification.filter(|k| *k != "none") { layout_config.fortification = kind.into(); }
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
    let plots: Vec<f64> = parts.iter().flat_map(|p| p.parcels.iter())
        .filter(|p| p.use_kind == "plot" && !p.provenance.iter().any(|s| s == "occupied-yard-merge"))
        .map(|p| g::area(&p.shape)).collect();
    let mean = plots.iter().sum::<f64>() / plots.len().max(1) as f64;
    (parts.iter().map(|p| p.parcels.len()).sum(), sites, enclosure, !layouts[0].enclosures.is_empty(), mean)
}

#[test]
fn a_walled_medina_of_500_is_packed_inside_its_wall() {
    let (parcels, sites, enclosed, walled, _) = walled_village("medina", 500);
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
    if let Ok(dir)=std::env::var("FILL2_OUT") {
        std::fs::create_dir_all(&dir).unwrap();
        let morph=resolve("pnw-plank-village","culture","auto","core",1.,&serde_json::json!({}),"parcels").unwrap();
        let raw=parcels::generate("pnw-notch",&layouts[0],&cfg,&morph).unwrap();
        std::fs::write(std::path::Path::new(&dir).join("plank-notch.json"),serde_json::to_vec(&serde_json::json!({"partition":parts[0],"raw":raw})).unwrap()).unwrap();
    }
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
    let s = Surface { geometry: None, width, n, height: &h, water: &w, interpolation: Default::default(),};
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
        let (_, sites, enclosed, walled, _) = walled_village(culture, 500);
        assert!(walled, "{culture}: no wall");
        assert!(enclosed <= 500.0 / 70.0 * 1e4, "{culture}: enclosure {:.1} ha", enclosed / 1e4);
        assert!(sites >= 15, "{culture}: sites {sites}");
    }
}

const TRIM_CULTURES: [&str; 15] = ["al-andalus", "hausa-kano", "hadhrami-tower", "hanseatic", "inuit-camp", "aztec", "barbarian-celtic", "celtic-oppidum", "egyptian-planned", "japanese-jokamachi", "bagan", "swahili-stone-town", "european-organic", "medina", "kraal"];

/// (blocks, blocks without any building site, their share of the block area) of one 500-hab. village.
fn empty_blocks(culture: &str) -> (usize, usize, f64) {
    let n = 64;
    let h = vec![10.0_f32; n * n];
    let w = vec![0_u8; n * n];
    let level = vec![0.0_f32; n * n];
    let s = Surface { geometry: None, width: 4000.0, n, height: &h, water: &w, interpolation: Default::default(),};
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
    if std::env::var("EMPTY_DETAIL").is_ok() || std::env::var("TRIM_DETAIL").is_ok() {
        let open = blocks.iter().filter(|b| b.kind == "reserve").count();
        let len: f64 = layouts[0].streets.iter().filter(|s| matches!(s.role.as_str(), "street" | "lane")).flat_map(|s| s.path.windows(2)).map(|w| (w[1].x - w[0].x).hypot(w[1].y - w[0].y)).sum();
        println!("  {culture}: ordinary {} reserve {open} street+lane length {len:.0} m; {:?}", blocks.iter().filter(|b| b.kind == "block").count(), layouts[0].warnings.iter().filter(|w| w.contains("champs")).collect::<Vec<_>>());
    }
    (blocks.len(), empty.len(), lost / total.max(1.0))
}

#[test]
#[ignore]
fn survey_empty_blocks() {
    for id in TRIM_CULTURES {
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

#[test]
fn unbuilt_blocks_are_given_back_to_the_fields() {
    for culture in TRIM_CULTURES.into_iter().chain(["mongol-ordu", "guarani-village", "pnw-plank-village"]) {
        let (_, _, share) = empty_blocks(culture);
        assert!(share <= 0.05, "{culture}: {:.0} % of the block land has no building site", share * 100.0);
    }
}

fn village_layout(culture: &str, population: u32) -> Layout {
    let n = 64;
    let h = vec![10.0_f32; n * n];
    let w = vec![0_u8; n * n];
    let s = Surface { geometry: None, width: 4000.0, n, height: &h, water: &w, interpolation: Default::default(),};
    let site = Site { key: "probe".into(), name: String::new(), population, culture: culture.into(), center: Point { x: 2000.0, y: 2000.0 }, radius: 150.0 };
    let cfg: LayoutConfig = serde_json::from_str(include_str!("fixtures/small-layout-config.json")).unwrap();
    generate_quarters("small-settlement", &[site], &cfg, s, &[]).unwrap().remove(0)
}

const FILL_CASES: &[(&str,u32)] = &[
        ("barbarian-norse",500),("celtic-oppidum",500),("giant-hold",500),("gnomish",500),
        ("himalayan-terraces",500),("indus-planned",500),("levantine-tell",500),("maori-pa",500),
        ("maya",500),("merfolk-tidal",500),("mesopotamian",500),("native-iroquoian",500),
        ("necropolis",500),("norse-ringfort",500),("oasis-caravan",500),("persian",500),
        ("sahel",500),("swahili-stone-town",500),("european-organic",500),("roman-core",500),
        ("hadhrami-tower",500),("hausa-kano",500),("japanese-jokamachi",500),("venetian-lagoon",500),
        ("medina",10000),("celtic-oppidum",10000),("duergar-hold",10000),("rajput-fort",10000),("chinese",10000),
    ];

#[test]
#[ignore]
fn survey_fill() {
    for &(culture, population) in FILL_CASES {
        let layout = village_layout(culture, population);
        let parts = generate_parcels("small-settlement", std::slice::from_ref(&layout), &ParcelConfig::default()).unwrap();
        let pr = parts[0].programme.as_ref().unwrap();
        let used: std::collections::HashSet<_> = pr.allocations.iter().filter(|a| !a.role.starts_with("open.")).map(|a| a.parcel_id.as_str()).collect();
        let built: std::collections::HashSet<_> = parts[0].parcels.iter().filter(|p| used.contains(p.id.as_str())).map(|p| p.block).collect();
        let inside = |b: &Block| layout.enclosures.iter().any(|e| g::contains(&Shape{outer:e.path.clone(),holes:vec![]},g::interior_point(&b.shape)));
        let empty: Vec<_> = layout.blocks.iter().enumerate().filter(|(i,b)| matches!(b.kind.as_str(),"block"|"reserve") && !built.contains(i) && (inside(b) || b.kind == "block")).collect();
        let housed:f64 = pr.allocations.iter().map(|a| a.households).sum();
        let wanted:f64 = pr.demands.iter().filter(|d|d.unit=="domesticUnits").map(|d|d.requested).sum();
        println!("FILL {culture} {population}: blocks {} empty {} area {:.0} households {housed:.0}/{wanted:.0}",layout.blocks.len(),empty.len(),empty.iter().map(|(_,b)|g::area(&b.shape)).sum::<f64>());
        for (i,b) in empty { println!("  {i} {} {} {:.0} {:?}",b.kind,b.zone,g::area(&b.shape),parts[0].parcels.iter().filter(|p|p.block==i).map(|p|(&p.use_kind,&p.reason)).collect::<Vec<_>>()); }
    }
}

#[test]
fn serviced_quarters_fill_from_the_core_with_a_bounded_population() {
    let cases: std::collections::BTreeSet<_> = FILL_CASES.iter().copied().chain(TRIM_CULTURES.map(|c|(c,500))).collect();
    for (culture, population) in cases {
        let layout = village_layout(culture, population);
        let layouts = std::slice::from_ref(&layout);
        let parts = generate_parcels("small-settlement", layouts, &ParcelConfig::default()).unwrap();
        let n = 64;
        let height = vec![10.; n*n];
        let water = vec![0; n*n];
        let level = vec![0.; n*n];
        let surface = Surface { geometry:None, width:4000., n, height:&height, water:&water, interpolation: Default::default(),};
        let mut index = building_sites::BuildingSiteIndex::prepare(layouts, &parts, &[0]).unwrap();
        let mut ids = std::collections::HashSet::new();
        let mut offset = 0;
        loop {
            let page = index.page("small-settlement", layouts, &parts, surface, &level, None, offset, 64, 24*1024*1024).unwrap();
            offset += page.requests.len();
            for r in &page.requests { if let Some(id) = r["parcel_id"].as_str() { ids.insert(id.to_owned()); } }
            if offset == page.total || page.requests.is_empty() { break; }
        }
        let lots: Vec<_> = parts[0].parcels.iter().filter(|p| ids.contains(&p.id)).collect();
        let built: std::collections::HashSet<_> = lots.iter().map(|p|p.block).collect();
        let rings: Vec<_> = layout.enclosures.iter().map(|e|Shape{outer:e.path.clone(),holes:vec![]}).collect();
        let frontage: Vec<_> = parts[0].parcels.iter().filter(|p| ids.contains(&p.id)
            || (matches!(layout.blocks[p.block].zone.as_str(),"core"|"middle") || rings.iter().any(|r|g::contains(r,g::interior_point(&p.shape))))
                && p.access.as_ref().is_some_and(|a|a.kind == "attached") && p.parent_ids.iter().any(|id|ids.contains(id))).collect();
        let relevant = |b: &Block| b.kind == "block" || b.kind == "reserve" && rings.iter().any(|r|g::contains(r,g::interior_point(&b.shape)));
        let (mut total,mut empty,mut core,mut core_empty) = (0.,0.,0.,0.);
        for (bi,b) in layout.blocks.iter().enumerate().filter(|(_,b)|relevant(b)) {
            let area = g::area(&b.shape);
            total += area;
            if !built.contains(&bi) { empty += area; }
            if b.zone == "core" { core += area; if !built.contains(&bi) { core_empty += area; } }
        }
        assert!(empty <= total*0.01, "{culture} {population}: empty {empty:.0}/{total:.0} m²");
        assert!(core_empty <= core*0.01, "{culture} {population}: empty core {core_empty:.0}/{core:.0} m²");
        let pr = parts[0].programme.as_ref().unwrap();
        let wanted:f64 = pr.demands.iter().filter(|d|d.unit=="domesticUnits").map(|d|d.requested).sum();
        let held:f64 = pr.allocations.iter().map(|a|a.households).sum();
        assert!(held <= (wanted*1.3).floor().max(wanted.ceil()), "{culture}: {held} households for {wanted}");
        for (si,s) in layout.streets.iter().enumerate().filter(|(_,s)| matches!(s.role.as_str(),"street"|"lane"|"radial"|"ring"|"market"|"track"|"derb"|"close"|"hutong"|"roji"|"private"|"collective"|"stairs") && !(s.role == "track" && s.rank >= 4) && s.path.len()>=2) {
            for (terminal, end, segment) in [(0,s.path[0],&s.path[..2]),(s.path.len()-2,*s.path.last().unwrap(),&s.path[s.path.len()-2..])] {
                let connected = layout.streets.iter().enumerate().any(|(j,t)| t.path.windows(2).enumerate().any(|(k,w)|
                    if j==si { k.abs_diff(terminal)>1 && g::distance(end,w[0],w[1]).0<=0.75 }
                    else { g::distance(end,w[0],w[1]).0 <= t.widths.first().copied().unwrap_or(4.)*0.5+1.5 }));
                if connected { continue; }
                let reach = s.widths.iter().copied().fold(0.,f64::max)*0.5+3.5;
                let serves = frontage.iter().any(|p|g::contains(&p.shape,end) || p.shape.outer.iter().zip(p.shape.outer.iter().cycle().skip(1)).any(|(&a,&b)| {
                    g::segment_hit(segment[0],segment[1],a,b).is_some()
                        || g::distance(a,segment[0],segment[1]).0<=reach || g::distance(b,segment[0],segment[1]).0<=reach
                        || g::distance(segment[0],a,b).0<=reach || g::distance(segment[1],a,b).0<=reach
                }));
                if !serves && std::env::var("FILL_DUMP").is_ok() {
                    std::fs::write(std::env::temp_dir().join(format!("magna-fill-{culture}-{population}.json")),serde_json::to_vec(&serde_json::json!({"layout":layout,"parts":parts,"built":ids,"street":si,"end":end})).unwrap()).unwrap();
                }
                assert!(serves,"{culture} {population}: {} dead end at {:.1},{:.1} serves no building lot",s.role,end.x,end.y);
            }
        }
    }
}

#[test]
fn an_overlarge_enclosure_replans_its_land_budget_before_filling() {
    let n = 64;
    let height = vec![10.;n*n];
    let water = vec![0;n*n];
    let surface = Surface{geometry:None,width:6000.,n,height:&height,water:&water, interpolation: Default::default(),};
    let site = Site{key:"fill-budget".into(),name:String::new(),population:500,culture:"celtic-oppidum".into(),center:Point{x:3000.,y:3000.},radius:150.};
    let mut cfg: LayoutConfig = serde_json::from_str(include_str!("fixtures/small-layout-config.json")).unwrap();
    cfg.footprint.gross_density = 5.;
    let layout = generate_quarters("fill-budget",&[site],&cfg,surface,&[]).unwrap().remove(0);
    assert!(!layout.enclosures.is_empty());
    assert!(layout.warnings.iter().any(|w|w.starts_with("Emprise intra-muros réduite")),"enclosure did not replan its excessive budget");
    assert!(layout.structure.as_ref().unwrap().metrics.target_area < 1_000_000.);
    let parts = generate_parcels("fill-budget",&[layout],&ParcelConfig::default()).unwrap();
    let pr = parts[0].programme.as_ref().unwrap();
    let wanted:f64 = pr.demands.iter().filter(|d|d.unit=="domesticUnits").map(|d|d.requested).sum();
    assert!(pr.allocations.iter().map(|a|a.households).sum::<f64>() <= (1.3*wanted).floor());
}

const FILL2_CULTURES: &[&str] = &["barbarian-celtic", "celtic-oppidum", "himalayan-terraces", "indus-planned", "native-iroquoian", "norse-ringfort", "swahili-stone-town", "goblin-warren", "ksar-oasis", "medina", "roman-core", "kraal", "native-plains", "nomad-camp", "mongol-ordu", "inuit-camp", "guarani-village", "pnw-plank-village"];

#[test]
fn village_open_uses_share_the_town_instead_of_emptying_whole_quarters() {
    for culture in ["roman-core", "oasis-caravan", "persian"] {
        let layout = village_layout(culture, 500);
        let part = generate_parcels("small-settlement", std::slice::from_ref(&layout), &ParcelConfig::default()).unwrap().remove(0);
        let pr = part.programme.as_ref().unwrap();
        let open_area: f64 = pr.allocations.iter().filter(|a| a.function == "common" && a.role != "open.garden")
            .filter_map(|a|part.parcels.iter().find(|p|p.id == a.parcel_id)).map(|p|g::area(&p.shape)).sum();
        let land: f64 = layout.blocks.iter().map(|b|g::area(&b.shape)).sum();
        assert!(open_area < land * 0.15, "{culture}: commons/cemetery take {open_area:.0}/{land:.0} m²");
        assert!(pr.allocations.iter().any(|a|a.role == "open.common"), "{culture}: communal land must remain");
        let cemetery = pr.demands.iter().find(|d|d.role == "open.cemetery" || d.role == "open.necropolis").unwrap();
        assert!(pr.allocations.iter().any(|a|a.demand_id == cemetery.id), "{culture}: cemetery must remain");
    }
}

#[test]
#[ignore]
fn survey_fill2_parcels() {
    for &culture in FILL2_CULTURES {
        let layout = village_layout(culture, 500);
        let parts = generate_parcels("small-settlement", std::slice::from_ref(&layout), &ParcelConfig::default()).unwrap();
        let pr = parts[0].programme.as_ref().unwrap();
        let mut counts = std::collections::BTreeMap::new();
        for p in &parts[0].parcels {
            let a = pr.allocations.iter().find(|a| a.parcel_id == p.id);
            let key = a.map_or(p.use_kind.as_str(), |a| a.role.as_str());
            *counts.entry(key).or_insert(0) += 1;
        }
        println!("FILL2 {culture}: {} lots {counts:?}; streets {:?}", parts[0].parcels.len(), layout.streets.iter().map(|s| (&s.role,s.path.len())).collect::<Vec<_>>());
    }
}

#[test]
fn reviewed_villages_have_no_unoccupied_parcels() {
    let n = 64;
    let height = vec![10.; n*n];
    let water = vec![0; n*n];
    let level = vec![0.; n*n];
    let surface = Surface { geometry:None, width:4000., n, height:&height, water:&water, interpolation: Default::default(),};
    let mut failures = vec![];
    for &culture in FILL2_CULTURES {
        let layout = village_layout(culture, 500);
        let layouts = std::slice::from_ref(&layout);
        let parts = generate_parcels("small-settlement", layouts, &ParcelConfig::default()).unwrap();
        let pr = parts[0].programme.as_ref().unwrap();
        let requests = building_sites::requests("small-settlement", layouts, &parts, surface, &level, None).unwrap();
        if kinds::native_camp(&layout.culture, 500, layout.config.as_ref().unwrap()) {
            assert!(!pr.allocations.iter().any(|a| a.role == "open.garden"), "{culture}: vacant cadastral garden");
            assert!(!layout.streets.iter().any(|s| s.role == "outbound"), "{culture}: urban exit feeder in a camp");
        }
        let mut bare = vec![];
        for p in &parts[0].parcels {
            let allocation = pr.allocations.iter().find(|a| a.parcel_id == p.id);
            let occupied = if let Some(a) = allocation {
                if a.role.starts_with("open.") || matches!(a.function.as_str(), "market"|"common") { true }
                else { requests.iter().any(|r| r["parcel_id"] == p.id && r["preview"].as_array().is_some_and(|a| !a.is_empty())) }
            } else {
                matches!(p.use_kind.as_str(), "path"|"place"|"byre"|"court")
                    || p.use_kind == "common" && p.reason == "common:verge" && g::area(&p.shape) < 100. && p.envelope.is_none()
                    || p.use_kind == "reserve" && p.family == "reserve" && !layout.enclosures.iter().any(|e|
                        g::contains(&Shape { outer:e.path.clone(), holes:vec![] }, g::interior_point(&p.shape)))
                    || p.use_kind == "garden" && (p.family == "reserve" || p.reason == "camp-open"
                        || p.access.as_ref().is_some_and(|a| a.kind == "attached") && p.parent_ids.iter().any(|id|
                            pr.allocations.iter().any(|a| &a.parcel_id == id && !a.role.starts_with("open."))))
            };
            if !occupied { bare.push((&p.id,&p.use_kind,&p.reason,allocation.map(|a|&a.role))); }
        }
        println!("OCCUPIED {culture}: bare {}/{} {bare:?}",bare.len(),parts[0].parcels.len());
        if let Ok(dir) = std::env::var("FILL2_OUT") {
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(std::path::Path::new(&dir).join(format!("{culture}.json")),
                serde_json::to_vec(&serde_json::json!({"layout":layout,"partition":parts[0],"requests":requests})).unwrap()).unwrap();
        }
        let tolerance = if kinds::native_camp(&layout.culture, 500, layout.config.as_ref().unwrap()) { 0. } else { 0.01 };
        if bare.len() as f64 > tolerance * parts[0].parcels.len() as f64 { failures.push(format!("{culture}: {bare:?}")); }
        for r in requests.iter().filter(|r| r["programme"]["role"].as_str().is_some_and(|s| s.starts_with("worship.mosque") || s.starts_with("worship.masjid"))) {
            assert!(r["preview_parts"].as_array().unwrap().iter().any(|p| p == "prayer-hall"), "{culture}: mosque without prayer hall: {r}");
        }
        for r in &pr.reservations {
            let d = pr.demands.iter().find(|d| d.id == r.demand_id).unwrap();
            if d.landmark && !d.role.starts_with("open.") && !matches!(d.function.as_str(), "market" | "common") {
                assert!(pr.allocations.iter().any(|a| a.demand_id == d.id && requests.iter().any(|r|
                    r["parcel_id"] == a.parcel_id && r["preview"].as_array().is_some_and(|p| !p.is_empty()))),
                    "{culture}: reserved landmark {} has no building", d.role);
            }
        }
        let wanted: f64 = pr.demands.iter().filter(|d| d.unit == "domesticUnits").map(|d|d.requested).sum();
        let housed: f64 = pr.allocations.iter().map(|a|a.households).sum();
        assert!(housed <= (wanted*1.3).floor().max(wanted.ceil()), "{culture}: {housed}/{wanted}");
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

#[test]
fn camps_leave_their_commons_free_of_generic_access_lanes() {
    for culture in ["kraal", "native-plains", "nomad-camp", "mongol-ordu"] {
        let layout = village_layout(culture, 500);
        assert!(layout.streets.iter().all(|s| !matches!(s.role.as_str(), "collective"|"private"|"close"|"derb"|"hutong"|"roji")), "{culture}: generic lane crosses camp");
        assert!(layout.streets.iter().filter(|s| !matches!(s.role.as_str(), "regional"|"road"|"bridge"|"ford"|"causeway"))
            .all(|s| s.widths.iter().all(|&w|w <= 3.)), "{culture}: urban streets in a camp");
    }
}

#[test]
fn communal_longhouses_keep_their_family_capacity_and_served_rows() {
    let layout = village_layout("native-iroquoian",500);
    let parts = generate_parcels("small-settlement", &[layout], &ParcelConfig::default()).unwrap();
    let pr = parts[0].programme.as_ref().unwrap();
    let housed: f64 = pr.allocations.iter().map(|a| a.households).sum();
    let wanted: f64 = pr.demands.iter().filter(|d|d.unit == "domesticUnits").map(|d|d.requested).sum();
    assert!(pr.allocations.iter().any(|a| a.households > 1.), "a communal longhouse can hold several families");
    assert!(housed >= wanted*0.9, "only {housed}/{wanted} families: the rows must reach the entrance");
}

#[test]
fn plank_house_count_follows_population_at_its_declared_metric_size() {
    let mut previous = 0;
    let mut failures = vec![];
    for population in [200, 500, 1000] {
        let layout = village_layout("pnw-plank-village", population);
        let n = 64;
        let height = vec![10.; n*n]; let water = vec![0; n*n]; let level = vec![0.; n*n];
        let surface = Surface { geometry:None, width:4000., n, height:&height, water:&water, interpolation: Default::default(),};
        let layouts = std::slice::from_ref(&layout);
        let parts = generate_parcels("small-settlement", layouts, &ParcelConfig::default()).unwrap();
        let requests = building_sites::requests("small-settlement", layouts, &parts, surface, &level, None).unwrap();
        let pr = parts[0].programme.as_ref().unwrap();
        let homes: Vec<_> = requests.iter().filter(|r| pr.allocations.iter().any(|a| r["parcel_id"] == a.parcel_id && a.households > 0.)
            && r["preview"].as_array().is_some_and(|p| !p.is_empty())).collect();
        let housed: f64 = pr.allocations.iter().map(|a| a.households).sum();
        let wanted: f64 = pr.demands.iter().filter(|d|d.unit == "domesticUnits").map(|d|d.requested).sum();
        eprintln!("PLANK {population}: homes={} households={housed}/{wanted}",homes.len());
        if let Ok(dir) = std::env::var("FILL2_OUT") {
            let morph = resolve("pnw-plank-village","culture","auto","core",1.,&serde_json::json!({}),"parcels").unwrap();
            let raw = parcels::generate(&format!("small-settlement\u{1}settlement:{}",layout.key),&layout,&ParcelConfig::default(),&morph).unwrap();
            std::fs::create_dir_all(&dir).unwrap();
            std::fs::write(std::path::Path::new(&dir).join(format!("plank-{population}.json")),
                serde_json::to_vec(&serde_json::json!({"layout":layout,"partition":parts[0],"raw":raw,"requests":requests})).unwrap()).unwrap();
        }
        if homes.len() <= previous { failures.push(format!("{population}: {} homes after {previous}",homes.len())); }
        if population == 500 && homes.len() < 15 { failures.push(format!("500 inhabitants: {} homes",homes.len())); }
        if housed < wanted*0.9 { failures.push(format!("{population}: {housed}/{wanted} households")); }
        assert!(pr.allocations.iter().filter(|a|a.unit == "domesticUnits").all(|a|a.households <= 4.));
        for r in &homes {
            let shapes: Vec<Shape> = serde_json::from_value(r["preview"].clone()).unwrap();
            assert!(shapes.iter().all(|s| g::area(s) <= 9.144*15.24+0.1), "oversized plank house");
        }
        previous = homes.len();
    }
    assert!(failures.is_empty(),"{}",failures.join("\n"));
}

#[test]
#[ignore = "Replays the five city-13 rasters captured by out/fix-v7/villages/capture.mjs"]
fn reviewed_camps_real_map_geometry() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../../web/out/fix-v7/villages");
    for culture in ["mongol-ordu","inuit-camp","pnw-plank-village","guarani-village","kraal"] {
        let f: serde_json::Value = serde_json::from_slice(&std::fs::read(root.join(format!("{culture}-fixture.json"))).unwrap()).unwrap();
        let height:Vec<f32> = serde_json::from_value(f["height"].clone()).unwrap();
        let water:Vec<u8> = serde_json::from_value(f["water"].clone()).unwrap();
        let level:Vec<f32> = serde_json::from_value(f["waterLevel"].clone()).unwrap();
        let surface = Surface { geometry:None,width:f["width"].as_f64().unwrap(),n:f["n"].as_u64().unwrap() as usize,height:&height,water:&water, interpolation: Default::default(),};
        let seed = f["seed"].as_str().unwrap();
        let sites:Vec<Site> = serde_json::from_value(f["sites"].clone()).unwrap();
        let roads:Vec<Street> = serde_json::from_value(f["roads"].clone()).unwrap();
        let cfg:LayoutConfig = serde_json::from_value(f["layoutConfig"].clone()).unwrap();
        let layouts = generate_quarters(seed,&sites,&cfg,surface,&roads).unwrap();
        let parts = generate_parcels(seed,&layouts,&ParcelConfig::default()).unwrap();
        let requests = building_sites::requests(seed,&layouts,&parts,surface,&level,None).unwrap();
        let out = root.join("after").join(culture); std::fs::create_dir_all(&out).unwrap();
        for (name,value) in [("layouts.json",serde_json::to_value(&layouts).unwrap()),("partitions.json",serde_json::to_value(&parts).unwrap()),("requests.json",serde_json::to_value(&requests).unwrap())] {
            std::fs::write(out.join(name),serde_json::to_vec(&value).unwrap()).unwrap();
        }
        eprintln!("CAMP_REVIEW {culture}: {} previews",requests.iter().filter(|r|r["preview"].as_array().is_some_and(|p|!p.is_empty())).count());
    }
}

/// Invariant (no empty camp): a 1500-inhabitant camp keeps a building site
/// per household or so, whatever the lattice draws. The arctic-coast bench
/// case: the camp is one block reached only by the ends of its tracks (a few
/// metres of street front); the inuit footpaths must still start there (they
/// started only where a cell boundary happened to meet that contact: one lot).
/// The nomad ring, at its default growth, pitches one piece per tent (it
/// folded eight tents into one sector lot: 22 homes for 273 households).
#[test]
fn large_camps_reached_by_track_ends_keep_their_homes() {
    let n = 16;
    let (h, w, level) = (vec![10.0_f32; n * n], vec![0_u8; n * n], vec![0.0_f32; n * n]);
    let s = Surface { geometry: None, width: 4000.0, n, height: &h, water: &w, interpolation: Default::default(),};
    let p = |x: f64, y: f64| Point { x, y };
    let track = |a: Point, b: Point, width: f64| Street { path: vec![a, b], widths: vec![width; 2], rank: 2, role: "regional".into() };
    let roads = [
        track(p(0., 2043.), p(1762., 2004.), 2.1),
        track(p(1762., 2004.), p(2000., 2000.), 2.1),
        track(p(2000., 2000.), p(2887., 4000.), 2.1),
        track(p(1762., 2004.), p(515., 3029.), 1.05),
    ];
    let cfg: LayoutConfig = serde_json::from_str(include_str!("fixtures/small-layout-config.json")).unwrap();
    assert_eq!(cfg.camp_growth, "ring", "default growth");
    let mut failures = vec![];
    // Seeds 0, 3, 4 and 7 drew no inuit footpath before the fix.
    for (culture, seeds) in [("inuit-camp", &[0, 3, 4, 7][..]), ("nomad-camp", &[0][..])] {
        for &k in seeds {
            // The bench site keeps its 5000-inhabitant radius (562 m).
            let seed = format!("camp-roads-{k}");
            let site = Site { key: "city".into(), name: String::new(), population: 1500, culture: culture.into(),
                center: p(2000., 2000.), radius: 561.79 };
            let layouts = generate_quarters(&seed, &[site], &cfg, s, &roads).unwrap();
            let parts = generate_parcels(&seed, &layouts, &ParcelConfig::default()).unwrap();
            let requests = building_sites::requests(&seed, &layouts, &parts, s, &level, None).unwrap();
            let built = requests.iter().filter(|r| r["preview"].as_array().is_some_and(|p| !p.is_empty())).count();
            let pr = parts[0].programme.as_ref().unwrap();
            let housed: f64 = pr.allocations.iter().map(|a| a.households).sum();
            let wanted: f64 = pr.demands.iter().filter(|d| d.unit == "domesticUnits").map(|d| d.requested).sum();
            eprintln!("CAMP-ROADS {culture} {seed}: {built} building sites, {housed}/{wanted} households");
            if built <= 120 || housed < 0.8 * wanted {
                failures.push(format!("{culture} {seed}: {built} building sites, {housed}/{wanted} households"));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

/// Review 03/11 (village-500 native-iroquoian, sheet switches on): the
/// longhouse village reached by trails ending at its centre showed one
/// building in 45 parcels. Every longhouse row lot is built and the
/// households are lodged, switches off or on (the City Bench roads of
/// city-temperate-coast-s, simplified).
#[test]
fn review12_a_longhouse_village_on_trail_ends_builds_its_longhouses() {
    let n = 16;
    let (h, w, level) = (vec![10.0_f32; n * n], vec![0_u8; n * n], vec![0.0_f32; n * n]);
    let s = Surface { geometry: None, width: 4000.0, n, height: &h, water: &w, interpolation: Default::default(),};
    let trail = |pts: &[(f64, f64)]| Street { path: pts.iter().map(|&(x, y)| Point { x, y }).collect(), widths: vec![1.62; pts.len()], rank: 2, role: "regional".into() };
    let roads = [
        trail(&[(2261., 1141.), (2254., 1260.), (2220., 1413.), (2168., 1603.), (2164., 1716.), (2105., 1870.), (2020., 1996.)]),
        trail(&[(2020., 1996.), (2000., 2000.)]),
        trail(&[(2600., 2666.), (2474., 2543.), (2471., 2441.), (2373., 2330.), (2271., 2232.), (2174., 2135.), (2066., 2027.)]),
        trail(&[(2020., 1996.), (2042., 2008.), (2066., 2027.)]),
        trail(&[(2066., 2027.), (2098., 2182.), (2099., 2281.), (2121., 2416.), (2145., 2562.), (2123., 2710.), (2021., 2899.)]),
    ];
    let base: LayoutConfig = serde_json::from_str(include_str!("fixtures/small-layout-config.json")).unwrap();
    let sheet = LayoutConfig { natural_camp_approaches: true, street_frontage: true, align_enclosed_grid: true, hide_unused_quarters: true,
        organic_branch_variation: 0.5, ribbon_width_variation: 0.5, ..base.clone() };
    for (name, cfg) in [("off", base), ("sheet", sheet)] {
        let seed = "city-temperate-coast-s-1";
        let site = Site { key: "city".into(), name: String::new(), population: 500, culture: "native-iroquoian".into(),
            center: Point { x: 2000., y: 2000. }, radius: 561.79 };
        let layouts = generate_quarters(seed, &[site], &cfg, s, &roads).unwrap();
        let parts = generate_parcels(seed, &layouts, &ParcelConfig::default()).unwrap();
        let requests = building_sites::requests(seed, &layouts, &parts, s, &level, None).unwrap();
        let built: std::collections::HashSet<&str> = requests.iter().filter(|r| r["preview"].as_array().is_some_and(|p| !p.is_empty()))
            .filter_map(|r| r["parcel_id"].as_str()).collect();
        let lots = parts[0].parcels.iter().filter(|p| p.use_kind == "plot").count();
        let empty = parts[0].parcels.iter().filter(|p| p.use_kind == "plot" && !built.contains(p.id.as_str())).count();
        let pr = parts[0].programme.as_ref().unwrap();
        let housed: f64 = pr.allocations.iter().map(|a| a.households).sum();
        let wanted: f64 = pr.demands.iter().filter(|d| d.unit == "domesticUnits").map(|d| d.requested).sum();
        assert!(lots >= 15 && empty == 0 && housed >= 0.9 * wanted, "{name}: {lots} lots, {empty} unbuilt, {housed}/{wanted} households");
    }
}

/// `outbuildings` (0 none .. 1 all): a 500-inhabitant village keeps no house outbuilding at 0, and some at 1.
#[test]
fn outbuildings_share_thins_village_house_dependencies() {
    let n = 16;
    let (h, w, level) = (vec![10.0_f32; n * n], vec![0_u8; n * n], vec![0.0_f32; n * n]);
    let s = Surface { geometry: None, width: 4000.0, n, height: &h, water: &w, interpolation: Default::default(),};
    let base: LayoutConfig = serde_json::from_str(include_str!("fixtures/small-layout-config.json")).unwrap();
    let seed = "city-temperate-coast-s-1";
    let farms = |outbuildings: f64| {
        let cfg = LayoutConfig { outbuildings, ..base.clone() };
        let site = Site { key: "city".into(), name: String::new(), population: 500, culture: "european-organic".into(),
            center: Point { x: 2000., y: 2000. }, radius: 561.79 };
        let layouts = generate_quarters(seed, &[site], &cfg, s, &[]).unwrap();
        let parts = generate_parcels(seed, &layouts, &ParcelConfig::default()).unwrap();
        let requests = building_sites::requests(seed, &layouts, &parts, s, &level, None).unwrap();
        requests.iter().filter(|r| r["programme"]["farmstead"].is_object()).count()
    };
    assert_eq!(farms(0.0), 0);
    assert!(farms(1.0) > 0);
}

/// A town is lived in: land out of reach of every building is a use its
/// programme declares (place, market, common, cemetery), never a bare quarter.
/// Replays the shape of the 10k medina's east quarter: a crescent along a curved
/// street, which a reserved kasbah left empty but for stretches of wall.
#[test]
#[ignore = "fails: the hand-built crescent gets no houses once unreserved, cause not established"]
fn no_quarter_of_a_town_stands_empty() {
    const REACH: f64 = 25.0;
    let arc = |r: f64, from: f64, to: f64| -> Vec<Point> {
        (0..=24).map(|i| {
            let a = (from + (to - from) * f64::from(i) / 24.0).to_radians();
            Point { x: 390.0 + r * a.cos(), y: 450.0 + r * a.sin() }
        }).collect()
    };
    let block = |shape: Shape, kind: &str| serde_json::json!({"shape":shape,"quarter":0,"kind":kind,"axis":{"x":1.0,"y":0.0}});
    let crescent = Shape { outer: arc(95.0, 45.0, 135.0).into_iter().chain(arc(130.0, 135.0, 45.0)).collect(), holes: vec![] };
    let street = |path: Vec<Point>| serde_json::json!({"widths":vec![8.0; path.len()],"path":path,"rank":2,"role":"street"});
    let mut layout: Layout = serde_json::from_value(serde_json::json!({"key":"lived","culture":"medina","center":{"x":300.0,"y":450.0},"quarters":[],
        "blocks":[block(g::rectangle(120.0, 385.0, 190.0, 445.0), "place"), block(g::rectangle(200.0, 385.0, 290.0, 445.0), "place"),
            block(g::rectangle(300.0, 385.0, 370.0, 445.0), "block"), block(crescent, "block")],
        "streets":[street(vec![Point { x: 100.0, y: 450.0 }, Point { x: 500.0, y: 450.0 }]), street(arc(90.0, 0.0, 180.0))],"warnings":[]})).unwrap();
    let (h, w, level) = (vec![6.0_f32; 1024], vec![0_u8; 1024], vec![0.0_f32; 1024]);
    let s = Surface { geometry: None, width: 1000.0, n: 32, height: &h, water: &w, interpolation: Default::default(),};
    programme::prepare(&mut layout, 10_000, &programme::ProgrammeContext::default(), s).unwrap();
    let layouts = [layout];
    let parts = generate_parcels("lived", &layouts, &ParcelConfig::default()).unwrap();
    let requests = building_sites::requests("lived", &layouts, &parts, s, &level, None).unwrap();
    let built: Vec<Shape> = requests.iter().filter_map(|r| r["preview"].as_array()).flatten()
        .map(|p| serde_json::from_value(p.clone()).unwrap()).collect();
    let lived = |p: Point| built.iter().any(|s: &Shape| g::contains(s, p)
        || (0..s.outer.len()).any(|i| g::distance(p, s.outer[i], s.outer[(i + 1) % s.outer.len()]).0 <= REACH));
    let programme = layouts[0].programme.as_ref().unwrap();
    for (bi, b) in layouts[0].blocks.iter().enumerate() {
        let role = programme.reservations.iter().find(|r| r.block == bi)
            .and_then(|r| programme.demands.iter().find(|d| d.id == r.demand_id));
        if b.kind == "place" || role.is_some_and(|d| matches!(d.function.as_str(), "market" | "common")) { continue; }
        let (x0, y0, x1, y1) = g::bbox(&b.shape);
        let bare = (0..((x1 - x0) / 5.0) as usize).flat_map(|i| (0..((y1 - y0) / 5.0) as usize).map(move |j| Point { x: x0 + 5.0 * i as f64, y: y0 + 5.0 * j as f64 }))
            .filter(|&p| g::contains(&b.shape, p) && !lived(p)).count();
        assert_eq!(bare, 0, "block {bi} ({:?}): {} m2 out of reach of {} buildings", role.map(|d| &d.role), bare * 25, built.len());
    }
}

#[test]
fn a_town_forced_onto_a_steep_flank_houses_half_its_households() {
    // A user-placed town on a uniform 29° flank (grade 0.55): the strict house
    // gates refuse every block, so the slope gates relax until half of the
    // land is housable; the town is laid out, cut and sited without panic.
    let (n, width, grade) = (128, 6000.0, 0.55);
    let h: Vec<f32> = (0..n * n).map(|i| (10.0 + grade * (i / n) as f64 * width / n as f64) as f32).collect();
    let w = vec![0_u8; n * n];
    let level = vec![0.0_f32; n * n];
    let s = Surface { geometry: None, width, n, height: &h, water: &w, interpolation: Default::default(),};
    let site = Site { key: "flank".into(), name: String::new(), population: 500, culture: "european-organic".into(), center: Point { x: 3000.0, y: 3000.0 }, radius: 150.0 };
    let layout_config: LayoutConfig = serde_json::from_str(include_str!("fixtures/small-layout-config.json")).unwrap();
    let parcel_config: ParcelConfig = serde_json::from_str(include_str!("fixtures/small-parcel-config.json")).unwrap();
    let layouts = generate_quarters("steep-flank", &[site], &layout_config, s, &[]).unwrap();
    let parts = generate_parcels("steep-flank", &layouts, &parcel_config).unwrap();
    let ids = (0..layouts.len()).collect::<Vec<_>>();
    let mut index = building_sites::BuildingSiteIndex::prepare(&layouts, &parts, &ids).unwrap();
    let mut sites = 0;
    loop {
        let page = index.page("steep-flank", &layouts, &parts, s, &level, None, sites, 64, 24 * 1024 * 1024).unwrap();
        sites += page.requests.len();
        if sites == page.total || page.requests.is_empty() { break; }
    }
    let pr = parts[0].programme.as_ref().expect("programme");
    let wanted: f64 = pr.demands.iter().filter(|d| d.unit == "domesticUnits").map(|d| d.requested).sum();
    let housed: f64 = pr.allocations.iter().map(|a| a.households).sum();
    eprintln!("steep flank: relax {} housed {housed:.0}/{wanted:.0} households, {sites} sites, warnings {:?}", pr.context.slope_relax, layouts[0].warnings);
    assert!(housed >= 0.5 * wanted, "housed {housed:.0} of {wanted:.0} households");
}

/// (layout, parts, building requests, housed households, wanted households) of a
/// village placed on the flank of a volcanic cone rising `grade` toward its summit.
fn cone_village(population: u32, grade: f64, radius: f64) -> (Layout, Partition, usize, f64, f64) {
    let (n, width) = (128, 6000.0);
    let apex = Point { x: 3000.0, y: 3000.0 };
    let h: Vec<f32> = (0..n * n).map(|i| {
        let p = Point { x: (i % n) as f64 * width / n as f64, y: (i / n) as f64 * width / n as f64 };
        (10.0 + grade * (2800.0 - ((p.x - apex.x).hypot(p.y - apex.y))).max(0.0)) as f32
    }).collect();
    let w = vec![0_u8; n * n];
    let level = vec![0.0_f32; n * n];
    let s = Surface { geometry: None, width, n, height: &h, water: &w, interpolation: Default::default(),};
    let site = Site { key: "cone".into(), name: String::new(), population, culture: "european-organic".into(),
        center: Point { x: apex.x + radius, y: apex.y }, radius: 150.0 };
    let layout_config: LayoutConfig = serde_json::from_str(include_str!("fixtures/small-layout-config.json")).unwrap();
    let parcel_config: ParcelConfig = serde_json::from_str(include_str!("fixtures/small-parcel-config.json")).unwrap();
    let layouts = generate_quarters("cone", &[site], &layout_config, s, &[]).unwrap();
    let parts = generate_parcels("cone", &layouts, &parcel_config).unwrap();
    let ids = (0..layouts.len()).collect::<Vec<_>>();
    let mut index = building_sites::BuildingSiteIndex::prepare(&layouts, &parts, &ids).unwrap();
    let mut sites = 0;
    loop {
        let page = index.page("cone", &layouts, &parts, s, &level, None, sites, 64, 24 * 1024 * 1024).unwrap();
        sites += page.requests.len();
        if sites == page.total || page.requests.is_empty() { break; }
    }
    let (wanted, housed) = parts[0].programme.as_ref().map_or((0.0, 0.0), |pr| (
        pr.demands.iter().filter(|d| d.unit == "domesticUnits").map(|d| d.requested).sum(),
        pr.allocations.iter().map(|a| a.households).sum()));
    let mut layouts = layouts;
    let mut parts = parts;
    (layouts.remove(0), parts.remove(0), sites, housed, wanted)
}

#[test]
fn a_village_placed_on_a_volcano_flank_still_builds_houses() {
    // A user-placed village 1.2 km from the summit of a cone at 29° (grade 0.55)
    // and 39° (0.8): no street climbs to it at street or lane grade and the
    // culture builds no stairs, yet the village keeps land, a contour street
    // and houses near where it was placed.
    for grade in [0.55, 0.8] {
        let (layout, part, sites, housed, wanted) = cone_village(300, grade, 1200.0);
        let site = Point { x: 4200.0, y: 3000.0 };
        let far = part.parcels.iter().filter(|p| p.use_kind == "plot")
            .map(|p| { let c = g::centroid(&p.shape); (c.x - site.x).hypot(c.y - site.y) }).fold(0.0, f64::max);
        eprintln!("cone grade {grade}: {} blocks, {} streets, {sites} sites, housed {housed:.0}/{wanted:.0}, farthest plot {far:.0} m, warnings {:?}",
            layout.blocks.len(), layout.streets.len(), layout.warnings);
        assert!(sites > 0 && housed > 0.0, "grade {grade}: {sites} building sites, {housed:.0} households");
        assert!(far <= 500.0, "grade {grade}: a plot {far:.0} m from the village site");
    }
}

#[test]
fn small_farms_and_roadside_shrines_on_a_steep_cone_keep_their_buildings() {
    let (n, width) = (128, 6000.0);
    let water = vec![0_u8; n * n];
    let level = vec![0.0_f32; n * n];
    // These real failed layouts lost their residential admission envelopes to
    // road cuts, while retaining their smaller utility bodies. Replay their
    // geometry on the same synthetic cone as the generated sites below.
    let clipped: Vec<Layout> = serde_json::from_str(include_str!("fixtures/clipped-utility-layouts.json")).unwrap();
    for grade in [0.0, 0.55, 0.8] {
        let height: Vec<f32> = (0..n * n).map(|i| {
            let x = (i % n) as f64 * width / n as f64;
            let y = (i / n) as f64 * width / n as f64;
            (10.0 + grade * (2800.0 - (x - 3000.0).hypot(y - 3000.0)).max(0.0)) as f32
        }).collect();
        let surface = Surface { geometry: None, width, n, height: &height, water: &water, interpolation: Default::default() };
        for (index, (template, culture)) in [("small_farm", "yoruba"), ("roadside_shrine", "chinese")].into_iter().enumerate() {
            let mut cfg: LayoutConfig = serde_json::from_str(include_str!("fixtures/small-layout-config.json")).unwrap();
            cfg.programme.intent = "activity".into();
            cfg.programme.template = template.into();
            cfg.street_frontage = true;
            cfg.align_enclosed_grid = true;
            cfg.hide_unused_quarters = true;
            cfg.natural_camp_approaches = true;
            cfg.organic_branch_variation = 0.5;
            cfg.ribbon_width_variation = 0.5;
            let site = Site { key: "city".into(), name: String::new(), population: 500, culture: culture.into(),
                center: Point { x: 4200.0, y: 3000.0 }, radius: 221.25 };
            let generated = generate_quarters("utility-cone", &[site], &cfg, surface, &[]).unwrap();
            let mut replay = clipped[index].clone();
            programme::prepare(&mut replay, 500, &cfg.programme, surface).unwrap();
            for (name, layouts) in [("generated", generated), ("road-clipped", vec![replay])] {
                let parts = generate_parcels("utility-cone", &layouts, &ParcelConfig::default()).unwrap();
                // V2 explicitly reapplies the programme after the cadastre.
                let parts = programme::reallocate(&layouts, &parts).unwrap();
                let requests = building_sites::requests("utility-cone", &layouts, &parts, surface, &level, None).unwrap();
                let buildings: usize = requests.iter().filter(|r| r["programme"]["activity"]["template"] == template
                    && r["function"] != "open_space" && r["programme"]["deficit"].is_null())
                    .map(|r| r["preview"].as_array().map_or(0, Vec::len)).sum();
                assert!(buildings > 0, "{template}/{culture} {name} grade {grade}: no utility buildings; {:?}", parts[0].programme);
                if grade > 0.0 {
                    assert!(requests.iter().any(|r| r["terrain"]["max_foundation_step_m"].as_f64().unwrap_or(0.0) > 0.75),
                        "{template} {name} grade {grade}: foundation did not adapt");
                    assert!(layouts[0].programme.as_ref().unwrap().warnings.iter().any(|w| w.contains("gradins")),
                        "{template} {name} grade {grade}: missing terrain warning");
                }
                eprintln!("utility cone {template}/{culture} {name} grade {grade}: {buildings} buildings");
            }
        }
    }
}

#[test]
fn a_town_and_village_use_the_buildable_terraces_of_a_volcano_flank() {
    let (n, width) = (256, 6000.0);
    let water = vec![0_u8; n * n];
    let level = vec![0.0_f32; n * n];
    for (population, grade, culture, minimum) in [
        (10_000, 0.55, "swahili-stone-town", 100),
        (2_000, 0.8, "european-organic", 40),
    ] {
        let center = Point { x: 4200.0, y: 3000.0 };
        let height: Vec<f32> = (0..n * n).map(|i| {
            let x = (i % n) as f64 * width / n as f64;
            let y = (i / n) as f64 * width / n as f64;
            let cone = 10.0 + grade * (2800.0 - (x - 3000.0).hypot(y - 3000.0)).max(0.0);
            // A tiny low-gradient ledge at the marker, enclosed by a steep
            // volcanic ridge. The town must select the usable flank beside
            // it, rather than spend its whole budget on the nearest speck.
            let r = (x - center.x).hypot(y - center.y);
            if population == 10_000 && r < 65.0 {
                (10.0 + grade * 1600.0 + 100.0 * (1.0 - ((r - 20.0) / 45.0).clamp(0.0, 1.0))) as f32
            } else { cone as f32 }
        }).collect();
        let surface = Surface { geometry: None, width, n, height: &height, water: &water,
            interpolation: Default::default() };
        let site = Site { key: "cone".into(), name: String::new(), population,
            culture: culture.into(), center, radius: if population == 10_000 { 735.0 } else { 330.0 } };
        let mut cfg: LayoutConfig = serde_json::from_str(include_str!("fixtures/small-layout-config.json")).unwrap();
        cfg.street_frontage = true;
        cfg.align_enclosed_grid = true;
        cfg.hide_unused_quarters = true;
        cfg.natural_camp_approaches = true;
        cfg.organic_branch_variation = 0.5;
        cfg.ribbon_width_variation = 0.5;
        let layouts = generate_quarters("large-cone", &[site], &cfg, surface, &[]).unwrap();
        let parts = generate_parcels("large-cone", &layouts, &ParcelConfig::default()).unwrap();
        // V2 reconciles the programme after subdivision, before building sites.
        let parts = programme::reallocate(&layouts, &parts).unwrap();
        let requests = building_sites::requests("large-cone", &layouts, &parts, surface, &level, None).unwrap();
        let buildings: usize = requests.iter()
            .filter(|r| r["function"] != "open_space" && r["programme"]["deficit"].is_null())
            .map(|r| r["preview"].as_array().map_or(0, Vec::len)).sum();
        let domestic = requests.iter().filter(|r| r["programme"]["deficit"].is_null()
            && r["programme"]["role"].as_str().is_some_and(|role| role.starts_with("dwelling")))
            .filter(|r| r["preview"].as_array().is_some_and(|p| !p.is_empty())).count();
        eprintln!("volcano {population}, grade {grade}: {buildings} buildings, {domestic} domestic sites; {:?}", layouts[0].warnings);
        assert!(buildings >= minimum, "{population} on grade {grade}: {buildings} buildings");
        assert!(domestic >= minimum / 2, "{population} on grade {grade}: {domestic} domestic sites");
        // The 2k town fills on its normal build and never enters the ladder.
        if population == 10_000 {
            assert!(layouts[0].warnings.iter().any(|w| w == super::slopes::TERRACED || w == super::slopes::FRONTAGE));
        }
        assert!(layouts[0].streets.iter().any(|s| matches!(s.role.as_str(), "street" | "lane" | "stairs")));
        assert!(layouts[0].structure.as_ref().is_some_and(|s| s.metrics.allocated_area >= 10_000.0));
    }
}

/// A 10k river canyon and a volcanic flank retain their normal core and use
/// contour terraces when the actual household allocation falls short.
#[test]
fn slope_ladder_houses_10k_canyon_and_volcano_towns() {
    let (n, width) = (256, 6000.0);
    for (canyon, culture) in [(true, "byzantine-greek"), (false, "javanese-courts")] {
        let mut water = vec![0_u8; n * n];
        let mut level = vec![0.0_f32; n * n];
        let height: Vec<f32> = (0..n * n).map(|i| {
            let x = (i % n) as f64 * width / n as f64;
            let y = (i / n) as f64 * width / n as f64;
            if canyon {
                if (x-3000.0).abs()<24.0 {water[i]=3;level[i]=12.0;}
                (10.0+0.75*((x-3000.0).abs()-65.0).max(0.0)) as f32
            } else {
                (10.0+0.55*(2800.0-(x-3000.0).hypot(y-3000.0)).max(0.0)) as f32
            }
        }).collect();
        let surface = Surface {geometry:None,width,n,height:&height,water:&water,interpolation:Default::default()};
        let center = if canyon {Point{x:3080.0,y:3000.0}} else {Point{x:4200.0,y:3000.0}};
        let site = Site {key:"slope-town".into(),name:String::new(),population:10_000,culture:culture.into(),center,radius:735.0};
        let mut cfg: LayoutConfig = serde_json::from_str(include_str!("fixtures/small-layout-config.json")).unwrap();
        cfg.street_frontage=true;cfg.align_enclosed_grid=true;cfg.hide_unused_quarters=true;
        cfg.organic_branch_variation=0.5;cfg.ribbon_width_variation=0.5;
        let path = if canyon {
            vec![Point{x:3100.0,y:2300.0},Point{x:3160.0,y:3700.0},Point{x:3220.0,y:2300.0},Point{x:3280.0,y:3700.0}]
        } else {
            vec![Point{x:4300.0,y:2300.0},Point{x:4240.0,y:3700.0},Point{x:4180.0,y:2300.0},Point{x:4120.0,y:3700.0}]
        };
        let roads=vec![Street {widths:vec![4.0;path.len()],path,rank:2,role:"regional".into()}];
        let layouts=generate_quarters("slope-ladder",&[site],&cfg,surface,&roads).unwrap();
        let parts=generate_parcels("slope-ladder",&layouts,&ParcelConfig::default()).unwrap();
        let parts=programme::reallocate(&layouts,&parts).unwrap();
        let pr=parts[0].programme.as_ref().unwrap();
        let (wanted,housed)=pr.demands.iter().filter(|d|d.unit=="domesticUnits")
            .fold((0.0,0.0),|(w,h),d|(w+d.requested,h+d.parcel_capacity.min(d.requested)));
        let requests=building_sites::requests("slope-ladder",&layouts,&parts,surface,&level,None).unwrap();
        let buildings:usize=requests.iter().filter(|r|r["function"]!="open_space"&&r["programme"]["deficit"].is_null())
            .map(|r|r["preview"].as_array().map_or(0,Vec::len)).sum();
        eprintln!("{culture}: {buildings} buildings, {housed:.0}/{wanted:.0} households; {:?}",layouts[0].warnings);
        // Requirement: the town is filled, or it says it is full.
        let exhausted=layouts[0].warnings.iter().any(|w|w==super::slopes::EXHAUSTED);
        assert!(housed>=wanted*0.95||exhausted,"{culture}: {housed}/{wanted} households, no shortfall warning");
        assert!(housed>=wanted*0.5,"{culture}: {housed}/{wanted} households");
        assert!(buildings>=250,"{culture}: only {buildings} buildings");
        // The map road is never copied whole into the town: the town keeps
        // only the pieces it uses, none beyond the frontage reach.
        assert!(!layouts[0].streets.iter().any(|s|s.path==roads[0].path));
        assert!(layouts[0].streets.iter().filter(|s|s.role=="regional").flat_map(|s|&s.path)
            .all(|p|(p.x-center.x).hypot(p.y-center.y)<=735.0*1.8+50.0));
        // At least some actual admitted buildings occupy the flank above the
        // narrow river floor / the starting contour, rather than all at its foot.
        assert!(parts[0].parcels.iter().any(|p|pr.allocations.iter().any(|a|a.parcel_id==p.id&&a.households>0.0)
            && surface.height_at(g::interior_point(&p.shape)) > if canyon {80.0} else {900.0}));
    }
}

/// Flat towns never enter the slope ladder: their layout is the normal one,
/// byte for byte (500 and 10k, with a hill just outside the 10k town's disc).
#[test]
fn flat_towns_keep_the_normal_layout() {
    let (n, width) = (256, 6000.0);
    let water = vec![0_u8; n * n];
    let height: Vec<f32> = (0..n * n).map(|i| {
        let x = (i % n) as f64 * width / n as f64;
        let y = (i / n) as f64 * width / n as f64;
        // A steep knoll 1.2 radii from the 10k centre, at the old square survey's corner.
        (20.0 + 0.002 * x + 0.8 * (180.0 - (x - 3620.0).hypot(y - 3620.0)).max(0.0)) as f32
    }).collect();
    let surface = Surface { geometry: None, width, n, height: &height, water: &water, interpolation: Default::default() };
    let mut cfg: LayoutConfig = serde_json::from_str(include_str!("fixtures/small-layout-config.json")).unwrap();
    cfg.street_frontage = true;
    for (population, radius) in [(500, 330.0), (10_000, 735.0)] {
        let site = Site { key: "flat".into(), name: String::new(), population, culture: "european-organic".into(),
            center: Point { x: 3000.0, y: 3000.0 }, radius };
        let layouts = generate_quarters("flat-town", std::slice::from_ref(&site), &cfg, surface, &[]).unwrap();
        let (effective, kind) = kinds::effective(&site, &cfg, &[]);
        assert!(!super::slopes::eligible(&site, &effective, surface, kind), "{population}: flat site surveyed as a slope");
        for w in [super::slopes::DENSIFIED, super::slopes::TERRACED, super::slopes::FRONTAGE, super::slopes::EXHAUSTED] {
            assert!(!layouts[0].warnings.iter().any(|x| x == w), "{population}: {w}");
        }
        let again = generate_quarters("flat-town", &[site], &cfg, surface, &[]).unwrap();
        assert_eq!(serde_json::to_vec(&layouts).unwrap(), serde_json::to_vec(&again).unwrap());
    }
}
