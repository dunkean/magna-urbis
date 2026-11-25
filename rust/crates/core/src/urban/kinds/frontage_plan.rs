//! Linear villages and roadside frontage capacity.

use super::*;

/// Share of its planned area a roadside isolated plot keeps to count whole.
pub(super) const WHOLE_PLOT: f64 = 0.85;
/// How far an isolated mill seeks water from its site (m).
pub(super) const MILL_REACH: f64 = 1000.0;

/// The bank nearest to `p` within `reach`: the first dry point stepping
/// from the nearest water toward `p`, and that direction (inland). None when
/// no water lies within reach.
pub(super) fn bank(surface: &Surface<'_>, p: Point, reach: f64) -> Option<(Point, Point)> {
    let cell = surface.width / surface.n as f64;
    let r = (reach / cell).ceil() as i64;
    let (ci, cj) = ((p.x / cell) as i64, (p.y / cell) as i64);
    let last = surface.n as i64 - 1;
    let mut best: Option<(f64, Point)> = None;
    for j in (cj - r).max(0)..=(cj + r).min(last) {
        for i in (ci - r).max(0)..=(ci + r).min(last) {
            let q = Point {
                x: (i as f64 + 0.5) * cell,
                y: (j as f64 + 0.5) * cell,
            };
            let d = dist(p, q);
            if d <= reach && best.is_none_or(|b| d < b.0) && surface.wet(q) {
                best = Some((d, q));
            }
        }
    }
    let (d, water) = best?;
    let inland = unit(water, p);
    let mut t = 0.0;
    while t <= d {
        let q = at(water, inland, t);
        if !surface.wet(q) {
            return Some((q, inland));
        }
        t += 0.5;
    }
    None
}

/// Plot size of one building: front × depth (m), drawn for the site (`key`).
/// A farm's plot follows its culture's farm type (`farmsteads::plot`). Every other
/// structure draws its area and its proportion round the size of its kind; the
/// peoples who wall a precinct round a lone building (a caravanserai, a temple
/// court) take a larger and squarer plot.
pub(super) fn plot_size(kind: Kind, role: &str, culture: &str, key: &str, rng: &mut Rng) -> (f64, f64) {
    // Ground (m²) and the range of front : depth.
    let (ground, narrow, wide): (f64, f64, f64) = match (kind, role) {
        (_, "isolated-mill") => (1200.0, 0.6, 1.0),
        (_, "isolated-inn") => (1560.0, 0.6, 1.3),
        (_, "isolated-tower") => (730.0, 0.8, 1.2),
        (_, "isolated-shrine") => (320.0, 0.7, 1.15),
        (_, "roadside-temple") => (720.0, 0.65, 1.1),
        (Kind::Single, _) => (950.0, 0.7, 1.1),
        _ => return super::super::farmsteads::plot(culture, &format!("{key}:{}", rng.next_u32())),
    };
    let precinct = matches!(
        super::super::activities::family_of(culture).map_or("", |f| f.0),
        "islamic" | "chinese" | "indian" | "ancient" | "classical" | "mesoamerican" | "andean"
    );
    let ground = ground * rng.range(0.9, 1.35) * if precinct { 1.2 } else { 1.0 };
    let shape = if precinct { rng.range(narrow.max(0.85), wide.max(1.0)) } else { rng.range(narrow, wide) };
    ((ground * shape).sqrt(), (ground / shape).sqrt())
}

pub(super) struct Plan {
    pub(super) blocks: Vec<(Shape, &'static str)>,
    pub(super) streets: Vec<Street>,
    pub(super) center: Point,
    pub(super) axis: Point,
}

/// The road through the place: the nearest road continued at either end by
/// the most collinear road meeting it there, while it is shorter than `need`
/// on that side. Returns the path and the site's station on it.
fn through(roads: &[Street], road: usize, station: f64, need: f64) -> (Vec<Point>, f64) {
    let ordinary = |r: &Street| !matches!(r.role.as_str(), "bridge" | "ford" | "causeway");
    let mut path = roads[road].path.clone();
    let mut station = station;
    let mut used = vec![road];
    for _ in 0..3 {
        let total = *arc(&path).last().unwrap_or(&0.0);
        let mut grown = false;
        for at_start in [true, false] {
            let room = if at_start { station } else { total - station };
            if room >= need * 0.5 || path.len() < 2 {
                continue;
            }
            let (end, inward) = if at_start {
                (path[0], unit(path[1], path[0]))
            } else {
                (
                    path[path.len() - 1],
                    unit(path[path.len() - 2], path[path.len() - 1]),
                )
            };
            // Best continuation: starts or ends at this end, heading on.
            let best = roads
                .iter()
                .enumerate()
                .filter(|(i, r)| !used.contains(i) && ordinary(r) && r.path.len() >= 2)
                .filter_map(|(i, r)| {
                    let (first, last) = (r.path[0], r.path[r.path.len() - 1]);
                    let forward = dist(first, end) < 1.0;
                    if !forward && dist(last, end) >= 1.0 {
                        return None;
                    }
                    let next = if forward {
                        r.path[1]
                    } else {
                        r.path[r.path.len() - 2]
                    };
                    let d = unit(end, next);
                    let straight = d.x * inward.x + d.y * inward.y;
                    (straight > 0.3).then_some((i, forward, straight))
                })
                .max_by(|a, b| a.2.total_cmp(&b.2));
            let Some((i, forward, _)) = best else {
                continue;
            };
            let mut extra = roads[i].path.clone();
            if forward == at_start {
                extra.reverse();
            }
            used.push(i);
            grown = true;
            if at_start {
                // `extra` now ends at `end`.
                let added = *arc(&extra).last().unwrap_or(&0.0);
                extra.pop();
                extra.extend(path);
                path = extra;
                station += added;
            } else {
                path.extend(extra.into_iter().skip(1));
            }
        }
        if !grown {
            break;
        }
    }
    (path, station)
}
/// Start of the `length` window along `path` that keeps the most dry land on
/// both sides at mid-plot depth, nearest the site's `station` when tied (a
/// quarter of the window's length counts like all its land).
fn window(path: &[Point], station: f64, length: f64, depth: f64, surface: &Surface<'_>) -> f64 {
    let total = *arc(path).last().unwrap_or(&0.0);
    let last = (total - length).max(0.0);
    let step = 20.0;
    let count = (total / step).ceil() as usize + 1;
    // One walk along the path, a sample every `step` metres.
    let s = arc(path);
    let mut i = 1;
    let dry: Vec<f64> = (0..count)
        .map(|k| {
            let t = (k as f64 * step).min(total);
            while i + 1 < path.len() && s[i] < t {
                i += 1;
            }
            let d = unit(path[i - 1], path[i]);
            let p = at(path[i - 1], d, t - s[i - 1]);
            let n = perp(d);
            [-1.0, 1.0]
                .iter()
                .filter(|&&side| !surface.wet(at(p, n, side * depth * 0.5)))
                .count() as f64
        })
        .collect();
    // Prefix sums: each window is O(1).
    let mut sum = vec![0.0];
    for v in &dry {
        sum.push(sum.last().unwrap() + v);
    }
    let span = ((length / step).round() as usize).max(1);
    let mut best = ((station - length * 0.5).clamp(0.0, last), f64::MIN);
    let mut k = 0;
    while k as f64 * step <= last + 1e-9 {
        let end = (k + span).min(count);
        let land = (sum[end] - sum[k]) / (2.0 * span as f64);
        let mid = k as f64 * step + length * 0.5;
        let score = land - 0.25 * (mid - station).abs() / length.max(1.0);
        if score > best.1 {
            best = (k as f64 * step, score);
        }
        k += 1;
    }
    best.0
}

/// Homes a village or hamlet asks for: the string's length and its fill
/// target. (One line to switch to the roles rule of homes per household.)
pub(super) fn wanted_homes(culture: &str, population: u32) -> f64 {
    super::super::footprint::capacity::households(culture, population)
}

/// House lots a street village's plan offers, as `parcels` cuts them: a farm
/// plot of a `wholeFarms` culture (up to 3000 m2) is one lot; any other block
/// is cut along the street into whole lots of the plan's module (0.85-1.2 modules).
pub(super) fn linear_homes(plan: &Plan, morph: &Morph, whole_farms: bool) -> f64 {
    let front = morph.range("frontage", "village");
    let module = if front[1] > 0.0 { ((front[0] + front[1]) * 0.5).clamp(12.0, 16.0) } else { 30.0 };
    let lot = module * 1.025;
    let d = plan.axis;
    plan.blocks
        .iter()
        .filter(|(_, k)| *k == "block")
        .map(|(s, _)| {
            if whole_farms && g::area(s) <= 3000.0 {
                return 1.0;
            }
            let (lo, hi) = s.outer.iter().map(|p| p.x * d.x + p.y * d.y).fold((f64::MAX, f64::MIN), |(lo, hi), v| (lo.min(v), hi.max(v)));
            // A farm narrower than two lots stays one (parcels keep its width).
            ((hi - lo) / lot).floor().max(1.0)
        })
        .sum()
}

/// The free stretch of `path` round `station` beside neighbours: 5 m stations
/// whose street point is off their land and margin, with a side free at
/// mid-plot depth. (start, end, frontage): the arc lengths of the run holding
/// the station (else of the nearest run) and its free frontage, both sides.
fn free_stretch(path: &[Point], station: f64, depth: f64, mask: &super::super::neighbours::Mask) -> (f64, f64, f64) {
    let total = *arc(path).last().unwrap_or(&0.0);
    if path.len() < 2 || total <= 0.0 {
        return (0.0, 0.0, 0.0);
    }
    let step = 5.0;
    let count = (total / step).ceil() as usize + 1;
    let sides: Vec<usize> = (0..count)
        .map(|k| {
            let (p, d) = point_at(path, (k as f64 * step).min(total));
            let n = perp(d);
            if mask.blocked(p) { 0 } else { [-1.0, 1.0].iter().filter(|&&s| !mask.blocked(at(p, n, s * depth * 0.5))).count() }
        })
        .collect();
    let k0 = ((station / step).round().max(0.0) as usize).min(count - 1);
    let Some(k) = (0..count).filter(|&k| sides[k] > 0).min_by_key(|&k| k.abs_diff(k0)) else {
        return (station, station, 0.0);
    };
    let (mut a, mut b) = (k, k);
    while a > 0 && sides[a - 1] > 0 {
        a -= 1;
    }
    while b + 1 < count && sides[b + 1] > 0 {
        b += 1;
    }
    (a as f64 * step, (b as f64 * step).min(total), sides[a..=b].iter().sum::<usize>() as f64 * step)
}

/// Beside neighbours, a street village needs a free stretch of its road (or
/// of its own lane through the centre) that fronts all its households: a lot
/// of the middle village module (14 m, `linear` keeps 12-16 m) with its 15 %
/// margin, on either side. Always true without neighbours.
pub(super) fn string_fits(site: &Site, cfg: &LayoutConfig, roads: &[Street]) -> bool {
    let Some(mask) = super::super::neighbours::Mask::of(site) else {
        return true;
    };
    let need = wanted_homes(culture(site, cfg), site.population).ceil() * 14.0 * 1.15;
    let depth = 50.0;
    let (path, station) = match nearest(site.center, roads, 600.0) {
        Some(n) if n.distance < depth + 60.0 => through(roads, n.road, n.station, need),
        near => {
            let d = near.map_or(Point { x: 1.0, y: 0.0 }, |n| n.tangent);
            (vec![at(site.center, d, -need), at(site.center, d, need)], need)
        }
    };
    free_stretch(&path, station, depth, &mask).2 >= need
}

fn varied_side(path: &[Point], half: f64, depth: f64, left: bool, strength: f64, phase: f64) -> Option<Shape> {
    if strength <= 0.0 { return side(path,half,depth,left); }
    let total = *arc(path).last()?;
    let n = (total/45.0).ceil().max(1.0) as usize;
    let mut inner = vec![];
    let mut outer = vec![];
    let sign = if left {1.0} else {-1.0};
    let mut stations = arc(path);
    stations.extend((0..=n).map(|i|total*i as f64/n as f64));
    stations.sort_by(f64::total_cmp);stations.dedup_by(|a,b|(*a-*b).abs()<1e-6);
    for station in stations {
        let (p,d) = point_at(path,station);
        let normal = perp(d);
        let variation = 0.22*(station/83.0+phase).sin()+0.12*(station/37.0+phase*1.7).sin();
        inner.push(at(p,normal,sign*half));
        outer.push(at(p,normal,sign*(half+depth*(1.0+strength*variation))));
    }
    outer.reverse();inner.extend(outer);
    let mut pieces = vec![g::normalized(Shape {outer:inner,holes:vec![]})];
    for road in g::ribbon(path,&[half*2.0]) {
        pieces = pieces.iter().flat_map(|p|g::difference(p,&road)).collect();
    }
    pieces.into_iter().max_by(|a,b|g::area(a).total_cmp(&g::area(b)))
}

/// A single broad bend, keeping the junction and field end fixed. Compare just
/// two mirrored bends on the physical surface: no per-lane routing search.
pub(super) fn field_lane(
    surface: Surface<'_>,
    from: Point,
    to: Point,
    bend: f64,
    grade: f64,
) -> Option<Vec<Point>> {
    let direction = unit(from, to);
    let normal = perp(direction);
    let length = dist(from, to);
    let mut best: Option<(Vec<Point>, f64)> = None;
    for offset in [bend, -bend] {
        let mut path = vec![from];
        for i in 1..4 {
            let t = i as f64 / 4.0;
            let sway = offset * (std::f64::consts::PI * t).sin().powi(2);
            path.push(at(at(from, direction, length * t), normal, sway));
        }
        path.push(to);
        if !routing::path_clear(surface, &path, grade) {
            continue;
        }
        let climb: f64 = path.windows(2)
            .map(|w| (surface.height_at(w[1]) - surface.height_at(w[0])).abs())
            .sum();
        if best.as_ref().is_none_or(|(_, cost)| climb < *cost - 1e-6) {
            best = Some((path, climb));
        }
    }
    best.map(|(path, _)| path).or_else(|| {
        routing::segment_clear(surface, from, to, grade).then(|| vec![from, to])
    })
}

/// Farms or long plots along an axis: the passing road when it is near, else
/// a lane through the site joined to the road by a track. A hamlet places
/// separate farm plots with gaps; a street village continuous strips cut by
/// cross-lanes to the fields, with a green near the middle.
#[allow(clippy::too_many_arguments)]
pub(super) fn linear(
    site: &Site,
    cfg: &LayoutConfig,
    kind: Kind,
    morph: &Morph,
    near: &Option<Near>,
    obstacles: &[Shape],
    road_half: &dyn Fn(&Near) -> f64,
    roads: &[Street],
    surface: Surface<'_>,
    rng: &mut Rng,
    fill: f64,
) -> Option<Plan> {
    let depth = morph.range("plotDepth", "village");
    let village = kind == Kind::StreetVillage;
    // The same cultural household size as programme::prepare, for both
    // frontage length and the number of farms. Explicit oversized hamlets
    // stay bounded by their demographic band, rather than a fixed 30 farms.
    let population = if village { site.population } else {
        site.population.min(demographics::floor("village") - 1)
    };
    let households = wanted_homes(culture(site, cfg), population).ceil();
    // A street village is laid for `fill` times its households (`lay_out`
    // sizes the string to them); a hamlet places one farm per household.
    let homes = if village { households * fill } else { households };
    // Beside neighbours the string keeps to free ground: their land and margin
    // are obstacles, and the road is cut to its free stretch round the site.
    let mask = super::super::neighbours::Mask::of(site);
    // `villageStreets`: the street village is read from its site
    // (`kinds_street_village.rs`), on its own random stream.
    let varied = village && cfg.village_streets;
    let organic = (0.3 + morph.number_or("curvature", 0.5)).clamp(0.3, 1.3);
    let mut module = 30.0;
    let (depth, length) = if village {
        // One farm per household along both sides of the street: the ribbon
        // is as long as their frontages, plus the cross-lanes and the green.
        let front = morph.range("frontage", "village");
        let front = if front[1] > 0.0 {
            // A compact village: house lots, never the town burgage, so the
            // ribbon stays about as long as it is wide in houses.
            ((front[0] + front[1]) * 0.5).clamp(12.0, 16.0)
        } else {
            30.0
        };
        module = front;
        let d = depth[1].clamp(40.0, 90.0);
        // A site-read village leaves gaps and thins at its ends: a longer window.
        let gaps = if varied { 1.35 } else { 1.0 };
        let extra = if varied { 140.0 } else { 60.0 };
        (
            d,
            (homes / 2.0 * front * 1.15 * gaps + extra).clamp(120.0, if varied { 3200.0 } else { 2400.0 }),
        )
    } else {
        let farms = households.max(2.0);
        let d = ((depth[0] + depth[1]) * 0.5).clamp(36.0, 64.0);
        // Room to skip wet or blocked stretches.
        (d, (farms / 2.0).ceil() * 50.0 * 1.6 + 20.0)
    };
    let c = site.center;
    // Axis: the road itself when it passes close, else a local lane.
    let (axis, half, mut streets, along) = match near {
        Some(n) if n.distance < depth + 60.0 => {
            let (road, station) = through(roads, n.road, n.station, length);
            let (road, station) = match &mask {
                Some(mask) => {
                    let (a, b, _) = free_stretch(&road, station, depth, mask);
                    if b - a < 20.0 {
                        return None;
                    }
                    (slice(&road, a, b), (station - a).clamp(0.0, b - a))
                }
                None => (road, station),
            };
            let start = window(&road, station, length, depth, &surface);
            (
                slice(&road, start, start + length),
                road_half(n),
                vec![],
                n.tangent,
            )
        }
        _ => {
            let along = near
                .as_ref()
                .map_or(Point { x: 1.0, y: 0.0 }, |n| n.tangent);
            let a = at(c, along, -length * 0.5);
            let b = at(c, along, length * 0.5);
            let table = super::super::network::town_table(morph, site.population, true);
            let width: f64 = match (cfg.road_width_by_size, village) {
                (true, true) => table[1],
                (true, false) => table[3],
                (false, true) => 5.0,
                (false, false) => 3.5,
            };
            let mut path = match near {
                Some(n) => {
                    let start = if dist(n.point, a) < dist(n.point, b) {
                        a
                    } else {
                        b
                    };
                    let mut p = track(surface, n.point, start, cfg.max_lane_grade);
                    p.push(if start == a { b } else { a });
                    p
                }
                None => vec![a, b],
            };
            path.dedup_by(|p, q| dist(*p, *q) < 1e-6);
            let rank = if village { 2 } else { 3 };
            let role = if village { "street" } else { "lane" };
            let axis = vec![a, b];
            (
                axis,
                width * 0.5,
                vec![street(path, width, rank, role)],
                along,
            )
        }
    };
    let total = *arc(&axis).last().unwrap_or(&0.0);
    if total < 20.0 {
        return None;
    }
    let mut blocked = obstacles.to_vec();
    if mask.is_some() {
        blocked.extend(super::super::neighbours::forbidden(site));
    }
    for s in &streets {
        if s.path.len() > 2 {
            blocked.extend(g::ribbon(&s.path[..s.path.len() - 1], &[s.widths[0]]));
        }
    }
    let mut blocks: Vec<(Shape, &'static str)> = vec![];
    let lane = if cfg.road_width_by_size { super::super::network::town_table(morph, site.population, true)[3] } else { 3.5 };
    if varied {
        let (blocks, lanes, center) = street_village::plan(
            site, cfg, culture(site, cfg), &axis, half, depth, homes * module * 1.15, module, lane,
            organic, &blocked, surface, rng,
        )?;
        streets.extend(lanes);
        return Some(Plan { blocks, streets, center, axis: along });
    }
    if village {
        // Cross-lanes every 110-200 m lead from the street to the fields.
        let mut cuts = vec![];
        let mut variation = rng.fork("v7-linear-variation");
        let mut lanes = rng.fork("street-village-field-lanes");
        let mut s = rng.range(90.0, 160.0);
        while s < total - 60.0 {
            let (p, d) = point_at(&axis, s);
            let n = perp(d);
            // A cross-lane always crosses its strip (`varied_side` deepens it up to 34 %),
            // or the strip is left uncut around a blind lane.
            let reach = half + depth * (1.0 + 0.34 * cfg.ribbon_width_variation) + 10.0;
            for sign in [-1.0, 1.0] {
                let strength = cfg.organic_branch_variation;
                // Modest variation belongs to this form even with default options.
                // Vary the field extension, rather than clamping short lanes to
                // one length; every lane must still cross the widest plot strip.
                let angle = lanes.range(-0.10, 0.10) * (1.0 + strength);
                let normal = Point {
                    x: n.x * angle.cos() - n.y * angle.sin(),
                    y: n.x * angle.sin() + n.y * angle.cos(),
                };
                let run = (reach + lanes.range(-4.0, 18.0) * (1.0 + 0.4 * strength)) / angle.cos();
                let end = at(p, normal, sign * run);
                let bend = lanes.range(1.8, 3.6) * (1.0 + 0.4 * strength)
                    * if lanes.chance(0.5) { -1.0 } else { 1.0 };
                if let Some(path) = field_lane(surface, p, end, bend, cfg.max_lane_grade) {
                    cuts.push(street(path, lane, 3, "lane"));
                }
                // Keep the optional ribbon outline's random stream unchanged.
                if strength > 0.0 {
                    variation.range(-0.20, 0.20);
                    variation.range(-0.30, 0.25);
                }
            }
            s += rng.range(110.0, 200.0);
        }
        let cut_shapes: Vec<Shape> = cuts
            .iter()
            .flat_map(|l| g::ribbon(&l.path, &l.widths))
            .collect();
        // A green (Anger) at the middle of one side, with the church nearby.
        let mid = total * 0.5;
        let green = side(
            &slice(&axis, mid - 32.0, mid + 32.0),
            half,
            depth.min(48.0),
            true,
        );
        for left in [true, false] {
            let phase = if cfg.ribbon_width_variation > 0.0 { variation.range(0.0,std::f64::consts::TAU) } else {0.0};
            let Some(strip) = varied_side(&axis, half, depth, left, cfg.ribbon_width_variation, phase) else {
                continue;
            };
            let mut pieces = vec![strip];
            for cut in cut_shapes.iter().chain(green.iter().filter(|_| left)) {
                pieces = pieces.iter().flat_map(|p| g::difference(p, cut)).collect();
            }
            for p in pieces {
                if let Some(p) = settle(&p, &blocked, &surface, 0.5).filter(|p| g::area(p) > 600.0)
                {
                    blocks.push((p, "block"));
                }
            }
        }
        if let Some(green) = green.and_then(|g| settle(&g, &blocked, &surface, 0.5)) {
            blocks.push((green, "place"));
        }
        // A cross-lane serves the plots it cuts: it ends square at the far edge
        // of its last plot, where the fields begin, and one that no plot touches
        // leads nowhere and is dropped. A lane ending in water or on another
        // street keeps its whole course.
        let mut kept: Vec<Street> = vec![];
        for mut cut in cuts {
            let width = cut.widths[0];
            let end = *cut.path.last().unwrap();
            let anchored = surface.wet(end)
                || streets.iter().chain(&kept).any(|s| {
                    s.path.windows(2).any(|w| g::distance(end, w[0], w[1]).0 < s.widths[0] * 0.5 + width)
                });
            if !anchored {
                let Some(trimmed) = street_village::to_last_plot(&cut.path, width * 0.5 + 3.0, &blocks) else {
                    continue;
                };
                cut.path = trimmed;
                cut.widths = vec![width; cut.path.len()];
            }
            kept.push(cut);
        }
        streets.extend(kept);
    } else {
        // Separate farms, alternating sides, with fields between them.
        let farms = households.max(2.0) as usize;
        let mut station = [rng.range(0.0, 15.0), rng.range(10.0, 30.0)];
        // Start the farms around the middle of the axis.
        let spare = (total - (farms as f64 / 2.0).ceil() * 50.0).max(0.0) * 0.5;
        station = station.map(|s| s + spare * 0.6);
        let mut turn = 0usize;
        while blocks.len() < farms && station.iter().any(|&s| s + 28.0 < total) {
            turn += 1;
            let mut left = turn % 2 == 0;
            if station[usize::from(!left)] + 28.0 >= total {
                left = !left;
            }
            let k = usize::from(!left);
            let w = rng.range(28.0, 44.0);
            let d = depth * rng.range(0.85, 1.15);
            if station[k] + w > total {
                station[k] = total;
                continue;
            }
            let sub = slice(&axis, station[k], station[k] + w);
            station[k] += w + if rng.chance(0.3) {
                0.0
            } else {
                rng.range(6.0, 26.0)
            };
            if let Some(p) =
                side(&sub, half, d, left).and_then(|p| settle(&p, &blocked, &surface, 0.6))
            {
                // Plots on a curve must not overlap their neighbours.
                if blocks
                    .iter()
                    .all(|(b, _)| g::intersection(b, &p).iter().map(g::area).sum::<f64>() < 1.0)
                {
                    blocks.push((p, "block"));
                }
            }
        }
    }
    let center = point_at(&axis, total * 0.5).0;
    Some(Plan {
        blocks,
        streets,
        center,
        axis: along,
    })
}
