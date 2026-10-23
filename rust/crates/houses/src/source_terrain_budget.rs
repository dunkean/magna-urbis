//! A bounded dimension proposal after an ordinary full-size admission failed.
//! Fixed facade centre/orientation, nested whole rectangles, no native layout.
//! A returned proposal still requires the unchanged ordinary site admission.
use super::source_aspect_budget::SourceAspectBudget;
use super::{contains, map_surface, transform_point};
use crate::catalogue::{Layout, SupportKind};
use crate::engine::ResolvedArchitecture;
use crate::geometry::{GRID_M, area, bounds, difference, intersection, rectangle, snap, unite};
use crate::model::{Point, Surface, Transform};
use crate::placement::{ArchitectureAccess, MAX_LEVEL_FOUNDATION_SLOPE_DEG, PlacementRequest};

pub(super) const MAX_EVALUATIONS: usize = 8;

pub(super) struct Proposal {
    pub dimensions: [f64; 2],
    pub transform: Transform,
}

#[derive(Default)]
pub(super) struct Evaluation {
    pub proposal: Option<Proposal>,
    pub evaluations: usize,
}

pub(super) fn supported(resolved: &ResolvedArchitecture, dimensions: [f64; 2]) -> bool {
    let p = &resolved.parameters;
    let Some(body) = resolved.plan.bodies.first() else {
        return false;
    };
    // The native FP-RECT primitive passes through the boolean union even for
    // one body. Its local origin can differ from zero by a few nanometres.
    // This is a recognition bound (1/10,000 of the construction grid), never
    // a geometric snap, a source normalization or a relaxed site constraint.
    const LOCAL_RECTANGLE_ROUNDOFF_M: f64 = GRID_M * 1e-4;
    if dimensions.iter().any(|v| !v.is_finite() || *v <= 0.)
        || body.footprint.iter().flat_map(|p| p.outer.iter().chain(p.holes.iter().flatten()))
            .any(|p| !p.x.is_finite() || !p.y.is_finite())
    { return false; }
    let b = bounds(&body.footprint);
    let reconstructed = rectangle(0., 0., dimensions[0], dimensions[1]);
    p.layout == Layout::Single
        && p.support.kind == SupportKind::Ground
        && p.support.height_m == [0.; 2]
        && body.parameters.support.kind == SupportKind::Ground
        && body.parameters.support.height_m == [0.; 2]
        && p.footprint_family == "FP-RECT"
        && matches!(body.parameters.roof_system.as_str(), "RF-GABLE" | "RF-HIP")
        && resolved.entrance.is_none()
        && resolved.plan.bodies.len() == 1
        && resolved.plan.courts.is_empty()
        && resolved.plan.paths.is_empty()
        && resolved.plan.features.is_empty()
        && body.z == 0.
        && body.voids.is_empty()
        && body.cells.is_empty()
        && !body.levels.is_empty()
        && body.levels.iter().all(|level| level == &body.footprint)
        && body.footprint.len() == 1
        && body.footprint[0].holes.is_empty()
        && body.footprint[0].outer.len() == 4
        && b.iter().zip([0., 0., dimensions[0], dimensions[1]])
            .all(|(actual, expected)| actual.is_finite()
                && (*actual - expected).abs() <= LOCAL_RECTANGLE_ROUNDOFF_M)
        // Both directions remain exact under the native boolean engine. A
        // trapezoid inside the same bounding rectangle is not an eligible body.
        && area(&difference(&body.footprint, &reconstructed)) == 0.
        && area(&difference(&reconstructed, &body.footprint)) == 0.
        && body.parameters.overhang_m[0].is_finite()
        && body.parameters.overhang_m[0] >= 0.
}

/// A lower front (native y=0) is the only supported anchor. The declared
/// access must lie on its outward side: never shrink around an inferred side
/// facade, reflect the house, or change orientation to obtain a terrain pass.
pub(super) fn lower_front(transform: &Transform, dimensions: [f64; 2], access: &ArchitectureAccess) -> bool {
    let front = transform_point(
        Point {
            x: dimensions[0] * 0.5,
            y: 0.,
        },
        transform,
    );
    let angle = transform.orientation_deg.to_radians();
    let inward = [-libm::sin(angle), libm::cos(angle)];
    access
        .segment
        .iter()
        .all(|p| (p.x - front.x) * inward[0] + (p.y - front.y) * inward[1] <= GRID_M)
}

/// All attempts are charged to the caller's GLOBAL evaluation budget. Coverage,
/// quantization and source-range errors return no proposal; they do not prove
/// that another scale, source or pose is impossible.
pub(super) fn reduce(
    r: &PlacementRequest,
    resolved: &ResolvedArchitecture,
    dimensions: [f64; 2],
    pose: &Transform,
    access: &ArchitectureAccess,
    occupied: &Surface,
    aspect: SourceAspectBudget,
    allowed: [[f64; 2]; 2],
    remaining: usize,
) -> Evaluation {
    let mut result = Evaluation::default();
    if remaining == 0
        || !supported(resolved, dimensions)
        || !aspect.contains(dimensions, allowed)
        || !lower_front(pose, dimensions, access)
    {
        return result;
    }
    let remaining = remaining.min(MAX_EVALUATIONS);
    let reduced_allowed = [
        [libm::ceil(allowed[0][0] / GRID_M) * GRID_M, dimensions[0]],
        [libm::ceil(allowed[1][0] / GRID_M) * GRID_M, dimensions[1]],
    ];
    if reduced_allowed
        .iter()
        .any(|range| !range[0].is_finite() || range[0] <= 0. || range[0] > range[1])
    {
        return result;
    }
    let levels = resolved.plan.bodies[0].levels.len();
    let geometry = |dims: [f64; 2]| {
        let shifted = Transform {
            origin: transform_point(
                Point {
                    x: (dimensions[0] - dims[0]) * 0.5,
                    y: 0.,
                },
                pose,
            ),
            orientation_deg: pose.orientation_deg,
        };
        // Same local level union and world transform as PreparedPlan/visual.
        let local = rectangle(0., 0., dims[0], dims[1]);
        let body = map_surface(&unite(&vec![local; levels]), &shifted);
        (body, shifted)
    };
    let mut check = |dims: [f64; 2]| -> Option<bool> {
        if result.evaluations == remaining {
            return None;
        }
        result.evaluations += 1;
        let (body, _) = geometry(dims);
        let (low, high, slope) = r.terrain.foundation_bounds(&body).ok()?;
        Some(
            slope <= MAX_LEVEL_FOUNDATION_SLOPE_DEG
                && high - low <= r.terrain.max_foundation_step_m + 1e-8
                && r.terrain.water_z_m.is_none_or(|water| low >= water - 0.01),
        )
    };
    // Successful ordinary admissions never call this helper. A failure for
    // another reason with adequate terrain keeps the entire old path too.
    if check(dimensions) != Some(false) {
        return result;
    }
    let lower_scale =
        (reduced_allowed[0][0] / dimensions[0]).max(reduced_allowed[1][0] / dimensions[1]);
    if !lower_scale.is_finite() || lower_scale >= 1. {
        return result;
    }
    let quantized = |scale: f64| -> Option<[f64; 2]> {
        // floor(W*s) and both depth bounds are nondecreasing in s; clamping a
        // nondecreasing rounded depth between those bounds preserves nesting.
        let w =
            snap(libm::floor(dimensions[0] * scale / GRID_M) * GRID_M).max(reduced_allowed[0][0]);
        let [lo, hi] = aspect.depth_bounds(w, reduced_allowed)?;
        let d = snap(dimensions[1] * scale).clamp(lo, hi);
        let dims = [w, d];
        aspect.contains(dims, reduced_allowed).then_some(dims)
    };
    let Some(mut best) = quantized(lower_scale) else {
        return result;
    };
    if check(best) != Some(true) {
        return result;
    }
    let (mut low, mut high) = (lower_scale, 1.);
    // Two endpoints plus at most six midpoints, less when the global caller
    // budget was partly consumed by earlier failed proposals.
    for _ in 2..remaining {
        let mid = (low + high) * 0.5;
        let Some(dims) = quantized(mid) else {
            return result;
        };
        match check(dims) {
            Some(true) => {
                low = mid;
                best = dims;
            }
            Some(false) => high = mid,
            None => return result,
        }
    }
    if best == dimensions || !aspect.contains(best.map(snap), allowed) {
        return result;
    }
    let (body, transform) = geometry(best);
    let allowed_body = difference(&r.buildable, &r.reserves);
    let land = difference(&r.cadastral, &r.reserves);
    let roof_rights = difference(r.roof_domain.as_ref().unwrap_or(&r.cadastral), &r.reserves);
    // This narrow gable/hip rectangle is an enclosing roof proposal, never a
    // replacement for the native roof rights check after construction.
    let eave = resolved.plan.bodies[0].parameters.overhang_m[0] + GRID_M;
    let roof = map_surface(
        &rectangle(-eave, -eave, best[0] + 2. * eave, best[1] + 2. * eave),
        &transform,
    );
    if !contains(&allowed_body, &body)
        || !contains(&land, &body)
        || area(&intersection(&body, occupied)) > 0.0001
        || !contains(&roof_rights, &roof)
        || area(&intersection(&roof, occupied)) > 0.0001
    {
        return result;
    }
    result.proposal = Some(Proposal {
        dimensions: best,
        transform,
    });
    result
}
