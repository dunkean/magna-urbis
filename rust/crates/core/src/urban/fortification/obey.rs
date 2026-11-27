//! Walls and moats first: the streets near a circuit obey its final works, wherever the circuit got
//! them (first build, `settle` and every rebuild, the late passes). A gate street passes the passage of
//! its gate (`seat_gate_streets`) and runs on beyond the ditch; every other street keeps out of the moat
//! band (`obey_moats`).

use crate::urban::{Block, Enclosure, Point, Shape, Street, Surface, geometry as g};
use super::gate_budget;
use super::geometry::{Box2, add, dir, dist, normals, pt, ribbon_half};
use super::moat_line;
use super::street_clearance::Near;

/// The envelope of a moat: its band (berm and ditch) and this margin (m) beyond the outer lip.
const ENVELOPE: f64 = 2.0;
/// A gate street carried over the ditch ends this far (m) beyond the outer lip, and links to a street
/// outside within `LINK_OUT` m of that end.
const BEYOND_LIP: f64 = 3.0;
/// The least ground (m) beyond the outer lip a carried street lands on.
const LANDING: f64 = 0.5;
const LINK_OUT: f64 = 40.0;
/// A stretch of street in the envelope is a gate's when the street passes within `GATE_LINE` m of the
/// gate point or its passage, within `GATE_WINDOW` m along the street of the stretch.
const GATE_LINE: f64 = 6.0;
const GATE_WINDOW: f64 = 30.0;
/// A gate street within this distance (m) of both ends of its passage (or of a plain gate point) passes
/// its gate as it is.
const ON_PASSAGE: f64 = 2.0;
/// A street crossing the curtain within this distance (m) of a land gate is that gate's street: farther off,
/// the gate goes to the street (`gate_budget`), not the street to the gate.
const SEAT_REACH: f64 = 10.0;
/// A street moved out of a band is redrawn every `PUSH_STEP` m, `PUSH_CLEAR` m beyond the envelope.
const PUSH_STEP: f64 = 3.0;
const PUSH_CLEAR: f64 = 0.5;
/// Sampling step (m) along a street near a curtain, and the shortest piece (m) a cut keeps.
const STEP: f64 = 1.0;
const MIN_PIECE: f64 = 4.0;

fn cumulated(path: &[Point]) -> Vec<f64> {
    std::iter::once(0.0).chain(path.windows(2).scan(0.0, |acc, w| { *acc += dist(w[0], w[1]); Some(*acc) })).collect()
}

/// The point `s` m along `path` (clamped) and its width on `widths`.
fn at(path: &[Point], widths: &[f64], cum: &[f64], s: f64) -> (Point, f64) {
    let n = path.len();
    let s = s.clamp(0.0, cum[n - 1]);
    let i = (0..n - 1).find(|&i| cum[i + 1] >= s).unwrap_or(n - 2);
    let t = ((s - cum[i]) / (cum[i + 1] - cum[i]).max(1e-12)).clamp(0.0, 1.0);
    let (p, q) = (path[i], path[i + 1]);
    (pt(p.x + (q.x - p.x) * t, p.y + (q.y - p.y) * t), widths[i] + (widths[i + 1] - widths[i]) * t)
}

/// Nearest point of the polyline `line` to `p`.
fn project(line: &[Point], p: Point) -> Point {
    line.windows(2).map(|w| g::distance(p, w[0], w[1])).min_by(|a, b| a.0.total_cmp(&b.0)).map_or(p, |d| d.2)
}

fn to_line(line: &[Point], p: Point) -> f64 {
    line.windows(2).map(|w| g::distance(p, w[0], w[1]).0).fold(f64::INFINITY, f64::min)
}

/// Make `p`, a point on `s`, a vertex of it: streets that meet share a vertex.
fn insert_vertex(s: &mut Street, p: Point) {
    even_widths(s);
    if s.path.len() < 2 || s.path.iter().any(|&q| dist(q, p) < 1e-6) {
        return;
    }
    let (k, (d, t, _)) = (0..s.path.len() - 1).map(|k| (k, g::distance(p, s.path[k], s.path[k + 1]))).min_by(|a, b| a.1.0.total_cmp(&b.1.0)).unwrap();
    if d < 1e-3 {
        let w = s.widths[k] + (s.widths[k + 1] - s.widths[k]) * t;
        s.path.insert(k + 1, p);
        s.widths.insert(k + 1, w);
    }
}

fn even_widths(s: &mut Street) {
    if s.widths.len() != s.path.len() {
        let last = s.widths.last().copied().unwrap_or(4.0);
        s.widths.resize(s.path.len(), last);
    }
}

/// The land gates of `e` with their passage axis (inner end, outer end): the gatehouse passage, else
/// the curtain normal through the gate point.
fn land_axes(e: &Enclosure) -> Vec<(usize, Point, Point)> {
    let ns = normals(&e.path);
    let half = ribbon_half(&e.kind).max(e.curtain_width_m * 0.5) + 1.0;
    (0..e.gates.len())
        .filter_map(|gi| {
            let house = e.gatehouses.iter().find(|gh| gh.gate == gi);
            if house.is_some_and(|gh| matches!(gh.kind.as_str(), "water" | "shore")) {
                return None;
            }
            if let Some(gh) = house.filter(|gh| dist(gh.passage[0], gh.passage[1]) > 0.5) {
                return Some((gi, gh.passage[0], gh.passage[1]));
            }
            let q = e.gates[gi];
            let k = e.path.windows(2).enumerate().min_by(|a, b| g::distance(q, a.1[0], a.1[1]).0.total_cmp(&g::distance(q, b.1[0], b.1[1]).0)).map_or(0, |(k, _)| k);
            Some((gi, add(q, ns[k], -half), add(q, ns[k], half)))
        })
        .collect()
}

/// A gate street passes its gate: the most important street crossing the curtain within `SEAT_REACH` m
/// of a land gate (and nearer to it than to any other gate) that runs off its passage (through the
/// gatehouse masses, or a few metres beside a gate point a rebuilt circuit kept) is moved onto the passage
/// axis over its gate throat, the ends tapered back to its line. Over a ditch it crosses straight: a
/// street that strays from the axis inside the band runs along the axis to beyond the outer lip and
/// meets its old line again outside the works. Streets joined to the moved stretch follow it.
pub(super) fn seat_gate_streets(streets: &mut [Street], enclosures: &[Enclosure], surface: Surface<'_>) {
    let profile = std::env::var("URBAN_PROFILE").is_ok();
    for e in enclosures.iter().filter(|e| !e.style.is_empty() && e.path.len() >= 4) {
        let works = Works::new(e);
        let ring = &works.ring;
        let band = 3.0 * e.moat.as_ref().map_or(0.0, |m| m.width_m) + 30.0;
        let near = Near::new(&e.path, 16.0);
        for (gi, a, b) in land_axes(e) {
            let q = e.gates[gi];
            // (priority, distance, street, arc of its crossing)
            let mut best: Option<(u8, f64, usize, f64)> = None;
            for (si, s) in streets.iter().enumerate() {
                if s.path.len() < 2 || gate_budget::water_way(s, false) {
                    continue;
                }
                let cum = cumulated(&s.path);
                for (j, w) in s.path.windows(2).enumerate() {
                    for k in near.crossed(w[0], w[1]) {
                        let Some((t, x)) = g::segment_hit(w[0], w[1], e.path[k], e.path[k + 1]) else { continue };
                        let d = dist(x, q);
                        let pr = gate_budget::priority(s);
                        if d < SEAT_REACH && e.gates.iter().all(|&o| dist(x, o) >= d) && best.is_none_or(|(bp, bd, _, _)| pr > bp || (pr == bp && d < bd)) {
                            best = Some((pr, d, si, cum[j] + t * (cum[j + 1] - cum[j])));
                        }
                    }
                }
            }
            let Some((_, off, si, cross_at)) = best else { continue };
            let s = &streets[si];
            let mut widths = s.widths.clone();
            if widths.len() != s.path.len() {
                let last = widths.last().copied().unwrap_or(4.0);
                widths.resize(s.path.len(), last);
            }
            let cum = cumulated(&s.path);
            let total = cum[cum.len() - 1];
            let (_, width) = at(&s.path, &widths, &cum, cross_at);
            let throat = (2.0 * width).max(12.0);
            let u = dir(a, b);
            let inward_first = g::contains(ring, at(&s.path, &widths, &cum, (cross_at - 1.0).max(0.0)).0);
            let out = if inward_first { 1.0 } else { -1.0 };
            // Over a ditch: how far the outer lip lies along the axis, and how far the street strays from
            // the axis while it is in the band.
            let across = works.across(b, u, band);
            let stray = across.map_or(0.0, |d| {
                let mut worst = 0.0_f64;
                let mut x = 0.0;
                while x < 4.0 * d {
                    x += 2.0;
                    let arc = cross_at + out * x;
                    if !(0.0..=total).contains(&arc) {
                        break;
                    }
                    let p = at(&s.path, &widths, &cum, arc).0;
                    if x > 4.0 && !works.envelope(p, ENVELOPE) {
                        break;
                    }
                    worst = worst.max(((p.x - a.x) * u.1 - (p.y - a.y) * u.0).abs());
                }
                worst
            });
            let straighten = across.is_some_and(|d| stray > (0.2 * d).max(4.0));
            // On its passage; a plain gate keeps an oblique street through its point.
            let housed = e.gatehouses.iter().any(|gh| gh.gate == gi);
            if !straighten && ((to_line(&s.path, a) <= ON_PASSAGE && to_line(&s.path, b) <= ON_PASSAGE) || (!housed && off <= ON_PASSAGE)) {
                continue;
            }
            let reach = across.filter(|_| straighten).map_or(throat, |d| d.max(throat));
            let (inner, outer) = (add(a, u, -throat), add(b, u, reach));
            if surface.wet(inner) || surface.wet(outer) || !g::contains(ring, inner) || g::contains(ring, outer) {
                continue;
            }
            // Outside, the street is met again after its throat, or, straight across a ditch, where a straight
            // link from the far end of the crossing clears the works.
            let rejoin = if straighten {
                let clear = |p: Point| {
                    let n = dist(outer, p).ceil().max(1.0) as usize;
                    (1..=n).all(|k| {
                        let t = k as f64 / n as f64;
                        let x = pt(outer.x + (p.x - outer.x) * t, outer.y + (p.y - outer.y) * t);
                        !works.envelope(x, 0.5) && !g::contains(ring, x) && !surface.wet(x)
                    })
                };
                let mut x = reach;
                let mut found = None;
                while found.is_none() && x < reach + 250.0 {
                    x += 4.0;
                    let arc = cross_at + out * x;
                    if !(0.0..=total).contains(&arc) {
                        break;
                    }
                    found = clear(at(&s.path, &widths, &cum, arc).0).then_some(x);
                }
                let Some(x) = found else { continue };
                x
            } else {
                2.0 * throat
            };
            let (lo, hi) = if inward_first { ((cross_at - 2.0 * throat).max(0.0), (cross_at + rejoin).min(total)) } else { ((cross_at - rejoin).max(0.0), (cross_at + 2.0 * throat).min(total)) };
            let mut mid: Vec<Point> = vec![];
            if lo > 0.0 {
                mid.push(at(&s.path, &widths, &cum, lo).0);
            }
            mid.extend(if inward_first { [inner, outer] } else { [outer, inner] });
            if hi < total {
                mid.push(at(&s.path, &widths, &cum, hi).0);
            }
            // The stretch replaced, and the vertices other streets may share with it.
            let mut old: Vec<Point> = vec![at(&s.path, &widths, &cum, lo).0];
            old.extend((0..s.path.len()).filter(|&i| cum[i] > lo && cum[i] < hi).map(|i| s.path[i]));
            old.push(at(&s.path, &widths, &cum, hi).0);
            let removed: Vec<Point> = (0..s.path.len()).filter(|&i| cum[i] >= lo - 1e-6 && cum[i] <= hi + 1e-6).map(|i| s.path[i]).collect();
            let mut path: Vec<Point> = vec![];
            let mut ws: Vec<f64> = vec![];
            for i in (0..s.path.len()).filter(|&i| cum[i] < lo - 1e-6) {
                path.push(s.path[i]);
                ws.push(widths[i]);
            }
            ws.extend(std::iter::repeat_n(width, mid.len()));
            path.extend(mid.iter().copied());
            for i in (0..s.path.len()).filter(|&i| cum[i] > hi + 1e-6) {
                path.push(s.path[i]);
                ws.push(widths[i]);
            }
            if profile {
                eprintln!("  seat: gate ({:.0},{:.0}) of {}: {} moved onto its passage{}", q.x, q.y, e.edit_key, s.role, if straighten { ", straight across the ditch" } else { "" });
            }
            let mut joints: Vec<Point> = vec![];
            for (j, t) in streets.iter_mut().enumerate() {
                if j == si {
                    continue;
                }
                let n = t.path.len();
                for (k, v) in t.path.iter_mut().enumerate() {
                    let end = k == 0 || k + 1 == n;
                    if removed.iter().any(|&r| dist(r, *v) < 1e-3) || (end && to_line(&old, *v) < 0.5) {
                        *v = project(&mid, *v);
                        joints.push(*v);
                    }
                }
            }
            streets[si].path = path;
            streets[si].widths = ws;
            for p in joints {
                insert_vertex(&mut streets[si], p);
            }
        }
    }
}

/// One moat run as the streets meet it: the land inside its outer lip and that lip.
struct Band {
    fill: Shape,
    bbox: Box2,
    lip: Near,
}

/// The ring of a circuit and the bands of its moat runs.
struct Works {
    ring: Shape,
    bands: Vec<Band>,
}

impl Works {
    fn new(e: &Enclosure) -> Self {
        let ring = g::normalized(Shape { outer: e.path[..e.path.len() - 1].to_vec(), holes: vec![] });
        let bands = e.moat.iter().flat_map(|m| m.runs.iter()).filter(|r| r.inner.len() >= 3).map(|r| {
            let fill = moat_line::outer_fill(r);
            let bbox = g::bbox(&fill);
            let mut lip = r.outer.clone();
            if r.closed {
                lip.push(r.outer[0]);
            }
            Band { fill, bbox, lip: Near::new(&lip, 8.0) }
        });
        Self { ring, bands: bands.collect() }
    }
    /// In the berm or the ditch of a run (or inside the circuit a closed run surrounds).
    fn in_fill(&self, p: Point) -> bool {
        self.bands.iter().any(|b| p.x >= b.bbox.0 && p.x <= b.bbox.2 && p.y >= b.bbox.1 && p.y <= b.bbox.3 && g::contains(&b.fill, p))
    }
    /// Distance (m) to the nearest outer lip, infinite beyond 8 m.
    fn lip_gap(&self, p: Point) -> f64 {
        self.bands.iter().map(|b| b.lip.distance(p, p)).fold(f64::INFINITY, f64::min)
    }
    /// Outside the circuit, in a band or within `margin` m of an outer lip.
    fn envelope(&self, p: Point, margin: f64) -> bool {
        !g::contains(&self.ring, p) && (self.in_fill(p) || self.lip_gap(p) < margin)
    }
    /// How far (m) from `from` along `u` the ground lies `BEYOND_LIP` m beyond the outer lip of the band that
    /// faces `from`, within `max` m; none when no band stands there.
    fn across(&self, from: Point, u: (f64, f64), max: f64) -> Option<f64> {
        let mut met = false;
        let mut t = 0.0;
        while t < max {
            t += STEP;
            let p = add(from, u, t);
            if g::contains(&self.ring, p) {
                return None;
            }
            let inside = self.in_fill(p);
            met |= inside;
            if met && !inside && self.lip_gap(p) >= BEYOND_LIP {
                return Some(t);
            }
        }
        None
    }
}

/// No street but a gate street stands in a moat band. On the final wall and moat of each circuit:
/// - a street that runs along the band without reaching the wall (a road led round to a gate) is no
///   crossing: where it stands in the berm or the ditch it moves out beyond the outer lip, the streets
///   joined to it following; within the margin of the lip it stays;
/// - a gate street (one passing within `GATE_LINE` m of a land gate or its passage) that ends inside
///   the envelope (outer lip + `ENVELOPE` m) runs straight on to `BEYOND_LIP` m beyond the outer lip,
///   and on to the nearest street outside within `LINK_OUT` m; it is not carried into water, another
///   circuit or a built block;
/// - every other stretch of street in the envelope goes: the street is cut where it enters it (at the
///   outer lip from outside, at the curtain from inside), the dead ends left follow the wall-end rules
///   (`stop_at_curtains`), and a street running along the band leaves it.
pub(super) fn obey_moats(streets: &mut Vec<Street>, enclosures: &[Enclosure], blocks: &[Block], surface: Surface<'_>) {
    let profile = std::env::var("URBAN_PROFILE").is_ok();
    let rings: Vec<Shape> = enclosures
        .iter()
        .filter(|e| e.path.len() >= 4)
        .map(|e| g::normalized(Shape { outer: e.path[..e.path.len() - 1].to_vec(), holes: vec![] }))
        .collect();
    let built: Vec<(Box2, &Shape)> = blocks.iter().filter(|b| matches!(b.kind.as_str(), "block" | "place")).map(|b| (g::bbox(&b.shape), &b.shape)).collect();
    let in_box = |b: &Box2, p: Point| p.x >= b.0 && p.x <= b.2 && p.y >= b.1 && p.y <= b.3;
    let on_block = |p: Point| built.iter().any(|(b, s)| in_box(b, p) && g::contains(s, p));
    for e in enclosures.iter().filter(|e| !e.style.is_empty() && e.path.len() >= 4) {
        let Some(m) = e.moat.as_ref().filter(|m| !m.runs.is_empty()) else { continue };
        let works = Works::new(e);
        if works.bands.is_empty() {
            continue;
        }
        let ring = &works.ring;
        let from_wall = |p: Point| e.path.windows(2).map(|w| g::distance(p, w[0], w[1]).0).fold(f64::INFINITY, f64::min);
        let reach = m.runs.iter().flat_map(|r| r.outer.iter()).map(|&p| from_wall(p)).fold(0.0, f64::max) + ENVELOPE + 1.0;
        let close = Near::new(&e.path, reach);
        let in_fill = |p: Point| works.in_fill(p);
        let lip_gap = |p: Point| works.lip_gap(p);
        let envelope = |p: Point| works.envelope(p, ENVELOPE);
        let others: Vec<&Shape> = rings.iter().filter(|r| *r != ring).collect();
        let foreign = |p: Point| others.iter().any(|r| g::contains(r, p));
        let half = ribbon_half(&e.kind).max(e.curtain_width_m * 0.5);
        let axes = land_axes(e);
        let by_gate = |path: &[Point], cum: &[f64], a: f64, b: f64| {
            axes.iter().any(|&(gi, pa, pb)| {
                path.windows(2).enumerate().any(|(j, w)| {
                    cum[j + 1] >= a - GATE_WINDOW
                        && cum[j] <= b + GATE_WINDOW
                        && [e.gates[gi], pa, pb].iter().any(|&q| g::distance(q, w[0], w[1]).0 <= GATE_LINE)
                })
            })
        };
        let max_carry = 3.0 * m.width_m + 30.0;
        // A street near the works: its cumulated arcs and (arc, in the envelope, in a band) every `STEP` m
        // along its segments near the curtain; none when it keeps out of the envelope.
        let survey = |s: &Street| -> Option<(Vec<f64>, Vec<(f64, bool, bool)>)> {
            if s.path.len() < 2 || gate_budget::water_way(s, false) || s.role == "causeway" {
                return None;
            }
            let cum = cumulated(&s.path);
            let mut samples: Vec<(f64, bool, bool)> = vec![];
            let mut sample = |arc: f64, near: bool, p: Point| {
                let inside = near && envelope(p);
                samples.push((arc, inside, inside && in_fill(p)));
            };
            for (j, w) in s.path.windows(2).enumerate() {
                let l = cum[j + 1] - cum[j];
                let near = close.distance(w[0], w[1]).is_finite();
                let n = if near { (l / STEP).ceil().max(1.0) as usize } else { 1 };
                for k in 0..n {
                    let t = k as f64 / n as f64;
                    sample(cum[j] + l * t, near, pt(w[0].x + (w[1].x - w[0].x) * t, w[0].y + (w[1].y - w[0].y) * t));
                }
            }
            let last = s.path[s.path.len() - 1];
            sample(cum[cum.len() - 1], close.distance(last, last).is_finite(), last);
            samples.iter().any(|x| x.1).then_some((cum, samples))
        };
        // A stretch `first..k` of samples in the envelope that the street enters and leaves on the far side
        // from the wall (both ways out lie outside the circuit and farther from the curtain than the stretch
        // comes): it runs along the band there, in front of a gate too. A street that crosses comes from
        // the wall or its berm.
        let alongside = |s: &Street, cum: &[f64], samples: &[(f64, bool, bool)], first: usize, k: usize| {
            first > 0 && k < samples.len() && s.widths.len() == s.path.len() && {
                let point = |arc: f64| at(&s.path, &s.widths, cum, arc).0;
                let (before, after) = (point(samples[first - 1].0), point(samples[k].0));
                let nearest = samples[first..k].iter().map(|x| from_wall(point(x.0))).fold(f64::INFINITY, f64::min);
                !g::contains(ring, before) && !g::contains(ring, after) && from_wall(before) > nearest - 0.5 && from_wall(after) > nearest - 0.5
            }
        };
        // The point beyond the envelope straight out from the curtain through `p`, on free ground.
        let outward = |p: Point| -> Option<Point> {
            let foot = e.path.windows(2).map(|w| g::distance(p, w[0], w[1])).min_by(|a, b| a.0.total_cmp(&b.0)).map(|d| d.2)?;
            let d = dist(foot, p);
            if d < 1e-6 {
                return None;
            }
            let u = ((p.x - foot.x) / d, (p.y - foot.y) / d);
            let mut t = 0.0;
            while t < max_carry {
                t += 0.5;
                let q = add(p, u, t);
                if !in_fill(q) && lip_gap(q) >= ENVELOPE + PUSH_CLEAR {
                    return (!g::contains(ring, q) && !foreign(q) && !surface.wet(q) && !on_block(q)).then_some(q);
                }
            }
            None
        };
        // Streets along the band move out of it; the streets joined to a moved vertex follow.
        let mut moved: Vec<(Point, Point)> = vec![];
        for i in 0..streets.len() {
            even_widths(&mut streets[i]);
            let s = &streets[i];
            let Some((cum, samples)) = survey(s) else { continue };
            // (from, to, [(arc, old point, new point)]) per stretch moved out.
            let mut pushes: Vec<(f64, f64, Vec<(f64, Point, Point)>)> = vec![];
            let mut k = 0;
            while k < samples.len() {
                if !samples[k].1 {
                    k += 1;
                    continue;
                }
                let first = k;
                while k < samples.len() && samples[k].1 {
                    k += 1;
                }
                if !alongside(s, &cum, &samples, first, k) || !samples[first..k].iter().any(|x| x.2) {
                    continue;
                }
                let (from, to) = (samples[first - 1].0, samples[k].0);
                let mut arcs: Vec<f64> = cum.iter().copied().filter(|&c| c > from + 1e-6 && c < to - 1e-6).collect();
                let knots = arcs.clone();
                let mut c = from + PUSH_STEP;
                while c < to - 0.5 * PUSH_STEP {
                    if knots.iter().all(|&v| (v - c).abs() > 0.5 * PUSH_STEP) {
                        arcs.push(c);
                    }
                    c += PUSH_STEP;
                }
                arcs.sort_by(f64::total_cmp);
                let points: Option<Vec<(f64, Point, Point)>> = arcs
                    .iter()
                    .map(|&c| {
                        let old = at(&s.path, &s.widths, &cum, c).0;
                        // In the margin already clear of the band, a point stays.
                        if !envelope(old) { Some((c, old, old)) } else { outward(old).map(|new| (c, old, new)) }
                    })
                    .collect();
                if let Some(points) = points {
                    pushes.push((from, to, points));
                }
            }
            if pushes.is_empty() {
                continue;
            }
            if profile {
                let p = at(&s.path, &s.widths, &cum, 0.5 * (pushes[0].0 + pushes[0].1)).0;
                eprintln!("  moat streets: {} moved out of the band of {} at ({:.0},{:.0}) ({:.0} m)", s.role, e.edit_key, p.x, p.y, pushes.iter().map(|x| x.1 - x.0).sum::<f64>());
            }
            let (mut path, mut ws): (Vec<Point>, Vec<f64>) = (vec![], vec![]);
            let mut j = 0;
            for (from, to, points) in &pushes {
                while j < s.path.len() && cum[j] <= from + 1e-6 {
                    path.push(s.path[j]);
                    ws.push(s.widths[j]);
                    j += 1;
                }
                for arc in std::iter::once(*from).chain(points.iter().map(|x| x.0)).chain(std::iter::once(*to)) {
                    let (old, w) = at(&s.path, &s.widths, &cum, arc);
                    let new = points.iter().find(|x| x.0 == arc).map_or(old, |x| x.2);
                    if path.last().is_none_or(|&q| dist(q, new) > 1e-6) {
                        path.push(new);
                        ws.push(w);
                    }
                }
                while j < s.path.len() && cum[j] <= to + 1e-6 {
                    if cum[j] > from + 1e-6 && cum[j] < to - 1e-6 && let Some(x) = points.iter().find(|x| (x.0 - cum[j]).abs() < 1e-9) {
                        moved.push((x.1, x.2));
                    }
                    j += 1;
                }
            }
            path.extend_from_slice(&s.path[j..]);
            ws.extend_from_slice(&s.widths[j..]);
            streets[i].path = path;
            streets[i].widths = ws;
        }
        for &(old, new) in &moved {
            for v in streets.iter_mut().flat_map(|t| t.path.iter_mut()) {
                if dist(*v, old) < 1e-3 {
                    *v = new;
                }
            }
        }
        // Per street: stretches to remove, and the points a gate street is carried on by at its start
        // and its end (from the end outward); links: (street, point) vertices to insert.
        let mut cuts: Vec<(usize, Vec<(f64, f64)>)> = vec![];
        let mut carry: Vec<(usize, bool, Vec<Point>)> = vec![];
        let mut links: Vec<(usize, Point)> = vec![];
        for (i, s) in streets.iter().enumerate() {
            let Some((cum, samples)) = survey(s) else { continue };
            let total = cum[cum.len() - 1];
            let last = s.path[s.path.len() - 1];
            let mut remove: Vec<(f64, f64)> = vec![];
            let mut k = 0;
            while k < samples.len() {
                if !samples[k].1 {
                    k += 1;
                    continue;
                }
                let first = k;
                while k < samples.len() && samples[k].1 {
                    k += 1;
                }
                let (from, to) = (if first == 0 { 0.0 } else { samples[first - 1].0 }, if k == samples.len() { total } else { samples[k].0 });
                let (at_start, at_end) = (first == 0, k == samples.len());
                // Along the band: within the margin of the lip it stays; in the berm or the ditch, where it
                // could not be moved out (a block or water right behind the bank), it is cut.
                if alongside(s, &cum, &samples, first, k) {
                    if samples[first..k].iter().any(|x| x.2) {
                        remove.push((from, to));
                    }
                    continue;
                }
                if !by_gate(&s.path, &cum, from, to) {
                    remove.push((from, to));
                    continue;
                }
                if !(at_start || at_end) {
                    continue;
                }
                // A gate street ending in the band: carried on from inside, kept where it ends at the
                // gate itself (the other half of a street parted at the gate point).
                let (end, back) = if at_end { (last, s.path[s.path.len() - 2]) } else { (s.path[0], s.path[1]) };
                if from_wall(end) <= half + 1.0 {
                    continue;
                }
                // It comes from the wall side: from inside the circuit or across the berm of an open run.
                let body = if at_end { from - 1.0 } else { to + 1.0 };
                let widths: Vec<f64> = if s.widths.len() == s.path.len() { s.widths.clone() } else { vec![s.widths.first().copied().unwrap_or(4.0); s.path.len()] };
                let inward = (0.0..=total).contains(&body) && {
                    let p = at(&s.path, &widths, &cum, body).0;
                    g::contains(ring, p) || from_wall(p) < from_wall(end)
                };
                if !inward {
                    remove.push((from, to));
                    continue;
                }
                // Straight over the ditch: along the axis of its gate when the street ends at it, else on its
                // own line.
                let u = axes
                    .iter()
                    .map(|&(gi, pa, pb)| (dist(e.gates[gi], end), dir(pa, pb)))
                    .filter(|&(d, _)| d < gate_budget::STRAIGHT)
                    .min_by(|a, b| a.0.total_cmp(&b.0))
                    .map_or(dir(back, end), |(_, axis)| axis);
                // `BEYOND_LIP` m beyond the outer lip, or the last free point of the far bank where a block or
                // water stands right behind it.
                let mut out = None;
                let mut t = 0.0;
                while t < max_carry {
                    t += STEP;
                    let p = add(end, u, t);
                    if g::contains(ring, p) || foreign(p) {
                        break;
                    }
                    let inside = in_fill(p);
                    if !inside && (surface.wet(p) || on_block(p)) {
                        break;
                    }
                    if !inside && lip_gap(p) >= LANDING {
                        out = Some(p);
                        if lip_gap(p) >= BEYOND_LIP {
                            break;
                        }
                    }
                }
                let Some(beyond) = out else {
                    // No way over: the stub in the band goes, and the gate, left without a street, closes.
                    if profile {
                        eprintln!("  moat streets: gate street of {} ending at ({:.0},{:.0}) cannot be carried over the ditch", e.edit_key, end.x, end.y);
                    }
                    remove.push((from, to));
                    continue;
                };
                let mut added = vec![beyond];
                // The nearest street outside within `LINK_OUT` m, by a straight link clear of the works.
                let clear = |a: Point, b: Point| {
                    let n = (dist(a, b) / 0.5).ceil().max(1.0) as usize;
                    (0..=n).all(|k| {
                        let t = k as f64 / n as f64;
                        let p = pt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
                        !envelope(p) && !g::contains(ring, p) && !foreign(p) && !surface.wet(p) && !on_block(p)
                    })
                };
                let target = streets
                    .iter()
                    .enumerate()
                    .filter(|&(j, t)| j != i && t.role != "wall-lane" && t.path.len() >= 2)
                    .flat_map(|(j, t)| t.path.windows(2).map(move |w| (j, g::distance(beyond, w[0], w[1]))))
                    .filter(|(_, d)| d.0 <= LINK_OUT)
                    .filter(|(_, d)| clear(beyond, d.2))
                    .min_by(|a, b| a.1.0.total_cmp(&b.1.0));
                if let Some((j, (d, _, p))) = target {
                    if d > 1e-3 {
                        added.push(p);
                    }
                    links.push((j, p));
                }
                if profile {
                    eprintln!("  moat streets: gate street of {} carried over the ditch from ({:.0},{:.0}){}", e.edit_key, end.x, end.y, if target.is_some() { ", linked" } else { "" });
                }
                carry.push((i, at_end, added));
            }
            if !remove.is_empty() {
                if profile {
                    let p = at(&s.path, &s.widths, &cum, 0.5 * (remove[0].0 + remove[0].1)).0;
                    eprintln!("  moat streets: {} cut out of the band of {} at ({:.0},{:.0}) ({:.0} m)", s.role, e.edit_key, p.x, p.y, remove.iter().map(|r| r.1 - r.0).sum::<f64>());
                }
                cuts.push((i, remove));
            }
        }
        if cuts.is_empty() && carry.is_empty() {
            continue;
        }
        // Carry the gate streets on; a street carried at its start shifts its stretches to cut.
        for (i, at_end, added) in carry {
            let s = &mut streets[i];
            even_widths(s);
            if at_end {
                let w = *s.widths.last().unwrap();
                s.path.extend(added.iter().copied());
                s.widths.extend(std::iter::repeat_n(w, added.len()));
            } else {
                let w = s.widths[0];
                let shift = added.iter().fold((s.path[0], 0.0), |(p, l), &q| (q, l + dist(p, q))).1;
                for &q in &added {
                    s.path.insert(0, q);
                    s.widths.insert(0, w);
                }
                for (_, list) in cuts.iter_mut().filter(|c| c.0 == i) {
                    for r in list.iter_mut() {
                        *r = (r.0 + shift, r.1 + shift);
                    }
                }
            }
        }
        // A link ends on a vertex of its target.
        for (j, p) in links {
            insert_vertex(&mut streets[j], p);
        }
        // Cut the stretches out of the band.
        let mut gone: Vec<Option<Vec<(f64, f64)>>> = vec![None; streets.len()];
        for (i, list) in cuts {
            gone[i] = Some(list);
        }
        let mut out: Vec<Street> = Vec::with_capacity(streets.len());
        for (i, mut s) in std::mem::take(streets).into_iter().enumerate() {
            let Some(mut list) = gone[i].take() else {
                out.push(s);
                continue;
            };
            even_widths(&mut s);
            let cum = cumulated(&s.path);
            let total = cum[cum.len() - 1];
            list.sort_by(|a, b| a.0.total_cmp(&b.0));
            let mut keep: Vec<(f64, f64)> = vec![];
            let mut from = 0.0_f64;
            for (a, b) in list {
                if a > from {
                    keep.push((from, a));
                }
                from = from.max(b);
            }
            if from < total {
                keep.push((from, total));
            }
            for (a, b) in keep.into_iter().filter(|(a, b)| b - a >= MIN_PIECE) {
                let (p0, w0) = at(&s.path, &s.widths, &cum, a);
                let (p1, w1) = at(&s.path, &s.widths, &cum, b);
                let mut path = vec![p0];
                let mut widths = vec![w0];
                for k in 1..s.path.len() - 1 {
                    if cum[k] > a + 1e-6 && cum[k] < b - 1e-6 {
                        path.push(s.path[k]);
                        widths.push(s.widths[k]);
                    }
                }
                path.push(p1);
                widths.push(w1);
                out.push(Street { path, widths, rank: s.rank, role: s.role.clone() });
            }
        }
        *streets = out;
    }
}
