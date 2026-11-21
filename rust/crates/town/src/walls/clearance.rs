//! Clearance of a traced line from what it must not touch: neighbours' claims, a harbour's quay,
//! apron and service row. The line is pulled back locally, vertex by vertex towards its anchor,
//! never dropped: a vertex that cannot be cleared stays where it was.

use magna_urbis_geom::{self as g, Point, Shape};

use super::geometry::lerp;

/// Spacing in metres of the vertices a line is densified to before it is pulled back.
const DENSIFY: f64 = 10.0;
/// Bisection steps along the way from a vertex to its anchor.
const STEPS: usize = 14;

/// A shape and the distance to keep from it.
#[derive(Clone, Debug)]
pub struct Obstacle {
    pub shape: Shape,
    pub clearance: f64,
    bounds: (f64, f64, f64, f64),
}

impl Obstacle {
    pub fn new(shape: Shape, clearance: f64) -> Self {
        let bounds = g::bbox(&shape);
        Self {
            shape,
            clearance,
            bounds,
        }
    }

    /// Whether `p` lies inside the shape or within its clearance.
    pub fn blocks(&self, p: Point) -> bool {
        let (b, d) = (self.bounds, self.clearance);
        if p.x < b.0 - d || p.x > b.2 + d || p.y < b.1 - d || p.y > b.3 + d {
            return false;
        }
        if g::contains(&self.shape, p) {
            return true;
        }
        std::iter::once(&self.shape.outer)
            .chain(&self.shape.holes)
            .any(|ring| {
                let n = ring.len();
                (0..n).any(|i| g::distance(p, ring[i], ring[(i + 1) % n]).0 < d)
            })
    }
}

/// What a pull-back did.
#[derive(Clone, Debug, PartialEq)]
pub struct Cleared {
    /// The ring after the pull-back, counter-clockwise.
    pub ring: Vec<Point>,
    /// Vertices moved.
    pub moved: usize,
    /// Vertices left blocked, because even the anchor is blocked or the moved ring folded.
    pub blocked: usize,
}

/// Pull every vertex of the closed `ring` that some obstacle blocks back towards `anchor`, by the
/// shortest move along that way that clears it. Vertices for which `fixed` holds (a stretch
/// shared with a standing circuit) never move. A ring that would fold is returned unmoved.
pub fn pull_back(
    ring: &[Point],
    anchor: Point,
    obstacles: &[Obstacle],
    fixed: impl Fn(Point) -> bool,
) -> Cleared {
    let blocked = |p: Point| obstacles.iter().any(|o| o.blocks(p));
    if obstacles.is_empty() || !ring.iter().any(|&p| blocked(p)) && !crosses(ring, &blocked) {
        return Cleared {
            ring: ring.to_vec(),
            moved: 0,
            blocked: 0,
        };
    }
    let dense = densify(ring, DENSIFY);
    let (mut moved, mut stuck) = (0, 0);
    let pulled: Vec<Point> = dense
        .iter()
        .map(|&p| {
            if fixed(p) || !blocked(p) {
                return p;
            }
            if blocked(anchor) {
                stuck += 1;
                return p;
            }
            let (mut lo, mut hi) = (0.0, 1.0);
            for _ in 0..STEPS {
                let mid = 0.5 * (lo + hi);
                if blocked(lerp(p, anchor, mid)) {
                    lo = mid;
                } else {
                    hi = mid;
                }
            }
            moved += 1;
            lerp(p, anchor, hi)
        })
        .collect();
    let outline = g::normalized(Shape {
        outer: g::unneedled(&pulled, 0.05),
        holes: vec![],
    });
    if !g::simple(&outline) {
        return Cleared {
            ring: ring.to_vec(),
            moved: 0,
            blocked: moved + stuck,
        };
    }
    Cleared {
        ring: outline.outer,
        moved,
        blocked: stuck,
    }
}

/// Whether a side of the ring passes through a blocked point between its vertices.
fn crosses(ring: &[Point], blocked: &impl Fn(Point) -> bool) -> bool {
    let n = ring.len();
    (0..n).any(|i| {
        let (a, b) = (ring[i], ring[(i + 1) % n]);
        let k = (a.distance(b) / DENSIFY).ceil().max(1.0) as usize;
        (1..k).any(|j| blocked(lerp(a, b, j as f64 / k as f64)))
    })
}

/// The closed ring with extra vertices so that no side is longer than `spacing`.
pub(super) fn densify(ring: &[Point], spacing: f64) -> Vec<Point> {
    let n = ring.len();
    let mut out = Vec::with_capacity(n * 2);
    for i in 0..n {
        let (a, b) = (ring[i], ring[(i + 1) % n]);
        let k = (a.distance(b) / spacing).ceil().max(1.0) as usize;
        for j in 0..k {
            out.push(lerp(a, b, j as f64 / k as f64));
        }
    }
    out
}
