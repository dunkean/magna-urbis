//! Additive PLAN accounting only. This module neither plans nor certifies a
//! house. Call only after the final retained building has been selected.
use super::{PlanBuilding, PlacementRequest, area};
use serde::{Deserialize, Serialize};
#[path = "housing_floor_outcome.rs"]
pub(in crate::plans) mod housing_floor_outcome;
pub use housing_floor_outcome::{HousingFloorOutcome, NecessaryHousingAreaStatus};

const VERSION: &str = "plan-programme-outcome-1";
const TOLERANCE: f64 = 0.10;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BodyFootprintAttainment {
    NotRequested,
    WithinTolerance,
    Deficit,
    Excess,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct BodyFootprintOutcome {
    /// Projected footprint target, never floor/parcel/roof area.
    pub requested_m2: Option<f64>,
    /// Area of final PlanBuilding.footprint, the authoritative retained union
    /// of actual body/level footprints. No nominal parameter or room multiplier.
    pub actual_m2: f64,
    pub tolerance_fraction: f64,
    /// This status concerns the area target ONLY, not the whole programme.
    pub attainment: BodyFootprintAttainment,
    /// Exact numeric gap, even when it lies inside the attainment tolerance.
    /// None without a requested target; no fabricated zero target.
    pub deficit_m2: Option<f64>,
    pub excess_m2: Option<f64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum HouseholdCapacityStatus { Unknown }

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HouseholdProgrammeOutcome {
    pub requested: Option<f64>,
    /// Always None in this PLAN report. Neither a request nor domestic_units=0
    /// proves a measured housed count. Explicit null means unknown, not zero.
    pub housed: Option<f64>,
    pub capacity_status: HouseholdCapacityStatus,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct PlanProgrammeOutcome {
    pub version: String,
    pub body_footprint: BodyFootprintOutcome,
    pub households: HouseholdProgrammeOutcome,
    /// Absent without an explicitly transmitted model; old reports stay exact.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub housing_floor: Option<HousingFloorOutcome>,
}

impl PlanProgrammeOutcome {
    pub(super) fn from_final_plan(r: &PlacementRequest, b: &PlanBuilding) -> Self {
        Self::from_programme(r.programme.as_ref(),b)
    }
    pub(in crate::plans) fn from_programme(programme: Option<&crate::programme::ArchitectureProgramme>, b: &PlanBuilding) -> Self {
        // PlanBuilding.footprint is the retained world union already produced
        // by native planning. Reusing it adds no boolean/reconstruction pass and
        // never changes admission, geometry, selection, diagnostics or archives.
        let actual = area(&b.footprint);
        let target = programme.and_then(|p| p.built_area_m2);
        let (attainment, deficit, excess) = if let Some(target) = target {
            let delta = actual - target;
            // Inclusive +/-10%, without division or ratio overflow. Inputs have
            // already passed the normal request and geometry validation.
            let status = if delta.abs() <= target * TOLERANCE {
                BodyFootprintAttainment::WithinTolerance
            } else if delta < 0. {
                BodyFootprintAttainment::Deficit
            } else {
                BodyFootprintAttainment::Excess
            };
            (status, Some((-delta).max(0.)), Some(delta.max(0.)))
        } else {
            (BodyFootprintAttainment::NotRequested, None, None)
        };
        Self {
            version: VERSION.into(),
            body_footprint: BodyFootprintOutcome { requested_m2: target,
                actual_m2: actual, tolerance_fraction: TOLERANCE, attainment,
                deficit_m2: deficit, excess_m2: excess },
            housing_floor: programme.and_then(|p| p.housing_floor_need.as_ref())
                .map(|need| HousingFloorOutcome::from_final_plan(need, b)),
            households: HouseholdProgrammeOutcome {
                requested: programme.and_then(|p| p.households),
                housed: None, capacity_status: HouseholdCapacityStatus::Unknown,
            },
        }
    }
}

#[cfg(test)]
#[path = "plan_programme_outcome_tests.rs"]
mod tests;
