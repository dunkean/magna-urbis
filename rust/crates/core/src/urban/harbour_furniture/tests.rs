use super::*;

const N: usize = 64;
const WIDTH: f64 = 256.0;

/// Flat ground with water of kind `code` for `x` in `[from, to)` (4 m cells).
fn raster(code: u8, from: f64, to: f64) -> (Vec<f32>, Vec<u8>) {
    let water = (0..N * N)
        .map(|i| {
            let x = ((i % N) as f64 + 0.5) * WIDTH / N as f64;
            if x >= from && x < to { code } else { 0 }
        })
        .collect();
    (vec![1.0; N * N], water)
}
fn ground<'a>(height: &'a [f32], water: &'a [u8]) -> Surface<'a> {
    Surface { geometry: None, width: WIDTH, n: N, height, water, interpolation: Default::default() }
}
fn rectangle(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
    Shape { outer: vec![Point { x: x0, y: y0 }, Point { x: x1, y: y0 }, Point { x: x1, y: y1 }, Point { x: x0, y: y1 }], holes: vec![] }
}
/// A quay street along `x`, from y = 40 to y = 216, with its platform.
fn quay(x: f64) -> (Vec<Street>, Vec<Quay>) {
    let street = Street { path: vec![Point { x, y: 40.0 }, Point { x, y: 216.0 }], widths: vec![6.0; 2], rank: 2, role: "quay".into() };
    let platform = Quay { kind: "quay".into(), shape: rectangle(x - 3.0, 40.0, x + 3.0, 216.0), deck_z_m: 2.0, material: "stone".into() };
    (vec![street], vec![platform])
}
fn count(found: &Plan, kind: &str) -> usize {
    found.items.iter().filter(|q| q.kind == kind).count()
}

/// Sea for x < 128: a merchant quay gets its quay wall, its cranes and its
/// boats, every hull on the water and clear of the existing pier; the
/// same seed gives the same harbour.
#[test]
fn a_sea_quay_is_furnished_on_clear_water() {
    let (height, water) = raster(1, 0.0, 128.0);
    let surface = ground(&height, &water);
    let (mut streets, mut platforms) = quay(132.0);
    streets.push(Street { path: vec![Point { x: 132.0, y: 100.0 }, Point { x: 100.0, y: 100.0 }], widths: vec![5.0; 2], rank: 3, role: "pier".into() });
    platforms.push(Quay { kind: "pier".into(), shape: rectangle(100.0, 97.5, 132.0, 102.5), deck_z_m: 2.0, material: "timber".into() });
    let harbour = plan("seed", "hanseatic", 10_000, "merchant-quay", &streets, &platforms, surface);
    assert_eq!(harbour.site, "sea");
    assert_eq!(harbour.family, "north-european");
    assert_eq!(harbour.types, vec!["merchant-quay"]);
    assert!(count(&harbour, "kerb") >= 10, "quay wall: {} kerbs", count(&harbour, "kerb"));
    assert!(count(&harbour, "crane") >= 1 && count(&harbour, "crane") == count(&harbour, "crane-jib"), "cranes {}", count(&harbour, "crane"));
    assert!(count(&harbour, "boat") <= MAX_BOATS);
    for item in harbour.items.iter().filter(|q| q.kind == "boat") {
        for p in &item.shape.outer {
            assert!(surface.wet(*p), "hull vertex on land: {p:?}");
            assert!(!(p.x > 100.0 && p.y > 97.5 && p.y < 102.5), "hull across the pier: {p:?}");
        }
        assert!(item.deck_z_m.is_finite());
    }
    let again = plan("seed", "hanseatic", 10_000, "merchant-quay", &streets, &platforms, surface);
    assert_eq!(harbour.items.len(), again.items.len());
    assert!(harbour.items.iter().zip(&again.items).all(|(a, b)| a.kind == b.kind && a.material == b.material && a.shape == b.shape));
}

/// The type is drawn with the town seed: stable for one town, varied
/// between towns of the same culture, always one the family builds on
/// that water; the planner reads the same draw for its moles.
#[test]
fn the_harbour_type_is_seeded_and_varies_between_towns() {
    let (height, water) = raster(1, 0.0, 128.0);
    let surface = ground(&height, &water);
    let (streets, platforms) = quay(132.0);
    assert_eq!(site_of("hanseatic", &streets, surface), Some("sea"));
    let family = &data()["families"]["north-european"]["types"];
    let mut seen = std::collections::BTreeSet::new();
    for town in 0..40 {
        let seed = format!("seed\u{1}settlement:town-{town}");
        let harbour = plan(&seed, "hanseatic", 10_000, "auto", &streets, &platforms, surface);
        assert!(!harbour.types.is_empty() && harbour.types.len() <= 2);
        for name in &harbour.types {
            assert!(family[*name].is_number(), "{name} is not a type of the family");
        }
        let choice = choose(&seed, "hanseatic", 10_000, "auto", "sea");
        assert_eq!(harbour.types, choice.types);
        assert_eq!(keeps_moles(&seed, "hanseatic", 10_000, "auto", &streets, surface), choice.moles);
        if choice.moles {
            assert!(num(&data()["types"][choice.types[0]], "moles", 0.0) > 0.0, "{} never keeps the moles", choice.types[0]);
        }
        seen.insert(harbour.types[0]);
    }
    assert!(seen.len() >= 3, "types drawn over 40 towns: {seen:?}");
    // A river-only type is never drawn on the sea, nor a village-only one in a town.
    assert!(!seen.contains("staithe") && !seen.contains("ferry-landing"));
    // `bare` and a quay away from the water keep the planner's works.
    assert!(keeps_moles("seed", "hanseatic", 10_000, "bare", &streets, surface));
    assert!(keeps_moles("seed", "hanseatic", 10_000, "auto", &quay(210.0).0, surface));
}

/// A 24 m river is a landing: two or three small boats alongside the bank
/// (parallel to the flow), no stage, crane, slip or raft, nothing past
/// the near half of the channel. Whatever the type asks for (a fishing
/// harbour moors stern-to on the sea).
#[test]
fn a_river_staithe_keeps_the_channel_free() {
    let (height, water) = raster(3, 116.0, 140.0);
    let surface = ground(&height, &water);
    let (streets, platforms) = quay(144.0);
    for wanted in ["staithe", "fishing-harbour"] {
        let harbour = plan("seed", "hanseatic", 4000, wanted, &streets, &platforms, surface);
        assert_eq!(harbour.site, "river");
        assert_eq!(harbour.types, vec![wanted]);
        assert!(count(&harbour, "basin") == 0 && count(&harbour, "breakwater") == 0);
        for kind in ["jetty", "crane", "slip", "raft", "boat-ashore"] {
            assert_eq!(count(&harbour, kind), 0, "{kind} on a 24 m river ({wanted})");
        }
        let boats: Vec<&Quay> = harbour.items.iter().filter(|q| q.kind == "boat").collect();
        assert!(!boats.is_empty() && boats.len() <= 3, "{} boats on a 24 m river ({wanted})", boats.len());
        for boat in boats {
            let (x0, y0, x1, y1) = bbox(&boat.shape.outer);
            assert!(y1 - y0 > x1 - x0, "boat square to the bank ({wanted})");
            assert!(boat.shape.outer.iter().all(|p| p.x > 127.0), "boat across the channel ({wanted})");
        }
    }
}

/// On an open sea front each forced type builds what its name says: a
/// mole harbour its breakwater, a fishing harbour its jetties, a shipyard
/// its slips, a small-craft basin its pontoon comb.
#[test]
fn each_harbour_type_builds_its_own_works_on_a_sea_front() {
    let (height, water) = raster(1, 0.0, 128.0);
    let surface = ground(&height, &water);
    let (streets, platforms) = quay(132.0);
    let built = |wanted: &str| plan("seed", "hanseatic", 10_000, wanted, &streets, &platforms, surface);
    assert!(count(&built("mole-harbour"), "breakwater") >= 2, "a mole harbour without its mole");
    assert!(count(&built("fishing-harbour"), "jetty") >= 3, "a fishing harbour without its jetties");
    assert!(count(&built("shipyard"), "slip") >= 3, "a shipyard without its slips");
    assert!(count(&built("small-craft-basin"), "jetty") >= 6, "a small-craft basin without its comb");
    assert_eq!(count(&built("merchant-quay"), "breakwater"), 0);
}

/// A town on a 56 m river with a bridge and no quay lands its boats: a
/// plain landing strip, three posts and small boats alongside the town bank,
/// parallel to the flow and clear of the bridge.
#[test]
fn a_river_town_without_quay_lands_its_boats_beside_its_bridge() {
    let (height, water) = raster(3, 84.0, 140.0);
    let surface = ground(&height, &water);
    let mut layout: Layout = serde_json::from_value(serde_json::json!({
        "key": "village", "culture": "hanseatic", "center": {"x": 200.0, "y": 128.0},
        "quarters": [], "blocks": [], "warnings": [], "structure": {},
        "streets": [{"path": [{"x": 160.0, "y": 128.0}, {"x": 60.0, "y": 128.0}], "widths": [5.0, 5.0], "rank": 2, "role": "bridge"}]
    }))
    .unwrap();
    furnish("seed", &mut layout, 2500, &LayoutConfig::default(), surface);
    let items = &layout.structure.as_ref().unwrap().quays;
    let of = |kind: &str| items.iter().filter(|q| q.kind == kind).collect::<Vec<_>>();
    assert_eq!(of("landing").len(), 1, "one plain landing strip");
    assert!(of("kerb").is_empty() && of("jetty").is_empty() && of("shiphouse").is_empty());
    assert_eq!(of("post").len(), 3);
    let boats = of("boat");
    assert!(!boats.is_empty() && boats.len() <= 3, "{} boats at the landing", boats.len());
    for boat in boats {
        let (x0, y0, x1, y1) = bbox(&boat.shape.outer);
        assert!(y1 - y0 > x1 - x0, "boat square to the river");
        assert!(x0 > 127.0 && x1 < 140.0, "boat off the town bank: {x0}..{x1}");
        assert!(y1 < 120.0 || y0 > 136.0, "boat under the bridge");
    }
    // Idempotent.
    furnish("seed", &mut layout, 2500, &LayoutConfig::default(), surface);
    assert_eq!(layout.structure.as_ref().unwrap().quays.iter().filter(|q| q.kind == "post").count(), 3);
}

/// A 512 m map of 4 m cells, sea all round an island of radius 90 m
/// centred on (256, 256), with a cove 28 m wide cut 46 m into its east
/// shore; `streets` are the settlement's own.
fn island_village(streets: serde_json::Value) -> ((Vec<f32>, Vec<u8>), Layout) {
    let n = 128;
    let water = (0..n * n)
        .map(|i| {
            let (x, y) = (((i % n) as f64 + 0.5) * 4.0, ((i / n) as f64 + 0.5) * 4.0);
            let land = (x - 256.0).hypot(y - 256.0) < 90.0 && !(x > 300.0 && (y - 256.0).abs() < 14.0);
            u8::from(!land)
        })
        .collect();
    let layout = serde_json::from_value(serde_json::json!({
        "key": "isle", "culture": "hanseatic", "center": {"x": 256.0, "y": 256.0},
        "quarters": [], "blocks": [], "warnings": [], "structure": {}, "streets": streets
    }))
    .unwrap();
    ((vec![1.0; n * n], water), layout)
}
fn isle<'a>(height: &'a [f32], water: &'a [u8]) -> Surface<'a> {
    Surface { geometry: None, width: 512.0, n: 128, height, water, interpolation: Default::default() }
}
fn of<'a>(layout: &'a Layout, kind: &str) -> Vec<&'a Quay> {
    layout.structure.as_ref().unwrap().quays.iter().filter(|q| q.kind == kind).collect()
}

/// A village in the middle of a small island, its streets 40 m from any
/// shore, gets a detached landing in the island's cove: one plain strip,
/// its posts, boats on the water, and a track to the village.
#[test]
fn an_island_village_away_from_its_shore_gets_a_detached_landing_in_a_cove() {
    let ((height, water), mut layout) = island_village(serde_json::json!([
        {"path": [{"x": 236.0, "y": 256.0}, {"x": 256.0, "y": 256.0}], "widths": [4.0, 4.0], "rank": 3, "role": "street"}
    ]));
    let surface = isle(&height, &water);
    furnish("seed", &mut layout, 300, &LayoutConfig::default(), surface);
    let kerbs = of(&layout, "landing");
    assert_eq!(kerbs.len(), 1, "one landing");
    assert!(of(&layout, "kerb").is_empty() && of(&layout, "jetty").is_empty() && of(&layout, "shiphouse").is_empty());
    let c = mean(&kerbs[0].shape.outer);
    assert!(c.x > 288.0 && c.x < 350.0 && (c.y - 256.0).abs() < 20.0, "the landing is not in the cove: {c:?}");
    let boats = of(&layout, "boat");
    assert!(!boats.is_empty() && boats.len() <= 3, "{} boats", boats.len());
    assert!(boats.iter().all(|b| b.shape.outer.iter().all(|&p| surface.wet(p))), "a boat on land");
    assert!(of(&layout, "breakwater").is_empty() && of(&layout, "crane").is_empty());
    let track = layout.streets.iter().find(|s| s.role == "track").expect("no track to the landing");
    let ends = [track.path[0], *track.path.last().unwrap()];
    assert!(ends.iter().any(|&p| dist(p, Point { x: 256.0, y: 256.0 }) < 1.0), "the track misses the village: {ends:?}");
    assert!(ends.iter().any(|&p| dist(p, c) < 8.0), "the track misses the landing: {ends:?}");
    // Idempotent: a second pass adds nothing.
    furnish("seed", &mut layout, 300, &LayoutConfig::default(), surface);
    assert_eq!(of(&layout, "landing").len(), 1);
    assert_eq!(layout.streets.iter().filter(|s| s.role == "track").count(), 1);
}

/// An island village whose streets reach the water lands its boats on its
/// own waterfront (the west shore).
#[test]
fn an_island_village_on_its_shore_lands_on_its_own_waterfront() {
    let ((height, water), mut layout) = island_village(serde_json::json!([
        {"path": [{"x": 256.0, "y": 256.0}, {"x": 176.0, "y": 256.0}], "widths": [4.0, 4.0], "rank": 3, "role": "street"}
    ]));
    let surface = isle(&height, &water);
    furnish("seed", &mut layout, 300, &LayoutConfig::default(), surface);
    let kerbs = of(&layout, "landing");
    assert_eq!(kerbs.len(), 1);
    assert!(mean(&kerbs[0].shape.outer).x < 200.0, "the landing left its waterfront");
    assert!(of(&layout, "shiphouse").is_empty());
}

/// Fifteen islanders: one small structure (a landing strip) and at most
/// three boats; no jetty, shed, crane or breakwater.
#[test]
fn a_tiny_island_settlement_gets_one_small_landing() {
    let ((height, water), mut layout) = island_village(serde_json::json!([
        {"path": [{"x": 246.0, "y": 256.0}, {"x": 256.0, "y": 256.0}], "widths": [3.0, 3.0], "rank": 4, "role": "lane"}
    ]));
    let surface = isle(&height, &water);
    furnish("seed", &mut layout, 15, &LayoutConfig::default(), surface);
    let structures: usize = ["landing", "kerb", "jetty", "slip", "shiphouse", "quay", "breakwater", "crane"].iter().map(|k| of(&layout, k).len()).sum();
    assert_eq!(structures, 1, "{:?}", layout.structure.as_ref().unwrap().quays.iter().map(|q| &q.kind).collect::<Vec<_>>());
    assert!(of(&layout, "boat").len() + of(&layout, "boat-ashore").len() <= 3);
}

/// A village's quay and an Underdark town's quay become one plain landing
/// on the waterline: the planner's platforms and stages go, no kerb,
/// jetty, crane, breakwater or shed; a strip, its posts, two or three
/// boats on the water. A town of the surface keeps its quays.
#[test]
fn villages_and_underdark_ports_land_on_one_plain_strip() {
    let (height, water) = raster(1, 0.0, 128.0);
    let surface = ground(&height, &water);
    let built = |culture: &str, population: u32| {
        let (streets, platforms) = quay(132.0);
        let mut layout: Layout = serde_json::from_value(serde_json::json!({
            "key": "port", "culture": culture, "center": {"x": 180.0, "y": 128.0},
            "quarters": [], "blocks": [], "warnings": [], "structure": {"quays": platforms}, "streets": streets
        }))
        .unwrap();
        layout.streets.push(Street { path: vec![Point { x: 132.0, y: 100.0 }, Point { x: 110.0, y: 100.0 }], widths: vec![3.0; 2], rank: 3, role: "landing".into() });
        furnish("seed", &mut layout, population, &LayoutConfig::default(), surface);
        layout
    };
    for (culture, population) in [("hanseatic", 600), ("drow-enclave", 10_000)] {
        let layout = built(culture, population);
        let kinds: Vec<&str> = layout.structure.as_ref().unwrap().quays.iter().map(|q| q.kind.as_str()).collect();
        assert_eq!(kinds.iter().filter(|&&k| k == "landing").count(), 1, "{culture}: {kinds:?}");
        for kind in ["quay", "kerb", "jetty", "crane", "breakwater", "shiphouse", "slip", "pier", "basin"] {
            assert!(!kinds.contains(&kind), "{culture}: {kind} in a plain landing");
        }
        let boats: Vec<&Quay> = layout.structure.as_ref().unwrap().quays.iter().filter(|q| q.kind == "boat").collect();
        assert!(!boats.is_empty() && boats.len() <= 3, "{culture}: {} boats", boats.len());
        assert!(boats.iter().all(|b| b.shape.outer.iter().all(|&p| surface.wet(p))));
        assert!(!layout.streets.iter().any(|s| s.role == "landing"), "{culture}: the stage street stays");
        assert!(!layout.streets.iter().any(|s| s.role == "quay"), "{culture}: quay paving on the bank");
        let deck = layout.structure.as_ref().unwrap().quays.iter().find(|q| q.kind == "landing").unwrap().deck_z_m;
        assert!(layout.structure.as_ref().unwrap().quays.iter().filter(|q| q.kind == "post").all(|q| (q.deck_z_m - (deck - 0.1)).abs() < 1e-9), "{culture}: posts a metre above the deck");
        // The strip lies on the waterline.
        let strip = layout.structure.as_ref().unwrap().quays.iter().find(|q| q.kind == "landing").unwrap();
        let (x0, _, x1, _) = bbox(&strip.shape.outer);
        assert!(x0 < 128.0 && x1 > 126.0 && x1 - x0 < 3.0, "{culture}: strip at x {x0}..{x1}");
        // Idempotent.
        let mut again = layout.clone();
        furnish("seed", &mut again, population, &LayoutConfig::default(), surface);
        assert_eq!(again.structure.as_ref().unwrap().quays.len(), layout.structure.as_ref().unwrap().quays.len());
    }
    // A town: one quay band on the waterline (4.5 m on the bank, 1 m over
        // the water), no kerb, finger piers out of it, its boats beside them;
        // its quay street stays.
    let town = built("hanseatic", 10_000);
    let quays = &town.structure.as_ref().unwrap().quays;
    let bands: Vec<&Quay> = quays.iter().filter(|q| q.kind == "quay").collect();
    assert_eq!(bands.len(), 1, "{:?}", quays.iter().map(|q| q.kind.as_str()).collect::<Vec<_>>());
    let (x0, _, x1, _) = bbox(&bands[0].shape.outer);
    assert!(x0 > 125.5 && x0 < 128.0 && (x1 - x0 - 5.5).abs() < 0.6, "band at x {x0}..{x1}");
        assert!(!quays.iter().any(|q| q.kind == "kerb"));
    assert!(town.streets.iter().any(|s| s.role == "quay"));
        assert!(!town.streets.iter().any(|s| s.role == "landing"));
        let (streets, platforms) = quay(132.0);
        let mut port: Layout = serde_json::from_value(serde_json::json!({
            "key": "port", "culture": "hanseatic", "center": {"x": 180.0, "y": 128.0},
            "quarters": [], "blocks": [], "warnings": [], "structure": {"quays": platforms}, "streets": streets
        }))
        .unwrap();
        furnish("seed", &mut port, 10_000, &LayoutConfig { port_type: "merchant-quay".into(), ..LayoutConfig::default() }, surface);
        let piers = of(&port, "jetty").into_iter().filter(|q| bbox(&q.shape.outer).0 < 116.0).count();
        assert!(piers >= 2, "{piers} finger piers");
        assert!(of(&port, "boat").len() >= 3);
}

/// A port town on a plateau 40 m above the sea (x < 100), its streets 110 m
/// from the shore, with the coast profile `rise(x)` (m above the water).
fn cliff_port(rise: impl Fn(f64) -> f64) -> ((Vec<f32>, Vec<u8>), Layout) {
    let water = (0..N * N).map(|i| u8::from(((i % N) as f64 + 0.5) * 4.0 < 100.0)).collect();
    let height = (0..N * N).map(|i| { let x = ((i % N) as f64 + 0.5) * 4.0; if x < 100.0 { 0.0 } else { rise(x).min(40.0) as f32 } }).collect();
    let layout = serde_json::from_value(serde_json::json!({
        "key": "cliff", "culture": "hanseatic", "center": {"x": 225.0, "y": 128.0},
        "quarters": [], "blocks": [], "warnings": [], "structure": {},
        "streets": [{"path": [{"x": 210.0, "y": 128.0}, {"x": 240.0, "y": 128.0}], "widths": [5.0, 5.0], "rank": 2, "role": "street"}]
    }))
    .unwrap();
    ((height, water), layout)
}
fn port_cfg() -> LayoutConfig {
    LayoutConfig { site_archetype: "harbor".into(), ..LayoutConfig::default() }
}

/// A shelf at the water (12 m at 1 m) under a 30° slope: a landing at the
/// foot and a path up to the town whose every leg keeps a footpath grade.
#[test]
fn a_plateau_port_lands_at_the_foot_of_its_slope_with_a_climbing_path() {
    let ((height, water), mut layout) = cliff_port(|x| if x < 112.0 { 1.0 } else { 1.0 + (x - 112.0) * 0.557 });
    let surface = ground(&height, &water);
    furnish("seed", &mut layout, 1200, &port_cfg(), surface);
    let items = &layout.structure.as_ref().unwrap().quays;
    let strip = items.iter().find(|q| q.kind == "landing").expect("no landing at the foot");
    assert!(bbox(&strip.shape.outer).0 < 101.0, "the landing is not at the water");
    assert!(items.iter().filter(|q| q.kind == "boat").all(|b| b.shape.outer.iter().all(|&p| surface.wet(p))));
    let track = layout.streets.iter().find(|s| s.role == "track").expect("no path up to the town");
    for w in track.path.windows(2) {
        let (run, climb) = (dist(w[0], w[1]), (surface.height_at(w[1]) - surface.height_at(w[0])).abs());
        assert!(climb <= FOOTPATH_GRADE * run + 0.5, "a leg climbs {climb:.1} m over {run:.1} m");
    }
    let (start, end) = (track.path[0], *track.path.last().unwrap());
    assert!(surface.height_at(start).min(surface.height_at(end)) < 3.0 && surface.height_at(start).max(surface.height_at(end)) > 35.0, "the path does not join the foot to the plateau");
}

/// A sheer cliff (35 m within 10 m of the water) lands nothing.
#[test]
fn a_sheer_cliff_lands_nothing() {
    let ((height, water), mut layout) = cliff_port(|x| (x - 100.0) * 3.5);
    let surface = ground(&height, &water);
    furnish("seed", &mut layout, 1200, &port_cfg(), surface);
    assert!(layout.structure.as_ref().unwrap().quays.is_empty());
    assert!(!layout.streets.iter().any(|s| s.role == "track"));
}

/// A steep bank (35°) with no shelf: no landing, a few boats moored at its
/// foot, a path down.
#[test]
fn a_steep_bank_without_shelf_gets_boats_only() {
    let ((height, water), mut layout) = cliff_port(|x| (x - 100.0) * 0.7);
    let surface = ground(&height, &water);
    furnish("seed", &mut layout, 1200, &port_cfg(), surface);
    let items = &layout.structure.as_ref().unwrap().quays;
    assert!(!items.iter().any(|q| q.kind == "landing" || q.kind == "post"), "a landing on a steep bank");
    let boats: Vec<&Quay> = items.iter().filter(|q| q.kind == "boat").collect();
    assert!(!boats.is_empty() && boats.iter().all(|b| b.shape.outer.iter().all(|&p| surface.wet(p))));
    assert!(layout.streets.iter().any(|s| s.role == "track"), "no path down to the boats");
}

/// A mainland village inland (the land reaches the map edge, no fishing
/// economy) gets no landing.
#[test]
fn a_mainland_inland_village_gets_no_landing() {
    let n = 128;
    let water: Vec<u8> = (0..n * n).map(|i| u8::from(((i % n) as f64 + 0.5) * 4.0 < 40.0)).collect();
    let height = vec![1.0; n * n];
    let surface = isle(&height, &water);
    let mut layout: Layout = serde_json::from_value(serde_json::json!({
        "key": "inland", "culture": "hanseatic", "center": {"x": 300.0, "y": 256.0},
        "quarters": [], "blocks": [], "warnings": [], "structure": {},
        "streets": [{"path": [{"x": 290.0, "y": 256.0}, {"x": 310.0, "y": 256.0}], "widths": [4.0, 4.0], "rank": 3, "role": "street"}]
    }))
    .unwrap();
    furnish("seed", &mut layout, 300, &LayoutConfig::default(), surface);
    assert!(layout.structure.as_ref().unwrap().quays.is_empty());
    assert!(!layout.streets.iter().any(|s| s.role == "track"));
}

/// A wide river (60 m) keeps its staithe stages and boats, all short of a
/// quarter of the channel, every boat alongside the bank.
#[test]
fn a_wide_river_staithe_stays_along_its_bank() {
    let (height, water) = raster(3, 84.0, 140.0);
    let surface = ground(&height, &water);
    let (streets, platforms) = quay(144.0);
    let harbour = plan("seed", "hanseatic", 6000, "staithe", &streets, &platforms, surface);
    assert_eq!(harbour.site, "river");
    assert!(count(&harbour, "boat") >= 3, "{} boats on a 60 m river", count(&harbour, "boat"));
    for item in harbour.items.iter().filter(|q| matches!(q.kind.as_str(), "boat" | "jetty" | "raft" | "slip")) {
        assert!(item.shape.outer.iter().all(|p| p.x > 140.0 - 0.25 * 56.0 - 0.5), "{} reaches past a quarter of the river", item.kind);
        if item.kind == "boat" {
            let (x0, y0, x1, y1) = bbox(&item.shape.outer);
            assert!(y1 - y0 > x1 - x0, "boat square to the bank");
        }
    }
}

/// `bare` keeps the planner's quays alone; a quay away from any water gets nothing.
#[test]
fn a_bare_port_and_a_dry_quay_get_no_furniture() {
    let (height, water) = raster(1, 0.0, 128.0);
    let surface = ground(&height, &water);
    let (streets, platforms) = quay(132.0);
    assert!(plan("seed", "hanseatic", 10_000, "bare", &streets, &platforms, surface).items.is_empty());
    let (dry, dry_platforms) = quay(210.0);
    assert_eq!(site_of("hanseatic", &dry, surface), None);
    let inland = plan("seed", "hanseatic", 10_000, "auto", &dry, &dry_platforms, surface);
    assert!(inland.items.is_empty() && inland.types.is_empty());
}

/// The catalogue is closed: families name known types, boat classes and
/// cultures; every culture of the urban catalogue belongs to one family.
#[test]
fn the_harbour_catalogue_is_consistent() {
    let (types, boats) = (&data()["types"], &data()["boats"]);
    let cultures = &super::super::catalogue()["cultures"];
    let mut listed = std::collections::BTreeSet::new();
    for (name, family) in data()["families"].as_object().unwrap() {
        for (kind, weight) in family["types"].as_object().unwrap() {
            assert!(types[kind].is_object() && weight.as_f64().is_some_and(|w| w > 0.0), "{name}: type {kind}");
        }
        for role in ["merchant", "lighter", "fishing", "small", "war", "ferry"] {
            let class = family["boats"][role].as_str().unwrap_or("");
            assert!(boats[class]["length"].as_f64().is_some_and(|l| l > 0.0), "{name}: boat {role} = {class}");
        }
        for culture in family["cultures"].as_array().unwrap() {
            let culture = culture.as_str().unwrap();
            assert!(cultures[culture].is_object(), "{name}: unknown culture {culture}");
            assert!(listed.insert(culture.to_string()), "{culture} is in two families");
        }
    }
    for (kind, recipe) in types.as_object().unwrap() {
        assert_eq!(recipe["label"].as_array().map(Vec::len), Some(2), "{kind}: label");
        assert!((0.0..=1.0).contains(&num(recipe, "moles", 0.0)), "{kind}: moles is a probability");
        for role in recipe["boats"].as_object().unwrap().keys() {
            assert!(["merchant", "lighter", "fishing", "small", "war", "ferry"].contains(&role.as_str()), "{kind}: role {role}");
        }
    }
    for culture in cultures.as_object().unwrap().keys() {
        assert!(listed.contains(culture), "{culture} has no harbour family");
    }
}
