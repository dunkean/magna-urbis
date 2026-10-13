//! Regional road network between placed settlements.
//!
//! Which places are linked comes from a Delaunay graph (its minimum spanning tree plus
//! shortcuts where the tree detours too much). Each link is routed on the terrain with the
//! road profile of its culture ([`profile`]), most important first, so lesser roads join
//! the trunks; all routes then merge into one network ([`network`]) whose class comes from
//! the trips it carries and whose surface comes from the development level and culture.
mod network;
pub mod profile;
mod search;

use super::grid::Fields;
use super::{Point, extent_radius};
use crate::{noise::Noise, rng::Rng};
use network::{Graph, Routed};
pub use profile::{CLASSES, LEVELS, PROFILES, SURFACES};
use profile::{Profile, class_index, level_by_id, profile_by_id, profile_for, surface_index};
use search::{Costs, Net, Query, Search};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RoadConfig {
    /// primitive | rural | developed | imperial
    pub level: String,
    /// auto (level and culture) | dirt | gravel | paved | flagstone
    pub surface: String,
    /// auto (culture of the larger place of each link) | a profile id
    pub culture: String,
    /// 0 = spanning tree only … 1 = many loops.
    pub density: f64,
    pub grade_weight: f64,
    /// Comfortable grade of main roads; 0 keeps the culture's value.
    pub max_grade: f64,
    pub crossing_cost: f64,
    /// Multiplies the culture's meandering.
    pub wobble: f64,
    /// 0 = every route on its own … 1 = strong trunk sharing.
    pub sharing: f64,
    pub exits: usize,
}
impl Default for RoadConfig {
    fn default() -> Self {
        Self {
            level: "rural".into(),
            surface: "auto".into(),
            culture: "auto".into(),
            density: 0.5,
            grade_weight: 1.0,
            max_grade: 0.0,
            crossing_cost: 1.0,
            wobble: 1.0,
            sharing: 0.7,
            exits: 2,
        }
    }
}

/// A place to connect. A placed settlement deserializes as one (extra fields are ignored).
#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(default, rename_all = "camelCase")]
pub struct RoadSite {
    pub key: String,
    pub population: u32,
    pub culture: String,
    pub center: Point,
    /// Settlement extent; 0 = from the population.
    pub radius: f64,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Crossing {
    /// bridge | ford | causeway
    pub kind: String,
    pub path: Vec<Point>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoadSegment {
    pub class: String,
    pub surface: String,
    pub profile: String,
    pub width: f64,
    /// Junction indices at both ends.
    pub a: usize,
    pub b: usize,
    pub path: Vec<Point>,
    pub crossings: Vec<Crossing>,
    pub length: f64,
    /// Steepest grade measured along the final path (rise over run).
    pub grade: f64,
    /// Population of the smaller end of the most important trip using this segment.
    pub importance: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Junction {
    pub point: Point,
    pub degree: usize,
    /// Settlement key, or "exit" at the map border.
    pub site: Option<String>,
}
#[derive(Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RoadOutput {
    pub segments: Vec<RoadSegment>,
    pub junctions: Vec<Junction>,
    pub warnings: Vec<String>,
    pub unreachable: Vec<String>,
    /// Routed connections (before merging).
    pub routes: usize,
    pub length_by_class: BTreeMap<String, f64>,
    pub length_by_surface: BTreeMap<String, f64>,
}

struct Union(Vec<usize>);
impl Union {
    fn new(n: usize) -> Self {
        Self((0..n).collect())
    }
    fn find(&self, mut i: usize) -> usize {
        while self.0[i] != i {
            i = self.0[i];
        }
        i
    }
    fn join(&mut self, a: usize, b: usize) {
        let (a, b) = (self.find(a), self.find(b));
        if a != b {
            self.0[a.max(b)] = a.min(b);
        }
    }
}

struct Plan {
    a: usize,
    b: usize,
    d: f64,
    mst: bool,
}
/// Delaunay pairs (all of them, for traffic) and the links to build: the spanning tree plus
/// shortcuts between places of 150+ inhabitants whose tree path exceeds `ratio` × distance.
fn plan(sites: &[RoadSite], ratio: f64) -> (Vec<(usize, usize)>, Vec<Plan>) {
    let k = sites.len();
    if k < 2 {
        return (vec![], vec![]);
    }
    let points: Vec<_> = sites
        .iter()
        .map(|s| delaunator::Point {
            x: s.center.x,
            y: s.center.y,
        })
        .collect();
    let del = delaunator::triangulate(&points);
    let mut pairs = BTreeSet::new();
    for t in del.triangles.as_chunks::<3>().0 {
        for (a, b) in [(t[0], t[1]), (t[1], t[2]), (t[2], t[0])] {
            pairs.insert((a.min(b), a.max(b)));
        }
    }
    if pairs.is_empty() {
        // Collinear places: chain them along the line.
        let mut order: Vec<_> = (0..k).collect();
        order.sort_by(|&a, &b| {
            points[a]
                .x
                .total_cmp(&points[b].x)
                .then_with(|| points[a].y.total_cmp(&points[b].y))
        });
        for pair in order.windows(2) {
            pairs.insert((pair[0].min(pair[1]), pair[0].max(pair[1])));
        }
    }
    let delaunay: Vec<_> = pairs.iter().copied().collect();
    let mut edges: Vec<_> = pairs
        .into_iter()
        .map(|(a, b)| Plan {
            a,
            b,
            d: sites[a].center.distance(sites[b].center),
            mst: false,
        })
        .collect();
    edges.sort_by(|a, b| {
        a.d.total_cmp(&b.d)
            .then_with(|| a.a.cmp(&b.a))
            .then_with(|| a.b.cmp(&b.b))
    });
    let mut uf = Union::new(k);
    let mut adj = vec![vec![]; k];
    for e in &mut edges {
        if uf.find(e.a) != uf.find(e.b) {
            e.mst = true;
            uf.join(e.a, e.b);
            adj[e.a].push((e.b, e.d));
            adj[e.b].push((e.a, e.d));
        }
    }
    let tree_distance = |a: usize, b: usize| {
        let mut d = vec![f64::INFINITY; k];
        d[a] = 0.0;
        let mut stack = vec![a];
        while let Some(u) = stack.pop() {
            for &(v, w) in &adj[u] {
                if !d[v].is_finite() {
                    d[v] = d[u] + w;
                    stack.push(v);
                }
            }
        }
        d[b]
    };
    let importance = |e: &Plan| sites[e.a].population.min(sites[e.b].population);
    edges.retain(|e| e.mst || (importance(e) >= 150 && tree_distance(e.a, e.b) > ratio * e.d));
    edges.sort_by(|a, b| {
        importance(b)
            .cmp(&importance(a))
            .then_with(|| a.d.total_cmp(&b.d))
            .then_with(|| a.a.cmp(&b.a))
            .then_with(|| a.b.cmp(&b.b))
    });
    (delaunay, edges)
}

fn validate(sites: &[RoadSite], cfg: &RoadConfig, width: f64) -> Result<(), String> {
    let values = [
        cfg.density,
        cfg.grade_weight,
        cfg.max_grade,
        cfg.crossing_cost,
        cfg.wobble,
        cfg.sharing,
    ];
    if values.iter().any(|v| !v.is_finite() || *v < 0.0)
        || cfg.density > 1.0
        || cfg.sharing > 1.0
        || cfg.grade_weight > 10.0
        || cfg.max_grade > 1.0
        || !(0.05..=10.0).contains(&cfg.crossing_cost)
        || cfg.wobble > 5.0
        || cfg.exits > 4
        || level_by_id(&cfg.level).is_none()
        || (cfg.surface != "auto" && !SURFACES.contains(&cfg.surface.as_str()))
        || (cfg.culture != "auto" && profile_by_id(&cfg.culture).is_none())
    {
        return Err("Invalid road parameters".into());
    }
    if sites.len() > 1000
        || sites.iter().any(|s| {
            !s.center.x.is_finite()
                || !s.center.y.is_finite()
                || s.center.x < 0.0
                || s.center.y < 0.0
                || s.center.x >= width
                || s.center.y >= width
                || !s.radius.is_finite()
                || s.radius < 0.0
        })
    {
        return Err("Invalid road endpoints".into());
    }
    Ok(())
}

struct Router<'a> {
    f: &'a Fields,
    sites: &'a [RoadSite],
    cfg: &'a RoadConfig,
    level: &'static profile::Level,
    costs: Costs,
    net: Net,
    search: Search,
    /// Road cells in insertion order, with the site whose component each route joined.
    road_cells: Vec<(usize, usize)>,
    marked: Vec<bool>,
    uf: Union,
    routed: Vec<Routed>,
}
impl Router<'_> {
    fn profile_of(&self, site: usize) -> usize {
        if self.cfg.culture == "auto" {
            profile_for(&self.sites[site].culture)
        } else {
            profile_by_id(&self.cfg.culture).unwrap_or(0)
        }
    }
    fn radius(&self, site: usize) -> f64 {
        let s = &self.sites[site];
        if s.radius > 0.0 {
            s.radius
        } else {
            extent_radius(s.population)
        }
    }
    /// Routes from a settlement (`from`) or a map exit (`None`, starting at `start`) to `to`.
    /// A route ends on the target's existing network when it has one.
    fn connect(&mut self, from: Option<usize>, to: usize, start: Point, importance: u32) -> bool {
        let f = self.f;
        let target = &self.sites[to];
        let comp = self.uf.find(to);
        let same = from.is_some_and(|k| self.uf.find(k) == comp);
        let goal = f.index(target.center);
        let start_i = f.index(start);
        let reach = self.radius(to) + 200.0;
        let mut goals = vec![goal];
        for &(cell, site) in &self.road_cells {
            if self.uf.find(site) == comp && (!same || f.pos(cell).distance(target.center) < reach)
            {
                goals.push(cell);
            }
        }
        let profile = self.profile_of(to);
        let class = class_index(importance, self.level);
        let query = Query {
            start: start_i,
            goals: &goals,
            origin: start,
            target: target.center,
            profile: &PROFILES[profile],
            class,
        };
        let Some(cells) = self.search.few_crossings(f, &self.net, &self.costs, &query) else {
            return false;
        };
        if let Some(from) = from {
            self.uf.join(from, to);
        }
        if cells.len() < 2 {
            return true;
        }
        let last = *cells.last().unwrap();
        let end = (last == goal).then(|| (target.center, target.key.clone()));
        let label = from.map_or_else(|| "exit".to_string(), |k| self.sites[k].key.clone());
        self.net.add_path(f.r.n, &cells);
        for &c in &cells {
            if !self.marked[c] {
                self.marked[c] = true;
                self.road_cells.push((c, to));
            }
        }
        self.routed.push(Routed {
            cells,
            importance,
            profile,
            start: (start, label),
            end,
        });
        true
    }
}

impl Router<'_> {
    /// A road from `site` to the map border `side`, ending wherever along that border the route
    /// is cheapest. Returns the exit point.
    fn connect_exit(&mut self, site: usize, side: usize, importance: u32) -> Option<Point> {
        let f = self.f;
        let n = f.r.n;
        let border: Vec<usize> = (0..n)
            .map(|k| match side {
                0 => k * n,
                1 => k * n + n - 1,
                2 => k,
                _ => (n - 1) * n + k,
            })
            .filter(|&i| f.r.water[i] == 0)
            .collect();
        let center = self.sites[site].center;
        let profile = self.profile_of(site);
        let query = Query {
            start: f.index(center),
            goals: &border,
            origin: center,
            target: side_point(f, side, center),
            profile: &PROFILES[profile],
            class: class_index(importance, self.level),
        };
        let mut cells = self
            .search
            .few_crossings(f, &self.net, &self.costs, &query)?;
        if cells.len() < 2 {
            return None;
        }
        cells.reverse();
        let at = f.pos(cells[0]);
        let exit = side_point(f, side, at);
        self.net.add_path(n, &cells);
        for &c in &cells {
            if !self.marked[c] {
                self.marked[c] = true;
                self.road_cells.push((c, site));
            }
        }
        self.routed.push(Routed {
            cells,
            importance,
            profile,
            start: (exit, "exit".into()),
            end: Some((center, self.sites[site].key.clone())),
        });
        Some(exit)
    }
}

/// Projection of `c` on map side 0 (west), 1 (east), 2 (north) or 3 (south).
fn side_point(f: &Fields, side: usize, c: Point) -> Point {
    match side {
        0 => Point { x: 0.0, y: c.y },
        1 => Point {
            x: f.r.width,
            y: c.y,
        },
        2 => Point { x: c.x, y: 0.0 },
        _ => Point {
            x: c.x,
            y: f.r.width,
        },
    }
}

pub(super) fn route(
    seed: &str,
    f: &Fields,
    sites: &[RoadSite],
    cfg: &RoadConfig,
) -> Result<RoadOutput, String> {
    validate(sites, cfg, f.r.width)?;
    let mut out = RoadOutput::default();
    let k = sites.len();
    if k == 0 {
        return Ok(out);
    }
    let level = level_by_id(&cfg.level).unwrap();
    let forced = SURFACES.iter().position(|s| *s == cfg.surface);
    let noise = Noise::new(
        Rng::new(&format!("magna-urbis:{seed}"))
            .fork("network")
            .fork("wobble"),
    );
    let size = f.r.n * f.r.n;
    let land = (0..size)
        .map(|i| {
            let mut m = 1.0;
            if f.dw[i] < 60.0 && f.hab[i] < 2.0 {
                m += 0.7 * (1.0 - super::smooth(f.hab[i], 0.3, 2.0));
            }
            if f.dw[i] < 6.0 * f.cell {
                m += 1.0 - f.dw[i] / (6.0 * f.cell);
            }
            m as f32
        })
        .collect();
    let wobble_noise = (0..size)
        .map(|i| {
            let p = f.pos(i);
            noise.fbm(p.x / 220.0, p.y / 220.0, 2) as f32
        })
        .collect();
    let mut settled = vec![false; size];
    for s in sites {
        let rad = if s.radius > 0.0 {
            s.radius
        } else {
            extent_radius(s.population)
        };
        let c = f.index(s.center);
        let r = (rad / f.cell).ceil() as isize;
        let (cx, cy) = ((c % f.r.n) as isize, (c / f.r.n) as isize);
        for y in (cy - r).max(0)..=(cy + r).min(f.r.n as isize - 1) {
            for x in (cx - r).max(0)..=(cx + r).min(f.r.n as isize - 1) {
                let i = y as usize * f.r.n + x as usize;
                if f.pos(i).distance(s.center) <= rad {
                    settled[i] = true;
                }
            }
        }
    }
    let mut router = Router {
        f,
        sites,
        cfg,
        level,
        costs: Costs {
            land,
            noise: wobble_noise,
            crossing_cost: cfg.crossing_cost,
            grade_weight: cfg.grade_weight,
            max_grade: cfg.max_grade,
            wobble: cfg.wobble,
            discount: 1.0 - 0.8 * cfg.sharing,
            near: 2.0 * cfg.sharing,
            dry_around: Costs::dry_around(f),
        },
        net: Net {
            dirs: vec![0; size],
            near: vec![0; size],
            settled,
        },
        search: Search::new(size),
        road_cells: vec![],
        marked: vec![false; size],
        uf: Union::new(k),
        routed: vec![],
    };
    // Shortcut threshold from the density: 0 → tree only, 0.5 → 1.6, 1 → 1.15.
    let density = (cfg.density * level.density).min(1.0);
    let ratio = if density <= 0.0 {
        f64::INFINITY
    } else {
        1.15 + 0.45 * (1.0 - density) / density
    };
    let (delaunay, plans) = plan(sites, ratio);
    let importance = |a: usize, b: usize| sites[a].population.min(sites[b].population);
    for e in &plans {
        if e.mst && router.uf.find(e.a) == router.uf.find(e.b) {
            continue;
        }
        let (from, to) = if sites[e.a].population <= sites[e.b].population {
            (e.a, e.b)
        } else {
            (e.b, e.a)
        };
        router.connect(Some(from), to, sites[from].center, importance(e.a, e.b));
    }
    let hub = (0..k)
        .max_by(|&a, &b| {
            sites[a]
                .population
                .cmp(&sites[b].population)
                .then(b.cmp(&a))
        })
        .unwrap();
    // A wet barrier may defeat a tree link: try other links between components.
    for a in 0..k {
        if router.uf.find(a) == router.uf.find(hub) {
            continue;
        }
        let mut targets: Vec<_> = (0..k)
            .filter(|&b| router.uf.find(a) != router.uf.find(b))
            .collect();
        targets.sort_by(|&b, &c| {
            sites[a]
                .center
                .distance(sites[b].center)
                .total_cmp(&sites[a].center.distance(sites[c].center))
        });
        for b in targets.into_iter().take(6) {
            if router.connect(Some(a), b, sites[a].center, importance(a, b)) {
                break;
            }
        }
    }
    // Exits: the main place towards its nearest borders, then large towns near a border. The
    // search runs from the place to every dry cell of that border, so the exit lands where the
    // ground allows rather than at the foot of a cliff.
    let mut exits: Vec<(Point, usize)> = vec![];
    let main = sites[hub].center;
    let mut main_sides: Vec<_> = (0..4).collect();
    main_sides.sort_by(|&a, &b| {
        side_point(f, a, main)
            .distance(main)
            .total_cmp(&side_point(f, b, main).distance(main))
    });
    for side in main_sides.into_iter().take(cfg.exits) {
        if let Some(p) = router.connect_exit(hub, side, sites[hub].population) {
            exits.push((p, hub));
        }
    }
    if cfg.exits > 0 {
        for i in (0..k).filter(|&i| i != hub && sites[i].population >= 1000) {
            let c = sites[i].center;
            let side = (0..4)
                .min_by(|&a, &b| {
                    side_point(f, a, c)
                        .distance(c)
                        .total_cmp(&side_point(f, b, c).distance(c))
                })
                .unwrap();
            let p = side_point(f, side, c);
            if p.distance(c) > 0.3 * f.r.width
                || exits
                    .iter()
                    .any(|(e, _)| e.distance(p) < 1500.0_f64.max(0.12 * f.r.width))
            {
                continue;
            }
            if let Some(p) = router.connect_exit(i, side, sites[i].population) {
                exits.push((p, i));
            }
        }
    }
    out.routes = router.routed.len();

    // One network from all routes.
    let mut graph = Graph::new();
    for r in &router.routed {
        graph.add(f, r);
    }
    for s in sites {
        graph.pin_cell(f.index(s.center), s.center, &s.key);
    }
    graph.planarize(f);
    graph.drop_triangles(f);
    let mut links = graph.links();
    let site_vertex: Vec<_> = sites
        .iter()
        .map(|s| graph.vertex_of(f.index(s.center)))
        .collect();
    let mut trips = vec![];
    for &(a, b) in &delaunay {
        if let (Some(va), Some(vb)) = (site_vertex[a], site_vertex[b]) {
            trips.push((va, vb, importance(a, b)));
        }
    }
    for &(p, s) in &exits {
        if let (Some(ve), Some(vs)) = (graph.vertex_of(f.index(p)), site_vertex[s]) {
            trips.push((ve, vs, sites[s].population));
        }
    }
    network::assign_traffic(&mut links, graph.pos.len(), &graph.pos, &trips, 3.0);

    // Junctions are the link ends.
    let mut junction_of: BTreeMap<usize, usize> = BTreeMap::new();
    let mut degree: BTreeMap<usize, usize> = BTreeMap::new();
    for link in &links {
        for v in [link.vertices[0], *link.vertices.last().unwrap()] {
            *degree.entry(v).or_default() += 1;
        }
    }
    for (&v, &d) in &degree {
        junction_of.insert(v, out.junctions.len());
        out.junctions.push(Junction {
            point: graph.pos[v],
            degree: d,
            site: graph.pin[v].clone(),
        });
    }
    // Most important first, so the renderer can draw the minor roads underneath.
    links.sort_by(|a, b| {
        b.importance
            .cmp(&a.importance)
            .then(b.length.total_cmp(&a.length))
    });
    for link in links {
        let p = &PROFILES[link.profile];
        let class = class_index(link.importance, level);
        let surface = surface_index(class, level, p, forced);
        let raw: Vec<_> = link.vertices.iter().map(|&v| graph.pos[v]).collect();
        let limit = if cfg.grade_weight > 0.0 {
            p.class_grade(class, cfg.max_grade)
        } else {
            f64::INFINITY
        };
        let path = smooth_path(f, p, &raw, limit);
        let length: f64 = path.windows(2).map(|w| w[0].distance(w[1])).sum();
        *out.length_by_class
            .entry(CLASSES[class].into())
            .or_default() += length;
        *out.length_by_surface
            .entry(SURFACES[surface].into())
            .or_default() += length;
        out.segments.push(RoadSegment {
            class: CLASSES[class].into(),
            surface: SURFACES[surface].into(),
            profile: p.id.into(),
            width: profile::width(class, level, p),
            a: junction_of[&link.vertices[0]],
            b: junction_of[link.vertices.last().unwrap()],
            crossings: crossings(f, &path, class),
            grade: measured_grade(f, &path),
            importance: link.importance,
            length,
            path,
        });
    }
    // Reachability from the main place over the final network.
    let mut reach = Union::new(out.junctions.len());
    for link_ends in out.segments.iter().map(|s| (s.a, s.b)) {
        reach.join(link_ends.0, link_ends.1);
    }
    let site_junction: Vec<Option<usize>> = site_vertex
        .iter()
        .map(|v| v.and_then(|v| junction_of.get(&v).copied()))
        .collect();
    let hub_root = site_junction[hub].map(|j| reach.find(j));
    for (i, s) in sites.iter().enumerate() {
        if i == hub {
            continue;
        }
        let connected = match (site_junction[i], hub_root) {
            (Some(j), Some(root)) => reach.find(j) == root,
            _ => false,
        };
        if !connected {
            out.unreachable.push(s.key.clone());
        }
    }
    if !out.unreachable.is_empty() {
        out.warnings.push(format!(
            "{} settlements cannot be reached by road",
            out.unreachable.len()
        ));
    }
    Ok(out)
}

fn clear(f: &Fields, p: &Profile, a: Point, b: Point) -> bool {
    let steps = (a.distance(b) / (f.cell * 0.2)).ceil().max(1.0) as usize;
    (0..=steps).all(|k| {
        let t = k as f64 / steps as f64;
        let i = f.index(Point {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
        });
        match f.r.water[i] {
            0 | 3 => true,
            2 => p.causeway && f.r.lake_depth(i) > 0.0,
            _ => false,
        }
    })
}
/// Steepest grade along a straight piece of road, sampled every half cell.
fn grade(f: &Fields, a: Point, b: Point) -> f64 {
    let d = a.distance(b);
    if d < 1e-6 {
        return 0.0;
    }
    let steps = (d / (0.5 * f.cell)).ceil().max(1.0) as usize;
    let at = |t: f64| {
        f.height_at(Point {
            x: a.x + (b.x - a.x) * t,
            y: a.y + (b.y - a.y) * t,
        })
    };
    let mut previous = at(0.0);
    let mut steepest = 0.0_f64;
    for k in 1..=steps {
        let next = at(k as f64 / steps as f64);
        steepest = steepest.max((next - previous).abs() * steps as f64 / d);
        previous = next;
    }
    steepest
}
/// Laplacian relaxation with fixed ends and fixed wet points, then one corner-cutting pass. No
/// step may enter blocked water or get steeper than the class limit (or the routed step, when
/// that was steeper already), so switchbacks keep their hairpins; points stay within a cell of
/// the routed line.
fn smooth_path(f: &Fields, profile: &Profile, raw: &[Point], limit: f64) -> Vec<Point> {
    if raw.len() < 3 {
        return raw.to_vec();
    }
    let mut p = raw.to_vec();
    let last = p.len() - 1;
    let allowed: Vec<f64> = (0..=last)
        .map(|i| {
            let before = if i > 0 {
                grade(f, raw[i - 1], raw[i])
            } else {
                0.0
            };
            let after = if i < last {
                grade(f, raw[i], raw[i + 1])
            } else {
                0.0
            };
            limit.max(before).max(after) + 0.005
        })
        .collect();
    let gentle = |a: Point, b: Point, i: usize| {
        f.r.water[f.index(a)] != 0 || f.r.water[f.index(b)] != 0 || grade(f, a, b) <= allowed[i]
    };
    for _ in 0..10 {
        for i in 1..last {
            if f.r.water[f.index(p[i])] != 0 {
                continue;
            }
            let q = Point {
                x: 0.5 * p[i].x + 0.25 * (p[i - 1].x + p[i + 1].x),
                y: 0.5 * p[i].y + 0.25 * (p[i - 1].y + p[i + 1].y),
            };
            if q.distance(raw[i]) > f.cell * 0.6 || f.r.water[f.index(q)] != 0 {
                continue;
            }
            if clear(f, profile, p[i - 1], q)
                && clear(f, profile, q, p[i + 1])
                && gentle(p[i - 1], q, i)
                && gentle(q, p[i + 1], i)
            {
                p[i] = q;
            }
        }
    }
    // Chaikin corner cutting where the cut stays on passable ground and within the grade.
    let mut out = vec![p[0]];
    for i in 1..last {
        let (a, b, c) = (p[i - 1], p[i], p[i + 1]);
        let wet = f.r.water[f.index(b)] != 0;
        let q = Point {
            x: 0.75 * b.x + 0.25 * a.x,
            y: 0.75 * b.y + 0.25 * a.y,
        };
        let r = Point {
            x: 0.75 * b.x + 0.25 * c.x,
            y: 0.75 * b.y + 0.25 * c.y,
        };
        if !wet
            && clear(f, profile, q, r)
            && f.r.water[f.index(q)] == 0
            && f.r.water[f.index(r)] == 0
            && gentle(q, r, i)
        {
            out.push(q);
            out.push(r);
        } else {
            out.push(b);
        }
    }
    out.push(p[last]);
    out
}
/// Wet runs along the path; a run that dips onto a dry corner for less than about a cell and a
/// half (a road clipping a bank while crossing) stays one crossing.
fn crossings(f: &Fields, path: &[Point], class: usize) -> Vec<Crossing> {
    const GAP: usize = 6;
    let mut out = vec![];
    let mut run: Vec<Point> = vec![];
    let mut kind = 0_u8;
    let mut widest = 0.0_f32;
    let mut dry = 0;
    let mut previous = path[0];
    let flush =
        |run: &mut Vec<Point>, dry: usize, kind: u8, widest: f32, out: &mut Vec<Crossing>| {
            // Keep one dry point past the water as the abutment.
            run.truncate(run.len() - dry.saturating_sub(1));
            if run.len() > 1 {
                let name = match kind {
                    2 => "causeway",
                    _ if widest < 3.5 && class >= 3 => "ford",
                    _ => "bridge",
                };
                out.push(Crossing {
                    kind: name.into(),
                    path: std::mem::take(run),
                });
            }
            run.clear();
        };
    for seg in path.windows(2) {
        let steps = (seg[0].distance(seg[1]) / (f.cell * 0.25)).ceil().max(1.0) as usize;
        for s in 1..=steps {
            let t = s as f64 / steps as f64;
            let p = Point {
                x: seg[0].x + (seg[1].x - seg[0].x) * t,
                y: seg[0].y + (seg[1].y - seg[0].y) * t,
            };
            let i = f.index(p);
            let w = f.r.water[i];
            if w == 2 || w == 3 {
                if !run.is_empty() && w != kind {
                    flush(&mut run, dry, kind, widest, &mut out);
                }
                if run.is_empty() {
                    run.push(previous);
                    widest = 0.0;
                }
                kind = w;
                widest = widest.max(f.r.river_width[i]);
                run.push(p);
                dry = 0;
            } else if !run.is_empty() {
                run.push(p);
                dry += 1;
                if dry > GAP {
                    flush(&mut run, dry, kind, widest, &mut out);
                    dry = 0;
                }
            }
            previous = p;
        }
    }
    flush(&mut run, dry, kind, widest, &mut out);
    out
}
/// Steepest grade between samples about one cell apart along the road, on dry ground.
fn measured_grade(f: &Fields, path: &[Point]) -> f64 {
    let total: f64 = path.windows(2).map(|w| w[0].distance(w[1])).sum();
    if total <= 0.0 {
        return 0.0;
    }
    let steps = (total / f.cell).ceil().max(1.0) as usize;
    let step = total / steps as f64;
    let mut samples = vec![path[0]];
    let mut seg = 0;
    let mut along = 0.0;
    for s in 1..=steps {
        let mut need = s as f64 * step;
        while seg + 1 < path.len() - 1 && along + path[seg].distance(path[seg + 1]) < need {
            along += path[seg].distance(path[seg + 1]);
            seg += 1;
        }
        need -= along;
        let len = path[seg].distance(path[seg + 1]).max(1e-9);
        let t = (need / len).clamp(0.0, 1.0);
        samples.push(Point {
            x: path[seg].x + (path[seg + 1].x - path[seg].x) * t,
            y: path[seg].y + (path[seg + 1].y - path[seg].y) * t,
        });
    }
    samples
        .windows(2)
        .filter_map(|w| {
            let (i, j) = (f.index(w[0]), f.index(w[1]));
            // Over the distance along the road: at a hairpin the samples are close in a straight line.
            (f.r.water[i] == 0 && f.r.water[j] == 0)
                .then(|| (f.height_at(w[0]) - f.height_at(w[1])).abs() / step)
        })
        .fold(0.0, f64::max)
}
