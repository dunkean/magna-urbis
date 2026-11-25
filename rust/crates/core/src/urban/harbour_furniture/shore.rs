//! Continuous quay bands and their shore furniture.

use super::*;

/// A town's quay ground: one band along the drawn water outline, 4.5 m on
/// the bank and 1 m over the water (m).
const BAND: (f64, f64) = (4.5, 1.0);
/// Width of a pontoon out of the quay band (m).
const PONTOON_WIDTH: f64 = 2.5;
/// Ground shapes the quay band replaces: the planner's platforms and the
/// works of `plan` (the basin stays in a closed port).
const GROUND: [&str; 10] = ["quay", "landing", "pier", "mole", "breakwater", "kerb", "jetty", "slip", "steps", "basin"];
/// Parts drawn with the item before them (a boat's cabin, masts and yards, a crane's jib).
const ATTACHED: [&str; 4] = ["cabin", "mast", "yard", "crane-jib"];
/// Farthest a boat floats from the quay band or a pontoon (m).
const BOAT_REACH: f64 = 15.0;

fn ccw(mut outer: Vec<Point>) -> Shape {
    let k = outer.len();
    let area: f64 = (0..k).map(|i| outer[i].x * outer[(i + 1) % k].y - outer[(i + 1) % k].x * outer[i].y).sum();
    if area < 0.0 {
        outer.reverse();
    }
    Shape { outer, holes: vec![] }
}

fn segment_distance(p: Point, a: Point, b: Point) -> f64 {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let l2 = dx * dx + dy * dy;
    let t = if l2 > 1e-12 { (((p.x - a.x) * dx + (p.y - a.y) * dy) / l2).clamp(0.0, 1.0) } else { 0.0 };
    dist(p, Point { x: a.x + t * dx, y: a.y + t * dy })
}

/// The bank under each quay street: every 2 m along the street, the first
/// drawn water on its water side (the side where more samples find water),
/// with the street's normal towards the water. A run breaks where no water
/// lies within reach, where the bank jumps (more than 6 m) and where an
/// earlier run already lines that bank (within 3 m).
fn bank_runs(streets: &[Street], surface: Surface<'_>) -> Vec<Vec<(Point, Point)>> {
    let mut runs: Vec<Vec<(Point, Point)>> = vec![];
    let mut laid: Vec<Point> = vec![];
    for s in streets.iter().filter(|s| s.role == "quay" && s.path.len() >= 2) {
        let before = runs.len();
        // The planner may set its street back from the drawn water (a coarse raster bank).
        let reach = s.widths.first().copied().unwrap_or(6.0) * 0.5 + 60.0;
        let first_wet = |p: Point, n: Point| (0..=(reach * 2.0) as usize).map(|k| k as f64 * 0.5).find(|&d| surface.wet(add(p, n, d)));
        let mut samples: Vec<(Point, Point)> = vec![];
        for w in s.path.windows(2) {
            let len = dist(w[0], w[1]);
            if len < 1e-6 {
                continue;
            }
            let t = Point { x: (w[1].x - w[0].x) / len, y: (w[1].y - w[0].y) / len };
            let steps = (len / 2.0).ceil() as usize;
            samples.extend((0..steps).map(|k| (add(w[0], t, len * k as f64 / steps as f64), t)));
        }
        if let (Some(&last), Some(&(_, t))) = (s.path.last(), samples.last()) {
            samples.push((last, t));
        }
        let side = |sign: f64, t: Point| Point { x: left(t).x * sign, y: left(t).y * sign };
        let hits = |sign: f64| samples.iter().filter(|(p, t)| first_wet(*p, side(sign, *t)).is_some()).count();
        let sign = if hits(1.0) >= hits(-1.0) { 1.0 } else { -1.0 };
        let mut run: Vec<(Point, Point)> = vec![];
        let mut previous: Option<f64> = None;
        for (p, t) in samples {
            let n = side(sign, t);
            let found = first_wet(p, n).filter(|&d| laid.iter().all(|&m| dist(m, add(p, n, d)) > 3.0));
            match found {
                Some(d) if previous.is_none_or(|e| (d - e).abs() <= 6.0) => run.push((add(p, n, d), n)),
                _ => {
                    if run.len() >= 3 {
                        runs.push(std::mem::take(&mut run));
                    } else {
                        run.clear();
                    }
                    if let Some(d) = found {
                        run.push((add(p, n, d), n));
                    }
                }
            }
            previous = found;
        }
        if run.len() >= 3 {
            runs.push(run);
        }
        for r in &runs[before..] {
            laid.extend(r.iter().map(|(b, _)| *b));
        }
    }
    runs
}

/// A town's harbour ground (the user's model, nothing more): one quay band
/// along the drawn water outline of each quay street (`BAND`), a few straight
/// timber pontoons out of it (one per 4000 people, 1 to 6, shorter than a
/// third of a river), and for the north-european family a closed port: its
/// moles become bands of the same width around the basin. The objects of
/// `items` (boats, cranes, cargo, sheds, posts...) stay, except those that
/// stood over the water on a removed shape, and boats on the band or adrift
/// more than `BOAT_REACH` from it; small craft moor along the pontoons.
#[allow(clippy::too_many_arguments)]
fn quay_band(seed: &str, streets: &[Street], culture: &str, population: u32, family: &str, items: Vec<Quay>, planner: &[Shape], surface: Surface<'_>) -> Vec<Quay> {
    let closed = family == "north-european";
    let material = if text(family_of(culture), "material", "auto") == "timber" { "timber" } else { "stone" };
    let level = |points: &[Point]| -> f64 {
        let mut h: Vec<f64> = points.iter().filter(|&&p| surface.wet(p)).map(|&p| surface.height_at(p)).collect();
        if h.is_empty() {
            return f64::NAN;
        }
        h.sort_by(f64::total_cmp);
        h[h.len() / 2]
    };
    let runs = bank_runs(streets, surface);
    let mut ground: Vec<Quay> = vec![];
    // One deck per piece: a run is cut where its water level moves by more
    // than 0.4 m (a descending river), the pieces sharing their ends.
    for run in &runs {
        let water: Vec<f64> = run.iter().map(|(b, n)| level(&[add(*b, *n, 1.5)])).collect();
        let mut from = 0;
        while from + 1 < run.len() {
            let start = water[from..].iter().copied().find(|h| h.is_finite());
            let mut to = from + 1;
            while to + 1 < run.len() && start.is_none_or(|h0| !water[to].is_finite() || (water[to] - h0).abs() <= 0.4) {
                to += 1;
            }
            let piece = &run[from..=to];
            let deck = level(&piece.iter().map(|(b, n)| add(*b, *n, 1.5)).collect::<Vec<_>>()) + 1.0;
            let mut outer: Vec<Point> = piece.iter().map(|(b, n)| add(*b, *n, BAND.1)).collect();
            outer.extend(piece.iter().rev().map(|(b, n)| add(*b, *n, -BAND.0)));
            if deck.is_finite() {
                ground.push(Quay { kind: "quay".into(), shape: ccw(outer), deck_z_m: deck, material: material.into() });
            }
            from = to;
        }
    }
    // A closed port: each mole a band on its own line (mitred corners).
    if closed {
        let half = (BAND.0 + BAND.1) * 0.5;
        for s in streets.iter().filter(|s| s.role == "mole" && s.path.len() >= 2) {
            let k = s.path.len();
            let normal = |i: usize, j: usize| {
                let l = dist(s.path[i], s.path[j]).max(1e-6);
                left(Point { x: (s.path[j].x - s.path[i].x) / l, y: (s.path[j].y - s.path[i].y) / l })
            };
            let miter = |i: usize| {
                let (a, b) = (normal(i.saturating_sub(1).min(k - 2), i.saturating_sub(1).min(k - 2) + 1), normal(i.min(k - 2), i.min(k - 2) + 1));
                let m = Point { x: a.x + b.x, y: a.y + b.y };
                let m2 = (m.x * m.x + m.y * m.y).max(0.5);
                Point { x: m.x * 2.0 / m2, y: m.y * 2.0 / m2 }
            };
            let mut outer: Vec<Point> = (0..k).map(|i| add(s.path[i], miter(i), half)).collect();
            outer.extend((0..k).rev().map(|i| add(s.path[i], miter(i), -half)));
            let deck = level(&s.path) + 1.0;
            if deck.is_finite() {
                ground.push(Quay { kind: "quay".into(), shape: ccw(outer), deck_z_m: deck, material: material.into() });
            }
        }
    }
    // Pontoons, evenly spaced along the quay banks.
    let banks: Vec<(Point, Point)> = runs.iter().flat_map(|r| r[1..r.len() - 1].iter().copied()).collect();
    let count = ((population as f64 / 4000.0).round() as usize).clamp(1, 6).min(banks.len() / 10);
    let reach = (10.0 + population as f64 / 2500.0).min(30.0);
    let mut pontoons: Vec<Obb> = vec![];
    for k in 0..count {
        let (b, n) = banks[banks.len() * (2 * k + 1) / (2 * count)];
        let mut open = 0.0;
        while open < 300.0 && surface.wet(add(b, n, open + 1.0)) {
            open += 1.0;
        }
        let river = harbour::water_code(surface, add(b, n, 2.0)) == 3;
        let length = reach.min(open * if river { 0.3 } else { 0.6 });
        if length < 5.0 {
            continue;
        }
        let o = Obb { c: add(b, n, length * 0.5), u: n, hl: length * 0.5, hw: PONTOON_WIDTH * 0.5 };
        let deck = level(&[add(b, n, 2.0), add(b, n, length)]) + 1.0;
        if deck.is_finite() {
            ground.push(Quay { kind: "pier".into(), shape: o.shape(), deck_z_m: deck, material: "timber".into() });
            pontoons.push(o);
        }
    }
    // The objects: those over the water on a removed shape go, boats on the
    // new ground or adrift go; a part follows its boat or crane.
    let removed: Vec<Shape> = planner.iter().cloned().chain(items.iter().filter(|q| GROUND.contains(&q.kind.as_str()) && !(closed && q.kind == "basin")).map(|q| q.shape.clone())).collect();
    let on_ground = |p: Point| ground.iter().any(|q| inside(&q.shape.outer, p));
    let basins: Vec<Shape> = if closed { items.iter().filter(|q| q.kind == "basin").map(|q| q.shape.clone()).collect() } else { vec![] };
    let near = |p: Point| {
        banks.iter().any(|(b, _)| dist(*b, p) <= BOAT_REACH)
            || pontoons.iter().any(|o| segment_distance(p, add(o.c, o.u, -o.hl), add(o.c, o.u, o.hl)) <= BOAT_REACH)
            || basins.iter().any(|s| inside(&s.outer, p))
    };
    let mut kept: Vec<Quay> = vec![];
    let mut kept_basins: Vec<Quay> = vec![];
    let mut parent = true;
    for q in items {
        let kind = q.kind.as_str();
        if ATTACHED.contains(&kind) {
            if parent {
                kept.push(q);
            }
            continue;
        }
        if kind == "basin" && closed {
            kept_basins.push(q);
            continue;
        }
        if GROUND.contains(&kind) {
            parent = false;
            continue;
        }
        let c = mean(&q.shape.outer);
        parent = if kind == "boat" {
            !q.shape.outer.iter().any(|&p| on_ground(p)) && near(c)
        } else {
            !(surface.wet(c) && removed.iter().any(|s| inside(&s.outer, c)) && !on_ground(c))
        };
        if parent {
            kept.push(q);
        }
    }
    // Small craft along the pontoons, one on each side when free.
    if let Some((class, length, beam)) = small_craft(culture) {
        let occupied: Vec<Obb> = kept
            .iter()
            .filter(|q| q.kind == "boat")
            .map(|q| {
                let (x0, y0, x1, y1) = bbox(&q.shape.outer);
                Obb { c: Point { x: (x0 + x1) * 0.5, y: (y0 + y1) * 0.5 }, u: Point { x: 1.0, y: 0.0 }, hl: (x1 - x0) * 0.5, hw: (y1 - y0) * 0.5 }
            })
            .collect();
        let mut b = Builder {
            surface,
            platforms: ground.iter().map(|q| (bbox(&q.shape.outer), &q.shape)).collect(),
            solid: vec![],
            occupied,
            items: vec![],
            rng: Rng::new(&format!("{seed}\u{1}harbour-band-v1")),
            stone: material == "stone",
            has_mole: false,
            boats: 0,
            boat_cap: 2 * pontoons.len(),
            posts: 0,
            cargo: 0,
            level_at: None,
        };
        for o in &pontoons {
            if length > o.hl * 2.0 + 2.0 {
                continue;
            }
            for sign in [1.0, -1.0] {
                let c = add(add(o.c, o.u, (o.hl - length * 0.5 - 0.5).max(0.0)), left(o.u), sign * (o.hw + 0.6 + beam * 0.5));
                b.float(class, c, o.u);
            }
        }
        let moored = b.items;
        kept.extend(moored);
    }
    kept_basins.extend(ground);
    kept_basins.extend(kept);
    kept_basins
}

pub(super) fn furnish_shore(seed: &str, layout: &mut Layout, population: u32, cfg: &LayoutConfig, surface: Surface<'_>) {
    let Some(structure) = layout.structure.as_ref() else { return };
    // A dead place: an abandoned or ruined town keeps its bare works (like
    // `port_type: bare`), without boats, cargo or cranes.
    if matches!(cfg.programme.state.as_str(), "abandoned" | "ruined") {
        return;
    }
    // No quay: a river town still lands its boats beside its bridge, an
    // island settlement or a fishing village on its shore.
    if !layout.streets.iter().any(|s| s.role == "quay") {
        if cfg.port_type != "bare" && !structure.quays.iter().any(|q| matches!(q.kind.as_str(), "kerb" | "post" | "slip" | "quay")) && !landing(seed, layout, population, surface) {
            shore_landing(seed, layout, population, cfg, surface);
        }
        return;
    }
    // A village, or any port of a `simple` family (the Underdark): one plain
    // landing, not quays and works. Towns keep their quays.
    if cfg.port_type != "bare" && (population < TOWN_PORT || family_of(&layout.culture)["simple"].as_bool() == Some(true)) {
        simple_landing(seed, layout, population, surface);
        return;
    }
    let found = plan(seed, &layout.culture, population, &cfg.port_type, &layout.streets, &structure.quays, surface);
    if cfg.port_type == "bare" {
        let Some(structure) = layout.structure.as_mut() else { return };
        structure.quays.retain(|q| PLATFORM_KINDS.contains(&q.kind.as_str()));
        return;
    }
    // The quay band in place of the planner's platforms and the works; the
    // quay streets stay (their quarters' port roles read them) and draw as
    // ordinary streets; piers, stages and moles go.
    let planner: Vec<Shape> = structure.quays.iter().filter(|q| PLATFORM_KINDS.contains(&q.kind.as_str())).map(|q| q.shape.clone()).collect();
    let items = quay_band(seed, &layout.streets, &layout.culture, population, found.family, found.items, &planner, surface);
    layout.streets.retain(|s| !matches!(s.role.as_str(), "pier" | "landing" | "mole"));
    let Some(structure) = layout.structure.as_mut() else { return };
    structure.quays = items;
}
