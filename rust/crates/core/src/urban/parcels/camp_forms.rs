//! Camp forms from placed dwellings (catalogue `campForm`): the camp is laid
//! out as its people pitch it — dwellings as points along the culture's
//! figure, deformed by the land, never a geometric target — and its land is
//! the Voronoi tessellation of those points (the « alvéoles »): each dwelling
//! holds the ground nearer to it than to any neighbour, open-ground points
//! fill the gaps so a cell stays the size of a household's yard.
//!
//! Figures (ethnographic sketch, `_agents_blackboard` camp research):
//! - `circle` — one loose ring open to a bearing, the council ground inside
//!   (Plains gathering camp); a second partial row only for overflow;
//! - `horseshoe` — huts in an arc around the byre, the head's hut at the back
//!   facing the gate (Zulu umuzi, Maasai enkang);
//! - `court` — the head's tent at the back of an open court, the senior
//!   households in a line beside it, the rest in small family groups of a
//!   few tents scattered around and behind, doors toward the opening (Mongol
//!   ordu: ails around the khan's ordo, open to the south);
//! - `plaza` — a few long houses around a rectangular plaza (Tupi-Guarani).
//! A camp too large for one figure splits into several (a new umuzi, a new
//! band circle, a new plaza village) instead of adding rings.
//!
//! Correct by construction like the other camp forms: the tessellation of the
//! plane is computed once from the layout (centre, blocks, key), every block
//! takes its share; cells are convex, so pieces partition a block exactly.
use super::*;
use std::f64::consts::{PI, TAU};

struct Site {
    p: Point,
    hold: Hold,
    /// Sites of one group form one tile (a long house, the head's compound,
    /// the central ground).
    group: usize,
    nominal: f64,
}

struct Plan {
    sites: Vec<Site>,
    paths: Vec<Vec<Point>>,
    groups: usize,
}

pub(super) struct Entry { p:Point, normal:Point, half:f64 }
pub(super) fn entries(layout:&Layout, c:Point)->Vec<Entry> {
    let explicit=|s:&super::super::super::Street|matches!(s.role.as_str(),"regional"|"road"|"gate-street"|"approach"|"outbound");
    let has_regional=layout.streets.iter().any(explicit);
    layout.streets.iter().filter(|s|explicit(s)||!has_regional&&s.rank<=1&&matches!(s.role.as_str(),"street"|"lane"|"track"))
        .filter_map(|s|s.path.windows(2).enumerate().filter(|(_,w)|length(sub(w[1],w[0]))>1e-6)
            .min_by(|(_,a),(_,b)|crate::urban::geometry::distance(c,a[0],a[1]).0.total_cmp(&crate::urban::geometry::distance(c,b[0],b[1]).0))
            .map(|(i,w)|{let d=unit(sub(w[1],w[0]));let a=s.widths.get(i).copied().unwrap_or(4.0);let b=s.widths.get(i+1).copied().unwrap_or(a);
                Entry{p:scale(add(w[0],w[1]),0.5),normal:Point{x:-d.y,y:d.x},half:0.25*(a+b)}}))
        .collect()
}
impl Plan {
    fn group(&mut self) -> usize {
        self.groups += 1;
        self.groups - 1
    }
    fn add(&mut self, p: Point, hold: Hold, nominal: f64) -> usize {
        let g = self.group();
        self.sites.push(Site { p, hold, group: g, nominal });
        g
    }
}

/// Unit vector at a bearing.
fn dir(a: f64) -> Point {
    Point { x: a.cos(), y: a.sin() }
}
fn lerp(a: Point, b: Point, t: f64) -> Point {
    add(a, scale(sub(b, a), t))
}

/// A closed figure around `c`: radius `r` deformed by a few low harmonics
/// and stretched along `axis` (`aspect` ≥ 1), so no two camps share a shape.
struct Figure {
    c: Point,
    r: f64,
    aspect: f64,
    axis: f64,
    harmonics: [(f64, f64); 3],
}
impl Figure {
    fn new(c: Point, r: f64, rng: &mut Rng, wobble: f64) -> Self {
        Figure {
            c,
            r,
            aspect: 1.0 + rng.range(0.0, 0.35) * wobble,
            axis: rng.range(0.0, PI),
            harmonics: [
                (rng.range(0.03, 0.09) * wobble, rng.range(0.0, TAU)),
                (rng.range(0.02, 0.06) * wobble, rng.range(0.0, TAU)),
                (rng.range(0.0, 0.04) * wobble, rng.range(0.0, TAU)),
            ],
        }
    }
    /// Point of the figure at bearing `a`, offset `dr` outward.
    fn at(&self, a: f64, dr: f64) -> Point {
        let k = 1.0
            + self
                .harmonics
                .iter()
                .enumerate()
                .map(|(i, (amp, ph))| amp * ((i as f64 + 2.0) * a + ph).sin())
                .sum::<f64>();
        let rel = a - self.axis;
        let (ex, ey) = (rel.cos() * self.aspect.sqrt(), rel.sin() / self.aspect.sqrt());
        let s = (ex * ex + ey * ey).sqrt();
        let rr = self.r * k * s + dr;
        add(self.c, scale(dir(a), rr))
    }
    /// Arc length of the figure from `a0` over `span` (sampled).
    fn length(&self, a0: f64, span: f64, dr: f64) -> f64 {
        let n = 64;
        (0..n)
            .map(|i| {
                let (t0, t1) = (a0 + span * i as f64 / n as f64, a0 + span * (i + 1) as f64 / n as f64);
                length(sub(self.at(t1, dr), self.at(t0, dr)))
            })
            .sum()
    }
    /// `n` bearings evenly spaced by arc length over `[a0, a0 + span]`.
    fn bearings(&self, a0: f64, span: f64, dr: f64, n: usize) -> Vec<f64> {
        let m = 256;
        let mut acc = vec![0.0];
        for i in 0..m {
            let (t0, t1) = (a0 + span * i as f64 / m as f64, a0 + span * (i + 1) as f64 / m as f64);
            acc.push(acc[i] + length(sub(self.at(t1, dr), self.at(t0, dr))));
        }
        let total = acc[m];
        (0..n)
            .map(|k| {
                let target = total * (k as f64 + 0.5) / n as f64;
                let i = acc.partition_point(|&v| v < target).clamp(1, m);
                let f = (target - acc[i - 1]) / (acc[i] - acc[i - 1]).max(1e-9);
                a0 + span * ((i - 1) as f64 + f) / m as f64
            })
            .collect()
    }
    fn polyline(&self, a0: f64, span: f64, dr: f64) -> Vec<Point> {
        let n = ((span * self.r / 4.0).ceil() as usize).clamp(8, 160);
        (0..=n).map(|i| self.at(a0 + span * i as f64 / n as f64, dr)).collect()
    }
}

/// Households the camp must lodge, one cell per household (or per long
/// house of `per_house` households); `None` without a programme.
fn households(layout: &Layout, per_house: f64) -> Option<usize> {
    let programme = layout.programme.as_ref()?;
    let mut n = 0.0;
    for d in &programme.demands {
        if d.unit == "domesticUnits" && d.requested > 0.0 {
            n += (d.requested / per_house.max(1.0)).ceil();
        } else if d.placement == "parcel" && super::super::super::programme::camps::needs_cell(layout, d) {
            n += d.sites.max(1) as f64;
        }
    }
    (n > 0.0).then_some(n.ceil() as usize)
}

/// Ring figures (circle, horseshoe): `n` dwellings in one row, a second
/// partial row only beyond the figure's capacity, a centre ground, a path on
/// the row's inner side. Returns the figure's outer radius.
#[allow(clippy::too_many_arguments)]
fn ring_unit(
    plan: &mut Plan,
    rng: &mut Rng,
    c: Point,
    n: usize,
    spacing: f64,
    depth: f64,
    path: f64,
    gap: f64,
    beta: f64,
    head: bool,
    centre_frac: f64,
    room: f64,
    on: &dyn Fn(Point) -> bool,
    entries: &[Entry],
) -> f64 {
    let span = TAU - gap;
    // Radius holding the row within the land (`room`), never smaller than a
    // sensible centre ground; what one row cannot hold goes to outer rows.
    let r = (n as f64 * spacing / span).min(0.62 * room).max(depth * (1.0 + 2.0 * centre_frac)).max(12.0);
    let fig = Figure::new(c, r, rng, 1.0);
    let a0 = beta + 0.5 * gap;
    // Centre ground: a few sites inside the inner path, one group.
    // Centre ground sites stay far enough inside that every dwelling's cell
    // reaches across the ring path (its front), jitter included.
    let centre = plan.group();
    let rc = (r - 1.4 * depth - 2.0 * path - 2.0).max(3.0);
    let steps = ((rc / spacing.max(6.0)).ceil() as i32).max(1);
    for i in -steps..=steps {
        for j in -steps..=steps {
            let q = Point { x: i as f64 * rc / steps as f64, y: j as f64 * rc / steps as f64 };
            if length(q) <= rc {
                let rel = q.y.atan2(q.x);
                // Follow the figure's outline, not a circle.
                let k = length(sub(fig.at(rel, 0.0), c)) / fig.r.max(1.0);
                plan.sites.push(Site { p: add(c, scale(q, k)), hold: Hold::Centre, group: centre, nominal: 0.0 });
            }
        }
    }
    plan.paths.push(fig.polyline(a0 - 0.02, span + 0.04, -0.5 * depth - 0.5 * path));
    // The row: dwellings evenly spread by arc, jittered along and across;
    // the head's hut at the back, opposite the opening.
    let mut placed = 0;
    let mut rows = 0;
    for row in 0..4 {
        let dr = row as f64 * (depth + path);
        let left = n - placed;
        let cap = (fig.length(a0, span, dr) / spacing).floor() as usize;
        let k = left.min(cap);
        if k == 0 {
            break;
        }
        rows = row + 1;
        // An outer row fills from the back toward the horns.
        let (b0, bspan) = if row > 0 {
            let s = span * (k as f64 / cap.max(1) as f64).min(1.0);
            (beta + PI - 0.5 * s, s)
        } else {
            (a0, span)
        };
        let bearings = fig.bearings(b0, bspan, dr, k);
        let back = bearings
            .iter()
            .enumerate()
            .min_by(|a, b| {
                let d = |x: f64| ((x - beta - PI).rem_euclid(TAU)).min(TAU - (x - beta - PI).rem_euclid(TAU));
                d(*a.1).total_cmp(&d(*b.1))
            })
            .map(|(i, _)| i);
        for (i, &a) in bearings.iter().enumerate() {
            let jitter = rng.range(-0.22, 0.22) * spacing / fig.r.max(1.0);
            let p = fig.at(a + jitter, dr + rng.range(-0.18, 0.18) * depth);
            if !on(p) {
                continue;
            }
            let is_head = head && row == 0 && Some(i) == back;
            plan.add(p, if is_head { Hold::Head } else { Hold::Dwelling }, spacing * depth * if is_head { 2.0 } else { 1.0 });
            placed += 1;
            // Its mirror across the ring path: the bisector of the pair is the
            // path's axis, so the dwelling's cell ends on the path, and the
            // centre ground begins across it — no sliver of yard beyond the path
            let axis = fig.at(a + jitter, dr - 0.5 * depth - 0.5 * path);
            let mirror = sub(scale(axis, 2.0), p);
            // (an outer row's mirror would stand among the first row's huts:
            // those huts are its neighbours across the path already).
            if row == 0 {
                plan.sites.push(Site { p: mirror, hold: Hold::Centre, group: centre, nominal: 0.0 });
            }
        }
        if row > 0 {
            plan.paths.push(fig.polyline(b0, bspan, dr - 0.5 * depth - 0.5 * path));
        }
    }
    // Enter through the cultural opening, then walk outside the hut rows to
    // actual regional kerbs. Each last leg meets the road across its width.
    let outside=rows.max(1) as f64*(depth+path);
    let gate=fig.at(beta,outside);
    let mut approach=fig.polyline(beta,0.5*gap,-0.5*depth-0.5*path);
    approach.reverse();approach.push(gate);plan.paths.push(approach);
    for entry in entries {
        let mut n=entry.normal;
        if dot(sub(c,entry.p),n)<0. {n=scale(n,-1.);}
        let mut landing=add(entry.p,scale(n,entry.half+path));
        if !on(landing) {n=scale(n,-1.);landing=add(entry.p,scale(n,entry.half+path));}
        if !on(landing) {continue;}
        let a=(landing.y-c.y).atan2(landing.x-c.x);
        let delta=(a-beta+PI).rem_euclid(TAU)-PI;
        let mut way=if delta==0. {vec![gate]}else if delta>0. {fig.polyline(beta,delta,outside)}else{let mut p=fig.polyline(a,-delta,outside);p.reverse();p};
        way.extend([landing,entry.p]);plan.paths.push(way);
    }
    r + outside
}

/// Mongol ordu: the head's tent at the back of the court, the senior tents in
/// a line beside it, then family groups (ails) of 3–8 tents in short lines
/// facing the opening, scattered in a loose band around and behind.
#[allow(clippy::too_many_arguments)]
fn court(plan: &mut Plan, rng: &mut Rng, c: Point, n: usize, spacing: f64, depth: f64, path: f64, beta: f64, on: &dyn Fn(Point) -> bool) {
    let fwd = dir(beta);
    let side = Point { x: -fwd.y, y: fwd.x };
    let court_w = (2.5 * spacing).max(30.0);
    let court_d = (2.0 * spacing).max(26.0);
    // The court: open ground in front of the head.
    let centre = plan.group();
    for i in -2..=2 {
        for j in 1..=3 {
            let q = add(c, add(scale(side, i as f64 * court_w / 5.0), scale(fwd, j as f64 * court_d / 3.5)));
            plan.sites.push(Site { p: q, hold: Hold::Centre, group: centre, nominal: 0.0 });
        }
    }
    // The head's compound (two sites, one tile) at the back of the court,
    // then the senior line beside it, spaced wider than family tents.
    let head = plan.group();
    for s in [-0.35, 0.35] {
        plan.sites.push(Site { p: add(c, scale(side, s * spacing)), hold: Hold::Head, group: head, nominal: 2.0 * spacing * depth });
    }
    let mut placed = 1;
    let senior = (n / 12).clamp(2, 10);
    for k in 0..senior {
        let s = (k / 2 + 1) as f64 * 1.8 * spacing * if k % 2 == 0 { -1.0 } else { 1.0 };
        let p = add(c, add(scale(side, s), scale(fwd, rng.range(-0.3, 0.6) * depth)));
        if on(p) && placed < n {
            plan.add(p, Hold::Dwelling, spacing * depth);
            placed += 1;
        }
    }
    let line_half = (senior / 2 + 1) as f64 * 1.8 * spacing;
    plan.paths.push(vec![add(c, add(scale(side, -line_half), scale(fwd, 0.5 * depth + 0.5 * path))), add(c, add(scale(side, line_half), scale(fwd, 0.5 * depth + 0.5 * path)))]);
    // Family groups: cluster centres by dart throwing in a band that widens
    // until the camp's households are lodged, mostly behind and beside the
    // court (never in front of it, which stays the open approach).
    let min_gap = 3.0 * spacing;
    let mut centres: Vec<Point> = vec![c];
    let mut band = court_w.max(court_d) + 2.0 * spacing;
    let mut tries = 0;
    while placed < n && tries < 20000 {
        tries += 1;
        if tries % 40 == 0 {
            band += spacing;
        }
        // Behind and beside the court first; the approach side only when the
        // land holds nothing more there.
        let open = if tries > 6000 { 1.0 } else { 0.62 };
        let a = beta + PI + rng.range(-open, open) * PI;
        let rr = rng.range(court_w.max(court_d) + spacing, band);
        let q = add(c, scale(dir(a), rr));
        if centres.iter().any(|&o| length(sub(o, q)) < min_gap) || !on(q) {
            continue;
        }
        centres.push(q);
        // An ail: a short line across the opening's direction, doors toward it.
        let k = (rng.int(3, 8) as usize).min(n - placed);
        let tilt = rng.range(-0.35, 0.35);
        let along = add(scale(side, tilt.cos()), scale(fwd, tilt.sin()));
        let step = spacing * rng.range(0.85, 1.25);
        let mut first = None;
        let mut last = None;
        for t in 0..k {
            let off = (t as f64 - 0.5 * (k as f64 - 1.0)) * step;
            let p = add(q, add(scale(along, off), scale(fwd, rng.range(-0.25, 0.25) * depth)));
            if !on(p) {
                continue;
            }
            plan.add(p, Hold::Dwelling, spacing * depth);
            placed += 1;
            first.get_or_insert(p);
            last = Some(p);
        }
        // The ail's front path and its track to the court.
        if let (Some(f), Some(l)) = (first, last) {
            let front = scale(fwd, 0.5 * depth + 0.5 * path);
            let (f, l) = (add(f, front), add(l, front));
            let mid = lerp(f, l, 0.5);
            plan.paths.push(vec![add(f, scale(along, -0.5 * step)), add(l, scale(along, 0.5 * step))]);
            // Its track joins the nearest path already laid (another ail's
            // track or front, the court), so tracks branch like trodden ways.
            let own = plan.paths.len() - 1;
            let to = plan.paths[..own]
                .iter()
                .flat_map(|l| l.windows(2).map(|w| crate::urban::geometry::distance(mid, w[0], w[1])))
                .min_by(|a, b| a.0.total_cmp(&b.0))
                .map_or(c, |d| d.2);
            let bend = add(lerp(mid, to, 0.5), scale(side, rng.range(-0.12, 0.12) * length(sub(to, mid))));
            plan.paths.push(vec![mid, bend, to]);
        }
    }
}

/// Plaza village: long houses (several sites each, one tile) around a
/// rectangular plaza, their long side on it.
#[allow(clippy::too_many_arguments)]
fn plaza(plan: &mut Plan, rng: &mut Rng, c: Point, houses: usize, house: [f64; 2], path: f64, room: f64, on: &dyn Fn(Point) -> bool) {
    let [width, mut len] = house;
    let rot = rng.range(0.0, PI);
    let (u, v) = (dir(rot), dir(rot + 0.5 * PI));
    // The plaza and its ring of houses fit the land (`room`: half extent).
    let per_side = houses.div_ceil(4).max(1) as f64;
    let mut half_l = 0.5 * (per_side * 1.25 * len).max(1.2 * len) * rng.range(0.9, 1.1);
    let fit = (room - width - path - 2.0).max(10.0);
    if half_l > fit {
        len *= fit / half_l;
        half_l = fit;
    }
    let half_w = half_l * rng.range(0.7, 0.9);
    let centre = plan.group();
    for i in -2..=2 {
        for j in -2..=2 {
            plan.sites.push(Site { p: add(c, add(scale(u, i as f64 * (half_l - width) / 2.5), scale(v, j as f64 * (half_w - width) / 2.5))), hold: Hold::Centre, group: centre, nominal: 0.0 });
        }
    }
    let at = |s: f64, t: f64| add(c, add(scale(u, s), scale(v, t)));
    let ring = vec![at(-half_l, -half_w), at(half_l, -half_w), at(half_l, half_w), at(-half_l, half_w), at(-half_l, -half_w)];
    plan.paths.push(ring);
    for h in 0..houses {
        let side = h % 4;
        let slot = (h / 4) as f64;
        let count = ((houses - side) as f64 / 4.0).ceil().max(1.0);
        let pos = (slot + 0.5) / count * 2.0 - 1.0;
        let jitter = rng.range(-0.08, 0.08);
        // Centre of the house, its long axis along the plaza side.
        let (centre_p, axis) = match side {
            0 => (at((pos + jitter) * half_l * 0.75, -half_w - 0.5 * path - 0.5 * width - 1.0), u),
            1 => (at(half_l + 0.5 * path + 0.5 * width + 1.0, (pos + jitter) * half_w * 0.75), v),
            2 => (at((pos + jitter) * half_l * 0.75, half_w + 0.5 * path + 0.5 * width + 1.0), u),
            _ => (at(-half_l - 0.5 * path - 0.5 * width - 1.0, (pos + jitter) * half_w * 0.75), v),
        };
        if !on(centre_p) {
            continue;
        }
        let g = plan.group();
        for t in [-0.33, 0.0, 0.33] {
            plan.sites.push(Site { p: add(centre_p, scale(axis, t * len)), hold: Hold::Dwelling, group: g, nominal: width * len });
        }
    }
}

/// Buckets of site indices for neighbour queries.
struct Grid {
    size: f64,
    x0: f64,
    y0: f64,
    nx: i64,
    ny: i64,
    cells: Vec<Vec<usize>>,
}
impl Grid {
    fn new(points: &[Point], size: f64) -> Self {
        let (x0, y0, x1, y1) = points.iter().fold((f64::MAX, f64::MAX, f64::MIN, f64::MIN), |b, p| (b.0.min(p.x), b.1.min(p.y), b.2.max(p.x), b.3.max(p.y)));
        // At most 512 buckets a side.
        let size = size.max((x1 - x0).max(y1 - y0) / 512.0);
        let nx = ((x1 - x0) / size).floor() as i64 + 1;
        let ny = ((y1 - y0) / size).floor() as i64 + 1;
        let mut cells = vec![vec![]; (nx * ny) as usize];
        for (i, p) in points.iter().enumerate() {
            let (cx, cy) = (((p.x - x0) / size) as i64, ((p.y - y0) / size) as i64);
            cells[(cy * nx + cx) as usize].push(i);
        }
        Grid { size, x0, y0, nx, ny, cells }
    }
    /// Sites within the square of half side `r` around `p`.
    fn near(&self, p: Point, r: f64, out: &mut Vec<usize>) {
        out.clear();
        let lo = |v: f64, o: f64, n: i64| (((v - r - o) / self.size).floor() as i64).clamp(0, n - 1);
        let hi = |v: f64, o: f64, n: i64| (((v + r - o) / self.size).floor() as i64).clamp(0, n - 1);
        for cy in lo(p.y, self.y0, self.ny)..=hi(p.y, self.y0, self.ny) {
            for cx in lo(p.x, self.x0, self.nx)..=hi(p.x, self.x0, self.nx) {
                out.extend_from_slice(&self.cells[(cy * self.nx + cx) as usize]);
            }
        }
    }
}

/// Convex Voronoi cell of site `i` inside the square (half-plane clipping by
/// neighbours of growing radius, canonical bisectors so neighbouring cells
/// share their edge).
fn cell(points: &[Point], i: usize, square: &[Point], grid: &Grid, scratch: &mut Vec<usize>) -> Vec<Point> {
    let pi = points[i];
    let mut poly: Vec<Point> = square.to_vec();
    let mut done = 0.0_f64;
    let mut r = 2.0 * grid.size;
    loop {
        grid.near(pi, r, scratch);
        let mut order: Vec<(f64, usize)> = scratch
            .iter()
            .filter(|&&j| j != i)
            .map(|&j| (length(sub(points[j], pi)), j))
            .filter(|&(d, _)| d >= done && d < r && d > 1e-6)
            .collect();
        order.sort_by(|a, b| a.0.total_cmp(&b.0).then(a.1.cmp(&b.1)));
        for &(_, j) in &order {
            let (a, b) = if i < j { (pi, points[j]) } else { (points[j], pi) };
            let m = lerp(a, b, 0.5);
            let nrm = sub(b, a);
            let side = |p: Point| dot(sub(p, m), nrm);
            let keep = |p: Point| if i < j { side(p) <= 0.0 } else { side(p) >= 0.0 };
            let mut out = Vec::with_capacity(poly.len() + 1);
            for k in 0..poly.len() {
                let (p, q) = (poly[k], poly[(k + 1) % poly.len()]);
                let (kp, kq) = (keep(p), keep(q));
                if kp {
                    out.push(p);
                }
                if kp != kq {
                    let (sp, sq) = (side(p), side(q));
                    out.push(lerp(p, q, sp / (sp - sq)));
                }
            }
            poly = out;
            if poly.len() < 3 {
                return vec![];
            }
        }
        // Every site farther than twice the cell's reach cannot cut it.
        let reach = poly.iter().map(|&v| length(sub(v, pi))).fold(0.0, f64::max);
        if 2.0 * reach <= r {
            break;
        }
        done = r;
        r = 2.0 * reach + 1e-6;
    }
    // A shared grid makes vertices computed from both sides coincide.
    poly.iter().map(|p| Point { x: (p.x * 1e5).round() / 1e5, y: (p.y * 1e5).round() / 1e5 }).collect()
}

fn near_polyline(p: Point, lines: &[Vec<Point>], r: f64) -> bool {
    lines.iter().any(|l| l.windows(2).any(|w| crate::urban::geometry::distance(p, w[0], w[1]).0 < r))
}

/// The camp's tiles and paths for a `campForm` figure.
pub(super) fn tiles(frame: &Frame, morph: &Morph, layout: &Layout) -> (Vec<Tile>, Vec<Shape>) {
    tiles_with_allowance(frame,morph,layout,1.0)
}
pub(super) fn tiles_with_allowance(frame:&Frame,morph:&Morph,layout:&Layout,allowance:f64)->(Vec<Tile>,Vec<Shape>) {
    let form = morph.text("campForm");
    let mut rng = Rng::new(&format!("camp-form:{}:{form}", frame.key));
    let depth = morph.number_or("campRow", 10.0).max(4.0);
    let [arc_lo, arc_hi] = morph.pair("campArc");
    let spacing = 0.5 * (arc_lo.max(4.0) + arc_hi.max(arc_lo.max(4.0)));
    let path = morph.number_or("campPath", 3.0).clamp(1.2, 8.0);
    let gap = morph.number_or("campGap", 0.0).clamp(0.0, 150.0).to_radians();
    let unit_max = morph.number_or("campUnitMax", 0.0).max(0.0) as usize;
    let beta = opening(frame, morph, layout);
    let entries=entries(layout,frame.centre);
    let on = |p: Point| on_land(layout, p);
    let mut plan = Plan { sites: vec![], paths: vec![], groups: 0 };
    let [house_w, house_l] = morph.pair("campHouse");
    let per_house = if form == "plaza" { (house_w * house_l / 120.0).max(1.0) } else { 1.0 };
    // Households, else what the land holds at the figure's density.
    // A capacity probe (no programme) sizes one figure from the land, never a
    // field of daughter camps over the whole territory.
    // The land bounds the camp: a probe's open-ended demand (or none) never
    // lays out more dwellings than the land holds at the figure's density.
    let land = ((frame.equivalent * frame.equivalent * PI) / (spacing * depth * 2.5)).ceil().clamp(3.0, 800.0) as usize;
    // (A real programme is lodged in full; only an open-ended probe demand,
    // far beyond the land, is cut to it.)
    let n = match households(layout, per_house) {
        Some(h) if h <= 4 * land => (h as f64*allowance).ceil() as usize,
        Some(_) => land,
        None => land.min(400),
    }
    .max(3);
    match form {
        "court" => {
            // Nomad spacing shrinks to what the camp's land offers per tent.
            let per_tent = (PI * frame.equivalent * frame.equivalent / n as f64).sqrt();
            let s = (0.75 * per_tent).clamp(0.6 * spacing, spacing);
            court(&mut plan, &mut rng, frame.centre, n, s, depth, path, beta, &on)
        }
        "plaza" => {
            let per = if unit_max > 0 { unit_max } else { 8 };
            let mut centres = vec![frame.centre];
            for u in 1..n.div_ceil(per) {
                let c = add(frame.centre, scale(dir(beta + u as f64 * 2.4), 2.6 * house_l * (1.0 + (u / 3) as f64)));
                if on(c) { centres.push(c); }
            }
            // A daughter plaza needs real land; otherwise the first figure
            // holds the overflow, as the ring grammar already does.
            let units = centres.len();
            for (u, &c) in centres.iter().enumerate() {
                let k = n / units + usize::from(u < n % units);
                plaza(&mut plan, &mut rng, c, k.max(3), [house_w.max(6.0), house_l.max(12.0)], path, 0.8 * frame.equivalent / (units as f64).sqrt(), &on);
            }
        }
        _ => {
            // circle / horseshoe: one figure per unit of at most `unit_max`.
            let per = if unit_max > 0 { unit_max } else { usize::MAX };
            let wanted = n.div_ceil(per).max(1);
            let head = morph.text("campHead") == "back";
            let centre_frac = morph.number_or("campCentre", 0.3);
            // Daughter camps stand on the land beyond the first one, away from
            // its opening; those the land cannot hold stay in the first camp
            // (an extra row) rather than off the map.
            let k0 = n.div_ceil(wanted);
            let est = (k0 as f64 * spacing / (TAU - gap)).min(0.62 * frame.equivalent) + 2.0 * (depth + path);
            let mut centres = vec![frame.centre];
            for u in 1..wanted {
                let base = beta + PI + (u as f64 - 0.5 * (wanted as f64 - 1.0)) * 1.1;
                let found = (0..12).map(|t| base + t as f64 * TAU / 12.0).map(|a| add(frame.centre, scale(dir(a), 2.3 * est))).find(|&c| on(c));
                if let Some(c) = found {
                    centres.push(c);
                }
            }
            let units = centres.len();
            for (u, &c) in centres.iter().enumerate() {
                let k = n.div_ceil(units).min(n.saturating_sub(u * n.div_ceil(units)));
                if k == 0 {
                    break;
                }
                ring_unit(&mut plan, &mut rng, c, k, spacing, depth, path, gap, beta, head, centre_frac, frame.equivalent / (units as f64).sqrt(), &on, if u==0 {entries.as_slice()}else{&[]});
                if u > 0 {
                    plan.paths.push(vec![frame.centre, lerp(frame.centre, c, 0.5), c]);
                }
            }
        }
    }
    // Open ground between and around the dwellings: a jittered grid of
    // open sites, kept off the dwellings, the centre grounds and the paths,
    // so every household's cell is the size of its yard.
    let (minx, miny, maxx, maxy) = plan.sites.iter().fold((f64::MAX, f64::MAX, f64::MIN, f64::MIN), |b, s| (b.0.min(s.p.x), b.1.min(s.p.y), b.2.max(s.p.x), b.3.max(s.p.y)));
    let g = 1.1 * spacing.max(depth);
    let margin = 3.0 * g;
    let filled: Vec<Point> = plan.sites.iter().map(|s| s.p).collect();
    let clear = 0.5 * depth + path;
    // Open sites merge by coarse square into a few open tiles: open ground
    // is common land, not one parcel (and one footpath) per gap.
    let chunk = 5.0 * g;
    let mut open_groups: std::collections::HashMap<(i64, i64), usize> = std::collections::HashMap::new();
    let mut open_site = |plan: &mut Plan, q: Point, size: f64| {
        let key = ((q.x / size).floor() as i64, (q.y / size).floor() as i64 + (1 << 40) * i64::from(size > chunk));
        let next = plan.groups;
        let group = *open_groups.entry(key).or_insert(next);
        if group == next {
            plan.groups += 1;
        }
        plan.sites.push(Site { p: q, hold: Hold::Open, group, nominal: 0.0 });
    };
    let mut y = miny - margin;
    while y <= maxy + margin {
        let mut x = minx - margin;
        while x <= maxx + margin {
            let q = Point { x: x + rng.range(-0.3, 0.3) * g, y: y + rng.range(-0.3, 0.3) * g };
            if !filled.iter().any(|&o| length(sub(o, q)) < 0.85 * g) && !near_polyline(q, &plan.paths, clear) {
                open_site(&mut plan, q, chunk);
            }
            x += g;
        }
        y += g;
    }
    // Far ground: a coarse grid out to the camp's land.
    // At most ~40 × 40 far sites whatever the land's extent.
    let far_step = (6.0 * g).max(frame.reach / 20.0);
    let reach = frame.reach + far_step;
    let mut y = frame.centre.y - reach;
    while y <= frame.centre.y + reach {
        let mut x = frame.centre.x - reach;
        while x <= frame.centre.x + reach {
            let q = Point { x, y };
            if q.x < minx - margin - 0.5 * g || q.x > maxx + margin + 0.5 * g || q.y < miny - margin - 0.5 * g || q.y > maxy + margin + 0.5 * g {
                open_site(&mut plan, q, 4.0 * far_step);
            }
            x += far_step;
        }
        y += far_step;
    }
    // Tessellation: one convex cell per site, merged per group.
    let far = 2.0 * frame.reach + 100.0;
    let square = [
        Point { x: frame.centre.x - far, y: frame.centre.y - far },
        Point { x: frame.centre.x + far, y: frame.centre.y - far },
        Point { x: frame.centre.x + far, y: frame.centre.y + far },
        Point { x: frame.centre.x - far, y: frame.centre.y + far },
    ];
    let points: Vec<Point> = plan.sites.iter().map(|s| s.p).collect();
    let grid = Grid::new(&points, g);
    let mut scratch = Vec::new();
    let mut by_group: Vec<Vec<Shape>> = vec![vec![]; plan.groups];
    for i in 0..points.len() {
        let outer = cell(&points, i, &square, &grid, &mut scratch);
        if outer.len() >= 3 {
            by_group[plan.sites[i].group].push(Shape { outer, holes: vec![] });
        }
    }
    let mut meta: Vec<Option<(Hold, f64)>> = vec![None; plan.groups];
    for s in &plan.sites {
        meta[s.group] = Some((s.hold, s.nominal));
    }
    let mut tiles = vec![];
    for (g, shapes) in by_group.into_iter().enumerate() {
        let Some((hold, nominal)) = meta[g] else { continue };
        let merged = if shapes.len() > 1 { union(&shapes) } else { shapes };
        for shape in merged {
            tiles.push(Tile { shape, hold, nominal, cut: true });
        }
    }
    let paths: Vec<Shape> = plan.paths.iter().filter(|l| l.len() >= 2).flat_map(|l| ribbon(l, &[path])).collect();
    (tiles, paths)
}

#[cfg(test)]
mod tests {
    use super::super::super::super::geometry::rectangle;
    use super::*;

    fn layout(shape: &Shape) -> Layout {
        serde_json::from_value(serde_json::json!({
            "key": "camp-form-test", "culture": "kraal", "center": {"x": 0.0, "y": 0.0},
            "quarters": [], "streets": [{"path": [{"x": -300.0, "y": -150.0}, {"x": 300.0, "y": -150.0}],
                "widths": [6.0, 6.0], "rank": 0, "role": "regional"}],
            "blocks": [{"shape": shape, "quarter": 0, "kind": "block", "axis": {"x": 1.0, "y": 0.0}, "zone": "village"}],
            "warnings": []
        }))
        .unwrap()
    }

    /// Invariant: a figure camp partitions its block exactly, lodges its
    /// dwellings in cells of a household's size, and stays fast.
    #[test]
    fn horseshoe_camp_partitions_its_block_into_household_cells() {
        let shape = rectangle(-140.0, -146.0, 140.0, 140.0);
        let l = layout(&shape);
        let mut fronts = contacts::street_contacts(&shape, &l, &FrontageIndex::new(&l));
        let morph = Morph {
            value: serde_json::json!({"campLayout":"ring","campForm":"horseshoe","campRow":9.5,"campArc":[9.0,10.5],
                "campPath":2.5,"campGap":50.0,"campCentre":0.3,"campHead":"back","campCentreUse":"byre","campUnitMax":40}),
        };
        let t0 = std::time::Instant::now();
        let lots = super::super::lots(&shape, 0, Point { x: 1.0, y: 0.0 }, &mut fronts, &morph, &l);
        let ms = t0.elapsed().as_millis();
        let total: f64 = lots.iter().map(|p| area(&p.shape)).sum();
        assert!((total - area(&shape)).abs() < 1e-3 * area(&shape), "{total} vs {}", area(&shape));
        let huts: Vec<_> = lots.iter().filter(|p| p.use_kind == "plot").collect();
        assert!(huts.len() >= 20, "{}", huts.len());
        assert!(ms < 3000, "{ms} ms");
    }
}
