use magna_urbis_geom::distance;
use magna_urbis_town::harbour::claimable_front;
use serde::{Deserialize, Serialize};

use super::{Point, Settlement, grid::Fields};
use crate::urban::{Surface, regional_harbour_specs};

/// A town's landing disc and its approach from the placed centre.
#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HarbourReservation {
    pub landing: Point,
    pub radius: f64,
    pub corridor_width: f64,
}

impl HarbourReservation {
    pub fn contains(&self, center: Point, point: Point) -> bool {
        self.landing.distance(point) < self.radius
            || distance(point, center, self.landing).0 < self.corridor_width * 0.5
    }

    /// Mark the excluded candidate cells once, for every population band.
    pub(super) fn exclude(&self, f: &Fields, center: Point, cells: &mut [bool]) {
        let pad = self.radius.max(self.corridor_width * 0.5);
        let first = f.index(Point {
            x: center.x.min(self.landing.x) - pad,
            y: center.y.min(self.landing.y) - pad,
        });
        let last = f.index(Point {
            x: center.x.max(self.landing.x) + pad,
            y: center.y.max(self.landing.y) + pad,
        });
        let n = f.r.n;
        for y in first / n..=last / n {
            for x in first % n..=last % n {
                let i = y * n + x;
                cells[i] |= self.contains(center, f.pos(i));
            }
        }
    }
}

pub(super) fn reserved(placed: &[Settlement], point: Point) -> bool {
    placed.iter().any(|town| {
        town.harbour_reservation
            .is_some_and(|claim| claim.contains(town.center, point))
    })
}

pub(super) fn reserve(
    surface: Surface<'_>,
    f: &Fields,
    culture: &str,
    center: Point,
    placed: &[Settlement],
) -> Option<HarbourReservation> {
    let (survey, works) = regional_harbour_specs(culture);
    // The placement raster measures distance to water cells on eight bearings, so leave
    // room for grid alignment and the difference from straight-line distance.
    if surface.geometry.is_none()
        && f.place_dw(f.index(center)) > 1.1 * survey.harbour_reach + 2.0 * f.cell
    {
        return None;
    }
    let front = claimable_front(&surface, center, &survey, &works)?;
    let claim = HarbourReservation {
        landing: front.landing,
        radius: works.reservation_radius,
        corridor_width: works.reservation_corridor_width,
    };
    // Earlier towns keep their sites and claimed landings.
    (!reserved(placed, claim.landing)
        && placed.iter().all(|town| !claim.contains(center, town.center)))
    .then_some(claim)
}
