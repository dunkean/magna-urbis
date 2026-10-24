//! An explicit allocation-model allowance, not a measured housing standard.
//! This metadata never changes allocation, population, massing or admission.
use super::{catalogue, family, occupancy};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HousingFloorModel {
    pub family: String, pub profile_provenance: String, pub calibration: String,
    pub floor_m2_per_household: f64, pub wealth: f64, pub wealth_factor: f64,
    pub effective_floor_m2_per_household: f64, pub persons_per_household: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct HousingFloorNeed {
    pub version: String, pub unit: String, pub scope: String,
    pub requested_m2: f64, pub allocated_households: f64, pub basis: String,
    pub model: HousingFloorModel,
}

pub(crate) fn indicative_housing_floor_need(culture: &str, households: f64, wealth: f64) -> Option<HousingFloorNeed> {
    if !households.is_finite() || households <= 0. || !wealth.is_finite() {
        return None;
    }
    let profile = occupancy(culture);
    if !profile.floor_per_household.is_finite() || profile.floor_per_household <= 0.
        || !profile.household_size.is_finite() || profile.household_size <= 0. {
        return None;
    }
    let wealth = wealth.clamp(0., 1.);
    let factor = 0.7 + 0.8 * wealth;
    let effective = profile.floor_per_household * factor;
    let requested = households * effective;
    if !requested.is_finite() || requested <= 0. { return None; }
    let family = family(culture);
    let source = catalogue().occupancy.get(family);
    let declared = source.and_then(|value| serde_json::from_value::<super::Occupancy>(value.clone()).ok()).is_some();
    let text = |key: &str, fallback: &str| {
        source.and_then(|value| value.get(key)).and_then(Value::as_str).unwrap_or(fallback).to_owned()
    };
    serde_json::from_value(json!({
        "version":"indicative-housing-floor-1", "unit":"useful_floor_m2",
        "scope":"housing_in_body_levels", "requested_m2":requested,
        "allocated_households":households,
        "basis":"allocation_households_times_wealth_scaled_floor_allowance",
        "model":{
            "family":family,
            "profile_provenance":text("provenance", if declared {"catalogue-declared"} else {"generic-fallback"}),
            "calibration":text("calibration", if declared {"not-assessed"} else {"not-culture-calibrated"}),
            "floor_m2_per_household":profile.floor_per_household,
            "wealth":wealth, "wealth_factor":factor,
            "effective_floor_m2_per_household":effective,
            "persons_per_household":profile.household_size
        }
    })).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn housing_floor_need_core_exact_allocation_and_generic_provenance() {
        let frozen = indicative_housing_floor_need("javanese-courts", 3., 0.25).unwrap();
        if let Ok(path) = std::env::var("CORE_HOUSING_FLOOR_NEED_OUT") {
            std::fs::write(path, serde_json::to_vec_pretty(&frozen).unwrap()).unwrap();
        }
        let need = serde_json::to_value(frozen).unwrap();
        assert_eq!(need["allocated_households"], 3.);
        assert!((need["requested_m2"].as_f64().unwrap() - 162.).abs() < 1e-12);
        assert_eq!(need["model"]["wealth"], 0.25);
        assert_eq!(need["model"]["profile_provenance"], "generic-compatibility-defaults");
        assert_eq!(need["model"]["calibration"], "not-culture-calibrated");
        assert_eq!(need["unit"], "useful_floor_m2");
        assert_eq!(need["scope"], "housing_in_body_levels");
        assert!(need.get("housed_households").is_none());
        assert!(need.get("built_area_m2").is_none());
    }

    #[test]
    fn housing_floor_need_core_fractional_allocation_is_not_replaced_by_display_rounding() {
        let need = serde_json::to_value(indicative_housing_floor_need("javanese-courts", 2.345, 0.25).unwrap()).unwrap();
        assert_eq!(need["allocated_households"], 2.345);
        assert!((need["requested_m2"].as_f64().unwrap() - 2.345*54.).abs() < 1e-12);
        for value in [0., -1., f64::NAN, f64::INFINITY] {
            assert!(indicative_housing_floor_need("javanese-courts", value, 0.25).is_none());
        }
        assert!(indicative_housing_floor_need("javanese-courts", 3., f64::NAN).is_none());
    }
}
