//! Terrain survey of slopes, banks, harbour fronts and strong points.

mod cost;
mod grid;
mod shelter;
mod shore;
mod slope;
mod summits;

#[cfg(test)]
mod tests;

use std::sync::Arc;

use magna_urbis_geom::{Point, Shape, surface::TerrainView};

use crate::{TownRequest, spec::SurveySpec};

use grid::Grid;

pub use cost::{CostField, CostPath};
pub use slope::QuarterSlope;

/// Index of the lowest row-major cell in a dry component of the survey grid.
pub type BankId = usize;

/// A sample at the centre of a survey grid cell.
#[derive(Clone, Debug)]
pub struct SurveyCell {
    pub index: usize,
    pub position: Point,
    pub elevation: f64,
    /// Rise over run along each coordinate axis.
    pub gradient: (f64, f64),
    /// Magnitude of the gradient, as rise over run.
    pub slope: f64,
    pub cliff: bool,
    pub slope_break: bool,
    pub crest: bool,
    pub wet: bool,
    /// Water class supplied by the terrain, or zero when unclassified.
    pub water_code: u8,
    pub navigable: bool,
    pub bank_id: Option<BankId>,
    /// Whether occupation of this cell is excluded.
    pub closed: bool,
    surveyed: bool,
    restricted: bool,
}

/// A usable shore run, oriented with its bank on the left.
#[derive(Clone, Debug, PartialEq)]
pub struct HarbourFront {
    pub bank_id: BankId,
    /// Metres along the bank's surveyed shore to the start of this run.
    pub station: f64,
    pub shore: Vec<Point>,
    /// Length of the shore run in metres.
    pub length: f64,
    /// Higher scores favour less exposure and more clearance from shoals.
    pub shelter_score: f64,
    pub sheltered: bool,
    /// Shortest open-land approach to the run, in metres, if one exists.
    pub land_distance: Option<f64>,
}

/// A defensible height with an open, level top and a lane-grade approach.
#[derive(Clone, Debug, PartialEq)]
pub struct StrongPoint {
    pub position: Point,
    /// Contiguous level summit area in square metres.
    pub top_area: f64,
    /// Height above the mean of the surrounding ring, in metres.
    pub prominence: f64,
    /// Lowest possible maximum segment grade along an approach from the centre.
    pub access_slope: f64,
    /// Rise above the site's median elevation plus 1.5 times local prominence.
    pub score: f64,
}

/// Terrain facts and the initial cost field for a single site.
pub struct Survey {
    costs: CostField,
    fronts: Vec<HarbourFront>,
    strong_points: Vec<StrongPoint>,
    spec: SurveySpec,
    /// Factor per cell on the cost of open ground in recomputed fields, when set.
    noise: Option<Arc<Vec<f64>>>,
}

impl Survey {
    /// Survey a town request within an explicit reach in metres. The caller
    /// can give the survey a larger reach than the site's imposed radius.
    pub fn from_request(request: &TownRequest<'_>, reach: f64) -> Result<Self, String> {
        Self::new(
            request.terrain,
            request.site.center,
            reach,
            request.site.radius,
            request.neighbour_claims,
            &request.specs.survey,
        )
    }

    /// Sample the terrain within `reach` metres of `center`. Harbour searches
    /// are bounded by both the surveyed extent and the spec's harbour reach.
    pub fn new(
        terrain: &dyn TerrainView,
        center: Point,
        reach: f64,
        imposed_radius: Option<f64>,
        neighbour_claims: &[Shape],
        spec: &SurveySpec,
    ) -> Result<Self, String> {
        let grid = Arc::new(Grid::sample(
            terrain,
            center,
            reach,
            imposed_radius,
            neighbour_claims,
            spec,
        )?);
        let fronts = shore::fronts(&grid, terrain, spec);
        let strong_points = summits::strong_points(&grid, terrain, spec);
        let costs = CostField::compute(grid, spec, &[], None, None);
        Ok(Self {
            costs,
            fronts,
            strong_points,
            spec: spec.clone(),
            noise: None,
        })
    }

    pub fn center(&self) -> Point {
        self.costs.grid.center
    }

    pub fn cell_size(&self) -> f64 {
        self.costs.grid.step
    }

    pub fn cell(&self, index: usize) -> Option<&SurveyCell> {
        self.costs
            .grid
            .cells
            .get(index)
            .filter(|cell| cell.surveyed)
    }

    pub fn cell_at(&self, point: Point) -> Option<&SurveyCell> {
        self.cell(self.costs.grid.index_at(point)?)
    }

    pub fn cells(&self) -> impl Iterator<Item = &SurveyCell> + '_ {
        self.costs.grid.cells.iter().filter(|cell| cell.surveyed)
    }

    pub fn cost_at(&self, point: Point) -> f64 {
        self.costs.cost_at(point)
    }

    pub fn closed_at(&self, point: Point) -> bool {
        self.costs.grid.open_at(point).is_none()
    }

    pub fn bank_id_at(&self, point: Point) -> Option<BankId> {
        self.cell_at(point)?.bank_id
    }

    /// Reachable cells in ascending cost order, with ties broken by cell index.
    pub fn cells_by_cost(&self) -> impl Iterator<Item = (&SurveyCell, f64)> + '_ {
        self.costs.cells_by_cost()
    }

    /// Fronts in bank and shore-station order.
    pub fn fronts(&self) -> &[HarbourFront] {
        &self.fronts
    }

    /// Strong points in descending score order.
    pub fn strong_points(&self) -> &[StrongPoint] {
        &self.strong_points
    }

    pub fn cost_field(&self) -> &CostField {
        &self.costs
    }

    /// Scale the cost of open ground in every recomputed field by `factor` at each cell's
    /// position (a seeded noise, so that growth does not go alike in every direction).
    pub fn set_cost_noise(&mut self, factor: impl Fn(Point) -> f64) {
        let factors = self.costs.grid.cells.iter().map(|c| factor(c.position)).collect();
        self.noise = Some(Arc::new(factors));
    }

    /// Build a new cost snapshot with the supplied armature paths.
    pub fn recompute_costs(&self, paths: &[CostPath<'_>]) -> CostField {
        let noise = self.noise.as_deref().map(Vec::as_slice);
        CostField::compute(Arc::clone(&self.costs.grid), &self.spec, paths, None, noise)
    }

    /// Build a new cost snapshot with the supplied armature paths, every reached cell then
    /// lowered by `discount` at its position (a harbour front's), floored at zero.
    pub fn recompute_costs_with(
        &self,
        paths: &[CostPath<'_>],
        discount: &dyn Fn(Point) -> f64,
    ) -> CostField {
        let noise = self.noise.as_deref().map(Vec::as_slice);
        CostField::compute(Arc::clone(&self.costs.grid), &self.spec, paths, Some(discount), noise)
    }
}

fn offset(point: Point, x: f64, y: f64) -> Point {
    Point {
        x: point.x + x,
        y: point.y + y,
    }
}

fn in_terrain(point: Point, width: f64) -> bool {
    (0.0..width).contains(&point.x) && (0.0..width).contains(&point.y)
}

fn interpolate(a: Point, b: Point, t: f64) -> Point {
    offset(a, (b.x - a.x) * t, (b.y - a.y) * t)
}
