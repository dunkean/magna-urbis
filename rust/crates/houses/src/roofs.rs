//! Deterministic finite-domain roof surfaces, with explicit local arms.
use crate::catalogue::Envelope;
use crate::geometry::{self as g, area, bounds, difference, intersection, point, snap, union};
use crate::model::*;
use geo::TriangulateEarcut;
use std::collections::{BTreeMap, BTreeSet};
use std::f64::consts::{PI, TAU};
use std::rc::Rc;

#[path = "attachment_contacts.rs"]
mod attachment_contacts;
#[path = "boundary_roofs.rs"]
mod boundary;
#[path = "corbel_roofs.rs"]
mod corbel;
#[path = "ogival_roofs.rs"]
mod ogival;
#[path = "parapet_openings.rs"]
mod parapets;
#[path = "roof_signatures.rs"]
mod signatures;
#[path = "support_intervals.rs"]
mod support_intervals;
pub(crate) use parapets::parapet_jamb_edges;
#[path = "roof_traits.rs"]
mod traits;
pub use traits::{RoofTrait, inspect_roof_trait};

pub const MAX_ROOF_FACES: usize = 20_000;
const EPS: f64 = 1.0e-8;

pub(crate) fn support_line_intervals(a: Point, b: Point, domain: &Surface) -> Vec<(f64, f64)> {
    support_intervals::line_intervals(a, b, domain)
}

/// Common finite cover input. A feature never creates a fictitious Body or room.
#[derive(Clone)]
struct RoofSource {
    id: String,
    body_id: String,
    feature_id: Option<String>,
    component_id: Option<String>,
    level: Level,
    envelope: Envelope,
    roof_system: String,
    roof_spec: RoofSpec,
    roof_arms: Vec<RoofArm>,
    roof_pitch_deg: f64,
    overhang_m: f64,
    support_z_m: f64,
    group: String,
    layer: String,
    kind: RoofFaceKind,
    declared_domain: Option<Surface>,
    intermediate: bool,
    nested: bool,
    boundary_triangulation: bool,
    voids: Vec<(String, Surface)>,
}

fn body_sources(unit: &HouseUnit) -> Vec<RoofSource> {
    let mut bodies: Vec<_> = unit.bodies.iter().collect();
    bodies.sort_by(|a, b| a.id.cmp(&b.id));
    let mut sources = vec![];
    for body in bodies {
        let mut levels: Vec<_> = body.levels.iter().collect();
        levels.sort_by_key(|l| l.index);
        for (li, level) in levels.iter().enumerate() {
            let top = li + 1 == levels.len();
            if !top && level.intermediate_cover == IntermediateCover::None {
                continue;
            }
            let roof_system = if top {
                body.roof_system.clone()
            } else {
                match level.intermediate_cover {
                    IntermediateCover::Terrace => "RF-FLAT",
                    IntermediateCover::Shed => "RF-SHED",
                    IntermediateCover::Skirt => "RF-HIP",
                    IntermediateCover::None => unreachable!(),
                }
                .into()
            };
            let support_z_m = snap(
                if top && matches!(body.envelope, Envelope::Shell | Envelope::Membrane) {
                    level.z_m
                } else {
                    level.z_m + level.height_m
                },
            );
            let kind = if ["RF-FLAT", "RF-STEP"].contains(&roof_system.as_str()) {
                RoofFaceKind::Slab
            } else if !top && level.intermediate_cover == IntermediateCover::Skirt {
                RoofFaceKind::Skirt
            } else {
                RoofFaceKind::Pan
            };
            let pitch = if !top && roof_system == "RF-FLAT" {
                0.0
            } else if !top && body.roof_pitch_deg == 0.0 {
                25.0
            } else {
                body.roof_pitch_deg
            };
            sources.push(RoofSource {
                id: body.id.clone(),
                body_id: body.id.clone(),
                feature_id: None,
                component_id: body.component_id.clone(),
                level: (**level).clone(),
                envelope: body.envelope,
                roof_system,
                roof_spec: body.roof_spec.clone(),
                roof_arms: body.roof_arms.clone(),
                roof_pitch_deg: pitch,
                overhang_m: body.overhang_m,
                support_z_m,
                group: format!(
                    "{}:{}:{}",
                    body.id,
                    level.index,
                    if top { "main" } else { "intermediate" }
                ),
                layer: if top {
                    "main".into()
                } else {
                    format!("intermediate:{}", (support_z_m * 1000.0) as i64)
                },
                kind,
                declared_domain: None,
                intermediate: !top,
                nested: false,
                boundary_triangulation: body.roof_spec.triangulation
                    == Some(RoofTriangulation::Boundary),
                voids: body
                    .voids
                    .iter()
                    .enumerate()
                    .map(|(i, s)| (format!("void:{}:{i}", body.id), s.clone()))
                    .collect(),
            });
        }
    }
    sources
}

fn attachment_source(
    unit: &HouseUnit,
    feature: &Feature,
    roof: &RoofAttachment,
) -> Result<RoofSource, String> {
    if feature.id.starts_with("roof:")
        || !matches!(
            feature.kind,
            FeatureKind::Gallery
                | FeatureKind::Deck
                | FeatureKind::Platform
                | FeatureKind::Landing
                | FeatureKind::Balcony
                | FeatureKind::InnerMembrane
        )
    {
        return Err(format!(
            "Feature non éligible à une couverture : {}.",
            feature.id
        ));
    }
    if roof.nested != (feature.kind == FeatureKind::InnerMembrane)
        || (roof.nested && (roof.owner_body_id.is_none() || roof.rf != "RF-DOME"))
    {
        return Err(format!(
            "Couverture intérieure sans propriétaire/profil : {}.",
            feature.id
        ));
    }
    if !unit.levels.iter().any(|l| l.index == roof.level)
        || roof
            .owner_body_id
            .as_ref()
            .is_some_and(|id| !unit.bodies.iter().any(|b| &b.id == id))
    {
        return Err(format!(
            "Propriétaire/niveau de couverture inconnus : {}.",
            feature.id
        ));
    }
    if !feature.z_m.is_finite()
        || feature
            .vertices3d
            .iter()
            .any(|v| !v.x.is_finite() || !v.y.is_finite() || !v.z.is_finite())
        || !roof.support_z_m.is_finite()
        || roof.support_z_m <= feature.z_m
        || !roof.max_span_m.is_finite()
        || roof.max_span_m <= 0.0
        || roof.max_span_m > 6.0
    {
        return Err(format!(
            "Appui/portée de couverture invalides : {}.",
            feature.id
        ));
    }
    valid_surface(&feature.surface).map_err(|e| format!("{e} Feature {}.", feature.id))?;
    valid_surface(&roof.domain).map_err(|e| format!("{e} Couverture {}.", feature.id))?;
    crate::gallery_components::validate(roof)
        .map_err(|e| format!("{e} Feature {}.", feature.id))?;
    crate::gallery_components::owner(unit, roof)?;
    if area(&feature.surface) <= EPS
        || area(&roof.domain) <= EPS
        || area(&difference(&feature.surface, &roof.domain)) > g::area_tolerance(&feature.surface)
        || area(&difference(&roof.domain, &unit.lot)) > g::area_tolerance(&roof.domain)
    {
        return Err(format!(
            "Domaine de couverture incomplet ou hors lot : {}.",
            feature.id
        ));
    }
    let catalogue = crate::catalogue::catalogue()?;
    if !catalogue.material_has(&roof.material, &["cladding"])
        || !catalogue.material_has(&roof.frame_material, &["roof_frame", "load_bearing"])
    {
        return Err(format!(
            "Matériau de couverture/charpente incompatible : {}.",
            feature.id
        ));
    }
    if ["RF-FLAT", "RF-STEP"].contains(&roof.rf.as_str()) && roof.spec.parapet_height_m != 0.0 {
        return Err(format!(
            "Une couverture non praticable ne porte pas de parapet : {}.",
            feature.id
        ));
    }
    for (body, level, slab) in unit.bodies.iter().flat_map(|body| {
        body.levels
            .iter()
            .filter_map(move |level| level.roof_slab.as_ref().map(|slab| (body, level, slab)))
    }) {
        if slab.walkable
            && slab.z_m > feature_floor_z(feature) + 0.001
            && attachment_contacts::conflicts(&intersection(&roof.domain, &slab.surface))
        {
            let overlap = intersection(&roof.domain, &slab.surface);
            let witness = overlap.iter().flat_map(|p| &p.outer).next().unwrap();
            return Err(format!(
                "Couverture en conflit avec une dalle praticable : {} ; dalle {}:{} z={:.3}, plancher galerie={:.3}, appui={:.3}, recouvrement={:.12} m² à ({:.9}, {:.9}).",
                feature.id,
                body.id,
                level.index,
                slab.z_m,
                feature_floor_z(feature),
                roof.support_z_m,
                area(&overlap),
                witness.x,
                witness.y
            ));
        }
    }
    validate_supports(unit, feature, roof)?;
    let mut materials = MaterialSlots {
        frame: roof.frame_material.clone(),
        infill: roof.frame_material.clone(),
        coating: String::new(),
        cladding: roof.material.clone(),
        base: String::new(),
        roof_frame: roof.frame_material.clone(),
    };
    // The shared operator only consumes cladding, infill and roof_frame.
    materials.coating.clone_from(&roof.material);
    Ok(RoofSource {
        id: feature.id.clone(),
        body_id: roof.owner_body_id.clone().unwrap_or_default(),
        feature_id: Some(feature.id.clone()),
        component_id: Some(feature.id.clone()),
        level: Level {
            index: roof.level,
            z_m: feature_floor_z(feature),
            height_m: roof.support_z_m - feature_floor_z(feature),
            footprint: feature.surface.clone(),
            floor: feature.surface.clone(),
            intermediate_cover: IntermediateCover::None,
            roof_slab: None,
            materials,
        },
        envelope: if roof.nested {
            Envelope::Membrane
        } else {
            Envelope::Open
        },
        roof_system: roof.rf.clone(),
        roof_spec: roof.spec.clone(),
        roof_arms: roof.arms.clone(),
        roof_pitch_deg: roof.pitch_deg,
        overhang_m: roof.overhang_m,
        support_z_m: roof.support_z_m,
        group: format!("feature:{}:roof", feature.id),
        layer: if roof.nested {
            format!("nested:{}", feature.id)
        } else {
            "main".into()
        },
        kind: if ["RF-FLAT", "RF-STEP"].contains(&roof.rf.as_str()) {
            RoofFaceKind::Slab
        } else {
            RoofFaceKind::Pan
        },
        declared_domain: Some(roof.domain.clone()),
        intermediate: false,
        nested: roof.nested,
        boundary_triangulation: roof.spec.triangulation == Some(RoofTriangulation::Boundary),
        voids: vec![],
    })
}

/// Sub-micrometre boundary contact has no resolvable interior in the exported
/// XY mesh. This tolerance never changes or filters the actual roof domain.
fn physical_overlap(overlap: &Surface) -> bool {
    let overlap_area = area(overlap);
    overlap_area > EPS && (overlap_area > 1e-6 || area(&g::offset(overlap, -1e-6)) > EPS)
}

fn feature_floor_z(feature: &Feature) -> f64 {
    if feature.kind == FeatureKind::InnerMembrane {
        return feature.z_m;
    }
    feature
        .vertices3d
        .iter()
        .map(|v| v.z)
        .fold(feature.z_m, f64::max)
}

fn roof_sources(unit: &HouseUnit) -> Result<Vec<RoofSource>, String> {
    if unit.site_context.iter().any(|f| f.roof.is_some()) {
        return Err("Le contexte de site ne peut porter une couverture générée.".into());
    }
    let mut sources = body_sources(unit);
    let mut attached: Vec<_> = unit.features.iter().filter(|f| f.roof.is_some()).collect();
    attached.sort_by(|a, b| a.id.cmp(&b.id));
    for feature in attached {
        sources.push(attachment_source(
            unit,
            feature,
            feature.roof.as_ref().unwrap(),
        )?);
    }
    Ok(sources)
}

fn validate_supports(
    unit: &HouseUnit,
    feature: &Feature,
    roof: &RoofAttachment,
) -> Result<(), String> {
    let wall_sections: BTreeMap<_, _> = unit
        .walls
        .iter()
        .map(|w| {
            (
                &w.id,
                crate::wall_geometry::wall_section(w, roof.support_z_m),
            )
        })
        .collect();
    let mut supports: Vec<&Surface> = vec![];
    let mut base_supports: Vec<&Surface> = vec![];
    let mut beams: Vec<&Surface> = vec![];
    let mut seen = BTreeSet::new();
    for id in &roof.supports {
        if !seen.insert(id) {
            return Err(format!("Support de couverture dupliqué : {id}."));
        }
        if let Some(wall) = unit.walls.iter().find(|w| &w.id == id) {
            if wall.shell_reference
                || wall.z_m > roof.support_z_m + 0.001
                || wall.z_m + wall.height_m < roof.support_z_m - 0.001
            {
                return Err(format!("Mur ne portant pas la cote d'appui : {id}."));
            }
            let section = &wall_sections[&wall.id];
            if area(section) <= EPS {
                return Err(format!("Section du mur sans appui à la cote : {id}."));
            }
            supports.push(section);
            base_supports.push(section);
        } else if let Some(support) = unit.features.iter().find(|f| &f.id == id) {
            if !matches!(
                support.kind,
                FeatureKind::Post | FeatureKind::Pier | FeatureKind::Beam
            ) || (support.z_m + support.height_m - roof.support_z_m).abs() > 0.001
            {
                return Err(format!("Support ne portant pas la cote d'appui : {id}."));
            }
            if feature.kind != FeatureKind::InnerMembrane
                && support.kind == FeatureKind::Beam
                && area(&intersection(&feature.surface, &support.surface)) > EPS
                && support.z_m < feature.z_m + 2.0 - 0.001
            {
                return Err(format!("Retombée de poutre sous la hauteur libre : {id}."));
            }
            supports.push(&support.surface);
            if support.kind == FeatureKind::Beam {
                beams.push(&support.surface);
            } else {
                base_supports.push(&support.surface);
            }
        } else {
            return Err(format!("Support de couverture inconnu : {id}."));
        }
    }
    if supports.is_empty() {
        return Err(format!("Couverture sans support : {}.", feature.id));
    }
    for surface in &supports {
        valid_surface(surface)?;
    }
    validate_supported_edges(
        &feature.id,
        &roof.domain,
        &supports,
        roof.max_span_m,
        roof.overhang_m + 0.25,
    )?;
    for beam in beams {
        if beam.len() == 1 && beam[0].holes.len() == 1 {
            validate_supported_ring(&feature.id, beam, &base_supports, roof.max_span_m)?;
        } else {
            validate_supported_edges(&feature.id, beam, &base_supports, roof.max_span_m, 0.25)?;
        }
    }
    Ok(())
}

/// A continuous curved beam spans between physical posts along its contour.
/// Polygon sampling points are not independent beam endpoints.
fn validate_supported_ring(
    id: &str,
    beam: &Surface,
    supports: &[&Surface],
    max_span: f64,
) -> Result<(), String> {
    let raw: Vec<_> = supports
        .iter()
        .flat_map(|s| g::to_geo(&g::offset(s, 0.25)).0)
        .collect();
    let support = g::from_geo(&geo::algorithm::bool_ops::unary_union(&raw));
    for ring in beam
        .iter()
        .flat_map(|p| std::iter::once(&p.outer).chain(&p.holes))
    {
        let mut intervals = vec![];
        let mut perimeter = 0.0;
        for (&a, &b) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            let len = libm::sqrt((b.x - a.x).powi(2) + (b.y - a.y).powi(2));
            intervals.extend(
                corbel::line_intervals(a, b, &support)
                    .into_iter()
                    .map(|(lo, hi)| (perimeter + lo * len, perimeter + hi * len)),
            );
            perimeter += len;
        }
        if intervals.is_empty() {
            return Err(format!("Poutre annulaire sans appui : {id}."));
        }
        intervals.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
        let first = intervals[0].0;
        let mut end = intervals[0].1;
        for &(lo, hi) in &intervals[1..] {
            if lo - end > max_span + 0.001 {
                return Err(format!(
                    "Portée annulaire excessive : {id} ({:.3} m).",
                    lo - end
                ));
            }
            end = end.max(hi);
        }
        if perimeter - end + first > max_span + 0.001 {
            return Err(format!(
                "Portée annulaire excessive : {id} ({:.3} m).",
                perimeter - end + first
            ));
        }
    }
    Ok(())
}

fn validate_supported_edges(
    id: &str,
    domain: &Surface,
    supports: &[&Surface],
    max_span_m: f64,
    tolerance: f64,
) -> Result<(), String> {
    for ring in domain
        .iter()
        .flat_map(|p| std::iter::once(&p.outer).chain(&p.holes))
    {
        for (a, b) in ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
        {
            let length = libm::sqrt((a.x - b.x).powi(2) + (a.y - b.y).powi(2));
            if length < EPS {
                continue;
            }
            let axis = [(b.x - a.x) / length, (b.y - a.y) / length];
            let mut intervals: Vec<(f64, f64)> = vec![];
            for support in supports {
                for polygon in support.iter() {
                    if !polygon
                        .outer
                        .iter()
                        .any(|p| distance_to_segment(*p, *a, *b) <= tolerance)
                    {
                        continue;
                    }
                    let values: Vec<_> = polygon
                        .outer
                        .iter()
                        .map(|p| (p.x - a.x) * axis[0] + (p.y - a.y) * axis[1])
                        .collect();
                    let lo = values
                        .iter()
                        .copied()
                        .fold(f64::INFINITY, f64::min)
                        .clamp(0.0, length);
                    let hi = values
                        .iter()
                        .copied()
                        .fold(f64::NEG_INFINITY, f64::max)
                        .clamp(0.0, length);
                    intervals.push((lo, hi));
                }
            }
            intervals.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.total_cmp(&b.1)));
            if intervals.is_empty() || intervals[0].0 > tolerance + 0.001 {
                return Err(format!("Extrémité de rive sans appui : {}.", id));
            }
            let mut end = 0.0_f64;
            for (lo, hi) in intervals {
                if lo - end > max_span_m + 0.001 {
                    return Err(format!(
                        "Portée de rive excessive : {} ({:.3} m).",
                        id,
                        lo - end
                    ));
                }
                end = end.max(hi);
            }
            if length - end > tolerance + 0.001 {
                return Err(format!("Extrémité de rive sans appui : {}.", id));
            }
        }
    }
    Ok(())
}

#[derive(Clone, Copy, Debug)]
struct Plane {
    a: f64,
    b: f64,
    c: f64,
}
impl Plane {
    fn height(self, p: Point) -> f64 {
        self.a * p.x + self.b * p.y + self.c
    }
    fn minus(self, other: Self) -> Self {
        Self {
            a: self.a - other.a,
            b: self.b - other.b,
            c: self.c - other.c,
        }
    }
}

#[derive(Clone)]
struct MaterialContour {
    id: String,
    points: Vec<Point>,
}

#[derive(Clone)]
struct CreatedPlane {
    group: String,
    id: usize,
    plane: Plane,
    layer: String,
    floor_z_m: f64,
}

/// Fixed native domain formula: ((eaves - (cores - declared)) & lot)
/// minus voids/upper occupied floors, optionally restricted by an arm/slab.
#[derive(Clone)]
struct NativeBase {
    eaves: Surface,
    eaves_recipe: Option<NativeOffsetSurface>,
    cores: Surface,
    cores_recipe: Option<NativeOffsetSurface>,
    declared: Vec<Surface>,
    lot: Surface,
    excluded: Vec<Surface>,
    /// Original finite arm edges, used only to certify construction anchors.
    raw_arms: Vec<Surface>,
}
#[derive(Clone)]
struct NativeDomain {
    base: Rc<NativeBase>,
    arm: Option<Surface>,
    arm_recipe: Option<NativeOffsetSurface>,
    slab: Option<Surface>,
}

/// Existing F64 generators, retained before the rounded world additions.
#[derive(Clone)]
struct NativeOffsetRing {
    raw: Vec<Point>,
    delta: Vec<Point>,
    distances: Vec<f64>,
    choices: Vec<NativeCorner>,
    reverse: bool,
}
#[derive(Clone)]
enum NativeCorner {
    Miter(Point),
    Parallel(Point),
    Bevel,
}
#[derive(Clone)]
struct NativeOffsetPolygon {
    outer: NativeOffsetRing,
    holes: Vec<NativeOffsetRing>,
}
type NativeOffsetSurface = Vec<NativeOffsetPolygon>;
#[derive(Clone)]
struct NativeAnchor {
    edge: [Point; 2],
    z: f64,
}
#[derive(Clone)]
struct NativePlane {
    plane: Plane,
    anchor: Option<NativeAnchor>,
}

#[derive(Clone)]
struct Candidate {
    domain: Surface,
    plane: Plane,
    body_id: String,
    feature_id: Option<String>,
    floor_z_m: f64,
    envelope: Envelope,
    component_id: Option<String>,
    level: u32,
    rf: String,
    group: String,
    layer: String,
    material: String,
    kind: RoofFaceKind,
    corbel: bool,
    nested: bool,
    boundary_triangulation: bool,
    whole_boundary: bool,
    overlay_error_m: f64,
    material_contours: Rc<Vec<MaterialContour>>,
    plan_id: usize,
    creation_planes: Rc<Vec<CreatedPlane>>,
    native_domain: Option<Rc<NativeDomain>>,
    native_anchor: Option<NativeAnchor>,
    native_minimum: Rc<Vec<NativePlane>>,
    native_peers: Rc<Vec<Candidate>>,
}

#[derive(Clone)]
struct RawFace {
    vertices: Vec<Vertex3>,
    source: Candidate,
}

fn local(arm: &RoofArm, x: f64, y: f64) -> Point {
    point(
        arm.origin.x + arm.axis[0] * x - arm.axis[1] * y,
        arm.origin.y + arm.axis[1] * x + arm.axis[0] * y,
    )
}
fn coordinates(arm: &RoofArm, p: Point) -> (f64, f64) {
    let dx = p.x - arm.origin.x;
    let dy = p.y - arm.origin.y;
    (
        dx * arm.axis[0] + dy * arm.axis[1],
        -dx * arm.axis[1] + dy * arm.axis[0],
    )
}
fn local_surface(arm: &RoofArm, x: f64, y: f64, w: f64, h: f64) -> Surface {
    vec![Polygon {
        outer: vec![
            local(arm, x, y),
            local(arm, x + w, y),
            local(arm, x + w, y + h),
            local(arm, x, y + h),
        ],
        holes: vec![],
    }]
}
fn arm_ellipse(arm: &RoofArm, rx: f64, ry: f64, segments: u32) -> Surface {
    vec![Polygon {
        outer: (0..segments)
            .map(|i| {
                let angle = TAU * i as f64 / segments as f64;
                local(
                    arm,
                    arm.length_m * 0.5 + rx * libm::cos(angle),
                    arm.width_m * 0.5 + ry * libm::sin(angle),
                )
            })
            .collect(),
        holes: vec![],
    }]
}
fn affine(arm: &RoofArm, a: f64, b: f64, c: f64) -> Plane {
    let ax = a * arm.axis[0] - b * arm.axis[1];
    let ay = a * arm.axis[1] + b * arm.axis[0];
    Plane {
        a: ax,
        b: ay,
        c: c - ax * arm.origin.x - ay * arm.origin.y,
    }
}
fn triangle_plane(vertices: &[Vertex3; 3]) -> Option<Plane> {
    let [a, b, c] = vertices;
    let den = (b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y);
    if den.abs() < EPS {
        return None;
    }
    let x = ((b.z - a.z) * (c.y - a.y) - (c.z - a.z) * (b.y - a.y)) / den;
    let y = ((b.x - a.x) * (c.z - a.z) - (c.x - a.x) * (b.z - a.z)) / den;
    Some(Plane {
        a: x,
        b: y,
        c: a.z - x * a.x - y * a.y,
    })
}

/// Clip a finite polygon by a*x+b*y+c >= 0. No plane is extrapolated beyond it.
fn half_plane(surface: &Surface, plane: Plane) -> Surface {
    if surface.is_empty() {
        return vec![];
    }
    if plane.a.abs() + plane.b.abs() < EPS {
        return if plane.c >= -EPS {
            surface.clone()
        } else {
            vec![]
        };
    }
    let b = bounds(surface);
    let margin = 1.0 + (b[2] - b[0]).max(b[3] - b[1]);
    let ring = [
        Point {
            x: b[0] - margin,
            y: b[1] - margin,
        },
        Point {
            x: b[2] + margin,
            y: b[1] - margin,
        },
        Point {
            x: b[2] + margin,
            y: b[3] + margin,
        },
        Point {
            x: b[0] - margin,
            y: b[3] + margin,
        },
    ];
    let mut clipped = vec![];
    for (p, q) in ring
        .iter()
        .zip(ring.iter().cycle().skip(1))
        .take(ring.len())
    {
        let ph = plane.height(*p);
        let qh = plane.height(*q);
        if ph >= -EPS {
            clipped.push(*p);
        }
        if (ph >= -EPS) != (qh >= -EPS) {
            let t = ph / (ph - qh);
            clipped.push(Point {
                x: p.x + t * (q.x - p.x),
                y: p.y + t * (q.y - p.y),
            });
        }
    }
    if clipped.len() < 3 {
        vec![]
    } else {
        intersection(
            surface,
            &vec![Polygon {
                outer: clipped,
                holes: vec![],
            }],
        )
    }
}

fn overlaps(a: [f64; 4], b: [f64; 4]) -> bool {
    a[0] < b[2] - EPS && b[0] < a[2] - EPS && a[1] < b[3] - EPS && b[1] < a[3] - EPS
}

fn validate_spec(body: &RoofSource) -> Result<(), String> {
    signatures::validate_horns(body)?;
    let s = &body.roof_spec;
    if !body.roof_pitch_deg.is_finite()
        || !(0.0..=70.0).contains(&body.roof_pitch_deg)
        || !body.overhang_m.is_finite()
        || !(0.0..=2.0).contains(&body.overhang_m)
    {
        return Err(format!("Pente/débord de toiture invalides : {}.", body.id));
    }
    if body.roof_system == "RF-CURVED"
        && libm::tan(body.roof_pitch_deg * PI / 180.0) < 2.0 * s.curve_lift_ratio
    {
        return Err(format!(
            "RF-CURVED : pente insuffisante pour curve_lift_ratio ; l'intrados passerait sous l'appui ({}).",
            body.id
        ));
    }
    for (name, value, lo, hi) in [
        ("tier_inset_ratio", s.tier_inset_ratio, 0.02, 0.3),
        ("tier_rise_m", s.tier_rise_m, 0.1, 5.0),
        ("drum_height_m", s.drum_height_m, 0.1, 5.0),
        ("gambrel_break_ratio", s.gambrel_break_ratio, 0.15, 0.85),
        (
            "gambrel_lower_pitch_deg",
            s.gambrel_lower_pitch_deg,
            25.0,
            80.0,
        ),
        ("saddle_rise_ratio", s.saddle_rise_ratio, 0.01, 0.5),
        ("parapet_height_m", s.parapet_height_m, 0.0, 2.0),
        ("dome_rise_ratio", s.dome_rise_ratio, 0.1, 2.0),
        ("oculus_ratio", s.oculus_ratio, 0.0, 0.4),
        ("curve_lift_ratio", s.curve_lift_ratio, 0.01, 0.4),
        ("tent_crown_ratio", s.tent_crown_ratio, 0.02, 0.3),
        ("shell_cross_rise_ratio", s.shell_cross_rise_ratio, 0.1, 2.0),
        ("shell_long_rise_ratio", s.shell_long_rise_ratio, 0.01, 0.5),
    ] {
        if !value.is_finite() || !(lo..=hi).contains(&value) {
            return Err(format!("Paramètre RF {name} invalide : {}.", body.id));
        }
    }
    if !(2..=5).contains(&s.tiers)
        || !(2..=24).contains(&s.step_count)
        || !(4..=32).contains(&s.shell_sections)
        || !(12..=96).contains(&s.round_segments)
        || !(4..=32).contains(&s.curve_sections)
        || s.drainage_side > 3
    {
        return Err(format!("Résolution/paramètres RF invalides : {}.", body.id));
    }
    if ["RF-FLAT", "RF-STEP"].contains(&body.roof_system.as_str()) && body.roof_pitch_deg != 0.0 {
        return Err("Une dalle de toiture exige une pente architecturale nulle.".into());
    }
    let pitched = [
        "RF-CONE",
        "RF-TENT",
        "RF-GABLE",
        "RF-HIP",
        "RF-SHED",
        "RF-EAVES",
        "RF-REED-HIP",
        "RF-GAMBREL",
        "RF-STEEP-STEP",
        "RF-MULTIPAV",
        "RF-TIERED",
        "RF-SADDLE",
        "RF-CURVED",
    ];
    if pitched.contains(&body.roof_system.as_str()) && body.roof_pitch_deg <= 0.0 {
        return Err(format!("{} exige une pente positive.", body.roof_system));
    }
    if body.roof_system == "RF-GAMBREL" && s.gambrel_lower_pitch_deg <= body.roof_pitch_deg {
        return Err(
            "Les pans bas du gambrel doivent être plus raides que les pans supérieurs.".into(),
        );
    }
    corbel::validate_spec(body)?;
    ogival::validate_spec(body)?;
    if !body.intermediate
        && s.drainage.is_some()
        && (!matches!(body.roof_system.as_str(), "RF-HIP" | "RF-GABLE" | "RF-SHED")
            || body.roof_pitch_deg <= 0.0)
    {
        return Err(format!("Drainage vers cour incompatible : {}.", body.id));
    }
    if let Some(vault) = &s.vault
        && ((!body.intermediate
            && !["RF-VAULT", "RF-THATCH-VAULT"].contains(&body.roof_system.as_str()))
            || !vault.bearing_ratio.is_finite()
            || !(0.05..=0.6).contains(&vault.bearing_ratio)
            || vault.open_ends.len() > 2
            || (vault.open_ends.len() == 2 && vault.open_ends[0] == vault.open_ends[1]))
    {
        return Err(format!("Profil/appuis de voûte invalides : {}.", body.id));
    }
    for (_, void) in &body.voids {
        valid_surface(void).map_err(|e| format!("{e} Vide de {}.", body.group))?;
        if area(void) <= EPS {
            return Err(format!("Vide de toiture sans domaine : {}.", body.id));
        }
    }
    valid_surface(&body.level.footprint).map_err(|e| format!("{e} Niveau {}.", body.group))?;
    if let Some(slab) = &body.level.roof_slab {
        valid_surface(&slab.surface).map_err(|e| format!("{e} Dalle {}.", body.group))?;
    }
    for (index, arm) in body.roof_arms.iter().enumerate() {
        valid_surface(&arm.domain).map_err(|e| format!("{e} Bras{index} de {}.", body.group))?;
        if body.feature_id.is_none() && arm.source_component.is_some() {
            return Err("Sélecteur de composante interdit sur un bras de Body.".into());
        }
        if !arm.origin.x.is_finite()
            || !arm.origin.y.is_finite()
            || !arm.length_m.is_finite()
            || !arm.width_m.is_finite()
            || arm.length_m <= 0.0
            || arm.width_m <= 0.0
            || !arm.axis.iter().all(|v| v.is_finite())
            || (arm.axis[0] * arm.axis[0] + arm.axis[1] * arm.axis[1] - 1.0).abs() > 1.0e-6
        {
            return Err(format!("Repère de bras toiture invalide : {}.", body.id));
        }
    }
    Ok(())
}

fn valid_surface(surface: &Surface) -> Result<(), String> {
    for polygon in surface {
        for ring in std::iter::once(&polygon.outer).chain(&polygon.holes) {
            if ring.len() < 3 || ring.iter().any(|p| !p.x.is_finite() || !p.y.is_finite()) {
                return Err("Surface de couverture non finie ou anneau dégénéré.".into());
            }
            if ring
                .iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
                .any(|(a, b)| a == b)
            {
                return Err("Surface de couverture avec une arête de longueur nulle.".into());
            }
        }
    }
    Ok(())
}

fn conservative_roof_faces(unit: &HouseUnit) -> Result<usize, String> {
    let mut total = 0usize;
    for body in &roof_sources(unit)? {
        validate_spec(body)?;
        let s = &body.roof_spec;
        let edges = body
            .level
            .footprint
            .iter()
            .map(|p| p.outer.len() + p.holes.iter().map(Vec::len).sum::<usize>())
            .sum::<usize>()
            .max(4);
        let arms = body.roof_arms.len().max(1);
        let main = match body.roof_system.as_str() {
            "RF-CONE" => edges.max(s.round_segments as usize) * 2,
            "RF-TENT" => edges.max(s.round_segments as usize) * 4,
            "RF-DOME" | "RF-DOME-CONE" | "RF-SNOW" => {
                edges.max(s.round_segments as usize) * (s.curve_sections as usize * 2 + 4)
            }
            "RF-THATCH-VAULT" | "RF-VAULT" => s.curve_sections as usize * 6 * arms,
            "RF-CROSSVAULT" => s.curve_sections as usize * s.curve_sections as usize * 20 * arms,
            // Four trapezoids per physical band; the existing center fan
            // emits up to four triangles before the contour clipping margin.
            "RF-CURVED" => signatures::estimate_curved_patches(unit, body)?.saturating_mul(4),
            "RF-SADDLE" if s.horns.is_some() => signatures::estimate_horn_faces(s.curve_sections),
            "RF-SADDLE" => s.curve_sections as usize * 8 * arms,
            "RF-SHELL" => s.shell_sections as usize * s.curve_sections as usize * 3 * arms,
            "RF-TIERED" => s.tiers as usize * 48 * arms,
            "RF-STEEP-STEP" => s.step_count as usize * 12 * arms + 12 * arms,
            "RF-MULTIPAV" => 96 * arms,
            "RF-GAMBREL" => 24 * arms,
            "RF-GABLE" | "RF-HIP" | "RF-FLAT" | "RF-SHED" | "RF-STEP" | "RF-EAVES"
            | "RF-REED-HIP" => 16 * arms,
            rf => return Err(format!("Couverture inconnue : {rf}.")),
        };
        let curved_round = ["RF-CONE", "RF-TENT", "RF-DOME", "RF-DOME-CONE", "RF-SNOW"]
            .contains(&body.roof_system.as_str());
        let edge_allowance = if curved_round {
            0
        } else {
            edges * if body.feature_id.is_some() { 8 } else { 4 }
        };
        let corbel_faces = corbel::estimate(unit, body);
        let ordinary = if s
            .corbel
            .as_ref()
            .is_some_and(|c| c.profile == CorbelProfile::Dome)
        {
            0
        } else {
            main + edge_allowance
        };
        total = total.saturating_add(ordinary + corbel_faces);
    }
    Ok(total)
}

/// Conservative preflight before constructing any roof mesh.
pub fn estimate_roof_faces(unit: &HouseUnit) -> Result<usize, String> {
    let total = conservative_roof_faces(unit)?;
    if total > MAX_ROOF_FACES {
        // A majorant cannot reject a compound whose hidden faces disappear.
        // The shared pure pipeline counts the finite visible mesh, with its
        // incremental guard rejecting only the actual 20,001st face.
        Ok(make_roofs(unit)?.0.faces.len())
    } else {
        Ok(total)
    }
}

fn distance_to_segment(p: Point, a: Point, b: Point) -> f64 {
    let dx = b.x - a.x;
    let dy = b.y - a.y;
    let den = dx * dx + dy * dy;
    if den < EPS {
        return libm::sqrt((p.x - a.x).powi(2) + (p.y - a.y).powi(2));
    }
    let t = (((p.x - a.x) * dx + (p.y - a.y) * dy) / den).clamp(0.0, 1.0);
    libm::sqrt((p.x - a.x - t * dx).powi(2) + (p.y - a.y - t * dy).powi(2))
}
fn edge_overhang(unit: &HouseUnit, body: &RoofSource, a: Point, b: Point, inner: bool) -> f64 {
    let mid = Point {
        x: (a.x + b.x) * 0.5,
        y: (a.y + b.y) * 0.5,
    };
    if unit
        .walls
        .iter()
        .filter(|w| w.party)
        .flat_map(|w| w.centerline.windows(2))
        .any(|s| distance_to_segment(mid, s[0], s[1]) <= 0.003)
    {
        return 0.0;
    }
    let near_court = unit.partition.courtyards.iter().find(|p| {
        p.outer
            .iter()
            .zip(p.outer.iter().cycle().skip(1))
            .take(p.outer.len())
            .any(|(c, d)| distance_to_segment(mid, *c, *d) < 0.003)
    });
    if let Some(court) = near_court {
        if body.roof_spec.drainage == Some(RoofDrainage::Inward) {
            return 0.0;
        }
        let b = bounds(&vec![court.clone()]);
        body.overhang_m
            .min(0.25)
            .min((b[2] - b[0]).min(b[3] - b[1]) * 0.2)
    } else if inner {
        body.overhang_m.min(0.25)
    } else {
        body.overhang_m
    }
}
fn offset_ring(unit: &HouseUnit, body: &RoofSource, ring: &[Point], inner: bool) -> Vec<Point> {
    let n = ring.len();
    if n < 3 {
        return vec![];
    }
    if body.boundary_triangulation && body.overhang_m == 0.0 {
        return ring.to_vec();
    }
    let lines: Vec<_> = ring
        .iter()
        .zip(ring.iter().cycle().skip(1))
        .take(n)
        .map(|(a, b)| {
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let len = libm::sqrt(dx * dx + dy * dy);
            let d = edge_overhang(unit, body, *a, *b, inner);
            (
                Point {
                    x: a.x + dy / len * d,
                    y: a.y - dx / len * d,
                },
                Point {
                    x: b.x + dy / len * d,
                    y: b.y - dx / len * d,
                },
                d,
            )
        })
        .collect();
    let mut out = vec![];
    for i in 0..n {
        let (a, b, da) = lines[(i + n - 1) % n];
        let (c, d, db) = lines[i];
        let ux = b.x - a.x;
        let uy = b.y - a.y;
        let vx = d.x - c.x;
        let vy = d.y - c.y;
        let det = ux * vy - uy * vx;
        let p = if det.abs() > EPS {
            let t = ((c.x - a.x) * vy - (c.y - a.y) * vx) / det;
            Point {
                x: a.x + t * ux,
                y: a.y + t * uy,
            }
        } else {
            Point {
                x: (b.x + c.x) * 0.5,
                y: (b.y + c.y) * 0.5,
            }
        };
        let dist = libm::sqrt((p.x - ring[i].x).powi(2) + (p.y - ring[i].y).powi(2));
        if dist > 4.0 * da.max(db).max(0.001) {
            out.push(if body.boundary_triangulation {
                b
            } else {
                point(b.x, b.y)
            });
            out.push(if body.boundary_triangulation {
                c
            } else {
                point(c.x, c.y)
            });
        } else {
            out.push(if body.boundary_triangulation {
                p
            } else {
                point(p.x, p.y)
            });
        }
    }
    out.dedup();
    out
}

fn literal_recipe(raw: &[Point]) -> NativeOffsetRing {
    NativeOffsetRing {
        raw: raw.to_vec(),
        delta: vec![],
        distances: vec![],
        choices: vec![],
        reverse: false,
    }
}

/// Freeze historical branch decisions; the exact backend evaluates only the
/// same Raw operands and the already computed per-edge F64 displacement.
fn offset_recipe(
    unit: &HouseUnit,
    body: &RoofSource,
    ring: &[Point],
    inner: bool,
) -> NativeOffsetRing {
    if body.overhang_m == 0.0 {
        return literal_recipe(ring);
    }
    let n = ring.len();
    let mut delta = vec![];
    let mut distances = vec![];
    let mut lines = vec![];
    for (&a, &b) in ring.iter().zip(ring.iter().cycle().skip(1)).take(n) {
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let len = libm::sqrt(dx * dx + dy * dy);
        let d = edge_overhang(unit, body, a, b, inner);
        let displacement = Point {
            x: dy / len * d,
            y: -(dx / len * d),
        };
        delta.push(displacement);
        distances.push(d);
        lines.push((
            Point {
                x: a.x + displacement.x,
                y: a.y + displacement.y,
            },
            Point {
                x: b.x + displacement.x,
                y: b.y + displacement.y,
            },
        ));
    }
    let mut choices = vec![];
    for i in 0..n {
        let (a, b) = lines[(i + n - 1) % n];
        let (c, d) = lines[i];
        let ux = b.x - a.x;
        let uy = b.y - a.y;
        let vx = d.x - c.x;
        let vy = d.y - c.y;
        let determinant = ux * vy - uy * vx;
        let old = if determinant.abs() > EPS {
            let t = ((c.x - a.x) * vy - (c.y - a.y) * vx) / determinant;
            Point {
                x: a.x + t * ux,
                y: a.y + t * uy,
            }
        } else {
            Point {
                x: (b.x + c.x) * 0.5,
                y: (b.y + c.y) * 0.5,
            }
        };
        let dist = libm::sqrt((old.x - ring[i].x).powi(2) + (old.y - ring[i].y).powi(2));
        choices.push(
            if dist > 4.0 * distances[(i + n - 1) % n].max(distances[i]).max(0.001) {
                NativeCorner::Bevel
            } else if determinant.abs() > EPS {
                NativeCorner::Miter(old)
            } else {
                NativeCorner::Parallel(old)
            },
        );
    }
    NativeOffsetRing {
        raw: ring.to_vec(),
        delta,
        distances,
        choices,
        reverse: false,
    }
}

fn offset_recipes(unit: &HouseUnit, body: &RoofSource, surface: &Surface) -> NativeOffsetSurface {
    surface
        .iter()
        .map(|p| NativeOffsetPolygon {
            outer: offset_recipe(unit, body, &p.outer, false),
            holes: p
                .holes
                .iter()
                .map(|r| offset_recipe(unit, body, r, true))
                .collect(),
        })
        .collect()
}

fn legacy_eaves_domain(domain: Surface, boundary: bool) -> Surface {
    if boundary || domain.len() < 2 {
        return domain;
    }
    let overlaps = domain.iter().enumerate().any(|(i, a)| {
        domain[i + 1..]
            .iter()
            .any(|b| !intersection(&vec![a.clone()], &vec![b.clone()]).is_empty())
    });
    if !overlaps {
        return domain;
    }
    // Boolean operands use EvenOdd within each MultiPolygon. Overlapping
    // eaves of this same cover are material union, not an XOR hole. Fold
    // single polygons to keep the existing intra-ring fill semantics; leave
    // disjoint inputs and the exact Boundary authority untouched.
    g::unite(&domain.into_iter().map(|p| vec![p]).collect::<Vec<_>>())
}

#[cfg(test)]
#[path = "legacy_eaves_tests.rs"]
mod legacy_eaves_tests;

fn roof_domain(unit: &HouseUnit, body: &RoofSource, level: &Level) -> Surface {
    if let Some(domain) = &body.declared_domain {
        return domain.clone();
    }
    let mut domain: Surface = level
        .footprint
        .iter()
        .map(|p| Polygon {
            outer: offset_ring(unit, body, &p.outer, false),
            holes: p
                .holes
                .iter()
                .map(|h| offset_ring(unit, body, h, true))
                .collect(),
        })
        .collect();
    domain = legacy_eaves_domain(domain, body.boundary_triangulation);
    // Interior eaves may project a little into a court; its reserved inner
    // core remains a genuine hole, including on extremely narrow courts.
    let cores: Surface = unit
        .partition
        .courtyards
        .iter()
        .map(|court| {
            let mut ring = court.outer.clone();
            ring.reverse();
            let mut inset = offset_ring(unit, body, &ring, true);
            inset.reverse();
            Polygon {
                outer: inset,
                holes: court.holes.clone(),
            }
        })
        .collect();
    let declared: Surface = unit
        .features
        .iter()
        .filter_map(|f| f.roof.as_ref())
        .fold(vec![], |surface, roof| union(&surface, &roof.domain));
    domain = difference(&domain, &difference(&cores, &declared));
    if !unit.lot.is_empty() {
        domain = intersection(&domain, &unit.lot);
    }
    for (_, void) in &body.voids {
        domain = difference(&domain, void);
    }
    domain
}

/// These are native operands, captured before any clipping or envelope boolean.
/// A vertex of a clipped candidate never becomes a material corner.
fn material_contours(unit: &HouseUnit, body: &RoofSource) -> Rc<Vec<MaterialContour>> {
    let mut contours = vec![];
    let mut add = |name: String, surface: &Surface| {
        for (pi, polygon) in surface.iter().enumerate() {
            for (ri, ring) in std::iter::once(&polygon.outer)
                .chain(&polygon.holes)
                .enumerate()
            {
                contours.push(MaterialContour {
                    id: format!("{}:{name}:{pi}:{ri}", body.group),
                    points: ring.clone(),
                });
            }
        }
    };
    let offset = |surface: &Surface| -> Surface {
        surface
            .iter()
            .map(|p| Polygon {
                outer: offset_ring(unit, body, &p.outer, false),
                holes: p
                    .holes
                    .iter()
                    .map(|r| offset_ring(unit, body, r, true))
                    .collect(),
            })
            .collect()
    };
    add("footprint".into(), &body.level.footprint);
    add("eave".into(), &offset(&body.level.footprint));
    if let Some(domain) = &body.declared_domain {
        add("declared".into(), domain);
    }
    if let Some(slab) = &body.level.roof_slab {
        add("slab".into(), &slab.surface);
    }
    for (ai, arm) in body.roof_arms.iter().enumerate() {
        add(format!("arm:{ai}"), &arm.domain);
        add(format!("arm-eave:{ai}"), &offset(&arm.domain));
    }
    let cores: Surface = unit
        .partition
        .courtyards
        .iter()
        .map(|court| {
            let mut ring = court.outer.clone();
            ring.reverse();
            let mut inset = offset_ring(unit, body, &ring, true);
            inset.reverse();
            Polygon {
                outer: inset,
                holes: court.holes.clone(),
            }
        })
        .collect();
    add("court-core".into(), &cores);
    add("lot".into(), &unit.lot);
    for (id, void) in &body.voids {
        add(format!("void:{id}"), void);
    }
    for other in &unit.bodies {
        for level in &other.levels {
            add(
                format!("upper:{}:{}", other.id, level.index),
                &level.footprint,
            );
        }
    }
    for feature in unit.features.iter().chain(&unit.site_context) {
        if let Some(roof) = &feature.roof {
            add(format!("feature-roof:{}", feature.id), &roof.domain);
        }
        if matches!(
            feature.kind,
            FeatureKind::RockShelter | FeatureKind::Gallery
        ) {
            add(format!("feature:{}", feature.id), &feature.surface);
        }
    }
    for portal in &unit.access.portals {
        if portal.kind == PortalKind::Hatch {
            add(format!("hatch:{}", portal.id), &portal.opening_surface);
        }
    }
    Rc::new(contours)
}

fn native_domain(unit: &HouseUnit, body: &RoofSource) -> Rc<NativeDomain> {
    let eaves = body.declared_domain.clone().unwrap_or_else(|| {
        body.level
            .footprint
            .iter()
            .map(|p| Polygon {
                outer: offset_ring(unit, body, &p.outer, false),
                holes: p
                    .holes
                    .iter()
                    .map(|r| offset_ring(unit, body, r, true))
                    .collect(),
            })
            .collect()
    });
    let eaves_recipe = body
        .declared_domain
        .is_none()
        .then(|| offset_recipes(unit, body, &body.level.footprint));
    let mut cores_recipe = None;
    let mut excluded = vec![];
    let mut cores = vec![];
    let mut declared = vec![];
    if body.declared_domain.is_none() {
        cores = unit
            .partition
            .courtyards
            .iter()
            .map(|court| {
                let mut r = court.outer.clone();
                r.reverse();
                let mut outer = offset_ring(unit, body, &r, true);
                outer.reverse();
                Polygon {
                    outer,
                    holes: court.holes.clone(),
                }
            })
            .collect();
        cores_recipe = Some(
            unit.partition
                .courtyards
                .iter()
                .map(|court| {
                    let mut raw = court.outer.clone();
                    raw.reverse();
                    let mut outer = offset_recipe(unit, body, &raw, true);
                    outer.reverse = true;
                    NativeOffsetPolygon {
                        outer,
                        holes: court.holes.iter().map(|r| literal_recipe(r)).collect(),
                    }
                })
                .collect(),
        );
        declared = unit
            .features
            .iter()
            .filter_map(|f| f.roof.as_ref().map(|r| r.domain.clone()))
            .collect();
        excluded.extend(body.voids.iter().map(|(_, s)| s.clone()));
    }
    for other in &unit.bodies {
        for upper in &other.levels {
            if !(body.nested && other.id == body.body_id)
                && (other.id != body.body_id
                    || body.feature_id.is_some()
                    || upper.index > body.level.index)
                && upper.z_m + upper.height_m > body.support_z_m + 0.001
            {
                excluded.push(upper.footprint.clone());
            }
        }
    }
    for f in unit.features.iter().chain(&unit.site_context) {
        if (f.kind == FeatureKind::RockShelter && f.z_m >= body.support_z_m - 0.001)
            || (body.intermediate
                && body.kind != RoofFaceKind::Slab
                && f.kind == FeatureKind::Gallery
                && feature_floor_z(f) >= body.support_z_m - 0.001)
        {
            excluded.push(f.surface.clone());
        }
    }
    for p in &unit.access.portals {
        if p.kind == PortalKind::Hatch && (p.to_z_m - body.support_z_m).abs() <= 0.001 {
            excluded.push(p.opening_surface.clone());
        }
    }
    Rc::new(NativeDomain {
        base: Rc::new(NativeBase {
            eaves,
            eaves_recipe,
            cores,
            cores_recipe,
            declared,
            lot: if body.declared_domain.is_none() {
                unit.lot.clone()
            } else {
                vec![]
            },
            excluded,
            raw_arms: body.roof_arms.iter().map(|a| a.domain.clone()).collect(),
        }),
        arm: None,
        arm_recipe: None,
        slab: None,
    })
}

fn template(
    body: &RoofSource,
    level: &Level,
    z: f64,
    rf: &str,
    group: String,
    layer: String,
    kind: RoofFaceKind,
) -> Candidate {
    Candidate {
        domain: vec![],
        plane: Plane {
            a: 0.0,
            b: 0.0,
            c: z,
        },
        body_id: body.body_id.clone(),
        feature_id: body.feature_id.clone(),
        floor_z_m: level.z_m,
        envelope: body.envelope,
        component_id: body.component_id.clone(),
        level: level.index,
        rf: rf.into(),
        group,
        layer,
        material: level.materials.cladding.clone(),
        kind,
        corbel: false,
        nested: body.nested,
        boundary_triangulation: body.boundary_triangulation,
        whole_boundary: false,
        overlay_error_m: 0.0,
        material_contours: Rc::new(vec![]),
        plan_id: usize::MAX,
        creation_planes: Rc::new(vec![]),
        native_domain: None,
        native_anchor: None,
        native_minimum: Rc::new(vec![]),
        native_peers: Rc::new(vec![]),
    }
}
fn add_plan(out: &mut Vec<Candidate>, template: &Candidate, domain: Surface, plane: Plane) {
    if area(&domain) > EPS || template.native_domain.is_some() {
        let mut candidate = template.clone();
        candidate.domain = domain;
        candidate.plane = plane;
        candidate.plan_id = out.len();
        out.push(candidate);
    }
}
/// The frame side selects a real Raw edge by exact coordinate identity.
/// No closest-edge search or bbox-derived material corner is introduced.
fn native_anchor(t: &Candidate, plane: Plane, side: [Point; 2], z: f64) -> Option<NativeAnchor> {
    let d = t.native_domain.as_ref()?;
    let axis = if plane.a != 0.0 && plane.b == 0.0 {
        0
    } else if plane.a == 0.0 && plane.b != 0.0 {
        1
    } else {
        return None;
    };
    let coordinates = |p: Point| if axis == 0 { [p.x, p.y] } else { [p.y, p.x] };
    let [coordinate, start] = coordinates(side[0]);
    let [other_coordinate, end] = coordinates(side[1]);
    if coordinate != other_coordinate {
        return None;
    }
    let recipes = d
        .base
        .eaves_recipe
        .iter()
        .chain(&d.base.cores_recipe)
        .chain(&d.arm_recipe)
        .flatten()
        .flat_map(|p| {
            std::iter::once(p.outer.raw.as_slice()).chain(p.holes.iter().map(|r| r.raw.as_slice()))
        });
    // A side shared by adjacent arms keeps its original finite Raw provenance.
    // The registry never unions domains or aliases nearby material coordinates.
    let arms =
        d.base.raw_arms.iter().flatten().flat_map(|p| {
            std::iter::once(p.outer.as_slice()).chain(p.holes.iter().map(Vec::as_slice))
        });
    recipes
        .chain(arms)
        .flat_map(|r| r.iter().zip(r.iter().cycle().skip(1)).take(r.len()))
        .find_map(|(&a, &b)| {
            let [aa, ra] = coordinates(a);
            let [bb, rb] = coordinates(b);
            let overlap = start.min(end).max(ra.min(rb)) < start.max(end).min(ra.max(rb));
            (aa == coordinate && bb == coordinate && a != b && overlap)
                .then_some(NativeAnchor { edge: [a, b], z })
        })
}

fn minimum_roof(
    out: &mut Vec<Candidate>,
    t: &Candidate,
    domain: &Surface,
    planes: &[Plane],
    anchors: &[Option<NativeAnchor>],
) {
    let mut t = t.clone();
    if t.native_domain.is_some() {
        t.native_minimum = Rc::new(
            planes
                .iter()
                .zip(anchors)
                .map(|(&plane, anchor)| NativePlane {
                    plane,
                    anchor: anchor.clone(),
                })
                .collect(),
        );
    }
    for (i, &plane) in planes.iter().enumerate() {
        let mut part = domain.clone();
        for (j, &other) in planes.iter().enumerate() {
            if i != j {
                let delta = other.minus(plane);
                if delta.a.abs() + delta.b.abs() + delta.c.abs() < EPS && j < i {
                    part.clear();
                    break;
                }
                part = half_plane(&part, delta);
                if part.is_empty() {
                    break;
                }
            }
        }
        t.native_anchor = anchors[i].clone();
        add_plan(out, &t, part, plane);
    }
}

/// The maximum of four affine distances to a rectangular court produces
/// inverted hips, with actual corner valleys ending at the court corners.
fn inward_roof(
    unit: &HouseUnit,
    source: &RoofSource,
    t: &Candidate,
    domain: &Surface,
    out: &mut Vec<Candidate>,
) -> Result<(), String> {
    let [court] = unit.partition.courtyards.as_slice() else {
        return Err(format!(
            "Drainage intérieur exige une cour rectangulaire unique : {}.",
            source.id
        ));
    };
    let b = bounds(&vec![court.clone()]);
    let rect = g::rectangle(b[0], b[1], b[2] - b[0], b[3] - b[1]);
    if area(&difference(&rect, &vec![court.clone()])) > g::area_tolerance(&rect)
        || physical_overlap(&intersection(domain, &vec![court.clone()]))
    {
        return Err(format!(
            "Cour incompatible avec le drainage intérieur : {}.",
            source.id
        ));
    }
    let pitch = libm::tan(source.roof_pitch_deg * PI / 180.0);
    let z = source.support_z_m;
    let planes = [
        Plane {
            a: -pitch,
            b: 0.0,
            c: z + pitch * b[0],
        },
        Plane {
            a: pitch,
            b: 0.0,
            c: z - pitch * b[2],
        },
        Plane {
            a: 0.0,
            b: -pitch,
            c: z + pitch * b[1],
        },
        Plane {
            a: 0.0,
            b: pitch,
            c: z - pitch * b[3],
        },
    ];
    for (i, &plane) in planes.iter().enumerate() {
        let mut part = domain.clone();
        for (j, &other) in planes.iter().enumerate() {
            if i != j {
                part = half_plane(&part, plane.minus(other));
            }
        }
        let mut t = t.clone();
        let side = match i {
            0 => [Point { x: b[0], y: b[1] }, Point { x: b[0], y: b[3] }],
            1 => [Point { x: b[2], y: b[1] }, Point { x: b[2], y: b[3] }],
            2 => [Point { x: b[0], y: b[1] }, Point { x: b[2], y: b[1] }],
            _ => [Point { x: b[0], y: b[3] }, Point { x: b[2], y: b[3] }],
        };
        t.native_anchor = native_anchor(&t, plane, side, z);
        add_plan(out, &t, part, plane);
    }
    Ok(())
}
fn pitched_arm(
    out: &mut Vec<Candidate>,
    t: &Candidate,
    arm: &RoofArm,
    covered: &Surface,
    z: f64,
    pitch: f64,
    hip: bool,
) {
    let d = intersection(covered, &arm.domain);
    let p = libm::tan(pitch * PI / 180.0);
    let mut planes = vec![
        affine(arm, 0.0, p, z),
        affine(arm, 0.0, -p, z + p * arm.width_m),
    ];
    if hip {
        planes.push(affine(arm, p, 0.0, z));
        planes.push(affine(arm, -p, 0.0, z + p * arm.length_m));
    }
    let sides = [
        [local(arm, 0.0, 0.0), local(arm, arm.length_m, 0.0)],
        [
            local(arm, 0.0, arm.width_m),
            local(arm, arm.length_m, arm.width_m),
        ],
        [local(arm, 0.0, 0.0), local(arm, 0.0, arm.width_m)],
        [
            local(arm, arm.length_m, 0.0),
            local(arm, arm.length_m, arm.width_m),
        ],
    ];
    let anchors: Vec<_> = planes
        .iter()
        .zip(sides)
        .map(|(&plane, side)| native_anchor(t, plane, side, z))
        .collect();
    minimum_roof(out, t, &d, &planes, &anchors);
}
fn curve_triangle(out: &mut Vec<Candidate>, t: &Candidate, covered: &Surface, v: [Vertex3; 3]) {
    if let Some(plane) = triangle_plane(&v) {
        let d = vec![Polygon {
            outer: v.iter().map(|p| Point { x: p.x, y: p.y }).collect(),
            holes: vec![],
        }];
        add_plan(out, t, intersection(&d, covered), plane);
    }
}
fn vertex(arm: &RoofArm, x: f64, y: f64, z: f64) -> Vertex3 {
    let p = local(arm, x, y);
    Vertex3 {
        x: p.x,
        y: p.y,
        z: snap(z),
    }
}
fn curved_grid<F: Fn(f64, f64) -> f64>(
    out: &mut Vec<Candidate>,
    t: &Candidate,
    arm: &RoofArm,
    covered: &Surface,
    nx: u32,
    ny: u32,
    f: F,
) {
    let limits = covered
        .iter()
        .flat_map(|p| &p.outer)
        .map(|&p| coordinates(arm, p))
        .fold(
            [
                f64::INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::NEG_INFINITY,
            ],
            |b, (x, y)| [b[0].min(x), b[1].min(y), b[2].max(x), b[3].max(y)],
        );
    for ix in 0..nx {
        for iy in 0..ny {
            let x0 = limits[0] + (limits[2] - limits[0]) * ix as f64 / nx as f64;
            let x1 = limits[0] + (limits[2] - limits[0]) * (ix + 1) as f64 / nx as f64;
            let y0 = limits[1] + (limits[3] - limits[1]) * iy as f64 / ny as f64;
            let y1 = limits[1] + (limits[3] - limits[1]) * (iy + 1) as f64 / ny as f64;
            let a = vertex(arm, x0, y0, f(x0, y0));
            let b = vertex(arm, x1, y0, f(x1, y0));
            let c = vertex(arm, x1, y1, f(x1, y1));
            let d = vertex(arm, x0, y1, f(x0, y1));
            curve_triangle(out, t, covered, [a.clone(), b, c.clone()]);
            curve_triangle(out, t, covered, [a, c, d]);
        }
    }
}
#[allow(clippy::too_many_arguments)]
fn round_roof(
    out: &mut Vec<Candidate>,
    t: &Candidate,
    covered: &Surface,
    arm: &RoofArm,
    z: f64,
    s: &RoofSpec,
    rf: &str,
    pitch: f64,
) {
    let rx = arm.length_m * 0.5;
    let ry = arm.width_m * 0.5;
    let rise = if rf == "RF-CONE" || rf == "RF-TENT" {
        rx.min(ry) * libm::tan(pitch * PI / 180.0)
    } else {
        rx.min(ry) * s.dome_rise_ratio
    };
    let minimum = if rf == "RF-TENT" {
        s.tent_crown_ratio
    } else {
        s.oculus_ratio
    };
    let nr = if rf == "RF-CONE" || rf == "RF-TENT" {
        1
    } else {
        s.curve_sections
    };
    // The exported FP boundary is authoritative. Radial sections reach every
    // boundary vertex, preserving its polygon and the true eave elevation.
    let mut exterior: Vec<_> = covered
        .iter()
        .flat_map(|p| p.outer.iter())
        .copied()
        .collect();
    let center = local(arm, rx, ry);
    for i in 0..if s.round_segments as usize > exterior.len() {
        s.round_segments
    } else {
        0
    } {
        let angle = TAU * i as f64 / s.round_segments as f64;
        let dx = arm.axis[0] * libm::cos(angle) - arm.axis[1] * libm::sin(angle);
        let dy = arm.axis[1] * libm::cos(angle) + arm.axis[0] * libm::sin(angle);
        let mut hit: Option<(f64, Point)> = None;
        for polygon in covered {
            for (a, b) in polygon
                .outer
                .iter()
                .zip(polygon.outer.iter().cycle().skip(1))
                .take(polygon.outer.len())
            {
                let ex = b.x - a.x;
                let ey = b.y - a.y;
                let den = dx * ey - dy * ex;
                if den.abs() < EPS {
                    continue;
                }
                let ax = a.x - center.x;
                let ay = a.y - center.y;
                let distance = (ax * ey - ay * ex) / den;
                let along = (ax * dy - ay * dx) / den;
                if distance > 0.0
                    && (-EPS..=1.0 + EPS).contains(&along)
                    && hit.as_ref().is_none_or(|h| distance > h.0)
                {
                    hit = Some((
                        distance,
                        point(center.x + distance * dx, center.y + distance * dy),
                    ));
                }
            }
        }
        if let Some((_, p)) = hit {
            exterior.push(p);
        }
    }
    exterior.sort_by(|a, b| {
        libm::atan2(a.y - center.y, a.x - center.x)
            .total_cmp(&libm::atan2(b.y - center.y, b.x - center.x))
    });
    exterior.dedup_by(|a, b| a.x == b.x && a.y == b.y);
    for ir in 0..nr {
        let r0 = minimum + (1.0 - minimum) * ir as f64 / nr as f64;
        let r1 = minimum + (1.0 - minimum) * (ir + 1) as f64 / nr as f64;
        for (a, b) in exterior
            .iter()
            .zip(exterior.iter().cycle().skip(1))
            .take(exterior.len())
        {
            let make = |r: f64, boundary: Point| {
                let (x, y) = coordinates(arm, boundary);
                let rho = libm::sqrt(((x - rx) / rx).powi(2) + ((y - ry) / ry).powi(2)) * r;
                let height = if rf == "RF-CONE" || rf == "RF-TENT" {
                    z + rise * (1.0 - rho)
                } else {
                    z + rise * libm::sqrt((1.0 - rho * rho).max(0.0))
                };
                vertex(arm, rx + (x - rx) * r, ry + (y - ry) * r, height)
            };
            let v0 = make(r0, *a);
            let v1 = make(r1, *a);
            let v2 = make(r1, *b);
            let v3 = make(r0, *b);
            curve_triangle(out, t, covered, [v0.clone(), v1, v2.clone()]);
            if r0 > EPS {
                curve_triangle(out, t, covered, [v0, v2, v3]);
            }
        }
    }
    if rf == "RF-TENT" {
        let crown = vec![Polygon {
            outer: exterior
                .iter()
                .map(|p| {
                    point(
                        center.x + (p.x - center.x) * minimum,
                        center.y + (p.y - center.y) * minimum,
                    )
                })
                .collect(),
            holes: vec![],
        }];
        add_plan(
            out,
            t,
            intersection(covered, &crown),
            Plane {
                a: 0.0,
                b: 0.0,
                c: z + rise * (1.0 - minimum),
            },
        );
    }
}

fn shifted_arm(arm: &RoofArm, inset: f64) -> RoofArm {
    let x = arm.length_m * inset;
    let y = arm.width_m * inset;
    let origin = local(arm, x, y);
    let length = arm.length_m * (1.0 - 2.0 * inset);
    let width = arm.width_m * (1.0 - 2.0 * inset);
    let mut out = RoofArm {
        source_component: None,
        origin,
        axis: arm.axis,
        length_m: length,
        width_m: width,
        domain: vec![],
    };
    out.domain = local_surface(&out, 0.0, 0.0, length, width);
    out
}

fn hip_boundary_profile(inner: &RoofArm, support: &RoofArm, z: f64, p: f64) -> Vec<(Point, f64)> {
    let planes = [
        affine(support, p, 0.0, z),
        affine(support, -p, 0.0, z + p * support.length_m),
        affine(support, 0.0, p, z),
        affine(support, 0.0, -p, z + p * support.width_m),
    ];
    let mut profile = vec![];
    for polygon in &inner.domain {
        for (a, b) in polygon
            .outer
            .iter()
            .zip(polygon.outer.iter().cycle().skip(1))
            .take(polygon.outer.len())
        {
            let mut stations = vec![0.0];
            for i in 0..planes.len() {
                for j in i + 1..planes.len() {
                    let d = planes[i].minus(planes[j]);
                    let da = d.height(*a);
                    let db = d.height(*b);
                    if (da - db).abs() > EPS {
                        let t = da / (da - db);
                        if (EPS..1.0 - EPS).contains(&t) {
                            stations.push(t);
                        }
                    }
                }
            }
            stations.sort_by(f64::total_cmp);
            stations.dedup_by(|a, b| (*a - *b).abs() < EPS);
            for t in stations {
                let point = Point {
                    x: a.x + t * (b.x - a.x),
                    y: a.y + t * (b.y - a.y),
                };
                let height = planes
                    .iter()
                    .map(|p| p.height(point))
                    .fold(f64::INFINITY, f64::min);
                profile.push((point, height));
            }
        }
    }
    profile
}

fn upper_envelope(candidates: &[Candidate]) -> Vec<Candidate> {
    let boxes: Vec<_> = candidates.iter().map(|c| bounds(&c.domain)).collect();
    let mut order: Vec<_> = (0..candidates.len()).collect();
    order.sort_by(|&a, &b| boxes[a][0].total_cmp(&boxes[b][0]).then(a.cmp(&b)));
    let mut neighbors = vec![vec![]; candidates.len()];
    for (ii, &i) in order.iter().enumerate() {
        for &j in order.iter().skip(ii + 1) {
            if boxes[j][0] >= boxes[i][2] - EPS {
                break;
            }
            if candidates[i].layer == candidates[j].layer && overlaps(boxes[i], boxes[j]) {
                neighbors[i].push(j);
                neighbors[j].push(i);
            }
        }
    }
    candidates
        .iter()
        .enumerate()
        .filter_map(|(i, source)| {
            let mut out = source.clone();
            neighbors[i].sort_unstable();
            for &j in &neighbors[i] {
                let delta = candidates[j].plane.minus(source.plane);
                let tied = delta.a.abs() + delta.b.abs() + delta.c.abs() < EPS;
                if tied && j > i {
                    continue;
                }
                let intersected = intersection(&out.domain, &candidates[j].domain);
                if source.boundary_triangulation {
                    out.overlay_error_m +=
                        boundary::overlay_error(&out.domain, &candidates[j].domain, &intersected);
                }
                let overlap = active_attachment_overlap(&intersected, source, &candidates[j]);
                if area(&overlap) < EPS {
                    continue;
                }
                let cut = if tied {
                    overlap
                } else {
                    let clipped = half_plane(&overlap, delta);
                    if source.boundary_triangulation {
                        out.overlay_error_m += boundary::half_error(&overlap, delta, &clipped);
                    }
                    clipped
                };
                let next = difference(&out.domain, &cut);
                if source.boundary_triangulation {
                    out.overlay_error_m += boundary::overlay_error(&out.domain, &cut, &next);
                }
                out.domain = next;
                if out.domain.is_empty() {
                    return None;
                }
            }
            Some(out)
        })
        .collect()
}

// A canopy belongs to the space above its own floor. A terrace that forms
// that floor remains a separate physical surface beneath the canopy.
fn active_attachment_overlap(domain: &Surface, a: &Candidate, b: &Candidate) -> Surface {
    let mut domain = domain.clone();
    for (attachment, other) in [(a, b), (b, a)] {
        if attachment.feature_id.is_some() {
            domain = half_plane(
                &domain,
                Plane {
                    c: other.plane.c - attachment.floor_z_m - 0.001,
                    ..other.plane
                },
            );
        }
    }
    domain
}

fn contour_faces(
    raw: &mut Vec<RawFace>,
    source: &Candidate,
    ring: &[Point],
    bottom: f64,
    top: F64Top,
    kind: RoofFaceKind,
) {
    for (a, b) in ring
        .iter()
        .zip(ring.iter().cycle().skip(1))
        .take(ring.len())
    {
        let za = top.height(*a);
        let zb = top.height(*b);
        if (za - bottom).abs() + (zb - bottom).abs() < 0.001 {
            continue;
        }
        let mut source = source.clone();
        source.kind = kind;
        raw.push(RawFace {
            vertices: vec![
                Vertex3 {
                    x: a.x,
                    y: a.y,
                    z: snap(bottom),
                },
                Vertex3 {
                    x: b.x,
                    y: b.y,
                    z: snap(bottom),
                },
                Vertex3 {
                    x: b.x,
                    y: b.y,
                    z: snap(zb),
                },
                Vertex3 {
                    x: a.x,
                    y: a.y,
                    z: snap(za),
                },
            ],
            source,
        });
    }
}
#[derive(Clone, Copy)]
enum F64Top {
    Constant(f64),
}
impl F64Top {
    fn height(self, _p: Point) -> f64 {
        match self {
            Self::Constant(z) => z,
        }
    }
}

fn roof_feature(
    id: String,
    kind: FeatureKind,
    surface: Surface,
    z: f64,
    height: f64,
    material: String,
    vertices3d: Vec<Vertex3>,
) -> Feature {
    Feature {
        id,
        kind,
        surface,
        z_m: snap(z),
        height_m: snap(height),
        material,
        vertices3d,
        roof: None,
    }
}

fn flat_details(
    unit: &HouseUnit,
    body: &RoofSource,
    t: &Candidate,
    domain: &Surface,
    z: f64,
    raw: &mut Vec<RawFace>,
    features: &mut Vec<Feature>,
) {
    let height = body.roof_spec.parapet_height_m;
    let mut counter = 0;
    for polygon in domain {
        for (a, b) in polygon
            .outer
            .iter()
            .zip(polygon.outer.iter().cycle().skip(1))
            .take(polygon.outer.len())
        {
            let pieces = parapets::retained_segments(*a, *b, z, height, &unit.access.portals);
            counter += usize::from(!pieces.is_empty());
            for (a, b) in pieces.into_iter().filter(|_| height > 0.0) {
                let mut source = t.clone();
                source.kind = RoofFaceKind::Parapet;
                source.material = body.level.materials.infill.clone();
                raw.push(RawFace {
                    vertices: vec![
                        Vertex3 { x: a.x, y: a.y, z },
                        Vertex3 { x: b.x, y: b.y, z },
                        Vertex3 {
                            x: b.x,
                            y: b.y,
                            z: z + height,
                        },
                        Vertex3 {
                            x: a.x,
                            y: a.y,
                            z: z + height,
                        },
                    ],
                    source,
                });
            }
        }
    }
    let b = bounds(domain);
    if b.iter().all(|n| n.is_finite()) {
        let position = match body.roof_spec.drainage_side {
            0 => point((b[0] + b[2]) * 0.5, b[1]),
            1 => point(b[2], (b[1] + b[3]) * 0.5),
            2 => point((b[0] + b[2]) * 0.5, b[3]),
            _ => point(b[0], (b[1] + b[3]) * 0.5),
        };
        features.push(roof_feature(
            format!("roof:{}:{}:drain:{counter}", body.id, t.level),
            FeatureKind::RoofDrain,
            g::rectangle(position.x - 0.08, position.y - 0.08, 0.16, 0.16),
            z,
            0.08,
            t.material.clone(),
            vec![],
        ));
    }
}

/// A well remains open through every cover. Its border is a masonry volume,
/// with a real top and both vertical sides, rather than a labelled decoration.
fn add_void_rims(
    unit: &HouseUnit,
    sources: &[RoofSource],
    visible: &[Candidate],
    raw: &mut Vec<RawFace>,
) -> Result<(), String> {
    for source in sources.iter().filter(|s| !s.voids.is_empty()) {
        let body = unit.bodies.iter().find(|b| b.id == source.body_id).unwrap();
        let height = source.roof_spec.parapet_height_m;
        if height <= 0.0 || body.wall_thickness_m <= 0.0 {
            return Err(format!(
                "Vide de toiture sans bordure physique déclarée : {}.",
                source.id
            ));
        }
        for (_, void) in &source.voids {
            let border = difference(&g::offset(void, body.wall_thickness_m), void);
            for candidate in visible.iter().filter(|c| c.group == source.group) {
                let domain = intersection(&border, &candidate.domain);
                let mut top = candidate.clone();
                top.kind = RoofFaceKind::Slab;
                top.material = source.level.materials.infill.clone();
                top.plane.c += height;
                for polygon in g::to_geo(&domain).0 {
                    for tri in polygon.earcut_triangles() {
                        raw.push(RawFace {
                            vertices: tri
                                .to_array()
                                .iter()
                                .map(|p| Vertex3 {
                                    x: p.x,
                                    y: p.y,
                                    z: snap(top.plane.height(Point { x: p.x, y: p.y })),
                                })
                                .collect(),
                            source: top.clone(),
                        });
                    }
                }
                for ring in border
                    .iter()
                    .flat_map(|p| std::iter::once(&p.outer).chain(&p.holes))
                {
                    for (&a, &b) in ring
                        .iter()
                        .zip(ring.iter().cycle().skip(1))
                        .take(ring.len())
                    {
                        for (lo, hi) in corbel::line_intervals(a, b, &candidate.domain) {
                            let vertex = |fraction: f64, dz: f64| {
                                let p = point(
                                    a.x + (b.x - a.x) * fraction,
                                    a.y + (b.y - a.y) * fraction,
                                );
                                Vertex3 {
                                    x: p.x,
                                    y: p.y,
                                    z: snap(candidate.plane.height(p) + dz),
                                }
                            };
                            let mut side = top.clone();
                            side.kind = RoofFaceKind::Parapet;
                            raw.push(RawFace {
                                vertices: vec![
                                    vertex(lo, 0.0),
                                    vertex(hi, 0.0),
                                    vertex(hi, height),
                                    vertex(lo, height),
                                ],
                                source: side,
                            });
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

fn stepped_gables(
    body: &RoofSource,
    t: &Candidate,
    arm: &RoofArm,
    z: f64,
    raw: &mut Vec<RawFace>,
    features: &mut Vec<Feature>,
) {
    let n = body.roof_spec.step_count;
    let half = arm.width_m * 0.5;
    let rise = half * libm::tan(body.roof_pitch_deg * PI / 180.0);
    for (side, x) in [(0, 0.0), (1, arm.length_m)] {
        let mut profile = vec![vertex(arm, x, 0.0, z)];
        for i in 0..2 * n {
            let y0 = arm.width_m * i as f64 / (2 * n) as f64;
            let y1 = arm.width_m * (i + 1) as f64 / (2 * n) as f64;
            let step = if i < n { i + 1 } else { 2 * n - i };
            let top = z + rise * step as f64 / n as f64 + 0.15;
            profile.push(vertex(arm, x, y0, top));
            profile.push(vertex(arm, x, y1, top));
        }
        profile.push(vertex(arm, x, arm.width_m, z));
        let mut source = t.clone();
        source.kind = RoofFaceKind::SteppedGable;
        source.material = body.level.materials.infill.clone();
        for i in 0..2 * n {
            let y0 = arm.width_m * i as f64 / (2 * n) as f64;
            let y1 = arm.width_m * (i + 1) as f64 / (2 * n) as f64;
            let step = if i < n { i + 1 } else { 2 * n - i };
            let top = z + rise * step as f64 / n as f64 + 0.15;
            raw.push(RawFace {
                vertices: vec![
                    vertex(arm, x, y0, z),
                    vertex(arm, x, y1, z),
                    vertex(arm, x, y1, top),
                    vertex(arm, x, y0, top),
                ],
                source: source.clone(),
            });
        }
        features.push(roof_feature(
            format!("roof:{}:{}:redents:{side}", body.id, t.level),
            FeatureKind::SteppedGable,
            local_surface(arm, x - 0.08, 0.0, 0.16, arm.width_m),
            z,
            rise + 0.15,
            source.material.clone(),
            profile,
        ));
    }
}

#[allow(clippy::too_many_arguments)]
fn end_profile<F: Fn(f64) -> f64>(
    body: &RoofSource,
    level: &Level,
    t: &Candidate,
    arm: &RoofArm,
    z: f64,
    n: u32,
    kind: RoofFaceKind,
    raw: &mut Vec<RawFace>,
    features: &mut Vec<Feature>,
    height: F,
) {
    for (side, x) in [(0, 0.0), (1, arm.length_m)] {
        if kind == RoofFaceKind::Tympanum
            && body.roof_spec.vault.as_ref().is_some_and(|v| {
                v.open_ends.contains(if side == 0 {
                    &VaultEnd::Start
                } else {
                    &VaultEnd::End
                })
            })
        {
            continue;
        }
        let mid = local(arm, x, arm.width_m * 0.5);
        let exterior = level.footprint.iter().any(|p| {
            p.outer
                .iter()
                .zip(p.outer.iter().cycle().skip(1))
                .take(p.outer.len())
                .any(|(a, b)| distance_to_segment(mid, *a, *b) <= 0.003)
        });
        if !exterior {
            continue;
        }
        let mut source = t.clone();
        source.kind = kind;
        source.material = level.materials.infill.clone();
        let mut profile = vec![vertex(arm, x, 0.0, z)];
        for i in 0..n {
            let y0 = arm.width_m * i as f64 / n as f64;
            let y1 = arm.width_m * (i + 1) as f64 / n as f64;
            let h0 = height(y0).max(z);
            let h1 = height(y1).max(z);
            if h0.max(h1) > z + 0.002 {
                raw.push(RawFace {
                    vertices: vec![
                        vertex(arm, x, y0, z),
                        vertex(arm, x, y1, z),
                        vertex(arm, x, y1, h1),
                        vertex(arm, x, y0, h0),
                    ],
                    source: source.clone(),
                });
            }
            profile.push(vertex(arm, x, y1, h1));
        }
        let height_m = profile.iter().map(|v| v.z - z).fold(0.0_f64, f64::max);
        features.push(roof_feature(
            format!("roof:{}:{}:end:{}:{side}", body.id, level.index, t.rf),
            if kind == RoofFaceKind::Gable {
                FeatureKind::RoofGable
            } else {
                FeatureKind::RoofTympanum
            },
            local_surface(arm, x - 0.04, 0.0, 0.08, arm.width_m),
            z,
            height_m,
            source.material,
            profile,
        ));
    }
}

fn cut_vertical_openings(unit: &HouseUnit, raw: Vec<RawFace>) -> Vec<RawFace> {
    let mut out = vec![];
    for face in raw {
        if face.source.corbel
            || (face.source.boundary_triangulation
                && matches!(
                    face.source.kind,
                    RoofFaceKind::Pan | RoofFaceKind::Slab | RoofFaceKind::Skirt
                ))
        {
            out.push(face);
            continue;
        }
        let Some(n) = normal(&face.vertices) else {
            continue;
        };
        if n[2].abs() > 1.0e-6 {
            out.push(face);
            continue;
        }
        let origin = &face.vertices[0];
        let Some(endpoint) = face
            .vertices
            .iter()
            .find(|p| (p.x - origin.x).abs() + (p.y - origin.y).abs() > EPS)
        else {
            continue;
        };
        let len = libm::sqrt((endpoint.x - origin.x).powi(2) + (endpoint.y - origin.y).powi(2));
        let axis = [(endpoint.x - origin.x) / len, (endpoint.y - origin.y) / len];
        let horizontal = |p: Point| (p.x - origin.x) * axis[0] + (p.y - origin.y) * axis[1];
        let mut domain = vec![Polygon {
            outer: face
                .vertices
                .iter()
                .map(|v| Point {
                    x: horizontal(Point { x: v.x, y: v.y }),
                    y: v.z,
                })
                .collect(),
            holes: vec![],
        }];
        let mut changed = false;
        for portal in unit
            .access
            .portals
            .iter()
            .filter(|p| matches!(p.kind, PortalKind::Door | PortalKind::Tunnel))
        {
            if let Some(wid) = &portal.wall_id
                && unit
                    .walls
                    .iter()
                    .find(|w| &w.id == wid)
                    .is_some_and(|w| w.body_id.as_ref() != Some(&face.source.body_id))
            {
                continue;
            }
            let near = portal
                .opening
                .iter()
                .all(|p| ((p.x - origin.x) * axis[1] - (p.y - origin.y) * axis[0]).abs() < 0.04);
            if !near {
                continue;
            }
            let a = horizontal(portal.opening[0]);
            let b = horizontal(portal.opening[1]);
            let lintel = portal.head_z_m;
            let cut = g::rectangle(
                a.min(b) - 0.001,
                portal.from_z_m.min(portal.to_z_m) - 0.001,
                (a - b).abs() + 0.002,
                lintel - portal.from_z_m.min(portal.to_z_m) + 0.001,
            );
            if area(&intersection(&domain, &cut)) > EPS {
                domain = difference(&domain, &cut);
                changed = true;
            }
        }
        if !changed {
            out.push(face);
            continue;
        }
        for polygon in g::to_geo(&domain).0 {
            for tri in polygon.earcut_triangles() {
                out.push(RawFace {
                    vertices: tri
                        .to_array()
                        .iter()
                        .map(|p| Vertex3 {
                            x: snap(origin.x + axis[0] * p.x),
                            y: snap(origin.y + axis[1] * p.x),
                            z: snap(p.y),
                        })
                        .collect(),
                    source: face.source.clone(),
                });
            }
        }
    }
    out
}

fn top_covers(
    unit: &HouseUnit,
    body: &RoofSource,
    level: &Level,
    z: f64,
    domain: &Surface,
) -> Surface {
    let mut out = domain.clone();
    for other in &unit.bodies {
        for upper in &other.levels {
            if !(body.nested && other.id == body.body_id)
                && (other.id != body.body_id
                    || body.feature_id.is_some()
                    || upper.index > level.index)
                && upper.z_m + upper.height_m > z + 0.001
            {
                out = difference(&out, &upper.footprint);
            }
        }
    }
    for feature in unit.features.iter().chain(&unit.site_context) {
        if feature.kind == FeatureKind::RockShelter && feature.z_m >= z - 0.001 {
            out = difference(&out, &feature.surface);
        }
        if body.intermediate
            && body.kind != RoofFaceKind::Slab
            && feature.kind == FeatureKind::Gallery
            && feature_floor_z(feature) >= z - 0.001
        {
            out = difference(&out, &feature.surface);
        }
    }
    for portal in &unit.access.portals {
        if portal.kind == PortalKind::Hatch && (portal.to_z_m - z).abs() <= 0.001 {
            out = difference(&out, &portal.opening_surface);
        }
    }
    out
}

fn arms_for(body: &RoofSource, level: &Level) -> Result<Vec<RoofArm>, String> {
    if !body.roof_arms.is_empty() {
        return Ok(body.roof_arms.clone());
    }
    if ["RF-FLAT", "RF-STEP"].contains(&body.roof_system.as_str()) {
        return Ok(vec![]);
    }
    Err(format!(
        "Le corps {} nécessite un repère de bras explicite pour {} (niveau {}).",
        body.id, body.roof_system, level.index
    ))
}

fn validate_vault_supports(
    unit: &HouseUnit,
    source: &RoofSource,
    arm: &RoofArm,
    z: f64,
) -> Result<(), String> {
    let Some(vault) = &source.roof_spec.vault else {
        return Ok(());
    };
    let thickness = vault.bearing_ratio * arm.width_m;
    let band = union(
        &local_surface(arm, 0.0, 0.0, arm.length_m, thickness),
        &local_surface(arm, 0.0, arm.width_m - thickness, arm.length_m, thickness),
    );
    let band = intersection(&band, &arm.domain);
    let bottom = z - thickness;
    let catalogue = crate::catalogue::catalogue()?;
    let walls: Vec<_> = unit
        .walls
        .iter()
        .filter(|w| {
            w.body_id.as_ref() == Some(&source.body_id)
                && w.level == source.level.index
                && matches!(
                    w.kind,
                    WallKind::Exterior | WallKind::Interior | WallKind::Party | WallKind::Shell
                )
                && !w.shell_reference
                && catalogue.material_has(&w.material, &["load_bearing"])
                && w.z_m < z + 0.001
                && w.z_m + w.height_m > bottom - 0.001
        })
        .collect();
    let mut heights = vec![bottom, z];
    for wall in &walls {
        heights.extend([
            wall.z_m.clamp(bottom, z),
            (wall.z_m + wall.height_m).clamp(bottom, z),
        ]);
    }
    heights.sort_by(f64::total_cmp);
    heights.dedup();
    for interval in heights.windows(2).filter(|h| h[1] - h[0] > 0.001) {
        let height = (interval[0] + interval[1]) * 0.5;
        let polygons: Vec<_> = walls
            .iter()
            .filter(|w| w.z_m <= height && w.z_m + w.height_m >= height)
            .flat_map(|w| g::to_geo(&crate::wall_geometry::wall_section(w, height)).0)
            .collect();
        let solid = g::from_geo(&geo::algorithm::bool_ops::unary_union(&polygons));
        if area(&difference(&band, &solid)) > g::area_tolerance(&band) {
            return Err(format!(
                "Retombées de voûte sans masse d'appui continue : {} ; épaisseur/hauteur requises {:.3}m.",
                source.id, thickness
            ));
        }
    }
    if area(&band) <= EPS || walls.is_empty() {
        return Err(format!(
            "Murs de retombée de voûte absents : {}.",
            source.id
        ));
    }
    Ok(())
}

fn validate_attachment_faces(unit: &HouseUnit, candidates: &[Candidate]) -> Result<(), String> {
    if !candidates.iter().any(|c| c.feature_id.is_some()) {
        return Ok(());
    }
    let existing: Vec<_> = candidates
        .iter()
        .filter(|c| c.feature_id.is_none())
        .cloned()
        .collect();
    let existing = upper_envelope(&existing);
    for source in candidates.iter().filter(|c| c.feature_id.is_some()) {
        let feature_id = source.feature_id.as_ref().unwrap();
        let feature = unit.features.iter().find(|f| &f.id == feature_id).unwrap();
        let passage = intersection(&source.domain, &feature.surface);
        let floor_z = feature_floor_z(feature);
        if !source.nested
            && passage
                .iter()
                .flat_map(|p| p.outer.iter().chain(p.holes.iter().flatten()))
                .any(|&p| source.plane.height(p) < floor_z + 2.0 - 0.001)
        {
            return Err(format!(
                "Hauteur libre de couverture inférieure à 2 m : {feature_id}."
            ));
        }
        if source.nested {
            let mut uncovered = source.domain.clone();
            for parent in existing.iter().filter(|c| c.body_id == source.body_id) {
                let delta = parent.plane.minus(source.plane);
                let covered = half_plane(
                    &intersection(&source.domain, &parent.domain),
                    Plane {
                        c: delta.c - 0.001,
                        ..delta
                    },
                );
                uncovered = difference(&uncovered, &covered);
            }
            if physical_overlap(&uncovered) {
                let witness = uncovered[0].outer[0];
                return Err(format!(
                    "Toile intérieure hors de sa couverture parent : {feature_id} ({:.8} m², xy {:.6},{:.6}, z {:.6}).",
                    area(&uncovered),
                    witness.x,
                    witness.y,
                    source.plane.height(witness)
                ));
            }
        }
        for other in &existing {
            if !overlaps(bounds(&source.domain), bounds(&other.domain)) {
                continue;
            }
            let overlap = active_attachment_overlap(
                &intersection(&source.domain, &other.domain),
                source,
                other,
            );
            let delta = source.plane.minus(other.plane);
            if delta.a.abs() + delta.b.abs() < EPS && delta.c <= 0.001 {
                continue;
            }
            let above = half_plane(
                &overlap,
                Plane {
                    c: delta.c - 0.001,
                    ..delta
                },
            );
            if physical_overlap(&above) {
                let witness = above
                    .iter()
                    .flat_map(|p| &p.outer)
                    .max_by(|a, b| delta.height(**a).total_cmp(&delta.height(**b)))
                    .unwrap();
                return Err(format!(
                    "Couverture {feature_id} au-dessus d'un toit existant : {} {} à ({:.9}, {:.9}) : galerie {:.3} m, toit {:.3} m ; aire {:.12} m².",
                    other.group,
                    other.rf,
                    witness.x,
                    witness.y,
                    source.plane.height(*witness),
                    other.plane.height(*witness),
                    area(&above)
                ));
            }
        }
    }
    Ok(())
}

fn make_roofs(unit: &HouseUnit) -> Result<(RoofMesh, Vec<Feature>, Vec<String>), String> {
    valid_surface(&unit.lot)?;
    valid_surface(&unit.partition.courtyards)?;
    for portal in &unit.access.portals {
        if matches!(portal.kind, PortalKind::Door | PortalKind::Tunnel) {
            if !portal.head_z_m.is_finite()
                || !portal.from_z_m.is_finite()
                || !portal.to_z_m.is_finite()
                || portal.head_z_m <= portal.from_z_m.max(portal.to_z_m)
            {
                return Err(format!("Hauteur de passage invalide : {}.", portal.id));
            }
            valid_surface(&portal.opening_surface)?;
            valid_surface(&portal.passage)?;
        }
    }
    let mut candidates = vec![];
    let mut raw = vec![];
    let mut features = vec![];
    let mut corbel_groups = BTreeMap::new();
    let sources = roof_sources(unit)?;
    for source in &sources {
        validate_spec(source)?;
    }
    for body in &sources {
        let level = &body.level;
        if !level.z_m.is_finite()
            || !level.height_m.is_finite()
            || level.height_m <= 0.0
            || area(&level.footprint) <= EPS
        {
            return Err(format!(
                "Niveau de toiture invalide : {}:{}.",
                body.id, level.index
            ));
        }
        let z = body.support_z_m;
        let mut domain = top_covers(unit, body, level, z, &roof_domain(unit, body, level));
        if domain.is_empty() {
            continue;
        }
        if body.envelope == Envelope::Rockcut
            && unit.features.iter().chain(&unit.site_context).any(|f| {
                f.kind == FeatureKind::RockShelter
                    && area(&difference(&domain, &f.surface)) <= g::area_tolerance(&domain)
            })
        {
            continue;
        }
        let rf = body.roof_system.as_str();
        let mut t = template(
            body,
            level,
            z,
            rf,
            body.group.clone(),
            body.layer.clone(),
            body.kind,
        );
        if body.boundary_triangulation {
            t.material_contours = material_contours(unit, body);
            if [
                "RF-FLAT",
                "RF-STEP",
                "RF-SHED",
                "RF-GABLE",
                "RF-HIP",
                "RF-EAVES",
                "RF-REED-HIP",
            ]
            .contains(&rf)
            {
                t.native_domain = Some(native_domain(unit, body));
            }
        }
        let s = &body.roof_spec;
        let arms = arms_for(body, level)?;
        if let Some(corbel_spec) = &s.corbel {
            corbel::build(unit, body, &t, &domain, &mut raw, &mut corbel_groups)?;
            if corbel_spec.profile == CorbelProfile::Dome {
                continue;
            }
        }
        if s.shell
            .as_ref()
            .is_some_and(|shell| shell.profile == ShellProfile::Ogival)
        {
            ogival::build(unit, body, &t, &domain, &mut raw, &mut corbel_groups)?;
            continue;
        }
        if rf == "RF-FLAT" || rf == "RF-STEP" {
            if let Some(slab) = &level.roof_slab {
                if !slab.z_m.is_finite() || (slab.z_m - z).abs() > 0.001 {
                    return Err(format!(
                        "Cote de dalle de toiture incohérente : {}:{} ({} ≠ {z}).",
                        body.id, level.index, slab.z_m
                    ));
                }
                domain = intersection(&domain, &slab.surface);
                if let Some(native) = &mut t.native_domain {
                    Rc::make_mut(native).slab = Some(slab.surface.clone());
                }
            }
            let terrace_id = format!("terrace:{}:{}", body.id, level.index);
            for terrace in unit
                .features
                .iter()
                .filter(|f| f.kind == FeatureKind::Terrace && f.id == terrace_id)
            {
                if area(&intersection(&domain, &terrace.surface)) > EPS
                    && (terrace.z_m - z).abs() > 0.001
                {
                    return Err(format!(
                        "Cote de terrasse incohérente : {} ({} ≠ {z}).",
                        terrace.id, terrace.z_m
                    ));
                }
            }
            add_plan(
                &mut candidates,
                &t,
                domain.clone(),
                Plane {
                    a: 0.0,
                    b: 0.0,
                    c: z,
                },
            );
            if body.feature_id.is_none() {
                flat_details(unit, body, &t, &domain, z, &mut raw, &mut features);
            }
            continue;
        }
        if !body.intermediate && s.drainage == Some(RoofDrainage::Inward) {
            inward_roof(unit, body, &t, &domain, &mut candidates)?;
            continue;
        }
        for (ai, original) in arms.iter().enumerate() {
            let mut t = t.clone();
            if let Some(native) = &mut t.native_domain {
                Rc::make_mut(native).arm_recipe = body
                    .feature_id
                    .is_none()
                    .then(|| offset_recipes(unit, body, &original.domain));
                Rc::make_mut(native).arm = Some(if body.feature_id.is_some() {
                    original.domain.clone()
                } else {
                    original
                        .domain
                        .iter()
                        .map(|p| Polygon {
                            outer: offset_ring(unit, body, &p.outer, false),
                            holes: p
                                .holes
                                .iter()
                                .map(|r| offset_ring(unit, body, r, true))
                                .collect(),
                        })
                        .collect()
                });
            }
            let arm = if s.axis == RoofAxis::Transverse {
                RoofArm {
                    source_component: None,
                    origin: local(original, original.length_m, 0.0),
                    axis: [-original.axis[1], original.axis[0]],
                    length_m: original.width_m,
                    width_m: original.length_m,
                    domain: original.domain.clone(),
                }
            } else {
                original.clone()
            };
            // The supplied arm is prolonged at joints; overhang only expands its finite domain.
            let mut extended = arm.clone();
            extended.domain = if body.feature_id.is_some() {
                if original.source_component.is_some() {
                    crate::gallery_components::portion(
                        body.declared_domain
                            .as_ref()
                            .ok_or("Attachment indexée sans domaine déclaré.")?,
                        original,
                        &domain,
                    )?
                } else {
                    intersection(&domain, &arm.domain)
                }
            } else {
                roof_domain(
                    unit,
                    body,
                    &Level {
                        footprint: arm.domain.clone(),
                        ..level.clone()
                    },
                )
            };
            let d = intersection(&domain, &extended.domain);
            if original.source_component.is_some() {
                let component = crate::gallery_components::selected(
                    body.declared_domain
                        .as_ref()
                        .ok_or("Attachment indexée sans domaine déclaré.")?,
                    original,
                )?;
                if area(&difference(&d, &component)) > g::area_tolerance(&component) {
                    return Err("Pan legacy dans une composante sœur.".into());
                }
            }
            if d.is_empty() {
                continue;
            }
            let p = libm::tan(body.roof_pitch_deg * PI / 180.0);
            match rf {
                "RF-GABLE" | "RF-HIP" | "RF-EAVES" | "RF-REED-HIP" | "RF-STEEP-STEP" => {
                    pitched_arm(
                        &mut candidates,
                        &t,
                        &extended,
                        &d,
                        z,
                        body.roof_pitch_deg,
                        !["RF-GABLE", "RF-STEEP-STEP"].contains(&rf),
                    );
                    if rf == "RF-STEEP-STEP" {
                        stepped_gables(body, &t, &arm, z, &mut raw, &mut features);
                    }
                    if rf == "RF-GABLE" {
                        end_profile(
                            body,
                            level,
                            &t,
                            &arm,
                            z,
                            2,
                            RoofFaceKind::Gable,
                            &mut raw,
                            &mut features,
                            |y| z + p * y.min(arm.width_m - y),
                        );
                    }
                }
                "RF-SHED" => {
                    let plane = affine(&arm, 0.0, -p, z + p * arm.width_m);
                    let side = [
                        local(&arm, 0.0, arm.width_m),
                        local(&arm, arm.length_m, arm.width_m),
                    ];
                    let mut t = t.clone();
                    t.native_anchor = native_anchor(&t, plane, side, z);
                    add_plan(&mut candidates, &t, d.clone(), plane);
                }
                "RF-CONE" | "RF-TENT" | "RF-DOME" | "RF-SNOW" | "RF-DOME-CONE" => {
                    let drum = if rf == "RF-DOME-CONE" {
                        s.drum_height_m
                    } else {
                        0.0
                    };
                    round_roof(
                        &mut candidates,
                        &t,
                        &d,
                        &arm,
                        z + drum,
                        s,
                        rf,
                        body.roof_pitch_deg,
                    );
                    if drum > 0.0 {
                        let mut drum_source = t.clone();
                        drum_source.material = level.materials.infill.clone();
                        for polygon in &d {
                            contour_faces(
                                &mut raw,
                                &drum_source,
                                &polygon.outer,
                                z,
                                F64Top::Constant(z + drum),
                                RoofFaceKind::Drum,
                            );
                        }
                        features.push(roof_feature(
                            format!("roof:{}:{}:drum:{ai}", body.id, level.index),
                            FeatureKind::RoofDrum,
                            d.clone(),
                            z,
                            drum,
                            level.materials.infill.clone(),
                            vec![],
                        ));
                    }
                    if rf != "RF-TENT" && s.oculus_ratio > 0.0 {
                        let rx = arm.length_m * 0.5;
                        let ry = arm.width_m * 0.5;
                        let irx = rx * s.oculus_ratio;
                        let iry = ry * s.oculus_ratio;
                        let outer = arm_ellipse(&arm, irx + 0.06, iry + 0.06, s.round_segments);
                        let inner = arm_ellipse(
                            &arm,
                            (irx - 0.06).max(0.02),
                            (iry - 0.06).max(0.02),
                            s.round_segments,
                        );
                        let cz = z
                            + drum
                            + rx.min(ry)
                                * s.dome_rise_ratio
                                * libm::sqrt(1.0 - s.oculus_ratio * s.oculus_ratio);
                        let ring = difference(&outer, &inner);
                        let vertices3d = outer[0]
                            .outer
                            .iter()
                            .map(|p| Vertex3 {
                                x: p.x,
                                y: p.y,
                                z: snap(cz),
                            })
                            .collect();
                        features.push(roof_feature(
                            format!("roof:{}:{}:crown:{ai}", body.id, level.index),
                            FeatureKind::TentCrown,
                            ring,
                            cz,
                            0.12,
                            level.materials.roof_frame.clone(),
                            vertices3d,
                        ));
                    }
                    if rf == "RF-TENT" {
                        let outer = arm_ellipse(
                            &arm,
                            arm.length_m * 0.5 * s.tent_crown_ratio + 0.05,
                            arm.width_m * 0.5 * s.tent_crown_ratio + 0.05,
                            s.round_segments,
                        );
                        let inner = arm_ellipse(
                            &arm,
                            (arm.length_m * 0.5 * s.tent_crown_ratio - 0.05).max(0.02),
                            (arm.width_m * 0.5 * s.tent_crown_ratio - 0.05).max(0.02),
                            s.round_segments,
                        );
                        let crown = difference(&outer, &inner);
                        features.push(roof_feature(
                            format!("roof:{}:{}:crown:{ai}", body.id, level.index),
                            FeatureKind::TentCrown,
                            crown,
                            z + arm.width_m.min(arm.length_m)
                                * 0.5
                                * p
                                * (1.0 - s.tent_crown_ratio),
                            0.12,
                            level.materials.roof_frame.clone(),
                            vec![],
                        ));
                    }
                }
                "RF-THATCH-VAULT" | "RF-VAULT" => {
                    validate_vault_supports(unit, body, &arm, z)?;
                    let rise = arm.width_m * 0.5 * s.dome_rise_ratio;
                    curved_grid(
                        &mut candidates,
                        &t,
                        &arm,
                        &d,
                        1,
                        s.curve_sections,
                        |_, y| {
                            z + rise
                                * libm::sqrt((1.0 - (2.0 * y / arm.width_m - 1.0).powi(2)).max(0.0))
                        },
                    );
                    end_profile(
                        body,
                        level,
                        &t,
                        &arm,
                        z,
                        s.curve_sections,
                        RoofFaceKind::Tympanum,
                        &mut raw,
                        &mut features,
                        |y| {
                            z + rise
                                * libm::sqrt((1.0 - (2.0 * y / arm.width_m - 1.0).powi(2)).max(0.0))
                        },
                    );
                }
                "RF-CROSSVAULT" => {
                    let rise = arm.width_m.min(arm.length_m) * 0.5 * s.dome_rise_ratio;
                    curved_grid(
                        &mut candidates,
                        &t,
                        &arm,
                        &d,
                        1,
                        s.curve_sections,
                        |_, y| {
                            z + rise
                                * libm::sqrt((1.0 - (2.0 * y / arm.width_m - 1.0).powi(2)).max(0.0))
                        },
                    );
                    curved_grid(
                        &mut candidates,
                        &t,
                        &arm,
                        &d,
                        s.curve_sections,
                        1,
                        |x, _| {
                            z + rise
                                * libm::sqrt(
                                    (1.0 - (2.0 * x / arm.length_m - 1.0).powi(2)).max(0.0),
                                )
                        },
                    );
                }
                "RF-GAMBREL" => {
                    let h = arm.width_m * 0.5;
                    let split = h * (1.0 - s.gambrel_break_ratio);
                    let steep = libm::tan(s.gambrel_lower_pitch_deg * PI / 180.0);
                    for (lo, hi, sign) in [
                        (0.0, split, 1.0),
                        (split, h, 1.0),
                        (h, arm.width_m - split, -1.0),
                        (arm.width_m - split, arm.width_m, -1.0),
                    ] {
                        let slope = if lo == 0.0 || hi == arm.width_m {
                            steep
                        } else {
                            p
                        };
                        let c = if sign > 0.0 {
                            if lo == 0.0 {
                                z
                            } else {
                                z + steep * split - p * split
                            }
                        } else if hi == arm.width_m {
                            z + steep * arm.width_m
                        } else {
                            z + steep * split + p * (arm.width_m - split)
                        };
                        let clip_lo = if lo == 0.0 { -body.overhang_m } else { lo };
                        let clip_hi = if hi == arm.width_m {
                            hi + body.overhang_m
                        } else {
                            hi
                        };
                        add_plan(
                            &mut candidates,
                            &t,
                            intersection(
                                &d,
                                &local_surface(
                                    &arm,
                                    -body.overhang_m,
                                    clip_lo,
                                    arm.length_m + 2.0 * body.overhang_m,
                                    clip_hi - clip_lo,
                                ),
                            ),
                            affine(&arm, 0.0, sign * slope, c),
                        );
                    }
                }
                "RF-CURVED" => {
                    signatures::curved(&mut candidates, &t, &arm, &d, z, p, s);
                }
                "RF-SADDLE" => {
                    if s.horns.is_some() {
                        signatures::horns(
                            unit,
                            body,
                            &t,
                            &arm,
                            &d,
                            z,
                            &mut candidates,
                            &mut raw,
                            &mut features,
                        )?;
                        continue;
                    }
                    curved_grid(
                        &mut candidates,
                        &t,
                        &arm,
                        &d,
                        s.curve_sections,
                        2,
                        |x, y| {
                            z + p * y.min(arm.width_m - y)
                                + s.saddle_rise_ratio
                                    * arm.length_m
                                    * (2.0 * x / arm.length_m - 1.0).powi(2)
                        },
                    );
                }
                "RF-SHELL" => {
                    curved_grid(
                        &mut candidates,
                        &t,
                        &arm,
                        &d,
                        s.shell_sections,
                        s.curve_sections,
                        |x, y| {
                            let arch = libm::sin(PI * y / arm.width_m).max(0.0);
                            z + arm.width_m * s.shell_cross_rise_ratio * arch
                                + arm.length_m
                                    * s.shell_long_rise_ratio
                                    * libm::sin(PI * x / arm.length_m)
                                    * arch
                        },
                    );
                    end_profile(
                        body,
                        level,
                        &t,
                        &arm,
                        z,
                        s.curve_sections,
                        RoofFaceKind::Tympanum,
                        &mut raw,
                        &mut features,
                        |y| {
                            z + arm.width_m
                                * s.shell_cross_rise_ratio
                                * libm::sin(PI * y / arm.width_m).max(0.0)
                        },
                    );
                    for i in 0..=s.shell_sections {
                        let x = arm.length_m * i as f64 / s.shell_sections as f64;
                        let arc: Vec<_> = (0..=s.curve_sections)
                            .map(|j| {
                                let y = arm.width_m * j as f64 / s.curve_sections as f64;
                                let a = libm::sin(PI * y / arm.width_m).max(0.0);
                                vertex(
                                    &arm,
                                    x,
                                    y,
                                    z + arm.width_m * s.shell_cross_rise_ratio * a
                                        + arm.length_m
                                            * s.shell_long_rise_ratio
                                            * libm::sin(PI * x / arm.length_m)
                                            * a,
                                )
                            })
                            .collect();
                        features.push(roof_feature(
                            format!("roof:{}:{}:arc:{ai}:{i}", body.id, level.index),
                            FeatureKind::RoofArc,
                            local_surface(&arm, x - 0.04, 0.0, 0.08, arm.width_m),
                            z,
                            arm.width_m * s.shell_cross_rise_ratio,
                            level.materials.roof_frame.clone(),
                            arc,
                        ));
                    }
                }
                "RF-TIERED" => {
                    let mut previous: Option<(RoofArm, f64)> = None;
                    for tier in 0..s.tiers {
                        let inset = s.tier_inset_ratio * tier as f64;
                        if inset >= 0.49 {
                            return Err(
                                "Retraits des pavillons RF-TIERED ferment le dernier toit.".into(),
                            );
                        }
                        let current = shifted_arm(&arm, inset);
                        let mut tz = z;
                        let mut tt = t.clone();
                        tt.group = format!("{}:tier:{tier}", t.group);
                        tt.layer = if body.feature_id.is_some() {
                            "main".into()
                        } else {
                            tt.group.clone()
                        };
                        tt.kind = RoofFaceKind::Skirt;
                        if let Some((support, previous_z)) = &previous {
                            let profile = hip_boundary_profile(&current, support, *previous_z, p);
                            tz = snap(
                                profile.iter().map(|(_, z)| *z).fold(z, f64::max) + s.tier_rise_m,
                            );
                            let mut source = tt.clone();
                            source.kind = RoofFaceKind::Drum;
                            source.material = level.materials.roof_frame.clone();
                            for ((a, za), (b, zb)) in profile
                                .iter()
                                .zip(profile.iter().cycle().skip(1))
                                .take(profile.len())
                            {
                                raw.push(RawFace {
                                    vertices: vec![
                                        Vertex3 {
                                            x: a.x,
                                            y: a.y,
                                            z: snap(*za),
                                        },
                                        Vertex3 {
                                            x: b.x,
                                            y: b.y,
                                            z: snap(*zb),
                                        },
                                        Vertex3 {
                                            x: b.x,
                                            y: b.y,
                                            z: tz,
                                        },
                                        Vertex3 {
                                            x: a.x,
                                            y: a.y,
                                            z: tz,
                                        },
                                    ],
                                    source: source.clone(),
                                });
                            }
                        }
                        let mut current_extended = current.clone();
                        current_extended.domain = roof_domain(
                            unit,
                            body,
                            &Level {
                                footprint: current.domain.clone(),
                                ..level.clone()
                            },
                        );
                        let mut td = intersection(&d, &current_extended.domain);
                        if tier + 1 < s.tiers {
                            td = difference(
                                &td,
                                &shifted_arm(&arm, s.tier_inset_ratio * (tier + 1) as f64).domain,
                            );
                        }
                        pitched_arm(
                            &mut candidates,
                            &tt,
                            &current_extended,
                            &td,
                            tz,
                            body.roof_pitch_deg,
                            true,
                        );
                        previous = Some((current.clone(), tz));
                        features.push(roof_feature(
                            format!("roof:{}:{}:pavilion:{ai}:{tier}", body.id, level.index),
                            FeatureKind::RoofPavilion,
                            current.domain,
                            tz,
                            s.tier_rise_m,
                            level.materials.roof_frame.clone(),
                            vec![],
                        ));
                    }
                }
                "RF-MULTIPAV" => {
                    let mut pavs = vec![shifted_arm(&arm, 0.16)];
                    for side in 0..2 {
                        let mut pav = RoofArm {
                            source_component: None,
                            origin: local(
                                &arm,
                                arm.length_m * (0.25 + side as f64 * 0.3),
                                arm.width_m * 0.25,
                            ),
                            axis: [-arm.axis[1], arm.axis[0]],
                            length_m: arm.width_m * 0.65,
                            width_m: arm.length_m * 0.3,
                            domain: vec![],
                        };
                        pav.domain = local_surface(&pav, 0.0, 0.0, pav.length_m, pav.width_m);
                        pavs.push(pav);
                    }
                    // The three finite pavilions cover a compound domain, whose gaps retain a base hip.
                    pitched_arm(
                        &mut candidates,
                        &t,
                        &extended,
                        &d,
                        z,
                        body.roof_pitch_deg,
                        true,
                    );
                    for (pi, pav) in pavs.iter().enumerate() {
                        pitched_arm(
                            &mut candidates,
                            &t,
                            pav,
                            &d,
                            z + 0.35,
                            body.roof_pitch_deg,
                            true,
                        );
                        features.push(roof_feature(
                            format!("roof:{}:{}:multipav:{ai}:{pi}", body.id, level.index),
                            FeatureKind::RoofPavilion,
                            intersection(&pav.domain, &d),
                            z,
                            0.35,
                            level.materials.roof_frame.clone(),
                            vec![],
                        ));
                    }
                }
                _ => return Err(format!("Opérateur toiture manquant : {rf}.")),
            }
        }
    }
    let mut cover_references = corbel::cover_references(&raw);
    cover_references.extend(ogival::cover_references(&raw));
    corbel::validate_collisions(&cover_references, &candidates)?;
    let mut attachment_references = candidates.clone();
    attachment_references.extend(cover_references);
    validate_attachment_faces(unit, &attachment_references)?;
    if candidates.iter().any(|c| c.boundary_triangulation) {
        let peers = Rc::new(candidates.clone());
        let registry = Rc::new(
            candidates
                .iter()
                .map(|c| CreatedPlane {
                    group: c.group.clone(),
                    id: c.plan_id,
                    plane: c.plane,
                    layer: c.layer.clone(),
                    floor_z_m: c.floor_z_m,
                })
                .collect(),
        );
        for candidate in &mut candidates {
            if candidate.boundary_triangulation {
                candidate.creation_planes = Rc::clone(&registry);
                candidate.native_peers = Rc::clone(&peers);
            }
        }
    }
    let native: Vec<_> = candidates
        .iter()
        .filter(|c| c.native_domain.is_some())
        .cloned()
        .collect();
    let ordinary: Vec<_> = candidates
        .iter()
        .filter(|c| c.native_domain.is_none())
        .cloned()
        .collect();
    let (native_visible, native_groups, native_notes) = boundary::native_candidates(&native)?;
    let mut visible = upper_envelope(&ordinary);
    visible.extend(native_visible);
    for candidate in &mut visible {
        if !matches!(candidate.envelope, Envelope::Shell | Envelope::Membrane) {
            continue;
        }
        for portal in unit
            .access
            .portals
            .iter()
            .filter(|p| matches!(p.kind, PortalKind::Door | PortalKind::Tunnel))
        {
            if candidate.nested
                && !candidate
                    .feature_id
                    .as_ref()
                    .is_some_and(|id| portal.feature_ids.contains(id))
            {
                continue;
            }
            if let Some(wall_id) = &portal.wall_id
                && unit
                    .walls
                    .iter()
                    .find(|w| &w.id == wall_id)
                    .is_some_and(|w| w.body_id.as_ref() != Some(&candidate.body_id))
            {
                continue;
            }
            let opening = union(&portal.opening_surface, &portal.passage);
            let overlap = intersection(&candidate.domain, &opening);
            if overlap.is_empty() {
                continue;
            }
            let lintel = portal.head_z_m;
            let below = half_plane(
                &overlap,
                Plane {
                    a: -candidate.plane.a,
                    b: -candidate.plane.b,
                    c: lintel - candidate.plane.c,
                },
            );
            candidate.domain = difference(&candidate.domain, &below);
        }
    }
    visible.retain(|c| !c.domain.is_empty());
    let mut groups: BTreeMap<String, RoofGroup> = BTreeMap::new();
    let mut group_polygons: BTreeMap<String, Vec<geo::Polygon<f64>>> = BTreeMap::new();
    for candidate in &visible {
        groups
            .entry(candidate.group.clone())
            .or_insert_with(|| RoofGroup {
                id: candidate.group.clone(),
                rf: candidate.rf.clone(),
                body_id: candidate.body_id.clone(),
                feature_id: candidate.feature_id.clone(),
                room_id: None,
                level: candidate.level,
                domain: vec![],
            });
        // One overlay retains the original shared boundaries. Repeated unions
        // re-quantize each result and can grow nanometre slivers into invalid
        // hole traversals in the OGC extractor.
        if candidate.native_domain.is_none() {
            group_polygons
                .entry(candidate.group.clone())
                .or_default()
                .extend(g::to_geo(&candidate.domain).0);
        }
        if candidate.boundary_triangulation {
            for polygon in &candidate.domain {
                let mut source = candidate.clone();
                source.domain = vec![polygon.clone()];
                source.whole_boundary = true;
                raw.push(RawFace {
                    vertices: polygon
                        .outer
                        .iter()
                        .map(|p| Vertex3 {
                            x: p.x,
                            y: p.y,
                            z: candidate.plane.height(*p),
                        })
                        .collect(),
                    source,
                });
            }
            continue;
        }
        for polygon in g::to_geo(&candidate.domain).0 {
            for triangle in polygon.earcut_triangles() {
                let vertices = triangle
                    .to_array()
                    .iter()
                    .map(|p| Vertex3 {
                        x: p.x,
                        y: p.y,
                        z: snap(candidate.plane.height(Point { x: p.x, y: p.y })),
                    })
                    .collect();
                raw.push(RawFace {
                    vertices,
                    source: candidate.clone(),
                });
            }
        }
    }
    for (id, polygons) in group_polygons {
        groups.get_mut(&id).unwrap().domain =
            g::from_geo(&geo::algorithm::bool_ops::unary_union(&polygons));
    }
    for (id, domain) in native_groups {
        groups
            .get_mut(&id)
            .ok_or_else(|| format!("Groupe Boundary natif sans face : {id}."))?
            .domain = domain;
    }
    add_void_rims(unit, &sources, &visible, &mut raw)?;
    let corbel_ids: BTreeSet<_> = corbel_groups.keys().cloned().collect();
    groups.extend(corbel_groups);
    let (mut mesh, mut source_planes, mut precision_notes) =
        assemble_mesh(cut_vertical_openings(unit, raw))?;
    precision_notes.extend(native_notes);
    mesh.groups = groups.into_values().collect();
    add_step_walls(unit, &mut mesh, &corbel_ids)?;
    source_planes.resize(mesh.faces.len(), None);
    mesh.edges = mesh_edges(unit, &mesh, &source_planes);
    if mesh.faces.len() > MAX_ROOF_FACES {
        return Err(format!(
            "Budget toitures dépassé : {} faces, maximum {MAX_ROOF_FACES}.",
            mesh.faces.len()
        ));
    }
    Ok((mesh, features, precision_notes))
}

fn vertex_key(v: &Vertex3) -> (i64, i64, i64) {
    (
        libm::round(v.x * 1_000_000.0) as i64,
        libm::round(v.y * 1_000_000.0) as i64,
        libm::round(v.z * 1000.0) as i64,
    )
}
fn normal(v: &[Vertex3]) -> Option<[f64; 3]> {
    if v.len() < 3 {
        return None;
    }
    let a = &v[0];
    for i in 1..v.len() - 1 {
        let b = &v[i];
        let c = &v[i + 1];
        let u = [b.x - a.x, b.y - a.y, b.z - a.z];
        let w = [c.x - a.x, c.y - a.y, c.z - a.z];
        let n = [
            u[1] * w[2] - u[2] * w[1],
            u[2] * w[0] - u[0] * w[2],
            u[0] * w[1] - u[1] * w[0],
        ];
        let len = libm::sqrt(n.iter().map(|x| x * x).sum());
        if len > EPS {
            return Some([n[0] / len, n[1] / len, n[2] / len]);
        }
    }
    None
}
fn on_segment(v: &Vertex3, a: &Vertex3, b: &Vertex3) -> Option<f64> {
    let d = [b.x - a.x, b.y - a.y, b.z - a.z];
    let den = d.iter().map(|x| x * x).sum::<f64>();
    if den < EPS {
        return None;
    }
    let t = ((v.x - a.x) * d[0] + (v.y - a.y) * d[1] + (v.z - a.z) * d[2]) / den;
    if !(EPS..1.0 - EPS).contains(&t) {
        return None;
    }
    let dist = (v.x - a.x - t * d[0]).powi(2)
        + (v.y - a.y - t * d[1]).powi(2)
        + (v.z - a.z - t * d[2]).powi(2);
    let xy_den = d[0] * d[0] + d[1] * d[1];
    let xy_t = if xy_den > EPS {
        ((v.x - a.x) * d[0] + (v.y - a.y) * d[1]) / xy_den
    } else {
        t
    };
    let xy_dist = (v.x - a.x - xy_t * d[0]).powi(2) + (v.y - a.y - xy_t * d[1]).powi(2);
    if dist < 0.000_001_01 && xy_dist < 0.000_000_000_004 {
        Some(t)
    } else {
        None
    }
}
/// Ear clipping retains every boundary subdivision. A collinear point on a
/// proposed diagonal blocks that ear, so adjoining faces share all T vertices.
type RoofAssembly = (RoofMesh, Vec<Option<Plane>>, Vec<String>);

fn assemble_mesh(raw: Vec<RawFace>) -> Result<RoofAssembly, String> {
    if raw.iter().any(|face| face.source.boundary_triangulation) {
        boundary::build(raw)
    } else {
        assemble_mesh_legacy(raw).map(|(mesh, planes)| (mesh, planes, vec![]))
    }
}

fn assemble_mesh_legacy(mut raw: Vec<RawFace>) -> Result<(RoofMesh, Vec<Option<Plane>>), String> {
    let mut source_planes = vec![];
    let mut mesh = RoofMesh::default();
    let mut index = BTreeMap::new();
    // Quantization can move equal affine intersections to adjacent z ticks.
    // Weld only within the stated millimetric tolerance, retaining true steps.
    let mut heights: BTreeMap<(i64, i64), Vec<i64>> = BTreeMap::new();
    for face in &raw {
        for v in &face.vertices {
            let (x, y, z) = vertex_key(v);
            heights.entry((x, y)).or_default().push(z);
        }
    }
    for values in heights.values_mut() {
        values.sort_unstable();
        values.dedup();
        let mut anchors = vec![];
        for &z in values.iter() {
            if anchors.last().is_none_or(|&last| z - last > 1) {
                anchors.push(z);
            }
        }
        *values = anchors;
    }
    for face in &mut raw {
        for v in &mut face.vertices {
            let (x, y, z) = vertex_key(v);
            let values = &heights[&(x, y)];
            let anchor = values
                .iter()
                .copied()
                .find(|&other| z - other >= 0 && z - other <= 1)
                .unwrap_or(z);

            v.x = x as f64 * 0.000_001;
            v.y = y as f64 * 0.000_001;
            v.z = anchor as f64 * 0.001;
        }
    }
    let mut all: BTreeMap<_, _> = BTreeMap::new();
    for face in &raw {
        for v in &face.vertices {
            all.entry(vertex_key(v)).or_insert_with(|| v.clone());
        }
    }
    let mut points: Vec<_> = all.into_values().collect();
    points.sort_by(|a, b| {
        a.x.total_cmp(&b.x)
            .then(a.y.total_cmp(&b.y))
            .then(a.z.total_cmp(&b.z))
    });

    for face in raw {
        let mut boundary = vec![];
        for (a, b) in face
            .vertices
            .iter()
            .zip(face.vertices.iter().cycle().skip(1))
            .take(face.vertices.len())
        {
            boundary.push(a.clone());
            let start = points.partition_point(|p| p.x < a.x.min(b.x) - 0.001);
            let end = points.partition_point(|p| p.x <= a.x.max(b.x) + 0.001);
            let mut inside: Vec<_> = points[start..end]
                .iter()
                .filter_map(|p| on_segment(p, a, b).map(|t| (t, p)))
                .collect();
            inside.sort_by(|a, b| a.0.total_cmp(&b.0));
            for (_, v) in inside {
                boundary.push(v.clone());
            }
        }
        boundary.dedup_by(|a, b| vertex_key(a) == vertex_key(b));

        if boundary.len() < 3 {
            continue;
        }
        // A center fan preserves every collinear subdivision, unlike earcut's cleanup.
        let mut polygons = vec![];
        let vertical = !ogival::oriented(face.source.kind)
            && !matches!(
                face.source.kind,
                RoofFaceKind::Pan
                    | RoofFaceKind::Slab
                    | RoofFaceKind::Skirt
                    | RoofFaceKind::CorbelSoffit
            );
        if boundary.len() == 3 || vertical || face.source.corbel {
            polygons.push(boundary);
        } else {
            let n = boundary.len() as f64;
            let center = Vertex3 {
                x: boundary.iter().map(|v| v.x).sum::<f64>() / n,
                y: boundary.iter().map(|v| v.y).sum::<f64>() / n,
                z: snap(boundary.iter().map(|v| v.z).sum::<f64>() / n),
            };
            for (a, b) in boundary
                .iter()
                .zip(boundary.iter().cycle().skip(1))
                .take(boundary.len())
            {
                polygons.push(vec![center.clone(), a.clone(), b.clone()]);
            }
        }
        for mut poly in polygons {
            let Some(mut n) = normal(&poly) else {
                continue;
            };
            if vertical {
                let length = libm::sqrt(n[0] * n[0] + n[1] * n[1]);
                if length > EPS {
                    n = [n[0] / length, n[1] / length, 0.0];
                }
            }
            if matches!(
                face.source.kind,
                RoofFaceKind::Pan | RoofFaceKind::Slab | RoofFaceKind::Skirt
            ) && n[2] < 0.0
            {
                poly.reverse();
                n = [-n[0], -n[1], -n[2]];
            }
            if face.source.kind == RoofFaceKind::CorbelSoffit && n[2] > 0.0 {
                poly.reverse();
                n = [-n[0], -n[1], -n[2]];
            }
            let mut ids = vec![];
            for v in poly {
                let key = vertex_key(&v);
                let id = *index.entry(key).or_insert_with(|| {
                    let id = mesh.vertices.len() as u32;
                    mesh.vertices.push(Vertex3 {
                        x: v.x,
                        y: v.y,
                        z: snap(v.z),
                    });
                    id
                });
                ids.push(id);
            }
            if ids.iter().collect::<BTreeSet<_>>().len() < 3 {
                continue;
            }
            mesh.faces.push(RoofFace {
                body_id: face.source.body_id.clone(),
                feature_id: face.source.feature_id.clone(),
                level: face.source.level,
                kind: face.source.kind,
                rf: face.source.rf.clone(),
                roof_group: face.source.group.clone(),
                component_id: face.source.component_id.clone(),
                vertices: ids,
                material: face.source.material.clone(),
                normal: n,
            });
            source_planes.push(if vertical || face.source.corbel {
                None
            } else {
                Some(face.source.plane)
            });
            if mesh.faces.len() > MAX_ROOF_FACES {
                return Err(format!(
                    "Budget toitures réel pendant assemblage : {} > {MAX_ROOF_FACES} faces ({}).",
                    mesh.faces.len(),
                    face.source.group
                ));
            }
        }
    }
    Ok((mesh, source_planes))
}

type EdgeMap = BTreeMap<(u32, u32), Vec<u32>>;
fn edge_map(mesh: &RoofMesh) -> EdgeMap {
    let mut map: BTreeMap<_, Vec<u32>> = BTreeMap::new();
    for (fi, face) in mesh.faces.iter().enumerate() {
        for (&a, &b) in face
            .vertices
            .iter()
            .zip(face.vertices.iter().cycle().skip(1))
            .take(face.vertices.len())
        {
            map.entry((a.min(b), a.max(b))).or_default().push(fi as u32);
        }
    }
    map
}
fn mesh_edges(unit: &HouseUnit, mesh: &RoofMesh, source_planes: &[Option<Plane>]) -> Vec<RoofEdge> {
    edge_map(mesh)
        .into_iter()
        .filter_map(|((a, b), faces)| {
            let first = &mesh.faces[faces[0] as usize];
            let second = faces.get(1).map(|&i| &mesh.faces[i as usize]);
            let plane_normal = |plane: Plane| {
                let length = libm::sqrt(plane.a * plane.a + plane.b * plane.b + 1.0);
                [-plane.a / length, -plane.b / length, 1.0 / length]
            };
            let first_normal = source_planes[faces[0] as usize].map_or(first.normal, plane_normal);
            let kind = if let Some(other) = second {
                let other_normal =
                    source_planes[faces[1] as usize].map_or(other.normal, plane_normal);
                let dot = first_normal
                    .iter()
                    .zip(other_normal)
                    .map(|(a, b)| a * b)
                    .sum::<f64>();
                if dot > 1.0 - 1.0e-6 {
                    return None;
                }
                if first.kind == RoofFaceKind::StepWall
                    || other.kind == RoofFaceKind::StepWall
                    || corbel::intrados(first.kind)
                    || corbel::intrados(other.kind)
                {
                    RoofEdgeKind::Step
                } else if first_normal[2].abs() < EPS || other_normal[2].abs() < EPS {
                    RoofEdgeKind::Verge
                } else {
                    let p = &mesh.vertices[a as usize];
                    let q = &mesh.vertices[b as usize];
                    let mid = Point {
                        x: (p.x + q.x) * 0.5,
                        y: (p.y + q.y) * 0.5,
                    };
                    let center = |face: &RoofFace| {
                        let n = face.vertices.len() as f64;
                        Point {
                            x: face
                                .vertices
                                .iter()
                                .map(|&i| mesh.vertices[i as usize].x)
                                .sum::<f64>()
                                / n,
                            y: face
                                .vertices
                                .iter()
                                .map(|&i| mesh.vertices[i as usize].y)
                                .sum::<f64>()
                                / n,
                        }
                    };
                    let side = |face: &RoofFace, normal: [f64; 3]| {
                        let c = center(face);
                        let dx = q.x - p.x;
                        let dy = q.y - p.y;
                        let den = dx * dx + dy * dy;
                        let transverse = (-dy * (c.x - mid.x) + dx * (c.y - mid.y)) / den;
                        (normal[0] * dy - normal[1] * dx) * transverse / normal[2]
                    };
                    let da = side(first, first_normal);
                    let db = side(other, other_normal);
                    if da > 0.0001 && db > 0.0001 {
                        RoofEdgeKind::Valley
                    } else if da < -0.0001 && db < -0.0001 {
                        if (p.z - q.z).abs() < 0.001 {
                            RoofEdgeKind::Ridge
                        } else {
                            RoofEdgeKind::Hip
                        }
                    } else {
                        RoofEdgeKind::Crease
                    }
                }
            } else if corbel::intrados(first.kind) {
                let p = &mesh.vertices[a as usize];
                let q = &mesh.vertices[b as usize];
                let mid = Point {
                    x: (p.x + q.x) * 0.5,
                    y: (p.y + q.y) * 0.5,
                };
                if unit.walls.iter().any(|w| {
                    w.body_id.as_ref() == Some(&first.body_id)
                        && w.level == first.level
                        && w.z_m <= p.z.min(q.z) + 0.001
                        && w.z_m + w.height_m >= p.z.max(q.z) - 0.001
                        && g::to_geo(&g::offset(&w.footprint, 0.002))
                            .0
                            .iter()
                            .any(|poly| {
                                use geo::Contains;
                                poly.contains(&geo::Point::new(mid.x, mid.y))
                            })
                }) {
                    RoofEdgeKind::Junction
                } else {
                    RoofEdgeKind::Step
                }
            } else if unit
                .bodies
                .iter()
                .find(|b| b.id == first.body_id)
                .is_some_and(|b| b.roof_spec.oculus_ratio > 0.0)
                && mesh
                    .groups
                    .iter()
                    .find(|g| g.id == first.roof_group)
                    .is_some_and(|g| {
                        g.domain.iter().any(|p| {
                            p.holes.iter().any(|ring| {
                                let p = &mesh.vertices[a as usize];
                                let q = &mesh.vertices[b as usize];
                                let mid = Point {
                                    x: (p.x + q.x) * 0.5,
                                    y: (p.y + q.y) * 0.5,
                                };
                                ring.iter()
                                    .zip(ring.iter().cycle().skip(1))
                                    .take(ring.len())
                                    .any(|(a, b)| distance_to_segment(mid, *a, *b) < 0.002)
                            })
                        })
                    })
            {
                RoofEdgeKind::Oculus
            } else if first.normal[2].abs() < EPS {
                RoofEdgeKind::Verge
            } else {
                RoofEdgeKind::Eave
            };
            Some(RoofEdge {
                kind,
                vertices: [a, b],
                faces: [Some(faces[0]), faces.get(1).copied()],
            })
        })
        .collect()
}

fn add_step_walls(
    unit: &HouseUnit,
    mesh: &mut RoofMesh,
    corbel_ids: &BTreeSet<String>,
) -> Result<(), String> {
    let mut projected: BTreeMap<_, Vec<(u32, u32, u32)>> = BTreeMap::new();
    for ((a, b), faces) in edge_map(mesh) {
        if faces.len() != 1 {
            continue;
        }
        let face = &mesh.faces[faces[0] as usize];
        if corbel_ids.contains(&face.roof_group) {
            continue;
        }
        if !matches!(
            face.kind,
            RoofFaceKind::Pan | RoofFaceKind::Slab | RoofFaceKind::Skirt
        ) {
            continue;
        }
        let v = &mesh.vertices[a as usize];
        let w = &mesh.vertices[b as usize];
        let p = (vertex_key(v).0, vertex_key(v).1);
        let q = (vertex_key(w).0, vertex_key(w).1);
        if p == q {
            continue;
        }
        let (pair, ids) = if p < q {
            ((p, q), (a, b))
        } else {
            ((q, p), (b, a))
        };
        projected
            .entry(pair)
            .or_default()
            .push((ids.0, ids.1, faces[0]));
    }
    for segments in projected.into_values() {
        if segments.len() != 2 {
            continue;
        }
        let (a, b, fa) = segments[0];
        let (c, d, fb) = segments[1];
        if mesh.faces[fa as usize].feature_id.is_some()
            || mesh.faces[fb as usize].feature_id.is_some()
        {
            continue;
        }
        let dz1 = mesh.vertices[a as usize].z - mesh.vertices[c as usize].z;
        let dz2 = mesh.vertices[b as usize].z - mesh.vertices[d as usize].z;
        if dz1.abs().max(dz2.abs()) <= 0.001 || dz1 * dz2 < -EPS {
            continue;
        }
        let (source, mut ids) = if dz1 + dz2 > 0.0 {
            (mesh.faces[fa as usize].clone(), vec![a, b, d, c])
        } else {
            (mesh.faces[fb as usize].clone(), vec![c, d, b, a])
        };
        if unit.bodies.iter().any(|body| {
            body.id == source.body_id
                && body.roof_spec.triangulation == Some(RoofTriangulation::Boundary)
        }) {
            // A material step can meet at one endpoint and form a triangle.
            // Preserve that face while removing its repeated closing corner.
            ids.dedup();
            if ids.first() == ids.last() {
                ids.pop();
            }
            if ids.len() < 3 {
                return Err("Paroi de ressaut Boundary sans surface positive.".into());
            }
        }
        let mid = Point {
            x: (mesh.vertices[a as usize].x + mesh.vertices[b as usize].x) * 0.5,
            y: (mesh.vertices[a as usize].y + mesh.vertices[b as usize].y) * 0.5,
        };
        let low = mesh.vertices[a as usize].z.min(mesh.vertices[c as usize].z);
        let high = mesh.vertices[a as usize].z.max(mesh.vertices[c as usize].z);
        let existing = unit.walls.iter().any(|w| {
            w.z_m <= low + 0.001
                && w.z_m + w.height_m >= high - 0.001
                && w.centerline
                    .windows(2)
                    .any(|s| distance_to_segment(mid, s[0], s[1]) < 0.003)
        });
        if existing {
            continue;
        }
        let vertices: Vec<_> = ids
            .iter()
            .map(|&i| mesh.vertices[i as usize].clone())
            .collect();
        if let Some(n) = normal(&vertices) {
            let mut face = source;
            face.kind = RoofFaceKind::StepWall;
            face.vertices = ids;
            face.normal = n;
            mesh.faces.push(face);
        }
        if mesh.faces.len() > MAX_ROOF_FACES {
            return Err("Budget de faces dépassé par les parois de ressaut.".into());
        }
    }
    Ok(())
}

/// Build every roof atomically. Identical repeated calls do not accumulate features.
pub fn build_roofs(unit: &mut HouseUnit) -> Result<(), String> {
    let roofs = make_roofs(unit)?;
    install_roofs(unit, roofs);
    Ok(())
}

pub(crate) fn build_roofs_with_budget(unit: &mut HouseUnit, limit: usize) -> Result<(), String> {
    let majorant = conservative_roof_faces(unit)?;
    // This tuple is computed on this same, unmutated unit and consumed here.
    let prepared = if majorant > MAX_ROOF_FACES {
        Some(make_roofs(unit)?)
    } else {
        None
    };
    let anticipated = prepared
        .as_ref()
        .map_or(majorant, |(mesh, _, _)| mesh.faces.len());
    if anticipated > limit {
        return Err(format!(
            "Budget toiture par unité avant maillage : {anticipated} > {limit} faces."
        ));
    }
    let roofs = match prepared {
        Some(roofs) => roofs,
        None => make_roofs(unit)?,
    };
    install_roofs(unit, roofs);
    Ok(())
}

fn install_roofs(unit: &mut HouseUnit, roofs: (RoofMesh, Vec<Feature>, Vec<String>)) {
    let (mesh, features, precision_notes) = roofs;
    let mut retained: Vec<_> = unit
        .features
        .iter()
        .filter(|f| !f.id.starts_with("roof:"))
        .cloned()
        .collect();
    retained.extend(features);
    unit.features = retained;
    unit.roofs = mesh;
    unit.diagnostics.retain(|d| {
        !d.starts_with("roof: couverture intermédiaire ")
            && !d.starts_with("roof: arrangement Boundary ")
    });
    unit.diagnostics.extend(precision_notes);
    for source in body_sources(unit) {
        if source.layer != "main"
            && source.roof_pitch_deg == 25.0
            && unit
                .bodies
                .iter()
                .find(|b| b.id == source.body_id)
                .is_some_and(|b| b.roof_pitch_deg == 0.0)
        {
            let message = format!(
                "roof: couverture intermédiaire {}:{}, pente stylisée explicite de 25° (toit principal sans pente).",
                source.id, source.level.index
            );
            if !unit.diagnostics.contains(&message) {
                unit.diagnostics.push(message);
            }
        }
    }
}

#[cfg(test)]
mod budget_tests {
    use super::*;

    fn fixture(round: bool) -> HouseUnit {
        let mut unit = crate::generate_batch(HouseConfig {
            pack: "MED-ANT".into(),
            recipe: Some("MED-ANT-B01".into()),
            count: 1,
            variation: 0.0,
            ..Default::default()
        })
        .unwrap()
        .units
        .remove(0);
        let footprint = if round {
            g::ellipse(6.0, 4.0, 6.0, 4.0, 64)
        } else {
            g::rectangle(0.0, 0.0, 12.0, 8.0)
        };
        let body = &mut unit.bodies[0];
        body.footprint = footprint.clone();
        body.levels[0].footprint = footprint.clone();
        body.levels[0].floor = footprint;
        body.roof_system = if round { "RF-DOME" } else { "RF-GABLE" }.into();
        body.roof_pitch_deg = 40.0;
        body.overhang_m = 0.0;
        body.roof_spec = RoofSpec::default();
        body.roof_arms = vec![RoofArm {
            source_component: None,
            origin: point(0.0, 0.0),
            axis: [1.0, 0.0],
            length_m: 12.0,
            width_m: 8.0,
            domain: g::rectangle(0.0, 0.0, 12.0, 8.0),
        }];
        unit.lot = g::rectangle(-3.0, -3.0, 18.0, 14.0);
        unit.features.clear();
        unit.walls.clear();
        unit.site_context.clear();
        unit.access.nodes.clear();
        unit.access.portals.clear();
        unit.roofs = RoofMesh::default();
        if round {
            let body = unit.bodies[0].clone();
            unit.bodies = (0..40)
                .map(|i| Body {
                    id: format!("b{i}"),
                    ..body.clone()
                })
                .collect();
        }
        unit
    }

    #[test]
    fn budget_refusal_is_atomic_in_both_estimate_branches() {
        for round in [false, true] {
            let mut unit = fixture(round);
            let majorant = conservative_roof_faces(&unit).unwrap();
            assert_eq!(majorant > MAX_ROOF_FACES, round);
            let expected = estimate_roof_faces(&unit).unwrap();
            if round {
                assert!(expected < majorant);
            } else {
                assert_eq!(expected, majorant);
            }
            let before = serde_json::to_vec(&unit).unwrap();
            let limit = expected - 1;
            assert_eq!(
                build_roofs_with_budget(&mut unit, limit).unwrap_err(),
                format!("Budget toiture par unité avant maillage : {expected} > {limit} faces.")
            );
            assert_eq!(serde_json::to_vec(&unit).unwrap(), before);
        }
    }

    #[test]
    fn budgeted_build_matches_public_build_in_both_estimate_branches() {
        for round in [false, true] {
            let mut checked = fixture(round);
            assert_eq!(
                conservative_roof_faces(&checked).unwrap() > MAX_ROOF_FACES,
                round
            );
            let mut ordinary = checked.clone();
            build_roofs(&mut ordinary).unwrap();
            build_roofs_with_budget(&mut checked, MAX_ROOF_FACES).unwrap();
            assert_eq!(
                serde_json::to_vec(&checked).unwrap(),
                serde_json::to_vec(&ordinary).unwrap()
            );
        }
    }
}
