//! Harbour works of a port town, by construction: the town stands on its
//! water (`sited`), its waterfront is a continuous stone quay between the
//! water and the first row of lots (`quays`), and piers, landing stages or
//! moles project from the quays into the water (`works`). Lengths, widths and
//! spacings scale with the port's population and come from the culture's
//! `plan.harbour` entry in the catalogue (defaults below).
use super::super::{LayoutConfig, Point, Shape, Site, Street, Surface, geometry as g, routing};
#[path = "harbour_shelter.rs"]
mod shelter;
#[path = "harbour_parameters.rs"]
mod placement;
pub(in super::super) use placement::{extend, blocks as port_blocks};

mod siting;
#[cfg(test)]
use siting::front_distance;
pub(in super::super) use siting::{apron, sited};
mod quays;
use quays::{Piece, shore_runs};
#[cfg(test)]
use quays::gentle_behind;
pub(in super::super) use quays::{quays, seaward};
mod navigation;
use navigation::{NAVIGABLE, channel_width, river_side, rock_side};
pub(in super::super) use navigation::{crosses_sea, front_water, keep_sea_access, navigable, protect_navigation};
mod works;
use works::{centred, densify, landing_streets, quay_budget, sub_path, touching, unlaid, untangled, works_with_minimum};
pub(in super::super) use works::{configured_works, typed_works, works};
mod platforms;
pub(in super::super) use platforms::{fronts, platforms};
#[cfg(test)]
mod tests;

pub(in super::super) fn shelter_weight(cfg: &LayoutConfig) -> f64 {
    cfg.port_shelter.unwrap_or(f64::from(cfg.sheltered_harbour))
}
pub(in super::super) fn parameterized(cfg: &LayoutConfig) -> bool {
    cfg.port_detachment < 1.0 || shelter_weight(cfg) > 0.0
}

// A navigable-water score alone also accepts lines entirely out at sea.
fn shore_front(path:&[Point],surface:Surface<'_>)->bool {
    if path.len()<2 {return false;}
    let reach=20.0+2.0*surface.width/surface.n as f64;
    [0.0,0.25,0.5,0.75,1.0].into_iter().all(|f| {
        let at=sub_path(path,0.0,length(path)*f);
        let p=*at.last().unwrap_or(&path[0]);
        if surface.wet(p) {return false;}
        let i=at.len().saturating_sub(2);
        let t=if at.len()>1 {unit(at[i],p)} else {unit(path[0],path[1])};
        [left(t),Point{x:t.y,y:-t.x}].into_iter().any(|n|
            (1..=reach.ceil() as usize).any(|d|surface.wet(add(p,n,d as f64))))
    })
}

fn code(surface: Surface<'_>, p: Point) -> u8 { water_code(surface, p) }

fn dist(a: Point, b: Point) -> f64 {
    (a.x - b.x).hypot(a.y - b.y)
}
fn add(p: Point, n: Point, d: f64) -> Point {
    Point {
        x: p.x + n.x * d,
        y: p.y + n.y * d,
    }
}
fn unit(a: Point, b: Point) -> Point {
    let l = dist(a, b).max(1e-9);
    Point {
        x: (b.x - a.x) / l,
        y: (b.y - a.y) / l,
    }
}
fn left(t: Point) -> Point {
    Point { x: -t.y, y: t.x }
}
fn length(path: &[Point]) -> f64 {
    path.windows(2).map(|w| dist(w[0], w[1])).sum()
}

/// Harbour parameters of a culture (`cultures.<c>.plan.harbour`).
#[derive(Clone, Copy, Debug)]
pub(in super::super) struct Harbour {
    /// Quay length per square root of inhabitants (m): 20 000 people and
    /// 6 m/√hab give ~850 m of quays.
    pub quay_per_sqrt_pop: f64,
    pub quay_width: f64,
    /// Distance between piers along a quay, for a 10 000-inhabitant port.
    pub pier_spacing: f64,
    /// Pier length range (m) over open water; rivers and canals get landing
    /// stages instead, short enough to keep the channel free.
    pub pier_length: (f64, f64),
    /// Sea ports build a sheltered basin between two moles where the coast
    /// allows.
    pub basin: bool,
    /// Lagoon towns line every shore and canal with quays (fondamenta).
    pub fondamenta: bool,
}
impl Default for Harbour {
    fn default() -> Self {
        Self {
            quay_per_sqrt_pop: 6.0,
            quay_width: 6.0,
            pier_spacing: 110.0,
            pier_length: (18.0, 45.0),
            basin: false,
            fondamenta: false,
        }
    }
}
pub(in super::super) fn params(culture: &str) -> Harbour {
    let h = &super::super::catalogue()["cultures"][culture]["plan"]["harbour"];
    let d = Harbour::default();
    let num = |k: &str, v: f64| {
        h[k].as_f64()
            .filter(|x| x.is_finite() && *x > 0.0)
            .unwrap_or(v)
    };
    let range = &h["pierLength"];
    let (a, b) = (
        range[0].as_f64().unwrap_or(d.pier_length.0),
        range[1].as_f64().unwrap_or(d.pier_length.1),
    );
    Harbour {
        quay_per_sqrt_pop: num("quayPerSqrtPop", d.quay_per_sqrt_pop),
        quay_width: num("quayWidth", d.quay_width).clamp(3.0, 12.0),
        pier_spacing: num("pierSpacing", d.pier_spacing).clamp(30.0, 400.0),
        pier_length: (a.clamp(4.0, 200.0), b.clamp(a.clamp(4.0, 200.0), 250.0)),
        basin: h["basin"].as_bool().unwrap_or(d.basin),
        fondamenta: h["fondamenta"].as_bool().unwrap_or(d.fondamenta),
    }
}

/// A port: its site archetype, declared port siting or a port function.
/// Waterfront cultures (`plan.waterfront`) build quays as well.
pub(in super::super) fn port_town(cfg: &LayoutConfig) -> bool {
    matches!(cfg.site_archetype.as_str(), "harbor" | "lakeshore" | "bridge")
        || cfg.programme.navigable_access
        || cfg
            .programme
            .functions
            .as_ref()
            .is_some_and(|f| f.port > 0.0)
}

pub(in super::super) fn water_code(surface: Surface<'_>, p: Point) -> u8 {
    surface.classify_water(p)
}

/// A platform is cadastral geometry, not the casing of a street.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Quay {
    pub kind: String,
    pub shape: Shape,
    pub deck_z_m: f64,
    pub material: String,
}
