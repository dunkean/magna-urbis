//! Urban crossings: a growing town may span a watercourse it was not founded
//! across, when the water is narrower than the span its builders can afford.
//!
//! Candidates are measured on the growth lattice: from each bank cell, the
//! straight crossing over the fewest metres of water (about perpendicular to the
//! flow) that lands on buildable land. Along one watercourse only the narrowest
//! candidate within a spacing that grows with the span survives, and none near
//! an existing regional crossing. Growth then decides which ones the town uses;
//! each used one becomes a street of role `bridge` (or `ford`) at street width.
//! Without a regional or buildable crossing, water stays a boundary.
use super::super::{Point, Street, Surface, routing};
use super::{Grid, distance};
use std::collections::HashMap;

/// Physical and cultural limits of the crossings a town may build.
#[derive(Clone, Copy, Debug)]
pub(super) struct Rules {
    /// Widest water (m) the town can span; zero disables urban crossings.
    pub max_span: f64,
    /// Water up to this width is forded rather than bridged.
    pub ford: f64,
    /// Carriageway width of the crossing street.
    pub width: f64,
    /// Longitudinal grade limit of the bank approaches.
    pub grade: f64,
}

#[derive(Clone, Debug)]
pub(super) struct Crossing {
    /// Lattice cells of the two landings (bank cell centres on the same line).
    pub from: usize,
    pub to: usize,
    /// Water crossed, metres, measured along the crossing line.
    pub span: f64,
    /// Water entry and exit on the crossing line.
    pub entry: Point,
    pub exit: Point,
}
impl Crossing {
    fn middle(&self) -> Point {
        Point {
            x: (self.entry.x + self.exit.x) * 0.5,
            y: (self.entry.y + self.exit.y) * 0.5,
        }
    }
    fn direction(&self) -> (f64, f64) {
        let (dx, dy) = (self.exit.x - self.entry.x, self.exit.y - self.entry.y);
        let l = dx.hypot(dy).max(1e-9);
        (dx / l, dy / l)
    }
    /// Growth cost: bank approaches at land cost, water dearer per metre as the
    /// span widens (piers, arches), so a stream is crossed almost like a lane
    /// and a wide river only by a large town that has run out of near land.
    pub(super) fn cost(&self, grid: &Grid) -> f64 {
        let land =
            distance(grid.point(self.from), self.entry) + distance(self.exit, grid.point(self.to));
        land + self.span * (3.0 + self.span / 20.0)
    }
    /// The crossing as streets: a bank approach on each side (an ordinary
    /// main street that carves blocks) and the span itself, abutment to
    /// abutment, of role `bridge` (or `ford`) at the same width.
    pub(super) fn streets(&self, grid: &Grid, rules: &Rules) -> Vec<Street> {
        let (a, b) = (grid.point(self.from), grid.point(self.to));
        let (ux, uy) = self.direction();
        let abutment = 2.0;
        let start = Point {
            x: self.entry.x - ux * abutment,
            y: self.entry.y - uy * abutment,
        };
        let end = Point {
            x: self.exit.x + ux * abutment,
            y: self.exit.y + uy * abutment,
        };
        let street = |path: Vec<Point>, role: &str| Street {
            widths: vec![rules.width; path.len()],
            path,
            rank: 1,
            role: role.into(),
        };
        let span_role = if self.span <= rules.ford {
            "ford"
        } else {
            "bridge"
        };
        let mut result = vec![];
        if distance(a, start) > 1.0 {
            result.push(street(vec![a, start], "street"));
        }
        result.push(street(vec![start, end], span_role));
        if distance(end, b) > 1.0 {
            result.push(street(vec![end, b], "street"));
        }
        result
    }
}

/// Minimum distance between two crossings of the same watercourse: footbridges
/// over a stream every few hundred metres, a stone bridge over a river about
/// once per kilometre.
pub(super) fn spacing(span: f64) -> f64 {
    (120.0 + 12.0 * span).clamp(150.0, 1500.0)
}

/// Widest span (m) a town of this culture and size builds, and the widest it
/// fords. A village fords or bridges a stream; a 5 000-inhabitant town spans
/// about 25 m; a large city builds multi-arch bridges over rivers of 100 m and more.
pub(in super::super) fn spans(culture: &str, population: u32) -> (f64, f64) {
    let builders = match culture {
        "roman-core" | "chinese" | "venetian-lagoon" | "khmer" | "persian" | "dwarven"
        | "stilt-town" | "wizard-city" | "gnomish" | "korean" | "japanese-jokamachi" => 1.25,
        "nomad-camp" | "native-plains" | "kraal" | "barbarian" | "barbarian-celtic"
        | "barbarian-norse" | "norse-ringfort" | "orcish" | "mississippian"
        | "native-iroquoian" | "myconid-colony" | "sahel" | "yoruba" | "celtic-oppidum"
        | "halfling" | "native-pueblo" => 0.55,
        _ => 1.0,
    };
    let span = (builders * 12.0 * (population as f64 / 1000.0).sqrt()).clamp(0.0, 400.0);
    let ford = if population < 1200 || builders < 1.0 {
        10.0
    } else {
        0.0
    };
    (span, ford)
}

/// Bank cells: buildable cells separated from a 4-neighbour by water, either a
/// wet cell or a watercourse narrower than the lattice running between them.
fn banks(grid: &Grid, dry: &[bool], surface: Surface<'_>) -> Vec<usize> {
    let n = grid.nx * grid.ny;
    let mut bank = vec![false; n];
    for i in 0..n {
        let (x, y) = (i % grid.nx, i / grid.nx);
        for j in [
            (x + 1 < grid.nx).then_some(i + 1),
            (y + 1 < grid.ny).then_some(i + grid.nx),
        ]
        .into_iter()
        .flatten()
        {
            let (p, q) = (grid.point(i), grid.point(j));
            match (dry[i], dry[j]) {
                (true, true) => {
                    if !routing::segment_clear(surface, p, q, f64::INFINITY) {
                        bank[i] = true;
                        bank[j] = true;
                    }
                }
                (true, false) if surface.wet(q) => bank[i] = true,
                (false, true) if surface.wet(p) => bank[j] = true,
                _ => {}
            }
        }
    }
    (0..n).filter(|&i| bank[i]).collect()
}

/// First parameter in (lo, hi] where `wet` flips from `from`, by sampling then
/// bisection. `None` when the state never flips within the interval.
fn flip(
    surface: Surface<'_>,
    p: Point,
    u: (f64, f64),
    lo: f64,
    hi: f64,
    from: bool,
) -> Option<f64> {
    let at = |t: f64| Point {
        x: p.x + u.0 * t,
        y: p.y + u.1 * t,
    };
    let h = (surface.width / surface.n as f64 * 0.2).clamp(0.5, 2.0);
    let mut a = lo;
    while a < hi {
        let b = (a + h).min(hi);
        if surface.wet(at(b)) != from {
            let (mut l, mut r) = (a, b);
            for _ in 0..10 {
                let m = (l + r) * 0.5;
                if surface.wet(at(m)) != from {
                    r = m;
                } else {
                    l = m;
                }
            }
            return Some(r);
        }
        a = b;
    }
    None
}

/// The narrowest admissible crossing from one bank cell over the 16 lattice
/// directions, landing on a buildable cell of the same line.
fn measure(
    grid: &Grid,
    dry: &[bool],
    surface: Surface<'_>,
    rules: &Rules,
    from: usize,
) -> Option<Crossing> {
    const DIRS: [(isize, isize); 16] = [
        (1, 0),
        (2, 1),
        (1, 1),
        (1, 2),
        (0, 1),
        (-1, 2),
        (-1, 1),
        (-2, 1),
        (-1, 0),
        (-2, -1),
        (-1, -1),
        (-1, -2),
        (0, -1),
        (1, -2),
        (1, -1),
        (2, -1),
    ];
    let p = grid.point(from);
    let (fx, fy) = ((from % grid.nx) as isize, (from / grid.nx) as isize);
    let approach = grid.step * 1.6;
    let mut best: Option<(f64, f64, Crossing)> = None;
    for (dx, dy) in DIRS {
        let lattice = grid.step * (dx as f64).hypot(dy as f64);
        let u = (
            dx as f64 * grid.step / lattice,
            dy as f64 * grid.step / lattice,
        );
        let Some(t0) = flip(surface, p, u, 0.0, approach, false) else {
            continue;
        };
        let Some(t1) = flip(surface, p, u, t0, t0 + rules.max_span + 1.0, true) else {
            continue;
        };
        let span = t1 - t0;
        if span > rules.max_span || best.as_ref().is_some_and(|b| b.0 <= span) {
            continue;
        }
        let at = |t: f64| Point {
            x: p.x + u.0 * t,
            y: p.y + u.1 * t,
        };
        let (entry, exit) = (at(t0), at(t1));
        // A real crossing spans a channel: water continues along the flow on
        // both sides of the crossing line. A ray that only clips a bend or a
        // shore corner lands on its own bank and is not a crossing.
        let middle = at((t0 + t1) * 0.5);
        let along = (span.max(grid.step * 0.25)).min(rules.max_span);
        if [(-u.1, u.0), (u.1, -u.0)]
            .iter()
            .any(|&w| flip(surface, middle, w, 0.0, along, true).is_some())
        {
            continue;
        }
        if !routing::segment_clear(surface, p, at((t0 - 0.3).max(0.0)), rules.grade) {
            continue;
        }
        // The landing is the first buildable lattice cell on the line past the
        // water, reached over dry land only (no second channel or island).
        let first = ((t1 + 0.5) / lattice).ceil() as isize;
        let last = ((t1 + approach) / lattice).floor() as isize;
        let landing = (first.max(1)..=last).find_map(|k| {
            let (x, y) = (fx + dx * k, fy + dy * k);
            if x < 0 || y < 0 || x >= grid.nx as isize || y >= grid.ny as isize {
                return None;
            }
            let j = y as usize * grid.nx + x as usize;
            (dry[j] && routing::segment_clear(surface, at(t1 + 0.3), grid.point(j), rules.grade))
                .then_some(j)
        });
        if let Some(to) = landing {
            let length = distance(p, grid.point(to));
            best = Some((
                span,
                length,
                Crossing {
                    from,
                    to,
                    span,
                    entry,
                    exit,
                },
            ));
        }
    }
    best.map(|b| b.2)
}

/// Admissible urban crossings on the lattice, one per narrow point. `fixed`
/// holds the existing regional crossings (entry, exit); urban candidates near a
/// parallel one are dropped, since that crossing already serves the bank.
pub(super) fn candidates(
    grid: &Grid,
    dry: &[bool],
    surface: Surface<'_>,
    rules: &Rules,
    fixed: &[(Point, Point)],
) -> Vec<Crossing> {
    if rules.max_span <= 0.0 {
        return vec![];
    }
    let all: Vec<Crossing> = banks(grid, dry, surface)
        .into_iter()
        .filter_map(|i| measure(grid, dry, surface, rules, i))
        .collect();
    let parallel = |a: (f64, f64), b: (f64, f64)| (a.0 * b.0 + a.1 * b.1).abs() >= 0.5;
    let unit = |a: Point, b: Point| {
        let l = distance(a, b).max(1e-9);
        ((b.x - a.x) / l, (b.y - a.y) / l)
    };
    // Greedy suppression, narrowest first: a candidate is kept unless a kept or
    // regional crossing of the same watercourse (parallel) lies within spacing.
    let bin = spacing(rules.max_span);
    let key = |p: Point| ((p.x / bin).floor() as i64, (p.y / bin).floor() as i64);
    let mut kept: HashMap<(i64, i64), Vec<(Point, (f64, f64), f64)>> = HashMap::new();
    for &(a, b) in fixed {
        let middle = Point {
            x: (a.x + b.x) * 0.5,
            y: (a.y + b.y) * 0.5,
        };
        kept.entry(key(middle))
            .or_default()
            .push((middle, unit(a, b), rules.max_span));
    }
    let mut order: Vec<usize> = (0..all.len()).collect();
    order.sort_by(|&a, &b| all[a].span.total_cmp(&all[b].span).then(a.cmp(&b)));
    let mut result = vec![];
    for i in order {
        let c = &all[i];
        let (m, d) = (c.middle(), c.direction());
        let (kx, ky) = key(m);
        let blocked = (kx - 1..=kx + 1)
            .flat_map(|x| (ky - 1..=ky + 1).map(move |y| (x, y)))
            .filter_map(|k| kept.get(&k))
            .flatten()
            .any(|&(o, od, span)| distance(o, m) < spacing(span.max(c.span)) && parallel(od, d));
        if !blocked {
            kept.entry(key(m)).or_default().push((m, d, c.span));
            result.push(c.clone());
        }
    }
    result
}
