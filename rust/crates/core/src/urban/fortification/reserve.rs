//! Cut quarters and blocks around the fortification reserve and return vacated land.

use std::sync::OnceLock;
use crate::urban::{Block, Enclosure, Layout, Point, Quarter, Shape, geometry as g, par, parcels};
use super::geometry::{Box2, Cut, area, curtain_body, dist, overlaps, pt, ribbon_half};
use super::street_clearance::Near;

/// Ground unavailable to a new ward or an edited block, including the streets through the reserve.
pub(in super::super) fn circuit_ground(e: &Enclosure) -> Vec<Shape> {
    let half = ribbon_half(&e.kind);
    let width = if e.curtain_width_m > 0.0 { e.curtain_width_m } else { 2.0 * half };
    let mut ground = curtain_body(&e.path, width, half);
    ground.extend(e.reserve.iter().cloned());
    ground.extend(e.ditch.iter().map(|d| d.shape.clone()));
    for c in e.moat.iter().flat_map(|m| &m.crossings) {
        ground.extend(g::ribbon(&c.path, &[2.0 * c.half_width_m]));
    }
    for gate in &e.gatehouses {
        ground.extend(g::ribbon(&gate.passage, &[gate.passage_width_m]));
    }
    ground
}

/// Quarters give up the fortification reserve. A quarter the reserve cuts
/// keeps its pieces of at least `MIN_PIECE` m²: smaller fragments (pockets
/// between a gatehouse, the curtain and the ditch) are returned to open land.
const MIN_PIECE: f64 = 1500.0;
pub(in super::super) fn yield_reserve(quarters: &mut Vec<Quarter>, enclosures: &[Enclosure]) {
    let pieces: Vec<(Shape, Box2)> = enclosures
        .iter()
        .flat_map(|e| e.reserve.iter())
        .map(|s| (s.clone(), g::bbox(s)))
        .collect();
    if pieces.is_empty() {
        return;
    }
    let out = par::map(quarters, |_, q| {
        let qb = g::bbox(&q.shape);
        let mut shapes = vec![q.shape.clone()];
        for (r, rb) in &pieces {
            if !overlaps(qb, *rb, 0.0) {
                continue;
            }
            shapes = shapes
                .into_iter()
                .flat_map(|s| {
                    if overlaps(g::bbox(&s), *rb, 0.0) {
                        g::difference(&s, r)
                    } else {
                        vec![s]
                    }
                })
                .collect();
        }
        let cut = (area(&shapes) - g::area(&q.shape)).abs() > 1.0;
        shapes
            .into_iter()
            .filter(|s| g::area(s) >= if cut { MIN_PIECE } else { 1.0 })
            .map(|shape| Quarter {
                shape,
                phase: q.phase,
                zone: q.zone.clone(),
            })
            .collect::<Vec<_>>()
    });
    *quarters = out.into_iter().flatten().collect();
}

/// Smallest block piece kept where the reserve cuts a block.
const MIN_BLOCK_PIECE: f64 = 100.0;

/// A lean-to has a street edge: an edge of at least 3 m whose middle lies
/// within 2 m of a street ribbon (`segs`: segment ends and half width), the
/// same test `parcels::lean_to_lots` uses to front it on that street.
pub(super) fn fronted(shape: &Shape, segs: &[(Point, Point, f64)]) -> bool {
    let ring = &shape.outer;
    (0..ring.len()).any(|i| {
        let (p, q) = (ring[i], ring[(i + 1) % ring.len()]);
        let m = pt((p.x + q.x) * 0.5, (p.y + q.y) * 0.5);
        dist(p, q) >= 3.0
            && segs
                .iter()
                .any(|&(a, b, hw)| g::distance(m, a, b).0 - hw <= 2.0)
    })
}

pub(super) fn gate_masses(layout: &Layout) -> Vec<Shape> {
    layout.enclosures.iter().flat_map(|e| &e.gatehouses)
        .flat_map(|gh| gh.masses.iter().cloned()).collect()
}

/// Later streets can close a gate or clip its towers. Return only its vacated
/// ground: another work (including a neighbouring curtain) still owns its land.
pub(super) fn release_gate_reserve(layout: &mut Layout, old_masses: Vec<Shape>) -> Vec<Shape> {
    if old_masses.is_empty() { return vec![]; }
    let held = Cut::new(layout.enclosures.iter().flat_map(|e| {
        curtain_body(&e.path, e.curtain_width_m, ribbon_half(&e.kind)).into_iter()
            .chain(e.towers_detail.iter().map(|t| t.footprint.clone()))
            .chain(e.gatehouses.iter().flat_map(|gh| gh.masses.iter().cloned()))
            .chain(e.bastions.iter().map(|w| w.shape.clone()))
            .chain(e.outworks.iter().map(|w| w.shape.clone()))
            .chain(e.ditch.iter().map(|w| w.shape.clone()))
            .chain(e.attached.iter().map(|w| w.shape.clone()))
    }).collect());
    let freed = held.from(old_masses);
    if freed.is_empty() { return freed; }
    let cut = Cut::new(freed.clone());
    for e in &mut layout.enclosures {
        e.reserve = cut.from(std::mem::take(&mut e.reserve));
    }
    for q in &mut layout.quarters {
        let domain = Shape { outer: q.shape.outer.clone(), holes: vec![] };
        let qb = g::bbox(&domain);
        let mut shapes = vec![q.shape.clone()];
        shapes.extend(freed.iter().filter(|s| overlaps(qb, g::bbox(s), 0.0))
            .flat_map(|s| g::intersection(&domain, s)));
        if shapes.len() > 1 {
            // Refill holes within this quarter's existing boundary; neither its
            // index nor its neighbours' land changes after block allocation.
            if let Some(shape) = g::union(&shapes).into_iter()
                .max_by(|a, b| g::area(a).total_cmp(&g::area(b))) {
                q.shape = shape;
            }
        }
    }
    freed
}

pub(super) fn trim_blocks(layout: &mut Layout, reserve_all: Vec<(Shape, Box2)>) {
    // --- blocks give up the reserve
    let walls: Vec<_> = layout.enclosures.iter().filter(|e| !e.style.is_empty() && e.path.len() >= 4)
        .map(|e| (Near::new(&e.path, 30.0), e.curtain_width_m * 0.5 + 1.0)).collect();
    let reserve = Cut {
        shapes: reserve_all,
    };
    let blocks = std::mem::take(&mut layout.blocks);
    let frontage = OnceLock::new();
    let out = par::map(&blocks, |i, b| {
        // Quarter partitioning can leave a tiny piece just clear of the
        // curtain. It follows the same rule as a piece cut by the reserve.
        if b.kind == "block" && g::area(&b.shape) < MIN_BLOCK_PIECE && walls.iter().any(|(near, reach)|
            b.shape.outer.iter().any(|&p| near.distance(p, p) <= *reach)) { return vec![]; }
        if reserve.hits(&b.shape) <= 0.5 {
            return vec![b.clone()];
        }
        let pieces = reserve.from(vec![b.shape.clone()]);
        let split = pieces.len() > 1 && b.kind == "block";
        pieces.into_iter().filter(|s| g::area(s) >= MIN_BLOCK_PIECE)
            .map(|shape| {
                let mut piece = Block { shape, ..b.clone() };
                // A curtain can cut the street off one piece of a serviced block.
                // Its landlocked backland stays open, as on the parcel cut.
                if split && !layout.programme.iter().flat_map(|p| &p.reservations).any(|r| r.block == i)
                    && parcels::access_fronts(&piece.shape, layout,
                        frontage.get_or_init(|| parcels::FrontageIndex::new(layout))).is_empty() {
                    piece.kind = "reserve".into();
                }
                piece
            })
            .collect()
    });
    layout.blocks = out.into_iter().flatten().collect();
}
