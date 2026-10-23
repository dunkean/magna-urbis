//! Continuous rectangle fitting in one declared front frame.
//!
//! This kernel constructs no house and chooses no style, orientation, infill or
//! terrain model. Its certificate covers the supplied rectangle and rectangular
//! margins only. Native construction, coordinate quantization, physical terrain
//! and a real entrance connection still require their ordinary admission guards.
use crate::model::Surface;

const MAX_DOMAIN_VERTICES: usize = 16;
const MAX_PROJECTED_CONSTRAINTS: usize = 2048;
const EPS: f64 = 1.0e-9;

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct Margins {
    pub left: f64,
    pub right: f64,
    pub front: f64,
    pub back: f64,
}

/// Exact source-owned rectangle descriptor; never an approximation of a court,
/// gallery, seeded infill or several bodies by their enclosing box.
#[derive(Clone, Debug)]
pub(crate) struct RectangleModel {
    pub identity: String,
    pub width_m: [f64; 2],
    pub depth_m: [f64; 2],
    pub architectural_margins: Margins,
    pub roof_margins: Margins,
}

/// All geometry is already in the same fixed orthonormal frame, with +y into
/// the site. `front_y` is the complete architectural rectangle's front edge.
/// Obstacles must already be represented by a genuinely convex admissible cell;
/// the kernel never substitutes a convex hull for supplied rights.
pub(crate) struct FixedFrontSite<'a> {
    pub buildable: &'a Surface,
    pub architectural: &'a Surface,
    pub roof: &'a Surface,
    pub front_y: f64,
    pub preferred_body_x: f64,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum PendingCheck {
    NativeSourceConstruction,
    CoordinateQuantization,
    PhysicalTerrain,
    NativeRoof,
    EntranceAndAccess,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) struct RectangleFit {
    pub descriptor_identity: String,
    pub body_origin_m: [f64; 2],
    pub dimensions_m: [f64; 2],
    pub body_area_m2: f64,
    pub architectural_domain_area_m2: f64,
    pub attainable_body_area_m2: [f64; 2],
    pub target_met: bool,
    pub projected_constraints: usize,
    pub pending_checks: Vec<PendingCheck>,
}

#[derive(Clone, Debug, PartialEq)]
pub(crate) enum FitOutcome {
    Fit(RectangleFit),
    /// Empty only for this descriptor, convex cell, orientation and front edge.
    /// It says nothing about another source, pose, cell, or terrain solution.
    EmptyFixedDomain,
    Unsupported(String),
}

#[derive(Clone, Copy, Debug)]
struct Plane {
    nx: f64,
    ny: f64,
    rhs: f64,
}

#[derive(Clone, Copy)]
struct Constraint {
    x: f64,
    w: f64,
    d: f64,
    rhs: f64,
}

#[derive(Clone, Copy)]
struct DimensionPlane {
    w: f64,
    d: f64,
    rhs: f64,
}

impl DimensionPlane {
    fn value(self, p: [f64; 2]) -> f64 {
        self.w * p[0] + self.d * p[1] - self.rhs
    }
}

fn valid_range(r: [f64; 2]) -> bool {
    r.iter().all(|v| v.is_finite() && *v > 0. && *v <= 10_000.) && r[0] <= r[1]
}

fn valid_margins(m: Margins) -> bool {
    [m.left, m.right, m.front, m.back]
        .iter()
        .all(|v| v.is_finite() && *v >= 0. && *v <= 10_000.)
}

fn convex_planes(surface: &Surface) -> Result<Vec<Plane>, String> {
    if surface.len() != 1 || !surface[0].holes.is_empty() {
        return Err("Rectangle fit requires one actual convex polygon without holes.".into());
    }
    let ring = &surface[0].outer;
    if !(3..=MAX_DOMAIN_VERTICES).contains(&ring.len())
        || ring
            .iter()
            .any(|p| !p.x.is_finite() || !p.y.is_finite() || p.x.abs() > 1.0e7 || p.y.abs() > 1.0e7)
    {
        return Err("Rectangle fit polygon exceeds its finite vertex/coordinate bounds.".into());
    }
    // A repeated traversal of a convex ring passes every edge half-plane but
    // is not a simple polygon. Accept the optional conventional closing point,
    // and reject every other repeated vertex rather than guessing a fill rule.
    for (i, a) in ring.iter().enumerate() {
        for (j, b) in ring.iter().enumerate().skip(i + 1) {
            if a.x == b.x && a.y == b.y && !(i == 0 && j == ring.len() - 1) {
                return Err(
                    "Rectangle fit requires a simple ring without repeated vertices.".into(),
                );
            }
        }
    }
    // Translate before the signed area sum to avoid large-coordinate cancellation.
    let origin = ring[0];
    let signed_area: f64 = ring
        .iter()
        .zip(ring.iter().cycle().skip(1))
        .take(ring.len())
        .map(|(a, b)| (a.x - origin.x) * (b.y - origin.y) - (b.x - origin.x) * (a.y - origin.y))
        .sum();
    if signed_area.abs() <= EPS {
        return Err("Rectangle fit polygon has no nondegenerate interior.".into());
    }
    let sign = signed_area.signum();
    let mut planes = Vec::with_capacity(ring.len());
    for (a, b) in ring
        .iter()
        .zip(ring.iter().cycle().skip(1))
        .take(ring.len())
    {
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let length = libm::hypot(dx, dy);
        if length <= EPS {
            continue;
        }
        let nx = sign * dy / length;
        let ny = -sign * dx / length;
        let rhs = nx * a.x + ny * a.y;
        // Every actual vertex must satisfy every oriented edge half-plane.
        // A concavity is unsupported, never replaced by a hull.
        if ring.iter().any(|p| nx * p.x + ny * p.y - rhs > EPS) {
            return Err("Rectangle fit cannot certify a concave or self-crossing domain.".into());
        }
        planes.push(Plane { nx, ny, rhs });
    }
    if planes.len() < 3 {
        return Err("Rectangle fit polygon has fewer than three usable edges.".into());
    }
    Ok(planes)
}

fn rectangle_constraints(
    planes: &[Plane],
    margins: Margins,
    body_y: f64,
    out: &mut Vec<Constraint>,
) {
    for &p in planes {
        // For a rectangle, the maximal supporting corner is known from the
        // normal signs. This is one exact inequality per edge, not four trials.
        let ox = if p.nx >= 0. {
            margins.right
        } else {
            -margins.left
        };
        let oy = if p.ny >= 0. {
            margins.back
        } else {
            -margins.front
        };
        out.push(Constraint {
            x: p.nx,
            w: p.nx.max(0.),
            d: p.ny.max(0.),
            rhs: p.rhs - p.nx * ox - p.ny * (body_y + oy),
        });
    }
}

fn project_x(constraints: &[Constraint]) -> Option<Vec<DimensionPlane>> {
    let mut lower = vec![];
    let mut upper = vec![];
    let mut result = vec![];
    for &c in constraints {
        if c.x == 0. {
            result.push(DimensionPlane {
                w: c.w,
                d: c.d,
                rhs: c.rhs,
            });
        } else {
            // x >=/<= rhs + w*W + d*D, depending on the original sign.
            let bound = DimensionPlane {
                w: -c.w / c.x,
                d: -c.d / c.x,
                rhs: c.rhs / c.x,
            };
            if c.x < 0. {
                lower.push(bound);
            } else {
                upper.push(bound);
            }
        }
    }
    if lower.is_empty()
        || upper.is_empty()
        || result.len() + lower.len() * upper.len() > MAX_PROJECTED_CONSTRAINTS
    {
        return None;
    }
    for lo in lower {
        for hi in &upper {
            result.push(DimensionPlane {
                w: lo.w - hi.w,
                d: lo.d - hi.d,
                rhs: hi.rhs - lo.rhs,
            });
        }
    }
    // Positive normalization makes clipping stable at near-vertical site edges.
    for c in &mut result {
        let norm = libm::hypot(c.w, c.d);
        if norm > 0. {
            c.w /= norm;
            c.d /= norm;
            c.rhs /= norm;
        }
        if ![c.w, c.d, c.rhs].iter().all(|v| v.is_finite()) {
            return None;
        }
    }
    Some(result)
}

fn clip(polygon: Vec<[f64; 2]>, plane: DimensionPlane) -> Vec<[f64; 2]> {
    let mut result = vec![];
    for (&a, &b) in polygon
        .iter()
        .zip(polygon.iter().cycle().skip(1))
        .take(polygon.len())
    {
        let va = plane.value(a);
        let vb = plane.value(b);
        if va <= 0. {
            result.push(a);
        }
        if (va < 0. && vb > 0.) || (va > 0. && vb < 0.) {
            let t = va / (va - vb);
            result.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])]);
        }
        if va > 0. && vb == 0. {
            result.push(b);
        }
    }
    result.dedup_by(|a, b| a == b);
    if result.len() > 1 && result.first() == result.last() {
        result.pop();
    }
    result
}

fn area(p: [f64; 2]) -> f64 {
    p[0] * p[1]
}

fn area_extrema(polygon: &[[f64; 2]]) -> ([f64; 2], [f64; 2]) {
    let mut minimum = polygon[0];
    let mut maximum = polygon[0];
    let mut consider = |p| {
        if area(p) < area(minimum) {
            minimum = p;
        }
        if area(p) > area(maximum) {
            maximum = p;
        }
    };
    for (&a, &b) in polygon
        .iter()
        .zip(polygon.iter().cycle().skip(1))
        .take(polygon.len())
    {
        consider(a);
        let dw = b[0] - a[0];
        let dd = b[1] - a[1];
        let quadratic = dw * dd;
        let linear = a[0] * dd + a[1] * dw;
        if quadratic != 0. {
            let t = -linear / (2. * quadratic);
            if t > 0. && t < 1. {
                consider([a[0] + t * dw, a[1] + t * dd]);
            }
        }
    }
    // W,D are strictly positive: grad(WD)=(D,W) has no interior stationary
    // point. The extrema above therefore cover the entire convex polygon.
    (minimum, maximum)
}

fn area_roots(a: [f64; 2], b: [f64; 2], target: f64) -> Vec<[f64; 2]> {
    let dw = b[0] - a[0];
    let dd = b[1] - a[1];
    let qa = dw * dd;
    let qb = a[0] * dd + a[1] * dw;
    let qc = area(a) - target;
    let mut roots = vec![];
    if qa == 0. {
        if qb != 0. {
            roots.push(-qc / qb);
        } else if qc == 0. {
            roots.extend([0., 1.]);
        }
    } else {
        let disc = qb * qb - 4. * qa * qc;
        if disc >= 0. {
            // Stable quadratic roots, including near-linear intervals.
            let q = -0.5 * (qb + libm::sqrt(disc).copysign(qb));
            if q != 0. {
                roots.extend([q / qa, qc / q]);
            } else {
                roots.push(-qb / (2. * qa));
            }
        }
    }
    roots
        .into_iter()
        .filter(|t| t.is_finite() && *t >= 0. && *t <= 1.)
        .map(|t| [a[0] + t * dw, a[1] + t * dd])
        .collect()
}

/// Solve the continuous rectangle problem once. No house, mesh, roof, native
/// candidate, random draw, or raster evaluation occurs in this function.
pub(crate) fn solve_rectangle(
    model: &RectangleModel,
    site: &FixedFrontSite<'_>,
    target_body_area_m2: f64,
    preferred_aspect: f64,
) -> Result<FitOutcome, String> {
    if model.identity.is_empty()
        || !valid_range(model.width_m)
        || !valid_range(model.depth_m)
        || !valid_margins(model.architectural_margins)
        || !valid_margins(model.roof_margins)
        || !site.front_y.is_finite()
        || !site.preferred_body_x.is_finite()
        || !target_body_area_m2.is_finite()
        || target_body_area_m2 <= 0.
        || !preferred_aspect.is_finite()
        || preferred_aspect <= 0.
    {
        return Err("Invalid direct rectangle descriptor, frame or footprint wish.".into());
    }
    let body_y = site.front_y + model.architectural_margins.front;
    let mut constraints = vec![];
    for (surface, margins) in [
        (site.buildable, Margins::default()),
        (site.architectural, model.architectural_margins),
        (site.roof, model.roof_margins),
    ] {
        let planes = match convex_planes(surface) {
            Ok(value) => value,
            Err(reason) => return Ok(FitOutcome::Unsupported(reason)),
        };
        rectangle_constraints(&planes, margins, body_y, &mut constraints);
    }
    let Some(projected) = project_x(&constraints) else {
        return Ok(FitOutcome::Unsupported(
            "Rectangle projection exceeds numeric/constraint bounds.".into(),
        ));
    };
    let [w0, w1] = model.width_m;
    let [d0, d1] = model.depth_m;
    let mut polygon = vec![[w0, d0], [w1, d0], [w1, d1], [w0, d1]];
    for &plane in &projected {
        polygon = clip(polygon, plane);
        if polygon.is_empty() {
            return Ok(FitOutcome::EmptyFixedDomain);
        }
    }
    let (minimum, maximum) = area_extrema(&polygon);
    let desired_area = target_body_area_m2.clamp(area(minimum), area(maximum));
    let dimensions = if desired_area == area(minimum) {
        minimum
    } else if desired_area == area(maximum) {
        maximum
    } else {
        let ideal = [
            libm::sqrt(desired_area * preferred_aspect),
            libm::sqrt(desired_area / preferred_aspect),
        ];
        let mut choices = vec![];
        if ideal[0] >= w0
            && ideal[0] <= w1
            && ideal[1] >= d0
            && ideal[1] <= d1
            && projected.iter().all(|c| c.value(ideal) <= EPS)
        {
            choices.push(ideal);
        }
        for (&a, &b) in polygon
            .iter()
            .zip(polygon.iter().cycle().skip(1))
            .take(polygon.len())
        {
            choices.extend(area_roots(a, b, desired_area));
        }
        choices.sort_by(|a, b| {
            let score = |p: &[f64; 2]| {
                (libm::log(p[0]) - libm::log(p[1]) - libm::log(preferred_aspect)).abs()
            };
            score(a)
                .total_cmp(&score(b))
                .then(a[0].total_cmp(&b[0]))
                .then(a[1].total_cmp(&b[1]))
        });
        let Some(best) = choices.first().copied() else {
            return Ok(FitOutcome::Unsupported(
                "Rectangle area roots were numerically unresolved.".into(),
            ));
        };
        best
    };
    let mut lower = f64::NEG_INFINITY;
    let mut upper = f64::INFINITY;
    for c in &constraints {
        let rhs = c.rhs - c.w * dimensions[0] - c.d * dimensions[1];
        if c.x < 0. {
            lower = lower.max(rhs / c.x);
        } else if c.x > 0. {
            upper = upper.min(rhs / c.x);
        } else if rhs < -EPS {
            return Ok(FitOutcome::Unsupported(
                "Rectangle dimension recovery failed a numeric guard.".into(),
            ));
        }
    }
    if !lower.is_finite() || !upper.is_finite() || lower > upper + EPS {
        return Ok(FitOutcome::Unsupported(
            "Rectangle origin interval was numerically unresolved.".into(),
        ));
    }
    let x = if lower > upper {
        (lower + upper) * 0.5
    } else {
        site.preferred_body_x.clamp(lower, upper)
    };
    if constraints
        .iter()
        .any(|c| c.x * x + c.w * dimensions[0] + c.d * dimensions[1] - c.rhs > EPS)
    {
        return Ok(FitOutcome::Unsupported(
            "Rectangle final half-plane verification failed.".into(),
        ));
    }
    let body_area_m2 = area(dimensions);
    let m = model.architectural_margins;
    Ok(FitOutcome::Fit(RectangleFit {
        descriptor_identity: model.identity.clone(),
        body_origin_m: [x, body_y],
        dimensions_m: dimensions,
        body_area_m2,
        architectural_domain_area_m2: (dimensions[0] + m.left + m.right)
            * (dimensions[1] + m.front + m.back),
        attainable_body_area_m2: [area(minimum), area(maximum)],
        target_met: (body_area_m2 - target_body_area_m2).abs() <= EPS * target_body_area_m2.max(1.),
        projected_constraints: projected.len(),
        pending_checks: vec![
            PendingCheck::NativeSourceConstruction,
            PendingCheck::CoordinateQuantization,
            PendingCheck::PhysicalTerrain,
            PendingCheck::NativeRoof,
            PendingCheck::EntranceAndAccess,
        ],
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Point, Polygon};

    fn polygon(points: &[[f64; 2]]) -> Surface {
        vec![Polygon {
            outer: points.iter().map(|p| Point { x: p[0], y: p[1] }).collect(),
            holes: vec![],
        }]
    }
    fn model() -> RectangleModel {
        RectangleModel {
            identity: "test-declared-rectangle-v1".into(),
            width_m: [1., 20.],
            depth_m: [1., 20.],
            architectural_margins: Margins::default(),
            roof_margins: Margins::default(),
        }
    }
    fn site(s: &Surface) -> FixedFrontSite<'_> {
        FixedFrontSite {
            buildable: s,
            architectural: s,
            roof: s,
            front_y: 0.,
            preferred_body_x: 0.,
        }
    }
    fn fit(value: FitOutcome) -> RectangleFit {
        let FitOutcome::Fit(fit) = value else {
            panic!("Expected a rectangle fit, got {value:?}")
        };
        fit
    }
    fn close(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-7, "{a} != {b}");
    }

    #[test]
    fn triangle_solves_the_interior_edge_maximum_and_target_without_poses() {
        let triangle = polygon(&[[0., 0.], [10., 0.], [0., 10.]]);
        let max = fit(solve_rectangle(&model(), &site(&triangle), 100., 1.).unwrap());
        close(max.body_area_m2, 25.);
        close(max.dimensions_m[0], 5.);
        close(max.dimensions_m[1], 5.);
        close(max.attainable_body_area_m2[0], 1.);
        assert!(!max.target_met);
        let mut preferred = site(&triangle);
        preferred.preferred_body_x = 8.;
        let target = fit(solve_rectangle(&model(), &preferred, 16., 1.).unwrap());
        close(target.body_origin_m[0], 2.);
        assert_eq!(target.dimensions_m, [4., 4.]);
        assert!(target.target_met);
        assert!(
            target
                .pending_checks
                .contains(&PendingCheck::PhysicalTerrain)
        );
        assert!(
            target
                .pending_checks
                .contains(&PendingCheck::EntranceAndAccess)
        );
    }

    #[test]
    fn body_architectural_and_roof_domains_have_separate_exact_margins() {
        let square = polygon(&[[0., 0.], [10., 0.], [10., 10.], [0., 10.]]);
        let mut descriptor = model();
        descriptor.architectural_margins = Margins {
            left: 1.,
            right: 1.,
            front: 1.,
            back: 1.,
        };
        descriptor.roof_margins = descriptor.architectural_margins;
        descriptor.width_m = [8., 8.];
        descriptor.depth_m = [8., 8.];
        let result = fit(solve_rectangle(&descriptor, &site(&square), 64., 1.).unwrap());
        assert_eq!(result.body_origin_m, [1., 1.]);
        close(result.body_area_m2, 64.);
        close(result.architectural_domain_area_m2, 100.);
        let smaller_roof = polygon(&[[0., 0.], [9.9, 0.], [9.9, 10.], [0., 10.]]);
        let mut rights = site(&square);
        rights.roof = &smaller_roof;
        assert_eq!(
            solve_rectangle(&descriptor, &rights, 64., 1.).unwrap(),
            FitOutcome::EmptyFixedDomain
        );
    }

    #[test]
    fn reversed_oblique_domain_retains_the_same_solution_and_right_angles() {
        let oblique = polygon(&[[0., 0.], [12., 0.], [9., 8.], [2., 10.]]);
        let mut reverse = oblique.clone();
        reverse[0].outer.reverse();
        let expected = fit(solve_rectangle(&model(), &site(&oblique), 40., 1.5).unwrap());
        let actual = fit(solve_rectangle(&model(), &site(&reverse), 40., 1.5).unwrap());
        for (a, b) in actual.dimensions_m.into_iter().zip(expected.dimensions_m) {
            close(a, b);
        }
        for (a, b) in actual.body_origin_m.into_iter().zip(expected.body_origin_m) {
            close(a, b);
        }
        assert_eq!(
            solve_rectangle(&model(), &site(&oblique), 40., 1.5).unwrap(),
            FitOutcome::Fit(expected.clone())
        );
        let [x, y] = expected.body_origin_m;
        let [w, d] = expected.dimensions_m;
        for plane in convex_planes(&oblique).unwrap() {
            for [qx, qy] in [[x, y], [x + w, y], [x + w, y + d], [x, y + d]] {
                assert!(plane.nx * qx + plane.ny * qy <= plane.rhs + EPS);
            }
        }
        // The output is a whole W by D rectangle in the fixed frame, never a
        // clipped polygon following the site's oblique edges.
    }

    #[test]
    fn holes_and_concavities_are_unsupported_not_false_hull_certificates() {
        let concave = polygon(&[[0., 0.], [10., 0.], [4., 4.], [10., 10.], [0., 10.]]);
        assert!(matches!(
            solve_rectangle(&model(), &site(&concave), 20., 1.).unwrap(),
            FitOutcome::Unsupported(_)
        ));
        let mut hole = polygon(&[[0., 0.], [10., 0.], [10., 10.], [0., 10.]]);
        hole[0].holes.push(vec![
            Point { x: 2., y: 2. },
            Point { x: 3., y: 2. },
            Point { x: 3., y: 3. },
            Point { x: 2., y: 3. },
        ]);
        assert!(matches!(
            solve_rectangle(&model(), &site(&hole), 20., 1.).unwrap(),
            FitOutcome::Unsupported(_)
        ));
        let double = polygon(&[
            [0., 0.],
            [10., 0.],
            [10., 10.],
            [0., 10.],
            [0., 0.],
            [10., 0.],
            [10., 10.],
            [0., 10.],
        ]);
        assert!(matches!(
            solve_rectangle(&model(), &site(&double), 20., 1.).unwrap(),
            FitOutcome::Unsupported(_)
        ));
    }

    #[test]
    fn unreachable_targets_keep_source_bounds_and_report_capacity_without_households() {
        let square = polygon(&[[0., 0.], [20., 0.], [20., 20.], [0., 20.]]);
        let mut descriptor = model();
        descriptor.width_m = [3., 5.];
        descriptor.depth_m = [4., 6.];
        let small = fit(solve_rectangle(&descriptor, &site(&square), 1., 1.).unwrap());
        assert_eq!(small.dimensions_m, [3., 4.]);
        assert_eq!(small.attainable_body_area_m2, [12., 30.]);
        assert!(!small.target_met);
        let large = fit(solve_rectangle(&descriptor, &site(&square), 100., 1.).unwrap());
        assert_eq!(large.dimensions_m, [5., 6.]);
        assert!(!large.target_met);
    }
}
