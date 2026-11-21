//! The recursive street split of a quarter: each piece too large for a block
//! is crossed by the best traced street among several seeds, and both sides
//! are split again.

use super::field::{Field, smooth};
use super::grade::{path_clear, path_grade};
use super::slope::cross_contour;
use super::trace::{TraceIndex, trace};
use crate::tissue::DraftStreet;
use magna_urbis_geom::{
    Point, Shape, area, centroid, contains, intersection, segment_hit, simplify, split,
};
use magna_urbis_random::Rng;
use std::cell::OnceCell;
use std::f64::consts::{FRAC_PI_2, PI};

/// Small places a quarter may keep from leftovers of its cuts.
const MAX_PLACES: usize = 6;
/// Smallest leftover in square metres kept as a place.
const MIN_PLACE: f64 = 120.0;
/// Smallest width in metres of a place.
const MIN_PLACE_WIDTH: f64 = 6.0;
/// Distance in metres within which a street end snaps onto a piece corner.
const SNAP: f64 = 6.0;

/// Tightest bounding box of a ring over its edge directions: centre, long axis
/// `u`, short axis `v` and the half sides along them.
#[derive(Clone, Copy)]
pub(super) struct Frame {
    c: Point,
    u: Point,
    v: Point,
    hu: f64,
    pub(super) hv: f64,
}

pub(super) fn frame(s: &Shape) -> Frame {
    let mut best = None;
    let mut ba = f64::INFINITY;
    for i in 0..s.outer.len() {
        let a = s.outer[i];
        let b = s.outer[(i + 1) % s.outer.len()];
        let l = a.distance(b);
        if l < 1e-8 {
            continue;
        }
        let u = Point {
            x: (b.x - a.x) / l,
            y: (b.y - a.y) / l,
        };
        let v = Point { x: -u.y, y: u.x };
        let (mut x0, mut y0, mut x1, mut y1) = (
            f64::INFINITY,
            f64::INFINITY,
            f64::NEG_INFINITY,
            f64::NEG_INFINITY,
        );
        for p in &s.outer {
            let x = p.x * u.x + p.y * u.y;
            let y = p.x * v.x + p.y * v.y;
            x0 = x0.min(x);
            x1 = x1.max(x);
            y0 = y0.min(y);
            y1 = y1.max(y);
        }
        let ar = (x1 - x0) * (y1 - y0);
        if ar < ba {
            ba = ar;
            let mut f = Frame {
                c: Point {
                    x: u.x * (x0 + x1) * 0.5 + v.x * (y0 + y1) * 0.5,
                    y: u.y * (x0 + x1) * 0.5 + v.y * (y0 + y1) * 0.5,
                },
                u,
                v,
                hu: (x1 - x0) * 0.5,
                hv: (y1 - y0) * 0.5,
            };
            if f.hu < f.hv {
                std::mem::swap(&mut f.u, &mut f.v);
                std::mem::swap(&mut f.hu, &mut f.hv);
            }
            best = Some(f);
        }
    }
    best.unwrap_or(Frame {
        c: centroid(s),
        u: Point { x: 1.0, y: 0.0 },
        v: Point { x: 0.0, y: 1.0 },
        hu: 0.0,
        hv: 0.0,
    })
}

fn length(path: &[Point]) -> f64 {
    path.windows(2).map(|q| q[0].distance(q[1])).sum()
}

/// What a piece of the split became.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PieceKind {
    /// Land for lots.
    Block,
    /// A small leftover kept open as a place.
    Place,
}

/// A piece of the quarter between its outline and the draft streets.
#[derive(Clone, Debug)]
pub struct Piece {
    /// Outline of the piece, the streets' centre lines included.
    pub shape: Shape,
    /// Depth in the split: 1 for the whole quarter.
    pub level: usize,
    /// Block or place.
    pub kind: PieceKind,
}

/// A cut that can be made: cost, both sides, the street, its rank, and whether
/// each side is kept as a place.
struct Candidate {
    cost: f64,
    a: Shape,
    b: Shape,
    path: Vec<Point>,
    rank: u8,
    place_a: bool,
    place_b: bool,
}

/// Whether a street end lies on a ring corner sharper than 25 degrees.
fn acute_ends(s: &Shape, path: &[Point]) -> bool {
    let r = &s.outer;
    let ends = [path[0], *path.last().unwrap()];
    r.iter().enumerate().any(|(i, &p)| {
        if !ends.iter().any(|q| q.distance(p) < 0.05) {
            return false;
        }
        let a = r[(i + r.len() - 1) % r.len()];
        let b = r[(i + 1) % r.len()];
        let u = Point {
            x: a.x - p.x,
            y: a.y - p.y,
        };
        let v = Point {
            x: b.x - p.x,
            y: b.y - p.y,
        };
        let angle = ((u.x * v.x + u.y * v.y) / (u.x.hypot(u.y) * v.x.hypot(v.y)).max(1e-9))
            .clamp(-1.0, 1.0)
            .acos();
        angle < 25.0 * PI / 180.0
    })
}

/// The street split of one quarter outline.
pub(super) struct Splitter<'f, 'a> {
    pub(super) field: &'f Field<'a>,
    pub(super) streets: Vec<DraftStreet>,
    places: usize,
}

impl<'f, 'a> Splitter<'f, 'a> {
    pub(super) fn new(field: &'f Field<'a>) -> Self {
        Self {
            field,
            streets: vec![],
            places: 0,
        }
    }

    /// Whether a cut may be a flight of stairs. On a steep quarter it may not: its flights are
    /// the stepped links laid after the split (`tissue::stairs`), short and spaced.
    fn stairs_allowed(&self) -> bool {
        self.field.params.allow_stairs && self.field.steep == 0.0
    }

    /// Add a street whose width changes gradually from one random end width to the other.
    fn add(&mut self, path: Vec<Point>, rank: u8, role: &str, rng: &mut Rng) {
        if path.len() < 2 || length(&path) < 0.2 {
            return;
        }
        let params = self.field.params;
        let wa = params.width(rank, rng);
        let wb = params.width(rank, rng);
        let total = length(&path);
        let mut at = 0.0;
        let widths = path
            .iter()
            .enumerate()
            .map(|(i, p)| {
                if i > 0 {
                    at += p.distance(path[i - 1]);
                }
                let width = wa + (wb - wa) * at / total;
                if role == "stairs" {
                    width.min(2.2)
                } else {
                    width
                }
            })
            .collect();
        self.streets.push(DraftStreet {
            path,
            widths,
            rank,
            role: role.into(),
        });
    }

    /// One cut through `seed` along `heading`: traced within the street
    /// grades (lane, then one short flight of stairs when allowed, as
    /// fallbacks), snapped onto the piece's corners, with both sides
    /// admissible. Its cost weighs balance, grade, slenderness and, on a steep
    /// quarter, its run across the contours, with a small random share.
    #[allow(clippy::too_many_arguments)]
    fn candidate(
        &self,
        pc: &Piece,
        index: &OnceCell<TraceIndex>,
        seed: Point,
        heading: f64,
        rank: u8,
        a0: f64,
        rng: &mut Rng,
    ) -> Option<Candidate> {
        let field = self.field;
        let params = field.params;
        let terrain = field.terrain;
        if !contains(&pc.shape, seed) {
            return None;
        }
        let grade = if rank < 3 {
            params.max_street_grade
        } else {
            params.max_lane_grade
        };
        let index = index.get_or_init(|| TraceIndex::new(&pc.shape));
        let traced = |limit| {
            Some((
                trace(field, &pc.shape, index, seed, heading + PI, limit)?,
                trace(field, &pc.shape, index, seed, heading, limit)?,
            ))
        };
        let stairs = self.stairs_allowed();
        let walked = traced(grade).or_else(|| traced(params.max_lane_grade));
        let (mut back, front, flight) = match walked {
            Some((back, front)) => (back, front, false),
            None if stairs => {
                let (back, front) = traced(params.max_stair_grade)?;
                (back, front, true)
            }
            None => return None,
        };
        back.reverse();
        back.extend(front.into_iter().skip(1));
        // A cut that needs stairs is one flight, and flights stay short.
        if flight && length(&back) > params.slope.stairs.max_length {
            return None;
        }
        // The 5 m steps carry no shape below half a metre; fewer vertices make
        // every later split cheaper. A steep quarter lays no stairs, so there the
        // simplified cut keeps lane grade.
        let simple_grade = if field.steep > 0.0 {
            params.max_lane_grade
        } else {
            params.max_stair_grade
        };
        let simple = simplify(&back, 0.5, |_| false);
        if simple.len() < back.len() && path_clear(terrain, &simple, simple_grade) {
            back = simple;
        }
        // Snap each end onto the nearest piece corner within reach, so streets
        // meet at shared junctions.
        let mut snapped = back.clone();
        for end in [0, back.len() - 1] {
            if let Some(&v) = pc
                .shape
                .outer
                .iter()
                .filter(|p| p.distance(back[end]) < SNAP)
                .min_by(|a, b| a.distance(back[end]).total_cmp(&b.distance(back[end])))
            {
                snapped[end] = v;
            }
        }
        let allowed = if stairs {
            params.max_stair_grade
        } else {
            params.max_lane_grade
        };
        let snapped_split = if path_clear(terrain, &snapped, allowed) {
            split(&pc.shape, &snapped)
        } else {
            None
        };
        if snapped_split.is_some() {
            back = snapped;
        }
        let (a, b) = snapped_split.or_else(|| split(&pc.shape, &back))?;
        let (aa, ab) = (area(&a), area(&b));
        let can_place =
            |ar: f64| ar >= MIN_PLACE && ar <= params.place_threshold && self.places < MAX_PLACES;
        let bad_a = aa < params.min_block || acute_ends(&a, &back);
        let bad_b = ab < params.min_block || acute_ends(&b, &back);
        let place_a = bad_a && can_place(aa);
        let place_b = bad_b && can_place(ab);
        if bad_a && !place_a || bad_b && !place_b {
            return None;
        }
        let (fa, fb) = (frame(&a), frame(&b));
        let narrow = |f: &Frame, place: bool| {
            f.hv * 2.0
                < if place {
                    MIN_PLACE_WIDTH
                } else {
                    params.min_width
                }
        };
        if narrow(&fa, place_a) || narrow(&fb, place_b) {
            return None;
        }
        let steepest = path_grade(terrain, &back);
        // On a steep quarter, cuts along the contours are preferred.
        let across = if field.steep > 0.0 {
            field.steep * params.slope.contour_cut * cross_contour(terrain, &back)
        } else {
            0.0
        };
        let cost = (aa - ab).abs() / a0
            + if steepest > params.max_lane_grade {
                0.8
            } else if steepest > grade {
                0.2
            } else {
                0.0
            }
            + 0.25
                * ((fa.hu / fa.hv.max(1.0) - 2.5).max(0.0)
                    + (fb.hu / fb.hv.max(1.0) - 2.5).max(0.0))
            + across
            + rng.float() * 0.08;
        Some(Candidate {
            cost,
            a,
            b,
            path: back,
            rank,
            place_a,
            place_b,
        })
    }

    /// Seeds of cuts square to the piece's longest sides: a point a short way
    /// inside each, heading away from it. Every side of a piece lies on the
    /// quarter outline or on a draft street, so every side fronts the network.
    fn anchors(shape: &Shape, half_width: f64) -> Vec<(Point, f64)> {
        let ring = &shape.outer;
        let mut sides: Vec<(f64, Point, Point)> = ring
            .iter()
            .zip(ring.iter().cycle().skip(1))
            .take(ring.len())
            .filter_map(|(&a, &b)| {
                let length = a.distance(b);
                (length >= 12.0).then(|| {
                    let mid = Point {
                        x: (a.x + b.x) * 0.5,
                        y: (a.y + b.y) * 0.5,
                    };
                    (
                        length,
                        mid,
                        Point {
                            x: -(b.y - a.y) / length,
                            y: (b.x - a.x) / length,
                        },
                    )
                })
            })
            .collect();
        sides.sort_by(|a, b| b.0.total_cmp(&a.0));
        let depth = (half_width * 0.5).clamp(6.0, 30.0);
        sides
            .into_iter()
            .take(8)
            .filter_map(|(_, mid, n)| {
                [1.0, -1.0].into_iter().find_map(|sign| {
                    let seed = Point {
                        x: mid.x + n.x * sign * depth,
                        y: mid.y + n.y * sign * depth,
                    };
                    contains(shape, seed).then(|| (seed, (n.y * sign).atan2(n.x * sign)))
                })
            })
            .collect()
    }

    /// Straight cut of a large piece around holes: a chord from a side seed
    /// (or the middle) across to the outer ring on both sides. The land splits
    /// along the chord; the street is the chord without its stretches over
    /// holes, each stretch within the allowed grade. Both sides must be blocks.
    fn straight_cut(&self, pc: &Piece, half_width: f64) -> Option<(Vec<Shape>, Vec<Vec<Point>>)> {
        let params = self.field.params;
        let ring = &pc.shape.outer;
        let a0 = area(&pc.shape);
        let f = frame(&pc.shape);
        let mut seeds = Self::anchors(&pc.shape, half_width);
        for t in [0.0, -0.3, 0.3] {
            let c = Point {
                x: f.c.x + f.u.x * f.hu * t,
                y: f.c.y + f.u.y * f.hu * t,
            };
            if contains(&pc.shape, c) {
                for heading in [f.u.y.atan2(f.u.x) + FRAC_PI_2, f.u.y.atan2(f.u.x)] {
                    seeds.push((c, heading));
                }
            }
        }
        let reach = 2.0 * (f.hu + f.hv) + 10.0;
        let grade = if self.stairs_allowed() {
            params.max_stair_grade
        } else {
            params.max_lane_grade
        };
        let mut best: Option<(f64, Vec<Shape>, Vec<Vec<Point>>)> = None;
        for (seed, heading) in seeds {
            let d = Point {
                x: heading.cos(),
                y: heading.sin(),
            };
            // Nearest outer-ring crossing on one side of the seed, with its edge.
            let end = |sign: f64| {
                let far = Point {
                    x: seed.x + d.x * sign * reach,
                    y: seed.y + d.y * sign * reach,
                };
                ring.iter()
                    .zip(ring.iter().cycle().skip(1))
                    .take(ring.len())
                    .enumerate()
                    .filter_map(|(k, (&a, &b))| segment_hit(seed, far, a, b).map(|h| (h, k)))
                    .min_by(|a, b| a.0.0.total_cmp(&b.0.0))
                    .map(|(h, k)| (h.1, k))
            };
            let (Some((a, ia)), Some((b, ib))) = (end(-1.0), end(1.0)) else {
                continue;
            };
            let chord = a.distance(b);
            if ia == ib || chord < 2.0 * params.min_width.max(10.0) {
                continue;
            }
            let mut parts = chord_split(&pc.shape, a, ia, b, ib);
            parts.sort_by(|p, q| area(q).total_cmp(&area(p)));
            if !(2..=4).contains(&parts.len())
                || parts[..2].iter().any(|p| area(p) < params.min_block)
                || (parts.iter().map(area).sum::<f64>() - a0).abs() > a0 * 1e-3
            {
                continue;
            }
            // The street: the chord's stretches over land, sampled every 2 m.
            let steps = (chord / 2.0).ceil().max(2.0) as usize;
            let at = |k: usize| Point {
                x: a.x + (b.x - a.x) * k as f64 / steps as f64,
                y: a.y + (b.y - a.y) * k as f64 / steps as f64,
            };
            let mut paths = vec![];
            let mut run: Vec<Point> = vec![];
            for k in 0..=steps {
                let p = at(k);
                let inside = k == 0 || k == steps || contains(&pc.shape, p);
                if inside {
                    run.push(p);
                }
                if !inside || k == steps {
                    if run.len() >= 2 {
                        let path = vec![run[0], *run.last().unwrap()];
                        if path_clear(self.field.terrain, &path, grade) {
                            paths.push(path);
                        }
                    }
                    run.clear();
                }
            }
            if paths.is_empty() {
                continue;
            }
            let cost =
                (area(&parts[0]) - area(&parts[1])).abs() / a0 + 0.2 * (parts.len() - 2) as f64;
            if best.as_ref().is_none_or(|b| cost < b.0) {
                best = Some((cost, parts, paths));
            }
        }
        best.map(|(_, parts, paths)| (parts, paths))
    }

    /// Split the quarter outline into pieces, laying the streets between them.
    pub(super) fn run(&mut self, outline: &Shape, rng: &mut Rng) -> Vec<Piece> {
        let field = self.field;
        let params = field.params;
        let mut queue = vec![Piece {
            shape: outline.clone(),
            level: 1,
            kind: PieceKind::Block,
        }];
        let mut out = vec![];
        let mut guard = 0;
        // A safety bound on the cuts, scaled with the quarter's land.
        let bound = 4000 + (area(outline) / 400.0) as usize;
        let bs = params.block_size;
        while let Some(pc) = queue.pop() {
            guard += 1;
            if guard > bound {
                out.push(pc);
                out.extend(queue);
                break;
            }
            let a0 = area(&pc.shape);
            let f = frame(&pc.shape);
            // A block target drawn log-uniformly in the zone's range, a little
            // smaller near the centre.
            let target = bs[0].max(1.0)
                * (bs[1].max(bs[0].max(1.0)) / bs[0].max(1.0)).powf(rng.float())
                * (0.85 + 0.15 * smooth(f.c.distance(field.centre), 50.0, 320.0));
            let small = a0 < target && f.hu / f.hv.max(1.0) < params.max_aspect;
            if pc.kind != PieceKind::Block || small || a0 < 2.0 * params.min_block {
                out.push(pc);
                continue;
            }
            // A cut through land worth many blocks is a street; the rest are lanes.
            let rank = if pc.level <= 1 || a0 > 4.0 * bs[1].max(bs[0]) {
                2
            } else {
                3
            };
            let angle = field.angle(f.c);
            let index = OnceCell::new();
            let mut best: Option<Candidate> = None;
            for fi in 0..2 {
                let heading = angle + fi as f64 * FRAC_PI_2;
                let mut seeds = vec![];
                for t in [0.5, 0.4, 0.6, 0.33, 0.67] {
                    let v = (t + rng.range(-0.04, 0.04) - 0.5) * 2.0 * f.hu * 0.92;
                    let w = rng.range(-0.15, 0.15) * f.hv;
                    seeds.push(Point {
                        x: f.c.x + f.u.x * v + f.v.x * w,
                        y: f.c.y + f.u.y * v + f.v.y * w,
                    });
                }
                for seed in seeds {
                    if let Some(c) = self.candidate(&pc, &index, seed, heading, rank, a0, rng)
                        && best.as_ref().is_none_or(|b| c.cost < b.cost)
                    {
                        best = Some(c);
                    }
                }
            }
            // A piece worth several blocks stays subdivided: when no cut from
            // its middle succeeds, cuts are anchored on its sides, square to them.
            if best.is_none() && a0 > 2.0 * target.max(params.min_block) {
                for (seed, heading) in Self::anchors(&pc.shape, f.hv) {
                    if let Some(c) = self.candidate(&pc, &index, seed, heading, rank, a0, rng)
                        && best.as_ref().is_none_or(|b| c.cost < b.cost)
                    {
                        best = Some(c);
                    }
                }
            }
            // A piece worth many blocks that no traced cut can split (holes in
            // the way) is crossed by a straight street that stops at the holes.
            if best.is_none()
                && a0 > 4.0 * target.max(params.min_block)
                && let Some((parts, paths)) = self.straight_cut(&pc, f.hv)
            {
                for path in paths {
                    self.add(path, 2, "street", rng);
                }
                for shape in parts {
                    queue.push(Piece {
                        shape,
                        level: pc.level + 1,
                        kind: PieceKind::Block,
                    });
                }
                continue;
            }
            let Some(c) = best else {
                out.push(pc);
                continue;
            };
            let mut rank = c.rank;
            if params.long_cut > 0.0
                && length(&c.path) >= params.long_cut
                && path_clear(field.terrain, &c.path, params.max_street_grade)
            {
                rank = rank.min(2);
            }
            let steepest = path_grade(field.terrain, &c.path);
            if steepest > params.max_street_grade {
                rank = 3;
            }
            let role = if steepest > params.max_lane_grade {
                rank = 3;
                "stairs"
            } else if rank <= 2 {
                "street"
            } else {
                "lane"
            };
            self.add(c.path, rank, role, rng);
            if c.place_a || c.place_b {
                self.places += 1;
            }
            let kind = |place: bool| {
                if place {
                    PieceKind::Place
                } else {
                    PieceKind::Block
                }
            };
            queue.push(Piece {
                shape: c.a,
                level: pc.level + 1,
                kind: kind(c.place_a),
            });
            queue.push(Piece {
                shape: c.b,
                level: pc.level + 1,
                kind: kind(c.place_b),
            });
        }
        out
    }
}

/// The two sides of a chord from `a` (on outer edge `ia`) to `b` (on edge
/// `ib`): each ring walk closed by the chord, intersected with the shape so
/// its holes stay holes.
fn chord_split(shape: &Shape, a: Point, ia: usize, b: Point, ib: usize) -> Vec<Shape> {
    let ring = &shape.outer;
    let n = ring.len();
    let walk = |from: usize, to: usize, start: Point, end: Point| {
        let mut r = vec![start];
        let mut k = (from + 1) % n;
        for _ in 0..n {
            r.push(ring[k]);
            if k == to {
                break;
            }
            k = (k + 1) % n;
        }
        r.push(end);
        Shape {
            outer: r,
            holes: vec![],
        }
    };
    [walk(ia, ib, a, b), walk(ib, ia, b, a)]
        .iter()
        .flat_map(|side| intersection(shape, side))
        .filter(|p| area(p) > 1.0)
        .collect()
}
