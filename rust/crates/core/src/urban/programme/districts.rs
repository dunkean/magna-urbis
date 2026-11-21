//! Prepared district roles and wealth, and how they shape dwelling roles.

use crate::urban::{Layout, Parcel, UrbanDistrict, culture::CultureMapping};

use super::BlockEnvironment;

/// District lookup by the allocation's block index, using the prepared environment.
pub(super) struct ParcelDistricts<'a> {
    districts: &'a [UrbanDistrict],
    block_district: Vec<Option<usize>>,
}

impl<'a> ParcelDistricts<'a> {
    pub(super) fn new(layout: &'a Layout, environment: &[BlockEnvironment]) -> Self {
        let districts = layout
            .structure
            .as_ref()
            .map_or(&[][..], |s| s.districts.as_slice());
        let block_district = environment.iter().map(|e| e.district).collect();
        Self { districts, block_district }
    }

    pub(super) fn of(&self, p: &Parcel) -> Option<&'a UrbanDistrict> {
        self.block_district
            .get(p.block)
            .copied()
            .flatten()
            .and_then(|i| self.districts.get(i))
    }
}

pub(super) fn farm_share(population: u32, pressure: f64, id: &str) -> bool {
    let base = if population < 150 { 0.7 } else { 0.45 };
    let chance = base * (1.35 - 0.7 * pressure.clamp(0.0, 1.0));
    crate::rng::Rng::new(id).fork("farmstead").chance(chance.clamp(0.0, 1.0))
}
/// Dwelling type from the native layout, its households and the district.
pub(super) fn dwelling_role(
    c: &CultureMapping,
    households: f64,
    area: f64,
    district: Option<(&str, f64)>,
    village: Option<bool>,
) -> String {
    if let Some((role, wealth)) = district
        && role == "elite"
    {
        return if wealth >= 0.65 && area >= 350.0 {
            "dwelling.mansion"
        } else {
            "dwelling.townhouse"
        }
        .into();
    }
    if households >= 3.0 {
        return "dwelling.tenement".into();
    }
    let layout = c.admissibility.native_layout.as_str();
    // A village house on a large plot may be a farm: dwelling, barn and yard.
    if village == Some(true) && area >= 500.0 && !matches!(layout, "hut_compound" | "kraal" | "platform") {
        return "dwelling.farm".into();
    }
    match layout {
        "strip" => "dwelling.row",
        "courtyard" | "siheyuan" | "atrium" => "dwelling.courtyard",
        "hut_compound" | "kraal" | "kancha" | "multiyard" => "dwelling.compound",
        "platform" => "dwelling.platform",
        _ => "dwelling.house",
    }
    .into()
}
