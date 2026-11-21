//! Bounded contextual demand and allocation. Metres, square metres and indicative
//! domestic units are distinct; estimated land capacity never means built housing.
//! Building roles come from the service catalogue (`roles`, `services.json`):
//! landmarks and large programmes reserve whole blocks before the cadastre,
//! small trades take plots after it, then shops, then housing, and every
//! buildable plot left over becomes an explicit garden or yard.

use crate::urban::Point;

mod adjacency;
mod admission;
mod allocation;
mod built_capacity;
#[path = "../programme_camps.rs"]
pub(in crate::urban) mod camps;
mod demand;
mod districts;
mod environment;
#[path = "../programme_functions.rs"]
mod functions;
#[path = "../household_population.rs"]
mod household_population;
mod housing;
#[path = "../programme_lots.rs"]
mod lots;
mod model;
mod outcomes;
mod preparation;
mod reservations;
mod services;

pub use admission::has_envelope;
pub use allocation::{allocate, reallocate};
pub(super) use allocation::{allocate_from_reference, consolidate, consolidate_cadastre, finish_cadastre};
pub use built_capacity::{
    BuiltCapacity, BuiltDeficit, BuiltOpenSpace, BuiltRefusal, BuiltScene, carry_open_deficits,
    reconcile_built,
};
pub use functions::{ProgrammeFunctions, PROGRAMME_FUNCTIONS_VERSION};
pub use model::{Adjacency, Allocation, BlockEnvironment, Demand, ProgrammeContext, Reservation, UrbanProgramme};
pub use preparation::prepare;
pub(super) use reservations::clear_probe_cache;

#[cfg(test)]
mod allocation_tests;
#[cfg(test)]
mod built_tests;
#[cfg(test)]
#[path = "../programme_open_deficit_tests.rs"]
mod open_deficit_tests;
#[cfg(test)]
#[path = "../programme_functions_tests.rs"]
mod programme_functions_tests;
#[cfg(test)]
mod reservation_tests;
#[cfg(test)]
mod test_fixtures;

fn dist(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
