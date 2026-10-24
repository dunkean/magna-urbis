//! Scalar accounting on FINAL retained level geometry. No construction or fit.
use super::PlanBuilding;
use crate::geometry::{area, difference, unite};
use crate::model::Surface;
use crate::placement::valid_surface;
use crate::programme::{HousingFloorNeed, accounting_close};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum NecessaryHousingAreaStatus { InsufficientGross, NotDisprovedByGross, Unknown }

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HousingFloorOutcome {
    pub version: String,
    pub scope: String,
    pub need_model: HousingFloorNeed,
    pub requested_useful_m2: f64,
    pub gross_floor_m2: Option<f64>,
    pub measurement: String,
    pub inventory_status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub inventory_limitation: Option<String>,
    pub necessary_area_status: NecessaryHousingAreaStatus,
    /// A necessary lower bound inside the declared body-level scope only.
    /// Zero never certifies actual useful area or household capacity.
    pub useful_shortfall_lower_bound_m2: Option<f64>,
    pub actual_useful_m2: Option<f64>,
    pub functional_certification: String,
}

impl HousingFloorOutcome {
    pub(super) fn from_final_plan(need: &HousingFloorNeed, building: &PlanBuilding) -> Self {
        let inventory = gross_floor_inventory(building);
        let (gross, limitation) = match inventory {
            Ok(gross) => (Some(gross), None),
            Err(reason) => (None, Some(reason.to_owned())),
        };
        let status = gross.map_or(NecessaryHousingAreaStatus::Unknown, |gross| {
            if gross < need.requested_m2 { NecessaryHousingAreaStatus::InsufficientGross }
            else { NecessaryHousingAreaStatus::NotDisprovedByGross }
        });
        Self {
            version: "plan-housing-floor-outcome-1".into(),
            scope: "housing_in_body_levels".into(),
            need_model: need.clone(), requested_useful_m2: need.requested_m2,
            gross_floor_m2: gross,
            measurement: "retained_level_footprint_union_per_exact_elevation".into(),
            inventory_status: if gross.is_some() {"retained_plan_levels"} else {"unknown"}.into(),
            inventory_limitation: limitation, necessary_area_status: status,
            useful_shortfall_lower_bound_m2: gross.map(|gross| (need.requested_m2-gross).max(0.)),
            actual_useful_m2: None, functional_certification: "unknown".into(),
        }
    }
}

fn union_parts(parts: &[Surface]) -> Surface {
    if parts.len() == 1 { parts[0].clone() } else { unite(parts) }
}

/// No global level count, nominal dimensions, historical useful_area_m2 scalar,
/// roof, foundation, garden, path, feature or household multiplier is used.
pub(in crate::plans) fn gross_floor_inventory(building: &PlanBuilding) -> Result<f64, &'static str> {
    if building.simplification != "architectural_plan" || building.volumes.is_empty()
        || !valid_surface(&building.footprint) {
        return Err("Missing or unrecognized final PLAN body-level inventory.");
    }
    let mut planes: BTreeMap<u64, Vec<Surface>> = BTreeMap::new();
    let mut body_ids = BTreeSet::new();
    for volume in &building.volumes {
        if !body_ids.insert(&volume.id) || volume.levels.is_empty() || !volume.z_m.is_finite()
            || !volume.wall_height_m.is_finite() || volume.wall_height_m <= 0. {
            return Err("Incomplete or duplicate body-level inventory.");
        }
        let mut previous_top = volume.z_m;
        let mut measured_height = 0.;
        for (index, level) in volume.levels.iter().enumerate() {
            if level.index as usize != index || !level.z_m.is_finite()
                || !level.height_m.is_finite() || level.height_m <= 0.
                || !valid_surface(&level.footprint)
                || !accounting_close(level.z_m, previous_top) {
                return Err("Missing, nonfinite or incoherent retained level geometry.");
            }
            previous_top = level.z_m + level.height_m;
            measured_height += level.height_m;
            // Only the exact native altitude identifies a shared plane.
            // Normalizing signed zero does not merge nearby/split levels.
            let elevation = if level.z_m == 0. { 0. } else { level.z_m };
            planes.entry(elevation.to_bits()).or_default().push(level.footprint.clone());
        }
        if !accounting_close(measured_height, volume.wall_height_m)
            || !accounting_close(previous_top, volume.z_m + volume.wall_height_m) {
            return Err("Retained levels do not cover the declared body height.");
        }
    }
    let merged: Vec<Surface> = planes.into_values().map(|parts| union_parts(&parts)).collect();
    // A missing whole body must not turn an incomplete inventory into a false
    // lower-bound deficit. Require agreement with final retained projection.
    // No geometric tolerance or admission rule is introduced or modified.
    let projected = union_parts(&merged);
    if (!difference(&projected, &building.footprint).is_empty()
        || !difference(&building.footprint, &projected).is_empty())
        && !retained_source_inventory_matches(building) {
        return Err("Retained levels do not reproduce the final body projection exactly.");
    }
    let gross: f64 = merged.iter().map(area).sum();
    if !gross.is_finite() || gross <= 0. { return Err("Unmeasurable retained level union."); }
    Ok(gross)
}

/// Boolean union in local coordinates followed by a rigid transform need not
/// reproduce a union of the transformed vertices bit for bit. The PLAN stores
/// both representations. When the direct projection check fails, require an
/// exact common retained source witness; never accept a geometric epsilon or
/// derive floor area from the source, a nominal footprint or a floor count.
pub(in crate::plans) fn retained_source_inventory_matches(building: &PlanBuilding) -> bool {
    if !building.transform.origin.x.is_finite()
        || !building.transform.origin.y.is_finite()
        || !building.transform.orientation_deg.is_finite()
        || !building.ground_z_m.is_finite() {
        return false;
    }
    let Ok(source) = building.resolved.unpack() else { return false; };
    if source.plan.bodies.len() != building.volumes.len()
        || source.plan.bodies.is_empty()
        || super::super::map_surface(&super::super::body_domain(&source), &building.transform)
            != building.footprint {
        return false;
    }
    for (index, (body, volume)) in source.plan.bodies.iter().zip(&building.volumes).enumerate() {
        let height = crate::engine::body_level_height(body);
        if volume.id != format!("{}:body:{index}", building.id)
            || body.levels.len() != volume.levels.len()
            || body.levels.is_empty()
            || volume.footprint != super::super::map_surface(&body.footprint, &building.transform)
            || volume.z_m != building.ground_z_m + body.z
            || volume.wall_height_m != height * body.levels.len() as f64 {
            return false;
        }
        for (level_index, (local, level)) in body.levels.iter().zip(&volume.levels).enumerate() {
            if level.index as usize != level_index
                || level.footprint != super::super::map_surface(local, &building.transform)
                || level.z_m != building.ground_z_m + body.z + level_index as f64 * height
                || level.height_m != height {
                return false;
            }
        }
    }
    true
}

#[cfg(test)]
#[path = "housing_floor_outcome_tests.rs"]
mod tests;
