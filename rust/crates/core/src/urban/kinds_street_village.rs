//! `villageStreets`: a street village read from its site.
//!
//! A street village (village-rue, Strassendorf, Angerdorf, Waldhufendorf) is a
//! ribbon of long plots along a road, but the ribbon is not a pattern: the site
//! decides where it is built, how deep its strips run and where its lanes go.
//!
//! 1. **Site reading.** Every 5 m along the axis and on each side, a probe walks
//!    outward until water, another road or a slope the strips cannot climb: the
//!    *reach* of that station. A front with no reach (a bank, a scarp, a road
//!    mouth) is a gap.
//! 2. **Core.** The village gathers round a crossroads near the site's centre,
//!    else round the centre itself. Frontage pressure falls off from the core.
//! 3. **Green.** Drawn from the culture's data: a spindle green (the road splits
//!    round an Anger and the houses front the second branch), a green on one side
//!    (on the side with more room), a small square on both sides, or none.
//! 4. **Lanes, each with a reason.** A lane to the water where the bank comes
//!    close behind the plots (landing, ford, wash place); field tracks at the
//!    culture's spacing, each placed where the land behind opens furthest,
//!    turned towards the gentler slope and running well out into the fields
//!    (they serve fields, not doors, so the street pruning keeps them); a back lane joining two field lanes
//!    behind the strips, with a small second row of plots, when the culture
//!    has one or when the street has no room left for the households.
//! 5. **Strips.** Four fronts grow outward from the core (both sides, both
//!    directions), always the least advanced first, farm by farm. Near the core
//!    the front is continuous; towards the ends gaps open and farms widen. Strip
//!    depth follows the culture, the reach and a seeded wobble; behind a back lane
//!    the strips run to it.
//!
//! Culture differences are data (`village.street` in the catalogue). Every step
//! is a walk along the axis or a per-station probe: the cost is linear in the
//! street's length.
use super::*;

/// Station spacing along the axis (m).
const STEP: f64 = 5.0;
/// Probe step outward from the street (m).
const PROBE: f64 = 5.0;

/// `village.street` of the culture, with defaults.
struct Style {
    spindle: f64,
    side_green: f64,
    square: f64,
    depth: f64,
    spread: f64,
    back_lane: f64,
    field_lanes: f64,
    water_lanes: usize,
    obliquity: f64,
}

fn style(culture: &str, population: u32, organic: f64) -> Style {
    let data = &composition::culture_data(culture, population)["village"]["street"];
    let num = |key: &str, default: f64| data[key].as_f64().unwrap_or(default);
    // A culture that lists its greens has none of the others.
    let listed = data["green"].is_object();
    let green = |key: &str, default: f64| data["green"][key].as_f64().unwrap_or(if listed { 0.0 } else { default });
    Style {
        spindle: green("spindle", 0.3).clamp(0.0, 1.0),
        side_green: green("side", 0.35).clamp(0.0, 1.0),
        square: green("square", 0.0).clamp(0.0, 1.0),
        depth: num("depth", 1.0).clamp(0.4, 2.5),
        spread: num("spread", 1.0).clamp(0.0, 2.0),
        back_lane: num("backLane", 0.35).clamp(0.0, 1.0),
        field_lanes: num("fieldLanes", 160.0).clamp(60.0, 800.0),
        water_lanes: num("waterLanes", 2.0).clamp(0.0, 6.0) as usize,
        obliquity: num("obliquity", organic).clamp(0.0, 2.0),
    }
}

/// The axis with its arc lengths: position and smoothed normal at any station
/// in O(log n).
struct Track<'a> {
    path: &'a [Point],
    arc: Vec<f64>,
    total: f64,
}
impl<'a> Track<'a> {
    fn new(path: &'a [Point]) -> Self {
        let arc = arc(path);
        let total = *arc.last().unwrap_or(&0.0);
        Self { path, arc, total }
    }
    fn pos(&self, t: f64) -> Point {
        let t = t.clamp(0.0, self.total);
        let i = self.arc.partition_point(|&v| v < t).clamp(1, self.path.len() - 1);
        let run = (self.arc[i] - self.arc[i - 1]).max(1e-9);
        let f = ((t - self.arc[i - 1]) / run).clamp(0.0, 1.0);
        let (a, b) = (self.path[i - 1], self.path[i]);
        Point { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f }
    }
    /// Left normal, from the chord over ±8 m (no flip at a polyline vertex).
    fn normal(&self, t: f64) -> Point {
        perp(unit(self.pos(t - 8.0), self.pos(t + 8.0)))
    }
    /// The point `offset` metres off the axis at station `t` (left positive).
    fn off(&self, t: f64, offset: f64) -> Point {
        at(self.pos(t), self.normal(t), offset)
    }
}

/// What a station offers on one side.
#[derive(Clone, Copy, Default)]
struct Reach {
    /// Buildable depth behind the street edge (m).
    depth: f64,
    /// The probe stopped at water.
    water: bool,
    /// The probe stopped at once on another road (a junction).
    road: bool,
}

/// A run of continuous strips on one side, between two stations.
struct Run {
    left: bool,
    a: f64,
    b: f64,
    pressure: f64,
}

fn smoothstep(u: f64) -> f64 {
    let u = u.clamp(0.0, 1.0);
    u * u * (3.0 - 2.0 * u)
}

/// A band between two offset curves of the axis, from station `a` to `b`.
fn band(track: &Track<'_>, a: f64, b: f64, left: bool, inner: &dyn Fn(f64) -> f64, outer: &dyn Fn(f64) -> f64) -> Option<Shape> {
    if b - a < 2.0 {
        return None;
    }
    let sign = if left { 1.0 } else { -1.0 };
    let mut stations = vec![a];
    let mut t = (a / STEP).floor() * STEP + STEP;
    while t < b - 0.5 {
        stations.push(t);
        t += STEP;
    }
    stations.push(b);
    let mut ring: Vec<Point> = stations.iter().map(|&s| track.off(s, sign * inner(s))).collect();
    let back: Vec<Point> = stations.iter().rev().map(|&s| track.off(s, sign * outer(s).max(inner(s) + 0.5))).collect();
    ring.extend(back);
    ring.dedup_by(|p, q| dist(*p, *q) < 1e-6);
    if ring.len() < 3 {
        return None;
    }
    // A tight bend may fold the outer curve: the union resolves it.
    g::union(&[g::normalized(Shape { outer: ring, holes: vec![] })])
        .into_iter()
        .max_by(|x, y| g::area(x).total_cmp(&g::area(y)))
}

/// A lane leaving the street at station `s` on one side: straight between the
/// plots up to `straight` metres from the axis, then on into the fields for
/// `length` metres in all, turned by at most `angle` towards the gentler ground
/// and gently bent.
#[allow(clippy::too_many_arguments)]
fn side_lane(track: &Track<'_>, surface: Surface<'_>, s: f64, left: bool, straight: f64, length: f64, angle: f64, skew: f64, bend: f64, grade: f64) -> Option<Vec<Point>> {
    let p = track.pos(s);
    let n = track.normal(s);
    let n = if left { n } else { Point { x: -n.x, y: -n.y } };
    let q = at(p, n, straight);
    if !routing::segment_clear(surface, p, q, grade) {
        return None;
    }
    let rest = (length - straight).max(10.0);
    let turn = |a: f64| Point { x: n.x * a.cos() - n.y * a.sin(), y: n.x * a.sin() + n.y * a.cos() };
    let h0 = surface.height_at(q);
    let mut best: Option<(f64, f64)> = None;
    for a in [-angle, 0.0, angle] {
        let end = at(q, turn(a), rest);
        let climb = (surface.height_at(end) - h0).abs() + (surface.height_at(at(q, turn(a), rest * 0.5)) - h0).abs();
        // A small bias keeps a straight lane on flat ground.
        let cost = climb + a.abs() * 0.5;
        if best.is_none_or(|(_, c)| cost < c - 1e-9) {
            best = Some((a, cost));
        }
    }
    // Each track keeps its own heading: no comb of parallel paths on even ground.
    let end = at(q, turn(best?.0 + skew), rest);
    let mut path = vec![p];
    match field_lane(surface, q, end, bend, grade) {
        Some(outer) => path.extend(outer),
        // The fields refuse it: the lane stops behind the plots.
        None => path.push(q),
    }
    Some(path)
}

/// Point at arc length `t` along a polyline.
fn along(path: &[Point], t: f64) -> Point {
    Track::new(path).pos(t)
}

/// The street village's plan, `varied` branch of `linear`: blocks and streets
/// along `axis` (half width `half`), for `households` lots of `module` frontage.
#[allow(clippy::too_many_arguments)]
pub(super) fn plan(
    site: &Site,
    cfg: &LayoutConfig,
    culture: &str,
    axis: &[Point],
    half: f64,
    depth: f64,
    budget: f64,
    module: f64,
    lane: f64,
    organic: f64,
    blocked: &[Shape],
    surface: Surface<'_>,
    rng: &mut Rng,
) -> Option<(Vec<(Shape, &'static str)>, Vec<Street>, Point)> {
    let track = Track::new(axis);
    let total = track.total;
    if total < 40.0 || axis.len() < 2 {
        return None;
    }
    let style = style(culture, site.population, organic);
    let mut rng = rng.fork("street-village-site");
    let base = (depth * style.depth).clamp(28.0, 200.0);
    let min_depth = (base * 0.35).clamp(14.0, 30.0);
    let slope = (cfg.max_lane_grade * 1.4).clamp(0.12, 0.35);

    // 1. Site reading: reach of every station on both sides.
    let probe_max = base * 2.6 + 30.0;
    let (ax0, ay0, ax1, ay1) = axis.iter().fold((f64::MAX, f64::MAX, f64::MIN, f64::MIN), |b, p| {
        (b.0.min(p.x), b.1.min(p.y), b.2.max(p.x), b.3.max(p.y))
    });
    let margin = half + probe_max + 10.0;
    let roads: Vec<g::ContainmentIndex> = blocked
        .iter()
        .filter(|o| {
            let (x0, y0, x1, y1) = g::bbox(o);
            !(x0 > ax1 + margin || x1 < ax0 - margin || y0 > ay1 + margin || y1 < ay0 - margin)
        })
        .map(g::ContainmentIndex::new)
        .collect();
    let on_road = |q: Point| roads.iter().any(|r| r.contains(q));
    let count = (total / STEP).floor() as usize + 1;
    let station = |i: usize| (i as f64 * STEP).min(total);
    let mut reach = [vec![Reach::default(); count], vec![Reach::default(); count]];
    for i in 0..count {
        let s = station(i);
        let p = track.pos(s);
        let n = track.normal(s);
        for (k, sign) in [(0usize, -1.0), (1usize, 1.0)] {
            let mut t = half + 3.0;
            let mut last = p;
            let mut h = surface.height_at(p);
            let mut r = Reach::default();
            let mut good = half;
            while t <= half + probe_max {
                let q = at(p, n, sign * t);
                if surface.wet(q) {
                    r.water = true;
                    break;
                }
                if on_road(q) {
                    r.road = t <= half + 3.0 + 1e-9;
                    break;
                }
                let hq = surface.height_at(q);
                if (hq - h).abs() / dist(q, last).max(1.0) > slope {
                    break;
                }
                good = t;
                last = q;
                h = hq;
                t += PROBE;
            }
            r.depth = (good - half).max(0.0);
            reach[k][i] = r;
        }
    }
    // A road mouth or a wet front blocks its neighbours too (5 m stations).
    let buildable: [Vec<bool>; 2] = std::array::from_fn(|k| {
        (0..count)
            .map(|i| (i.saturating_sub(1)..=(i + 1).min(count - 1)).all(|j| reach[k][j].depth >= min_depth && !reach[k][j].road))
            .collect()
    });
    let idx = |s: f64| ((s / STEP).round() as usize).min(count - 1);
    let side_k = |left: bool| usize::from(left);
    let depth_at = |left: bool, s: f64| reach[side_k(left)][idx(s)].depth;

    // 2. Core: a crossroads near the site's centre, else the centre.
    let centre = (0..count)
        .min_by(|&a, &b| dist(track.pos(station(a)), site.center).total_cmp(&dist(track.pos(station(b)), site.center)))
        .map_or(total * 0.5, station);
    let mut junctions = vec![];
    for k in 0..2 {
        let mut i = 0;
        while i < count {
            if reach[k][i].road {
                let j0 = i;
                while i < count && reach[k][i].road {
                    i += 1;
                }
                junctions.push(station((j0 + i - 1) / 2));
            }
            i += 1;
        }
    }
    let core = junctions
        .iter()
        .copied()
        .filter(|&j| (j - centre).abs() < total * 0.3 && j > total * 0.1 && j < total * 0.9)
        .min_by(|a, b| (a - centre).abs().total_cmp(&(b - centre).abs()))
        .unwrap_or_else(|| (centre + rng.range(-0.08, 0.08) * total).clamp(total * 0.25, total * 0.75));
    let reach_scale = (budget / 4.0 * 1.1).max(50.0);
    let pressure = |s: f64| (-((s - core) / reach_scale).powi(2)).exp();

    // Forbidden spans and lane seams, per side.
    let mut forbidden: [Vec<(f64, f64)>; 2] = [vec![], vec![]];
    for k in 0..2 {
        let mut i = 0;
        while i < count {
            if !buildable[k][i] {
                let j0 = i;
                while i < count && !buildable[k][i] {
                    i += 1;
                }
                forbidden[k].push((station(j0) - STEP * 0.5, station(i - 1) + STEP * 0.5));
            }
            i += 1;
        }
    }
    let mut streets: Vec<Street> = vec![];
    let mut cuts: Vec<Shape> = vec![];
    let mut greens: Vec<Shape> = vec![];
    // Lane seams: (station, half extent over which the neighbouring strips run to the lane).
    let mut seams: [Vec<(f64, f64)>; 2] = [vec![], vec![]];

    // 3. Green.
    let green_len = rng.range(55.0, 120.0) * (f64::from(site.population) / 300.0).sqrt().clamp(0.8, 1.4);
    let draw = rng.float() * (style.spindle + style.side_green + style.square).max(1.0);
    let mean_reach = |left: bool, a: f64, b: f64| {
        let (i0, i1) = (idx(a.max(0.0)), idx(b.min(total)));
        (i0..=i1).map(|i| reach[side_k(left)][i].depth).sum::<f64>() / (i1 + 1 - i0) as f64
    };
    let (g0, g1) = ((core - green_len * 0.5).max(15.0), (core + green_len * 0.5).min(total - 15.0));
    let roomy = mean_reach(true, g0, g1) >= mean_reach(false, g0, g1);
    let green_left = if rng.chance(0.75) { roomy } else { !roomy };
    let mut spindle: Option<(f64, f64, f64, f64)> = None;
    if g1 - g0 >= 40.0 {
        if draw < style.spindle {
            // The road splits round a green: the branch bows out on the roomy side.
            let room = (g0..g1).step_by_f(STEP).map(|s| depth_at(green_left, s)).fold(f64::MAX, f64::min);
            let width = rng.range(22.0, 40.0).min(room - min_depth - lane);
            let branch = (half * 2.0 * 0.75).max(lane);
            let sign = if green_left { 1.0 } else { -1.0 };
            let bow = |s: f64| width * (std::f64::consts::PI * ((s - g0) / (g1 - g0))).sin();
            if width >= 16.0 {
                let k = ((g1 - g0) / 8.0).ceil().max(4.0) as usize;
                let path: Vec<Point> = (0..=k)
                    .map(|i| {
                        let s = g0 + (g1 - g0) * i as f64 / k as f64;
                        track.off(s, sign * bow(s))
                    })
                    .collect();
                if routing::path_clear(surface, &path, cfg.max_street_grade.max(0.08)) {
                    let inner = |_: f64| half + 0.5;
                    let outer = |s: f64| bow(s) - branch * 0.5 - 0.5;
                    let (ga, gb) = (g0 + (g1 - g0) * 0.12, g1 - (g1 - g0) * 0.12);
                    greens.extend(band(&track, ga, gb, green_left, &inner, &outer));
                    cuts.extend(g::ribbon(&path, &[branch]));
                    streets.push(street(path, branch, 2, "street"));
                    spindle = Some((g0, g1, width, branch));
                    forbidden[side_k(green_left)].push((g0 - 2.0, g1 + 2.0));
                }
            }
        }
        if spindle.is_none() && draw < style.spindle + style.side_green {
            let (a, b) = (core - green_len * 0.35, core + green_len * 0.35);
            let d = rng.range(28.0, 45.0);
            if let Some(green) = band(&track, a.max(5.0), b.min(total - 5.0), green_left, &|_| half, &|s| half + d.min(depth_at(green_left, s))) {
                greens.push(green);
                forbidden[side_k(green_left)].push((a - 1.0, b + 1.0));
            }
        } else if spindle.is_none() && draw < style.spindle + style.side_green + style.square {
            let (a, b) = (core - green_len * 0.25, core + green_len * 0.25);
            let d = rng.range(16.0, 28.0);
            for left in [true, false] {
                if let Some(green) = band(&track, a.max(5.0), b.min(total - 5.0), left, &|_| half, &|s| half + d.min(depth_at(left, s))) {
                    greens.push(green);
                    forbidden[side_k(left)].push((a - 1.0, b + 1.0));
                }
            }
        }
    }
    let blocked_at = |forbidden: &[(f64, f64)], s: f64, pad: f64| forbidden.iter().any(|&(a, b)| s > a - pad && s < b + pad);

    // 4a. Lanes to the water, where the bank comes close behind the plots.
    let extent = budget / 4.0 * (1.0 + 0.6 * style.spread) + 60.0;
    // (side, station, path, role): a lane to the water, or a field track.
    let mut lanes: Vec<(bool, f64, Vec<Point>, &'static str)> = vec![];
    for left in [true, false] {
        let k = side_k(left);
        let mut spans: Vec<(f64, f64)> = vec![];
        let mut i = 0;
        while i < count {
            let near = |i: usize| reach[k][i].water && reach[k][i].depth < base * 1.4 && buildable[k][i];
            if near(i) {
                let j0 = i;
                let mut best = i;
                while i < count && near(i) {
                    if reach[k][i].depth < reach[k][best].depth {
                        best = i;
                    }
                    i += 1;
                }
                if station(i - 1) - station(j0) >= 10.0 {
                    spans.push((station(best), reach[k][best].depth));
                }
            }
            i += 1;
        }
        spans.retain(|(s, _)| (s - core).abs() < extent);
        spans.sort_by(|a, b| (a.0 - core).abs().total_cmp(&(b.0 - core).abs()));
        let mut placed: Vec<f64> = vec![];
        for (s, d) in spans {
            if placed.len() >= style.water_lanes || placed.iter().any(|&q| (q - s).abs() < 140.0) || blocked_at(&forbidden[k], s, 12.0) {
                continue;
            }
            let path = vec![track.pos(s), track.off(s, if left { 1.0 } else { -1.0 } * (half + d))];
            if routing::path_clear(surface, &path, cfg.max_lane_grade) {
                placed.push(s);
                seams[k].push((s, lane * 0.5 + 1.5));
                lanes.push((left, s, path, "lane"));
            }
        }
    }

    // 4b. Field lanes, at the culture's spacing, where the land opens furthest.
    //     A field lane serves the fields, not doors: it is a track that runs well
    //     out past the strips (and a back lane's second row), so that the street
    //     pruning keeps it as a way to the fields.
    let angle = 0.24 * style.obliquity;
    let lane_len = |r: &mut Rng| half + base * r.range(2.4, 3.0) + r.range(50.0, 260.0);
    for left in [true, false] {
        let k = side_k(left);
        for dir in [-1.0, 1.0] {
            let mut x = rng.range(10.0, 50.0);
            loop {
                let step = style.field_lanes * rng.range(1.0, 2.2);
                let (lo, hi) = (x + step * 0.7, x + step * 1.3);
                if lo > extent {
                    break;
                }
                // The station of longest reach in the window.
                let mut best: Option<(f64, f64)> = None;
                let mut y = lo;
                while y <= hi {
                    let s = core + dir * y;
                    if s < 20.0 || s > total - 20.0 {
                        break;
                    }
                    let i = idx(s);
                    let free = buildable[k][i]
                        && !blocked_at(&forbidden[k], s, 15.0)
                        && !seams[k].iter().any(|&(q, _)| (q - s).abs() < 35.0);
                    if free && best.is_none_or(|(_, r)| reach[k][i].depth > r + 1e-9) {
                        best = Some((s, reach[k][i].depth));
                    }
                    y += STEP;
                }
                let Some((s, _)) = best else {
                    x = hi;
                    if core + dir * x < 0.0 || core + dir * x > total {
                        break;
                    }
                    continue;
                };
                let bend = rng.range(1.5, 7.0) * style.obliquity.max(0.3) * if rng.chance(0.5) { -1.0 } else { 1.0 };
                let length = lane_len(&mut rng);
                let skew = rng.range(-0.18, 0.18) * style.obliquity.max(0.4);
                if let Some(path) = side_lane(&track, surface, s, left, half + base * 1.6, length, angle, skew, bend, cfg.max_lane_grade) {
                    seams[k].push((s, lane * 0.5 + 1.0));
                    lanes.push((left, s, path, "track"));
                }
                x = (s - core) * dir;
            }
        }
    }

    // 4c. A back lane joining two field lanes behind the strips, with a second row.
    let usable: f64 = (0..2).map(|k| buildable[k].iter().filter(|&&b| b).count() as f64 * STEP).sum();
    let overflow = budget / usable.max(1.0);
    let mut budget = budget;
    let mut back: Option<(bool, f64, f64, Box<dyn Fn(f64) -> f64>)> = None;
    if rng.chance((style.back_lane + if overflow > 0.85 { 0.5 } else { 0.0 }).min(1.0)) {
        let mut pairs: Vec<(usize, usize)> = vec![];
        for (i, a) in lanes.iter().enumerate() {
            for (j, b) in lanes.iter().enumerate() {
                let gap = b.1 - a.1;
                if a.0 == b.0 && (80.0..=380.0).contains(&gap) && i != j {
                    pairs.push((i, j));
                }
            }
        }
        pairs.sort_by(|p, q| {
            let mid = |p: &(usize, usize)| ((lanes[p.0].1 + lanes[p.1].1) * 0.5 - core).abs();
            mid(p).total_cmp(&mid(q))
        });
        let drift = rng.range(0.0, 28.0) * style.obliquity.max(0.4);
        let rising = rng.chance(0.5);
        let set_back = base * rng.range(0.95, 1.15);
        for (i, j) in pairs.into_iter().take(3) {
            let (left, a, b) = (lanes[i].0, lanes[i].1, lanes[j].1);
            let offset = move |s: f64| {
                let u = ((s - a) / (b - a)).clamp(0.0, 1.0);
                half + set_back + lane * 0.5 + drift * smoothstep(if rising { u } else { 1.0 - u })
            };
            let sign = if left { 1.0 } else { -1.0 };
            // Ends on the two field lanes, which must run past it.
            let reach_lane = |path: &[Point], off: f64| -> Option<Point> {
                let len = *arc(path).last()?;
                (len > off + 8.0).then(|| along(path, off))
            };
            let (Some(pa), Some(pb)) = (reach_lane(&lanes[i].2, offset(a)), reach_lane(&lanes[j].2, offset(b))) else {
                continue;
            };
            let k = ((b - a) / 10.0).ceil().max(2.0) as usize;
            let mut path = vec![pa];
            path.extend((1..k).map(|m| {
                let s = a + (b - a) * m as f64 / k as f64;
                track.off(s, sign * offset(s))
            }));
            path.push(pb);
            if !routing::path_clear(surface, &path, cfg.max_lane_grade) {
                continue;
            }
            cuts.extend(g::ribbon(&path, &[lane]));
            streets.push(street(path, lane, 3, "lane"));
            budget -= (b - a) * 0.8;
            back = Some((left, a, b, Box::new(offset)));
            break;
        }
    }
    for (_, _, path, _) in &lanes {
        cuts.extend(g::ribbon(path, &[lane]));
    }

    // 5. Strips: four fronts grow outward from the core, the least advanced first.
    let p_gap = |f: f64| (style.spread * (0.04 + 0.4 * (1.0 - f).powi(2))).clamp(0.0, 0.8);
    struct Front {
        left: bool,
        dir: f64,
        x: f64,
        drive: f64,
        live: bool,
    }
    let mut fronts: Vec<Front> = vec![];
    for left in [true, false] {
        for dir in [-1.0, 1.0] {
            let start = match spindle {
                Some((g0, g1, ..)) if left == green_left => ((if dir > 0.0 { g1 } else { g0 }) - core) * dir + 3.0,
                _ => rng.range(0.0, 10.0),
            };
            fronts.push(Front { left, dir, x: start, drive: rng.range(0.8, 1.25), live: true });
        }
    }
    let mut runs: Vec<Run> = vec![];
    let farm = |f: f64, r: &mut Rng| module * r.range(0.9, 1.6) * (1.0 + 0.4 * (1.0 - f));
    while budget > 0.0 {
        let Some(c) = fronts
            .iter_mut()
            .filter(|c| c.live)
            .min_by(|a, b| (a.x / a.drive).total_cmp(&(b.x / b.drive)))
        else {
            break;
        };
        let k = side_k(c.left);
        let s_of = |x: f64| core + c.dir * x;
        let x = c.x;
        let s = s_of(x);
        if s < 6.0 || s > total - 6.0 {
            c.live = false;
            continue;
        }
        // Inside a forbidden span: skip to its far end.
        if let Some(&(a, b)) = forbidden[k].iter().find(|&&(a, b)| s >= a && s <= b) {
            c.x = (if c.dir > 0.0 { b } else { a } - core) * c.dir + 0.5;
            continue;
        }
        // The next obstacle ahead: a forbidden span or a lane seam.
        let limit_end = (if c.dir > 0.0 { total - 6.0 } else { 6.0 } - core) * c.dir;
        let mut limit = limit_end;
        let mut at_seam: Option<(f64, f64)> = None;
        for &(a, b) in &forbidden[k] {
            let near = (if c.dir > 0.0 { a } else { b } - core) * c.dir;
            if near > x && near < limit {
                limit = near;
                at_seam = None;
            }
        }
        for &(q, e) in &seams[k] {
            let xq = (q - core) * c.dir;
            if xq > x + e + 0.5 && xq + e < limit {
                limit = xq + e;
                at_seam = Some((xq, e));
            }
        }
        let mut end = x;
        let mut hit = false;
        loop {
            let f = pressure(s_of(end));
            let w = farm(f, &mut rng);
            if end + w >= limit {
                hit = true;
                end = limit;
                break;
            }
            end += w;
            if budget - (end - x) <= 0.0 || rng.chance(p_gap(pressure(s_of(end)))) {
                break;
            }
        }
        if end - x >= 14.0 {
            let (a, b) = if c.dir > 0.0 { (s_of(x), s_of(end)) } else { (s_of(end), s_of(x)) };
            runs.push(Run { left: c.left, a, b, pressure: pressure((a + b) * 0.5) });
            budget -= end - x;
        }
        c.x = match (hit, at_seam) {
            (true, Some((xq, e))) => xq - e,
            (true, None) => limit + 0.5,
            _ => {
                let f = pressure(s_of(end));
                end + rng.range(6.0, 30.0) * (0.6 + (1.0 - f)) * style.spread.max(0.3)
            }
        };
    }

    // 6. Blocks: each run a band, its depth from the culture, the reach and a
    //    seeded wobble; behind a back lane the strips run to it.
    let mut taken: Vec<Shape> = vec![];
    let accept = |shape: Shape, kind: &'static str, blocks: &mut Vec<(Shape, &'static str)>, taken: &mut Vec<Shape>| {
        let mut pieces = vec![shape];
        for cut in cuts.iter().chain(taken.iter()) {
            let (a0, b0, a1, b1) = g::bbox(cut);
            pieces = pieces
                .iter()
                .flat_map(|p| {
                    let (x0, y0, x1, y1) = g::bbox(p);
                    if a0 > x1 || a1 < x0 || b0 > y1 || b1 < y0 { vec![p.clone()] } else { g::difference(p, cut) }
                })
                .collect();
        }
        if let Some(p) = pieces
            .into_iter()
            .max_by(|a, b| g::area(a).total_cmp(&g::area(b)))
            .and_then(|p| settle(&p, blocked, &surface, 0.4))
            .filter(|p| g::area(p) > 250.0)
        {
            taken.push(p.clone());
            blocks.push((p, kind));
        }
    };
    let mut built: Vec<(Shape, &'static str)> = vec![];
    // The green first: the church and the village's centre stand by it.
    for green in greens {
        accept(green, "place", &mut built, &mut taken);
    }
    let center = built.first().map_or(track.pos(core), |(green, _)| g::centroid(green));
    for run in &runs {
        let target = base * rng.range(0.85, 1.1) * (1.0 + 0.2 * (1.0 - run.pressure));
        // The back line: one fence per farm or two, straight between its corners.
        let mut knots = vec![(run.a, rng.range(0.88, 1.12))];
        while knots.last().unwrap().0 < run.b {
            let next = knots.last().unwrap().0 + module * rng.range(1.0, 2.4);
            knots.push((next.min(run.b), rng.range(0.88, 1.12)));
        }
        let wobble = move |s: f64| {
            let i = knots.partition_point(|k| k.0 < s).clamp(1, knots.len() - 1);
            let ((s0, v0), (s1, v1)) = (knots[i - 1], knots[i]);
            v0 + (v1 - v0) * ((s - s0) / (s1 - s0).max(1e-9)).clamp(0.0, 1.0)
        };
        let behind = back.as_ref().filter(|(left, a, b, _)| *left == run.left && run.b > *a && run.a < *b);
        let inner_bow = |s: f64| match spindle {
            Some((g0, g1, width, branch)) if run.left == green_left && s > g0 && s < g1 => {
                (width * (std::f64::consts::PI * ((s - g0) / (g1 - g0))).sin() + branch * 0.5).max(half)
            }
            _ => half,
        };
        let outer = |s: f64| {
            let room = half + depth_at(run.left, s) - 0.5;
            let own = half + target * wobble(s);
            match behind {
                Some((_, a, b, offset)) if s >= *a && s <= *b => (offset(s) - lane * 0.5 - 0.2).min(room),
                _ => own.min(room),
            }
        };
        if let Some(shape) = band(&track, run.a, run.b, run.left, &inner_bow, &outer) {
            accept(shape, "block", &mut built, &mut taken);
        }
    }
    // The houses fronting the spindle's branch.
    if let Some((g0, g1, width, branch)) = spindle {
        let target = base * rng.range(0.85, 1.05);
        let inner = |s: f64| (width * (std::f64::consts::PI * ((s - g0) / (g1 - g0))).sin() + branch * 0.5 + 0.05).max(half);
        let outer = |s: f64| (inner(s) + target).min(half + depth_at(green_left, s) - 0.5);
        if let Some(shape) = band(&track, g0 + 4.0, g1 - 4.0, green_left, &inner, &outer) {
            accept(shape, "block", &mut built, &mut taken);
        }
    }
    // The back lane's second row, on its far side.
    if let Some((left, a, b, offset)) = &back {
        let row = base * rng.range(0.55, 0.8);
        let (ra, rb) = (a + lane + 2.0, b - lane - 2.0);
        let inner = |s: f64| offset(s) + lane * 0.5 + 0.05;
        let outer = |s: f64| (inner(s) + row).min(half + depth_at(*left, s) - 0.5);
        if rb - ra > 30.0
            && let Some(shape) = band(&track, ra, rb, *left, &inner, &outer)
        {
            accept(shape, "block", &mut built, &mut taken);
        }
    }
    let blocks = built;
    // A lane that no plot touches leads nowhere: drop it.
    for (_, _, path, role) in lanes {
        let serves = blocks.iter().any(|(shape, kind)| {
            *kind == "block"
                && shape.outer.iter().any(|&v| path.windows(2).any(|w| g::distance(v, w[0], w[1]).0 < lane * 0.5 + 3.0))
        });
        if serves {
            streets.push(street(path, lane, 3, role));
        }
    }
    // Never an empty village: without a single plot the caller falls back.
    blocks.iter().any(|(_, kind)| *kind == "block").then_some((blocks, streets, center))
}

/// `(a..b).step_by_f(step)`: stations from `a` to `b` every `step`.
trait StepBy {
    fn step_by_f(self, step: f64) -> std::vec::IntoIter<f64>;
}
impl StepBy for std::ops::Range<f64> {
    fn step_by_f(self, step: f64) -> std::vec::IntoIter<f64> {
        let mut out = vec![];
        let mut t = self.start;
        while t < self.end {
            out.push(t);
            t += step;
        }
        out.push(self.end);
        out.into_iter()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::urban::{ParcelConfig, generate_parcels, generate_quarters};

    const W: f64 = 3000.0;
    const N: usize = 300;
    fn p(x: f64, y: f64) -> Point {
        Point { x, y }
    }
    fn road(path: Vec<Point>) -> Street {
        street(path, 6.0, 0, "regional")
    }

    type Case = (&'static str, Vec<f32>, Vec<u8>, Vec<Street>);

    /// Four sites: flat, slope across (with a ravine), river along, crossroads with a marsh.
    fn sites() -> Vec<Case> {
        let cell = |k: usize| (((k % N) as f64 + 0.5) * W / N as f64, ((k / N) as f64 + 0.5) * W / N as f64);
        let flat_h = vec![0.0f32; N * N];
        let dry = vec![0u8; N * N];
        let main = || road(vec![p(100.0, 1520.0), p(900.0, 1490.0), p(1500.0, 1500.0), p(2100.0, 1540.0), p(2900.0, 1510.0)]);
        // Uphill to the north (y < 1500): steeper and steeper; a ravine at x 1380-1460;
        // gently down to the south.
        let slope_h: Vec<f32> = (0..N * N)
            .map(|k| {
                let (x, y) = cell(k);
                let d = 1500.0 - y;
                let up = if d > 0.0 { 0.08 * d + 0.003 * d * d } else { 0.03 * d };
                let ravine = if (1380.0..1460.0).contains(&x) && d > 0.0 { 0.25 * d } else { 0.0 };
                (up + ravine) as f32
            })
            .collect();
        let straight = || road(vec![p(100.0, 1500.0), p(2900.0, 1500.0)]);
        // A river south of the road, 40-140 m off, meandering.
        let river: Vec<u8> = (0..N * N)
            .map(|k| {
                let (x, y) = cell(k);
                let c = 1500.0 + 90.0 + 50.0 * (x / 260.0).sin();
                u8::from((y - c).abs() < 16.0)
            })
            .collect();
        // Crossroads: a road north from the centre, one south further east, a marsh west.
        let marsh: Vec<u8> = (0..N * N)
            .map(|k| {
                let (x, y) = cell(k);
                u8::from(((x - 1150.0) / 90.0).powi(2) + ((y - 1440.0) / 40.0).powi(2) < 1.0)
            })
            .collect();
        vec![
            ("flat", flat_h.clone(), dry.clone(), vec![main()]),
            ("slope", slope_h, dry, vec![straight()]),
            ("river", flat_h.clone(), river, vec![main()]),
            (
                "crossroads",
                flat_h,
                marsh,
                vec![
                    main(),
                    road(vec![p(1500.0, 1500.0), p(1480.0, 900.0), p(1550.0, 200.0)]),
                    road(vec![p(1760.0, 1520.0), p(1800.0, 2200.0), p(1700.0, 2900.0)]),
                ],
            ),
        ]
    }

    fn surface<'a>(h: &'a [f32], w: &'a [u8]) -> Surface<'a> {
        Surface { geometry: None, width: W, n: N, height: h, water: w, interpolation: Default::default() }
    }

    fn site(culture: &str, key: &str) -> Site {
        Site { key: key.into(), name: String::new(), population: 500, culture: culture.into(), center: p(1500.0, 1505.0), radius: 200.0, neighbours: Vec::new() }
    }

    /// The site-read plan stays a street village: plots on both sides of the road,
    /// no plot on another nor under a lane, never on water, shallower up the slope,
    /// replayed by its seed and varied by it.
    #[test]
    fn street_village_reads_its_site() {
        let morph = Morph { value: serde_json::json!({
            "plotDepth": {"village": [40.0, 60.0]},
            "frontage": {"village": [12.0, 16.0]},
            "curvature": 0.6,
        }) };
        let cfg = LayoutConfig { road_width_by_size: false, village_streets: true, ..LayoutConfig::default() };
        for (name, h, w, roads) in sites() {
            let surface = surface(&h, &w);
            for k in 0..4 {
                let culture = ["european-organic", "byzantine-greek", "venetian-lagoon", "hanseatic"][k];
                let site = site(culture, &format!("{name}-{k}"));
                let near = nearest(site.center, &roads, 600.0);
                let build = |seed: &str| {
                    linear(&site, &cfg, Kind::StreetVillage, &morph, &near, &[], &|_| 3.05, &roads, surface, &mut Rng::new(seed))
                        .expect("a street village")
                };
                let plan = build(&site.key);
                let again = build(&site.key);
                let paths = |plan: &Plan| plan.streets.iter().map(|s| s.path.clone()).collect::<Vec<_>>();
                assert_eq!(paths(&plan), paths(&again), "{name}/{culture}: seed replay");
                let built: Vec<&Shape> = plan.blocks.iter().filter(|(_, kind)| *kind == "block").map(|(b, _)| b).collect();
                assert!(built.len() >= 4, "{name}/{culture}: {} blocks", built.len());
                for (i, a) in built.iter().enumerate() {
                    for b in &built[i + 1..] {
                        let overlap: f64 = g::intersection(a, b).iter().map(g::area).sum();
                        assert!(overlap < 1.0, "{name}/{culture}: plots overlap by {overlap} m2");
                    }
                    assert!(!surface.wet(g::interior_point(a)), "{name}/{culture}: a plot on water");
                }
                for lane in &plan.streets {
                    for ribbon in g::ribbon(&lane.path, &lane.widths) {
                        for shape in &built {
                            let overlap: f64 = g::intersection(shape, &ribbon).iter().map(g::area).sum();
                            assert!(overlap < 1.0, "{name}/{culture}: a lane over a plot by {overlap} m2");
                        }
                    }
                }
                let other = build(&format!("{}-other", site.key));
                assert_ne!(paths(&plan), paths(&other), "{name}/{culture}: the seed varies the plan");
                if name == "slope" {
                    // Mean depth of the plots north (uphill) and south of the road.
                    let depth = |north: bool| {
                        let ds: Vec<f64> = built
                            .iter()
                            .filter(|s| (g::centroid(s).y < 1500.0) == north)
                            .map(|s| {
                                let (_, y0, _, y1) = g::bbox(s);
                                y1 - y0
                            })
                            .collect();
                        ds.iter().sum::<f64>() / ds.len().max(1) as f64
                    };
                    assert!(depth(true) < depth(false), "{culture}: strips climb the slope ({} vs {})", depth(true), depth(false));
                }
            }
        }
    }

    /// Plan pictures (before: switch off; after: on) when `MU_VILLAGE_SHOTS` names a folder.
    #[test]
    fn street_village_pictures() {
        let Ok(dir) = std::env::var("MU_VILLAGE_SHOTS") else { return };
        let dir = std::path::PathBuf::from(dir);
        std::fs::create_dir_all(&dir).unwrap();
        let seed_suffix = std::env::var("MU_VILLAGE_SEED").unwrap_or_default();
        let cultures = ["european-organic", "byzantine-greek", "venetian-lagoon", "hanseatic"];
        let (vw, vh) = (1500.0, 800.0);
        for (name, h, w, roads) in sites() {
            let surface = surface(&h, &w);
            let cols = cultures.len() as f64;
            let mut svg = format!(
                "<svg xmlns='http://www.w3.org/2000/svg' width='{}' height='{}' viewBox='0 0 {} {}'><rect width='100%' height='100%' fill='#efe9d8'/>",
                cols * vw / 2.5, (2.0 * vh + 80.0) / 2.5, cols * vw, 2.0 * vh + 80.0
            );
            for (row, on) in [false, true].into_iter().enumerate() {
                for (col, culture) in cultures.iter().enumerate() {
                    let (ox, oy) = (col as f64 * vw, row as f64 * (vh + 40.0) + 40.0);
                    let (x0, y0) = (1500.0 - vw / 2.0, 1500.0 - vh / 2.0);
                    let tx = |q: Point| format!("{:.1},{:.1}", q.x - x0 + ox, q.y - y0 + oy);
                    svg.push_str(&format!("<clipPath id='c{row}{col}'><rect x='{ox}' y='{oy}' width='{vw}' height='{vh}'/></clipPath><g clip-path='url(#c{row}{col})'>"));
                    // Terrain: water, and slopes above 15 % and 25 %.
                    let cell = W / N as f64;
                    for j in 0..N {
                        for i in 0..N {
                            let (x, y) = (i as f64 * cell, j as f64 * cell);
                            if x + cell < x0 || x > x0 + vw || y + cell < y0 || y > y0 + vh {
                                continue;
                            }
                            let c = p(x + cell * 0.5, y + cell * 0.5);
                            let dx = surface.height_at(p(c.x + 5.0, c.y)) - surface.height_at(p(c.x - 5.0, c.y));
                            let dy = surface.height_at(p(c.x, c.y + 5.0)) - surface.height_at(p(c.x, c.y - 5.0));
                            let grade = dx.hypot(dy) / 10.0;
                            let fill = if w[j * N + i] != 0 {
                                "#7fa7c9"
                            } else if grade > 0.25 {
                                "#b9ab8c"
                            } else if grade > 0.15 {
                                "#d3c8a8"
                            } else {
                                continue;
                            };
                            svg.push_str(&format!("<rect x='{:.1}' y='{:.1}' width='{cell}' height='{cell}' fill='{fill}'/>", x - x0 + ox, y - y0 + oy));
                        }
                    }
                    // `streetFrontage` as on the sheets: it prunes ways that serve no door.
                    let cfg = LayoutConfig { village_streets: on, street_frontage: true, settlement_form: "street-village".into(), ..LayoutConfig::default() };
                    let site = site(culture, &format!("{name}-{col}{seed_suffix}"));
                    let layouts = generate_quarters(&site.key, std::slice::from_ref(&site), &cfg, surface, &roads).unwrap();
                    let parts = generate_parcels(&site.key, &layouts, &ParcelConfig::default()).unwrap();
                    let ring = |r: &[Point]| format!("M{}Z", r.iter().map(|&q| tx(q)).collect::<Vec<_>>().join("L"));
                    for parcel in &parts[0].parcels {
                        let fill = match parcel.use_kind.as_str() {
                            "place" | "green" | "market" => "#b7cf8f",
                            "field" | "garden" | "orchard" => "#d9dcae",
                            _ => "#d8b98a",
                        };
                        svg.push_str(&format!("<path d='{}' fill='{fill}' stroke='#7a6548' stroke-width='0.8'/>", ring(&parcel.shape.outer)));
                    }
                    for b in &layouts[0].blocks {
                        let stroke = if b.kind == "place" { "#3f7a2a" } else { "#4a3524" };
                        svg.push_str(&format!("<path d='{}' fill='none' stroke='{stroke}' stroke-width='2'/>", ring(&b.shape.outer)));
                    }
                    for s in &layouts[0].streets {
                        let color = match s.role.as_str() {
                            "lane" | "track" => "#9a4a2a",
                            "street" => "#c0392b",
                            _ => "#555",
                        };
                        svg.push_str(&format!(
                            "<polyline points='{}' fill='none' stroke='{color}' stroke-width='{:.1}' stroke-linecap='round'/>",
                            s.path.iter().map(|&q| tx(q)).collect::<Vec<_>>().join(" "),
                            s.widths.first().copied().unwrap_or(3.0).max(2.0)
                        ));
                    }
                    let lots = parts[0].parcels.iter().filter(|q| q.use_kind != "place").count();
                    svg.push_str("</g>");
                    svg.push_str(&format!(
                        "<text x='{}' y='{}' font-size='30' font-family='sans-serif'>{name} / {culture} / {} / {} blocks, {lots} parcels</text>",
                        ox + 10.0,
                        oy - 8.0,
                        if on { "villageStreets ON" } else { "before (off)" },
                        layouts[0].blocks.len()
                    ));
                    svg.push_str(&format!("<rect x='{ox}' y='{oy}' width='{vw}' height='{vh}' fill='none' stroke='#333' stroke-width='2'/>"));
                }
            }
            svg.push_str("</svg>");
            std::fs::write(dir.join(format!("{name}.svg")), svg).unwrap();
        }
    }
}
