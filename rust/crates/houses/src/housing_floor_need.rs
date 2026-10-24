//! Optional indicative useful-floor allowance carried from the allocation.
//! Validation is scalar accounting only; no admission/EPS or dimension control.
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HousingFloorModel {
    pub family: String,
    pub profile_provenance: String,
    pub calibration: String,
    pub floor_m2_per_household: f64,
    pub wealth: f64,
    pub wealth_factor: f64,
    pub effective_floor_m2_per_household: f64,
    pub persons_per_household: f64,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HousingFloorNeed {
    pub version: String,
    pub unit: String,
    pub scope: String,
    pub requested_m2: f64,
    pub allocated_households: f64,
    pub basis: String,
    pub model: HousingFloorModel,
}

/// A bounded relative allowance for valid f64 arithmetic/JSON roundtrips.
/// This has no relationship to a geometric or physical admission tolerance.
pub(crate) fn accounting_close(a: f64, b: f64) -> bool {
    a.is_finite() && b.is_finite()
        && (a-b).abs() <= 64. * f64::EPSILON * a.abs().max(b.abs()).max(1.)
}

impl HousingFloorNeed {
    pub(crate) fn validate(&self, reported_households: Option<f64>) -> Result<(), String> {
        let invalid = || "Invalid programme.housing_floor_need: unrecognized or inconsistent indicative useful-floor model.".to_string();
        if self.version != "indicative-housing-floor-1" || self.unit != "useful_floor_m2"
            || self.scope != "housing_in_body_levels"
            || self.basis != "allocation_households_times_wealth_scaled_floor_allowance" {
            return Err(invalid());
        }
        let m = &self.model;
        if [&m.family, &m.profile_provenance, &m.calibration].iter().any(|s| s.is_empty() || s.len() > 256)
            || [self.requested_m2, self.allocated_households, m.floor_m2_per_household,
                m.wealth_factor, m.effective_floor_m2_per_household, m.persons_per_household]
                .iter().any(|value| !value.is_finite() || *value <= 0.)
            || !m.wealth.is_finite() || !(0.0..=1.0).contains(&m.wealth) {
            return Err(invalid());
        }
        let Some(households) = reported_households else { return Err(invalid()); };
        // Core historically rounds only programme.households to 0.01. The
        // model preserves the original allocation; do not replace its quantity.
        // Test the existing decimal rounding cell, not round(allocation): a
        // valid JSON roundtrip may move an exact half-cent boundary by 1 ulp.
        let grid = (households * 100.).round() / 100.;
        let roundoff = 64. * f64::EPSILON * households.abs().max(self.allocated_households.abs()).max(1.);
        let old_display_rounding = accounting_close(households, grid)
            && (households-self.allocated_households).abs() <= 0.005 + roundoff;
        if !(accounting_close(households, self.allocated_households) || old_display_rounding)
            || !accounting_close(m.wealth_factor, 0.7 + 0.8*m.wealth)
            || !accounting_close(m.effective_floor_m2_per_household, m.floor_m2_per_household*m.wealth_factor)
            || !accounting_close(self.requested_m2, self.allocated_households*m.effective_floor_m2_per_household) {
            return Err(invalid());
        }
        Ok(())
    }
}
