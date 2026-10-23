//! Retain already-tried native terrain witnesses, then spend one
//! shared eight-evaluation budget after every ordinary pathway has refused.
use super::source_aspect_budget::SourceAspectBudget;
use super::*;
use std::sync::Arc;

pub(super) const MAX_WITNESSES: usize = source_terrain_budget::MAX_EVALUATIONS / 2;

#[derive(Clone, Copy, Debug)]
pub(super) struct TerrainFailure { pub low: f64, pub high: f64, pub slope: f64 }

/// Prepared once per native candidate, shared by its already-tried poses.
pub(super) struct Ticket<'a> {
    resolved: &'a ResolvedArchitecture,
    full_dimensions: [f64; 2],
    aspect: SourceAspectBudget,
    allowed: [[f64; 2]; 2],
    lower_scale: f64,
    archive: OnceCell<Arc<ResolvedArchitecture>>,
}

pub(super) struct Witness {
    pub resolved: Arc<ResolvedArchitecture>,
    pub full_dimensions: [f64; 2],
    pub full_pose: Transform,
    pub access: ArchitectureAccess,
    #[cfg(test)]
    pub terrain: TerrainFailure,
    pub aspect: SourceAspectBudget,
    pub allowed: [[f64; 2]; 2],
    pub priority: f64,
    pub order: usize,
}

pub(super) struct Recovery {
    enabled: bool,
    pub evaluations: usize,
    pub constructions: usize,
    pub admissions: usize,
    pub witnesses: Vec<Witness>,
    pub selected: Option<usize>,
    observed: usize,
    finished: bool,
    pub reduced_dimensions: Option<[f64; 2]>,
}

/// Select one declared segment for an already-tried pose. This is not a
/// successful access: the sole rebuilt proposal must pass the full connector
/// and exact segment guard later. Never change the house pose to find a front.
/// The first 64 declared records bound scalar work, including invalid records.
pub(super) fn declared_lower_access<'a>(
    r: &'a PlacementRequest, dimensions: [f64; 2], pose: &Transform,
) -> Option<&'a ArchitectureAccess> {
    if dimensions.iter().any(|v| !v.is_finite() || *v <= 0.)
        || !pose.origin.x.is_finite() || !pose.origin.y.is_finite()
        || !pose.orientation_deg.is_finite()
    { return None; }
    let front = transform_point(Point { x: dimensions[0] * 0.5, y: 0. }, pose);
    r.accesses.iter().take(64).enumerate().filter_map(|(index, access)| {
        if !matches!(access.kind.as_str(), "public" | "collective" | "private")
            || !access.width_m.is_finite() || access.width_m < 0.8
            || access.segment.iter().any(|p| !p.x.is_finite() || !p.y.is_finite())
            || libm::hypot(access.segment[1].x - access.segment[0].x,
                access.segment[1].y - access.segment[0].y) < 0.8
            || !source_terrain_budget::lower_front(pose, dimensions, access)
        { return None; }
        let contact = nearest(front, access.segment[0], access.segment[1]);
        let distance = libm::hypot(front.x - contact.x, front.y - contact.y);
        distance.is_finite().then_some((distance, index, access))
    }).min_by(|a, b| a.0.total_cmp(&b.0).then(a.2.id.cmp(&b.2.id)).then(a.1.cmp(&b.1)))
        .map(|(_, _, access)| access)
}

impl Recovery {
    #[cfg(test)]
    pub(super) fn enabled(&self) -> bool { self.enabled }

    #[cfg(test)]
    pub(super) fn disable_for_test(&mut self) { self.enabled = false; }

    pub(super) fn new(r: &PlacementRequest, target: Option<&Surface>, exact: bool) -> Self {
        Self {
            enabled: !exact && target.is_none() && r.parcel_fit != Some(false)
                && r.config.as_ref().is_none_or(|c| {
                    c.mode == HistoricalMode::HistoricalInspired && c.pack == r.culture.pack
                }) && native_ground_preparation_allowed(r, true),
            evaluations: 0, constructions: 0, admissions: 0,
            witnesses: Vec::new(), selected: None, observed: 0, finished: false,
            reduced_dimensions: None,
        }
    }

    pub(super) fn ticket<'a>(
        &self, r: &PlacementRequest, prepared: &PreparedPlan<'a>,
    ) -> Option<Ticket<'a>> {
        if !self.enabled || self.finished { return None; }
        let resolved = prepared.resolved;
        let catalogue = catalogue().ok()?;
        let recipe = catalogue.recipes.iter().find(|r| r.id == resolved.recipe_id)?;
        let source = recipe.variants.iter()
            .find(|v| v.parameters.variant_id == resolved.parameters.variant_id)
            .map_or(&recipe.parameters, |v| &v.parameters);
        let aspect = SourceAspectBudget::for_candidate(r, resolved, source)?;
        let shape = crate::morphology::domestic_budget_shape(
            &resolved.parameters, &resolved.plan,
        ).ok()?;
        if shape.passage_m != 0. || shape.court_fraction != 0. { return None; }
        let b = bounds(&resolved.plan.bodies[0].footprint);
        let full_dimensions = [b[2] - b[0], b[3] - b[1]];
        let size = resolved.config.size;
        let allowed = [
            [shape.minimum_body[0].max(source.width_m[0] * size), source.width_m[1] * size * 2.],
            [shape.minimum_body[1].max(source.depth_m[0] * size), source.depth_m[1] * size * 2.],
        ];
        if !aspect.contains(full_dimensions, allowed)
            || !source_terrain_budget::supported(resolved, full_dimensions)
        { return None; }
        let lower_scale = (libm::ceil(allowed[0][0] / GRID_M) * GRID_M / full_dimensions[0])
            .max(libm::ceil(allowed[1][0] / GRID_M) * GRID_M / full_dimensions[1]);
        if !lower_scale.is_finite() || lower_scale <= 0. || lower_scale >= 1. { return None; }
        Some(Ticket { resolved, full_dimensions, aspect, allowed, lower_scale, archive: OnceCell::new() })
    }

    /// Observe only an actual physical refusal from the unchanged native
    /// align[.5,.1,.9] loop. No frontage pose is synthesized for this purpose.
    pub(super) fn observe_existing_native(
        &mut self, r: &PlacementRequest, ticket: &Ticket<'_>, pose: &Transform,
        terrain: TerrainFailure,
    ) {
        if !self.enabled || self.finished { return; }
        if let Some(access) = declared_lower_access(r, ticket.full_dimensions, pose) {
            self.observe(r, ticket, pose, access, terrain);
        }
    }

    pub(super) fn observe(
        &mut self, r: &PlacementRequest, ticket: &Ticket<'_>, pose: &Transform,
        access: &ArchitectureAccess, terrain: TerrainFailure,
    ) {
        if !self.enabled || self.finished { return; }
        if self.witnesses.iter().any(|w| {
            w.resolved.recipe_id == ticket.resolved.recipe_id
                && w.resolved.parameters.variant_id == ticket.resolved.parameters.variant_id
                && w.resolved.config.seed == ticket.resolved.config.seed
                && w.resolved.plan.bodies[0].levels.len() == ticket.resolved.plan.bodies[0].levels.len()
                && w.full_dimensions == ticket.full_dimensions
                && w.full_pose.origin == pose.origin
                && w.full_pose.orientation_deg == pose.orientation_deg
                && w.access.id == access.id && w.access.segment == access.segment
                && w.access.kind == access.kind && w.access.width_m == access.width_m
        }) { return; }
        if !source_terrain_budget::lower_front(pose, ticket.full_dimensions, access) { return; }
        // Priority only: raster height range does not necessarily scale linearly.
        // This score never certifies feasibility or a physical impossibility.
        let priority = ((terrain.high - terrain.low) * ticket.lower_scale
            / r.terrain.max_foundation_step_m).max(terrain.slope / MAX_LEVEL_FOUNDATION_SLOPE_DEG);
        if priority.is_nan() || priority < 0. { return; }
        let order = self.observed;
        self.observed += 1;
        let replace = if self.witnesses.len() == MAX_WITNESSES {
            // Keep the first compatible historic witness. Other slots retain
            // the best observed priorities; equal priorities keep prior order.
            let Some((index, worst)) = self.witnesses.iter().enumerate().filter(|(_, w)| w.order != 0)
                .max_by(|(_, a), (_, b)| a.priority.total_cmp(&b.priority).then(a.order.cmp(&b.order)))
            else { return; };
            if priority.total_cmp(&worst.priority).is_ge() { return; }
            Some(index)
        } else { None };
        // Do not clone the architecture until a retained slot was selected.
        // Poses sharing this ticket share a single lazy Arc allocation.
        let witness = Witness {
            resolved: Arc::clone(ticket.archive.get_or_init(|| Arc::new(ticket.resolved.clone()))),
            full_dimensions: ticket.full_dimensions, full_pose: pose.clone(),
            access: access.clone(),
            #[cfg(test)]
            terrain,
            aspect: ticket.aspect, allowed: ticket.allowed,
            priority, order,
        };
        if let Some(index) = replace { self.witnesses[index] = witness; }
        else { self.witnesses.push(witness); }
        self.witnesses.sort_by(|a, b| a.priority.total_cmp(&b.priority).then(a.order.cmp(&b.order)));
    }

    pub(super) fn finish(
        &mut self, r: &PlacementRequest, occupied: &Surface,
    ) -> Option<Result<PlanBuilding, String>> {
        if !self.enabled || self.finished { return None; }
        self.finished = true;
        if self.witnesses.is_empty() { return None; }
        let neighbors = unite(&r.neighbors.iter().map(|n| n.footprint.clone())
            .chain(std::iter::once(occupied.clone())).collect::<Vec<_>>());
        let mut found = None;
        for (index, witness) in self.witnesses.iter().enumerate() {
            let remaining = source_terrain_budget::MAX_EVALUATIONS - self.evaluations;
            if remaining < 2 { break; }
            let correction = source_terrain_budget::reduce(
                r, &witness.resolved, witness.full_dimensions, &witness.full_pose,
                &witness.access, &neighbors, witness.aspect, witness.allowed, remaining,
            );
            self.evaluations += correction.evaluations;
            if let Some(proposal) = correction.proposal { found = Some((index, proposal)); break; }
        }
        let (index, proposal) = found?;
        self.selected = Some(index);
        let witness = &self.witnesses[index];
        self.reduced_dimensions = Some(proposal.dimensions);
        self.constructions = 1;
        let result = (|| {
            let shape = crate::morphology::domestic_budget_shape(
                &witness.resolved.parameters, &witness.resolved.plan,
            ).map_err(str::to_owned)?;
            let [w, d] = proposal.dimensions;
            let plan = crate::morphology::domestic_budget_plan(
                &witness.resolved.parameters, &witness.resolved.plan, &shape, w, d,
            ).map_err(str::to_owned)?;
            let mut reduced = witness.resolved.as_ref().clone();
            reduced.parameters.width_m = [w; 2]; reduced.parameters.depth_m = [d; 2];
            reduced.plan = plan; reduced.entrance = None;
            self.admissions = 1;
            let mut building = visual_with_front_access_prepared(
                r, &PreparedPlan::new(&reduced), proposal.transform.clone(),
                &neighbors, true, false, Some(&witness.access), false,
            )?;
            building.diagnostics.push(format!(
                "Initial source terrain recovery: {}/8 exact terrain evaluations; 1/1 additional native dimension and admission after all existing pathways refused; {}/4 retained prior witnesses, selected observation {}; retained source {}::{} and seed; actual full body {:.6} x {:.6} m reduced to {:.6} x {:.6} m at fixed facade/angle; source minima, proportions, terrain, body/roof/occupation rights and access checked; post-admission growth skipped, final entrance preparation retained; no household capacity inferred.",
                self.evaluations, self.witnesses.len(), witness.order,
                reduced.recipe_id, reduced.parameters.variant_id,
                witness.full_dimensions[0], witness.full_dimensions[1], w, d,
            ));
            Ok(building)
        })();
        Some(result)
    }
}
