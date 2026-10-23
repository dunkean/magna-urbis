//! Isolated bridge from one resolved native source to the convex rectangle
//! kernel. Not called by production. No style/orientation search or new draws.
//! A candidate is still subject to native terrain, roof and access admission.
use crate::catalogue::{
    EnclosureFamily, Envelope, Layout, Recipe, SupportKind, VerticalAccess, catalogue,
};
use crate::direct_convex_fit::{
    FitOutcome, FixedFrontSite, Margins, RectangleFit, RectangleModel, solve_rectangle,
};
use crate::engine::ResolvedArchitecture;
use crate::geometry::{GRID_M, area, difference, rectangle, snap, unite};
use crate::layouts::{build_layout, minimum_domain};
use crate::model::{HistoricalMode, Overrides, Point, Surface, Transform};
use crate::placement::{ArchitectureFunction, PlacementRequest};

pub(crate) enum Preparation<'a> {
    Ready(NativeSingleRectangle<'a>),
    Unsupported(String),
}

/// Bound to one immutable resolved draw bundle. `identity` is diagnostic, not
/// a global cache key. The native seed is supplied by the draw owner verbatim.
pub(crate) struct NativeSingleRectangle<'a> {
    original: &'a ResolvedArchitecture,
    recipe: &'static Recipe,
    native_layout_seed: String,
    model: RectangleModel,
}

pub(crate) enum NativeFitOutcome {
    Candidate(NativeRectangleCandidate),
    EmptyFixedDomain,
    Unsupported(String),
}

pub(crate) struct NativeRectangleCandidate {
    pub resolved: ResolvedArchitecture,
    /// In the same front frame as the supplied domains. Native +y (the usual
    /// street side) faces the front by a rigid half turn; nothing is reflected.
    pub transform: Transform,
    pub analytical: RectangleFit,
    pub nominal_dimensions_m: [f64; 2],
    pub body_area_m2: f64,
    pub target_error_m2: f64,
}

/// Prepare scalars only. The request is the ORIGINAL urban request, before
/// internal recipe/variant selection. Explicit controls keep their old path.
pub(crate) fn prepare<'a>(
    request: &PlacementRequest,
    resolved: &'a ResolvedArchitecture,
    native_layout_seed: &str,
    exact_or_imposed: bool,
    parcel_fit: bool,
) -> Result<Preparation<'a>, String> {
    let unsupported = |s: &str| Ok(Preparation::Unsupported(s.into()));
    if exact_or_imposed
        || !parcel_fit
        || request.culture.mode != HistoricalMode::HistoricalInspired
        || resolved.config.mode != HistoricalMode::HistoricalInspired
        || !matches!(
            request.function,
            ArchitectureFunction::Domestic | ArchitectureFunction::Mixed
        )
        || request.config.as_ref().is_some_and(|c| {
            c.recipe.is_some()
                || c.workshop.is_some()
                || c.overrides != Overrides::default()
                || c.mode != HistoricalMode::HistoricalInspired
        })
    {
        return unsupported(
            "Direct native rectangle is opt-in automatic inspired domestic fitting; explicit, exact and strict controls retain their current path.",
        );
    }
    if resolved.generator_version != crate::GENERATOR_VERSION
        || resolved.schema_version != crate::SCHEMA_VERSION
        || resolved.config.count != 1
        || resolved.config.workshop.is_some()
        || native_layout_seed.is_empty()
    {
        return unsupported(
            "Direct native rectangle requires one compatible atlas draw bundle and its original native layout seed.",
        );
    }
    let p = &resolved.parameters;
    // No implied porch, court, gallery, enclosure, jetty or secondary body is
    // permitted. These require an affine domain descriptor, not a box proxy.
    if p.layout != Layout::Single
        || p.footprint_family != "FP-RECT"
        || p.support.kind != SupportKind::Ground
        || p.support.height_m != [0., 0.]
        || p.envelope != Envelope::Walled
        || p.elevation_family != "ground"
        || p.bodies != [1, 1]
        || p.floors != [1, 1]
        || p.cells != [0, 0]
        || !p.details.is_empty()
        || p.detail_spec.is_some()
        || p.gallery_cover.enabled
        || p.gallery_cover.facade_mode.is_some()
        || p.enclosure_family != EnclosureFamily::None
        || !p.enclosures.is_empty()
        || p.court_program.is_some()
        || p.structural_spec.is_some()
        || p.portal_profile.is_some()
        || p.site_gate_profile.is_some()
        || p.shell.is_some()
        || p.roof_spec.shell.is_some()
        || p.roof_spec.corbel.is_some()
        || p.roof_spec.vault.is_some()
        || p.roof_spec.drainage.is_some()
        || p.roof_spec.horns.is_some()
        || p.roof_spec.triangulation.is_some()
        || !matches!(p.roof_system.as_str(), "RF-GABLE" | "RF-HIP")
        || p.vertical_access != VerticalAccess::None
        || !p.vertical_routes.is_empty()
        || !(p.components.is_empty() || p.components.len() == 1 && p.components[0].id == "main")
    {
        return unsupported(
            "Only a declared plain single-storey Single/FP-RECT ground/walled body with gable/hip roof is represented; compound, strip, circulation and unknown support programmes remain on their existing path.",
        );
    }
    if p.width_m[0] != p.width_m[1]
        || p.depth_m[0] != p.depth_m[1]
        || p.overhang_m[0] != p.overhang_m[1]
        || !p.overhang_m[0].is_finite()
        || !(0. ..=6.).contains(&p.overhang_m[0])
        || resolved.entrance.is_some()
        || !plain_native_plan(resolved)
    {
        return unsupported(
            "The retained body must be the unadapted native rectangle with fixed draws and no structural entrance to invalidate.",
        );
    }
    let data = catalogue()?;
    let recipe = data
        .recipes
        .iter()
        .find(|r| r.id == resolved.recipe_id)
        .ok_or("Unknown native rectangle recipe.")?;
    let bounds = data.resolve_variant_parameters(recipe, &resolved.config, &p.variant_id)?;
    let minimum = minimum_domain(p);
    let mut ranges = [bounds.width_m, bounds.depth_m];
    for (axis, r) in ranges.iter_mut().enumerate() {
        // The existing inspired parcel-fit allowance is ×2. This descriptor
        // neither changes that policy nor treats an admission witness as a cap.
        r[0] =
            libm::ceil((r[0] * resolved.config.size).max(minimum[axis]).max(2.) / GRID_M) * GRID_M;
        r[1] = libm::floor((r[1] * resolved.config.size * 2.).min(200.) / GRID_M) * GRID_M;
        if !r.iter().all(|v| v.is_finite() && *v > 0.) || r[0] > r[1] {
            return unsupported(
                "No source/minimum range is representable on the native millimetre grid.",
            );
        }
    }
    // In this scope each native eave offsets one rectangular body edge by the
    // same drawn overhang. No court/party edge/attachment changes that offset.
    // Round out and reserve one grid unit for native roof-coordinate snapping.
    // This is a conservative enclosing rectangle, not a certified roof mesh.
    let overhang = libm::ceil(p.overhang_m[0] / GRID_M) * GRID_M + GRID_M;
    let model = RectangleModel {
        identity: format!(
            "native-single-rectangle-v1:{}:{}:{}",
            resolved.recipe_id, p.variant_id, native_layout_seed
        ),
        width_m: ranges[0],
        depth_m: ranges[1],
        architectural_margins: Margins::default(),
        roof_margins: Margins {
            left: overhang,
            right: overhang,
            front: overhang,
            back: overhang,
        },
    };
    Ok(Preparation::Ready(NativeSingleRectangle {
        original: resolved,
        recipe,
        native_layout_seed: native_layout_seed.into(),
        model,
    }))
}

fn plain_native_plan(resolved: &ResolvedArchitecture) -> bool {
    let p = &resolved.parameters;
    let plan = &resolved.plan;
    let Some(body) = plan.bodies.first() else {
        return false;
    };
    let (Ok(body_parameters), Ok(source_parameters)) =
        (serde_json::to_vec(&body.parameters), serde_json::to_vec(p))
    else {
        return false;
    };
    plan.bodies.len() == 1
        && plan.courts.is_empty()
        && plan.paths.is_empty()
        && plan.features.is_empty()
        && plan.bodies[0].z == 0.
        && plan.bodies[0].voids.is_empty()
        && plan.bodies[0].cells.is_empty()
        && plan.bodies[0].footprint == unite(&[rectangle(0., 0., p.width_m[0], p.depth_m[0])])
        && plan.bodies[0].levels == vec![plan.bodies[0].footprint.clone()]
        && body_parameters == source_parameters
}

fn transformed(surface: &Surface, t: &Transform) -> Surface {
    let (sin, cos) = (
        libm::sin(t.orientation_deg.to_radians()),
        libm::cos(t.orientation_deg.to_radians()),
    );
    let mut world = surface.clone();
    for polygon in &mut world {
        for ring in std::iter::once(&mut polygon.outer).chain(polygon.holes.iter_mut()) {
            for q in ring {
                *q = Point {
                    x: t.origin.x + cos * q.x - sin * q.y,
                    y: t.origin.y + sin * q.x + cos * q.y,
                };
            }
        }
    }
    world
}

impl NativeSingleRectangle<'_> {
    /// One continuous solve, inward grid quantization, then ONE native layout.
    /// No roof mesh/interiors, no repeated dimension or pose construction.
    pub(crate) fn solve(
        &self,
        site: &FixedFrontSite<'_>,
        target_m2: f64,
    ) -> Result<NativeFitOutcome, String> {
        let preferred_aspect =
            self.original.parameters.width_m[0] / self.original.parameters.depth_m[0];
        let analytical = match solve_rectangle(&self.model, site, target_m2, preferred_aspect)? {
            FitOutcome::Fit(value) => value,
            FitOutcome::EmptyFixedDomain => return Ok(NativeFitOutcome::EmptyFixedDomain),
            FitOutcome::Unsupported(reason) => return Ok(NativeFitOutcome::Unsupported(reason)),
        };
        let dimensions = analytical
            .dimensions_m
            .map(|v| snap(libm::floor(v / GRID_M) * GRID_M));
        for (d, r) in dimensions
            .iter()
            .zip([self.model.width_m, self.model.depth_m])
        {
            if *d < r[0] - 1e-9 || *d > r[1] + 1e-9 {
                return Ok(NativeFitOutcome::Unsupported("Native grid quantization escaped its source range; existing fitting remains available.".into()));
            }
        }
        let mut resolved = self.original.clone();
        resolved.parameters.width_m.fill(dimensions[0]);
        resolved.parameters.depth_m.fill(dimensions[1]);
        resolved.plan = build_layout(self.recipe, &resolved.parameters, &self.native_layout_seed)?;
        if !plain_native_plan(&resolved) {
            return Ok(NativeFitOutcome::Unsupported("Native construction no longer matches its rectangle descriptor; no approximate certificate was returned.".into()));
        }
        // Native +y points toward the street. Map it to the low-y side of the
        // fixed front frame by a half turn, keeping an orthogonal whole body.
        let transform = Transform {
            origin: Point {
                x: analytical.body_origin_m[0] + dimensions[0],
                y: analytical.body_origin_m[1] + dimensions[1],
            },
            orientation_deg: 180.,
        };
        let footprint = transformed(&resolved.plan.bodies[0].footprint, &transform);
        if [site.buildable, site.architectural]
            .iter()
            .any(|domain| area(&difference(&footprint, domain)) > 0.0001)
        {
            return Ok(NativeFitOutcome::Unsupported("Quantized native body failed exact supplied-domain verification; no retries were performed.".into()));
        }
        let body_area = area(&resolved.plan.bodies[0].footprint);
        resolved.plan.diagnostics.push(format!("Direct native rectangle candidate: one continuous convex fit and one native layout, {:.3} x {:.3} m, {:.3} m2 for target {:.3} m2. Fixed front/cell only; source draws and native roof retained. Terrain, real entrance/access and native roof rights still require ordinary admission; no household capacity is certified.",dimensions[0],dimensions[1],body_area,target_m2));
        Ok(NativeFitOutcome::Candidate(NativeRectangleCandidate {
            resolved,
            transform,
            analytical,
            nominal_dimensions_m: dimensions,
            body_area_m2: body_area,
            target_error_m2: body_area - target_m2,
        }))
    }
}

#[cfg(test)]
#[path = "native_single_fit_tests.rs"]
mod tests;
