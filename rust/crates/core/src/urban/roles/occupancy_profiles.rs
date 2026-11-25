//! Housing occupancy profiles and population-driven housing shares.

use super::*;

/// One occupancy entry of the service catalogue, read once: the profile when
/// it deserialises, and the provenance and calibration texts it declares.
pub(super) struct OccupancyEntry {
    pub(super) declared: Option<Occupancy>,
    pub(super) provenance: Option<&'static str>,
    pub(super) calibration: Option<&'static str>,
}
pub(super) fn occupancy_table() -> &'static BTreeMap<&'static str, OccupancyEntry> {
    static TABLE: OnceLock<BTreeMap<&'static str, OccupancyEntry>> = OnceLock::new();
    TABLE.get_or_init(|| {
        catalogue()
            .occupancy
            .iter()
            .map(|(family, value)| {
                let entry = OccupancyEntry {
                    declared: serde_json::from_value(value.clone()).ok(),
                    provenance: value.get("provenance").and_then(serde_json::Value::as_str),
                    calibration: value.get("calibration").and_then(serde_json::Value::as_str),
                };
                (family.as_str(), entry)
            })
            .collect()
    })
}
pub fn occupancy(culture: &str) -> Occupancy {
    occupancy_table()
        .get(family(culture))
        .and_then(|entry| entry.declared)
        .unwrap_or(Occupancy {
            household_size: 4.5,
            floor_per_household: 60.0,
            max_per_plot: 4.0,
        })
}

/// Weight of the catalogue's urban household size at a population: 0 up to
/// 2,500 people, 1 from 5,000, smoothstep between (`settlement_occupancy`).
pub fn urban_household_share(population: u32) -> f64 {
    smoothstep((f64::from(population) - 2500.) / 2500.)
}

fn smoothstep(t: f64) -> f64 {
    let t = t.clamp(0., 1.);
    t * t * (3. - 2. * t)
}

/// Weight of the large town house (two or three households under one roof):
/// 0 up to 2,000 people, where every home holds one household, 1 from 4,000.
/// Shared by `programme::household_capacity` and the capacity probe cache key.
pub fn town_house_share(population: u32) -> f64 {
    smoothstep((f64::from(population) - 2000.) / 2000.)
}

/// Weight of the culture's urban floor-area cap (tenements) in a city's dense
/// core: 0 up to 8,000 people, 1 from 40,000. A lot reaches it only near the
/// centre (its access pressure, `programme::household_capacity`); the rest of
/// the town keeps its houses. Also sets the infill margin (`programme::allocate`).
pub fn dense_core_share(population: u32) -> f64 {
    smoothstep((f64::from(population) - 8000.) / 32000.)
}

/// Homes the land plan reserves and the allocation fills per household of the
/// programme: 5 % more in villages, 15 % in towns (from 4,000 people, with the
/// large town house), 30 % in large cities (their dense core). The one source of
/// the housing margin for `footprint::capacity` and `programme::allocate`.
/// Towns also keep the 5 % the land plan's block measure used to add on its
/// own (`TOWN_MEASURE`), blended in from 2,500 to 4,500 people like
/// `homes_per_household`: villages do not get it, town counts stay as calibrated.
pub fn housing_margin(population: u32) -> f64 {
    (1.05 + 0.10 * town_house_share(population) + 0.15 * dense_core_share(population))
        * (1. + (TOWN_MEASURE - 1.) * smoothstep((f64::from(population) - 2500.) / 2000.))
}

/// Margin of the block measure towns are planned with (the former
/// `capacity::MEASURE_MARGIN`, sampling error ≈ 6 % on the capacity sweep).
const TOWN_MEASURE: f64 = 1.05;

/// Homes per household of a village (user choice, 2026-11-16: about 15 % fewer
/// homes in villages, at the same land per home): 0.85 in hamlets and villages
/// up to 2,500 people, rising smoothly to 1 at 4,500. The blend keeps homes per
/// inhabitant from ever rising with population (the household size grows
/// toward the urban one over the same range). An isolated farmstead keeps one
/// household on one farm. Applied once, as persons per domestic unit
/// (`settlement_occupancy`), so the land plan (`footprint::capacity`), the
/// programme and its fill limit (`programme::prepare`/`allocate`), the street
/// villages and hamlets (`kinds::linear`) all count the same homes.
pub fn homes_per_household(population: u32) -> f64 {
    if crate::settlements::demographics::below(population, "hamlet") { return 1.; }
    0.85 + 0.15 * smoothstep((f64::from(population) - 2500.) / 2000.)
}

/// Most landmark buildings an entry keeps below its threshold (`townPop`).
pub(super) const EARLY_SITES: f64 = 3.0;

/// Share of a place's households its housing towers and slabs hold together
/// (`programme::allocate`): 10 % below city size, where most of a tower is
/// offices, shops and landmark and the town lives in its ordinary homes; 0 in
/// a city, whose towers stay as they were.
pub fn tower_home_share(population: u32) -> f64 {
    if crate::settlements::demographics::below(population, "city") { 0.10 } else { 0.0 }
}

/// Persons per domestic unit of a settlement. Small places include single
/// people and couples as well as large families: the household blends back to
/// the catalogue's urban mean between 2,500 and 5,000 people. A village then
/// counts `homes_per_household` homes per household.
pub fn settlement_occupancy(culture: &str, population: u32) -> Occupancy {
    let mut profile = occupancy(culture);
    if population >= 5000 { return profile; }
    // A communal longhouse, or a family's tent or camp hut (tipi, ger, beehive
    // hut, igloo, orc hut), and any camp: the dwelling count is its typology's.
    let preset = &super::super::catalogue()["presets"][format!("{culture}/village")]["params"];
    if matches!(preset["arch"]["typology"].as_str(), Some("longhouse" | "maloca" | "plank-house" | "tipi" | "ger" | "beehive-hut" | "igloo" | "orc-hut"))
        || preset["campLayout"].as_str().is_some_and(|s| !s.is_empty()) {
        return profile;
    }
    // A declared family compound or courtyard house (siheyuan included) is
    // already a whole family's dwelling: it keeps its cultural reference household.
    if !matches!(preset["plotOp"].as_str(), Some("courtyard" | "compound" | "siheyuan")) {
        let urban = urban_household_share(population);
        // 70 % of the urban mean: European 4.5 -> 3.15, industrial 5 -> 3.5,
        // contemporary 3 -> 2.1; extended-family cultures (7-8) keep 4.9-5.
        let rural = (profile.household_size * 0.7).clamp(2., 5.).min(profile.household_size);
        profile.household_size = rural + (profile.household_size - rural) * urban;
    }
    profile.household_size /= homes_per_household(population);
    profile
}
