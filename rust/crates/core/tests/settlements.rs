use magna_urbis_core::settlements::roads::{RoadConfig, RoadOutput, RoadSite};
use magna_urbis_core::settlements::{
    Config, Output, Point, Raster, SettlementSpec, Terrain, extent_gap, generate, pair_spacing,
};

const WIDTH: f64 = 16000.0;

struct Map {
    height: Vec<f32>,
    water: Vec<u8>,
    level: Vec<f32>,
    widths: Vec<f32>,
    ids: Vec<i32>,
    n: usize,
}
impl Map {
    fn new() -> Self {
        Self::sized(128)
    }
    fn sized(n: usize) -> Self {
        Self {
            height: vec![30.0; n * n],
            water: vec![0; n * n],
            level: vec![30.0; n * n],
            widths: vec![0.0; n * n],
            ids: vec![-1; n * n],
            n,
        }
    }
    fn raster(&self) -> Raster<'_> {
        Raster {
            width: WIDTH,
            n: self.n,
            height: &self.height,
            water: &self.water,
            water_level: &self.level,
            river_width: &self.widths,
            river_ids: &self.ids,
        }
    }
    fn terrain(&self) -> Terrain {
        Terrain::new(self.raster()).unwrap()
    }
    fn strip(&mut self, kind: u8) {
        for y in 0..self.n {
            for x in 61..67 {
                let i = y * self.n + x;
                self.water[i] = kind;
                self.level[i] = 20.0;
                self.widths[i] = 30.0;
                self.ids[i] = if kind == 3 { 0 } else { -1 };
            }
        }
    }
    fn index(&self, p: Point) -> usize {
        let c = |v: f64| ((v / WIDTH * self.n as f64) as usize).min(self.n - 1);
        c(p.y) * self.n + c(p.x)
    }
}
fn fixed(key: &str, pop: u32, x: f64, y: f64) -> SettlementSpec {
    SettlementSpec {
        key: key.into(),
        population: pop,
        position: Some(Point { x, y }),
        ..Default::default()
    }
}
fn list(places: Vec<SettlementSpec>) -> Config {
    Config {
        mode: "list".into(),
        list: places,
        ..Default::default()
    }
}
fn sites(out: &Output) -> Vec<RoadSite> {
    // The bench sends placed settlements as JSON; extra fields must be ignored.
    serde_json::from_str(&serde_json::to_string(&out.settlements).unwrap()).unwrap()
}
fn no_exits() -> RoadConfig {
    RoadConfig {
        exits: 0,
        ..Default::default()
    }
}
fn place_and_route(
    map: &Map,
    seed: &str,
    cfg: &Config,
    roads: &RoadConfig,
) -> (Output, RoadOutput) {
    let t = map.terrain();
    let placed = t.place(seed, cfg).unwrap();
    let routed = t.roads(seed, &sites(&placed), roads).unwrap();
    (placed, routed)
}
fn sinuosity(r: &RoadOutput) -> f64 {
    let s = r
        .segments
        .iter()
        .max_by(|a, b| a.length.total_cmp(&b.length))
        .unwrap();
    s.length / s.path[0].distance_to(*s.path.last().unwrap())
}
trait Distance {
    fn distance_to(self, b: Point) -> f64;
}
impl Distance for Point {
    fn distance_to(self, b: Point) -> f64 {
        (self.x - b.x).hypot(self.y - b.y)
    }
}
fn segment_distance(p: Point, a: Point, b: Point) -> f64 {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let den = dx * dx + dy * dy;
    let t = if den > 0.0 {
        (((p.x - a.x) * dx + (p.y - a.y) * dy) / den).clamp(0.0, 1.0)
    } else {
        0.0
    };
    p.distance_to(Point {
        x: a.x + t * dx,
        y: a.y + t * dy,
    })
}
fn polyline_distance(p: Point, path: &[Point]) -> f64 {
    path.windows(2)
        .map(|w| segment_distance(p, w[0], w[1]))
        .fold(f64::INFINITY, f64::min)
}
fn crosses(a: Point, b: Point, c: Point, d: Point) -> Option<Point> {
    let r = (b.x - a.x, b.y - a.y);
    let s = (d.x - c.x, d.y - c.y);
    let den = r.0 * s.1 - r.1 * s.0;
    if den.abs() < 1e-12 {
        return None;
    }
    let t = ((c.x - a.x) * s.1 - (c.y - a.y) * s.0) / den;
    let u = ((c.x - a.x) * r.1 - (c.y - a.y) * r.0) / den;
    ((0.0..=1.0).contains(&t) && (0.0..=1.0).contains(&u)).then_some(Point {
        x: a.x + t * r.0,
        y: a.y + t * r.1,
    })
}

/// The network invariants: one geometry per stretch of road, and roads only meet at junctions.
fn assert_clean_network(roads: &RoadOutput, cell: f64) {
    let near_junction = |p: Point, tolerance: f64| {
        roads
            .junctions
            .iter()
            .any(|j| j.point.distance_to(p) < tolerance)
    };
    for (i, s) in roads.segments.iter().enumerate() {
        assert_eq!(
            s.path[0], roads.junctions[s.a].point,
            "segment start is a junction"
        );
        assert_eq!(
            *s.path.last().unwrap(),
            roads.junctions[s.b].point,
            "segment end is a junction"
        );
        // Doubled roads: the length of a segment running alongside another one.
        let mut alongside = 0.0;
        let total: f64 = s.length;
        for w in s.path.windows(2) {
            let mid = Point {
                x: 0.5 * (w[0].x + w[1].x),
                y: 0.5 * (w[0].y + w[1].y),
            };
            if near_junction(mid, 3.0 * cell) {
                continue;
            }
            if roads
                .segments
                .iter()
                .enumerate()
                .any(|(j, o)| j != i && polyline_distance(mid, &o.path) < 0.9 * cell)
            {
                alongside += w[0].distance_to(w[1]);
            }
        }
        assert!(
            alongside <= 0.1 * total + 2.0 * cell,
            "segment {i} ({} m) runs {alongside:.0} m alongside another road",
            total.round()
        );
        // Crossings away from any junction.
        for o in &roads.segments[i + 1..] {
            for w in s.path.windows(2) {
                for v in o.path.windows(2) {
                    if let Some(x) = crosses(w[0], w[1], v[0], v[1]) {
                        assert!(
                            near_junction(x, 2.5 * cell),
                            "roads cross without a junction at {x:?}"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn legacy_spacing_and_population_streams_are_preserved() {
    assert!((pair_spacing(300, 3000) - 2895.5284471265845).abs() < 1e-9);
    let map = Map::new();
    let mut cfg = Config {
        mode: "counts".into(),
        ..Default::default()
    };
    cfg.main.population = 3000;
    cfg.counts.insert("village".into(), 2);
    cfg.counts.insert("hamlet".into(), 2);
    cfg.counts.insert("farmstead".into(), 2);
    let a = generate("42", map.raster(), &cfg).unwrap();
    let b = generate("42", map.raster(), &cfg).unwrap();
    assert_eq!(a.settlements.len(), 7);
    // Drawn directly with the legacy TypeScript planner's CLASS_POP and fork('pop').
    assert_eq!(
        a.settlements
            .iter()
            .skip(1)
            .map(|s| s.spec.population)
            .collect::<Vec<_>>(),
        vec![563, 248, 65, 24, 8, 9]
    );
    assert_eq!(
        a.settlements.iter().map(|s| s.center).collect::<Vec<_>>(),
        b.settlements.iter().map(|s| s.center).collect::<Vec<_>>()
    );
    for (i, s) in a.settlements.iter().enumerate() {
        let c = &s.scores;
        let sum = c.flatness
            + c.buildable
            + c.fresh_water
            + c.river
            + c.harbor
            + c.flood
            + c.culture
            + c.site
            + c.defense
            + c.elevation
            + c.cluster
            + c.variation;
        assert!(c.total.is_finite());
        assert!((sum - c.total).abs() < 1e-9);
        for o in &a.settlements[..i] {
            let d = s.center.distance_to(o.center);
            assert!(d >= extent_gap(s.spec.population, o.spec.population));
        }
    }
    let roads = map.terrain().roads("42", &sites(&a), &no_exits()).unwrap();
    assert!(roads.unreachable.is_empty());
}

#[test]
fn manual_positions_route_every_class_and_a_move_only_reroutes() {
    let map = Map::new();
    let mut specs = vec![
        fixed("main", 8000, 3000.0, 8000.0),
        fixed("town", 6000, 6000.0, 8000.0),
        fixed("village", 300, 9000.0, 8000.0),
        fixed("hamlet", 40, 12000.0, 8000.0),
        fixed("farm", 8, 14000.0, 8000.0),
    ];
    specs[2].name = "Market village".into();
    specs[2].culture = "roman-core".into();
    let developed = RoadConfig {
        level: "developed".into(),
        ..no_exits()
    };
    let (out, roads) = place_and_route(&map, "manual", &list(specs.clone()), &developed);
    assert_eq!(out.settlements.len(), specs.len());
    for (s, request) in out.settlements.iter().zip(&specs) {
        assert_eq!(Some(s.center), request.position);
        assert_eq!(s.spec.population, request.population);
        assert!(s.scores.manual);
    }
    assert_eq!(out.settlements[2].spec.name, "Market village");
    assert_eq!(out.settlements[2].spec.culture, "roman-core");
    assert!(roads.unreachable.is_empty());
    for class in ["highway", "local", "track", "trail"] {
        assert!(
            roads.segments.iter().any(|r| r.class == class),
            "missing {class}"
        );
    }
    for s in &out.settlements {
        let j = roads
            .junctions
            .iter()
            .find(|j| j.site.as_deref() == Some(s.spec.key.as_str()))
            .expect("every settlement is a network node");
        assert_eq!(j.point, s.center);
    }
    // Moving one place: same settlements elsewhere, rerouted network ends at the new point.
    let t = map.terrain();
    let mut moved_sites = sites(&out);
    moved_sites[3].center = Point {
        x: 12000.0,
        y: 11000.0,
    };
    let moved = t.roads("manual", &moved_sites, &developed).unwrap();
    assert!(
        moved
            .junctions
            .iter()
            .any(|j| j.point == moved_sites[3].center && j.site.as_deref() == Some("hamlet"))
    );
    assert!(moved.unreachable.is_empty());
    let total = |r: &RoadOutput| r.segments.iter().map(|s| s.length).sum::<f64>();
    assert!((total(&roads) - total(&moved)).abs() > 1.0);
}

#[test]
fn rivers_are_bridged_once_and_a_lake_barrier_is_reported_unreachable() {
    let mut map = Map::new();
    let cfg = list(vec![
        fixed("a", 300, 4000.0, 8000.0),
        fixed("b", 300, 12000.0, 8000.0),
    ]);
    map.strip(3);
    let (_, river) = place_and_route(&map, "crossing", &cfg, &no_exits());
    assert!(river.unreachable.is_empty());
    let bridges: Vec<_> = river.segments.iter().flat_map(|s| &s.crossings).collect();
    assert_eq!(bridges.len(), 1);
    assert_eq!(bridges[0].kind, "bridge");
    map.strip(2);
    let (_, lake) = place_and_route(&map, "crossing", &cfg, &no_exits());
    assert_eq!(lake.unreachable, vec!["b"]);
    assert!(lake.segments.is_empty());
}

#[test]
fn shallow_lakes_are_crossed_on_causeways_only_by_causeway_cultures() {
    let mut map = Map::new();
    map.strip(2);
    for i in 0..map.n * map.n {
        if map.water[i] == 2 {
            map.level[i] = 33.0; // 3 m deep
        }
    }
    let cfg = list(vec![
        fixed("a", 300, 4000.0, 8000.0),
        fixed("b", 300, 12000.0, 8000.0),
    ]);
    let (_, medieval) = place_and_route(&map, "lake", &cfg, &no_exits());
    assert_eq!(medieval.unreachable, vec!["b"]);
    let aztec = RoadConfig {
        culture: "mesoamerican".into(),
        ..no_exits()
    };
    let (_, causeway) = place_and_route(&map, "lake", &cfg, &aztec);
    assert!(causeway.unreachable.is_empty());
    assert!(
        causeway
            .segments
            .iter()
            .flat_map(|s| &s.crossings)
            .any(|c| c.kind == "causeway")
    );
}

#[test]
fn paths_go_around_lakes_without_cutting_through_them() {
    let mut map = Map::new();
    for y in 45..83 {
        for x in 53..75 {
            map.water[y * map.n + x] = 2;
        }
    }
    let cfg = list(vec![
        fixed("a", 300, 4000.0, 8000.0),
        fixed("b", 300, 12000.0, 8000.0),
    ]);
    let (_, roads) = place_and_route(&map, "detour", &cfg, &no_exits());
    assert!(roads.unreachable.is_empty());
    assert!(!roads.segments.is_empty());
    for road in &roads.segments {
        for segment in road.path.windows(2) {
            for k in 0..=20 {
                let t = k as f64 / 20.0;
                let p = Point {
                    x: segment[0].x + (segment[1].x - segment[0].x) * t,
                    y: segment[0].y + (segment[1].y - segment[0].y) * t,
                };
                assert_eq!(map.water[map.index(p)], 0);
            }
        }
    }
}

/// A 30 % escarpment between a low and a high plateau.
fn escarpment() -> Map {
    let mut map = Map::sized(160);
    let cell = WIDTH / map.n as f64;
    for y in 0..map.n {
        for x in 0..map.n {
            let px = (x as f64 + 0.5) * cell;
            let h = 30.0 + 0.30 * (px - 6000.0).clamp(0.0, 3000.0);
            map.height[y * map.n + x] = h as f32;
            map.level[y * map.n + x] = h as f32;
        }
    }
    map
}

#[test]
fn roads_hold_their_grade_with_switchbacks_on_an_escarpment() {
    let map = escarpment();
    let cfg = list(vec![
        fixed("low", 3000, 3000.0, 8000.0),
        fixed("high", 3000, 12500.0, 8000.0),
    ]);
    let (_, graded) = place_and_route(&map, "slope", &cfg, &no_exits());
    assert!(graded.unreachable.is_empty());
    let steepest = graded.segments.iter().map(|s| s.grade).fold(0.0, f64::max);
    // Main road at 10 % (rural level demotes highways to main roads); smoothing may steepen a bend.
    assert!(steepest < 0.16, "graded road reaches {steepest:.3}");
    let flat = RoadConfig {
        grade_weight: 0.0,
        ..no_exits()
    };
    let (_, straight) = place_and_route(&map, "slope", &cfg, &flat);
    let direct = straight
        .segments
        .iter()
        .map(|s| s.grade)
        .fold(0.0, f64::max);
    assert!(
        direct > 0.25,
        "slope-blind road should climb straight, got {direct:.3}"
    );
    let length = |r: &RoadOutput| r.segments.iter().map(|s| s.length).sum::<f64>();
    assert!(
        length(&graded) > length(&straight) + 500.0,
        "no switchbacks"
    );
    assert_clean_network(&graded, WIDTH / map.n as f64);
}

/// Resampled every half cell along a path.
fn resample(path: &[Point], step: f64) -> Vec<Point> {
    let mut out = vec![path[0]];
    let mut carry = 0.0;
    for w in path.windows(2) {
        let l = w[0].distance_to(w[1]);
        let mut d = step - carry;
        while d <= l {
            let t = d / l;
            out.push(Point {
                x: w[0].x + (w[1].x - w[0].x) * t,
                y: w[0].y + (w[1].y - w[0].y) * t,
            });
            d += step;
        }
        carry = l - (d - step);
    }
    out
}

/// A face of `slope` rising `rise` metres, reachable only through a 2 km wide corridor between
/// seas, routed between a town below and one above.
fn corridor_face(slope: f64, rise: f64) -> (RoadOutput, f64) {
    let mut map = Map::sized(320);
    let cell = WIDTH / map.n as f64;
    for y in 0..map.n {
        for x in 0..map.n {
            let (px, py) = ((x as f64 + 0.5) * cell, (y as f64 + 0.5) * cell);
            let i = y * map.n + x;
            let h = (30.0 + slope * (px - 6000.0).clamp(0.0, rise / slope)) as f32;
            map.height[i] = h;
            map.level[i] = h;
            if !(7000.0..=9000.0).contains(&py) {
                map.water[i] = 1;
                map.level[i] = 0.0;
                map.height[i] = -5.0;
            }
        }
    }
    let cfg = list(vec![
        fixed("low", 3000, 3000.0, 8000.0),
        fixed("high", 3000, 12500.0, 8000.0),
    ]);
    let (_, roads) = place_and_route(&map, "face", &cfg, &no_exits());
    assert!(roads.unreachable.is_empty());
    assert_clean_network(&roads, cell);
    // Hatching: another part of the same road, eight cells or more further along, within a cell
    // and a half (the legs of a switchback stacked one cell apart).
    for s in &roads.segments {
        let points = resample(&s.path, 0.5 * cell);
        for (a, p) in points.iter().enumerate() {
            if roads
                .junctions
                .iter()
                .any(|j| j.point.distance_to(*p) < 3.0 * cell)
            {
                continue;
            }
            if let Some(q) = points[(a + 16).min(points.len())..]
                .iter()
                .find(|q| q.distance_to(*p) < 1.5 * cell)
            {
                panic!("switchback legs touch at {p:?} / {q:?} on a {slope} face");
            }
        }
    }
    (roads, cell)
}

#[test]
fn switchbacks_keep_their_legs_apart_even_on_a_very_steep_face() {
    // 30 %: a ramp of (1, 3) moves holds 10 %, so the road zigzags at a cart's grade, far longer
    // than the 2.5 km fall line.
    let (roads, _) = corridor_face(0.3, 750.0);
    let length: f64 = roads.segments.iter().map(|s| s.length).sum();
    assert!(length > 9500.0 + 2500.0, "no switchbacks ({length:.0} m)");
    let steepest = roads.segments.iter().map(|s| s.grade).fold(0.0, f64::max);
    assert!(steepest < 0.3, "road reaches {steepest:.3}");
    // 60 %: no move holds the grade off the contour. The road used to climb in a dense ladder of
    // legs one cell apart; it now takes the slope on a few legs instead.
    corridor_face(0.6, 750.0);
}

fn hilly(n: usize) -> Map {
    let mut map = Map::sized(n);
    let cell = WIDTH / n as f64;
    for y in 0..n {
        for x in 0..n {
            let (px, py) = ((x as f64 + 0.5) * cell, (y as f64 + 0.5) * cell);
            let h = 60.0
                + 25.0 * (px / 1700.0).sin() * (py / 2300.0).cos()
                + 12.0 * (px / 610.0 + py / 830.0).sin();
            map.height[y * n + x] = h as f32;
            map.level[y * n + x] = h as f32;
        }
    }
    // A meandering river across the map.
    for y in 0..n {
        let py = (y as f64 + 0.5) * cell;
        let cx = 0.55 * WIDTH + 900.0 * (py / 2100.0).sin();
        for x in 0..n {
            let px = (x as f64 + 0.5) * cell;
            if (px - cx).abs() < 22.0 {
                let i = y * n + x;
                map.water[i] = 3;
                map.widths[i] = 12.0;
                map.ids[i] = 0;
                map.level[i] = map.height[i] - 1.0;
            }
        }
    }
    map
}

#[test]
fn a_dense_network_has_one_geometry_per_road_and_junctions_at_every_meeting() {
    let map = hilly(256);
    let mut cfg = Config {
        distribution: "zipf".into(),
        density: 2.0,
        relief: "hills".into(),
        ..Default::default()
    };
    cfg.main.population = 12000;
    for (level, density) in [("rural", 0.5), ("imperial", 1.0)] {
        let roads_cfg = RoadConfig {
            level: level.into(),
            density,
            ..Default::default()
        };
        let start = std::time::Instant::now();
        let (placed, roads) = place_and_route(&map, "dense", &cfg, &roads_cfg);
        eprintln!(
            "{level}: {} places, {} routes → {} segments, {} junctions in {:?}",
            placed.settlements.len(),
            roads.routes,
            roads.segments.len(),
            roads.junctions.len(),
            start.elapsed()
        );
        assert!(placed.settlements.len() >= 12);
        assert!(roads.unreachable.is_empty(), "{:?}", roads.unreachable);
        assert_clean_network(&roads, WIDTH / map.n as f64);
        // Exactly one bridge per crossing place: the river is never crossed twice in a row.
        for s in &roads.segments {
            assert!(s.crossings.len() <= 1);
        }
        let again = map
            .terrain()
            .roads("dense", &sites(&placed), &roads_cfg)
            .unwrap();
        assert_eq!(
            serde_json::to_string(&roads.segments).unwrap(),
            serde_json::to_string(&again.segments).unwrap()
        );
    }
}

#[test]
fn levels_cultures_and_surface_overrides_type_the_network() {
    let map = hilly(160);
    let mut cfg = Config {
        distribution: "zipf".into(),
        ..Default::default()
    };
    cfg.main.population = 9000;
    let t = map.terrain();
    let placed = t.place("typed", &cfg).unwrap();
    let s = sites(&placed);
    let route = |c: RoadConfig| t.roads("typed", &s, &c).unwrap();
    let primitive = route(RoadConfig {
        level: "primitive".into(),
        ..Default::default()
    });
    assert!(primitive.segments.iter().all(|r| r.surface == "dirt"));
    assert!(
        primitive
            .segments
            .iter()
            .all(|r| !["highway", "main"].contains(&r.class.as_str()))
    );
    let paved = route(RoadConfig {
        surface: "paved".into(),
        ..Default::default()
    });
    assert!(paved.segments.iter().all(|r| r.surface == "paved"));
    let tribal = route(RoadConfig {
        level: "imperial".into(),
        culture: "tribal".into(),
        ..Default::default()
    });
    assert!(
        tribal
            .segments
            .iter()
            .filter(|r| ["highway", "main", "local"].contains(&r.class.as_str()))
            .all(|r| r.surface == "dirt")
    );
    let roman = route(RoadConfig {
        level: "imperial".into(),
        culture: "roman".into(),
        ..Default::default()
    });
    assert!(roman.segments.iter().all(|r| r.profile == "roman"));
    assert!(
        roman
            .segments
            .iter()
            .any(|r| r.surface == "flagstone" || r.surface == "paved")
    );
    let medieval = route(RoadConfig {
        culture: "medieval".into(),
        ..Default::default()
    });
    assert!(
        sinuosity(&roman) < sinuosity(&medieval),
        "roman {:.3} vs medieval {:.3}",
        sinuosity(&roman),
        sinuosity(&medieval)
    );
    // Auto culture follows the settlements.
    let mut aztec_cfg = cfg.clone();
    aztec_cfg.main.culture = "aztec".into();
    let aztec = t.place("typed", &aztec_cfg).unwrap();
    let auto = t
        .roads("typed", &sites(&aztec), &RoadConfig::default())
        .unwrap();
    assert!(auto.segments.iter().all(|r| r.profile == "mesoamerican"));
    // A tree-only network has no more links than places (plus exits).
    let tree = route(RoadConfig {
        density: 0.0,
        exits: 0,
        ..Default::default()
    });
    let loops = route(RoadConfig {
        density: 1.0,
        exits: 0,
        ..Default::default()
    });
    let km = |r: &RoadOutput| r.segments.iter().map(|s| s.length).sum::<f64>();
    assert!(km(&loops) > km(&tree));
}

#[test]
fn rank_size_distribution_follows_the_law_down_to_the_minimum() {
    let map = Map::sized(160);
    let mut cfg = Config {
        distribution: "zipf".into(),
        zipf_exponent: 1.0,
        population_jitter: 0.0,
        density: 0.5,
        min_population: 200,
        ..Default::default()
    };
    cfg.main.population = 4000;
    let out = map.terrain().place("zipf", &cfg).unwrap();
    // 0.5 × 10 places per 100 km² on 256 km² ≈ 13, cut at 4000 / r ≥ 200 → ranks 2..=13.
    assert_eq!(out.requested, 13);
    let mut pops: Vec<_> = out
        .settlements
        .iter()
        .skip(1)
        .map(|s| s.spec.population)
        .collect();
    pops.sort_unstable_by(|a, b| b.cmp(a));
    assert_eq!(pops.first(), Some(&2000));
    assert!(pops.iter().all(|p| (200..4000).contains(p)));
    assert_eq!(out.settlements[0].spec.population, 4000);
    let steep = Config {
        zipf_exponent: 2.0,
        ..cfg.clone()
    };
    let few = map.terrain().place("zipf", &steep).unwrap();
    assert!(few.requested < out.requested);
}

#[test]
fn geographic_preferences_move_the_choice_of_sites() {
    let mut map = Map::sized(160);
    let cell = WIDTH / map.n as f64;
    for y in 0..map.n {
        for x in 0..map.n {
            let h = 20.0 + 0.004 * (x as f64 + 0.5) * cell;
            map.height[y * map.n + x] = h as f32;
            map.level[y * map.n + x] = h as f32;
        }
    }
    let mut cfg = Config {
        mode: "counts".into(),
        ..Default::default()
    };
    cfg.main.population = 2000;
    cfg.counts.insert("village".into(), 5);
    let mean_x = |out: &Output| {
        out.settlements.iter().map(|s| s.center.x).sum::<f64>() / out.settlements.len() as f64
    };
    let t = map.terrain();
    let low = t
        .place(
            "geo",
            &Config {
                elevation: -1.0,
                ..cfg.clone()
            },
        )
        .unwrap();
    let high = t
        .place(
            "geo",
            &Config {
                elevation: 1.0,
                ..cfg.clone()
            },
        )
        .unwrap();
    assert!(mean_x(&high) > mean_x(&low) + 2000.0);
    assert!(high.settlements.iter().all(|s| s.scores.elevation > 0.0));
}

#[test]
fn fixed_wet_points_are_not_silently_relocated_and_invalid_configs_fail() {
    let mut map = Map::new();
    map.strip(2);
    let cfg = list(vec![fixed("wet", 300, 8000.0, 8000.0)]);
    let out = generate("wet", map.raster(), &cfg).unwrap();
    assert!(out.settlements.is_empty());
    assert!(out.warnings.iter().any(|w| w.contains("manual position")));
    let cfg = list(vec![
        fixed("dup", 300, 3000.0, 8000.0),
        fixed("dup", 300, 13000.0, 8000.0),
    ]);
    assert!(generate("bad", map.raster(), &cfg).is_err());
    let cfg = Config {
        flatness_weight: f64::NAN,
        ..Default::default()
    };
    assert!(generate("bad", map.raster(), &cfg).is_err());
    let t = map.terrain();
    for bad in [
        RoadConfig {
            sharing: f64::NAN,
            ..Default::default()
        },
        RoadConfig {
            level: "space-age".into(),
            ..Default::default()
        },
        RoadConfig {
            culture: "klingon".into(),
            ..Default::default()
        },
    ] {
        assert!(t.roads("bad", &[], &bad).is_err());
    }
}
