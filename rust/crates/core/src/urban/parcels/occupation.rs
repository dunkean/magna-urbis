//! City-side building occupation of one parcel: the footprint(s) a house of
//! this culture, zone and programme actually covers, in metres. This is a
//! preview for the city plan (silhouettes, density, later 3D massing) and a
//! hint for the houses crate; the admission witness stays `Parcel.envelope`.
//!
//! Correct by construction: bodies and wings are whole rectangles composed in
//! the frame of the main frontage and fitted (slid, narrowed, shortened) inside
//! the lot by an exact slice test, or the lot band itself when its sides are
//! within 15 degrees of square (street walls then keep the cadastral party
//! walls). A mass that does not fit one wing width is dropped, never clipped
//! into a sliver; a court keeps at least the culture's wing width on every
//! side. Every piece is a valid simple polygon at least `wing` thick.
use super::*;

/// Keep points `p` with `dot(n, p) <= c`.
pub(super) type Plane = (Point, f64);

/// What the parcel builds, chosen from the cultural recipe (buildingOp,
/// plotOp, arch.typology), the zone, the function and the programme role.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(in super::super) enum Kind {
    Open,
    Row,
    Detached,
    Farm,
    Court,
    /// Collective block-front body (insula, tenement): a deep street range
    /// with shops below, built around a court only where the lot holds one.
    Insula,
    Pavilions,
    Hanok,
    Yashiki,
    Round,
    Long,
    Hall,
    Warehouse,
}

/// Resolved tissue numbers for one (block, culture), with pressure applied.
pub(in super::super) struct Occupancy<'a> {
    pub morph: &'a Morph,
    pub zone: &'a str,
    /// Allocation function before the houses mapping (domestic, mixed, workshop,
    /// warehouse, collective, market, common).
    pub function: &'a str,
    pub role: &'a str,
    pub landmark: bool,
    pub party_walls: bool,
    pub wealth: f64,
    pub seed: &'a str,
    /// Architecture pack (EUR-MED, AF-MAG, AS-CHI...): flavours landmark massing.
    pub pack: &'a str,
    /// The lot holds the envelope of one of the pack's native court recipes
    /// (resolved by the caller from the houses admission export): only then
    /// is a collective body's (insula's) court reported as a court form, so
    /// the programme never asks the houses side for a court the lot cannot
    /// hold; elsewhere it stays the light court of a row building.
    pub court_lot: bool,
    /// Whether a home's court wish stays a court in the composition
    /// `building_sites` finally asks (feasibility.rs), when it knows; `None`
    /// falls back to `courts::court_kept`, its approximation from the pack.
    pub court_kept: Option<bool>,
}

pub(in super::super) fn kind(o: &Occupancy) -> Kind {
    let m = o.morph;
    let op = m.text("buildingOp");
    let plot = m.text("plotOp");
    let typology = m.value["arch"]["typology"].as_str().unwrap_or("");
    if matches!(o.function, "open_space" | "market" | "common") {
        return Kind::Open;
    }
    let court = matches!(op, "courtyardHouse" | "kancha" | "sahelCompound")
        || typology.contains("courtyard")
        || matches!(typology, "domus" | "calli" | "kancha-house")
        || plot == "courtyard";
    let pavilions = op == "pavilionCompound" || plot == "siheyuan";
    // A farm is a house, a barn and a yard wherever it stands.
    if o.role.starts_with("dwelling.farm") {
        return Kind::Farm;
    }
    // Programme roles first: inns and cloisters wrap a yard, a town or guild
    // hall keeps the street wall of its square, an elite house gets a court.
    match o.role {
        r if r.starts_with("commerce.inn") || r == "worship.monastery" => return Kind::Court,
        r if r.starts_with("civic.townhall") || r.starts_with("civic.guild") => return Kind::Row,
        // A basilica or a pillared hall is a roofed hall, never a court house.
        r if r.starts_with("civic.basilica") || r.starts_with("civic.hall") => return Kind::Hall,
        r if r.starts_with("dwelling.mansion") && (court || o.party_walls) => return Kind::Court,
        _ => {}
    }
    if o.function == "collective"
        || o.landmark
        || o.role.starts_with("worship")
        || o.role.starts_with("civic")
        || o.role.starts_with("defence")
    {
        return if court || pavilions {
            Kind::Court
        } else {
            Kind::Hall
        };
    }
    if o.function == "warehouse" {
        return Kind::Warehouse;
    }
    if matches!(
        typology,
        "roundhouse" | "ger" | "tipi" | "beehive-hut" | "orc-hut" | "smial" | "tree-house"
    ) {
        return Kind::Round;
    }
    if matches!(
        typology,
        "longhouse" | "byre-house" | "stone-hall" | "duergar-hall"
    ) || matches!(op, "hall" | "duergarHall")
    {
        return Kind::Long;
    }
    // The role chooses before the tissue's form: a court or compound tissue
    // (domus, dar, siheyuan) sets its ordinary court house, not every dwelling.
    if (court || pavilions)
        && let Some(form) = role_form(o)
    {
        return form;
    }
    if pavilions {
        return Kind::Pavilions;
    }
    match op {
        "hanok" => return Kind::Hanok,
        "yashiki" => return Kind::Yashiki,
        _ => {}
    }
    if court {
        return Kind::Court;
    }
    if o.zone == "village" {
        return Kind::Farm;
    }
    Kind::Row
}

/// Residential form of an ordinary dwelling role inside a court or compound
/// tissue (CODEX_ROMAN_COURTYARD_REVIEW.md: a Pompeian shop, a simple house
/// and an Ostian insula are not all domus). A shop fronts its street; a
/// tenement is a deep block-front body, around a court only where the lot
/// holds one with whole wings; a house the programme admitted as a simple
/// recipe (`dwelling.house`, not `dwelling.courtyard`) is a simple body. Court
/// roles (`dwelling.courtyard`, mansions, inns, compounds) keep the tissue's
/// form. No quota: the role and the lot decide, the seed only varies details.
fn role_form(o: &Occupancy) -> Option<Kind> {
    let is = |p: &str| {
        o.role == p
            || o.role
                .strip_prefix(p)
                .is_some_and(|rest| rest.starts_with('.'))
    };
    if is("dwelling.tenement") || is("dwelling.insula") {
        Some(Kind::Insula)
    } else if is("dwelling.shop")
        || is("commerce.shop")
        || is("dwelling.house")
        || is("dwelling.row")
        || is("dwelling.townhouse")
        || (o.function == "mixed" && !is("dwelling.courtyard") && !is("dwelling.compound"))
    {
        Some(Kind::Row)
    } else {
        None
    }
}

fn mix(r: [f64; 2], t: f64) -> f64 {
    r[0] + (r[1] - r[0]) * t.clamp(0.0, 1.0)
}
/// A zoned catalogue range, or the fallback when the tissue does not define it
/// (a defined `[0, 0]`, such as a zero side gap, is a real value).
fn zoned(m: &Morph, key: &str, zone: &str, fallback: [f64; 2]) -> [f64; 2] {
    if m.value[key][zone].is_array() {
        m.range(key, zone)
    } else {
        fallback
    }
}

/// Sutherland-Hodgman against a convex window: exact for any simple subject.
pub(super) fn clip(ring: &[Point], planes: &[Plane]) -> Vec<Point> {
    let mut out = ring.to_vec();
    for &(n, c) in planes {
        if out.len() < 3 {
            return Vec::new();
        }
        let input = std::mem::take(&mut out);
        for i in 0..input.len() {
            let p = input[i];
            let q = input[(i + 1) % input.len()];
            let (dp, dq) = (dot(n, p) - c, dot(n, q) - c);
            if dp <= 0.0 {
                out.push(p);
            }
            if (dp < 0.0 && dq > 0.0) || (dp > 0.0 && dq < 0.0) {
                out.push(add(p, scale(sub(q, p), dp / (dp - dq))));
            }
        }
    }
    out
}

pub(super) fn ring_area(r: &[Point]) -> f64 {
    super::super::geometry::signed(r)
}

/// Frame of one frontage run: `u` along the street, `n` into the parcel and the
/// frontage level `t0` (minimum `dot(n, p)` over the run).
#[derive(Clone, Copy)]
pub(super) struct Frame {
    pub(super) u: Point,
    pub(super) n: Point,
    pub(super) t0: f64,
}
impl Frame {
    fn s(&self, p: Point) -> f64 {
        dot(self.u, p)
    }
    fn t(&self, p: Point) -> f64 {
        dot(self.n, p)
    }
    /// t <= c
    pub(super) fn below(&self, c: f64) -> Plane {
        (self.n, c)
    }
    /// t >= c
    pub(super) fn above(&self, c: f64) -> Plane {
        (scale(self.n, -1.0), -c)
    }
    pub(super) fn left(&self, c: f64) -> Plane {
        (self.u, c)
    }
    pub(super) fn right(&self, c: f64) -> Plane {
        (scale(self.u, -1.0), -c)
    }
    /// Axis-aligned frame rectangle [s0,s1] x [t0,t1].
    pub(super) fn rect(&self, s0: f64, s1: f64, t0: f64, t1: f64) -> [Plane; 4] {
        [
            self.right(s0),
            self.left(s1),
            self.above(t0),
            self.below(t1),
        ]
    }
    fn range(&self, ring: &[Point]) -> (f64, f64, f64, f64) {
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

fn frame_of(run: &[Front], shape: &Shape) -> Frame {
    let (a, b) = (run[0].a, run.last().unwrap().b);
    let u = unit(sub(b, a));
    let mid = scale(add(a, b), 0.5);
    let mut n = normal(u);
    let probe = |n: Point| super::super::geometry::contains(shape, add(mid, scale(n, 0.3)));
    if !probe(n)
        && (probe(scale(n, -1.0))
            || dot(sub(super::super::geometry::centroid(shape), mid), n) < 0.0)
    {
        n = scale(n, -1.0);
    }
    let t0 = run
        .iter()
        .flat_map(|f| [dot(n, f.a), dot(n, f.b)])
        .fold(f64::INFINITY, f64::min);
    Frame { u, n, t0 }
}

fn convex(ring: &[Point]) -> bool {
    let n = ring.len();
    (0..n).all(|i| {
        let (a, b, c) = (ring[i], ring[(i + 1) % n], ring[(i + 2) % n]);
        let (e, f) = (sub(b, a), sub(c, b));
        e.x * f.y - e.y * f.x >= -1e-6 * length(e).max(1e-9) * length(f).max(1e-9)
    })
}

/// The parcel minus its street setback and (without party walls) its side
/// gaps. Convex lots are inset edge by edge; others by frame bounds.
fn base(
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
fn behind_fronts(ring: &[Point], fronts: &[Front], setback: f64) -> Vec<Point> {
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

pub(super) fn circle(c: Point, r: f64) -> Vec<Plane> {
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
pub(super) fn clip_parts(ring: &[Point], planes: &[Plane]) -> Vec<Vec<Point>> {
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
    super::super::geometry::intersection(
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

fn largest(parts: Vec<Vec<Point>>) -> Vec<Point> {
    parts
        .into_iter()
        .max_by(|a, b| ring_area(a).abs().total_cmp(&ring_area(b).abs()))
        .unwrap_or_default()
}

/// The widest frame interval `[L, R]` around `anchor` such that the rectangle
/// `[L, R] x [t0, t1]` lies inside `ring`. Exact: the boundary is linear between
/// vertex levels, so slices just inside the band ends and on both sides of every
/// vertex level inside it bound the interval.
fn fit(ring: &[Point], f: &Frame, t0: f64, t1: f64, anchor: f64) -> Option<(f64, f64)> {
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
fn fit_any(ring: &[Point], f: &Frame, t0: f64, t1: f64, anchor: f64) -> Option<(f64, f64)> {
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
fn square_enough(ring: &[Point], f: &Frame, fronts: &[Front], tolerance: f64) -> bool {
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
fn front_range(
    b: &[Point],
    run: &[Front],
    inward: Point,
    to: f64,
    wing: f64,
) -> Option<Vec<Point>> {
    front_range_why(b, run, inward, to, wing, true).ok()
}
/// The strip between a street run and its offset `to` metres inward, run ends
/// prolonged so that the lot's sides, not the strip, close what it cuts.
fn street_strip(run: &[Front], inward: Point, to: f64) -> Result<Vec<Point>, &'static str> {
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
fn front_range_why(
    b: &[Point],
    run: &[Front],
    inward: Point,
    to: f64,
    wing: f64,
    partial: bool,
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
    let range = super::super::geometry::intersection(
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
        && super::super::geometry::difference(
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
    if !partial {
        r = blunted(r, wing);
    }
    let n = r.len();
    let square = (0..n).all(|i| {
        let (a, v, c) = (r[(i + n - 1) % n], r[i], r[(i + 1) % n]);
        let (e, f) = (sub(v, a), sub(c, v));
        let (le, lf) = (length(e), length(f));
        // Convex corners only (reflex ones sit at concave street bends), at
        // least 64.5 degrees: a party wall leans at most 25 degrees.
        le < 0.8
            || lf < 0.8
            || e.x * f.y - e.y * f.x <= 0.0
            || dot(e, f) / (le * lf) >= 115.5f64.to_radians().cos()
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
    if thickness(&r, None) < wing - 1e-6 {
        return Err("thin");
    }
    Ok(r)
}

/// The ring without vertices lying within `tolerance` of the line through
/// their neighbours (repeated until none is left), at least a triangle.
fn smoothed(ring: &[Point], tolerance: f64) -> Vec<Point> {
    let mut out = ring.to_vec();
    let mut changed = true;
    while changed && out.len() > 3 {
        changed = false;
        let mut i = 0;
        while i < out.len() && out.len() > 3 {
            let n = out.len();
            let (a, v, c) = (out[(i + n - 1) % n], out[i], out[(i + 1) % n]);
            if distance(v, a, c) < tolerance {
                out.remove(i);
                changed = true;
            } else {
                i += 1;
            }
        }
    }
    out
}

/// `ring` offset by `d` (negative: inwards), corners mitred down to 25
/// degrees (sharper ones bevelled), every component as an outer ring.
fn offset(ring: &[Point], d: f64) -> Vec<Vec<Point>> {
    use geo::algorithm::buffer::{Buffer, BufferStyle, LineJoin};
    let poly = super::super::geometry::polygon(&Shape {
        outer: ring.to_vec(),
        holes: vec![],
    });
    let style = BufferStyle::new(d).line_join(LineJoin::Miter(25f64.to_radians()));
    super::super::geometry::shapes(poly.buffer_with_style(style))
        .into_iter()
        .filter(|s| s.holes.is_empty())
        .map(|s| s.outer)
        .collect()
}

/// Morphological opening of `ring` by a disk `wing` across: what is left once
/// every part thinner than a body is removed (slivers, spikes, folded
/// cadastral seams), kept inside `ring` and without its sub-decimetre jogs.
fn opened(ring: &[Point], wing: f64) -> Vec<Vec<Point>> {
    let mut out = vec![];
    // A tapered end survives a bevelled opening thinner than the disk: such a
    // part is opened again by a wider disk, until it holds the body width.
    let mut todo = vec![(ring.to_vec(), 0.5 * wing - 1e-3)];
    while let Some((ring, r)) = todo.pop() {
        for core in offset(&ring, -r) {
            for grown in offset(&core, r) {
                for part in clip_inside(&grown, &ring) {
                    let part = blunted(smoothed(&dedup(part), 0.05), wing);
                    if part.len() < 3 || !simple(&part) || ring_area(&part).abs() < wing * wing {
                        continue;
                    }
                    if thickness(&part, None) >= wing - 1e-6 {
                        out.push(part);
                    } else if r < 0.9 * wing {
                        todo.push((part, r * 1.3));
                    }
                }
            }
        }
    }
    out
}

/// The ring with every corner sharper than 70 degrees cut square to its
/// bisector where the wedge is `wing` wide: an opening keeps acute tips, and
/// a tip is a sliver a body cannot use.
fn blunted(mut ring: Vec<Point>, wing: f64) -> Vec<Point> {
    if ring_area(&ring) < 0.0 {
        ring.reverse();
    }
    for _ in 0..8 {
        let n = ring.len();
        if n < 3 {
            break;
        }
        let tip = (0..n).find_map(|i| {
            let (a, v, c) = (ring[(i + n - 1) % n], ring[i], ring[(i + 1) % n]);
            let (e, f) = (sub(a, v), sub(c, v));
            let (le, lf) = (length(e), length(f));
            let convex = (v.x - a.x) * (c.y - v.y) - (v.y - a.y) * (c.x - v.x) > 0.0;
            let cos = dot(e, f) / (le * lf).max(1e-12);
            (convex && le > 1e-6 && lf > 1e-6 && cos > 70f64.to_radians().cos()).then(|| {
                let half = 0.5 * cos.clamp(-1.0, 1.0).acos();
                let b = unit(add(scale(e, 1.0 / le), scale(f, 1.0 / lf)));
                let d = 0.5 * wing / half.tan().max(1e-6);
                (scale(b, -1.0), -(dot(b, v) + d))
            })
        });
        let Some(plane) = tip else {
            break;
        };
        ring = dedup(largest(clip_parts(&ring, &[plane])));
    }
    ring
}

fn clip_inside(a: &[Point], b: &[Point]) -> Vec<Vec<Point>> {
    super::super::geometry::intersection(
        &Shape {
            outer: a.to_vec(),
            holes: vec![],
        },
        &Shape {
            outer: b.to_vec(),
            holes: vec![],
        },
    )
    .into_iter()
    .filter(|s| s.holes.is_empty())
    .map(|s| s.outer)
    .collect()
}

/// `ring` inset by `d` on every side: the same polygon with each wall moved
/// in (edge by edge when convex, exact), so a court keeps its house's shape.
fn inset(ring: &[Point], d: f64) -> Option<Vec<Point>> {
    let mut r = ring.to_vec();
    if ring_area(&r) < 0.0 {
        r.reverse();
    }
    let out = if convex(&r) {
        let planes: Vec<Plane> = (0..r.len())
            .filter_map(|i| {
                let (a, b) = (r[i], r[(i + 1) % r.len()]);
                (length(sub(b, a)) > 1e-6).then(|| {
                    // Inward (left) normal of a CCW edge.
                    let e = unit(sub(b, a));
                    let m = Point { x: -e.y, y: e.x };
                    (scale(m, -1.0), -(dot(m, a) + d))
                })
            })
            .collect();
        clip(&r, &planes)
    } else {
        largest(offset(&r, -d))
    };
    let out = dedup(out);
    (out.len() >= 3 && ring_area(&out).abs() > 1e-6).then_some(out)
}

/// Polygonal body of an odd-shaped lot (« même dégénérées : en ville les formes
/// bizarres au sol sont courantes »): the street strip of `run`, `to` deep, of
/// the domain (the whole domain without a run), opened by `wing` so that no
/// part is thinner than a body. Built where no square body or legible range
/// fits, so an allocated lot always carries a house when a body fits at all.
fn polygonal(
    b: &[Point],
    run: Option<&[Front]>,
    inward: Point,
    to: f64,
    wing: f64,
) -> Vec<Vec<Point>> {
    let domain = run
        .and_then(|r| street_strip(r, inward, to).ok())
        .map_or_else(|| vec![b.to_vec()], |strip| clip_inside(b, &strip));
    let mut out: Vec<Vec<Point>> = domain.iter().flat_map(|d| opened(d, wing)).collect();
    if out.is_empty() && run.is_some() {
        out = opened(b, wing);
    }
    out
}

/// A rear wing or back building against one party wall (« aile en retour
/// sur le mur mitoyen »): the part of the domain within `w` of its side wall
/// on the `left` (low `s`) or right, from level `t0` (the street range's back
/// wall, so the two meet at the lot's own angle) to `t1`, its far end square
/// to the wall. Its long sides follow the party wall the neighbour's wing
/// shares; `None` when no straight side wall bounds that band.
fn side_wing(
    b: &[Point],
    f: &Frame,
    fronts: &[Front],
    left: bool,
    w: f64,
    t0: f64,
    t1: f64,
    wing: f64,
) -> Option<Vec<Point>> {
    if w < wing - 1e-9 || t1 - t0 < wing - 1e-9 {
        return None;
    }
    let band = largest(clip_parts(b, &[f.above(t0), f.below(t1)]));
    if band.len() < 3 {
        return None;
    }
    let (bs0, bs1, _, _) = f.range(&band);
    let mid = 0.5 * (bs0 + bs1);
    let n = band.len();
    let (a, c) = (0..n)
        .map(|i| (band[i], band[(i + 1) % n]))
        .filter(|&(a, c)| {
            let d = sub(c, a);
            let l = length(d);
            let m = scale(add(a, c), 0.5);
            l >= wing
                && dot(d, f.n).abs() / l > 0.8
                && (f.s(m) < mid) == left
                && !fronts.iter().any(|g| distance(m, g.a, g.b) < 0.3)
        })
        .max_by(|x, y| length(sub(x.1, x.0)).total_cmp(&length(sub(y.1, y.0))))?;
    let mut e = unit(sub(c, a));
    if dot(e, f.n) < 0.0 {
        e = scale(e, -1.0);
    }
    let mut m = normal(e);
    if (dot(m, f.u) > 0.0) != left {
        m = scale(m, -1.0);
    }
    // The wall's corner at the far level, then the end square to the wall.
    let far = add(a, scale(e, (t1 - f.t(a)) / dot(e, f.n)));
    let planes = [
        (m, dot(m, a) + w),
        (scale(m, -1.0), -(dot(m, a) - 0.05)),
        f.above(t0),
        (e, dot(e, far)),
    ];
    let r = dedup(largest(clip_parts(b, &planes)));
    (r.len() >= 3
        && simple(&r)
        && ring_area(&r).abs() >= wing * wing
        && thickness(&r, None) >= wing - 1e-6)
        .then_some(r)
}

/// Frame of the lot's own orientation (« l'orientation de la parcelle »):
/// depth along its side walls (their length-weighted mean direction), the
/// main street's frame where the lot has no side wall roughly along it.
fn lot_frame(b: &[Point], main: &Frame, fronts: &[Front]) -> Frame {
    let n = b.len();
    let mut d = Point { x: 0.0, y: 0.0 };
    for i in 0..n {
        let (a, c) = (b[i], b[(i + 1) % n]);
        let e = sub(c, a);
        let l = length(e);
        let m = scale(add(a, c), 0.5);
        if l < 3.0
            || dot(e, main.n).abs() / l < 0.8
            || fronts.iter().any(|g| distance(m, g.a, g.b) < 0.3)
        {
            continue;
        }
        d = add(
            d,
            if dot(e, main.n) < 0.0 {
                scale(e, -1.0)
            } else {
                e
            },
        );
    }
    if length(d) < 1e-6 {
        return *main;
    }
    let nn = unit(d);
    let mut u = normal(nn);
    if dot(u, main.u) < 0.0 {
        u = scale(u, -1.0);
    }
    let t0 = b.iter().map(|&p| dot(nn, p)).fold(f64::INFINITY, f64::min);
    Frame { u, n: nn, t0 }
}

/// Largest frame rectangle `[s0, s1, t0, t1]` inside `ring`, over bands between
/// twelve levels of its depth (`fit` exact for each band).
fn inscribed(ring: &[Point], f: &Frame) -> Option<[f64; 4]> {
    let (s0, s1, t0, t1) = f.range(ring);
    let levels: Vec<f64> = (0..=11).map(|i| t0 + (t1 - t0) * i as f64 / 11.0).collect();
    let mut best: Option<([f64; 4], f64)> = None;
    for i in 0..levels.len() {
        for j in i + 1..levels.len() {
            let (a, b) = (levels[i], levels[j]);
            if let Some((l, r)) = fit_any(ring, f, a, b, 0.5 * (s0 + s1)) {
                let v = (r - l) * (b - a);
                if best.is_none_or(|(_, x)| v > x) {
                    best = Some(([l, r, a, b], v));
                }
            }
        }
    }
    best.map(|(r, _)| r)
}

/// Structural minimum thickness of a piece (outer ring and optional hole):
/// the smallest distance from a vertex to a facing edge across the solid.
/// Unlike `2A/perimeter`, a thin wing attached to a wide body is measured at
/// the wing, and a court whose wall thins to a line is measured there.
/// Measured on the rings without their sub-decimetre jogs (`JOG`): the
/// zigzags cadastral cuts leave on party walls are not walls of the body.
pub(super) fn thickness(outer: &[Point], hole: Option<&[Point]>) -> f64 {
    const JOG: f64 = 0.12;
    // Rings with the solid on their left (outer CCW, hole CW).
    let mut rings: Vec<Vec<Point>> = vec![smoothed(outer, JOG)];
    if ring_area(&rings[0]) < 0.0 {
        rings[0].reverse();
    }
    if let Some(h) = hole {
        let mut h = smoothed(h, JOG);
        if ring_area(&h) > 0.0 {
            h.reverse();
        }
        rings.push(h);
    }
    // Outward normal of an edge: right-hand normal of its direction.
    let out = |a: Point, b: Point| {
        let d = unit(sub(b, a));
        Point { x: d.y, y: -d.x }
    };
    let mut best = f64::INFINITY;
    for (ri, r) in rings.iter().enumerate() {
        let n = r.len();
        for i in 0..n {
            let v = r[i];
            let vn = unit(add(out(r[(i + n - 1) % n], v), out(v, r[(i + 1) % n])));
            for (rj, s) in rings.iter().enumerate() {
                let m = s.len();
                for j in 0..m {
                    if ri == rj && (j == i || (j + 1) % m == i) {
                        continue;
                    }
                    let (a, b) = (s[j], s[(j + 1) % m]);
                    let e = sub(b, a);
                    let len2 = dot(e, e);
                    if len2 < 1e-12 {
                        continue;
                    }
                    let en = out(a, b);
                    if dot(en, vn) > -0.3 || dot(sub(v, a), en) > 1e-9 {
                        continue;
                    }
                    let k = dot(sub(v, a), e) / len2;
                    if !(0.0..=1.0).contains(&k) {
                        continue;
                    }
                    best = best.min(-dot(sub(v, a), en));
                }
            }
        }
    }
    best
}

/// True when no two non-adjacent edges of the ring cross or touch.
fn simple(ring: &[Point]) -> bool {
    let n = ring.len();
    if n < 3 {
        return false;
    }
    let cross = |o: Point, a: Point, b: Point| {
        let (u, v) = (sub(a, o), sub(b, o));
        u.x * v.y - u.y * v.x
    };
    for i in 0..n {
        let (a, b) = (ring[i], ring[(i + 1) % n]);
        for j in i + 1..n {
            if j == i + 1 || (i == 0 && j == n - 1) {
                continue;
            }
            let (c, d) = (ring[j], ring[(j + 1) % n]);
            let (d1, d2) = (cross(a, b, c), cross(a, b, d));
            let (d3, d4) = (cross(c, d, a), cross(c, d, b));
            if d1 * d2 <= 0.0 && d3 * d4 <= 0.0 {
                // Collinear disjoint segments are fine.
                if d1 == 0.0 && d2 == 0.0 {
                    let e = sub(b, a);
                    let (p, q) = (dot(sub(c, a), e), dot(sub(d, a), e));
                    if p.max(q) < 0.0 || p.min(q) > dot(e, e) {
                        continue;
                    }
                }
                return false;
            }
        }
    }
    true
}

type Piece = (Vec<Point>, Option<Vec<Point>>, &'static str);

/// Whole bodies and wings composed in the frame of the main frontage: every
/// piece is a frame rectangle placed (slid, then shrunk) inside the building
/// domain `b`, or the lot band itself when its sides are within 15 degrees of
/// square (the street wall then keeps the cadastral party walls). A mass that
/// does not fit at least `wing` wide is dropped, never clipped into a sliver.
struct Lay<'a> {
    b: &'a [Point],
    fronts: &'a [Front],
    f: Frame,
    wing: f64,
    pieces: Vec<Piece>,
}
impl Lay<'_> {
    fn rect(&self, [s0, s1, t0, t1]: [f64; 4]) -> Vec<Point> {
        let at = |s: f64, t: f64| add(scale(self.f.u, s), scale(self.f.n, t));
        vec![at(s0, t0), at(s1, t0), at(s1, t1), at(s0, t1)]
    }
    /// The rectangle `[s0, s1] x [t0, t1]` inside `b`: slid sideways to fit,
    /// then narrowed, then shortened from its far end; never below `wing`.
    fn place(&self, s0: f64, s1: f64, t0: f64, t1: f64, anchor: f64) -> Option<[f64; 4]> {
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
                    return Some([l, r, start, t]);
                }
            }
        }
        None
    }
    fn add(&mut self, r: [f64; 4], label: &'static str) -> f64 {
        let ring = self.rect(r);
        let a = ring_area(&ring).abs();
        self.pieces.push((ring, None, label));
        a
    }
    fn put(&mut self, s0: f64, s1: f64, t0: f64, t1: f64, anchor: f64) -> f64 {
        self.place(s0, s1, t0, t1, anchor)
            .map_or(0.0, |r| self.add(r, "building"))
    }
    /// The lot band `t0..t1` itself, when square within 15 degrees and thick enough.
    fn band(&self, t0: f64, t1: f64) -> Option<Vec<Point>> {
        if t1 - t0 < self.wing {
            return None;
        }
        let part = dedup(largest(clip_parts(
            self.b,
            &[self.f.above(t0), self.f.below(t1)],
        )));
        (part.len() >= 3
            && square_enough(&part, &self.f, self.fronts, 15.0)
            && thickness(&part, None) >= self.wing - 1e-6)
            .then_some(part)
    }
    /// Street body: the square lot band, else a fitted frame rectangle.
    fn body(&mut self, s0: f64, s1: f64, t0: f64, t1: f64, anchor: f64) -> f64 {
        if let Some(part) = self.band(t0, t1) {
            let a = ring_area(&part).abs();
            self.pieces.push((part, None, "building"));
            return a;
        }
        self.put(s0, s1, t0, t1, anchor)
    }
}

/// Building footprints of one parcel; empty for open space. Every returned
/// shape lies inside the parcel, is counter-clockwise, and is at least 4 m².
#[cfg(test)]
pub(in super::super) fn preview(p: &Parcel, o: &Occupancy) -> Vec<Shape> {
    preview_parts(p, o).0.into_iter().map(|(s, _)| s).collect()
}

/// Footprints with their part label: `building` for ordinary occupation, the
/// programme part (`nave`, `tower`, `minaret`, `prayer-hall`...) for landmarks,
/// `ruin` for the broken walls of a ruined building; and the form actually
/// built, when there is one. The realized form is what the programme wishes
/// (`programme.composition`): a court or insula whose court does not fit
/// falls back to its street body (`Row`, or `Detached` with side gaps), a
/// compound too small for its pavilions to a row, so the houses side is never
/// asked for a court the lot cannot hold.
pub(in super::super) fn preview_parts(
    p: &Parcel,
    o: &Occupancy,
) -> (Vec<(Shape, &'static str)>, Option<Kind>) {
    let (parts, form) = preview_form(p, o);
    let form = (!parts.is_empty()).then_some(form);
    (parts, form)
}

fn preview_form(p: &Parcel, o: &Occupancy) -> (Vec<(Shape, &'static str)>, Kind) {
    let mut rng = Rng::new(o.seed).fork("occupation");
    let kind = kind(o);
    // Invariant (preview = asked composition): a home's court is previewed
    // only on a lot that holds one of the pack's native court sources; else
    // `building_sites` (feasibility.rs) asks another composition, so the lot
    // previews its street house, the simple form that request keeps.
    // It keeps its court as a row's closed back court (Hof, cortile) where
    // the wings fit: the light court of a row building, as an insula's.
    let court_wish = kind == Kind::Court;
    let kind = if court_wish
        && matches!(o.function, "domestic" | "mixed")
        && !o.landmark
        && !o
            .court_kept
            .unwrap_or_else(|| super::courts::court_kept(p, o.pack, o.role, o.function))
    {
        Kind::Row
    } else {
        kind
    };
    if kind == Kind::Open || p.shape.outer.len() < 3 {
        return (vec![], kind);
    }
    let shape = super::super::geometry::normalized(p.shape.clone());
    let ring = &shape.outer;
    let total = area(&shape);
    let m = o.morph;
    let zone = o.zone;
    let pressure = p.pressure.clamp(0.0, 1.0);
    let fronts: Vec<Front> = parcel_fronts(p)
        .into_iter()
        .filter(|f| length(sub(f.b, f.a)) > 0.3)
        .collect();
    let street_runs: Vec<Vec<Front>> = runs(&fronts)
        .into_iter()
        .filter(|r| length(sub(r.last().unwrap().b, r[0].a)) >= 2.0)
        .collect();
    let mut frames: Vec<Frame> = street_runs.iter().map(|r| frame_of(r, &shape)).collect();
    if frames.is_empty() {
        let u = unit(p.axis);
        let u = if length(u) < 0.5 {
            Point { x: 1.0, y: 0.0 }
        } else {
            u
        };
        let mut f = Frame {
            u,
            n: normal(u),
            t0: 0.0,
        };
        f.t0 = f.range(ring).2;
        frames.push(f);
    }
    let main = frames[0];
    let walled = p.provenance.iter().any(|x| x == "curtain-backed");
    // Opposite (through-lot) or angled (corner) second frontage.
    let second_i = (1..frames.len()).find(|&i| dot(frames[i].n, main.n) < 0.82);
    let second = second_i.map(|i| frames[i]);
    let coverage = {
        let planned = m.text("streetOp") == "grid";
        let r = super::pressure::adjusted(m, "coverage", zone, pressure, planned, 0.62, 1.03);
        let r = if m.value["coverage"][zone].is_array() {
            r
        } else {
            [0.5, 0.7]
        };
        mix(r, rng.float()).clamp(0.08, 0.97)
    };
    let setback = match kind {
        Kind::Row | Kind::Warehouse | Kind::Court | Kind::Insula | Kind::Pavilions => {
            mix(zoned(m, "setback", zone, [0.0, 0.5]), rng.float() * 0.5)
        }
        _ => mix(zoned(m, "setback", zone, [0.5, 3.0]), rng.float()).max(0.5),
    };
    let gaps = zoned(m, "sideGap", zone, [0.0, 1.0]);
    let side_gap = mix(gaps, rng.float());
    // Party walls: zero gap where the recipe or the tissue builds them (a zero
    // minimum side gap: souks, medina dars, burgage cores) and the drawn gap is
    // small; otherwise a real side passage (at least 0.8 m).
    let party = o.party_walls || gaps[0] <= 0.0;
    // The form reported to the programme: the wished one unless the lot
    // forces a fallback below. Side gaps only space a row (the wish stays
    // `Row`, as the houses side reads street continuity separately).
    let mut form = kind;
    let kind = if kind == Kind::Row && (!party || side_gap >= 0.6) {
        Kind::Detached
    } else {
        kind
    };
    let attached = matches!(
        kind,
        Kind::Row | Kind::Warehouse | Kind::Court | Kind::Insula | Kind::Pavilions
    ) && party;
    let gap = if attached { 0.0 } else { side_gap.max(0.8) };
    // One street-range depth per block, each lot varying a little around it:
    // the rear walls of a block face line up instead of zigzagging lot by lot.
    let block_draw = o
        .seed
        .rsplit_once("/parcel-")
        .map(|(block, _)| Rng::new(block).fork("street-range-depth").float());
    let own = rng.float();
    let depth = mix(
        zoned(m, "buildDepth", zone, [8.0, 12.0]),
        block_draw.map_or(own, |b| 0.8 * b + 0.2 * own),
    ) * (0.9 + 0.15 * pressure + 0.1 * o.wealth);
    // Minimum body/wing width (culture value, at least 3 m) and court wing.
    let rooms = if m.value["roomDepth"].is_array() {
        m.pair("roomDepth")
    } else {
        [4.5, 6.0]
    };
    let room = mix(rooms, rng.float());
    let wing = m.number_or("minWing", 3.0).max(3.0);
    let court_wing = (rooms[0] * 0.8).clamp(3.5, 6.0).max(wing);
    let used: Vec<Frame> = std::iter::once(main).chain(second).collect();
    let b = largest(base(ring, &fronts, &used, setback, gap));
    // A concave lot whose frame half-planes cut most of it away keeps its own
    // shape behind a setback strip along each front instead.
    let b = if ring_area(&b).abs() < 0.6 * total {
        let own = behind_fronts(ring, &fronts, setback);
        if ring_area(&own).abs() > ring_area(&b).abs() {
            own
        } else {
            b
        }
    } else {
        b
    };
    if b.len() < 3 || ring_area(&b) < 4.0 {
        return (vec![], kind);
    }
    let (s0, s1, _, t1) = main.range(&b);
    let ta = main.t0 + setback;
    // Mid-frontage station: the anchor every body is fitted around.
    let anchor = fronts
        .iter()
        .filter(|f| dot(unit(sub(f.b, f.a)), main.u).abs() > 0.7)
        .max_by(|x, y| length(sub(x.b, x.a)).total_cmp(&length(sub(y.b, y.a))))
        .map_or((s0 + s1) * 0.5, |f| main.s(scale(add(f.a, f.b), 0.5)))
        .clamp(s0, s1);
    // A monument stands whole in its precinct (« sens de l'implantation »):
    // the largest rectangle of the lot facing one of its streets or along
    // its sides (the main street and the lot's own frame unless another holds
    // a tenth more), its parts composed inside, so the lot never cuts a room
    // or a range obliquely. A programme scaled to its lot (a Friday mosque,
    // a cloister) that the precinct would shrink below three fifths keeps its
    // massing in the lot itself: odd-shaped precincts are common in towns.
    let mut probe = rng.clone();
    if let Some(in_lot) = super::landmark::massing(o, &b, main, (s0, s1, ta, t1), &mut probe) {
        let built = |parts: &[Piece]| {
            parts
                .iter()
                .map(|(r, _, _)| ring_area(r).abs())
                .sum::<f64>()
        };
        let lot = lot_frame(&b, &main, &fronts);
        let precinct = std::iter::once(lot)
            .chain(frames.iter().copied())
            .enumerate()
            .filter_map(|(i, f)| {
                let r = inscribed(&b, &f)?;
                let v = (r[1] - r[0]) * (r[3] - r[2]) * if i <= 1 { 1.1 } else { 1.0 };
                Some((f, r, v))
            })
            .max_by(|x, y| x.2.total_cmp(&y.2));
        let mut whole = rng.clone();
        let parts = precinct.and_then(|(f, r, _)| {
            let at = |s: f64, t: f64| add(scale(f.u, s), scale(f.n, t));
            let rect = vec![
                at(r[0], r[2]),
                at(r[1], r[2]),
                at(r[1], r[3]),
                at(r[0], r[3]),
            ];
            super::landmark::massing(o, &rect, f, (r[0], r[1], r[2], r[3]), &mut whole)
        });
        // The precinct holds no such monument: the ordinary occupation.
        let done = match parts {
            Some(parts) if built(&parts) >= 0.6 * built(&in_lot) => {
                finish(&shape, ruined(o, parts, &mut whole), wing)
            }
            Some(_) => finish(&shape, ruined(o, in_lot, &mut probe), wing),
            None => vec![],
        };
        if !done.is_empty() {
            return (done, kind);
        }
    }
    // A house never spreads over an oversized lot: courtyard houses, hanok and
    // yashiki keep a bounded domain at the street and leave the rest as garden.
    let collective = o.function == "collective"
        || o.landmark
        || o.role.starts_with("dwelling.mansion")
        || o.role.starts_with("commerce.inn");
    // A paired court lot is cut to its court house (`pair_courts`): it is
    // the house's own domain, not an oversized lot to leave as garden.
    let paired = p.provenance.iter().any(|x| x == "court-pair");
    let bounded = matches!(kind, Kind::Hanok | Kind::Yashiki)
        || (kind == Kind::Court && !collective && !paired);
    let b = if bounded {
        let (w, d) = (
            rng.range(16.0, 28.0) * (0.85 + 0.3 * o.wealth),
            rng.range(18.0, 32.0) * (0.85 + 0.3 * o.wealth),
        );
        if s1 - s0 > w * 1.2 || t1 - ta > d * 1.2 {
            let x = s0 + (s1 - s0 - w).max(0.0) * rng.float();
            largest(clip_parts(&b, &main.rect(x, x + w, ta - 1.0, ta + d)))
        } else {
            b
        }
    } else {
        b
    };
    if b.len() < 3 || ring_area(&b) < 4.0 {
        return (vec![], kind);
    }
    let (s0, s1, _, t1) = main.range(&b);
    let anchor = anchor.clamp(s0, s1);
    let width = s1 - s0;
    let plot_depth = t1 - ta;
    // The street wall stands where the frontage is fully inside the lot: on a
    // bowed or oblique front a square body starts behind its deepest point.
    let sag = fronts
        .iter()
        .filter(|f| dot(unit(sub(f.b, f.a)), main.u).abs() > 0.9 && main.t(f.a) - main.t0 < 6.0)
        .flat_map(|f| [main.t(f.a), main.t(f.b)])
        .fold(main.t0, f64::max)
        - main.t0;
    let tf = ta + sag.min(3.0);
    let mut lay = Lay {
        b: &b,
        fronts: &fronts,
        f: main,
        wing,
        pieces: vec![],
    };
    let row = |lay: &mut Lay, rng: &mut Rng, depth: f64, workshop: bool| {
        let front_end = ta + depth.min(plot_depth);
        let target = coverage * total;
        // Dense cores also build the closed back court (Hof, cortile): street
        // range, two side wings on the party walls and a rear range around a
        // light court, wherever every wing keeps the culture's width and the
        // court is at least 3 m wide and 12 m². One piece with its court as a
        // hole.
        if second.is_none()
            && (court_wish
                || (coverage >= 0.6
                    && (zone == "core" || pressure >= 0.6)
                    && rng.chance(0.35 + 0.3 * coverage.min(1.0))))
        {
            // A former court house keeps a one-room rear range.
            let rear = if court_wish {
                court_wing.max(depth * 0.4)
            } else {
                wing.max(depth * 0.6)
            }
            .min(depth);
            let court_w = width - 2.0 * wing;
            // The court shortens to the lot's depth, never below 3.5 m.
            let court_d = (court_w * rng.range(0.8, 1.4))
                .clamp(3.5, 14.0)
                .min(t1 - 0.5 - front_end - rear);
            let end = front_end + court_d + rear;
            if court_w >= 3.0
                && court_d >= 3.5
                && court_w * court_d >= 12.0
                && end <= t1 - 0.5 + 1e-9
            {
                let outer = lay.rect([s0, s1, tf, end]);
                let outer_shape = Shape {
                    outer: outer.clone(),
                    holes: vec![],
                };
                let corner = add(scale(main.u, s0), scale(main.n, tf));
                let court = [s0 + wing, s1 - wing, front_end, front_end + court_d];
                let fits = super::families::rect_within(
                    &Shape {
                        outer: lay.b.to_vec(),
                        holes: vec![],
                    },
                    corner,
                    main.u,
                    main.n,
                    s1 - s0,
                    end - tf,
                ) && super::families::rect_within(
                    &outer_shape,
                    add(
                        scale(main.u, court[0] - wing),
                        scale(main.n, court[2] - wing),
                    ),
                    main.u,
                    main.n,
                    court[1] - court[0] + 2.0 * wing,
                    court[3] - court[2] + 2.0 * wing,
                );
                if fits && front_end - tf >= wing {
                    lay.pieces.push((outer, Some(lay.rect(court)), "building"));
                    return;
                }
                // Attached rows on oblique lots: the outer mass is the lot's
                // street range down to the rear range (party walls kept), the
                // court that range inset by the wing width between the street
                // and rear ranges: its walls run along the party walls and
                // the street (« même orientation que la maison »).
                let ranged = attached
                    .then(|| street_runs.first())
                    .flatten()
                    .and_then(|run| front_range(lay.b, run, main.n, end - main.t0, wing));
                if let Some(outer) = ranged
                    && front_end - tf >= court_wing
                    && rear >= court_wing
                    && let Some(inner) = inset(&outer, court_wing)
                {
                    let court = dedup(clip(
                        &inner,
                        &[main.above(front_end), main.below(front_end + court_d)],
                    ));
                    if court.len() >= 3
                        && ring_area(&court).abs() >= 12.0
                        && thickness(&court, None) >= 3.0
                    {
                        lay.pieces.push((outer, Some(court), "building"));
                        return;
                    }
                }
            }
        }
        // Invariant (« mitoyenneté continue »): an attached row builds its
        // street range along the whole frontage, party wall to party wall.
        let range = attached
            .then(|| street_runs.first())
            .flatten()
            .and_then(|run| front_range(lay.b, run, main.n, front_end - main.t0, wing));
        let mut rear_from = front_end;
        let mut covered = match range.or_else(|| lay.band(ta, front_end)) {
            Some(part) => {
                let a = ring_area(&part).abs();
                rear_from = part.iter().map(|&q| main.t(q)).fold(front_end, f64::max);
                lay.pieces.push((part, None, "building"));
                a
            }
            None => lay.put(s0, s1, tf, front_end.max(tf + wing), anchor),
        };
        if let Some(f) = second {
            let opposite = dot(f.n, main.n) < -0.8;
            if opposite {
                // Through-lot: a rear house on the back street, a full room
                // deep behind a 2.5 m yard; on a shorter tail the house runs
                // through to the back street (no strip of a house).
                let start = (t1 - depth * 0.8).max(rear_from + 2.5);
                let start = if t1 - start >= rooms[1] {
                    start
                } else if t1 - rear_from >= rooms[1] + 2.5 {
                    t1 - rooms[1]
                } else {
                    rear_from
                };
                covered += lay.body(s0, s1, start, t1, anchor);
            } else {
                // Corner: the side street builds its own street range behind
                // the main one, both following their streets and meeting on
                // the main range's back wall (an L), else an L square in the
                // main frame.
                let d2 = depth.min(width * 0.6);
                let end = (rear_from + 2.0 * depth).min(t1);
                let back = largest(clip_parts(lay.b, &[main.above(rear_from), main.below(end)]));
                let side = second_i
                    .and_then(|i| street_runs.get(i))
                    .filter(|_| attached && back.len() >= 3)
                    .and_then(|run| {
                        front_range_why(&back, run, f.n, setback + d2, wing, false).ok()
                    });
                let (lo, hi) = if dot(f.n, main.u) < 0.0 {
                    (s1 - d2, s1)
                } else {
                    (s0, s0 + d2)
                };
                let square = lay
                    .place(lo, hi, rear_from, end, (lo + hi) * 0.5)
                    .map(|r| lay.rect(r));
                // A side street touching only part of the lot's side keeps
                // the longer L square in the main frame.
                let part = match (side, square) {
                    (Some(a), Some(b)) if ring_area(&a).abs() < 0.6 * ring_area(&b).abs() => {
                        Some(b)
                    }
                    (a, b) => a.or(b),
                };
                if let Some(part) = part {
                    covered += ring_area(&part).abs();
                    lay.pieces.push((part, None, "building"));
                }
            }
            rear_from = f64::INFINITY;
        }
        let avail = t1 - rear_from;
        let rear_min = if coverage > 0.85 { 1.5 } else { 3.0 };
        // The back of the lot varies lot by lot within the culture's rooms
        // (« réguliers, jamais identiques »), drawn from the lot's own seed: a
        // long wing on one party wall (the burgage back range), a short wing
        // of one or two rooms with a back house beyond its yard, or a back
        // house alone. Every piece stands against the party walls, so the
        // wings of neighbours share them; leftover land stays yard or garden.
        let mut vary = Rng::new(o.seed).fork("occupation-back");
        let (back_form, left) = (vary.float(), vary.chance(0.5));
        let back_rooms = vary.range(rooms[0], 2.0 * rooms[0]).max(wing);
        let yard = vary.range(3.0, 7.0);
        let back_house = |lay: &mut Lay, from: f64, covered: &mut f64| -> Option<f64> {
            let (a, z) = (from + yard, from + yard + back_rooms);
            if z > t1 - rear_min + 1e-9 {
                return None;
            }
            let part = side_wing(lay.b, &main, lay.fronts, left, width, a, z, wing)
                .or_else(|| lay.band(a, z))?;
            *covered += ring_area(&part).abs();
            let end = part.iter().map(|&q| main.t(q)).fold(z, f64::max);
            lay.pieces.push((part, None, "building"));
            Some(end)
        };
        if covered < target - 1.0 && avail > rear_min + wing {
            let w = (width * vary.range(0.35, 0.7)).clamp(wing, (width * 0.7).max(wing));
            let need = (target - covered) / w;
            let len = if back_form < 0.45 {
                (vary.range(1.0, 2.0) * room).min(need)
            } else {
                need * vary.range(0.5, 1.05)
            }
            .min(avail - rear_min);
            if back_form >= 0.2 && len >= wing {
                let (lo, hi) = if left { (s0, s0 + w) } else { (s1 - w, s1) };
                let part = side_wing(
                    lay.b,
                    &main,
                    lay.fronts,
                    left,
                    w,
                    rear_from,
                    rear_from + len,
                    wing,
                )
                .or_else(|| {
                    lay.place(lo, hi, rear_from, rear_from + len, (lo + hi) * 0.5)
                        .map(|r| lay.rect(r))
                });
                if let Some(part) = part {
                    covered += ring_area(&part).abs();
                    rear_from = part.iter().map(|&q| main.t(q)).fold(rear_from, f64::max);
                    lay.pieces.push((part, None, "building"));
                }
            }
            // A lot backing onto the town wall builds its back house on it.
            if back_form < 0.45
                && !walled
                && let Some(end) = back_house(lay, rear_from, &mut covered)
            {
                rear_from = end;
            }
        }
        let tail = t1 - rear_from;
        if walled && tail >= wing + 1.5 {
            // Invariant (houses against the wall): a lot backing onto the town
            // wall builds its rear range on the curtain, its party wall, with
            // no strip between them (« maison adossée au rempart »).
            let dd = rng.range(4.0, 7.0).max(wing).min(tail - 1.5);
            lay.body(s0, s1, t1 - dd, t1, anchor);
        } else if tail >= 9.0 && (workshop || covered < target - 10.0 || rng.chance(0.35)) {
            // Back-lot workshop, stable or store at the end of a long tail,
            // against a party wall.
            let dd = rng.range(4.0, 7.0).min(tail - 4.0);
            let back = rng.range(0.0, 2.0);
            let w = width * if workshop { 1.0 } else { rng.range(0.55, 1.0) };
            let (a, z) = (t1 - back - dd, t1 - back);
            match side_wing(lay.b, &main, lay.fronts, left, w, a, z, wing) {
                Some(part) => lay.pieces.push((part, None, "building")),
                None => {
                    let lo = if left { s0 } else { s1 - w };
                    lay.put(lo, lo + w, a, z, lo + w * 0.5);
                }
            }
        }
    };
    match kind {
        Kind::Open => {}
        Kind::Row => row(&mut lay, &mut rng, depth, o.function == "workshop"),
        Kind::Warehouse => {
            let end = ta + plot_depth.min((depth * 1.5).max(15.0));
            lay.body(s0, s1, tf, end, anchor);
        }
        Kind::Detached | Kind::Farm | Kind::Long => {
            let farm = kind == Kind::Farm;
            let (house_w, house_d) = match kind {
                Kind::Long => (rng.range(14.0, 28.0), rng.range(5.0, 7.5)),
                Kind::Farm => (rng.range(10.0, 16.0), rng.range(7.0, 10.0)),
                _ => (
                    rng.range(7.0, 12.0) * (0.85 + 0.3 * o.wealth),
                    depth.min(rng.range(8.0, 11.0)),
                ),
            };
            // A long house turns its gable to a narrow street frontage.
            let (house_w, house_d) = if kind == Kind::Long && house_w > width * 1.05 {
                (house_d, house_w)
            } else {
                (house_w, house_d)
            };
            let hw = house_w.min(width);
            let slack = (width - hw).max(0.0);
            let at = s0 + slack * rng.range(0.2, 0.8);
            let house = lay.place(at, at + hw, tf, tf + house_d.min(plot_depth), at + hw * 0.5);
            let house_end = house.map_or(tf + house_d.min(plot_depth), |r| r[3]);
            let (hx0, hx1) = house.map_or((at, at + hw), |r| (r[0], r[1]));
            if let Some(r) = house {
                lay.add(r, "building");
            }
            let tail = t1 - house_end;
            if farm {
                // Farmstead: house, barn and a yard. The barn closes the yard
                // at the back (three-sided court) or runs along one side; on a
                // shallow lot it stands beside the house across the yard.
                let bw = rng.range(6.0, 9.0);
                let bl = rng.range(9.0, 15.0);
                let mut barn = 0.0;
                if tail > 8.0 && width > 9.0 {
                    if rng.chance(0.5) {
                        let yard = rng.range(6.0, 12.0).min(tail - 6.0).max(2.0);
                        let start = house_end + yard;
                        let len = rng.range(10.0, 18.0).min(width);
                        let x = s0 + (width - len) * rng.float();
                        barn = lay.put(
                            x,
                            x + len,
                            start,
                            start + bw.min(tail - yard),
                            x + len * 0.5,
                        );
                    } else {
                        let start = house_end + 1.5;
                        let w = bw.min(width * 0.45);
                        let (lo, hi) = if hx0 - s0 > s1 - hx1 {
                            (s0, s0 + w)
                        } else {
                            (s1 - w, s1)
                        };
                        barn = lay.put(lo, hi, start, start + bl.min(tail - 2.0), (lo + hi) * 0.5);
                    }
                }
                if barn <= 0.0 {
                    // Beside the house, a yard between them.
                    let gapx = rng.range(4.0, 8.0);
                    let (lo, hi) = if s1 - hx1 >= hx0 - s0 {
                        (hx1 + gapx, hx1 + gapx + bl)
                    } else {
                        (hx0 - gapx - bl, hx0 - gapx)
                    };
                    lay.put(lo, hi, tf, tf + bw, (lo + hi) * 0.5);
                }
                if total > 1500.0 && rng.chance(0.6) {
                    let start = house_end + 2.0;
                    let x = if rng.chance(0.5) { s0 } else { s1 - 4.5 };
                    lay.put(x, x + 4.5, start, start + 6.0, x + 2.25);
                }
            } else if tail > 8.0 && (o.function == "workshop" || rng.chance(0.3 + 0.4 * coverage)) {
                // Garden shed, workshop or byre at the rear.
                let (w, d) = if o.function == "workshop" {
                    (rng.range(6.0, 9.0), rng.range(6.0, 9.0))
                } else {
                    (rng.range(3.0, 5.0), rng.range(3.0, 5.0))
                };
                let back = rng.range(0.5, 3.0);
                let x = if rng.chance(0.5) { s0 } else { s1 - w };
                lay.put(x, x + w, t1 - back - d, t1 - back, x + w * 0.5);
            }
        }
        Kind::Round => {
            let mut huts: Vec<(Point, f64)> = vec![];
            let count = 1
                + usize::from(total > 300.0)
                + usize::from(total > 700.0)
                + usize::from(rng.chance(0.3));
            for i in 0..count * 6 {
                if huts.len() >= count {
                    break;
                }
                let r = rng.range(2.5, 4.5) * if i == 0 { 1.15 } else { 0.9 };
                let s = if i == 0 {
                    (s0 + s1) * 0.5
                } else {
                    rng.range(s0 + r, (s1 - r).max(s0 + r))
                };
                let t = if i == 0 {
                    ta + r + 1.0
                } else {
                    rng.range(ta + r, (t1 - r).max(ta + r))
                };
                let c = add(scale(main.u, s), scale(main.n, t));
                if !super::super::geometry::contains(&shape, c)
                    || huts.iter().any(|(q, rq)| length(sub(*q, c)) < r + rq + 1.5)
                {
                    continue;
                }
                let hut = largest(clip_parts(&b, &circle(c, r)));
                if hut.len() >= 3 && ring_area(&hut).abs() >= 4.0 {
                    lay.pieces.push((hut, None, "building"));
                    huts.push((c, r));
                }
            }
        }
        Kind::Court | Kind::Insula => {
            // Public and elite courts (cloister, inn yard, hotel court) are
            // wide; an ordinary house keeps the light court its coverage allows.
            // An insula wraps one-room ranges (shops below) around an open
            // court (Ostia, Casa di Diana) where the lot holds whole wings.
            let insula = kind == Kind::Insula;
            let mut ring_depth = if collective {
                (0.12 * width.min(plot_depth)).clamp(4.0, 9.0)
            } else if insula {
                room.clamp(4.0, 7.0)
            } else {
                room.clamp(3.5, 7.0)
            };
            if rng.chance(m.number_or("bigCourtChance", 0.12) + 0.2 * o.wealth) {
                ring_depth *= 0.8;
            }
            let ring_depth = ring_depth.max(court_wing);
            // Outer mass: the square domain itself, else the widest fitted
            // rectangle. The court lies inside it inset by the wing width on
            // every side, so no wing ever thins below `court_wing`.
            let lot_outer = square_enough(&b, &main, &fronts, 15.0);
            let outer = if lot_outer {
                Some(b.clone())
            } else {
                [1.0, 0.8, 0.6].into_iter().find_map(|k| {
                    let r = lay.place(s0, s1, tf, tf + (t1 - tf) * k, anchor)?;
                    (r[1] - r[0] >= 2.0 * court_wing + 3.0 && r[3] - r[2] >= 2.0 * court_wing + 3.0)
                        .then(|| lay.rect(r))
                })
            };
            // Invariant (« la cour a l'orientation de la maison »): a court in
            // the lot's own mass is that mass inset, deeper until its area
            // meets the target, so each court wall is parallel to the house
            // wall facing it; a court in a frame rectangle is a frame
            // rectangle.
            let inset_court = |outer: &[Point]| -> Option<Vec<Point>> {
                let area_outer = ring_area(outer).abs();
                let least = if insula {
                    m.number_or("courtyardMin", 9.0).max(16.0)
                } else {
                    m.number_or("courtyardMin", 9.0).min(9.0)
                };
                let target = if collective || insula {
                    0.0
                } else {
                    m.number_or("courtyardMin", 9.0)
                        .max((1.0 - coverage) * area_outer)
                };
                let mut pick = None;
                for k in [1.0, 1.2, 1.45, 1.75, 2.1, 2.5] {
                    let Some(c) = inset(outer, ring_depth * k) else {
                        break;
                    };
                    let a = ring_area(&c).abs();
                    if a < least || thickness(&c, None) < 3.0 {
                        break;
                    }
                    pick = Some(c);
                    if a <= target || target == 0.0 {
                        break;
                    }
                }
                pick
            };
            let court = outer.as_ref().and_then(|outer| {
                if lot_outer {
                    return inset_court(outer);
                }
                let (cs0, cs1, ct0, ct1) = main.range(outer);
                let (cs0, cs1, ct0, ct1) = (
                    cs0 + ring_depth,
                    cs1 - ring_depth,
                    ct0 + ring_depth,
                    ct1 - ring_depth,
                );
                let (cw, ch) = (cs1 - cs0, ct1 - ct0);
                if cw < 3.0 || ch < 3.0 {
                    return None;
                }
                let area_outer = ring_area(outer).abs();
                let target = if collective || insula {
                    cw * ch
                } else {
                    m.number_or("courtyardMin", 9.0)
                        .max((1.0 - coverage) * area_outer)
                };
                let k = (target / (cw * ch)).sqrt().min(1.0);
                let outer_shape = Shape {
                    outer: outer.clone(),
                    holes: vec![],
                };
                // A collective court is a real open court, not a light well.
                let least = if insula {
                    m.number_or("courtyardMin", 9.0).max(16.0)
                } else {
                    m.number_or("courtyardMin", 9.0).min(9.0)
                };
                [k, k * 0.75, k * 0.55, 1.0].into_iter().find_map(|k| {
                    let (w, h) = (cw * k, ch * k);
                    if w < 3.0 || h < 3.0 || w * h < least {
                        return None;
                    }
                    let (x0, y0) = ((cs0 + cs1 - w) * 0.5, (ct0 + ct1 - h) * 0.5);
                    // The court grown by the wing width must stay inside the mass.
                    let grown = add(
                        scale(main.u, x0 - court_wing),
                        scale(main.n, y0 - court_wing),
                    );
                    super::families::rect_within(
                        &outer_shape,
                        grown,
                        main.u,
                        main.n,
                        w + 2.0 * court_wing,
                        h + 2.0 * court_wing,
                    )
                    .then(|| lay.rect([x0, x0 + w, y0, y0 + h]))
                })
            });
            match (outer, court) {
                (Some(outer), Some(court)) => {
                    // An insula court on a lot that holds no native court
                    // recipe is the light court (cortile) of a row building,
                    // as the dense rows' back courts: the programme asks a
                    // row, never a court house the lot cannot hold.
                    form = if insula && !o.court_lot {
                        Kind::Row
                    } else {
                        Kind::Court
                    };
                    // Court types vary within a block: besides the closed
                    // ring, a house opens its court to the rear garden (U:
                    // street range and two side wings) or to one side as
                    // well (L: street range and one wing). The wings keep
                    // the ring's width; the opening runs to the mass's edge,
                    // so no sliver is left behind it.
                    let variant = rng.float();
                    let open_share = m.number_or("openCourtChance", 0.35);
                    if form == Kind::Court
                        && !collective
                        && !insula
                        && variant < open_share
                        && convex(&court)
                    {
                        // The opening is the court swept to the rear (U) and
                        // to one side as well (L), between the court's own
                        // walls: the wings left keep the court's orientation.
                        let mut c = court.clone();
                        if ring_area(&c) < 0.0 {
                            c.reverse();
                        }
                        let k = c.len();
                        // Outward (right) normal of each CCW court wall.
                        let outward: Vec<Point> = (0..k)
                            .map(|i| scale(normal(unit(sub(c[(i + 1) % k], c[i]))), -1.0))
                            .collect();
                        let pick = |d: Point| {
                            (0..k)
                                .max_by(|&i, &j| dot(outward[i], d).total_cmp(&dot(outward[j], d)))
                                .unwrap_or(0)
                        };
                        let rear_wall = pick(main.n);
                        let side_wall = if variant < open_share * 0.6 {
                            None
                        } else if rng.chance(0.5) {
                            Some(pick(main.u))
                        } else {
                            Some(pick(scale(main.u, -1.0)))
                        };
                        let planes: Vec<Plane> = (0..k)
                            .filter(|&i| i != rear_wall && Some(i) != side_wall)
                            .map(|i| (outward[i], dot(outward[i], c[i])))
                            .collect();
                        let lot = Shape {
                            outer: outer.clone(),
                            holes: vec![],
                        };
                        let mut opened = vec![lot];
                        for cut in clip_parts(&outer, &planes) {
                            let cut = Shape {
                                outer: cut,
                                holes: vec![],
                            };
                            opened = opened.iter().flat_map(|s| difference(s, &cut)).collect();
                        }
                        if !opened.is_empty() && opened.iter().all(|s| s.holes.is_empty()) {
                            for s in opened {
                                lay.pieces.push((s.outer, None, "building"));
                            }
                        } else {
                            lay.pieces.push((outer, Some(court), "building"));
                        }
                    } else {
                        lay.pieces.push((outer, Some(court), "building"))
                    }
                }
                // Documented fallback: the street body (an insula's deep
                // block-front range), never a court thinner than its wings.
                _ => {
                    form = Kind::Row;
                    let deep = if insula {
                        (zoned(m, "buildDepth", zone, [8.0, 12.0])[1] * (1.0 + 0.2 * pressure))
                            .max(depth)
                    } else {
                        depth
                    };
                    row(&mut lay, &mut rng, deep, false)
                }
            }
        }
        Kind::Hall => {
            // Free-standing monument in its precinct: forecourt (parvis) in
            // front, a nave-like hall along the plot depth.
            let margin = (0.08 * width).clamp(1.5, 8.0);
            // A keep or tower is a square block, a temple or church a nave.
            let keep = o.role.starts_with("defence");
            let hall_w = if keep {
                (0.4 * width.min(plot_depth)).clamp(8.0, 22.0)
            } else {
                (0.5 * width).clamp(8.0, 30.0)
            }
            .min(width - 2.0 * margin);
            let start = ta + (0.15 * plot_depth).clamp(2.0, 20.0);
            let len = if keep {
                hall_w
            } else {
                (0.7 * plot_depth).clamp(10.0, 70.0)
            }
            .min(t1 - start - margin);
            let mid = (s0 + s1) * 0.5;
            lay.put(
                mid - hall_w * 0.5,
                mid + hall_w * 0.5,
                start,
                start + len,
                mid,
            );
        }
        Kind::Pavilions => {
            if width < 12.0 || plot_depth < 16.0 {
                form = Kind::Row;
                row(&mut lay, &mut rng, depth, false);
            } else {
                // Siheyuan: a compound of bounded size at the street (larger
                // lots keep gardens), with a gate row, then one to three
                // courtyards in depth, each closed by a hall and two side halls.
                let cw = width.min(rng.range(18.0, 30.0) * (0.85 + 0.3 * o.wealth));
                let x0 = s0 + (width - cw) * rng.range(0.0, 1.0);
                let (x1, x2) = (x0, x0 + cw);
                let front = rng.range(4.0, 5.5);
                lay.put(x1 + 0.5, x2 - 0.5, tf, tf + front, (x1 + x2) * 0.5);
                let mut at = tf + front;
                let courts = 1 + usize::from(o.wealth > 0.5) + usize::from(o.wealth > 0.8);
                for _ in 0..courts {
                    let yard = rng.range(8.0, 14.0);
                    let hall = rng.range(6.0, 8.0);
                    if at + yard + hall > t1 - 0.5 {
                        break;
                    }
                    let side = rng.range(3.5, 5.0);
                    let (lo, hi) = (at + 1.5, at + yard - 1.5);
                    if hi - lo >= 4.0 && cw >= 2.0 * side + 5.0 {
                        lay.put(x1 + 0.5, x1 + 0.5 + side, lo, hi, x1 + 0.5 + side * 0.5);
                        lay.put(x2 - 0.5 - side, x2 - 0.5, lo, hi, x2 - 0.5 - side * 0.5);
                    }
                    lay.put(
                        x1 + 1.5,
                        x2 - 1.5,
                        at + yard,
                        at + yard + hall,
                        (x1 + x2) * 0.5,
                    );
                    at += yard + hall;
                }
            }
        }
        Kind::Hanok => {
            // Main house (anchae) across the back of the yard, one wing (an L),
            // and on wide lots a guest house (sarangchae) near the gate.
            let d = rng.range(5.0, 7.0).min(plot_depth * 0.4);
            let back = rng.range(0.5, 2.0);
            let main_t = t1 - back - d;
            lay.put(s0 + 1.5, s1 - 1.5, main_t, t1 - back, (s0 + s1) * 0.5);
            let yard = rng.range(3.0, 6.0);
            let w = rng.range(4.0, 5.5);
            let left = rng.chance(0.5);
            let (lo, hi) = if left {
                (s0 + 1.5, s0 + 1.5 + w)
            } else {
                (s1 - 1.5 - w, s1 - 1.5)
            };
            if main_t - (ta + yard) >= 4.0 {
                lay.put(lo, hi, ta + yard, main_t, (lo + hi) * 0.5);
            }
            if width > 18.0 && main_t - ta > 12.0 {
                let (lo, hi) = if left {
                    (s1 - 1.5 - 8.0, s1 - 1.5)
                } else {
                    (s0 + 1.5, s0 + 9.5)
                };
                lay.put(lo, hi, tf + 1.0, tf + 6.0, (lo + hi) * 0.5);
            }
        }
        Kind::Yashiki => {
            // Residence standing in its garden, with a storehouse (kura).
            let hw = width * rng.range(0.45, 0.65);
            let hd = (plot_depth * rng.range(0.3, 0.45)).max(8.0).min(plot_depth);
            let start = ta + (0.2 * plot_depth).min(plot_depth - hd).max(0.0);
            let mid = s0 + (width - hw) * rng.range(0.3, 0.7);
            lay.put(mid, mid + hw, start, start + hd, mid + hw * 0.5);
            if plot_depth - (start - ta + hd) > 8.0 {
                let x = if rng.chance(0.5) { s0 + 1.0 } else { s1 - 5.0 };
                lay.put(x, x + 4.0, t1 - 7.0, t1 - 1.0, x + 2.0);
            }
        }
    }
    let pieces = std::mem::take(&mut lay.pieces);
    let built = finish(&shape, ruined(o, pieces, &mut rng), wing);
    if !built.is_empty() || matches!(kind, Kind::Round) {
        return (built, form);
    }
    // Invariant (« un lot attribué porte un bâtiment »): where no square body,
    // legible range or court fits, an odd-shaped lot still builds its
    // polygonal body: its street strip (the whole lot without a street) opened
    // by the body width, so a lot that holds a body never stays empty.
    let to = (ta - main.t0) + depth.max(wing);
    let parts: Vec<Piece> = polygonal(&b, street_runs.first().map(Vec::as_slice), main.n, to, wing)
        .into_iter()
        .map(|r| (r, None, "building"))
        .collect();
    let form = match form {
        Kind::Court | Kind::Insula | Kind::Pavilions | Kind::Hanok | Kind::Yashiki => Kind::Row,
        f => f,
    };
    (finish(&shape, ruined(o, parts, &mut rng), wing), form)
}

/// A ruin keeps broken stretches of its walls and no roofed body: every
/// significant wall of every piece becomes a 0.6 m strip along 40-100 % of its
/// length, some walls fallen entirely. Abandoned buildings stay whole (their
/// role suffix flags them).
fn ruined(o: &Occupancy, pieces: Vec<Piece>, rng: &mut Rng) -> Vec<Piece> {
    if !o.role.ends_with(".ruin") {
        return pieces;
    }
    let mut out = vec![];
    for (outer, hole, _) in pieces {
        for mut r in std::iter::once(outer).chain(hole) {
            if ring_area(&r) < 0.0 {
                r.reverse();
            }
            let n = r.len();
            for i in 0..n {
                let (a, b) = (r[i], r[(i + 1) % n]);
                let len = length(sub(b, a));
                if len < 2.0 || rng.chance(0.3) {
                    continue;
                }
                let d = unit(sub(b, a));
                let inward = normal(d);
                let keep = rng.range(0.4, 1.0) * len;
                let start = rng.range(0.0, len - keep);
                let p = add(a, scale(d, start));
                let q = add(a, scale(d, start + keep));
                let k = 0.6_f64.min(len * 0.25);
                out.push((
                    vec![p, q, add(q, scale(inward, k)), add(p, scale(inward, k))],
                    None,
                    "ruin",
                ));
            }
        }
    }
    out
}

/// Clean pieces: keep valid simple rings only, orient them, drop any piece
/// thinner than its structural minimum (bodies and wings `wing`, landmark
/// parts 1.5 m, ruin walls 0.3 m), and keep the parcel's reserved holes
/// unbuilt, keeping every valid component of what remains.
fn finish(shape: &Shape, pieces: Vec<Piece>, wing: f64) -> Vec<(Shape, &'static str)> {
    let minimum = |label: &str| match label {
        "building" | "range" => wing - 1e-6,
        "ruin" => 0.3,
        _ => 1.5,
    };
    // No needle: a built piece keeps every interior angle at 20 degrees or
    // more (walls, wheels and ruins are thin by nature).
    let blunt = |r: &[Point], label: &str| {
        matches!(label, "ruin" | "wall" | "wheel")
            || (0..r.len()).all(|i| {
                let n = r.len();
                let (a, v, b) = (r[(i + n - 1) % n], r[i], r[(i + 1) % n]);
                let (u, w) = (sub(a, v), sub(b, v));
                let (lu, lw) = (length(u), length(w));
                lu < 1.0
                    || lw < 1.0
                    || (u.x * w.x + u.y * w.y) / (lu * lw) <= 20.0_f64.to_radians().cos()
            })
    };
    let valid = |s: &Shape, label: &str| {
        s.outer.len() >= 3
            && area(s) >= if label == "ruin" { 0.5 } else { 4.0 }
            && blunt(&s.outer, label)
            && simple(&s.outer)
            && s.holes.iter().all(|h| h.len() >= 3 && simple(h))
            && thickness(&s.outer, s.holes.first().map(|h| h.as_slice())) >= minimum(label)
    };
    // Reserved holes are real areas: cadastral merges leave zero-area rings
    // (collinear triples, seams) that reserve nothing, yet their difference
    // breaks every piece of the lot into invalid rings.
    let reserved: Vec<Shape> = shape
        .holes
        .iter()
        .filter(|h| h.len() >= 3 && ring_area(h).abs() >= 0.5)
        .map(|h| Shape {
            outer: h.clone(),
            holes: vec![],
        })
        .collect();
    let mut out = vec![];
    for (outer, hole, label) in pieces {
        let mut outer = dedup(outer);
        if outer.len() < 3 {
            continue;
        }
        if ring_area(&outer) < 0.0 {
            outer.reverse();
        }
        // Courts are clockwise holes whatever the frame handedness.
        let hole = hole.map(dedup).filter(|h| h.len() >= 3).map(|mut h| {
            if ring_area(&h) > 0.0 {
                h.reverse();
            }
            h
        });
        let piece = Shape {
            outer,
            holes: hole.into_iter().collect(),
        };
        if reserved.is_empty() {
            if valid(&piece, label) {
                out.push((piece, label));
            }
        } else {
            // Rare: reserved holes inside the parcel stay unbuilt.
            let mut rest = vec![piece];
            for h in &reserved {
                rest = rest.iter().flat_map(|s| difference(s, h)).collect();
            }
            out.extend(
                rest.into_iter()
                    .map(|s| super::super::geometry::normalized(s))
                    .filter(|s| s.holes.len() <= 1 && valid(s, label))
                    .map(|s| (s, label)),
            );
        }
    }
    out
}

fn dedup(ring: Vec<Point>) -> Vec<Point> {
    let mut out: Vec<Point> = Vec::with_capacity(ring.len());
    for p in ring {
        if out.last().is_none_or(|q| length(sub(p, *q)) > 5e-3) {
            out.push(p);
        }
    }
    while out.len() > 1 && length(sub(out[0], *out.last().unwrap())) <= 5e-3 {
        out.pop();
    }
    // Drop exactly collinear vertices and doubled-back ones: a spike whose
    // two sides retrace each other within 2 degrees has no width (clipping
    // leaves them with millimetre offsets, beyond an exact test). Vertices
    // within 5 mm, including neighbours left by a removed spike, collapse.
    let mut changed = true;
    while changed && out.len() >= 3 {
        changed = false;
        let n = out.len();
        for i in 0..n {
            let (a, b, c) = (out[(i + n - 1) % n], out[i], out[(i + 1) % n]);
            let (u, v) = (sub(b, a), sub(c, b));
            let (lu, lv) = (length(u).max(1e-9), length(v).max(1e-9));
            let cross = (u.x * v.y - u.y * v.x).abs();
            let back = u.x * v.x + u.y * v.y < 0.0 && cross <= 2.0_f64.to_radians().sin() * lu * lv;
            if cross <= 1e-9 * lu * lv || back || length(sub(c, a)) <= 5e-3 {
                out.remove(i);
                if out.len() >= 2 && i < out.len() {
                    let j = if i == 0 { out.len() - 1 } else { i - 1 };
                    if length(sub(out[i % out.len()], out[j])) <= 5e-3 {
                        out.remove(i % out.len());
                    }
                }
                changed = true;
                break;
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::super::super::geometry::rectangle;
    use super::*;
    use serde_json::json;

    fn lot(shape: Shape, front: [Point; 2], pressure: f64) -> Parcel {
        Parcel {
            pressure,
            envelope: None,
            id: "lot".into(),
            parent_ids: vec![],
            provenance: vec![],
            family: "frontage".into(),
            reason: String::new(),
            contacts: vec![super::super::super::ParcelContact {
                a: front[0],
                b: front[1],
                street: 0,
                rank: 1,
                length: length(sub(front[1], front[0])),
                kind: "public".into(),
            }],
            shape,
            block: 0,
            axis: Point { x: 1.0, y: 0.0 },
            use_kind: "plot".into(),
            front: Some(front),
            rank: 1,
            access: None,
        }
    }
    /// Probe: `S7_DUMP=<dir with layout.json, partition.json>` counts why the
    /// street range of core plots is refused (12 m deep, 3 m wing).
    #[test]
    #[ignore]
    fn probe_front_ranges() {
        let Ok(dir) = std::env::var("S7_DUMP") else {
            return;
        };
        let read = |f: &str| std::fs::read_to_string(format!("{dir}/{f}")).unwrap();
        let layout: Layout = serde_json::from_str(&read("layout.json")).unwrap();
        let partition: super::super::super::Partition =
            serde_json::from_str(&read("partition.json")).unwrap();
        let mut why: std::collections::BTreeMap<&str, usize> = Default::default();
        for p in &partition.parcels {
            if p.use_kind != "plot" || layout.blocks[p.block].zone != "core" {
                continue;
            }
            let shape = super::super::super::geometry::normalized(p.shape.clone());
            let fronts: Vec<Front> = parcel_fronts(p)
                .into_iter()
                .filter(|f| length(sub(f.b, f.a)) > 0.3)
                .collect();
            let Some(run) = runs(&fronts)
                .into_iter()
                .find(|r| length(sub(r.last().unwrap().b, r[0].a)) >= 2.0)
            else {
                *why.entry("no-run").or_default() += 1;
                continue;
            };
            let f = frame_of(&run, &shape);
            let key = match front_range_why(&shape.outer, &run, f.n, 12.0, 3.0, true) {
                Ok(_) => "ok",
                Err(e) => e,
            };
            if key == "thin" && why.get("thin").copied().unwrap_or(0) < 12 {
                let r =
                    front_range_why(&shape.outer, &run, f.n, 12.0, 0.0, true).unwrap_or_default();
                eprintln!(
                    "thin {:.2} lot {:.2} area {:.0} run {:.1} n {} {:?}",
                    thickness(&r, None),
                    thickness(&shape.outer, None),
                    area(&shape),
                    run.iter().map(|f| length(sub(f.b, f.a))).sum::<f64>(),
                    r.len(),
                    r.iter()
                        .map(|q| (q.x.round(), q.y.round()))
                        .collect::<Vec<_>>()
                );
            }
            *why.entry(key).or_default() += 1;
        }
        eprintln!("{why:?}");
    }
    /// Probe: `OCC_DUMP=<dir with layout.json, partition.json>` previews every
    /// allocated core plot (party walls from `OCC_PARTY`, default on) and
    /// prints the ids (suffix filter `OCC_LOTS`, comma separated) left empty.
    #[test]
    #[ignore]
    fn probe_previews() {
        let Ok(dir) = std::env::var("OCC_DUMP") else {
            return;
        };
        let read = |f: &str| std::fs::read_to_string(format!("{dir}/{f}")).unwrap();
        let layout: Layout = serde_json::from_str(&read("layout.json")).unwrap();
        let partition: super::super::super::Partition =
            serde_json::from_str(&read("partition.json")).unwrap();
        let only: Vec<String> = std::env::var("OCC_LOTS")
            .map(|s| s.split(',').map(str::to_owned).collect())
            .unwrap_or_default();
        let party = std::env::var("OCC_PARTY").map_or(true, |v| v != "0");
        let programme = partition.programme.as_ref().unwrap();
        let (mut n, mut empty) = (0, 0);
        for a in &programme.allocations {
            let Some(p) = partition.parcels.iter().find(|p| p.id == a.parcel_id) else {
                continue;
            };
            if (only.is_empty() && layout.blocks[p.block].zone != "core")
                || (!only.is_empty() && !only.iter().any(|s| p.id.ends_with(s.as_str())))
            {
                continue;
            }
            let Some((zone, morph)) = super::super::super::culture::parcel_morph(
                &layout, &partition, &a.culture, p.block,
            ) else {
                continue;
            };
            let o = Occupancy {
                morph: &morph,
                zone,
                function: &a.function,
                role: &a.role,
                landmark: a.landmark,
                party_walls: party,
                wealth: 0.5,
                seed: &p.id,
                pack: &a.architecture_pack,
                court_lot: false,
                court_kept: Some(true),
            };
            if kind(&o) == Kind::Open {
                continue;
            }
            n += 1;
            let (parts, form) = preview_form(p, &o);
            if parts.is_empty() {
                empty += 1;
                eprintln!("empty {} {} {:?}", p.id, a.role, form);
            } else if !only.is_empty() {
                for (s, l) in &parts {
                    eprintln!(
                        "{l} {:.0} m² thick {:.2} {:?}",
                        area(s),
                        thickness(&s.outer, s.holes.first().map(|h| h.as_slice())),
                        s.outer
                            .iter()
                            .map(|q| (q.x.round(), q.y.round()))
                            .collect::<Vec<_>>()
                    );
                }
            }
        }
        eprintln!("core plots {n}, empty {empty}");
    }
    fn tissue(op: &str, typology: &str) -> Morph {
        Morph {
            value: json!({"buildingOp":op,"plotOp":"burgage","arch":{"typology":typology},
                "coverage":{"core":[0.9,0.96],"edge":[0.55,0.68]},"buildDepth":{"core":[10.0,14.0]},
                "setback":{"core":[0.0,0.3]},"sideGap":{"core":[0.0,0.0]},"roomDepth":[4.5,6.0],
                "bigCourtChance":0.1,"courtyardMin":9,"openCourtChance":0.0}),
        }
    }

    /// Exact A3 corner-lot witness: two individually near-axis street edges
    /// converge into a 13.77-degree tip. Their direction alone is insufficient.
    #[test]
    fn acute_street_band_uses_a_whole_body_instead_of_the_a3_needle() {
        let data: serde_json::Value =
            serde_json::from_str(include_str!("../../../tests/fixtures/a3-needle.json")).unwrap();
        let parcel: Parcel = serde_json::from_value(data["parcel"].clone()).unwrap();
        let old: Shape = serde_json::from_value(data["preview"].clone()).unwrap();
        let fronts: Vec<_> = parcel_fronts(&parcel)
            .into_iter()
            .filter(|f| length(sub(f.b, f.a)) > 0.3)
            .collect();
        let main = runs(&fronts)
            .into_iter()
            .find(|r| length(sub(r.last().unwrap().b, r[0].a)) >= 2.0)
            .unwrap();
        let f = frame_of(&main, &parcel.shape);
        assert!(
            !square_enough(&old.outer, &f, &fronts, 15.0),
            "A3 13.77-degree tip passed the rectangular-band gate"
        );
        let (s0, s1, t0, t1) = f.range(&old.outer);
        let mut lay = Lay {
            b: &old.outer,
            fronts: &fronts,
            f,
            wing: 3.0,
            pieces: vec![],
        };
        assert!(lay.band(t0, t1).is_none());
        assert!(
            lay.body(s0, s1, t0, t1, (s0 + s1) * 0.5) > 9.0,
            "Rejecting a needle must still try a nonempty whole body"
        );
        let result = finish(&parcel.shape, lay.pieces, 3.0);
        assert_eq!(result.len(), 1);
        let replacement = &result[0].0;
        assert_eq!(replacement.outer.len(), 4);
        assert!(thickness(&replacement.outer, None) >= 3.0 - 1e-6);
        assert!(
            difference(replacement, &parcel.shape)
                .iter()
                .map(area)
                .sum::<f64>()
                < 1e-5
        );
        for i in 0..4 {
            let a = unit(sub(replacement.outer[(i + 1) % 4], replacement.outer[i]));
            let b = unit(sub(
                replacement.outer[(i + 2) % 4],
                replacement.outer[(i + 1) % 4],
            ));
            assert!(dot(a, b).abs() < 1e-7, "Body corner is not square");
        }
    }

    /// Invariant (houses against the wall): a row lot backing onto the town
    /// wall (`curtain-backed`) builds its rear range on the curtain, its rear
    /// party wall: some building piece reaches the rear line, for every seed.
    #[test]
    fn curtain_backed_rows_build_against_the_wall() {
        let mut p = lot(
            rectangle(0.0, 0.0, 8.0, 34.0),
            [Point { x: 0.0, y: 0.0 }, Point { x: 8.0, y: 0.0 }],
            0.5,
        );
        p.provenance.push("curtain-backed".into());
        let mut morph = tissue("streetFrontRow", "gabled-row-house");
        morph.value["coverage"]["core"] = json!([0.4, 0.5]);
        for seed in ["a", "b", "c", "d", "e", "f"] {
            let fp = preview(
                &p,
                &Occupancy {
                    morph: &morph,
                    zone: "core",
                    function: "domestic",
                    role: "dwelling",
                    landmark: false,
                    party_walls: true,
                    wealth: 0.5,
                    seed,
                    pack: "EUR-MED",
                    court_lot: false,
                    court_kept: None,
                },
            );
            let rear = fp
                .iter()
                .flat_map(|s| s.outer.iter())
                .map(|q| q.y)
                .fold(f64::NEG_INFINITY, f64::max);
            assert!(
                rear > 34.0 - 1e-6,
                "seed {seed}: rear of the buildings at {rear}"
            );
        }
    }

    /// A dense European block of 6 m burgage lots: street walls share the
    /// cadastral party walls exactly and the block is mostly built; a courtyard
    /// culture on the same lots yields a real inner court (a hole).
    #[test]
    fn dense_rows_share_party_walls_and_courtyard_cultures_keep_a_court() {
        let lots: Vec<Parcel> = (0..8)
            .map(|i| {
                let x = i as f64 * 6.0;
                lot(
                    rectangle(x, 0.0, x + 6.0, 30.0),
                    [Point { x, y: 0.0 }, Point { x: x + 6.0, y: 0.0 }],
                    0.9,
                )
            })
            .collect();
        let morph = tissue("streetFrontRow", "gabled-row-house");
        let occupancy = |seed: &'static str| Occupancy {
            morph: &morph,
            zone: "core",
            function: "domestic",
            role: "dwelling",
            landmark: false,
            party_walls: true,
            wealth: 0.5,
            seed,
            pack: "MED-ANT",
            court_lot: false,
            court_kept: None,
        };
        let seeds = ["a", "b", "c", "d", "e", "f", "g", "h"];
        let mut built = 0.0;
        for (p, seed) in lots.iter().zip(seeds) {
            let fp = preview(p, &occupancy(seed));
            assert!(!fp.is_empty());
            // The street body spans the whole frontage: zero side gap.
            let (x0, x1) = fp[0]
                .outer
                .iter()
                .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), q| {
                    (a.min(q.x), b.max(q.x))
                });
            let (lx0, lx1) = (p.shape.outer[0].x, p.shape.outer[1].x);
            assert!(
                (x0 - lx0).abs() < 1e-6 && (x1 - lx1).abs() < 1e-6,
                "{x0} {x1}"
            );
            for s in &fp {
                assert!(s.outer.iter().all(|q| q.x >= lx0 - 1e-6
                    && q.x <= lx1 + 1e-6
                    && q.y >= -1e-6
                    && q.y <= 30.0 + 1e-6));
            }
            built += fp.iter().map(area).sum::<f64>();
        }
        let block = 48.0 * 30.0;
        assert!(built / block > 0.55, "coverage {}", built / block);

        let court_morph = tissue("courtyardHouse", "domus");
        let wide = lot(
            rectangle(0.0, 0.0, 32.0, 30.0),
            [Point { x: 0.0, y: 0.0 }, Point { x: 32.0, y: 0.0 }],
            0.7,
        );
        let fp = preview(
            &wide,
            &Occupancy {
                morph: &court_morph,
                ..occupancy("court")
            },
        );
        assert_eq!(fp.len(), 1);
        assert_eq!(fp[0].holes.len(), 1, "a courtyard house keeps its court");
        assert!(area(&fp[0]) < 32.0 * 30.0 - 9.0 && area(&fp[0]) > 0.3 * 32.0 * 30.0);
    }
    /// A parish church on its reserved lot is a nave, a choir and a west tower
    /// at the street, all inside the lot; a mosque gets a minaret and a hall.
    /// A3 audit witnesses: a body whose ring doubles back over itself (a
    /// zero-width spike left by clipping, 01-l row/tenement lots) loses the
    /// spike; a 13 degree inn range triangle is not a building piece.
    #[test]
    fn preview_pieces_have_no_spike_and_no_needle() {
        let pt = |x: f64, y: f64| Point { x, y };
        let lot = rectangle(0.0, 0.0, 40.0, 40.0);
        let spiked = vec![
            pt(0.0, 0.0),
            pt(10.0, 0.0),
            pt(10.0, 10.0),
            pt(5.0, 10.0),
            pt(2.0, 6.0),
            pt(5.0, 10.0004),
            pt(0.0, 10.0),
        ];
        let needle = vec![pt(20.0, 20.0), pt(32.0, 20.0), pt(20.0, 22.8)];
        let out = finish(
            &lot,
            vec![(spiked, None, "building"), (needle, None, "range")],
            3.0,
        );
        assert_eq!(out.len(), 1, "{out:?}");
        assert_eq!(out[0].0.outer.len(), 4, "{:?}", out[0].0.outer);
        assert!((area(&out[0].0) - 100.0).abs() < 0.1);
    }

    /// Invariant (« mitoyenneté continue »): on a bent street with party walls
    /// leaning 25 degrees (beyond the 15-degree square band), every attached
    /// row lot still builds its street range along its whole frontage, from
    /// party wall to party wall, so neighbours leave no gap on the street.
    #[test]
    fn attached_rows_keep_a_continuous_street_wall_on_bent_streets_and_leaning_walls() {
        let pt = |x: f64, y: f64| Point { x, y };
        // Street bending by 12 degrees at x = 8; party walls lean 25 degrees.
        let front = |x: f64| {
            if x <= 8.0 {
                pt(x, 0.0)
            } else {
                pt(x, (x - 8.0) * 0.21)
            }
        };
        let lean = 30.0 * 25f64.to_radians().tan();
        let morph = tissue("streetFrontRow", "gabled-row-house");
        for (i, (x0, x1)) in [(0.0, 8.0), (8.0, 15.0), (2.0, 13.0)]
            .into_iter()
            .enumerate()
        {
            let (a, b) = (front(x0), front(x1));
            let mut outer = vec![a];
            if x0 < 8.0 && x1 > 8.0 {
                outer.push(front(8.0));
            }
            outer.extend([b, pt(b.x - lean, b.y + 30.0), pt(a.x - lean, a.y + 30.0)]);
            let mut p = lot(
                Shape {
                    outer,
                    holes: vec![],
                },
                [a, b],
                0.9,
            );
            if x0 < 8.0 && x1 > 8.0 {
                let m = front(8.0);
                p.contacts[0].b = m;
                p.contacts[0].length = length(sub(m, a));
                let mut c = p.contacts[0].clone();
                (c.a, c.b, c.length) = (m, b, length(sub(b, m)));
                p.contacts.push(c);
            }
            for k in 0..6 {
                let seed = format!("wall-{i}-{k}");
                let o = Occupancy {
                    morph: &morph,
                    zone: "core",
                    function: "domestic",
                    role: "dwelling.row",
                    landmark: false,
                    party_walls: true,
                    wealth: 0.5,
                    seed: &seed,
                    pack: "EUR-MED",
                    court_lot: false,
                    court_kept: None,
                };
                let fp = preview(&p, &o);
                let body = fp.first().expect("street body");
                let on = |q: Point| {
                    super::super::super::geometry::contains(body, q)
                        || (0..body.outer.len()).any(|j| {
                            // Within the culture's street setback (core: 0 to 0.3 m).
                            distance(q, body.outer[j], body.outer[(j + 1) % body.outer.len()])
                                < 0.31
                        })
                };
                for c in &p.contacts {
                    for t in 0..=10 {
                        let q = add(c.a, scale(sub(c.b, c.a), t as f64 / 10.0));
                        assert!(on(q), "{seed}: street front at {q:?} not built");
                    }
                }
            }
        }
    }

    /// Invariant (preview = asked composition, A3 « 162 mansions »): a home's
    /// court is previewed only where the lot holds a native court source of
    /// its pack serving its houses role; elsewhere the preview is the row
    /// `building_sites` then asks (its feasible composition keeps simple
    /// wishes), with a row's closed back court where the wings fit.
    #[test]
    fn a_home_court_is_previewed_only_where_a_native_court_source_fits() {
        let morph = tissue("courtyardHouse", "domus");
        let pt = |x: f64, y: f64| Point { x, y };
        let small = lot(
            rectangle(0.0, 0.0, 22.0, 26.0),
            [pt(0.0, 0.0), pt(22.0, 0.0)],
            0.7,
        );
        let large = lot(
            rectangle(0.0, 0.0, 34.0, 32.0),
            [pt(0.0, 0.0), pt(34.0, 0.0)],
            0.7,
        );
        // MED-ANT's atrium house (a `dwelling` court source) needs 28.1 x 28.3 m.
        let kept = |l: &Parcel| {
            super::super::courts::court_kept(l, "MED-ANT", "dwelling.mansion", "domestic")
        };
        assert!(!kept(&small) && kept(&large));
        // EUR-MED's only court source is an ensemble: a house keeps no court.
        assert!(!super::super::courts::court_kept(
            &large,
            "EUR-MED",
            "dwelling.mansion",
            "domestic"
        ));
        let mut courts = 0;
        for k in 0..12 {
            let seed = format!("mansion-{k}");
            let o = Occupancy {
                morph: &morph,
                zone: "core",
                function: "domestic",
                role: "dwelling.mansion",
                landmark: false,
                party_walls: true,
                wealth: 0.8,
                seed: &seed,
                pack: "MED-ANT",
                court_lot: false,
                court_kept: None,
            };
            // The small lot is a row (at most with a row's back court).
            let (_, form) = preview_parts(&small, &o);
            assert_eq!(form, Some(Kind::Row), "{seed}");
            let (parts, form) = preview_parts(&large, &o);
            if form == Some(Kind::Court) {
                courts += 1;
                assert!(parts.iter().any(|(s, _)| !s.holes.is_empty()), "{seed}");
            }
        }
        assert!(courts >= 6, "large lots keep their court: {courts}/12");
    }

    /// Typology diversity: wide dense-core row lots also build closed back
    /// courts (street range, side wings, rear range) where every wing keeps
    /// the culture's width; narrow lots stay plain rows.
    #[test]
    fn wide_dense_row_lots_also_build_closed_back_courts() {
        let morph = tissue("streetFrontRow", "gabled-row-house");
        let seeds: Vec<String> = (0..24).map(|i| format!("hof-{i}")).collect();
        fn occupancy<'a>(morph: &'a Morph, seed: &'a str) -> Occupancy<'a> {
            Occupancy {
                morph,
                zone: "core",
                function: "domestic",
                role: "dwelling",
                landmark: false,
                party_walls: true,
                wealth: 0.5,
                seed,
                pack: "EUR-MED",
                court_lot: false,
                court_kept: None,
            }
        }
        let courts = |w: f64| {
            let p = lot(
                rectangle(0.0, 0.0, w, 42.0),
                [Point { x: 0.0, y: 0.0 }, Point { x: w, y: 0.0 }],
                0.9,
            );
            let mut n = 0;
            for seed in &seeds {
                for s in preview(&p, &occupancy(&morph, seed)) {
                    if let Some(h) = s.holes.first() {
                        n += 1;
                        assert!(thickness(&s.outer, Some(h)) >= 3.0 - 1e-6);
                        assert!(ring_area(h).abs() >= 12.0 - 1e-6);
                        assert!(s.outer.iter().all(|q| q.x >= -1e-6 && q.x <= w + 1e-6));
                    }
                }
            }
            n
        };
        let wide = courts(16.0);
        assert!(
            wide >= 4 && wide < seeds.len(),
            "{wide} courts on 16 m lots"
        );
        assert_eq!(
            courts(8.0),
            0,
            "an 8 m lot has no room for two wings and a court"
        );
        assert!(courts(10.0) > 0, "a 10 m lot keeps a 4 m light court");
    }

    #[test]
    fn landmark_previews_follow_their_programme() {
        let site = lot(
            rectangle(0.0, 0.0, 36.0, 60.0),
            [Point { x: 0.0, y: 0.0 }, Point { x: 36.0, y: 0.0 }],
            0.5,
        );
        let morph = tissue("streetFrontRow", "gabled-row-house");
        let o = |role: &'static str, pack: &'static str| Occupancy {
            morph: &morph,
            zone: "core",
            function: "collective",
            role,
            landmark: true,
            party_walls: true,
            wealth: 0.5,
            seed: "landmark",
            pack,
            court_lot: false,
            court_kept: None,
        };
        let church = preview_parts(&site, &o("worship.parish", "EUR-MED")).0;
        let labels: Vec<_> = church.iter().map(|p| p.1).collect();
        for part in ["tower", "nave", "choir", "apse"] {
            assert!(labels.contains(&part), "{labels:?}");
        }
        let tower = church.iter().find(|p| p.1 == "tower").unwrap();
        let nave = church.iter().find(|p| p.1 == "nave").unwrap();
        let y = |s: &Shape| s.outer.iter().map(|q| q.y).fold(f64::INFINITY, f64::min);
        assert!(
            y(&tower.0) < y(&nave.0),
            "the tower stands at the street front"
        );
        for (s, _) in &church {
            assert!(
                s.outer.iter().all(|q| q.x >= -1e-6
                    && q.x <= 36.0 + 1e-6
                    && q.y >= -1e-6
                    && q.y <= 60.0 + 1e-6)
            );
        }
        let mosque = preview_parts(&site, &o("worship.mosque.friday", "AF-MAG")).0;
        let labels: Vec<_> = mosque.iter().map(|p| p.1).collect();
        assert!(
            labels.contains(&"minaret") && labels.contains(&"prayer-hall"),
            "{labels:?}"
        );
    }

    /// A court never leaves a wing thinner than the culture's minimum, on a
    /// square lot, an oblique lot and Codex's thin-court lot of 01-l
    /// (`parcel-ba8e5a7e8a355e53`, a 0.0000002 m wing before); every piece is a
    /// valid simple polygon at least one wing thick.
    #[test]
    fn courts_keep_whole_wings_and_pieces_stay_valid() {
        let p = |x: f64, y: f64| Point { x, y };
        let codex = Shape {
            outer: vec![
                p(5.785, 38.490),
                p(5.785, 26.941),
                p(10.278, 26.516),
                p(13.278, 26.382),
                p(17.953, 26.368),
                p(32.825, 27.584),
                p(32.827, 27.555),
                p(32.955, 27.589),
                p(33.032, 27.569),
                p(33.033, 27.588),
                p(33.884, 27.546),
                p(41.444, 27.176),
                p(43.023, 27.137),
                p(43.022, 27.118),
                p(43.191, 27.073),
                p(43.198, 27.119),
                p(44.615, 26.984),
                p(47.297, 26.810),
                p(47.310, 26.813),
                p(47.330, 26.807),
                p(47.621, 26.789),
                p(49.207, 26.686),
                p(47.683, 30.631),
                p(35.847, 35.821),
                p(35.832, 38.650),
            ],
            holes: vec![],
        };
        let lots = [
            // Lots holding MED-ANT's native atrium house (28.1 x 28.3 m).
            lot(
                rectangle(0.0, 0.0, 32.0, 30.0),
                [p(0.0, 0.0), p(32.0, 0.0)],
                0.7,
            ),
            lot(
                Shape {
                    outer: vec![p(0.0, 0.0), p(34.0, 0.0), p(46.0, 30.0), p(4.0, 30.0)],
                    holes: vec![],
                },
                [p(0.0, 0.0), p(34.0, 0.0)],
                0.7,
            ),
            lot(codex, [p(5.785, 38.490), p(5.785, 26.941)], 0.3),
        ];
        // Closed and open (U, L) courts alike keep whole wings.
        let mut morph = tissue("courtyardHouse", "domus");
        morph.value["openCourtChance"] = json!(0.5);
        let ring_gap = |a: &[Point], b: &[Point]| {
            let mut d = f64::INFINITY;
            for (x, y) in [(a, b), (b, a)] {
                for q in x {
                    for i in 0..y.len() {
                        d = d.min(distance(*q, y[i], y[(i + 1) % y.len()]));
                    }
                }
            }
            d
        };
        let mut courts = 0;
        for (li, l) in lots.iter().enumerate() {
            for role in ["dwelling", "dwelling.mansion"] {
                for k in 0..24 {
                    let seed = format!("court-{li}-{role}-{k}");
                    let o = Occupancy {
                        morph: &morph,
                        zone: "core",
                        function: "domestic",
                        role,
                        landmark: false,
                        party_walls: true,
                        wealth: 0.9,
                        seed: &seed,
                        pack: "MED-ANT",
                        court_lot: false,
                        court_kept: None,
                    };
                    for (s, label) in preview_parts(l, &o).0 {
                        assert!(
                            simple(&s.outer) && s.holes.iter().all(|h| h.len() >= 3 && simple(h)),
                            "{seed}: invalid piece"
                        );
                        assert!(
                            thickness(&s.outer, s.holes.first().map(|h| h.as_slice()))
                                >= 3.0 - 1e-6,
                            "{seed}: {label} thinner than a wing"
                        );
                        for h in &s.holes {
                            courts += 1;
                            assert!(
                                ring_gap(&s.outer, h) >= 3.5 - 1e-6,
                                "{seed}: court wing {:.3}",
                                ring_gap(&s.outer, h)
                            );
                        }
                    }
                }
            }
        }
        assert!(courts > 10, "courts are still composed: {courts}");
    }

    /// A farm is a house and a barn around a yard; a ruin keeps only broken
    /// wall stretches (no roofed body); an abandoned house keeps its masses.
    #[test]
    fn farms_have_a_barn_and_ruins_only_walls() {
        let p = |x: f64, y: f64| Point { x, y };
        let morph = tissue("streetFrontRow", "gabled-row-house");
        for (k, shape) in [
            rectangle(0.0, 0.0, 30.0, 40.0),
            rectangle(0.0, 0.0, 34.0, 16.0),
        ]
        .into_iter()
        .enumerate()
        {
            let w = shape.outer[1].x;
            let site = lot(shape, [p(0.0, 0.0), p(w, 0.0)], 0.3);
            let o = |role: &'static str, seed: &'static str| Occupancy {
                morph: &morph,
                zone: "edge",
                function: "domestic",
                role,
                landmark: false,
                party_walls: false,
                wealth: 0.5,
                seed,
                pack: "EUR-MED",
                court_lot: false,
                court_kept: None,
            };
            for seed in ["a", "b", "c", "d"] {
                let farm = preview_parts(&site, &o("dwelling.farm", seed)).0;
                assert!(
                    farm.len() >= 2,
                    "lot {k} seed {seed}: house and barn, got {}",
                    farm.len()
                );
                let ruin = preview_parts(&site, &o("dwelling.farm.ruin", seed)).0;
                assert!(
                    !ruin.is_empty()
                        && ruin
                            .iter()
                            .all(|(s, l)| *l == "ruin" && thickness(&s.outer, None) <= 0.61)
                );
                let built: f64 = farm.iter().map(|(s, _)| area(s)).sum();
                let walls: f64 = ruin.iter().map(|(s, _)| area(s)).sum();
                assert!(walls < 0.5 * built, "a ruin is walls, not roofed masses");
                let empty = preview_parts(&site, &o("dwelling.farm.abandoned", seed)).0;
                assert_eq!(empty.len(), farm.len());
            }
        }
    }

    fn home<'a>(morph: &'a Morph, role: &'a str, seed: &'a str) -> Occupancy<'a> {
        Occupancy {
            morph,
            zone: "core",
            function: "domestic",
            role,
            landmark: false,
            party_walls: true,
            wealth: 0.5,
            seed,
            pack: "EUR-MED",
            court_lot: false,
            court_kept: None,
        }
    }
    fn poly(pts: &[(f64, f64)]) -> Shape {
        Shape {
            outer: pts.iter().map(|&(x, y)| Point { x, y }).collect(),
            holes: vec![],
        }
    }
    fn parallel(a: Point, b: Point, c: Point, d: Point, degrees: f64) -> bool {
        let (e, f) = (unit(sub(b, a)), unit(sub(d, c)));
        (e.x * f.y - e.y * f.x).abs() <= degrees.to_radians().sin()
    }

    /// Invariant (review P01 107-109, P03 11): on lots whose party walls lean
    /// off the street normal, every piece behind the street range (wing, back
    /// house, back building) stands against one of its own lot's side walls,
    /// along it: an edge lies on that wall and runs parallel to it, so the
    /// wings of neighbours meet on their shared wall at the lot's angle.
    #[test]
    fn rear_pieces_stand_along_their_own_party_wall_on_leaning_lots() {
        let lean = 18f64.to_radians().tan();
        let shape = poly(&[
            (0.0, 0.0),
            (7.0, 0.0),
            (7.0 - 36.0 * lean, 36.0),
            (-36.0 * lean, 36.0),
        ]);
        let sides = [
            (shape.outer[1], shape.outer[2]),
            (shape.outer[3], shape.outer[0]),
        ];
        let p = lot(
            shape,
            [Point { x: 0.0, y: 0.0 }, Point { x: 7.0, y: 0.0 }],
            0.8,
        );
        let morph = tissue("streetFrontRow", "gabled-row-house");
        let mut rear = 0;
        for k in 0..12 {
            let seed = format!("lean/parcel-{k}");
            let fp = preview(&p, &home(&morph, "dwelling.row", &seed));
            assert!(!fp.is_empty(), "{seed}: nothing built");
            for s in fp.iter().filter(|s| s.outer.iter().all(|q| q.y > 0.5)) {
                rear += 1;
                let r = &s.outer;
                let against = (0..r.len()).any(|i| {
                    let (a, b) = (r[i], r[(i + 1) % r.len()]);
                    length(sub(b, a)) >= 2.0
                        && sides.iter().any(|&(c, d)| {
                            distance(a, c, d) < 0.05
                                && distance(b, c, d) < 0.05
                                && parallel(a, b, c, d, 0.5)
                        })
                });
                assert!(against, "{seed}: rear piece {r:?} off its party walls");
            }
        }
        assert!(
            rear >= 6,
            "too few rear pieces ({rear}) to test the invariant"
        );
    }

    /// Invariant (review P11 6-9, P12 12-15): a court has its house's
    /// orientation: every wall of the court runs parallel to a wall of the
    /// mass around it (the mass inset), on a lot within 15 degrees of square
    /// (insula on the lot itself) and on an oblique row lot (back court).
    #[test]
    fn courts_are_parallel_to_their_house() {
        let insula = lot(
            poly(&[(0.0, 0.0), (20.0, 0.0), (22.0, 28.0), (-4.0, 28.0)]),
            [Point { x: 0.0, y: 0.0 }, Point { x: 20.0, y: 0.0 }],
            0.8,
        );
        let lean = 20f64.to_radians().tan();
        let oblique = lot(
            poly(&[
                (0.0, 0.0),
                (16.0, 0.0),
                (16.0 + 34.0 * lean, 34.0),
                (34.0 * lean, 34.0),
            ]),
            [Point { x: 0.0, y: 0.0 }, Point { x: 16.0, y: 0.0 }],
            0.9,
        );
        let domus = tissue("courtyardHouse", "domus");
        let rows = tissue("streetFrontRow", "gabled-row-house");
        let mut courts = 0;
        for k in 0..16 {
            let seed = format!("court/parcel-{k}");
            for fp in [
                preview(&insula, &home(&domus, "dwelling.tenement", &seed)),
                preview(&oblique, &home(&rows, "dwelling.row", &seed)),
            ] {
                for s in &fp {
                    let o = &s.outer;
                    for h in &s.holes {
                        courts += 1;
                        for i in 0..h.len() {
                            let (a, b) = (h[i], h[(i + 1) % h.len()]);
                            if length(sub(b, a)) < 1.0 {
                                continue;
                            }
                            assert!(
                                (0..o.len()).any(|j| parallel(
                                    a,
                                    b,
                                    o[j],
                                    o[(j + 1) % o.len()],
                                    0.5
                                )),
                                "{seed}: court wall {a:?}-{b:?} parallel to no house wall"
                            );
                        }
                    }
                }
            }
        }
        assert!(
            courts >= 8,
            "too few courts ({courts}) to test the invariant"
        );
    }

    /// Invariant (review P13, « même dégénérées »): an allocated lot that holds
    /// a body builds one. Real 01-l core lots left empty before (odd shapes,
    /// zero-area cadastral holes, a concave lot cut by its frame planes) each
    /// get a footprint inside the lot, every piece at least a wing thick and
    /// without a needle corner.
    #[test]
    fn allocated_irregular_lots_get_a_practicable_footprint() {
        let data: serde_json::Value =
            serde_json::from_str(include_str!("fixtures/irregular-lots-01l.json")).unwrap();
        let parcels: Vec<Parcel> = serde_json::from_value(data["parcels"].clone()).unwrap();
        let morph = tissue("streetFrontRow", "gabled-row-house");
        assert_eq!(parcels.len(), 7);
        for p in &parcels {
            for role in ["dwelling.row", "dwelling.shop"] {
                let fp = preview(p, &home(&morph, role, &p.id));
                assert!(!fp.is_empty(), "{}: allocated lot left empty", p.id);
                let lot = super::super::super::geometry::normalized(Shape {
                    outer: p.shape.outer.clone(),
                    holes: vec![],
                });
                for s in &fp {
                    assert!(
                        thickness(&s.outer, s.holes.first().map(|h| h.as_slice())) >= 3.0 - 1e-6
                    );
                    assert!(difference(s, &lot).iter().map(area).sum::<f64>() < 1e-2);
                }
            }
        }
    }

    /// Invariant (review P08, « jamais identiques »): same-size neighbour lots
    /// of a regular row get different footprints, drawn from each lot's seed
    /// within the culture's rooms, while their street ranges keep one depth.
    #[test]
    fn same_size_neighbour_lots_get_different_footprints() {
        let morph = tissue("giebelhaus", "giebelhaus");
        let mut patterns = vec![];
        let mut fronts = vec![];
        for k in 0..8 {
            let x = 6.0 * k as f64;
            let p = lot(
                rectangle(x, 0.0, x + 6.0, 38.0),
                [Point { x, y: 0.0 }, Point { x: x + 6.0, y: 0.0 }],
                0.8,
            );
            let seed = format!("hanse-block/parcel-{k}");
            let fp = preview(&p, &home(&morph, "dwelling.row", &seed));
            // Structure of the footprint: each piece's share of the lot width
            // (quarters) and its extent in depth (3 m steps).
            let mut sig: Vec<(i64, i64)> = fp
                .iter()
                .map(|s| {
                    let (x0, x1) = s
                        .outer
                        .iter()
                        .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), q| {
                            (a.min(q.x), b.max(q.x))
                        });
                    let (y0, y1) = s
                        .outer
                        .iter()
                        .fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), q| {
                            (a.min(q.y), b.max(q.y))
                        });
                    (
                        ((x1 - x0) / 6.0 * 4.0).round() as i64,
                        ((y1 - y0) / 3.0).round() as i64,
                    )
                })
                .collect();
            sig.sort();
            fronts.push(
                fp.iter()
                    .filter(|s| s.outer.iter().any(|q| q.y < 0.5))
                    .flat_map(|s| s.outer.iter().map(|q| q.y))
                    .fold(0.0, f64::max),
            );
            patterns.push((fp.len(), sig));
        }
        let mut distinct = patterns.clone();
        distinct.sort();
        distinct.dedup();
        assert!(distinct.len() >= 6, "repeated footprints: {patterns:?}");
        assert!(
            patterns.windows(2).all(|w| w[0] != w[1]),
            "identical neighbours: {patterns:?}"
        );
        let (lo, hi) = fronts
            .iter()
            .fold((f64::INFINITY, 0.0f64), |(a, b), &y| (a.min(y), b.max(y)));
        assert!(hi - lo < 2.0, "street ranges zigzag: {fronts:?}");
    }

    /// Invariant (review P04 5-6, « coupé pour rien »): a monument stands whole
    /// in its precinct, the largest rectangle of its lot facing a street: on a
    /// wedge lot every part of a bathhouse is a whole rectangle, none cut by
    /// the lot's oblique side.
    #[test]
    fn landmark_parts_stay_whole_in_their_precinct() {
        let wedge = lot(
            poly(&[(0.0, 0.0), (30.0, 0.0), (40.0, 16.0), (-2.0, 27.25)]),
            [Point { x: 0.0, y: 0.0 }, Point { x: 30.0, y: 0.0 }],
            0.6,
        );
        let morph = tissue("streetFrontRow", "gabled-row-house");
        for seed in ["bath-a", "bath-b", "bath-c"] {
            let mut o = home(&morph, "civic.bathhouse", seed);
            o.function = "collective";
            o.landmark = true;
            let fp = preview(&wedge, &o);
            assert!(!fp.is_empty(), "{seed}: no bathhouse");
            for s in &fp {
                let r = &s.outer;
                assert_eq!(r.len(), 4, "{seed}: part cut by the lot {r:?}");
                for i in 0..4 {
                    let (a, b, c) = (r[i], r[(i + 1) % 4], r[(i + 2) % 4]);
                    assert!(
                        dot(unit(sub(b, a)), unit(sub(c, b))).abs() < 1e-6,
                        "{seed}: {r:?}"
                    );
                }
            }
        }
    }

    /// Invariant (review P08 73-74, « losanges »): party walls leaning more than
    /// 25 degrees do not make a diamond house: the street body is built square
    /// to its street where a straight one fits.
    #[test]
    fn steeply_leaning_party_walls_build_a_straight_street_body() {
        let lean = 36f64.to_radians().tan();
        let p = lot(
            poly(&[
                (0.0, 0.0),
                (18.0, 0.0),
                (18.0 + 30.0 * lean, 30.0),
                (30.0 * lean, 30.0),
            ]),
            [Point { x: 0.0, y: 0.0 }, Point { x: 18.0, y: 0.0 }],
            0.8,
        );
        let morph = tissue("streetFrontRow", "gabled-row-house");
        for k in 0..6 {
            let seed = format!("steep/parcel-{k}");
            let fp = preview(&p, &home(&morph, "dwelling.tenement", &seed));
            let body = fp
                .iter()
                .find(|s| s.outer.iter().any(|q| q.y < 0.5))
                .expect("street body");
            let r = &body.outer;
            for i in 0..r.len() {
                let (a, v, c) = (r[(i + r.len() - 1) % r.len()], r[i], r[(i + 1) % r.len()]);
                let (e, f) = (unit(sub(v, a)), unit(sub(c, v)));
                // Square corners (or a straight run), never a 54-126° rhombus.
                assert!(
                    dot(e, f).abs() < 0.3 || dot(e, f) > 0.999,
                    "{seed}: diamond corner in {r:?}"
                );
            }
        }
    }
}
