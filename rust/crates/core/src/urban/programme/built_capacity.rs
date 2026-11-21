//! Validation and accounting for realised buildings, refusals and open ground.

use crate::urban::{Parcel, Partition, Shape, geometry::{area, difference}, warnings};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

use super::{Allocation, UrbanProgramme};

/// A declaration transported from an actual open Core request, not a proof of
/// terrain impossibility and never an architectural capacity certificate.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct BuiltDeficit {
    pub version: String,
    pub request_id: String,
    pub demand_id: String,
    pub original_function: String,
    pub role: String,
    pub cause: String,
    pub households: f64,
    pub message: String,
}

type AppliedOutcome<'a> = (&'a Allocation, &'a Parcel, &'a UrbanProgramme);
fn applied_outcomes(partitions: &[Partition]) -> Result<BTreeMap<&str, AppliedOutcome<'_>>, String> {
    let mut applied = BTreeMap::new();
    for partition in partitions {
        if let Some(programme) = &partition.programme {
            let parcels = partition.parcels.iter().map(|p| (p.id.as_str(), p)).collect::<BTreeMap<_, _>>();
            for allocation in &programme.allocations {
                let parcel = *parcels.get(allocation.parcel_id.as_str()).ok_or("Applied allocation has no cadastral parcel")?;
                if applied.insert(allocation.parcel_id.as_str(), (allocation, parcel, programme)).is_some() {
                    return Err("Applied allocations must be unique per parcel".into());
                }
            }
        }
    }
    Ok(applied)
}

fn validate_open_deficit(allocation: &Allocation, programme: &UrbanProgramme, space: &BuiltOpenSpace, deficit: &BuiltDeficit) -> Result<(), String> {
    let demand = programme.demands.iter().find(|d| d.id == allocation.demand_id).ok_or("Architectural deficit has no retained demand")?;
    if deficit.version != "architectural-deficit-1"
        || deficit.request_id.is_empty() || space.id.as_deref() != Some(deficit.request_id.as_str())
        || deficit.demand_id != allocation.demand_id || deficit.original_function != allocation.function
        || !matches!(allocation.function.as_str(), "domestic" | "mixed" | "workshop" | "warehouse" | "collective")
        || deficit.role.is_empty() || deficit.role != allocation.role
        || !(demand.role == allocation.role || demand.role == "dwelling"
            && allocation.function == "domestic" && allocation.role.starts_with("dwelling."))
        || demand.function != allocation.function || demand.unit != allocation.unit
        || !matches!(deficit.cause.as_str(), "pente" | "forme" | "source_absente")
        || deficit.message.trim().is_empty() || !deficit.households.is_finite() || deficit.households < 0.
        || !allocation.households.is_finite() || allocation.households < 0.
        || deficit.households != allocation.households {
        return Err("Architectural deficit identity, origin, role, function or quantity differs from its applied allocation and demand".into());
    }
    Ok(())
}

/// Join three retained facts: actual Core open request, actual Houses open
/// outcome, and its applied allocation/demand. An allocation alone cannot create
/// a deficit. This transports an existing declaration; it reruns no feasibility
/// test and changes no geometry, requested programme or capacity.
pub fn carry_open_deficits(partitions: &[Partition], scene: &BuiltScene, requests: &[serde_json::Value]) -> Result<BuiltScene, String> {
    let applied = applied_outcomes(partitions)?;
    let mut source = BTreeMap::new();
    for request in requests {
        let parcel = request["parcel_id"].as_str().ok_or("Deficit source request has no parcel identity")?;
        if source.insert(parcel, request).is_some() { return Err("Deficit source requests must be unique per parcel".into()); }
    }
    let mut carried = scene.clone();
    for space in &mut carried.open_spaces {
        let (allocation, _, programme) = applied.get(space.parcel_id.as_str()).ok_or("Open space has no applied allocation")?;
        if matches!(allocation.function.as_str(), "market" | "common") {
            if space.deficit.is_some() { return Err("An intended open allocation cannot claim an architectural deficit".into()); }
            continue;
        }
        let request = *source.get(space.parcel_id.as_str()).ok_or("Open architectural deficit requires its actual Core source request")?;
        let request_id = request["id"].as_str().ok_or("Deficit source request has no architectural identity")?;
        let p = &request["programme"];
        let d = &p["deficit"];
        if request["function"].as_str() != Some("open_space") || space.id.as_deref() != Some(request_id)
            || p["role"].as_str() != Some(allocation.role.as_str()) {
            return Err("Open outcome does not match its actual deficit source request".into());
        }
        let deficit = BuiltDeficit {
            version: "architectural-deficit-1".into(), request_id: request_id.into(),
            demand_id: allocation.demand_id.clone(), original_function: allocation.function.clone(), role: allocation.role.clone(),
            cause: d["cause"].as_str().ok_or("Actual Core request has no architectural deficit cause")?.into(),
            households: d["households"].as_f64().ok_or("Actual Core deficit has no allocated household quantity")?,
            message: d["message"].as_str().ok_or("Actual Core deficit has no message")?.into(),
        };
        validate_open_deficit(allocation, programme, space, &deficit)?;
        if deficit.cause == "source_absente" {
            let coverage = &p["source_coverage"];
            if coverage["version"] != "functional-source-coverage-1" || coverage["status"] != "missing"
                || coverage["role"].as_str() != Some(allocation.role.as_str())
                || coverage["function"].as_str() != Some(allocation.function.as_str())
                || coverage["functional_footing_tested"] != false
                || coverage["residential_fallback_is_functional_source"] != false {
                return Err("Missing functional source deficit requires its actual coverage declaration, not a residential footing inference".into());
            }
        }
        if space.deficit.as_ref().is_some_and(|old| old != &deficit) {
            return Err("Stored architectural deficit differs from its actual source request".into());
        }
        space.deficit = Some(deficit);
    }
    Ok(carried)
}

/// Only accepted architectural results contribute to completed capacity. This
/// coarse boundary deliberately does not depend on the houses crate or renderer.
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BuiltCapacity {
    pub parcel_id: String,
    pub function: String,
    pub useful_area_m2: f64,
    pub domestic_units: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BuiltRefusal {
    pub parcel_id: String,
    pub message: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BuiltOpenSpace {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    pub parcel_id: String,
    pub surface: Vec<Shape>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deficit: Option<BuiltDeficit>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct BuiltScene {
    pub buildings: Vec<BuiltCapacity>,
    pub refusals: Vec<BuiltRefusal>,
    pub open_spaces: Vec<BuiltOpenSpace>,
}

pub fn reconcile_built(
    partitions: &[Partition],
    scene: &BuiltScene,
) -> Result<Vec<Partition>, String> {
    let applied = applied_outcomes(partitions)?;
    let buildings = scene
        .buildings
        .iter()
        .map(|b| (b.parcel_id.as_str(), b))
        .collect::<BTreeMap<_, _>>();
    let refusals = scene
        .refusals
        .iter()
        .map(|r| (r.parcel_id.as_str(), r))
        .collect::<BTreeMap<_, _>>();
    let mut identities = BTreeSet::new();
    for building in &scene.buildings {
        if !identities.insert(building.parcel_id.as_str())
            || !building.useful_area_m2.is_finite()
            || building.useful_area_m2 < 0.0
            || !building.domestic_units.is_finite()
            || building.domestic_units < 0.0
        {
            return Err(
                "Accepted building capacities must be finite, nonnegative and unique per parcel"
                    .into(),
            );
        }
        let (allocation, _, _) = applied
            .get(building.parcel_id.as_str())
            .ok_or("Accepted building has no applied allocation")?;
        if building.function != allocation.function
            || matches!(allocation.function.as_str(), "market" | "common")
        {
            return Err("Built function differs from applied allocation".into());
        }
    }
    for refusal in &scene.refusals {
        if !identities.insert(refusal.parcel_id.as_str())
            || !applied.contains_key(refusal.parcel_id.as_str())
        {
            return Err("Building/refusal outcomes must be unique and allocated".into());
        }
    }
    let mut open_areas = BTreeMap::new();
    let mut open_deficits = BTreeMap::new();
    for space in &scene.open_spaces {
        if !identities.insert(space.parcel_id.as_str()) {
            return Err("Open outcomes must be unique per parcel".into());
        }
        let (allocation, parcel, programme) = applied
            .get(space.parcel_id.as_str())
            .ok_or("Open space has no applied allocation")?;
        if matches!(allocation.function.as_str(), "market" | "common") {
            if space.deficit.is_some() {
                return Err("An intended open allocation cannot claim an architectural deficit".into());
            }
        } else {
            let deficit = space.deficit.as_ref().ok_or("Open space does not match an applied open function")?;
            validate_open_deficit(allocation, programme, space, deficit)?;
            open_deficits.insert(space.parcel_id.as_str(), deficit);
        }
        if space.surface.is_empty()
            || space.surface.iter().any(|shape| {
                shape.outer.len() < 3
                    || shape.holes.iter().any(|h| h.len() < 3)
                    || shape
                        .outer
                        .iter()
                        .chain(shape.holes.iter().flatten())
                        .any(|p| !p.x.is_finite() || !p.y.is_finite())
            })
        {
            return Err("Invalid open capacity surface".into());
        }
        let total = space.surface.iter().map(area).sum::<f64>();
        let merged = crate::urban::geometry::union(&space.surface)
            .iter()
            .map(area)
            .sum::<f64>();
        let outside = space
            .surface
            .iter()
            .flat_map(|shape| difference(shape, &parcel.shape))
            .map(|shape| area(&shape))
            .sum::<f64>();
        let tolerance = 1e-4_f64.max(total * 1e-8);
        if !total.is_finite() || total - merged > tolerance || outside > tolerance {
            return Err(
                "Open capacity must be disjoint and remain inside its applied parcel".into(),
            );
        }
        if !open_deficits.contains_key(space.parcel_id.as_str()) {
            open_areas.insert(space.parcel_id.as_str(), merged);
        }
    }
    let mut result = partitions.to_vec();
    for partition in &mut result {
        let Some(programme) = &mut partition.programme else {
            continue;
        };
        for demand in &mut programme.demands {
            demand.built_capacity = 0.0;
            demand.open_capacity = 0.0;
            demand
                .reasons
                .retain(|reason| !reason.starts_with("Building refusal: ")
                    && !reason.starts_with("Architectural deficit: "));
        }
        for allocation in &programme.allocations {
            let Some(demand) = programme
                .demands
                .iter_mut()
                .find(|d| d.id == allocation.demand_id)
            else {
                continue;
            };
            if let Some(building) = buildings.get(allocation.parcel_id.as_str()) {
                if building.function != allocation.function {
                    return Err("Built function differs from applied allocation".into());
                }
                demand.built_capacity += if demand.unit == "domesticUnits" {
                    building.domestic_units
                } else {
                    building.useful_area_m2
                };
            }
            if matches!(allocation.function.as_str(), "market" | "common")
                && let Some(open_area) = open_areas.get(allocation.parcel_id.as_str())
            {
                demand.open_capacity += open_area;
            }
            if let Some(deficit) = open_deficits.get(allocation.parcel_id.as_str()) {
                demand.reasons.push(format!(
                    "Architectural deficit: cause={}; original_function={}; role={}; demand={}; allocated_households={}: {}",
                    deficit.cause, deficit.original_function, deficit.role, deficit.demand_id, deficit.households, deficit.message,
                ));
            }
            if let Some(refusal) = refusals.get(allocation.parcel_id.as_str()) {
                demand
                    .reasons
                    .push(format!("Building refusal: {}", refusal.message));
            }
        }
        for demand in &mut programme.demands {
            demand.deficit =
                (demand.requested - demand.built_capacity - demand.open_capacity).max(0.0);
        }
        crate::urban::generation_limits::report_population(programme, true);
        partition.warnings.retain(|w| !warnings::is_population_shortfall(w));
        partition.warnings.extend(programme.warnings.iter().filter(|w| warnings::is_population_shortfall(w)).cloned());
    }
    Ok(result)
}
