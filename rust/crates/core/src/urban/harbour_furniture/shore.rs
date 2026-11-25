//! Continuous quay bands and their shore furniture.

use super::*;

/// A town's quay ground: one band along the drawn water outline, 4.5 m on
/// the bank and 1 m over the water (m).
const BAND: (f64, f64) = (4.5, 1.0);
/// Parts drawn with the item before them (a boat's cabin, masts and yards, a crane's jib).
const ATTACHED: [&str; 4] = ["cabin", "mast", "yard", "crane-jib"];
/// Farthest a boat floats from the works of its harbour (m).
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

/// A town's quay ground: one band along the drawn water outline of each quay street (`BAND`), and
/// each planner mole as a band of the same width on its own line (mitred corners).
fn quay_band(streets: &[Street], culture: &str, surface: Surface<'_>) -> Vec<Quay> {
    let material = if text(family_of(culture), "material", "auto") == "timber" { "timber" } else { "stone" };
    let level = |points: &[Point]| -> f64 {
        let mut h: Vec<f64> = points.iter().filter(|&&p| surface.wet(p)).map(|&p| surface.height_at(p)).collect();
        if h.is_empty() {
            return f64::NAN;
        }
        h.sort_by(f64::total_cmp);
        h[h.len() / 2]
    };
    let mut ground: Vec<Quay> = vec![];
    // One deck per piece: a run is cut where its water level moves by more
    // than 0.4 m (a descending river), the pieces sharing their ends.
    for run in bank_runs(streets, surface) {
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
            ground.push(Quay { kind: "mole".into(), shape: ccw(outer), deck_z_m: deck, material: material.into() });
            }
        }
    ground
    }

/// A town's harbour on its quay ground: the works and objects of its harbour types (`plan`), laid from
/// the edge of the band. The band is its own edge (no coping stroke); a basin is drawn where it lies
/// wholly on water; a boat floats beside the works or in a basin, never adrift (`BOAT_REACH`).
fn assemble(ground: Vec<Quay>, items: Vec<Quay>, surface: Surface<'_>) -> Vec<Quay> {
    let works: Vec<Shape> =
        ground.iter().chain(items.iter().filter(|q| matches!(q.kind.as_str(), "jetty" | "breakwater" | "steps"))).map(|q| q.shape.clone()).collect();
    let basins: Vec<Shape> = items.iter().filter(|q| q.kind == "basin").map(|q| q.shape.clone()).collect();
    let beside = |p: Point, s: &Shape| {
        let (x0, y0, x1, y1) = bbox(&s.outer);
        p.x > x0 - BOAT_REACH
            && p.x < x1 + BOAT_REACH
            && p.y > y0 - BOAT_REACH
            && p.y < y1 + BOAT_REACH
            && (0..s.outer.len()).any(|i| segment_distance(p, s.outer[i], s.outer[(i + 1) % s.outer.len()]) <= BOAT_REACH)
    };
    let on_water = |s: &Shape| s.outer.iter().all(|&p| surface.wet(p) || ground.iter().any(|q| inside(&q.shape.outer, p)));
    let (mut out, mut kept): (Vec<Quay>, Vec<Quay>) = (vec![], vec![]);
    let mut parent = true;
    for q in items {
        match q.kind.as_str() {
            // A part follows its boat or crane.
            kind if ATTACHED.contains(&kind) => {
        if parent {
            kept.push(q);
        }
    }
            "kerb" => {}
            "basin" => {
                if on_water(&q.shape) {
                    out.push(q);
            }
        }
            "boat" => {
                let c = mean(&q.shape.outer);
                parent = works.iter().any(|s| beside(c, s)) || basins.iter().any(|s| inside(&s.outer, c));
                if parent {
                    kept.push(q);
    }
            }
            _ => {
                parent = true;
                kept.push(q);
            }
        }
    }
    out.extend(ground);
    out.extend(kept);
    out
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
    if cfg.port_type == "bare" {
        let Some(structure) = layout.structure.as_mut() else { return };
        structure.quays.retain(|q| PLATFORM_KINDS.contains(&q.kind.as_str()));
        return;
    }
    // A town: the quay band in place of the planner's platforms, with the
    // works of its harbour types laid from it (jetties in place of the
    // planner's piers and stages, its moles as bands). The quay streets stay
    // (their quarters' port roles read them) and draw as ordinary streets.
    layout.streets.retain(|s| !matches!(s.role.as_str(), "pier" | "landing"));
    let ground = quay_band(&layout.streets, &layout.culture, surface);
    let found = plan(seed, &layout.culture, population, &cfg.port_type, &layout.streets, &ground, surface);
    layout.streets.retain(|s| s.role != "mole");
    let Some(structure) = layout.structure.as_mut() else { return };
    structure.quays = assemble(ground, found.items, surface);
}
