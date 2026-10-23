//! One bounded setback for a source-projected Single budget dimension slot.
//! One fixed-dimension translation after the existing front-line guide refused.
//! No hull, new dimension, source draw or native admission in this helper.
use super::*;
use crate::rigid_translation_fit::{TranslationOutcome, TranslationProblem};

const MAX_RIGHTS_VERTICES: usize = 64;
const MAX_FRONT_FRAGMENTS: usize = 64;

pub(super) struct SetbackProposal {
    pub transform: Transform,
    pub constraints: usize,
    pub translation_m: f64,
}

fn bounded_ring(surface: &Surface) -> bool {
    surface.len() == 1
        && surface[0].holes.is_empty()
        && (3..=MAX_RIGHTS_VERTICES).contains(&surface[0].outer.len())
        && surface[0]
            .outer
            .iter()
            .all(|p| p.x.is_finite() && p.y.is_finite())
}

/// This clips RIGHTS, never a house. Keep unrounded boundary coordinates;
/// rectangle() would snap them and could grant up to half a millimetre of land.
/// The reused kernel proves resulting topology and convexity (no hull).
fn rear_rights(surface: &Surface, frame: &Transform, cut: f64) -> Result<Surface, String> {
    if !bounded_ring(surface) {
        return Err(
            "Setback requires one finite rights ring with at most 64 vertices and no holes.".into(),
        );
    }
    let local = map_surface(surface, &inverse(frame));
    let b = bounds(&local);
    if !cut.is_finite() || cut >= b[3] {
        return Err("Setback has no rear rights behind every declared access fragment.".into());
    }
    let clip = vec![Polygon {
        outer: vec![
            Point {
                x: b[0],
                y: cut.max(b[1]),
            },
            Point {
                x: b[2],
                y: cut.max(b[1]),
            },
            Point { x: b[2], y: b[3] },
            Point { x: b[0], y: b[3] },
        ],
        holes: vec![],
    }];
    let rear = intersection(&local, &clip);
    if !bounded_ring(&rear) {
        return Err(
            "Setback rear intersection is disconnected, holed or exceeds 64 vertices.".into(),
        );
    }
    // Intersection construction is sufficient in exact arithmetic. Retain the
    // usual geometric containment check too after the boolean representation.
    if !contains(&local, &rear) {
        return Err("Setback rear intersection escaped the actual rights.".into());
    }
    Ok(rear)
}

/// `long_axis` is the orientation already selected for this existing budget
/// slot from the CURRENT legal polygon's longest edge. The sign is chosen once
/// from the current rights, then frozen. No archived pose or parcel identity.
pub(super) fn propose(
    r: &PlacementRequest,
    prepared: &PreparedPlan<'_>,
    access: &ArchitectureAccess,
    occupied: &Surface,
    long_axis: f64,
) -> Result<Option<SetbackProposal>, String> {
    let resolved = prepared.resolved;
    if access.kind != "public"
        || !long_axis.is_finite()
        || resolved.parameters.layout != crate::catalogue::Layout::Single
        || resolved.plan.bodies.len() != 1
        || !resolved.plan.courts.is_empty()
        || !resolved.plan.paths.is_empty()
        || !resolved.plan.features.is_empty()
        || !bounded_ring(&prepared.body_local)
    {
        return Err("Setback only supports this automatic single-body source-aspect slot and a public access.".into());
    }
    let buildable = difference(&difference(&r.buildable, &r.reserves), occupied);
    let architectural = difference(&difference(&r.cadastral, &r.reserves), occupied);
    // Exactly the native visual roof rights: no invented neighbour roof rights.
    let roof_rights = difference(r.roof_domain.as_ref().unwrap_or(&r.cadastral), &r.reserves);
    if !bounded_ring(&buildable) || !bounded_ring(&architectural) || !bounded_ring(&roof_rights) {
        return Err("Setback exact rights are outside the bounded simple-ring scope.".into());
    }
    let [a, b] = access.segment;
    let origin = Point {
        x: (a.x + b.x) * 0.5,
        y: (a.y + b.y) * 0.5,
    };
    let mut frame = Transform {
        origin,
        orientation_deg: long_axis,
    };
    let local_land = map_surface(&architectural, &inverse(&frame));
    // One deterministic sign, not two trial orientations. For unsupported
    // topology the kernel will refuse, not substitute this mean for rights.
    let side = local_land[0].outer.iter().map(|p| p.y).sum::<f64>();
    if !side.is_finite() || side == 0. {
        return Err("Setback cannot determine the inward sign of the current long edge.".into());
    }
    if side < 0. {
        frame.orientation_deg += 180.;
    }
    let fragments: Vec<_> = r.accesses.iter().filter(|f| f.id == access.id).collect();
    if fragments.is_empty()
        || fragments.len() > MAX_FRONT_FRAGMENTS
        || fragments.iter().any(|f| {
            f.kind != "public"
                || f.segment
                    .iter()
                    .any(|p| !p.x.is_finite() || !p.y.is_finite())
        })
    {
        return Err("Setback frontage fragments exceed their finite/public scope.".into());
    }
    // A common road ID is used ONLY for the rear cut. Admission still receives
    // the selected real segment, never a fabricated bridge between fragments.
    let inv = inverse(&frame);
    let cut = fragments
        .iter()
        .flat_map(|f| f.segment)
        .map(|p| transform_point(p, &inv).y)
        .fold(f64::NEG_INFINITY, f64::max);
    let body_rights = rear_rights(&buildable, &frame, cut)?;
    let occupation_rights = rear_rights(&architectural, &frame, cut)?;
    let roof_rights = rear_rights(&roof_rights, &frame, cut)?;

    let mut occupation_parts = vec![prepared.plan_local.clone()];
    if let Some(entry) = &resolved.entrance {
        occupation_parts.push(entry.passage.clone());
    }
    match prepared.foundation()? {
        crate::engine::FoundationPreparation::Supported(physical) => {
            occupation_parts.extend(physical.occupation_parts.iter().cloned());
        }
        // Exactly the existing visual fallback. This is not an assertion that
        // native supports/entrance are certified when preparation is unsupported.
        crate::engine::FoundationPreparation::Unsupported(_) => {}
    }
    let occupation = unite(&occupation_parts);
    let mut roof_parts = prepared.roofs().to_vec();
    roof_parts.extend(
        resolved
            .plan
            .features
            .iter()
            .filter_map(|f| f.roof.as_ref())
            .map(|r| r.domain.clone()),
    );
    let roof = unite(&roof_parts);
    let envelope = bounds(&unite(&[occupation.clone(), roof.clone()]));
    let body_bounds = bounds(&prepared.body_local);
    // Put the real envelope immediately behind the derived cut and center the
    // body on this real frontage. The kernel computes ONE minimum translation.
    let initial_local = Transform {
        origin: Point {
            x: -(body_bounds[0] + body_bounds[2]) * 0.5,
            y: cut - envelope[1],
        },
        orientation_deg: 0.,
    };
    let body = map_surface(&prepared.body_local, &initial_local);
    let occupation = map_surface(&occupation, &initial_local);
    let roof = map_surface(&roof, &initial_local);
    let fit = match crate::rigid_translation_fit::solve(&TranslationProblem {
        body: &body,
        buildable: &body_rights,
        occupation: &occupation,
        architectural_rights: &occupation_rights,
        roof: &roof,
        roof_rights: &roof_rights,
    }) {
        TranslationOutcome::Fit(fit) => fit,
        TranslationOutcome::EmptyFixedDomains => return Ok(None),
        TranslationOutcome::Unsupported(reason) => return Err(reason),
    };
    let local_origin = Point {
        x: initial_local.origin.x + fit.delta.x,
        y: initial_local.origin.y + fit.delta.y,
    };
    Ok(Some(SetbackProposal {
        transform: Transform {
            origin: transform_point(local_origin, &frame),
            orientation_deg: frame.orientation_deg,
        },
        constraints: fit.constraints,
        translation_m: fit.distance_m,
    }))
}
