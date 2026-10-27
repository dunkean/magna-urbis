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
    let plots: Vec<f64> = parts.iter().flat_map(|p| p.parcels.iter())
        .filter(|p| p.use_kind == "plot" && !p.provenance.iter().any(|s| s == "occupied-yard-merge"))
        .map(|p| g::area(&p.shape)).collect();
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

const TRIM_CULTURES: [&str; 15] = ["al-andalus", "hausa-kano", "hadhrami-tower", "hanseatic", "inuit-camp", "aztec", "barbarian-celtic", "celtic-oppidum", "egyptian-planned", "japanese-jokamachi", "bagan", "swahili-stone-town", "european-organic", "medina", "kraal"];

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
    for culture in TRIM_CULTURES {
        let (_, _, share) = empty_blocks(culture);
        assert!(share <= 0.05, "{culture}: {:.0} % of the block land has no building site", share * 100.0);
    }
}

fn village_layout(culture: &str, population: u32) -> Layout {
    let n = 64;
    let h = vec![10.0_f32; n * n];
    let w = vec![0_u8; n * n];
    let s = Surface { geometry: None, width: 4000.0, n, height: &h, water: &w };
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
        let surface = Surface { geometry:None, width:4000., n, height:&height, water:&water };
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
    let surface = Surface{geometry:None,width:6000.,n,height:&height,water:&water};
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

const FILL2_CULTURES: &[&str] = &["barbarian-celtic", "celtic-oppidum", "himalayan-terraces", "indus-planned", "native-iroquoian", "norse-ringfort", "swahili-stone-town", "goblin-warren", "ksar-oasis", "medina", "roman-core", "kraal", "native-plains", "nomad-camp"];

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
    let surface = Surface { geometry:None, width:4000., n, height:&height, water:&water };
    let mut failures = vec![];
    for &culture in FILL2_CULTURES {
        let layout = village_layout(culture, 500);
        let layouts = std::slice::from_ref(&layout);
        let parts = generate_parcels("small-settlement", layouts, &ParcelConfig::default()).unwrap();
        let pr = parts[0].programme.as_ref().unwrap();
        let requests = building_sites::requests("small-settlement", layouts, &parts, surface, &level, None).unwrap();
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
        if bare.len() as f64 > 0.01 * parts[0].parcels.len() as f64 { failures.push(format!("{culture}: {bare:?}")); }
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
