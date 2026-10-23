//! Minimum rigid translation for three sets of exact convex site rights.
//!
//! Every moving surface is already at its retained orientation and dimensions,
//! in the same coordinates as its rights. No hull, clipping of a building,
//! source construction, orientation search or native admission happens here.
use crate::geometry::{bounds, to_geo};
use crate::model::{Point, Surface};
use geo::algorithm::Validation;

const MAX_RIGHTS_VERTICES: usize = 64;
const MAX_MOVING_VERTICES: usize = 4096;
const MAX_MOVING_POLYGONS: usize = 256;
const MAX_CONSTRAINTS: usize = 3 * MAX_RIGHTS_VERTICES;
const MAX_FIT_VERTICES: usize = MAX_CONSTRAINTS + 4;
const MAX_ABS_COORDINATE: f64 = 10_000_000.;
const EPS: f64 = 1e-9;

pub(crate) struct TranslationProblem<'a> {
    pub body: &'a Surface,
    pub buildable: &'a Surface,
    /// Complete reserved occupation, including native body/site passages and
    /// supports. The caller supplies the actual union or overlapping parts.
    pub occupation: &'a Surface,
    /// Actual cadastral/reserve/neighbour-free domain, not its convex hull.
    pub architectural_rights: &'a Surface,
    pub roof: &'a Surface,
    pub roof_rights: &'a Surface,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PendingCheck {
    PhysicalTerrainAndWater,
    NativeEntranceAndConnector,
    NativeRoofRealization,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct RigidTranslation {
    pub delta: Point,
    pub distance_m: f64,
    pub constraints: usize,
    pub feasible_vertices: usize,
    pub pending_checks: Vec<PendingCheck>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum TranslationOutcome {
    Fit(RigidTranslation),
    /// Only these complete moving domains, fixed orientation and exact rights.
    /// This is not a claim about another assembly, orientation or terrain.
    EmptyFixedDomains,
    Unsupported(String),
}

#[derive(Clone, Copy)]
struct Plane {
    nx: f64,
    ny: f64,
    rhs: f64,
}

impl Plane {
    fn value(self, p: Point) -> f64 {
        self.nx * p.x + self.ny * p.y - self.rhs
    }
}

fn finite(p: Point) -> bool {
    p.x.is_finite()
        && p.y.is_finite()
        && p.x.abs() <= MAX_ABS_COORDINATE
        && p.y.abs() <= MAX_ABS_COORDINATE
}

/// One support inequality per edge. Local subtraction keeps a small requested
/// move accurate even when its city coordinates are large.
fn constraints(moving: &Surface, rights: &Surface) -> Result<Vec<Plane>, String> {
    if rights.len() != 1 || !rights[0].holes.is_empty() {
        return Err(
            "Rigid translation requires one actual convex rights polygon without holes.".into(),
        );
    }
    let mut ring = rights[0].outer.as_slice();
    if ring.len() > 1 && ring.first() == ring.last() {
        ring = &ring[..ring.len() - 1];
    }
    if !(3..=MAX_RIGHTS_VERTICES).contains(&ring.len()) || ring.iter().any(|p| !finite(*p)) {
        return Err("Rigid translation rights exceed finite coordinate/vertex bounds.".into());
    }
    for (i, a) in ring.iter().enumerate() {
        if ring.iter().skip(i + 1).any(|b| a == b) {
            return Err(
                "Rigid translation requires a simple rights ring without repeated vertices.".into(),
            );
        }
    }
    // Validate topology, then separately prove convexity from all real edges.
    // Validating polygons separately permits overlapping moving components;
    // their union has the same support maximum without an extra boolean.
    if !to_geo(rights).0[0].is_valid() {
        return Err("Rigid translation rights polygon is not geometrically valid.".into());
    }
    if moving.is_empty() || moving.len() > MAX_MOVING_POLYGONS {
        return Err(
            "Rigid translation moving domain is empty or exceeds the polygon bound.".into(),
        );
    }
    let count: usize = moving
        .iter()
        .map(|p| p.outer.len() + p.holes.iter().map(Vec::len).sum::<usize>())
        .sum();
    if count > MAX_MOVING_VERTICES
        || moving
            .iter()
            .any(|p| p.outer.len() < 3 || p.holes.iter().any(|h| h.len() < 3))
        || moving
            .iter()
            .flat_map(|p| p.outer.iter().chain(p.holes.iter().flatten()))
            .any(|p| !finite(*p))
        || to_geo(moving).0.iter().any(|p| !p.is_valid())
    {
        return Err(
            "Rigid translation moving polygons are invalid or exceed finite complexity bounds."
                .into(),
        );
    }
    let origin = ring[0];
    let signed_twice_area: f64 = ring
        .iter()
        .zip(ring.iter().cycle().skip(1))
        .take(ring.len())
        .map(|(a, b)| (a.x - origin.x) * (b.y - origin.y) - (b.x - origin.x) * (a.y - origin.y))
        .sum();
    if !signed_twice_area.is_finite() || signed_twice_area.abs() <= EPS {
        return Err("Rigid translation rights have no nondegenerate interior.".into());
    }
    let sign = signed_twice_area.signum();
    let mut result = Vec::with_capacity(ring.len());
    for (a, b) in ring
        .iter()
        .zip(ring.iter().cycle().skip(1))
        .take(ring.len())
    {
        let length = libm::hypot(b.x - a.x, b.y - a.y);
        if length <= EPS {
            return Err("Rigid translation rights contain a degenerate edge.".into());
        }
        let nx = sign * (b.y - a.y) / length;
        let ny = -sign * (b.x - a.x) / length;
        let edge = nx * (a.x - origin.x) + ny * (a.y - origin.y);
        if ring
            .iter()
            .any(|p| nx * (p.x - origin.x) + ny * (p.y - origin.y) - edge > EPS)
        {
            return Err(
                "Rigid translation cannot certify concave rights; no convex hull was substituted."
                    .into(),
            );
        }
        let support = moving
            .iter()
            .flat_map(|p| &p.outer)
            .map(|p| nx * (p.x - origin.x) + ny * (p.y - origin.y))
            .fold(f64::NEG_INFINITY, f64::max);
        let rhs = edge - support;
        if !rhs.is_finite() {
            return Err("Rigid translation support constraint is not finite.".into());
        }
        result.push(Plane { nx, ny, rhs });
    }
    Ok(result)
}

fn clip(polygon: Vec<Point>, plane: Plane) -> Vec<Point> {
    let mut out = Vec::with_capacity(polygon.len() + 1);
    for (&a, &b) in polygon
        .iter()
        .zip(polygon.iter().cycle().skip(1))
        .take(polygon.len())
    {
        // Exact-contact domains can collapse to a segment/point. Subtraction
        // of equal decimal coordinates may differ by an ulp; do not turn that
        // contact into an empty polygon. The final check uses the same1nm
        // numerical bound, independently of all native physical tolerances.
        let value = |p| {
            let v = plane.value(p);
            if v.abs() <= EPS { 0. } else { v }
        };
        let va = value(a);
        let vb = value(b);
        if va <= 0. {
            out.push(a);
        }
        if (va < 0. && vb > 0.) || (va > 0. && vb < 0.) {
            let t = va / (va - vb);
            out.push(Point {
                x: a.x + t * (b.x - a.x),
                y: a.y + t * (b.y - a.y),
            });
        }
        if va > 0. && vb == 0. {
            out.push(b);
        }
    }
    out.dedup();
    if out.len() > 1 && out.first() == out.last() {
        out.pop();
    }
    out
}

/// Intersect half-planes in (deltaX,deltaY) and return the Euclidean projection
/// of zero onto that convex set. The initial rectangle is a necessary bounding
/// interval from the actual domains, not an arbitrary movement distance cap.
pub(crate) fn solve(problem: &TranslationProblem<'_>) -> TranslationOutcome {
    let mut planes = Vec::new();
    let mut lower = [f64::NEG_INFINITY; 2];
    let mut upper = [f64::INFINITY; 2];
    let mut vertices = 0;
    for (name, moving, rights) in [
        ("body", problem.body, problem.buildable),
        (
            "occupation",
            problem.occupation,
            problem.architectural_rights,
        ),
        ("roof", problem.roof, problem.roof_rights),
    ] {
        let next = match constraints(moving, rights) {
            Ok(value) => value,
            Err(reason) => return TranslationOutcome::Unsupported(format!("{name}: {reason}")),
        };
        vertices += moving
            .iter()
            .map(|p| p.outer.len() + p.holes.iter().map(Vec::len).sum::<usize>())
            .sum::<usize>();
        if vertices > MAX_MOVING_VERTICES || planes.len() + next.len() > MAX_CONSTRAINTS {
            return TranslationOutcome::Unsupported(
                "Rigid translation exceeds the combined vertex/constraint budget.".into(),
            );
        }
        planes.extend(next);
        let m = bounds(moving);
        let r = bounds(rights);
        for axis in 0..2 {
            lower[axis] = lower[axis].max(r[axis] - m[axis]);
            upper[axis] = upper[axis].min(r[axis + 2] - m[axis + 2]);
        }
    }
    for axis in 0..2 {
        if lower[axis] > upper[axis] + EPS {
            return TranslationOutcome::EmptyFixedDomains;
        }
        if lower[axis] > upper[axis] {
            let contact = (lower[axis] + upper[axis]) * 0.5;
            lower[axis] = contact;
            upper[axis] = contact;
        }
    }
    let zero = Point { x: 0., y: 0. };
    // An already valid assembly is always the unique minimum-distance answer.
    if planes.iter().all(|p| p.value(zero) <= 0.) {
        return TranslationOutcome::Fit(result(zero, planes.len(), 0));
    }
    let mut polygon = vec![
        Point {
            x: lower[0],
            y: lower[1],
        },
        Point {
            x: upper[0],
            y: lower[1],
        },
        Point {
            x: upper[0],
            y: upper[1],
        },
        Point {
            x: lower[0],
            y: upper[1],
        },
    ];
    polygon.dedup();
    if polygon.len() > 1 && polygon.first() == polygon.last() {
        polygon.pop();
    }
    for &plane in &planes {
        polygon = clip(polygon, plane);
        if polygon.is_empty() {
            return TranslationOutcome::EmptyFixedDomains;
        }
        if polygon.len() > MAX_FIT_VERTICES
            || polygon.iter().any(|p| !p.x.is_finite() || !p.y.is_finite())
        {
            return TranslationOutcome::Unsupported(
                "Rigid translation feasible polygon exceeded numeric/complexity bounds.".into(),
            );
        }
    }
    let mut best = polygon[0];
    let squared = |p: Point| p.x * p.x + p.y * p.y;
    // The closest point is on an edge because zero failed a constraint. This
    // also handles a feasible segment or single point without inventing area.
    for (&a, &b) in polygon
        .iter()
        .zip(polygon.iter().cycle().skip(1))
        .take(polygon.len())
    {
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let length_squared = dx * dx + dy * dy;
        let t = if length_squared > 0. {
            (-(a.x * dx + a.y * dy) / length_squared).clamp(0., 1.)
        } else {
            0.
        };
        let candidate = Point {
            x: a.x + t * dx,
            y: a.y + t * dy,
        };
        if squared(candidate) < squared(best)
            || squared(candidate) == squared(best)
                && candidate
                    .x
                    .total_cmp(&best.x)
                    .then(candidate.y.total_cmp(&best.y))
                    .is_lt()
        {
            best = candidate;
        }
    }
    if planes.iter().any(|p| p.value(best) > EPS) {
        return TranslationOutcome::Unsupported("Rigid translation failed final half-plane verification; native admission was not attempted.".into());
    }
    TranslationOutcome::Fit(result(best, planes.len(), polygon.len()))
}

fn result(delta: Point, constraints: usize, feasible_vertices: usize) -> RigidTranslation {
    RigidTranslation {
        delta,
        distance_m: libm::hypot(delta.x, delta.y),
        constraints,
        feasible_vertices,
        pending_checks: vec![
            PendingCheck::PhysicalTerrainAndWater,
            PendingCheck::NativeEntranceAndConnector,
            PendingCheck::NativeRoofRealization,
        ],
    }
}

#[cfg(test)]
#[path = "rigid_translation_fit_tests.rs"]
mod tests;
