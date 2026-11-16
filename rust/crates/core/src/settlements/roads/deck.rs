//! Wet spans along a finished road, and bridge decks at a bounded angle to their river.
//!
//! A route is a raster search, so a road running nearly along a river crosses it wherever its
//! path happens to pass from one bank to the other, and the deck that follows the road can meet
//! the water at a few degrees over tens of metres. After smoothing, each such bridge is laid
//! again locally: the deck keeps its place on the river but turns until it meets the river at
//! [`MIN_BRIDGE_ANGLE`] (oblique, not square), and short dry ramps join it to the road on each
//! bank. Fords and causeways keep their path. When no ramp fits (water, grade, a sharp turn) the
//! original crossing stays. Cost: a few raster probes per shallow bridge, no search.
use super::super::Point;
use super::super::grid::Fields;

/// Smallest angle between a bridge deck and the river it spans, in degrees.
pub(super) const MIN_BRIDGE_ANGLE: f64 = 45.0;
/// Dry samples (a quarter cell apart) that end a crossing; a shorter dip onto a bank stays in it.
const GAP: usize = 6;
/// Dry ground each deck end keeps past the water, in cells.
const ABUTMENT: f64 = 0.5;
/// How far along the road from the water, in cells, a ramp may reach for a vertex to join.
const REACH: f64 = 10.0;
/// Sharpest turn at either end of a ramp, in degrees.
const MAX_TURN: f64 = 80.0;
/// Longest march from the river axis to a bank, in cells.
const MAX_BANK: f64 = 64.0;

/// A wet run along a path: its kind, its points (one dry point before the water and one after,
/// the abutments) and the distance along the path of its first and last points.
pub(super) struct Span {
    pub kind: &'static str,
    pub points: Vec<Point>,
    pub from: f64,
    pub to: f64,
}

type Dir = (f64, f64);

fn lerp(a: Point, b: Point, t: f64) -> Point {
    Point { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }
}
fn offset(p: Point, d: Dir, t: f64) -> Point {
    Point { x: p.x + d.0 * t, y: p.y + d.1 * t }
}
fn dot(a: Dir, b: Dir) -> f64 {
    a.0 * b.0 + a.1 * b.1
}
fn unit(a: Point, b: Point) -> Option<Dir> {
    let d = a.distance(b);
    (d > 1e-9).then(|| ((b.x - a.x) / d, (b.y - a.y) / d))
}
fn inside(f: &Fields, p: Point) -> bool {
    (0.0..f.r.width).contains(&p.x) && (0.0..f.r.width).contains(&p.y)
}

/// Wet runs along the path; a run that dips onto a dry corner for less than about a cell and a
/// half (a road clipping a bank while crossing) stays one crossing.
pub(super) fn spans(f: &Fields, path: &[Point], class: usize) -> Vec<Span> {
    let mut out = vec![];
    let mut run: Vec<(Point, f64)> = vec![];
    let mut kind = 0_u8;
    let mut widest = 0.0_f32;
    let mut dry = 0;
    let mut previous = (path[0], 0.0);
    let mut along = 0.0;
    let flush = |run: &mut Vec<(Point, f64)>, dry: usize, kind: u8, widest: f32, out: &mut Vec<Span>| {
        // Keep one dry point past the water as the abutment.
        run.truncate(run.len() - dry.saturating_sub(1));
        if run.len() > 1 {
            let name = match kind {
                2 => "causeway",
                _ if widest < 3.5 && class >= 3 => "ford",
                _ => "bridge",
            };
            out.push(Span {
                kind: name,
                from: run[0].1,
                to: run[run.len() - 1].1,
                points: run.iter().map(|q| q.0).collect(),
            });
        }
        run.clear();
    };
    for seg in path.windows(2) {
        let len = seg[0].distance(seg[1]);
        let steps = (len / (f.cell * 0.25)).ceil().max(1.0) as usize;
        for s in 1..=steps {
            let t = s as f64 / steps as f64;
            let p = (lerp(seg[0], seg[1], t), along + len * t);
            let i = f.index(p.0);
            let w = f.r.water[i];
            if w == 2 || w == 3 {
                if !run.is_empty() && w != kind {
                    flush(&mut run, dry, kind, widest, &mut out);
                }
                if run.is_empty() {
                    run.push(previous);
                    widest = 0.0;
                }
                kind = w;
                widest = widest.max(f.r.river_width[i]);
                run.push(p);
                dry = 0;
            } else if !run.is_empty() {
                run.push(p);
                dry += 1;
                if dry > GAP {
                    flush(&mut run, dry, kind, widest, &mut out);
                    dry = 0;
                }
            }
            previous = p;
        }
        along += len;
    }
    flush(&mut run, dry, kind, widest, &mut out);
    out
}

/// Turns every bridge that meets its river at less than [`MIN_BRIDGE_ANGLE`] to that angle (see
/// the module notes). The path ends never move; `limit` is the class grade of the ramps (the
/// replaced road's own steepest dry step when that was steeper).
pub(super) fn straighten(f: &Fields, path: Vec<Point>, class: usize, limit: f64) -> Vec<Point> {
    if path.len() < 2 {
        return path;
    }
    let spans = spans(f, &path, class);
    if spans.iter().all(|s| s.kind != "bridge") {
        return path;
    }
    let mut arcs = Vec::with_capacity(path.len());
    let mut along = 0.0;
    arcs.push(along);
    for w in path.windows(2) {
        along += w[0].distance(w[1]);
        arcs.push(along);
    }
    let mut path = path;
    // Back to front: a rewrite only changes vertices after its dry anchor before the water, so
    // the vertices up to `ceiling` keep their index and distance along the original path.
    let mut ceiling = path.len() - 1;
    for k in (0..spans.len()).rev() {
        let span = &spans[k];
        if span.kind != "bridge" {
            continue;
        }
        let floor = if k > 0 { spans[k - 1].to } else { f64::NEG_INFINITY };
        let next = spans.get(k + 1).map_or(f64::INFINITY, |s| s.from);
        let Some(r) = relay(f, &path, &arcs[..=ceiling], span, (floor, next), limit) else {
            continue;
        };
        let mut out = path[..=r.before].to_vec();
        if r.start.distance(path[r.before]) > 1e-6 {
            out.push(r.start);
        }
        if r.end.distance(path[r.after]) > 1e-6 {
            out.push(r.end);
        }
        out.extend_from_slice(&path[r.after..]);
        path = out;
        ceiling = r.before;
    }
    path
}

/// A straightened crossing: the road keeps its vertices up to `before` and from `after`, with
/// the deck from `start` to `end` between them.
struct Relay {
    before: usize,
    after: usize,
    start: Point,
    end: Point,
}

/// The deck at [`MIN_BRIDGE_ANGLE`] for one shallow bridge, and the road vertices its ramps join;
/// None when the bridge is steep enough already or nothing valid fits. `arcs` covers the vertices
/// that may still be used (their distance along the road); `bounds` are the ends of the
/// neighbouring wet spans, which the ramps must not reach.
fn relay(f: &Fields, path: &[Point], arcs: &[f64], span: &Span, bounds: (f64, f64), limit: f64) -> Option<Relay> {
    let cell = f.cell;
    let (first, last) = (span.points[0], *span.points.last()?);
    let road = unit(first, last)?;
    let wet: Vec<Point> = span.points.iter().copied().filter(|&p| f.r.water[f.index(p)] == 3).collect();
    let mid = *wet.get(wet.len() / 2)?;
    let (mean, axis) = river_axis(f, mid)?;
    if dot(road, axis).abs().min(1.0).acos().to_degrees() >= MIN_BRIDGE_ANGLE {
        return None;
    }
    // The crossing stays where the road met the river, brought onto the river's axis.
    let on_axis = offset(mean, axis, dot((mid.x - mean.x, mid.y - mean.y), axis));
    let centre = if inside(f, on_axis) && f.r.water[f.index(on_axis)] == 3 { on_axis } else { mid };
    let normal = (-axis.1, axis.0);
    let side = |p: Point| dot((p.x - centre.x, p.y - centre.y), normal);
    let (s0, s1) = (side(first), side(last));
    if s0 * s1 >= 0.0 {
        // In and out on one bank: not a crossing to turn.
        return None;
    }
    // From the road direction toward the river normal, stopping at the minimum angle.
    let along = if dot(road, axis) < 0.0 { -1.0 } else { 1.0 };
    let across = s1.signum();
    let (c, s) = (MIN_BRIDGE_ANGLE.to_radians().cos(), MIN_BRIDGE_ANGLE.to_radians().sin());
    let deck = (c * along * axis.0 + s * across * normal.0, c * along * axis.1 + s * across * normal.1);
    // Wet width over the sine of the angle, measured along the deck itself (an off-centre axis
    // or a bank that is not parallel then still gives dry ends).
    let back = bank(f, centre, (-deck.0, -deck.1))?;
    let on = bank(f, centre, deck)?;
    let margin = ABUTMENT * cell;
    let start = offset(centre, deck, -(back + margin));
    let end = offset(centre, deck, on + margin);
    if !inside(f, start)
        || !inside(f, end)
        || start.distance(end) >= span.to - span.from
        || !single_crossing(f, start, end)
    {
        return None;
    }
    // Dry vertices on each bank within reach, nearest first.
    let reach = REACH * cell;
    let below = arcs.partition_point(|&a| a <= span.from);
    let befores: Vec<usize> = (0..below)
        .rev()
        .take_while(|&i| arcs[i] > bounds.0 && span.from - arcs[i] <= reach)
        .collect();
    let above = arcs.partition_point(|&a| a < span.to);
    let afters: Vec<usize> = (above..arcs.len())
        .take_while(|&j| arcs[j] < bounds.1 && arcs[j] - span.to <= reach)
        .collect();
    let (&lo, &hi) = (befores.last()?, afters.last()?);
    // As in smoothing, a ramp may be as steep as the replaced road already was on dry ground.
    let dry = |p: Point| f.r.water[f.index(p)] == 0;
    let steepest = path[lo..=hi]
        .windows(2)
        .filter(|w| dry(w[0]) && dry(w[1]))
        .map(|w| super::grade(f, w[0], w[1]))
        .fold(0.0, f64::max);
    let allowed = limit.max(steepest) + 0.005;
    let turn = MAX_TURN.to_radians().cos();
    let smooth = |a: Option<Point>, b: Point, c: Point| match (a.and_then(|a| unit(a, b)), unit(b, c)) {
        (Some(u), Some(v)) => dot(u, v) >= turn,
        _ => true,
    };
    let ramp = |a: Point, b: Point| dry_line(f, a, b) && super::grade(f, a, b) <= allowed;
    let before = befores.into_iter().find(|&i| {
        let p = path[i];
        ramp(p, start)
            && smooth(i.checked_sub(1).map(|h| path[h]), p, start)
            && smooth(Some(p), start, end)
            // A ramp shorter than the turn check can see joins straight onto the deck.
            && (p.distance(start) > 1e-6 || smooth(i.checked_sub(1).map(|h| path[h]), p, end))
    })?;
    let after = afters.into_iter().find(|&j| {
        let p = path[j];
        ramp(end, p)
            && smooth(Some(start), end, p)
            && smooth(Some(end), p, path.get(j + 1).copied().unwrap_or(p))
            && (p.distance(end) > 1e-6 || smooth(Some(start), p, path.get(j + 1).copied().unwrap_or(p)))
    })?;
    (before < after).then_some(Relay { before, after, start, end })
}

/// Principal direction of the river around `at` (cells of its river id in a disc, widened until
/// they form a clearly elongated cloud), and the cloud's mean as a point on its axis. None for a
/// river too wide or too bent to have a local direction at that scale.
fn river_axis(f: &Fields, at: Point) -> Option<(Point, Dir)> {
    let n = f.r.n as isize;
    let c = f.index(at);
    let id = f.r.river_ids[c];
    let (cx, cy) = ((c % f.r.n) as isize, (c / f.r.n) as isize);
    let mut r = 6_isize;
    loop {
        let (mut k, mut sx, mut sy, mut sxx, mut syy, mut sxy) = (0.0_f64, 0.0, 0.0, 0.0, 0.0, 0.0);
        for y in (cy - r).max(0)..=(cy + r).min(n - 1) {
            for x in (cx - r).max(0)..=(cx + r).min(n - 1) {
                let (dx, dy) = (x - cx, y - cy);
                if dx * dx + dy * dy > r * r {
                    continue;
                }
                let i = (y * n + x) as usize;
                if f.r.water[i] != 3 || (id >= 0 && f.r.river_ids[i] != id) {
                    continue;
                }
                let (dx, dy) = (dx as f64, dy as f64);
                k += 1.0;
                sx += dx;
                sy += dy;
                sxx += dx * dx;
                syy += dy * dy;
                sxy += dx * dy;
            }
        }
        if k >= 3.0 {
            let (mx, my) = (sx / k, sy / k);
            let (a, b, d) = (sxx / k - mx * mx, sxy / k - mx * my, syy / k - my * my);
            let root = (0.25 * (a - d) * (a - d) + b * b).sqrt();
            let (major, minor) = (0.5 * (a + d) + root, 0.5 * (a + d) - root);
            if major > 0.0 && minor <= 0.2 * major {
                let theta = 0.5 * (2.0 * b).atan2(a - d);
                let centre = f.pos(c);
                let mean = Point { x: centre.x + mx * f.cell, y: centre.y + my * f.cell };
                return Some((mean, (theta.cos(), theta.sin())));
            }
        }
        if r >= 24 {
            return None;
        }
        r *= 2;
    }
}

/// Distance from `from` (in the river) along `d` to the first dry ground; None past other water,
/// the map edge or [`MAX_BANK`] cells.
fn bank(f: &Fields, from: Point, d: Dir) -> Option<f64> {
    let step = 0.25 * f.cell;
    let mut t = 0.0;
    while t <= MAX_BANK * f.cell {
        let p = offset(from, d, t);
        if !inside(f, p) {
            return None;
        }
        match f.r.water[f.index(p)] {
            0 => return Some(t),
            3 => {}
            _ => return None,
        }
        t += step;
    }
    None
}

/// Every sample from `a` to `b`, a fifth of a cell apart, on dry ground.
fn dry_line(f: &Fields, a: Point, b: Point) -> bool {
    let steps = (a.distance(b) / (0.2 * f.cell)).ceil().max(1.0) as usize;
    (0..=steps).all(|k| f.r.water[f.index(lerp(a, b, k as f64 / steps as f64))] == 0)
}

/// From dry `a` to dry `b`, the line passes one river run and no other water.
fn single_crossing(f: &Fields, a: Point, b: Point) -> bool {
    if f.r.water[f.index(a)] != 0 || f.r.water[f.index(b)] != 0 {
        return false;
    }
    let steps = (a.distance(b) / (0.2 * f.cell)).ceil().max(1.0) as usize;
    let mut stage = 0;
    for k in 0..=steps {
        match (f.r.water[f.index(lerp(a, b, k as f64 / steps as f64))], stage) {
            (0, 0) | (0, 2) | (3, 1) => {}
            (0, 1) => stage = 2,
            (3, 0) => stage = 1,
            _ => return false,
        }
    }
    stage == 2
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::settlements::Raster;

    const N: usize = 120;
    const WIDTH: f64 = 6000.0;

    /// 50 m cells, flat ground at 20 m, a straight river two cells wide along x (rows 59 and 60,
    /// y from 2950 to 3050); `hills` raises the listed (column, row) cells to 200 m.
    fn fields(hills: &[(usize, usize)]) -> Fields {
        let mut h = vec![20.0f32; N * N];
        for &(x, y) in hills {
            h[y * N + x] = 200.0;
        }
        let water: Vec<u8> = (0..N * N).map(|i| if (59..=60).contains(&(i / N)) { 3 } else { 0 }).collect();
        let widths: Vec<f32> = water.iter().map(|&w| if w == 3 { 20.0 } else { 0.0 }).collect();
        let ids: Vec<i32> = water.iter().map(|&w| if w == 3 { 0 } else { -1 }).collect();
        Fields::new(Raster { width: WIDTH, n: N, height: &h, water: &water, water_level: &h, river_width: &widths, river_ids: &ids })
    }

    /// A road through (3000, 3000) at `degrees` to the river, 4 km long, one vertex per cell.
    fn road(degrees: f64) -> Vec<Point> {
        let (c, s) = (degrees.to_radians().cos(), degrees.to_radians().sin());
        (-40..=40)
            .map(|k| {
                let t = f64::from(k) * 50.0;
                Point { x: 3000.0 + t * c, y: 3000.0 + t * s }
            })
            .collect()
    }

    fn deck_angle(span: &Span) -> f64 {
        let (a, b) = (span.points[0], *span.points.last().unwrap());
        (b.y - a.y).abs().atan2((b.x - a.x).abs()).to_degrees()
    }

    /// A road meeting the river at 10° gets a deck at the minimum angle, much shorter, with dry
    /// ends, ramps joining the road on both banks and the road ends unchanged.
    #[test]
    fn a_shallow_bridge_turns_to_the_minimum_angle() {
        let f = fields(&[]);
        let raw = road(10.0);
        let old = spans(&f, &raw, 0);
        assert_eq!(old.len(), 1);
        assert!(deck_angle(&old[0]) < 15.0);
        let path = straighten(&f, raw.clone(), 0, 0.08);
        let new = spans(&f, &path, 0);
        assert_eq!(new.len(), 1, "one crossing");
        let deck = &new[0];
        assert_eq!(deck.kind, "bridge");
        assert!(deck_angle(deck) >= MIN_BRIDGE_ANGLE - 1.0, "deck at {:.1}°", deck_angle(deck));
        assert!(deck.to - deck.from < 0.5 * (old[0].to - old[0].from), "deck {:.0} m, was {:.0} m", deck.to - deck.from, old[0].to - old[0].from);
        let (a, b) = (deck.points[0], *deck.points.last().unwrap());
        assert!(f.r.water[f.index(a)] == 0 && f.r.water[f.index(b)] == 0, "a deck end in the water");
        assert_eq!((path[0], path.last()), (raw[0], raw.last()));
        assert!(path.len() < raw.len(), "the wet stretch along the river is gone");
        assert!(path.windows(2).all(|w| w[0].distance(w[1]) > 1e-6 && w[0].distance(w[1]) < REACH * f.cell + 200.0));
    }

    /// A road meeting the river at 80° keeps its path.
    #[test]
    fn a_square_enough_bridge_is_unchanged() {
        let f = fields(&[]);
        let raw = road(80.0);
        assert_eq!(straighten(&f, raw.clone(), 0, 0.08), raw);
    }

    /// Hills where both deck ends would land: no ramp holds the grade, the crossing stays as routed.
    #[test]
    fn a_bridge_without_valid_ramps_keeps_its_path() {
        let mut hills = vec![];
        for x in 55..=60 {
            hills.extend([(x, 57), (x, 58)]);
        }
        for x in 59..=64 {
            hills.extend([(x, 61), (x, 62)]);
        }
        let f = fields(&hills);
        let raw = road(10.0);
        assert_eq!(straighten(&f, raw.clone(), 0, 0.08), raw);
    }
}
