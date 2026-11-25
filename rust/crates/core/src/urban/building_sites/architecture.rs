//! Architecture culture, overrides, and typical floor counts for a lot.

use super::*;

/// The culture whose building stands on a lot when it is not the lot's own:
/// the request's explicit house mix first (`house_mix`), else the place's
/// style sheet for a home (`houses` facet, `rural` for a farm). The flag
/// tells a style-sheet draw: the lot then builds in that culture's whole
/// tissue (plan, storeys, roofs, materials).
pub(super) fn drawn_culture(architecture_culture: Option<&str>, seed: &str, layout: &Layout, partition: &Partition, parcel: &super::super::Parcel, role: &str, function: &str) -> Option<(String, bool)> {
    let profile = super::super::house_mix::HouseSettings::parse(architecture_culture);
    let block = layout.blocks.get(parcel.block)?;
    if let Some(h) = profile.as_ref().filter(|h| h.buildings.contains_key(&format!("{}/building", parcel.id)) || h.parcels.contains_key(&parcel.id) || h.blocks.contains_key(&parcel.block.to_string()) || h.quarters.contains_key(&block.quarter.to_string())) {
        if let Some(culture) = h.pick(seed, &layout.key, &parcel.id, parcel.block, block.quarter, &block.zone) {
            return Some((culture.to_owned(), true));
        }
    }
    let local = partition.config.as_ref().and_then(|c| c.overrides.parcels.get(&parcel.id)).and_then(|o| o.culture.as_deref())
        .or_else(|| partition.config.as_ref().and_then(|c| c.overrides.blocks.get(&parcel.block.to_string())).and_then(|o| o.culture.as_deref()))
        .or_else(|| layout.config.as_ref().and_then(|c| c.overrides.quarters.get(&block.quarter.to_string())).and_then(|o| o.building_culture.as_deref().or(o.culture.as_deref())));
    if let Some(culture) = local.filter(|c| !c.is_empty() && *c != "site") {
        return Some((culture.to_owned(), true));
    }
    let explicit = super::super::house_mix::HouseSettings::parse(architecture_culture).and_then(|h| {
        let block = layout.blocks.get(parcel.block)?;
        h.pick(seed, &layout.key, &parcel.id, parcel.block, block.quarter, &block.zone).map(str::to_owned)
    });
    if let Some(culture) = explicit {
        return Some((culture, false));
    }
    if !matches!(function, "domestic" | "mixed") {
        return None;
    }
    super::super::forms::sheet::houses(layout, seed, &parcel.id, parcel.block, role.starts_with("dwelling.farm")).map(|c| (c.to_owned(), true))
}

/// Every procedural site, including civic water buildings and shanties, keeps
/// its footprint when a scope changes only the roof or storeys.
pub(super) fn apply_massing_overrides(request: &mut Value, layout: &Layout, partition: &Partition,
    parcel: &super::super::Parcel, architecture_culture: Option<&str>) -> Result<(), String> {
    let quarter = layout.blocks.get(parcel.block).map(|block| block.quarter.to_string());
    let quarter_edit = quarter.as_ref().and_then(|id| layout.config.as_ref()?.overrides.quarters.get(id)?.house_config.as_ref());
    let block_edit = partition.config.as_ref().and_then(|cfg| cfg.overrides.blocks.get(&parcel.block.to_string())).and_then(|edit| edit.house_config.as_ref());
    let parcel_edit = partition.config.as_ref().and_then(|cfg| cfg.overrides.parcels.get(&parcel.id)).and_then(|edit| edit.house_config.as_ref());
    let profile = super::super::house_mix::HouseSettings::parse(architecture_culture);
    let id = request["id"].as_str().ok_or("Missing procedural building identifier")?;
    let keys: Vec<String> = quarter.map(|id| format!("q:{id}")).into_iter()
        .chain([format!("block:{}", parcel.block), format!("p:{}", parcel.id), format!("b:{id}")]).collect();
    let selected = keys.iter().filter_map(|key| profile.as_ref()?.massing.get(key));
    for patch in [quarter_edit, block_edit, parcel_edit].into_iter().flatten().chain(selected).filter(|patch| super::super::massing::is_shape_edit(patch)) {
        let shapes: Vec<super::super::Shape> = serde_json::from_value(request["preview"].clone()).map_err(|error| error.to_string())?;
        super::super::massing::apply_edit(&mut request["programme"]["massing"], &shapes, patch)?;
    }
    Ok(())
}

/// The same hierarchy is used by native consumers and the V2 edit replay.
pub(super) fn inherit_house_config(request: &mut Value, layout: &Layout, partition: &Partition, parcel: &super::super::Parcel) {
    fn merge(target: &mut Value, patch: &Value) {
        if let (Some(target), Some(patch)) = (target.as_object_mut(), patch.as_object()) {
            for (key, value) in patch {
                if value.is_object() { merge(target.entry(key).or_insert_with(|| json!({})), value); }
                else { target.insert(key.clone(), value.clone()); }
            }
        }
    }
    let quarter = layout.blocks.get(parcel.block).and_then(|b| layout.config.as_ref()?.overrides.quarters.get(&b.quarter.to_string())).and_then(|o| o.house_config.as_ref());
    let lot = partition.config.as_ref().and_then(|c| c.overrides.parcels.get(&parcel.id)).and_then(|o| o.house_config.as_ref());
    let block = partition.config.as_ref().and_then(|c| c.overrides.blocks.get(&parcel.block.to_string())).and_then(|o| o.house_config.as_ref());
    if quarter.is_none() && block.is_none() && lot.is_none() { return; }
    for patch in [quarter, block, lot].into_iter().flatten() {
        if patch.get("pack").is_some_and(|pack| *pack != request["config"]["pack"]) && patch.get("recipe").is_none() {
            request["config"]["recipe"] = Value::Null;
            request["config"]["overrides"]["variant"] = Value::Null;
        }
        merge(&mut request["config"], patch);
    }
    if let Some(seed) = lot.and_then(|p| p["seed"].as_str()).or_else(|| block.and_then(|p| p["seed"].as_str())).or_else(|| quarter.and_then(|p| p["seed"].as_str())).map(|s| format!("{s}/{}/building", parcel.id)) {
        request["seed"] = json!(seed);
        request["config"]["seed"] = json!(seed);
    }
    request["config"]["count"] = json!(1);
    request["culture"]["pack"] = request["config"]["pack"].clone();
    request["culture"]["mode"] = request["config"]["mode"].clone();
    request.as_object_mut().unwrap().remove("native_minimum_candidates");
}
/// Discrete native levels from the applied cultural/function profile. The actual
/// recipe range remains authoritative; no height truncation occurs after placement.
pub(super) fn typical_floors(
    culture: &super::super::culture::CultureMapping,
    function: &str,
    population: u32,
    pressure: f64,
) -> u32 {
    let desired = if function == "collective"
        || (matches!(function, "domestic" | "mixed")
            && culture.functional_profile != "communal"
            && population >= 1000
            && pressure > 0.6)
    {
        2
    } else {
        1
    };
    desired.clamp(
        culture.admissibility.floors[0],
        culture.admissibility.floors[1],
    )
}
