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

/// Final street crossings share a town-sized catchment; narrow canals can
/// have more footbridges than rivers, but neither gets one per street end.
pub(in crate::urban) fn street_spacing(span: f64, population: u32) -> f64 {
    (80.0 + 4.0 * span + 60.0 * (population as f64 / 1000.0).sqrt()).clamp(100.0, 800.0)
}

/// Demand depends on the town and its occupied banks, not the number of roads
/// that happened to hit water. Short frontages and villages need one crossing.
pub(in crate::urban) fn street_count(population: u32, frontage: f64) -> usize {
    let size = population as f64 / 1000.0;
    (size.sqrt().round() + (frontage / 1500.0).floor())
        .clamp(1.0, size.sqrt().ceil().max(1.0))
        .min(1.0 + (frontage / 200.0).floor()) as usize
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
    // Each cell decides independently which of its two forward neighbours make a bank pair;
    // the marks are merged afterwards (a set union, so order cannot matter).
    let marks = super::super::par::range(n, |i| {
        let (x, y) = (i % grid.nx, i / grid.nx);
        let mut out = [usize::MAX; 4];
        let mut count = 0;
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
                        out[count] = i;
                        out[count + 1] = j;
                        count += 2;
                    }
                }
                (true, false) if surface.wet(q) => {
                    out[count] = i;
                    count += 1;
                }
                (false, true) if surface.wet(p) => {
                    out[count] = j;
                    count += 1;
                }
                _ => {}
            }
        }
        (out, count)
    });
    let mut bank = vec![false; n];
    for (out, count) in marks {
        for &c in &out[..count] {
            bank[c] = true;
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

/// Channel normal from the wet raster/vector mask. A covariance fit over a
/// few channel widths smooths raster stairs without following an oblique road.
pub(in crate::urban) fn deck(surface: Surface<'_>, middle: Point) -> Option<[Point; 2]> {
    deck_at(surface, middle, 2)
}
fn deck_at(surface: Surface<'_>, middle: Point, center_passes: u8) -> Option<[Point; 2]> {
    if !surface.wet(middle) { return None; }
    let cell = surface.width / surface.n as f64;
    let bank = |u: (f64, f64)| -> Option<f64> {
        let at = |t: f64| Point { x: middle.x + u.0 * t, y: middle.y + u.1 * t };
        let landing = (cell * 0.5).clamp(1.0, 4.0);
        let mut from = 0.0;
        while from < 2000.0 {
            let t = flip(surface, middle, u, from, 2000.0, true)?;
            let p = at(t + landing);
            let broad = [-0.5, 0.0, 0.5].iter().all(|&s| !surface.wet(Point { x: p.x - u.1 * landing * s, y: p.y + u.0 * landing * s }));
            if broad && routing::segment_clear(surface, at(t + 0.02), p, f64::INFINITY) { return Some(t); }
            // A raster/vector seam or a tiny island is not a bank landing.
            from = t + 0.02;
            if !surface.wet(at(from)) { from = flip(surface, middle, u, from, 2000.0, false)? + 0.02; }
        }
        None
    };
    let banks = |u: (f64, f64)| -> Option<(f64, f64)> {
        Some((bank((-u.0, -u.1))?, bank(u)?))
    };
    // The shortest chord wins, the first on ties. Both ends are positive, so once the
    // first end alone is longer than the best chord the other cannot matter.
    let mut best: Option<(f64, (f64, f64))> = None;
    for i in 0..36 {
        let angle = i as f64 * std::f64::consts::PI / 36.0;
        let u = (angle.cos(), angle.sin());
        let Some(a) = bank((-u.0, -u.1)) else { continue; };
        if best.is_some_and(|(sum, _)| a > sum) { continue; }
        let Some(b) = bank(u) else { continue; };
        if best.is_none_or(|(sum, _)| (a + b).total_cmp(&sum).is_lt()) { best = Some((a + b, u)); }
    }
    let (shortest, mut normal) = best?;
    let (a, b) = banks(normal)?;
    let center = Point { x: middle.x + normal.0 * (b - a) * 0.5, y: middle.y + normal.1 * (b - a) * 0.5 };
    // Establish the channel width at its centre before choosing a fit window.
    // A chord grazing the inside of a bend must not shrink that window.
    if center_passes > 0 && distance(middle, center) > cell.min(5.0) * 0.1 && surface.wet(center)
        && let Some(ends) = deck_at(surface, center, center_passes - 1) { return Some(ends); }
    // A point beside a bend can have an arbitrarily short grazing chord.
    // Grow the fit until it sees an elongated channel, not just a shore cell.
    let (mut radius, mut best_fit) = ((shortest * 2.0).max(cell * 3.0).clamp(4.0, 600.0), 0.2);
    loop {
        let step = (radius / 24.0).max(0.5);
        let k = (radius / step).ceil() as i32;
        let (mut count, mut sx, mut sy, mut xx, mut xy, mut yy) = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        for y in -k..=k { for x in -k..=k {
            let (dx, dy) = (x as f64 * step, y as f64 * step);
            let p = Point { x: middle.x + dx, y: middle.y + dy };
            if dx.hypot(dy) > radius || p.x < 0.0 || p.y < 0.0 || p.x >= surface.width || p.y >= surface.width || !surface.wet(p) { continue; }
            count += 1.0; sx += dx; sy += dy; xx += dx * dx; xy += dx * dy; yy += dy * dy;
        }}
        if count > 3.0 {
            xx -= sx * sx / count; xy -= sx * sy / count; yy -= sy * sy / count;
            let fit = (xx - yy).hypot(2.0 * xy) / (xx + yy).max(1e-9);
            let flow = 0.5 * (2.0 * xy).atan2(xx - yy); let u = (-flow.sin(), flow.cos());
            if fit > best_fit && banks(u).is_some() { normal = u; best_fit = fit; }
        }
        if best_fit >= 0.7 || radius >= 600.0 { break; }
        radius = (radius * 2.0).min(600.0);
    }
    // Fit the centreline across two widths upstream and downstream. Bank
    // notches can rotate a local shore segment without changing this axis.
    let (a, b) = banks(normal)?;
    let width = (a + b).max(cell);
    let mut centers = vec![];
    for i in -4..=4 {
        let t = i as f64 * width * 0.5;
        let station = Point { x: middle.x - normal.1 * t, y: middle.y + normal.0 * t };
        // Follow the same channel only; do not jump a dry gap into a tributary.
        let step = (width / 48.0).clamp(0.5, 4.0);
        let mut wet = vec![];
        let mut d = -width * 2.0;
        while d <= width * 2.0 {
            let p = Point { x: station.x + normal.0 * d, y: station.y + normal.1 * d };
            if surface.wet(p) { wet.push(d); }
            d += step;
        }
        if wet.len() < 2 { continue; }
        let lo = wet[0]; let hi = *wet.last().unwrap();
        if lo <= -width * 2.0 + step || hi >= width * 2.0 - step { continue; }
        if wet.windows(2).any(|w| w[1] - w[0] > step * 1.5) { continue; }
        let d = (lo + hi) * 0.5;
        centers.push((station.x + normal.0 * d, station.y + normal.1 * d));
    }
    if centers.len() >= 5 {
        let n = centers.len() as f64;
        let (sx, sy) = centers.iter().fold((0.0, 0.0), |(x, y), p| (x + p.0, y + p.1));
        let (xx, xy, yy) = centers.iter().fold((0.0, 0.0, 0.0), |(xx, xy, yy), &(x, y)| {
            let (x, y) = (x - sx / n, y - sy / n); (xx + x*x, xy + x*y, yy + y*y)
        });
        let flow = 0.5 * (2.0 * xy).atan2(xx - yy);
        let u = (-flow.sin(), flow.cos());
        if banks(u).is_some() { normal = u; }
    }
    let (a, b) = banks(normal)?;
    let center = Point { x: middle.x + normal.0 * (b - a) * 0.5, y: middle.y + normal.1 * (b - a) * 0.5 };
    if center_passes > 0 && distance(middle, center) > cell.min(5.0) * 0.1 && surface.wet(center)
        && let Some(ends) = deck_at(surface, center, center_passes - 1) { return Some(ends); }
    // Land beyond the bank's interpolated height ramp, without reaching a
    // neighbouring canal. The approaches must not climb out of the river bed.
    let landing = |t: f64, sign: f64| {
        let at = |extra: f64| Point { x: middle.x + sign * normal.0 * (t + extra), y: middle.y + sign * normal.1 * (t + extra) };
        let mut abutment = (cell * 0.75).clamp(2.0, 20.0).min((shortest * 0.25).max(2.0));
        while abutment > 2.0 && !routing::segment_clear(surface, at(0.02), at(abutment), f64::INFINITY) { abutment = (abutment * 0.5).max(2.0); }
        // The vector bank may lie a few cells inside the raster bed. Put the
        // ramp beyond that height transition, rather than on its steep face.
        let step = (cell * 0.5).clamp(1.0, 4.0);
        let mut best = (f64::INFINITY, abutment);
        let mut extra = abutment;
        while extra <= (cell * 10.0).clamp(abutment, 45.0) {
            if !routing::segment_clear(surface, at(0.02), at(extra + step), f64::INFINITY) { break; }
            let grade = routing::segment_grade(surface, at(extra), at(extra + step));
            if grade < best.0 { best = (grade, extra); }
            if grade <= 0.08 { best.1 = extra; break; }
            extra += step;
        }
        abutment = best.1;
        while abutment > 0.125 && surface.wet(at(abutment)) { abutment *= 0.5; }
        at(abutment)
    };
    let ends = [landing(a, -1.0), landing(b, 1.0)];
    (!surface.wet(ends[0]) && !surface.wet(ends[1])).then_some(ends)
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
    let _profile = routing::Profile::new("crossing_candidates");
    if rules.max_span <= 0.0 {
        return vec![];
    }
    let cells = banks(grid, dry, surface);
    let all: Vec<Crossing> = super::super::par::map(&cells, |_, &i| measure(grid, dry, surface, rules, i))
        .into_iter()
        .flatten()
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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::urban::{LayoutConfig, Site, generate_quarters, geography, geometry as g, network};

    fn street(points: &[(f64, f64)], role: &str) -> Street {
        Street { path: points.iter().map(|&(x, y)| Point { x, y }).collect(),
            widths: vec![6.0; points.len()], rank: 1, role: role.into() }
    }
    fn coverage(streets: &[Street], surface: Surface<'_>) -> usize {
        let mut wet = 0;
        for s in streets {
            for p in s.path.windows(2) {
                let mid = Point { x: (p[0].x + p[1].x) * 0.5, y: (p[0].y + p[1].y) * 0.5 };
                if !surface.wet(mid) || matches!(s.role.as_str(), "quay" | "pier" | "mole" | "landing") { continue; }
                wet += 1;
                assert!(streets.iter().filter(|s| matches!(s.role.as_str(), "bridge" | "causeway")).any(|b|
                    b.path.windows(2).any(|w| g::distance(mid, w[0], w[1]).0 < 0.05)), "unsupported wet street: role={} midpoint={mid:?}", s.role);
            }
        }
        wet
    }

    #[test]
    fn oblique_unflagged_and_nearby_crossings_share_one_normal_deck() {
        let n = 200;
        let water: Vec<u8> = (0..n * n).map(|i| u8::from((90..104).contains(&(i % n)))).collect();
        let height: Vec<f32> = water.iter().map(|&w| if w == 0 { 20.0 } else { 0.0 }).collect();
        let surface = Surface { geometry: None, width: 1000.0, n, height: &height, water: &water };
        let original = [(300.0, 300.0), (700.0, 650.0)];
        let mut streets = vec![street(&original, "regional"), street(&[(320.0, 320.0), (680.0, 660.0)], "bridge")];
        network::bridge_water(&mut streets, surface, 0.12);
        let bridges: Vec<_> = streets.iter().filter(|s| s.role == "bridge").collect();
        assert_eq!(bridges.len(), 1, "{bridges:?}");
        let b = bridges[0];
        assert_eq!(b.path.len(), 2);
        assert!((b.path[1].y - b.path[0].y).abs() < (b.path[1].x - b.path[0].x).abs() * 15.0_f64.to_radians().tan());
        assert!(b.path.iter().all(|&p| !surface.wet(p)));
        assert!(coverage(&streets, surface) > 0);
        assert!(streets.iter().filter(|s| s.role != "bridge").all(|s| routing::path_clear(surface, &s.path, 0.12)));
        for p in original { assert!(streets.iter().any(|s| s.path.contains(&Point { x: p.0, y: p.1 }))); }
        let mut reached = vec![Point { x: original[0].0, y: original[0].1 }];
        loop {
            let before = reached.len();
            for s in &streets {
                if s.path.iter().any(|p| reached.contains(p)) {
                    for &p in &s.path { if !reached.contains(&p) { reached.push(p); } }
                }
            }
            if before == reached.len() { break; }
        }
        assert!(reached.contains(&Point { x: original[1].0, y: original[1].1 }), "bank ramps disconnected the original street");
        let before = streets.iter().filter(|s| s.role == "bridge").count();
        network::bridge_water(&mut streets, surface, 0.12);
        assert_eq!(streets.iter().filter(|s| s.role == "bridge").count(), before);
        coverage(&streets, surface);
    }

    #[test]
    fn thin_vector_canals_get_separate_decks_despite_a_dry_coarse_raster() {
        let n = 20;
        let height = vec![20.0; n * n]; let water = vec![0; n * n];
        let geography = crate::urban::Geography::new(crate::urban::VectorGeography {
            land: vec![g::rectangle(0.0, 0.0, 1000.0, 1000.0).outer],
            water: vec![vec![g::rectangle(500.0, 0.0, 502.0, 1000.0).outer],
                vec![g::rectangle(514.0, 0.0, 516.0, 1000.0).outer]],
        }, 1000.0).unwrap();
        let surface = Surface { geometry: Some(&geography), width: 1000.0, n, height: &height, water: &water };
        let mut streets = vec![street(&[(450.0, 450.0), (570.0, 500.0)], "street")];
        network::bridge_water(&mut streets, surface, 0.12);
        assert_eq!(streets.iter().filter(|s| s.role == "bridge").count(), 2, "parallel canals must not merge across dry land");
        assert!(coverage(&streets, surface) >= 2);
        assert!(streets.iter().filter(|s| s.role != "bridge").all(|s| routing::path_clear(surface, &s.path, 0.12)));
    }

    #[test]
    fn channel_normal_smooths_diagonal_raster_steps() {
        let n = 200;
        let height = vec![20.0; n * n];
        for angle in [0.0_f64, 0.31, 0.78, 1.2] {
            let (nx, ny) = (angle.cos(), angle.sin());
            let water: Vec<u8> = (0..n * n).map(|i| {
                let (x, y) = (((i % n) as f64 + 0.5) * 5.0 - 500.0, ((i / n) as f64 + 0.5) * 5.0 - 500.0);
                u8::from((x * nx + y * ny).abs() < 35.0)
            }).collect();
            let surface = Surface { geometry: None, width: 1000.0, n, height: &height, water: &water };
            let [a, b] = deck(surface, Point { x: 500.0, y: 500.0 }).unwrap();
            let cos = ((b.x - a.x) * nx + (b.y - a.y) * ny).abs() / distance(a, b);
            assert!(cos >= 15.0_f64.to_radians().cos(), "angle={angle}, deck={a:?}/{b:?}");
        }
    }

    #[test]
    fn deck_follows_long_channel_axis_across_short_bank_bends() {
        let n = 400;
        let height = vec![20.0; n*n];
        // Local banks slope by up to 35 degrees. Measure the reference course
        // independently on the analytic centreline over two widths each way.
        let water: Vec<_> = (0..n*n).map(|i| {
            let (x, y) = (((i % n) as f64 + 0.5) * 2.5, ((i / n) as f64 + 0.5) * 2.5);
            u8::from((x - 500.0 - 35.0 * ((y - 500.0) / 50.0).sin()).abs() < 40.0)
        }).collect();
        let surface = Surface { geometry: None, width: 1000.0, n, height: &height, water: &water };
        for y in [450.0, 500.0, 550.0] {
            let x = 500.0 + 35.0 * ((y - 500.0) / 50.0_f64).sin();
            let mut xy = 0.0; let mut yy = 0.0;
            for i in -8..=8 {
                let t = i as f64 * 20.0;
                xy += t * 35.0 * ((y + t - 500.0) / 50.0).sin(); yy += t*t;
            }
            let slope = xy / yy;
            for offset in [-25.0, 0.0, 25.0] {
                let [a, b] = deck(surface, Point { x: x + offset, y }).unwrap();
                let cosine = ((b.x - a.x) - slope * (b.y - a.y)).abs() / (distance(a, b) * 1.0_f64.hypot(slope));
                assert!(cosine >= 15.0_f64.to_radians().cos(), "y={y}, offset={offset}, slope={slope}: {a:?}/{b:?}");
            }
        }
    }

    #[test]
    fn bastide_inside_bend_uses_the_overall_river_course() {
        #[derive(serde::Deserialize)]
        struct Fixture { width: f64, n: usize, geometry: crate::urban::VectorGeography }
        let f: Fixture = serde_json::from_str(include_str!("../fixtures/panic20k.json")).unwrap();
        let geography = crate::urban::Geography::new(f.geometry, f.width).unwrap();
        let height = vec![20.0; f.n*f.n]; let water = vec![0; f.n*f.n];
        let surface = Surface { geometry: Some(&geography), width: f.width, n: f.n, height: &height, water: &water };
        // The reported skewed span grazed the west bank at this bend. The
        // retained map's centreline runs about (90, 200) over the long window,
        // independently measured at y=2000..2240, rather than along that bank.
        let [a, b] = deck(surface, Point { x: 2893.7, y: 2127.2 }).unwrap();
        let cosine = ((b.x - a.x) - 0.45 * (b.y - a.y)).abs() / (distance(a, b) * 1.0_f64.hypot(0.45));
        assert!(cosine >= 15.0_f64.to_radians().cos(), "bastide deck follows local bank: {a:?}/{b:?}");
    }

    fn layout(streets: Vec<Street>, bounds: &[(f64, f64, f64, f64)]) -> crate::urban::Layout {
        let mut l: crate::urban::Layout = serde_json::from_value(serde_json::json!({
            "key":"crossings", "culture":"bastide", "center":{"x":1000.0,"y":1000.0},
            "streets":[], "quarters":[], "blocks":[], "warnings":[]
        })).unwrap();
        l.streets = streets;
        l.blocks = bounds.iter().map(|&(a, b, c, d)| crate::urban::Block {
            shape: g::rectangle(a, b, c, d), quarter: 0, kind: "block".into(),
            axis: Point { x: 1.0, y: 0.0 }, zone: "core".into(), phase: None,
        }).collect();
        l
    }

    #[test]
    fn bridge_count_scales_with_crossing_length_and_population_not_street_count() {
        let n = 200; let height = vec![20.0; n * n];
        let water: Vec<_> = (0..n*n).map(|i| u8::from((98..102).contains(&(i % n)))).collect();
        let surface = Surface { geometry: None, width: 2000.0, n, height: &height, water: &water };
        let mut streets = vec![street(&[(900.0, 100.0), (900.0, 1900.0)], "street"),
            street(&[(1100.0, 100.0), (1100.0, 1900.0)], "street")];
        for y in (100..=1900).step_by(40) {
            let y = y as f64;
            streets.extend([street(&[(900.0, y), (970.0, y)], "street"),
                street(&[(970.0, y), (1030.0, y)], "bridge"),
                street(&[(1030.0, y), (1100.0, y)], "street")]);
        }
        // A main through route wins over neighbouring local crossings.
        streets.iter_mut().filter(|s| s.role == "bridge" && s.path[0].y == 980.0).for_each(|s| s.rank = 0);
        network::join_waterfront(&mut streets, 500.0);
        let original = layout(streets, &[(800.0, 100.0, 890.0, 1900.0), (1110.0, 100.0, 1200.0, 1900.0)]);
        let mut counts = vec![];
        for population in [500, 10000, 50000] {
            let mut l = original.clone();
            network::select_bridges(&mut l, population, surface, &[]);
            let bridges: Vec<_> = l.streets.iter().filter(|s| s.role == "bridge").collect();
            let limit = street_count(population, 1800.0);
            assert_eq!(bridges.len(), limit, "pop={population}");
            assert!(bridges.iter().any(|s| s.rank == 0));
            for (i, a) in bridges.iter().enumerate() { for b in &bridges[i+1..] {
                assert!((a.path[0].y - b.path[0].y).abs() >= 1800.0 / limit as f64 * 0.7);
            }}
            assert_served_ends(&l);
            let before = bridges.len();
            eprintln!("population {population}: {} candidate streets, {before} bridges (limit {limit})", original.streets.iter().filter(|s| s.role == "bridge").count());
            network::select_bridges(&mut l, population, surface, &[]);
            assert_eq!(l.streets.iter().filter(|s| s.role == "bridge").count(), before);
            counts.push(before);
        }
        assert_eq!(counts, [1, 4, 8]);
    }

    fn assert_served_ends(l: &crate::urban::Layout) {
        for b in l.streets.iter().filter(|s| s.role == "bridge") {
            for p in [b.path[0], *b.path.last().unwrap()] {
                assert!(l.streets.iter().filter(|s| s.role != "bridge").any(|s|
                    s.path.contains(&p)), "unconnected bridge end {p:?}");
            }
        }
    }

    fn assert_connected(l: &crate::urban::Layout, points: &[Point]) {
        let mut reached = vec![points[0]];
        loop {
            let before = reached.len();
            for s in &l.streets { if s.path.iter().any(|p| reached.contains(p)) {
                for &p in &s.path { if !reached.contains(&p) { reached.push(p); } }
            }}
            if reached.len() == before { break; }
        }
        for p in points { assert!(reached.contains(p), "unreachable built part {p:?}"); }
    }

    #[test]
    fn built_parts_get_bridges_even_without_an_original_crossing_road() {
        let n = 320; let height = vec![20.0; n*n];
        let water: Vec<_> = (0..n*n).map(|i| u8::from((118..122).contains(&(i % n)) || (198..202).contains(&(i % n)))).collect();
        let surface = Surface { geometry: None, width: 1600.0, n, height: &height, water: &water };
        for population in [500, 10000] {
            for parts in [2, 3] {
                let positions = [550.0, 800.0, 1050.0];
                let streets = positions[..parts].iter().map(|&x| street(&[(x, 600.0), (x, 1000.0)], "street")).collect();
                let blocks: Vec<_> = positions[..parts].iter().map(|&x| (x + 10.0, 600.0, x + 40.0, 1000.0)).collect();
                let mut l = layout(streets, &blocks);
                network::select_bridges(&mut l, population, surface, &[]);
                let bridges = l.streets.iter().filter(|s| s.role == "bridge").count();
                assert!(bridges >= parts - 1, "pop={population}, parts={parts}: {bridges}");
                if population == 500 { assert_eq!(bridges, parts - 1); }
                assert_served_ends(&l);
                // All built parts belong to one street component.
                assert_connected(&l, &positions[..parts].iter().map(|&x| Point { x, y: 600.0 }).collect::<Vec<_>>());
            }
        }
    }

    #[test]
    fn a_nearby_bridge_cannot_hide_a_different_built_part() {
        let n = 200; let height = vec![20.0; n*n];
        let water: Vec<_> = (0..n*n).map(|i| u8::from((98..102).contains(&(i % n)))).collect();
        let surface = Surface { geometry: None, width: 2000.0, n, height: &height, water: &water };
        let streets = vec![street(&[(900.0, 100.0), (900.0, 300.0)], "street"),
            street(&[(1100.0, 120.0), (1100.0, 140.0)], "street"),
            street(&[(1100.0, 180.0), (1100.0, 200.0)], "street")];
        let mut l = layout(streets, &[(810.0, 100.0, 890.0, 300.0),
            (1110.0, 120.0, 1150.0, 140.0), (1110.0, 180.0, 1150.0, 200.0)]);
        network::select_bridges(&mut l, 500, surface, &[]);
        assert!(l.streets.iter().any(|s| s.role == "bridge"));
        assert_connected(&l, &[Point { x: 900.0, y: 100.0 }, Point { x: 1100.0, y: 120.0 }, Point { x: 1100.0, y: 180.0 }]);
        assert_served_ends(&l);
    }

    #[test]
    fn bridge_junctions_preserve_reserved_blocks_street_references() {
        let n = 200; let height = vec![20.0; n*n];
        let water: Vec<_> = (0..n*n).map(|i| u8::from((98..102).contains(&(i % n)))).collect();
        let surface = Surface { geometry: None, width: 2000.0, n, height: &height, water: &water };
        let mut l = layout(vec![street(&[(900.0, 100.0), (900.0, 700.0)], "street"),
            street(&[(1100.0, 100.0), (1100.0, 700.0)], "street")],
            &[(810.0, 100.0, 890.0, 700.0), (1110.0, 100.0, 1200.0, 700.0)]);
        l.programme = Some(serde_json::from_value(serde_json::json!({"version":1,"population":10000,
            "context":{},"cultures":[],"demands":[],"allocations":[],"adjacency":[],"environment":[],
            "reconciliationPasses":0,"warnings":[],"reservations":[{"id":"reserved","demandId":"test",
            "block":1,"shape":l.blocks[1].shape,"street":1,"frontage":600.0}]})).unwrap());
        network::select_bridges(&mut l, 10000, surface, &[]);
        let r = &l.programme.as_ref().unwrap().reservations[0];
        assert!(l.streets[r.street].path.iter().all(|p| (p.x - 1100.0).abs() < 0.01), "reservation lost its bank street");
        assert!(l.streets.iter().any(|s| s.role == "bridge"));
    }

    #[test]
    fn nearby_local_bridge_keeps_a_built_bank_connected_but_not_an_empty_spur() {
        let n = 200; let height = vec![20.0; n*n];
        let water: Vec<_> = (0..n*n).map(|i| u8::from((98..102).contains(&(i % n)))).collect();
        let surface = Surface { geometry: None, width: 2000.0, n, height: &height, water: &water };
        let mut streets = vec![street(&[(900.0, 100.0), (900.0, 500.0)], "street")];
        for y in [150.0, 250.0, 350.0] {
            streets.extend([street(&[(900.0, y), (970.0, y)], "street"),
                street(&[(970.0, y), (1030.0, y)], "bridge"),
                street(&[(1030.0, y), (1100.0, y)], "street")]);
        }
        // The last bank has a tiny approach but no lots or onward road.
        streets.last_mut().unwrap().role = "approach".into();
        // This crossing has no far-bank street at all.
        streets.extend([street(&[(900.0, 450.0), (970.0, 450.0)], "street"),
            street(&[(970.0, 450.0), (1030.0, 450.0)], "bridge")]);
        network::join_waterfront(&mut streets, 500.0);
        let mut l = layout(streets, &[(800.0, 100.0, 890.0, 400.0),
            (1040.0, 160.0, 1100.0, 180.0), (1040.0, 260.0, 1100.0, 280.0)]);
        network::select_bridges(&mut l, 10000, surface, &[]);
        let bridges: Vec<_> = l.streets.iter().filter(|s| s.role == "bridge").collect();
        assert_eq!(bridges.len(), 2, "connect both built streets, drop the empty spur: {bridges:?}");
        assert!(bridges.iter().all(|s| s.path[0].y < 300.0));
        assert_served_ends(&l);
        let mut reached = vec![Point { x: 900.0, y: 100.0 }];
        loop {
            let before = reached.len();
            for s in &l.streets { if s.path.iter().any(|p| reached.contains(p)) {
                for &p in &s.path { if !reached.contains(&p) { reached.push(p); } }
            }}
            if before == reached.len() { break; }
        }
        for y in [150.0, 250.0] { assert!(reached.contains(&Point { x: 1100.0, y })); }
    }

    #[test]
    fn regional_bridge_keeps_its_existing_outward_road_beyond_the_town_clip() {
        let n = 200; let height = vec![20.0; n*n];
        let water: Vec<_> = (0..n*n).map(|i| u8::from((98..102).contains(&(i % n)))).collect();
        let surface = Surface { geometry: None, width: 2000.0, n, height: &height, water: &water };
        let streets = vec![street(&[(900.0, 500.0), (970.0, 500.0)], "street"),
            street(&[(970.0, 500.0), (1030.0, 500.0)], "bridge"),
            street(&[(1030.0, 500.0), (1060.0, 500.0)], "approach")];
        let original = layout(streets, &[(900.0, 510.0, 960.0, 550.0)]);
        let mut empty = original.clone(); network::select_bridges(&mut empty, 10000, surface, &[]);
        assert!(empty.streets.iter().all(|s| s.role != "bridge"));
        let mut l = original;
        network::select_bridges(&mut l, 10000, surface, &[street(&[(1060.0, 500.0), (1600.0, 500.0)], "regional")]);
        assert_eq!(l.streets.iter().filter(|s| s.role == "bridge").count(), 1);
        assert!(l.streets.iter().any(|s| s.role == "regional" && s.path[0] == Point { x: 1060.0, y: 500.0 }));
        assert_served_ends(&l);
    }

    #[test]
    fn crossings_between_the_same_built_banks_share_spacing_around_a_bend() {
        let n = 200; let height = vec![20.0; n*n];
        let water: Vec<_> = (0..n*n).map(|i| {
            let (x, y) = (i % n, i / n);
            u8::from(((98..102).contains(&x) && y < 102) || ((98..102).contains(&y) && x >= 98))
        }).collect();
        let surface = Surface { geometry: None, width: 1000.0, n, height: &height, water: &water };
        let streets = vec![
            street(&[(470.0, 350.0), (450.0, 350.0), (450.0, 550.0), (650.0, 550.0), (650.0, 530.0)], "approach"),
            street(&[(530.0, 350.0), (650.0, 350.0), (650.0, 470.0)], "street"),
            street(&[(470.0, 350.0), (530.0, 350.0)], "bridge"),
            street(&[(650.0, 470.0), (650.0, 530.0)], "bridge"),
        ];
        let mut l = layout(streets, &[(410.0, 350.0, 440.0, 550.0), (550.0, 310.0, 650.0, 340.0)]);
        network::select_bridges(&mut l, 10000, surface, &[]);
        assert_eq!(l.streets.iter().filter(|s| s.role == "bridge").count(), 2, "one size/frontage demand around the bend");
        assert!(l.streets.iter().filter(|s| s.role != "bridge").count() >= 2, "keep both bank streets");
        assert_served_ends(&l);
    }

    #[test]
    fn stilt_planning_mask_does_not_rotate_the_physical_river_normal() {
        let n = 200; let height = vec![20.0; n*n];
        let water: Vec<_> = (0..n*n).map(|i| u8::from((80..120).contains(&(i % n)))).collect();
        // Reclaimed shallows leave an oblique sliver in a straight river.
        let mask: Vec<_> = (0..n*n).map(|i| {
            let (x, y) = ((i % n) as f64 * 5.0, (i / n) as f64 * 5.0);
            u8::from(water[i] != 0 && (x - 500.0 - (y - 500.0) * 0.8).abs() < 25.0)
        }).collect();
        let physical = Surface { geometry: None, width: 1000.0, n, height: &height, water: &water };
        let planning = Surface { water: &mask, ..physical };
        let [p, q] = deck(planning, Point { x: 500.0, y: 500.0 }).unwrap();
        assert!((q.y - p.y).abs() > (q.x - p.x).abs() * 15.0_f64.to_radians().tan(), "fixture must expose the planning-mask rotation");
        let mut streets = vec![street(&[(300.0, 500.0), (700.0, 500.0)], "regional")];
        network::bridge_water_on_ground(&mut streets, planning, physical, 0.12);
        let bridges: Vec<_> = streets.iter().filter(|s| s.role == "bridge").collect();
        assert_eq!(bridges.len(), 1, "{streets:?}");
        let b = bridges[0]; let (a, z) = (b.path[0], *b.path.last().unwrap());
        assert!((z.y - a.y).abs() <= (z.x - a.x).abs() * 15.0_f64.to_radians().tan(), "{b:?}");
        assert!(!physical.wet(a) && !physical.wet(z), "wet physical landing {b:?}");
    }

    #[test]
    fn bank_to_bank_stilt_pier_is_a_normal_crossing_but_a_water_dead_end_is_not() {
        let n = 200; let height = vec![20.0; n*n];
        let water: Vec<_> = (0..n*n).map(|i| u8::from((80..120).contains(&(i % n)))).collect();
        let dry = vec![0; n*n];
        let physical = Surface { geometry: None, width: 1000.0, n, height: &height, water: &water };
        let planning = Surface { water: &dry, ..physical };
        // Shore joints just inside the wet mask still reach dry bank streets.
        let mut streets = vec![street(&[(300.0, 400.0), (400.1, 400.0)], "street"),
            street(&[(400.1, 400.0), (500.0, 450.0), (599.9, 600.0)], "pier"),
            street(&[(599.9, 600.0), (700.0, 600.0)], "street"),
            street(&[(300.0, 700.0), (400.0, 700.0)], "street"),
            street(&[(400.0, 700.0), (450.0, 750.0)], "pier")];
        network::bridge_water_on_ground(&mut streets, planning, physical, 0.12);
        let bridges: Vec<_> = streets.iter().filter(|s| s.role == "bridge").collect();
        assert_eq!(bridges.len(), 1, "{streets:?}");
        let b = bridges[0]; let (a, z) = (b.path[0], *b.path.last().unwrap());
        assert!((z.y - a.y).abs() <= (z.x - a.x).abs() * 15.0_f64.to_radians().tan(), "{b:?}");
        assert!(streets.iter().any(|s| s.role == "pier" && s.path.last() == Some(&Point { x: 450.0, y: 750.0 })));
        let l = layout(streets, &[]); assert_served_ends(&l);
    }

    #[test]
    fn a_retained_normal_bridge_does_not_keep_hundreds_of_metres_of_dry_deck() {
        let n = 200; let height = vec![20.0; n*n];
        let water: Vec<_> = (0..n*n).map(|i| u8::from((90..104).contains(&(i % n)))).collect();
        let surface = Surface { geometry: None, width: 1000.0, n, height: &height, water: &water };
        let mut streets = vec![street(&[(300.0, 500.0), (700.0, 500.0)], "bridge")];
        network::bridge_water(&mut streets, surface, 0.12);
        let bridges: Vec<_> = streets.iter().filter(|s| s.role == "bridge").collect();
        assert_eq!(bridges.len(), 1, "{streets:?}");
        let b = bridges[0];
        assert!(distance(b.path[0], *b.path.last().unwrap()) < 120.0, "dry approaches must be streets: {b:?}");
        for p in [Point { x: 300.0, y: 500.0 }, Point { x: 700.0, y: 500.0 }] {
            assert!(streets.iter().any(|s| s.role != "bridge" && s.path.contains(&p)));
        }
        coverage(&streets, surface);
    }

    #[test]
    fn river_10k_town_keeps_a_few_supported_perpendicular_crossings() {
        let n = 300;
        let height = vec![20.0; n * n];
        let water: Vec<u8> = (0..n * n).map(|i| u8::from((145..152).contains(&(i % n)))).collect();
        let surface = Surface { geometry: None, width: 3000.0, n, height: &height, water: &water };
        let cfg = LayoutConfig { fortification: "none".into(), ..Default::default() };
        let roads = [street(&[(900.0, 1200.0), (2000.0, 1800.0)], "regional")];
        let mut counts = vec![];
        for seed in ["bridge-invariant", "bridge-invariant-2", "bridge-invariant-3"] {
        for culture in ["bagan", "bastide", "elven", "indus-planned", "necropolis", "orcish", "wizard-city", "venetian-lagoon", "stilt-town"] {
        let site = Site { key: "river-10k".into(), name: String::new(), population: 10000,
            culture: culture.into(), center: Point { x: 1380.0, y: 1500.0 }, radius: 450.0 };
        let ground = geography::stilt_ground(&site, culture, surface);
        let transport = ground.as_ref().map_or(surface, |g| g.surface(surface));
        let layout = generate_quarters(seed, &[site], &cfg, surface, &roads).unwrap().remove(0);
        let count = layout.streets.iter().filter(|s| s.role == "bridge").count();
        eprintln!("{seed}/{culture}: {} streets, {count} decks", layout.streets.len());
        assert!((2..=4).contains(&count), "{seed}/{culture}: {count} river bridges");
        counts.push(count);
        coverage(&layout.streets, transport);
        assert!(layout.streets.iter().filter(|s| s.role == "bridge").any(|s|
            s.path.windows(2).any(|w| surface.wet(Point { x: (w[0].x + w[1].x) * 0.5, y: (w[0].y + w[1].y) * 0.5 }))), "no river deck for {culture}");
        for b in layout.streets.iter().filter(|s| s.role == "bridge") {
            let (a, z) = (b.path[0], *b.path.last().unwrap());
            assert!(b.path.iter().all(|&p| g::distance(p, a, z).0 < 0.01), "bent deck {b:?}");
            assert!((z.y - a.y).abs() <= (z.x - a.x).abs() * 15.0_f64.to_radians().tan(), "oblique deck {b:?}");
        }
        }
        }
        assert!(counts.iter().max().unwrap() - counts.iter().min().unwrap() <= 1, "bridge count spread: {counts:?}");
    }

    #[test]
    fn bridge_cleanup_keeps_the_quay_network_connected_to_land_streets() {
        use std::collections::{BTreeMap, BTreeSet};
        let (n, width) = (96, 2800.0);
        let water: Vec<u8> = (0..n*n).map(|i| {
            let x = (i % n) as f64 * width / n as f64;
            let y = (i / n) as f64 * width / n as f64;
            let bank = 1700.0 + 60.0 * (y / 250.0).sin();
            if x >= bank && x < bank + 200.0 { 3 } else { 0 }
        }).collect();
        let height: Vec<f32> = (0..n*n).map(|i| 2.0 + ((i / n) as f64 * width / n as f64 * 0.002) as f32).collect();
        let surface = Surface { geometry: None, width, n, height: &height, water: &water };
        for culture in ["indian-temple", "swahili-stone-town"] {
        let site = Site { key: "port-10k".into(), name: String::new(), population: 10000, culture: culture.into(), center: Point { x: 1500.0, y: 1400.0 }, radius: 480.0 };
        let cfg = LayoutConfig { site_archetypes: BTreeMap::from([("port-10k".into(), "bridge".into())]), ..Default::default() };
        let mut road = street(&[(100.0, 1400.0), (1690.0, 1400.0)], "regional"); road.widths = vec![7.0; 2];
        let roads = [road];
        let l = generate_quarters("port-invariant", &[site], &cfg, surface, &roads).unwrap().remove(0);
        let key = |p: Point| ((p.x * 10000.0).round() as i64, (p.y * 10000.0).round() as i64);
        let mut graph: BTreeMap<_, Vec<_>> = BTreeMap::new();
        for s in &l.streets { for w in s.path.windows(2) {
            graph.entry(key(w[0])).or_default().push(key(w[1])); graph.entry(key(w[1])).or_default().push(key(w[0]));
        }}
        let land: BTreeSet<_> = l.streets.iter().filter(|s| !matches!(s.role.as_str(), "quay" | "pier" | "mole" | "landing")).flat_map(|s| s.path.iter().map(|&p| key(p))).collect();
        for q in l.streets.iter().filter(|s| s.role == "quay") {
            let mut seen = BTreeSet::new(); let mut queue = vec![key(q.path[0])];
            while let Some(p) = queue.pop() { if seen.insert(p) { queue.extend(graph.get(&p).into_iter().flatten().copied()); } }
            assert!(seen.iter().any(|p| land.contains(p)), "isolated quay after bridge cleanup: {:?}", q.path);
        }
        }
    }

    #[test]
    #[ignore = "set BRIDGE_FIXTURE to an offline urban raster fixture"]
    fn real_river_fixture_has_supported_normal_crossings() {
        #[derive(serde::Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct Fixture { seed: String, n: usize, width: f64, height: Vec<f32>, water: Vec<u8>, geometry: Option<crate::urban::VectorGeography>, sites: Vec<Site>, roads: Vec<Street>, layout_config: LayoutConfig }
        let path = std::env::var("BRIDGE_FIXTURE").expect("BRIDGE_FIXTURE");
        let f: Fixture = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        let geography = f.geometry.map(|g| crate::urban::Geography::new(g, f.width).unwrap());
        let surface = Surface { geometry: geography.as_ref(), width: f.width, n: f.n, height: &f.height, water: &f.water };
        let layouts = generate_quarters(&f.seed, &f.sites, &f.layout_config, surface, &f.roads).unwrap();
        if let Some(path) = std::env::var_os("BRIDGE_OUTPUT") {
            std::fs::write(path, serde_json::to_vec(&layouts).unwrap()).unwrap();
        }
        let mut failures = vec![];
        for l in &layouts {
            let site = f.sites.iter().find(|s| s.key == l.key).unwrap();
            let ground = geography::stilt_ground(site, &l.culture, surface);
            coverage(&l.streets, ground.as_ref().map_or(surface, |g| g.surface(surface)));
            let mut count = 0;
            for b in l.streets.iter().filter(|s| s.role == "bridge") {
                let (a, z) = (b.path[0], *b.path.last().unwrap());
                if !b.path.iter().all(|&p| g::distance(p, a, z).0 < 0.05) { failures.push(format!("{} bent deck {b:?}", l.culture)); continue; }
                let wet = routing::water_intervals(surface, a, z).into_iter().map(|(lo, hi)| {
                    let t = (lo + hi) * 0.5;
                    ((hi - lo) * distance(a, z), Point { x: a.x + (z.x - a.x) * t, y: a.y + (z.y - a.y) * t })
                }).max_by(|a, b| a.0.total_cmp(&b.0));
                let Some((_, middle)) = wet else { continue; };
                let Some([p, q]) = deck(surface, middle) else { continue; };
                let cosine = ((z.x - a.x) * (q.x - p.x) + (z.y - a.y) * (q.y - p.y)).abs() / (distance(a, z) * distance(p, q));
                if cosine < 15.0_f64.to_radians().cos() { failures.push(format!("{} oblique deck {b:?}, normal {p:?}/{q:?}", l.culture)); continue; }
                count += 1;
            }
            eprintln!("{}: {count} straight normal decks, wet streets supported", l.culture);
        }
        assert!(failures.is_empty(), "{} crossing failures:\n{}", failures.len(), failures.join("\n"));
    }
}
