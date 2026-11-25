//! The one rule of the decks (bridges, fords, causeways over water) of roads and towns: in plan, two decks neither
//! cross nor overlap. They may share an abutment on land, and nothing else.

use magna_urbis_geom::Point;

/// Free water kept between the edges of two decks (m).
pub(crate) const CLEARANCE: f64 = 1.0;
/// Two ends closer than this (m) are one abutment.
pub(crate) const ABUTMENT: f64 = 0.5;
/// Two decks that leave one abutment closer than this angle (radians) lie over each other.
const APART: f64 = 0.17;

fn distance(a: Point, b: Point) -> f64 {
    (b.x - a.x).hypot(b.y - a.y)
}
fn to_segment(p: Point, a: Point, b: Point) -> f64 {
    let (dx, dy) = (b.x - a.x, b.y - a.y);
    let l = dx * dx + dy * dy;
    let t = if l > 0.0 { (((p.x - a.x) * dx + (p.y - a.y) * dy) / l).clamp(0.0, 1.0) } else { 0.0 };
    (p.x - a.x - t * dx).hypot(p.y - a.y - t * dy)
}
fn crosses(a: Point, b: Point, c: Point, d: Point) -> bool {
    let side = |p: Point, q: Point, r: Point| (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    side(a, b, c) * side(a, b, d) < 0.0 && side(c, d, a) * side(c, d, b) < 0.0
}
fn gap(a: Point, b: Point, c: Point, d: Point) -> f64 {
    if crosses(a, b, c, d) {
        return 0.0;
    }
    to_segment(a, c, d).min(to_segment(b, c, d)).min(to_segment(c, a, b)).min(to_segment(d, a, b))
}

/// A deck in plan: its centre line and half width.
#[derive(Clone, Copy)]
pub(crate) struct Deck<'a> {
    pub path: &'a [Point],
    pub half: f64,
}
impl Deck<'_> {
    pub(crate) fn bounds(&self) -> (f64, f64, f64, f64) {
        self.path.iter().fold((f64::INFINITY, f64::INFINITY, f64::NEG_INFINITY, f64::NEG_INFINITY), |b, p| (b.0.min(p.x), b.1.min(p.y), b.2.max(p.x), b.3.max(p.y)))
    }
    fn ends(&self) -> [(Point, Point); 2] {
        let n = self.path.len();
        [(self.path[0], self.path[1]), (self.path[n - 1], self.path[n - 2])]
    }
}

/// Whether two decks meet anywhere but at an abutment they share on `land`.
pub(crate) fn clash(a: Deck<'_>, b: Deck<'_>, land: impl Fn(Point) -> bool) -> bool {
    if a.path.len() < 2 || b.path.len() < 2 {
        return false;
    }
    let reach = a.half + b.half + CLEARANCE;
    let (p, q) = (a.bounds(), b.bounds());
    if p.0 - reach > q.2 || q.0 - reach > p.2 || p.1 - reach > q.3 || q.1 - reach > p.3 {
        return false;
    }
    let shared = a.ends().into_iter().flat_map(|e| b.ends().into_iter().map(move |f| (e, f))).find(|(e, f)| distance(e.0, f.0) <= ABUTMENT && land(e.0));
    if let Some(((p, from), (_, to))) = shared {
        let angle = ((from.y - p.y).atan2(from.x - p.x) - (to.y - p.y).atan2(to.x - p.x)).cos().clamp(-1.0, 1.0).acos();
        return angle < APART
            || a.path.windows(2).any(|v| {
                b.path.windows(2).any(|w| {
                    let near = |v: &[Point]| distance(v[0], p).min(distance(v[1], p)) <= ABUTMENT;
                    if near(v) && near(w) { false } else if near(v) || near(w) { crosses(v[0], v[1], w[0], w[1]) } else { gap(v[0], v[1], w[0], w[1]) < reach }
                })
            });
    }
    if a.path.windows(2).any(|v| b.path.windows(2).any(|w| crosses(v[0], v[1], w[0], w[1]))) {
        return true;
    }
    // Two decks may come close about their landings (one after the other, on either side of an islet), not along them.
    let (p, q) = (middle(a.path, reach, &land), middle(b.path, reach, &land));
    p.windows(2).any(|v| q.windows(2).any(|w| gap(v[0], v[1], w[0], w[1]) < reach))
}

/// A deck without the first `reach` metres (at most a third of it) from each of its ends on land.
fn middle(path: &[Point], reach: f64, land: impl Fn(Point) -> bool) -> Vec<Point> {
    let length: f64 = path.windows(2).map(|w| distance(w[0], w[1])).sum();
    let cut = reach.min(0.33 * length);
    let trim = |path: Vec<Point>| -> Vec<Point> {
        let mut left = cut;
        for (k, w) in path.windows(2).enumerate() {
            let l = distance(w[0], w[1]);
            if l > left {
                let t = left / l;
                let mut out = vec![Point { x: w[0].x + (w[1].x - w[0].x) * t, y: w[0].y + (w[1].y - w[0].y) * t }];
                out.extend_from_slice(&path[k + 1..]);
                return out;
            }
            left -= l;
        }
        path
    };
    let mut out = path.to_vec();
    for end in [path[0], path[path.len() - 1]] {
        if land(end) {
            out = trim(out);
        }
        out.reverse();
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn line(points: &[(f64, f64)]) -> Vec<Point> {
        points.iter().map(|&(x, y)| Point { x, y }).collect()
    }

    #[test]
    fn decks_share_an_abutment_on_land_and_nothing_else() {
        let meet = |a: &[(f64, f64)], b: &[(f64, f64)], land: bool| {
            let (a, b) = (line(a), line(b));
            clash(Deck { path: &a, half: 3.0 }, Deck { path: &b, half: 2.0 }, |_| land)
        };
        assert!(meet(&[(0.0, 0.0), (40.0, 0.0)], &[(20.0, -20.0), (20.0, 20.0)], true), "a crossing");
        assert!(meet(&[(0.0, 0.0), (40.0, 0.0)], &[(0.0, 5.0), (40.0, 5.0)], true), "an overlap of their widths");
        assert!(!meet(&[(0.0, 0.0), (40.0, 0.0)], &[(0.0, 7.0), (40.0, 7.0)], true), "side by side");
        let (a, b) = ([(0.0, 0.0), (40.0, 0.0)], [(0.0, 0.0), (30.0, 25.0)]);
        assert!(!meet(&a, &b, true), "one abutment on land");
        assert!(meet(&a, &b, false), "one end in the water");
        assert!(meet(&a, &[(0.0, 0.0), (40.0, 2.0)], true), "one over the other");
        assert!(!meet(&a, &[(43.0, 0.0), (80.0, 0.0)], true), "one after the other, over an islet");
    }
}
