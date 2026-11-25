//! Frontage frames and street-backed building ranges.

use super::*;

/// Frame of one frontage run: `u` along the street, `n` into the parcel and the
/// frontage level `t0` (minimum `dot(n, p)` over the run).
#[derive(Clone, Copy)]
pub(in crate::urban::parcels) struct Frame {
    pub(in crate::urban::parcels) u: Point,
    pub(in crate::urban::parcels) n: Point,
    pub(in crate::urban::parcels) t0: f64,
}
impl Frame {
    pub(super) fn s(&self, p: Point) -> f64 {
        dot(self.u, p)
    }
    pub(super) fn t(&self, p: Point) -> f64 {
        dot(self.n, p)
    }
    /// t <= c
    pub(in crate::urban::parcels) fn below(&self, c: f64) -> Plane {
        (self.n, c)
    }
    /// t >= c
    pub(in crate::urban::parcels) fn above(&self, c: f64) -> Plane {
        (scale(self.n, -1.0), -c)
    }
    pub(in crate::urban::parcels) fn left(&self, c: f64) -> Plane {
        (self.u, c)
    }
    pub(in crate::urban::parcels) fn right(&self, c: f64) -> Plane {
        (scale(self.u, -1.0), -c)
    }
    /// Axis-aligned frame rectangle [s0,s1] x [t0,t1].
    pub(in crate::urban::parcels) fn rect(&self, s0: f64, s1: f64, t0: f64, t1: f64) -> [Plane; 4] {
        [
            self.right(s0),
            self.left(s1),
            self.above(t0),
            self.below(t1),
        ]
    }
    pub(super) fn range(&self, ring: &[Point]) -> (f64, f64, f64, f64) {
        ring.iter().fold(
            (
                f64::INFINITY,
                f64::NEG_INFINITY,
                f64::INFINITY,
                f64::NEG_INFINITY,
            ),
            |(a, b, c, d), &p| {
                let (s, t) = (self.s(p), self.t(p));
                (a.min(s), b.max(s), c.min(t), d.max(t))
            },
        )
    }
}

pub(super) fn frame_of(run: &[Front], shape: &Shape) -> Frame {
    let (a, b) = (run[0].a, run.last().unwrap().b);
    let u = unit(sub(b, a));
    let mid = scale(add(a, b), 0.5);
    let mut n = normal(u);
    let probe = |n: Point| super::super::super::geometry::contains(shape, add(mid, scale(n, 0.3)));
    if !probe(n)
        && (probe(scale(n, -1.0))
            || dot(sub(super::super::super::geometry::centroid(shape), mid), n) < 0.0)
    {
        n = scale(n, -1.0);
    }
    let t0 = run
        .iter()
        .flat_map(|f| [dot(n, f.a), dot(n, f.b)])
        .fold(f64::INFINITY, f64::min);
    Frame { u, n, t0 }
}

pub(super) fn convex(ring: &[Point]) -> bool {
    let n = ring.len();
    (0..n).all(|i| {
        let (a, b, c) = (ring[i], ring[(i + 1) % n], ring[(i + 2) % n]);
        let (e, f) = (sub(b, a), sub(c, b));
        e.x * f.y - e.y * f.x >= -1e-6 * length(e).max(1e-9) * length(f).max(1e-9)
    })
}

/// The parcel minus its street setback and (without party walls) its side
/// gaps. Convex lots are inset edge by edge; others by frame bounds.
pub(super) fn base(
    ring: &[Point],
    fronts: &[Front],
    frames: &[Frame],
    setback: f64,
    gap: f64,
) -> Vec<Vec<Point>> {
    let on_front = |a: Point, b: Point| {
        let m = scale(add(a, b), 0.5);
        fronts.iter().any(|f| distance(m, f.a, f.b) < 0.05)
    };
    let mut planes = vec![];
    if convex(ring) {
        for i in 0..ring.len() {
            let (a, b) = (ring[i], ring[(i + 1) % ring.len()]);
            if length(sub(b, a)) < 1e-6 {
                continue;
            }
            let g = if on_front(a, b) { setback } else { gap };
            if g > 1e-6 {
                let m = normal(unit(sub(b, a)));
                planes.push((scale(m, -1.0), -(dot(m, a) + g)));
            }
        }
    } else {
        for f in frames {
            planes.push(f.above(f.t0 + setback));
        }
        if gap > 1e-6
            && let Some(f) = frames.first()
        {
            let (s0, s1, _, _) = f.range(ring);
            planes.push(f.right(s0 + gap));
            planes.push(f.left(s1 - gap));
        }
    }
    clip_parts(ring, &planes)
}

/// The lot without a strip `setback` deep along each of its street fronts:
/// the setback of a concave lot, exact where frame half-planes would cut
/// away whatever lies beyond a front set in a recess.
pub(super) fn behind_fronts(ring: &[Point], fronts: &[Front], setback: f64) -> Vec<Point> {
    let mut rest = vec![Shape {
        outer: ring.to_vec(),
        holes: vec![],
    }];
    if setback > 1e-6 {
        for f in fronts {
            let u = unit(sub(f.b, f.a));
            let n = scale(normal(u), setback);
            let (a, b) = (sub(f.a, scale(u, 0.05)), add(f.b, scale(u, 0.05)));
            let strip = Shape {
                outer: vec![sub(a, n), sub(b, n), add(b, n), add(a, n)],
                holes: vec![],
            };
            rest = rest.iter().flat_map(|s| difference(s, &strip)).collect();
        }
    }
    largest(rest.into_iter().map(|s| s.outer).collect())
}

pub(in crate::urban::parcels) fn circle(c: Point, r: f64) -> Vec<Plane> {
    (0..12)
        .map(|i| {
            let a = i as f64 * std::f64::consts::TAU / 12.0;
            let n = Point {
                x: a.cos(),
                y: a.sin(),
            };
            (n, dot(n, c) + r)
        })
        .collect()
}

/// Pieces of `ring` inside the convex window `planes`, one ring per connected
/// component. Sutherland-Hodgman is exact for a convex subject; a concave one
/// may fall apart into several components, which one S-H ring would bridge with
/// zero-width edges (an invalid polygon), so a boolean intersection keeps them.
pub(in crate::urban::parcels) fn clip_parts(ring: &[Point], planes: &[Plane]) -> Vec<Vec<Point>> {
    let r = clip(ring, planes);
    if r.len() < 3 || ring_area(&r).abs() < 1e-6 {
        return vec![];
    }
    if convex(ring) {
        return vec![r];
    }
    let (mut x0, mut y0, mut x1, mut y1) = (
        f64::INFINITY,
        f64::INFINITY,
        f64::NEG_INFINITY,
        f64::NEG_INFINITY,
    );
    for p in ring {
        (x0, y0, x1, y1) = (x0.min(p.x), y0.min(p.y), x1.max(p.x), y1.max(p.y));
    }
    let m = 1.0 + (x1 - x0).max(y1 - y0);
    let square = [
        Point {
            x: x0 - m,
            y: y0 - m,
        },
        Point {
            x: x1 + m,
            y: y0 - m,
        },
        Point {
            x: x1 + m,
            y: y1 + m,
        },
        Point {
            x: x0 - m,
            y: y1 + m,
        },
    ];
    let window = clip(&square, planes);
    if window.len() < 3 {
        return vec![];
    }
    super::super::super::geometry::intersection(
        &Shape {
            outer: ring.to_vec(),
            holes: vec![],
        },
        &Shape {
            outer: window,
            holes: vec![],
        },
    )
    .into_iter()
    .map(|s| s.outer)
    .collect()
}

pub(super) fn largest(parts: Vec<Vec<Point>>) -> Vec<Point> {
    parts
        .into_iter()
        .max_by(|a, b| ring_area(a).abs().total_cmp(&ring_area(b).abs()))
        .unwrap_or_default()
}

/// The widest frame interval `[L, R]` around `anchor` such that the rectangle
/// `[L, R] x [t0, t1]` lies inside `ring`. Exact: the boundary is linear between
/// vertex levels, so slices just inside the band ends and on both sides of every
/// vertex level inside it bound the interval.
pub(super) fn fit(ring: &[Point], f: &Frame, t0: f64, t1: f64, anchor: f64) -> Option<(f64, f64)> {
    if t1 - t0 < 1e-6 || ring.len() < 3 {
        return None;
    }
    let pts: Vec<(f64, f64)> = ring.iter().map(|&p| (f.s(p), f.t(p))).collect();
    let eps = 1e-6;
    let mut levels = vec![t0 + eps, t1 - eps];
    for &(_, t) in &pts {
        if t > t0 && t < t1 {
            levels.push((t - eps).max(t0 + eps));
            levels.push((t + eps).min(t1 - eps));
        }
    }
    let (mut lo, mut hi) = (f64::NEG_INFINITY, f64::INFINITY);
    let n = pts.len();
    let mut xs = Vec::with_capacity(8);
    for level in levels {
        xs.clear();
        for i in 0..n {
            let (sa, ta) = pts[i];
            let (sb, tb) = pts[(i + 1) % n];
            if (ta <= level) != (tb <= level) {
                xs.push(sa + (sb - sa) * (level - ta) / (tb - ta));
            }
        }
        xs.sort_by(f64::total_cmp);
        let span = xs
            .chunks(2)
            .find(|c| c.len() == 2 && c[0] <= anchor && anchor <= c[1])?;
        lo = lo.max(span[0]);
        hi = hi.min(span[1]);
        if hi <= lo {
            return None;
        }
    }
    Some((lo, hi))
}

/// `fit` around `anchor`, else around the middle of the slice nearest to it.
pub(super) fn fit_any(ring: &[Point], f: &Frame, t0: f64, t1: f64, anchor: f64) -> Option<(f64, f64)> {
    fit(ring, f, t0, t1, anchor).or_else(|| {
        let level = 0.5 * (t0 + t1);
        let pts: Vec<(f64, f64)> = ring.iter().map(|&p| (f.s(p), f.t(p))).collect();
        let n = pts.len();
        let mut xs: Vec<f64> = (0..n)
            .filter_map(|i| {
                let (sa, ta) = pts[i];
                let (sb, tb) = pts[(i + 1) % n];
                ((ta <= level) != (tb <= level)).then(|| sa + (sb - sa) * (level - ta) / (tb - ta))
            })
            .collect();
        xs.sort_by(f64::total_cmp);
        let near = xs.chunks(2).filter(|c| c.len() == 2).min_by(|a, b| {
            let d = |c: &[f64]| (0.5 * (c[0] + c[1]) - anchor).abs();
            d(a).total_cmp(&d(b))
        })?;
        fit(ring, f, t0, t1, 0.5 * (near[0] + near[1]))
    })
}

/// Every significant edge (>= 0.8 m) off the street frontage runs within
/// `tolerance` degrees of the frame axes: the mass is square in the street
/// frame, its street wall alone following the (possibly curved) street.
/// Near-axis edges may still converge into a needle. Require at least a
/// 45-degree angle between adjacent sides as well (including inward spikes),
/// leaving room for the existing 30-degree street / 15-degree side tolerance.
pub(super) fn square_enough(ring: &[Point], f: &Frame, fronts: &[Front], tolerance: f64) -> bool {
    let limit = tolerance.to_radians().sin();
    ring.len() >= 3
        && (0..ring.len()).all(|i| {
            let a = sub(ring[i], ring[(i + ring.len() - 1) % ring.len()]);
            let b = sub(ring[(i + 1) % ring.len()], ring[i]);
            let lengths = length(a) * length(b);
            lengths > 1e-12 && dot(a, b) / lengths >= -std::f64::consts::FRAC_1_SQRT_2 - 1e-9
        })
        && ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
            .all(|(a, b)| {
                let e = sub(*b, *a);
                let len = length(e);
                if len < 0.8 {
                    return true;
                }
                let (x, y) = (dot(e, f.u).abs() / len, dot(e, f.n).abs() / len);
                let m = scale(add(*a, *b), 0.5);
                // A street wall may follow its street within 30 degrees.
                if y <= 0.5 && fronts.iter().any(|g| distance(m, g.a, g.b) < 0.3) {
                    return true;
                }
                x.min(y) <= limit
            })
}

/// Street range of an attached row (« front bâti continu »): the domain `b`
/// between its street frontage and that frontage offset `to` metres into the
/// lot along the whole run (mitred at street bends), closed by the lot's own
/// sides, i.e. the cadastral party walls neighbours share. Every lot of a block
/// face thus builds its street wall from party wall to party wall at the same
/// depth from the street, however the street curves or the walls lean. `None`
/// (the caller then fits a frame rectangle) when the range would not be a
/// legible body: thinner than `wing`, a party wall leaning more than 25
/// degrees off square (a « losange » where a straight house fits), a
/// self-crossing offset (a bend tighter than the depth), or a range covering
/// less than half its nominal strip.
pub(super) fn front_range(
    b: &[Point],
    run: &[Front],
    inward: Point,
    to: f64,
    wing: f64,
    streets: &[Front],
) -> Option<Vec<Point>> {
    front_range_why(b, run, inward, to, wing, true, streets).ok()
}
/// cos 2 degrees: two frames closer than this share their orientation.
pub(super) const LEAN: f64 = 0.99939;

/// Street range whose back wall is square to the lot's side walls (`lf`),
/// not parallel to the street (« la perpendiculaire à la parcelle pour le
/// mur de derrière »): the street wall follows the street, the party walls
/// are the lot's, the back wall stands `to` behind the frontage's middle.
/// `None` where the lot stands square to its street, the run bends (more
/// than 8 degrees), the walls lean more than 25 degrees or the range is not
/// legible; the caller then keeps the street-parallel range.
pub(super) fn square_backed(
    b: &[Point],
    run: &[Front],
    main: &Frame,
    lf: &Frame,
    to: f64,
    wing: f64,
    streets: &[Front],
) -> Option<Vec<Point>> {
    let lean = dot(lf.n, main.n).clamp(-1.0, 1.0);
    if lean >= LEAN || lean < 25f64.to_radians().cos() {
        return None;
    }
    let (a, z) = (run.first()?.a, run.last()?.b);
    let chord = length(sub(z, a));
    // A cadastral jog (under 1.5 m) at a run's end is no bend of the street,
    // nor a gentle curve whose vertices stand within a tenth of the range's
    // depth (1 m at most) of its chord: the back wall stays square to the
    // party walls (« des trapèzes plutôt que des parallélogrammes »).
    let (a, z) = (run.first()?.a, run.last()?.b);
    let sag = (0.1 * to).clamp(0.3, 1.0);
    let bent = run
        .iter()
        .flat_map(|f| [f.a, f.b])
        .any(|p| distance(p, a, z) > sag)
        || dot(unit(sub(z, a)), main.u).abs() < 8f64.to_radians().cos();
    if bent || chord < wing {
        return None;
    }
    let mid = scale(add(a, z), 0.5);
    let extra = 0.5 * chord * lean.acos().tan() + 1.0;
    let r = front_range_why(b, run, main.n, to + extra, wing, true, streets).ok()?;
    let back = lf.t(mid) + to - (main.t(mid) - main.t0);
    let r = dedup(largest(clip_parts(&r, &[lf.below(back)])));
    legible(&r, wing).then_some(r)
}

/// The strip between a street run and its offset `to` metres inward, run ends
/// prolonged so that the lot's sides, not the strip, close what it cuts.
pub(super) fn street_strip(run: &[Front], inward: Point, to: f64) -> Result<Vec<Point>, &'static str> {
    let segs: Vec<(Point, Point, Point)> = run
        .iter()
        .filter(|f| length(sub(f.b, f.a)) > 0.05)
        .map(|f| {
            let n = normal(unit(sub(f.b, f.a)));
            (
                f.a,
                f.b,
                if dot(n, inward) < 0.0 {
                    scale(n, -1.0)
                } else {
                    n
                },
            )
        })
        .collect();
    let (Some(&first), Some(&last)) = (segs.first(), segs.last()) else {
        return Err("empty");
    };
    let ext = 2.0 * (to + 2.0);
    let line = |k: f64| -> Vec<Point> {
        let u0 = unit(sub(first.1, first.0));
        let ul = unit(sub(last.1, last.0));
        let mut pts = vec![
            add(sub(first.0, scale(u0, ext)), scale(first.2, k)),
            add(first.0, scale(first.2, k)),
        ];
        for w in segs.windows(2) {
            let m = add(w[0].2, w[1].2);
            let c = (length(m) * 0.5).max(0.5);
            pts.push(add(w[1].0, scale(unit(m), k / c)));
        }
        pts.push(add(last.1, scale(last.2, k)));
        pts.push(add(add(last.1, scale(ul, ext)), scale(last.2, k)));
        pts
    };
    // The near line lies in the street: `b` (setback applied) bounds the front.
    let mut strip = line(-2.0);
    strip.extend(line(to).into_iter().rev());
    let strip = dedup(strip);
    if strip.len() < 4 || !simple(&strip) {
        return Err("bend");
    }
    Ok(strip)
}
/// `partial`: refuse a range covering less than half its nominal strip (off
/// for a side-street range, whose run also borders the main range).
pub(super) fn front_range_why(
    b: &[Point],
    run: &[Front],
    inward: Point,
    to: f64,
    wing: f64,
    partial: bool,
    streets: &[Front],
) -> Result<Vec<Point>, &'static str> {
    let run_length: f64 = run
        .iter()
        .map(|f| length(sub(f.b, f.a)))
        .filter(|l| *l > 0.05)
        .sum();
    if to < wing || run_length < wing {
        return Err("short");
    }
    let strip = street_strip(run, inward, to)?;
    let range = super::super::super::geometry::intersection(
        &Shape {
            outer: b.to_vec(),
            holes: vec![],
        },
        &Shape {
            outer: strip,
            holes: vec![],
        },
    )
    .into_iter()
    .filter(|s| s.holes.is_empty())
    .max_by(|x, y| area(x).total_cmp(&area(y)))
    .ok_or("empty-cut")?;
    let mut r = dedup(range.outer);
    if r.len() < 3 {
        return Err("empty-cut");
    }
    if ring_area(&r) < 0.0 {
        r.reverse();
    }
    // Cadastral cuts leave centimetre zigzags on lot sides: a wall does not
    // follow them. Kept only when it leaves the domain by a negligible area.
    let smooth = smoothed(&r, 0.05);
    if smooth.len() >= 3
        && smooth.len() < r.len()
        && simple(&smooth)
        && super::super::super::geometry::difference(
            &Shape {
                outer: smooth.clone(),
                holes: vec![],
            },
            &Shape {
                outer: b.to_vec(),
                holes: vec![],
            },
        )
        .iter()
        .map(area)
        .sum::<f64>()
            < 2e-3
    {
        r = smooth;
    }
    // A side-street range ends on whatever closes the lot behind the main
    // range: a sharp corner there is cut square, the street wall is kept.
    let whole = ring_area(&r).abs();
    if !partial {
        r = blunted(r, wing);
    } else {
        // A street range running into the lot's own tip (a street meeting
        // a lot side under 45 degrees) stops square short of it: the tip
        // is a constraint of the lot, not a reason to drop the street wall
        // for a rectangle fitted somewhere in the lot (review series 3 P18).
        r = blunted_at(r, wing, 45.0);
    }
    let n = r.len();
    let square = (0..n).all(|i| {
        let (a, v, c) = (r[(i + n - 1) % n], r[i], r[(i + 1) % n]);
        let (e, f) = (sub(v, a), sub(c, v));
        let (le, lf) = (length(e), length(f));
        // Convex corners only (reflex ones sit at concave street bends), at
        // least 64.5 degrees: a party wall leans at most 25 degrees. A
        // corner between two streets keeps their angle down to 60 degrees
        // (P04 55: the range follows both streets).
        let street = |p: Point, q: Point| {
            let m = scale(add(p, q), 0.5);
            streets.iter().any(|g| distance(m, g.a, g.b) < 0.3)
        };
        let limit = if street(a, v) && street(v, c) {
            120.0
        } else {
            115.5
        };
        le < 0.8
            || lf < 0.8
            || e.x * f.y - e.y * f.x <= 0.0
            || dot(e, f) / (le * lf) >= f64::to_radians(limit).cos()
    });
    if !square {
        return Err("acute");
    }
    if !simple(&r) {
        return Err("simple");
    }
    if partial && ring_area(&r) < 0.5 * run_length.min(40.0) * to {
        return Err("partial");
    }
    // A range whose tip was cut, or ending in a sharp corner between two
    // streets, is a trapezoid of the lot, not its triangle (« pas de maison
    // triangulaire quand un rectangle rentre »): it keeps its full depth
    // along a stretch of the street (a third of the run, two wings at
    // least); else the lot keeps a rectangle.
    if partial && (ring_area(&r).abs() < whole - 0.5 || sharpest(&r) < 70.0) {
        let (a, z) = (run[0].a, run[run.len() - 1].b);
        let f = frame_along(sub(z, a));
        if full_stretch(&r, &f) < (2.0 * wing).max(run_length / 3.0) {
            return Err("tip");
        }
    }
    if thickness(&r, None) < wing - 1e-6 {
        return Err("thin");
    }
    Ok(r)
}

/// Length of the stretch of `ring` along `f.u` where its depth across (the
/// solid on a line along `f.n`) is at least nine tenths of its deepest.
fn full_stretch(ring: &[Point], f: &Frame) -> f64 {
    let pts: Vec<(f64, f64)> = ring.iter().map(|&p| (f.s(p), f.t(p))).collect();
    let (lo, hi) = pts
        .iter()
        .fold((f64::INFINITY, f64::NEG_INFINITY), |(l, h), &(s, _)| {
            (l.min(s), h.max(s))
        });
    const STEP: f64 = 0.25;
    let n = pts.len();
    let depths: Vec<f64> = (0..((hi - lo) / STEP) as usize)
        .map(|k| {
            let x = lo + (k as f64 + 0.5) * STEP;
            let mut ts: Vec<f64> = (0..n)
                .filter_map(|i| {
                    let ((sa, ta), (sb, tb)) = (pts[i], pts[(i + 1) % n]);
                    ((sa <= x) != (sb <= x)).then(|| ta + (tb - ta) * (x - sa) / (sb - sa))
                })
                .collect();
            ts.sort_by(f64::total_cmp);
            ts.chunks(2)
                .filter(|c| c.len() == 2)
                .map(|c| c[1] - c[0])
                .sum()
        })
        .collect();
    let deepest = depths.iter().copied().fold(0.0, f64::max);
    STEP * depths.iter().filter(|&&d| d >= 0.9 * deepest).count() as f64
}
