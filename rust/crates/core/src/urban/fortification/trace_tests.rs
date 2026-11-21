//! Curtain traces, pocket repair and occupied banks.

use serde_json::Value;
use crate::rng::Rng;
use crate::urban::{
    Enclosure, Geography, LayoutConfig, Point, Shape, Site, Street,
    Surface, VectorGeography, composition, geometry as g,
};
use super::build::build;
use super::geometry::{area, disc, dist, pt};
use super::pockets::{PocketLimits, pockets, without_invaginations};
use super::style::styled;
use super::trace::{
    CONTOUR_PAIRS, TRACE_PAIRS, bastioned_trace, curtain_trace, hill_trace, trace_enclosures, wet_length,
};
use super::test_fixtures::{N, W, octagon, predicted, river, street, streets, surface};

fn notch(depth: f64, width: f64) -> Shape {
    g::normalized(Shape { outer: vec![pt(400.0, 400.0), pt(700.0, 400.0),
        pt(700.0, 700.0), pt(550.0 + width * 0.5, 700.0),
        pt(550.0 + width * 0.5, 700.0 - depth), pt(550.0 - width * 0.5, 700.0 - depth),
        pt(550.0 - width * 0.5, 700.0), pt(400.0, 700.0)], holes: vec![] })
}

fn boundary_gap(p: Point, shape: &Shape) -> f64 {
    (0..shape.outer.len()).map(|i| g::distance(p, shape.outer[i],
        shape.outer[(i + 1) % shape.outer.len()]).0).fold(f64::INFINITY, f64::min)
}

#[test]
fn curved_curtains_keep_metric_fit_at_giant_scale_and_coarse_rasters() {
    for scale in [1.0, 2.5, 10.0] {
        let radius = 250.0 * scale;
        let base = disc(pt(5000.0, 5000.0), radius, 720, 0.0);
        let trace = curtain_trace(&base);
        assert!(g::simple(&trace));
        // A smooth foundation must not turn into a coarse inscribed polygon.
        assert!(base.outer.iter().all(|&p| boundary_gap(p, &trace) < 3.1), "scale {scale}");
        assert!(g::area(&trace) > g::area(&base) * 0.99, "scale {scale}");
        let hill = hill_trace(&base, 2.0);
        for cell in [8.0, 32.0, 80.0] {
            assert_eq!(hill_trace(&base, cell), hill, "raster cell {cell}");
        }
    }
    // Long genuine fronts need no artificial vertices or culture override.
    let rect = g::normalized(g::rectangle(100.0, 100.0, 1100.0, 600.0));
    let trace = curtain_trace(&rect);
    assert!(trace.outer.len() < 20);
    assert!((0..trace.outer.len()).any(|i| dist(trace.outer[i],
        trace.outer[(i + 1) % trace.outer.len()]) > 200.0));
}

#[test]
fn contour_rounding_keeps_thin_necks_simple() {
    let base = g::normalized(Shape { outer: vec![pt(902.225, 280.018), pt(1008.195, 308.579),
        pt(33.624, 46.017), pt(0.0, 0.0)], holes: vec![] });
    assert!(g::simple(&base));
    for trace in [curtain_trace(&base), hill_trace(&base, 8.0)] {
        assert!(g::simple(&trace));
    }
    let trace = curtain_trace(&base);
    assert!(base.outer.iter().all(|&p| boundary_gap(p, &trace) <= 3.0));
}

#[test]
fn head_trace_is_exact_without_large_invaginations() {
    let height = vec![10.0; N * N];
    let water = vec![0; N * N];
    let s = surface(&height, &water);
    let wavy = Shape { outer: (0..96).map(|i| {
        let a = i as f64 * std::f64::consts::TAU / 96.0;
        let r = 250.0 * (1.0 + 0.07 * (a * 5.0).cos());
        pt(1000.0 + r * a.cos(), 1000.0 + r * a.sin())
    }).collect(), holes: vec![] };
    for raw in [disc(pt(1000.0, 1000.0), 250.0, 64, 0.0), wavy, notch(20.0, 160.0), notch(8.0, 6.0)] {
        for base in [raw.clone(), hill_trace(&raw, W / N as f64)] {
            assert_eq!(without_invaginations(&base, s), base);
            assert_eq!(trace_enclosures(vec![base.clone()], &[base.clone()], s), vec![base]);
        }
    }
}

#[test]
fn deep_pockets_are_bridged_without_moving_the_other_fronts() {
    let height = vec![10.0; N * N];
    let water = vec![0; N * N];
    let s = surface(&height, &water);
    for base in [notch(160.0, 100.0), notch(80.0, 6.0)] {
        let trace = without_invaginations(&base, s);
        assert!(g::simple(&trace));
        assert!(g::area(&trace) > g::area(&base));
        assert!(area(&g::difference(&base, &trace)) < 1e-6);
        assert!(pockets(&trace, PocketLimits::read()).is_empty());
        assert_eq!(trace.outer, base.outer[..4].iter().chain(&base.outer[6..]).copied().collect::<Vec<_>>());
        assert_eq!(without_invaginations(&trace, s), trace);
    }
}

#[test]
fn narrow_fold_inside_a_shallow_bay_is_bridged_locally() {
    let height = vec![10.0; N * N];
    let water = vec![0; N * N];
    let s = surface(&height, &water);
    let base = g::normalized(Shape { outer: vec![pt(300.0, 300.0), pt(1300.0, 300.0),
        pt(1300.0, 900.0), pt(1000.0, 850.0), pt(804.0, 850.0), pt(804.0, 800.0),
        pt(800.0, 800.0), pt(800.0, 850.0), pt(600.0, 850.0), pt(300.0, 900.0)], holes: vec![] });
    let trace = without_invaginations(&base, s);
    assert!(g::area(&trace) > g::area(&base));
    assert!(g::area(&trace) - g::area(&base) < 250.0);
    assert!(pockets(&trace, PocketLimits::read()).is_empty());
    for &p in &[base.outer[0], base.outer[1], base.outer[2], base.outer[3], base.outer[8], base.outer[9]] {
        assert!(trace.outer.contains(&p), "unaffected front moved");
    }
}

#[test]
fn pocket_repair_keeps_towers_and_gates_on_unaffected_fronts() {
    let height = vec![10.0; N * N];
    let water = vec![0; N * N];
    let s = surface(&height, &water);
    let base = notch(160.0, 100.0);
    let trace = without_invaginations(&base, s);
    let roads = vec![street(&[(300.0, 450.0), (800.0, 450.0)], 1, 6.0)];
    let make = |shape: &Shape| {
        let mut path = shape.outer.clone();
        path.push(path[0]);
        let gates = composition::gates(&path, &roads);
        let land = gates.len();
        let mut e = Enclosure { path, kind: "wall".into(), gates, ..Default::default() };
        let mut style = styled("flanked", "european-organic", 10_000);
        style.forced = true;
        build(&mut e, land, &[], &roads, s, &style, 10_000, &predicted(), &Rng::new("walls3-towers"));
        e
    };
    let (before, after) = (make(&base), make(&trace));
    assert!(!before.gates.is_empty());
    assert_eq!(before.gates, after.gates);
    let unchanged = |e: &Enclosure| e.towers_detail.iter().filter(|t| t.anchor.y < 500.0)
        .map(|t| (t.anchor, t.kind.clone(), t.radius_m, t.height_m)).collect::<Vec<_>>();
    assert!(!unchanged(&before).is_empty());
    assert_eq!(unchanged(&before), unchanged(&after));
    for t in before.towers_detail.iter().filter(|t| t.anchor.y < 500.0) {
        let other = after.towers_detail.iter().find(|q| q.anchor == t.anchor).unwrap();
        assert!(area(&g::difference(&t.footprint, &other.footprint)) < 1e-4);
        assert!(area(&g::difference(&other.footprint, &t.footprint)) < 1e-4);
    }
}

#[test]
fn river_circuit_follows_the_occupied_bank_or_encloses_both_banks() {
    let height = vec![10.0; N * N];
    let water = river(1000.0, 1064.0);
    let s = surface(&height, &water);
    let trace = g::normalized(g::rectangle(600.0, 600.0, 1100.0, 1200.0));
    let near = g::normalized(g::rectangle(610.0, 610.0, 1000.0, 1190.0));
    let bank = trace_enclosures(vec![trace.clone()], &[near.clone()], s);
    assert_eq!(bank.len(), 1);
    assert!(g::bbox(&bank[0]).2 <= 1000.0);
    assert!((g::area(&bank[0]) - area(&g::dry_clip(&s, &bank[0]))).abs() < 1.0);
    let far = g::normalized(g::rectangle(1064.0, 610.0, 1095.0, 1190.0));
    assert_eq!(trace_enclosures(vec![trace.clone()], &[near, far], s), vec![trace]);
    let mut water = river(800.0, 864.0);
    for (wet, other) in water.iter_mut().zip(river(1000.0, 1064.0)) { *wet |= other; }
    let s = surface(&height, &water);
    let circuit = g::normalized(g::rectangle(400.0, 600.0, 1100.0, 1200.0));
    let town = [g::normalized(g::rectangle(410.0, 610.0, 795.0, 1190.0)),
        g::normalized(g::rectangle(870.0, 610.0, 995.0, 1190.0))];
    let bank = trace_enclosures(vec![circuit], &town, s);
    assert_eq!(bank.len(), 1, "occupied banks keep their crossing");
    assert!(g::bbox(&bank[0]).2 <= 1000.0, "empty third bank is excluded");
    let pocket = notch(160.0, 100.0);
    let water = river(536.0, 568.0);
    let s = surface(&height, &water);
    assert_eq!(without_invaginations(&pocket, s), pocket, "no cut may enclose a new empty far bank");
}

#[test]
fn head_comparison_across_cultures_and_scales() {
    let height = vec![10.0; N * N];
    let cultures: Value = serde_json::from_str(include_str!("../catalogue.json")).unwrap();
    let mut changed = std::collections::BTreeSet::new();
    for culture in cultures["cultures"].as_object().unwrap().keys() {
        for pop in [500, 10_000] {
            if pop == 10_000 && matches!(culture.as_str(), "kraal" | "nomad-camp" | "inuit-camp" |
                "siberian-camp" | "mongol-ordu" | "native-plains" | "pnw-plank-village" |
                "guarani-village" | "budj-bim" | "maori-pa" | "myconid-colony" | "halfling") { continue; }
            for river_site in [false, true] {
                let water = if river_site { river(1240.0, 1296.0) } else { vec![0; N * N] };
                let s = surface(&height, &water);
                let cfg = LayoutConfig { site_archetype: if river_site { "bridge" } else { "plain" }.into(), ..LayoutConfig::default() };
                let site = Site { key: "walls3-head".into(), name: String::new(), population: pop,
                    culture: culture.clone(), center: pt(1000.0, 1000.0), radius: if pop == 500 { 180.0 } else { 500.0 },
                    neighbours: Vec::new(), };
                TRACE_PAIRS.with(|p| *p.borrow_mut() = Some(vec![]));
                CONTOUR_PAIRS.with(|p| *p.borrow_mut() = Some(vec![]));
                let c = composition::generate("walls3-head", &site, &cfg, s, &streets(), site.radius).unwrap();
                let pairs = TRACE_PAIRS.with(|p| p.borrow_mut().take().unwrap());
                let contours = CONTOUR_PAIRS.with(|p| p.borrow_mut().take().unwrap());
                let different = pairs.iter().any(|(a, b)| a != b);
                if different { changed.insert(format!("{culture}/{pop}/{}", if river_site { "river" } else { "dry" })); }
                for (before, after) in &pairs {
                    for trace in after {
                        assert!(before.iter().any(|s| !g::simple(s)) || g::simple(trace), "{culture}/{pop}: invalid circuit");
                        assert_eq!(without_invaginations(trace, s), *trace, "{culture}/{pop}: residual pocket");
                    }
                    if !different { assert_eq!(before, after); }
                }
                if let Ok(out) = std::env::var("WALLS3_PROBE_DIR") {
                    std::fs::create_dir_all(&out).unwrap();
                    let label = format!("{culture}-{pop}-{}", if river_site { "river" } else { "dry" });
                    std::fs::write(std::path::Path::new(&out).join(format!("{label}.json")),
                        serde_json::to_vec(&serde_json::json!({"pairs": pairs, "contours": contours, "phases": c.phases, "quarters": c.plan.quarters,
                            "enclosures": c.plan.enclosures})).unwrap()).unwrap();
                }
            }
        }
    }
    println!("WALLS3 changed versus HEAD traces: {}", changed.into_iter().collect::<Vec<_>>().join(", "));
}

#[test]
fn reviewed_wall_fixture() {
    let Ok(path) = std::env::var("WALLS4_FIXTURE") else { return };
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Fixture { seed: String, n: usize, width: f64, height: Vec<f32>, water: Vec<u8>,
        geometry: Option<VectorGeography>, sites: Vec<Site>, roads: Vec<Street>, layout_config: LayoutConfig }
    let f: Fixture = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    let geography = f.geometry.map(|g| Geography::new(g, f.width).unwrap());
    let s = Surface { geometry: geography.as_ref(), width: f.width, n: f.n, height: &f.height, water: &f.water, interpolation: Default::default(),};
    for site in &f.sites {
        TRACE_PAIRS.with(|p| *p.borrow_mut() = Some(vec![]));
        CONTOUR_PAIRS.with(|p| *p.borrow_mut() = Some(vec![]));
        let c = composition::generate(&f.seed, site, &f.layout_config, s, &f.roads, site.radius).unwrap();
        let pairs = TRACE_PAIRS.with(|p| p.borrow_mut().take().unwrap());
        let contours = CONTOUR_PAIRS.with(|p| p.borrow_mut().take().unwrap());
        assert!(!c.plan.enclosures.is_empty());
        assert!(!pairs.is_empty(), "fixture must exercise the current wall trace");
        if let Ok(out) = std::env::var("WALLS3_PROBE_DIR") {
            std::fs::create_dir_all(&out).unwrap();
            std::fs::write(std::path::Path::new(&out).join(format!("{}-real-river.json", site.culture)),
                serde_json::to_vec(&serde_json::json!({"pairs": pairs, "contours": contours,
                    "phases": c.phases, "quarters": c.plan.quarters, "enclosures": c.plan.enclosures})).unwrap()).unwrap();
        }
        for (before, after) in &pairs {
            for trace in after {
                assert!(g::simple(&Shape { outer: trace.outer.clone(), holes: vec![] }),
                    "{}: invalid outer circuit", site.culture);
                assert!(before.iter().any(|s| !g::simple(s)) || g::simple(trace),
                    "{}: invalid circuit", site.culture);
                assert_eq!(without_invaginations(trace, s), *trace, "{}: residual pocket", site.culture);
            }
        }
    }
}

#[test]
fn bastide_river_fixture_has_no_empty_far_bank() {
    let Ok(path) = std::env::var("WALLS3_RIVER_FIXTURE") else { return };
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Fixture { seed: String, n: usize, width: f64, height: Vec<f32>, water: Vec<u8>,
        geometry: Option<VectorGeography>, sites: Vec<Site>, roads: Vec<Street>, layout_config: LayoutConfig }
    let f: Fixture = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
    let geography = f.geometry.map(|g| Geography::new(g, f.width).unwrap());
    let s = Surface { geometry: geography.as_ref(), width: f.width, n: f.n, height: &f.height, water: &f.water, interpolation: Default::default(),};
    let site = f.sites.iter().find(|s| s.culture == "bastide").unwrap();
    TRACE_PAIRS.with(|p| *p.borrow_mut() = Some(vec![]));
    let c = composition::generate(&f.seed, site, &f.layout_config, s, &f.roads, site.radius).unwrap();
    let pairs = TRACE_PAIRS.with(|p| p.borrow_mut().take().unwrap());
    for (_, after) in &pairs {
        for trace in after {
            for bank in g::dry_clip(&s, trace) {
                if g::area(&bank) < 1.0 { continue; }
                assert!(c.plan.quarters.iter().any(|q| area(&g::intersection(&bank, &q.shape)) > 1.0),
                    "bastide encloses an empty far bank");
            }
        }
    }
    if let Ok(out) = std::env::var("WALLS3_PROBE_DIR") {
        std::fs::create_dir_all(&out).unwrap();
        std::fs::write(std::path::Path::new(&out).join("bastide-real-river.json"),
            serde_json::to_vec(&serde_json::json!({"pairs": pairs, "quarters": c.plan.quarters,
                "enclosures": c.plan.enclosures})).unwrap()).unwrap();
    }
}

/// Defect 1 of the review: a bastioned trace never takes the curtain into
/// the river along a bank (its bulges there are given back).
#[test]
fn bastioned_trace_never_runs_in_the_river() {
    let water = river(1310.0, 1420.0);
    let height = vec![10.0f32; N * N];
    let s = surface(&height, &water);
    let octa = g::normalized(Shape {
        outer: octagon()[..8].to_vec(),
        holes: vec![],
    });
    let land = g::intersection(&octa, &g::rectangle(0.0, 0.0, 1305.0, W))
        .into_iter()
        .next()
        .unwrap();
    let trace = bastioned_trace(&land, s).expect("a bastioned trace");
    let wet = wet_length(&trace.outer, s);
    assert!(wet < 1.0, "{wet:.0} m of curtain in the river");
    let covered = area(&g::intersection(&trace, &land));
    assert!(covered >= 0.98 * g::area(&land));
}
