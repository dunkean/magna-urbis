//! One physical shaft footprint shared by cell allocation and native access.
use crate::catalogue::{VerticalAccess, VerticalRoute};

pub(crate) fn vertical_footprint(
    kind: VerticalAccess,
    routes: &[VerticalRoute],
    level_height: f64,
) -> (f64, f64) {
    let width = routes
        .iter()
        .map(|route| route.min_width_m)
        .fold(0.9, f64::max);
    let ladder = matches!(kind, VerticalAccess::Ladder | VerticalAccess::RoofHatch)
        && routes.iter().all(|route| {
            matches!(
                route.kind,
                VerticalAccess::Ladder | VerticalAccess::RoofHatch
            )
        });
    (
        width,
        if ladder {
            1.3
        } else {
            (level_height * 0.95).max(2.6)
        },
    )
}
