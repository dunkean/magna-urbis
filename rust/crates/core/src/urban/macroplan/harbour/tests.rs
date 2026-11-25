use super::*;

#[test]
fn timber_landings_are_small_and_all_platforms_need_a_bank_connection() {
    let (height, water) = coast(256);
    let surface = Surface { geometry: None, width: 256.0, n: 256, height: &height, water: &water, interpolation: Default::default() };
    let street = |a, b, role: &str| Street { path: vec![a, b], widths: vec![6.0; 2], rank: 3, role: role.into() };
    let streets = vec![
        // A pier joins one offshore quay, a boardwalk joins the other.
        street(Point { x: 140.0, y: 100.0 }, Point { x: 80.0, y: 100.0 }, "pier"),
        street(Point { x: 80.0, y: 90.0 }, Point { x: 80.0, y: 120.0 }, "quay"),
        street(Point { x: 140.0, y: 150.0 }, Point { x: 80.0, y: 150.0 }, "boardwalk"),
        street(Point { x: 80.0, y: 145.0 }, Point { x: 80.0, y: 175.0 }, "quay"),
        // This whole pier/quay component is isolated on the water.
        street(Point { x: 50.0, y: 210.0 }, Point { x: 20.0, y: 210.0 }, "pier"),
        street(Point { x: 20.0, y: 200.0 }, Point { x: 20.0, y: 230.0 }, "quay"),
        street(Point { x: 130.0, y: 185.0 }, Point { x: 130.0, y: 230.0 }, "quay"),
    ];
    for culture in ["stilt-town", "hanseatic"] {
        let mut layout: super::super::super::Layout = serde_json::from_value(serde_json::json!({
            "key": "landing", "culture": culture, "center": {"x": 180.0, "y": 128.0},
            "quarters": [], "streets": streets, "blocks": [], "warnings": [], "structure": {}
        })).unwrap();
        let original = serde_json::to_value(&layout.streets).unwrap();
        platforms(&mut layout, surface);
        assert_eq!(serde_json::to_value(&layout.streets).unwrap(), original, "platform construction preserves the network");
        let quays = &layout.structure.as_ref().unwrap().quays;
        assert_eq!(quays.len(), 4, "two attached stages, a pier and a bank quay; no isolated component: {culture}");
        assert!(quays.iter().all(|q| g::bbox(&q.shape).0 > 60.0));
        let stages: Vec<_> = quays.iter().filter(|q| g::bbox(&q.shape).2 < 100.0).collect();
        assert_eq!(stages.len(), 2, "both pier and boardwalk support a stage");
        if culture == "stilt-town" {
            assert!(quays.iter().all(|q| q.material == "timber"));
            assert!(stages.iter().all(|q| q.kind == "landing" && g::area(&q.shape) <= 32.001));
        } else {
            assert!(stages.iter().all(|q| q.material == "stone" && q.kind == "quay" && g::area(&q.shape) > 100.0));
        }
        // Removing the access decks must also remove their offshore stages.
        layout.streets.retain(|s| s.role == "quay");
        platforms(&mut layout, surface);
        assert_eq!(layout.structure.as_ref().unwrap().quays.len(), 1, "only the bank quay survives without piers");
    }
}

#[test]
fn review_quay_budget_keeps_villages_short_and_ports_larger() {
    let mut site = Site { key:"landing".into(),name:String::new(),population:500,culture:"hanseatic".into(),center:Point{x:180.0,y:128.0},radius:120.0, neighbours: Vec::new() };
    let cfg = LayoutConfig::default();
    let village = quay_budget(&site,&cfg,Harbour::default());
    assert_eq!(village,20.0);
    site.population=10_000;
    let town = quay_budget(&site,&cfg,Harbour::default());
    let port = quay_budget(&site,&LayoutConfig { site_archetype:"harbor".into(),..cfg },Harbour::default());
    assert!(town > village && town <= 350.001 && port > town && port <= 600.0);
}

#[test]
fn quay_frontage_and_landing_works_scale_with_population() {
    let (height,water)=coast(256);
    let surface=Surface {geometry:None,width:256.,n:256,height:&height,water:&water, interpolation: Default::default(),};
    let domain=g::rectangle(128.,4.,254.,252.);
    let cfg=LayoutConfig {site_archetype:"harbor".into(),..Default::default()};
    let mut lengths=vec![];
    let mut counts=vec![];
    let mut building_need=vec![];
    for pop in [500,10_000] {
        let site=Site {key:"scale".into(),name:String::new(),population:pop,culture:"hanseatic".into(),center:Point{x:180.,y:128.},radius:120., neighbours: Vec::new()};
        let mut streets=vec![Street {path:vec![Point{x:180.,y:4.},Point{x:180.,y:252.}],widths:vec![5.;2],rank:1,role:"street".into()}];
        quays(std::slice::from_ref(&domain),&mut streets,surface,&cfg,&site,"hanseatic",true);
        let metres:f64=streets.iter().filter(|s|s.role=="quay").map(|s|length(&s.path)).sum();
        // A village keeps a short landing (quay_budget), a town a real front.
        assert!(metres>if pop==500 {15.} else {50.});
        let works=works(&streets,surface,&site,"hanseatic");
        // Under 40 m a village quay is its own landing; a town adds works.
        assert!(pop==500 || !works.is_empty());
        if pop==500 { assert!(works.iter().all(|s|s.role=="landing")); }
        else { assert!(works.iter().any(|s|s.role=="pier"||s.role=="mole")); }
        lengths.push(metres); counts.push(works.len());
        let layout:super::super::super::Layout=serde_json::from_value(serde_json::json!({
            "key":"scale","culture":"hanseatic","center":site.center,"quarters":[],"streets":streets,"blocks":[],"warnings":[]
        })).unwrap();
        let needs=super::super::super::roles::services_for_layout(&layout,pop,Default::default());
        building_need.push(needs.iter().filter(|n|n.entry.site=="quay").map(|n|n.area*n.sites as f64).sum::<f64>());
    }
    assert!(lengths[1]>lengths[0]*1.3);
    assert!(counts[1]>counts[0]);
    assert!(building_need[1]>building_need[0]*2.0);
}

#[test]
fn ten_thousand_coastal_and_river_towns_have_built_connected_quays() {
    use super::super::super::{generate_quarters, generate_parcels, ParcelConfig};
    for (culture, river) in [("celtic-oppidum", false), ("dwarven", false), ("indian-temple", true), ("swahili-stone-town", true)] {
        let (n, width) = (if river { 96 } else { 192 }, 2800.0);
        let water: Vec<u8> = (0..n*n).map(|i| {
            let x = (i % n) as f64 * width / n as f64;
            let y = (i / n) as f64 * width / n as f64;
            let bank = 1700.0 + if river { 60.0 * (y / 250.0).sin() } else { 0.0 };
            if x >= bank && (!river || x < bank + 200.0) { if river { 3 } else { 1 } } else { 0 }
        }).collect();
        let height: Vec<f32> = (0..n*n).map(|i| 2.0 + if river { ((i / n) as f64 * width / n as f64 * 0.002) as f32 } else { 0.0 }).collect();
        let surface = Surface { geometry: None, width, n, height: &height, water: &water, interpolation: Default::default(),};
        let site = Site { key: "port-10k".into(), name: String::new(), population: 10_000, culture: culture.into(),
            center: Point { x: 1500.0, y: 1400.0 }, radius: 480.0,
            neighbours: Vec::new(), };
        let cfg = LayoutConfig { site_archetypes: std::collections::BTreeMap::from([("port-10k".into(), if river { "bridge" } else { "harbor" }.into())]), ..LayoutConfig::default() };
        let roads = [Street { path: vec![Point { x: 100.0, y: 1400.0 }, Point { x: 1690.0, y: 1400.0 }], widths: vec![7.0; 2], rank: 1, role: "regional".into() }];
        let layouts = generate_quarters("port-invariant", &[site], &cfg, surface, &roads).unwrap();
        let l = &layouts[0];
        let platforms = &l.structure.as_ref().unwrap().quays;
        let quays: Vec<_> = l.streets.iter().filter(|s| s.role == "quay").collect();
        eprintln!("{culture} river={river}: {} platforms, {} quay streets", platforms.len(), quays.len());
        assert!(!quays.is_empty(), "{culture}: missing quay street");
        assert!(platforms.iter().any(|q| q.kind == "quay" && q.shape.outer.iter().any(|&p| surface.wet(p))), "{culture}: embankment must touch water");
        for quay in &quays {
            assert!(quay.path.iter().any(|&p| l.streets.iter().filter(|s| s.role != "quay" && !matches!(s.role.as_str(), "pier" | "mole" | "landing"))
                .any(|s| s.path.iter().any(|&q| dist(p, q) < 0.01))), "{culture}: quay disconnected from street graph");
        }
        if river {
            assert!(quays.iter().map(|q| length(&q.path)).sum::<f64>() > 250.0, "continuous river embankment");
            for q in platforms.iter().filter(|q| q.kind == "quay") {
                for &p in q.shape.outer.iter().filter(|&&p| surface.wet(p)) {
                    assert!((q.deck_z_m - surface.height_at(p) - 1.0).abs() < 0.8, "{culture}: quay follows descending water");
                }
            }
        } else {
            assert!(platforms.iter().filter(|q| q.kind == "pier").count() >= 2, "{culture}: multiple coastal piers");
        }
        for st in &l.streets {
            for w in st.path.windows(2) { for e in &l.enclosures { for edge in e.path.windows(2) {
                if let Some((t, p)) = g::segment_hit(w[0], w[1], edge[0], edge[1]) {
                    if t > 0.01 && t < 0.99 { assert!(e.gates.iter().any(|&q| dist(p, q) < 8.0), "{culture}: street crosses closed wall"); }
                }
            } } }
        }
        let parts = generate_parcels("port-invariant", &layouts, &ParcelConfig::default()).unwrap();
        let programme = parts[0].programme.as_ref().unwrap();
        let requests=super::super::super::building_sites::requests("port-invariant",&layouts,&parts,surface,&height,None).unwrap();
        for role in ["commerce.warehouse", "civic.harbour", "craft.boatshed", "commerce.fishmarket"] {
            assert!(programme.allocations.iter().any(|a| a.role == role), "{culture}: unplaced {role}");
            assert!(requests.iter().any(|r|programme.allocations.iter().any(|a|a.role==role && r["parcel_id"]==a.parcel_id)
                && r["function"]!="open_space" && serde_json::from_value::<Vec<Shape>>(r["preview"].clone()).unwrap_or_default().iter().map(g::area).sum::<f64>()>20.0),
                "{culture}: {role} needs a real building footprint and function");
        }
    }
}

/// Sea to the west of x = 128 m on a 256 m flat map; land elsewhere.
fn coast(n: usize) -> (Vec<f32>, Vec<u8>) {
    let height = vec![1.0; n * n];
    let water = (0..n * n)
        .map(|i| u8::from(((i % n) as f64 + 0.5) * 256.0 / n as f64 / 4.0 < 32.0))
        .collect();
    (height, water)
}

/// One shore, one simple quay line on the water: a folded run goes
/// straight across its loop, a run along a laid quay keeps only its free
/// stretches, and a line standing back from the drawn water does not
/// front it.
#[test]
fn a_quay_line_is_simple_single_and_on_the_water() {
    let p = |x: f64, y: f64| Point { x, y };
    let flat = untangled(vec![p(0.0, 0.0), p(40.0, 0.0), p(40.0, 10.0), p(20.0, -10.0), p(60.0, -10.0)]);
    assert!(flat.len() < 5);
    for i in 0..flat.len() - 1 {
        for j in i + 2..flat.len() - 1 {
            assert!(g::segment_hit(flat[i], flat[i + 1], flat[j], flat[j + 1]).is_none(), "the line still crosses itself: {flat:?}");
        }
    }
    let laid = vec![vec![p(0.0, 0.0), p(100.0, 0.0)]];
    let line = vec![p(-50.0, 3.0), p(150.0, 3.0)];
    assert_eq!(unlaid(&line, &[], 7.0, 20.0), vec![line.clone()]);
    let parts = unlaid(&line, &laid, 7.0, 20.0);
    assert_eq!(parts.len(), 2, "{parts:?}");
    for part in &parts {
        assert!(length(part) >= 20.0);
        assert!(part.iter().all(|&q| g::distance(q, laid[0][0], laid[0][1]).0 >= 7.0 - 1e-9));
    }
    let (height, water) = coast(64);
    let surface = Surface { geometry: None, width: 256.0, n: 64, height: &height, water: &water, interpolation: Default::default() };
    assert!(touching(surface, &[p(134.0, 40.0), p(134.0, 200.0)], 3.0) > 0.9, "a quay on the waterline");
    assert!(touching(surface, &[p(200.0, 40.0), p(200.0, 200.0)], 3.0) < 0.1, "a street 70 m from the water");
}

/// A port's waterfront is one continuous quay (its budget of the shore,
/// nearest the centre), joined to the streets, with piers into open water
/// at intervals, wholly over water; an inland quarter gets none.
#[test]
fn a_port_waterfront_is_a_continuous_quay_with_piers() {
    let n = 64;
    let (height, water) = coast(n);
    let surface = Surface {
        geometry: None,
        width: 256.0,
        n,
        height: &height,
        water: &water,
        interpolation: Default::default(),
    };
    // A stair-stepped raster shore (4 m cells, 12 m steps) at x ≈ 128.
    let mut outer = vec![
        Point { x: 128.0, y: 8.0 },
        Point { x: 250.0, y: 8.0 },
        Point { x: 250.0, y: 248.0 },
    ];
    let mut y = 248.0;
    while y > 8.0 {
        let x = if ((y / 12.0) as i64) % 2 == 0 {
            128.0
        } else {
            132.0
        };
        outer.push(Point { x, y });
        y -= 12.0;
        outer.push(Point { x, y });
    }
    let region = g::normalized(Shape {
        outer,
        holes: vec![],
    });
    let road = Street {
        path: vec![Point { x: 175.0, y: 10.0 }, Point { x: 175.0, y: 246.0 }],
        widths: vec![5.0; 2],
        rank: 1,
        role: "street".into(),
    };
    let mut cfg = LayoutConfig::default();
    cfg.programme.functions = Some(crate::urban::programme::ProgrammeFunctions { port: 1.0, ..Default::default() });
    let site = Site {
        key: "port".into(),
        name: String::new(),
        population: 2000,
        culture: "european-organic".into(),
        center: Point { x: 180.0, y: 128.0 },
        radius: 200.0,
        neighbours: Vec::new(),
    };
    let mut streets = vec![road.clone()];
    quays(
        &[region.clone()],
        &mut streets,
        surface,
        &cfg,
        &site,
        "european-organic",
        true,
    );
    let quay: Vec<_> = streets.iter().filter(|s| s.role == "quay").collect();
    assert_eq!(quay.len(), 1, "one continuous quay");
    let l = length(&quay[0].path);
    let budget = quay_budget(&site, &cfg, params("european-organic"));
    assert!(
        l > 0.9 * budget.min(200.0) && l <= budget + 1.0,
        "quay {l} m"
    );
    assert!(routing::path_clear(surface, &quay[0].path, 0.05));
    for ribbon in g::ribbon(&quay[0].path, &quay[0].widths) {
        let dry: f64 = g::dry_clip(&surface, &ribbon).iter().map(g::area).sum();
        assert!(g::area(&ribbon) - dry <= 1e-3, "quay platform on dry land");
    }
    // Within 12 m of the water along its whole length.
    assert!(quay[0].path.iter().all(|p| p.x < 128.0 + 14.0));
    let joined = streets
        .iter()
        .filter(|s| s.role == "street" && s.path.len() == 2)
        .filter(|s| quay[0].path.contains(&s.path[0]))
        .count();
    assert!(joined >= 1, "landing streets reach the quay");
    let piers = works(&streets, surface, &site, "european-organic");
    assert!(!piers.is_empty());
    for p in &piers {
        let root = p.path[0];
        assert!(
            quay[0]
                .path
                .windows(2)
                .any(|w| g::distance(root, w[0], w[1]).0 < 1e-6)
        );
        let end = *p.path.last().unwrap();
        assert!(surface.wet(end) && surface.wet(point_on(p, 0.7)));
    }
    // Inland quarter, 20 m from the water: no quay.
    let inland = g::normalized(Shape {
        outer: vec![
            Point { x: 152.0, y: 8.0 },
            Point { x: 250.0, y: 8.0 },
            Point { x: 250.0, y: 248.0 },
            Point { x: 152.0, y: 248.0 },
        ],
        holes: vec![],
    });
    let mut streets = vec![road];
    quays(
        &[inland],
        &mut streets,
        surface,
        &cfg,
        &site,
        "european-organic",
        true,
    );
    assert!(!streets.iter().any(|s| s.role == "quay"));
}
/// Invariant: a port's quays front navigable water. Beside a 4 m brook
/// (one raster cell) the bank stays a bank; beside a 24 m river the same
/// port lines it with a quay.
#[test]
fn a_brook_is_banked_not_quayed() {
    let n = 64;
    let height = vec![1.0; n * n];
    let site = Site {
        key: "port".into(),
        name: String::new(),
        population: 2000,
        culture: "european-organic".into(),
        center: Point { x: 170.0, y: 128.0 },
        radius: 200.0,
        neighbours: Vec::new(),
    };
    let mut cfg = LayoutConfig::default();
    cfg.programme.functions = Some(crate::urban::programme::ProgrammeFunctions { port: 1.0, ..Default::default() });
    let road = Street {
        path: vec![Point { x: 175.0, y: 42.0 }, Point { x: 175.0, y: 214.0 }],
        widths: vec![5.0; 2],
        rank: 1,
        role: "street".into(),
    };
    let quayed = |x0: f64| {
        // River water (code 3) over x in [x0, 140).
        let water: Vec<u8> = (0..n * n)
            .map(|i| {
                let x = ((i % n) as f64 + 0.5) * 4.0;
                if x >= x0 && x < 140.0 { 3 } else { 0 }
            })
            .collect();
        let surface = Surface {
            geometry: None,
            width: 256.0,
            n,
            height: &height,
            water: &water,
            interpolation: Default::default(),
        };
        let mut streets = vec![road.clone()];
        // The land east of the water, 30 m clear of the map edge.
        let region = g::rectangle(140.0, 40.0, 210.0, 216.0);
        quays(
            &[region],
            &mut streets,
            surface,
            &cfg,
            &site,
            "european-organic",
            true,
        );
        streets.iter().any(|s| s.role == "quay")
    };
    assert!(!quayed(136.0), "a quay along a 4 m brook");
    assert!(quayed(116.0), "no quay along a 24 m river");
    // A road already on the bank, between the quarter and the river: no
    // quay set back behind it, its paving spread across the road.
    let water: Vec<u8> = (0..n * n).map(|i| if ((i % n) as f64 + 0.5) * 4.0 >= 116.0 && ((i % n) as f64 + 0.5) * 4.0 < 140.0 { 3 } else { 0 }).collect();
    let surface = Surface { geometry: None, width: 256.0, n, height: &height, water: &water, interpolation: Default::default() };
    let bank = Street { path: vec![Point { x: 143.0, y: 30.0 }, Point { x: 143.0, y: 226.0 }], widths: vec![5.0; 2], rank: 2, role: "approach".into() };
    let mut streets = vec![road.clone(), bank];
    quays(&[g::rectangle(140.0, 40.0, 210.0, 216.0)], &mut streets, surface, &cfg, &site, "european-organic", true);
    assert!(!streets.iter().any(|s| s.role == "quay"), "a quay behind the bank road");
}

/// A domain stopping short of its water joins the waterline across a
/// gentle gap, not down a cliff.
#[test]
fn the_harbour_apron_reaches_the_waterline_but_not_down_a_cliff() {
    let n = 64;
    let (height, water) = coast(n);
    let surface = Surface {
        geometry: None,
        width: 256.0,
        n,
        height: &height,
        water: &water,
        interpolation: Default::default(),
    };
    let domain = g::rectangle(150.0, 40.0, 240.0, 200.0);
    let cfg = LayoutConfig::default();
    let wide = apron(&domain, surface, &cfg, 50.0);
    let (x0, _, _, _) = g::bbox(&wide);
    assert!(x0 < 131.0 && x0 >= 127.9, "apron edge at {x0}");
    assert!(g::area(&wide) > g::area(&domain) + 0.9 * 22.0 * 150.0);
    let dry: f64 = g::dry_clip(&surface, &wide).iter().map(g::area).sum();
    assert!((dry - g::area(&wide)).abs() < 1.0, "apron on dry land");
    // The gap is a 20 m cliff: nothing is added.
    let cliff: Vec<f32> = (0..n * n)
        .map(|i| if (i % n) * 4 < 140 { 1.0 } else { 21.0 })
        .collect();
    let steep = Surface {
        height: &cliff,
        ..surface
    };
    assert!((g::area(&apron(&domain, steep, &cfg, 50.0)) - g::area(&domain)).abs() < 1.0);
}
fn point_on(s: &Street, t: f64) -> Point {
    super::super::point(s.path[0], *s.path.last().unwrap(), t)
}

/// An inland port moves to its gentle shore; a cliff shore is refused
/// and a town already on its water stays.
#[test]
fn an_inland_port_stands_on_its_shore_never_at_a_cliff() {
    let n = 256;
    let width = 2048.0;
    let cell = width / n as f64;
    let water: Vec<u8> = (0..n * n)
        .map(|i| u8::from(((i % n) as f64 + 0.5) * cell < 400.0))
        .collect();
    let gentle = vec![2.0f32; n * n];
    let surface = Surface {
        geometry: None,
        width,
        n,
        height: &gentle,
        water: &water,
        interpolation: Default::default(),
    };
    let mut cfg = LayoutConfig::default();
    cfg.programme.functions = Some(crate::urban::programme::ProgrammeFunctions { port: 1.0, ..Default::default() });
    let site = Site {
        key: "p".into(),
        name: String::new(),
        population: 8000,
        culture: "european-organic".into(),
        center: Point {
            x: 1200.0,
            y: 1000.0,
        },
        radius: 600.0,
        neighbours: Vec::new(),
    };
    let moved = sited(&site, &cfg, surface).expect("moves to its shore");
    let d = moved.center.x - 400.0;
    assert!((d - front_distance(600.0)).abs() < 12.0, "front at {d} m");
    assert!((moved.center.y - 1000.0).abs() < 10.0);
    // Not a port: stays.
    assert!(sited(&site, &LayoutConfig::default(), surface).is_none());
    // Already on the water: stays.
    let near = Site {
        center: Point {
            x: 470.0,
            y: 1000.0,
        },
        ..site.clone()
    };
    assert!(sited(&near, &cfg, surface).is_none());
    // A cliff: the land rises 40 m within 20 m of the bank.
    let cliff: Vec<f32> = (0..n * n)
        .map(|i| {
            if ((i % n) as f64 + 0.5) * cell < 416.0 {
                2.0
            } else {
                42.0
            }
        })
        .collect();
    let steep = Surface {
        height: &cliff,
        ..surface
    };
    assert!(sited(&site, &cfg, steep).is_none());
}

#[test]
fn a_cliff_coast_never_sends_its_town_to_an_offshore_island() {
    let (n, width) = (256, 2048.0);
    let cell = width / n as f64;
    let island = |x: f64, y: f64| (x - 200.0).hypot(y - 1000.0) < 120.0;
    let water: Vec<u8> = (0..n * n).map(|i| {
        let (x, y) = (((i % n) as f64 + 0.5) * cell, ((i / n) as f64 + 0.5) * cell);
        u8::from(x < 400.0 && !island(x, y))
    }).collect();
    let height: Vec<f32> = (0..n * n).map(|i|
        if ((i % n) as f64 + 0.5) * cell < 416.0 { 2.0 } else { 42.0 }).collect();
    let surface = Surface { geometry: None, width, n, height: &height, water: &water, interpolation: Default::default() };
    let site = Site { key: "mainland".into(), name: String::new(), population: 500,
        culture: "european-organic".into(), center: Point { x: 1200.0, y: 1000.0 }, radius: 180.0, neighbours: vec![] };
    let cfg = LayoutConfig { site_archetype: "harbor".into(), ..Default::default() };
    assert!(sited(&site, &cfg, surface).is_none(), "an unreachable island cannot rescue a cliff harbour");
    let resident = Site { center: Point { x: 200.0, y: 1000.0 }, ..site.clone() };
    assert!(!surface.wet(resident.center), "the island stays available to an independently placed settlement");
}

#[test]
fn a_crossing_is_not_a_harbour_order_and_a_manual_foundation_never_moves() {
    let (n, width) = (128, 2048.0);
    let height = vec![2.0; n * n];
    let water: Vec<u8> = (0..n * n).map(|i| u8::from(i % n < 25)).collect();
    let surface = Surface { geometry: None, width, n, height: &height, water: &water, interpolation: Default::default() };
    let site = Site { key: "manual".into(), name: String::new(), population: 500,
        culture: "european-organic".into(), center: Point { x: 900.0, y: 1000.0 }, radius: 180.0, neighbours: vec![] };
    let mut cfg = LayoutConfig { site_archetype: "bridge".into(), ..Default::default() };
    assert!(sited(&site, &cfg, surface).is_none());
    cfg.site_archetype = "harbor".into();
    assert!(sited(&site, &cfg, surface).is_some(), "a reachable harbour still has a shore");
    cfg.fixed_sites.insert(site.key.clone());
    assert!(sited(&site, &cfg, surface).is_none());
}

/// A quay never stands where the land behind it climbs faster than a
/// street over its 60 m: a ramp-then-cliff shore gets none, a gentle one does.
#[test]
fn a_quay_needs_gentle_land_behind_it() {
    let n = 64;
    let (_, water) = coast(n);
    let cfg = LayoutConfig::default();
    let shelf = |rise: f32| -> Vec<f32> {
        (0..n * n).map(|i| {
            let x = ((i % n) as f64 + 0.5) * 4.0 - 128.0;
            if x < 24.0 { 1.0 } else { 1.0 + rise * ((x - 24.0) / 12.0) as f32 }
        }).collect()
    };
    let at = |height: &[f32]| {
        let surface = Surface { geometry: None, width: 256.0, n, height, water: &water, interpolation: Default::default(),};
        gentle_behind(surface, Point { x: 130.0, y: 128.0 }, Point { x: 1.0, y: 0.0 }, 1.0, cfg.max_street_grade)
    };
    assert!(at(&shelf(0.5)));
    assert!(!at(&shelf(3.0)));
}
