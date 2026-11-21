//! Bridge re-entrant bays and folds while retaining the occupied banks.

#[cfg(test)]
use magna_urbis_geom::simple_around;

use crate::urban::{Point, Shape, Surface, geometry as g, par};
use super::geometry::{area, cross, dir, dist};
use super::style::{data, num};

#[derive(Clone, Copy)]
pub(super) struct PocketLimits {
    depth_span: f64,
    min_depth: f64,
    fold_gap: f64,
}
impl PocketLimits {
    pub(super) fn read() -> Self {
        let v = &data()["invaginations"];
        Self { depth_span: num(v, "maxDepthSpanRatio", 0.4),
            min_depth: num(v, "minDepthM", 12.0), fold_gap: num(v, "foldGapM", 10.0) }
    }
}
pub(super) struct Pocket {
    start: usize,
    end: usize,
    a: Point,
    b: Point,
    length: f64,
}
impl Pocket {
    fn chain(&self, r: &[Point]) -> Vec<Point> {
        let mut chain = vec![self.a];
        chain.extend((1..=(self.end + r.len() - self.start) % r.len())
            .map(|k| r[(self.start + k) % r.len()]));
        chain.push(self.b);
        chain.dedup_by(|a, b| dist(*a, *b) < 1e-7);
        chain
    }
    fn bridge(&self, shape: &Shape) -> Shape {
        let r = &shape.outer;
        let count = (self.end + r.len() - self.start) % r.len();
        let mut outer = vec![];
        for i in 0..r.len() {
            let k = (i + r.len() - self.start) % r.len();
            if k > 0 && k <= count { continue; }
            outer.push(r[i]);
            if i == self.start {
                if dist(r[i], self.a) > 1e-7 { outer.push(self.a); }
                outer.push(self.b);
            }
        }
        outer.dedup_by(|a, b| dist(*a, *b) < 1e-7);
        if outer.len() > 1 && dist(outer[0], *outer.last().unwrap()) < 1e-7 { outer.pop(); }
        Shape { outer, holes: shape.holes.clone() }
    }
}
/// Sides of a simple ring, by exact coordinates: a bridged ring is simple when
/// its new sides are (`simple_around`), which is linear instead of quadratic.
type Sides = std::collections::HashSet<[u64; 4]>;
fn side_key(p: Point, q: Point) -> [u64; 4] { [p.x.to_bits(), p.y.to_bits(), q.x.to_bits(), q.y.to_bits()] }
fn sides(r: &[Point]) -> Sides { (0..r.len()).map(|i| side_key(r[i], r[(i + 1) % r.len()])).collect() }
#[cfg(test)]
fn bridged_simple(next: &Shape, base: Option<&Sides>) -> bool {
    let Some(base) = base else { return g::simple(next) };
    let r = &next.outer;
    let fresh: Vec<usize> = (0..r.len()).filter(|&i| !base.contains(&side_key(r[i], r[(i + 1) % r.len()]))).collect();
    simple_around(r, &fresh)
}
/// The shape test of a pocket: a re-entrant chain, no occupied salient cut
/// off, deep enough (or a narrow fold). Cheap: no bridge is built.
fn pocket_candidate(shape: &Shape, start: usize, end: usize, a: Point, b: Point, limits: PocketLimits, fold: bool) -> Option<Pocket> {
    let mut p = Pocket { start, end, a, b, length: 0.0 };
    let chain = p.chain(&shape.outer);
    let span = dist(a, b);
    if span < 1e-6 || chain.len() < 3 || g::signed(&chain) >= -1e-6 { return None; }
    let u = dir(a, b);
    // A cut may fill a pocket, never cut off an occupied salient.
    if chain.iter().any(|&q| cross(u, (q.x - a.x, q.y - a.y)) < -1e-6) { return None; }
    let depth = chain.iter().map(|&q| g::distance(q, a, b).0).fold(0.0, f64::max);
    p.length = chain.windows(2).map(|w| dist(w[0], w[1])).sum();
    if depth <= limits.min_depth || if fold {
        span >= limits.fold_gap || p.length <= span * 4.0
    } else { depth <= span * limits.depth_span } { return None; }
    Some(p)
}
/// The bridged shape when it is a valid repair: simple and larger.
#[cfg(test)]
fn bridged(shape: &Shape, p: &Pocket, base: Option<&Sides>) -> Option<Shape> {
    let next = p.bridge(shape);
    (next.outer.len() >= 3 && bridged_simple(&next, base) && g::area(&next) > g::area(shape)).then_some(next)
}
#[cfg(test)]
pub(super) fn pockets(shape: &Shape, limits: PocketLimits) -> Vec<Pocket> {
    let base = g::simple(shape).then(|| sides(&shape.outer));
    candidates(shape, limits).into_iter().filter(|p| bridged(shape, p, base.as_ref()).is_some()).collect()
}
/// Every pocket candidate in discovery order (corner pairs, then folds).
fn candidates(shape: &Shape, limits: PocketLimits) -> Vec<Pocket> {
    let r = &shape.outer;
    if r.len() < 4 { return vec![]; }
    let n = r.len();
    // Twice-around prefix of the shoelace terms: the signed area of the chain
    // r[i..=j] closed by its chord in O(1). A chain clearly positive (> 1 m²)
    // is no pocket (it must be below -1e-6): skipped before building it.
    let mut prefix = vec![0.0; 2 * n + 1];
    for k in 0..2 * n {
        let (p, q) = (r[k % n], r[(k + 1) % n]);
        prefix[k + 1] = prefix[k] + (p.x * q.y - q.x * p.y);
    }
    let corners: Vec<_> = (0..n).filter(|&i|
        cross(dir(r[(i + n - 1) % n], r[i]), dir(r[i], r[(i + 1) % n])) >= -1e-8).collect();
    let corners_found = par::map(&corners, |_, &i| {
        let mut found = Vec::new();
        for &j in &corners {
            let span = (j + n - i) % n;
            if span < 2 { continue; }
            let end = (j + n - 1) % n;
            if 0.5 * (prefix[i + span] - prefix[i] + (r[j].x * r[i].y - r[i].x * r[j].y)) > 1.0 {
                continue;
            }
            // A vertex clearly right of the chord (an occupied salient) rejects
            // the pair before its chain is built; `pocket_candidate` decides the rest.
            let u = dir(r[i], r[j]);
            if (1..span).any(|k| { let q = r[(i + k) % n]; cross(u, (q.x - r[i].x, q.y - r[i].y)) < -1e-3 }) {
                continue;
            }
            if let Some(p) = pocket_candidate(shape, i, end, r[i], r[j], limits, false) { found.push(p); }
        }
        found
    });
    // Opposing stretches can fold inside a broad, otherwise shallow bay.
    // Use their closest endpoint/projection, rather than moving either stretch.
    // Sides whose boxes lie more than the fold gap apart have no point pair
    // closer than it: skipped.
    let boxes: Vec<[f64; 4]> = (0..n).map(|i| { let (a, b) = (r[i], r[(i + 1) % n]);
        [a.x.min(b.x), a.y.min(b.y), a.x.max(b.x), a.y.max(b.y)] }).collect();
    let folds = par::map(&boxes, |i, _| {
        let mut found = Vec::new();
        for j in 0..r.len() {
            if i == j || (i + 1) % r.len() == j || (j + 1) % r.len() == i { continue; }
            let (p, q) = (boxes[i], boxes[j]);
            if (p[0] - q[2]).max(q[0] - p[2]).max(p[1] - q[3]).max(q[1] - p[3]) > limits.fold_gap { continue; }
            let (a, b) = (r[i], r[(i + 1) % r.len()]);
            let (c, d) = (r[j], r[(j + 1) % r.len()]);
            let candidates = [(a, g::distance(a, c, d).2), (b, g::distance(b, c, d).2),
                (g::distance(c, a, b).2, c), (g::distance(d, a, b).2, d)];
            for (a, b) in candidates {
                if dist(a, b) >= limits.fold_gap { continue; }
                if let Some(p) = pocket_candidate(shape, i, j, a, b, limits, true) { found.push(p); }
            }
        }
        found
    });
    corners_found.into_iter().chain(folds).flatten().collect()
}
/// Keep the founding trace except at a deep re-entrant bay or narrow fold.
/// Each round repairs the shortest valid pocket: candidates are sorted by
/// length (stable, discovery order on ties) and only validated in that order,
/// up to the first that passes.
pub(super) fn without_invaginations(shape: &Shape, surface: Surface<'_>) -> Shape {
    fill_pockets(shape, surface, PocketLimits::read(), f64::INFINITY)
}
/// Re-entrant bends (deeper than a sixth of their chord, chord under 400 m)
/// of a joined circuit are cut by straight runs: two circuits made one go
/// straight across where each used to turn in, never across water.
pub(in super::super) fn straight_across(shape: &Shape, surface: Surface<'_>) -> Shape {
    let limits = PocketLimits { depth_span: 1.0 / 6.0, ..PocketLimits::read() };
    fill_pockets(shape, surface, limits, 400.0)
}
fn fill_pockets(shape: &Shape, surface: Surface<'_>, limits: PocketLimits, max_span: f64) -> Shape {
    if !g::simple(shape) { return shape.clone(); }
    let mut trace = shape.clone();
    // The dry test of a pocket, by its exact chord and chain: the cut piece is
    // the region between them (the bridge changes nothing else), so pockets a
    // repair leaves untouched are not cut and clipped again next round.
    let mut dry: std::collections::HashMap<Vec<u64>, bool> = Default::default();
    // A bridge refused because its new sides touch a side of the trace stays
    // refused while that side is on the trace: the same pocket between the
    // same neighbours makes the same new sides (keyed by chain and
    // neighbours), and a side that survives a repair is no neighbour of them.
    let mut crossed: std::collections::HashMap<Vec<u64>, [u64; 4]> = Default::default();
    loop {
        let mut repairs = candidates(&trace, limits);
        repairs.retain(|p| dist(p.a, p.b) <= max_span);
        repairs.sort_by(|a, b| a.length.total_cmp(&b.length));
        // The trace is simple (checked above, then kept by every repair).
        let base = sides(&trace.outer);
        let r = &trace.outer;
        let bits = |q: &Point| [q.x.to_bits(), q.y.to_bits()];
        let Some(next) = repairs.iter().filter_map(|p| {
            let chain = p.chain(r);
            let mut context: Vec<u64> = chain.iter().flat_map(bits).collect();
            context.extend(bits(&r[p.start]));
            context.extend(bits(&r[(p.end + 1) % r.len()]));
            if crossed.get(&context).is_some_and(|side| base.contains(side)) {
                return None;
            }
            let next = p.bridge(&trace);
            let o = &next.outer;
            let fresh: Vec<usize> = (0..o.len()).filter(|&i| !base.contains(&side_key(o[i], o[(i + 1) % o.len()]))).collect();
            match g::touching_side(o, &fresh) {
                Err(Some(j)) => {
                    crossed.insert(context, side_key(o[j], o[(j + 1) % o.len()]));
                    return None;
                }
                Err(None) => return None,
                Ok(()) => {}
            }
            (g::area(&next) > g::area(&trace)).then_some((chain, next))
        }).find_map(|(chain, next)| {
            let key: Vec<u64> = chain.iter().flat_map(bits).collect();
            // A pocket cut never creates an empty corner across a river.
            let ok = *dry.entry(key).or_insert_with(|| g::difference(&next, &trace).iter().all(|s|
                g::area(s) - area(&g::dry_clip(&surface, s)) < 1.0));
            ok.then_some(next)
        }) else { return trace; };
        trace = next;
    }
}
