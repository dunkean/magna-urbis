//! Catalogue completeness and exact numerical compatibility only.
//! These tests do not certify a housing standard or a native capacity.
use super::*;
use serde_json::Value;

fn legacy() -> Value {
    serde_json::from_str(include_str!("../../tests/fixtures/occupancy-before-insular-explicit.json")).unwrap()
}

fn same_bits(actual: Occupancy, expected: Occupancy) {
    assert_eq!(actual.household_size.to_bits(), expected.household_size.to_bits());
    assert_eq!(actual.floor_per_household.to_bits(), expected.floor_per_household.to_bits());
    assert_eq!(actual.max_per_plot.to_bits(), expected.max_per_plot.to_bits());
}

#[test]
fn occupancy_profile_every_mapped_family_has_an_explicit_positive_entry() {
    let cat = catalogue();
    for (culture, family) in &cat.cultures {
        let value = cat.occupancy.get(family).unwrap_or_else(|| panic!("{culture}: missing {family}"));
        let profile: Occupancy = serde_json::from_value(value.clone()).unwrap();
        assert!(profile.household_size.is_finite() && profile.household_size > 0.);
        assert!(profile.floor_per_household.is_finite() && profile.floor_per_household > 0.);
        assert!(profile.max_per_plot.is_finite() && profile.max_per_plot >= 1.);
    }
}

#[test]
fn occupancy_profile_all_cultures_remain_bit_exact_to_previous_resolution() {
    let before = legacy();
    for (culture, family) in before["cultures"].as_object().unwrap() {
        let source = before["occupancy"].get(family.as_str().unwrap()).unwrap_or(&before["fallback"]);
        let expected: Occupancy = serde_json::from_value(source.clone()).unwrap();
        same_bits(occupancy(culture), expected);
    }
    // Unknown culture continues to use the existing explicit fantasy family.
    same_bits(occupancy("unknown-compatibility-culture"),
        serde_json::from_value(before["occupancy"]["fantasy"].clone()).unwrap());
}

#[test]
fn occupancy_profile_insular_is_explicitly_generic_and_uncalibrated() {
    let cat = catalogue();
    assert_eq!(family("javanese-courts"), "insular");
    let entry = &cat.occupancy["insular"];
    assert_eq!(entry["provenance"], "generic-compatibility-defaults");
    assert_eq!(entry["calibration"], "not-culture-calibrated");
    same_bits(occupancy("javanese-courts"), Occupancy {
        household_size: 4.5, floor_per_household: 60., max_per_plot: 4.,
    });
}

#[test]
fn occupancy_profile_c1358_mass_wish_allocation_and_useful_allowance_are_separate() {
    let fixture: Value = serde_json::from_str(include_str!("../../tests/fixtures/occupancy-c1358-origin.json")).unwrap();
    let request = &fixture["request"];
    let preview: Vec<crate::urban::Shape> = serde_json::from_value(request["preview"].clone()).unwrap();
    let area = preview.iter().map(crate::urban::geometry::area).sum::<f64>();
    assert_eq!((area * 10.).round() / 10., 617.9);
    assert_eq!(request["programme"]["built_area_m2"], 617.9);
    assert_eq!(request["programme"]["households"], 3);
    assert_eq!(fixture["allocation"]["households"], 3.);
    assert_eq!(fixture["population"], 100000);
    let profile = occupancy("javanese-courts");
    let wealth = fixture["allocation"]["wealth"].as_f64().unwrap();
    let per = profile.floor_per_household * (0.7 + 0.8 * wealth);
    assert!((per - 54.).abs() < 1e-12);
    assert!((3. * per - 162.).abs() < 1e-12);
    // 162 is an implied indicative useful-floor allowance in the allocator,
    // not the native footprint target and not a measured housed capacity.
    assert_ne!(3. * per, request["programme"]["built_area_m2"].as_f64().unwrap());
    assert!(fixture["retained_native_facts"]["housed_households"].is_null());
    assert_eq!(fixture["retained_native_facts"]["capacity_status"], "unknown");
}
