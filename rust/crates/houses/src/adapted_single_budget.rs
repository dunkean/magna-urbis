//! The inspired constrained operator's physical minima,
//! restricted to improving an already admitted sub-nominal Single rectangle.
//! This is neither a historical dimension nor a placement certificate.
use super::*;

pub(super) fn adapted_axis_minima(
    r: &PlacementRequest,
    resolved: &ResolvedArchitecture,
    source: &crate::catalogue::Parameters,
    nominal: [f64; 2],
) -> Option<[f64; 2]> {
    if !native_ground_preparation_allowed(r, true)
        || r.parcel_fit == Some(false)
        || r.config.as_ref().is_some_and(|c| {
            c.mode != HistoricalMode::HistoricalInspired || c.pack != r.culture.pack
        })
        || !resolved.config.size.is_finite()
        || resolved.config.size <= 0.
        || !crate::morphology::supports(&resolved.parameters)
    {
        return None;
    }
    let aspect = source_aspect_budget::SourceAspectBudget::for_candidate(r, resolved, source)?;
    let shape = crate::morphology::domestic_budget_shape(&resolved.parameters, &resolved.plan).ok()?;
    if shape.passage_m != 0. || shape.court_fraction != 0. {
        return None;
    }
    let body = &resolved.plan.bodies[0];
    if body.parameters.support.kind != SupportKind::Ground
        || body.parameters.support.height_m != [0.; 2]
        || body.z != 0.
        || body.levels.len() != body.parameters.floors[0] as usize
    {
        return None;
    }
    let b = bounds(&body.footprint);
    let actual = [snap(b[2] - b[0]), snap(b[3] - b[1])];
    let physical = crate::morphology::constrained_minimum_domain(&body.parameters);
    let max = [source.width_m[1], source.depth_m[1]].map(|v| v * resolved.config.size * 2.);
    if nominal.iter().chain(physical.iter()).any(|v| !v.is_finite() || *v <= 0.)
        || actual.iter().zip(physical).any(|(a, p)| *a < p)
        || !actual.iter().zip(nominal).any(|(a, n)| *a + GRID_M < n)
        || !aspect.contains(actual, [[physical[0], max[0]], [physical[1], max[1]]])
    {
        return None;
    }
    // The physical minima are already authorized by constrained synthesis.
    // This narrower budget phase additionally never requests an axis below
    // the already admitted whole body's grid dimension. No geometric scaling.
    Some([physical[0].max(actual[0]), physical[1].max(actual[1])])
}
