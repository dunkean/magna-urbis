//! Precinct surveys, wall tracing, gates, water sides, clearance and wall raises.
//!
//! The tracers are pure functions of a precinct candidate (a closed outline in
//! metres), the terrain view and the charter's wall spec. They port classic's
//! tracers in `rust/crates/core/src/urban/`:
//! - `village.rs`: `contour_trace`, `curtain_trace`, `hill_trace` and `village_trace`
//!   (`fortification.rs`), and the polygonal fit `curtain` (`composition.rs`):
//!   straight runs between corners, at most about 2 % of the town's width off its land;
//! - `params.rs`: `parameter_trace` (`fortification_params.rs`): stiffness, terrain
//!   adherence, crest limit and the bank rule;
//! - `square.rs`: `square_trace` and `framed_box` (`fortification.rs`), and the grid
//!   frame `grid_frame` (`composition.rs`);
//! - `bastioned.rs`: `bastioned_trace` and `off_water` (`fortification.rs`);
//! - `across.rs`: `fill_pockets` behind `straight_across` and `without_invaginations`
//!   (`fortification.rs`);
//! - `attach.rs`: `lopsided`, `attach` and `shared_length` (`fortification_extension.rs`);
//! - `geometry.rs`: vector and ring helpers, `normals`, `wet_length`, the relief of
//!   `terrain` (`fortification.rs`), `segment_clear` (`routing.rs`), and a buffer made
//!   of round-joined ribbons in place of geo's offset;
//! - [`trace`]: the order of `enclosures` (`composition.rs`): polygonal fit, style
//!   trace (hill, square or bastioned), pocket repair, parameter trace, then the lobe;
//!   and the corner and salient tests of `fortification::build`.
//!
//! Not ported here: the knoll repair of `parameter_trace` (with an explicit relief
//! limit, a founding line over a knoll is routed round it, which needs a router) and
//! `occupied_banks` (the precinct survey keeps to occupied banks).

mod across;
mod attach;
mod bastioned;
mod geometry;
mod params;
mod square;
mod village;

#[cfg(test)]
mod tests;

use magna_urbis_geom::{self as g, Point, Shape, surface::TerrainView};

use crate::spec::WallSpec;

use geometry::{cross, dir, relief, turn_at};

pub use across::{straight_across, without_invaginations};
pub use attach::{attach, lopsided, shared_length, shared_stretch};
pub use bastioned::bastioned_trace;
pub use params::{Regularity, parameter_trace};
pub use square::{grid_frame, square_trace};
pub use village::{curtain_trace, hill_trace, polygonal_fit, village_trace};

/// Cross-grade of a circuit's ground above which a masonry wall follows the contour.
const HILL_RELIEF: f64 = 0.07;
/// Turn in degrees above which a vertex is a corner (classic's default corner turn).
const CORNER_TURN_DEG: f64 = 35.0;
/// Convex turns in degrees that carry a bastion (classic `build`).
const SALIENT_TURN_DEG: std::ops::RangeInclusive<f64> = 15.0..=110.0;
/// A grid frame this close to the compass (degrees) is the compass for a cardinal culture.
const CARDINAL_SNAP_DEG: f64 = 3.0;

/// Whether a planned culture's square circuit is drawn.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum SquareRule {
    /// Square where the enclosure shape is square or rectangular and the site is not a hill.
    #[default]
    Auto,
    /// The plan's rectangle, kept even on a hill or where it walls empty land.
    Rect,
    /// Never square: the curtain follows the outline.
    Follow,
}

/// Which tracer drew a circuit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TraceFamily {
    /// Straight runs between corners fitted to the outline.
    Polygonal,
    /// The closer contour of a hill town.
    Hill,
    /// The rectangle of a planned town.
    Square,
    /// Long fronts between salients.
    Bastioned,
}

/// A precinct candidate: the closed outline to wall and what its trace depends on
/// beyond the charter's wall spec.
#[derive(Clone, Debug)]
pub struct Candidate<'a> {
    /// Closed outline in map-local metres.
    pub outline: Shape,
    /// Style of this raise; the spec's baseline style when `None`.
    pub style: Option<&'a str>,
    /// A small settlement keeps the village fit.
    pub small: bool,
    /// Made of two circuits joined: its re-entrant bends are cut straight across.
    pub joined: bool,
    /// Direction in radians of the street grid it encloses, for a square trace.
    pub grid: Option<f64>,
    /// A cardinal culture keeps the compass for its square trace.
    pub cardinal: bool,
    pub square: SquareRule,
    /// The curtain is drawn to a bank within 80 m outward.
    pub bank_walls: bool,
    /// Curtain width in metres of the resolved style.
    pub curtain_width: f64,
    /// The standing circuit, already traced, this candidate joins as a lobe.
    pub attach_to: Option<&'a Shape>,
}

impl Candidate<'_> {
    /// A candidate for a full circuit with the default options: urban fit, the
    /// spec's style, a 3 m curtain.
    pub fn new(outline: Shape) -> Self {
        Self {
            outline,
            style: None,
            small: false,
            joined: false,
            grid: None,
            cardinal: false,
            square: SquareRule::Auto,
            bank_walls: false,
            curtain_width: 3.0,
            attach_to: None,
        }
    }
}

/// A traced circuit with the points the works stand on.
#[derive(Clone, Debug)]
pub struct Traced {
    /// The new closed outline, counter-clockwise; the lobe alone when attached.
    pub outline: Shape,
    pub family: TraceFamily,
    /// Style the circuit is built in: the requested one, or `flanked` where a
    /// bastioned or concentric style cannot stand.
    pub style: String,
    /// Vertices turning more than 35°, for corner towers.
    pub corners: Vec<Point>,
    /// Convex vertices turning 15° to 110° of a bastioned trace, for bastions.
    pub salients: Vec<Point>,
    /// Sides of a lobe lying on the standing circuit; empty unless attached.
    pub shared: Vec<(Point, Point)>,
    /// Decisions the trace had to make against the request.
    pub warnings: Vec<String>,
}

/// Trace a precinct candidate in the style of its raise. A style that cannot stand
/// on the site falls back to a flanked circuit, and a lobe that cannot attach to its
/// standing circuit leaves the full circuit, each with a warning.
pub fn trace(candidate: &Candidate<'_>, terrain: &dyn TerrainView, spec: &WallSpec) -> Traced {
    let mut warnings = vec![];
    let mut style = candidate.style.unwrap_or(spec.style.as_str()).to_string();
    let shape = &candidate.outline;
    let cell = terrain.width() / terrain.water_resolution().max(1) as f64;
    let mut fitted = polygonal_fit(shape, cell, candidate.small);
    if candidate.joined {
        fitted = straight_across(&fitted, terrain);
    }
    let masonry = !matches!(style.as_str(), "palisade" | "gord" | "hedge");
    let hill = masonry && relief(&fitted, terrain) > HILL_RELIEF;
    if hill && matches!(style.as_str(), "bastioned" | "concentric") {
        warnings.push(format!(
            "Fortification: {style} circuit brought back to a flanked one on relief."
        ));
        style = "flanked".into();
    }
    let square = matches!(spec.enclosure_shape.as_str(), "square" | "rect")
        && match candidate.square {
            SquareRule::Follow => false,
            SquareRule::Rect => true,
            SquareRule::Auto => !hill,
        };
    let (family, traced) = if hill {
        let contour = if candidate.small {
            village_trace(shape, cell, true)
        } else {
            hill_trace(shape)
        };
        (TraceFamily::Hill, contour)
    } else if square {
        let grid = candidate.grid.map(|a| {
            if candidate.cardinal && a.abs() < CARDINAL_SNAP_DEG.to_radians() {
                0.0
            } else {
                a
            }
        });
        match square_trace(
            &fitted,
            terrain,
            candidate.cardinal,
            candidate.square == SquareRule::Rect,
            grid,
        ) {
            Some(rect) => (TraceFamily::Square, rect),
            None => (TraceFamily::Polygonal, fitted),
        }
    } else if style == "bastioned" {
        match bastioned_trace(&fitted, terrain) {
            Some(fronts) => (TraceFamily::Bastioned, fronts),
            None => {
                warnings.push("Fortification: no bastioned trace fits this outline; a flanked circuit is kept.".into());
                style = "flanked".into();
                (TraceFamily::Polygonal, fitted)
            }
        }
    } else {
        (TraceFamily::Polygonal, fitted)
    };
    let traced = without_invaginations(&traced, terrain);
    let regularity = Regularity {
        stiffness: spec.stiffness,
        adherence: spec.terrain_adherence,
        crest_limit: spec.crest_limit,
        bank_walls: candidate.bank_walls,
        curtain_width: candidate.curtain_width,
    };
    let mut outline = g::normalized(parameter_trace(traced, terrain, &regularity));
    let mut shared = vec![];
    if let Some(old) = candidate.attach_to {
        match attach(old, &outline) {
            Some(lobe) => {
                shared = shared_stretch(old, &lobe);
                outline = lobe;
            }
            None => warnings.push(
                "Fortification: no lobe attaches on this outline; a concentric circuit is kept."
                    .into(),
            ),
        }
    }
    let corners = corner_points(&outline.outer);
    let salients = if family == TraceFamily::Bastioned {
        salient_points(&outline.outer)
    } else {
        vec![]
    };
    Traced {
        outline,
        family,
        style,
        corners,
        salients,
        shared,
        warnings,
    }
}

fn corner_points(ring: &[Point]) -> Vec<Point> {
    (0..ring.len())
        .filter(|&i| turn_at(ring, i).to_degrees() > CORNER_TURN_DEG)
        .map(|i| ring[i])
        .collect()
}

/// Convex vertices of a counter-clockwise ring turning within the salient range.
fn salient_points(ring: &[Point]) -> Vec<Point> {
    let n = ring.len();
    if n < 3 {
        return vec![];
    }
    (0..n)
        .filter(|&i| {
            let (a, v, b) = (ring[(i + n - 1) % n], ring[i], ring[(i + 1) % n]);
            cross(dir(a, v), dir(v, b)) > 0.0
                && SALIENT_TURN_DEG.contains(&turn_at(ring, i).to_degrees())
        })
        .map(|i| ring[i])
        .collect()
}
