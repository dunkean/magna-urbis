//! Direct placement of an explicitly selected, cached native minimum witness.
//! No source draw, dimension search or roof construction is performed per pose.
//! This is opt-in: it cannot resize a programme or supersede an explicit model.
use crate::admission_witness::{
    AdmissionWitness, AdmissionWitnessIdentity, cached_admission_witness, witness_identity,
};
use crate::geometry::{area, difference, intersection, union, unite};
use crate::model::*;
use crate::placement::*;
use crate::plans::{CartographicRoof, PlanBuilding};
use crate::style_index::{StyleQuery, style_index};
use serde::{Deserialize, Serialize};

pub const MAX_NATIVE_MINIMUM_CANDIDATES: usize = 4;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct NativeMinimumCandidate {
    pub identity: AdmissionWitnessIdentity,
    pub transform: Transform,
    pub access_id: String,
    /// World point on the declared access, with enough width on both sides.
    pub contact: Point,
}

fn world(p: Point, t: &Transform) -> Point {
    let angle = t.orientation_deg.to_radians();
    let (s, c) = (libm::sin(angle), libm::cos(angle));
    Point {
        x: t.origin.x + p.x * c - p.y * s,
        y: t.origin.y + p.x * s + p.y * c,
    }
}
fn map(s: &Surface, t: &Transform) -> Surface {
    s.iter()
        .map(|p| Polygon {
            outer: p.outer.iter().map(|p| world(*p, t)).collect(),
            holes: p
                .holes
                .iter()
                .map(|ring| ring.iter().map(|p| world(*p, t)).collect())
                .collect(),
        })
        .collect()
}
fn inverse(t: &Transform) -> Transform {
    let mut result = Transform {
        origin: Point { x: 0., y: 0. },
        orientation_deg: -t.orientation_deg,
    };
    let p = world(t.origin, &result);
    result.origin = Point { x: -p.x, y: -p.y };
    result
}
fn contains(domain: &Surface, s: &Surface) -> bool {
    area(&difference(s, domain)) <= (area(s) * 1e-8).max(0.0001)
}
fn midpoint(opening: [Point; 2]) -> Point {
    Point {
        x: (opening[0].x + opening[1].x) * 0.5,
        y: (opening[0].y + opening[1].y) * 0.5,
    }
}

/// None means the ordinary source-preserving path remains responsible.
/// A present eligible contract either succeeds in <=4 exact checks or reports
/// its failure. It never silently falls through to the old stochastic search.
pub(crate) fn try_plan(
    r: &PlacementRequest,
    occupied: &Surface,
    target: Option<&Surface>,
    exact: bool,
) -> Option<Result<PlanBuilding, String>> {
    if r.native_minimum_candidates.is_empty()
        || exact
        || target.is_some()
        || r.parcel_fit == Some(false)
        || r.culture.mode != HistoricalMode::HistoricalInspired
        || !matches!(
            r.function,
            ArchitectureFunction::Domestic | ArchitectureFunction::Mixed
        )
        || r.config.as_ref().is_some_and(|c| {
            c.recipe.is_some()
                || c.workshop.is_some()
                || c.overrides != Overrides::default()
                || c.size != 1.
                || c.variation != HouseConfig::default().variation
                || c.wealth != 0.5
                || c.orientation_deg != 0.
        })
    {
        return None;
    }
    if r.config
        .as_ref()
        .is_some_and(|c| c.mode != r.culture.mode || c.pack != r.culture.pack)
    {
        return Some(Err(
            "Native candidate contract conflicts with explicit config pack/mode.".into(),
        ));
    }
    Some((|| {
        crate::plans::validate_request(r)?;
        if r.native_minimum_candidates.len() > MAX_NATIVE_MINIMUM_CANDIDATES {
            return Err("Native minimum contract exceeds four candidate poses.".into());
        }
        let neighbors = unite(
            &r.neighbors
                .iter()
                .map(|n| n.footprint.clone())
                .chain(std::iter::once(occupied.clone()))
                .collect::<Vec<_>>(),
        );
        let mut failures = Vec::new();
        for (i, candidate) in r.native_minimum_candidates.iter().enumerate() {
            match checked_plan(r, candidate, &neighbors).and_then(|b| {
                crate::plans::parent_batch::admission_guard(&b)?;Ok(b)
            }) {
                Ok(mut b) => {
                    b.diagnostics.push(format!("Direct native minimum: {}/{} supplied poses checked; cached canonical source retained, no dimension or pose search. Source seed {}. Household capacity remains unknown.",i+1,r.native_minimum_candidates.len(),candidate.identity.seed));
                    return Ok(b);
                }
                Err(e) => failures.push(format!("{}: {e}", candidate.identity.style_id)),
            }
        }
        Err(format!(
            "Native minimum candidates refused without hidden regeneration: {}",
            failures.join("; ")
        ))
    })())
}

fn compatible(r: &PlacementRequest, w: &AdmissionWitness) -> Result<(), String> {
    let mut config = r.config.clone().unwrap_or_default();
    config.pack = r.culture.pack.clone();
    config.mode = r.culture.mode;
    config.count = 1;
    config.seed = r.seed.clone();
    crate::catalogue::catalogue()?.validate_config(&config)?;
    let query = StyleQuery {
        pack_id: Some(config.pack.clone()),
        tradition_id: crate::cultural_palettes::automatic_tradition(&r.culture, &config, false)
            .map(str::to_owned),
        recipe_id: Some(w.identity.recipe_id.clone()),
        variant_id: Some(w.identity.variant_id.clone()),
        mode: config.mode,
        era: config.era.clone(),
        allow_late: config.allow_late,
        typology: r.typology,
        ..Default::default()
    };
    if !style_index()?
        .find(&query)
        .iter()
        .any(|s| s.id == w.identity.style_id && s.role.residential())
    {
        return Err("Witness conflicts with culture, tradition, era or typology.".into());
    }
    if let Some(p) = &r.programme {
        if let Some([lo, hi]) = p.floors
            && !w.primary_floors.is_some_and(|f| (lo..=hi).contains(&f))
        {
            return Err("Frozen principal floors do not satisfy the requested range.".into());
        }
        if let Some(c) = p.composition
            && (!c.residential() || c.rank(w.parameters()) != 0)
        {
            return Err("Frozen source does not satisfy the requested composition.".into());
        }
        if let Some(target) = p.built_area_m2 {
            let actual = area(&w.body_footprint);
            if (actual / target - 1.).abs() > 0.10 {
                return Err(format!(
                    "Frozen footprint {actual:.3}m2 does not meet programme {target:.3}m2 within 10%; no minimum-size substitution."
                ));
            }
        }
    }
    Ok(())
}

fn checked_plan(
    r: &PlacementRequest,
    c: &NativeMinimumCandidate,
    occupied: &Surface,
) -> Result<PlanBuilding, String> {
    if ![
        c.transform.origin.x,
        c.transform.origin.y,
        c.transform.orientation_deg,
        c.contact.x,
        c.contact.y,
    ]
    .into_iter()
    .all(f64::is_finite)
    {
        return Err("Non-finite native candidate pose/contact.".into());
    }
    if c.identity != witness_identity(&c.identity.style_id)? {
        return Err("Stale native witness identity or source hash.".into());
    }
    let w = cached_admission_witness(&c.identity.style_id)?;
    compatible(r, &w)?;
    let t = &c.transform;
    let land = difference(&r.cadastral, &r.reserves);
    let walk = difference(&land, occupied);
    let footprint = map(&w.body_footprint, t);
    if !contains(&difference(&r.buildable, &r.reserves), &footprint)
        || area(&intersection(&footprint, occupied)) > 0.0001
    {
        return Err(
            "Native bodies or upper levels exceed buildable rights or overlap neighbours.".into(),
        );
    }
    let court = map(&w.geometry.courts, t);
    let bearing = map(&w.bearing_domain, t);
    if !contains(&walk, &court) || !contains(&walk, &bearing) {
        return Err(
            "Native courts, enclosures or supports conflict with land, reserves or neighbours."
                .into(),
        );
    }
    let roof = map(&w.roof_footprint, t);
    if !contains(
        &difference(r.roof_domain.as_ref().unwrap_or(&r.cadastral), &r.reserves),
        &roof,
    ) {
        return Err("Native roof exceeds roof rights.".into());
    }
    let (low, high, slope) = r.terrain.foundation_bounds(&bearing)?;
    if slope > MAX_LEVEL_FOUNDATION_SLOPE_DEG || high - low > r.terrain.max_foundation_step_m + 1e-8
    {
        return Err(format!(
            "Native foundation requires step {:.3}m / allowed {:.3}m; slope {slope:.3}deg / allowed {MAX_LEVEL_FOUNDATION_SLOPE_DEG}deg.",
            high - low,
            r.terrain.max_foundation_step_m
        ));
    }
    let min_support = w
        .structural_unit
        .bodies
        .iter()
        .flat_map(|b| b.levels.iter().map(|l| l.z_m))
        .fold(f64::INFINITY, f64::min);
    if r.terrain
        .water_z_m
        .is_some_and(|z| z > low + min_support + 0.05)
    {
        return Err("Native foundation or support is submerged.".into());
    }
    let access = r
        .accesses
        .iter()
        .find(|a| a.id == c.access_id)
        .ok_or("Candidate refers to an undeclared access.")?;
    if !matches!(access.kind.as_str(), "public" | "collective" | "private") {
        return Err("Candidate access has an unsupported kind.".into());
    }
    let [a, b] = access.segment;
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let len = libm::hypot(dx, dy);
    let width = 0.8_f64.max(w.access_width_m);
    if !access.width_m.is_finite() || access.width_m < width || !len.is_finite() || len < width {
        return Err("Declared access is narrower than the native witness requires.".into());
    }
    let along = ((c.contact.x - a.x) * dx + (c.contact.y - a.y) * dy) / len;
    let across = ((c.contact.x - a.x) * dy - (c.contact.y - a.y) * dx).abs() / len;
    if across > 0.001 || along < width * 0.5 - 1e-8 || along > len - width * 0.5 + 1e-8 {
        return Err("Candidate contact is outside the usable declared access segment.".into());
    }
    let entrance = world(midpoint(w.entrance.opening), t);
    let site_entry = world(midpoint(w.site_entry.opening), t);
    let connector = segment_corridor(c.contact, site_entry, width);
    let native_passage = map(&w.entrance.passage, t);
    if area(&intersection(&connector, &map(&w.entry_wall_solids, t))) > 0.0001
        || area(&difference(
            &intersection(&connector, &footprint),
            &native_passage,
        )) > 0.0001
    {
        return Err("Public connector crosses a native wall/body away from its portal.".into());
    }
    let circulation = unite(&[
        map(&w.geometry.circulation, t),
        connector.clone(),
        map(&w.site_entry.passage, t),
    ]);
    if !contains(&walk, &circulation) {
        return Err("Native public connection crosses a reserve, hole or neighbour.".into());
    }
    let inv = inverse(t);
    let local_allowed = map(&walk, &inv);
    let local_connector = map(&connector, &inv);
    let interface = union(&local_connector, &w.site_entry.passage);
    if !contains(&local_allowed, &w.site_entry.passage)
        || area(&intersection(&local_connector, &w.site_entry.passage)) <= 0.005
        || interface.len() != 1
        || !crate::access::retained_connection_within(
            &w.structural_unit,
            &local_allowed,
            &interface,
        )
    {
        return Err("Native gate-to-body access graph is disconnected on the real site.".into());
    }
    let unit = &w.structural_unit;
    let volumes = unit
        .bodies
        .iter()
        .enumerate()
        .map(|(i, b)| {
            let levels: Vec<_> = b
                .levels
                .iter()
                .map(|l| VolumeLevel {
                    index: l.index,
                    footprint: map(&l.footprint, t),
                    z_m: high + l.z_m,
                    height_m: l.height_m,
                    materials: Some(l.materials.clone()),
                })
                .collect();
            let z = levels.first().map_or(high, |l| l.z_m);
            let top = levels.iter().map(|l| l.z_m + l.height_m).fold(z, f64::max);
            let roof_top = unit
                .roofs
                .faces
                .iter()
                .filter(|f| f.body_id == b.id)
                .flat_map(|f| {
                    f.vertices
                        .iter()
                        .map(|i| high + unit.roofs.vertices[*i as usize].z)
                })
                .fold(top, f64::max);
            ArchitectureVolume {
                id: format!("{}:body:{i}", r.id),
                footprint: map(&b.footprint, t),
                levels,
                z_m: z,
                wall_height_m: top - z,
                roof_height_m: roof_top - top,
                roof_system: b.roof_system.clone(),
                roof_pitch_deg: b.roof_pitch_deg,
                overhang_m: b.overhang_m,
                roof_spec: b.roof_spec.clone(),
                materials: b.levels[0].materials.clone(),
                role: b.role,
                envelope: b.envelope,
                roof_mesh: VolumeRoofMesh {
                    vertices: vec![],
                    faces: vec![],
                    edges: vec![],
                    groups: vec![],
                },
                foundation: VolumeFoundation {
                    footprint: map(&b.footprint, t),
                    z_min_m: low - 0.15,
                    z_max_m: high,
                },
            }
        })
        .collect();
    let features = w
        .site_features
        .iter()
        .map(|f| world_feature(f, t, high, &r.id))
        .collect();
    let ridges = unit
        .roofs
        .edges
        .iter()
        .filter(|e| e.kind == RoofEdgeKind::Ridge)
        .map(|e| {
            e.vertices.map(|i| {
                let v = &unit.roofs.vertices[i as usize];
                world(Point { x: v.x, y: v.y }, t)
            })
        })
        .collect();
    let height = unit
        .roofs
        .vertices
        .iter()
        .map(|v| v.z)
        .chain(
            unit.bodies
                .iter()
                .flat_map(|b| b.levels.iter().map(|l| l.z_m + l.height_m)),
        )
        .fold(0., f64::max);
    let mut diagnostics = w.resolved.plan.diagnostics.clone();
    diagnostics.push("Frozen native structural witness: exact bodies, roofs, supports, real portal and site access checked. No interior generated; minimum prototype seed preserved. Continuous party-wall fusion and household capacity are not certified.".into());
    Ok(PlanBuilding {
        id: r.id.clone(),
        parcel_id: r.parcel_id.clone(),
        function: r.function,
        culture: r.culture.clone(),
        recipe_id: w.identity.recipe_id.clone(),
        variant_id: w.identity.variant_id.clone(),
        transform: t.clone(),
        ground_z_m: high,
        footprint,
        roof_footprint: roof,
        courtyards: court,
        circulation,
        entrance,
        access_id: access.id.clone(),
        volumes,
        structural_features: features,
        useful_area_m2: unit
            .bodies
            .iter()
            .flat_map(|b| b.levels.iter().map(|l| area(&l.footprint)))
            .sum(),
        domestic_units: 0,
        programme_outcome: None,
        simplification: "architectural_plan".into(),
        diagnostics,
        cartographic: CartographicRoof {
            height_m: height,
            ridges,
            roof_system: w.parameters().roof_system.clone(),
            validation: "native_site".into(),
        },
        resolved: w.packed.clone(),
    })
}

fn world_feature(f: &Feature, t: &Transform, z: f64, id: &str) -> Feature {
    let mut result = f.clone();
    result.id = format!("{id}:{}", f.id);
    result.surface = map(&f.surface, t);
    result.z_m += z;
    result.vertices3d = f
        .vertices3d
        .iter()
        .map(|v| {
            let p = world(Point { x: v.x, y: v.y }, t);
            Vertex3 {
                x: p.x,
                y: p.y,
                z: v.z + z,
            }
        })
        .collect();
    if let Some(roof) = &mut result.roof {
        roof.domain = map(&roof.domain, t);
        roof.support_z_m += z;
        if let Some(owner) = &mut roof.owner_body_id {
            *owner = owner.replacen("unit-0", id, 1);
        }
        for support in &mut roof.supports {
            *support = format!("{id}:{support}");
        }
        let angle = t.orientation_deg.to_radians();
        let (s, c) = (libm::sin(angle), libm::cos(angle));
        for arm in &mut roof.arms {
            arm.origin = world(arm.origin, t);
            arm.domain = map(&arm.domain, t);
            let [x, y] = arm.axis;
            arm.axis = [x * c - y * s, x * s + y * c];
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::geometry::{bounds, rectangle};
    use crate::plans::{PlanBatchRequest, RealizePlanRequest, plan_batch, realize_plan};
    use std::collections::BTreeMap;

    fn request() -> PlacementRequest {
        let w = cached_admission_witness("AS-ISL-B14::default").unwrap();
        let b = w.site_bounds_m;
        let p = midpoint(w.site_entry.opening);
        let body = bounds(&w.body_footprint);
        let normals = [
            ([1., 0.], (p.x - body[2]).abs()),
            ([-1., 0.], (p.x - body[0]).abs()),
            ([0., 1.], (p.y - body[3]).abs()),
            ([0., -1.], (p.y - body[1]).abs()),
        ];
        let normal = normals
            .into_iter()
            .min_by(|a, b| a.1.total_cmp(&b.1))
            .unwrap()
            .0;
        let contact = Point {
            x: p.x + normal[0] * 3.,
            y: p.y + normal[1] * 3.,
        };
        let tangent = [-normal[1], normal[0]];
        let t = Transform {
            origin: Point { x: 100., y: -50. },
            orientation_deg: 27.,
        };
        let land = map(
            &rectangle(b[0] - 6., b[1] - 6., b[2] - b[0] + 12., b[3] - b[1] + 12.),
            &t,
        );
        let candidate = NativeMinimumCandidate {
            identity: w.identity.clone(),
            transform: t.clone(),
            access_id: "street".into(),
            contact: world(contact, &t),
        };
        serde_json::from_value(serde_json::json!({
            "id":"native-1","parcel_id":"lot-1","cadastral":land,"buildable":land,"reserves":[],
            "accesses":[{"id":"street","segment":[
                world(Point{x:contact.x-tangent[0]*5.,y:contact.y-tangent[1]*5.},&t),
                world(Point{x:contact.x+tangent[0]*5.,y:contact.y+tangent[1]*5.},&t)
            ],"kind":"public","width_m":2.}],"party_boundaries":[],"neighbors":[],
            "culture":{"culture":"javanese-courts","pack":"AS-ISL","mode":"historical_inspired","borrowing":null},
            "function":"domestic","seed":"site-seed-is-not-native-seed",
            "terrain":{"origin":{"x":0.,"y":0.},"ground_z_m":12.,"gradient":[0.,0.],"water_z_m":null,"max_foundation_step_m":0.75},
            "programme":{"floors":[1,1],"built_area_m2":area(&w.body_footprint)},
            "native_minimum_candidates":[candidate]
        })).unwrap()
    }
    fn one(r: PlacementRequest) -> Result<PlanBuilding, String> {
        let mut result = plan_batch(PlanBatchRequest {
            schema_version: "1".into(),
            requests: vec![r],
            settings: None,
            footprints: BTreeMap::new(),
        })
        .unwrap();
        if let Some(b) = result.buildings.pop() {
            Ok(b)
        } else {
            Err(result.refusals.remove(0).message)
        }
    }

    #[test]
    fn direct_pose_retains_native_structure_seed_and_detailed_roof() {
        let r = request();
        let w = cached_admission_witness("AS-ISL-B14::default").unwrap();
        let building = one(r.clone()).unwrap();
        assert_eq!(building.cartographic.validation, "native_site");
        assert_eq!(
            building.resolved.unpack().unwrap().config.seed,
            w.identity.seed
        );
        assert!(contains(
            &building.footprint,
            &map(&w.body_footprint, &building.transform)
        ));
        assert!(contains(
            &building.roof_footprint,
            &map(&w.roof_footprint, &building.transform)
        ));
        assert_eq!(building.domestic_units, 0);
        let details = realize_plan(RealizePlanRequest {
            building: building.clone(),
            interiors: false,
        })
        .unwrap();
        assert!(!details.units[0].roofs.faces.is_empty());
        assert_eq!(details.settings.seed, w.identity.seed);
        // The explicit direct route is stable on a second request and reuses
        // one cached structure, without re-drawing it with the city's seed.
        let again = one(r).unwrap();
        assert_eq!(
            serde_json::to_value(building).unwrap(),
            serde_json::to_value(again).unwrap()
        );
        assert!(std::sync::Arc::ptr_eq(
            &w,
            &cached_admission_witness("AS-ISL-B14::default").unwrap()
        ));
    }

    #[test]
    fn complex_direct_pose_preserves_components_portal_and_detailed_roofs() {
        let w = cached_admission_witness("EUR-MED-B07::flat_stone").unwrap();
        let opening = w.site_entry.opening;
        let p = midpoint(opening);
        let dx = opening[1].x - opening[0].x;
        let dy = opening[1].y - opening[0].y;
        let length = libm::sqrt(dx * dx + dy * dy);
        let tangent = [dx / length, dy / length];
        // Derive the street from the real native portal, never from a guessed
        // bounding-box facade. Only the outward normal clears the body.
        let normal = [[-tangent[1], tangent[0]], [tangent[1], -tangent[0]]]
            .into_iter()
            .find(|n| {
                let probe = rectangle(p.x + n[0] * 0.5 - 0.05, p.y + n[1] * 0.5 - 0.05, 0.1, 0.1);
                area(&intersection(&probe, &w.body_footprint)) < 1e-9
            })
            .unwrap();
        let contact = Point {
            x: p.x + normal[0] * 3.,
            y: p.y + normal[1] * 3.,
        };
        let t = Transform {
            origin: Point { x: 245., y: -130. },
            orientation_deg: -37.,
        };
        let b = w.site_bounds_m;
        let land = map(
            &rectangle(b[0] - 8., b[1] - 8., b[2] - b[0] + 16., b[3] - b[1] + 16.),
            &t,
        );
        let candidate = NativeMinimumCandidate {
            identity: w.identity.clone(),
            transform: t.clone(),
            access_id: "street".into(),
            contact: world(contact, &t),
        };
        let mut r: PlacementRequest = serde_json::from_value(serde_json::json!({
            "id":"complex-native","parcel_id":"complex-lot","cadastral":land,"buildable":land,"reserves":[],
            "accesses":[{"id":"street","segment":[
                world(Point{x:contact.x-tangent[0]*5.,y:contact.y-tangent[1]*5.},&t),
                world(Point{x:contact.x+tangent[0]*5.,y:contact.y+tangent[1]*5.},&t)
            ],"kind":"public","width_m":2.}],"party_boundaries":[],"neighbors":[],
            "culture":{"culture":"european-organic","pack":"EUR-MED","mode":"historical_inspired","borrowing":null},
            "function":"domestic","seed":"complex-site-seed",
            "terrain":{"origin":{"x":0.,"y":0.},"ground_z_m":12.,"gradient":[0.,0.],"water_z_m":null,"max_foundation_step_m":0.75},
            "programme":{"floors":[1,1],"built_area_m2":area(&w.body_footprint)},
            "native_minimum_candidates":[candidate]
        })).unwrap();
        let building = one(r.clone()).unwrap();
        assert_eq!(building.cartographic.validation, "native_site");
        assert_eq!(building.recipe_id, "EUR-MED-B07");
        assert_eq!(building.variant_id, "flat_stone");
        assert_eq!(building.transform, t);
        assert_eq!(
            building
                .volumes
                .iter()
                .map(|v| v.levels.len())
                .collect::<Vec<_>>(),
            [1, 3]
        );
        for (volume, body) in building.volumes.iter().zip(&w.structural_unit.bodies) {
            assert_eq!(volume.footprint, map(&body.footprint, &t));
            for (actual, native) in volume.levels.iter().zip(&body.levels) {
                assert_eq!(actual.footprint, map(&native.footprint, &t));
                assert_eq!(actual.height_m, native.height_m);
            }
        }
        assert_eq!(building.entrance, world(p, &t));
        assert_eq!(
            building.resolved.unpack().unwrap().config.seed,
            w.identity.seed
        );
        let details = realize_plan(RealizePlanRequest {
            building,
            interiors: false,
        })
        .unwrap();
        assert!(details.units[0].rooms.is_empty());
        assert_eq!(details.units[0].transform, t);
        assert_eq!(details.units[0].bodies, w.structural_unit.bodies);
        assert_eq!(details.units[0].roofs, w.structural_unit.roofs);
        assert!(!details.units[0].roofs.faces.is_empty());
        assert_eq!(details.settings.seed, w.identity.seed);
        r.programme.as_mut().unwrap().floors = Some([2, 2]);
        assert!(one(r).err().unwrap().contains("Frozen principal floors"));
    }

    #[test]
    fn direct_pose_rechecks_real_rights_ground_access_and_source_contract() {
        let initial = request();
        let mut stale = initial.clone();
        stale.native_minimum_candidates[0].identity.source_sha256 = "stale".into();
        assert!(one(stale).err().unwrap().contains("Stale"));
        let mut target = initial.clone();
        target.programme.as_mut().unwrap().built_area_m2 = Some(700.);
        assert!(
            one(target)
                .err()
                .unwrap()
                .contains("no minimum-size substitution")
        );
        let mut floors = initial.clone();
        floors.programme.as_mut().unwrap().floors = Some([2, 2]);
        assert!(
            one(floors)
                .err()
                .unwrap()
                .contains("Frozen principal floors")
        );
        let mut roof = initial.clone();
        roof.roof_domain = Some(rectangle(0., 0., 1., 1.));
        assert!(one(roof).err().unwrap().contains("roof rights"));
        let mut terrain = initial.clone();
        terrain.terrain.gradient = [0.2, 0.];
        assert!(one(terrain).err().unwrap().contains("foundation requires"));
        let mut access = initial.clone();
        access.native_minimum_candidates[0].contact.x += 1.;
        assert!(
            one(access)
                .err()
                .unwrap()
                .contains("usable declared access")
        );
        let mut kind = initial.clone();
        kind.accesses[0].kind = "invented".into();
        assert!(one(kind).err().unwrap().contains("unsupported kind"));
        let mut mode = initial.clone();
        mode.config = Some(HouseConfig {
            pack: mode.culture.pack.clone(),
            mode: HistoricalMode::HistoricalStrict,
            ..Default::default()
        });
        assert!(one(mode).err().unwrap().contains("config pack/mode"));
        let mut blocked = initial.clone();
        let contact = blocked.native_minimum_candidates[0].contact;
        blocked.reserves = rectangle(contact.x - 0.4, contact.y - 0.4, 0.8, 0.8);
        assert!(one(blocked).err().unwrap().contains("connection crosses"));
        let mut occupied = initial.clone();
        occupied.neighbors.push(ArchitectureNeighbor {
            id: "other".into(),
            footprint: occupied.buildable.clone(),
            height_m: 4.,
        });
        assert!(one(occupied).err().unwrap().contains("overlap neighbours"));
        let mut pinned = initial;
        pinned.config = Some(HouseConfig {
            recipe: Some("AS-ISL-B15".into()),
            pack: pinned.culture.pack.clone(),
            ..Default::default()
        });
        assert!(try_plan(&pinned, &vec![], None, false).is_none());
        assert!(try_plan(&request(), &vec![], None, true).is_none());
    }
}
