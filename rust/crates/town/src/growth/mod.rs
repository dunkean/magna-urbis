//! Ring growth, event ordering, capacity counting, stopping and resuming.
//!
//! A town grows ring by ring over the survey's cost field, in fixed steps of effective metres.
//! One ring is one or more clock steps, each in this order:
//! 1. its cost field is frozen and `ExtendArmature` draws its boundary (the parts of its outer
//!    cost level outside the town) and prolongs the main axes across it, splitting it into
//!    sectors;
//! 2. each sector is opened as a quarter keyed `(ring, station)`: drafts are laid in parallel
//!    from the frozen outlines and committed in station order;
//! 3. each quarter is counted at birth through [`Capacity`], with its inputs frozen then, and
//!    the clock is the sum of the counts;
//! 4. the quarters of earlier rings age by one fill step, intramural first;
//! 5. promotions whose threshold the clock crossed are applied (walls, harbours and road fates
//!    join this step in later lots);
//! 6. the stop test: growth stops as soon as the clock reaches the target.
//!
//! Steps 3, 5 and 6 follow every quarter and every ageing step, so a ring is cut at the first
//! station that crosses a threshold and dated events see the town as it stood. When no land is
//! left, quarters go on ageing without new rings.
//!
//! **Stop and resume.** The stop is a checkpoint: the journal and a cursor. Resuming replays the
//! journal through the same loop and goes on from where it stood, so generating to P1 and
//! resuming to P2 gives the journal and graph of generating to P2 directly, the target entering
//! only the stop test. The final allocation is the caller's: [`verdict`] applies the 90 % rule
//! and [`reopen`] the one reopening.

mod commit;
mod contour;
mod count;
mod driver;
mod par;
mod rings;
mod sectors;
#[cfg(test)]
mod tests;

use magna_urbis_geom::{Point, Shape};

pub use count::QuarterRecord;

use crate::TownRequest;
use crate::export::TownPlan;
use crate::graph::Clock;
use crate::journal::Checkpoint;
use driver::Driver;

/// One block and the frontage available to its lots.
#[derive(Clone, Debug)]
pub struct CapacityBlock {
    /// Buildable outline after street widths and reserves are deducted.
    pub outline: Shape,
    /// Segments of the outline that provide frontage.
    pub frontage_edges: Vec<[Point; 2]>,
}

/// Inputs to the lot cut frozen at birth, with the fill level being counted.
#[derive(Clone, Copy, Debug)]
pub struct CapacityInputs<'a> {
    /// Parcel pressure at birth.
    pub pressure: f64,
    /// Recipe key for the quarter's lot cut.
    pub recipe: &'a str,
    /// Growth-zone key for the quarter's lot cut.
    pub zone: &'a str,
    /// Density of the quarter's phase relative to the founding phase's.
    pub density: f64,
    /// Whether the quarter was born in the intramural regime.
    pub intramural: bool,
    /// Occupation share of the quarter's lots, from zero to one.
    pub fill_level: f64,
}

/// Counts households in a quarter using its blocks and birth conditions.
pub trait Capacity {
    /// Count households at the requested fill level using only this quarter.
    fn households(&self, blocks: &[CapacityBlock], inputs: CapacityInputs<'_>) -> f64;
}

/// Share of the requested households a town must house after the final allocation.
pub const ACCEPTED_SHARE: f64 = 0.9;

/// What the caller does after its final allocation.
#[derive(Clone, Debug, PartialEq)]
pub enum Verdict {
    /// Every household is housed.
    Housed,
    /// The town is kept with this one-line warning.
    Short(String),
    /// Reopen growth once at the cursor for this many more households.
    Reopen {
        /// Households the allocation left without a home.
        missing: f64,
    },
}

/// The 90 % rule: a town housing at least [`ACCEPTED_SHARE`] of its households is kept with a
/// warning; below that, growth reopens once (`reopened` false), then the gap is reported.
pub fn verdict(housed: f64, requested: f64, reopened: bool) -> Verdict {
    if requested <= 0.0 || housed >= requested {
        return Verdict::Housed;
    }
    let share = housed / requested;
    if share < ACCEPTED_SHARE && !reopened {
        return Verdict::Reopen {
            missing: requested - housed,
        };
    }
    let percent = (share * 100.0).floor();
    Verdict::Short(format!("Housing {percent} % (Logement {percent} %)"))
}

/// Households to house for a request: its population over the household size.
pub fn target_households(request: &TownRequest<'_>) -> f64 {
    f64::from(request.site.population) / request.specs.growth.household_size.max(1e-9)
}

/// Grow a town from founding until it houses the request's population.
pub fn generate(request: &TownRequest<'_>, capacity: &dyn Capacity) -> Result<TownPlan, String> {
    let target = Clock::from_households(target_households(request));
    run(request, capacity, target, None)
}

/// Resume a stopped town and grow it until it houses the request's population. The request must
/// be the one the town was generated with, but for its population.
pub fn resume(
    request: &TownRequest<'_>,
    capacity: &dyn Capacity,
    checkpoint: &Checkpoint,
) -> Result<TownPlan, String> {
    let target = Clock::from_households(target_households(request));
    run(request, capacity, target, Some(checkpoint))
}

/// The one reopening: resume `plan` for `missing` households more than it was grown for.
pub fn reopen(
    request: &TownRequest<'_>,
    capacity: &dyn Capacity,
    plan: &TownPlan,
    missing: f64,
) -> Result<TownPlan, String> {
    let target = Clock::from_households(plan.stop.target.households() + missing.max(0.0));
    run(request, capacity, target, Some(&plan.stop.checkpoint))
}

/// Grow to `target` households, replaying `from` first when given.
pub(crate) fn run(
    request: &TownRequest<'_>,
    capacity: &dyn Capacity,
    target: Clock,
    from: Option<&Checkpoint>,
) -> Result<TownPlan, String> {
    let mut driver = Driver::new(request, capacity, target, from)?;
    driver.grow()?;
    Ok(driver.finish())
}
