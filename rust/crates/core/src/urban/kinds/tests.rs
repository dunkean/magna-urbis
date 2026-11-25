use super::super::{
    LayoutConfig, ParcelConfig, Site, Street, Surface, generate_parcels, generate_quarters,
};
use super::*;

/// Road chain invariant: the track of an isolated place is routed over land or not built.
/// Across a sea bay cutting the whole map (no way round) the place keeps no straight track
/// over the water; on open ground the track still joins the road.
#[test]
fn an_isolated_place_gets_no_track_across_water() {
    let n = 256;
    let height = vec![5.0f32; n * n];
    let cell = 2000.0 / n as f64;
    // The bay: x from 900 to 1300 m, over the whole height of the map.
    let bay: Vec<u8> = (0..n * n).map(|k| u8::from((900.0..1300.0).contains(&(((k % n) as f64 + 0.5) * cell)))).collect();
    let dry = vec![0u8; n * n];
    let (road, place) = (Point { x: 700.0, y: 1000.0 }, Point { x: 1500.0, y: 1000.0 });
    let over = |water: &[u8]| track(Surface { geometry: None, width: 2000.0, n, height: &height, water, interpolation: Default::default() }, road, place, 0.12);
    assert_eq!(over(&bay), vec![place], "a track over the bay");
    let land = over(&dry);
    assert!(land.len() >= 2 && dist(land[0], road) < 30.0 && dist(*land.last().unwrap(), place) < 30.0, "{land:?}");
}

fn run(population: u32, cfg: &LayoutConfig) -> (Layout, super::super::Partition) {
    let n = 128;
    let height = vec![0.0; n * n];
    let water = vec![0u8; n * n];
    let surface = Surface {
        geometry: None,
        width: 8000.0,
        n,
        height: &height,
        water: &water,
        interpolation: Default::default(),
    };
    let road = Street {
        path: vec![
            Point {
                x: 500.0,
                y: 4020.0,
            },
            Point {
                x: 7500.0,
                y: 3980.0,
            },
        ],
        widths: vec![6.0, 6.0],
        rank: 0,
        role: "regional".into(),
    };
    let site = Site {
        key: "kind".into(),
        name: String::new(),
        population,
        culture: "european-organic".into(),
        center: Point {
            x: 4000.0,
            y: 4060.0,
        },
        radius: crate::settlements::extent_radius(population),
        neighbours: Vec::new(),
    };
    let layouts = generate_quarters("kinds", &[site], cfg, surface, &[road]).unwrap();
    let partitions = generate_parcels("kinds", &layouts, &ParcelConfig::default()).unwrap();
    (layouts[0].clone(), partitions[0].clone())
}

/// An isolated structure keeps its whole plot even at a road junction,
/// and an isolated mill stands on the nearest bank, its plot backing onto
/// the water (« un moulin est sur son bief »).
#[test]
fn isolated_structures_have_their_whole_plot_and_a_mill_its_bank() {
    let n = 256;
    let height = vec![0.0; n * n];
    // A river band 40 m wide, 300 m east of the site.
    let cell = 2000.0 / n as f64;
    let water: Vec<u8> = (0..n * n)
        .map(|k| {
            let x = ((k % n) as f64 + 0.5) * cell;
            u8::from((1300.0..1340.0).contains(&x))
        })
        .collect();
    let surface = Surface {
        geometry: None,
        width: 2000.0,
        n,
        height: &height,
        water: &water,
        interpolation: Default::default(),
    };
    let p = |x: f64, y: f64| Point { x, y };
    let road = |a: Point, b: Point| Street {
        path: vec![a, b],
        widths: vec![6.0, 6.0],
        rank: 1,
        role: "regional".into(),
    };
    // Three roads meeting at the site.
    let roads = [
        road(p(1000.0, 1000.0), p(400.0, 1000.0)),
        road(p(1000.0, 1000.0), p(1200.0, 1000.0)),
        road(p(1000.0, 1000.0), p(1000.0, 400.0)),
    ];
    let site = Site {
        key: "isolated".into(),
        name: String::new(),
        population: 12,
        culture: "european-organic".into(),
        center: p(1004.0, 1004.0),
        radius: 30.0,
        neighbours: Vec::new(),
    };
    for (role, planned) in [
        ("isolated-shrine", 16.0 * 20.0),
        ("isolated-mill", 30.0 * 40.0),
    ] {
        let mut cfg = LayoutConfig::default();
        cfg.programme.intent = role.into();
        let l = &generate_quarters(
            "isolated",
            std::slice::from_ref(&site),
            &cfg,
            surface,
            &roads,
        )
        .unwrap()[0];
        let plot = &l.blocks[0].shape;
        assert!(
            g::area(plot) >= WHOLE_PLOT * 0.9 * 0.92 * planned,
            "{role}: {}",
            g::area(plot)
        );
        let near_water = plot.outer.iter().any(|q| (1290.0..1300.5).contains(&q.x));
        assert_eq!(near_water, role == "isolated-mill", "{role}");
    }
}

/// The `activity` intent lays one template's yard: a plot hugging its buildings, a water
/// template on the bank, installations as ground blocks beside it.
#[test]
fn an_activity_site_is_a_yard_with_its_installations() {
    let n = 256;
    let height: Vec<f32> = (0..n * n).map(|k| 0.05 * (k % n) as f32).collect();
    let cell = 2000.0 / n as f64;
    let water: Vec<u8> = (0..n * n).map(|k| 3 * u8::from((1300.0..1340.0).contains(&(((k % n) as f64 + 0.5) * cell)))).collect();
    let surface = Surface { geometry: None, width: 2000.0, n, height: &height, water: &water, interpolation: Default::default(),};
    let site = Site { key: "activity".into(), name: String::new(), population: 12, culture: "european-organic".into(), center: Point { x: 1004.0, y: 1004.0 }, radius: 30.0, neighbours: Vec::new() };
    for template in ["river_watermill", "stone_quarry", "forest_logging"] {
        let mut cfg = LayoutConfig::default();
        cfg.programme.intent = "activity".into();
        cfg.programme.template = template.into();
        let l = &generate_quarters("activity", std::slice::from_ref(&site), &cfg, surface, &[]).unwrap()[0];
        assert!(matches!(l.blocks[0].kind.as_str(), "block" | "reserve:programme"), "{template}: {}", l.blocks[0].kind);
        let centre = l.structure.as_ref().unwrap().centers[0].point;
        let yard = super::super::activities::site_yard(template, "european-organic", "activity", centre, l.blocks[0].axis.y.atan2(l.blocks[0].axis.x), &surface);
        assert!(yard.len() >= 2, "{template}: {} buildings", yard.len());
        assert!(l.blocks.len() > 1, "{template}: no installation block");
        if template == "river_watermill" {
            assert!(l.blocks[0].shape.outer.iter().any(|q| (1290.0..1400.0).contains(&q.x)), "mill not on the bank");
        }
    }
}

/// A plot strip along a bending road is one piece on the requested side,
/// even when a bend lies close to the end of a short slice.
#[test]
fn a_strip_along_a_bending_road_is_one_piece() {
    let road: Vec<Point> = (0..40)
        .map(|i| {
            let x = f64::from(i) * 20.0;
            Point {
                x,
                y: 30.0 * (x / 160.0).sin(),
            }
        })
        .collect();
    for (a, b) in [(0.0, 760.0), (95.0, 135.0), (210.0, 250.0)] {
        let path = slice(&road, a, b);
        let length = *arc(&path).last().unwrap();
        for left in [true, false] {
            let strip = side(&path, 3.0, 60.0, left).unwrap();
            let ratio = g::area(&strip) / (length * 60.0);
            assert!((0.85..1.15).contains(&ratio), "{a}-{b} {left}: {ratio}");
            // The strip lies on the requested side of the road.
            let c = g::interior_point(&strip);
            let (_, _, q) = path
                .windows(2)
                .map(|w| g::distance(c, w[0], w[1]))
                .min_by(|x, y| x.0.total_cmp(&y.0))
                .unwrap();
            let n = perp(point_at(&path, length * 0.5).1);
            assert_eq!((c.x - q.x) * n.x + (c.y - q.y) * n.y > 0.0, left);
        }
    }
}

/// One focused test per end of the range: an 8-inhabitant farmstead is one
/// plot with one farm (house + barn + yard) on a track, no quarter grid; a
/// 300 000-inhabitant metropolis has several centres (wards), an absorbed
/// village and an old circuit turned boulevard.
#[test]
fn a_farmstead_is_one_farm_and_a_metropolis_has_wards() {
    let (l, p) = run(8, &LayoutConfig::default());
    assert_eq!(l.archetype, "farmstead");
    assert_eq!(l.quarters.len(), 1, "no quarter grid");
    assert!(l.enclosures.is_empty());
    assert!(
        l.streets
            .iter()
            .all(|s| matches!(s.role.as_str(), "regional" | "track")),
        "{:?}",
        l.streets.iter().map(|s| &s.role).collect::<Vec<_>>()
    );
    let built: Vec<_> = p
        .programme
        .as_ref()
        .unwrap()
        .allocations
        .iter()
        .filter(|a| !a.role.starts_with("open."))
        .collect();
    assert!((1..=3).contains(&built.len()), "{built:?}");
    assert!(built.iter().any(|a| a.role.starts_with("dwelling.farm")));
    // The user's configuration is kept on the layout.
    assert_eq!(l.config.as_ref().unwrap().programme.intent, "settlement");

    let (m, _) = run(300_000, &LayoutConfig::default());
    assert_eq!(m.archetype, "metropolis");
    let s = m.structure.as_ref().unwrap();
    assert!(s.centers.len() >= 3, "{} centres", s.centers.len());
    let wards: std::collections::BTreeSet<_> = s.districts.iter().map(|d| d.center).collect();
    assert!(
        wards.len() >= 3,
        "districts lean on {} centres",
        wards.len()
    );
    assert!(m.phases.iter().any(|p| p.kind == "absorbed-village"));
    assert!(
        m.streets.iter().any(|s| s.role == "ring"),
        "old wall line as boulevard"
    );
}
