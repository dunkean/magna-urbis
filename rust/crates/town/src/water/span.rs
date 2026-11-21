//! Spans across water on the survey's water mask: straight chords between two dry landings, and
//! the direction of the flow, from which a span is laid square to it.
//!
//! The flow is classic's (`footprint::crossings::deck`): the main axis of the wet cells in a disc
//! around the crossing point, the disc grown until those cells form an elongated channel. The
//! span is the chord along the normal to that axis, tried at a few positions along the flow and
//! kept where it is shortest.

use std::f64::consts::PI;

use magna_urbis_geom::Point;

use crate::survey::{BankId, Survey};

/// Samples per survey cell along a chord.
const SAMPLES_PER_CELL: f64 = 4.0;
/// Directions tried for the shortest chord through a wet point, over half a turn (10° apart).
const DIRECTIONS: usize = 18;
/// Elongation of the wet cells around a point at which their main axis is taken as the flow
/// (classic's 0.7).
const CHANNEL_FIT: f64 = 0.7;
/// Below this elongation the water has no clear flow (a pond, a lake): the shortest chord through
/// the point stands for the span.
const MIN_FIT: f64 = 0.4;
/// Largest radius in metres of the disc whose wet cells give the flow (classic's 600).
const MAX_FLOW_RADIUS: f64 = 600.0;
/// Positions along the flow, in cells on either side of the seed, at which a span is tried.
const SHIFTS: i32 = 6;
/// Metres of span traded for one metre of shift along the flow away from the seed, so that of
/// two equal spans the one on the chain's line wins.
const SHIFT_WEIGHT: f64 = 0.1;

/// A straight crossing of water between two dry landings.
#[derive(Clone, Debug, PartialEq)]
pub struct Chord {
    /// Landings on dry open cells, half a cell inland from each bank.
    pub ends: [Point; 2],
    /// Survey bank components of the two landings.
    pub banks: [BankId; 2],
    /// Water crossed in metres.
    pub width: f64,
    /// Whether any of the water crossed is navigable.
    pub navigable: bool,
}

impl Chord {
    /// The same chord walked from its second landing.
    pub fn reversed(&self) -> Self {
        Self {
            ends: [self.ends[1], self.ends[0]],
            banks: [self.banks[1], self.banks[0]],
            width: self.width,
            navigable: self.navigable,
        }
    }

    /// Unit direction from the first landing to the second.
    pub fn axis(&self) -> (f64, f64) {
        unit(self.ends[0], self.ends[1])
    }

    /// The point halfway between the landings.
    pub fn middle(&self) -> Point {
        Point {
            x: (self.ends[0].x + self.ends[1].x) * 0.5,
            y: (self.ends[0].y + self.ends[1].y) * 0.5,
        }
    }
}

/// Unit direction from `a` to `b` (east for coincident points).
pub fn unit(a: Point, b: Point) -> (f64, f64) {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let length = dx.hypot(dy);
    if length > 1e-12 {
        (dx / length, dy / length)
    } else {
        (1.0, 0.0)
    }
}

/// The point `t` metres from `p` along the unit direction `u`.
pub fn along(p: Point, u: (f64, f64), t: f64) -> Point {
    Point {
        x: p.x + u.0 * t,
        y: p.y + u.1 * t,
    }
}

/// Whether `p` lies on a wet surveyed cell.
pub fn wet(survey: &Survey, p: Point) -> bool {
    survey.cell_at(p).is_some_and(|c| c.wet)
}

/// The first wet point from `from` along `u` within `reach` metres, sampled every half cell.
pub fn first_wet(survey: &Survey, from: Point, u: (f64, f64), reach: f64) -> Option<Point> {
    let step = survey.cell_size() * 0.5;
    let mut t = step;
    while t <= reach {
        let p = along(from, u, t);
        let cell = survey.cell_at(p)?;
        if cell.wet {
            return Some(p);
        }
        t += step;
    }
    None
}

/// Distance from the wet point `from` along `u` to the first dry sample, within `max` metres, and
/// whether the water passed is navigable. `None` past the survey or beyond `max`.
fn bank(survey: &Survey, from: Point, u: (f64, f64), max: f64) -> Option<(f64, bool)> {
    let step = survey.cell_size() / SAMPLES_PER_CELL;
    let mut navigable = false;
    let mut t = 0.0;
    while t <= max {
        let cell = survey.cell_at(along(from, u, t))?;
        if !cell.wet {
            return Some((t, navigable));
        }
        navigable |= cell.navigable;
        t += step;
    }
    None
}

/// The chord through the wet point `from` along `u` and against it. `None` when a bank lies
/// beyond the survey, the water is wider than `max` metres, or a landing is not open dry land.
pub fn chord(survey: &Survey, from: Point, u: (f64, f64), max: f64) -> Option<Chord> {
    if !wet(survey, from) {
        return None;
    }
    let back = (-u.0, -u.1);
    let (a, wet_a) = bank(survey, from, back, max)?;
    let (b, wet_b) = bank(survey, from, u, max - a)?;
    let inset = survey.cell_size() * 0.5;
    let ends = [along(from, back, a + inset), along(from, u, b + inset)];
    let landing = |p: Point| {
        survey
            .cell_at(p)
            .filter(|c| !c.wet && !c.closed)
            .and_then(|c| c.bank_id)
    };
    Some(Chord {
        banks: [landing(ends[0])?, landing(ends[1])?],
        ends,
        width: a + b,
        navigable: wet_a || wet_b,
    })
}

/// The shortest chord through the wet point `from`, over `DIRECTIONS` directions, that `accept`
/// takes (it may turn the chord round), with water at most `max` metres wide.
pub fn shortest(
    survey: &Survey,
    from: Point,
    max: f64,
    accept: &dyn Fn(&Chord) -> Option<Chord>,
) -> Option<Chord> {
    let mut best: Option<Chord> = None;
    for i in 0..DIRECTIONS {
        let angle = i as f64 * PI / DIRECTIONS as f64;
        let limit = best.as_ref().map_or(max, |c| c.width.min(max));
        let Some(found) = chord(survey, from, (angle.cos(), angle.sin()), limit) else {
            continue;
        };
        let Some(found) = accept(&found) else {
            continue;
        };
        if best.as_ref().is_none_or(|b| found.width < b.width) {
            best = Some(found);
        }
    }
    best
}

/// Direction of the flow at the wet point `at`, in radians modulo π: the main axis of the wet
/// cells in a disc around it, the disc grown from `radius` until the cells form an elongated
/// channel. `None` over still water, where no axis stands out.
pub fn flow(survey: &Survey, at: Point, radius: f64) -> Option<f64> {
    let step = survey.cell_size();
    let mut r = radius.max(3.0 * step).min(MAX_FLOW_RADIUS);
    let mut best: Option<(f64, f64)> = None;
    loop {
        let k = (r / step).ceil() as i32;
        let (mut n, mut sx, mut sy, mut xx, mut xy, mut yy) = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
        for j in -k..=k {
            for i in -k..=k {
                let (dx, dy) = (f64::from(i) * step, f64::from(j) * step);
                if dx.hypot(dy) > r || !wet(survey, Point { x: at.x + dx, y: at.y + dy }) {
                    continue;
                }
                n += 1.0;
                sx += dx;
                sy += dy;
                xx += dx * dx;
                xy += dx * dy;
                yy += dy * dy;
            }
        }
        if n > 3.0 {
            xx -= sx * sx / n;
            xy -= sx * sy / n;
            yy -= sy * sy / n;
            let fit = (xx - yy).hypot(2.0 * xy) / (xx + yy).max(1e-9);
            let angle = 0.5 * (2.0 * xy).atan2(xx - yy);
            if best.is_none_or(|(f, _)| fit > f) {
                best = Some((fit, angle));
            }
        }
        if best.is_some_and(|(f, _)| f >= CHANNEL_FIT) || r >= MAX_FLOW_RADIUS {
            break;
        }
        r = (r * 2.0).min(MAX_FLOW_RADIUS);
    }
    best.filter(|&(f, _)| f >= MIN_FIT).map(|(_, angle)| angle)
}

/// The span across the water at the wet point `seed`: square to the flow, the shortest of the
/// chords along the flow's normal tried at the seed and at a few positions up and down stream,
/// a shift costing `SHIFT_WEIGHT` metres of span per metre. Over still water, or when no square
/// chord is taken, the shortest chord through the seed. Every chord is one `accept` takes, with
/// water at most `max` metres wide.
pub fn span_near(
    survey: &Survey,
    seed: Point,
    max: f64,
    accept: &dyn Fn(&Chord) -> Option<Chord>,
) -> Option<Chord> {
    let first = shortest(survey, seed, max, accept)?;
    let Some(flow) = flow(survey, seed, 2.0 * first.width) else {
        return Some(first);
    };
    let downstream = (flow.cos(), flow.sin());
    let normal = (-downstream.1, downstream.0);
    let step = survey.cell_size();
    let mut best: Option<(f64, Chord)> = None;
    for s in 0..=SHIFTS {
        for sign in [1.0, -1.0] {
            if s == 0 && sign < 0.0 {
                continue;
            }
            let shift = sign * f64::from(s) * step;
            let centre = along(seed, downstream, shift);
            let Some(found) = chord(survey, centre, normal, max).and_then(|c| accept(&c)) else {
                continue;
            };
            let score = found.width + SHIFT_WEIGHT * shift.abs();
            if best.as_ref().is_none_or(|(b, _)| score < *b) {
                best = Some((score, found));
            }
        }
    }
    Some(best.map_or(first, |(_, c)| c))
}
