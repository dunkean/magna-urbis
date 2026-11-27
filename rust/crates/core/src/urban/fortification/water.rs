//! Walls against water, decided once, at the trace.
//!
//! Invariant: a defended circuit is one closed ring whose curtain only a gate interrupts, and it
//! never stands in water. `water_fronts` gives a circuit its dry line, at the first trace and at
//! every refit: set back from every shore, bank and harbour front, round a pond, crossing water only
//! on a channel a water gate spans, square to the flow, and one ring per bank of a wider one.
//! On a sea or lake shore the curtain leaves the beach bare (`beach`).
//! An inlet is crossed at its mouth: a ring never runs up one bank of a narrow creek and back down
//! the other (`over_inlets`). A stream entered a walled town by a water gate or a culvert: the Ngu Ha
//! canal passes through the citadel of Hue under two of them.
//! `gate_spans` lets `build` open water gates on those crossings only, and `audit` measures what is
//! left of the rule on a finished circuit.

use crate::urban::{Enclosure, Layout, Point, Shape, Street, Surface, Work, composition, geometry as g};
use magna_urbis_geom::difference_many;
use super::geometry::{Cut, V, add, area, buffer, buffer_all, closed, cross, dir, dist, dot, overlaps, pt, quad};
use super::gate_budget::{CORNER_TURN, STRAIGHT};
use super::pockets::{closed_at_mouth, pocket_land};
use super::shore::{WallWalk, water_passages};

/// Widest water (m) a water gate spans. A wider channel leaves each bank its own circuit.
pub(super) const WATER_GATE_SPAN: f64 = 35.0;
/// Wall walk (m) kept between the outer face of a curtain and the waterline.
const WALK: f64 = 5.0;
/// Beach (m) left bare before that wall walk on a sea or lake shore, where the land is deep enough.
const BEACH: f64 = 20.0;
/// A ring at most this much (m) nearer a shore than its beach, or nearer over less than `TIDY` m², is
/// behind it: a ring drawn on that line, then simplified, is left as it is.
const GIVE: f64 = 6.0;
const TIDY: f64 = 100.0;
/// Reach (m) of a quay: the land that near it is harbour, not beach.
const QUAY_REACH: f64 = 60.0;
/// Water nearer than the setback less this slack (m) moves a ring: a ring already set back, then
/// simplified within a metre, is left as it is.
const SLACK: f64 = 1.5;
/// A water piece of a circuit under this area (m²) and this extent (m) that its ring meets once is
/// a pond, not a channel: the ring goes round it.
const POND: (f64, f64) = (2_500.0, 100.0);
/// How far (m) each end of a crossing may move along the ring for the curtain to come straight to the
/// bank and stand square to the flow, and the dry length (m) it keeps on each bank for its abutment.
const SQUARE_REACH: f64 = 80.0;
const ABUTMENT: f64 = 4.0;
/// How far (m) from the ring a straight crossing may pass outside it, and from the water its dry ends
/// may stand nearer to a bank than the setback.
const ASIDE: f64 = 25.0;
const APPROACH: f64 = 30.0;
/// A ditch ends this far (m) from natural water: a dam of plain ground holds its water.
pub(super) const MOAT_SHORT: f64 = 8.0;
/// Mean width (m) up to which a re-entrant of a ring is an inlet, crossed at its mouth: following
/// its two sides raises far more wall than the land it leaves out is worth.
const INLET: f64 = 80.0;
/// Side (m) of the cells in which the water along a trace is read: a channel crossing stands at most
/// that far inside the town.
const BAND: f64 = 30.0;
/// Sampling step (m) along a ring.
const STEP: f64 = 2.0;
/// Smallest bank (m²) that keeps a circuit of its own.
const MIN_BANK: f64 = 5_000.0;
/// Opening (m) that removes the needles a cut leaves.
const NECK: f64 = 2.0;
/// Land narrower than this (m) between two stretches of a ring is a finger or a neck: no wall goes
/// round it. What the opening takes off a corner (under `CORNER` m²) stays.
const FINGER: f64 = 30.0;
const CORNER: f64 = 400.0;
/// Water thinner than this (m) is a seam of the clipped land, not water.
const THIN: f64 = 1.0;
/// Half the width (m) from which a stretch of water is too wide for a gate: a little under half the
/// span, for the round end of the cut.
const BROAD: f64 = 14.5;
/// Length (m) of curtain a gate point without a gate leaves open in the drawn wall.
const BARE_GATE: f64 = 6.5;

/// Open water at `p`: cave rock is `wet` for building but is no shore.
fn water(surface: Surface<'_>, p: Point) -> bool {
    surface.wet(p) && !surface.solid(p)
}

/// The circuits `shapes` on dry land: each ring stands `face` + a wall walk back from the water and
/// behind the `harbour` fronts (`macroplan::harbour::fronts`). A channel a water gate spans stays
/// inside its ring (the curtain crosses it once on each side of the town, square to the flow); a wider
/// one leaves each occupied bank its own closed ring; a pond the ring meets is gone round. A ring
/// with no water within its wall walk and no inlet (`is_inlet`) is returned as it is.
pub(in super::super) fn water_fronts(shapes: Vec<Shape>, occupied: &[Shape], harbour: &[Shape], surface: Surface<'_>, face: f64) -> Vec<Shape> {
    let setback = face.max(1.0) + WALK;
    shapes.iter().flat_map(|s| dry_circuits(s, occupied, harbour, surface, setback, false)).collect()
}

/// The same rule on circuits whose water gates are already placed (a refit, a forced footprint, a
/// circuit `settle` is about to build): each crossing a gate spans keeps its line, only the rest of
/// the ring is read. A ring that obeys the rule is returned as it is, so the rule can be applied at
/// every stage without moving a wall.
pub(in super::super) fn kept_fronts(shapes: Vec<Shape>, occupied: &[Shape], harbour: &[Shape], surface: Surface<'_>, face: f64) -> Vec<Shape> {
    let setback = face.max(1.0) + WALK;
    shapes.iter().flat_map(|s| dry_circuits(s, occupied, harbour, surface, setback, true)).collect()
}

fn dry_circuits(shape: &Shape, occupied: &[Shape], harbour: &[Shape], surface: Surface<'_>, setback: f64, placed: bool) -> Vec<Shape> {
    let plain = Shape { outer: shape.outer.clone(), holes: vec![] };
    if plain.outer.len() < 3 {
        return vec![shape.clone()];
    }
    let bounds = g::bbox(&plain);
    // A front counts when the circuit holds real land of it, not the sliver a simplified ring leaves.
    let fronts: Vec<Shape> = harbour.iter()
        .filter(|h| overlaps(g::bbox(h), bounds, setback) && area(&g::intersection(&plain, h)) > 50.0)
        .cloned().collect();
    // Placed crossings, as (arc, length) with the approach on each bank: their water is not read again.
    let gates: Vec<(f64, f64)> = if placed {
        placed_gates(&plain.outer, surface, setback)
    } else {
        vec![]
    };
    let mut cells = water_cells(&plain.outer, setback - SLACK, &gates, |q| water(surface, q));
    if cells.is_empty() && fronts.is_empty() && beach(&plain, harbour, surface, setback, &gates).is_empty() {
        // Nothing to set back from; the outline may still go round a creek farther off.
        let ring = if placed { shape.clone() } else { over_inlets(shape, harbour, surface) };
        return vec![square_spans(ring, &plain, harbour, surface, setback, placed)];
    }
    // At the first trace the outline closes over the creeks it goes round: each is then crossed
    // once, at its mouth, like any channel.
    let plain = if placed { plain } else { over_slits(plain, &cells, surface) };
    if !placed {
        cells = water_cells(&plain.outer, setback - SLACK, &gates, |q| water(surface, q));
    }
    let band = opened(&band_water(&cells, surface, setback), setback);
    // The circuit less the water band, the harbour fronts and the water `left` out: one overlay.
    let land = |left: &[Shape]| -> Vec<Shape> {
        let cutters = g::union(&band.iter().chain(&fronts).chain(left).cloned().collect::<Vec<_>>());
        if cutters.is_empty() { vec![plain.clone()] } else { difference_many(&plain, &cutters) }
    };
    let crossings = |pieces: &[Shape]| -> Vec<WetRun> { banks(pieces, occupied).iter().flat_map(|r| wet_runs(&closed(&r.outer), surface)).collect() };
    let wide = |run: &WetRun| run.length > WATER_GATE_SPAN + STEP;
    let mut left: Vec<Shape> = vec![];
    let mut pieces = land(&left);
    // The water of the whole circuit, read only for a crossing no gate spans, and how far each
    // piece of it has left the circuit (1: its broad stretch, 2: all of it).
    let mut waters: Option<Vec<Shape>> = None;
    let mut gone: Vec<u8> = vec![];
    for _ in 0..4 {
        let met = crossings(&pieces);
        // A pond the ring meets once leaves the circuit: the ring goes round it.
        let mut more: Vec<Shape> = met.iter().filter(|run| !wide(run)).filter_map(|run| pond_at(run, &met, surface)).flat_map(|pond| buffer_all(&[pond], setback)).collect();
        // A water crossed on a stretch no gate spans leaves the circuit where it is broad, so each
        // bank closes on its own shore; where it narrows it stays inside, crossed on a gate. A
        // crossing still too long after that takes the whole piece out.
        if met.iter().any(|run| wide(run)) {
            if waters.is_none() {
                let read = wet_in(surface, &plain);
                gone = vec![0; read.len()];
                waters = Some(read);
            }
            for (k, piece) in waters.iter().flatten().enumerate() {
                if gone[k] >= 2 || !met.iter().any(|run| wide(run) && g::contains(piece, run.middle)) {
                    continue;
                }
                gone[k] += 1;
                let broad = if gone[k] == 1 { buffer_all(&buffer_all(std::slice::from_ref(piece), -BROAD), BROAD + setback) } else { vec![] };
                if broad.is_empty() {
                    gone[k] = 2;
                    more.extend(opened(std::slice::from_ref(piece), setback));
                } else {
                    more.extend(broad);
                }
            }
        }
        if more.is_empty() {
            break;
        }
        left.extend(more);
        pieces = land(&left);
    }
    // Whatever the pieces, no curtain is left standing in water: all the water goes.
    if crossings(&pieces).iter().any(|run| wide(run)) {
        let all = waters.unwrap_or_else(|| wet_in(surface, &plain));
        left.extend(opened(&all, setback));
        pieces = land(&left);
    }
    // Then the beaches, where they cost no crossing a gate cannot span.
    let bare: Vec<Shape> = pieces.iter().flat_map(|piece| {
        let own = if placed { placed_gates(&piece.outer, surface, setback) } else { vec![] };
        let shore = beach(piece, harbour, surface, setback, &own);
        if shore.is_empty() { vec![piece.clone()] } else { difference_many(piece, &shore) }
    }).collect();
    let pieces = if crossings(&bare).iter().any(|run| wide(run)) || banks(&bare, occupied).is_empty() { pieces } else { bare };
    let cut = finished(pieces, occupied);
    let traced: Vec<Shape> = (0..cut.len()).map(|i| {
        let others: Vec<Shape> = harbour.iter().chain(&cut[..i]).chain(&cut[i + 1..]).cloned().collect();
        over_inlets(&cut[i], &others, surface)
    }).collect();
    let traced: Vec<Shape> = traced.into_iter().map(|ring| square_spans(ring, &plain, harbour, surface, setback, placed)).collect();
    if traced.is_empty() { vec![shape.clone()] } else { traced }
}

/// The sea or a lake at `p`: a river has no beach, nor has the edge of the map.
fn open_water(surface: Surface<'_>, p: Point) -> bool {
    water(surface, p) && matches!(surface.classify_water(p), 1 | 2)
}

/// The crossings of a ring a gate spans, as (arc, length) with the approach on each bank.
fn placed_gates(ring: &[Point], surface: Surface<'_>, setback: f64) -> Vec<(f64, f64)> {
    wet_runs(&closed(ring), surface).iter().filter(|run| run.length <= WATER_GATE_SPAN + STEP)
        .map(|run| (run.from - setback - FINGER, run.length + 2.0 * (setback + FINGER))).collect()
}

/// What the circuit `town` leaves to the beaches along its ring: the land within `setback` + `BEACH`
/// of a broad open water, where enough of the town stands behind it. A neck, a spit or a small island
/// (under `FINGER` m wide once its beaches are off) keeps the plain setback, and so does a quay whose
/// curtain stands right behind it (a thin `harbour` front). Empty when the ring is behind them already.
fn beach(town: &Shape, harbour: &[Shape], surface: Surface<'_>, setback: f64, placed: &[(f64, f64)]) -> Vec<Shape> {
    let depth = setback + BEACH;
    let cells = water_cells(&town.outer, depth - GIVE, placed, |q| open_water(surface, q));
    if cells.is_empty() {
        return vec![];
    }
    // Broader than a channel a gate spans, read far enough out to tell.
    let half = WATER_GATE_SPAN * 0.5;
    let read: Vec<Shape> = cell_boxes(&cells, depth + 2.0 * half).iter().flat_map(|zone| wet_in(surface, zone)).filter(|w| open_water(surface, g::interior_point(w))).collect();
    let broad = buffer_all(&g::union(&read), -half);
    let shore = buffer_all(&broad, half + depth);
    if shore.is_empty() {
        return vec![];
    }
    // The land wide enough behind the beaches, and what it has room for before it; a narrow part of
    // the town keeps its shores and its foot, so no beach parts it from the rest.
    let behind = difference_many(town, &shore);
    let body = buffer_all(&buffer_all(&behind, -FINGER * 0.5), FINGER * 0.5);
    let mut room = buffer_all(&body, depth + NECK);
    let narrow: Vec<Shape> = Cut::new(body).from(behind).into_iter().chain(Cut::new(room.clone()).from(vec![town.clone()])).filter(|s| g::area(s) >= CORNER).collect();
    if !narrow.is_empty() {
        room = Cut::new(buffer_all(&g::union(&narrow), depth + NECK)).from(room);
    }
    let thin: Vec<Shape> = harbour.iter().filter(|h| buffer(h, -8.0).is_empty()).cloned().collect();
    if !thin.is_empty() {
        room = Cut::new(buffer_all(&thin, depth)).from(room);
    }
    let near = buffer_all(&broad, half + depth - GIVE);
    shore.iter().flat_map(|s| room.iter().flat_map(move |r| g::intersection(s, r)))
        .filter(|cut| near.iter().flat_map(|n| g::intersection(cut, n)).map(|n| area(&g::intersection(&n, town))).sum::<f64>() > TIDY)
        .collect()
}

/// The bare beach before a curtain: the dry land between its outer face and the sea or lake it faces,
/// away from the quays. No quarter, block or lot stands on it.
pub(super) fn bare_beach(path: &[Point], ns: &[V], face: f64, streets: &[Street], surface: Surface<'_>) -> Vec<Shape> {
    let quays: Vec<(Point, Point)> = streets.iter().filter(|s| s.role == "quay").flat_map(|s| s.path.windows(2).map(|w| (w[0], w[1]))).collect();
    let mut strip = vec![];
    for (w, &n) in path.windows(2).zip(ns) {
        let l = dist(w[0], w[1]);
        let steps = (l / 8.0).ceil().max(1.0) as usize;
        let piece = l / steps as f64;
        for k in 0..steps {
            let from = add(w[0], dir(w[0], w[1]), piece * k as f64);
            let middle = add(from, dir(w[0], w[1]), piece * 0.5);
            let depth = (1..=7).map(|r| f64::from(r) * 5.0).find(|&r| open_water(surface, add(middle, n, face + r)));
            let Some(depth) = depth else { continue };
            if quays.iter().all(|&(a, b)| g::distance(middle, a, b).0 > QUAY_REACH) {
                strip.push(quad(from, dir(w[0], w[1]), n, [-4.0, piece + 4.0], [face, face + depth]));
            }
        }
    }
    g::union(&strip).iter().flat_map(|s| g::dry_clip(&surface, s)).collect()
}

/// The pond under the crossing `run`, when the ring meets it nowhere else: a water under `POND` in
/// area and extent, read in a window just larger than that.
fn pond_at(run: &WetRun, met: &[WetRun], surface: Surface<'_>) -> Option<Shape> {
    let (m, reach) = (run.middle, POND.1 + 10.0);
    let window = g::rectangle(m.x - reach, m.y - reach, m.x + reach, m.y + reach);
    let pond = opened(&wet_in(surface, &window), 0.0).into_iter().find(|w| g::contains(w, m))?;
    let (x0, y0, x1, y1) = g::bbox(&pond);
    let whole = x0 > m.x - reach + 1.0 && y0 > m.y - reach + 1.0 && x1 < m.x + reach - 1.0 && y1 < m.y + reach - 1.0;
    let small = g::area(&pond) < POND.0 && (x1 - x0).max(y1 - y0) <= POND.1;
    (whole && small && met.iter().filter(|other| g::contains(&pond, other.middle)).count() == 1).then_some(pond)
}

/// A slit of water narrower than a gate span that runs into the circuit (a creek the founding
/// outline goes round on both banks) is water inside the town: the outline closes over it. Only the
/// outline near water (`cells`) is closed, and only gaps that are mostly water join, so no land
/// outside the founding outline is taken.
fn over_slits(plain: Shape, cells: &std::collections::BTreeSet<(i64, i64)>, surface: Surface<'_>) -> Shape {
    use geo::BooleanOps;
    let near: Vec<Shape> = cell_boxes(cells, 2.0 * WATER_GATE_SPAN).iter().flat_map(|zone| g::intersection(&plain, zone)).collect();
    if near.is_empty() {
        return plain;
    }
    let land = geo::MultiPolygon(g::union(&near).iter().map(g::polygon).collect());
    let Ok(gaps) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| g::shapes(composition::closing(&land, WATER_GATE_SPAN * 0.5).difference(&land)))) else {
        return plain;
    };
    // A gap inside the outline is land of the town the cells did not cover, not a slit.
    let slits: Vec<Shape> = gaps.into_iter()
        .filter(|gap| g::area(gap) > 20.0 && !g::contains(&plain, g::interior_point(gap)) && area(&g::dry_clip(&surface, gap)) <= 0.5 * g::area(gap))
        .collect();
    if slits.is_empty() {
        return plain;
    }
    let joined = g::union(&std::iter::once(plain.clone()).chain(slits).collect::<Vec<_>>());
    joined.into_iter().max_by(|a, b| g::area(a).total_cmp(&g::area(b))).map_or(plain, |s| g::normalized(Shape { outer: s.outer, holes: vec![] }))
}

/// `ring` with each of its inlets crossed at the mouth (`is_inlet`).
pub(in super::super) fn over_inlets(ring: &Shape, barred: &[Shape], surface: Surface<'_>) -> Shape {
    closed_at_mouth(ring, &|chain| is_inlet(chain, barred, surface))
}

/// A pocket of a ring (its `chain`, from one end of its mouth to the other) no wall goes round: under
/// `INLET` m wide on average (the land it adds against the wall it saves), holding no more water than
/// a channel a gate spans, its mouth crossed by at most one such channel, and clear of the `barred`
/// land (harbour fronts, other circuits). A pond at the mouth is gone round (`pond_at`).
fn is_inlet(chain: &[Point], barred: &[Shape], surface: Surface<'_>) -> bool {
    let (a, b) = (chain[0], chain[chain.len() - 1]);
    let saved = chain.windows(2).map(|w| dist(w[0], w[1])).sum::<f64>() - dist(a, b);
    let land = pocket_land(chain);
    let added = g::area(&land);
    if added > 0.5 * INLET * saved {
        return false;
    }
    let runs = wet_runs(&[a, b], surface);
    let spanned = match runs.as_slice() {
        [] => true,
        [run] => single_span(a, b, surface).is_some_and(|(before, wet, after)| wet <= WATER_GATE_SPAN && before.min(after) >= ABUTMENT) && pond_at(run, &runs, surface).is_none(),
        _ => false,
    };
    let bounds = g::bbox(&land);
    spanned
        && !barred.iter().any(|s| overlaps(g::bbox(s), bounds, 0.0) && area(&g::intersection(&land, s)) > 50.0)
        && added - area(&g::dry_clip(&surface, &land)) <= 0.6 * WATER_GATE_SPAN * saved
}

/// Cells (`BAND` m) that hold water (`wet`) within `reach` of the closed `ring`, outside its `placed`
/// stretches ((arc, length) along the ring).
fn water_cells(ring: &[Point], reach: f64, placed: &[(f64, f64)], wet: impl Fn(Point) -> bool) -> std::collections::BTreeSet<(i64, i64)> {
    let mut cells = std::collections::BTreeSet::new();
    let n = ring.len();
    let total: f64 = (0..n).map(|i| dist(ring[i], ring[(i + 1) % n])).sum::<f64>().max(1e-9);
    let mut at = 0.0;
    for i in 0..n {
        let (a, b) = (ring[i], ring[(i + 1) % n]);
        let l = dist(a, b);
        let steps = (l / (2.0 * STEP)).ceil().max(1.0) as usize;
        let from = at;
        at += l;
        for k in 0..steps {
            let t = k as f64 / steps as f64;
            if placed.iter().any(|&(start, length)| (from + l * t - start).rem_euclid(total) <= length) {
                continue;
            }
            let p = pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
            let around = (0..8).flat_map(|d| {
                let angle = f64::from(d) * std::f64::consts::FRAC_PI_4;
                [0.5, 1.0].map(|r| add(p, (angle.cos(), angle.sin()), reach * r))
            });
            for q in std::iter::once(p).chain(around).filter(|&q| wet(q)) {
                cells.insert(((q.x / BAND).floor() as i64, (q.y / BAND).floor() as i64));
            }
        }
    }
    cells
}

/// The `cells` as boxes with a `margin`, the cells of one row in runs.
fn cell_boxes(cells: &std::collections::BTreeSet<(i64, i64)>, margin: f64) -> Vec<Shape> {
    let mut rows: std::collections::BTreeMap<i64, Vec<i64>> = Default::default();
    for &(x, y) in cells {
        rows.entry(y).or_default().push(x);
    }
    let mut boxes = vec![];
    for (y, xs) in rows {
        let mut k = 0;
        while k < xs.len() {
            let first = xs[k];
            while k + 1 < xs.len() && xs[k + 1] == xs[k] + 1 {
                k += 1;
            }
            boxes.push(g::rectangle(first as f64 * BAND - margin, y as f64 * BAND - margin, (xs[k] + 1) as f64 * BAND + margin, (y + 1) as f64 * BAND + margin));
            k += 1;
        }
    }
    boxes
}

/// The water of `cells`, each read with a margin of `setback` so that a shore across a cell edge is
/// set back from too.
fn band_water(cells: &std::collections::BTreeSet<(i64, i64)>, surface: Surface<'_>, setback: f64) -> Vec<Shape> {
    cell_boxes(cells, setback).iter().flat_map(|zone| wet_in(surface, zone)).collect()
}

/// The water of `zone` (with what lies off the map): the complement of its clipped land, in one
/// overlay. It keeps hairlines along the clip edges and the seams of the land pieces (`opened`).
fn wet_in(surface: Surface<'_>, zone: &Shape) -> Vec<Shape> {
    let dry = g::dry_clip(&surface, zone);
    if dry.is_empty() { vec![zone.clone()] } else { difference_many(zone, &dry) }
}

/// `water` without its hairlines (an opening by `THIN`: set back from, each would raise a wall of
/// its own), grown by `grow`.
fn opened(water: &[Shape], grow: f64) -> Vec<Shape> {
    buffer_all(&buffer_all(&g::union(water), -THIN), THIN + grow)
}

/// `s` holds occupied land.
fn held(s: &Shape, occupied: &[Shape]) -> bool {
    let b = g::bbox(s);
    occupied.is_empty() || occupied.iter().any(|q| overlaps(g::bbox(q), b, 0.0) && area(&g::intersection(s, q)) > 1.0)
}

/// The outlines of the dry `pieces` that hold occupied land, as cut: enough to read their crossings.
fn banks(pieces: &[Shape], occupied: &[Shape]) -> Vec<Shape> {
    pieces.iter().filter(|s| g::area(s) >= MIN_BANK && held(s, occupied)).map(|s| Shape { outer: s.outer.clone(), holes: vec![] }).collect()
}

/// The rings of the dry `pieces` that hold occupied land: without fingers, necks or holes, simplified
/// within 2.5 m. When no piece qualifies the largest one stands for the town.
fn finished(pieces: Vec<Shape>, occupied: &[Shape]) -> Vec<Shape> {
    let slim = |s: &Shape, tolerance: f64| {
        let mut outer = g::simplify(&closed(&s.outer), tolerance, |_| false);
        outer.pop();
        let simplified = g::normalized(Shape { outer, holes: vec![] });
        if simplified.outer.len() >= 3 && g::simple(&simplified) { simplified } else { g::normalized(Shape { outer: s.outer.clone(), holes: vec![] }) }
    };
    // Fingers and necks go (what an opening by half `FINGER` removes, corners excepted), then the
    // needles of the cuts. The cuts are arcs: fewer points first, the openings cost their number.
    let opened: Vec<Shape> = pieces.iter().filter(|p| g::area(p) >= 100.0).flat_map(|p| {
        let p = slim(p, 0.5);
        let body = Cut::new(buffer(&p, -FINGER * 0.5).iter().flat_map(|b| buffer(b, FINGER * 0.5)).collect());
        let fingers: Vec<Shape> = body.from(vec![p.clone()]).into_iter().filter(|f| g::area(f) >= CORNER).collect();
        let whole = if fingers.is_empty() { vec![p] } else { Cut::new(fingers).from(vec![p]) };
        whole.iter().flat_map(|q| buffer(q, -NECK)).flat_map(|q| buffer(&q, NECK)).collect::<Vec<_>>()
    }).collect();
    let rings: Vec<Shape> = opened.iter().filter(|s| g::area(s) >= MIN_BANK && held(s, occupied)).map(|s| slim(s, 2.5)).collect();
    if !rings.is_empty() {
        return rings;
    }
    opened.iter().max_by(|a, b| g::area(a).total_cmp(&g::area(b))).map(|s| slim(s, 2.5)).into_iter().collect()
}

/// A stretch of a closed path that stands in water: where it starts along the path (m), its length
/// and its middle point.
#[derive(Clone, Copy, Debug)]
struct WetRun {
    from: f64,
    length: f64,
    middle: Point,
}

/// The stretches of the closed `path` that stand in water, sampled every `STEP`.
fn wet_runs(path: &[Point], surface: Surface<'_>) -> Vec<WetRun> {
    // (point, arc where the sample starts, length it stands for, wet)
    let mut samples: Vec<(Point, f64, f64, bool)> = vec![];
    let mut at = 0.0;
    for w in path.windows(2) {
        let l = dist(w[0], w[1]);
        let steps = (l / STEP).ceil().max(1.0) as usize;
        let piece = l / steps as f64;
        for k in 0..steps {
            let t = (k as f64 + 0.5) / steps as f64;
            let p = pt(w[0].x + (w[1].x - w[0].x) * t, w[0].y + (w[1].y - w[0].y) * t);
            samples.push((p, at + piece * k as f64, piece, water(surface, p)));
        }
        at += l;
    }
    let n = samples.len();
    // Start on dry ground so that no run wraps round the seam; a ring wholly in water is one run.
    let Some(start) = (0..n).find(|&i| !samples[i].3) else {
        return samples.first().map(|s| WetRun { from: 0.0, length: at, middle: s.0 }).into_iter().collect();
    };
    let mut runs = vec![];
    let mut run: Vec<usize> = vec![];
    for k in 1..=n {
        let i = (start + k) % n;
        if samples[i].3 {
            run.push(i);
        } else if !run.is_empty() {
            runs.push(WetRun { from: samples[run[0]].1, length: run.iter().map(|&j| samples[j].2).sum(), middle: samples[run[run.len() / 2]].0 });
            run.clear();
        }
    }
    runs
}

/// What the straight line from `p` to `q` crosses, sampled every metre: the dry length on the first
/// bank, the water, the dry length on the second bank. `None` unless it is dry, then wet, then dry.
fn single_span(p: Point, q: Point, surface: Surface<'_>) -> Option<(f64, f64, f64)> {
    let l = dist(p, q);
    let steps = l.ceil().max(1.0) as usize;
    let piece = l / steps as f64;
    let (mut before, mut wet, mut after) = (0.0, 0.0, 0.0);
    for k in 0..steps {
        let t = (k as f64 + 0.5) / steps as f64;
        if water(surface, pt(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t)) {
            if after > 0.0 {
                return None;
            }
            wet += piece;
        } else if wet > 0.0 {
            after += piece;
        } else {
            before += piece;
        }
    }
    (before > 0.0 && wet > 0.0 && after > 0.0).then_some((before, wet, after))
}

/// The ring with each of its water crossings straight to its banks and square to the flow (`squared`),
/// inside the ring as traced or its founding land, or close by. A `placed` crossing that does not fold
/// its curtain keeps its line.
fn square_spans(ring: Shape, founding: &Shape, harbour: &[Shape], surface: Surface<'_>, setback: f64, placed: bool) -> Shape {
    let within = [founding.clone(), ring.clone()];
    let mut ring = ring;
    // Middles of the crossings already handled, squared or left as traced.
    let mut done: Vec<Point> = vec![];
    for _ in 0..12 {
        let path = closed(&ring.outer);
        let Some(run) = wet_runs(&path, surface).into_iter().find(|run| done.iter().all(|&d| dist(d, run.middle) > run.length * 0.5 + 6.0)) else { break };
        done.push(run.middle);
        if let Some((squared, middle)) = squared(&path, &run, &within, harbour, surface, setback, placed) {
            ring = squared;
            done.push(middle);
        }
    }
    ring
}

/// The closed `path` with its wet stretch `run` re-placed: each end moves along the ring by up to
/// `SQUARE_REACH`, and the crossing becomes the straight line between the two ends that leaves no sharp
/// corner by its gate (`CORNER_TURN`, within `STRAIGHT` m of its banks) and crosses the least water, with
/// `ABUTMENT` m of dry ground on each bank, inside the land `within` or `ASIDE` m from the ring, off the
/// `harbour` fronts. Where a corner is left on every line the first trace takes the gentlest, and a
/// `placed` crossing, moved only when it folds its curtain, stays. Returns the ring and the middle of
/// the span.
fn squared(path: &[Point], run: &WetRun, within: &[Shape], harbour: &[Shape], surface: Surface<'_>, setback: f64, placed: bool) -> Option<(Shape, Point)> {
    let n = path.len() - 1;
    let cum: Vec<f64> = std::iter::once(0.0).chain(path.windows(2).scan(0.0, |acc, w| { *acc += dist(w[0], w[1]); Some(*acc) })).collect();
    let total = cum[n];
    if total < run.length + 2.0 * SQUARE_REACH + 20.0 {
        return None;
    }
    let at = |s: f64| {
        let s = s.rem_euclid(total);
        let k = (0..n).find(|&k| cum[k + 1] >= s).unwrap_or(n - 1);
        let t = ((s - cum[k]) / (cum[k + 1] - cum[k]).max(1e-9)).clamp(0.0, 1.0);
        pt(path[k].x + (path[k + 1].x - path[k].x) * t, path[k].y + (path[k + 1].y - path[k].y) * t)
    };
    let turn = |a: Point, b: Point, c: Point| { let (u, v) = (dir(a, b), dir(b, c)); cross(u, v).atan2(dot(u, v)).abs() };
    // The sharp corners of the ring, and the sharpest turn within `clear` m of the banks of a crossing
    // from arc `from` to arc `to` with `before` and `after` m of dry ground, its ends turning by `ends`.
    let corners: Vec<(f64, f64)> = (0..n).map(|k| (cum[k], turn(path[(k + n - 1) % n], path[k], path[k + 1]))).filter(|c| c.1 > CORNER_TURN).collect();
    let sharpest = |from: f64, to: f64, before: f64, after: f64, ends: [f64; 2], clear: f64| {
        let own = [(before, ends[0]), (after, ends[1])].into_iter().filter(|e| e.0 < clear).map(|e| e.1);
        let kept = corners.iter().filter(|c| {
            let (a, b) = ((from - c.0).rem_euclid(total), (c.0 - to).rem_euclid(total));
            a > 0.5 && a + before < clear || b > 0.5 && b + after < clear
        });
        own.chain(kept.map(|c| c.1)).fold(0.0, f64::max)
    };
    if placed && sharpest(run.from, run.from + run.length, 0.0, 0.0, [0.0; 2], STRAIGHT) <= CORNER_TURN {
        return None;
    }
    let near_ring = |q: Point| path.windows(2).any(|w| g::distance(q, w[0], w[1]).0 <= ASIDE);
    let steps = (SQUARE_REACH / 4.0) as usize;
    // (water crossed + a little for each metre moved, arc of the first end, arc of the second)
    let mut best: Option<(f64, f64, f64)> = None;
    for i in 0..=steps {
        let from = run.from - 1.0 - 4.0 * i as f64;
        let p = at(from);
        if water(surface, p) {
            break;
        }
        for j in 0..=steps {
            let to = run.from + run.length + 1.0 + 4.0 * j as f64;
            let q = at(to);
            if water(surface, q) || 3.0 * (to - from) > total {
                break;
            }
            let Some((before, wet, after)) = single_span(p, q, surface) else { continue };
            if wet > WATER_GATE_SPAN || before.min(after) < ABUTMENT {
                continue;
            }
            // A gate never folds its curtain: a sharp corner by it outweighs any water, a gentle turn a
            // few metres of it.
            let worst = sharpest(from, to, before, after, [turn(at(from - 2.0), p, q), turn(p, q, at(to + 2.0))], STRAIGHT + 2.0 * STEP);
            if placed && worst > CORNER_TURN {
                continue;
            }
            let score = wet + 0.02 * 4.0 * (i + j) as f64 + 3.0 * worst + if worst > CORNER_TURN { 1_000.0 } else { 0.0 };
            if best.is_some_and(|b| score >= b.0) {
                continue;
            }
            let along = |d: f64| add(p, dir(p, q), d);
            let length = dist(p, q);
            let inside = [0.25, 0.5, 0.75].iter().map(|&t| along(length * t)).all(|x| (within.iter().any(|s| g::contains(s, x)) || near_ring(x)) && !harbour.iter().any(|h| g::contains(h, x)));
            // Beyond its approach each dry end keeps the setback from the banks, as the rest of the ring.
            let dry_end = |from: f64, step: f64, run: f64| (0..).map(|k| f64::from(k) * 4.0).take_while(|&d| d < run - APPROACH).all(|d| !near_water(along(from + step * d), setback - SLACK, surface));
            if inside && dry_end(0.0, 1.0, before) && dry_end(length, -1.0, after) {
                best = Some((score, from, to));
            }
        }
    }
    let (_, from, to) = best?;
    let (p, q) = (at(from), at(to));
    // The ring from the second end round to the first; the crossing closes it.
    let kept_length = total - (to - from);
    let mut kept: Vec<(f64, Point)> = (0..n).map(|k| ((cum[k] - to).rem_euclid(total), path[k])).filter(|v| v.0 > 0.5 && v.0 < kept_length - 0.5).collect();
    kept.sort_by(|a, b| a.0.total_cmp(&b.0));
    let outer: Vec<Point> = std::iter::once(q).chain(kept.into_iter().map(|v| v.1)).chain(std::iter::once(p)).collect();
    let ring = g::normalized(Shape { outer, holes: vec![] });
    (ring.outer.len() >= 4 && g::simple(&ring)).then(|| (ring, pt((p.x + q.x) * 0.5, (p.y + q.y) * 0.5)))
}

/// The water gates of a curtain: the wet stretches a gate spans, as entry and exit banks in path
/// order. A longer wet stretch opens nothing: no trace of `water_fronts` holds one, and a circuit
/// that came another way keeps its curtain whole (`audit` reports it).
pub(super) fn gate_spans(walk: &WallWalk<'_>, banks: &[(Point, bool)]) -> Vec<(Point, bool)> {
    water_passages(banks)
        .filter(|&(a, b)| (walk.arc(b) - walk.arc(a)).rem_euclid(walk.total) <= WATER_GATE_SPAN + 2.0 * STEP)
        .flat_map(|(a, b)| [(a, true), (b, false)])
        .collect()
}

/// Open water at `p` or within `reach` of it, sampled on eight sides. At a zero reach the sixteen
/// samples are `p` itself (up to the sign of a zero, which reads the same cell): the first test answers.
pub(super) fn near_water(p: Point, reach: f64, surface: Surface<'_>) -> bool {
    water(surface, p)
        || (reach != 0.0
            && (0..8).any(|d| {
                let angle = f64::from(d) * std::f64::consts::FRAC_PI_4;
                [0.5, 1.0].iter().any(|&r| water(surface, add(p, (angle.cos(), angle.sin()), reach * r)))
            }))
}

/// A ditch is never dug in natural water: each piece ends `MOAT_SHORT` m from it.
pub(super) fn short_of_water(ditch: Vec<Work>, surface: Surface<'_>) -> Vec<Work> {
    ditch
        .into_iter()
        .flat_map(|d| {
            let n = d.shape.outer.len();
            let reaches = (0..n).any(|i| {
                let (a, b) = (d.shape.outer[i], d.shape.outer[(i + 1) % n]);
                let steps = (dist(a, b) / 4.0).ceil().max(1.0) as usize;
                (0..steps).any(|k| {
                    let t = k as f64 / steps as f64;
                    let p = pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
                    near_water(p, MOAT_SHORT, surface)
                })
            });
            if !reaches {
                return vec![d];
            }
            let (x0, y0, x1, y1) = g::bbox(&d.shape);
            let zone = g::rectangle(x0 - MOAT_SHORT, y0 - MOAT_SHORT, x1 + MOAT_SHORT, y1 + MOAT_SHORT);
            let wet = opened(&wet_in(surface, &zone), MOAT_SHORT);
            Cut::new(wet).from(vec![d.shape.clone()]).into_iter().filter(|s| g::area(s) >= 20.0).map(|shape| Work { shape, ..d.clone() }).collect()
        })
        .collect()
}

/// What the rule "only a gate interrupts the curtain, and no curtain stands in water" measures on
/// one circuit.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct WaterAudit {
    /// Openings of the curtain that are no gate: open water fronts, and gate points that carry
    /// neither a street nor a water gate.
    pub gaps: usize,
    /// Length (m) of curtain those openings leave out.
    pub gap_m: f64,
    /// Length (m) of curtain standing in water outside the span of a water gate.
    pub wet_m: f64,
}

/// The audit of the circuit `e` against the final `streets`. A cave circuit keeps its rock faces
/// open: they are not water and are not counted.
pub(super) fn audit(e: &Enclosure, streets: &[Street], surface: Surface<'_>) -> WaterAudit {
    let mut found = WaterAudit::default();
    if e.path.len() < 4 {
        return found;
    }
    let walk = WallWalk::new(&e.path);
    let span = |a: Point, b: Point| (walk.arc(a), (walk.arc(b) - walk.arc(a)).rem_euclid(walk.total));
    let middle = |a: Point, b: Point| {
        let (from, length) = span(a, b);
        walk.along(from + length * 0.5).0
    };
    for front in e.gatehouses.iter().filter(|gh| gh.kind == "shore" && !surface.solid(middle(gh.passage[0], gh.passage[1]))) {
        found.gaps += 1;
        found.gap_m += span(front.passage[0], front.passage[1]).1;
    }
    let crossings = composition::gates(&e.path, streets);
    let ends: Vec<Point> = e.gatehouses.iter().filter(|gh| matches!(gh.kind.as_str(), "water" | "shore")).flat_map(|gh| gh.passage).collect();
    let entered = |q: Point| {
        streets.iter().filter(|s| matches!(s.role.as_str(), "regional" | "approach")).any(|s| {
            let reach = s.widths.iter().copied().fold(0.0, f64::max) * 0.5 + 2.0;
            s.path.first().into_iter().chain(s.path.last()).any(|&p| dist(p, q) < reach)
        })
    };
    for (i, &q) in e.gates.iter().enumerate() {
        if !(crossings.iter().any(|&c| dist(c, q) < 8.0) || ends.iter().any(|&p| dist(p, q) < 2.0) || e.gatehouses.iter().any(|gh| gh.gate == i && gh.kind == "water") || entered(q)) {
            found.gaps += 1;
            found.gap_m += BARE_GATE;
        }
    }
    let spans: Vec<(f64, f64)> = e.gatehouses.iter().filter(|gh| gh.kind == "water").map(|gh| span(gh.passage[0], gh.passage[1])).collect();
    let mut at = 0.0;
    for w in e.path.windows(2) {
        let l = dist(w[0], w[1]);
        let steps = (l / STEP).ceil().max(1.0) as usize;
        for k in 0..steps {
            let t = (k as f64 + 0.5) / steps as f64;
            let s = at + l * t;
            let spanned = spans.iter().any(|&(from, length)| (s - from).rem_euclid(walk.total) <= length);
            if !spanned && water(surface, pt(w[0].x + (w[1].x - w[0].x) * t, w[0].y + (w[1].y - w[0].y) * t)) {
                found.wet_m += l / steps as f64;
            }
        }
        at += l;
    }
    found
}

/// One of the `gaps` between two circuits is water wider than a gate spans (its water over half its
/// outline, its mean wet width): the circuits stay apart, each closed on its bank.
pub(in super::super) fn parted_by_water(gaps: &[Shape], surface: Surface<'_>) -> bool {
    gaps.iter().any(|gap| {
        let n = gap.outer.len();
        let half = (0..n).map(|i| dist(gap.outer[i], gap.outer[(i + 1) % n])).sum::<f64>() * 0.5;
        let wet = g::area(gap) - area(&g::dry_clip(&surface, gap));
        wet > 0.8 * WATER_GATE_SPAN * half.max(1.0)
    })
}

/// A town circuit of `layout` stands along water (within about a beach and a wall walk of it).
pub(in super::super) fn walled_on_water(layout: &Layout, surface: Surface<'_>) -> bool {
    layout.enclosures.iter().filter(|e| e.purpose.is_empty() && e.path.len() >= 4)
        .any(|e| !water_cells(&e.path[..e.path.len() - 1], BEACH + 2.0 * WALK, &[], |q| water(surface, q)).is_empty())
}

/// The audit of every built circuit of `layout`, in enclosure order (castles and citadels included).
pub fn audit_layout(layout: &Layout, surface: Surface<'_>) -> Vec<WaterAudit> {
    layout.enclosures.iter().filter(|e| !e.style.is_empty() && e.path.len() >= 4).map(|e| audit(e, &layout.streets, surface)).collect()
}

#[cfg(test)]
#[path = "water_tests.rs"]
mod tests;
