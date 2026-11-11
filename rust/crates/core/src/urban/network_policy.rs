//! Local road invariants. Spatial buckets and bounded neighbourhoods keep the
//! work proportional to road length; rejected harbour decks use bounded local routes.
use super::*;
use crate::urban::{Layout, Surface, geometry as g, routing};

const CELL: f64 = 32.0;

/// Segment buckets visited along the line, rather than its rectangular area.
#[derive(Default)]
struct Near {
    lines: Vec<(Point, Point)>,
    cells: BTreeMap<Key, Vec<usize>>,
}
impl Near {
    fn add(&mut self, a: Point, b: Point) {
        let id = self.lines.len();
        self.lines.push((a, b));
        let n = (distance(a, b) / (CELL * 0.5)).ceil().max(1.0) as usize;
        let mut visited = BTreeSet::new();
        for i in 0..=n {
            let p = lerp(a, b, i as f64 / n as f64);
            let k = ((p.x / CELL).floor() as i64, (p.y / CELL).floor() as i64);
            if visited.insert(k) {
                self.cells.entry(k).or_default().push(id);
            }
        }
    }
    fn distance(&self, p: Point, reach: f64) -> f64 {
        let (x, y) = ((p.x / CELL).floor() as i64, (p.y / CELL).floor() as i64);
        let n = (reach / CELL).ceil() as i64 + 1;
        let mut best = f64::INFINITY;
        for dx in -n..=n {
            for dy in -n..=n {
                for &i in self.cells.get(&(x + dx, y + dy)).into_iter().flatten() {
                    let (a, b) = self.lines[i];
                    best = best.min(g::distance(p, a, b).0);
                }
            }
        }
        best
    }
}

fn remove_edges(streets: &mut Vec<Street>, gone: &BTreeSet<(usize, usize)>) {
    if gone.is_empty() {
        return;
    }
    let before = Graph::new(streets);
    let land: BTreeSet<_> = streets
        .iter()
        .filter(|s| !matches!(s.role.as_str(), "bridge" | "ford" | "causeway"))
        .flat_map(|s| s.path.iter().copied().map(key))
        .collect();
    let spans: Vec<_> = streets
        .iter()
        .filter(|s| matches!(s.role.as_str(), "bridge" | "ford" | "causeway"))
        .cloned()
        .collect();
    let crossings = Graph::new(&spans);
    let supported: BTreeSet<_> = land
        .iter()
        .filter_map(|p| crossings.component.get(p).copied())
        .collect();
    let mut out = vec![];
    for (i, s) in streets.iter().enumerate() {
        // Selection has already committed supported crossings. Cosmetic
        // pruning cannot overrule it, even if another crossing exists.
        // An unattached imported deck can still be rejected.
        let crossing = matches!(s.role.as_str(), "bridge" | "ford" | "causeway")
            && s.path.iter().any(|&p| {
                crossings.component.get(&key(p)).is_some_and(|c| supported.contains(c))
            });
        let mut path = vec![];
        let mut widths = vec![];
        for j in 0..s.path.len().saturating_sub(1) {
            if gone.contains(&(i, j)) && !crossing {
                if path.len() >= 2 {
                    out.push(Street {
                        path: std::mem::take(&mut path),
                        widths: std::mem::take(&mut widths),
                        rank: s.rank,
                        role: s.role.clone(),
                    });
                }
            } else {
                if path.is_empty() {
                    path.push(s.path[j]);
                    widths.push(width(s, j));
                }
                path.push(s.path[j + 1]);
                widths.push(width(s, j + 1));
            }
        }
        if path.len() >= 2 {
            out.push(Street {
                path,
                widths,
                rank: s.rank,
                role: s.role.clone(),
            });
        }
    }
    // Whole empty components and terminal tails may disappear. Every vertex
    // that survives from one original component must still reach every other
    // surviving vertex in it, including the land routes to both bridge banks.
    let after = Graph::new(&out);
    let mut retained = BTreeMap::new();
    for (p, &component) in &after.component {
        if retained
            .insert(before.component[p], component)
            .is_some_and(|previous| previous != component)
        {
            return;
        }
    }
    *streets = out;
}

/// A selected-out bridge must not leave its unoccupied approaches as a fan
/// on the bank. Peel only unserved terminal edges, preserving all actual
/// waterfront purposes, rural tracks, private access and occupied frontage.
pub(super) fn river_spurs(layout: &mut Layout, surface: Surface<'_>) {
    if layout
        .config
        .as_ref()
        .is_some_and(|c| c.programme.intent == "isolated-mill")
    {
        return;
    }
    if !layout
        .streets
        .iter()
        .any(|s| s.path.iter().any(|&p| near_water(surface, p)))
    {
        return;
    }
    let mut purposes = Near::default();
    let mut frontage = Near::default();
    for s in &layout.streets {
        if CROSSINGS.contains(&s.role.as_str())
            || matches!(s.role.as_str(), "mill" | "track" | "trail")
            || private(s)
        {
            for w in s.path.windows(2) {
                purposes.add(w[0], w[1]);
            }
        }
    }
    for b in layout.blocks.iter().filter(|b| b.kind == "block") {
        for (&a, &b) in b
            .shape
            .outer
            .iter()
            .zip(b.shape.outer.iter().cycle().skip(1))
            .take(b.shape.outer.len())
        {
            frontage.add(a, b);
        }
    }
    // Sample the existing trajectories so that an occupied head can keep its
    // frontage while only the empty tail disappears. Widths follow the samples.
    for s in &mut layout.streets {
        let mut path = vec![];
        let mut widths = vec![];
        for (i, w) in s.path.windows(2).enumerate() {
            let n = (distance(w[0], w[1]) / 8.0).ceil().max(1.0) as usize;
            for k in 0..n {
                let t = k as f64 / n as f64;
                path.push(lerp(w[0], w[1], t));
                widths.push(width(s, i) + (width(s, i + 1) - width(s, i)) * t);
            }
        }
        if let Some(&p) = s.path.last() {
            path.push(p);
            widths.push(width(s, s.path.len() - 1));
        }
        s.path = path;
        s.widths = widths;
    }
    struct Edge {
        street: usize,
        offset: usize,
        a: Key,
        b: Key,
        removable: bool,
    }
    let mut edges = vec![];
    let mut incident: BTreeMap<Key, Vec<usize>> = BTreeMap::new();
    let mut points = BTreeMap::new();
    for (i, s) in layout.streets.iter().enumerate() {
        let can = !CROSSINGS.contains(&s.role.as_str())
            && !private(s)
            && !matches!(
                s.role.as_str(),
                "regional" | "outbound" | "track" | "trail" | "mill"
            );
        for (j, w) in s.path.windows(2).enumerate() {
            let (a, b) = (key(w[0]), key(w[1]));
            if a == b {
                continue;
            }
            let reach = width(s, j).max(width(s, j + 1)) * 0.5 + 8.0;
            let removable = can
                && [w[0], lerp(w[0], w[1], 0.5), w[1]]
                    .iter()
                    .all(|&p| frontage.distance(p, reach) > reach);
            let id = edges.len();
            edges.push(Edge {
                street: i,
                offset: j,
                a,
                b,
                removable,
            });
            incident.entry(a).or_default().push(id);
            incident.entry(b).or_default().push(id);
            points.insert(a, w[0]);
            points.insert(b, w[1]);
        }
    }
    let mut degree: BTreeMap<_, _> = incident.iter().map(|(&p, e)| (p, e.len())).collect();
    let mut queue: Vec<_> = points
        .iter()
        .filter(|(_, p)| near_water(surface, **p) && purposes.distance(**p, 12.0) > 12.0)
        .map(|(&p, _)| (p, true))
        .collect();
    let mut alive = vec![true; edges.len()];
    let mut gone = BTreeSet::new();
    while let Some((p, bank)) = queue.pop() {
        if !bank && degree[&p] != 1 {
            continue;
        }
        for &i in &incident[&p] {
            let e = &edges[i];
            if !alive[i] || !e.removable {
                continue;
            }
            alive[i] = false;
            gone.insert((e.street, e.offset));
            *degree.get_mut(&e.a).unwrap() -= 1;
            *degree.get_mut(&e.b).unwrap() -= 1;
            queue.push((if e.a == p { e.b } else { e.a }, false));
        }
    }
    remove_edges(&mut layout.streets, &gone);
}

fn near_water(surface: Surface<'_>, p: Point) -> bool {
    surface.wet(p)
        || (0..8).any(|i| {
            let a = i as f64 * std::f64::consts::FRAC_PI_4;
            surface.wet(Point {
                x: p.x + 8.0 * a.cos(),
                y: p.y + 8.0 * a.sin(),
            })
        })
}

/// Delete only a redundant third edge of a small triangle. The other two
/// edges must still exist, so this can never disconnect the street graph.
/// Planned grids reject small diagonal cells; other tissues lose only slivers
/// narrower than a usable frontage. Crossings and access ways are immutable.
pub(super) fn small_loops(streets: &mut Vec<Street>, grid: bool) {
    let max_edge = if grid { 100.0 } else { 60.0 };
    let mut links: BTreeMap<Key, BTreeSet<Key>> = BTreeMap::new();
    let mut edges = BTreeMap::new();
    let mut points = BTreeMap::new();
    for (i, s) in streets.iter().enumerate() {
        for (j, w) in s.path.windows(2).enumerate() {
            let (a, b) = (key(w[0]), key(w[1]));
            if a == b || distance(w[0], w[1]) > max_edge {
                continue;
            }
            links.entry(a).or_default().insert(b);
            links.entry(b).or_default().insert(a);
            edges.insert(if a < b { (a, b) } else { (b, a) }, (i, j));
            points.insert(a, w[0]);
            points.insert(b, w[1]);
        }
    }
    let edge = |a: Key, b: Key| if a < b { (a, b) } else { (b, a) };
    let mut gone = BTreeSet::new();
    for (&a, neighbors) in &links {
        if neighbors.len() > 16 {
            continue;
        }
        for &b in neighbors.range(a..) {
            if links[&b].len() > 16 {
                continue;
            }
            for &c in neighbors.intersection(&links[&b]).filter(|&&c| c > b) {
                let sides = [edges[&edge(a, b)], edges[&edge(a, c)], edges[&edge(b, c)]];
                if sides.iter().any(|s| gone.contains(s)) {
                    continue;
                }
                let (p, q, r) = (points[&a], points[&b], points[&c]);
                let twice_area = ((q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x)).abs();
                let longest = distance(p, q).max(distance(p, r)).max(distance(q, r));
                let widest = sides
                    .iter()
                    .map(|&(i, j)| width(&streets[i], j))
                    .fold(0.0, f64::max);
                if twice_area > 2.0 * if grid { 900.0 } else { 180.0 }
                    || !grid && twice_area / longest.max(EPS) > widest + MIN_LAND
                {
                    continue;
                }
                let candidate = sides
                    .into_iter()
                    .filter(|&(i, _)| {
                        let s = &streets[i];
                        !protected(s)
                            && !private(s)
                            && !CROSSINGS.contains(&s.role.as_str())
                            && !matches!(s.role.as_str(), "track" | "trail")
                    })
                    .max_by(|&(i, j), &(k, l)| {
                        streets[i]
                            .rank
                            .cmp(&streets[k].rank)
                            .then_with(|| {
                                distance(streets[i].path[j], streets[i].path[j + 1]).total_cmp(
                                    &distance(streets[k].path[l], streets[k].path[l + 1]),
                                )
                            })
                            .then(i.cmp(&k))
                            .then(j.cmp(&l))
                    });
                if let Some(s) = candidate {
                    gone.insert(s);
                }
            }
        }
    }
    remove_edges(streets, &gone);
}

#[cfg(test)]
mod tests {
    use super::*;
    fn road(points: &[(f64, f64)], role: &str) -> Street {
        Street {
            path: points.iter().map(|&(x, y)| Point { x, y }).collect(),
            widths: vec![4.0; points.len()],
            rank: 2,
            role: role.into(),
        }
    }
    fn layout(streets: Vec<Street>) -> Layout {
        let mut l: Layout = serde_json::from_value(serde_json::json!({
            "key":"road-policy", "culture":"chinese", "center":{"x":100.,"y":100.},
            "quarters":[],"blocks":[],"streets":[],"warnings":[]
        }))
        .unwrap();
        l.streets = streets;
        l.config = Some(Default::default());
        l
    }
    fn surface<'a>(h: &'a [f32], w: &'a [u8]) -> Surface<'a> {
        Surface {
            geometry: None,
            width: 400.0,
            n: 100,
            height: h,
            water: w,
            interpolation: Default::default(),
        }
    }
    fn length(streets: &[Street]) -> f64 {
        streets
            .iter()
            .flat_map(|s| s.path.windows(2))
            .map(|w| distance(w[0], w[1]))
            .sum()
    }
    #[test]
    fn bank_fans_of_rejected_bridges_go_but_tracks_and_landings_stay() {
        let h = vec![10.; 10000];
        let water: Vec<_> = (0..10000)
            .map(|i| if (50..55).contains(&(i % 100)) { 3 } else { 0 })
            .collect();
        let surf = surface(&h, &water);
        let roads = vec![
            road(&[(40., 100.), (196., 180.)], "approach"),
            road(&[(40., 260.), (196., 180.)], "street"),
        ];
        let mut l = layout(roads.clone());
        river_spurs(&mut l, surf);
        assert!(l.streets.is_empty(), "bank fan remains: {:?}", l.streets);
        let mut l = layout(vec![
            roads[0].clone(),
            road(&[(196., 180.), (220., 180.)], "bridge"),
        ]);
        river_spurs(&mut l, surf);
        assert!((length(&l.streets) - length(&[roads[0].clone()]) - 24.).abs() < 1e-6);
        let mut l = layout(vec![road(&[(40., 100.), (196., 180.)], "track")]);
        let before = length(&l.streets);
        river_spurs(&mut l, surf);
        assert!((length(&l.streets) - before).abs() < 1e-6);
        let mut l = layout(vec![
            roads[0].clone(),
            road(&[(190., 180.), (196., 180.)], "landing"),
        ]);
        river_spurs(&mut l, surf);
        assert!(!l.streets.is_empty());
    }
    #[test]
    fn river_tail_stops_at_occupied_frontage() {
        let h = vec![10.; 10000];
        let water: Vec<_> = (0..10000)
            .map(|i| if i % 100 >= 50 { 3 } else { 0 })
            .collect();
        let mut l = layout(vec![road(&[(40., 100.), (196., 100.)], "street")]);
        l.blocks = serde_json::from_value(serde_json::json!([{
            "shape":{"outer":[{"x":40.,"y":106.},{"x":80.,"y":106.},{"x":80.,"y":125.},{"x":40.,"y":125.}],"holes":[]},
            "kind":"block","quarter":0,"axis":{"x":1.,"y":0.}
        }])).unwrap();
        river_spurs(&mut l, surface(&h, &water));
        assert!(!l.streets.is_empty());
        assert!(l.streets.iter().flat_map(|s| &s.path).all(|p| p.x < 110.));
    }
    #[test]
    fn bank_pruning_keeps_the_land_route_to_a_distant_bridge() {
        let h = vec![10.; 10000];
        let water: Vec<_> = (0..10000)
            .map(|i| if (50..55).contains(&(i % 100)) { 3 } else { 0 })
            .collect();
        let mut l = layout(vec![
            road(&[(40., 60.), (40., 100.)], "regional"),
            road(&[(40., 100.), (196., 100.), (180., 140.), (196., 180.)], "street"),
            road(&[(196., 180.), (224., 180.)], "bridge"),
            road(&[(224., 180.), (300., 180.)], "regional"),
        ]);
        let before = length(&l.streets);
        river_spurs(&mut l, surface(&h, &water));
        assert_eq!(Graph::new(&l.streets).length.len(), 1);
        assert!((length(&l.streets) - before).abs() < 1e-6);
        assert_eq!(l.streets.iter().filter(|s| s.role == "bridge").count(), 1);
    }
    #[test]
    fn pruning_keeps_a_supported_split_bridge_even_with_an_alternate_route() {
        let mut streets = vec![
            road(&[(20., 20.), (40., 20.)], "street"),
            road(&[(40., 20.), (60., 20.)], "bridge"),
            road(&[(60., 20.), (80., 20.)], "bridge"),
            road(&[(80., 20.), (100., 20.)], "street"),
            road(&[(40., 20.), (60., 50.), (80., 20.)], "street"),
        ];
        let before = serde_json::to_vec(&streets).unwrap();
        remove_edges(&mut streets, &BTreeSet::from([(1, 0), (2, 0)]));
        assert_eq!(serde_json::to_vec(&streets).unwrap(), before);
    }
    #[test]
    fn small_grid_triangle_loses_only_its_diagonal_and_stays_connected() {
        let mut streets = vec![
            road(&[(20., 20.), (50., 20.)], "street"),
            road(&[(50., 20.), (50., 50.)], "street"),
            road(&[(20., 20.), (50., 50.)], "street"),
        ];
        small_loops(&mut streets, true);
        assert_eq!(streets.len(), 2);
        assert!((length(&streets) - 60.).abs() < 1e-6);
        assert_eq!(Graph::new(&streets).length.len(), 1);
        let before = serde_json::to_vec(&streets).unwrap();
        small_loops(&mut streets, true);
        assert_eq!(serde_json::to_vec(&streets).unwrap(), before);
    }
    #[test]
    fn large_cells_and_crossing_triangles_keep_their_edges() {
        let mut large = vec![
            road(&[(0., 0.), (200., 0.)], "street"),
            road(&[(200., 0.), (200., 200.)], "street"),
            road(&[(0., 0.), (200., 200.)], "street"),
        ];
        small_loops(&mut large, true);
        assert_eq!(large.len(), 3);
        let mut bridges = vec![
            road(&[(20., 20.), (40., 20.)], "bridge"),
            road(&[(40., 20.), (40., 40.)], "causeway"),
            road(&[(20., 20.), (40., 40.)], "track"),
        ];
        small_loops(&mut bridges, true);
        assert_eq!(bridges.len(), 3);
    }
    #[test]
    fn harbour_corridor_rejects_imported_decks_but_keeps_upstream_crossing() {
        let h = vec![10.; 10000];
        let water: Vec<_> = (0..10000)
            .map(|i| if (50..70).contains(&(i % 100)) { 3 } else { 0 })
            .collect();
        let mut l = layout(vec![
            road(&[(196., 120.), (196., 200.)], "quay"),
            road(&[(196., 160.), (284., 160.)], "bridge"),
            road(&[(196., 40.), (284., 40.)], "bridge"),
        ]);
        l.config.as_mut().unwrap().site_archetype = "harbor".into();
        harbour_clearance(&mut l, surface(&h, &water), 10000, 0.12);
        let bridges: Vec<_> = l.streets.iter().filter(|s| s.role == "bridge").collect();
        assert_eq!(bridges.len(), 1);
        assert_eq!(bridges[0].path[0].y, 40.);
    }
    #[test]
    fn cove_harbour_relocates_its_crossing_inland() {
        let h = vec![10.; 10000];
        let water: Vec<_> = (0..10000).map(|i| {
            let (x, y) = (i % 100, i / 100);
            if (50..70).contains(&x) && y >= 30 { 1 }
            else if (56..64).contains(&x) && (10..30).contains(&y) { 1 }
            else { 0 }
        }).collect();
        let surf = surface(&h, &water);
        let mut l = layout(vec![
            road(&[(80., 160.), (196., 160.)], "regional"),
            road(&[(196., 120.), (196., 160.), (196., 200.)], "quay"),
            road(&[(196., 160.), (284., 160.)], "bridge"),
            road(&[(284., 160.), (380., 160.)], "regional"),
        ]);
        l.config.as_mut().unwrap().site_archetype = "harbor".into();
        let mut disabled = l.clone();
        disabled.config.as_mut().unwrap().harbour_bridge_clearance = false;
        select_bridges_graded(&mut disabled, 10000, surf, &[], 0.12);
        assert!(disabled.streets.iter().any(|s| s.role == "bridge"
            && s.path.iter().all(|p| (p.y - 160.).abs() < 0.01)));
        select_bridges_graded(&mut l, 10000, surf, &[], 0.12);
        let bridges: Vec<_> = l.streets.iter().filter(|s| s.role == "bridge").collect();
        assert!(!bridges.is_empty(), "the crossing disappeared: {:?}", l.streets);
        assert!(bridges.iter().all(|s| s.path.iter().all(|p| p.y < 120.)), "deck in front of harbour: {bridges:?}");
        assert!(bridges.iter().all(|s| deck_landing_grade(surf, [s.path[0], *s.path.last().unwrap()]) <= 0.12));
        assert!(l.streets.iter().filter(|s| s.role == "approach").all(|s| routing::path_clear(surf, &s.path, 0.12)));
        let graph = Graph::new(&l.streets);
        assert_eq!(graph.component[&key(Point { x: 80., y: 160. })], graph.component[&key(Point { x: 380., y: 160. })]);
        // The final port pass must also retain the crossing behind the sea basin.
        crate::urban::macroplan::harbour::protect_navigation(&mut l, surf, &[]);
        assert!(l.streets.iter().any(|s| s.role == "bridge"));
    }
    #[test]
    fn cove_harbour_clearance_leaves_non_harbour_river_streets_unchanged() {
        let h = vec![10.; 10000];
        let water: Vec<_> = (0..10000)
            .map(|i| if (50..70).contains(&(i % 100)) { 3 } else { 0 })
            .collect();
        let mut l = layout(vec![
            road(&[(80., 160.), (180., 160.)], "regional"),
            road(&[(180., 160.), (196., 160.)], "causeway"),
            road(&[(196., 120.), (196., 160.), (196., 200.)], "quay"),
            road(&[(196., 160.), (240., 160.)], "bridge"),
            road(&[(240., 160.), (284., 160.)], "bridge"),
            road(&[(284., 160.), (300., 160.)], "causeway"),
            road(&[(300., 160.), (380., 160.)], "regional"),
        ]);
        let before = serde_json::to_vec(&l.streets).unwrap();
        harbour_clearance(&mut l, surface(&h, &water), 10000, 0.12);
        assert_eq!(serde_json::to_vec(&l.streets).unwrap(), before);
    }
    fn enclosure() -> crate::urban::Enclosure {
        crate::urban::Enclosure {
            path: vec![
                Point { x: 20., y: 100. },
                Point { x: 380., y: 100. },
                Point { x: 380., y: 350. },
                Point { x: 20., y: 350. },
                Point { x: 20., y: 100. },
            ],
            kind: "wall".into(),
            ..Default::default()
        }
    }
    #[test]
    fn grazing_road_crosses_one_wall_run_once_and_perpendicularly() {
        let h = vec![10.; 10000];
        let w = vec![0; 10000];
        let mut l = layout(vec![road(
            &[(40., 95.), (100., 105.), (160., 95.), (240., 110.)],
            "regional",
        )]);
        l.enclosures.push(enclosure());
        assert_eq!(
            crate::urban::composition::gates(&l.enclosures[0].path, &l.streets).len(),
            3
        );
        wall_approaches(&mut l, surface(&h, &w));
        let gates = crate::urban::composition::gates(&l.enclosures[0].path, &l.streets);
        assert_eq!(gates.len(), 1, "{:?}", l.streets);
        assert!(
            l.streets[0]
                .path
                .windows(2)
                .filter(|s| g::segment_hit(
                    s[0],
                    s[1],
                    Point { x: 20., y: 100. },
                    Point { x: 380., y: 100. }
                )
                .is_some())
                .all(|s| (s[0].x - s[1].x).abs() < 1e-6)
        );
    }
    #[test]
    fn nearby_road_crossings_share_a_gate_and_disabled_policy_is_unchanged() {
        let h = vec![10.; 10000];
        let w = vec![0; 10000];
        let mut l = layout(vec![
            road(&[(100., 40.), (100., 170.)], "regional"),
            road(&[(110., 40.), (110., 170.)], "street"),
        ]);
        l.enclosures.push(enclosure());
        l.config.as_mut().unwrap().wall_gate_policy = false;
        let old = serde_json::to_vec(&l.streets).unwrap();
        wall_approaches(&mut l, surface(&h, &w));
        assert_eq!(old, serde_json::to_vec(&l.streets).unwrap());
        l.config.as_mut().unwrap().wall_gate_policy = true;
        wall_approaches(&mut l, surface(&h, &w));
        assert_eq!(
            crate::urban::composition::gates(&l.enclosures[0].path, &l.streets).len(),
            1
        );
    }
    #[test]
    fn isolated_establishment_gets_access_and_can_disable_it() {
        let h = vec![10.; 10000];
        let w = vec![0; 10000];
        let mut l = layout(vec![road(&[(200., 140.), (200., 180.)], "track")]);
        let mut cfg = crate::urban::LayoutConfig::default();
        cfg.programme.intent = "isolated-farm".into();
        // The programme is prepared in the normal pipeline; an isolated intent
        // must not suppress the common final access invariant.
        l.config = Some(cfg.clone());
        let roads = [road(&[(40., 20.), (40., 380.)], "regional")];
        ensure_regional_access(&mut l, &roads, surface(&h, &w), &cfg);
        assert_eq!(l.streets.len(), 2);
        assert!(routing::path_clear(
            surface(&h, &w),
            &l.streets[1].path,
            cfg.max_lane_grade
        ));
        assert!(crate::settlements::roads::RoadConfig::default().activity_access);
    }
}

/// The wet corridor normal to each quay is the harbour's navigable approach.
/// Even an imported regional deck must yield here. River decks upstream, away
/// from that corridor, retain their original trajectories.
pub(super) fn harbour_clearance(layout: &mut Layout, surface: Surface<'_>, population: u32, max_grade: f64) {
    // Waterfront streets also occur in ordinary river towns. Their quays do
    // not reserve a harbour basin, so neither deck grouping nor relocation
    // may change those crossings or their bank connections.
    if !layout.config.as_ref().is_some_and(crate::urban::macroplan::harbour::port_town) {
        return;
    }
    let mut approach = Near::default();
    for s in layout.streets.iter().filter(|s| s.role == "quay") {
        for (j, w) in s.path.windows(2).enumerate() {
            let length = distance(w[0], w[1]);
            if length < EPS {
                continue;
            }
            let normal = Point {
                x: -(w[1].y - w[0].y) / length,
                y: (w[1].x - w[0].x) / length,
            };
            let n = (length / 12.0).ceil().max(1.0) as usize;
            for k in 0..=n {
                for side in [-1.0, 1.0] {
                    let p = lerp(w[0], w[1], k as f64 / n as f64);
                    let reach =
                        (width(s, j) + 2.0 * surface.width / surface.n as f64 + 8.0).max(20.0);
                    let at = |d: f64| Point {
                        x: p.x + side * normal.x * d,
                        y: p.y + side * normal.y * d,
                    };
                    let Some(start) = (1..=reach.ceil() as usize)
                        .map(|d| at(d as f64))
                        .find(|&p| surface.wet(p))
                    else {
                        continue;
                    };
                    // A sea/lake basin stays open for 200 m. On a narrow river the
                    // ray stops at the opposite bank, so upstream bridges are safe.
                    let mut end = start;
                    for d in 1..=100 {
                        let q = Point {
                            x: start.x + side * normal.x * d as f64 * 2.0,
                            y: start.y + side * normal.y * d as f64 * 2.0,
                        };
                        if !surface.wet(q) {
                            break;
                        }
                        end = q;
                    }
                    approach.add(start, end);
                }
            }
        }
    }
    if approach.lines.is_empty() {
        return;
    }
    let obstructs = |path: &[Point]| path.windows(2).any(|w| {
        let n = (distance(w[0], w[1]) / 4.0).ceil().max(1.0) as usize;
        (0..=n).any(|k| {
            let p = lerp(w[0], w[1], k as f64 / n as f64);
            surface.wet(p) && approach.distance(p, 12.0) <= 12.0
        })
    });
    // Causeways also encode raised dry bank ramps and joints on quay platforms.
    // They are bank routes, not decks across the navigable channel: grouping
    // them with bridges would delete the very approaches relocation must keep.
    let platforms: Vec<_> = layout.streets.iter().filter(|s| s.role == "quay")
        .flat_map(|s| s.path.windows(2).enumerate().map(move |(i, w)|
            (w[0], w[1], width(s, i).max(width(s, i + 1)) * 0.5 + 0.5))).collect();
    let crossing = |s: &Street| s.path.len() >= 2 && (matches!(s.role.as_str(), "bridge" | "ford")
        || s.role == "causeway" && s.path.windows(2).any(|w| {
            let n = (distance(w[0], w[1]) / 2.0).ceil().max(1.0) as usize;
            (0..=n).any(|i| {
                let p = lerp(w[0], w[1], i as f64 / n as f64);
                surface.wet(p) && !platforms.iter().any(|&(a, b, half)| g::distance(p, a, b).0 <= half)
            })
        }));
    let spans: Vec<_> = layout.streets.iter().filter(|s| crossing(s)).cloned().collect();
    let decks = Graph::new(&spans);
    let rejected: BTreeSet<_> = spans.iter().filter(|s| obstructs(&s.path))
        .map(|s| decks.component[&key(s.path[0])]).collect();
    if rejected.is_empty() { return; }
    // A navigation rejection overrides selection, including supported and split
    // imported decks. Preserve their bank junctions as the relocation demand.
    let mut requests = vec![];
    for &c in &rejected {
        let parts: Vec<_> = spans.iter().filter(|s| decks.component[&key(s.path[0])] == c).collect();
        let ends: Vec<_> = parts.iter().flat_map(|s| s.path.iter().copied())
            .filter(|&p| !surface.wet(p) && decks.degree(p) == 1).collect();
        let pair = ends.iter().enumerate().flat_map(|(i, &a)| ends[i + 1..].iter().map(move |&b| (a, b)))
            .max_by(|&(a, b), &(c, d)| distance(a, b).total_cmp(&distance(c, d)));
        if let Some((a, b)) = pair {
            let width = parts.iter().flat_map(|s| &s.widths).copied().fold(1.0, f64::max);
            let rank = parts.iter().map(|s| s.rank).min().unwrap_or(2);
            requests.push((a, b, width, rank));
        }
    }
    layout.streets.retain(|s| !crossing(s) || !rejected.contains(&decks.component[&key(s.path[0])]));
    let max_span = crate::urban::footprint::crossings::spans(&layout.culture, population).0;
    for (a, b, width, rank) in requests {
        let graph = Graph::new(&layout.streets);
        let (Some(ca), Some(cb)) = (graph.component.get(&key(a)), graph.component.get(&key(b))) else { continue; };
        if ca == cb { continue; }
        let middle = routing::water_intervals(surface, a, b).into_iter()
            .max_by(|x, y| (x.1 - x.0).total_cmp(&(y.1 - y.0)))
            .map_or(lerp(a, b, 0.5), |(lo, hi)| lerp(a, b, (lo + hi) * 0.5));
        let length = distance(a, b).max(EPS);
        let normal = Point { x: (b.x - a.x) / length, y: (b.y - a.y) / length };
        let along = Point { x: -normal.y, y: normal.x };
        let at = |sign: f64, d: f64| Point { x: middle.x + sign * along.x * d, y: middle.y + sign * along.y * d };
        // The closed/narrowing end is inland; reaching the map edge through
        // water is an open mouth. On rivers use the higher banks as upstream.
        let inland_score = |sign: f64| {
            let mut narrowest = 400.0_f64;
            let mut height = 0.0_f64;
            for i in 1..=40 {
                let p = at(sign, i as f64 * 16.0);
                if p.x < 0.0 || p.y < 0.0 || p.x >= surface.width || p.y >= surface.width { break; }
                if !surface.wet(p) { return i as f64 * 16.0; }
                // Cheap transects select the search direction before exact decks.
                let bank = |side: f64| (1..=100).map(|k| Point {
                    x: p.x + side * normal.x * k as f64 * 4.0,
                    y: p.y + side * normal.y * k as f64 * 4.0,
                }).find(|q| q.x >= 0.0 && q.y >= 0.0 && q.x < surface.width && q.y < surface.width && !surface.wet(*q));
                if let (Some(l), Some(r)) = (bank(-1.0), bank(1.0)) {
                    narrowest = narrowest.min(distance(l, r));
                    height = height.max((surface.height_at(l) + surface.height_at(r)) * 0.5);
                }
            }
            640.0 + narrowest - height.min(100.0)
        };
        let sign = if inland_score(1.0) <= inland_score(-1.0) { 1.0 } else { -1.0 };
        let margin = 700.0;
        let mut planner = routing::RoutePlanner::new(surface,
            (a.x.min(b.x) - margin, a.y.min(b.y) - margin, a.x.max(b.x) + margin, a.y.max(b.y) + margin));
        let mut land_route = |p: Point, q: Point| {
            if routing::segment_clear(surface, p, q, max_grade) { Some(vec![p, q]) }
            else { planner.route(p, q, max_grade).filter(|path| routing::path_clear(surface, path, max_grade)) }
        };
        let mut replacement = None;
        for i in 1..=40 {
            let p = at(sign, i as f64 * 16.0);
            if p.x < 0.0 || p.y < 0.0 || p.x >= surface.width || p.y >= surface.width { break; }
            if !surface.wet(p) { break; }
            if approach.distance(p, 12.0) <= 12.0 { continue; }
            let Some(mut ends) = crate::urban::footprint::crossings::deck(surface, p) else { continue; };
            if obstructs(&ends) || deck_landing_grade(surface, ends) > max_grade + EPS { continue; }
            let wet = routing::water_intervals(surface, ends[0], ends[1]);
            let span = wet.iter().map(|&(lo, hi)| (hi - lo) * distance(ends[0], ends[1])).sum::<f64>();
            if wet.len() != 1 || span > max_span + EPS { continue; }
            if distance(a, ends[0]) > distance(a, ends[1]) { ends.swap(0, 1); }
            for ends in [ends, [ends[1], ends[0]]] {
                if let (Some(left), Some(right)) = (land_route(a, ends[0]), land_route(b, ends[1])) {
                    replacement = Some((ends, left, right));
                    break;
                }
            }
            if replacement.is_some() { break; }
        }
        let street = |path: Vec<Point>, role: &str| Street { widths: vec![width; path.len()], path, rank, role: role.into() };
        if let Some((ends, left, right)) = replacement {
            layout.streets.extend([street(left, "approach"), street(ends.to_vec(), "bridge"), street(right, "approach")]);
        } else if let Some(path) = land_route(a, b) {
            // A closed cove can be bypassed on land when no deck is admissible.
            layout.streets.push(street(path, "approach"));
        }
        planarize(&mut layout.streets, surface.width * 0.25);
    }
}

/// Consolidate a grazing run before gates and their works are reconciled.
/// Both the replacement's water/grade and its curtain intersections are checked.
pub(in crate::urban) fn wall_approaches(layout: &mut Layout, surface: Surface<'_>) {
    let cfg = layout.config.clone().unwrap_or_default();
    if !cfg.wall_gate_policy {
        return;
    }
    let reserved = reserved_streets(layout);
    let mut moved = false;
    for e in &layout.enclosures {
        if e.path.len() < 4 {
            continue;
        }
        let near = crate::urban::fortification::Near::new(&e.path, 40.0);
        let graph = Graph::new(&layout.streets);
        let mut gates: Vec<Point> = vec![];
        let mut order: Vec<_> = (0..layout.streets.len()).collect();
        order.sort_by_key(|&i| (layout.streets[i].rank, i));
        for i in order {
            let s = &layout.streets[i];
            if s.path.len() < 2 || CROSSINGS.contains(&s.role.as_str()) || private(s) {
                continue;
            }
            let mut hits = vec![];
            for (j, w) in s.path.windows(2).enumerate() {
                for k in near.crossed(w[0], w[1]) {
                    let (a, b) = (e.path[k], e.path[k + 1]);
                    if let Some((_, p)) = g::segment_hit(w[0], w[1], a, b) {
                        if hits
                            .last()
                            .is_none_or(|&(_, _, q): &(usize, usize, Point)| distance(p, q) > 0.5)
                        {
                            hits.push((j, k, p));
                        }
                    }
                }
            }
            if hits.is_empty() {
                continue;
            }
            let (first, wall, p) = hits[0];
            let (last, _, _) = *hits.last().unwrap();
            let (a, b) = (e.path[wall], e.path[wall + 1]);
            let len = distance(a, b);
            if len < EPS {
                continue;
            }
            let tangent = Point {
                x: (b.x - a.x) / len,
                y: (b.y - a.y) / len,
            };
            let normal = Point {
                x: -tangent.y,
                y: tangent.x,
            };
            let incoming = distance(s.path[first], s.path[first + 1]);
            let sine = ((s.path[first + 1].x - s.path[first].x) * normal.x
                + (s.path[first + 1].y - s.path[first].y) * normal.y)
                .abs()
                / incoming.max(EPS);
            let spacing = (width(s, first) * 2.0 + 12.0).max(24.0);
            let close = gates.iter().copied().find(|&q| distance(q, p) < spacing);
            // Distinct sides of the town are independent wall runs.
            let same_run = hits.iter().all(|&(_, k, _)| {
                let (c, d) = (e.path[k], e.path[k + 1]);
                let l = distance(c, d);
                l > EPS && ((d.x - c.x) * tangent.x + (d.y - c.y) * tangent.y).abs() / l > 0.94
            });
            if !same_run || sine >= 0.5 && hits.len() == 1 && close.is_none() {
                gates.extend(hits.iter().map(|h| h.2));
                continue;
            }
            let gate = close.unwrap_or(p);
            let start = s.path[first];
            let end = s.path[last + 1];
            let side = |q: Point| (q.x - gate.x) * normal.x + (q.y - gate.y) * normal.y;
            let offset = hits
                .iter()
                .map(|&(_, k, _)| g::distance(e.path[k], a, b).0)
                .fold(0.0, f64::max)
                + width(s, first) * 0.5
                + 8.0;
            let at = |sign: f64| Point {
                x: gate.x + normal.x * offset * sign,
                y: gate.y + normal.y * offset * sign,
            };
            let left = at(if side(start) >= 0.0 { 1.0 } else { -1.0 });
            let right = at(if side(end) >= 0.0 { 1.0 } else { -1.0 });
            let mut replacement = vec![start, left];
            if side(start) * side(end) < 0.0 {
                replacement.extend([gate, right]);
            }
            replacement.push(end);
            replacement.dedup_by(|a, b| distance(*a, *b) < EPS);
            let grade = if s.rank >= 3 {
                cfg.max_lane_grade
            } else {
                cfg.max_street_grade
            };
            let crossings: Vec<_> = replacement
                .windows(2)
                .flat_map(|w| {
                    near.crossed(w[0], w[1]).into_iter().filter_map(move |k| {
                        g::segment_hit(w[0], w[1], e.path[k], e.path[k + 1]).map(|(_, p)| p)
                    })
                })
                .collect();
            if !routing::path_clear(surface, &replacement, grade)
                || crossings.iter().any(|&q| distance(q, gate) > 0.5)
            {
                gates.extend(hits.iter().map(|h| h.2));
                continue;
            }
            // Retain all old junctions outside the corrected approach. An
            // approach containing an internal junction is left for a later run.
            if s.path[first + 1..=last]
                .iter()
                .any(|&p| graph.degree(p) > 2)
            {
                gates.extend(hits.iter().map(|h| h.2));
                continue;
            }
            let w = width(s, first);
            let mut path = s.path[..first].to_vec();
            let mut widths: Vec<_> = (0..first).map(|j| width(s, j)).collect();
            widths.extend(vec![w; replacement.len()]);
            path.extend(replacement);
            path.extend_from_slice(&s.path[last + 2..]);
            widths.extend((last + 2..s.path.len()).map(|j| width(s, j)));
            layout.streets[i].path = path;
            layout.streets[i].widths = widths;
            moved = true;
            if !crossings.is_empty() {
                gates.push(gate);
            }
        }
    }
    if moved {
        planarize(&mut layout.streets, 200.0);
        remap_reservations(layout, &reserved);
    }
}
