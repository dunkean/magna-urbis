//! Network nodes (catalogue P4): toll houses at the bridges of main roads near towns,
//! ferries where a lesser road crosses a wide river, inns / caravanserais / Andean
//! storeways every 15–25 km of trunk road between towns, pilgrim stops near large
//! places, border posts on the trunk roads leaving the map. Read from the finished
//! network (never changes it); each node is an [`ActivitySite`] (mode `network_node`)
//! whose buildings stand beside the road, clear of its ribbon and of water. The
//! culture is the nearest settlement's. Keyed by position: no iteration-order effects.
use super::activities::{self as sites, ActivityBuilding, ActivitySite};
use super::grid::Fields;
use super::installations;
use super::roads::{RoadOutput, RoadSite};
use super::{Point, extent_radius};
use crate::rng::Rng;
use crate::urban::activities as act;

struct Place<'a> {
    key: &'a str,
    culture: &'a str,
    pop: u32,
    c: Point,
    r: f64,
}

/// Road pieces with their half width.
struct Ribbon(Vec<(Point, Point, f64)>);
fn seg_distance(p: Point, a: Point, b: Point) -> f64 {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let l2 = dx * dx + dy * dy;
    let t = if l2 > 0.0 { (((p.x - a.x) * dx + (p.y - a.y) * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
    p.distance(Point { x: a.x + dx * t, y: a.y + dy * t })
}
impl Ribbon {
    fn near(o: &RoadOutput, c: Point, r: f64) -> Self {
        let mut v = vec![];
        for s in &o.segments {
            for w in s.path.windows(2) {
                if seg_distance(c, w[0], w[1]) < r {
                    v.push((w[0], w[1], s.width / 2.0));
                }
            }
        }
        Self(v)
    }
    fn clear(&self, p: Point, margin: f64) -> bool {
        self.0.iter().all(|(a, b, h)| seg_distance(p, *a, *b) > h + margin)
    }
}

struct Spot {
    template: &'static str,
    at: Point,
    /// Road direction at `at`.
    dir: Point,
    class: String,
    place: usize,
}

/// Points every `step` m along a path with the local direction (from `skip` m on).
fn walk(path: &[Point], step: f64, skip: f64) -> Vec<(Point, Point)> {
    let mut out = vec![];
    let mut next = skip;
    let mut along = 0.0;
    for w in path.windows(2) {
        let l = w[0].distance(w[1]);
        if l <= 0.0 {
            continue;
        }
        let d = Point { x: (w[1].x - w[0].x) / l, y: (w[1].y - w[0].y) / l };
        while next <= along + l {
            let t = next - along;
            out.push((Point { x: w[0].x + d.x * t, y: w[0].y + d.y * t }, d));
            next += step;
        }
        along += l;
    }
    out
}

/// Waystation template of a culture: storeways for the Inca, inns where carts roll,
/// caravanserais for pack-animal cultures.
fn way_template(culture: &str) -> Option<&'static str> {
    if culture == "inca" {
        return Some("andean_storeway");
    }
    let t = act::transport(culture);
    if t.iter().any(|m| m == "carts") {
        Some("road_waystation")
    } else if t.iter().any(|m| m == "pack_animals") {
        Some("caravan_waystation")
    } else {
        None
    }
}

fn hash01(key: &str) -> f64 {
    Rng::new(key).float()
}

pub(super) fn place(seed: &str, f: &Fields, road_sites: &[RoadSite], roads: &RoadOutput) -> Vec<ActivitySite> {
    let places: Vec<Place> = road_sites
        .iter()
        .filter(|s| s.access.is_none())
        .map(|s| Place { key: &s.key, culture: &s.culture, pop: s.population, c: s.center, r: if s.radius > 0.0 { s.radius } else { extent_radius(s.population) } })
        .collect();
    if places.is_empty() || roads.segments.is_empty() {
        return vec![];
    }
    let nearest = |p: Point, min_pop: u32| {
        places
            .iter()
            .enumerate()
            .filter(|(_, s)| s.pop >= min_pop)
            .map(|(i, s)| (i, p.distance(s.c) - s.r))
            .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)))
    };
    let major = |c: &str| matches!(c, "highway" | "main");
    let mut spots: Vec<Spot> = vec![];
    // Border posts: trunk roads at the map exits, 700 m inside.
    for (j, junction) in roads.junctions.iter().enumerate() {
        if junction.site.as_deref() != Some("exit") {
            continue;
        }
        for s in roads.segments.iter().filter(|s| major(&s.class) && (s.a == j || s.b == j)) {
            let mut path = s.path.clone();
            if s.b == j {
                path.reverse();
            }
            let Some(&(at, d)) = walk(&path, 1e9, 700.0).first() else { continue };
            let Some((pi, _)) = nearest(at, 0) else { continue };
            spots.push(Spot { template: "border_outpost", at, dir: d, class: s.class.clone(), place: pi });
        }
    }
    // Bridges (toll) and wide river crossings of lesser roads (ferry).
    for s in &roads.segments {
        for cr in &s.crossings {
            if cr.kind == "causeway" || cr.path.len() < 2 {
                continue;
            }
            let widest = cr.path.iter().map(|p| f.index(*p)).filter(|&i| f.r.water[i] == 3).map(|i| f.r.river_width[i] as f64).fold(0.0, f64::max);
            let (a, b) = (cr.path[0], *cr.path.last().unwrap());
            let mid = Point { x: (a.x + b.x) / 2.0, y: (a.y + b.y) / 2.0 };
            let Some((pi, edge)) = nearest(mid, 0) else { continue };
            let template = if major(&s.class) && cr.kind == "bridge" && places[pi].pop >= 1000 && edge < 3000.0 {
                "bridge_toll"
            } else if !major(&s.class) && s.class != "trail" && widest >= 20.0 {
                "ferry_crossing"
            } else {
                continue;
            };
            // On the abutment nearer the place, a few metres back from the water.
            let (end, other) = if a.distance(places[pi].c) <= b.distance(places[pi].c) { (a, b) } else { (b, a) };
            let l = end.distance(other).max(1e-6);
            let d = Point { x: (end.x - other.x) / l, y: (end.y - other.y) / l };
            let at = Point { x: end.x + d.x * 12.0, y: end.y + d.y * 12.0 };
            spots.push(Spot { template, at, dir: d, class: s.class.clone(), place: pi });
        }
    }
    // Trade outposts: junctions of regional roads in open country (2.5 km+ from any place),
    // those between places of different cultures first, then the most remote.
    let mut trade: Vec<(bool, f64, Spot)> = vec![];
    for (j, junction) in roads.junctions.iter().enumerate() {
        if junction.site.is_some() || junction.degree < 3 {
            continue;
        }
        let regional: Vec<_> = roads.segments.iter().filter(|s| major(&s.class) && (s.a == j || s.b == j)).collect();
        if regional.len() < 2 {
            continue;
        }
        let at = junction.point;
        let mut ranked: Vec<(usize, f64)> = places.iter().enumerate().map(|(i, s)| (i, at.distance(s.c) - s.r)).collect();
        ranked.sort_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
        let Some(&(pi, edge)) = ranked.first() else { continue };
        if edge < 2500.0 {
            continue;
        }
        let mixed = ranked.get(1).is_some_and(|n| places[n.0].culture != places[pi].culture);
        let (a, b) = (regional[0].path.first().copied().unwrap_or(at), regional[0].path.last().copied().unwrap_or(at));
        let l = a.distance(b).max(1e-6);
        let dir = Point { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
        trade.push((mixed, edge, Spot { template: "trade_outpost", at, dir, class: regional[0].class.clone(), place: pi }));
    }
    trade.sort_by(|a, b| b.0.cmp(&a.0).then(b.1.total_cmp(&a.1)).then(a.2.at.x.total_cmp(&b.2.at.x)).then(a.2.at.y.total_cmp(&b.2.at.y)));
    // Waystations: trunk-road points far from towns, spaced 15–25 km (and from trade outposts).
    let mut way: Vec<(f64, Spot)> = vec![];
    for s in roads.segments.iter().filter(|s| major(&s.class)) {
        for (at, d) in walk(&s.path, 300.0, 150.0) {
            let (Some((pi, any)), Some((_, town))) = (nearest(at, 0), nearest(at, 1000)) else { continue };
            if any < 1000.0 || town < 5000.0 {
                continue;
            }
            let Some(template) = way_template(places[pi].culture) else { continue };
            way.push((town, Spot { template, at, dir: d, class: s.class.clone(), place: pi }));
        }
    }
    way.sort_by(|a, b| b.0.total_cmp(&a.0).then(a.1.at.x.total_cmp(&b.1.at.x)).then(a.1.at.y.total_cmp(&b.1.at.y)));
    let mut kept: Vec<Point> = vec![];
    for (_, _, t) in trade {
        if kept.len() < 2 && kept.iter().all(|k| k.distance(t.at) >= 8000.0) {
            kept.push(t.at);
            spots.push(t);
        }
    }
    for (_, w) in way {
        let spacing = 15000.0 + 10000.0 * hash01(&format!("nodes:{seed}:way:{:.0}:{:.0}", w.at.x, w.at.y));
        if kept.iter().all(|k| k.distance(w.at) >= spacing) {
            kept.push(w.at);
            spots.push(w);
        }
    }
    // Pilgrim stops: sometimes, on a road 1.2–3 km out of a large place.
    for (pi, p) in places.iter().enumerate().filter(|(_, p)| p.pop >= 2000) {
        if hash01(&format!("nodes:{seed}:pilgrim:{}", p.key)) >= 0.4 {
            continue;
        }
        let found = roads.segments.iter().filter(|s| s.class != "trail").find_map(|s| {
            walk(&s.path, 200.0, 100.0).into_iter().find(|(at, _)| {
                let edge = at.distance(p.c) - p.r;
                (1200.0..3000.0).contains(&edge) && nearest(*at, 0).is_some_and(|n| n.0 == pi)
            }).map(|(at, d)| (at, d, s.class.clone()))
        });
        if let Some((at, dir, class)) = found {
            spots.push(Spot { template: "pilgrimage_stop", at, dir, class, place: pi });
        }
    }
    // Keep: priority order above, 1.5 km apart, a cap per template.
    let cap = |t: &str| match t {
        "bridge_toll" | "border_outpost" => 4,
        "ferry_crossing" => 3,
        "pilgrimage_stop" | "trade_outpost" => 2,
        _ => usize::MAX,
    };
    let mut out: Vec<ActivitySite> = vec![];
    for s in spots {
        if out.iter().filter(|o| o.template == s.template).count() >= cap(s.template) || out.iter().any(|o| o.access.distance(s.at) < 1500.0) {
            continue;
        }
        if let Some(site) = build(&s, &places[s.place], f, roads) {
            out.push(site);
        }
    }
    out
}

fn build(s: &Spot, p: &Place, f: &Fields, roads: &RoadOutput) -> Option<ActivitySite> {
    let culture = p.culture;
    let tpl = act::data().sites.iter().find(|t| t.id == s.template)?;
    if !sites::culture_ok(&tpl.only, culture) || !tpl.required.iter().all(|b| act::allowed(culture, b)) {
        return None;
    }
    let id = format!("node:{}:{:.0}:{:.0}", s.template, s.at.x, s.at.y);
    let mut rng = Rng::new(&id);
    let extra = ((rng.float() * 3.0) as usize).min(2);
    let names = sites::pick(tpl, culture, extra, &mut rng);
    let ribbon = Ribbon::near(roads, s.at, 260.0);
    let dry = |q: Point| q.x >= 0.0 && q.y >= 0.0 && q.x < f.r.width && q.y < f.r.width && f.r.water[f.index(q)] == 0;
    let ok = |ring: &[Point]| {
        (0..ring.len()).all(|i| {
            let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
            let m = Point { x: (a.x + b.x) / 2.0, y: (a.y + b.y) / 2.0 };
            dry(a) && dry(m) && ribbon.clear(a, 3.0) && ribbon.clear(m, 3.0)
        })
    };
    let normal = Point { x: -s.dir.y, y: s.dir.x };
    let first = if rng.float() < 0.5 { 1.0 } else { -1.0 };
    let angle = s.dir.y.atan2(s.dir.x);
    let mut placed: Option<(Point, Vec<ActivityBuilding>)> = None;
    'tries: for dist in [22.0, 36.0, 52.0] {
        for side in [first, -first] {
            let centre = Point { x: s.at.x + normal.x * side * dist, y: s.at.y + normal.y * side * dist };
            // The yard's front faces the road on either side of it.
            let b = sites::yard(&id, culture, &names, centre, if side < 0.0 { angle + std::f64::consts::PI } else { angle }, &mut rng, f, &ok);
            if tpl.required.iter().all(|r| b.iter().any(|x| &x.archetype == r)) {
                placed = Some((centre, b));
                break 'tries;
            }
        }
    }
    let (centre, buildings) = placed?;
    let installations = installations::lay(&sites::allowed_installations(tpl, culture), &id, centre, &buildings, f, Some(s.at), &|q| !ribbon.clear(q, 2.0));
    Some(ActivitySite {
        template: s.template.into(),
        mode: "network_node".into(),
        parent: p.key.into(),
        anchor: String::new(),
        kind: "network_node".into(),
        resource: s.class.clone(),
        culture: culture.into(),
        x: centre.x,
        y: centre.y,
        ground: f.height_at(centre),
        access: s.at,
        access_class: "track".into(),
        residents: 0,
        season_mask: 0x0fff,
        buildings,
        installations,
        id,
    })
}
