//! Remote places: rare single sites whose situation is the point. A temple on a summit,
//! a monastery on a cliff ledge, a sanctuary cut at the foot of a rock face, a tower on a
//! crag, a hermitage on a sea stack, a tomb in a gorge, lost ruins deep in a forest or on
//! a marsh island. Each is an [`ActivitySite`] of an `activities.json` template that
//! carries a `remote` block; `remote.situations` and `remote.accesses` are the two
//! vocabularies.
//!
//! Situations are cheap predicates on the planning grid (heights on two rings of eight
//! directions, water, two resource potentials). Candidates come from a bounded jittered
//! grid of probes (48 x 48 at most), each refined on its own neighbourhood, and from the
//! shore cells of the islands on a stride (256 x 256 tests at most); the most
//! dramatic are kept, far from the settlements and from each other, so a region without
//! dramatic ground gets none. The access is drawn per template: `none` leaves the place
//! without any path (it is never routed); a stair, a causeway, a rope bridge or a tunnel
//! is one installation line, and the ordinary trail of the site ends at its far end.
use super::activities::{self as sites, ActivityBuilding, ActivitySite};
use super::countryside::{complete, dry, frame_angle, hash01, nearest};
use super::grid::Fields;
use super::installations::{self, Installation};
use super::{Point, Settlement};
use crate::rng::Rng;
use crate::urban::activities as act;
use std::f64::consts::{FRAC_PI_4, TAU};

fn add(p: Point, d: Point, k: f64) -> Point {
    Point { x: p.x + d.x * k, y: p.y + d.y * k }
}
/// Unit vector of the `k`-th of eight directions.
fn dir8(k: usize) -> Point {
    let a = (k % 8) as f64 * FRAC_PI_4;
    Point { x: a.cos(), y: a.sin() }
}
fn in_map(f: &Fields, p: Point) -> bool {
    p.x >= 0.0 && p.y >= 0.0 && p.x < f.r.width && p.y < f.r.width
}
/// Sea or standing lake water (class 2 at ground level is cavern rock).
fn open_water(f: &Fields, i: usize) -> bool {
    let w = f.r.water[i];
    w == 1 || (w == 2 && f.r.water_level[i] > f.r.height[i])
}
/// Directions (of eight) in which water lies within `reach`; `open`: sea and lakes only.
fn water_sides(f: &Fields, p: Point, reach: f64, open: bool) -> usize {
    let steps = (reach / f.cell).ceil().max(1.0) as usize;
    (0..8)
        .filter(|&k| {
            (1..=steps).any(|s| {
                let q = add(p, dir8(k), (s as f64 * f.cell).min(reach));
                in_map(f, q) && {
                    let i = f.index(q);
                    if open { open_water(f, i) } else { f.r.water[i] != 0 }
                }
            })
        })
        .count()
}
/// Unit vector down the slope at `p`; none on level ground.
fn downhill(f: &Fields, p: Point) -> Option<Point> {
    let s = f.cell.max(5.0);
    let h = |dx: f64, dy: f64| f.height_at(Point { x: p.x + dx, y: p.y + dy });
    let (gx, gy) = (h(s, 0.0) - h(-s, 0.0), h(0.0, s) - h(0.0, -s));
    let g = gx.hypot(gy);
    (g > 0.02 * s).then(|| Point { x: -gx / g, y: -gy / g })
}

/// The ground round a point: rise (+) or drop (-) from it in eight directions, on a near
/// ring (1.5 cells, 60 m at least) and a far ring (3 cells, 180 m at least).
struct Relief {
    near: [f64; 8],
    far: [f64; 8],
    r1: f64,
    r2: f64,
}
fn relief(f: &Fields, p: Point) -> Relief {
    let (r1, r2) = ((1.5 * f.cell).max(60.0), (3.0 * f.cell).max(180.0));
    let h = f.height_at(p);
    let ring = |r: f64| -> [f64; 8] { std::array::from_fn(|k| f.height_at(add(p, dir8(k), r)) - h) };
    Relief { near: ring(r1), far: ring(r2), r1, r2 }
}

/// How far `x` exceeds its threshold: 0 at the threshold, 1 at twice it.
fn over(x: f64, threshold: f64) -> f64 {
    if threshold > 0.0 { (x / threshold - 1.0).clamp(0.0, 1.0) } else { 0.0 }
}
fn best(values: impl Iterator<Item = f64>) -> Option<f64> {
    values.fold(None, |a: Option<f64>, b| Some(a.map_or(b, |a| a.max(b))))
}
fn known(id: &str) -> Option<(&'static str, &'static act::Situation)> {
    act::data().remote.situations.get_key_value(id).map(|(k, s)| (k.as_str(), s))
}

/// The situations a dry point stands in, each with its drama (0 at its thresholds .. 1).
/// `edge`: distance to the edge of the nearest settlement; `potential`: a resource
/// potential (0-1) at a point.
fn situations(f: &Fields, p: Point, edge: f64, potential: &dyn Fn(&str, Point) -> f64) -> Vec<(&'static str, f64)> {
    let i = f.index(p);
    let r = relief(f, p);
    let slope = f.slope[i] as f64;
    let mut out = vec![];
    let wet_near = f.dw[i] <= r.r2;
    // An islet or a sea stack: open water on nearly every side.
    let mut islet = false;
    if let Some((id, s)) = known("islet") {
        if f.dw[i] <= s.at("reach") && water_sides(f, p, s.at("reach"), true) as f64 >= s.at("sides") {
            islet = true;
            out.push((id, (f.hab[i] / s.at("stack").max(1.0)).clamp(0.0, 1.0)));
        }
    }
    // A summit: everything round it is lower; a crag is a summit steep on nearly every side.
    let peak = r.near.iter().chain(&r.far).all(|&d| d < 0.0);
    let mean_drop = -r.far.iter().sum::<f64>() / 8.0;
    if peak && !wet_near {
        if let Some((id, s)) = known("summit") {
            if mean_drop >= s.at("drop") {
                out.push((id, over(mean_drop, s.at("drop"))));
            }
        }
        if let Some((id, s)) = known("crag") {
            let steep = (0..8).filter(|&k| -r.near[k] / r.r1 >= s.at("grade")).count();
            if mean_drop >= s.at("drop") && steep as f64 >= s.at("sides") {
                out.push((id, over(mean_drop, s.at("drop"))));
            }
        }
    }
    if !islet {
        // A ledge or a cliff top: a face falls away on one side; more so with rock above it.
        if !peak {
            if let Some((id, s)) = known("cliff-ledge") {
                let faces = (0..8).filter(|&k| -r.near[k] / r.r1 >= s.at("grade") && -r.far[k] >= s.at("drop"));
                let drama = best(faces.map(|k| 0.7 * over(-r.far[k], s.at("drop")) + if r.near[(k + 4) % 8] / r.r1 >= 0.5 * s.at("grade") { 0.3 } else { 0.0 }));
                if let Some(drama) = drama {
                    out.push((id, drama));
                }
            }
        }
        // The foot of a face: gentle ground, the rock rising at its back.
        if let Some((id, s)) = known("cliff-foot") {
            let faces = (0..8).filter(|&k| r.near[k] / r.r1 >= s.at("grade") && r.far[k] >= s.at("rise") && r.near[(k + 4) % 8].abs() / r.r1 <= s.at("ease"));
            if let Some(drama) = best(faces.map(|k| over(r.far[k], s.at("rise")))) {
                out.push((id, drama));
            }
        }
        // A gorge: the ground rises on two opposite sides and runs on between them.
        if let Some((id, s)) = known("gorge") {
            let walls = (0..4).filter(|&k| r.far[k] >= s.at("rise") && r.far[k + 4] >= s.at("rise") && r.far[(k + 2) % 8].min(r.far[(k + 6) % 8]) < 0.5 * s.at("rise"));
            let river = if f.db[i] <= r.r2 { 0.3 } else { 0.0 };
            if let Some(drama) = best(walls.map(|k| 0.7 * over(r.far[k].min(r.far[k + 4]), s.at("rise")) + river)) {
                out.push((id, drama));
            }
        }
        // A marsh island: low level ground in peat, or with water on several sides.
        if let Some((id, s)) = known("marsh-island") {
            if slope <= s.at("ease") && f.hab[i] <= s.at("above_water") {
                let peat = potential("peat", p);
                let sides = if wet_near { water_sides(f, p, r.r2, false) } else { 0 };
                if peat >= s.at("peat") || sides as f64 >= s.at("sides") {
                    out.push((id, (peat + sides as f64 / 16.0).clamp(0.0, 1.0)));
                }
            }
        }
    }
    // Deep forest: woods here and all round, far from any settlement.
    if let Some((id, s)) = known("deep-forest") {
        let wood = s.at("wood");
        if edge >= s.at("far") && slope <= s.at("ease") && potential("wood", p) >= wood && (0..4).all(|k| potential("wood", add(p, dir8(2 * k), 500.0)) >= 0.8 * wood) {
            out.push((id, (0.5 * over(edge, s.at("far")) + potential("wood", p) - wood).clamp(0.0, 1.0)));
        }
    }
    out
}

/// The top of the rise `p` stands on: up the steepest dry neighbour, eight cells at most.
fn climb(f: &Fields, p: Point) -> Point {
    let n = f.r.n as isize;
    let mut i = f.index(p) as isize;
    for _ in 0..8 {
        let (x, y) = (i % n, i / n);
        let mut top = i;
        for (dx, dy) in [(-1, -1), (0, -1), (1, -1), (-1, 0), (1, 0), (-1, 1), (0, 1), (1, 1)] {
            let (nx, ny) = (x + dx, y + dy);
            if nx < 0 || ny < 0 || nx >= n || ny >= n {
                continue;
            }
            let j = ny * n + nx;
            if f.r.water[j as usize] == 0 && f.r.height[j as usize] > f.r.height[top as usize] {
                top = j;
            }
        }
        if top == i {
            break;
        }
        i = top;
    }
    f.pos(i as usize)
}

struct Candidate {
    score: f64,
    p: Point,
    situation: &'static str,
}

/// Steps down the slope from `from`: the fall line, else the steepest traverse beside it
/// whose grade a stair may take (`max_grade`), until the ground eases under `ease` (an
/// ordinary trail takes over) or `reach` metres are laid. None when the ground is level,
/// when the way down is steeper than a stair or for less than 8 m of fall; a stair that
/// meets water stops on the shore.
fn fall_line(f: &Fields, from: Point, max_grade: f64, reach: f64, ease: f64) -> Option<Vec<Point>> {
    if !dry(f, from) {
        return None;
    }
    let step = (0.5 * f.cell).clamp(8.0, 30.0);
    let top = f.height_at(from);
    let mut line = vec![from];
    let (mut p, mut h, mut run) = (from, top, 0.0);
    while run < reach {
        let Some(down) = downhill(f, p) else { break };
        let mut next: Option<(f64, Point)> = None;
        let mut barred = false;
        for turn in [0.0_f64, 0.5, -0.5, 1.0, -1.0] {
            let (sin, cos) = turn.sin_cos();
            let d = Point { x: down.x * cos - down.y * sin, y: down.x * sin + down.y * cos };
            let q = add(p, d, step);
            if !dry(f, q) {
                continue;
            }
            let fall = h - f.height_at(q);
            if fall / step > max_grade {
                barred = true;
            } else if fall > 0.0 && next.is_none_or(|b| fall > b.0) {
                next = Some((fall, q));
            }
        }
        // No way down: a face too steep for a stair bars it, else this is the bottom or the shore.
        let Some((fall, q)) = next else {
            if barred {
                return None;
            }
            break;
        };
        line.push(q);
        (p, h, run) = (q, h - fall, run + step);
        if fall / step < ease {
            break;
        }
    }
    (top - h >= 8.0).then_some(line)
}

/// The shortest line from `from` across water to other dry ground within `reach`
/// (a causeway, a rope bridge): its own shore, then the far one.
fn span(f: &Fields, from: Point, reach: f64) -> Option<[Point; 2]> {
    let step = (0.5 * f.cell).max(4.0);
    let mut found: Option<(f64, Point, Point)> = None;
    for k in 0..16 {
        let a = k as f64 * TAU / 16.0;
        let d = Point { x: a.cos(), y: a.sin() };
        let (mut shore, mut wet, mut t) = (from, false, step);
        while t <= reach {
            let q = add(from, d, t);
            if !in_map(f, q) {
                break;
            }
            if f.r.water[f.index(q)] != 0 {
                wet = true;
            } else if wet {
                if found.is_none_or(|b| t < b.0) {
                    found = Some((t, shore, q));
                }
                break;
            } else {
                shore = q;
            }
            t += step;
        }
    }
    found.map(|(_, a, b)| [a, b])
}

/// A gallery through the rock: straight down from `from` along `down` to the first
/// ground at least 10 m lower where the slope eases under `ease`, within `reach`.
fn bore(f: &Fields, from: Point, down: Point, reach: f64, ease: f64) -> Option<[Point; 2]> {
    if !dry(f, from) {
        return None;
    }
    let step = (0.5 * f.cell).clamp(8.0, 30.0);
    let top = f.height_at(from);
    let mut t = step;
    while t <= reach {
        let q = add(from, down, t);
        if !dry(f, q) {
            return None;
        }
        let h = f.height_at(q);
        if top - h >= 10.0 && (h - f.height_at(add(q, down, step))) / step < ease {
            return Some([from, q]);
        }
        t += step;
    }
    None
}

/// The template a culture sets in a situation: among the remote templates of that
/// situation it may build, drawn by their weight and the culture's own (`prefer`).
fn template_for(culture: &str, situation: &str, rng: &mut Rng) -> Option<&'static act::Site> {
    let pool: Vec<(&'static act::Site, f64)> = act::data()
        .sites
        .iter()
        .filter_map(|t| {
            let place = t.remote.as_ref()?;
            if !place.situations.iter().any(|s| s == situation) || !sites::culture_ok(&t.only, culture) {
                return None;
            }
            let names: Vec<&str> = t.required.iter().map(|b| sites::resolve(b, culture).filter(|a| act::allowed(culture, a))).collect::<Option<_>>()?;
            if names.is_empty() {
                return None;
            }
            let weight = place.weight * names.iter().map(|a| act::weight(culture, a)).sum::<f64>() / names.len() as f64;
            (weight > 0.0).then_some((t, weight))
        })
        .collect();
    let mut x = rng.float() * pool.iter().map(|p| p.1).sum::<f64>();
    for (t, weight) in &pool {
        if x < *weight {
            return Some(*t);
        }
        x -= weight;
    }
    pool.last().map(|p| p.0)
}

/// The way to a place: the access kinds of its template in a weighted random order, the
/// first one the ground allows. Returns the kind, its line, the point where the ordinary
/// path ends and the class of that path (`none`: no path at all).
fn approach(f: &Fields, t: &act::Site, place: &'static act::RemotePlace, centre: Point, front: Point, up: Point, rng: &mut Rng) -> (&'static str, Option<Installation>, Point, &'static str) {
    let cfg = &act::data().remote;
    let class = if t.access == "trail" { "trail" } else { "track" };
    let mut pool: Vec<(&'static str, f64)> = place.access.iter().map(|(k, w)| (k.as_str(), *w)).collect();
    while !pool.is_empty() {
        let mut x = rng.float() * pool.iter().map(|p| p.1).sum::<f64>();
        let mut k = pool.len() - 1;
        for (i, p) in pool.iter().enumerate() {
            if x < p.1 {
                k = i;
                break;
            }
            x -= p.1;
        }
        let (kind, _) = pool.remove(k);
        let Some(a) = cfg.accesses.get(kind) else { continue };
        let drawn = |points: Vec<Point>| {
            a.installation.as_ref().map(|id| Installation {
                archetype: id.clone(),
                kind: act::archetype(id).and_then(|x| x.ground.clone()).unwrap_or_default(),
                closed: false,
                points,
            })
        };
        match a.line.as_str() {
            "none" => return (kind, None, centre, "none"),
            "path" => return (kind, None, if dry(f, front) { front } else { centre }, class),
            "fall" => {
                if let Some(line) = fall_line(f, front, a.grade, a.reach, cfg.path_grade) {
                    let foot = line[line.len() - 1];
                    return (kind, drawn(line), foot, class);
                }
            }
            "span" => {
                if let Some([shore, landing]) = span(f, centre, a.reach) {
                    return (kind, drawn(vec![shore, landing]), landing, class);
                }
            }
            "bore" => {
                if let Some([mouth, exit]) = bore(f, front, Point { x: -up.x, y: -up.y }, a.reach, cfg.path_grade) {
                    return (kind, drawn(vec![mouth, exit]), exit, class);
                }
            }
            _ => {}
        }
    }
    ("none", None, centre, "none")
}

/// The place of a candidate: its template, its yard on ground that holds it (the spot,
/// then two rings of eight spots round it; a form takes its whole site, a tighter one or
/// leaves the single body, `act::formed`), in ruins for its share, and its access.
fn build(seed: &str, s: &Settlement, c: &Candidate, f: &Fields) -> Option<ActivitySite> {
    let culture = s.spec.culture.as_str();
    let anchor = format!("remote-{:.0}-{:.0}", c.p.x, c.p.y);
    let id = format!("activity:{}:{anchor}", s.spec.key);
    let mut rng = Rng::new(&format!("remote:{seed}:{id}"));
    let t = template_for(culture, c.situation, &mut rng)?;
    let place = t.remote.as_ref()?;
    let names = sites::pick(t, culture, usize::from(rng.chance(0.3)), &mut rng);
    // The back against the hill, the front down the slope (towards the parent on level ground).
    let up = downhill(f, c.p).map(|d| Point { x: -d.x, y: -d.y }).unwrap_or_else(|| {
        let d = c.p.distance(s.center).max(1.0);
        Point { x: (c.p.x - s.center.x) / d, y: (c.p.y - s.center.y) / d }
    });
    let angle = frame_angle(up);
    // Never over water: every corner of every body is dry.
    let ok = |ring: &[Point]| ring.iter().all(|&q| dry(f, q));
    let shift = (0.5 * f.cell).max(12.0);
    let spots = std::iter::once(c.p).chain((1..=2).flat_map(|ring| (0..8).map(move |k| add(c.p, dir8(k), shift * ring as f64))));
    let mut stood: Option<(Point, Vec<ActivityBuilding>)> = None;
    for (k, at) in spots.enumerate() {
        if !dry(f, at) {
            continue;
        }
        let mut spot_rng = Rng::new(&format!("{id}:spot:{k}"));
        let yard = sites::yard(&id, culture, &names, at, angle, &mut spot_rng, f, &ok);
        if complete(t, culture, &yard) {
            stood = Some((at, yard));
            break;
        }
    }
    let (centre, mut buildings) = stood?;
    let reach = buildings.iter().flat_map(|b| &b.ring).map(|q| (centre.x - q.x) * up.x + (centre.y - q.y) * up.y).fold(0.0, f64::max);
    let front = add(centre, up, -(reach + 4.0));
    if rng.chance(place.ruined) {
        buildings = act::ruined(&id, culture, buildings);
    }
    let (kind, line, access, class) = approach(f, t, place, centre, front, up, &mut rng);
    let mut installations = installations::lay(&sites::allowed_installations(t, culture), &id, centre, &buildings, f, None, &|_| false);
    installations.extend(line);
    Some(ActivitySite {
        template: t.id.clone(),
        mode: "autonomous_external".into(),
        parent: s.spec.key.clone(),
        anchor,
        kind: "remote".into(),
        resource: String::new(),
        culture: culture.into(),
        x: centre.x,
        y: centre.y,
        ground: f.height_at(centre),
        access,
        access_class: class.into(),
        residents: 0,
        season_mask: 0x0fff,
        buildings,
        installations,
        situation: c.situation.into(),
        approach: kind.into(),
        id,
    })
}

/// Remote places of a region: `rate` x sqrt(land / 100 km²) x `frequency` of them (the
/// fraction drawn from the seed, `most` at most), on the most dramatic candidates,
/// `clear` from every settlement, `spacing` apart, `site_gap` from the sites in `taken`.
/// Each belongs to the nearest settlement and is built in its culture.
pub(super) fn places(seed: &str, settlements: &[Settlement], f: &Fields, potential: &dyn Fn(&str, Point) -> f64, taken: &[ActivitySite], frequency: f64) -> Vec<ActivitySite> {
    let cfg = &act::data().remote;
    if settlements.is_empty() || frequency.is_nan() || frequency <= 0.0 {
        return vec![];
    }
    let (w, n) = (f.r.width, f.r.n);
    let land_km2 = f.r.water.iter().filter(|&&v| v == 0).count() as f64 * (w / n as f64).powi(2) / 1e6;
    let expected = cfg.rate * (land_km2 / 100.0).sqrt() * frequency;
    let want = (expected.floor() as usize + usize::from(hash01(&format!("remote:{seed}:count")) < expected.fract())).min(cfg.most);
    if want == 0 {
        return vec![];
    }
    // Probes: one jittered point per cell of a coarse grid, then the top of its rise and
    // eight points round it; the best situation of the lot stands for the cell.
    let step = (w / 48.0).max(3.0 * f.cell).max(200.0);
    let cells = (w / step).floor() as usize;
    let margin = (0.03 * w).max(2.0 * f.cell);
    let mut cands: Vec<Candidate> = vec![];
    for j in 0..cells {
        for i in 0..cells {
            let mut rng = Rng::new(&format!("remote:{seed}:{i}:{j}"));
            let p0 = Point { x: (i as f64 + 0.15 + 0.7 * rng.float()) * step, y: (j as f64 + 0.15 + 0.7 * rng.float()) * step };
            let Some((pi, d0)) = nearest(settlements, p0) else { continue };
            if d0 < cfg.clear - step {
                continue;
            }
            let s = &settlements[pi];
            let mut found: Option<Candidate> = None;
            let round = (0..8).map(|k| add(p0, dir8(k), step / 3.0));
            for q in [p0, climb(f, p0)].into_iter().chain(round) {
                if q.x < margin || q.y < margin || q.x > w - margin || q.y > w - margin || !dry(f, q) {
                    continue;
                }
                let edge = q.distance(s.center) - s.radius;
                if edge < cfg.clear {
                    continue;
                }
                for (id, drama) in situations(f, q, edge, potential) {
                    let score = cfg.situations.get(id).map_or(0.0, |s| s.weight) * (0.5 + drama);
                    if found.as_ref().is_none_or(|b| score > b.score) {
                        found = Some(Candidate { score, p: q, situation: id });
                    }
                }
            }
            if let Some(mut c) = found {
                c.score *= 0.7 + 0.3 * rng.float();
                cands.push(c);
            }
        }
    }
    // An islet is smaller than a probe cell: the shore cells of the land cut off from the
    // mainland (`island`) are read too, on a stride that keeps the pass under 256 x 256 tests.
    if let Some((id, s)) = known("islet") {
        let stride = n.div_ceil(256).max(1);
        for y in (0..n).step_by(stride) {
            for x in (0..n).step_by(stride) {
                let i = y * n + x;
                if !f.island[i] || f.dw[i] > s.at("reach") {
                    continue;
                }
                let q = f.pos(i);
                if q.x < margin || q.y < margin || q.x > w - margin || q.y > w - margin {
                    continue;
                }
                let Some((_, edge)) = nearest(settlements, q) else { continue };
                if edge < cfg.clear {
                    continue;
                }
                if let Some(&(_, drama)) = situations(f, q, edge, potential).iter().find(|c| c.0 == id) {
                    let jitter = 0.7 + 0.3 * hash01(&format!("remote:{seed}:islet:{x}:{y}"));
                    cands.push(Candidate { score: s.weight * (0.5 + drama) * jitter, p: q, situation: id });
                }
            }
        }
    }
    cands.sort_by(|a, b| b.score.total_cmp(&a.score).then(a.p.x.total_cmp(&b.p.x)).then(a.p.y.total_cmp(&b.p.y)));
    let spacing = cfg.spacing.min(w / 4.0);
    let mut out: Vec<ActivitySite> = vec![];
    // A bounded number of yards are tried: ground that refuses them all leaves fewer places.
    let mut tries = 6 * want + 12;
    for c in cands {
        if out.len() >= want || tries == 0 {
            break;
        }
        let at = c.p;
        if out.iter().any(|o| Point { x: o.x, y: o.y }.distance(at) < spacing)
            || taken.iter().any(|t| Point { x: t.x, y: t.y }.distance(at) < cfg.site_gap || t.access.distance(at) < cfg.site_gap)
            || settlements.iter().any(|s| at.distance(s.center) - s.radius < cfg.clear)
        {
            continue;
        }
        let Some((pi, _)) = nearest(settlements, at) else { continue };
        tries -= 1;
        if let Some(site) = build(seed, &settlements[pi], &c, f) {
            out.push(site);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settlements::{Config, Raster, SettlementSpec};

    /// A 6 km region on a 50 m grid: `height` gives the ground, no water.
    fn fields(height: impl Fn(f64, f64) -> f64) -> Fields {
        let (n, width) = (120, 6000.0);
        let cell = width / n as f64;
        let h: Vec<f32> = (0..n * n).map(|i| height((i % n) as f64 * cell + 0.5 * cell, (i / n) as f64 * cell + 0.5 * cell) as f32).collect();
        let (water, rivers, ids) = (vec![0u8; n * n], vec![0.0f32; n * n], vec![-1i32; n * n]);
        Fields::new(Raster { width, n, height: &h, water: &water, water_level: &h, river_width: &rivers, river_ids: &ids })
    }

    /// One village in the south-west corner of the region.
    fn village(f: &Fields) -> crate::settlements::Output {
        let spec = SettlementSpec { key: "village".into(), population: 300, culture: "european-organic".into(), position: Some(Point { x: 1500.0, y: 1500.0 }), ..Default::default() };
        let cfg = Config { mode: "list".into(), list: vec![spec], ..Default::default() };
        let out = crate::settlements::placement::place("remote-test", f, &cfg);
        assert_eq!(out.settlements.len(), 1);
        out
    }

    /// A region with a cliff (a 110 m face along x = 4200..4350) and a summit (a 135 m
    /// cone at 1525, 4525) gets remote places on them, each with a stair, another line or
    /// no path at all; a place without a path is not a road endpoint. A flat region gets
    /// none, and frequency 0 gives none.
    #[test]
    fn dramatic_ground_gets_remote_places_with_a_stair_or_no_path() {
        let f = fields(|x, y| 20.0 + 110.0 * ((x - 4200.0) / 150.0).clamp(0.0, 1.0) + (135.0 - 0.45 * (x - 1525.0).hypot(y - 4525.0)).max(0.0));
        let none = |_: &str, _: Point| 0.0;
        let mut region = village(&f);
        assert!(places("remote-test", &region.settlements, &f, &none, &[], 0.0).is_empty(), "frequency 0 gives none");
        let out = places("remote-test", &region.settlements, &f, &none, &[], 5.0);
        assert!(!out.is_empty(), "no remote place on a cliff and a summit");
        let data = act::data();
        for site in &out {
            assert!(["summit", "crag", "cliff-ledge", "cliff-foot"].contains(&site.situation.as_str()), "{}: situation {}", site.template, site.situation);
            let place = data.sites.iter().find(|t| t.id == site.template).and_then(|t| t.remote.as_ref()).expect("a remote template");
            assert!(place.situations.contains(&site.situation) && place.access.contains_key(&site.approach), "{}: {} by {}", site.template, site.situation, site.approach);
            assert!(!site.buildings.is_empty() && site.buildings.iter().all(|b| b.ring.iter().all(|&q| dry(&f, q))), "{}: nothing stands", site.template);
            assert!(region.settlements.iter().all(|s| Point { x: site.x, y: site.y }.distance(s.center) - s.radius >= data.remote.clear));
            let access = &data.remote.accesses[&site.approach];
            let line = site.installations.iter().find(|i| Some(&i.archetype) == access.installation.as_ref());
            assert_eq!(line.is_some(), access.installation.is_some(), "{}: line of {}", site.template, site.approach);
            assert_eq!(site.access_class == "none", access.line == "none", "{}: path class {}", site.template, site.access_class);
            if access.line == "fall" {
                let line = &line.unwrap().points;
                assert!(line.len() >= 2 && line[line.len() - 1] == site.access, "the trail ends at the foot of the stair");
                for step in line.windows(2) {
                    let (fall, run) = (f.height_at(step[0]) - f.height_at(step[1]), step[0].distance(step[1]));
                    assert!(fall > 0.0 && fall / run <= access.grade + 1e-6, "a stair step of grade {}", fall / run);
                }
            }
        }
        for (i, a) in out.iter().enumerate() {
            assert!(out[i + 1..].iter().all(|b| Point { x: a.x, y: a.y }.distance(Point { x: b.x, y: b.y }) >= 1000.0), "two remote places side by side");
        }
        region.activities = out;
        let routed = region.road_sites();
        assert!(region.activities.iter().all(|a| (a.access_class == "none") != routed.iter().any(|r| r.key == a.id)), "a place without a path is never routed");
        // A stair cut straight down the face from the cliff top: within its grade, to the foot.
        let stair = &data.remote.accesses["cliff-stair"];
        let line = fall_line(&f, Point { x: 4330.0, y: 3000.0 }, stair.grade, stair.reach, data.remote.path_grade).expect("a stair down the cliff");
        assert!(f.height_at(line[0]) - f.height_at(line[line.len() - 1]) > 60.0, "the stair stops on the face");
        // Level ground has no dramatic situation.
        let flat = fields(|_, _| 20.0);
        let plain = village(&flat);
        assert!(places("remote-test", &plain.settlements, &flat, &none, &[], 5.0).is_empty(), "a remote place on a plain");
    }
}
