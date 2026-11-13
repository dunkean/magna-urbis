//! Activity sites (catalogue P3): placed on satisfying anchors near their parent, only
//! culture-allowed buildings, and the road network unchanged while `activityAccess` is off.
use magna_urbis_core::resources::RegionInput;
use magna_urbis_core::settlements::roads::RoadConfig;
use magna_urbis_core::settlements::{Config, Point, Raster, SettlementSpec, Terrain};

const WIDTH: f64 = 16000.0;
const N: usize = 128;

struct Map {
    height: Vec<f32>,
    water: Vec<u8>,
    level: Vec<f32>,
    widths: Vec<f32>,
    ids: Vec<i32>,
}
/// Rolling hills cut by a north-south river valley.
fn map() -> Map {
    let cell = WIDTH / N as f64;
    let mut m = Map { height: vec![0.0; N * N], water: vec![0; N * N], level: vec![0.0; N * N], widths: vec![0.0; N * N], ids: vec![-1; N * N] };
    for i in 0..N * N {
        let (x, y) = (((i % N) as f64 + 0.5) * cell, ((i / N) as f64 + 0.5) * cell);
        let valley = ((x - 8000.0).abs() / 2500.0).min(1.0);
        let h = 40.0 + 0.002 * (WIDTH - y) + 160.0 * valley + 60.0 * (x / 1900.0).sin() * (y / 2300.0).cos() + 20.0 * (x / 700.0 + y / 900.0).sin();
        m.height[i] = h as f32;
        m.level[i] = h as f32;
        if (x - 8000.0).abs() < 90.0 {
            m.water[i] = 3;
            m.widths[i] = 20.0;
            m.ids[i] = 0;
            m.level[i] = h as f32 + 0.5;
        }
    }
    m
}
fn terrain(m: &Map) -> Terrain {
    let mut t = Terrain::new(Raster { width: WIDTH, n: N, height: &m.height, water: &m.water, water_level: &m.level, river_width: &m.widths, river_ids: &m.ids }).unwrap();
    t.set_region(RegionInput { seed: "p3".into(), biome: "temperate".into(), ..Default::default() });
    t
}
fn places(culture: &str) -> Config {
    let at = |key: &str, population: u32, x: f64, y: f64| SettlementSpec {
        key: key.into(),
        population,
        culture: culture.into(),
        position: Some(Point { x, y }),
        ..Default::default()
    };
    Config {
        mode: "list".into(),
        list: vec![at("town", 3000, 7600.0, 8000.0), at("village", 400, 7700.0, 3000.0), at("hamlet", 60, 12000.0, 12500.0), at("west", 500, 3000.0, 9000.0)],
        ..Default::default()
    }
}

#[test]
fn activity_sites_sit_on_anchors_by_culture_and_leave_roads_alone_when_off() {
    let catalogue: serde_json::Value = serde_json::from_str(include_str!("../src/urban/activities.json")).unwrap();
    let template = |id: &str| catalogue["sites"].as_array().unwrap().iter().find(|s| s["id"] == id).unwrap().clone();
    let m = map();
    let t = terrain(&m);
    let out = t.place("p3", &places("european-organic")).unwrap();
    let anchors = &t.resources().anchors;
    assert!(!out.activities.is_empty(), "no activity site from {} anchors", anchors.len());
    // Farms, monasteries, remote places and network nodes are placed on the countryside, not on a resource anchor.
    for a in out.activities.iter().filter(|a| !matches!(a.kind.as_str(), "farm" | "worship" | "network_node" | "remote")) {
        // On its own anchor, which offers what the template asks for.
        let anchor = anchors.iter().find(|x| format!("{:016x}", x.id) == a.anchor).expect("site without anchor");
        assert_eq!((anchor.x, anchor.y), (a.x, a.y), "{}", a.id);
        let offer = match anchor.kind {
            "mine" => match anchor.resource { "small_coal" => "coal", "salt_spring" => "salt_deposit", "gypsum_quarry" => "stone_ashlar", _ => "ore" },
            _ => anchor.resource,
        };
        let tpl = template(&a.template);
        assert!(tpl["context"].as_array().unwrap().iter().any(|c| c.as_str().unwrap().split('|').any(|id| id == offer)), "{} on {offer}", a.template);
        // Near its parent, outside every settlement.
        let parent = out.settlements.iter().find(|s| s.spec.key == a.parent).unwrap();
        let edge = |s: &magna_urbis_core::settlements::Settlement| (a.x - s.center.x).hypot(a.y - s.center.y) - s.radius;
        let limit = if a.mode == "attached_external" { 4000.0 + 0.25 * parent.radius } else { 12000.0 };
        assert!(edge(parent) <= limit, "{} {:.0} m from {}", a.id, edge(parent), a.parent);
        assert!(out.settlements.iter().all(|s| edge(s) >= 120.0), "{} inside a settlement", a.id);
        assert!(out.settlements.iter().all(|s| edge(s) >= edge(parent) - 1e-9), "{} not tied to the nearest place", a.id);
        assert_eq!(a.residents, 0);
        assert!(!a.buildings.is_empty() && a.buildings.iter().all(|b| b.massing.is_array()), "{}", a.id);
    }
    let mut ids: Vec<&str> = out.activities.iter().filter(|a| !matches!(a.kind.as_str(), "farm" | "worship" | "network_node" | "remote")).map(|a| a.anchor.as_str()).collect();
    ids.sort();
    ids.dedup();
    let anchored_n = out.activities.iter().filter(|a| !matches!(a.kind.as_str(), "farm" | "worship" | "network_node" | "remote")).count();
    assert!(anchored_n > 0, "no anchored site");
    assert_eq!(ids.len(), anchored_n, "two sites on one anchor");
    // Deterministic.
    assert_eq!(serde_json::to_string(&out.activities).unwrap(), serde_json::to_string(&t.place("p3", &places("european-organic")).unwrap().activities).unwrap());
    // Inca: no carted mills (water or wind gristmills are denied).
    let inca = t.place("p3", &places("inca")).unwrap();
    assert!(!inca.activities.is_empty());
    for a in &inca.activities {
        for b in &a.buildings {
            assert!(!matches!(b.archetype.as_str(), "water_gristmill" | "wind_gristmill"), "inca {} in {}", b.archetype, a.id);
        }
    }
    // Roads: with the switch off, the sites change nothing; on, they add tracks or trails.
    let all = out.road_sites();
    let settlements: Vec<_> = all.iter().filter(|s| s.access.is_none()).cloned().collect();
    assert!(all.len() > settlements.len());
    // The access switch is on by default: turn it off for the comparison.
    let cfg = RoadConfig { activity_access: false, ..RoadConfig::default() };
    let base = serde_json::to_string(&t.roads("p3", &settlements, &cfg).unwrap()).unwrap();
    assert_eq!(base, serde_json::to_string(&t.roads("p3", &all, &cfg).unwrap()).unwrap(), "activityAccess off moved the network");
    let on = t.roads("p3", &all, &RoadConfig { activity_access: true, ..cfg }).unwrap();
    assert!(on.junctions.iter().any(|j| j.site.as_deref().is_some_and(|s| s.starts_with("activity:"))), "no access track reached");
    eprintln!("{} sites ({} inca), {} buildings", out.activities.len(), inca.activities.len(), out.activities.iter().map(|a| a.buildings.len()).sum::<usize>());
}

#[test]
fn network_nodes_leave_roads_alone_and_installations_follow_the_ground() {
    let m = map();
    let t = terrain(&m);
    let cell = WIDTH / N as f64;
    let water = |p: Point| m.water[((p.y / cell) as usize).min(N - 1) * N + ((p.x / cell) as usize).min(N - 1)];
    let cfg = places_two_banks("european-organic");
    let out = t.place("p4", &cfg).unwrap();
    let sites: Vec<_> = out.road_sites().into_iter().filter(|s| s.access.is_none()).collect();
    let rc = RoadConfig::default();
    let with = t.roads("p4", &sites, &rc).unwrap();
    // Nodes read the network: without them it is the same network.
    let mut without = t.roads("p4", &sites, &RoadConfig { network_nodes: false, ..rc.clone() }).unwrap();
    assert!(without.nodes.is_empty());
    without.nodes = with.nodes.clone();
    assert_eq!(serde_json::to_string(&with).unwrap(), serde_json::to_string(&without).unwrap(), "nodes moved the network");
    assert!(!with.nodes.is_empty(), "no network node");
    let off_road = |p: Point| {
        with.segments.iter().all(|s| {
            s.path.windows(2).all(|w| {
                let (dx, dy) = (w[1].x - w[0].x, w[1].y - w[0].y);
                let l2 = (dx * dx + dy * dy).max(1e-9);
                let k = (((p.x - w[0].x) * dx + (p.y - w[0].y) * dy) / l2).clamp(0.0, 1.0);
                (p.x - w[0].x - dx * k).hypot(p.y - w[0].y - dy * k) > s.width / 2.0
            })
        })
    };
    for n in &with.nodes {
        assert_eq!(n.mode, "network_node");
        assert!(!n.buildings.is_empty());
        for p in n.buildings.iter().flat_map(|b| &b.ring) {
            assert!(water(*p) == 0 && off_road(*p), "{} building on water or road at {p:?}", n.id);
        }
    }
    // A mill's weir crosses its river.
    let mill = out.activities.iter().flat_map(|a| &a.installations).find(|i| i.archetype == "mill_weir").expect("no mill weir");
    assert_eq!(mill.kind, "water_structure");
    let (a, b) = (mill.points[0], mill.points[1]);
    assert!((0..=20).any(|k| water(Point { x: a.x + (b.x - a.x) * k as f64 / 20.0, y: a.y + (b.y - a.y) * k as f64 / 20.0 }) == 3), "weir off the river");
    // Culture gates: no cart inn for the Inca, no caravanserai in Europe.
    assert!(with.nodes.iter().all(|n| n.buildings.iter().all(|b| b.archetype != "caravanserai")));
    let inca = t.place("p4", &places_two_banks("inca")).unwrap();
    let inca_sites: Vec<_> = inca.road_sites().into_iter().filter(|s| s.access.is_none()).collect();
    let inca_roads = t.roads("p4", &inca_sites, &rc).unwrap();
    for n in &inca_roads.nodes {
        assert!(n.template != "road_waystation" && n.buildings.iter().all(|b| b.archetype != "roadside_inn"), "inca {}", n.id);
    }
    eprintln!("nodes: {:?} | inca {:?}", with.nodes.iter().map(|n| &n.template).collect::<Vec<_>>(), inca_roads.nodes.iter().map(|n| &n.template).collect::<Vec<_>>());
}
/// Two towns facing each other across the river, so a main road bridges it.
fn places_two_banks(culture: &str) -> Config {
    let mut c = places(culture);
    c.list.push(SettlementSpec { key: "east".into(), population: 2500, culture: culture.into(), position: Some(Point { x: 10500.0, y: 8600.0 }), ..Default::default() });
    c
}
