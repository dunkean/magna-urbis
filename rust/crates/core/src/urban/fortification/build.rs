//! Build a circuit in placement order and assemble its reserved land.

use crate::rng::Rng;
use crate::urban::{Enclosure, Gatehouse, Point, Shape, Street, Surface, Tower, Work, geometry as g};
use super::faubourg::{GateFronts, lean_tos};
use super::gate_works::{gate_info, land_gatehouses, water_gatehouses};
use super::geometry::{
    Cut, TILE, V, area, buffer, curtain_body, dist,
    normals, ribbon_half, segment_relief, tiles, wet_outward,
};
use super::moat::{self, choose_moat, continuous_moat, dig_moat, natural_stops, rounded_ends};
use super::outworks::{citadel, outer_works};
use super::shore::{WallWalk, shore_gaps};
use super::street_clearance::{Predicted, street_clear, street_segments};
use super::style::Style;
use super::towers::towers_and_bastions;
use super::water::{bare_beach, gate_spans, short_of_water};

/// Every structure of one circuit. `e.gates` holds its `land` gates (street
/// crossings); the ends of its water gates are added here. `banks` are the
/// curtain's land/water transitions in path order (`true`: entering water).
/// Only a gate interrupts the curtain: a wet stretch a water gate spans opens
/// on one, any other keeps its curtain (`water::water_fronts` keeps the trace
/// off the water).
#[allow(clippy::too_many_arguments)]
pub(in super::super) fn build(
    e: &mut Enclosure,
    land: usize,
    banks: &[(Point, bool)],
    streets: &[Street],
    surface: Surface<'_>,
    style: &Style,
    pop: u32,
    predicted: &Predicted,
    rng: &Rng,
) -> Vec<Street> {
    let path = e.path.clone();
    let n_seg = path.len().saturating_sub(1);
    if style.timber_culture && style.material == "timber-earth" { e.kind = style.kind.clone(); }
    e.style = style.id.clone();
    e.material = style.material.clone();
    e.curtain_width_m = style.curtain_width;
    e.height_m = style.height;
    if n_seg < 3 {
        return vec![];
    }
    let ring: Vec<Point> = path[..n_seg].to_vec();
    let poly = g::normalized(Shape {
        outer: ring.clone(),
        holes: vec![],
    });
    let h = ribbon_half(&e.kind);
    let c = style.curtain_width;
    let face = c - h;
    let ns = normals(&path);
    let inner_core = Cut::new(tiles(buffer(&poly, -h), TILE));
    let mut hgt = rng.fork("height");
    let jitter = hgt.range(0.92, 1.08);
    let (height, tower_height) = (style.height * jitter, style.tower_height * jitter);
    let mut dr = rng.fork("ditch");
    // Moat and berm scale with the settlement: a village digs a few metres,
    // a 10 000-inhabitant town the full width of its style.
    let size = (f64::from(pop) / 10_000.0).sqrt().clamp(0.3, 1.0);
    let dw = dr.range(
        style.ditch_width[0],
        style.ditch_width[1].max(style.ditch_width[0]),
    );
    let dw = if dw > 0.0 { (dw * size).max(3.0_f64.min(dw)) } else { dw };
    let reach =
        face + style.berm + dw + 25.0 + style.court_radius[1].max(style.outer_gap[1] + 16.0) + 45.0;
    let clear = Cut::new(street_clear(&path, streets, reach, predicted));
    let street_lines = street_segments(&path, streets, reach);
    // Per-segment terrain: steep runs and runs with water outside keep no
    // ditch (water is the moat), get no bastion and a wider tower spacing.
    let steep: Vec<bool> = (0..n_seg)
        .map(|i| segment_relief(path[i], path[i + 1], ns[i], surface) > 0.15)
        .collect();
    let wet: Vec<bool> = (0..n_seg)
        .map(|i| wet_outward(path[i], path[i + 1], ns[i], surface, 10.0) > 0.3)
        .collect();
    let ctx = BuildContext {
        path: &path, ring: &ring, poly: &poly, n_seg, ns: &ns, h, c, face,
        height, tower_height, streets, street_lines: &street_lines,
        inner_core: &inner_core, clear: &clear, surface, style, predicted,
        steep: &steep, wet: &wet,
    };
    let walk = WallWalk::new(&path);
    // A cave circuit keeps every rock contact: its short barriers between the rock are the curtain.
    let banks = if style.cave { banks.to_vec() } else { gate_spans(&walk, banks) };
    // Each passage end is a gate point of the curtain.
    for &(p, _) in &banks {
        if e.gates.iter().all(|&q| dist(q, p) >= 8.0) {
            e.gates.push(p);
        }
    }
    let infos = gate_info(&ctx, &walk, e, land);
    let mut works = Works {
        towers: vec![],
        gatehouses: vec![],
        bastions: vec![],
        bastion_union: vec![],
        outworks: vec![],
        extra_reserve: vec![],
        occupied: Cut::new(vec![]),
    };
    let mut gate_clear = vec![8.0; e.gates.len()];
    land_gatehouses(&ctx, e, &infos, pop, &mut works, &mut gate_clear);
    water_gatehouses(&ctx, &walk, e, &banks, &mut works);
    towers_and_bastions(&ctx, e, &gate_clear, &mut works, rng);

    let major_land: Vec<usize> = (0..land).filter(|&i| infos[i].major).collect();
    // Nothing of a cave curtain stands inside the rock.
    let shore_gaps = shore_gaps(&walk, &works.gatehouses);
    let in_gap = |p: Point| {
        let s = walk.arc(p);
        shore_gaps.iter().any(|&(a, l)| {
            let d = (s - a).rem_euclid(walk.total);
            d > 1.0 && d < l - 1.0
        })
    };
    works.towers.retain(|t| !in_gap(t.anchor));
    let moat_core = outer_works(&ctx, e, &infos, &major_land, &mut works, rng);
    let moat = choose_moat(&ctx, &mut dr, size, dw);
    let GateFronts { attached, lanes, fronts } =
        lean_tos(&ctx, &walk, e, &infos, &major_land, &works, moat, rng);
    let mut ditch = dig_moat(
        &ctx, &walk, e, &infos, &major_land, &mut works, moat, moat_core, fronts, &shore_gaps, rng,
    );
    citadel(&ctx, moat, &mut works.outworks, &mut ditch, rng);

    let Works { towers, gatehouses, bastions, outworks, extra_reserve, .. } = works;
    // Rule: the moat stops short of natural water on a round end, and is a ring or nothing (no stubs
    // between cuts).
    let ditch = rounded_ends(short_of_water(ditch, surface), natural_stops(&ctx, moat, 1.0), moat.dw, surface);
    let ditch = continuous_moat(ditch, &[], &path, surface);
    // Same bounded mitres as the drawn curtain, with a quantisation margin.
    // Rounded buffers leave buildable wedges under its corners.
    let body = curtain_body(&path,c,h);
    let mut reserve: Vec<Shape> = clear.from(tiles(body, TILE));
    reserve.extend(extra_reserve);
    reserve.extend(clear.from(inner_core.from(tiles(bare_beach(&path, &ns, face, streets, surface), TILE))));
    reserve.extend(towers.iter().map(|t| t.footprint.clone()));
    reserve.extend(gatehouses.iter().flat_map(|gh| gh.masses.clone()));
    reserve.extend(bastions.iter().map(|b| b.shape.clone()));
    reserve.extend(outworks.iter().map(|w| w.shape.clone()));
    reserve.extend(ditch.iter().map(|d| d.shape.clone()));
    reserve.extend(attached.iter().map(|a| a.shape.clone()));
    let reserve: Vec<Shape> = tiles(g::union(&reserve), TILE)
        .into_iter()
        .filter(|s| g::area(s) > 0.5)
        .collect();
    // The reserve holds the whole ditch; its water lies in reaches, a dam between two.
    let (ditch, dams) = moat::reaches(&ctx, &walk, moat, ditch);
    e.towers = towers.iter().map(|t| t.anchor).collect();
    e.towers_detail = towers;
    e.gatehouses = gatehouses;
    e.bastions = bastions;
    e.outworks = outworks;
    e.moat = moat::spec(&style.moat_form, &ditch, dams, "", surface);
    e.ditch = ditch;
    e.attached = attached;
    e.reserve = reserve;
    lanes
}

/// Geometry and clipping rules shared by the works of a single circuit.
pub(super) struct BuildContext<'a> {
    pub(super) path: &'a [Point],
    pub(super) ring: &'a [Point],
    pub(super) poly: &'a Shape,
    pub(super) n_seg: usize,
    pub(super) ns: &'a [V],
    pub(super) h: f64,
    pub(super) c: f64,
    pub(super) face: f64,
    pub(super) height: f64,
    pub(super) tower_height: f64,
    pub(super) streets: &'a [Street],
    pub(super) street_lines: &'a [(Point, Point)],
    pub(super) inner_core: &'a Cut,
    pub(super) clear: &'a Cut,
    pub(super) surface: Surface<'a>,
    pub(super) style: &'a Style,
    pub(super) predicted: &'a Predicted,
    pub(super) steep: &'a [bool],
    pub(super) wet: &'a [bool],
}

impl BuildContext<'_> {
    pub(super) fn clip(&self, s: Shape) -> Vec<Shape> {
        self.clear.from(self.inner_core.from(vec![s]))
    }

    pub(super) fn dry_points(&self, s: &Shape) -> bool {
        !s.outer.iter().any(|&p| self.surface.wet(p)) && !self.surface.wet(g::centroid(s))
    }

    pub(super) fn dry_share(&self, s: &[Shape]) -> f64 {
        let a = area(s);
        if a <= 0.0 {
            return 0.0;
        }
        s.iter()
            .map(|p| area(&g::dry_clip(&self.surface, p)))
            .sum::<f64>()
            / a
    }

    pub(super) fn has(&self, work: &str) -> bool {
        self.style.outworks.iter().any(|x| x == work)
    }
}

/// Each pass adds to the footprints already occupied by its predecessors.
pub(super) struct Works {
    pub(super) towers: Vec<Tower>,
    pub(super) gatehouses: Vec<Gatehouse>,
    pub(super) bastions: Vec<Work>,
    pub(super) bastion_union: Vec<Shape>,
    pub(super) outworks: Vec<Work>,
    pub(super) extra_reserve: Vec<Shape>,
    pub(super) occupied: Cut,
}

pub(super) fn free(occupied: &Cut, s: &Shape) -> bool {
    occupied.hits(s) <= 0.5
}
