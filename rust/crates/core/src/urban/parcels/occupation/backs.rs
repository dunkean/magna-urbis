//! Building placement behind the main frontage.

use super::*;

pub(super) type Piece = (Vec<Point>, Option<Vec<Point>>, &'static str);

/// Whole bodies and wings composed in the frame of the main frontage: every
/// piece is a frame rectangle placed (slid, then shrunk) inside the building
/// domain `b`, or the lot band itself when its sides are within 15 degrees of
/// square (the street wall then keeps the cadastral party walls). A mass that
/// does not fit at least `wing` wide is dropped, never clipped into a sliver.
pub(super) struct Lay<'a> {
    pub(super) b: &'a [Point],
    pub(super) fronts: &'a [Front],
    pub(super) f: Frame,
    pub(super) wing: f64,
    pub(super) pieces: Vec<Piece>,
}
impl Lay<'_> {
    pub(super) fn rect(&self, [s0, s1, t0, t1]: [f64; 4]) -> Vec<Point> {
        let at = |s: f64, t: f64| add(scale(self.f.u, s), scale(self.f.n, t));
        vec![at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)]
    }
    /// The rectangle `[s0, s1] x [t0, t1]` inside `b`: slid sideways to fit,
    /// then narrowed, then shortened from its far end; never below `wing`.
    pub(super) fn place(&self, s0: f64, s1: f64, t0: f64, t1: f64, anchor: f64) -> Option<[f64; 4]> {
        let w = s1 - s0;
        if w < self.wing - 1e-9 || t1 - t0 < self.wing - 1e-9 {
            return None;
        }
        // Shorten from the far end first, then step back from the near end.
        for (back, k) in [
            (0.0, 1.0),
            (0.0, 0.8),
            (0.0, 0.6),
            (0.0, 0.45),
            (1.0, 1.0),
            (2.0, 1.0),
            (2.0, 0.7),
            (1.0, 0.45),
        ] {
            let start = t0 + back;
            let t = start + (t1 - t0 - back) * k;
            if t - start < self.wing - 1e-9 {
                continue;
            }
            if let Some((l, r)) = fit_any(self.b, &self.f, start, t, anchor.clamp(s0, s1)) {
                if r - l >= w {
                    let a = s0.clamp(l, r - w);
                    return Some([a, a + w, start, t]);
                }
                if r - l >= self.wing {
                    // A body narrowed under three fifths of its width is
                    // shortened with it, at most 3.5 times as long as wide:
                    // never a long bar one wing wide.
                    let t = if r - l < 0.6 * w {
                        t.min(start + 3.5 * (r - l))
                    } else {
                        t
                    };
                    return Some([l, r, start, t]);
                }
            }
        }
        None
    }
    pub(super) fn add(&mut self, r: [f64; 4], label: &'static str) -> f64 {
        let ring = self.rect(r);
        let a = ring_area(&ring).abs();
        self.pieces.push((ring, None, label));
        a
    }
    /// Invariant (one lot, separate bodies): a piece slid sideways to fit
    /// the lot never lands on a piece already placed; it is dropped instead
    /// (review series 2 P21: two houses stacked on one spot).
    pub(super) fn put(&mut self, s0: f64, s1: f64, t0: f64, t1: f64, anchor: f64) -> f64 {
        self.place(s0, s1, t0, t1, anchor)
            .filter(|&r| self.clear(&self.rect(r)))
            .map_or(0.0, |r| self.add(r, "building"))
    }
    /// Whether `ring` overlaps no placed piece (by more than half a m²).
    pub(super) fn clear(&self, ring: &[Point]) -> bool {
        let r = Shape {
            outer: ring.to_vec(),
            holes: vec![],
        };
        self.pieces.iter().all(|(q, _, _)| {
            let q = Shape {
                outer: q.clone(),
                holes: vec![],
            };
            intersection(&q, &r).iter().map(area).sum::<f64>() < 0.5
        })
    }
    /// The lot band `t0..t1` itself, when its walls lean 25 degrees at most and it is thick enough.
    pub(super) fn band(&self, t0: f64, t1: f64) -> Option<Vec<Point>> {
        if t1 - t0 < self.wing {
            return None;
        }
        let part = dedup(largest(clip_parts(
            self.b,
            &[self.f.above(t0), self.f.below(t1)],
        )));
        (part.len() >= 3
            && (square_enough(&part, &self.f, self.fronts, 15.0) || open_corners(&part))
            && simple(&part)
            && thickness(&part, None) >= self.wing - 1e-6)
            .then_some(part)
    }
    /// Street body: the square lot band, else a fitted frame rectangle.
    pub(super) fn body(&mut self, s0: f64, s1: f64, t0: f64, t1: f64, anchor: f64) -> f64 {
        if let Some(part) = self.band(t0, t1) {
            let a = ring_area(&part).abs();
            self.pieces.push((part, None, "building"));
            return a;
        }
        self.put(s0, s1, t0, t1, anchor)
    }
}

/// What `fill_back` knows of the lot it fills.
pub(super) struct Fill<'a> {
    /// The box of a larger lot a bounded court house keeps to itself, its
    /// yard and garden included: the filling builds outside it.
    pub(super) kept: Option<&'a [Point]>,
    /// Built area (m²) the tissue's coverage asks of the lot.
    pub(super) target: f64,
    /// `backBuildings` of the layout (0..1): how far the lot is filled,
    /// from just over the half that leaves it alone to two thirds of the
    /// coverage. The caller draws, with the same share, which lots are filled.
    pub(super) share: f64,
    /// Share of a court house's mass its court leaves open.
    pub(super) open: f64,
    pub(super) setback: f64,
    pub(super) rooms: [f64; 2],
    pub(super) court_wing: f64,
    /// The lot builds on its party walls, from wall to wall.
    pub(super) attached: bool,
    /// The form laid: a detached house, else a row (or a form fallen back
    /// to one), else a court or compound form.
    pub(super) detached: bool,
    pub(super) row: bool,
    pub(super) workshop: bool,
    /// The form of the bounded house, on a lot at least twice its box: the
    /// free ground holds a second house of the tissue.
    pub(super) second: Option<Kind>,
}

/// The largest rectangle of the lot's frame on the ground no laid piece
/// covers (`kept` left out as well): 4 x 5 m at least, a wing thick, clear
/// of every piece.
fn free_rectangle(lay: &Lay, kept: Option<&[Point]>) -> Option<[f64; 4]> {
    fn solid(r: &[Point]) -> Shape {
        Shape {
            outer: r.to_vec(),
            holes: vec![],
        }
    }
    let f = lay.f;
    let mut free = vec![solid(lay.b)];
    for cut in kept
        .into_iter()
        .chain(lay.pieces.iter().map(|p| p.0.as_slice()))
    {
        let cut = solid(cut);
        free = free.iter().flat_map(|s| difference(s, &cut)).collect();
    }
    // Ground around a body that stands clear of every lot line is one ring
    // once cut along that body's sides down to the front of the lot.
    let front = f.range(lay.b).2;
    for _ in 0..3 {
        if free.iter().all(|s| s.holes.is_empty()) {
            break;
        }
        free = free
            .into_iter()
            .flat_map(|s| {
                let cuts: Vec<Shape> = s
                    .holes
                    .iter()
                    .map(|h| {
                        let (a, z, _, far) = f.range(h);
                        solid(&lay.rect([a - 0.01, z + 0.01, front - 1.0, far + 0.01]))
                    })
                    .collect();
                let mut rest = vec![s];
                for cut in &cuts {
                    rest = rest.iter().flat_map(|g| difference(g, cut)).collect();
                }
                rest
            })
            .collect();
    }
    let size = |r: &[f64; 4]| (r[1] - r[0]) * (r[3] - r[2]);
    let fits = |w: f64, d: f64| w.min(d) >= lay.wing.max(4.0) && w.max(d) >= 5.0;
    free.iter()
        .filter(|s| s.holes.is_empty() && s.outer.len() >= 3)
        .filter_map(|s| {
            let r = inscribed_by(&s.outer, &f, |w, d| if fits(w, d) { w * d } else { 0.0 })?;
            fits(r[1] - r[0], r[3] - r[2]).then(|| deepened(&s.outer, &f, r))
        })
        .filter(|r| lay.clear(&lay.rect(*r)))
        .max_by(|x, y| size(x).total_cmp(&size(y)))
}

/// The frame rectangle `r` of `ring` deepened at both ends as far as it
/// stays inside at its width (`fit` exact): `inscribed` tries levels a
/// twelfth of the depth apart, which would leave a strip of ground between
/// the rectangle and the wall that bounds it.
fn deepened(ring: &[Point], f: &Frame, [s0, s1, t0, t1]: [f64; 4]) -> [f64; 4] {
    let (_, _, lo, hi) = f.range(ring);
    let holds = |a: f64, z: f64| {
        fit(ring, f, a, z, 0.5 * (s0 + s1)).is_some_and(|(l, r)| l <= s0 + 1e-6 && r >= s1 - 1e-6)
    };
    // The furthest level from `kept` towards `end` whose band still holds.
    fn reach(kept: f64, end: f64, band: &dyn Fn(f64) -> bool) -> f64 {
        if band(end) {
            return end;
        }
        let (mut kept, mut out) = (kept, end);
        for _ in 0..10 {
            let mid = 0.5 * (kept + out);
            if band(mid) {
                kept = mid;
            } else {
                out = mid;
            }
        }
        kept
    }
    let t0 = reach(t0, lo, &|a: f64| holds(a, t1));
    let t1 = reach(t1, hi, &|z: f64| holds(t0, z));
    [s0, s1, t0, t1]
}

/// Back buildings on the free ground of a town lot built under half of its
/// tissue's coverage: while the lot stays under two thirds of that coverage,
/// three times at most, the largest free rectangle of the lot's frame
/// (`free_rectangle`) takes one more body. The layout's `backBuildings`
/// (0..1) is the share of such lots that are filled (the others keep their
/// court or garden) and brings the two thirds down towards the half
/// (`share`). A house stands only where the free ground touches a
/// street or a lane: every other body is a low dependency (`annex`), reached
/// through its lot. What a body is follows the lot:
/// - on free ground along a street or a lane, a second house of the tissue's
///   form where a bounded court house leaves at least its own box free (a
///   court house with whole wings, else a house across the back), else a
///   house (`building`) along that street or lane;
/// - behind a row, the back-lot workshop, stable or store of its tissue, in
///   proportion to the ground it closes; behind a detached house, its shed
///   or workshop; each grown towards what the coverage still asks;
/// - else a service range beside a court house, along the longer side of
///   the free ground.
/// Every body is a whole rectangle of the frame at least `wing` thick,
/// against a wall of the lot where the free ground lies on one. No strip
/// thinner than a yard is left along it, and a body that does not stand at
/// the back of the lot keeps a passage beside it (1.2 m, a yard between
/// party walls, where a thinner strip is no yard); a street house between
/// party walls spans its frontage, the ground behind reached through it. A
/// lot that already holds half of its coverage, or no piece at all, is left
/// as laid.
pub(super) fn fill_back(lay: &mut Lay, c: &Fill, rng: &mut Rng) {
    const PASSAGE: f64 = 1.2;
    const YARD: f64 = 3.0;
    if lay.pieces.is_empty() {
        return;
    }
    let mut covered: f64 = lay
        .pieces
        .iter()
        .map(|(r, hole, _)| {
            ring_area(r).abs() - hole.as_ref().map_or(0.0, |h| ring_area(h).abs())
        })
        .sum();
    if covered >= 0.5 * c.target {
        return;
    }
    let goal = c.target * (0.5 + c.share.clamp(0.0, 1.0) / 6.0);
    let (f, wing, fronts) = (lay.f, lay.wing, lay.fronts);
    let back = f.range(lay.b).3;
    let at = |s: f64, t: f64| add(scale(f.u, s), scale(f.n, t));
    // A body takes the whole span where the strip left would be no yard.
    let whole = |x: f64, span: f64| if span - x < YARD { span } else { x };
    // A court house needs its two wings and a court of 3.5 m.
    let least = 2.0 * c.court_wing + 3.5;
    let mut second = c.second;
    for _ in 0..3 {
        if covered >= goal {
            break;
        }
        let Some([s0, s1, t0, t1]) = free_rectangle(lay, c.kept) else {
            break;
        };
        let (w, d) = (s1 - s0, t1 - t0);
        let need = (goal - covered).max(wing * wing);
        // The side a body stands on: the wall of the lot the rectangle lies
        // on, drawn where it lies on both or on none.
        let toss = rng.chance(0.5);
        let left = match fit_any(lay.b, &f, t0, t1, 0.5 * (s0 + s1)) {
            Some((l, r)) if (s0 - l < 0.05) != (r - s1 < 0.05) => s0 - l < 0.05,
            _ => toss,
        };
        // The side of the rectangle (near, far, low, high) a street or a
        // lane runs along, within the setback.
        let street = [
            (at(s0, t0), at(s1, t0)),
            (at(s0, t1), at(s1, t1)),
            (at(s0, t0), at(s0, t1)),
            (at(s1, t0), at(s1, t1)),
        ]
        .into_iter()
        .position(|(a, b)| {
            let (e, len) = (unit(sub(b, a)), length(sub(b, a)));
            fronts.iter().any(|g| {
                let (x, y) = (dot(sub(g.a, a), e), dot(sub(g.b, a), e));
                let off = dot(sub(scale(add(g.a, g.b), 0.5), a), normal(e)).abs();
                (y - x).abs() >= 0.8 * length(sub(g.b, g.a))
                    && x.max(y).min(len) - x.min(y).max(0.0) >= 2.0
                    && off <= c.setback + 1.5
            })
        });
        // The width a body ending at level `v` may take, and its span there.
        let room = |v: f64| {
            if back - v > PASSAGE && !(c.attached && street.is_some()) {
                w - if c.attached { YARD } else { PASSAGE }
            } else {
                w
            }
        };
        let across = |len: f64, v: f64| {
            let len = whole(len, room(v));
            if left { (s0, s0 + len) } else { (s1 - len, s1) }
        };
        let (body, label, court): ([f64; 4], &'static str, bool) = match (second.take(), street) {
            (Some(Kind::Court), Some(_)) if w >= least + YARD && d >= least => {
                let (k0, k1, k2, k3) = c.kept.map_or((0.0, 0.0, 0.0, 0.0), |k| f.range(k));
                let deep = whole((k3 - k2).max(least), d);
                // On the back street where the free ground reaches one.
                let (u, v) = if street == Some(1) {
                    (t1 - deep, t1)
                } else {
                    (t0, t0 + deep)
                };
                let (a, z) = across((k1 - k0).max(least), v);
                ([a, z, u, v], "building", true)
            }
            (Some(k), Some(_)) if k != Kind::Court => {
                let deep = whole(rng.range(5.0, 8.0).max(wing), d);
                let (a, z) = across((w * rng.range(0.45, 0.65)).max(8.0), t1);
                ([a, z, t1 - deep, t1], "building", false)
            }
            (_, Some(side)) => {
                // One or two rooms deep, as long as the coverage asks.
                let deep = rng.range(c.rooms[0], 2.0 * c.rooms[0]).max(wing);
                if side < 2 {
                    let deep = whole(deep, d);
                    let (u, v) = if side == 0 {
                        (t0, t0 + deep)
                    } else {
                        (t1 - deep, t1)
                    };
                    let (a, z) = across((need / deep).max(5.0), v);
                    ([a, z, u, v], "building", false)
                } else {
                    let len = whole((need / deep).max(5.0), d);
                    let deep = whole(deep, room(t0 + len));
                    let (a, z) = if side == 2 {
                        (s0, s0 + deep)
                    } else {
                        (s1 - deep, s1)
                    };
                    ([a, z, t0, t0 + len], "building", false)
                }
            }
            (_, None) if c.kept.is_none() && d >= 8.0 && (c.detached || c.row) => {
                let (bw, bd) = if c.detached {
                    if c.workshop {
                        (rng.range(6.0, 9.0), rng.range(6.0, 9.0))
                    } else {
                        (rng.range(3.0, 5.0), rng.range(3.0, 5.0))
                    }
                } else {
                    (
                        w * if c.workshop { 1.0 } else { rng.range(0.55, 1.0) },
                        rng.range(4.0, 7.0).max(0.25 * d.min(30.0)),
                    )
                };
                let (bw, bd) = (bw.max(wing), bd.max(wing));
                let k = (need / (bw * bd)).sqrt().clamp(1.0, 3.0);
                let deep = whole(bd * k, d);
                let (a, z) = across(bw * k, t1);
                ([a, z, t1 - deep, t1], "annex", false)
            }
            _ => {
                let deep = rng.range(wing, c.rooms[0].max(wing + 0.5));
                if w >= d {
                    let deep = whole(deep, d);
                    let (a, z) = across((need / deep).max(5.0), t1);
                    ([a, z, t1 - deep, t1], "annex", false)
                } else {
                    let (a, z) = across(deep, t1);
                    let len = whole((need / (z - a).max(wing)).max(5.0), d);
                    ([a, z, t1 - len, t1], "annex", false)
                }
            }
        };
        let [a, z, u, v] = body;
        let Some(r) = lay
            .place(a, z, u, v, 0.5 * (a + z))
            .filter(|&r| lay.clear(&lay.rect(r)))
        else {
            break;
        };
        // The court keeps the wing width on every side and opens the share
        // of the mass the coverage leaves, 3 m and 9 m² at least.
        let (iw, id) = (
            r[1] - r[0] - 2.0 * c.court_wing,
            r[3] - r[2] - 2.0 * c.court_wing,
        );
        let hole = (court && iw >= 3.0 && id >= 3.0 && iw * id >= 9.0).then(|| {
            let k = (c.open * (r[1] - r[0]) * (r[3] - r[2]) / (iw * id))
                .sqrt()
                .max(3.0 / iw.min(id))
                .max(3.0 / (iw * id).sqrt())
                .min(1.0);
            let (ms, mt) = (0.5 * (r[0] + r[1]), 0.5 * (r[2] + r[3]));
            lay.rect([
                ms - 0.5 * iw * k,
                ms + 0.5 * iw * k,
                mt - 0.5 * id * k,
                mt + 0.5 * id * k,
            ])
        });
        let ring = lay.rect(r);
        covered += ring_area(&ring).abs() - hole.as_ref().map_or(0.0, |h| ring_area(h).abs());
        lay.pieces.push((ring, hole, label));
    }
}
