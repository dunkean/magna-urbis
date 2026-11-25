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
use works::{HARBOUR_REACH, centred, densify, landing_links, landing_streets, quay_budget, sub_path, touching, unlaid, untangled, works_with_minimum};
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
    /// 4.5 m/√hab give ~640 m of quays.
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
            quay_per_sqrt_pop: 4.5,
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

/// The land a town reaches without crossing the sea or a lake: the dry cells joined to its centre, its
/// rivers counted as land (a town bridges its river), with what the crossings already built join.
/// No harbour element stands on any other land.
pub(in super::super) struct Reach {
    side: usize,
    cell: f64,
    /// Cells of the reached land; `None` when the centre stands on no land: nothing is ruled out.
    member: Option<Vec<bool>>,
}
impl Reach {
    /// Most cells per side of the flooded grid.
    const SIDE: usize = 512;
    pub(in super::super) fn new(surface: Surface<'_>, from: Point, streets: &[Street]) -> Self {
        let step = surface.n.div_ceil(Self::SIDE).max(1);
        let side = surface.n / step;
        let cell = surface.width * step as f64 / surface.n.max(1) as f64;
        let mut reach = Self { side, cell, member: None };
        if side < 2 {
            return reach;
        }
        let land: Vec<bool> = (0..side * side)
            .map(|i| {
                let (x, y) = ((i % side) * step + step / 2, (i / side) * step + step / 2);
                matches!(surface.water[y * surface.n + x], 0 | 3)
            })
            .collect();
        let start = |p: Point| {
            let gap = |i: usize| dist(Point { x: ((i % side) as f64 + 0.5) * cell, y: ((i / side) as f64 + 0.5) * cell }, p);
            reach.around(p, 3).into_iter().filter(|&i| land[i]).min_by(|&a, &b| gap(a).total_cmp(&gap(b)))
        };
        let Some(first) = start(from) else { return reach };
        let flood = |member: &mut Vec<bool>, first: usize| {
            let mut stack = vec![first];
            member[first] = true;
            while let Some(i) = stack.pop() {
                let (x, y) = (i % side, i / side);
                let next = [(x > 0).then(|| i - 1), (x + 1 < side).then_some(i + 1), (y > 0).then(|| i - side), (y + 1 < side).then_some(i + side)];
                for j in next.into_iter().flatten() {
                    if land[j] && !member[j] {
                        member[j] = true;
                        stack.push(j);
                    }
                }
            }
        };
        let mut member = vec![false; side * side];
        flood(&mut member, first);
        let spans: Vec<[usize; 2]> = streets
            .iter()
            .filter(|s| matches!(s.role.as_str(), "bridge" | "causeway") && s.path.len() >= 2)
            .filter_map(|s| Some([start(s.path[0])?, start(*s.path.last()?)?]))
            .collect();
        while let Some(far) = spans.iter().find_map(|&[a, b]| match (member[a], member[b]) {
            (true, false) => Some(b),
            (false, true) => Some(a),
            _ => None,
        }) {
            flood(&mut member, far);
        }
        reach.member = Some(member);
        reach
    }
    /// The cells within `r` cells of the one that holds `p`.
    fn around(&self, p: Point, r: i64) -> Vec<usize> {
        let (x, y, side) = ((p.x / self.cell).floor() as i64, (p.y / self.cell).floor() as i64, self.side as i64);
        (y - r..=y + r)
            .flat_map(|y| (x - r..=x + r).map(move |x| (x, y)))
            .filter(|&(x, y)| x >= 0 && y >= 0 && x < side && y < side)
            .map(|(x, y)| (y * side + x) as usize)
            .collect()
    }
    /// `p` stands on the reached land, or within a cell of it (a point on the bank).
    pub(in super::super) fn holds(&self, p: Point) -> bool {
        self.member.as_ref().is_none_or(|member| self.around(p, 1).into_iter().any(|i| member[i]))
    }
}

/// How far (m) beyond its circuits a walled town still has its harbour on the shore.
const SHORE_REACH: f64 = 60.0;

/// The quays laid so far already make the harbour of the town on its own water: enough of them stand
/// within its radius (on the sea or a lake for a sea or lake site). Their landing rows, and in time the
/// quarters, are cut to them: they are not laid again.
pub(in super::super) fn own_front(streets: &[Street], surface: Surface<'_>, cfg: &LayoutConfig, site: &Site, culture: &str) -> bool {
    let open = matches!(cfg.site_archetype.as_str(), "harbor" | "lakeshore");
    let own: f64 = streets.iter().filter(|s| s.role == "quay" && near_centre(s, site) && !(open && river_side(surface, &s.path))).map(|s| length(&s.path)).sum();
    own >= (0.4 * quay_budget(site, cfg, params(culture))).min(80.0)
}
fn near_centre(s: &Street, site: &Site) -> bool {
    s.path.windows(2).any(|w| g::distance(site.center, w[0], w[1]).0 <= site.radius)
}

/// The harbour of a walled town, decided before its walls are set back from the water. A plan whose
/// quays already make the harbour of the town (`own_front`) keeps them, less the ones on another
/// water. Elsewhere the outline of the growth stopped short of a shore that the enceinte then takes
/// in: the quays are laid on the shore the circuits reach, whole, with their landing rows behind them.
/// Returns the port yards, which join the plan as quarters of its youngest epoch (none for a harbour
/// kept `inside`).
#[allow(clippy::too_many_arguments)]
pub(in super::super) fn town_port(
    quarters: &mut Vec<super::super::Quarter>,
    streets: &mut Vec<Street>,
    walls: &[Shape],
    surface: Surface<'_>,
    cfg: &LayoutConfig,
    site: &Site,
    culture: &str,
    m: &super::Morph,
    inside: bool,
) -> Vec<Shape> {
    use geo::Buffer;
    if surface.n < 2 || !port_town(cfg) || parameterized(cfg) || params(culture).fondamenta {
        return vec![];
    }
    if own_front(streets, surface, cfg, site, culture) {
        let own: Vec<(Point, Point)> = streets.iter().filter(|s| s.role == "quay" && near_centre(s, site)).flat_map(|s| s.path.windows(2).map(|w| (w[0], w[1]))).collect();
        streets.retain(|s| {
            s.role != "quay" || s.path.len() < 2 || river_side(surface, &s.path) || near_centre(s, site)
                || s.path.iter().any(|&p| own.iter().any(|&(a, b)| g::distance(p, a, b).0 <= HARBOUR_REACH))
        });
        return vec![];
    }
    let near_wall = |w: &Shape| {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g::shapes(g::polygon(w).buffer(SHORE_REACH)))).unwrap_or_else(|_| vec![w.clone()])
    };
    let regions: Vec<Shape> = walls.iter().flat_map(near_wall).flat_map(|s| g::dry_clip(&surface, &s)).filter(|s| g::area(s) > 500.0).collect();
    quays(&regions, streets, surface, cfg, site, culture, true);
    if !streets.iter().any(|s| s.role == "quay") {
        return vec![];
    }
    super::add_landing_rows(&regions, streets, &[], surface, cfg, m, culture);
    if inside {
        return vec![];
    }
    let reach = Reach::new(surface, site.center, streets);
    let mut yards: Vec<Shape> = fronts(streets, false, culture, 0.0).iter().flat_map(|s| g::dry_clip(&surface, s)).collect();
    yards.retain(|s| g::area(s) > 200.0 && reach.holds(g::interior_point(s)));
    let Some((phase, zone)) = quarters.iter().max_by_key(|q| q.phase).map(|q| (q.phase, q.zone.clone())) else { return vec![] };
    // A yard is one quarter from the quay to the wall: the quarters give up what they hold of it, so no
    // boundary cuts the plots of the warehouses.
    *quarters = std::mem::take(quarters).into_iter().flat_map(|q| {
        let super::super::Quarter { shape, phase, zone } = q;
        let rest = yards.iter().fold(vec![shape], |rest, yard| rest.iter().flat_map(|s| g::difference(s, yard)).collect());
        rest.into_iter().filter(|s| g::area(s) > 1.0).map(|shape| super::super::Quarter { shape, phase, zone: zone.clone() }).collect::<Vec<_>>()
    }).collect();
    quarters.extend(yards.iter().map(|shape| super::super::Quarter { shape: shape.clone(), phase, zone: zone.clone() }));
    yards
}

/// A platform is cadastral geometry, not the casing of a street.
#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
pub struct Quay {
    pub kind: String,
    pub shape: Shape,
    pub deck_z_m: f64,
    pub material: String,
}
