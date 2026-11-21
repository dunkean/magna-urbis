//! Pocket repairs: a re-entrant bay or a narrow fold of a circuit is cut by one
//! straight run, the shortest valid pocket first, never across water.

use std::collections::{HashMap, HashSet};

use magna_urbis_geom::{self as g, Point, Shape, surface::TerrainView};

use super::geometry::{area_of, cross, dir, dist};

#[derive(Clone, Copy)]
struct PocketLimits {
    /// A bay is a pocket when deeper than this share of its chord.
    depth_span: f64,
    /// Bays and folds no deeper than this (metres) stay.
    min_depth: f64,
    /// Two stretches closer than this (metres) form a fold.
    fold_gap: f64,
}

/// Classic `invaginations` defaults.
const LIMITS: PocketLimits = PocketLimits {
    depth_span: 0.4,
    min_depth: 12.0,
    fold_gap: 10.0,
};

/// A chain of the ring from `a` (on side `start`) to `b` (on side `end`), replaced by
/// the chord `a`–`b`.
struct Pocket {
    start: usize,
    end: usize,
    a: Point,
    b: Point,
    length: f64,
}

impl Pocket {
    fn chain(&self, r: &[Point]) -> Vec<Point> {
        let mut chain = vec![self.a];
        chain.extend(
            (1..=(self.end + r.len() - self.start) % r.len())
                .map(|k| r[(self.start + k) % r.len()]),
        );
        chain.push(self.b);
        chain.dedup_by(|a, b| dist(*a, *b) < 1e-7);
        chain
    }

    fn bridge(&self, shape: &Shape) -> Shape {
        let r = &shape.outer;
        let count = (self.end + r.len() - self.start) % r.len();
        let mut outer = vec![];
        for (i, &p) in r.iter().enumerate() {
            let k = (i + r.len() - self.start) % r.len();
            if k > 0 && k <= count {
                continue;
            }
            outer.push(p);
            if i == self.start {
                if dist(p, self.a) > 1e-7 {
                    outer.push(self.a);
                }
                outer.push(self.b);
            }
        }
        outer.dedup_by(|a, b| dist(*a, *b) < 1e-7);
        if outer.len() > 1 && dist(outer[0], outer[outer.len() - 1]) < 1e-7 {
            outer.pop();
        }
        Shape {
            outer,
            holes: shape.holes.clone(),
        }
    }
}

/// Sides of a ring by exact coordinates: a bridged ring is simple when its new sides are.
type Sides = HashSet<[u64; 4]>;

fn side_key(p: Point, q: Point) -> [u64; 4] {
    [p.x.to_bits(), p.y.to_bits(), q.x.to_bits(), q.y.to_bits()]
}

fn sides(r: &[Point]) -> Sides {
    (0..r.len())
        .map(|i| side_key(r[i], r[(i + 1) % r.len()]))
        .collect()
}

/// The shape test of a pocket: a re-entrant chain that cuts off no occupied salient,
/// deep enough (or a narrow fold). No bridge is built.
fn pocket_candidate(
    shape: &Shape,
    start: usize,
    end: usize,
    a: Point,
    b: Point,
    limits: PocketLimits,
    fold: bool,
) -> Option<Pocket> {
    let mut p = Pocket {
        start,
        end,
        a,
        b,
        length: 0.0,
    };
    let chain = p.chain(&shape.outer);
    let span = dist(a, b);
    if span < 1e-6 || chain.len() < 3 || g::signed(&chain) >= -1e-6 {
        return None;
    }
    let u = dir(a, b);
    if chain
        .iter()
        .any(|&q| cross(u, (q.x - a.x, q.y - a.y)) < -1e-6)
    {
        return None;
    }
    let depth = chain
        .iter()
        .map(|&q| g::distance(q, a, b).0)
        .fold(0.0, f64::max);
    p.length = chain.windows(2).map(|w| dist(w[0], w[1])).sum();
    let shallow = if fold {
        span >= limits.fold_gap || p.length <= span * 4.0
    } else {
        depth <= span * limits.depth_span
    };
    if depth <= limits.min_depth || shallow {
        return None;
    }
    Some(p)
}

/// Every pocket candidate in discovery order: chords between convex corners, then
/// the closest point pairs of opposing sides within the fold gap.
fn candidates(shape: &Shape, limits: PocketLimits) -> Vec<Pocket> {
    let r = &shape.outer;
    let n = r.len();
    if n < 4 {
        return vec![];
    }
    // Twice-around prefix of the shoelace terms: the signed area of the chain
    // r[i..=j] closed by its chord in O(1). A chain clearly positive (> 1 m²) is no
    // pocket and is skipped before it is built.
    let mut prefix = vec![0.0; 2 * n + 1];
    for k in 0..2 * n {
        let (p, q) = (r[k % n], r[(k + 1) % n]);
        prefix[k + 1] = prefix[k] + (p.x * q.y - q.x * p.y);
    }
    let corners: Vec<usize> = (0..n)
        .filter(|&i| cross(dir(r[(i + n - 1) % n], r[i]), dir(r[i], r[(i + 1) % n])) >= -1e-8)
        .collect();
    let mut found = vec![];
    for &i in &corners {
        for &j in &corners {
            let span = (j + n - i) % n;
            if span < 2 {
                continue;
            }
            if 0.5 * (prefix[i + span] - prefix[i] + (r[j].x * r[i].y - r[i].x * r[j].y)) > 1.0 {
                continue;
            }
            // A vertex clearly right of the chord (an occupied salient) rejects the pair.
            let u = dir(r[i], r[j]);
            if (1..span).any(|k| {
                let q = r[(i + k) % n];
                cross(u, (q.x - r[i].x, q.y - r[i].y)) < -1e-3
            }) {
                continue;
            }
            found.extend(pocket_candidate(
                shape,
                i,
                (j + n - 1) % n,
                r[i],
                r[j],
                limits,
                false,
            ));
        }
    }
    // Opposing stretches can fold inside a broad, otherwise shallow bay: their closest
    // endpoint and projection are joined. Sides whose boxes lie farther apart than the
    // fold gap have no pair closer than it.
    let boxes: Vec<[f64; 4]> = (0..n)
        .map(|i| {
            let (a, b) = (r[i], r[(i + 1) % n]);
            [a.x.min(b.x), a.y.min(b.y), a.x.max(b.x), a.y.max(b.y)]
        })
        .collect();
    for i in 0..n {
        for j in 0..n {
            if i == j || (i + 1) % n == j || (j + 1) % n == i {
                continue;
            }
            let (p, q) = (boxes[i], boxes[j]);
            if (p[0] - q[2])
                .max(q[0] - p[2])
                .max(p[1] - q[3])
                .max(q[1] - p[3])
                > limits.fold_gap
            {
                continue;
            }
            let (a, b) = (r[i], r[(i + 1) % n]);
            let (c, d) = (r[j], r[(j + 1) % n]);
            let pairs = [
                (a, g::distance(a, c, d).2),
                (b, g::distance(b, c, d).2),
                (g::distance(c, a, b).2, c),
                (g::distance(d, a, b).2, d),
            ];
            for (a, b) in pairs {
                if dist(a, b) < limits.fold_gap {
                    found.extend(pocket_candidate(shape, i, j, a, b, limits, true));
                }
            }
        }
    }
    found
}

/// Repair pockets one at a time, shortest chain first, up to `max_span` metres of
/// chord, while the circuit stays simple, grows and the filled piece is dry.
fn fill_pockets(
    shape: &Shape,
    terrain: &dyn TerrainView,
    limits: PocketLimits,
    max_span: f64,
) -> Shape {
    if !g::simple(shape) {
        return shape.clone();
    }
    let mut trace = shape.clone();
    let bits = |q: &Point| [q.x.to_bits(), q.y.to_bits()];
    // The dry test of a pocket by its exact chain: pockets a repair leaves untouched
    // are not cut and clipped again next round.
    let mut dry: HashMap<Vec<u64>, bool> = HashMap::new();
    // A bridge refused because a new side touches a side of the trace stays refused
    // while that side is on the trace (keyed by chain and neighbours).
    let mut crossed: HashMap<Vec<u64>, [u64; 4]> = HashMap::new();
    loop {
        let mut repairs = candidates(&trace, limits);
        repairs.retain(|p| dist(p.a, p.b) <= max_span);
        repairs.sort_by(|a, b| a.length.total_cmp(&b.length));
        let base = sides(&trace.outer);
        let r = &trace.outer;
        let mut next = None;
        for p in &repairs {
            let chain = p.chain(r);
            let mut context: Vec<u64> = chain.iter().flat_map(bits).collect();
            context.extend(bits(&r[p.start]));
            context.extend(bits(&r[(p.end + 1) % r.len()]));
            if crossed
                .get(&context)
                .is_some_and(|side| base.contains(side))
            {
                continue;
            }
            let bridged = p.bridge(&trace);
            let o = &bridged.outer;
            let fresh: Vec<usize> = (0..o.len())
                .filter(|&i| !base.contains(&side_key(o[i], o[(i + 1) % o.len()])))
                .collect();
            match g::touching_side(o, &fresh) {
                Err(Some(j)) => {
                    crossed.insert(context, side_key(o[j], o[(j + 1) % o.len()]));
                    continue;
                }
                Err(None) => continue,
                Ok(()) => {}
            }
            if g::area(&bridged) <= g::area(&trace) {
                continue;
            }
            let key: Vec<u64> = chain.iter().flat_map(bits).collect();
            // A pocket cut never creates an empty corner across a river.
            let ok = *dry.entry(key).or_insert_with(|| {
                g::difference(&bridged, &trace)
                    .iter()
                    .all(|s| g::area(s) - area_of(&terrain.dry_clip(s)) < 1.0)
            });
            if ok {
                next = Some(bridged);
                break;
            }
        }
        match next {
            Some(n) => trace = n,
            None => return trace,
        }
    }
}

/// A traced circuit without deep re-entrant bays (deeper than 0.4 of their chord and
/// 12 m) or narrow folds (under 10 m across): each is cut by a straight run.
pub fn without_invaginations(shape: &Shape, terrain: &dyn TerrainView) -> Shape {
    fill_pockets(shape, terrain, LIMITS, f64::INFINITY)
}

/// Re-entrant bends of a joined circuit (deeper than a sixth of their chord, chord
/// under 400 m) are cut by straight runs: two circuits made one go straight across
/// where each used to turn in, never across water.
pub fn straight_across(shape: &Shape, terrain: &dyn TerrainView) -> Shape {
    fill_pockets(
        shape,
        terrain,
        PocketLimits {
            depth_span: 1.0 / 6.0,
            ..LIMITS
        },
        400.0,
    )
}
