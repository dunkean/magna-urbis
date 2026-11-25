//! The programme and frontage fields carried by each building site.

use super::*;

/// Optional district role/wealth per quarter, read through serde so the stage
/// works with and without the roles contract (`structure.districts[i].role`).
pub(super) fn district_programmes(layout: &Layout) -> BTreeMap<usize, (String, Option<f64>)> {
    let mut out = BTreeMap::new();
    for district in layout.structure.iter().flat_map(|s| &s.districts) {
        let value = serde_json::to_value(district).unwrap_or(Value::Null);
        let role = value["role"].as_str().unwrap_or("").to_owned();
        let wealth = value["wealth"].as_f64();
        for &q in &district.quarters {
            out.insert(q, (role.clone(), wealth));
        }
    }
    out
}
/// Default building role when the programme stage did not assign one.
fn default_role(function: &str) -> &'static str {
    match function {
        "domestic" => "dwelling",
        "mixed" => "commerce.shop",
        "workshop" => "craft.workshop",
        "warehouse" => "commerce.warehouse",
        "collective" => "civic",
        "market" => "commerce.market",
        "common" => "open.common",
        _ => "dwelling",
    }
}
/// `programme` of a request: allocation role/landmark when present, the
/// district role and wealth of its quarter, else wealth from occupation pressure.
pub(super) fn programme_of(
    allocation: &super::super::programme::Allocation,
    parcel: &Parcel,
    layout: &Layout,
    districts: &BTreeMap<usize, (String, Option<f64>)>,
) -> Value {
    let value = serde_json::to_value(allocation).unwrap_or(Value::Null);
    let role = value["role"]
        .as_str()
        .filter(|r| !r.is_empty())
        .unwrap_or(default_role(&allocation.function));
    let landmark = value["landmark"].as_bool().unwrap_or(false);
    let district = layout
        .blocks
        .get(parcel.block)
        .and_then(|b| districts.get(&b.quarter));
    let wealth = district
        .and_then(|d| d.1)
        .unwrap_or(parcel.pressure)
        .clamp(0.0, 1.0);
    // Empty buildings are flagged: a ruin previews broken walls, an abandoned
    // building keeps its masses.
    let state = if role.ends_with(".ruin") {
        Some("ruin")
    } else if role.ends_with(".abandoned") {
        Some("abandoned")
    } else {
        None
    };
    let mut programme = json!({"role":role,"district_role":district.map_or("", |d| d.0.as_str()),
        "wealth":wealth,"landmark":landmark});
    // Households the city allocates to this plot (compounds and tenements hold
    // several). Descriptive metadata for the houses side, not a certified capacity:
    // it does not size the bodies yet (CODEX_JAVANESE_HOUSES.md).
    if allocation.households > 0.0 && allocation.households.is_finite() {
        programme["households"] = json!((allocation.households * 100.0).round() / 100.0);
        // Copy only a model frozen by the actual allocator. In particular,
        // an old saved allocation never receives today's catalogue model.
        if matches!(allocation.function.as_str(), "domestic" | "mixed")
            && let Some(need) = &allocation.housing_floor_need {
            programme["housing_floor_need"] = json!(need);
        }
    }
    if let Some(state) = state {
        programme["state"] = json!(state);
    }
    programme
}
/// Wished architectural composition, from the programme role first, then the
/// occupation kind the city chose for the lot.
pub(super) fn composition_of(role: &str, kind: Option<super::super::parcels::OccupationKind>) -> &'static str {
    use super::super::parcels::OccupationKind as K;
    let family = role.split('.').next().unwrap_or("");
    match (family, role) {
        ("worship", _) => "religious",
        ("civic", _) => "civic",
        ("defence", _) => "defence",
        (_, r) if r.starts_with("commerce.inn") || r.starts_with("commerce.caravanserai") => "inn",
        (_, r) if r.starts_with("dwelling.farm") => "farm",
        ("storage", _) => "hall",
        (_, r) if r.starts_with("commerce.market") || r.starts_with("commerce.hall") => "hall",
        _ => match kind {
            Some(K::Row) => "row",
            Some(K::Court | K::Hanok | K::Yashiki) => "courtyard",
            // Only reached for an empty preview: the wished block-front body.
            Some(K::Insula) => "row",
            Some(K::Farm) => "farm",
            Some(K::Pavilions | K::Round | K::Long) => "compound",
            Some(K::Hall | K::Warehouse) => "hall",
            Some(K::Detached | K::Open) | None => "detached",
        },
    }
}
/// Street-wall continuity wished for a composition (1 = full street front).
pub(super) fn frontage_continuity(composition: &str) -> f64 {
    match composition {
        "row" => 1.0,
        "courtyard" | "civic" | "inn" => 0.85,
        "hall" | "religious" => 0.6,
        "compound" => 0.5,
        "detached" => 0.3,
        "farm" | "defence" => 0.2,
        _ => 0.0,
    }
}
