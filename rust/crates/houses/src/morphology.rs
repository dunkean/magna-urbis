//! Opt-in, bounded composition inside a supplied architectural envelope.
//!
//! Coordinates are already in the building's local frame. No finished house is
//! clipped: candidates comprise whole habitable ranges, each checked against the
//! real polygon and its holes. Unsupported authored programmes remain native.
use crate::catalogue::{EnclosureFamily, Envelope, Layout, Parameters, Placement, SupportKind};
use crate::geometry::*;
use crate::layouts::{LayoutPlan, composed_spec, minimum_domain, spec};
use crate::model::{Role, Surface};
use geo::algorithm::Validation;
use magna_urbis_random::Rng;

const MAX_CANDIDATES: usize = 64;
const MINIMUM_CANDIDATES: usize = 16;
const MAX_RANGES: usize = 8;
const MAX_VERTICES: usize = 256;
const COURT_CLEARANCE: f64 = 1.8;
const ROW_PASSAGE: f64 = 1.25;
const COURT_GATE: f64 = 1.6;
const EPS: f64 = 0.000_001;

fn bounded(value: f64, min: f64, max: f64) -> f64 {
    // Subtraction of snapped metric dimensions can put max a few ulps below
    // min at the exact physical minimum. Final domain checks remain decisive.
    value.max(min).min(max.max(min))
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Family {
    Rectangle,
    Row,
    Elbow,
    OpenCourt,
    Court,
    Compound,
}

fn family(p: &Parameters) -> Option<Family> {
    match (p.layout, p.footprint_family.as_str()) {
        (Layout::Strip, "FP-RECT" | "FP-LONG") => Some(Family::Row),
        (Layout::Courtyard, "FP-L") => Some(Family::Elbow),
        (Layout::Courtyard, "FP-U") => Some(Family::OpenCourt),
        (Layout::Courtyard, "FP-COURT") => Some(Family::Court),
        (Layout::Single, "FP-RECT" | "FP-LONG") => Some(Family::Rectangle),
        (Layout::Single, "FP-L") => Some(Family::Elbow),
        (Layout::Single, "FP-U") => Some(Family::OpenCourt),
        (Layout::Single | Layout::Additive, "FP-COMPLEX") => Some(Family::Compound),
        _ => None,
    }
}

/// The catalogue index calls this same predicate. Capability follows declared
/// construction data, never a recipe/pack label or a guessed cultural identity.
fn supports_structure(p: &Parameters) -> bool {
    p.court_program.is_none()
        && p.structural_spec.is_none()
        && p.shell.is_none()
        && p.envelope == Envelope::Walled
        && p.support.kind == SupportKind::Ground
        && p.roof_spec.shell.is_none()
        && p.roof_spec.corbel.is_none()
        && p.roof_spec.vault.is_none()
        && !p.gallery_cover.enabled
        && p.bodies[0] > 0
        && p.bodies[0] <= MAX_RANGES as u32
        && !p
            .details
            .iter()
            .any(|d| matches!(d.as_str(), "arcade" | "jetty" | "jetties" | "street_jetty"))
        && p.roof_system != "uncovered"
}

pub(crate) fn supports(p: &Parameters) -> bool {
    supports_structure(p)
        && ((family(p).is_some()
            && (p.components.is_empty()
                || (p.components.len() == 1 && p.components[0].id == "main")))
            || supports_components(p))
}

/// Heterogeneous, source-declared main + adjacent assemblies (for example a
/// house and its tower). Each component keeps its own construction programme.
pub(crate) fn supports_components(p: &Parameters) -> bool {
    supports_structure(p)
        && p.layout == Layout::Additive
        && p.components.len() > 1
        && p.components
            .iter()
            .filter(|c| c.placement == Placement::Main)
            .count()
            == 1
        && p.components
            .iter()
            .filter(|c| c.placement == Placement::Main)
            .all(|c| c.count == [1, 1])
        && p.components
            .iter()
            .map(|c| u64::from(c.count[1]))
            .sum::<u64>()
            <= MAX_RANGES as u64
        && p.components.iter().all(|c| {
            matches!(c.placement, Placement::Main | Placement::Adjacent)
                && matches!(
                    c.footprint_family.as_str(),
                    "FP-RECT" | "FP-LONG" | "FP-SQUARE" | "FP-TOWER"
                )
                && c.envelope == Envelope::Walled
                && c.support.kind == SupportKind::Ground
                && c.floors[0] > 0
                && c.roof_spec.shell.is_none()
                && c.roof_spec.corbel.is_none()
                && c.roof_spec.vault.is_none()
                && c.roof_system != "uncovered"
        })
}

/// Eligibility for exact fitting of supported orthogonal subsets; actual
/// topology, body counts, access and minimum ranges still require admission.
pub(crate) fn supports_imposed(p: &Parameters) -> bool {
    supports(p) && !supports_components(p) && family(p) != Some(Family::Court)
}

#[derive(Clone, Copy, Debug)]
struct Range {
    x: f64,
    y: f64,
    w: f64,
    d: f64,
}

impl Range {
    fn new(x: f64, y: f64, w: f64, d: f64) -> Self {
        Self {
            x: snap(x),
            y: snap(y),
            w: snap(w),
            d: snap(d),
        }
    }

    fn surface(self) -> Surface {
        rectangle(self.x, self.y, self.w, self.d)
    }

    fn valid(self, minimum: [f64; 2]) -> bool {
        self.w + EPS >= minimum[0] && self.d + EPS >= minimum[1]
    }

    fn overlaps(self, other: Self) -> bool {
        self.x < other.x + other.w - EPS
            && other.x < self.x + self.w - EPS
            && self.y < other.y + other.d - EPS
            && other.y < self.y + self.d - EPS
    }
}

struct Candidate {
    ranges: Vec<Range>,
    court: Surface,
    path: Surface,
    gate_range: Option<usize>,
}

fn contained(envelope: &Surface, candidate: &Surface) -> bool {
    area(&difference(candidate, envelope)) <= EPS.max(area(candidate) * 1e-9)
}

fn validate_surface(surface: &Surface, label: &str) -> Result<(), String> {
    let vertices: usize = surface
        .iter()
        .flat_map(|p| std::iter::once(&p.outer).chain(p.holes.iter()))
        .map(Vec::len)
        .sum();
    if surface.is_empty() || vertices > MAX_VERTICES {
        return Err(format!(
            "Morphology {label}: an envelope with 3..={MAX_VERTICES} vertices is required."
        ));
    }
    for polygon in surface {
        if signed_area(&polygon.outer) <= 0.0
            || polygon.holes.iter().any(|ring| signed_area(ring) >= 0.0)
        {
            return Err(format!(
                "Morphology {label}: native positive exterior/negative hole winding is required."
            ));
        }
        for ring in std::iter::once(&polygon.outer).chain(polygon.holes.iter()) {
            if ring.len() < 3
                || ring.iter().any(|p| {
                    !p.x.is_finite() || !p.y.is_finite() || p.x.abs() > 1e7 || p.y.abs() > 1e7
                })
                || signed_area(ring).abs() < EPS
            {
                return Err(format!("Morphology {label}: invalid or unbounded ring."));
            }
        }
    }
    if area(surface) <= EPS {
        return Err(format!("Morphology {label}: no positive usable area."));
    }
    to_geo(surface)
        .check_validation()
        .map_err(|error| format!("Morphology {label}: invalid polygon topology ({error})."))?;
    Ok(())
}

fn minimum_extent(p: &Parameters, f: Family, m: [f64; 2]) -> [f64; 2] {
    if p.layout == Layout::Courtyard && matches!(f, Family::Elbow | Family::OpenCourt) {
        let ratio = libm::sqrt(p.courtyard_ratio[0].clamp(0.05, 0.7));
        let sides = if f == Family::OpenCourt { 2.0 } else { 1.0 };
        return [
            (sides * m[0] / (1.0 - ratio)).max(COURT_CLEARANCE / ratio),
            (m[1] / (1.0 - ratio))
                .max(m[1] / ratio)
                .max(COURT_CLEARANCE / ratio),
        ];
    }
    match f {
        Family::Rectangle => m,
        Family::Row => [m[0] + ROW_PASSAGE, m[1] + COURT_CLEARANCE],
        Family::Elbow => [m[0] * 2.0 + COURT_CLEARANCE, m[1] * 2.0],
        Family::OpenCourt => [m[0] * 2.0 + COURT_CLEARANCE, m[1] * 2.0],
        Family::Court => {
            let ratio = libm::sqrt(p.courtyard_ratio[0].clamp(0.05, 0.7));
            [
                (2.0 * m[0] / (1.0 - ratio)).max(2.0 * m[0] + COURT_GATE),
                2.0 * m[1] / (1.0 - ratio),
            ]
        }
        Family::Compound => [m[0] * 2.0, m[1] * 2.0],
    }
}

fn make_candidate(
    p: &Parameters,
    family: Family,
    outer: Range,
    minimum: [f64; 2],
    rng: &mut Rng,
) -> Candidate {
    let Range { x, y, w, d } = outer;
    let mut c = Candidate {
        ranges: vec![],
        court: vec![],
        path: vec![],
        gate_range: None,
    };
    match family {
        Family::Rectangle => c.ranges.push(outer),
        Family::Row => {
            let yard = snap(
                (d * rng.range(0.18, 0.32))
                    .max(COURT_CLEARANCE)
                    .min(d - minimum[1]),
            );
            c.ranges
                .push(Range::new(x, y + yard, w - ROW_PASSAGE, d - yard));
            c.court = rectangle(x, y, w - ROW_PASSAGE, yard);
            c.path = rectangle(x + w - ROW_PASSAGE, y, ROW_PASSAGE, d);
        }
        Family::Elbow | Family::OpenCourt => {
            let mut base = snap(bounded(
                d * rng.range(0.28, 0.47),
                minimum[1],
                d - minimum[1],
            ));
            let mut left = snap(bounded(
                w * rng.range(0.24, 0.39),
                minimum[0],
                w - minimum[0] - COURT_CLEARANCE,
            ));
            let mut right = if family == Family::OpenCourt {
                snap(bounded(
                    w * rng.range(0.24, 0.39),
                    minimum[0],
                    w - left - COURT_CLEARANCE,
                ))
            } else {
                0.0
            };
            if p.layout == Layout::Courtyard {
                let ratio = libm::sqrt(p.courtyard_ratio[0].clamp(0.05, 0.7));
                base = snap((d * (1.0 - ratio)).max(minimum[1]).min(d - minimum[1]));
                let sides = snap(w * (1.0 - ratio));
                if family == Family::OpenCourt {
                    left = snap(bounded(
                        sides * rng.range(0.38, 0.62),
                        minimum[0],
                        sides - minimum[0],
                    ));
                    right = snap(sides - left);
                } else {
                    left = sides;
                    right = 0.0;
                }
            }
            c.ranges.push(Range::new(x, y, w, base));
            c.ranges.push(Range::new(x, y + base, left, d - base));
            if right > 0.0 {
                // Independently sized arms: topology is retained while the plan
                // is no longer a scaled copy of one fixed-ratio template.
                let depth = snap((d - base) * rng.range(0.76, 1.0)).max(minimum[1]);
                c.ranges
                    .push(Range::new(x + w - right, y + base, right, depth));
            }
            if p.layout == Layout::Courtyard {
                c.court = rectangle(x + left, y + base, w - left - right, d - base);
                c.path = rectangle(x + left, y + base, COURT_CLEARANCE, d - base);
            }
        }
        Family::Court => {
            let ratio = libm::sqrt(p.courtyard_ratio[0].clamp(0.05, 0.7));
            let cw = snap((w * ratio).max(COURT_CLEARANCE).min(w - 2.0 * minimum[0]));
            let cd = snap((d * ratio).max(COURT_CLEARANCE).min(d - 2.0 * minimum[1]));
            let left = snap(bounded(
                (w - cw) * rng.range(0.38, 0.62),
                minimum[0],
                w - cw - minimum[0],
            ));
            let back = snap(bounded(
                (d - cd) * rng.range(0.38, 0.62),
                minimum[1],
                d - cd - minimum[1],
            ));
            c.ranges = vec![
                Range::new(x, y, w, back),
                Range::new(x, y + back, left, cd),
                Range::new(x + left + cw, y + back, w - left - cw, cd),
                Range::new(x, y + back + cd, w, d - back - cd),
            ];
            c.court = rectangle(x + left, y + back, cw, cd);
            let gate_x = snap(bounded(
                x + left + cw * 0.5 - COURT_GATE * 0.5,
                x + minimum[0],
                x + w - minimum[0] - COURT_GATE,
            ));
            c.path = rectangle(gate_x, y + back + cd, COURT_GATE, d - back - cd);
            c.gate_range = Some(3);
        }
        Family::Compound => {
            let count = if p.layout == Layout::Additive {
                p.bodies[0] as usize
            } else {
                rng.int(3, 5) as usize
            };
            // Different trees of attached ranges, with independent offsets and
            // dimensions. No footprint union is clipped to rescue a candidate.
            let mw = snap((w * rng.range(0.32, 0.56)).max(minimum[0]).min(w));
            let md = snap((d * rng.range(0.30, 0.52)).max(minimum[1]).min(d));
            c.ranges
                .push(Range::new(x + (w - mw) * 0.5, y + (d - md) * 0.5, mw, md));
            for _ in 1..count {
                let mut added = false;
                for _ in 0..24 {
                    let anchor = c.ranges[rng.int(0, c.ranges.len() as u32 - 1) as usize];
                    let side = rng.int(0, 3);
                    let rw = snap((w * rng.range(0.20, 0.42)).max(minimum[0]));
                    let rd = snap((d * rng.range(0.20, 0.42)).max(minimum[1]));
                    let r = match side {
                        0 => Range::new(
                            anchor.x - rw,
                            anchor.y + rng.range(0.0, (anchor.d - rd).max(0.0)),
                            rw,
                            rd.min(anchor.d),
                        ),
                        1 => Range::new(
                            anchor.x + anchor.w,
                            anchor.y + rng.range(0.0, (anchor.d - rd).max(0.0)),
                            rw,
                            rd.min(anchor.d),
                        ),
                        2 => Range::new(
                            anchor.x + rng.range(0.0, (anchor.w - rw).max(0.0)),
                            anchor.y - rd,
                            rw.min(anchor.w),
                            rd,
                        ),
                        _ => Range::new(
                            anchor.x + rng.range(0.0, (anchor.w - rw).max(0.0)),
                            anchor.y + anchor.d,
                            rw.min(anchor.w),
                            rd,
                        ),
                    };
                    if r.valid(minimum)
                        && r.x >= x - EPS
                        && r.y >= y - EPS
                        && r.x + r.w <= x + w + EPS
                        && r.y + r.d <= y + d + EPS
                        && !c.ranges.iter().any(|a| a.overlaps(r))
                    {
                        c.ranges.push(r);
                        added = true;
                        break;
                    }
                }
                if !added {
                    c.ranges.clear();
                    break;
                }
            }
        }
    }
    c
}

fn materialize(
    p: &Parameters,
    role: Role,
    envelope: &Surface,
    candidate: Candidate,
    fixed: bool,
) -> Result<LayoutPlan, String> {
    let domains: Vec<_> = candidate.ranges.iter().map(|r| r.surface()).collect();
    let mut bodies = if p.layout == Layout::Single {
        vec![composed_spec(&domains, p, role)]
    } else {
        domains.iter().map(|s| spec(s.clone(), p, role)).collect()
    };
    if let Some(index) = candidate.gate_range {
        let body = &mut bodies[index];
        body.footprint = difference(&body.footprint, &candidate.path);
        body.levels[0] = body.footprint.clone();
        if body.levels.len() == 1 {
            // Ground-only ranges have no roof bridge above an open gateway.
            let split: Vec<_> = body.footprint.iter().map(|p| vec![p.clone()]).collect();
            *body = composed_spec(&split, p, role);
        }
    }
    let occupied = unite(
        &bodies
            .iter()
            .map(|b| b.footprint.clone())
            .collect::<Vec<_>>(),
    );
    if bodies.iter().any(|b| b.levels.iter().any(|l| l.is_empty())) {
        return Err("Morphology: an upper-level setback eliminates a habitable range.".into());
    }
    Ok(LayoutPlan {
        lot: envelope.clone(),
        courts: difference(&candidate.court, &occupied),
        paths: difference(&candidate.path, &occupied),
        bodies,
        features: vec![],
        context: vec![],
        diagnostics: vec![format!(
            "Constrained morphology v1: {}; {} whole habitable ranges; retained materials, floors and structural room/stair minima. Inspired adaptation of declared {:?}/{} capabilities, not measured historical dimensions.",
            if fixed {
                "exact orthogonal footprint decomposition"
            } else {
                "seeded composition within the actual polygon and its holes"
            },
            domains.len(),
            p.layout,
            p.footprint_family,
        )],
    })
}

/// A deliberately narrow budget operator: one orthogonal range, with the
/// retained strip court/passage programme. Other topologies keep their plan.
pub(crate) struct DomesticBudgetShape {
    pub passage_m: f64,
    pub court_fraction: f64,
    pub minimum_body: [f64; 2],
    pub minimum_court_depth: f64,
    court_over_passage: bool,
}

fn rectangular_bounds(s: &Surface) -> Option<[f64; 4]> {
    if s.len() != 1 || !s[0].holes.is_empty() || !(4..=16).contains(&s[0].outer.len()) {
        return None;
    }
    let b = bounds(s);
    // Boolean operations may retain collinear vertices a few ulps apart. This
    // accepts that representation, not arbitrary near-rectangular topology.
    let on = |x: f64, edge: f64| (x - edge).abs() < 1e-6;
    let boundary_edges = s[0]
        .outer
        .iter()
        .zip(s[0].outer.iter().cycle().skip(1))
        .all(|(a, c)| {
            [b[0], b[2]].iter().any(|x| on(a.x, *x) && on(c.x, *x))
                || [b[1], b[3]].iter().any(|y| on(a.y, *y) && on(c.y, *y))
        });
    (b[2] > b[0]
        && b[3] > b[1]
        && boundary_edges
        && (area(s) - (b[2] - b[0]) * (b[3] - b[1])).abs() < 0.0001)
        .then_some(b)
}

/// Physical room/stair minimum of the existing inspired constrained operator.
/// This is not a catalogue nominal bound or a site admission certificate.
pub(crate) fn constrained_minimum_domain(p: &Parameters) -> [f64; 2] {
    minimum_domain(p).map(|v| libm::ceil(v / GRID_M) * GRID_M)
}

pub(crate) fn domestic_budget_shape(
    p: &Parameters,
    plan: &LayoutPlan,
) -> Result<DomesticBudgetShape, &'static str> {
    // A native rear-court arcade uses the same whole strip range. Its covers
    // and posts are regenerated by the native gallery builder, not scaled.
    // Other gallery topologies, facade-bearing bands and structural programmes
    // need their own operator and remain excluded.
    let strip_gallery = p.gallery_cover.enabled
        && p.layout == Layout::Strip
        && p.footprint_family == "FP-RECT"
        && p.support.kind == SupportKind::Ground
        && p.envelope == Envelope::Walled
        && p.bodies == [1, 1]
        && p.cells[1] == 0
        && p.court_program.is_none()
        && p.structural_spec.is_none()
        && p.shell.is_none()
        && p.roof_spec.shell.is_none()
        && p.roof_spec.corbel.is_none()
        && p.roof_spec.vault.is_none()
        && p.gallery_cover.facade_mode.is_none()
        && (p.gallery_cover.width_m - 0.85).abs() < 1e-8
        && p.details.iter().all(|d| {
            matches!(
                d.as_str(),
                "party_walls" | "arcade" | "columns" | "shopfront"
            )
        })
        && p.details.iter().any(|d| d == "arcade")
        && (p.components.is_empty() || p.components.len() == 1 && p.components[0].id == "main");
    if (p.gallery_cover.enabled || p.details.iter().any(|d| d == "arcade")) && !strip_gallery {
        return Err(
            "gallery/arcade spans need a dedicated budget operator; native structure retained",
        );
    }
    // Corner columns have a 0.13 m circular radius. The generic offset helper
    // bevels rectangle corners; use the exact rectangular court bounds here.
    // This only recognizes native components, never replaces site admission.
    let court_support_zone = if strip_gallery && !plan.courts.is_empty() {
        let c = bounds(&plan.courts);
        rectangle(
            c[0] - 0.14,
            c[1] - 0.14,
            c[2] - c[0] + 0.28,
            c[3] - c[1] + 0.28,
        )
    } else {
        vec![]
    };
    if !(supports(p) || strip_gallery)
        || !matches!(family(p), Some(Family::Rectangle | Family::Row))
        || plan.bodies.len() != 1
        || p.enclosures
            .iter()
            .any(|e| e.family != EnclosureFamily::None)
        || plan.features.iter().any(|f| {
            f.kind != crate::model::FeatureKind::PartyWall
                && !(strip_gallery
                    && matches!(
                        f.kind,
                        crate::model::FeatureKind::Gallery
                            | crate::model::FeatureKind::Arcade
                            | crate::model::FeatureKind::Post
                    )
                    && area(&difference(&f.surface, &court_support_zone)) < EPS)
        })
    {
        return Err(
            "no declared single rectangle/strip budget capability for this retained assembly",
        );
    }
    let body = &plan.bodies[0];
    let b = rectangular_bounds(&body.footprint).ok_or("retained body is not a single rectangle")?;
    if !body.voids.is_empty()
        || body.levels.iter().any(|l| {
            area(&difference(l, &body.footprint)) + area(&difference(&body.footprint, l)) > 0.0001
        })
    {
        return Err("retained voids or differing floor plates require another budget operator");
    }
    let mut minimum_body =
        constrained_minimum_domain(&body.parameters);
    if strip_gallery {
        minimum_body[0] = minimum_body[0].max(COURT_CLEARANCE + 2. * p.gallery_cover.width_m);
    }
    if family(p) == Some(Family::Rectangle) {
        if !plan.courts.is_empty() || !plan.paths.is_empty() || !plan.features.is_empty() {
            return Err("rectangle has an additional court/path/feature programme");
        }
        return Ok(DomesticBudgetShape {
            passage_m: 0.,
            court_fraction: 0.,
            minimum_body,
            minimum_court_depth: 0.,
            court_over_passage: false,
        });
    }
    let c =
        rectangular_bounds(&plan.courts).ok_or("strip court is not a single retained rectangle")?;
    let path = rectangular_bounds(&plan.paths)
        .ok_or("strip passage is not a single retained rectangle")?;
    let near = |a: f64, b: f64| (a - b).abs() <= 2. * GRID_M;
    if !near(c[3], b[1])
        || !near(c[0], b[0])
        || !(near(c[2], b[2]) || near(c[2], path[2]))
        || !near(path[0], b[2])
        || !near(path[1], c[1])
        || !near(path[3], b[3])
    {
        return Err("strip court/passage topology differs from the declared rear-court operator");
    }
    if plan
        .features
        .iter()
        .filter(|f| f.kind == crate::model::FeatureKind::PartyWall)
        .any(|f| {
            rectangular_bounds(&f.surface).is_none_or(|fb| {
                !near((fb[0] + fb[2]) * 0.5, b[0]) && !near((fb[0] + fb[2]) * 0.5, b[2])
            }) || f.roof.is_some()
                || !f.vertices3d.is_empty()
        })
    {
        return Err("party feature requires an undeclared structural budget adapter");
    }
    Ok(DomesticBudgetShape {
        passage_m: path[2] - path[0],
        court_fraction: (c[3] - c[1]) / (b[3] - c[1]),
        minimum_body,
        minimum_court_depth: COURT_CLEARANCE
            + if strip_gallery {
                2. * p.gallery_cover.width_m
            } else {
                0.
            },
        court_over_passage: c[2] > b[2] + GRID_M,
    })
}

/// Rebuild whole native rectangular ranges, never rescale a roof mesh or clip a
/// body. Dimensions are proposed by the caller; physical site admission follows.
pub(crate) fn domestic_budget_plan(
    p: &Parameters,
    retained: &LayoutPlan,
    shape: &DomesticBudgetShape,
    body_width: f64,
    body_depth: f64,
) -> Result<LayoutPlan, &'static str> {
    let w = snap(body_width);
    let d = snap(body_depth);
    let yard = if shape.court_fraction > 0. {
        snap(d * shape.court_fraction / (1. - shape.court_fraction))
    } else {
        0.
    };
    if w < shape.minimum_body[0]
        || d < shape.minimum_body[1]
        || (shape.court_fraction > 0. && yard < shape.minimum_court_depth)
    {
        return Err("budget dimensions violate retained room/stair/court minima");
    }
    let mut parameters = retained.bodies[0].parameters.clone();
    parameters.width_m = [w + shape.passage_m; 2];
    parameters.depth_m = [d + yard; 2];
    let mut body = spec(
        rectangle(0., yard, w, d),
        &parameters,
        retained.bodies[0].role,
    );
    body.component.clone_from(&retained.bodies[0].component);
    body.z = retained.bodies[0].z;
    let old = bounds(&retained.bodies[0].footprint);
    let features = retained
        .features
        .iter()
        .filter(|f| f.kind == crate::model::FeatureKind::PartyWall)
        .map(|f| {
            let mut f = f.clone();
            let fb = bounds(&f.surface);
            let thickness = fb[2] - fb[0];
            let x = if ((fb[0] + fb[2]) * 0.5 - old[0]).abs() < 2. * GRID_M {
                0.
            } else {
                w
            };
            f.surface = rectangle(x - thickness * 0.5, yard, thickness, d);
            f
        })
        .collect();
    let margin = p.overhang_m[0].max(0.1) + 2. * GRID_M;
    let mut diagnostics = retained.diagnostics.clone();
    diagnostics.push("Declared domestic rectangle/strip budget: one rebuilt range; retained floors, materials, rear-court fraction, passage width and party-feature thickness; native declared gallery width, cover and support spacing retained where eligible; no inferred boundary rights.".into());
    Ok(LayoutPlan {
        lot: rectangle(
            -margin,
            -margin,
            w + shape.passage_m + 2. * margin,
            d + yard + 2. * margin,
        ),
        courts: if yard > 0. {
            rectangle(
                0.,
                0.,
                w + if shape.court_over_passage {
                    shape.passage_m
                } else {
                    0.
                },
                yard,
            )
        } else {
            vec![]
        },
        paths: if shape.passage_m > 0. {
            rectangle(w, 0., shape.passage_m, d + yard)
        } else {
            vec![]
        },
        bodies: vec![body],
        features,
        // Context is illustrative neighbouring scenery, not source structure or
        // city rights. It is omitted just as in constrained morphology plans.
        context: vec![],
        diagnostics,
    })
}

/// Resolve a plan inside an available envelope, or decompose an imposed
/// orthogonal footprint exactly. A finite search failure is an explicit refusal.
pub(crate) fn synthesize(
    p: &Parameters,
    role: Role,
    envelope: &Surface,
    seed: &str,
    target_footprint: Option<&Surface>,
) -> Result<LayoutPlan, String> {
    if !supports(p) || supports_components(p) {
        return Err("Morphology: this authored layout/programme has no constrained composition operator; retain its native template.".into());
    }
    validate_surface(envelope, "envelope")?;
    // Enclosure enrichment derives its ring from plan.lot. Preserve a physical
    // clearance instead of placing a range underneath the declared boundary.
    let inset = p
        .enclosures
        .iter()
        .any(|s| s.family != EnclosureFamily::None && s.placement != Placement::Central);
    let construction = if inset {
        offset(envelope, -0.75)
    } else {
        envelope.clone()
    };
    if construction.is_empty() {
        return Err(
            "Morphology: declared perimeter enclosure leaves no construction domain.".into(),
        );
    }
    let minimum = constrained_minimum_domain(p);
    if minimum.iter().any(|v| !v.is_finite() || *v <= 0.0)
        || p.floors[0] == 0
        || !p.width_m[0].is_finite()
        || !p.depth_m[0].is_finite()
    {
        return Err("Morphology: invalid resolved architectural dimensions.".into());
    }
    let family = family(p).unwrap();
    if let Some(target) = target_footprint {
        if !contained(&construction, target) {
            return Err("Morphology: imposed footprint crosses the envelope, a reserved hole or its declared enclosure clearance.".into());
        }
        return exact_footprint(p, role, envelope, target, minimum, family);
    }
    let b = bounds(&construction);
    let span = [b[2] - b[0], b[3] - b[1]];
    let required = minimum_extent(p, family, minimum).map(|v| libm::ceil(v / GRID_M) * GRID_M);
    if span[0] + EPS < required[0] || span[1] + EPS < required[1] {
        return Err(format!(
            "Morphology: available span {:.3} x {:.3} m cannot preserve minimum ranges/court/access ({:.3} x {:.3} m).",
            span[0], span[1], required[0], required[1]
        ));
    }
    let desired = [
        p.width_m[0].max(required[0]).min(span[0]),
        p.depth_m[0].max(required[1]).min(span[1]),
    ];
    let root = Rng::new(seed).fork("constrained-morphology-v1");
    for i in 0..MAX_CANDIDATES + MINIMUM_CANDIDATES {
        let mut rng = root.fork(&format!("candidate:{i}"));
        // Coverage/aspect are occupation targets, not physical minima. A long
        // or tapered parcel can have a large bounding box while only a small
        // admissible range fits inside it. Reserve a bounded final search for
        // the actual room/stair/court/access minima instead of stopping at 55%
        // of the requested size and wrongly rejecting an otherwise usable lot.
        let minimum_candidate = i >= MAX_CANDIDATES;
        let (w, d) = if minimum_candidate {
            (required[0], required[1])
        } else {
            let scale = if i < 4 { 1.0 } else { rng.range(0.55, 1.0) };
            (
                snap((desired[0] * scale).max(required[0]).min(span[0])),
                snap(
                    (desired[1] * if i < 4 { 1.0 } else { rng.range(0.55, 1.0) })
                        .max(required[1])
                        .min(span[1]),
                ),
            )
        };
        // The first four candidates cover the corners, then seeded positions
        // distribute the same architectural programme around concavities/holes.
        let (fx, fy) = match i {
            0 => (0.0, 0.0),
            1 => (1.0, 0.0),
            2 => (0.0, 1.0),
            3 => (1.0, 1.0),
            j if j >= MAX_CANDIDATES && j < MAX_CANDIDATES + 9 => {
                let j = j - MAX_CANDIDATES;
                let positions = [0.5, 0.0, 1.0];
                (positions[j % 3], positions[j / 3])
            }
            _ => (rng.float(), rng.float()),
        };
        let outer = Range::new(b[0] + (span[0] - w) * fx, b[1] + (span[1] - d) * fy, w, d);
        let candidate = make_candidate(p, family, outer, minimum, &mut rng);
        if candidate.ranges.is_empty()
            || candidate
                .ranges
                .iter()
                .any(|r| !r.valid(minimum) || !contained(&construction, &r.surface()))
            || (!candidate.court.is_empty() && !contained(envelope, &candidate.court))
            || (!candidate.path.is_empty() && !contained(envelope, &candidate.path))
        {
            continue;
        }
        return materialize(p, role, envelope, candidate, false);
    }
    Err(format!(
        "Morphology: no admissible composition within {} bounded candidates; no body was clipped or required range/court removed.",
        MAX_CANDIDATES + MINIMUM_CANDIDATES
    ))
}

/// Recompose heterogeneous components that were already resolved by the native
/// source programme. Main/adjacent is the declared topology; source identities,
/// quantities, heights, roof systems and materials are retained independently.
pub(crate) fn synthesize_components(
    p: &Parameters,
    native: &LayoutPlan,
    envelope: &Surface,
    seed: &str,
    target_footprint: Option<&Surface>,
) -> Result<LayoutPlan, String> {
    if !supports_components(p) {
        return Err(
            "Morphology: no constrained operator for this authored component programme.".into(),
        );
    }
    if target_footprint.is_some() {
        return Err("Morphology: a heterogeneous component programme cannot be assigned to an imposed union footprint without explicit component domains.".into());
    }
    validate_surface(envelope, "component envelope")?;
    if !native.features.is_empty() || !native.courts.is_empty() || !native.paths.is_empty() {
        return Err("Morphology: authored component features/courts/access must retain their dedicated native layout.".into());
    }
    if native.bodies.len() < 2 || native.bodies.len() > MAX_RANGES {
        return Err("Morphology: invalid retained component count.".into());
    }
    for component in &p.components {
        if component.count[0] != component.count[1]
            || native
                .bodies
                .iter()
                .filter(|b| b.component.as_deref() == Some(component.id.as_str()))
                .count()
                != component.count[0] as usize
        {
            return Err("Morphology: retained component identities/counts differ from the resolved source programme.".into());
        }
    }
    let main_id = &p
        .components
        .iter()
        .find(|c| c.placement == Placement::Main)
        .unwrap()
        .id;
    let main_index = native
        .bodies
        .iter()
        .position(|b| b.component.as_ref() == Some(main_id))
        .ok_or("Morphology: missing retained main component.")?;
    let mut sizes = vec![];
    let mut minima = vec![];
    for body in &native.bodies {
        let b = bounds(&body.footprint);
        let rectangular = rectangle(b[0], b[1], b[2] - b[0], b[3] - b[1]);
        if !body.voids.is_empty()
            || !body.cells.is_empty()
            || body.levels.len() != body.parameters.floors[0] as usize
            || area(&difference(&rectangular, &body.footprint)) > EPS
        {
            return Err(
                "Morphology: this retained component has non-rectangular structural constraints."
                    .into(),
            );
        }
        sizes.push([b[2] - b[0], b[3] - b[1]]);
        let mut minimum = minimum_domain(&body.parameters).map(|v| libm::ceil(v / GRID_M) * GRID_M);
        if matches!(
            body.parameters.footprint_family.as_str(),
            "FP-SQUARE" | "FP-TOWER"
        ) {
            minimum = [minimum[0].max(minimum[1]); 2];
        }
        minima.push(minimum);
    }
    let inset = p
        .enclosures
        .iter()
        .any(|s| s.family != EnclosureFamily::None && s.placement != Placement::Central);
    let construction = if inset {
        offset(envelope, -0.75)
    } else {
        envelope.clone()
    };
    if construction.is_empty() {
        return Err("Morphology: no construction area remains inside the source enclosure.".into());
    }
    let b = bounds(&construction);
    let span = [b[2] - b[0], b[3] - b[1]];
    let root = Rng::new(seed).fork("constrained-components-v1");
    // The existing native Main/Adjacent operator requires 1.4 m of separation.
    // Preserve that physical passage rather than silently turning tower and
    // dwelling into overlapping structural bodies or a fictitious joint roof.
    const COMPONENT_GAP: f64 = 1.4;
    for attempt in 0..MAX_CANDIDATES {
        let mut rng = root.fork(&format!("candidate:{attempt}"));
        let dimensions: Vec<_> = native
            .bodies
            .iter()
            .enumerate()
            .map(|(i, body)| {
                let mut size = [
                    snap((sizes[i][0] * rng.range(0.78, 1.16)).max(minima[i][0])),
                    snap((sizes[i][1] * rng.range(0.78, 1.16)).max(minima[i][1])),
                ];
                if matches!(
                    body.parameters.footprint_family.as_str(),
                    "FP-SQUARE" | "FP-TOWER"
                ) {
                    size = [size[0].max(size[1]); 2];
                }
                size
            })
            .collect();
        let main = Range::new(0., 0., dimensions[main_index][0], dimensions[main_index][1]);
        let mut ranges = vec![None; native.bodies.len()];
        ranges[main_index] = Some(main);
        for (index, size) in dimensions
            .iter()
            .enumerate()
            .filter(|(i, _)| *i != main_index)
        {
            for _ in 0..24 {
                let side = rng.int(0, 3);
                let along = rng.range(-0.15, 1.15);
                let candidate = match side {
                    0 => Range::new(
                        -size[0] - COMPONENT_GAP,
                        (main.d - size[1]) * along,
                        size[0],
                        size[1],
                    ),
                    1 => Range::new(
                        main.w + COMPONENT_GAP,
                        (main.d - size[1]) * along,
                        size[0],
                        size[1],
                    ),
                    2 => Range::new(
                        (main.w - size[0]) * along,
                        -size[1] - COMPONENT_GAP,
                        size[0],
                        size[1],
                    ),
                    _ => Range::new(
                        (main.w - size[0]) * along,
                        main.d + COMPONENT_GAP,
                        size[0],
                        size[1],
                    ),
                };
                let margin = Range::new(
                    candidate.x - COMPONENT_GAP,
                    candidate.y - COMPONENT_GAP,
                    candidate.w + 2. * COMPONENT_GAP,
                    candidate.d + 2. * COMPONENT_GAP,
                );
                if !ranges
                    .iter()
                    .flatten()
                    .any(|existing| margin.overlaps(*existing))
                {
                    ranges[index] = Some(candidate);
                    break;
                }
            }
        }
        if ranges.iter().any(Option::is_none) {
            continue;
        }
        let mut ranges: Vec<Range> = ranges.into_iter().map(Option::unwrap).collect();
        let cluster = bounds(&unite(
            &ranges.iter().map(|r| r.surface()).collect::<Vec<_>>(),
        ));
        let extent = [cluster[2] - cluster[0], cluster[3] - cluster[1]];
        if extent[0] > span[0] + EPS || extent[1] > span[1] + EPS {
            continue;
        }
        let align = match attempt {
            0 => [0.5, 0.5],
            1 => [0., 0.],
            2 => [1., 0.],
            3 => [0., 1.],
            4 => [1., 1.],
            _ => [rng.float(), rng.float()],
        };
        let shift = [
            snap(b[0] + (span[0] - extent[0]) * align[0] - cluster[0]),
            snap(b[1] + (span[1] - extent[1]) * align[1] - cluster[1]),
        ];
        for r in &mut ranges {
            r.x = snap(r.x + shift[0]);
            r.y = snap(r.y + shift[1]);
        }
        if ranges
            .iter()
            .any(|r| !contained(&construction, &r.surface()))
        {
            continue;
        }
        let bodies = native
            .bodies
            .iter()
            .zip(&ranges)
            .map(|(retained, r)| {
                let mut body = spec(r.surface(), &retained.parameters, retained.role);
                body.component = retained.component.clone();
                body
            })
            .collect();
        return Ok(LayoutPlan {
            lot: envelope.clone(),
            courts: vec![],
            paths: vec![],
            bodies,
            features: vec![],
            context: vec![],
            diagnostics: vec![format!(
                "Constrained component morphology v1: {} retained source components arranged by declared Main/Adjacent relationships with 1.4 m clear passage; component IDs, quantities, individual materials, floors and roof systems are unchanged. Seeded inspired dimensions/side placement, not measured historical reconstruction.",
                native.bodies.len()
            )],
        });
    }
    Err(format!(
        "Morphology: no admissible source-component assembly within {MAX_CANDIDATES} candidates; no required component was removed or replaced."
    ))
}

fn orthogonal_ranges(target: &Surface, transpose: bool) -> Result<Vec<Range>, String> {
    let mut xs = vec![];
    let mut ys = vec![];
    for polygon in target {
        for ring in std::iter::once(&polygon.outer).chain(polygon.holes.iter()) {
            for (a, b) in ring
                .iter()
                .zip(ring.iter().cycle().skip(1))
                .take(ring.len())
            {
                if (a.x - b.x).abs() > EPS && (a.y - b.y).abs() > EPS {
                    return Err("Morphology: imposed footprint needs an orthogonal decomposition in the supplied local frame.".into());
                }
                xs.push(if transpose { a.y } else { a.x });
                ys.push(if transpose { a.x } else { a.y });
            }
        }
    }
    xs.sort_by(f64::total_cmp);
    xs.dedup_by(|a, b| (*a - *b).abs() < EPS);
    ys.sort_by(f64::total_cmp);
    ys.dedup_by(|a, b| (*a - *b).abs() < EPS);
    if xs.len() > 32 || ys.len() > 32 {
        return Err("Morphology: imposed footprint exceeds the bounded decomposition grid (32 coordinates per axis).".into());
    }
    let mut runs: Vec<Range> = vec![];
    for row in ys.windows(2) {
        let mut start = None;
        for col in 0..xs.len() - 1 {
            let s = if transpose {
                rectangle(row[0], xs[col], row[1] - row[0], xs[col + 1] - xs[col])
            } else {
                rectangle(xs[col], row[0], xs[col + 1] - xs[col], row[1] - row[0])
            };
            let inside = contained(target, &s);
            if inside && start.is_none() {
                start = Some(xs[col]);
            }
            if let Some(x) = start
                && (!inside || col == xs.len() - 2)
            {
                let end = if inside { xs[col + 1] } else { xs[col] };
                if let Some(previous) = runs.iter_mut().find(|r| {
                    (r.x - x).abs() < EPS
                        && (r.w - (end - x)).abs() < EPS
                        && (r.y + r.d - row[0]).abs() < EPS
                }) {
                    previous.d = snap(row[1] - previous.y);
                } else {
                    runs.push(Range::new(x, row[0], end - x, row[1] - row[0]));
                }
                start = None;
            }
        }
    }
    if transpose {
        for r in &mut runs {
            *r = Range::new(r.y, r.x, r.d, r.w);
        }
    }
    Ok(runs)
}

fn exact_footprint(
    p: &Parameters,
    role: Role,
    envelope: &Surface,
    target: &Surface,
    minimum: [f64; 2],
    family: Family,
) -> Result<LayoutPlan, String> {
    validate_surface(target, "footprint")?;
    if !contained(envelope, target) {
        return Err(
            "Morphology: imposed footprint crosses the envelope or one of its reserved holes."
                .into(),
        );
    }
    if target.len() != 1 || target.iter().any(|p| !p.holes.is_empty()) || family == Family::Court {
        return Err("Morphology: this imposed footprint requires an authored disconnected/closed-court access programme; exact fitting is unsupported.".into());
    }
    let mut options = vec![
        orthogonal_ranges(target, false)?,
        orthogonal_ranges(target, true)?,
    ];
    options.sort_by_key(Vec::len);
    let outer = &target[0].outer;
    let corners = (0..outer.len())
        .filter(|&i| {
            let a = outer[(i + outer.len() - 1) % outer.len()];
            let b = outer[i];
            let c = outer[(i + 1) % outer.len()];
            ((b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x)).abs() > EPS
        })
        .count();
    let target_bounds = bounds(target);
    let notch = difference(
        &rectangle(
            target_bounds[0],
            target_bounds[1],
            target_bounds[2] - target_bounds[0],
            target_bounds[3] - target_bounds[1],
        ),
        target,
    );
    for ranges in options {
        let count = ranges.len();
        let compatible = match family {
            Family::Rectangle | Family::Row => count == 1,
            Family::Elbow => count == 2 && corners == 6 && notch.len() == 1,
            Family::OpenCourt => count == 3 && corners == 8 && notch.len() == 1,
            Family::Compound => {
                (2..=MAX_RANGES).contains(&count)
                    && (p.layout != Layout::Additive || count == p.bodies[0] as usize)
            }
            Family::Court => false,
        };
        if !compatible || ranges.iter().any(|r| !r.valid(minimum)) {
            continue;
        }
        let occupied = unite(&ranges.iter().map(|r| r.surface()).collect::<Vec<_>>());
        if area(&difference(target, &occupied)) + area(&difference(&occupied, target)) > EPS {
            continue;
        }
        // A row/court has an essential open-space programme; a fixed footprint
        // cannot silently discard it merely because the roofs themselves fit.
        let open = difference(envelope, target);
        let mut court = vec![];
        let mut path = vec![];
        if family == Family::Row {
            let r = ranges[0];
            court = rectangle(r.x, r.y - COURT_CLEARANCE, r.w, COURT_CLEARANCE);
            path = rectangle(
                r.x + r.w,
                r.y - COURT_CLEARANCE,
                ROW_PASSAGE,
                r.d + COURT_CLEARANCE,
            );
            if !contained(&open, &court) || !contained(&open, &path) {
                continue;
            }
        } else if p.layout == Layout::Courtyard {
            // Open L/U courts must retain a whole clear area within the actual
            // open complement, rather than declaring leftover slivers a court.
            let b = bounds(target);
            let clear = rectangle(
                (b[0] + b[2]) * 0.5 - COURT_CLEARANCE * 0.5,
                b[3] - COURT_CLEARANCE,
                COURT_CLEARANCE,
                COURT_CLEARANCE,
            );
            if !contained(&open, &clear) {
                continue;
            }
            court = intersection(&open, &rectangle(b[0], b[1], b[2] - b[0], b[3] - b[1]));
            if area(&court) + EPS < p.courtyard_ratio[0] * (b[2] - b[0]) * (b[3] - b[1]) {
                continue;
            }
            path = clear;
        }
        return materialize(
            p,
            role,
            envelope,
            Candidate {
                ranges,
                court,
                path,
                gate_range: None,
            },
            true,
        );
    }
    Err("Morphology: imposed footprint is incompatible with the declared topology, retained body count, minimum habitable widths or required court/access.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{ResolvedArchitecture, model::HouseConfig, resolve_architecture};

    fn resolved(recipe: &str) -> ResolvedArchitecture {
        resolve_architecture(HouseConfig {
            recipe: Some(recipe.into()),
            pack: recipe.rsplit_once("-B").unwrap().0.into(),
            count: 1,
            seed: "morphology-regression".into(),
            ..HouseConfig::default()
        })
        .unwrap()
    }

    fn assert_plan(plan: &LayoutPlan, envelope: &Surface) {
        for body in &plan.bodies {
            assert!(area(&body.footprint) > 0.0);
            assert!(contained(envelope, &body.footprint));
            assert!(body.levels.iter().all(|l| contained(envelope, l)));
        }
        for (i, a) in plan.bodies.iter().enumerate() {
            for b in plan.bodies.iter().skip(i + 1) {
                assert!(area(&intersection(&a.footprint, &b.footprint)) < EPS);
            }
        }
        assert!(contained(envelope, &plan.courts));
        assert!(contained(envelope, &plan.paths));
    }

    #[test]
    fn row_keeps_yard_passage_and_exact_seed_replay() {
        let r = resolved("EUR-MED-B02");
        let site = rectangle(0., 0., 12., 24.);
        let a = synthesize(&r.parameters, Role::Dwelling, &site, "row", None).unwrap();
        let b = synthesize(&r.parameters, Role::Dwelling, &site, "row", None).unwrap();
        assert_eq!(
            serde_json::to_value(&a).unwrap(),
            serde_json::to_value(&b).unwrap()
        );
        assert_plan(&a, &site);
        assert_eq!(a.bodies.len(), 1);
        assert!(area(&a.courts) >= COURT_CLEARANCE * minimum_domain(&r.parameters)[0]);
        assert!(area(&a.paths) >= ROW_PASSAGE * minimum_domain(&r.parameters)[1]);
    }

    #[test]
    fn compound_variation_changes_composition_without_losing_ranges() {
        let r = resolved("AF-EAST-B08");
        let site = rectangle(0., 0., 100., 70.);
        let mut signatures = std::collections::BTreeSet::new();
        for i in 0..12 {
            let plan = synthesize(
                &r.parameters,
                Role::Dwelling,
                &site,
                &format!("compound:{i}"),
                None,
            )
            .unwrap();
            assert_plan(&plan, &site);
            assert_eq!(plan.bodies.len(), r.parameters.bodies[0] as usize);
            signatures.insert(
                serde_json::to_string(
                    &plan.bodies.iter().map(|b| &b.footprint).collect::<Vec<_>>(),
                )
                .unwrap(),
            );
        }
        assert!(signatures.len() >= 10);
    }

    #[test]
    fn courtyards_are_real_reserved_space_and_ranges_keep_minimum_widths() {
        for recipe in ["EUR-MED-B06", "MED-ANT-B08"] {
            let r = resolved(recipe);
            let site = rectangle(0., 0., 90., 90.);
            let plan = synthesize(&r.parameters, Role::Dwelling, &site, "court", None).unwrap();
            assert_plan(&plan, &site);
            assert_eq!(plan.bodies.len(), r.parameters.bodies[0] as usize);
            assert!(area(&plan.courts) >= COURT_CLEARANCE * COURT_CLEARANCE);
            let occupied = unite(
                &plan
                    .bodies
                    .iter()
                    .map(|b| b.footprint.clone())
                    .collect::<Vec<_>>(),
            );
            let b = bounds(&occupied);
            assert!(
                area(&plan.courts)
                    >= r.parameters.courtyard_ratio[0] * (b[2] - b[0]) * (b[3] - b[1]) * 0.999
            );
            assert!(area(&plan.paths) > 0.0);
            let minimum = minimum_domain(&r.parameters);
            for body in &plan.bodies {
                let b = bounds(&body.footprint);
                assert!(b[2] - b[0] + EPS >= minimum[0]);
                assert!(b[3] - b[1] + EPS >= minimum[1]);
                assert!(area(&intersection(&body.footprint, &plan.courts)) < EPS);
            }
        }
    }

    #[test]
    fn imposed_elbow_exactly_fits_concavity_and_rejects_reserved_hole() {
        let mut r = resolved("EUR-MED-B01");
        r.parameters.footprint_family = "FP-L".into();
        r.parameters.allowed_footprints = vec!["FP-L".into()];
        let target = union(&rectangle(0., 0., 20., 8.), &rectangle(0., 8., 8., 16.));
        let envelope = union(&target, &rectangle(20., 0., 4., 8.));
        let plan = synthesize(
            &r.parameters,
            Role::Dwelling,
            &envelope,
            "elbow",
            Some(&target),
        )
        .unwrap();
        assert_plan(&plan, &envelope);
        assert!(area(&difference(&target, &plan.bodies[0].footprint)) < EPS);
        assert!(area(&difference(&plan.bodies[0].footprint, &target)) < EPS);
        let blocked = difference(&envelope, &rectangle(2., 2., 2., 2.));
        assert!(
            synthesize(
                &r.parameters,
                Role::Dwelling,
                &blocked,
                "elbow",
                Some(&target)
            )
            .err()
            .unwrap()
            .contains("reserved hole")
        );
    }

    #[test]
    fn free_composition_respects_holes_and_unusable_sites_refuse() {
        let r = resolved("EUR-MED-B01");
        let site = difference(&rectangle(0., 0., 36., 30.), &rectangle(12., 8., 8., 10.));
        let plan = synthesize(&r.parameters, Role::Dwelling, &site, "hole", None).unwrap();
        assert_plan(&plan, &site);
        assert!(
            synthesize(
                &r.parameters,
                Role::Dwelling,
                &rectangle(0., 0., 1., 100.),
                "small",
                None
            )
            .is_err()
        );
        let triangle = vec![crate::model::Polygon {
            outer: vec![point(0., 0.), point(20., 0.), point(0., 20.)],
            holes: vec![],
        }];
        assert!(
            synthesize(
                &r.parameters,
                Role::Dwelling,
                &rectangle(0., 0., 30., 30.),
                "triangle",
                Some(&triangle)
            )
            .is_err()
        );
    }

    #[test]
    fn opt_in_adaptation_keeps_native_route_and_strict_mode_unchanged() {
        let original = resolved("EUR-MED-B02");
        let before = serde_json::to_value(&original).unwrap();
        let site = rectangle(0., 0., 14., 30.);
        let adapted = crate::engine::adapt_resolved_architecture(&original, &site, None).unwrap();
        assert_eq!(serde_json::to_value(&original).unwrap(), before);
        assert_eq!(adapted.parameters.floors, original.parameters.floors);
        assert_eq!(adapted.parameters.materials, original.parameters.materials);
        assert_ne!(
            adapted.plan.bodies[0].footprint,
            original.plan.bodies[0].footprint
        );
        let replay = crate::engine::adapt_resolved_architecture(&original, &site, None).unwrap();
        assert_eq!(
            serde_json::to_value(&adapted).unwrap(),
            serde_json::to_value(&replay).unwrap()
        );
        let mut strict = original;
        strict.config.mode = crate::model::HistoricalMode::HistoricalStrict;
        assert!(crate::engine::adapt_resolved_architecture(&strict, &site, None).is_err());
    }

    #[test]
    fn retained_row_court_and_compound_generate_native_roofs_without_reroll() {
        for recipe in ["EUR-MED-B02", "EUR-MED-B06", "AF-EAST-B08", "EUR-MED-B07"] {
            let original = resolved(recipe);
            let adapted = crate::engine::adapt_resolved_architecture(
                &original,
                &rectangle(0., 0., 100., 90.),
                None,
            )
            .unwrap();
            let volume = crate::engine::volume_unit(&adapted).unwrap();
            assert!(!volume.roofs.faces.is_empty(), "{recipe}");
            assert_eq!(volume.bodies.len(), adapted.plan.bodies.len());
            for (body, retained) in volume.bodies.iter().zip(&adapted.plan.bodies) {
                assert_eq!(body.footprint, retained.footprint, "{recipe}");
                assert_eq!(body.levels.len(), retained.levels.len());
                for (level, footprint) in body.levels.iter().zip(&retained.levels) {
                    assert_eq!(level.footprint, *footprint, "{recipe}");
                }
            }
        }
    }

    #[test]
    fn row_enrichment_keeps_the_adapted_footprint_and_levels() {
        let original = resolved("EUR-MED-B02");
        let adapted = crate::engine::adapt_resolved_architecture(
            &original,
            &rectangle(0., 0., 18., 32.),
            None,
        )
        .unwrap();
        // enrich_architecture itself audits exact body, level and structural
        // roof continuity against volume_unit; this exercises that contract.
        let detailed = crate::enrich_architecture(&adapted).unwrap();
        assert_eq!(
            detailed.units[0].bodies[0].footprint,
            adapted.plan.bodies[0].footprint
        );
    }

    #[test]
    fn european_source_house_and_tower_vary_without_losing_component_identity() {
        let original = resolved("EUR-MED-B07");
        assert!(supports_components(&original.parameters));
        assert!(supports(&original.parameters));
        assert!(!supports_imposed(&original.parameters));
        let source = serde_json::to_value(&original).unwrap();
        let site = difference(&rectangle(0., 0., 40., 40.), &rectangle(16., 16., 8., 8.));
        let mut signatures = std::collections::BTreeSet::new();
        for i in 0..12 {
            let mut seeded = original.clone();
            seeded.config.seed = format!("european-components:{i}");
            let adapted = crate::engine::adapt_resolved_architecture(&seeded, &site, None).unwrap();
            assert_plan(&adapted.plan, &site);
            assert_eq!(adapted.plan.bodies.len(), original.plan.bodies.len());
            for (body, retained) in adapted.plan.bodies.iter().zip(&original.plan.bodies) {
                assert_eq!(body.component, retained.component);
                assert_eq!(body.parameters.roof_system, retained.parameters.roof_system);
                assert_eq!(body.parameters.floors, retained.parameters.floors);
                assert_eq!(body.parameters.materials, retained.parameters.materials);
                let b = bounds(&body.footprint);
                let minimum = minimum_domain(&body.parameters);
                assert!(b[2] - b[0] + EPS >= minimum[0] && b[3] - b[1] + EPS >= minimum[1]);
                if body.component.as_deref() == Some("tower") {
                    assert_eq!(body.parameters.roof_system, "RF-FLAT");
                    assert!((b[2] - b[0] - (b[3] - b[1])).abs() < EPS);
                }
            }
            for (i, a) in adapted.plan.bodies.iter().enumerate() {
                for b in adapted.plan.bodies.iter().skip(i + 1) {
                    assert!(
                        area(&intersection(
                            &offset(&a.footprint, 0.7),
                            &offset(&b.footprint, 0.7)
                        )) < EPS
                    );
                }
            }
            signatures.insert(
                serde_json::to_string(
                    &adapted
                        .plan
                        .bodies
                        .iter()
                        .map(|b| &b.footprint)
                        .collect::<Vec<_>>(),
                )
                .unwrap(),
            );
            let replay = crate::engine::adapt_resolved_architecture(&seeded, &site, None).unwrap();
            assert_eq!(
                serde_json::to_value(&adapted).unwrap(),
                serde_json::to_value(&replay).unwrap()
            );
        }
        assert!(signatures.len() >= 10);
        assert_eq!(serde_json::to_value(&original).unwrap(), source);
        assert!(
            crate::engine::adapt_resolved_architecture(&original, &rectangle(0., 0., 3., 3.), None)
                .is_err()
        );
    }

    #[test]
    fn house_and_tower_interiors_preserve_native_roofs_and_retained_geometry() {
        let original = resolved("EUR-MED-B07");
        let adapted = crate::engine::adapt_resolved_architecture(
            &original,
            &rectangle(0., 0., 40., 40.),
            None,
        )
        .unwrap();
        let retained = serde_json::to_value(&adapted).unwrap();
        // Native portal corrections let this formerly refused seed keep its
        // roofs through enrichment. The engine still audits exact native roof
        // surfaces, bodies and levels before returning either detailed model.
        let original_detail = crate::enrich_architecture(&original).unwrap();
        let adapted_detail = crate::enrich_architecture(&adapted).unwrap();
        for (plan, detail) in [(&original, &original_detail), (&adapted, &adapted_detail)] {
            assert_eq!(detail.units[0].bodies.len(), plan.plan.bodies.len());
            for (body, spec) in detail.units[0].bodies.iter().zip(&plan.plan.bodies) {
                assert_eq!(body.footprint, spec.footprint);
                assert_eq!(body.levels.len(), spec.levels.len());
                for (level, footprint) in body.levels.iter().zip(&spec.levels) {
                    assert_eq!(&level.footprint, footprint);
                }
            }
        }
        assert_eq!(serde_json::to_value(&adapted).unwrap(), retained);
        let volume = crate::engine::volume_unit(&adapted).unwrap();
        assert_eq!(volume.bodies.len(), 2);
        assert!(!volume.roofs.faces.is_empty());
        assert!(
            volume
                .bodies
                .iter()
                .any(|body| body.component_id.as_deref() == Some("tower"))
        );
    }
}
