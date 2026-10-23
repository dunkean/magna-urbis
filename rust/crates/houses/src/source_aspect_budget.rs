//! Scalar source-proportion bounds for the existing automatic rectangle budget.
//! No source draw, geometry construction, pose search or physical certificate.
use crate::catalogue::{Envelope, Layout, Parameters, SupportKind};
use crate::engine::ResolvedArchitecture;
use crate::geometry::{GRID_M, snap};
use crate::model::HistoricalMode;
use crate::placement::{ArchitectureFunction, PlacementRequest};

#[derive(Clone, Copy, Debug)]
pub(super) struct SourceAspectBudget {
    width: [f64; 2],
    depth: [f64; 2],
    ratio: [f64; 2],
}

fn valid_range([low, high]: [f64; 2]) -> bool {
    low.is_finite() && high.is_finite() && low > 0. && low <= high
}

fn grid_interval([low, high]: [f64; 2]) -> Option<[f64; 2]> {
    if !valid_range([low, high]) {
        return None;
    }
    let interval = [
        libm::ceil(low / GRID_M) * GRID_M,
        libm::floor(high / GRID_M) * GRID_M,
    ];
    valid_range(interval).then_some(interval)
}

impl SourceAspectBudget {
    pub(super) fn new(width: [f64; 2], depth: [f64; 2]) -> Option<Self> {
        if !valid_range(width) || !valid_range(depth) {
            return None;
        }
        let ratio = [width[0] / depth[1], width[1] / depth[0]];
        valid_range(ratio).then_some(Self {
            width,
            depth,
            ratio,
        })
    }

    pub(super) fn for_candidate(
        request: &PlacementRequest,
        resolved: &ResolvedArchitecture,
        source: &Parameters,
    ) -> Option<Self> {
        let simple = |p: &Parameters| {
            p.layout == Layout::Single
                && p.footprint_family == "FP-RECT"
                && p.bodies == [1, 1]
                && p.cells[1] == 0
                && p.envelope == Envelope::Walled
                && p.support.kind == SupportKind::Ground
                && (p.components.is_empty()
                    || p.components.len() == 1
                        && p.components[0].id == "main"
                        && p.components[0].count == [1, 1]
                        && p.components[0].width_ratio == [1.; 2]
                        && p.components[0].depth_ratio == [1.; 2])
        };
        if request.culture.mode != HistoricalMode::HistoricalInspired
            || resolved.config.mode != HistoricalMode::HistoricalInspired
            || request.parcel_fit == Some(false)
            || !matches!(
                request.function,
                ArchitectureFunction::Domestic | ArchitectureFunction::Mixed
            )
            || request.config.as_ref().is_some_and(|c| {
                c.recipe.is_some() || c.workshop.is_some() || c.overrides.variant.is_some()
            })
            || !simple(source)
            || !simple(&resolved.parameters)
            || resolved.plan.bodies.len() != 1
            || !resolved.plan.courts.is_empty()
            || !resolved.plan.paths.is_empty()
            || !resolved.plan.features.is_empty()
            || resolved.entrance.is_some()
        {
            return None;
        }
        // Use the selected source/variant ranges, not retained singleton draws
        // or the (possibly adapted) body's current proportions. Uniform size
        // cancels in this ratio; physical/source axis bounds are supplied below.
        Self::new(source.width_m, source.depth_m)
    }

    pub(super) fn contains(&self, [w, d]: [f64; 2], allowed: [[f64; 2]; 2]) -> bool {
        if !allowed.into_iter().all(valid_range)
            || !w.is_finite()
            || !d.is_finite()
            || w < allowed[0][0]
            || w > allowed[0][1]
            || d < allowed[1][0]
            || d > allowed[1][1]
        {
            return false;
        }
        let products = [
            w * self.depth[1],
            d * self.width[0],
            w * self.depth[0],
            d * self.width[1],
        ];
        products.iter().all(|v| v.is_finite())
            && products[0] >= products[1]
            && products[2] <= products[3]
    }

    /// Feasible whole-grid depths for one width. The site guide must use this
    /// lower bound too: it cannot shorten a wide body below its source ratio.
    pub(super) fn depth_bounds(&self, width: f64, allowed: [[f64; 2]; 2]) -> Option<[f64; 2]> {
        if !allowed.into_iter().all(valid_range)
            || !width.is_finite()
            || width < allowed[0][0]
            || width > allowed[0][1]
        {
            return None;
        }
        grid_interval([
            allowed[1][0].max(width / self.ratio[1]),
            allowed[1][1].min(width / self.ratio[0]),
        ])
    }

    /// One fixed-area projection for one existing candidate slot. A valid
    /// couple is returned bit-exactly. An empty interval is skipped, never
    /// repaired through another geometry/pose or a wider source permission.
    pub(super) fn project(&self, proposed: [f64; 2], allowed: [[f64; 2]; 2]) -> Option<[f64; 2]> {
        if self.contains(proposed, allowed) {
            return Some(proposed);
        }
        if !allowed.into_iter().all(valid_range)
            || proposed.iter().any(|v| !v.is_finite() || *v <= 0.)
        {
            return None;
        }
        let area = proposed[0] * proposed[1];
        if !area.is_finite() || area <= 0. {
            return None;
        }
        let [low, high] = grid_interval([
            allowed[0][0]
                .max(area / allowed[1][1])
                .max(libm::sqrt(area * self.ratio[0])),
            allowed[0][1]
                .min(area / allowed[1][0])
                .min(libm::sqrt(area * self.ratio[1])),
        ])?;
        let width = snap(proposed[0]).clamp(low, high);
        let [minimum, maximum] = self.depth_bounds(width, allowed)?;
        let result = [width, snap(area / width).clamp(minimum, maximum)];
        self.contains(result, allowed).then_some(result)
    }
}
