//! Building forms: one production grammar for houses, utility buildings,
//! monuments and isolated buildings.
//!
//! A building is an assembly of *masses*: convex footprints (mostly rectangles
//! in the building's own frame) that never overlap in plan, each with a label
//! (its role: `building`, `wing`, `nave`, `aisle`, `tier`…). Three layers turn
//! that into volumes:
//!
//! 1. `plan` composes the masses of a house from its kit (I, L, T, U, H plans,
//!    cross-wings, outshots, porches, turrets), inside the room its lot leaves.
//!    Monuments and utility buildings compose theirs in `urban/monuments`.
//! 2. `roles` raises a mass from its label: wall height, base, roof kind and
//!    pitch, ridge axis, tiers, materials. The rules are data
//!    (`roles_*.json`), overridable per culture.
//! 3. `roof` builds every pitched roof as a solid (the lower envelope of a few
//!    planes over the mass) and takes their union across the lot, so wings run
//!    into their main body with true valleys, lean-tos die against walls and
//!    dormers stand out of their slope. The result is explicit roof pans: the
//!    renderers draw them and never recompute a roof.
//!
//! `kit` is the style registry: what a culture's houses are made of (plan
//! weights, roof variants, details), read by traits and never by culture name.
//! Its schema also reserves the street, plot, plan, regional and epoch facets
//! of a style (`styles.json`), so a new style is one data block.
use super::{Layout, Morph};

pub(super) mod kit;
pub(super) mod plan;
pub(super) mod roles;
pub(super) mod roof;
pub(super) mod sheet;

/// Morph key carrying `houseComplexity: complex` to the occupation stage.
const COMPLEX: &str = "_complexHouses";

/// Whether homes are composed by the plan grammar: `houseComplexity: complex`
/// of the layout's applied configuration, and always for a single isolated
/// structure (a lone farm, mill or inn has all the room it wants).
pub(super) fn complex_houses(layout: &Layout) -> bool {
    layout.config.as_ref().is_some_and(|c| c.house_complexity == "complex")
        || layout.programme.as_ref().is_some_and(|p| super::roles::is_isolated(&p.context.intent))
}

/// Morph key carrying `backBuildings` (0..1) to the occupation stage.
const BACK: &str = "_backBuildings";

/// The lot tissue with the layout's house complexity and back-building
/// share, as the occupation reads them.
pub(super) fn flagged(mut morph: Morph, layout: &Layout) -> Morph {
    if complex_houses(layout) {
        morph.value[COMPLEX] = serde_json::json!(true);
    }
    if let Some(c) = &layout.config {
        morph.value[BACK] = serde_json::json!(c.back_buildings.clamp(0.0, 1.0));
    }
    morph
}

/// How far the occupation fills the back of this tissue's town lots (0..1);
/// a tissue read outside a layout takes the whole rule.
pub(super) fn back_buildings(morph: &Morph) -> f64 {
    morph.value[BACK].as_f64().unwrap_or(1.0)
}

/// Whether the occupation composes this tissue's homes with the plan grammar.
pub(super) fn is_complex(morph: &Morph) -> bool {
    morph.value[COMPLEX].as_bool().unwrap_or(false)
}
