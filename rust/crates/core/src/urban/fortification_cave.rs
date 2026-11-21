//! Underdark fortification: in a cave the chamber's rock is the town's enceinte, and the town closes the
//! passages that lead into it. Each passage gets a barrier wall across its narrowest point near the town,
//! anchored in the rock at both ends; the circuit handed to `build` runs along these barriers and closes
//! through the rock between them. `build` then treats the rock runs like any water front (an open passage
//! of the curtain, no wall drawn, abutments where the barrier meets the rock), so the barriers get the
//! curtain, its towers, its gates and gatehouses where a street crosses them, and no wet moat
//! (`Style::cave`). Only a town whose surroundings are mostly solid rock is concerned: a surface town
//! (no solid ground) keeps its circuit unchanged.
use super::*;

/// Grid step (m) of the floor analysis; coarser for a very large town (at most `MAX_SIDE` cells a side).
const CELL: f64 = 4.0;
const MAX_SIDE: f64 = 1200.0;
/// How far beyond the town's edge (m, along the floor) a passage is followed to find its neck.
const REACH: f64 = 90.0;
/// A barrier stands at least this far (m, along the floor) from the town's edge.
const NEAR_EDGE: f64 = 8.0;
/// An opening wider than this (m) is open cave floor, not a passage: no barrier closes it.
const MAX_BARRIER: f64 = 120.0;
/// Share of solid rock round the town's circuit that makes it a cave town.
const ROCK_SHARE: f64 = 0.15;
/// Rock (in cells) kept inside the circuit along the chamber walls.
const ROCK_KEEP: usize = 2;
/// A barrier's ends go this far (m) into the rock.
const ANCHOR: f64 = 2.0;

/// The circuits of a town: unchanged on the surface; in a cave, one circuit closing the passages into
/// the town's floor (`true`), or the traced circuits when the floor cannot be closed that way.
pub(in super::super) fn cave_circuits(walls: Vec<Shape>, surface: Surface<'_>) -> (Vec<Shape>, bool) {
    if walls.is_empty() || !surface.geometry.is_some_and(|g| g.has_solid()) || !rocky(&walls, surface) {
        return (walls, false);
    }
    match chamber_circuit(&walls, surface) {
        Some(ring) => (vec![ring], true),
        None => (walls, false),
    }
}

/// Solid rock on at least `ROCK_SHARE` of a ring 20, 60 or 120 m outside the circuits (a town may
/// leave some floor between its edge and the chamber walls).
fn rocky(walls: &[Shape], surface: Surface<'_>) -> bool {
    [20.0, 60.0, 120.0].iter().any(|&d| {
        let (mut rock, mut all) = (0usize, 0usize);
        for w in walls {
            for grown in buffer(&g::normalized(Shape { outer: w.outer.clone(), holes: vec![] }), d) {
                let r = &grown.outer;
                for i in 0..r.len() {
                    let (a, b) = (r[i], r[(i + 1) % r.len()]);
                    let k = (dist(a, b) / 8.0).ceil().max(1.0) as usize;
                    for j in 0..k {
                        all += 1;
                        rock += usize::from(surface.solid(add(a, dir(a, b), dist(a, b) * j as f64 / k as f64)));
                    }
                }
            }
        }
        all > 0 && rock as f64 >= ROCK_SHARE * all as f64
    })
}

/// A barrier wall across one passage: from rock to rock through its neck.
pub(super) struct Barrier {
    pub a: Point,
    pub b: Point,
}

struct Grid {
    x0: f64,
    y0: f64,
    cell: f64,
    w: usize,
    h: usize,
}
impl Grid {
    fn at(&self, i: usize) -> Point {
        pt(self.x0 + (i % self.w) as f64 * self.cell, self.y0 + (i / self.w) as f64 * self.cell)
    }
    fn index(&self, p: Point) -> Option<usize> {
        let (x, y) = (((p.x - self.x0) / self.cell).round(), ((p.y - self.y0) / self.cell).round());
        (x >= 0.0 && y >= 0.0 && (x as usize) < self.w && (y as usize) < self.h).then(|| y as usize * self.w + x as usize)
    }
    fn border(&self, i: usize) -> bool {
        let (x, y) = (i % self.w, i / self.w);
        x == 0 || y == 0 || x + 1 == self.w || y + 1 == self.h
    }
    fn four(&self, i: usize) -> impl Iterator<Item = usize> + '_ {
        let (x, y) = (i % self.w, i / self.w);
        [(x > 0).then(|| i - 1), (x + 1 < self.w).then(|| i + 1), (y > 0).then(|| i - self.w), (y + 1 < self.h).then(|| i + self.w)]
            .into_iter()
            .flatten()
    }
    fn eight(&self, i: usize) -> impl Iterator<Item = usize> + '_ {
        let (x, y) = ((i % self.w) as i64, (i / self.w) as i64);
        (-1..=1_i64).flat_map(move |dy| (-1..=1_i64).map(move |dx| (dx, dy))).filter_map(move |(dx, dy)| {
            let (u, v) = (x + dx, y + dy);
            ((dx, dy) != (0, 0) && u >= 0 && v >= 0 && (u as usize) < self.w && (v as usize) < self.h)
                .then(|| v as usize * self.w + u as usize)
        })
    }
}

/// Breadth-first steps from `seeds` over the cells `open` allows, up to `limit` steps (and the parent of each).
fn spread(grid: &Grid, seeds: &[usize], open: impl Fn(usize) -> bool, limit: u32) -> (Vec<u32>, Vec<usize>) {
    let mut steps = vec![u32::MAX; grid.w * grid.h];
    let mut parent = vec![usize::MAX; grid.w * grid.h];
    let mut queue = std::collections::VecDeque::new();
    for &s in seeds {
        if steps[s] == u32::MAX {
            steps[s] = 0;
            queue.push_back(s);
        }
    }
    while let Some(i) = queue.pop_front() {
        if steps[i] >= limit {
            continue;
        }
        for j in grid.four(i) {
            if steps[j] == u32::MAX && open(j) {
                steps[j] = steps[i] + 1;
                parent[j] = i;
                queue.push_back(j);
            }
        }
    }
    (steps, parent)
}

/// The barriers closing the floor around `walls`, with the grid analysis, or `None` when a passage
/// cannot be closed (open floor wider than `MAX_BARRIER`, a passage without rock on one side).
fn barriers(walls: &[Shape], surface: Surface<'_>) -> Option<(Vec<Barrier>, Grid, Vec<bool>, Vec<usize>)> {
    let boxes: Vec<Box2> = walls.iter().map(g::bbox).collect();
    let pad = REACH + MAX_BARRIER * 0.5 + 20.0;
    let x0 = boxes.iter().map(|b| b.0).fold(f64::INFINITY, f64::min) - pad;
    let y0 = boxes.iter().map(|b| b.1).fold(f64::INFINITY, f64::min) - pad;
    let x1 = boxes.iter().map(|b| b.2).fold(f64::NEG_INFINITY, f64::max) + pad;
    let y1 = boxes.iter().map(|b| b.3).fold(f64::NEG_INFINITY, f64::max) + pad;
    let cell = CELL.max((x1 - x0).max(y1 - y0) / MAX_SIDE);
    let grid = Grid { x0, y0, cell, w: ((x1 - x0) / cell).ceil() as usize + 1, h: ((y1 - y0) / cell).ceil() as usize + 1 };
    let n = grid.w * grid.h;
    let blocked: Vec<bool> = (0..n).map(|i| surface.wet(grid.at(i))).collect();
    let seeds: Vec<usize> = (0..n)
        .filter(|&i| {
            let p = grid.at(i);
            !blocked[i] && walls.iter().zip(&boxes).any(|(w, b)| p.x >= b.0 && p.x <= b.2 && p.y >= b.1 && p.y <= b.3 && g::contains(w, p))
        })
        .collect();
    if seeds.is_empty() {
        return None;
    }
    let limit = (REACH / cell).ceil() as u32;
    let (steps, parent) = spread(&grid, &seeds, |j| !blocked[j], limit);
    // Width of the floor across `axis` at `c`: from rock to rock, each end `ANCHOR` into the rock.
    let span = |c: Point, axis: V| -> Option<(Point, Point)> {
        let across = (-axis.1, axis.0);
        let side = |sign: f64| -> Option<Point> {
            let mut t = 0.0;
            while t <= MAX_BARRIER {
                let p = add(c, across, sign * t);
                if surface.wet(p) {
                    return Some(add(p, across, sign * ANCHOR));
                }
                t += cell * 0.5;
            }
            None
        };
        Some((side(-1.0)?, side(1.0)?))
    };
    // Every passage still open `REACH` from the town: on the way back from its end, the narrowest
    // section (the nearest to the town of equally narrow ones), at least `NEAR_EDGE` from the town.
    let near = (NEAR_EDGE / cell).ceil() as u32;
    let mut found: Vec<(f64, Point, Point)> = vec![];
    for f in (0..n).filter(|&i| steps[i] == limit) {
        let mut best: Option<(f64, Point, Point)> = None;
        let mut i = f;
        while i != usize::MAX && steps[i] >= near {
            let mut back = i;
            for _ in 0..3 {
                if parent[back] != usize::MAX {
                    back = parent[back];
                }
            }
            if back != i {
                let c = grid.at(i);
                // A section with no rock within reach on a side is open floor: never a neck.
                if let Some((a, b)) = span(c, dir(grid.at(back), c)) {
                    let width = dist(a, b);
                    if best.is_none_or(|x| width <= x.0) {
                        best = Some((width, a, b));
                    }
                }
            }
            i = parent[i];
        }
        found.extend(best);
    }
    // One barrier per passage: the narrowest of the sections found along it.
    found.sort_by(|x, y| x.0.total_cmp(&y.0));
    let mid = |a: Point, b: Point| pt((a.x + b.x) * 0.5, (a.y + b.y) * 0.5);
    let mut out: Vec<Barrier> = vec![];
    for (width, a, b) in found {
        if width > MAX_BARRIER {
            return None;
        }
        let m = mid(a, b);
        if out.iter().all(|k| dist(mid(k.a, k.b), m) > width.max(dist(k.a, k.b)) + 2.0 * cell) {
            out.push(Barrier { a, b });
        }
    }
    Some((out, grid, blocked, seeds))
}

/// The circuit of a cave town: its floor up to the barriers, with `ROCK_KEEP` cells of rock along the
/// chamber walls, traced as one closed outline.
fn chamber_circuit(walls: &[Shape], surface: Surface<'_>) -> Option<Shape> {
    let (barriers, grid, blocked, seeds) = barriers(walls, surface)?;
    if barriers.is_empty() {
        return None;
    }
    let n = grid.w * grid.h;
    // Barrier cells: two cells thick, so no 4-neighbour step slips through a diagonal.
    let mut wall = vec![false; n];
    for bar in &barriers {
        let k = (dist(bar.a, bar.b) / (grid.cell / 3.0)).ceil().max(1.0) as usize;
        for j in 0..=k {
            let p = add(bar.a, dir(bar.a, bar.b), dist(bar.a, bar.b) * j as f64 / k as f64);
            for (dx, dy) in [(0.0, 0.0), (0.5, 0.0), (0.0, 0.5), (0.5, 0.5)] {
                if let Some(i) = grid.index(pt(p.x + dx * grid.cell, p.y + dy * grid.cell)) {
                    wall[i] = true;
                }
            }
        }
    }
    let (inside, _) = spread(&grid, &seeds, |j| !blocked[j] && !wall[j], u32::MAX);
    // A floor reaching the edge of the analysis is not closed: a passage was missed.
    if (0..n).any(|i| inside[i] != u32::MAX && grid.border(i)) {
        return None;
    }
    let mut field = vec![0.0f32; n];
    let mut queue = std::collections::VecDeque::new();
    let mut depth = vec![u32::MAX; n];
    for i in 0..n {
        if inside[i] != u32::MAX || wall[i] {
            field[i] = 1.0;
            depth[i] = 0;
            queue.push_back(i);
        }
    }
    // Rock along the chamber walls, a few cells deep (8-neighbour).
    while let Some(i) = queue.pop_front() {
        if depth[i] >= ROCK_KEEP as u32 {
            continue;
        }
        for j in grid.eight(i) {
            if depth[j] == u32::MAX && blocked[j] {
                depth[j] = depth[i] + 1;
                field[j] = 1.0;
                queue.push_back(j);
            }
        }
    }
    for i in (0..n).filter(|&i| grid.border(i)) {
        field[i] = 0.0;
    }
    let paths = crate::render_geometry::contours::contour_levels(&field, grid.w, grid.h, &[0.5], grid.cell, grid.x0, grid.y0);
    let seed = grid.at(seeds[0]);
    let ring = paths
        .into_iter()
        .flatten()
        .filter(|p| p.closed && p.pts.len() >= 4)
        .map(|p| g::normalized(Shape { outer: p.pts.iter().map(|q| pt(q[0], q[1])).collect(), holes: vec![] }))
        .filter(|s| g::contains(s, seed))
        .max_by(|a, b| g::area(a).total_cmp(&g::area(b)))?;
    let mut r = ring.outer.clone();
    r.push(r[0]);
    let mut r = g::simplify(&r, grid.cell * 0.75, |_| false);
    r.pop();
    let ring = g::normalized(Shape { outer: r, holes: vec![] });
    (ring.outer.len() >= 3 && g::simple(&ring)).then_some(ring)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::urban::{Geography, LayoutConfig, VectorGeography};

    const W: f64 = 2048.0;
    const N: usize = 256;

    fn rect(x0: f64, y0: f64, x1: f64, y1: f64) -> Shape {
        g::rectangle(x0, y0, x1, y1)
    }
    /// A cave: rock everywhere but a chamber (disc of 260 m round the centre) and three passages to the
    /// edge of the map (east, north, south-west), 30 m wide.
    fn cave() -> Geography {
        let chamber = g::normalized(disc(pt(1024.0, 1024.0), 260.0, 48, 0.0));
        let east = rect(1200.0, 1009.0, 2047.0, 1039.0);
        let north = rect(1009.0, 1.0, 1039.0, 850.0);
        let sw = g::normalized(Shape { outer: vec![pt(870.0, 1170.0), pt(1.0, 2000.0), pt(25.0, 2025.0), pt(892.0, 1192.0)], holes: vec![] });
        let floor = g::union(&[chamber, east, north, sw]);
        assert_eq!(floor.len(), 1, "one floor");
        let square = vec![pt(0.0, 0.0), pt(W, 0.0), pt(W, W), pt(0.0, W)];
        let rock = vec![square.clone(), floor[0].outer.clone()];
        Geography::with_solid(VectorGeography { land: vec![square], ..Default::default() }, rock, W).unwrap()
    }
    fn surface<'a>(geometry: Option<&'a Geography>, height: &'a [f32], water: &'a [u8]) -> Surface<'a> {
        Surface { geometry, width: W, n: N, height, water, interpolation: Default::default() }
    }
    fn road(points: &[(f64, f64)]) -> Street {
        Street { key: None, path: points.iter().map(|&(x, y)| pt(x, y)).collect(), widths: vec![6.0; points.len()], rank: 1, role: "regional".into() }
    }

    /// Walls review 16/11 (Underdark): a town in a chamber with three entrances is closed by three
    /// barrier walls anchored on the rock, with a gate on each road entrance and no ring wall.
    #[test]
    fn walls16_cave_town_closes_its_three_passages() {
        let geo = cave();
        let (height, water) = (vec![10.0f32; N * N], vec![0u8; N * N]);
        let s = surface(Some(&geo), &height, &water);
        let town = g::normalized(disc(pt(1024.0, 1024.0), 200.0, 32, 0.0));
        let (circuits, cave) = cave_circuits(vec![town.clone()], s);
        assert!(cave && circuits.len() == 1, "no cave circuit");
        let path = closed(&circuits[0].outer);
        let streets = vec![road(&[(2040.0, 1024.0), (1024.0, 1024.0)]), road(&[(1024.0, 10.0), (1024.0, 1024.0)]), road(&[(13.0, 2012.0), (881.0, 1181.0), (1024.0, 1024.0)])];
        let mut gates = super::super::super::composition::gates(&path, &streets);
        let land = gates.len();
        assert_eq!(land, 3, "one gate per road entrance");
        let banks = super::super::super::composition::water_gates(&path, s);
        for &(p, _) in &banks {
            if gates.iter().all(|&q| dist(p, q) >= 8.0) {
                gates.push(p);
            }
        }
        let mut e = Enclosure { path: path.clone(), kind: "wall".into(), gates, ..Default::default() };
        let mut style = styled("flanked", "duergar-hold", 6_000);
        style.options(&LayoutConfig::default());
        style.cave = true;
        let predicted = Predicted { widths: [9.0, 8.0, 5.0, 3.5, 3.0], arterial: 1, dwelling: [5.0, 5.0] };
        build(&mut e, land, &banks, &streets, s, &style, 6_000, &predicted, &Rng::new("cave-walls"));
        // The built curtain: the dry runs of the circuit outside its rock (shore) passages.
        let dry: Vec<f64> = {
            let mut runs = vec![];
            let mut run = 0.0;
            for w in path.windows(2) {
                let k = (dist(w[0], w[1]) / 2.0).ceil().max(1.0) as usize;
                for j in 0..k {
                    let p = add(w[0], dir(w[0], w[1]), dist(w[0], w[1]) * (j as f64 + 0.5) / k as f64);
                    if s.wet(p) {
                        if run > 0.0 { runs.push(run); }
                        run = 0.0;
                    } else {
                        run += dist(w[0], w[1]) / k as f64;
                    }
                }
            }
            if run > 0.0 { runs.push(run); }
            runs
        };
        assert_eq!(dry.len(), 3, "three barriers: {dry:?}");
        assert!(dry.iter().all(|&l| l < 60.0), "a barrier wider than its passage (a ring wall?): {dry:?}");
        let gatehouses = e.gatehouses.iter().filter(|gh| !matches!(gh.kind.as_str(), "water" | "shore")).count();
        assert_eq!(gatehouses, 3, "a gatehouse on each road entrance");
        assert!(e.ditch.iter().all(|d| d.kind != "wet"), "no wet moat in a cave");
        assert!(e.towers_detail.iter().all(|t| !s.solid(t.center)), "a tower on the rock");
    }

    /// A surface town keeps its circuit unchanged.
    #[test]
    fn walls16_surface_town_keeps_its_circuit() {
        let (height, water) = (vec![10.0f32; N * N], vec![0u8; N * N]);
        let s = surface(None, &height, &water);
        let town = g::normalized(disc(pt(1024.0, 1024.0), 200.0, 32, 0.0));
        let (circuits, cave) = cave_circuits(vec![town.clone()], s);
        assert!(!cave);
        assert_eq!(circuits.len(), 1);
        assert_eq!(circuits[0].outer, town.outer);
    }
}
