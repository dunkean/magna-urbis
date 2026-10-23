//! Cartographic architecture: retain a real native plan before roof tessellation.
//! Body/level footprints are authoritative. Roof outlines, heights and entrances
//! here are display/planning proxies, not a certificate of detailed construction.
use crate::catalogue::{SupportKind, catalogue};
use crate::compact::CompactArchitecture;
use crate::engine::{
    ResolvedArchitecture, body_level_height, resolve_urban_architecture,
    resolve_urban_architecture_with_budget,
};
use crate::geometry::*;
use crate::model::*;
use crate::placement::*;
use crate::style_index::{StyleQuery, style_index};
use geo::{
    Buffer,
    algorithm::buffer::{BufferStyle, LineJoin},
};
use serde::{Deserialize, Serialize};
use std::cell::OnceCell;
use std::collections::{BTreeMap, BTreeSet};

// Batch identity also changes with the native portal constructor so incremental
// scene merging cannot mix legacy house archives and newly certified entries.
pub const PLAN_VERSION: &str = "architectural-plans-2";

#[derive(Clone, Deserialize)]
pub struct PlanBatchRequest {
    pub schema_version: String,
    pub requests: Vec<PlacementRequest>,
    #[serde(default)]
    pub settings: Option<PlacementBatchSettings>,
    /// Explicit world-space building footprints. Absence means a free envelope.
    #[serde(default)]
    pub footprints: BTreeMap<String, Surface>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct CartographicRoof {
    pub height_m: f64,
    pub ridges: Vec<[Point; 2]>,
    pub roof_system: String,
    pub validation: String,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct PlanBuilding {
    pub id: String,
    pub parcel_id: String,
    pub function: ArchitectureFunction,
    pub culture: ArchitectureCulture,
    pub recipe_id: String,
    pub variant_id: String,
    pub transform: Transform,
    pub ground_z_m: f64,
    pub footprint: Surface,
    pub roof_footprint: Surface,
    pub courtyards: Surface,
    pub circulation: Surface,
    pub entrance: Point,
    pub access_id: String,
    pub volumes: Vec<ArchitectureVolume>,
    pub structural_features: Vec<Feature>,
    pub useful_area_m2: f64,
    /// Unknown until the native programme/access is certified; never reconciled.
    pub domestic_units: u32,
    pub simplification: String,
    pub diagnostics: Vec<String>,
    pub cartographic: CartographicRoof,
    pub resolved: CompactArchitecture,
}

#[derive(Serialize)]
pub struct PlanBatch {
    pub schema_version: String,
    pub generator_version: String,
    pub buildings: Vec<PlanBuilding>,
    pub refusals: Vec<PlacementRefusal>,
    pub open_spaces: Vec<OpenSpace>,
    pub materials: Vec<crate::catalogue::Material>,
}

fn transform_point(p: Point, t: &Transform) -> Point {
    let a = t.orientation_deg.to_radians();
    let (c, s) = (libm::cos(a), libm::sin(a));
    Point {
        x: t.origin.x + p.x * c - p.y * s,
        y: t.origin.y + p.x * s + p.y * c,
    }
}
fn map_surface(surface: &Surface, t: &Transform) -> Surface {
    surface
        .iter()
        .map(|p| Polygon {
            outer: p.outer.iter().map(|p| transform_point(*p, t)).collect(),
            holes: p
                .holes
                .iter()
                .map(|r| r.iter().map(|p| transform_point(*p, t)).collect())
                .collect(),
        })
        .collect()
}
fn inverse(t: &Transform) -> Transform {
    let mut inv = Transform {
        origin: Point { x: 0., y: 0. },
        orientation_deg: -t.orientation_deg,
    };
    let p = transform_point(t.origin, &inv);
    inv.origin = Point { x: -p.x, y: -p.y };
    inv
}
fn contains(domain: &Surface, s: &Surface) -> bool {
    area(&difference(s, domain)) <= (area(s) * 1e-8).max(0.0001)
}
fn body_domain(resolved: &ResolvedArchitecture) -> Surface {
    unite(
        &resolved
            .plan
            .bodies
            .iter()
            .flat_map(|b| b.levels.clone())
            .collect::<Vec<_>>(),
    )
}
fn plan_domain(resolved: &ResolvedArchitecture) -> Surface {
    plan_domain_with_body(resolved, body_domain(resolved))
}

fn plan_domain_with_body(resolved: &ResolvedArchitecture, body: Surface) -> Surface {
    let mut parts = vec![
        body,
        resolved.plan.courts.clone(),
        resolved.plan.paths.clone(),
    ];
    parts.extend(resolved.plan.features.iter().map(|f| f.surface.clone()));
    unite(&parts)
}

/// Ephemeral preparation for the rigid poses of one immutable architecture.
/// Never reused after a layout/entry/parameter change and never stored globally.
/// Local boolean order stays unchanged; roof parts remain separate so their
/// world-space union uses exactly the same quantization as the uncached path.
struct PreparedPlan<'a> {
    resolved: &'a ResolvedArchitecture,
    retain_native_entry: bool,
    body_local: Surface,
    plan_local: Surface,
    roof_parts: OnceCell<Vec<Surface>>,
    local_ridges: OnceCell<Vec<Vec<[Point; 2]>>>,
    level_areas: OnceCell<Vec<Vec<f64>>>,
    packed: OnceCell<Result<CompactArchitecture, String>>,
    packed_entry: OnceCell<Result<CompactArchitecture, String>>,
    foundation: OnceCell<Result<crate::engine::FoundationPreparation, String>>,
}

impl<'a> PreparedPlan<'a> {
    fn new(resolved: &'a ResolvedArchitecture) -> Self {
        let body_local = body_domain(resolved);
        let plan_local = plan_domain_with_body(resolved, body_local.clone());
        Self {
            resolved,
            retain_native_entry: false,
            body_local,
            plan_local,
            roof_parts: OnceCell::new(),
            local_ridges: OnceCell::new(),
            level_areas: OnceCell::new(),
            packed: OnceCell::new(),
            packed_entry: OnceCell::new(),
            foundation: OnceCell::new(),
        }
    }

    fn with_native_entry(resolved: &'a ResolvedArchitecture) -> Self {
        let mut prepared = Self::new(resolved);
        prepared.retain_native_entry = true;
        prepared
    }

    /// Reuse the one native graph and all initialized geometry caches. Only
    /// the rare alternative's archive and complete site admission are new.
    fn with_existing_entry(&self, index: usize) -> Result<Self, String> {
        let crate::engine::FoundationPreparation::Supported(physical) = self.foundation()? else {
            return Err("No prepared native foundation/entrance alternative.".into());
        };
        let foundation = OnceCell::new();
        let _ = foundation.set(Ok(crate::engine::FoundationPreparation::Supported(
            physical.with_existing_entry(index)?,
        )));
        Ok(Self {
            resolved: self.resolved,
            retain_native_entry: true,
            body_local: self.body_local.clone(),
            plan_local: self.plan_local.clone(),
            roof_parts: self.roof_parts.clone(),
            local_ridges: self.local_ridges.clone(),
            level_areas: self.level_areas.clone(),
            packed: OnceCell::new(),
            packed_entry: OnceCell::new(),
            foundation,
        })
    }

    fn roofs(&self) -> &[Surface] {
        self.roof_parts.get_or_init(|| {
            self.resolved
                .plan
                .bodies
                .iter()
                .map(|b| body_roof_outline(b, &self.resolved.plan.lot))
                .collect()
        })
    }

    fn ridges(&self) -> &[Vec<[Point; 2]>] {
        self.local_ridges.get_or_init(|| {
            self.resolved
                .plan
                .bodies
                .iter()
                .map(|b| {
                    let p = &b.parameters;
                    let mut ridges = vec![];
                    if matches!(
                        p.roof_system.as_str(),
                        "RF-GABLE" | "RF-HIP" | "RF-GAMBREL" | "RF-REED-HIP" | "RF-STEEP-STEP"
                    ) {
                        for arm in &b.arms {
                            let inset =
                                if matches!(p.roof_system.as_str(), "RF-HIP" | "RF-REED-HIP") {
                                    (arm.width_m * 0.5).min(arm.length_m * 0.45)
                                } else {
                                    0.
                                };
                            let at = |x: f64| Point {
                                x: arm.origin.x + arm.axis[0] * x - arm.axis[1] * arm.width_m * 0.5,
                                y: arm.origin.y + arm.axis[1] * x + arm.axis[0] * arm.width_m * 0.5,
                            };
                            let a = at(inset);
                            let z = at(arm.length_m - inset);
                            if contains(&b.footprint, &corridor(a, z, 0.02)) {
                                ridges.push([a, z]);
                            }
                        }
                    }
                    ridges
                })
                .collect()
        })
    }

    fn areas(&self) -> &[Vec<f64>] {
        self.level_areas.get_or_init(|| {
            self.resolved
                .plan
                .bodies
                .iter()
                .map(|b| b.levels.iter().map(area).collect())
                .collect()
        })
    }

    fn packed(&self) -> Result<CompactArchitecture, String> {
        self.packed
            .get_or_init(|| CompactArchitecture::pack(self.resolved))
            .clone()
    }

    fn foundation(&self) -> Result<&crate::engine::FoundationPreparation, String> {
        self.foundation
            .get_or_init(|| {
                if self.retain_native_entry {
                    crate::engine::prepare_foundation_and_entry(self.resolved)
                } else {
                    crate::engine::prepare_foundation_domains(self.resolved)
                }
            })
            .as_ref()
            .map_err(Clone::clone)
    }

    fn packed_with_native_entry(&self) -> Result<CompactArchitecture, String> {
        self.packed_entry
            .get_or_init(|| {
                let crate::engine::FoundationPreparation::Supported(physical) =
                    self.foundation()?
                else {
                    return Err("No prepared native foundation/entrance to retain.".into());
                };
                let entry = physical
                    .entry
                    .as_ref()
                    .ok_or("Missing prepared native entrance.")?;
                let mut retained = self.resolved.clone();
                retained.entrance = Some(entry.body_entry.clone());
                CompactArchitecture::pack(&retained)
            })
            .clone()
    }
}

#[cfg(test)]
#[path = "prepared_plan_tests.rs"]
mod prepared_plan_tests;

#[cfg(test)]
#[path = "foundation_integration_tests.rs"]
mod foundation_integration_tests;

#[cfg(test)]
#[path = "native_plan_entry_tests.rs"]
mod native_plan_entry_tests;

#[path = "native_one_bend_access.rs"]
mod native_one_bend_access;

#[cfg(test)]
#[path = "native_one_bend_access_tests.rs"]
mod native_one_bend_access_tests;

#[cfg(test)]
#[path = "roman_b13_foundation_integration_tests.rs"]
mod roman_b13_foundation_integration_tests;

#[cfg(test)]
#[path = "native_entry_alternatives_probe.rs"]
mod native_entry_alternatives_probe;

#[cfg(test)]
#[path = "existing_wing_portal_one_bend_probe.rs"]
mod existing_wing_portal_one_bend_probe;

#[cfg(test)]
#[path = "existing_native_entry_tests.rs"]
mod existing_native_entry_tests;

#[cfg(test)]
#[path = "single_native_entry_tests.rs"]
mod single_native_entry_tests;

#[path = "source_aspect_budget.rs"]
mod source_aspect_budget;
#[path = "adapted_single_budget.rs"]
mod adapted_single_budget;
#[path = "budget_selection.rs"]
mod budget_selection;

#[path = "source_aspect_setback.rs"]
mod source_aspect_setback;

#[cfg(test)]
#[path = "source_aspect_setback_tests.rs"]
mod source_aspect_setback_tests;

#[path = "source_terrain_budget.rs"]
mod source_terrain_budget;

#[path = "initial_terrain_recovery.rs"]
mod initial_terrain_recovery;
#[cfg(test)]
#[path = "initial_terrain_recovery_tests.rs"]
mod initial_terrain_recovery_tests;
#[cfg(test)]
#[path = "initial_terrain_recovery_v3_tests.rs"]
mod initial_terrain_recovery_v3_tests;

#[cfg(test)]
#[path = "initial_terrain_recovery_v3_positive_tests.rs"]
mod initial_terrain_recovery_v3_positive_tests;


#[cfg(test)]
#[path = "source_terrain_budget_tests.rs"]
mod source_terrain_budget_tests;

#[cfg(test)]
#[path = "source_aspect_budget_tests.rs"]
mod source_aspect_budget_tests;

#[cfg(test)]
#[path = "native_translation_probe_tests.rs"]
mod native_translation_probe_tests;

fn frame(r: &PlacementRequest, domain: &Surface) -> Transform {
    let edge = r
        .placement_hint
        .as_ref()
        .and_then(|s| s.first())
        .filter(|p| p.outer.len() >= 2)
        .map(|p| [p.outer[0], p.outer[1]])
        .or_else(|| {
            r.accesses
                .iter()
                .max_by(|a, b| {
                    let len = |a: &ArchitectureAccess| {
                        libm::hypot(
                            a.segment[1].x - a.segment[0].x,
                            a.segment[1].y - a.segment[0].y,
                        )
                    };
                    len(a).total_cmp(&len(b))
                })
                .map(|a| a.segment)
        });
    let angle = edge.map_or(0., |e| {
        libm::atan2(e[1].y - e[0].y, e[1].x - e[0].x).to_degrees()
    });
    let rotate = Transform {
        origin: Point { x: 0., y: 0. },
        orientation_deg: -angle,
    };
    let b = bounds(&map_surface(domain, &rotate));
    let mut result = Transform {
        origin: Point { x: 0., y: 0. },
        orientation_deg: angle,
    };
    result.origin = transform_point(Point { x: b[0], y: b[1] }, &result);
    result
}

pub(crate) fn validate_request(r: &PlacementRequest) -> Result<(), String> {
    if let Some(programme) = &r.programme {
        programme.validate()?;
    }
    if !valid_surface(&r.cadastral)
        || !valid_surface(&r.buildable)
        || !contains(&r.cadastral, &r.buildable)
    {
        return Err(
            "Buildable domain must be finite, valid and inside the cadastral surface.".into(),
        );
    }
    for surface in [&r.reserves].into_iter().chain(r.roof_domain.iter()) {
        if !surface.is_empty() && !valid_surface(surface) {
            return Err("Invalid reserve or roof-rights polygon.".into());
        }
    }
    if r.neighbors
        .iter()
        .any(|n| !valid_surface(&n.footprint) || !n.height_m.is_finite())
    {
        return Err("Invalid neighbour geometry.".into());
    }
    let t = &r.terrain;
    if !t.ground_z_m.is_finite()
        || !t.origin.x.is_finite()
        || !t.origin.y.is_finite()
        || !t.gradient.iter().all(|v| v.is_finite())
        || !t.max_foundation_step_m.is_finite()
        || t.max_foundation_step_m < 0.
        || t.water_z_m.is_some_and(|v| !v.is_finite())
    {
        return Err("Invalid physical terrain.".into());
    }
    if let Some(g) = &t.grid
        && (g.width < 2
            || g.height < 2
            || g.width > 4096
            || g.height > 4096
            || g.width.checked_mul(g.height) != Some(g.elevations_m.len())
            || !g.step_m.is_finite()
            || g.step_m <= 0.
            || !g.origin.x.is_finite()
            || !g.origin.y.is_finite()
            || !g.elevations_m.iter().all(|v| v.is_finite()))
    {
        return Err("Invalid physical terrain grid.".into());
    }
    if r.culture.mode == HistoricalMode::HistoricalStrict && r.culture.borrowing.is_some() {
        return Err("Strict mode refuses cultural borrowing.".into());
    }
    if let Some(o) = &r.occupation
        && (!o.coverage.is_finite()
            || o.coverage <= 0.
            || o.coverage > 1.
            || !o.frontage_m.is_finite()
            || o.frontage_m <= 0.
            || !o.depth_m.is_finite()
            || o.depth_m <= 0.)
    {
        return Err("Invalid occupation targets.".into());
    }
    if !r.accesses.iter().any(|a| {
        a.width_m.is_finite()
            && a.width_m >= 0.8
            && a.segment.iter().all(|p| p.x.is_finite() && p.y.is_finite())
            && libm::hypot(
                a.segment[1].x - a.segment[0].x,
                a.segment[1].y - a.segment[0].y,
            ) >= 0.8
    }) {
        return Err("No usable declared frontage.".into());
    }
    Ok(())
}

fn nearest(p: Point, a: Point, b: Point) -> Point {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let t = (((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy)).clamp(0., 1.);
    Point {
        x: a.x + t * dx,
        y: a.y + t * dy,
    }
}
fn corridor(a: Point, b: Point, width: f64) -> Surface {
    let len = libm::hypot(b.x - a.x, b.y - a.y);
    if len < 0.01 {
        return vec![];
    }
    let x = (b.y - a.y) / len * width * 0.5;
    let y = -(b.x - a.x) / len * width * 0.5;
    vec![Polygon {
        outer: vec![
            Point {
                x: a.x + x,
                y: a.y + y,
            },
            Point {
                x: b.x + x,
                y: b.y + y,
            },
            Point {
                x: b.x - x,
                y: b.y - y,
            },
            Point {
                x: a.x - x,
                y: a.y - y,
            },
        ],
        holes: vec![],
    }]
}
fn proposed_access(
    r: &PlacementRequest,
    footprint: &Surface,
    occupied: &Surface,
) -> Result<(Point, String, Surface, Point), String> {
    proposed_access_with_facade(r, footprint, occupied, false)
}

/// A cap on the actual facade/street edge preserves clear corridor width at
/// oblique approaches. A cap perpendicular to the path penetrates the house by
/// w²*tan(angle)/8 even when its centre is exactly on the facade.
fn edge_capped_corridor(
    entry: Point,
    contact: Point,
    facade: [Point; 2],
    street: [Point; 2],
) -> Option<Surface> {
    let length = libm::hypot(contact.x - entry.x, contact.y - entry.y);
    if length < 0.01 {
        return None;
    }
    let normal = [
        (contact.y - entry.y) / length,
        -(contact.x - entry.x) / length,
    ];
    let cap = |center: Point, edge: [Point; 2]| -> Option<[Point; 2]> {
        let dx = edge[1].x - edge[0].x;
        let dy = edge[1].y - edge[0].y;
        let edge_length = libm::hypot(dx, dy);
        if edge_length < 0.8 {
            return None;
        }
        let dot = (dx * normal[0] + dy * normal[1]) / edge_length;
        if dot.abs() < 0.1 {
            return None;
        }
        let half = 0.4 / dot.abs();
        // Both ends of a real 0.8 m clear connection must lie on the declared
        // segment; a clamped midpoint at a street endpoint is insufficient.
        let from = ((center.x - edge[0].x) * dx + (center.y - edge[0].y) * dy) / edge_length;
        if from < half || edge_length - from < half {
            return None;
        }
        let sign = dot.signum();
        let v = Point {
            x: dx / edge_length * half * sign,
            y: dy / edge_length * half * sign,
        };
        Some([
            Point {
                x: center.x + v.x,
                y: center.y + v.y,
            },
            Point {
                x: center.x - v.x,
                y: center.y - v.y,
            },
        ])
    };
    let a = cap(entry, facade)?;
    let b = cap(contact, street)?;
    let axis = [
        (contact.x - entry.x) / length,
        (contact.y - entry.y) / length,
    ];
    if (0..2).any(|i| (b[i].x - a[i].x) * axis[0] + (b[i].y - a[i].y) * axis[1] <= 1e-8) {
        return None; // Oblique end caps must not cross on a very short path.
    }
    Some(vec![Polygon {
        outer: vec![a[0], b[0], b[1], a[1]],
        holes: vec![],
    }])
}

fn proposed_access_with_facade(
    r: &PlacementRequest,
    footprint: &Surface,
    occupied: &Surface,
    align_caps: bool,
) -> Result<(Point, String, Surface, Point), String> {
    let walk = difference(&difference(&r.cadastral, &r.reserves), occupied);
    let mut candidates = vec![];
    for a in r.accesses.iter().filter(|a| {
        a.width_m >= 0.8
            && a.width_m.is_finite()
            && a.segment.iter().all(|p| p.x.is_finite() && p.y.is_finite())
            && a.segment[0] != a.segment[1]
    }) {
        for polygon in footprint {
            for (p, q) in polygon
                .outer
                .iter()
                .zip(polygon.outer.iter().cycle().skip(1))
                .take(polygon.outer.len())
            {
                let mid = Point {
                    x: (p.x + q.x) * 0.5,
                    y: (p.y + q.y) * 0.5,
                };
                let contact = nearest(mid, a.segment[0], a.segment[1]);
                candidates.push((
                    libm::hypot(contact.x - mid.x, contact.y - mid.y),
                    mid,
                    contact,
                    a.id.clone(),
                    [*p, *q],
                    a.segment,
                ));
            }
        }
    }
    candidates.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.3.cmp(&b.3)));
    for (_, entry, contact, id, facade, street) in candidates.into_iter().take(64) {
        let path = corridor(entry, contact, 0.8);
        if contains(&walk, &path) && area(&intersection(&path, footprint)) < 0.002 {
            return Ok((entry, id, path, contact));
        }
        if align_caps
            && let Some(path) = edge_capped_corridor(entry, contact, facade, street)
            && contains(&walk, &path)
            && area(&intersection(&path, footprint)) < 0.002
        {
            return Ok((entry, id, path, contact));
        }
    }
    Err("No unobstructed planning connection from building to declared frontage.".into())
}

/// Connect a rebuilt budget model to its actual native portal. The passage is
/// the only permitted penetration of the body; it is retained for the native
/// access builder, which independently checks the eventual interior cut.
fn proposed_native_access(
    r: &PlacementRequest,
    resolved: &ResolvedArchitecture,
    transform: &Transform,
    footprint: &Surface,
    occupied: &Surface,
) -> Result<(Point, String, Surface, Point), String> {
    let native = resolved
        .entrance
        .as_ref()
        .ok_or("Missing native budget entrance.")?;
    let solids = unite(
        &resolved
            .plan
            .features
            .iter()
            .filter(|f| matches!(f.kind, FeatureKind::PartyWall | FeatureKind::Post))
            .map(|f| f.surface.clone())
            .collect::<Vec<_>>(),
    );
    proposed_native_access_with_entry(r, native, &solids, transform, footprint, occupied, None)
}

fn proposed_native_access_with_entry(
    r: &PlacementRequest,
    native: &crate::access::StructuralEntrance,
    local_solids: &Surface,
    transform: &Transform,
    footprint: &Surface,
    occupied: &Surface,
    one_bend: Option<native_one_bend_access::OneBendContext<'_>>,
) -> Result<(Point, String, Surface, Point), String> {
    if native.width_m < 0.8 || (native.from_z_m - native.to_z_m).abs() > 0.001 {
        return Err("Native budget entrance requires a different access operator.".into());
    }
    let opening = native.opening.map(|p| transform_point(p, transform));
    let entry = Point {
        x: (opening[0].x + opening[1].x) * 0.5,
        y: (opening[0].y + opening[1].y) * 0.5,
    };
    let passage = map_surface(&native.passage, transform);
    let walk = difference(&difference(&r.cadastral, &r.reserves), occupied);
    let solids = map_surface(local_solids, transform);
    if !contains(&walk, &passage) || area(&intersection(&passage, &solids)) > 0.0001 {
        return Err(
            "Native budget passage crosses a reserve, neighbour or structural support.".into(),
        );
    }
    let mut candidates: Vec<_> = r
        .accesses
        .iter()
        .filter(|a| {
            matches!(a.kind.as_str(), "public" | "collective" | "private")
                && a.width_m.is_finite()
                && a.width_m >= 0.8
                && a.segment.iter().all(|p| p.x.is_finite() && p.y.is_finite())
                && libm::hypot(
                    a.segment[1].x - a.segment[0].x,
                    a.segment[1].y - a.segment[0].y,
                ) >= 0.8
        })
        .map(|a| {
            let [a0, a1] = a.segment;
            let dx = a1.x - a0.x;
            let dy = a1.y - a0.y;
            let length = libm::hypot(dx, dy);
            // The full 0.8 m connection must land on usable frontage, including
            // the ordinary rectangular cap. Never clamp to a bare endpoint.
            let contact = nearest(
                entry,
                Point {
                    x: a0.x + dx / length * 0.4,
                    y: a0.y + dy / length * 0.4,
                },
                Point {
                    x: a1.x - dx / length * 0.4,
                    y: a1.y - dy / length * 0.4,
                },
            );
            (
                libm::hypot(contact.x - entry.x, contact.y - entry.y),
                a,
                contact,
            )
        })
        .collect();
    candidates.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.id.cmp(&b.1.id)));
    // Preserve every already-valid connection before repairing a contact.
    // At an oblique approach, the cap needs more than the old fixed 0.4 m
    // endpoint margin. Solve its feasible interval without moving the house;
    // the complete world-space cap and all physical guards remain decisive.
    for exact_contact in [false, true] {
        for (_, access, previous_contact) in candidates.iter().take(64) {
            let contact = if exact_contact {
                match crate::frontage_contact::solve(entry, access.segment, 0.8) {
                    crate::frontage_contact::ContactOutcome::Fit(value)
                        if value.point != *previous_contact => value.point,
                    _ => continue,
                }
            } else {
                *previous_contact
            };
            let paths = std::iter::once(corridor(entry, contact, 0.8)).chain(
                std::iter::once_with(|| edge_capped_corridor(entry, contact, opening, access.segment))
                    .flatten(),
            );
            for path in paths {
                if contains(&walk, &path)
                    && area(&intersection(&path, &solids)) < 0.0001
                    && area(&difference(&intersection(&path, footprint), &passage)) < 0.002
                    && area(&intersection(&path, &passage)) > 0.005
                {
                    return Ok((entry, access.id.clone(), union(&path, &passage), contact));
                }
            }
        }
    }
    // Last resort only: keep all admitted straight/analytic contacts above.
    // One support-line bend per already-eligible frontage, in the same stable
    // distance/ID order and within the existing 64-access bound. There is no
    // elbow sampling, alternative portal, source draw or rigid-pose change.
    if let Some(context) = one_bend.filter(|context| context.matches_site(native)) {
        let local_frame = inverse(transform);
        for (_, access, _) in candidates.iter().take(64) {
            let street = access.segment.map(|p| transform_point(p, &local_frame));
            let Ok(route) = native_one_bend_access::one_bend_on_support_line(
                native.opening, context.body_local, local_solids, street, 0.8,
            ) else { continue };
            let path = map_surface(&route.path, transform);
            // Same complete-world-surface guards as the straight connectors.
            // The native passage was checked before any candidate and remains
            // the sole allowed penetration of the body, uncut and unshortened.
            if contains(&walk, &path)
                && area(&intersection(&path, &solids)) < 0.0001
                && area(&difference(&intersection(&path, footprint), &passage)) < 0.002
                && area(&intersection(&path, &passage)) > 0.005
            {
                return Ok((entry, access.id.clone(), union(&path, &passage),
                    transform_point(route.contact, transform)));
            }
        }
    }
    Err("No unobstructed connection from the retained native portal to declared frontage.".into())
}

fn roof_rise(p: &crate::catalogue::Parameters, domain: &Surface) -> f64 {
    let b = bounds(domain);
    let span = (b[2] - b[0]).min(b[3] - b[1]);
    match p.roof_system.as_str() {
        "RF-FLAT" | "RF-STEP" => p.roof_spec.parapet_height_m,
        "RF-DOME" | "RF-DOME-CONE" => span * 0.5 * p.roof_spec.dome_rise_ratio,
        "RF-VAULT" | "RF-CROSSVAULT" | "RF-THATCH-VAULT" => span * 0.5,
        "RF-SHED" => span * libm::tan(p.roof_pitch_deg[0].to_radians()),
        _ => span * 0.5 * libm::tan(p.roof_pitch_deg[0].to_radians()),
    }
    .max(0.)
}

fn body_roof_outline(b: &crate::layouts::BodySpec, lot: &Surface) -> Surface {
    let p = &b.parameters;
    // Native eaves follow each retained level (including jettied upper
    // floors), and offset_ring keeps mitres up to four times the overhang.
    // geo's Miter argument is a minimum angle in radians, not a ratio:
    // geometry::offset's historical 3.0 bevels even right-angle corners.
    // Use the native four-times limit here and cover its millimetre snap.
    // The result stays a conservative envelope; detailed realization must
    // still pass the independent native-roof containment guard.
    let roof_local = unite(
        &b.levels
            .iter()
            .enumerate()
            .map(|(index, level)| {
                let flat = matches!(p.roof_system.as_str(), "RF-FLAT" | "RF-STEP");
                // body_roof_slab emits a restricting slab only where this
                // level is exposed. A fully covered intermediate level has
                // no slab and the native roof builder retains its eaves
                // outside the upper body, even for a flat-roofed tower.
                let has_slab = flat
                    && b.levels
                        .get(index + 1)
                        .is_none_or(|upper| level != upper && !difference(level, upper).is_empty());
                if has_slab {
                    level.clone()
                } else {
                    from_geo(
                        &to_geo(level).buffer_with_style(
                            BufferStyle::new(p.overhang_m[0] + GRID_M)
                                .line_join(LineJoin::Miter(2.0 * libm::asin(0.25))),
                        ),
                    )
                }
            })
            .collect::<Vec<_>>(),
    );
    // Native roof_domain applies this same retained lot boundary. Keep the
    // proxy conservative inside that domain before checking roof rights.
    if lot.is_empty() {
        roof_local
    } else {
        intersection(&roof_local, lot)
    }
}

/// Rigid front poses only: no footprint clipping, scaling, new architectural
/// draws or inferred party-wall rights. Native courts/features/eaves travel
/// with the body, including a strip house's rear court at native y=0.
#[cfg(test)]
fn frontage_poses<'a>(
    r: &'a PlacementRequest,
    resolved: &ResolvedArchitecture,
    domain: &Surface,
) -> Vec<(Transform, &'a ArchitectureAccess)> {
    frontage_poses_prepared(r, &PreparedPlan::new(resolved), domain)
}

fn frontage_poses_prepared<'a>(
    r: &'a PlacementRequest,
    prepared: &PreparedPlan<'_>,
    domain: &Surface,
) -> Vec<(Transform, &'a ArchitectureAccess)> {
    let resolved = prepared.resolved;
    const LIMIT: usize = 8;
    const MARGIN: f64 = 0.1;
    let mut accesses: Vec<_> = r
        .accesses
        .iter()
        .filter(|a| {
            matches!(a.kind.as_str(), "public" | "collective" | "private")
                && a.width_m.is_finite()
                && a.width_m >= 0.8
                && a.segment.iter().all(|p| p.x.is_finite() && p.y.is_finite())
                && libm::hypot(
                    a.segment[1].x - a.segment[0].x,
                    a.segment[1].y - a.segment[0].y,
                ) >= 0.8
        })
        .collect();
    let length = |a: &ArchitectureAccess| {
        libm::hypot(
            a.segment[1].x - a.segment[0].x,
            a.segment[1].y - a.segment[0].y,
        )
    };
    accesses.sort_by(|a, b| length(b).total_cmp(&length(a)).then(a.id.cmp(&b.id)));
    let mut envelope_parts = vec![prepared.plan_local.clone()];
    envelope_parts.extend(prepared.roofs().iter().cloned());
    envelope_parts.extend(
        resolved
            .plan
            .features
            .iter()
            .filter_map(|f| f.roof.as_ref())
            .map(|r| r.domain.clone()),
    );
    // The real native landing can extend beyond the eaves. Pose the complete
    // passage inside the site rather than truncating it at a facade proxy.
    if let Some(entry) = &resolved.entrance {
        envelope_parts.push(entry.passage.clone());
    }
    if prepared.retain_native_entry
        && native_ground_preparation_allowed(r, true)
        && let Ok(crate::engine::FoundationPreparation::Supported(physical)) = prepared.foundation()
        && physical.entry.is_some()
    {
        envelope_parts.extend(physical.occupation_parts.iter().cloned());
    }
    let envelope = bounds(&unite(&envelope_parts));
    let bodies = bounds(&prepared.body_local);
    // Prefer the end without the rear court. This only chooses a half-turn;
    // no reflection or change to the source assembly is introduced.
    let flip = envelope[3] - bodies[3] < bodies[1] - envelope[1];
    let native = if flip {
        [-envelope[2], -envelope[3], -envelope[0], -envelope[1]]
    } else {
        envelope
    };
    let width = native[2] - native[0];
    let depth = native[3] - native[1];
    let legal = intersection(
        domain,
        &difference(r.roof_domain.as_ref().unwrap_or(&r.cadastral), &r.reserves),
    );
    if !valid_surface(&legal) {
        return Vec::new();
    }
    let mut poses = Vec::new();
    for access in accesses.into_iter().take(2) {
        // Canonical endpoints make a reversed segment the same front, with the
        // same candidate order. Either inward normal is checked against the site.
        let [mut a, mut b] = access.segment;
        if a.x.total_cmp(&b.x).then(a.y.total_cmp(&b.y)).is_gt() {
            std::mem::swap(&mut a, &mut b);
        }
        let origin = point((a.x + b.x) * 0.5, (a.y + b.y) * 0.5);
        let angle = libm::atan2(b.y - a.y, b.x - a.x).to_degrees();
        let mut sides: Vec<_> = [angle, angle + 180.]
            .into_iter()
            .map(|orientation_deg| {
                let frame = Transform {
                    origin,
                    orientation_deg,
                };
                let available = bounds(&map_surface(&legal, &inverse(&frame)));
                (frame, available)
            })
            .collect();
        sides.sort_by(|a, b| b.1[3].total_cmp(&a.1[3]));
        for (frame, available) in sides {
            let front = available[1].max(0.) + MARGIN;
            if front + depth > available[3] + GRID_M {
                continue;
            }
            let lo = (available[0] + width * 0.5 + MARGIN)
                .max(-length(access) * 0.5 + width * 0.5 + MARGIN);
            let hi = (available[2] - width * 0.5 - MARGIN)
                .min(length(access) * 0.5 - width * 0.5 - MARGIN);
            // A short access can still serve a wider building: its midpoint is
            // the only candidate and proposed_access remains authoritative.
            let anchors = if lo <= hi {
                [0_f64.clamp(lo, hi), lo, hi]
            } else {
                [0.; 3]
            };
            let mut previous = Vec::new();
            for x in anchors {
                if previous.iter().any(|p: &f64| (*p - x).abs() < GRID_M) {
                    continue;
                }
                previous.push(x);
                let offset = point(x - (native[0] + native[2]) * 0.5, front - native[1]);
                poses.push((
                    Transform {
                        origin: transform_point(offset, &frame),
                        orientation_deg: frame.orientation_deg + if flip { 180. } else { 0. },
                    },
                    access,
                ));
                if poses.len() == LIMIT {
                    return poses;
                }
            }
        }
    }
    poses
}

fn frontage_fallback(mut building: PlanBuilding, preferred: bool, attempts: usize) -> PlanBuilding {
    if preferred {
        building.diagnostics.push(format!("Street-front preference: {attempts} bounded rigid poses did not provide a valid front placement; retained native placement fallback. Proximity is advisory; continuous frontage and party walls are not certified."));
    }
    building
}

/// A duplicate source ID may name multiple street segments. A front preference
/// is fulfilled only when the admitted planning path actually ends on this one.
fn contact_on_front(id: &str, contact: Point, access: &ArchitectureAccess) -> bool {
    let closest = nearest(contact, access.segment[0], access.segment[1]);
    id == access.id && libm::hypot(contact.x - closest.x, contact.y - closest.y) <= 2. * GRID_M
}

fn try_frontage(
    r: &PlacementRequest,
    resolved: &ResolvedArchitecture,
    domain: &Surface,
    occupied: &Surface,
    attempts: &mut usize,
    adapted: bool,
) -> Option<PlanBuilding> {
    try_frontage_reporting(r, resolved, domain, occupied, attempts, adapted, &mut None)
}

fn remember_terrain_refusal(error: &str, terrain_refusal: &mut Option<String>) {
    if terrain_refusal.is_none()
        && error.starts_with("Architecture exceeds physical foundation/slope limits.")
    {
        *terrain_refusal = Some(error.to_owned());
    }
}

fn try_frontage_reporting(
    r: &PlacementRequest,
    resolved: &ResolvedArchitecture,
    domain: &Surface,
    occupied: &Surface,
    attempts: &mut usize,
    adapted: bool,
    terrain_refusal: &mut Option<String>,
) -> Option<PlanBuilding> {
    try_frontage_reporting_prepared(
        r,
        &PreparedPlan::new(resolved),
        domain,
        occupied,
        attempts,
        adapted,
        terrain_refusal,
    )
}

fn try_frontage_reporting_prepared(
    r: &PlacementRequest,
    prepared: &PreparedPlan<'_>,
    domain: &Surface,
    occupied: &Surface,
    attempts: &mut usize,
    adapted: bool,
    terrain_refusal: &mut Option<String>,
) -> Option<PlanBuilding> {
    try_frontage_reporting_prepared_with_recovery(
        r, prepared, domain, occupied, attempts, adapted, terrain_refusal, None,
        &OnceCell::new(),
    )
}

fn try_frontage_reporting_prepared_with_recovery<'a>(
    r: &PlacementRequest,
    prepared: &PreparedPlan<'a>,
    domain: &Surface,
    occupied: &Surface,
    attempts: &mut usize,
    adapted: bool,
    terrain_refusal: &mut Option<String>,
    mut recovery: Option<&mut initial_terrain_recovery::Recovery>,
    recovery_ticket: &OnceCell<Option<initial_terrain_recovery::Ticket<'a>>>,
) -> Option<PlanBuilding> {
    for (transform, access) in frontage_poses_prepared(r, prepared, domain) {
        *attempts += 1;
        let mut physical_failure = None;
        match visual_with_front_access_prepared_reported(
            r,
            prepared,
            transform.clone(),
            occupied,
            true,
            false,
            Some(access),
            false,
            if recovery.is_some() { Some(&mut physical_failure) } else { None },
        ) {
            Ok(mut building) => {
                let contact = nearest(building.entrance, access.segment[0], access.segment[1]);
                let distance = libm::hypot(
                    building.entrance.x - contact.x,
                    building.entrance.y - contact.y,
                );
                let basis = if adapted {
                    "accepted adapted plan; unchanged assembly"
                } else {
                    "source assembly"
                };
                building.diagnostics.push(format!("Street-front preference: rigid pose {distance:.2} m from declared access {}; {basis} and boundary rights retained. Proximity only: continuous frontage and party walls are not certified.", access.id));
                return Some(building);
            }
            Err(error) => {
                remember_terrain_refusal(&error, terrain_refusal);
                if let (Some(recovery), Some(failure)) = (recovery.as_deref_mut(), physical_failure) {
                    if let Some(ticket) = recovery_ticket.get_or_init(|| recovery.ticket(r, prepared)) {
                        recovery.observe(r, ticket, &transform, access, failure);
                    }
                }
            }
        }
    }
    None
}

/// Only an already admitted adapted building enters this final preference pass.
/// At most eight extra rigid poses for that same retained assembly, then return
/// its valid old pose. No adaptation, recipe choice or RNG is repeated here.
fn prefer_accepted_adapted_front(
    r: &PlacementRequest,
    adapted: &ResolvedArchitecture,
    domain: &Surface,
    occupied: &Surface,
    building: PlanBuilding,
    preferred: bool,
    mut attempts: usize,
) -> PlanBuilding {
    if preferred {
        let initial = attempts;
        if let Some(front) = try_frontage(r, adapted, domain, occupied, &mut attempts, true) {
            return front;
        }
        let mut fallback = frontage_fallback(building, true, attempts);
        fallback.diagnostics.push(format!("Accepted adapted assembly: {} additional rigid front poses exhausted; validated fallback retained without regeneration.", attempts - initial));
        fallback
    } else {
        building
    }
}

fn visual(
    r: &PlacementRequest,
    resolved: &ResolvedArchitecture,
    transform: Transform,
    occupied: &Surface,
    programme_automatic: bool,
    functional_hall: bool,
) -> Result<PlanBuilding, String> {
    visual_with_front(
        r,
        resolved,
        transform,
        occupied,
        programme_automatic,
        functional_hall,
        None,
    )
}

#[cfg(test)]
fn visual_prepared(
    r: &PlacementRequest,
    prepared: &PreparedPlan<'_>,
    transform: Transform,
    occupied: &Surface,
    programme_automatic: bool,
    functional_hall: bool,
) -> Result<PlanBuilding, String> {
    visual_with_front_access_prepared(
        r,
        prepared,
        transform,
        occupied,
        programme_automatic,
        functional_hall,
        None,
        false,
    )
}

fn visual_with_front(
    r: &PlacementRequest,
    resolved: &ResolvedArchitecture,
    transform: Transform,
    occupied: &Surface,
    programme_automatic: bool,
    functional_hall: bool,
    front: Option<&ArchitectureAccess>,
) -> Result<PlanBuilding, String> {
    visual_with_front_access(
        r,
        resolved,
        transform,
        occupied,
        programme_automatic,
        functional_hall,
        front,
        false,
    )
}

fn visual_with_front_access(
    r: &PlacementRequest,
    resolved: &ResolvedArchitecture,
    transform: Transform,
    occupied: &Surface,
    programme_automatic: bool,
    functional_hall: bool,
    front: Option<&ArchitectureAccess>,
    align_access_caps: bool,
) -> Result<PlanBuilding, String> {
    visual_with_front_access_prepared(
        r,
        &PreparedPlan::new(resolved),
        transform,
        occupied,
        programme_automatic,
        functional_hall,
        front,
        align_access_caps,
    )
}

fn native_ground_preparation_allowed(r: &PlacementRequest, automatic: bool) -> bool {
    automatic
        && r.culture.mode == HistoricalMode::HistoricalInspired
        && matches!(
            r.function,
            ArchitectureFunction::Domestic | ArchitectureFunction::Mixed
        )
        && r.config.as_ref().is_none_or(|c| {
            c.recipe.is_none() && c.workshop.is_none() && c.overrides == Overrides::default()
        })
}

fn visual_with_front_access_prepared(
    r: &PlacementRequest,
    prepared: &PreparedPlan<'_>,
    transform: Transform,
    occupied: &Surface,
    programme_automatic: bool,
    functional_hall: bool,
    front: Option<&ArchitectureAccess>,
    align_access_caps: bool,
) -> Result<PlanBuilding, String> {
    visual_with_front_access_prepared_reported(
        r, prepared, transform, occupied, programme_automatic, functional_hall,
        front, align_access_caps, None,
    )
}

fn visual_with_front_access_prepared_reported(
    r: &PlacementRequest,
    prepared: &PreparedPlan<'_>,
    transform: Transform,
    occupied: &Surface,
    programme_automatic: bool,
    functional_hall: bool,
    front: Option<&ArchitectureAccess>,
    align_access_caps: bool,
    terrain_failure: Option<&mut Option<initial_terrain_recovery::TerrainFailure>>,
) -> Result<PlanBuilding, String> {
    let resolved = prepared.resolved;
    let footprint = map_surface(&prepared.body_local, &transform);
    let all = map_surface(&prepared.plan_local, &transform);
    let allowed = difference(&r.buildable, &r.reserves);
    if !contains(&allowed, &footprint)
        || !contains(&difference(&r.cadastral, &r.reserves), &all)
        || area(&intersection(&all, occupied)) > 0.0001
    {
        return Err(
            "Architectural bodies, courts or structures do not fit the supplied domain.".into(),
        );
    }
    let native_foundation = if native_ground_preparation_allowed(r, programme_automatic) {
        match prepared.foundation()? {
            crate::engine::FoundationPreparation::Supported(physical) => Some(physical),
            crate::engine::FoundationPreparation::Unsupported(_reason) => None,
        }
    } else {
        None
    };
    let bearing = if let Some(physical) = native_foundation {
        // The native constructor may add required gallery posts or walls that
        // a lightweight plan has not stored yet. Their occupied land must pass
        // the same rights/overlap checks before separating the bearing surface.
        let native_occupation = unite(
            &physical
                .occupation_parts
                .iter()
                .map(|s| map_surface(s, &transform))
                .collect::<Vec<_>>(),
        );
        if !contains(&difference(&r.cadastral, &r.reserves), &native_occupation)
            || area(&intersection(&native_occupation, occupied)) > 0.0001
        {
            return Err(
                "Native circulation or supports exceed cadastral/reserve/occupation rights.".into(),
            );
        }
        unite(
            &physical
                .bearing_parts
                .iter()
                .map(|s| map_surface(s, &transform))
                .collect::<Vec<_>>(),
        )
    } else {
        all
    };
    let (low, ground, slope) = r.terrain.foundation_bounds(&bearing)?;
    if slope > crate::placement::MAX_LEVEL_FOUNDATION_SLOPE_DEG
        || ground - low > r.terrain.max_foundation_step_m + 1e-8
    {
        if let Some(out) = terrain_failure {
            *out = Some(initial_terrain_recovery::TerrainFailure { low, high: ground, slope });
        }
        return Err(format!(
            "Architecture exceeds physical foundation/slope limits. Required step {:.3} m / allowed {:.3} m; raster slope {:.3} deg / allowed {} deg.",
            ground - low,
            r.terrain.max_foundation_step_m,
            slope,
            crate::placement::MAX_LEVEL_FOUNDATION_SLOPE_DEG
        ));
    }
    if let Some(water) = r.terrain.water_z_m
        && low < water - 0.01
        && resolved.plan.bodies.iter().any(|b| {
            !matches!(
                b.parameters.support.kind,
                SupportKind::Posts | SupportKind::Piers | SupportKind::Raft
            )
        })
    {
        return Err("Unsupported submerged foundation.".into());
    }
    let prepared_entry = native_foundation.and_then(|physical| physical.entry.as_ref());
    let native_entry = prepared_entry.is_some() || align_access_caps && resolved.entrance.is_some();
    let (entrance, access_id, path, contact) = if let Some(entry) = prepared_entry {
        proposed_native_access_with_entry(
            r,
            &entry.site_entry,
            &entry.site_solids,
            &transform,
            &footprint,
            occupied,
            Some(native_one_bend_access::OneBendContext {
                body_entry: &entry.body_entry,
                body_local: &prepared.body_local,
            }),
        )?
    } else if native_entry {
        proposed_native_access(r, resolved, &transform, &footprint, occupied)?
    } else if align_access_caps {
        proposed_access_with_facade(r, &footprint, occupied, true)?
    } else {
        proposed_access(r, &footprint, occupied)?
    };
    if front.is_some_and(|access| !contact_on_front(&access_id, contact, access)) {
        return Err("Admitted planning path reaches a different declared frontage segment.".into());
    }
    let mut volumes = vec![];
    let mut roof_parts = vec![];
    let mut ridges = vec![];
    let mut height = 0_f64;
    let mut useful_area = 0.;
    for (i, b) in resolved.plan.bodies.iter().enumerate() {
        let p = &b.parameters;
        let level_height = body_level_height(b);
        let wall_height = level_height * b.levels.len() as f64;
        let rise = roof_rise(p, &b.footprint);
        height = height.max(b.z + wall_height + rise);
        roof_parts.push(map_surface(&prepared.roofs()[i], &transform));
        for &[a, z] in &prepared.ridges()[i] {
            ridges.push([
                transform_point(a, &transform),
                transform_point(z, &transform),
            ]);
        }
        let levels = b
            .levels
            .iter()
            .enumerate()
            .map(|(index, s)| {
                useful_area += prepared.areas()[i][index];
                VolumeLevel {
                    index: index as u32,
                    footprint: map_surface(s, &transform),
                    z_m: ground + b.z + index as f64 * level_height,
                    height_m: level_height,
                    materials: None,
                }
            })
            .collect();
        let body = map_surface(&b.footprint, &transform);
        volumes.push(ArchitectureVolume {
            id: format!("{}:body:{i}", r.id),
            footprint: body.clone(),
            levels,
            z_m: ground + b.z,
            wall_height_m: wall_height,
            roof_height_m: rise,
            roof_system: p.roof_system.clone(),
            roof_pitch_deg: p.roof_pitch_deg[0],
            overhang_m: p.overhang_m[0],
            roof_spec: p.roof_spec.clone(),
            materials: p.materials.clone(),
            role: b.role,
            envelope: p.envelope,
            roof_mesh: VolumeRoofMesh {
                vertices: vec![],
                faces: vec![],
                edges: vec![],
                groups: vec![],
            },
            foundation: VolumeFoundation {
                footprint: body,
                z_min_m: low - 0.15,
                z_max_m: ground,
            },
        });
    }
    // Authored gallery/porch covers already declare their finite roof domain,
    // including eaves. Keep those roofs visible without triangulating them.
    roof_parts.extend(
        resolved
            .plan
            .features
            .iter()
            .filter_map(|feature| feature.roof.as_ref())
            .map(|roof| map_surface(&roof.domain, &transform)),
    );
    let roof_footprint = unite(&roof_parts);
    if !contains(
        &difference(r.roof_domain.as_ref().unwrap_or(&r.cadastral), &r.reserves),
        &roof_footprint,
    ) {
        return Err("Cartographic eave envelope exceeds roof rights.".into());
    }
    let feature_source = native_foundation.map_or(resolved.plan.features.as_slice(), |physical| {
        physical.native_features.as_slice()
    });
    let structural_features = feature_source
        .iter()
        .map(|f| {
            let mut f = f.clone();
            f.surface = map_surface(&f.surface, &transform);
            f.z_m += ground;
            f.vertices3d = f
                .vertices3d
                .iter()
                .map(|v| {
                    let p = transform_point(Point { x: v.x, y: v.y }, &transform);
                    Vertex3 {
                        x: p.x,
                        y: p.y,
                        z: v.z + ground,
                    }
                })
                .collect();
            f
        })
        .collect();
    let mut diagnostics = resolved.plan.diagnostics.clone();
    if native_foundation.is_some() {
        diagnostics.push("Native ground-strip foundation: actual body levels and native gallery/posts determine the physical footing; bare courts/paths retain their cadastral reservation without being treated as a level foundation. All native structures were checked against cadastral, reserve and neighbour rights. Foundation-step and slope limits are unchanged; household capacity remains unknown.".into());
    }
    if prepared_entry.is_some() {
        diagnostics.push("Native planning entrance: the structural body portal is retained in the compact archive; its whole site passage and public connector were checked against cadastral, reserve, neighbour and support rights. Interior room subdivision remains deferred and must preserve this portal.".into());
    }
    if let Some(p) = &r.programme
        && p.has_wishes()
    {
        let mut trace = Vec::new();
        if let Some(composition) = p.composition {
            let outcome = if functional_hall {
                "declared functional programme retained"
            } else if !matches!(
                r.function,
                ArchitectureFunction::Domestic | ArchitectureFunction::Mixed
            ) || !composition.residential()
            {
                "unsupported functional composition; retained native fallback"
            } else if !programme_automatic {
                "explicit selection retained"
            } else if composition.rank(&resolved.parameters) > 0 {
                "source/site fallback outside preferred family"
            } else {
                "preferred source family"
            };
            trace.push(format!(
                "composition={} -> {:?}/{} ({outcome})",
                composition.as_str(),
                resolved.parameters.layout,
                resolved.parameters.footprint_family
            ));
            if composition == crate::programme::ProgrammeComposition::Farm {
                trace.push("farm wish selects a residential compound/court; agricultural functions are not certified".into());
            }
        }
        if let Some([lo, hi]) = p.floors {
            let primary = resolved
                .parameters
                .components
                .iter()
                .filter(|c| {
                    c.role.residential() && c.placement != crate::catalogue::Placement::FacingMain
                })
                .find(|c| c.placement == crate::catalogue::Placement::Main)
                .or_else(|| {
                    resolved.parameters.components.iter().find(|c| {
                        c.role.residential()
                            && c.placement != crate::catalogue::Placement::FacingMain
                    })
                });
            let actual = primary.map_or(resolved.parameters.floors[0], |c| c.floors[0]);
            let hard = r
                .config
                .as_ref()
                .is_some_and(|c| c.overrides.floors.is_some());
            let reason = if hard {
                "explicit override retained"
            } else if !programme_automatic {
                "explicit/native configuration retained"
            } else if (lo..=hi).contains(&actual) {
                "within preferred range"
            } else {
                "source/site fallback outside preferred range"
            };
            trace.push(format!("main floors=[{lo},{hi}] -> {actual} ({reason})"));
        }
        if let Some(target) = p.built_area_m2 {
            let outcome = if functional_hall {
                "declared functional budget adapter; target_met recorded in retained functional diagnostics"
            } else {
                "target advisory, no declared budget adapter"
            };
            trace.push(format!(
                "body footprint target={target:.2}m2 actual={:.2}m2; {outcome}",
                area(&footprint)
            ));
        }
        if p.frontage_continuity.is_some() || p.party_walls.is_some() {
            trace.push(
                "frontage is a placement preference; continuity and party-wall wishes are not certified; native boundary rights unchanged".into(),
            );
        }
        if resolved.config.mode == HistoricalMode::HistoricalStrict {
            trace.push("strict source families and dimensions retained".into());
        }
        diagnostics.push(format!("Urban programme: {}.", trace.join("; ")));
    }
    diagnostics.push(if native_entry {
        "Retained architectural plan: no roof mesh or interior was generated. Native structural entrance retained for exact interior replay; eaves and roof height remain cartographic envelopes. Detailed realization certifies native construction separately. Household capacity is unknown."
    } else {
        "Retained architectural plan: no roof mesh or interior was generated. Eaves, roof height and entrance are cartographic/planning proxies; detailed realization certifies native construction separately. Household capacity is unknown."
    }.into());
    let mut circulation = union(&map_surface(&resolved.plan.paths, &transform), &path);
    if let Some(entry) = prepared_entry
        && !entry.retained_passages.is_empty()
    {
        // Alternative admission retained the canonical passage's occupation.
        // Persist only those actual passages, so the following houses see the
        // same rights through OccupationIndex. Canonical outputs do not incur
        // this extra union or any change to their original boolean order.
        let mut parts = vec![circulation];
        parts.extend(entry.retained_passages.iter().map(|s| map_surface(s, &transform)));
        circulation = unite(&parts);
    }
    Ok(PlanBuilding {
        id: r.id.clone(),
        parcel_id: r.parcel_id.clone(),
        function: r.function,
        culture: r.culture.clone(),
        recipe_id: resolved.recipe_id.clone(),
        variant_id: resolved.parameters.variant_id.clone(),
        transform: transform.clone(),
        ground_z_m: ground,
        footprint,
        roof_footprint,
        courtyards: map_surface(&resolved.plan.courts, &transform),
        circulation,
        entrance,
        access_id,
        volumes,
        structural_features,
        useful_area_m2: useful_area,
        domestic_units: 0,
        simplification: "architectural_plan".into(),
        diagnostics,
        cartographic: CartographicRoof {
            height_m: height,
            ridges,
            roof_system: resolved.parameters.roof_system.clone(),
            validation: "plan_only".into(),
        },
        resolved: if prepared_entry.is_some() {
            prepared.packed_with_native_entry()?
        } else {
            prepared.packed()?
        },
    })
}

/// Give a simple ground-supported source its actual programme before admission.
/// Otherwise lot coverage can inflate the first house and the later budget
/// pass is unreachable on a sloping site. No additional candidate search.
fn initial_ground_programme_dimensions(
    r: &PlacementRequest,
    selected: &HouseConfig,
    exact: bool,
    target: Option<&Surface>,
) -> Option<[f64; 2]> {
    use crate::catalogue::{Envelope, Layout};
    let requested = r.programme.as_ref()?.built_area_m2?;
    if exact
        || target.is_some()
        || r.culture.mode != HistoricalMode::HistoricalInspired
        || r.parcel_fit == Some(false)
        || !matches!(
            r.function,
            ArchitectureFunction::Domestic | ArchitectureFunction::Mixed
        )
        || r.config.as_ref().is_some_and(|c| {
            c.recipe.is_some() || c.workshop.is_some() || c.overrides.variant.is_some()
        })
        || !requested.is_finite()
        || requested <= 0.
    {
        return None;
    }
    let data = catalogue().ok()?;
    let recipe = data
        .recipes
        .iter()
        .find(|p| Some(p.id.as_str()) == selected.recipe.as_deref())?;
    let p = data
        .resolve_variant_parameters(
            recipe,
            selected,
            selected.overrides.variant.as_deref().unwrap_or("default"),
        )
        .ok()?;
    if p.layout != Layout::Single
        || p.footprint_family != "FP-RECT"
        || p.support.kind != SupportKind::Ground
        || p.envelope != Envelope::Walled
        || p.bodies != [1, 1]
        || p.cells[1] > 0
        || p.gallery_cover.enabled
        || !p.enclosures.is_empty()
        || p.structural_spec.is_some()
        || p.court_program.is_some()
        || p.shell.is_some()
        || !(p.components.is_empty() || p.components.len() == 1 && p.components[0].id == "main")
        || p.details
            .iter()
            .any(|d| matches!(d.as_str(), "arcade" | "jetty" | "jetties" | "street_jetty"))
    {
        return None;
    }
    let w = p.width_m.map(|v| v * selected.size);
    let d = p.depth_m.map(|v| v * selected.size);
    let aspect = r
        .occupation
        .as_ref()
        .map_or(w[0] / d[0], |o| o.frontage_m / o.depth_m);
    if w.iter().chain(&d).any(|v| !v.is_finite() || *v <= 0.)
        || !aspect.is_finite()
        || aspect <= 0.
        || !(w[0] * d[0]).is_finite()
        || !(w[1] * d[1]).is_finite()
    {
        return None;
    }
    let area = requested.clamp(w[0] * d[0], w[1] * d[1]);
    let width = libm::sqrt(area * aspect).clamp(w[0], w[1]);
    let depth = (area / width).clamp(d[0], d[1]);
    Some([(area / depth).clamp(w[0], w[1]), depth])
}

/// Only automatic programmes may guide dimensions before the first native
/// construction. Explicit user controls keep the existing path; the engine
/// independently checks whether the selected topology has an exact area model.
fn automatic_initial_programme_area(
    r: &PlacementRequest,
    exact: bool,
    target: Option<&Surface>,
) -> Option<f64> {
    if exact
        || target.is_some()
        || r.parcel_fit == Some(false)
        || r.culture.mode != HistoricalMode::HistoricalInspired
        || !matches!(
            r.function,
            ArchitectureFunction::Domestic | ArchitectureFunction::Mixed
        )
        || r.config.as_ref().is_some_and(|c| {
            c.recipe.is_some() || c.workshop.is_some() || c.overrides != Overrides::default()
        })
    {
        return None;
    }
    r.programme
        .as_ref()?
        .built_area_m2
        .filter(|a| a.is_finite() && *a > 0.)
}

/// A source-native retry, not an arbitrary platform morphology operator. It is
/// reserved for one previously drawn simple house after normal admission fails.
fn native_platform_budget_target(
    r: &PlacementRequest,
    resolved: &ResolvedArchitecture,
    exact: bool,
    target: Option<&Surface>,
) -> Option<f64> {
    use crate::catalogue::{Envelope, Layout};
    let p = &resolved.parameters;
    let requested = r.programme.as_ref()?.built_area_m2?;
    if exact
        || target.is_some()
        || r.culture.mode != HistoricalMode::HistoricalInspired
        || r.parcel_fit == Some(false)
        || !matches!(
            r.function,
            ArchitectureFunction::Domestic | ArchitectureFunction::Mixed
        )
        || r.config.as_ref().is_some_and(|c| {
            c.recipe.is_some() || c.workshop.is_some() || c.overrides.variant.is_some()
        })
        || !requested.is_finite()
        || requested <= 0.
        || requested >= area(&body_domain(resolved))
        || p.layout != Layout::Platform
        || p.footprint_family != "FP-RECT"
        || p.support.kind != SupportKind::Posts
        || p.envelope != Envelope::Walled
        || p.bodies != [1, 1]
        || resolved.plan.bodies.len() != 1
        || !resolved.plan.courts.is_empty()
        || !p.enclosures.is_empty()
        || p.structural_spec.is_some()
        || p.court_program.is_some()
        || p.shell.is_some()
        || !(p.components.is_empty() || p.components.len() == 1 && p.components[0].id == "main")
    {
        return None;
    }
    Some(requested)
}

fn retry_native_platform_budget(
    r: &PlacementRequest,
    original: &ResolvedArchitecture,
    requested: f64,
    domain: &Surface,
    neighbors: &Surface,
) -> Result<PlanBuilding, String> {
    let base = frame(r, domain);
    let size = bounds(&map_surface(domain, &inverse(&base)));
    let spans = [size[2] - size[0] - 0.8, size[3] - size[1] - 0.8];
    let aspect = r.occupation.as_ref().map_or_else(
        || original.parameters.width_m[0] / original.parameters.depth_m[0],
        |o| o.frontage_m / o.depth_m,
    );
    let desired = [
        libm::sqrt(requested * aspect),
        libm::sqrt(requested / aspect),
    ];
    // Same selected source, variant, overrides and RNG seed. Only the native
    // envelope request changes; source minima/maxima and all native features
    // are rebuilt by their original constructors, never scaled or clipped.
    let resolved = resolve_urban_architecture(
        original.config.clone(),
        r.function,
        spans,
        false,
        Some(desired),
        r.occupation.as_ref().map(|o| o.coverage),
        true,
    )?;
    if resolved.recipe_id != original.recipe_id
        || resolved.parameters.variant_id != original.parameters.variant_id
        || resolved.plan.bodies.len() != original.plan.bodies.len()
        || resolved
            .plan
            .bodies
            .iter()
            .zip(&original.plan.bodies)
            .any(|(a, b)| {
                a.role != b.role
                    || a.z != b.z
                    || a.levels.len() != b.levels.len()
                    || a.parameters.support.kind != b.parameters.support.kind
            })
    {
        return Err(
            "Native platform budget retry changed the declared source/body programme.".into(),
        );
    }
    let mut attempts = 0;
    let mut terrain_refusal = None;
    let annotate = |mut building: PlanBuilding, poses: usize| {
        building.diagnostics.push(format!("Native platform budget retry: after normal admission failed, one retained source/variant/seed was rebuilt for programme target={requested:.3}m2 instead of the coarse lot-coverage target; initial={:.3}m2 actual={:.3}m2; {poses}/11 rigid poses (at most 8 front + 3 centred), no constrained-composition search. Source dimensions, body count, support, floors, physical terrain, roof rights and access retained. Source minima may prevent the exact target; household capacity remains unknown.", area(&body_domain(original)), area(&building.footprint)));
        building
    };
    // A real access is also a useful physical pose for a compound programme.
    // This only extends an exhausted search; it adds no continuity requirement.
    if let Some(building) = try_frontage_reporting(
        r,
        &resolved,
        domain,
        neighbors,
        &mut attempts,
        false,
        &mut terrain_refusal,
    ) {
        return Ok(annotate(building, attempts));
    }
    let b = bounds(&plan_domain(&resolved));
    let mut error = "No native platform pose was admitted.".to_owned();
    for align in [0.5, 0.1, 0.9] {
        let offset = point(
            size[0] + (size[2] - size[0] - (b[2] - b[0])) * 0.5 - b[0],
            size[1] + (size[3] - size[1] - (b[3] - b[1])) * align - b[1],
        );
        attempts += 1;
        match visual(
            r,
            &resolved,
            Transform {
                origin: transform_point(offset, &base),
                orientation_deg: base.orientation_deg,
            },
            neighbors,
            true,
            false,
        ) {
            Ok(building) => return Ok(annotate(building, attempts)),
            Err(e) => {
                remember_terrain_refusal(&e, &mut terrain_refusal);
                error = e;
            }
        }
    }
    if let Some(terrain) = terrain_refusal
        && !error.contains(&terrain)
    {
        error.push_str(&format!(
            " An earlier retry pose fitting bodies/courts/structures failed terrain before roof/access checks: {terrain}"
        ));
    }
    Err(format!(
        "Native platform budget retry exhausted {attempts}/11 rigid poses: {error}"
    ))
}

#[cfg(test)]
fn plan_one_initial(
    r: &PlacementRequest,
    occupied: &Surface,
    target: Option<&Surface>,
    exact: bool,
) -> Result<PlanBuilding, String> {
    plan_one_initial_with_terrain_recovery(r, occupied, target, exact).map(|(building, _)| building)
}

fn plan_one_initial_with_terrain_recovery(
    r: &PlacementRequest,
    occupied: &Surface,
    target: Option<&Surface>,
    exact: bool,
) -> Result<(PlanBuilding, bool), String> {
    let mut recovery = initial_terrain_recovery::Recovery::new(r, target, exact);
    match plan_one_initial_sequence(r, occupied, target, exact, &mut recovery) {
        Ok(building) => Ok((building, false)),
        Err(mut error) => match recovery.finish(r, occupied) {
            Some(Ok(building)) => Ok((building, true)),
            Some(Err(reason)) => {
                error.push_str(&format!(" Initial source terrain recovery: {}/8 exact terrain evaluations; {}/1 constructions; {}/1 admissions; reduced native refusal: {reason}", recovery.evaluations, recovery.constructions, recovery.admissions));
                Err(error)
            }
            None => {
                if !recovery.witnesses.is_empty() {
                    error.push_str(&format!(" Initial source terrain recovery: {}/8 exact terrain evaluations; {}/1 constructions; {}/1 admissions; no bounded reduced rectangle proposed; original refusal retained.", recovery.evaluations, recovery.constructions, recovery.admissions));
                }
                Err(error)
            }
        },
    }
}

fn plan_one_initial_sequence(
    r: &PlacementRequest,
    occupied: &Surface,
    target: Option<&Surface>,
    exact: bool,
    recovery: &mut initial_terrain_recovery::Recovery,
) -> Result<PlanBuilding, String> {
    let initial_area = automatic_initial_programme_area(r, exact, target);
    let mut budget_attempted = false;
    let mut error = match plan_one_initial_pass(
        r,
        occupied,
        target,
        exact,
        initial_area,
        &mut budget_attempted,
        None,
        recovery,
    ) {
        Ok(building) => return Ok(building),
        Err(error) => error,
    };
    if budget_attempted {
        // Larger initial dimensions can alter the constrained constructor's
        // first geometry-valid choice, which is not yet a terrain proof.
        // Restore the complete former sequence only after admission fails;
        // three rigid poses alone cannot recover its adapted solutions.
        let mut unused = false;
        match plan_one_initial_pass(r, occupied, target, exact, None, &mut unused, None, recovery) {
            Ok(mut building) => {
                building.diagnostics.push(format!(
                        "Initial strip programme recovery: one complete legacy-dimension pass admitted a retained native source after the budget-guided pass failed. Source selection, seed, terrain, cadastral/roof rights and access checks are unchanged; no recursive retry. Initial refusal: {error}"
                    ));
                return Ok(building);
            }
            Err(legacy_error) => error.push_str(&format!(
                " One legacy-dimension recovery pass also refused: {legacy_error}"
            )),
        }
    }
    // An additional family comes after both established dimension pathways.
    // This pass selects only that family; it never repeats the previous four.
    let mut simple_attempted = false;
    let mut unused = false;
    match plan_one_initial_pass(
        r,
        occupied,
        target,
        exact,
        initial_area,
        &mut unused,
        Some(&mut simple_attempted),
        recovery,
    ) {
        Ok(building) => Ok(building),
        Err(simple_error) => {
            if simple_attempted {
                error.push_str(&format!(
                    " One missing simple family also refused: {simple_error}"
                ));
            }
            Err(error)
        }
    }
}

fn plan_one_initial_pass(
    r: &PlacementRequest,
    occupied: &Surface,
    target: Option<&Surface>,
    exact: bool,
    initial_programme_area: Option<f64>,
    budget_attempted: &mut bool,
    simple_fallback: Option<&mut bool>,
    recovery: &mut initial_terrain_recovery::Recovery,
) -> Result<PlanBuilding, String> {
    validate_request(r)?;
    if target.is_some_and(|s| !valid_surface(s) || !contains(&r.buildable, s)) {
        return Err("Imposed footprint must fit the buildable domain.".into());
    }
    let neighbors = unite(
        &r.neighbors
            .iter()
            .map(|n| n.footprint.clone())
            .chain(std::iter::once(occupied.clone()))
            .collect::<Vec<_>>(),
    );
    let domain = difference(&difference(&r.buildable, &r.reserves), &neighbors);
    if !valid_surface(&domain) {
        return Err("No unoccupied buildable domain.".into());
    }
    let base_frame = frame(r, &domain);
    let local = map_surface(&domain, &inverse(&base_frame));
    let size = bounds(&local);
    let target_local = target.map(|s| map_surface(s, &inverse(&base_frame)));
    let mut config = r.config.clone().unwrap_or_default();
    if config.workshop.is_some()
        && (!exact
            || config.mode != HistoricalMode::FantasyMix
            || r.culture.mode != HistoricalMode::FantasyMix)
    {
        return Err("Workshop templates require an explicit Fantasy model/site.".into());
    }
    if config.workshop.is_none() {
        config.pack = r.culture.pack.clone();
        config.mode = r.culture.mode;
    }
    config.seed = r.seed.clone();
    config.count = 1;
    config.orientation_deg = 0.;
    // Functional roles opt in through one exported native registry. Selection
    // sees the original config, before the legacy city pack/mode normalization.
    let functional_selection = if matches!(
        r.function,
        ArchitectureFunction::Collective
            | ArchitectureFunction::Warehouse
            | ArchitectureFunction::Workshop
    ) {
        Some(crate::functional_choices::choices_for_request(r, exact, 4)?)
    } else {
        None
    };
    let mut functional_candidates = vec![];
    let mut unregistered_functional_diagnostic = None;
    if let Some(selection) = functional_selection {
        use crate::functional_choices::FunctionalSelectionStatus;
        match selection.status {
            FunctionalSelectionStatus::Available => {
                if target.is_some() {
                    return Err("Registered inspired functional envelopes have no imposed-footprint adapter.".into());
                }
                functional_candidates = selection.candidates;
            }
            FunctionalSelectionStatus::Incompatible => {
                return Err(format!(
                    "Registered inspired functional envelope refused: {}",
                    selection.diagnostics.join(" ")
                ));
            }
            FunctionalSelectionStatus::Unregistered => {
                unregistered_functional_diagnostic = Some(format!(
                    "Unregistered functional programme: {} Existing native fallback does not certify the requested function; urban landmark preview remains indicative.",
                    selection.diagnostics.join(" ")
                ))
            }
            FunctionalSelectionStatus::Explicit => {}
        }
    }
    let query = StyleQuery {
        pack_id: Some(config.pack.clone()),
        tradition_id: crate::cultural_palettes::automatic_tradition(&r.culture, &config, exact)
            .map(str::to_owned),
        recipe_id: config.recipe.clone(),
        variant_id: config.overrides.variant.clone(),
        mode: config.mode,
        era: config.era.clone(),
        allow_late: config.allow_late,
        typology: r.typology,
        include_variants: config.variation > 0. || config.overrides.variant.is_some(),
        ..Default::default()
    };
    let programme_automatic = !exact
        && config.recipe.is_none()
        && config.workshop.is_none()
        && config.overrides.variant.is_none()
        && matches!(
            r.function,
            ArchitectureFunction::Domestic | ArchitectureFunction::Mixed
        );
    let frontage_preferred = programme_automatic
        && target.is_none()
        && r.programme.as_ref().is_some_and(|p| {
            p.composition == Some(crate::programme::ProgrammeComposition::Row)
                || p.frontage_continuity.is_some_and(|v| v >= 0.75)
        });
    let mut frontage_attempts = 0;
    let recipes: Vec<_> = if !functional_candidates.is_empty() {
        functional_candidates
            .iter()
            .map(|c| {
                (
                    c.config.recipe.clone(),
                    c.config.overrides.variant.clone(),
                    None,
                )
            })
            .collect()
    } else if exact || config.recipe.is_some() || config.workshop.is_some() {
        vec![(
            config.recipe.clone(),
            config.overrides.variant.clone(),
            None,
        )]
    } else {
        let index = style_index()?;
        let candidates = if programme_automatic && let Some(p) = &r.programme {
            index.candidate_styles_for_programme(&query, &config, &r.seed, 4, p)?
        } else {
            index.candidate_styles_for_config(&query, &config, &r.seed, 4)?
        };
        candidates
            .iter()
            .map(|e| {
                (
                    Some(e.recipe_id.to_string()),
                    Some(e.variant_id.to_string()),
                    r.programme
                        .as_ref()
                        .filter(|_| programme_automatic)
                        .and_then(|p| p.preferred_floor(e, &config, &r.seed)),
                )
            })
            .collect()
    };
    let mut error = "No compatible architectural recipe.".to_string();
    let mut terrain_refusal = None;
    let mut platform_budget_retry = None;
    let simple_fallback_tried = simple_fallback.is_some();
    let recipes = if let Some(attempted) = simple_fallback {
        if !programme_automatic
            || target.is_some()
            || config.mode != HistoricalMode::HistoricalInspired
        {
            return Err("No automatic missing-family recovery applies.".into());
        }
        let Some(programme) = &r.programme else {
            return Err("No programme for missing-family recovery.".into());
        };
        let attempted_recipe_ids: Vec<_> = recipes
            .iter()
            .filter_map(|(recipe, _, _)| recipe.as_deref())
            .collect();
        let Some(entry) = style_index()?.simple_fallback_for_programme(
            &query,
            &config,
            &r.seed,
            programme,
            &attempted_recipe_ids,
        )?
        else {
            return Err("No additional compatible simple family.".into());
        };
        *attempted = true;
        vec![(
            Some(entry.recipe_id.to_owned()),
            Some(entry.variant_id.to_owned()),
            programme.preferred_floor(entry, &config, &r.seed),
        )]
    } else {
        recipes
    };
    for (recipe, variant, preferred_floor) in recipes {
        let mut config = config.clone();
        config.recipe = recipe;
        config.overrides.variant = variant;
        if let Some(floors) = preferred_floor {
            config.overrides.floors = Some(floors);
        }
        let functional_envelope = functional_candidates.iter().find(|c| {
            c.config.recipe == config.recipe
                && c.config.overrides.variant == config.overrides.variant
        });
        // C1 is opt-in for an already selected, declared source. It does not
        // replace an admission pin or add non-residential sources to the palette.
        let functional_hall = !exact
            && config.workshop.is_none()
            && r.function == ArchitectureFunction::Collective
            && r.programme.as_ref().is_some_and(|p| {
                p.composition == Some(crate::programme::ProgrammeComposition::Hall)
            })
            && crate::functional_programmes::registry()?
                .programmes
                .iter()
                .any(|p| p.pack_id == config.pack && Some(p.recipe_id) == config.recipe.as_deref());
        if functional_hall && target.is_some() {
            return Err("A registered functional hall has no declared imposed-footprint adapter; its source programme was not replaced.".into());
        }
        let spans = [size[2] - size[0] - 0.8, size[3] - size[1] - 0.8];
        let initial_budget = initial_ground_programme_dimensions(r, &config, exact, target);
        let desired = initial_budget.or_else(|| {
            r.occupation.as_ref().map(|o| {
                let a = area(&domain) * o.coverage;
                let aspect = o.frontage_m / o.depth_m;
                [libm::sqrt(a * aspect), libm::sqrt(a / aspect)]
            })
        });
        let resolved = if exact {
            crate::resolve_architecture(config.clone())
        } else if let Some(candidate) = functional_envelope {
            crate::functional_choices::resolve_candidate(r, candidate, spans)
        } else if functional_hall {
            crate::functional_programmes::resolve_functional_architecture(
                config.clone(),
                r.programme.as_ref().unwrap(),
                r.function,
                crate::functional_programmes::FunctionalSite { body_span_m: spans },
            )
            .map(|result| result.architecture)
        } else {
            resolve_urban_architecture_with_budget(
                config.clone(),
                r.function,
                spans,
                false,
                desired,
                r.occupation.as_ref().map(|o| o.coverage),
                r.parcel_fit.unwrap_or(true),
                initial_programme_area,
            )
            .or_else(|e| {
                if config.mode != HistoricalMode::HistoricalStrict
                    && r.parcel_fit.unwrap_or(true)
                    && matches!(
                        r.function,
                        ArchitectureFunction::Domestic | ArchitectureFunction::Mixed
                    )
                {
                    crate::resolve_architecture(config.clone())
                } else {
                    Err(e)
                }
            })
        };
        let mut resolved = match resolved {
            Ok(value) => value,
            Err(e) if functional_hall => {
                return Err(format!("Registered functional hall refused: {e}"));
            }
            Err(e) => {
                // A failed scalar minimum may prevent a resolved value. The
                // legacy pass must still be available, but only if a budget
                // was actually offered on this automatic native path.
                *budget_attempted |= initial_programme_area.is_some();
                error = e;
                continue;
            }
        };
        *budget_attempted |= initial_programme_area.is_some()
            && crate::strip_programme_budget::supported(&resolved.parameters);
        if simple_fallback_tried {
            resolved.plan.diagnostics.push(
                "Missing simple family recovery: after all four native source candidates refused, one untried simple source was selected from the same cultural/era-compatible seeded order. Existing successful choices, explicit controls and physical admission guards are unchanged; programme capacity is not certified.".into(),
            );
        }
        if let Some(diagnostic) = &unregistered_functional_diagnostic {
            resolved.plan.diagnostics.push(diagnostic.clone());
        }
        if let Some(dimensions) = initial_budget {
            resolved.plan.diagnostics.push(format!("Initial native footprint budget: programme target={:.3}m2 replaces coarse lot coverage before first admission; requested source-bounded dimensions {:.3} x {:.3} m, native body area {:.3}m2. Same source/variant/seed and native constructors, no additional placement search; intrinsic minima and physical site guards retained.", r.programme.as_ref().unwrap().built_area_m2.unwrap(), dimensions[0], dimensions[1], area(&body_domain(&resolved))));
        }
        if r.typology.is_some_and(|t| {
            t != ArchitectureTypology::Common && typology(resolved.parameters.layout) != t
        }) {
            error = "Chosen recipe variant does not match the requested typology.".into();
            if functional_hall {
                return Err(error);
            }
            continue;
        }
        if platform_budget_retry.is_none()
            && let Some(area) = native_platform_budget_target(r, &resolved, exact, target)
        {
            platform_budget_retry = Some((resolved.clone(), area));
        }
        // Default native composition is tried first. Constrained synthesis is
        // opt-in and retains its resolved body/level decisions on success.
        if target.is_none() {
            let prepared = PreparedPlan::new(&resolved);
            // The same lazy ticket serves existing frontage and native poses;
            // unsupported candidates and earlier successful poses create none.
            let recovery_ticket = OnceCell::new();
            if frontage_preferred
                && let Some(building) = try_frontage_reporting_prepared_with_recovery(
                    r,
                    &prepared,
                    &domain,
                    &neighbors,
                    &mut frontage_attempts,
                    false,
                    &mut terrain_refusal,
                    Some(&mut *recovery),
                    &recovery_ticket,
                )
            {
                return Ok(building);
            }
            let b = bounds(&prepared.plan_local);
            if !exact
                && !functional_hall
                && functional_envelope.is_none()
                && config.mode != HistoricalMode::HistoricalStrict
                && r.parcel_fit.unwrap_or(true)
                && (matches!(
                    resolved.parameters.footprint_family.as_str(),
                    "FP-L" | "FP-U" | "FP-COMPLEX"
                ) || crate::morphology::supports_components(&resolved.parameters))
            {
                // Variations keep the source programme's nominal scale when the
                // site is roomy; they do not grow to consume an entire estate.
                let w = (b[2] - b[0]).min(spans[0]);
                let d = (b[3] - b[1]).min(spans[1]);
                let nominal = rectangle(
                    size[0] + (size[2] - size[0] - w) * 0.5,
                    size[1] + (size[3] - size[1] - d) * 0.5,
                    w,
                    d,
                );
                let envelope = intersection(&local, &nominal);
                if let Ok(adapted) =
                    crate::engine::adapt_resolved_architecture(&resolved, &envelope, None)
                    && let Ok(building) = visual(
                        r,
                        &adapted,
                        base_frame.clone(),
                        &neighbors,
                        programme_automatic,
                        functional_hall,
                    )
                {
                    return Ok(prefer_accepted_adapted_front(
                        r,
                        &adapted,
                        &domain,
                        &neighbors,
                        building,
                        frontage_preferred,
                        frontage_attempts,
                    ));
                }
            }
            for align in [0.5, 0.1, 0.9] {
                let offset = Point {
                    x: size[0] + (spans[0] + 0.8 - (b[2] - b[0])) * 0.5 - b[0],
                    y: size[1] + (spans[1] + 0.8 - (b[3] - b[1])) * align - b[1],
                };
                let transform = Transform {
                    origin: transform_point(offset, &base_frame),
                    orientation_deg: base_frame.orientation_deg,
                };
                let mut physical_failure = None;
                match visual_with_front_access_prepared_reported(
                    r,
                    &prepared,
                    transform.clone(),
                    &neighbors,
                    programme_automatic,
                    functional_hall || functional_envelope.is_some(),
                    None,
                    false,
                    Some(&mut physical_failure),
                ) {
                    Ok(b) => {
                        return Ok(frontage_fallback(b, frontage_preferred, frontage_attempts));
                    }
                    Err(e) => {
                        remember_terrain_refusal(&e, &mut terrain_refusal);
                        // Keep the established frontage pool unchanged. Native
                        // poses extend only requests without that preference.
                        if !frontage_preferred && let Some(failure) = physical_failure {
                            if let Some(ticket) = recovery_ticket.get_or_init(|| recovery.ticket(r, &prepared)) {
                                recovery.observe_existing_native(r, ticket, &transform, failure);
                            }
                        }
                        error = e;
                    }
                }
            }
        }
        if functional_hall {
            // Exhausted rigid placements keep the source intact: never pass a
            // hall through domestic cleanup or an undeclared morphology adapter.
            return Err(format!(
                "Registered functional hall site admission refused: {error}"
            ));
        }
        if functional_envelope.is_some() {
            // Try only the next registered source after its rigid poses fail.
            // Never shrink/remorph a failed functional programme as a house.
            error =
                format!("Registered inspired functional envelope site admission refused: {error}");
            continue;
        }
        if (!exact || target.is_some())
            && config.mode != HistoricalMode::HistoricalStrict
            && r.parcel_fit.unwrap_or(true)
        {
            let inset = if target.is_some() {
                local.clone()
            } else {
                from_geo(
                    &to_geo(&local).buffer_with_style(
                        BufferStyle::new(
                            -resolved.parameters.overhang_m[0].max(0.3) - 2.0 * GRID_M,
                        )
                        .line_join(LineJoin::Miter(2.0 * libm::asin(0.25))),
                    ),
                )
            };
            match crate::engine::adapt_resolved_architecture(
                &resolved,
                &inset,
                target_local.as_ref(),
            ) {
                Ok(adapted) => match visual(
                    r,
                    &adapted,
                    base_frame.clone(),
                    &neighbors,
                    programme_automatic && target.is_none(),
                    functional_hall,
                ) {
                    Ok(b) => {
                        return Ok(prefer_accepted_adapted_front(
                            r,
                            &adapted,
                            &domain,
                            &neighbors,
                            b,
                            frontage_preferred,
                            frontage_attempts,
                        ));
                    }
                    Err(e) => {
                        remember_terrain_refusal(&e, &mut terrain_refusal);
                        error = e;
                    }
                },
                Err(e) => error = format!("{error} Constrained composition: {e}"),
            }
            // The city supplies an admission witness near an actual frontage.
            // A bounding-box search can miss that usable part of a tapered or
            // concave lot, or choose a part without a clear entrance corridor.
            // Treat the witness only as another envelope to try; it never
            // overrides the real cadastral, roof, reserve or access checks.
            if target.is_none()
                && let Some(hint) = &r.placement_hint
                && valid_surface(hint)
            {
                let hinted = intersection(&inset, &map_surface(hint, &inverse(&base_frame)));
                if valid_surface(&hinted)
                    && let Ok(adapted) =
                        crate::engine::adapt_resolved_architecture(&resolved, &hinted, None)
                    && let Ok(building) = visual(
                        r,
                        &adapted,
                        base_frame.clone(),
                        &neighbors,
                        programme_automatic,
                        functional_hall,
                    )
                {
                    return Ok(prefer_accepted_adapted_front(
                        r,
                        &adapted,
                        &domain,
                        &neighbors,
                        building,
                        frontage_preferred,
                        frontage_attempts,
                    ));
                }
            }
        }
    }
    if frontage_preferred {
        error.push_str(&format!(" Street-front preference exhausted {frontage_attempts} bounded rigid poses; cadastral, roof and access constraints were retained."));
    }
    if let Some(terrain) = terrain_refusal
        && !error.contains(&terrain)
    {
        error.push_str(&format!(
            " An earlier candidate fitting bodies/courts/structures failed terrain before roof/access checks: {terrain}"
        ));
    }
    if let Some((resolved, requested)) = platform_budget_retry {
        match retry_native_platform_budget(r, &resolved, requested, &domain, &neighbors) {
            Ok(building) => return Ok(building),
            Err(reason) => error.push_str(&format!(" {reason}")),
        }
    }
    Err(error)
}

fn plan_one(
    r: &PlacementRequest,
    occupied: &Surface,
    target: Option<&Surface>,
    exact: bool,
) -> Result<PlanBuilding, String> {
    if let Some(result) = crate::native_candidate::try_plan(r, occupied, target, exact) {
        return result;
    }
    let (initial, terrain_recovered) = plan_one_initial_with_terrain_recovery(r, occupied, target, exact)?;
    let automatic = !exact
        && target.is_none()
        && r.culture.mode == HistoricalMode::HistoricalInspired
        && r.parcel_fit != Some(false)
        && matches!(
            r.function,
            ArchitectureFunction::Domestic | ArchitectureFunction::Mixed
        )
        && r.config.as_ref().is_none_or(|c| {
            c.recipe.is_none() && c.workshop.is_none() && c.overrides.variant.is_none()
        });
    let building =
        if automatic && !terrain_recovered
            && let Some(area) = r.programme.as_ref().and_then(|p| p.built_area_m2) {
            improve_domestic_budget_selection(r, occupied, initial, area, true)
        } else {
            budget_selection::Selection::single(initial)
        };
    if native_ground_preparation_allowed(r, automatic) {
        Ok(building.finalize(r, occupied))
    } else {
        Ok(building.building)
    }
}

/// Upgrade only the final, already admitted source. Native portal preparation
/// must not replace a valid house by a poorer source or shrink its programme.
/// One cached structural graph, the same pose, then at most three rigid front
/// poses, then at most four already-cut alternative doors at the initial pose.
/// Plain Single rectangles receive only the existing pose, with no alternative
/// door or dimension search; intermediate foundation admission stays unchanged.
/// An unsuccessful upgrade keeps the admitted proxy and its explicit
/// interior limitation; detail realization still refuses a mismatched portal.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum FinalEntryPolicy {
    LegacyNominalSafeguard,
    PreserveWinningGeometry,
}

struct FinalEntryResult {
    building: PlanBuilding,
    policy: FinalEntryPolicy,
}

fn retain_final_native_entry(
    r: &PlacementRequest,
    occupied: &Surface,
    previous: PlanBuilding,
) -> PlanBuilding {
    retain_final_native_entry_result(r, occupied, previous).building
}

fn retain_final_native_entry_result(
    r: &PlacementRequest,
    occupied: &Surface,
    previous: PlanBuilding,
) -> FinalEntryResult {
    let mut policy = FinalEntryPolicy::LegacyNominalSafeguard;
    let building = retain_final_native_entry_with_policy(r, occupied, previous, &mut policy);
    FinalEntryResult { building, policy }
}

fn retain_final_native_entry_with_policy(
    r: &PlacementRequest,
    occupied: &Surface,
    mut previous: PlanBuilding,
    policy: &mut FinalEntryPolicy,
) -> PlanBuilding {
    if !native_ground_preparation_allowed(r, true) || r.parcel_fit == Some(false) {
        return previous;
    }
    // The preceding native-foundation admission has already identified the
    // supported ground Strip scope. Singles use a cheap canonical source
    // prefilter before unpacking only the final admitted candidate. The actual
    // retained parameters/body still undergo the full preparation checks.
    let strip = previous.diagnostics.iter()
        .any(|d| d.starts_with("Native ground-strip foundation:"));
    let single_source = !strip && previous.volumes.len() == 1
        && catalogue().ok().and_then(|data| {
            let recipe = data.recipes.iter().find(|recipe| recipe.id == previous.recipe_id)?;
            if recipe.parameters.variant_id == previous.variant_id {
                Some(&recipe.parameters)
            } else {
                recipe.variants.iter()
                    .find(|variant| variant.parameters.variant_id == previous.variant_id)
                    .map(|variant| &variant.parameters)
            }
        }).is_some_and(crate::engine::single_native_entry_parameters);
    if !strip && !single_source {
        return previous;
    }
    let resolved = match previous.resolved.unpack() {
        Ok(value) if value.entrance.is_none() => value,
        _ => return previous,
    };
    let single = resolved.parameters.layout == crate::catalogue::Layout::Single;
    if single
        && (resolved.config.mode != HistoricalMode::HistoricalInspired
            || r.config.as_ref().is_some_and(|c| c.mode != HistoricalMode::HistoricalInspired))
    {
        return previous;
    }
    // This capability needs physical frame/wall operators before access.
    // It may enrich the selected final pose, but failure must not choose a
    // different admitted size merely to obtain the newly supported entrance.
    // Classify the already unpacked effective parameters: no archive lookup,
    // second unpack, extra preparation, geometry retry or recipe identity.
    if single && crate::engine::single_frame_entry_details(&resolved.parameters) {
        *policy = FinalEntryPolicy::PreserveWinningGeometry;
    }
    let prepared = PreparedPlan::with_native_entry(&resolved);
    let mut error = match prepared.foundation() {
        Ok(crate::engine::FoundationPreparation::Supported(physical))
            if physical.entry.is_some() =>
        {
            String::new()
        }
        Ok(crate::engine::FoundationPreparation::Unsupported(reason)) if single => {
            previous.diagnostics.push(format!("Native planning entrance deferred: final Single preparation unsupported: {reason} Admitted geometry retained without changing its pose or selecting another door."));
            return previous;
        }
        Ok(_) => return previous,
        Err(reason) => {
            if single {
                previous.diagnostics.push(format!("Native planning entrance deferred: final Single preparation failed before pose admission: {reason} Admitted geometry retained; no interior access certificate was fabricated."));
            } else {
                previous.diagnostics.push(format!("Native planning entrance deferred: {reason} Admitted geometry retained; no interior access certificate was fabricated."));
            }
            return previous;
        }
    };
    let neighbors = unite(
        &r.neighbors
            .iter()
            .map(|n| n.footprint.clone())
            .chain(std::iter::once(occupied.clone()))
            .collect::<Vec<_>>(),
    );
    if single {
        match visual_with_front_access_prepared(
            r, &prepared, previous.transform.clone(), &neighbors, true, false, None, true,
        ) {
            Ok(mut building) => {
                for diagnostic in &mut building.diagnostics {
                    if diagnostic.starts_with("Native ground-strip foundation:") {
                        *diagnostic = "Native ground-single foundation: the unchanged whole body determines the footing; the complete native passage and public connector retain cadastral, reserve, neighbour and support rights. Existing foundation-step, slope and roof limits are unchanged; household capacity remains unknown.".into();
                    }
                }
                return finish_native_entry_upgrade(&previous, building,
                    "Native planning entrance upgrade: final Single source, dimensions, floors and pose retained; 1/1 existing pose checked. No alternative door, rigid-pose retry, source selection or dimension search.".into());
            }
            Err(reason) => {
                previous.diagnostics.push(format!("Native planning entrance deferred: final Single 1/1 existing pose; {reason} Admitted geometry retained without changing its pose or selecting another door."));
                return previous;
            }
        }
    }
    // The current-pose attempt needs no front envelope. Preserve the same
    // fallback order, but compute it only if this first native entrance
    // admission fails; visual still performs its complete roof checks.
    let poses = std::iter::once((previous.transform.clone(), None)).chain(
        std::iter::once_with(|| {
            let domain = difference(&difference(&r.buildable, &r.reserves), &neighbors);
            frontage_poses_prepared(r, &prepared, &domain)
                .into_iter()
                .filter(|(pose, _)| {
                    pose.origin != previous.transform.origin
                        || pose.orientation_deg != previous.transform.orientation_deg
                })
                .take(3)
                .map(|(pose, front)| (pose, Some(front)))
                .collect::<Vec<_>>()
        })
        .flatten(),
    );
    let mut attempts = 0;
    for (pose, front) in poses {
        attempts += 1;
        match visual_with_front_access_prepared(
            r, &prepared, pose, &neighbors, true, false, front, true,
        ) {
            Ok(building) => return finish_native_entry_upgrade(&previous, building,
                format!("Native planning entrance upgrade: admitted final source, dimensions, floors and programme retained; {attempts}/4 rigid poses checked. No new source selection or dimension search.")),
            Err(reason) => error = reason,
        }
    }
    // All canonical poses have failed. Consume only doors from that same
    // access graph, in the preparation's deterministic bounded order. Keep
    // the original pose and every original occupation part; no smaller house,
    // replacement wall cut, extra source draw or new structural unit is made.
    let alternatives = match prepared.foundation() {
        Ok(crate::engine::FoundationPreparation::Supported(physical)) =>
            physical.entry.as_ref().map(|entry| entry.alternatives.as_slice()).unwrap_or(&[]),
        _ => &[],
    };
    let mut alternative_attempts = 0;
    for (index, pair) in alternatives.iter().enumerate() {
        alternative_attempts += 1;
        let candidate = match prepared.with_existing_entry(index) {
            Ok(value) => value,
            Err(reason) => { error = reason; continue; }
        };
        match visual_with_front_access_prepared(
            r, &candidate, previous.transform.clone(), &neighbors, true, false, None, true,
        ) {
            Ok(building) => return finish_native_entry_upgrade(&previous, building,
                format!("Native planning entrance upgrade: admitted final source, dimensions, floors and programme retained; {attempts}/4 canonical rigid poses checked, then existing portal {} ({alternative_attempts}/{} alternatives) at the initial pose. No new door, structural graph, source selection or dimension search.", pair.portal_id, alternatives.len())),
            Err(reason) => error = reason,
        }
    }
    previous.diagnostics.push(format!("Native planning entrance deferred: {attempts}/4 rigid poses; {alternative_attempts}/{} existing portal alternatives at the initial pose; {error} Admitted geometry retained; detailed interior admission still requires a matching native portal.", alternatives.len()));
    previous
}

fn finish_native_entry_upgrade(
    previous: &PlanBuilding,
    mut building: PlanBuilding,
    outcome: String,
) -> PlanBuilding {
    for diagnostic in &previous.diagnostics {
        if !diagnostic.starts_with("Retained architectural plan:")
            && !building.diagnostics.contains(diagnostic)
        {
            building.diagnostics.push(diagnostic.clone());
        }
    }
    if previous.diagnostics.iter().any(|d| d.starts_with("Domestic footprint budget:")) {
        for diagnostic in &mut building.diagnostics {
            *diagnostic = diagnostic.replace(
                "target advisory, no declared budget adapter",
                "declared domestic rectangle/strip budget; final status follows",
            );
        }
        building.diagnostics.dedup();
    }
    building.diagnostics.push(outcome);
    building
}

/// A rectangle proposal from the convex hull of a single legal polygon. A
/// shallow frontage notch may lie outside this guide: visual_with_front always
/// checks the original polygon, holes, terrain, roofs and actual access. This
/// bounded scalar calculation never certifies or clips architectural geometry.
fn budget_front_rectangle(
    access: &ArchitectureAccess,
    legal: &Surface,
    width: f64,
    min_depth: f64,
    max_depth: f64,
    orientation: Option<f64>,
) -> Option<(f64, Transform)> {
    use geo::ConvexHull;
    if legal.len() != 1 || !legal[0].holes.is_empty() || legal[0].outer.len() > 64 {
        return None;
    }
    let [mut a, mut b] = access.segment;
    if a.x.total_cmp(&b.x).then(a.y.total_cmp(&b.y)).is_gt() {
        std::mem::swap(&mut a, &mut b);
    }
    let guide = from_geo(&geo::MultiPolygon(vec![to_geo(legal).convex_hull()]));
    let origin = point((a.x + b.x) * 0.5, (a.y + b.y) * 0.5);
    let angle = orientation.unwrap_or_else(|| libm::atan2(b.y - a.y, b.x - a.x).to_degrees());
    for angle in [angle, angle + 180.] {
        let frame = Transform {
            origin,
            orientation_deg: angle,
        };
        let local = map_surface(&guide, &inverse(&frame));
        let mut ring = local[0].outer.clone();
        let signed: f64 = ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .map(|(a, b)| a.x * b.y - b.x * a.y)
            .sum();
        if signed < 0. {
            ring.reverse();
        }
        let ends = access.segment.map(|p| transform_point(p, &inverse(&frame)));
        let length = (ends[1].x - ends[0].x).abs();
        // An oblique frontage is wholly behind the proposed front line. Its
        // actual connection remains mandatory; it is not replaced by an axis.
        let front = bounds(&local)[1].max(ends[0].y).max(ends[1].y).max(0.) + 0.1;
        let interval = |depth: f64| -> Option<(f64, f64)> {
            let half = (length - width) * 0.5 - 0.1;
            let (mut lo, mut hi) = if half >= 0. { (-half, half) } else { (0., 0.) };
            for (a, b) in ring.iter().zip(ring.iter().cycle().skip(1)) {
                let nx = b.y - a.y;
                let ny = a.x - b.x;
                let rhs =
                    nx * a.x + ny * a.y - ny * front - nx.abs() * width * 0.5 - ny.max(0.) * depth;
                if nx.abs() < 1e-9 {
                    if rhs < -1e-8 {
                        return None;
                    }
                } else if nx > 0. {
                    hi = hi.min(rhs / nx);
                } else {
                    lo = lo.max(rhs / nx);
                }
                if lo > hi + 1e-8 {
                    return None;
                }
            }
            Some((lo, hi.max(lo)))
        };
        if interval(min_depth).is_none() {
            continue;
        }
        let mut low = min_depth;
        let mut high = max_depth.max(low);
        // Millimetre precision is enough; no RNG, payload or native roof build.
        if interval(high).is_some() {
            low = high;
        } else {
            for _ in 0..16 {
                let mid = (low + high) * 0.5;
                if interval(mid).is_some() {
                    low = mid;
                } else {
                    high = mid;
                }
            }
        }
        let (lo, hi) = interval(low)?;
        return Some((
            low,
            Transform {
                origin: transform_point(
                    Point {
                        x: 0_f64.clamp(lo, hi),
                        y: front,
                    },
                    &frame,
                ),
                orientation_deg: angle,
            },
        ));
    }
    None
}

fn budget_envelope_prepared(r: &PlacementRequest, prepared: &PreparedPlan<'_>) -> [f64; 4] {
    let resolved = prepared.resolved;
    let mut parts = vec![prepared.plan_local.clone()];
    if let Some(entry) = &resolved.entrance {
        parts.push(entry.passage.clone());
    }
    if prepared.retain_native_entry
        && native_ground_preparation_allowed(r, true)
        && let Ok(crate::engine::FoundationPreparation::Supported(physical)) = prepared.foundation()
        && physical.entry.is_some()
    {
        parts.extend(physical.occupation_parts.iter().cloned());
    }
    parts.extend(prepared.roofs().iter().cloned());
    parts.extend(
        resolved
            .plan
            .features
            .iter()
            .filter_map(|f| f.roof.as_ref())
            .map(|r| r.domain.clone()),
    );
    bounds(&unite(&parts))
}

/// One post-admission pass on the already selected source, never nested in the
/// 80-candidate morphology search. At most 8 dimension pairs / 24 rigid poses.
// Existing test callers retain their pre-finalization interface. Production
// consumes the typed selection so the nominal entrance fallback is not lost.
#[cfg(test)]
fn improve_domestic_budget(
    r: &PlacementRequest, occupied: &Surface, best: PlanBuilding, target: f64,
) -> PlanBuilding {
    improve_domestic_budget_selection(r, occupied, best, target, true).building
}

fn improve_domestic_budget_selection(
    r: &PlacementRequest,
    occupied: &Surface,
    mut best: PlanBuilding,
    target: f64,
    allow_adapted: bool,
) -> budget_selection::Selection {
    const MAX_POSES: usize = 24;
    const MAX_DIMENSIONS: usize = 8;
    const TOLERANCE: f64 = 0.10;
    let resolved = match best.resolved.unpack() {
        Ok(p) => p,
        Err(_) => return budget_selection::Selection::single(best),
    };
    let shape = match crate::morphology::domestic_budget_shape(&resolved.parameters, &resolved.plan)
    {
        Ok(shape) => shape,
        Err(reason) => {
            best.diagnostics.push(format!("Domestic footprint budget: target={target:.3}m2 actual={:.3}m2; unsupported: {reason}; valid source plan retained.", area(&best.footprint)));
            return budget_selection::Selection::single(best);
        }
    };
    let initial_area = area(&best.footprint);
    let mut error = (initial_area / target).ln().abs();
    let mut poses = 0;
    let mut dimensions = 0;
    let mut admitted = 0;
    let mut terrain_evaluations = 0;
    let mut terrain_correction_used = false;
    let mut setback_reserved = false;
    let mut setback_note: Option<String> = None;
    let catalog = match catalogue() {
        Ok(c) => c,
        Err(_) => return budget_selection::Selection::single(best),
    };
    let Some(recipe) = catalog.recipes.iter().find(|c| c.id == resolved.recipe_id) else {
        return budget_selection::Selection::single(best);
    };
    let source = recipe
        .variants
        .iter()
        .find(|v| v.parameters.variant_id == resolved.parameters.variant_id)
        .map_or(&recipe.parameters, |v| &v.parameters);
    // Reuse the existing explicit parcel_fit/inspired dimension allowance;
    // nothing in this pass widens it or relaxes room/stair/court minima.
    let size = resolved.config.size;
    let fraction = shape.court_fraction;
    let minimum_width = shape.minimum_body[0].max(source.width_m[0] * size - shape.passage_m);
    let minimum_depth = shape.minimum_body[1]
        .max(source.depth_m[0] * size * (1. - fraction))
        .max(if fraction > 0. {
            shape.minimum_court_depth * (1. - fraction) / fraction
        } else {
            0.
        });
    let nominal_minima = [minimum_width, minimum_depth];
    let maximum_width = source.width_m[1] * size * 2. - shape.passage_m;
    let maximum_depth = source.depth_m[1] * size * 2. * (1. - fraction);
    let source_aspect = source_aspect_budget::SourceAspectBudget::for_candidate(r, &resolved, source);
    let neighbors = unite(
        &r.neighbors
            .iter()
            .map(|n| n.footprint.clone())
            .chain(std::iter::once(occupied.clone()))
            .collect::<Vec<_>>(),
    );
    let domain = difference(&difference(&r.buildable, &r.reserves), &neighbors);
    let legal = intersection(
        &domain,
        &difference(r.roof_domain.as_ref().unwrap_or(&r.cadastral), &r.reserves),
    );
    let margin = resolved.parameters.overhang_m[0].max(0.1) + 0.102;
    let length = |a: &ArchitectureAccess| {
        libm::hypot(
            a.segment[1].x - a.segment[0].x,
            a.segment[1].y - a.segment[0].y,
        )
    };
    let mut accesses: Vec<_> = r
        .accesses
        .iter()
        .filter(|a| {
            matches!(a.kind.as_str(), "public" | "collective" | "private")
                && a.width_m.is_finite()
                && a.width_m >= 0.8
                && length(a).is_finite()
                && length(a) >= 0.8
                && a.segment.iter().all(|p| p.x.is_finite() && p.y.is_finite())
        })
        .collect();
    accesses.sort_by(|a, b| length(b).total_cmp(&length(a)).then(a.id.cmp(&b.id)));
    let mut nominal = None;
    let mut adapted_won = false;
    let mut adapted_started = false;
    let mut nominal_counts = None;
    // Only the second phase skips dimensions already constructed by phase 0.
    // The nominal phase keeps its historical order/dedup/early exits exactly.
    let mut nominal_dimensions: Vec<(usize, [f64; 3])> = vec![];
    'phases: for adapted in [false, true] {
        let [minimum_width, minimum_depth] = if adapted {
            if !allow_adapted || dimensions == MAX_DIMENSIONS || poses == MAX_POSES
                || (area(&best.footprint) / target - 1.).abs() <= TOLERANCE {
                break;
            }
            let Some(minima) = adapted_single_budget::adapted_axis_minima(
                r, &resolved, source, nominal_minima,
            ) else { break; };
            nominal = Some(best.clone());
            nominal_counts = Some((dimensions, poses, terrain_evaluations));
            adapted_started = true;
            minima
        } else {
            nominal_minima
        };
        for (access_slot, access) in accesses.iter().copied().enumerate().take(2) {
        if (area(&best.footprint) / target - 1.).abs() <= TOLERANCE {
            break;
        }
        let [a, b] = access.segment;
        let origin = point((a.x + b.x) * 0.5, (a.y + b.y) * 0.5);
        let angle = libm::atan2(b.y - a.y, b.x - a.x).to_degrees();
        let depth = [angle, angle + 180.]
            .into_iter()
            .map(|orientation_deg| {
                let available = bounds(&map_surface(
                    &legal,
                    &inverse(&Transform {
                        origin,
                        orientation_deg,
                    }),
                ));
                available[3] - available[1].max(0.)
            })
            .fold(0_f64, f64::max)
            - 2. * margin;
        let max_depth = maximum_depth.min(depth * (1. - fraction));
        let high = maximum_width
            .min(length(access) - 2. * margin - shape.passage_m)
            .min(target / minimum_depth)
            .max(minimum_width);
        if max_depth < minimum_depth || high > maximum_width {
            continue;
        }
        let mut seen = Vec::<[f64; 3]>::new();
        let guided = legal.len() == 1 && legal[0].holes.is_empty() && legal[0].outer.len() <= 64;
        let mut couples = Vec::<(f64, f64, Option<f64>)>::new();
        if guided {
            let ring = &legal[0].outer;
            let long_axis = ring
                .iter()
                .zip(ring.iter().cycle().skip(1))
                .max_by(|(a, b), (c, d)| {
                    libm::hypot(b.x - a.x, b.y - a.y).total_cmp(&libm::hypot(d.x - c.x, d.y - c.y))
                })
                .map(|(a, b)| libm::atan2(b.y - a.y, b.x - a.x).to_degrees() - 90.);
            // Reallocate the same four pairs: two widths at the street axis,
            // two at the actual long parcel edge. A 6-degree skew otherwise
            // caps a deep burgage at half its usable depth.
            for orientation in [None, long_axis] {
                let extra = resolved.parameters.overhang_m[0] + GRID_M;
                let minimum_envelope_depth = minimum_depth / (1. - fraction) + extra;
                let fits = |width| {
                    budget_front_rectangle(
                        access,
                        &legal,
                        width + shape.passage_m + extra,
                        minimum_envelope_depth,
                        minimum_envelope_depth,
                        orientation,
                    )
                    .is_some()
                };
                if !fits(minimum_width) {
                    continue;
                }
                let mut low = minimum_width;
                let mut upper = maximum_width.min(target / minimum_depth).max(low);
                if fits(upper) {
                    low = upper;
                } else {
                    for _ in 0..16 {
                        let mid = (low + upper) * 0.5;
                        if fits(mid) {
                            low = mid;
                        } else {
                            upper = mid;
                        }
                    }
                }
                couples.extend([(low, 1., orientation), (minimum_width, 1., orientation)]);
            }
        } else {
            couples.extend([
                (high, 1., None),
                (high, 0.5, None),
                ((high * 0.6).max(minimum_width), 1., None),
                ((high * 0.6).max(minimum_width), 0.5, None),
            ]);
        }
        for (width, depth_factor, orientation) in couples {
            if dimensions == MAX_DIMENSIONS {
                break 'phases;
            }
            let mut width = if guided {
                (libm::floor(width / GRID_M) * GRID_M).max(minimum_width)
            } else {
                snap(width)
            };
            let mut depth = snap(
                ((target / width).min(if guided { maximum_depth } else { max_depth })
                    * depth_factor)
                    .max(minimum_depth),
            );
            let aspect_limits = [
                [minimum_width, maximum_width],
                [minimum_depth, if guided { maximum_depth } else { max_depth }],
            ];
            let mut guide_minimum_depth = minimum_depth;
            let mut aspect_changed = false;
            let mut setback_slot = false;
            if let Some(aspect) = source_aspect {
                let Some(projected) = aspect.project([width, depth], aspect_limits) else {
                    continue;
                };
                aspect_changed = projected != [width, depth];
                [width, depth] = projected;
                let Some([low, high]) = aspect.depth_bounds(width, aspect_limits) else {
                    continue;
                };
                guide_minimum_depth = low;
                depth = depth.min(high);
                if depth < guide_minimum_depth {
                    continue;
                }
            }
            if guided {
                let extra_depth = resolved.parameters.overhang_m[0] + GRID_M;
                match budget_front_rectangle(
                    access,
                    &legal,
                    width + shape.passage_m + resolved.parameters.overhang_m[0] + GRID_M,
                    guide_minimum_depth / (1. - fraction) + extra_depth,
                    depth / (1. - fraction) + extra_depth,
                    orientation,
                ) {
                    Some((fits, _)) => {
                        depth = (libm::floor((fits - extra_depth) * (1. - fraction) / GRID_M) * GRID_M)
                            .max(guide_minimum_depth);
                    }
                    None if aspect_changed && source_aspect.is_some()
                        && orientation.is_some() && access.kind == "public"
                        && !setback_reserved => {
                        // Reuse this existing long-edge dimension slot. Its
                        // source-compliant W/D stay unchanged; no added pair.
                        setback_slot = true;
                    }
                    None => continue,
                }
            }
            // domestic_budget_plan snaps the rectangle once more. Check that
            // actual construction too when a non-integral size leaves a source
            // minimum between grid points; do not broaden the ratio tolerance.
            if source_aspect.is_some_and(|aspect|
                !aspect.contains([width, depth], aspect_limits)
                    || !aspect.contains([snap(width), snap(depth)], aspect_limits)) {
                continue;
            }
            if seen.iter().any(|p| {
                (p[0] - width).abs() < GRID_M
                    && (p[1] - depth).abs() < GRID_M
                    && (p[2] - orientation.unwrap_or(angle)).abs() < 0.001
            }) {
                continue;
            }
            let key = [width, depth, orientation.unwrap_or(angle)];
            if adapted && nominal_dimensions.iter().any(|(slot, p)|
                *slot == access_slot
                    && (p[0] - key[0]).abs() < GRID_M
                    && (p[1] - key[1]).abs() < GRID_M
                    && (p[2] - key[2]).abs() < 0.001) {
                continue;
            }
            seen.push(key);
            if !adapted {
                nominal_dimensions.push((access_slot, key));
            }
            dimensions += 1;
            if setback_slot {
                // Reserve globally even if native construction or the exact
                // translation is refused. No second setback geometry follows.
                setback_reserved = true;
                setback_note = Some("one existing dimension slot reserved; native construction or proposal pending".into());
            }
            let Ok(plan) = crate::morphology::domestic_budget_plan(
                &resolved.parameters,
                &resolved.plan,
                &shape,
                width,
                depth,
            ) else {
                continue;
            };
            let mut candidate = resolved.clone();
            candidate.parameters.width_m = [width + shape.passage_m; 2];
            candidate.parameters.depth_m = [snap(depth / (1. - fraction)); 2];
            candidate.plan = plan;
            candidate.entrance = None;
            if candidate.parameters.gallery_cover.enabled
                && crate::engine::retain_structural_circulation(&mut candidate).is_err()
            {
                continue;
            }
            let prepared = PreparedPlan::new(&candidate);
            let mut candidates = if setback_slot {
                match source_aspect_setback::propose(
                    r, &prepared, access, &neighbors, orientation.unwrap(),
                ) {
                    Ok(Some(proposal)) => {
                        setback_note = Some(format!("one proposal from the current long edge/access; {} convex support constraints; {:.6}m rigid translation; native admission pending", proposal.constraints, proposal.translation_m));
                        vec![(proposal.transform, access)]
                    }
                    Ok(None) => {
                        setback_note = Some("empty fixed rear domains; no claim about another source/pose".into());
                        continue;
                    }
                    Err(reason) => {
                        setback_note = Some(format!("unsupported: {reason}"));
                        continue;
                    }
                }
            } else {
                frontage_poses_prepared(r, &prepared, &domain)
            };
            if guided && !setback_slot {
                let e = budget_envelope_prepared(r, &prepared);
                let guide_pose = budget_front_rectangle(
                    access,
                    &legal,
                    e[2] - e[0],
                    e[3] - e[1],
                    e[3] - e[1],
                    orientation,
                );
                if let Some((_, pose)) = guide_pose {
                    // Strip front is the end opposite its retained rear court.
                    let flip = fraction > 0.;
                    let center = if flip {
                        Point {
                            x: (e[0] + e[2]) * 0.5,
                            y: e[3],
                        }
                    } else {
                        Point {
                            x: -(e[0] + e[2]) * 0.5,
                            y: -e[1],
                        }
                    };
                    candidates.insert(
                        0,
                        (
                            Transform {
                                origin: transform_point(center, &pose),
                                orientation_deg: pose.orientation_deg
                                    + if flip { 180. } else { 0. },
                            },
                            access,
                        ),
                    );
                }
            }
            let mut first_admission_failure = true;
            for (transform, aimed) in candidates {
                if !std::ptr::eq(aimed, access) {
                    continue;
                }
                if poses == MAX_POSES {
                    break 'phases;
                }
                poses += 1;
                let terrain_pose = aspect_changed.then(|| transform.clone());
                let admission = visual_with_front_access_prepared(
                    r,
                    &prepared,
                    transform,
                    &neighbors,
                    true,
                    false,
                    Some(aimed),
                    true,
                );
                let mut admitted_terrain_reduction = false;
                let building = match admission {
                    Ok(building) => {
                        if setback_slot {
                            setback_note = Some("1/1 proposal admitted by unchanged native site, roof, terrain and access guards".into());
                        }
                        building
                    }
                    Err(reason) => {
                        if setback_slot {
                            setback_note = Some(format!("1/1 proposal refused by native admission: {reason}; incumbent retained"));
                            continue;
                        }
                        let first = first_admission_failure;
                        first_admission_failure = false;
                        if !first || !aspect_changed || terrain_correction_used
                            || dimensions == MAX_DIMENSIONS || poses == MAX_POSES
                            || terrain_evaluations == source_terrain_budget::MAX_EVALUATIONS {
                            continue;
                        }
                        // Inspect the actual first failed pose, not its error
                        // text. Full-size successes incur no duplicate terrain
                        // check; every other pose retains the full candidate.
                        let correction = source_terrain_budget::reduce(
                            r, &candidate, [snap(width), snap(depth)], terrain_pose.as_ref().unwrap(),
                            aimed, &neighbors, source_aspect.unwrap(), aspect_limits,
                            source_terrain_budget::MAX_EVALUATIONS - terrain_evaluations,
                        );
                        terrain_evaluations += correction.evaluations;
                        let Some(proposal) = correction.proposal else { continue; };
                        let [reduced_width, reduced_depth] = proposal.dimensions;
                        if (reduced_width * reduced_depth / target).ln().abs() + 1e-6 >= error {
                            continue;
                        }
                        // One global reallocation: a reduced dimension consumes
                        // one of eight, and its admission consumes one of 24.
                        // At most seven ordinary couples then remain available.
                        terrain_correction_used = true;
                        dimensions += 1;
                        let Ok(plan) = crate::morphology::domestic_budget_plan(
                            &candidate.parameters, &candidate.plan, &shape,
                            reduced_width, reduced_depth,
                        ) else { continue; };
                        let mut reduced = candidate.clone();
                        reduced.parameters.width_m = [reduced_width; 2];
                        reduced.parameters.depth_m = [reduced_depth; 2];
                        reduced.plan = plan;
                        reduced.entrance = None;
                        let reduced_prepared = PreparedPlan::new(&reduced);
                        poses += 1;
                        match visual_with_front_access_prepared(
                            r, &reduced_prepared, proposal.transform, &neighbors,
                            true, false, Some(aimed), true,
                        ) {
                            Ok(building) => {
                                admitted_terrain_reduction = true;
                                building
                            }
                            Err(_) => continue,
                        }
                    }
                };
                admitted += 1;
                let candidate_error = (area(&building.footprint) / target).ln().abs();
                if candidate_error + 1e-6 < error {
                    error = candidate_error;
                    best = building;
                    adapted_won = adapted;
                }
                // A reduced success must not pre-empt the remaining full-size
                // poses of this same dimension pair. Full-size successes keep
                // their ordinary early stop, within the global pose budget.
                if !admitted_terrain_reduction
                    && (area(&best.footprint) / target - 1.).abs() <= TOLERANCE {
                    break 'phases;
                }
            }
            // The reduction already meets the programme: after its original
            // full-size pair is exhausted, do not explore other dimensions.
            if (area(&best.footprint) / target - 1.).abs() <= TOLERANCE {
                break 'phases;
            }
        }
    }
    } // shared nominal/adapted phases: no counters or terrain/setback flags reset
    if !adapted_won { nominal = None; }
    let annotate = |best: &mut PlanBuilding| {
    let actual = area(&best.footprint);
    let met = (actual / target - 1.).abs() <= TOLERANCE;
    for diagnostic in &mut best.diagnostics {
        *diagnostic = diagnostic.replace(
            "target advisory, no declared budget adapter",
            "declared domestic rectangle/strip budget; final status follows",
        );
    }
    best.diagnostics.push(format!("Domestic footprint budget: target={target:.3}m2 actual={actual:.3}m2 ratio={:.3} target_met={met} tolerance=0.10; initial={initial_area:.3}m2; {dimensions}/8 dimension pairs, {poses}/24 rigid poses, {admitted} admitted; chosen source, floors, court fraction and passage retained. {}", actual/target,
        if met { "Declared target tolerance met; continuous frontage/party walls are not certified." } else { "Bounded search did not meet target; best validated plan retained, not a proof of impossibility." }));
    if terrain_evaluations > 0 {
        best.diagnostics.push(format!("Source aspect terrain guide: {terrain_evaluations}/8 exact rectangle terrain evaluations; {}/1 reduced dimension allocated within the same 8 dimension / 24 admission budget. Fixed facade centre and orientation; other full-size poses retained. Final site, roof, source and access guards unchanged; no optimality certificate.", usize::from(terrain_correction_used)));
    }
    if let Some(note) = &setback_note {
        best.diagnostics.push(format!("Source aspect setback: {note}. At most one existing dimension slot and one of 24 admissions; dimensions/source/floors unchanged by translation; no native doorway or optimality certificate inferred."));
    }
    if adapted_started {
        let (nominal_dimensions, nominal_poses, nominal_terrain) = nominal_counts.unwrap();
        best.diagnostics.push(format!("Adapted domestic budget phases: nominal first used {nominal_dimensions}/8 dimensions, {nominal_poses}/24 admissions, {nominal_terrain}/8 terrain-guide evaluations; adapted minima used only the shared remainder. No nominal success was displaced by a worse area score; final native entrance preservation is checked separately."));
    }
    };
    annotate(&mut best);
    if let Some(fallback) = &mut nominal { annotate(fallback); }
    budget_selection::Selection { building: best, nominal }
}

pub fn plan_batch(input: PlanBatchRequest) -> Result<PlanBatch, String> {
    if input.schema_version != "1" {
        return Err("Unsupported plan request schema.".into());
    }
    let mut result = PlanBatch {
        schema_version: "1".into(),
        generator_version: PLAN_VERSION.into(),
        buildings: vec![],
        refusals: vec![],
        open_spaces: vec![],
        materials: catalogue()?.materials.clone(),
    };
    let mut ids = BTreeSet::new();
    let mut occupied = OccupationIndex::default();
    for mut r in input.requests {
        if !ids.insert(r.id.clone()) {
            return Err("Duplicate architectural identity.".into());
        }
        if r.function == ArchitectureFunction::OpenSpace {
            result.open_spaces.push(OpenSpace {
                id: r.id,
                parcel_id: r.parcel_id,
                surface: r.cadastral,
            });
            continue;
        }
        let mut exact = false;
        if let Some(s) = &input.settings {
            if let Some(fit) = s.parcel_fit {
                r.parcel_fit = Some(fit);
            }
            if let Some(t) = s.typology {
                r.typology = Some(t);
            }
            if let Some(c) = &s.house_config
                && matches!(
                    r.function,
                    ArchitectureFunction::Domestic | ArchitectureFunction::Mixed
                )
            {
                if c.workshop.is_none() && c.pack != r.culture.pack
                    || s.floors
                        .zip(c.overrides.floors)
                        .is_some_and(|(a, b)| a != b)
                {
                    result.refusals.push(PlacementRefusal {
                        id: r.id,
                        parcel_id: r.parcel_id,
                        code: "model_conflict".into(),
                        message: "Explicit model conflicts with culture or floors.".into(),
                        attempts: 0,
                    });
                    continue;
                }
                r.config = Some(c.clone());
                exact = true;
            }
            if let Some(f) = s.floors {
                r.config
                    .get_or_insert_with(HouseConfig::default)
                    .overrides
                    .floors = Some(f);
            }
        }
        match plan_one(
            &r,
            &occupied.local(&r.cadastral),
            input.footprints.get(&r.id),
            exact,
        ) {
            Ok(b) => {
                let mut parts = vec![
                    b.footprint.clone(),
                    b.courtyards.clone(),
                    b.circulation.clone(),
                ];
                parts.extend(b.structural_features.iter().map(|f| f.surface.clone()));
                occupied.insert(unite(&parts));
                result.buildings.push(b);
            }
            Err(message) => result.refusals.push(PlacementRefusal {
                id: r.id,
                parcel_id: r.parcel_id,
                code: "plan_refused".into(),
                message,
                attempts: 0,
            }),
        }
    }
    Ok(result)
}

#[derive(Deserialize)]
pub struct RealizePlanRequest {
    pub building: PlanBuilding,
    #[serde(default)]
    pub interiors: bool,
}

pub fn realize_plan(input: RealizePlanRequest) -> Result<HouseBatch, String> {
    let b = input.building;
    let resolved = b.resolved.unpack()?;
    if input.interiors
        && !matches!(
            b.function,
            ArchitectureFunction::Domestic | ArchitectureFunction::Mixed
        )
    {
        return Err("This programme has no certified functional interior recipe; its retained exterior plan is preserved.".into());
    }
    if input.interiors
        && resolved
            .plan
            .bodies
            .iter()
            .map(|b| b.levels.len() as u64 * u64::from(b.parameters.rooms_per_body[1]))
            .sum::<u64>()
            > u64::from(crate::engine::MAX_ROOMS)
    {
        return Err("Retained interior exceeds the native room budget.".into());
    }
    if !b.transform.origin.x.is_finite()
        || !b.transform.origin.y.is_finite()
        || !b.transform.orientation_deg.is_finite()
        || !b.ground_z_m.is_finite()
    {
        return Err("Invalid retained world transform or elevation.".into());
    }
    if [&b.footprint, &b.roof_footprint]
        .iter()
        .any(|s| !valid_surface(s) || !geo::algorithm::Validation::is_valid(&to_geo(s)))
    {
        return Err("Invalid retained visible footprint or roof envelope.".into());
    }
    let expected = map_surface(&body_domain(&resolved), &b.transform);
    if area(&difference(&expected, &b.footprint)) + area(&difference(&b.footprint, &expected))
        > 0.0001
    {
        return Err(
            "Stored footprint differs from the retained plan; no regeneration performed.".into(),
        );
    }
    let mut batch = if input.interiors {
        crate::enrich_architecture(&resolved)?
    } else {
        HouseBatch {
            schema_version: crate::SCHEMA_VERSION.into(),
            catalogue_version: catalogue()?.catalogue_version.clone(),
            generator_version: crate::GENERATOR_VERSION.into(),
            settings: resolved.config.clone(),
            units: vec![crate::engine::volume_unit(&resolved)?],
            diagnostics: vec![],
        }
    };
    let unit = &mut batch.units[0];
    let roof = unite(
        &unit
            .roofs
            .faces
            .iter()
            .filter_map(|f| {
                let s = vec![Polygon {
                    outer: f
                        .vertices
                        .iter()
                        .map(|i| {
                            let v = &unit.roofs.vertices[*i as usize];
                            Point { x: v.x, y: v.y }
                        })
                        .collect(),
                    holes: vec![],
                }];
                (area(&s) > 1e-8).then_some(s)
            })
            .collect::<Vec<_>>(),
    );
    let roof_world = map_surface(&roof, &b.transform);
    if !contains(&b.roof_footprint, &roof_world) {
        return Err(format!(
            "Native roof exceeds the retained cartographic envelope by {:.6} m2 (native {:?}, retained {:?}). City plan preserved; a new site admission is required.",
            area(&difference(&roof_world, &b.roof_footprint)),
            bounds(&roof_world),
            bounds(&b.roof_footprint)
        ));
    }
    if input.interiors {
        let accessible = unit
            .access
            .portals
            .iter()
            .filter(|p| p.from == unit.access.root || p.to == unit.access.root)
            .any(|p| {
                let mid = transform_point(
                    Point {
                        x: (p.opening[0].x + p.opening[1].x) * 0.5,
                        y: (p.opening[0].y + p.opening[1].y) * 0.5,
                    },
                    &b.transform,
                );
                libm::hypot(mid.x - b.entrance.x, mid.y - b.entrance.y) < 0.001
            });
        if !accessible {
            return Err("Native interior entrance differs from the retained planning connection. City plan preserved; detailed site admission is required.".into());
        }
    }
    unit.transform = b.transform;
    batch.diagnostics.push(format!("Retained urban physical foundation: {:.3} m; local architectural z is relative to that foundation.",b.ground_z_m));
    batch.diagnostics.push("Inspection of retained architecture, without new draws. Body footprints and native roof containment are checked; this is not a replacement for full native site/access certification and supplies no certified city capacity.".into());
    Ok(batch)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn site() -> PlacementRequest {
        serde_json::from_value(serde_json::json!({
            "id":"test-house","parcel_id":"test-parcel", "cadastral":rectangle(0.,0.,80.,60.),"buildable":rectangle(0.,0.,80.,60.),"reserves":[],
            "accesses":[{"id":"front","segment":[{"x":0.,"y":60.},{"x":80.,"y":60.}],"kind":"public","width_m":2.}],
            "party_boundaries":[],"neighbors":[],"culture":{"culture":"european-organic","pack":"EUR-MED","mode":"historical_inspired","borrowing":null},
            "function":"domestic","seed":"plan-test","terrain":{"origin":{"x":0.,"y":0.},"ground_z_m":10.,"gradient":[0.,0.],"water_z_m":null,"max_foundation_step_m":1.},
            "config":{"recipe":"EUR-MED-B02"}
        })).unwrap()
    }
    fn batch(r: PlacementRequest) -> PlanBatch {
        plan_batch(PlanBatchRequest {
            schema_version: "1".into(),
            requests: vec![r],
            settings: None,
            footprints: BTreeMap::new(),
        })
        .unwrap()
    }
    fn hall_site(pack: &str, recipe: &str, width: f64, depth: f64) -> PlacementRequest {
        let mut r = site();
        r.cadastral = rectangle(0., 0., width, depth);
        r.buildable = r.cadastral.clone();
        r.roof_domain = Some(r.cadastral.clone());
        r.accesses[0].segment = [point(0., depth), point(width, depth)];
        r.culture.pack = pack.into();
        r.function = ArchitectureFunction::Collective;
        r.config = Some(HouseConfig {
            pack: pack.into(),
            recipe: Some(recipe.into()),
            era: "M".into(),
            ..Default::default()
        });
        r.programme = Some(crate::programme::ArchitectureProgramme {
            composition: Some(crate::programme::ProgrammeComposition::Hall),
            built_area_m2: Some(600.),
            ..Default::default()
        });
        r
    }
    #[test]
    fn functional_hall_plan_budget_survives_compact_exterior_replay() {
        let mut retained = None;
        for [width, depth] in [[30., 80.], [100., 180.]] {
            let r = hall_site("AM-AND", "AM-AND-B04", width, depth);
            let mut result = batch(r.clone());
            assert_eq!(result.buildings.len(), 1, "{:?}", result.refusals);
            let b = result.buildings.remove(0);
            assert_eq!(b.recipe_id, "AM-AND-B04");
            assert!((area(&b.footprint) - 600.).abs() < 0.1);
            assert!(contains(&r.buildable, &b.footprint));
            assert!(contains(r.roof_domain.as_ref().unwrap(), &b.roof_footprint));
            assert!(contains(&r.cadastral, &b.circulation));
            assert_eq!(b.access_id, "front");
            assert!(b.diagnostics.iter().any(|d| d.contains("target_met=true")));
            assert!(
                !b.diagnostics
                    .iter()
                    .any(|d| d.contains("unsupported functional composition")
                        || d.contains("no declared budget adapter"))
            );
            assert!(
                b.volumes
                    .iter()
                    .all(|v| v.role == Role::NonDomestic && v.roof_mesh.faces.is_empty())
            );
            let resolved = b.resolved.unpack().unwrap();
            assert_eq!(resolved.parameters.components.len(), 1);
            let current = serde_json::to_value(&resolved).unwrap();
            if let Some(previous) = retained {
                assert_eq!(previous, current);
            }
            retained = Some(current);
            let mut expected = crate::engine::volume_unit(&resolved).unwrap();
            expected.transform = b.transform.clone();
            let wire = serde_json::to_vec(&b).unwrap();
            let restored: PlanBuilding = serde_json::from_slice(&wire).unwrap();
            let detailed = realize_plan(RealizePlanRequest {
                building: restored.clone(),
                interiors: false,
            })
            .unwrap();
            assert!(!detailed.units[0].roofs.faces.is_empty());
            assert_eq!(
                serde_json::to_value(&expected).unwrap(),
                serde_json::to_value(&detailed.units[0]).unwrap()
            );
            assert!(
                realize_plan(RealizePlanRequest {
                    building: restored,
                    interiors: true
                })
                .is_err()
            );
        }
    }
    #[test]
    fn functional_hall_plan_keeps_strict_budget_and_refuses_constraints_without_domestic_fallback()
    {
        let mut r = hall_site("AF-WEST", "AF-WEST-B03", 50., 90.);
        r.culture.mode = HistoricalMode::HistoricalStrict;
        let result = batch(r.clone());
        assert_eq!(result.buildings.len(), 1, "{:?}", result.refusals);
        let b = &result.buildings[0];
        assert_eq!(b.recipe_id, "AF-WEST-B03");
        assert!((area(&b.footprint) - 360.).abs() < 1e-6);
        assert!(
            b.diagnostics
                .iter()
                .any(|d| d.contains("target=600.000m2 actual=360.000m2 target_met=false"))
        );
        let mut narrow = hall_site("AF-WEST", "AF-WEST-B03", 5., 90.);
        narrow.culture.mode = HistoricalMode::HistoricalInspired;
        let result = batch(narrow);
        assert!(result.buildings.is_empty());
        assert!(
            result.refusals[0]
                .message
                .contains("Registered functional hall refused")
                && result.refusals[0].message.contains("minimum")
        );
        let mut wrong_roof_rights = r.clone();
        wrong_roof_rights.roof_domain = Some(rectangle(24., 44., 2., 2.));
        let result = batch(wrong_roof_rights);
        assert!(result.buildings.is_empty());
        assert!(
            result.refusals[0]
                .message
                .contains("site admission refused")
                && result.refusals[0].message.contains("roof rights")
        );
        r.config.as_mut().unwrap().overrides.floors = Some(2);
        let result = batch(r);
        assert!(result.buildings.is_empty());
        assert!(
            result.refusals[0]
                .message
                .contains("Registered functional hall refused")
        );
    }
    fn automatic_row_site() -> PlacementRequest {
        let mut r = site();
        r.cadastral = rectangle(0., 0., 80., 120.);
        r.buildable = r.cadastral.clone();
        r.roof_domain = Some(r.cadastral.clone());
        r.accesses[0].segment = [point(0., 120.), point(80., 120.)];
        r.typology = Some(ArchitectureTypology::Row);
        r.config = Some(HouseConfig {
            variation: 0.,
            overrides: Overrides {
                floors: Some(3),
                ..Default::default()
            },
            ..Default::default()
        });
        r
    }
    fn row_wish(r: &mut PlacementRequest) {
        r.programme = Some(crate::programme::ArchitectureProgramme {
            composition: Some(crate::programme::ProgrammeComposition::Row),
            frontage_continuity: Some(1.),
            ..Default::default()
        });
    }
    fn street_gap(building: &PlanBuilding, access: &ArchitectureAccess) -> f64 {
        building
            .footprint
            .iter()
            .flat_map(|p| &p.outer)
            .map(|p| {
                let q = nearest(*p, access.segment[0], access.segment[1]);
                libm::hypot(q.x - p.x, q.y - p.y)
            })
            .fold(f64::INFINITY, f64::min)
    }
    fn assert_source_right_angles(building: &PlanBuilding) {
        let local = map_surface(&building.footprint, &inverse(&building.transform));
        for ring in local.iter().map(|p| &p.outer) {
            for (a, b) in ring
                .iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
            {
                assert!(
                    (a.x - b.x).abs() < 1e-7 || (a.y - b.y).abs() < 1e-7,
                    "source rectangle edges must stay perpendicular, no parcel clipping"
                );
            }
        }
    }
    // Freeze the pre-initial-budget admission path for comparisons of the
    // post-admission adapter. New initial sizing may already meet the target.
    fn initial_without_strip_budget(r: &PlacementRequest) -> Result<PlanBuilding, String> {
        let mut unused = false;
        plan_one_initial_pass(r, &vec![], None, false, None, &mut unused, None, &mut initial_terrain_recovery::Recovery::new(r, None, false))
    }
    #[test]
    fn automatic_row_front_poses_follow_real_accesses_without_clipping_or_lost_rights() {
        let r = automatic_row_site();
        let old = batch(r.clone()).buildings.remove(0);
        assert!(street_gap(&old, &r.accesses[0]) > 15.);
        let mut wanted = r.clone();
        row_wish(&mut wanted);
        let first = batch(wanted.clone()).buildings.remove(0);
        assert!(street_gap(&first, &wanted.accesses[0]) < 2.);
        assert!((area(&first.footprint) - area(&old.footprint)).abs() < 1e-6);
        assert!(
            first.volumes.iter().all(|v| v.levels.len() == 3),
            "explicit floors remain hard"
        );
        assert!(
            first
                .diagnostics
                .iter()
                .any(|d| d.contains("Proximity only"))
        );
        assert!(contains(
            wanted.roof_domain.as_ref().unwrap(),
            &first.roof_footprint
        ));
        assert_source_right_angles(&first);
        assert_eq!(
            serde_json::to_value(&first).unwrap(),
            serde_json::to_value(batch(wanted.clone()).buildings.remove(0)).unwrap()
        );
        assert!(
            !realize_plan(RealizePlanRequest {
                building: first.clone(),
                interiors: false
            })
            .unwrap()
            .units[0]
                .roofs
                .faces
                .is_empty()
        );
        assert!(
            frontage_poses(
                &wanted,
                &first.resolved.unpack().unwrap(),
                &wanted.buildable
            )
            .len()
                <= 8
        );

        wanted.accesses[0].segment.reverse();
        let reversed = batch(wanted.clone()).buildings.remove(0);
        assert!(area(&difference(&first.footprint, &reversed.footprint)) < 1e-6);
        assert!(area(&difference(&reversed.footprint, &first.footprint)) < 1e-6);
        wanted.accesses[0].segment = [point(80., 0.), point(0., 0.)];
        // An admission witness with a different first-edge direction must not
        // replace the actual street as the placement preference.
        let mut hint = rectangle(20., 40., 15., 20.);
        hint[0].outer.rotate_left(1);
        wanted.placement_hint = Some(hint);
        let opposite = batch(wanted.clone()).buildings.remove(0);
        assert!(street_gap(&opposite, &wanted.accesses[0]) < 2.);
        assert_source_right_angles(&opposite);
        let rotation = Transform {
            origin: point(180., 70.),
            orientation_deg: 31.,
        };
        wanted.cadastral = map_surface(&wanted.cadastral, &rotation);
        wanted.buildable = map_surface(&wanted.buildable, &rotation);
        wanted.roof_domain = Some(map_surface(wanted.roof_domain.as_ref().unwrap(), &rotation));
        wanted.placement_hint = wanted
            .placement_hint
            .as_ref()
            .map(|h| map_surface(h, &rotation));
        for p in &mut wanted.accesses[0].segment {
            *p = transform_point(*p, &rotation);
        }
        let rotated = batch(wanted.clone()).buildings.remove(0);
        assert!(street_gap(&rotated, &wanted.accesses[0]) < 2.);
        assert_source_right_angles(&rotated);
        assert!(contains(&wanted.buildable, &rotated.footprint));
        assert!(contains(
            wanted.roof_domain.as_ref().unwrap(),
            &rotated.roof_footprint
        ));

        let mut blocked = r;
        row_wish(&mut blocked);
        blocked.reserves = rectangle(0., 116., 80., 4.);
        let refusal = batch(blocked.clone());
        assert!(
            refusal.buildings.is_empty(),
            "a front strip blocks every actual entrance"
        );
        assert!(
            refusal.refusals[0]
                .message
                .contains("Street-front preference")
        );
        blocked.accesses.push(ArchitectureAccess {
            id: "left-corner".into(),
            segment: [point(0., 120.), point(0., 0.)],
            kind: "public".into(),
            width_m: 2.,
        });
        let corner = batch(blocked.clone()).buildings.remove(0);
        assert_eq!(corner.access_id, "left-corner");
        assert!(street_gap(&corner, &blocked.accesses[1]) < 2.);
        assert!(area(&intersection(&corner.footprint, &blocked.reserves)) < 1e-6);
        assert!(area(&intersection(&corner.circulation, &blocked.reserves)) < 1e-6);
        assert_source_right_angles(&corner);
    }

    #[test]
    fn accepted_adapted_row_retries_front_without_redrawing_its_assembly() {
        // Real 37-bastide parcel-06086b2d057ff205, frozen before this correction.
        // Its initial plan could not fit at the street; the accepted adapted
        // assembly then stayed 27.7m back without being offered a rigid move.
        #[derive(Deserialize)]
        struct Fixture {
            request: PlacementRequest,
            center: PlanBuilding,
        }
        let fixture: Fixture =
            serde_json::from_str(include_str!("../tests/fixtures/frontage-deep-bastide.json"))
                .unwrap();
        let r = fixture.request;
        // Reconstruct the same adapted candidate from the current source. The
        // archived center supplies its pose, not a version-bypassed old plan.
        let integrated = initial_without_strip_budget(&r).unwrap();
        let resolved = integrated.resolved.unpack().unwrap();
        let center = visual(
            &r,
            &resolved,
            fixture.center.transform,
            &vec![],
            true,
            false,
        )
        .unwrap();
        assert!(street_gap(&center, &r.accesses[0]) > 20.);
        let retained = serde_json::to_value(&center.resolved).unwrap();
        let body_area = area(&center.footprint);
        let court_area = area(&center.courtyards);
        let domain = difference(&r.buildable, &r.reserves);
        let front = prefer_accepted_adapted_front(&r, &resolved, &domain, &vec![], center, true, 6);
        assert!(street_gap(&front, &r.accesses[0]) < 1.);
        assert_eq!(retained, serde_json::to_value(&front.resolved).unwrap());
        assert!((area(&front.footprint) - body_area).abs() < 1e-5);
        assert!((area(&front.courtyards) - court_area).abs() < 1e-5);
        assert!(contains(&domain, &front.footprint));
        assert!(contains(&r.cadastral, &front.courtyards));
        assert!(contains(
            r.roof_domain.as_ref().unwrap(),
            &front.roof_footprint
        ));
        assert_source_right_angles(&front);
        assert!(
            !realize_plan(RealizePlanRequest {
                building: front.clone(),
                interiors: false
            })
            .unwrap()
            .units[0]
                .roofs
                .faces
                .is_empty()
        );
        assert!(
            front
                .diagnostics
                .iter()
                .any(|d| d.contains("accepted adapted plan; unchanged assembly"))
        );
        // Exercise the actual fallback branch, not just the rigid helper.
        assert!(area(&difference(&front.footprint, &integrated.footprint)) < 1e-5);
        assert!(area(&difference(&integrated.footprint, &front.footprint)) < 1e-5);
        assert_eq!(
            serde_json::to_value(&integrated).unwrap(),
            serde_json::to_value(initial_without_strip_budget(&r).unwrap()).unwrap()
        );
    }

    #[test]
    fn domestic_budget_improves_frozen_bastide_ranges_without_losing_native_programme() {
        let requests: Vec<PlacementRequest> = serde_json::from_str(include_str!(
            "../tests/fixtures/domestic-budget-bastide.json"
        ))
        .unwrap();
        for (index, r) in requests.iter().enumerate() {
            let old = initial_without_strip_budget(r).unwrap();
            let old_resolved = old.resolved.unpack().unwrap();
            let target = r.programme.as_ref().unwrap().built_area_m2.unwrap();
            // This test isolates the post-admission adapter and its retained
            // court programme. Initial sizing is covered separately: it can
            // now admit the source-native strip before constrained synthesis.
            let new = improve_domestic_budget(r, &vec![], old.clone(), target);
            if index == 2 {
                // The declared native rear-court arcade is now rebuilt with
                // its source cover/support parameters, not scaled as a mesh.
                assert!(area(&new.footprint) < area(&old.footprint));
                assert_eq!(old.recipe_id, new.recipe_id);
                assert_eq!(
                    serde_json::to_value(&old_resolved.parameters.gallery_cover).unwrap(),
                    serde_json::to_value(&new.resolved.unpack().unwrap().parameters.gallery_cover)
                        .unwrap()
                );
                continue;
            }
            let old_error = (area(&old.footprint) / target).ln().abs();
            let new_error = (area(&new.footprint) / target).ln().abs();
            assert!(
                new_error < old_error * 0.8,
                "site{index}: {:?}",
                new.diagnostics
            );
            assert_eq!(old.recipe_id, new.recipe_id);
            assert_eq!(old.variant_id, new.variant_id);
            let resolved = new.resolved.unpack().unwrap();
            let before = crate::morphology::domestic_budget_shape(
                &old_resolved.parameters,
                &old_resolved.plan,
            )
            .unwrap();
            let after =
                crate::morphology::domestic_budget_shape(&resolved.parameters, &resolved.plan)
                    .unwrap();
            assert!((before.court_fraction - after.court_fraction).abs() < 0.0001);
            assert!((before.passage_m - after.passage_m).abs() < 1e-6);
            let mut previous = old_resolved.plan.bodies[0].parameters.clone();
            previous.width_m = resolved.plan.bodies[0].parameters.width_m;
            previous.depth_m = resolved.plan.bodies[0].parameters.depth_m;
            assert_eq!(
                serde_json::to_value(previous).unwrap(),
                serde_json::to_value(&resolved.plan.bodies[0].parameters).unwrap()
            );
            assert_eq!(
                old_resolved.plan.bodies[0].levels.len(),
                resolved.plan.bodies[0].levels.len()
            );
            assert_source_right_angles(&new);
            assert!(contains(&r.buildable, &new.footprint));
            assert!(contains(
                r.roof_domain.as_ref().unwrap(),
                &new.roof_footprint
            ));
            assert!(area(&intersection(&r.reserves, &new.footprint)) < 1e-6);
            assert!(
                new.diagnostics
                    .iter()
                    .any(|d| d.contains("/24 rigid poses"))
            );
            assert!(
                !realize_plan(RealizePlanRequest {
                    building: new.clone(),
                    interiors: false
                })
                .unwrap()
                .units[0]
                    .roofs
                    .faces
                    .is_empty()
            );
            assert_eq!(
                serde_json::to_value(new).unwrap(),
                serde_json::to_value(improve_domestic_budget(r, &vec![], old, target)).unwrap()
            );
        }
    }

    #[test]
    fn complex_budget_preserves_real_bastide_courts_and_native_gallery() {
        let requests: Vec<PlacementRequest> = serde_json::from_str(include_str!(
            "../tests/fixtures/complex-budget-bastide.json"
        ))
        .unwrap();
        for (i, r) in requests.iter().enumerate() {
            let initial = plan_one_initial(r, &vec![], None, false).unwrap();
            let old = initial.resolved.unpack().unwrap();
            let new = plan_one(r, &vec![], None, false).unwrap();
            let resolved = new.resolved.unpack().unwrap();
            let target = r.programme.as_ref().unwrap().built_area_m2.unwrap();
            eprintln!(
                "bastide{} area={:.4} target={target} {:?}",
                [1, 5, 8][i],
                area(&new.footprint),
                new.diagnostics.last()
            );
            assert!(
                area(&new.footprint) > [60., 54.54, 104.4][i],
                "frozen under/over-occupation remains unresolved"
            );
            if i == 0 {
                // The previous perpendicular cap enters this oblique facade
                // by about 0.00917 m². Preserve the 0.002 guard and move the
                // cap onto the actual facade, never cut the house itself.
                assert!(proposed_access(r, &new.footprint, &vec![]).is_err());
                let (_, _, path, _) =
                    proposed_access_with_facade(r, &new.footprint, &vec![], true).unwrap();
                assert!(contains(&r.cadastral, &path));
                assert!(area(&intersection(&path, &new.footprint)) < 1e-6);
            }
            assert_eq!(initial.recipe_id, new.recipe_id);
            assert_eq!(initial.variant_id, new.variant_id);
            assert_eq!(old.config.seed, resolved.config.seed);
            assert_eq!(old.plan.bodies.len(), resolved.plan.bodies.len());
            assert_source_right_angles(&new);
            assert!(contains(&r.buildable, &new.footprint));
            assert!(contains(
                r.roof_domain.as_ref().unwrap(),
                &new.roof_footprint
            ));
            let before =
                crate::morphology::domestic_budget_shape(&old.parameters, &old.plan).unwrap();
            let after =
                crate::morphology::domestic_budget_shape(&resolved.parameters, &resolved.plan)
                    .unwrap();
            assert!((before.court_fraction - after.court_fraction).abs() < 1e-4);
            assert!((before.passage_m - after.passage_m).abs() < 1e-6);
            let native = realize_plan(RealizePlanRequest {
                building: new.clone(),
                interiors: i == 1,
            });
            assert!(native.is_ok(), "native replay: {:?}", native.err());
            if i == 1 {
                assert!((area(&new.footprint) / target - 1.).abs() < 0.1);
                let entry = resolved
                    .entrance
                    .as_ref()
                    .expect("native gallery entrance retained");
                let middle = transform_point(
                    Point {
                        x: (entry.opening[0].x + entry.opening[1].x) * 0.5,
                        y: (entry.opening[0].y + entry.opening[1].y) * 0.5,
                    },
                    &new.transform,
                );
                assert!(libm::hypot(middle.x - new.entrance.x, middle.y - new.entrance.y) < 1e-6);
                let unit = native.unwrap().units.remove(0);
                assert!(
                    unit.features
                        .iter()
                        .any(|f| f.kind == crate::model::FeatureKind::Gallery && f.roof.is_some())
                );
                assert!(area(&difference(&new.courtyards, &new.roof_footprint)) > 3.0);
                assert!(
                    realize_plan(RealizePlanRequest {
                        building: new.clone(),
                        interiors: false
                    })
                    .is_ok()
                );
            }
            let mut pinned = r.clone();
            pinned.config.as_mut().unwrap().recipe = Some(new.recipe_id.clone());
            assert_eq!(
                plan_one_initial(&pinned, &vec![], None, false)
                    .map(|p| serde_json::to_value(p).unwrap()),
                plan_one(&pinned, &vec![], None, false).map(|p| serde_json::to_value(p).unwrap())
            );
            let mut strict = r.clone();
            strict.culture.mode = HistoricalMode::HistoricalStrict;
            for (request, exact) in [(&strict, false), (r, true)] {
                let initial = plan_one_initial(request, &vec![], None, exact)
                    .map(|p| serde_json::to_value(p).unwrap());
                let final_plan = plan_one(request, &vec![], None, exact)
                    .map(|p| serde_json::to_value(p).unwrap());
                assert_eq!(initial, final_plan);
            }
            assert_eq!(
                serde_json::to_value(&new).unwrap(),
                serde_json::to_value(plan_one(r, &vec![], None, false).unwrap()).unwrap()
            );
        }
    }

    #[test]
    fn initial_strip_budget_preserves_legacy_admissions_and_recovers_targeted_sites() {
        let fixture: PlanBatchRequest = serde_json::from_str(include_str!(
            "../tests/fixtures/strip_initial_recovery.json"
        ))
        .unwrap();
        assert_eq!(fixture.requests.len(), 4);
        for (i, r) in fixture.requests.iter().enumerate() {
            let initial_area = automatic_initial_programme_area(r, false, None);
            assert!(initial_area.is_some());
            let mut attempted = false;
            let guided =
                plan_one_initial_pass(r, &vec![], None, false, initial_area, &mut attempted, None, &mut initial_terrain_recovery::Recovery::new(r, None, false));
            assert!(attempted);
            let mut unused = false;
            let legacy = plan_one_initial_pass(r, &vec![], None, false, None, &mut unused, None, &mut initial_terrain_recovery::Recovery::new(r, None, false));
            assert!(
                !unused,
                "the legacy pass cannot recurse into budget recovery"
            );
            if i == 1 || i == 3 {
                // These were lost before the legacy-dimension recovery was
                // added. A corrected native bearing domain may also admit
                // their guided candidate; keeping them admitted is the contract.
                assert!(legacy.is_ok());
            } else {
                assert!(guided.is_ok());
            }
            let building = plan_one(r, &vec![], None, false).unwrap();
            assert_eq!(building.recipe_id, "EUR-MED-B02");
            assert!(contains(&r.buildable, &building.footprint));
            assert!(contains(
                r.roof_domain.as_ref().unwrap_or(&r.cadastral),
                &building.roof_footprint
            ));
            assert_source_right_angles(&building);
            let resolved = building.resolved.unpack().unwrap();
            assert_eq!(resolved.config.seed, r.seed);
            let bearing = if building
                .diagnostics
                .iter()
                .any(|d| d.starts_with("Native ground-strip foundation:"))
            {
                let mut parts = vec![building.footprint.clone()];
                parts.extend(
                    building
                        .structural_features
                        .iter()
                        .map(|f| f.surface.clone()),
                );
                unite(&parts)
            } else {
                map_surface(&plan_domain(&resolved), &building.transform)
            };
            let (lo, hi, slope) = r.terrain.foundation_bounds(&bearing).unwrap();
            assert!(hi - lo <= r.terrain.max_foundation_step_m + 1e-8);
            assert!(slope <= crate::placement::MAX_LEVEL_FOUNDATION_SLOPE_DEG);
            eprintln!(
                "strip witness {i}: guided={} legacy={} final={:.6} target={:.6}",
                guided.is_ok(),
                legacy.is_ok(),
                area(&building.footprint),
                initial_area.unwrap()
            );
            if guided.is_err() {
                assert!(
                    legacy.is_ok(),
                    "a failed guided pass must retain the legacy success"
                );
                assert!(
                    building
                        .diagnostics
                        .iter()
                        .any(|d| d.starts_with("Initial strip programme recovery:"))
                );
            } else {
                assert!(
                    !building
                        .diagnostics
                        .iter()
                        .any(|d| d.starts_with("Initial strip programme recovery:"))
                );
            }
            if i == 0 || i == 2 {
                assert!((area(&building.footprint) / initial_area.unwrap() - 1.).abs() < 0.001);
            }
            assert_eq!(
                serde_json::to_value(&building).unwrap(),
                serde_json::to_value(plan_one(r, &vec![], None, false).unwrap()).unwrap()
            );
        }
    }

    #[test]
    fn roman_small_lots_keep_simple_sources_without_fabricating_capacity() {
        let requests: Vec<PlacementRequest> =
            serde_json::from_str(include_str!("../tests/fixtures/roman_simple_recovery.json"))
                .unwrap();
        assert_eq!(requests.len(), 2);
        for (index, r) in requests.iter().enumerate() {
            let mut attempted = false;
            let preferred = plan_one_initial_pass(
                r,
                &vec![],
                None,
                false,
                automatic_initial_programme_area(r, false, None),
                &mut attempted,
                None,
                &mut initial_terrain_recovery::Recovery::new(r, None, false),
            );
            assert!(
                !attempted,
                "these Roman sources do not use the strip scalar solver"
            );
            let building = plan_one(r, &vec![], None, false).unwrap();
            assert!(matches!(
                building.recipe_id.as_str(),
                "MED-ANT-B01" | "MED-ANT-B12"
            ));
            assert_eq!(
                building
                    .diagnostics
                    .iter()
                    .any(|d| d.starts_with("Missing simple family recovery:")),
                preferred.is_err(),
                "the additional family is used only after the preferred sequence fails"
            );
            assert_eq!(
                building.domestic_units, 0,
                "admission is not certified household capacity"
            );
            assert!(contains(&r.buildable, &building.footprint));
            assert!(contains(
                r.roof_domain.as_ref().unwrap_or(&r.cadastral),
                &building.roof_footprint
            ));
            assert_source_right_angles(&building);
            let resolved = building.resolved.unpack().unwrap();
            assert_eq!(resolved.config.seed, r.seed);
            let (lo, hi, slope) = r
                .terrain
                .foundation_bounds(&map_surface(&plan_domain(&resolved), &building.transform))
                .unwrap();
            assert!(hi - lo <= r.terrain.max_foundation_step_m + 1e-8);
            assert!(slope <= crate::placement::MAX_LEVEL_FOUNDATION_SLOPE_DEG);
            if index == 0 {
                eprintln!("Roman simple target: recipe={} area={:.6} target=99.3", building.recipe_id, area(&building.footprint));
                assert!((area(&building.footprint) / 99.3 - 1.).abs() <= 0.1,
                    "the formerly met target must remain inside the declared ten-percent budget tolerance");
            } else {
                assert!(area(&building.footprint) >= 31.5 - 1e-5);
                assert!(
                    area(&building.footprint)
                        > r.programme.as_ref().unwrap().built_area_m2.unwrap() * 1.1
                );
                assert!(
                    building
                        .diagnostics
                        .iter()
                        .any(|d| d.contains("target_met=false"))
                );
                assert_eq!(building.volumes[0].levels.len(), 2);
            }
            let mut pinned = r.clone();
            pinned
                .config
                .get_or_insert_with(HouseConfig::default)
                .recipe = Some("MED-ANT-B02".into());
            assert!(
                plan_one_initial(&pinned, &vec![], None, false).is_err(),
                "an incompatible pin must not trigger an extra simple source"
            );
        }
    }

    #[test]
    fn native_ground_programme_budget_precedes_real_java_admission_with_source_bounds() {
        let mut r: PlacementRequest = serde_json::from_str(include_str!(
            "../tests/fixtures/native-platform-budget-java.json"
        ))
        .unwrap();
        r.parcel_fit = Some(true);
        let mut selected = r.config.clone().unwrap();
        selected.recipe = Some("AS-ISL-B14".into());
        selected.overrides.variant = Some("default".into());
        let dimensions = initial_ground_programme_dimensions(&r, &selected, false, None).unwrap();
        assert!((dimensions[0] * dimensions[1] - 67.4).abs() < 1e-8);
        assert!((4.5..=7.5).contains(&dimensions[0]) && (6.0..=11.0).contains(&dimensions[1]));
        let mut tiny = r.clone();
        tiny.programme.as_mut().unwrap().built_area_m2 = Some(1.);
        assert_eq!(
            initial_ground_programme_dimensions(&tiny, &selected, false, None),
            Some([4.5, 6.])
        );
        let mut large = r.clone();
        large.programme.as_mut().unwrap().built_area_m2 = Some(500.);
        assert_eq!(
            initial_ground_programme_dimensions(&large, &selected, false, None),
            Some([7.5, 11.])
        );

        // Real original request: the culturally filtered single native house
        // receives the programme before any placement or post-admission pass.
        let initial = plan_one_initial(&r, &vec![], None, false).unwrap();
        assert!(["AS-ISL-B14", "AS-ISL-B15"].contains(&initial.recipe_id.as_str()));
        assert!((area(&initial.footprint) - 67.4).abs() < 0.02);
        assert!(
            initial
                .diagnostics
                .iter()
                .any(|d| d.contains("Initial native footprint budget:"))
        );
        assert_source_right_angles(&initial);
        let resolved = initial.resolved.unpack().unwrap();
        let (lo, hi, slope) = r
            .terrain
            .foundation_bounds(&map_surface(&plan_domain(&resolved), &initial.transform))
            .unwrap();
        assert!(hi - lo <= 0.75 && slope <= crate::placement::MAX_LEVEL_FOUNDATION_SLOPE_DEG);
        assert_eq!(resolved.config.seed, r.seed);
        assert_eq!(resolved.plan.bodies.len(), 1);
        assert_eq!(resolved.parameters.support.kind, SupportKind::Ground);
        assert!(
            !realize_plan(RealizePlanRequest {
                building: initial,
                interiors: false
            })
            .unwrap()
            .units[0]
                .roofs
                .faces
                .is_empty()
        );

        for exclusion in [
            "recipe",
            "variant",
            "strict",
            "exact",
            "footprint",
            "no-fit",
            "collective",
        ] {
            let mut excluded = r.clone();
            match exclusion {
                "recipe" => excluded.config.as_mut().unwrap().recipe = selected.recipe.clone(),
                "variant" => {
                    excluded.config.as_mut().unwrap().overrides.variant = Some("default".into())
                }
                "strict" => excluded.culture.mode = HistoricalMode::HistoricalStrict,
                "no-fit" => excluded.parcel_fit = Some(false),
                "collective" => excluded.function = ArchitectureFunction::Collective,
                _ => {}
            }
            assert!(
                initial_ground_programme_dimensions(
                    &excluded,
                    &selected,
                    exclusion == "exact",
                    (exclusion == "footprint").then_some(&r.buildable)
                )
                .is_none(),
                "{exclusion}"
            );
        }
        // A gallery/jetty and a compound stay in their existing operators.
        for recipe in ["EUR-MED-B09", "AS-ISL-B05"] {
            selected.recipe = Some(recipe.into());
            assert!(
                initial_ground_programme_dimensions(&r, &selected, false, None).is_none(),
                "{recipe}"
            );
        }
    }

    #[test]
    fn native_platform_budget_retries_the_real_java_site_without_relaxing_terrain_or_pins() {
        let mut r: PlacementRequest = serde_json::from_str(include_str!(
            "../tests/fixtures/native-platform-budget-java.json"
        ))
        .unwrap();
        r.parcel_fit = Some(true);
        // B03 is the source retained by the frozen pre-change witness. Keep
        // the request automatic; do not make this regression depend on future
        // additions to the AS-ISL palette or pin the user's request itself.
        let domain = difference(&r.buildable, &r.reserves);
        let frame = frame(&r, &domain);
        let size = bounds(&map_surface(&domain, &inverse(&frame)));
        let mut config = r.config.clone().unwrap();
        config.recipe = Some("AS-ISL-B03".into());
        config.overrides.variant = Some("default".into());
        config.overrides.floors = Some(1);
        config.seed = r.seed.clone();
        config.orientation_deg = 0.;
        let occupation = r.occupation.as_ref().unwrap();
        let native_area = area(&domain) * occupation.coverage;
        let aspect = occupation.frontage_m / occupation.depth_m;
        let old = resolve_urban_architecture(
            config,
            r.function,
            [size[2] - size[0] - 0.8, size[3] - size[1] - 0.8],
            false,
            Some([
                libm::sqrt(native_area * aspect),
                libm::sqrt(native_area / aspect),
            ]),
            Some(occupation.coverage),
            true,
        )
        .unwrap();
        let mut terrain_refusal = None;
        assert!(
            try_frontage_reporting(
                &r,
                &old,
                &domain,
                &vec![],
                &mut 0,
                false,
                &mut terrain_refusal
            )
            .is_none()
        );
        let error = terrain_refusal.unwrap();
        assert!(error.contains("allowed 0.750 m"), "{error}");
        let retry = retry_native_platform_budget(&r, &old, 67.4, &domain, &vec![]).unwrap();
        assert_eq!(retry.recipe_id, "AS-ISL-B03");
        assert_eq!(retry.variant_id, "default");
        assert!((area(&retry.footprint) - 93.456).abs() < 0.001);
        assert_eq!(retry.domestic_units, 0);
        assert!(
            retry
                .diagnostics
                .iter()
                .any(|d| d.contains("Native platform budget retry:")
                    && d.contains("/11 rigid poses"))
        );
        assert_source_right_angles(&retry);
        assert!(contains(&r.buildable, &retry.footprint));
        assert!(contains(
            r.roof_domain.as_ref().unwrap(),
            &retry.roof_footprint
        ));
        let resolved = retry.resolved.unpack().unwrap();
        let (low, high, slope) = r
            .terrain
            .foundation_bounds(&map_surface(&plan_domain(&resolved), &retry.transform))
            .unwrap();
        assert!(
            high - low > 0.74 && high - low <= 0.75 && slope < 12.,
            "step={} slope={slope}",
            high - low
        );

        assert_eq!(old.recipe_id, retry.recipe_id);
        assert_eq!(old.parameters.variant_id, retry.variant_id);
        assert!(area(&body_domain(&old)) > 180.);
        let mut same_draws = resolved.parameters.clone();
        same_draws.width_m = old.parameters.width_m;
        same_draws.depth_m = old.parameters.depth_m;
        assert_eq!(
            serde_json::to_value(same_draws).unwrap(),
            serde_json::to_value(&old.parameters).unwrap()
        );
        assert_eq!(resolved.plan.bodies.len(), old.plan.bodies.len());
        assert_eq!(resolved.plan.bodies[0].z, old.plan.bodies[0].z);
        assert_eq!(
            resolved.plan.bodies[0].levels.len(),
            old.plan.bodies[0].levels.len()
        );
        assert_eq!(resolved.config.seed, old.config.seed);
        assert!(
            !realize_plan(RealizePlanRequest {
                building: retry.clone(),
                interiors: false
            })
            .unwrap()
            .units[0]
                .roofs
                .faces
                .is_empty()
        );
        assert_eq!(
            serde_json::to_value(&retry).unwrap(),
            serde_json::to_value(
                retry_native_platform_budget(&r, &old, 67.4, &domain, &vec![]).unwrap()
            )
            .unwrap()
        );

        let mut compound = r.clone();
        compound.programme.as_mut().unwrap().composition =
            Some(crate::programme::ProgrammeComposition::Compound);
        compound.programme.as_mut().unwrap().frontage_continuity = Some(0.6);
        let compound_retry =
            retry_native_platform_budget(&compound, &old, 67.4, &domain, &vec![]).unwrap();
        assert_eq!(compound_retry.footprint, retry.footprint);
        assert!(
            compound_retry
                .diagnostics
                .iter()
                .any(|d| d.contains("Native platform budget retry:"))
        );

        // The opt-in boundary is separate from whether a pinned native pose
        // happens to fit: these paths must never enable this fallback.
        assert!(native_platform_budget_target(&r, &old, false, None).is_some());
        for exclusion in [
            "recipe",
            "variant",
            "strict",
            "exact",
            "footprint",
            "no-fit",
            "collective",
            "invalid-target",
        ] {
            let mut excluded = r.clone();
            match exclusion {
                "recipe" => excluded.config.as_mut().unwrap().recipe = Some("AS-ISL-B03".into()),
                "variant" => {
                    excluded.config.as_mut().unwrap().overrides.variant = Some("default".into())
                }
                "strict" => excluded.culture.mode = HistoricalMode::HistoricalStrict,
                "no-fit" => excluded.parcel_fit = Some(false),
                "collective" => excluded.function = ArchitectureFunction::Collective,
                "invalid-target" => {
                    excluded.programme.as_mut().unwrap().built_area_m2 = Some(f64::NAN)
                }
                _ => {}
            }
            assert!(
                native_platform_budget_target(
                    &excluded,
                    &old,
                    exclusion == "exact",
                    (exclusion == "footprint").then_some(&excluded.buildable)
                )
                .is_none(),
                "{exclusion}"
            );
        }
    }

    #[test]
    fn domestic_budget_reduces_overshoot_but_preserves_explicit_strict_and_exact_plans() {
        let mut r: PlacementRequest = serde_json::from_str::<Vec<PlacementRequest>>(include_str!(
            "../tests/fixtures/domestic-budget-bastide.json"
        ))
        .unwrap()
        .remove(1);
        r.parcel_fit = Some(true);
        r.programme.as_mut().unwrap().built_area_m2 = Some(30.);
        let initial = initial_without_strip_budget(&r).unwrap();
        assert!(area(&initial.footprint) > 50.);
        let reduced = plan_one(&r, &vec![], None, false).unwrap();
        assert!(
            (area(&reduced.footprint) / 30. - 1.).abs() < 0.1,
            "{:?}",
            reduced.diagnostics
        );
        assert_eq!(initial.recipe_id, reduced.recipe_id);
        assert_eq!(initial.variant_id, reduced.variant_id);
        assert_eq!(
            reduced.volumes[0].levels.len(),
            initial.volumes[0].levels.len()
        );
        assert_source_right_angles(&reduced);
        assert!(
            !realize_plan(RealizePlanRequest {
                building: reduced,
                interiors: false
            })
            .unwrap()
            .units[0]
                .roofs
                .faces
                .is_empty()
        );
        // Give strict/exact native assembly enough room; the regression here
        // is the budget gate, independently of cramped-site source refusal.
        r.cadastral = rectangle(0., 0., 80., 120.);
        r.buildable = r.cadastral.clone();
        r.roof_domain = Some(r.cadastral.clone());
        r.placement_hint = None;
        r.occupation = None;
        r.terrain = automatic_row_site().terrain;
        r.accesses.truncate(1);
        r.accesses[0].segment = [point(0., 120.), point(80., 120.)];
        r.config
            .get_or_insert_with(HouseConfig::default)
            .overrides
            .floors = Some(2);
        for mode in ["recipe", "variant", "strict", "exact", "fit-disabled"] {
            let mut pinned = r.clone();
            match mode {
                "recipe" => {
                    pinned.config.as_mut().unwrap().recipe = Some(initial.recipe_id.clone())
                }
                "variant" => {
                    pinned.config.as_mut().unwrap().recipe = Some(initial.recipe_id.clone());
                    pinned.config.as_mut().unwrap().overrides.variant =
                        Some(initial.variant_id.clone())
                }
                "strict" => pinned.culture.mode = HistoricalMode::HistoricalStrict,
                "fit-disabled" => pinned.parcel_fit = Some(false),
                _ => {}
            }
            let exact = mode == "exact";
            let native = plan_one_initial(&pinned, &vec![], None, exact).unwrap();
            let with_budget = plan_one(&pinned, &vec![], None, exact).unwrap();
            assert_eq!(
                serde_json::to_value(native).unwrap(),
                serde_json::to_value(with_budget).unwrap(),
                "{mode}"
            );
        }
    }

    #[test]
    fn frontage_requires_actual_contact_when_two_segments_share_the_same_id() {
        let mut r = automatic_row_site();
        let mut opposite = r.accesses[0].clone();
        opposite.segment = [point(0., 0.), point(80., 0.)];
        r.accesses.push(opposite);
        let building = batch(r.clone()).buildings.remove(0);
        let resolved = building.resolved.unpack().unwrap();
        let (_, id, _, contact) = proposed_access(&r, &building.footprint, &vec![]).unwrap();
        assert!(r.accesses.iter().all(|a| a.id == id));
        let right = r
            .accesses
            .iter()
            .find(|a| contact_on_front(&id, contact, a))
            .unwrap();
        let wrong = r
            .accesses
            .iter()
            .find(|a| !contact_on_front(&id, contact, a))
            .unwrap();
        assert!(
            visual_with_front(
                &r,
                &resolved,
                building.transform.clone(),
                &vec![],
                true,
                false,
                Some(wrong)
            )
            .err()
            .unwrap()
            .contains("different declared frontage segment")
        );
        let mut reversed = right.clone();
        reversed.segment.reverse();
        assert!(
            visual_with_front(
                &r,
                &resolved,
                building.transform,
                &vec![],
                true,
                false,
                Some(&reversed)
            )
            .is_ok()
        );
    }

    #[test]
    fn frontage_preferences_do_not_replace_explicit_models_or_legacy_placement() {
        let physical = |b: PlanBuilding| {
            let mut value = serde_json::to_value(b).unwrap();
            value.as_object_mut().unwrap().remove("diagnostics");
            value
        };
        let mut r = automatic_row_site();
        let legacy = batch(r.clone()).buildings.remove(0);
        r.programme = Some(crate::programme::ArchitectureProgramme {
            role: Some("dwelling".into()),
            ..Default::default()
        });
        assert_eq!(
            serde_json::to_value(&legacy).unwrap(),
            serde_json::to_value(batch(r.clone()).buildings.remove(0)).unwrap()
        );
        r.programme.as_mut().unwrap().frontage_continuity = Some(0.5);
        assert_eq!(
            physical(legacy),
            physical(batch(r.clone()).buildings.remove(0))
        );
        // Strong continuity alone is actionable even without a row label.
        r.programme.as_mut().unwrap().frontage_continuity = Some(0.9);
        assert!(street_gap(&batch(r.clone()).buildings.remove(0), &r.accesses[0]) < 2.);
        for variant_pin in [false, true] {
            r.programme = None;
            r.config.as_mut().unwrap().recipe = Some("EUR-MED-B02".into());
            r.config.as_mut().unwrap().overrides.variant = variant_pin.then(|| "default".into());
            let mut outcome = batch(r.clone());
            assert_eq!(
                outcome.buildings.len(),
                1,
                "variant_pin={variant_pin}: {:?}",
                outcome.refusals
            );
            let pinned = outcome.buildings.remove(0);
            row_wish(&mut r);
            assert_eq!(
                physical(pinned),
                physical(batch(r.clone()).buildings.remove(0))
            );
        }
        r.config.as_mut().unwrap().recipe = None;
        let invalid = batch(r.clone());
        assert!(
            invalid.buildings.is_empty(),
            "a variant alone still requires its explicit recipe"
        );
        assert!(invalid.refusals[0].message.contains("variante explicite"));
        let settings = Some(PlacementBatchSettings {
            house_config: Some(HouseConfig {
                recipe: Some("EUR-MED-B02".into()),
                variation: 0.,
                ..Default::default()
            }),
            ..Default::default()
        });
        let exact = |r| {
            plan_batch(PlanBatchRequest {
                schema_version: "1".into(),
                requests: vec![r],
                settings: settings.clone(),
                footprints: BTreeMap::new(),
            })
            .unwrap()
            .buildings
            .remove(0)
        };
        r.programme = None;
        let pinned = exact(r.clone());
        row_wish(&mut r);
        assert_eq!(physical(pinned), physical(exact(r)));
    }
    #[test]
    fn real_tapered_burgage_lots_keep_constraints_and_replay() {
        // Retained city-01-s requests: one large occupation target on a tapered
        // lot, and one lot whose usable frontage is found by its witness.
        let input: PlanBatchRequest = serde_json::from_str(include_str!(
            "../tests/fixtures/city_burgage_constraints.json"
        ))
        .unwrap();
        let expected = input.requests.clone();
        let first = plan_batch(input.clone()).unwrap();
        let second = plan_batch(input).unwrap();
        assert_eq!(first.buildings.len(), 2, "{:?}", first.refusals);
        assert_eq!(
            serde_json::to_value(&first).unwrap(),
            serde_json::to_value(&second).unwrap()
        );
        for building in &first.buildings {
            let request = expected.iter().find(|r| r.id == building.id).unwrap();
            assert!(contains(&request.buildable, &building.footprint));
            assert!(contains(
                request.roof_domain.as_ref().unwrap(),
                &building.roof_footprint
            ));
            assert!(contains(&request.cadastral, &building.circulation));
            assert_eq!(building.recipe_id, "EUR-MED-B02");
            assert!(building.volumes.iter().all(|v| v.levels.len() == 3));
            let restored = serde_json::from_slice(&serde_json::to_vec(building).unwrap()).unwrap();
            let detailed = realize_plan(RealizePlanRequest {
                building: restored,
                interiors: false,
            })
            .unwrap();
            assert!(!detailed.units[0].roofs.faces.is_empty());
        }
    }
    #[test]
    fn compact_city_path_defers_meshes_and_replays_the_same_plan() {
        let a = batch(site());
        let b = batch(site());
        assert_eq!(
            serde_json::to_value(&a).unwrap(),
            serde_json::to_value(&b).unwrap()
        );
        assert_eq!(a.buildings.len(), 1, "{:?}", a.refusals);
        let b = &a.buildings[0];
        assert_eq!(b.domestic_units, 0);
        assert!(
            b.volumes
                .iter()
                .all(|v| v.roof_mesh.faces.is_empty() && v.roof_mesh.vertices.is_empty())
        );
        let realized = realize_plan(RealizePlanRequest {
            building: b.clone(),
            interiors: false,
        })
        .unwrap();
        assert!(!realized.units[0].roofs.faces.is_empty());
        let all = unite(
            &realized.units[0]
                .bodies
                .iter()
                .flat_map(|b| b.levels.iter().map(|l| l.footprint.clone()))
                .collect::<Vec<_>>(),
        );
        assert!(contains(&b.footprint, &map_surface(&all, &b.transform)));
        assert!(contains(&map_surface(&all, &b.transform), &b.footprint));
    }
    #[test]
    fn european_tower_intermediate_eaves_survive_compact_exterior_replay() {
        // Exact failing native smoke input: a three-level flat-roofed tower
        // retains intermediate eaves, not only the top slab's body footprint.
        let mut r = site();
        r.id = "compact-smoke-1".into();
        r.parcel_id = "compact-smoke-parcel-1".into();
        r.seed = "compact-smoke:EUR-MED-B07".into();
        r.cadastral = rectangle(180., 160., 48., 55.);
        r.buildable = r.cadastral.clone();
        r.roof_domain = Some(r.cadastral.clone());
        r.accesses[0].segment = [point(180., 215.), point(228., 215.)];
        r.terrain.origin = point(180., 160.);
        r.parcel_fit = Some(true);
        r.config = Some(HouseConfig {
            recipe: Some("EUR-MED-B07".into()),
            variation: 0.,
            overrides: Overrides {
                variant: Some("default".into()),
                ..Default::default()
            },
            ..Default::default()
        });
        let mut planned = batch(r.clone());
        assert_eq!(planned.buildings.len(), 1, "{:?}", planned.refusals);
        let building = planned.buildings.remove(0);
        assert!(contains(
            r.roof_domain.as_ref().unwrap(),
            &building.roof_footprint
        ));
        assert!(
            building
                .volumes
                .iter()
                .any(|v| v.roof_system == "RF-FLAT" && v.levels.len() > 1)
        );
        let bytes = serde_json::to_vec(&building).unwrap();
        let restored: PlanBuilding = serde_json::from_slice(&bytes).unwrap();
        let realized = realize_plan(RealizePlanRequest {
            building: restored,
            interiors: false,
        })
        .unwrap();
        assert_eq!(realized.units[0].bodies.len(), 2);
        assert!(!realized.units[0].roofs.faces.is_empty());
        let footprint = unite(
            &realized.units[0]
                .bodies
                .iter()
                .flat_map(|body| body.levels.iter().map(|level| level.footprint.clone()))
                .collect::<Vec<_>>(),
        );
        let world = map_surface(&footprint, &building.transform);
        assert!(contains(&building.footprint, &world));
        assert!(contains(&world, &building.footprint));
    }

    #[test]
    fn holes_reserves_and_earlier_buildings_remain_empty() {
        let mut r = site();
        r.reserves = rectangle(30., 15., 20., 30.);
        let mut second = r.clone();
        second.id = "second".into();
        second.parcel_id = "second-parcel".into();
        second.seed = "second".into();
        let result = plan_batch(PlanBatchRequest {
            schema_version: "1".into(),
            requests: vec![r.clone(), second],
            settings: None,
            footprints: BTreeMap::new(),
        })
        .unwrap();
        for b in &result.buildings {
            assert!(area(&intersection(&b.footprint, &r.reserves)) < 0.0001);
        }
        if result.buildings.len() == 2 {
            assert!(
                area(&intersection(
                    &result.buildings[0].footprint,
                    &result.buildings[1].footprint
                )) < 0.0001
            );
        }
        assert!(!result.buildings.is_empty(), "{:?}", result.refusals);
    }
    #[test]
    fn invalid_terrain_and_impossible_domain_are_refused() {
        let mut r = site();
        r.buildable = rectangle(0., 0., 0.5, 0.5);
        assert!(batch(r).buildings.is_empty());
        let mut r = site();
        r.terrain.grid = Some(GroundGrid {
            origin: point(0., 0.),
            step_m: 1.,
            width: 0,
            height: 0,
            elevations_m: vec![],
        });
        assert!(batch(r).buildings.is_empty());
    }
    #[test]
    fn tampered_compact_footprint_is_not_rerolled() {
        let mut b = batch(site()).buildings.remove(0);
        b.footprint = rectangle(0., 0., 1., 1.);
        assert!(
            realize_plan(RealizePlanRequest {
                building: b,
                interiors: false
            })
            .is_err()
        );
    }
    #[test]
    fn input_order_does_not_change_disjoint_building_identity() {
        let a = site();
        let mut b = site();
        b.id = "far".into();
        b.parcel_id = "far".into();
        b.cadastral = translate(&b.cadastral, 256., 0.);
        b.buildable = b.cadastral.clone();
        for access in &mut b.accesses {
            for p in &mut access.segment {
                p.x += 256.;
            }
        }
        let run = |requests| {
            plan_batch(PlanBatchRequest {
                schema_version: "1".into(),
                requests,
                settings: None,
                footprints: BTreeMap::new(),
            })
            .unwrap()
        };
        let first = run(vec![a.clone(), b.clone()]);
        let second = run(vec![b, a]);
        assert_eq!(first.buildings.len(), 2);
        for b in first.buildings {
            assert_eq!(
                serde_json::to_value(&b).unwrap(),
                serde_json::to_value(second.buildings.iter().find(|x| x.id == b.id).unwrap())
                    .unwrap()
            );
        }
    }
}

#[cfg(test)]
#[path = "b11_native_entry_tests.rs"]
mod b11_native_entry_tests;

#[cfg(test)]
#[path = "adapted_single_budget_tests.rs"]
mod adapted_single_budget_tests;

#[cfg(test)]
#[path = "nominal_first_budget_tests.rs"]
mod nominal_first_budget_tests;

#[cfg(test)]
#[path = "b06_light_entry_tests/positive.rs"]
mod b06_light_entry_tests;

#[cfg(test)]
#[path = "b06_light_entry_tests/finalize_policy.rs"]
mod b06_light_finalize_policy_tests;
